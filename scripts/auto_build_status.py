"""auto-build.sh 的辅助：读 docs/TASKS.md 选下一项，解析 claude -p 的 JSON 输出。只用标准库。
用法：
  python -X utf8 scripts/auto_build_status.py next M2 [--skip-p1]
      -> TASK <id> | GATE <id> | MANUAL <id> | DEPS <id> <缺的依赖,逗号分隔> | DONE - | NOSECTION -
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
        missing = []
        for nxt in sec[k + 1:k + 4]:
            if nxt.startswith("依赖："):
                missing = [d for d in ID.findall(nxt) if d not in done]
                break
        return f"DEPS {ids[0]} {','.join(missing)}" if missing else f"TASK {ids[0]}"
    return "DONE -"


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
        print(next_item(arg, "--skip-p1" in sys.argv[3:]))
    elif cmd == "checklist":
        checklist(arg)
    elif cmd == "parse":
        parse(arg)
    elif cmd == "tail":
        tail(arg, int(sys.argv[3]) if len(sys.argv) > 3 else 30)
    else:
        sys.exit(f"unknown command {cmd}")
