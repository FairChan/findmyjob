#!/usr/bin/env bash
# 无人值守开发：脚本选出里程碑里下一个任务，每轮启动一个全新的 claude -p，只做这一个任务并提交。
# 停止：里程碑完成 / 🚦 闸门 / （人工）任务 / 依赖未完成 / BLOCKED / 校验失败 / 超时 / 超预算 / 达到轮数。
# 用法：./scripts/auto-build.sh M2 [最多轮数，默认 15]（在 milestone/M2 分支上、工作区干净时运行）
#   AUTO_BUILD_DRY_RUN=1          只打印下一项，不调用 claude
#   AUTO_BUILD_SKIP_P1=1          跳过标题含「（P1」的任务
#   AUTO_BUILD_COMMIT_REVIEW=0    本次关闭 security-guidance 提交审查
#   AUTO_BUILD_ROUND_BUDGET_USD   每轮预算（默认 3，M0-H01 演练后按 DECISIONS D23 调整）
#   AUTO_BUILD_TOTAL_BUDGET_USD   本次累计预算（默认 30）
#   AUTO_BUILD_TIMEOUT            每轮超时（默认 90m）
#   AUTO_BUILD_MODEL              可选，固定模型 ID（中转支持哪些 ID 待核实）
# 退出码：0 正常停止（完成/闸门/人工/dry-run/轮数/预算），1 环境或校验失败，2 BLOCKED/依赖/超时，3 触碰红线文件
# 钩子降级：--settings scripts/headless-settings.json 为主，下面的 export 兜底（哪个生效以 M0-H01 实测为准）。
set -uo pipefail

MILESTONE="${1:?用法: ./scripts/auto-build.sh <里程碑，如 M2> [最多轮数]}"
MAX_ROUNDS="${2:-15}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT" || exit 1

PY="${PYTHON:-python}"   # 本机 python3 可能指向失效的 Anaconda 路径，默认用 python
ROUND_TIMEOUT="${AUTO_BUILD_TIMEOUT:-90m}"
ROUND_BUDGET="${AUTO_BUILD_ROUND_BUDGET_USD:-3}"
TOTAL_BUDGET="${AUTO_BUILD_TOTAL_BUDGET_USD:-30}"
RUN_DIR=".auto-build/$(date +%Y%m%d-%H%M%S)-${MILESTONE}"
SG_LOG="$HOME/.claude/security/log.txt"
HELPER=("$SCRIPT_DIR/auto_build_status.py")
SETTINGS="scripts/headless-settings.json"   # 即 $SCRIPT_DIR/headless-settings.json；已 cd 到仓库根，用相对路径，免得 Git Bash 把 /c/... 传给 Windows 版 claude

# 无人值守时的钩子开关（兜底；主配置在 headless-settings.json）
export ENABLE_STOP_REVIEW=0                                    # -p 下 Stop 审查退化为同步 decision:block，会多跑一轮
export MAX_STOP_HOOK_FIRINGS=1
export ENABLE_COMMIT_REVIEW="${AUTO_BUILD_COMMIT_REVIEW:-1}"   # 保留提交审查（同步，结果在本轮内处理）
export SG_AGENTIC_COMMIT_REVIEW=0                              # 提交审查改单次调用，不跑多轮 agent
export MAX_COMMIT_REVIEWS_PER_HOUR=6
export DIFF_TOTAL_BYTES=150000
export CLAUDE_SECURITY_SCAN_TIP=off
export CLAUDE_MEM_DISABLE_TOOL_HOOKS=1                         # 关 claude-mem 的 observation 和 file-context 注入
export CLAUDE_MEM_DISABLE_SUMMARY=1                            # 关 Stop 时的摘要调用
export PYTHONUTF8=1

# 运行目录必须被忽略，否则日志会弄脏工作区；检查通过后立刻建目录（之后的 log/tee 都依赖它）
command -v git >/dev/null || { echo "停止：缺少命令 git"; exit 1; }
git check-ignore -q .auto-build/x || { echo "停止：.gitignore 缺少 .auto-build/"; exit 1; }
mkdir -p "$RUN_DIR" || { echo "停止：无法创建 $RUN_DIR"; exit 1; }

