# AI 技能与闸门扫描

> v0.2 · 2026-11-03 · FindMYJob。本文件规定开发中什么时候用哪个 Claude Code 技能、闸门扫描怎么跑、花费怎么记。和 CLAUDE.md 冲突时以 CLAUDE.md 为准；无人值守的技能名单和 `scripts/unattended.md` 保持一致。

## §0 怎么开闸门会话

闸门扫描（GATE-M4、GATE-M7、GATE-M8 和 E6）都由人在交互会话里运行，不在 auto-build 里跑。

1. 在干净的 worktree 里扫，不动开发目录：

```bash
git worktree add ../findmyjob-scan <ref>
```

   `<ref>` 是要扫的 tag 或分支，例如 `milestone/M4`。看基线用 `git show <base>:<path>`，不 checkout。
2. 在 `../findmyjob-scan` 里用默认权限模式启动：`claude --permission-mode default`。不用 acceptEdits，不用 bypassPermissions。
3. 提示词里写明：范围（只列 §1 规定的路径）、基线 ref、报告写到 `.reports/<YYYY-MM-DD>-<tool>/`、不读 `.env*` 的内容。
4. 扫完把报告移回开发仓库的 `.reports/`（已忽略，不入库）；每个 High 要么修掉，要么写进 DECISIONS 的「已接受风险」；入库的只有 `docs/security/FINDINGS.md` 里的编号、位置和状态。
5. 在 `.reports/COSTS.tsv` 记一行花费（§3），然后 `git worktree remove ../findmyjob-scan`。

## §1 路由表

花费一栏只写已知数字；没有估算的写「首跑后记进 COSTS.tsv」，不要猜。试点前闸门的 LLM 扫描合计不超过 300 元（D23）。

