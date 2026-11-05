"""auto-build.sh 的辅助：读 docs/TASKS.md 选下一项，解析 claude -p 的 JSON 输出。只用标准库。
用法：
  python -X utf8 scripts/auto_build_status.py next M2 [--skip-p1]
      -> TASK <id> | GATE <id> | MANUAL <id> | DEPS <id> <缺的依赖,逗号分隔> | DONE - | NOSECTION -
      设了 AUTO_BUILD_TASKS="M4-T01,M4-T02,..." 时进入任务清单模式：不看里程碑顺序，按清单顺序返回第一个
      未勾选、依赖都已 [x] 的任务；清单里的闸门或人工任务照常返回 GATE / MANUAL；都还卡在依赖上时返回
      清单里第一个未勾选任务的 DEPS；清单全部勾选返回 DONE -；清单里有 TASKS.md 找不到的 ID 返回 UNKNOWN <id>
  python -X utf8 scripts/auto_build_status.py checklist GATE-M4
  python -X utf8 scripts/auto_build_status.py parse <round.json>
      -> <STATUS|NONE> <session_id> <total_cost_usd> <num_turns> <subtype>
  python -X utf8 scripts/auto_build_status.py tail <round.json> [行数]
任务标题格式：#### [ ] M0-T01 标题；人工任务用 H 编号（M7-H01）并在标题里写「（人工）」；
P1 任务的标题含「（P1」；闸门标题含 🚦。依赖写在标题后 3 行以内的「依赖：」行。
"""
import json
import os
import re
import sys

TASKS = os.environ.get("AUTO_BUILD_TASKS_FILE", "docs/TASKS.md")
HEAD = re.compile(r"^#### \[( |x)\] (.+)$")
ID = re.compile(r"GATE-M\d+|M\d+-[TH]\d+")
STATUS = re.compile(r"STATUS:\s*(TASK_DONE|BLOCKED|MILESTONE_DONE|GATE_REACHED)\b")


def lines():
    with open(TASKS, encoding="utf-8") as f:
        return [l.rstrip("\n") for l in f]


def section(ms):
    out, on = [], False
    for line in lines():
        if line.startswith("## "):
            if on:
                break
            on = line.startswith(f"## {ms} ")
            continue
        if on:
            out.append(line)
    return out


def done_ids():
    ids = set()
    for line in lines():
        m = HEAD.match(line)
        if m and m.group(1) == "x":
            found = ID.findall(m.group(2))
            if found:
                ids.add(found[0])
    return ids


def missing_deps(block, k, done):
    for nxt in block[k + 1:k + 4]:
        if nxt.startswith("依赖："):
            return [d for d in ID.findall(nxt) if d not in done]
    return []


def next_item(ms, skip_p1):
    sec, done = section(ms), done_ids()
    if not sec:
        return "NOSECTION -"
    for k, line in enumerate(sec):
        m = HEAD.match(line)
        if not m or m.group(1) == "x":
            continue
        title = m.group(2)
        ids = ID.findall(title)
        if not ids:
            continue
        if skip_p1 and "（P1" in title:
            continue
        if "🚦" in title:
            return f"GATE {ids[0]}"
        if "（人工）" in title:
            return f"MANUAL {ids[0]}"
        missing = missing_deps(sec, k, done)
        return f"DEPS {ids[0]} {','.join(missing)}" if missing else f"TASK {ids[0]}"
    return "DONE -"


def next_from_list(wanted, skip_p1):
    # 并行车道用：清单之外的任务一概不碰，所以依赖没满足的跳过、继续看清单里的下一个
    all_lines, done = lines(), done_ids()
    heads = {}
    for k, line in enumerate(all_lines):
        m = HEAD.match(line)
        if m:
            ids = ID.findall(m.group(2))
            if ids and ids[0] not in heads:
                heads[ids[0]] = (k, m.group(1) == "x", m.group(2))
    first_blocked = None
    for tid in wanted:
        if tid not in heads:
            return f"UNKNOWN {tid}"
        k, checked, title = heads[tid]
        if checked or (skip_p1 and "（P1" in title):
            continue
        if "🚦" in title:
            return f"GATE {tid}"
        if "（人工）" in title:
            return f"MANUAL {tid}"
        missing = missing_deps(all_lines, k, done)
        if not missing:
            return f"TASK {tid}"
        first_blocked = first_blocked or f"DEPS {tid} {','.join(missing)}"
    return first_blocked or "DONE -"


def task_list():
    raw = os.environ.get("AUTO_BUILD_TASKS", "")
    return [t for t in re.split(r"[\s,，]+", raw) if t]


def checklist(gid):
    on = False
    for line in lines():
        if line.startswith("### ") or line.startswith("## "):
            if on:
                break
            on = line.startswith("### ") and gid in line
        if on:
            print(line)


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def parse(path):
    d = load(path)
    if not isinstance(d, dict):
        print("NONE - 0 0 no_json")
        return
    text = (d.get("result") or "").replace("：", ":")
    status = "NONE"
    for raw in reversed(text.splitlines()):
        line = raw.strip().strip("*`>_ ").strip()
        m = STATUS.match(line)
        if m:
            status = m.group(1)
            break
    print(status, d.get("session_id") or "-", d.get("total_cost_usd") or 0,
          d.get("num_turns") or 0, d.get("subtype") or "-")


def tail(path, n):
    d = load(path)
    text = d.get("result", "") if isinstance(d, dict) else ""
    print("\n".join(text.splitlines()[-n:]))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    cmd, arg = sys.argv[1], sys.argv[2]
    if cmd == "next":
        skip = "--skip-p1" in sys.argv[3:]
        wanted = task_list()
        print(next_from_list(wanted, skip) if wanted else next_item(arg, skip))
    elif cmd == "checklist":
        checklist(arg)
    elif cmd == "parse":
        parse(arg)
    elif cmd == "tail":
        tail(arg, int(sys.argv[3]) if len(sys.argv) > 3 else 30)
    else:
        sys.exit(f"unknown command {cmd}")