log() { echo "$*" | tee -a "$RUN_DIR/summary.txt"; }
stop() { log "停止：$2"; exit "$1"; }
py() { "$PY" -X utf8 "${HELPER[@]}" "$@"; }

[[ "$MILESTONE" =~ ^M[0-9]+$ ]] || stop 1 "里程碑必须写成 M<数字>，例如 M2"
[[ "$MAX_ROUNDS" =~ ^[0-9]+$ ]] || stop 1 "最多轮数必须是整数"
for c in claude pnpm gitleaks timeout "$PY"; do command -v "$c" >/dev/null || stop 1 "缺少命令 $c"; done
for f in scripts/unattended.md scripts/mcp-none.json scripts/headless-settings.json scripts/auto_build_status.py; do
  [[ -f "$f" ]] || stop 1 "缺少 $f"
done
branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" == "milestone/${MILESTONE}" ]] || stop 1 "当前分支是 $branch：先 git switch -c milestone/${MILESTONE}（不能在 main 或 master 上跑）"
[[ -z "$(git status --porcelain)" ]] || stop 1 "工作区不干净，先提交或清理"
if [[ -f docker-compose.yml ]]; then
  docker compose ps --services --status running 2>/dev/null | grep -qx postgres || stop 1 "postgres 未运行：docker compose up -d"
fi

DENY=(AskUserQuestion
  "Bash(git push *)" "Bash(git checkout *)" "Bash(git switch *)" "Bash(git reset *)" "Bash(git clean *)"
  "Bash(git stash *)" "Bash(git rebase *)" "Bash(git commit --amend *)" "Bash(git worktree *)"
  "Bash(npx prisma migrate reset *)" "Bash(pnpm prisma migrate reset *)" "Bash(pnpm exec prisma migrate reset *)"
  "Bash(npx prisma db push *)" "Bash(pnpm prisma db push *)" "Bash(docker compose down *)"
  "Edit(**/CLAUDE.md)" "Write(**/CLAUDE.md)" "Edit(.claude/**)" "Write(.claude/**)"
  "Edit(.githooks/**)" "Write(.githooks/**)"
  "Skill(superpowers:brainstorming)" "Skill(brainstorming)" "Skill(security-threat-model)")   # Skill(...) 语法待 M0-H01 核实

GUARD=('*CLAUDE.md' .claude .githooks scripts/auto-build.sh scripts/unattended.md scripts/auto_build_status.py
  scripts/headless-settings.json)

total=0
for ((i = 1; i <= MAX_ROUNDS; i++)); do
  next="$(py next "$MILESTONE" ${AUTO_BUILD_SKIP_P1:+--skip-p1})" || stop 1 "解析 docs/TASKS.md 失败"
  read -r kind id rest <<<"$next"
  case "$kind" in
    DONE) stop 0 "STATUS: MILESTONE_DONE ${MILESTONE}" ;;
    GATE) py checklist "$id" | tee -a "$RUN_DIR/summary.txt"; stop 0 "STATUS: GATE_REACHED $id（扫描顺序见 docs/AI-SKILLS.md）" ;;
    MANUAL) stop 0 "$id 标记为（人工），请在交互会话里做，完成后由人勾选" ;;
    DEPS) stop 2 "STATUS: BLOCKED $id 依赖未完成：$rest" ;;
    TASK) ;;
    *) stop 1 "里程碑 ${MILESTONE} 不存在或无法识别：$next" ;;
  esac
  [[ -n "${AUTO_BUILD_DRY_RUN:-}" ]] && stop 0 "dry-run：下一个任务 $id"

  log "=== ${MILESTONE} · 第 ${i} 轮 · ${id} ==="
  out="$RUN_DIR/r${i}-${id}"
  before="$(git rev-parse HEAD)"
  sg_before="$(grep -c 'Review usage' "$SG_LOG" 2>/dev/null || true)"
  PROMPT="【无人值守】只实现 docs/TASKS.md 中的 ${id}，严格按 CLAUDE.md 的「单任务工作流」和「无人值守模式」执行，完成并提交后停止。