| 时点 | 技能 / 工具 | 调用方式 | 用途 | 估算花费 |
|---|---|---|---|---|
| A、C 阶段的交互会话按计划执行时 | superpowers:executing-plans | 手动点名 | 计划已经批准，开场时直接说明，不再走 brainstorming | 计入会话 |
| 每个编码任务（包括 auto-build 轮次） | superpowers:test-driven-development | 自动 | 先写失败测试，再实现 | 计入轮次（D23：每轮上限 3 美元） |
| 测试失败或出现异常 | superpowers:systematic-debugging | 自动 | 替代 ci-cd 技能引用的、并未安装的 debugging-and-error-recovery | 计入轮次 |
| 任何任务声称完成之前 | superpowers:verification-before-completion | 自动 | 跑完 DoD 命令，看到证据后才能输出 STATUS | 计入轮次 |
| 修改 settings 和权限规则时 | update-config | 手动点名 | settings 和权限规则的写法 | 计入会话 |
| B8 威胁建模；E3 前复跑 | security-threat-model | 手动点名 | 设计期威胁模型，TM-ID 保持稳定。会停下来等人确认假设，所以禁止在 auto-build 里调用 | 首跑后记进 COSTS.tsv |
| 审 schema；M0-T02、M0-T03、M4 涉及 pg_trgm 或 advisory lock 时 | supabase-postgres-best-practices | 自动 | SQL 和索引细节，受 CLAUDE.md「数据库与迁移」覆盖项约束，忽略 Supabase 专有内容 | 计入轮次 |
| 修改 schema、迁移、回填 | prisma-migrations（项目技能） | 自动 | 本项目唯一的迁移规程 | 计入轮次 |
| GATE-M7 之后的 expand/contract | deprecation-and-migration | 自动 | 只借鉴分步改表的思路，不写 down 迁移 | 计入轮次 |
| 写认证、PII、上传、限流、角色相关代码时 | security-and-hardening | 自动 | 编码阶段的安全基线；Ask First 项只要在 TASKS 范围内就视为已批准，记入 DECISIONS | 计入轮次 |
| 写 Server Action、Route Handler、模块边界时 | api-and-interface-design | 自动 | Express 示例改写成 App Router 写法 | 计入轮次 |
| M0-T06 写 CI；M7-T06、M7-T11 写镜像和部署 | ci-cd-and-automation | 自动 | 用 pnpm 和 frozen-lockfile，SHA 固定，最小权限，不用 Vercel | 计入轮次 |
| M0-T08 写日志告警；M7-T04 接 Sentry | observability-and-instrumentation | 自动 | 范围只到 Sentry、pino、/api/health | 计入轮次 |
| 写 UI 任务（M0-T05、M2-T02、M7-T08、M7-T17） | accessibility | 自动 | WCAG 2.2 AA，大字号门槛按 24px 和 18.66px，注意输入法组合输入和 lang | 计入轮次 |
| M5-T03、M7-T17 的 SEO | seo | 自动 | Metadata API、hreflang、noindex，不用 robots.txt 藏私有路径 | 计入轮次 |
| 每次 Edit/Write 和 git commit | security-guidance（插件钩子） | 钩子 | 正则提醒加单次提交审查；Stop 审查已关闭；auto-build 经 headless-settings 降级 | 提交审查每小时最多 6 次，按中转扣费 |
| 会话启动和工具调用 | claude-mem（插件钩子） | 钩子 | FindMYJob 整个工作区已排除，不记录、不注入 | 0 |
| 每次提交 | gitleaks（.githooks/pre-commit） | 钩子 | 拦截暂存区里的秘密，工具缺失时拒绝提交 | 0（本地） |
| 每个 PR 和 push 到 main | CI：verify / e2e / guard / gitleaks / pnpm audit | CI | 确定性闸门，不调用 LLM | Actions 分钟数，单次 PR ≤ 20 分钟 |
| 每月（版本更新）和安全公告出现时 | Dependabot | CI | npm 和 github-actions 更新，Prisma 大版本忽略 | 0 |
| M0 结束、新增直接依赖、GATE-M7、E 阶段距上次超过 30 天 | supply-chain-risk-auditor:supply-chain-risk-auditor | 手动点名 | 先跑 collect.py 再跑 render.py，只评直接依赖，报告写到 .reports/ | 主要靠脚本查元数据，单独记账 |
| GATE-M4；GATE-M8 的 billing 部分 | differential-review:diff-review | 手动点名 | 限定高风险路径，附 FindMYJob 检查表，用 git show 读基线，不 checkout | 计入试点前 300 元上限 |
| M0 结束（P1）；GATE-M7（P0） | security-best-practices | 手动点名 | 限定 Next.js 服务端目录，报告写到 .reports/，不读 .env 的内容 | 计入试点前 300 元上限 |
| GATE-M7 | shipping-and-launch | 手动点名 | 上线清单，补上恢复演练、新旧镜像兼容、律师签字；回滚等于部署上一镜像 | 计入会话 |
| GATE-M7 或 E 阶段（P1） | web-quality-audit + core-web-vitals + performance-optimization | 手动点名 | 只在合成数据环境用锁定版本的 Lighthouse 测，不用 PSI 或 CrUX 测非公开 URL | 计入会话 |
| E6，触发条件是预算或学生数接近 2700 | claude-security:claude-security | 手动点名 | 在干净 worktree 里用 default 权限模式做 changes 或限定目录扫描，`--scope` 用逗号分隔（例如 `src/server,src/app/api,deploy`） | 审计估算：changes 扫描约 1–5M token，codebase 扫描约 10–50M token；不得超过 D23 上限 |
| E6（P1） | insecure-defaults:audit | 手动点名 | src 和 deploy 分开跑，点名 POSTGRES_PASSWORD 和 NEXT_PUBLIC_ 这类密钥 | 首跑后记进 COSTS.tsv |
| M7-T16（P1） | static-analysis:semgrep | CI | 只在 CI 里用 registry 规则集，`--metrics=off`；不在本地用 semgrep-scan workflow | 0（CI） |
| 写 DECISIONS 或 ADR | documentation-and-adrs | 自动 | 只写 docs/DECISIONS.md，不建 docs/decisions/ | 计入轮次 |
| 写项目技能 | superpowers:writing-skills | 手动点名 | 编写或修改 prisma-migrations 技能 | 计入会话 |