docs/TASKS.md 就是已批准的设计，不走 brainstorming。
最后一行只输出一行：STATUS: TASK_DONE ${id}
做不完、依赖不满足或检查修不好时，最后一行输出：STATUS: BLOCKED ${id} <一句话原因>"

  timeout "$ROUND_TIMEOUT" claude -p "$PROMPT" \
    --settings "$SETTINGS" \
    --permission-mode acceptEdits \
    --output-format json \
    --max-budget-usd "$ROUND_BUDGET" \
    --append-system-prompt "$(cat scripts/unattended.md)" \
    --strict-mcp-config --mcp-config scripts/mcp-none.json \
    ${AUTO_BUILD_MODEL:+--model "$AUTO_BUILD_MODEL"} \
    --disallowedTools "${DENY[@]}" \
    >"$out.json" 2>"$out.stderr"
  rc=$?

  read -r status sid cost turns subtype < <(py parse "$out.json")
  after="$(git rev-parse HEAD)"
  sg_after="$(grep -c 'Review usage' "$SG_LOG" 2>/dev/null || true)"
  # 先取到变量再匹配：pipefail 下 git log | grep -q 可能因 SIGPIPE 误判
  subjects="$(git log --format=%s "$before..$after" 2>/dev/null || true)"
  committed=no; [[ -n "$subjects" && "$subjects" == *"$id"* ]] && committed=yes
  checked=no; grep -qE "^#### \[x\] ${id}([^0-9]|$)" docs/TASKS.md && checked=yes
  dirty="$(git status --porcelain)"
  guard="$(git diff --name-only "$before" "$after" -- "${GUARD[@]}")"
  migr="$(git diff --name-only --diff-filter=MDR "$before" "$after" -- prisma/migrations)"
  deltests="$(git diff --name-only --diff-filter=D "$before" "$after" -- tests '*.test.ts' '*.test.tsx' '*.spec.ts')"
  git log --stat "$before..$after" >"$out.git.txt" 2>/dev/null
  total="$("$PY" -c "print(round($total + float('${cost:-0}'), 4))")"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date +%FT%T)" "$i" "$id" "$status" "$rc" "$subtype" \
    "$cost" "$turns" "$(( ${sg_after:-0} - ${sg_before:-0} ))" "$after" >>"$RUN_DIR/rounds.tsv"
  py tail "$out.json" 30

  [[ -n "$guard" ]] && stop 3 "本轮改了规则文件：$guard（git show $after 查看，人工处理）"
  [[ -n "$migr" ]] && stop 3 "本轮修改/删除了已提交的 migration：$migr"
  [[ -n "$deltests" ]] && stop 3 "本轮删除了测试文件：$deltests"
  [[ $rc -eq 124 ]] && stop 2 "超时 ${ROUND_TIMEOUT}（session $sid）"
  case "$status" in
    BLOCKED) stop 2 "STATUS: BLOCKED ${id}（详见 $out.json）" ;;
    TASK_DONE | NONE)
      if [[ $committed == yes && $checked == yes && -z "$dirty" ]]; then
        [[ $status == NONE ]] && log "警告：输出里没有 STATUS 行，按 git 状态判定 ${id} 已完成（session $sid）"
      else
        stop 1 "校验失败：status=$status rc=$rc subtype=$subtype committed=$committed checked=$checked dirty=$([[ -n $dirty ]] && echo yes || echo no)（session $sid）"
      fi ;;
    *) stop 1 "无法识别：status=$status rc=$rc subtype=$subtype（session $sid）" ;;
  esac
  "$PY" -c "import sys; sys.exit(0 if $total <= $TOTAL_BUDGET else 1)" || stop 0 "累计花费 \$$total 超过 \$$TOTAL_BUDGET"
done
stop 0 "已达到最大轮数 ${MAX_ROUNDS}"