## §2 无人值守时允许和禁止的技能

auto-build 的每一轮都以【无人值守】开头，没有人在场（见 CLAUDE.md「无人值守模式」和 `scripts/unattended.md`）。

- **允许**：test-driven-development、systematic-debugging、verification-before-completion（「有 1% 可能就调用」只适用于这三个），以及 CLAUDE.md「技能适配」涉及的领域技能：prisma-migrations、supabase-postgres-best-practices、security-and-hardening、api-and-interface-design、ci-cd-and-automation、observability-and-instrumentation、accessibility、seo、deprecation-and-migration、documentation-and-adrs。
- **禁止**（带不带 `superpowers:` 前缀都一样）：brainstorming、writing-plans、executing-plans、subagent-driven-development、dispatching-parallel-agents、using-git-worktrees、finishing-a-development-branch、requesting-code-review。
- **禁止**（闸门专用，只能由人交互调用）：security-threat-model、security-best-practices、claude-security、insecure-defaults、differential-review、static-analysis:*、supply-chain-risk-auditor、web-quality-audit、best-practices、performance-optimization、shipping-and-launch。
- 无人值守时不提问、不调用 AskUserQuestion、不进计划模式、不启动 Workflow；遇到需要人决定的事，输出 `STATUS: BLOCKED <ID> <原因>`。

## §3 `.reports/COSTS.tsv` 的格式

制表符分隔，UTF-8，第一行是表头，每次闸门扫描或深度扫描追加一行。auto-build 的逐轮花费在 `.auto-build/<运行>/rounds.tsv` 里，月底汇总一行进来。

```
date	phase	tool	scope	ref	model	tokens_in	tokens_out	cost_usd	cost_cny	report_path	operator	note
```

| 列 | 说明 |
|---|---|
| date | YYYY-MM-DD |
| phase | GATE-M4 / GATE-M7 / GATE-M8 / E6 / M0 / auto-build-月度汇总 |
| tool | 技能或工具名，例如 differential-review:diff-review |
| scope | 扫描的路径，逗号分隔 |
| ref | 扫描的 ref 或 base..head |
| model | 以日志或账单里的 model= 为准 |
| tokens_in / tokens_out | 拿不到就写 - |
| cost_usd / cost_cny | 以中转实际扣费为准；只知道一种币种时另一列写 - |
| report_path | `.reports/<日期>-<tool>/` 下的报告 |
| operator | 执行人 |
| note | 结论摘要（只写编号和数量，不写代码和数据） |

## §4 不用的技能及原因

| 技能 / 插件 | 不用的原因 |
|---|---|
| database-migrations 插件（wshobson） | 模板有多处 PostgreSQL 错误，完全没有 Prisma 内容，还带「主动调用、拥有全部工具」的代理；已卸载，迁移规程用项目技能 prisma-migrations |
| security-compliance 插件（wshobson） | 只覆盖 GDPR / HIPAA，没有马来西亚 PDPA；同样带主动代理；已卸载。PDPA 事项走律师（D10）和 RUNBOOK |
| RTK 的 ship | 会 push；本项目只允许人 push |
| best-practices 用于后端审查 | 面向前端的通用清单，描述里有 security audit 字样容易误触发；已设为只能手动调用 |
| design:accessibility-review | 和 accessibility 技能重复，用 accessibility + axe 测试 |
| 本地 CodeQL | 私有仓库用不了免费 code scanning（A25） |
| claude-mem 的 /make-plan 和 /do | 绕开 TASKS 和 auto-build 的校验；KICKOFF 已删除这种方式 |
| auto-build 中的 brainstorming 和 writing-plans | 要求人来批准设计，无人值守时会卡住；TASKS 就是已批准的设计 |
| RTK 命令改写钩子（rtk init -g） | 不装：装之前要先验证 git commit 被改写后 security-guidance 的提交审查还能触发 |
