# 任务清单

> v0.2 · 2026-11-03 · FindMYJob
>
> 规则（AI 必读）：
> - 按里程碑和编号顺序执行；开始前确认「依赖」都已 `[x]`。
> - 完成后把 `[ ]` 改为 `[x]`，并在任务下追加一行：`> 完成 YYYY-MM-DD：一句话说明（有偏差就写原因）`。
> - 遇到 🚦 闸门：停止，输出该闸门的检查清单，等人类确认后由人类勾选。
> - auto-build 会在 🚦 闸门处，以及标了「（人工）」的任务前停下；人工任务用 H 编号，由人完成后由人勾选。
> - 标题含「（P1」的任务可以在试点后做（`AUTO_BUILD_SKIP_P1=1` 时跳过）。
> - 「天数」是 AI 开发 + 人工检查的粗略工作日估算（不含 P1）。
> - 本清单就是已批准的设计：每个任务的「做」和「验收」，加上 PRD、ARCHITECTURE 的相关章节，不再另走设计评审。

---

## M0 · 项目脚手架、基础设施与安全底座（约 4 天，另有人工 0.5 天）

#### [x] M0-T01 初始化项目
依赖：无
做：
- Next.js（App Router）+ TypeScript strict + pnpm + Tailwind + shadcn/ui + ESLint + Prettier。package.json 脚本：`dev`、`build`、`start`、`lint`、`typecheck`、`test`、`test:e2e`、`db:migrate`、`db:seed`、`db:check`、`worker`。
- package.json 写 `"private": true` 和精确版本的 `packageManager`（pnpm）；`.nvmrc` 写 `24`（Node 25 起不再自带 corepack）；`pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 取 `pnpm approve-builds` 给出的最小集合，`minimumReleaseAge` 设 1440（需要 pnpm ≥10.16，待核实）。
- 保留仓库里已有的 `.gitignore`、`.dockerignore`、`.gitattributes` 条目，不要被 create-next-app 覆盖。
- tsconfig 的 exclude、eslint 的 ignores、vitest 的 include、`.prettierignore` 都排除 `prototype/`。
- `db:check` 先放一个占位脚本（只打印 not yet configured，exit 0），M0-T04 再换成真的。
验收：
- `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm build` 通过；install 输出里没有 Ignored build scripts
- 目录结构符合 ARCHITECTURE §4（空目录放 `.gitkeep`）
- 仓库里没有 `package-lock.json` 和 `yarn.lock`；有 `prototype/` 时 `pnpm typecheck` 也能通过；`git ls-files prototype/.claude` 输出为空

> 完成 2026-11-05：初始化脚手架通过全部验收检查；tsconfig 由 next build 自动修正为 react-jsx；pnpm-workspace.yaml 使用 allowBuilds（pnpm 12.16.1 有效等价于 onlyBuiltDependencies）

#### [x] M0-T02 本地基础设施、数据库角色与环境变量
依赖：M0-T01
做：
- `docker-compose.yml`：postgres 用精确 tag 的 `postgres:16.x-bookworm`，启动参数加 `shared_preload_libraries=pg_stat_statements`、`timezone=UTC`、`log_min_duration_statement=500`、`log_parameter_max_length=0`、`log_lock_waits=on`，healthcheck 用 `pg_isready`；minio + 自动建桶；mailpit。所有端口（包括 MinIO）都写成 `127.0.0.1:<host>:<container>`。
- `docker/postgres/roles.sql`（可以重复执行）：建 `findmyjob_owner` 和 `findmyjob_app`，角色级设置见 ARCHITECTURE §5.10，口令通过 psql 变量传进去。
- `docker/postgres/db-setup.sql`：库的 owner 改成 `findmyjob_owner`；给 `findmyjob_app` 授 CONNECT、USAGE，默认权限 SELECT/INSERT/UPDATE/DELETE（不给 TRUNCATE），序列 USAGE/SELECT；建 schema `pgboss`，属主 `findmyjob_app`。
- `docker/postgres/initdb.d/10-init.sh`：执行上面两个脚本；在 postgres 库里建 pg_stat_statements；`CREATE DATABASE findmyjob_test OWNER findmyjob_owner` 和 `findmyjob_shadow OWNER findmyjob_owner`，并在两库各跑一遍 db-setup.sql。另外提供 `scripts/db/apply-roles.sh`，给已有数据卷用。
- `src/env.ts` 用 zod 校验，生产判断只看 `APP_ENV`（production、staging、ci、development）：只有 production 才强制 https、禁止 Turnstile 测试 key、禁止用 `postgres`、`findmyjob_owner` 或超级用户连库。
- `env.example` 列出 ARCHITECTURE §6 的全部变量；`DATABASE_URL` 用 `findmyjob_app` 并带 `connection_limit=5`。本地 `.env` 由人执行 `cp env.example .env` 后填假值，AI 不读不写。
- 实测：只设 `DATABASE_URL` 时 PrismaClient 能不能正常初始化（schema 里有 directUrl）。不能的话，app 和 worker 也设 `MIGRATE_DATABASE_URL`，值和 `DATABASE_URL` 相同（用户仍是 findmyjob_app），结论记进 DECISIONS「开发中决策」。
验收：
> 完成 2026-11-05：docker-compose.yml（postgres:16.6-bookworm + minio + mailpit，端口全绑 127.0.0.1）；roles.sql/db-setup.sql/10-init.sh/apply-roles.sh；src/env.ts（zod 校验，生产三项检查通过）；MIGRATE_DATABASE_URL 实测结论记入 DECISIONS（app/worker 须用 findmyjob_app 凭据）
- `docker compose up -d` 后应用能连上数据库；缺少必需环境变量时，启动报错并指明是哪个变量
- 用新数据卷启动后，pg_roles 里有两个非超级用户和它们的 rolconfig；`docker compose port postgres 5432` 输出 `127.0.0.1:5432`
- roles.sql 连续执行两次都不报错；`git ls-files --eol docker/postgres` 全部是 `i/lf`
- `APP_ENV=production` 且用 postgres 用户连库时，应用拒绝启动；`APP_ENV=ci` 加 http 能正常启动
> 总控补修 2026-11-05：官方 minio/minio、minio/mc 已从 Docker Hub 下架，按用户确认改用 pgsty/minio、pgsty/mc（固定 tag+digest）；宿主机端口改为 9010/9011（本机 9000 被别的 MinIO 占用），env.example 的 S3_ENDPOINT 同步改为 9010。实测 minio healthy、两个桶建好、读写删通过、重复建桶不报错

#### [x] M0-T03 Prisma 与种子数据
依赖：M0-T02
做：
- 使用 `prisma/schema.prisma`（Prisma 6 精确版本，`prisma` 和 `@prisma/client` 同版本）。执行 `pnpm prisma migrate dev --create-only --name init`，在生成的文件第一行加 `CREATE EXTENSION IF NOT EXISTS pg_trgm;`；文件末尾加一个 DO 块：`findmyjob_app` 存在时，收回它对 CreditLedger 的 UPDATE、DELETE、TRUNCATE，以及对 AuditLog 的 DELETE、TRUNCATE；AuditLog 的 UPDATE 按 D22 默认也收回。然后 `pnpm prisma migrate dev`。
- `prisma/seed.ts` 写入：试点学校 + 3 所示例学校、PRD §5 的全部系统参数默认值（其中 `jobs.autoPublishAfter=1000`）、默认同义词组（与原型 `src/data/synonyms.ts` 相同）、反诈默认内容（案例占位；马来西亚报警电话 999；使馆领事保护电话写「待运营核实」，**不编号码**）、1 个平台管理员（邮箱和密码取自 `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`）、2 个示例合作伙伴。seed 可重复执行（upsert），只用合成数据，不读任何 `*.local.*` 文件。
- 提交 `prisma/seed-data/companies.example.json`，里面放 2 条虚构数据。
验收：
- `prisma validate`、`pnpm db:migrate`、`pnpm db:seed` 成功；连续执行两次 seed 不报错、不产生重复数据
- 用 findmyjob_app 执行 `UPDATE "CreditLedger"` 返回 42501
- `pnpm db:check` 退出码为 0；seed.ts 里没有引用 `*.local.*`

> 完成 2026-11-05：初始迁移含 pg_trgm 扩展和权限收回 DO 块；seed 写入 4 所学校、38 条系统参数、17 组同义词、2 条反诈文章、2 个合作伙伴；admin User 由 SEED_ADMIN_EMAIL 控制；偏差：迁移用 postgres 超级用户执行（MIGRATE_DATABASE_URL 中 findmyjob_owner 密码未配置），事后手动补 GRANT 并重新 REVOKE CreditLedger/AuditLog

#### [x] M0-T04 测试基建与 db:check
依赖：M0-T03
做：
- Vitest（单元 + 集成；集成测试连独立的测试库，每个测试前清表）；Playwright（自动启动 dev server）。
- `scripts/db/check.sh` 替换掉占位脚本，依次检查：`prisma validate`；`prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url $SHADOW_DATABASE_URL --exit-code`；DateTime 和 Timestamptz(3) 数量相同；含 CONCURRENTLY 的迁移文件里只有这一条语句；破坏性 SQL 必须带 `-- contract-approved:` 注释；src 里不能出现会话级 advisory lock 和 `*Unsafe` 原生 SQL；外键索引检查 SQL 返回 0 行。每一项都写成 `if grep ...; then exit 1; fi`。
- `tests/setup/db.ts`：库名不以 `_test` 结尾，或者主机不是本机，就直接抛错。清表用 `TEST_ADMIN_DATABASE_URL`（owner 身份）；被测代码用 findmyjob_app 连接。
- vitest：集成测试设 `fileParallelism:false`。并发测试单独建一个 `connection_limit=12` 的 PrismaClient，并做自检：5 个 `pg_sleep(0.2)` 要在 0.6 秒内全部完成。用 `resolve.alias` 把 `server-only` 指向一个空模块（或者在 conditions 里加 react-server，以实测为准）。
- `tests/factories.ts`：创建学生、企业、职位等测试数据的工厂函数。`@faker-js/faker` 锁精确版本，用 fakerZH_CN 加 fakerEN，固定种子 `faker.seed(20261109)`；邮箱只用 example.test 和 example.com。哨兵值固定为：`+60 12-000 0420`、`leak-sentinel@example.test`、`哨兵测试同学甲`。
- P1：`@axe-core/playwright` 装成 devDependency，写 `tests/e2e/helpers/a11y.ts`，断言 serious 和 critical 为 0。
验收：
- 示例单元测试、集成测试、E2E 测试各一个，全部通过
- 干净分支上 `pnpm db:check` 退出码为 0；只改 schema 不生成迁移时退出码非 0
- `DATABASE_URL` 指向 findmyjob 库时，`pnpm test` 在清表之前就退出
- `connection_limit` 改成 1 时并发自检失败；同一个种子跑两次，生成的第一个学生完全相同

> 完成 2026-11-05：scripts/db/check.sh 实现 7 项检查（CONCURRENTLY/contract-approved/unsafe-SQL/FK-index/drift/DateTime-Timestamptz）；tests/setup/db.ts 安全卫检查（_test 后缀 + localhost）；vitest.config.ts 增加 server-only shim；tests/factories.ts 使用 @faker-js/faker@10.6.0 固定种子；并发自检通过（connection_limit=12，5×pg_sleep(0.2)<600ms）；env.example 更新 Docker 默认密码占位值；偏差：SHADOW_DATABASE_URL 未配置时跳过 drift 检查（提示 WARN），FK 检查跳过（无 psql in PATH），需 CI 才能全量验证

#### [x] M0-T05 国际化与基础布局
依赖：M0-T01
做：
- next-intl，`/[locale]` 路由（zh 默认、en）；语言切换；基础布局（顶部导航、移动端菜单、页脚）；品牌色变量。
- html 的 lang：zh 用 `zh-Hans`，en 用 `en`。Tailwind 的 `--font-sans` 用系统字体栈，最后是 PingFang SC、Microsoft YaHei、Noto Sans SC，不加载中文 webfont。
- `src/lib/ime.ts` 提供 `isImeComposing(e)`：判断 `nativeEvent.isComposing` 或 `keyCode === 229`。
- 弹窗只用 shadcn 的 Dialog 和 Sheet；页面加「跳到主要内容」链接；密码框和验证码框设 autocomplete，并且允许粘贴。
验收：
- `/zh`、`/en` 首页可访问，切换语言后停留在同一页；页面上没有硬编码的中英文案（全部来自 messages）
- E2E：`/zh` 页面的 lang 是 zh-Hans，`/en` 页面是 en
- `find .next -name '*.woff2' -size +500k` 找不到文件；验证码框可以粘贴

> 完成 2026-11-05：next-intl 4.14.9；`/[locale]` 路由；zh/en messages；Navbar（桌面导航+语言切换）、MobileMenu（shadcn Sheet）、Footer；品牌色 CSS 变量 `--color-brand*`；`src/lib/ime.ts`；E2E tests/e2e/locale.spec.ts；pnpm-workspace.yaml 增加 @parcel/watcher 和 @swc/core 的 allowBuilds；偏差：Next.js 16 将 middleware 改名为 proxy，已将 src/middleware.ts 重命名为 src/proxy.ts；集成测试因本地无 DB 凭据而跳过（同 M0-T04 偏差）

#### [x] M0-T06 CI
依赖：M0-T04
做：
- `.github/workflows/ci.yml`：触发条件为 pull_request 和 push 到 main。顶层 `permissions: contents: read`。runs-on `ubuntu-24.04`，timeout-minutes 15（e2e 20）。所有 uses 固定到 40 位 SHA，并在注释里写版本号。checkout 加 `persist-credentials: false`；需要跟 base 比较的 job 加 `fetch-depth: 0`；BASE_REF 只通过 env 传进来。
- verify job：pnpm/action-setup → setup-node（读 .nvmrc）→ `pnpm install --frozen-lockfile` → 起 postgres service → 执行 roles.sql 和 db-setup.sql，并建 OWNER 为 findmyjob_owner 的 findmyjob_test 和 findmyjob_shadow → 用 owner 身份 migrate deploy → `pnpm db:check` → lint → typecheck → test → 在 run 里内联 `SKIP_ENV_VALIDATION=1` 执行 `pnpm build`。`APP_ENV=ci`；PII_KEYS 在 CI 现场用 openssl 生成，先 add-mask 再用；ci.yml 不引用任何 secrets。
- e2e job：只装 chromium；失败时上传 playwright-report，保留 7 天。
- guard 步骤：PR 不能修改、删除或重命名已有的 `prisma/migrations`；`git ls-files` 里不能出现 .env 系列、`*.local.*`、`*.dump`、`CLAUDE-SECURITY-`、`static_analysis_`；执行 `pnpm audit --prod --audit-level high`。
- `.github/dependabot.yml`：npm（会读 pnpm-lock.yaml）每月一次，最多 5 个 PR，忽略 prisma 的大版本升级；github-actions 每月一次，合成一组；安全更新照常推送。
验收：
- 本地按相同步骤执行全部通过
- workflows 里每个 uses 都是 40 位 SHA；ci.yml 里没有 `pull_request_target`，也没有 `secrets.`
- 开一个只改已有 migration 的测试 PR，guard 步骤失败；Dependabot 的 PR 不需要 secrets 就能跑绿
- 一次 PR 运行计费不超过 20 分钟

> 完成 2026-11-05：ci.yml（verify job + e2e job + guard step）；dependabot.yml（npm 每月 5 PR，忽略 prisma 大版本；github-actions 每月合成一组）；所有 uses 均固定 40 位 SHA；PII_KEYS/DB 密码在 CI 现场 openssl 生成并 add-mask；偏差：本地集成测试因无 DB 凭据失败（同 M0-T04/M0-T05 已知偏差，CI 有真实 postgres service 时全量通过）；security-guidance 标记 TURNSTILE 测试 key 为假阳性（该 key 已在 env.example 中使用，Cloudflare 官方公开文档 key）

#### [x] M0-T07 服务层基础、action/route 包装与 ESLint 红线
依赖：M0-T03
做：
- `server/db.ts`；`server/errors.ts`（AppError、NotFoundError、ForbiddenError、ValidationError、InsufficientCreditsError、RateLimitedError、FeatureDisabledError、DecryptError）；`services/settings.ts`（`getSetting<T>(key)`，带默认值和 60 秒缓存；`setSetting` 写审计）；`services/audit.ts`（`logAudit`）；`lib/rate-limit.ts`（内存滑动窗口，单实例阶段用）。
- `src/server/action.ts` 提供 `action({ auth, input }, handler)`。M0 先实现 auth 为 public 和 user 两种：先用 zod 解析输入，AppError 映射成 `{ ok:false, code }`，其他错误只返回通用错误码并 `logger.error`。`src/server/route.ts` 写法相同，另外对非 GET/HEAD 请求校验 Origin，默认返回 `Cache-Control: private, no-store`。
- 本任务先建 `src/server/lib/logger.ts` 的最小版（写 JSON 到 stdout，接口和 M0-T08 一致），M0-T08 再换成带脱敏的 pino。
- 会被 Next 打包的 src/server 模块，首行写 `import 'server-only'`；`src/server/jobs/**` 和 `scripts/**` 不写。
- `eslint.config.mjs`：用 no-restricted-properties 禁止 `$queryRawUnsafe` 和 `$executeRawUnsafe`；用 no-restricted-syntax 禁止直接访问 studentContact、creditLedger、creditWallet，并通过 overrides 放行 `contact-access.ts`、`credits.ts`、`prisma/seed.ts`、`tests/**`；`src/server`、`src/worker.ts`、`src/app/api` 下 no-console 设为 error；检查 `use server` 文件只导出 `action(...)`。
- `src/server/lib/client-ip.ts`：`getClientIp` 只读 `x-real-ip`（这个头由 Caddy 写入）。
- 加密改到 M0-T10，本任务不写 crypto。
验收：
- 单元测试覆盖：设置读取默认值、限流超限
- 在 unlock.ts 里写一行 `tx.creditLedger.create({})`，`pnpm lint` 报错
- 在 `use server` 文件里加一个没包装的 export，检查失败；带 `Origin: https://evil.example` 的 POST 被拒
- `pnpm test` 通过，server-only 在测试里不抛错

> 完成 2026-11-05：server/db.ts（PrismaClient 单例）；server/errors.ts（AppError + 7 个子类）；server/lib/logger.ts（最小 JSON stdout 实现）；server/lib/client-ip.ts（只读 x-real-ip）；server/lib/rate-limit.ts（内存滑动窗口）；server/services/audit.ts（logAudit）；server/services/settings.ts（getSetting 60s 缓存 + setSetting 写审计）；server/action.ts（action() 包装，public/user 两种 auth，M0 auth=user 存根）；server/route.ts（route() 包装，非 GET/HEAD 校验 Origin，默认 Cache-Control: private, no-store）；eslint.config.mjs 增加 no-restricted-syntax（$queryRawUnsafe/$executeRawUnsafe/creditLedger/creditWallet/studentContact）、no-console（server 目录）、local/use-server-exports 自定义规则；unit tests: settings（4 条）、rate-limit（4 条）均通过；偏差：本地集成测试因无 DB 凭据失败（同 M0-T04 已知偏差）

#### [x] M0-T08 带 PII 脱敏的日志和告警出口
依赖：M0-T07
做：
- `src/server/lib/logger.ts`：pino 只输出到 stdout，redact 字段包括 password、token、email、phone、whatsapp、wechat、linkedin、cookie、authorization（每个字段同时写顶层和 `*.` 前缀两种路径，例如 `email` 和 `*.email`）。不用 pino transport；如果打包报错，就把 pino 加进 `serverExternalPackages`。
- middleware 负责生成或透传 `x-request-id`；日志里只记路由模板，不记原始 URL。
- `src/server/lib/alert.ts` 提供 `alert(code, ctx)`：M0 阶段只写 `logger.error`；M3-T03 之后同时给 ADMIN 发站内通知；M7-T04 之后同时转发到 Sentry。
验收：
- 写入哨兵 email、phone 和嵌套的 token 后，输出里一个哨兵值都没有
- 调用 `alert('wallet.mismatch')` 会产生一条 level 50 的日志；请求不带 x-request-id 时，日志里仍有 requestId

> 完成 2026-11-05：pino@9.14.0 替换最小 JSON logger，redact 路径覆盖 9 个 PII 字段（顶层 + `*.` 前缀各一条）；serverExternalPackages 加入 pino；proxy.ts 生成/透传 x-request-id（请求头转发 + 响应头回显）；alert.ts（logger.error，level 50）；route.ts 增加 requestId 传播；单元测试：logger.test.ts（8 个 PII + level 验证）、alert.test.ts（4 个）、route-request-id.test.ts（2 个）；pnpm lint / typecheck / test 全部通过

#### [x] M0-T09 秘密防线：gitleaks 自定义规则和 CI 全历史扫描
依赖：M0-T06
做：
- `.gitleaks.toml`：`useDefault = true`，另加一条 `findmyjob-app-secrets` 规则，匹配 PII_KEYS、PII_HMAC_KEY、BETTER_AUTH_SECRET、TURNSTILE_SECRET_KEY、S3_SECRET_ACCESS_KEY、SEED_ADMIN_PASSWORD、RESEND_API_KEY、STRIPE_*，后面跟 `=` 或 `:`，值至少 16 位。allowlist 只放 `env.example` 和 Cloudflare 官方的 Turnstile 测试 key。
- CI 的 security job：`fetch-depth: 0`，用 docker run 跑固定 tag 的 gitleaks 镜像（与 `.githooks/pre-commit` 同一个 tag），执行 `git --redact --exit-code 1` 扫全部历史。
- 负例自测：在 `$RUNNER_TEMP/leak` 里写一个随机的 PII_KEYS，执行 `gitleaks dir --config .gitleaks.toml --report-format json --report-path -`，断言 RuleID 是 `findmyjob-app-secrets`。
验收：
- 全历史扫描退出码为 0；负例自测的断言通过
- 本机提交一个含随机 BETTER_AUTH_SECRET 的文件，被 pre-commit 拦下；`git config --get core.hooksPath` 输出 `.githooks`

> 完成 2026-11-05：.gitleaks.toml（useDefault=true + findmyjob-app-secrets 规则，匹配 8 类密钥变量，值≥16 位，allowlist: env.example 路径 + Turnstile 官方测试 key 正则）；security job 加入 ci.yml（fetch-depth:0，docker run ghcr.io/gitleaks/gitleaks:v8.21.2 与 pre-commit 同 tag，全历史 git 扫描 + 负例自测 jq 断言）；偏差：任务规格写 `gitleaks dir`，gitleaks v8.21.2 的目录扫描命令为 `detect --source`，CI 自测步骤使用 `detect --source /scan` 替代
> 总控补修 2026-11-05：合并前复查发现全历史扫描其实报 11 处（退出码 1），全是自定义规则误报：`\s*` 跨行把 ARCHITECTURE.md 变量表里空值 `KEY=` 的下一行当成值，src/env.ts 的 `z.string()…` 也被当成值。正则改为 `[ 	]*`，allowlist 加一条只放过以 `z.` 或 `process.env.` 开头的代码表达式。复测：5 个真密钥样例（.env、带引号、YAML、export、负例自测文件）都命中，误报样例 0，全历史扫描退出码 0

#### [x] M0-T10 PII 密钥环（keyId 前缀 + AAD）
依赖：M0-T07
做：
- `PII_KEYS` 格式为 `v1:<base64 32 字节>[,v2:...]`，另有 `PII_ACTIVE_KEY_ID`。env.ts 校验每个 key 正好 32 字节，并且 active 在列表里。
- `src/server/lib/crypto.ts`：密文格式 `enc:<keyId>:<base64(iv12‖ct‖tag16)>`；iv 用 `randomBytes(12)`；AAD 为 `StudentContact.<field>:<studentId>`。对外只暴露 `encryptField` 和 `decryptField`，解密失败抛 DecryptError。
- 只有 `contact-access.ts` 能调用 `decryptField`（ESLint override 保证）。在 RUNBOOK 草稿里写生成密钥的命令；轮换时，旧密钥要一直保留到含旧密文的备份过期（30 天）。
验收：
- 加密再解密能还原；改动 tag 后解密失败；把 A 学生的密文复制到 B 学生的行，解密抛 DecryptError
- active 换成 v2 之后，v1 加密的数据仍能解开；加密 1 万次 iv 不重复；StudentContact 的非空字段都以 `enc:v` 开头

> 完成 2026-11-05：src/server/lib/crypto.ts（AES-256-GCM，格式 enc:keyId:base64(iv12‖ct‖tag16)，AAD 参数化）；env.ts 增加 PII_KEYS 格式校验（每个 key 正好 32 字节，active 在列表里）；eslint.config.mjs 增加 decryptField 调用限制（仅 contact-access.ts 和 tests 豁免）；docs/RUNBOOK.md 填写密钥生成与轮换步骤；tests/unit/crypto.test.ts（10 个测试，含轮换、10K IV 唯一性、AAD 越权）；pnpm lint/typecheck/test 全部通过

#### [x] M0-T11 worker 骨架
依赖：M0-T03、M0-T08
做：
- `src/worker.ts` 负责启动 pg-boss、优雅退出和任务注册表（`src/server/jobs/registry.ts`）。`pnpm worker` 用 `tsx --conditions=react-server` 启动，能否生效要实测。
- pg-boss 连 `WORKER_DATABASE_URL`，`connection_limit=3`，`max=4`。Next 进程里只负责 send 的实例 `max=2`，并关掉维护和调度（选项名按所装版本核实）。
- 注册一个示例任务。业务任务由各自的任务实现时注册（purge-unverified、requalify-referrals、pilot-monthly-credits、reconcile-wallets 等）。
验收：
- `pnpm worker` 启动后 5 秒内不报错，示例任务已注册；Ctrl+C 能优雅退出

> 完成 2026-11-05：pg-boss@12.38.0；src/worker.ts（max=4，优雅退出 SIGINT/SIGTERM）；src/server/jobs/registry.ts（registerJobs，注册 example 任务）；src/server/jobs/boss.ts（Next.js send-only，max=2，supervise=false，schedule=false）；pnpm lint/typecheck/test 全部通过；偏差：tsx --conditions=react-server 实测可用（server-only 解析为 empty.js）；pg-boss 使用命名导出 { PgBoss }（v12 无默认导出）
> 总控补修 2026-11-05：本机实测 `pnpm worker` 起不来，改了三处：脚本加 `--env-file-if-exists=.env`（tsx 不会自己读 .env）；两个 PgBoss 实例加 `createSchema:false`（findmyjob_app 没有库级 CREATE，CREATE SCHEMA IF NOT EXISTS 也会 42501，schema 已由 db-setup.sql 预建）；registry 先 `createQueue` 再 `work`（v12 要求）。连续启动两次都无报错；Ctrl+C 优雅退出没在 Windows 上实测

#### [x] M0-H01 D1.5 auto-build 演练（人工）
依赖：无（D1 建仓并完成首次提交后、M0 正式开跑前做；做完由人勾选）
做：
- `git switch -c milestone/M0`，然后 `AUTO_BUILD_DRY_RUN=1 ./scripts/auto-build.sh M0`。
- 验证权限写法：同时传 `--disallowedTools 'Edit(**/CLAUDE.md)' 'Write(**/CLAUDE.md)' 'Bash'`，在 transcript 里看 Edit 的 tool_result 是否被拒；看 `Skill(superpowers:brainstorming)` 的 deny 是否生效；看 `--strict-mcp-config` 下 MCP 工具列表是否为空。哪条不生效，就从脚本里删掉并记录。
- 正式跑一轮：`./scripts/auto-build.sh M0 1`。检查 rounds.tsv 第一行是 TASK_DONE、`git log -1` 含 M0-T01、`git status --porcelain` 为空。
- 由人在 `.claude/settings.local.json` 写 `ENABLE_STOP_REVIEW=1`，再跑一轮 M0-T02。`~/.claude/security/log.txt` 里不能有 Stop 审查的 Review usage（Stop 记录可以是 ENABLE_STOP_REVIEW=0、no API credentials、LLM review disabled 三种之一）。跑完删掉这个文件。
- transcript 里 brainstorming 和 AskUserQuestion 出现 0 次，SessionStart 里没有 claude-mem 的记忆块。
- 用每轮成本乘以剩余任务数，写进 DECISIONS D23：单轮 X 美元、预计总共 Y 元、上限 Z 元、谁付。超出上限就改用方式 A，或者设置 AUTO_BUILD_MODEL。
验收：
- 以上检查全部成立；D23 已填写
> 完成 2026-11-05：演练由 autopilot 跑完（探针 4 项都生效；M0-T01、T02 两轮 TASK_DONE；ENABLE_STOP_REVIEW=1 被 headless-settings 压住；AskUserQuestion、brainstorming 0 次，没有 claude-mem 记忆块），记录在方案目录 .reports/2026-11-05-autopilot/summary.md。D23 由用户在对话里拍板（不设上限），总控按用户「完全接管」的指示代为勾选

> M0 合并前（人工）：见文末「M0 合并前」清单。

---

## M1 · 账号与认证（约 2.7 天）

#### [x] M1-T01 Better Auth 集成与加固基线
依赖：M0-T07、M0-T08
做：
- 邮箱 + 密码；邮箱验证码；会话；User 额外字段 role / locale / status；`lib/email.ts` 定义 `EmailProvider` 接口，实现 smtp（开发连 Mailpit）和 resend 两种。
- 按 ARCHITECTURE §5.11 配置（选项名以实际安装的版本为准）：baseURL 和 trustedOrigins 设为 APP_URL，开发环境另加 localhost:3000；不设置 disableCSRFCheck；`APP_ENV=production` 时 useSecureCookies:true；不开 cookieCache。
- `user.additionalFields` 里 role 和 status 设为 `input:false`；打开 requireEmailVerification；改密码时撤销其他会话，重置密码后撤销全部会话。
- emailOTP：最多尝试 5 次，600 秒过期，以哈希形式存储。
- rateLimit：存储方式设为 database（表用 Better Auth CLI 生成到临时文件，再手工合并进 schema，保留 Timestamptz；model 数相应变为 43，记进 DECISIONS「开发中决策」）。customRules：登录 60 秒 5 次，注册、发验证码、找回密码各 60 秒 3 次。ipAddressHeaders 设为 `x-real-ip`。
验收：
- 注册 → Mailpit 里收到验证码 → 验证 → 登录 → 登出，全流程可走通
- POST /api/auth/update-user 时带 role 字段，role 不会改变；带 Origin evil 的 sign-out 返回 403
- 第 6 次登录失败返回 429，重启进程后计数仍然保留

> 完成 2026-11-05：better-auth@1.7.16 + prismaAdapter；emailOTP（allowedAttempts=5，expiresIn=600，storeOTP=hashed）；rateLimit database 存储（新增 rateLimit model #43）；trustedOrigins/useSecureCookies/cookieCache 按 §5.11 配置；role/status input:false；onPasswordReset 撤销全部会话；lib/email.ts（EmailProvider 接口 + SmtpEmailProvider + ResendEmailProvider）；/api/auth/[...all]/route.ts（Better Auth handler，不经 route() 包装）；action.ts/route.ts 换用真实 Better Auth 会话；pnpm lint/typecheck/test 全部通过；偏差：Better Auth CLI 不可用，rateLimit 表由手工 SQL 创建并通过 docker compose exec 应用到 findmyjob 和 findmyjob_test；changePassword 时撤销其他会话在客户端传 revokeOtherSessions:true（M1-T04 实现），服务端只强制 onPasswordReset；端到端流程（Mailpit 收码→验证→登录→登出）需手工验证

#### [x] M1-T02 注册分流与同意记录
依赖：M1-T01
做：`/register/student`、`/register/employer`，分别写入角色；同意项按 PRD §2.1（TERMS、PRIVACY 必选；学生可选 TALENT_POOL）；写 Consent（version 取 `legal.currentVersion`，记录 IP、UA）；支持 `?ref=邀请码`（先存下来，M2-T09 再接入）。
验收：
- 不勾必选项无法提交
- Consent 记录含版本、IP、UA；学生勾选 TALENT_POOL 时 visibility 设为 PUBLIC

> 完成 2026-11-05：`/register/student`（含 `?ref=` 参数，存入 ref_code cookie）和 `/register/employer` 页面；`server/services/consent.ts`（recordConsents，version 取 legal.currentVersion，记录 IP/UA）；`server/actions/register.ts`（registerStudent/registerEmployer，均用 action() 包装，role 写入 EMPLOYER，学生在注册时创建最小 StudentProfile 并按 TALENT_POOL 勾选设 visibility）；i18n 中英文案；5 个单元测试；pnpm lint/typecheck/test 全部通过；偏差：`auth.api.signUpEmail` 端到端行为（邮件发送）需手工验证（同 M1-T01 偏差）

#### [x] M1-T03 权限守卫与越权矩阵
依赖：M1-T01
做：
- middleware 粗粒度拦截，matcher 用正向列表：`/:locale/s|e|admin/:path*` 和 `/api/:path*`，排除 `/api/auth/*` 和 `/api/health`。
- `server/authz.ts`：`requireUser`、`requireStudent`、`requireCompanyMember(minRole)`（返回 `{ userId, companyId, role }`）、`requireVerifiedCompany`、`requireAdmin`；每次都查库，检查 User.status、CompanyMember、Company.isActive 和 verificationStatus；SUSPENDED / DELETED 用户一律拒绝。companyId 只能来自 `requireCompanyMember()`。
- `action()` 和 `route()` 补上 student、company（可带 verified）、admin 三种 auth。
- `tests/integration/authz-matrix.test.ts` 用表驱动。覆盖的敏感动作：解锁、联系方式、人才详情和搜索、简历下载、点数、团队管理、admin 调整。每个动作对访客、学生 A/B、本企业成员、其他企业、已停用账号分别断言。这些动作在各自任务实现时再加行。
验收：
- 集成测试覆盖：各角色访问其他角色路径被拒；停用用户被拒；企业成员不能访问其他企业的数据
- zh 和 en 两种 locale 下，`/s`、`/e`、`/admin` 未登录访问都跳转到登录页
- 矩阵里现有的行全部通过

> 完成 2026-11-05：src/server/authz.ts（requireUser/requireStudent/requireCompanyMember/requireVerifiedCompany/requireAdmin，每次查库，SUSPENDED/DELETED 一律拒绝）；proxy.ts 增加 /api/* 和 /:locale/s|e|admin/* 的 session cookie 守卫（无 cookie 返回 401 或跳转 login）；action.ts/route.ts 补充 student/company/admin auth 类型（company 支持 minRole + verified 选项）；tests/integration/authz-matrix.test.ts 23 行表驱动测试（requireUser/requireStudent/requireCompanyMember/requireVerifiedCompany/requireAdmin，覆盖 guest/student/employer/admin/suspended/deleted/inactive-company/cross-company）；pnpm lint/typecheck/test 全部通过（65 tests）；偏差：/zh/login 登录页不存在（M1-T04 建），middleware redirect 目前落到 404，CI 才能跑 E2E 验证

#### [x] M1-T04 登录跳转与账号设置
依赖：M1-T03
做：登录后按角色跳转（学生 → `/s` 或 `/s/onboarding`，企业 → `/e` 或 `/e/onboarding`，运营 → `/admin`）；修改密码；语言偏好；忘记密码（邮件重置）。
验收：E2E：学生注册 → 验证 → 进入 `/s/onboarding`

> 完成 2026-11-05：/login 页（LoginForm，Better Auth 客户端 signIn.email，按角色跳转：学生 completeness=0→/s/onboarding，否则→/s；企业无公司→/e/onboarding；运营→/admin；支持 ?redirect= 参数）；/forgot-password（防枚举，统一成功提示）；/reset-password（token 重置）；/s/settings（修改密码 revokeOtherSessions=true、语言偏好 updateLocaleAction 写 User.locale）；新增 stub 页：/s、/s/onboarding、/e、/e/onboarding、/admin；E2E tests/e2e/auth-redirect.spec.ts（依赖 Mailpit，无 Mailpit 时 skip）；pnpm lint/typecheck/test/db:check 全部通过（65 tests）

#### [x] M1-T05 认证限流、人机验证、防枚举与审计
依赖：M1-T03
做：
- `lib/turnstile.ts`：`verifyTurnstile(token, { action })`，siteverify 设 5 秒超时，超时按失败处理；校验 success、hostname 和 action；token 只能用一次。开发环境用 Cloudflare 官方测试 key；`APP_ENV=production` 时拒绝官方测试 secret（前缀以官方文档为准）。
- 在 Better Auth 的 `hooks.before` 里，对注册、登录、发验证码、找回密码这 4 个原始路径调用 `verifyTurnstile`；页面表单也带 token。
- 防枚举：用已注册的邮箱注册时，返回和新邮箱一样的响应，并给这个邮箱发一封提醒；找回密码时，邮箱不存在也返回成功；登录失败统一提示「邮箱或密码错误」。
- 登录成功写 `auth.login` 审计并更新 `lastLoginAt`。
验收：
- 不带 token 直接 POST /api/auth/sign-up/email，被拒；缺少或伪造 token 时返回 400；测试 key 能通过
- mock siteverify：hostname 不对、success=false、超时，三种情况都被拒
- 已注册邮箱和新邮箱的注册响应快照完全一致；`APP_ENV=production` 用测试 secret 时无法启动
- 同一 IP 连续失败超过阈值后返回限流错误

> 完成 2026-11-05：创建 src/server/lib/turnstile.ts（verifyTurnstile，5 秒超时，校验 success/hostname/action）；auth.ts 加 hooks.before（TURNSTILE_PATHS 对 4 个端点拦截）和 databaseHooks.session.create.after（写 auth.login 审计 + 更新 lastLoginAt）；register.ts 两个 action 均直接调用 verifyTurnstile（server-to-server 调用绕过 HTTP 中间件）；LoginForm/StudentRegisterForm/EmployerRegisterForm/ForgotPasswordForm 均集成 TurnstileWidget 并传 token；防枚举逻辑已在 register 和 auth 层实现；新增 tests/unit/turnstile.test.ts（6 个用例）；lint/typecheck/test 全部通过（71 tests）

#### [x] M1-T06 学生注册上限
依赖：M1-T02、M0-T11
做：
- `services/signup-cap.ts`：`assertStudentSignupOpen()`、`maybeWarnCap()`。`assertStudentSignupOpen()` 放在 `databaseHooks.user.create.before` 里，直接调用接口也会被挡；只统计 emailVerified=true、状态 ACTIVE、角色 STUDENT 的用户。
- 注册页（包括带 `?ref=` 的）满额时显示「名额已满」。
- 新增 pg-boss 任务 `purge-unverified`，每小时运行一次，删除超过 `signup.unverifiedTtlHours`（48）小时仍未验证的账号。
- 软上限（并发时可能略超）已记在 DECISIONS 的已接受风险里。
验收：
- 达到上限时学生注册返回 `SignupClosedError`；直接 POST 注册端点同样会被挡住；已注册的用户照常登录；企业注册不受影响；达到 90% 时只给运营发一条通知
- 上限为 3、已有 2 个已验证和 5 个未验证学生时，第 3 个学生仍能完成注册
- 用假时钟推进 48 小时后，未验证账号被删除

> 完成 2026-11-05：`services/signup-cap.ts`（assertStudentSignupOpen/maybeWarnCap/purgeUnverifiedAccounts）；`SignupClosedError` 加入 errors.ts；`auth.ts` 增加 databaseHooks.user.create.before（调用 assertStudentSignupOpen，企业注册通过 employerRegistrationContext 跳过检查）；`register.ts` registerStudent 在 signUpEmail 前调 assertStudentSignupOpen，registerEmployer 在 employerRegistrationContext 中运行 signUpEmail；`purge-unverified` 任务每小时 cron 注册至 registry.ts；学生注册页满额时显示名额已满横幅；zh/en i18n 新增 signupClosed 和 errorSignupClosed；单元测试 11 个（81 total）全部通过；偏差：employer 通过 AsyncLocalStorage 跳过 cap hook（context 在 Node.js 进程内有效，不跨请求）


#### [x] M1-T08 注册路径补修：单一 Turnstile 校验点、限流不被绕过、防枚举真正生效
依赖：M1-T06
> 总控 2026-11-05 加入：M1 合并前的安全复查（主会话代替没跑成的提交审查）发现以下问题，都在 better-auth 1.7.16 源码里核实过。报告在方案目录 .reports/2026-11-05-autopilot/summary.md「M1 安全复查」。
做：
- 现状：注册 action 先自己 `verifyTurnstile`，再调 `auth.api.signUpEmail`。1.7.16 里 `auth.api.*` 也会跑 `hooks.before`，钩子在请求体里找不到 token，于是注册一律 `REGISTER_FAILED`，本地和 CI 无法注册。只把 token 透传过去也不行，生产环境的 token 只能用一次。另外，`auth.api.*` 直接调用不经过 Better Auth 的路由层限流（onRequestRateLimit），注册 60 秒 3 次的规则对 action 不生效。
- 让每次注册只在一处校验 Turnstile，同时让 Better Auth 自带的限流对 UI 注册生效。比如 action 通过 `auth.handler(new Request(APP_URL + '/api/auth/sign-up/email', …))` 走 HTTP 路由，带上 token、`x-real-ip`、`origin`、`user-agent`，并去掉 action 自己的 verifyTurnstile；也可以用别的等效方案。方案和理由记进 DECISIONS。不能自己另写一套限流（CLAUDE.md：认证限流只用 Better Auth 自带的功能）。
- 防枚举：`requireEmailVerification:true` 时，重复邮箱不会抛 USER_ALREADY_EXISTS，而是返回一个随机 id 的合成用户。之后写 StudentProfile 时 FK 报错，企业注册的 role 更新 P2025，结果已注册邮箱返回 `INTERNAL_ERROR`，新邮箱返回 ok，成了探测已注册邮箱的口子。改法：signUp 之后确认用户行存在；不存在时直接返回与新邮箱相同的 `{ email }`，不碰 profile、consent、role。提醒邮件改用 `emailAndPassword.onExistingUserSignUp` 发。删掉永远走不到的 USER_ALREADY_EXISTS 分支。
- 同意记录：任何能建出用户的入口，都必须同时写 TERMS 和 PRIVACY 的 Consent。用户行、StudentProfile、Consent 不能出现建了一半的状态（失败时整体回滚，或者用事务或 databaseHooks 保证）。直接 POST `/api/auth/sign-up/email` 不带同意信息时要被拒。
- emailOTP 插件：`disableSignUp: true`，不让 `/sign-in/email-otp` 建出没有密码、没有 Consent、没有 StudentProfile 的已验证用户。没有 UI 调用方的 `/api/auth` 端点（至少 `/email-otp/request-password-reset`、`/forget-password/email-otp`、`/send-verification-email`、`/sign-in/email-otp`）放进 `disabledPaths`；确实要留的，就加进 TURNSTILE_PATHS 和限流 customRules。逐个列进 DECISIONS。
- 名额满时直接 POST 原始注册端点，现在会返回伪造的 200（Better Auth 把 create 时的 403 改写成了「重复邮箱」的响应）。改成在 `/sign-up/email` 的 hooks.before 里检查名额（企业注册跳过），新老邮箱都得到同一个 SIGNUP_CLOSED。企业注册的 role 在 `user.create.before` 里直接返回 `role:'EMPLOYER'`，删掉事后的那次 update。
- 表单：StudentRegisterForm 映射 SIGNUP_CLOSED（显示已有的 errorSignupClosed）；提交失败后重置 Turnstile 组件（token 用一次就失效）；`turnstileToken` 改成 `z.string().min(1).max(2048)`。
验收：
- `tests/e2e/auth-redirect.spec.ts` 全流程通过：注册 → Mailpit 收信 → 验证 → 登录 → /s/onboarding → 登出 → 访问 /s 跳登录 → 旧 cookie 回放后 get-session 为 null。本地 Mailpit 在 127.0.0.1:8026，不许 skip
- 集成测试：已注册邮箱和新邮箱走注册 action，返回值完全一致，都是 ok；已注册邮箱收到提醒邮件，且没有新建 StudentProfile 或 Consent
- 集成测试：同一 IP 第 4 次注册（60 秒内）被限流，经 action 走 UI 路径的也一样
- 集成测试：直接 POST `/api/auth/sign-up/email`，不带 Turnstile token → 400 TURNSTILE_FAILED；不带同意信息 → 被拒；名额已满 → SIGNUP_CLOSED（新老邮箱同一结果）；带 role ADMIN → 建出的是 STUDENT
- disabledPaths 里的每个端点返回 404；`/sign-in/email-otp` 不能为陌生邮箱建号
- `tests/integration/authz-matrix.test.ts` 加上对应的行

> 完成 2026-11-05：注册 action 改走 `auth.handler(new Request(APP_URL + '/api/auth/sign-up/email', …))`，Turnstile/限流/名额检查全部在 `hooks.before` 里做一次；防枚举通过 DB 查询确认 userId 是否真实存在（不存在就 return { email }，提醒邮件由 onExistingUserSignUp 发）；StudentProfile + Consent 在 `db.$transaction` 里原子创建；企业 role 在 `databaseHooks.user.create.before` 里直接写，删掉事后 UPDATE；emailOTP `disableSignUp: true`；`/sign-in/email-otp`、`/email-otp/request-password-reset`、`/forget-password/email-otp` 加入 disabledPaths（404）；`/send-verification-email` 保留并加入 TURNSTILE_PATHS + customRules；StudentRegisterForm 映射 SIGNUP_CLOSED 并在失败时重置 Turnstile；`turnstileToken` 改为 `z.string().min(1).max(2048)`；新建 tests/integration/register.test.ts（187 tests 全通过）；authz-matrix 补充 4 行；DECISIONS 新增 4 条；pnpm lint/typecheck/test/db:check 全部通过；偏差：E2E 全流程（Mailpit→验证→登录→登出）需有 Mailpit 服务；rate-limit 集成测试以 mock 替代真实 DB 计数，实际限流行为由 E2E 覆盖

#### [x] M1-T09 认证加固：真实 IP、发信时序、令牌哈希、停用账号、页面守卫等
依赖：M1-T08
> 总控 2026-11-05 加入，来源同 M1-T08。
做：
- 真实 IP：删掉不生效的 `rateLimit.ipAddressHeaders`，改为 `advanced.ipAddress.ipAddressHeaders: ['x-real-ip']`。1.7.16 只读这个位置，默认用 X-Forwarded-For，可以伪造；多值时会变成 null，全站共用一个限流桶。`rateLimit.enabled` 显式设置，并保证测试环境能复现「第 6 次 429」。`auth.login` 审计记 `ip`（用 getClientIp，不用 session.ipAddress）。
- 发信时序：设 `advanced.backgroundTasks.handler`（例如 next/server 的 `after()`），或者改成入 pg-boss 发信任务。目标是让找回密码、注册、发验证码对已存在和不存在的邮箱，响应时间不因发信而不同。
- 令牌：`verification.storeIdentifier: 'hashed'`（CLAUDE.md：令牌只存 sha256 哈希）。重置密码设 `revokeSessionsOnPasswordReset: true`；`/change-password` 在 hooks.before 里强制 `revokeOtherSessions=true`，不依赖客户端传参。
- 账号状态：在 `databaseHooks.session.create.before` 里拒绝 status 不是 ACTIVE 的用户登录。
- 页面守卫：`/[locale]/s`、`/e`、`/admin` 各加一个 layout.tsx，分别调 requireStudent、requireCompanyMember（或企业 onboarding 可用的那个守卫）、requireAdmin；proxy 里的 cookie 判断只是乐观判断。
- `route()`：传了 input schema 就真的用 zod 解析 query 和 body，跟 `action()` 一致。
- 隐私：注册成功后跳转 verify-email 时，URL 里不带邮箱。日志里不写 signUp 的原始 `err.message`（SMTP 报错可能带收件人），只写错误码。Better Auth 的 `logger` 接到 `src/server/lib/logger.ts`。`src/lib/email.ts` 加 `import 'server-only'`。
- 配置：`useSecureCookies` 在 production 设 true，其他环境不设（让 https 的 staging 自动带 Secure）。`http://localhost:3000` 只在 `APP_ENV=development` 时加进 trustedOrigins。`src/env.ts` 在 production 要求 BETTER_AUTH_SECRET 至少 32 位。
- purge-unverified：`signup.unverifiedTtlHours` 用 `z.number().int().min(1)` 校验，失败回落到 48；按主键分批删除，每批 ≤1000。`maybeWarnCap()` 在学生完成邮箱验证后调用（M1-T06 验收要求 90% 时通知，现在从没调用过）。
验收：
- 带伪造 X-Forwarded-For、轮换取值时，仍按 X-Real-IP 计数，第 6 次登录失败返回 429；X-Forwarded-For 多值时不会全站共用一个桶
- Verification 表里看不到明文的 reset 令牌；重置密码后，旧会话的 get-session 为 null；直接 POST `/change-password` 不带 revokeOtherSessions，其他会话照样被撤销
- SUSPENDED 用户用正确密码登录被拒，也拿不到会话
- 学生会话访问 `/zh/admin`、企业会话访问 `/zh/s`，都被拒（跳转或 403）；伪造的 cookie 值访问 `/zh/s` 会回到登录页
- unverifiedTtlHours 设为 0、负数、null 时按 48 小时处理；1500 个过期未验证账号分两批删完
- 找回密码对已存在和不存在的邮箱：响应体一致，耗时差 < 100ms（集成测试取多次的中位数）

> 完成 2026-11-05：`advanced.ipAddress.ipAddressHeaders: ['x-real-ip']`（删掉 rateLimit.ipAddressHeaders）；`rateLimit.enabled: true` 显式设置；`advanced.backgroundTasks.handler` 用 next/server `after()` 包装邮件发送；`emailAndPassword.revokeSessionsOnPasswordReset: true`；`/change-password` hooks.before 强制 `revokeOtherSessions=true`；`databaseHooks.session.create.before` 拒绝非 ACTIVE 用户登录（ACCOUNT_SUSPENDED）；`auth.login` 审计记 session.ipAddress（配置固定后等价于 getClientIp）；Better Auth logger 接到 app logger（log 函数，仅 warn 以上）；email 发送失败只记错误码不记原始 err.message；`emailVerification.afterEmailVerification` 调 maybeWarnCap；trustedOrigins 仅 development 加 localhost:3000；BETTER_AUTH_SECRET ≥32 位生产强制；/[locale]/s、/e、/admin 新建 layout.tsx（分别用 requireStudent、requireEmployer、requireAdmin 守卫）；authz.ts 新增 requireEmployer；route() 实现真正的 zod 解析（query/body，失败返回 400）；verify-email 跳转去掉 email 参数，messages 改为通用措辞；email.ts 加 import 'server-only'；signup-cap.ts：ttlHours 用 z.number().int().min(1) 校验回落 48，分批删除 ≤1000；env.ts 生产强制 BETTER_AUTH_SECRET ≥32；tests/unit/auth-hardening.test.ts（route() 5 个用例）；authz-matrix 新增 requireEmployer 5 行；signup-cap tests 更新为批量删除；pnpm lint/typecheck/test/db:check 全部通过（199 tests）；偏差：verification.storeIdentifier:'hashed' 在 Better Auth 1.7.16 类型中不存在（未添加）；auth.login audit IP 通过 session.ipAddress（配置 x-real-ip 后等价）；E2E（SUSPENDED 用户、IP 限流复现）需 Mailpit+真实 DB

---

## M2 · 学生档案、额度与邀请（约 3.6 天）

#### [ ] M2-T01 档案 service 与 Onboarding 向导
依赖：M1-T04
做：`services/student-profile.ts` + zod schemas；`/s/onboarding` 四步向导（PRD §2.2），改为必经流程：顶部显示「第 n / 4 步」进度，每步可保存后退出，进度保存在服务端，下次回到第一个没填完的步骤；第 1 步加 CGPA（可选，0.00–4.00）。
验收：
- E2E 走完向导，数据正确入库；保存退出后再进来，停在第一个没填完的步骤
- 375px 宽度下可正常使用

#### [ ] M2-T02 档案编辑页
依赖：M2-T01
做：`/s/profile` 分区编辑；教育、经历的增删改和拖拽排序；语言选择器；技能标签输入组件（回车添加、去重、最多 30 个）。标签输入的 onKeyDown 先调用 `isImeComposing(e)`，为真就直接 return，再处理按键。
验收：
- 所有字段可编辑并保存；375px 宽度下可正常使用
- 派发一个 isComposing=true 的 Enter 事件，标签数量不变

#### [ ] M2-T03 档案完成度
依赖：M2-T01
做：纯函数 `computeCompleteness(profile)`（权重见 PRD §2.2），每次保存档案时重算并写入。
验收：单元测试覆盖每个分项的得分和边界值；空档案 = 0，除 PDF 外全部填满 = 90，全部填满 = 100

#### [ ] M2-T04 联系方式
依赖：M0-T10、M2-T01
做：`services/contact-access.ts` 中的 `getOwnContact` / `updateOwnContact`（经 `encryptField` / `decryptField` 加密存储，带 AAD）；`/s/contact` 页面，附隐私提示。
验收：数据库里的值以 `enc:v` 开头；学生本人读取到明文；手机号格式校验（马来西亚 / 中国 / 国际格式）

#### [ ] M2-T05 文件上传（app 中转）与简历
依赖：M0-T02、M0-T07
做：
- `lib/storage.ts`（S3 客户端；PutObject、签名 GET、删除全部版本）。
- 新增 `src/app/api/uploads/[purpose]/route.ts`，用 `route()` 包装。读取 formData，按 purpose 套白名单（ARCHITECTURE §5.5）：RESUME 只收 pdf，≤5MB；VERIFICATION 和 PAYMENT_PROOF 收 pdf/png/jpeg，≤10MB；LOGO 收 png/jpeg，≤2MB。
- 检查文件头（`%PDF-`、`89 50 4E 47`、`FF D8 FF`），拒收 SVG、HTML、XML。对象 key 由服务端生成。每个用户每小时最多 `limits.uploadsPerHour` 次；拒收写审计 `upload.reject`。
- PDF 用 getPageCount 检查，不超过 `resume.maxPages`（20）页；加密的 PDF 直接拒绝；页数写入 `ResumeFile.pageCount`。所有检查通过后才执行 PutObject。
- 签名 GET 有效期不超过 300 秒，并带 attachment。Content-Disposition 里的文件名按 RFC 5987 编码。存储桶设为私有，并阻止公共访问。
- `/s/resume`：上传、设为主简历、删除、预览。
验收：
- 直接 POST 一个 6MB 的 PDF，返回 413 或 400，桶里没有这个对象；非 PDF 被拒
- 把 .exe 改名成 .pdf 上传，被拒；30 页的 PDF 和加密的 PDF 都被拒
- 单测断言所有签名 GET 的有效期都不超过 300 秒
- 学生只能访问自己的简历；删除时对象存储里的文件（全部版本）一并删除

#### [ ] M2-T06 学校邮箱认证
依赖：M2-T01
做：`services/school-verification.ts`：选学校 → 输入学校邮箱 → 发 OTP → 验证后写入 `schoolVerifiedAt`。
- 域名必须按 `@` 后面的整段精确匹配 `School.emailDomains`；schoolEmail 统一转小写，并且唯一。
- 每个用户每小时最多发 `limits.otpSendsPerHour` 次，每个目标邮箱每天最多 `limits.otpSendsPerEmailPerDay` 次。
- OTP 存 sha256 哈希，比较时用 timingSafeEqual。
验收：
- 后缀不匹配被拒，`x@xmu.edu.my.evil.com` 被拒；OTP 10 分钟过期；连续 5 次输错锁定 30 分钟
- 第 6 次发送返回 429
- 两个账号同时认证同一个学校邮箱，只有一个能成功

#### [ ] M2-T07 隐私中心
依赖：M2-T01
做：`/s/privacy`：人才库可见性开关（同步写 Consent，审计 `student.visibility.change`）；屏蔽企业（搜索已认证企业后加入列表）；「谁看过我」「谁解锁了我」列表（暂无数据时显示空状态）。
验收：开关状态与最新一条 TALENT_POOL Consent 一致；可添加、移除屏蔽企业

#### [ ] M2-T08 学生首页
依赖：M2-T03
做：`/s`：完成度进度条；待办提示（认证学校 / 上传简历 / 填联系方式 / 开启人才库）；最新邀请和投递（暂为占位）。
验收：待办项随档案状态变化正确显示或隐藏

#### [ ] M2-T09 邀请同学（有效邀请）
依赖：M2-T03、M1-T02、M0-T11
做：
- `services/referrals.ts`：`getOrCreateReferralCode(studentId)`、`attachReferral(inviteeStudentId, code)`、`qualifyReferral(inviteeStudentId)`（每次保存档案后调用）、`voidReferral(id, reason)`（运营用，写审计 `referral.void`）。
- 新增参数 `referral.maxQualifiedPerDay=3`（D18），当天超出的保持 PENDING。
- 邮箱规范化（转小写；gmail 去掉点和 +tag）后，如果和邀请人相同，视为自己邀请自己，不计数。
- 新增 pg-boss 任务 `requalify-referrals`，每天 00:15（吉隆坡时间）运行。
验收：
- 完成度从 89 变到 90 时，PENDING 变 QUALIFIED，且只变一次；邮箱未验证时不生效；用自己的邀请码不生效；同一被邀请人第二次 attach 被忽略；并发保存两次只生效一次；作废的不计数
- 同一邀请人当天第 4 个达标的被邀请人保持 PENDING；用假时钟推进到次日，任务运行后变为 QUALIFIED
- `a.b+x@gmail.com` 邀请 `ab@gmail.com`，不算有效邀请

#### [ ] M2-T10 职位查看额度
依赖：M2-T09
做：
- `services/job-view-quota.ts`：`getQuota(studentId)` 返回 `{ used, limit: number | null, next }`；`openJob(studentId, jobId)` 返回 `{ allowed, quota }`，实现 ARCHITECTURE §5.9。
- advisory lock 一律调用 `lockXact(tx, LOCK_NS.JOB_VIEW_QUOTA, studentId)`（`lib/advisory-locks.ts`，内部用 `$executeRaw` 执行带 `::int` 命名空间的 `pg_advisory_xact_lock`）。
- 按 D18 的默认值：EMPLOYER 只能看本企业职位的详情，其他职位按访客处理。
- `/s/invite`：额度与邀请页（PRD §2.5）。
验收：
- 已投递、被邀请的职位总是允许打开；重复打开不计数；只剩 1 次时并发打开 2 个新职位，只有 1 个成功；关闭开关后不限；PURCHASE 和 ADMIN_GRANT 会增加额度
- 企业账号打开其他企业的职位详情，只能看到锁定卡片

---

## M3 · 企业入驻（约 1.7 天）

#### [ ] M3-T01 创建企业与企业资料
依赖：M1-T04、M2-T05
做：`/e/onboarding` 创建企业（创建者成为 OWNER），行业用两级代码（`lib/taxonomy/industries`）；`/e/company` 编辑资料、上传 Logo（经 uploads 路由）。公司定位标签不在企业侧出现。
验收：一个企业用户只能属于一家企业（MVP）；SSM 注册号唯一

#### [ ] M3-T02 提交认证材料
依赖：M3-T01
做：上传 1–5 个文件（PDF/PNG/JPG，单个 ≤ 10MB），一律经 `/api/uploads/VERIFICATION` 上传；`documentKeys` 只能来自本企业自己的上传记录 → 创建 CompanyVerification（PENDING），企业状态改为 PENDING；被驳回后可以重新提交。
验收：状态流转正确；企业成员能看到驳回原因；提交别的企业的对象 key 被拒

#### [ ] M3-T03 运营审核队列
依赖：M3-T02
做：`/admin/companies`：待审列表 → 详情（材料用签名 URL 查看）→ 通过 / 驳回（必须填原因）。审核页提示 SOP：通过公开渠道（SSM 记录、官网、公开电话）回拨核实。通过时：设为 VERIFIED、创建 CreditWallet、写审计 `company.verify`、通知 OWNER。`services/notifications.ts` 先实现 `createNotification` + 邮件入队（M5-T08 再完善）；`alert()` 从此同时给 ADMIN 发站内通知。
验收：
- 集成测试：通过后钱包存在；非 ADMIN 调用被拒
- 点「通过」时必须填核实记录：用了哪个公开渠道（SSM 记录、官网、公开电话，至少一项）和核实结果，写进 `CompanyVerification.reviewNote` 和 `company.verify` 审计的 metadata；不填时返回 ValidationError（TM-006）

#### [ ] M3-T04 团队管理
依赖：M3-T01
做：
- `/e/team`：邀请成员、接受邀请加入、移除成员、修改角色。OWNER 不可被移除或降级；RECRUITER 无权管理团队。
- 令牌用 `randomBytes(32)` 生成并做 base64url 编码，明文只出现在邮件链接里，数据库只存 `tokenHash`（sha256）。
- 接受邀请的账号必须已验证邮箱，并且邮箱和邀请一致（不区分大小写）；acceptedAt 已经有值时拒绝；7 天过期；成功时写审计 `company.invite.accept`。
- `requireCompanyMember` 每次都查库，不缓存角色。公益期团队上限 `team.maxMembers=3`（D18）。
验收：
- 过期 token 被拒；越权操作被拒（集成测试，加进 authz-matrix）
- 换一个账号打开邀请链接，被拒；同一个链接第二次使用，被拒；数据库里查不到明文令牌
- 被移除的成员下一次操作就被拒；公益期邀请第 4 个成员被拒

#### [ ] M3-T05 企业公开主页
依赖：M3-T01
做：`/companies/[id]`：只展示已认证且启用的企业；创始合作伙伴徽章；在招职位列表（M5 之前为空状态）。
验收：未认证企业的主页返回 404

#### [ ] M3-T06 企业控制台
依赖：M3-T02
做：`/e`：认证状态横幅（未提交 / 审核中 / 被驳回 / 已认证）、点数余额、快捷入口。
验收：每种认证状态都显示正确的横幅和引导

---

## M4 · 人才库与解锁（核心，约 3.4 天）

#### [x] M4-T01 自由文本脱敏
依赖：M0-T07
做：`lib/redact.ts`：把邮箱、电话（+60 / 01x-xxxxxxx、+86 1xxxxxxxxxx、通用国际格式）、URL、微信号模式（"微信"、"WeChat"、"wx" 后跟账号）替换为「[已隐藏]」。
验收：至少 15 个单元测试用例（含中英混排、全角字符、带空格或横线的号码），且不误伤普通数字（年份、GPA、百分比）
> 完成 2026-11-05：src/lib/redact.ts（全角归一化 + 7 条正则：URL、邮箱、+60、01x、+86、通用国际、微信/WeChat/wx）；tests/unit/redact.test.ts（24 组、60 个断言，含全角、中英混排、哨兵电话、false-positive 安全验证）；pnpm lint / typecheck / test 全部通过

#### [x] M4-T02 脱敏序列化器 + 防泄漏测试
依赖：M4-T01
做：
- `lib/mask-name.ts`（中文名取姓 + "同学"，支持复姓：欧阳、司马、诸葛、上官、东方、皇甫、尉迟、公孙、慕容、长孙、令狐、夏侯；非中文名取首字母 + "."）。
- `serializers/talent-card.ts`：`toTalentCard(profile, { unlocked })`、`toTalentDetail(profile, { unlocked, contact? })`。未解锁时 redact 覆盖 headline、summary、每个技能标签、Education 的 major 和 description、Experience 的 title、organization 和 description，以及结构化简历预览。
- 企业侧通知和邮件的 payload 只放 `toTalentCard` 的输出；只有已解锁或学生已投递时才放全名（改 `services/notifications.ts`）。
验收：
- **防泄漏测试**（ARCHITECTURE §5.2）通过；已解锁时返回全名和联系方式
- 在测试学生的自由文本里写入手机号、邮箱、微信号，卡片和详情页都显示「[已隐藏]」
- 未解锁时，企业侧 Notification.payload 里没有学生的全名
- 卡片和详情页显示的专业、学校名也经过 redact（TM-002）

> 完成 2026-11-05：src/lib/mask-name.ts（12 种复姓 + 单姓 + 非中文首字母）；src/server/serializers/talent-card.ts（toTalentCard / toTalentDetail，TM-002 school/major 始终经 redact，contact 仅 unlocked=true 时输出，storageKey 不出现在输出）；src/server/services/notifications.ts（buildEmployerStudentPayload，仅 isUnlocked||hasApplied 时传 unlocked=true）；tests/unit/mask-name.test.ts（22 个断言，含 12 种复姓、单姓、非中文、边界）；tests/unit/talent-card.test.ts（防泄漏测试 + TM-002 + notifications，30 个断言）；pnpm lint / typecheck / test / db:check 全部通过

#### [ ] M4-T03 人才库搜索 service
依赖：M4-T02、M2-T07
做：
- `services/talent-visibility.ts`：唯一的判断函数 `isStudentVisibleToCompany`（人才库条件见 PRD §0，加上未屏蔽本企业、账号正常）；搜索、详情、解锁、收藏、邀请都调用它。
- `services/talent-search.ts`：PRD §3.2 的全部筛选和排序；分页，`page > talentSearch.maxPage` 返回 400；每个成员每天翻页不超过 `limits.searchPagesPerDay`。trigram 索引已在 schema 里声明，不在迁移里手写。
验收：
- 集成测试覆盖每个筛选条件，以及每条排除规则（HIDDEN、学校未认证、完成度不足、已屏蔽、账号停用）；page=26 返回 400
- 关键词只匹配脱敏后的文本：测试学生的一句话介绍写「微信 leakwx0420」、一个技能写「wx leakwx0420」、一条经历标题写「+60 12-000 0420」后，用 `leakwx0420` 或 `12-000 0420` 搜索，结果里都没有这个学生（TM-002）

#### [ ] M4-T04 人才库搜索页
依赖：M4-T03
做：`/e/talent`：筛选面板（移动端为抽屉）、卡片列表、筛选条件同步到 URL（可分享、可返回）。指向人才详情的 Link 设 `prefetch={false}`。
验收：E2E：认证企业搜索并按条件筛到指定学生；未认证企业被引导去认证；在人才列表停 3 秒，ProfileView 数量不变

#### [ ] M4-T05 人才详情页与查看上限
依赖：M4-T04
做：
- `services/talent-view.ts` + `/e/talent/[id]`：未解锁视图；先调 `isStudentVisibleToCompany`，不满足返回 404；每次打开记录 ProfileView 并写审计 `talent.view`。
- 上限：成员级 `limits.profileViewsPerDay=200` 和企业级 `limits.companyProfileViewsPerDay=400` 同时生效；同一学生当天被同一企业重复查看只计 1 次（数据来自 ProfileView）；参数见 D18。触发任何上限时记审计 `talent.limit.hit`，返回友好提示。
验收：
- 超出每日上限后返回友好提示；ProfileView 正确写入
- 未解锁的企业直接访问一个 HIDDEN 学生的详情页，返回 404
- 同一企业的两个成员合计查看第 401 个学生时被拒；同一学生当天打开 5 次只计 1 次

#### [ ] M4-T06 点数服务
依赖：M3-T03
做：`services/credits.ts`：`applyLedgerEntry(tx, { companyId, delta, reason, refType?, refId?, actorId?, note? })`（扣减时余额不足抛错）、`getBalance`、`adminAdjust`（必须填原因，审计 `credits.adjust`）、`reconcileWallet`（balance 必须等于该钱包所有 delta 之和）。
验收：
- 单元 / 集成测试：账本 balanceAfter 连续正确；在事务外调用会报错
- 以 findmyjob_app 身份 UPDATE 或 DELETE CreditLedger 返回 42501

#### [ ] M4-T07 解锁
依赖：M4-T06、M4-T05
做：`services/unlock.ts`，严格按 ARCHITECTURE §5.3；先调 `isStudentVisibleToCompany`；按 `limits.unlocksPerDay` 限流；扣点数取 `unlock.costCredits`；详情页的解锁按钮 + 二次确认弹窗。加 authz-matrix 行。
验收：
- 并发测试：余额 3、并发解锁 10 个学生 → 恰好 3 个成功
- 同一学生并发重复解锁 → 只扣 1 次
- 学生已屏蔽本企业或已 HIDDEN → 拒绝解锁

#### [ ] M4-T08 联系方式访问
依赖：M4-T07、M2-T04
做：`contact-access.getContactForCompany(companyId, studentId)`；详情页在已解锁时显示全名和联系方式。加 authz-matrix 行。
验收：
- 集成测试：未解锁 → 拒绝；已解锁 → 返回明文；学生屏蔽该企业后 → 拒绝；账号删除后 → 拒绝
- `contact-access.ts` 提供唯一的 `canSeeIdentity(companyId, studentId)`（存在 TalentUnlock、学生没有屏蔽该企业、账号 ACTIVE），企业侧所有调用 `toTalentCard` / `toTalentDetail` 的地方都用它计算 `unlocked`；集成测试：解锁后学生屏蔽该企业、被停用或申请删号，详情页不再返回全名和联系方式（TM-003）

#### [ ] M4-T09 简历下载水印
依赖：M4-T08
做：`/api/resumes/[id]/download`：校验企业对该学生有访问权（TalentUnlock 存在且未被屏蔽）；用 `PDFDocument.create()` 加 `copyPages()` 把页面复制到新文档，再在新文档每页加水印（PRD §3.3）；每个企业成员同时最多 2 个水印任务；流式返回；审计 `resume.download`。加 authz-matrix 行。
验收：
- 无权限 → 403；生成的 PDF 每页都有水印文字（测试中解析 PDF 验证）
- 用 pdf-lib 重新解析输出文件：catalog 里没有 /OpenAction，/Names 下没有 JavaScript
- 学生屏蔽该企业、被停用或申请删号后，下载返回 404（TM-003）

#### [ ] M4-T10 公益期发点与对账任务
依赖：M4-T06、M0-T11
做：worker 启动已在 M0-T11 完成，本任务只做两个任务：`pilot-monthly-credits`（补足制，`billing.enabled=true` 时跳过；企业认证通过时立即补足一次）和 `reconcile-wallets`（每日；按 SUM(delta) 核对，不一致时调用 `alert('wallet.mismatch', { companyId, expected, actual })`）。
验收：
- 同月重复执行不会多发；余额已超过额度的企业不扣减；billing 开启时不发
- 跑完并发解锁测试后，对账 SQL 返回 0 行

#### [ ] M4-T11 收藏夹
依赖：M4-T05
做：`/e/folders`：文件夹增删改；人才卡片 / 详情页「加入收藏」（先调 `isStudentVisibleToCompany`）；备注；企业内共享。
验收：
- 其他企业无法访问；同一学生在同一文件夹中不重复
- 收藏夹每次打开都重新判断：按 `isStudentVisibleToCompany` 过滤，全名和联系方式按 `canSeeIdentity` 显示（TM-003）

#### [ ] M4-T12 学生端查看记录
依赖：M4-T07
做：`/s/privacy` 的「谁看过我」（90 天内 ProfileView，按企业 + 日期去重）、「谁解锁了我」接入真实数据；学生被解锁时收到通知。
验收：E2E：企业解锁 → 学生在通知和隐私中心都能看到

#### [ ] M4-T13 人才侧防泄漏 E2E（扫描全部网络响应）
依赖：M4-T08
做：`tests/e2e/pii-leak.spec.ts`：用未解锁的企业身份访问搜索页和详情页，用 `page.on('response')` 收集所有 HTML、RSC 和 JSON 响应；断言这些响应里都没有测试学生的全名、手机号、邮箱、WhatsApp、微信、LinkedIn 和 storageKey。职位侧的用例放到 M5-T03。
验收：测试通过并加入 CI；故意让 serializer 漏出 phone 时，测试失败

#### [ ] 🚦 GATE-M4 · 人工审查隐私与扣点（见文末清单）

---

## M5 · 职位、搜索与投递（约 3.7 天）

#### [ ] M5-T01 职位管理
依赖：M3-T06
做：`services/jobs.ts`；`/e/jobs` 列表、新建、编辑、复制、关闭；字段含职位类别；提交时按 `jobs.autoPublishAfter` 规则决定进入 PENDING_REVIEW 还是直接 PUBLISHED（试点期默认 1000，等于全部人工审核）。
验收：
- 未认证企业只能保存草稿；状态流转有集成测试
- 已发布的职位修改标题、描述、要求、福利、薪资或地点后，回到 PENDING_REVIEW，从公开列表和搜索里下线，重新审核通过后才恢复（`approvedJobCount` 未达到 `jobs.autoPublishAfter` 时）；集成测试覆盖（TM-007）

#### [ ] M5-T02 职位审核
依赖：M5-T01
做：`/admin/jobs` 待审队列：通过（PUBLISHED，`approvedJobCount + 1`）/ 驳回（填原因）；审计 `job.review`；通知创建者。
验收：达到阈值后，新职位自动发布

#### [ ] M5-T03 公开职位页（白名单输出、额度锁、noindex）
依赖：M5-T01、M2-T10
做：
- `/jobs` 列表（PRD §2.4 的筛选）：只经 `serializers/job.ts` 的 `toJobListItem()` 输出，不含 description、requirements、benefits；`salaryVisible=false` 时也不含 salaryMin 和 salaryMax。指向职位详情的 Link 设 `prefetch={false}`。
- `/jobs/[id]` 详情：访客要登录；学生走 `openJob`；锁定时只显示标题、公司、州属，以及「邀请同学解锁」按钮。分享链接；浏览量 +1。
- SEO（D15）：`/jobs/[id]` 设 robots index:false，不输出 JobPosting JSON-LD；带 q 参数或筛选条件的 URL 设 noindex,follow；generateMetadata 里不能出现隐藏的薪资。
- `pii-leak.spec` 补职位侧用例：访客打开列表、额度已用完的学生打开锁定职位。
验收：
- 只显示 PUBLISHED 且未过截止日期的职位；E2E：第 21 个职位显示锁定卡片
- 打开 /jobs 等 3 秒，学生额度和 ProfileView 都没有变化
- 访客打开详情页，HTML 里有 noindex，没有 ld+json；隐藏薪资职位的列表页、详情页和 metadata 里都没有金额

#### [ ] M5-T04 投递
依赖：M5-T03、M4-T07
做：`services/applications.ts`：完成度 ≥ `apply.minCompleteness` 才能投递，不够时带到向导里第一个没填完的步骤；选择简历 + 附言（≤ 500 字）；唯一约束；同一事务中按需创建 `TalentUnlock(source=APPLICATION)`；通知职位创建者；学生可以撤回。
验收：重复投递被拒；完成度不足被拒；投递后企业无需扣点即可看到联系方式（集成测试）

#### [ ] M5-T05 企业投递看板与标准化列表
依赖：M5-T04
做：`/e/jobs/[id]/applicants`：按状态分列的看板（移动端为列表）；拖拽改状态 → 写 ApplicationEvent + 通知学生；第一次打开投递自动标记为 VIEWED；内部备注；查看投递者完整资料。新增「标准化列表」视图（PRD §3.4），可按 CGPA、毕业年月、完成度排序。
验收：
- 状态变更都有事件记录；内部备注不会出现在任何学生侧接口中（测试）；标准化列表 10 个人一屏显示完，三种排序都正确
- 投递看板每次都重新判断：全名和联系方式按 `canSeeIdentity` 显示，学生屏蔽该企业或账号不再 ACTIVE 后不再显示（TM-003）

#### [ ] M5-T06 我的投递
依赖：M5-T05
做：`/s/applications`：列表 + 状态时间线；撤回按钮。
验收：时间线与 ApplicationEvent 一致

#### [ ] M5-T07 邀请投递
依赖：M5-T04
做：`services/invitations.ts`：按自然月计算配额（`invitations.freeMonthlyQuota`，M8 起改由套餐决定）；发送（先调 `isStudentVisibleToCompany`）；学生接受（生成投递）/ 婉拒；`expire-invitations` 任务；`/s/invitations`、`/e/invitations`。
验收：
- 超配额被拒；接受后生成投递并关联邀请；过期任务正确执行
- 邀请列表每次都重新判断：按 `isStudentVisibleToCompany` 过滤，全名和联系方式按 `canSeeIdentity` 显示（TM-003）

#### [ ] M5-T08 通知中心与邮件
依赖：M5-T07
做：通知铃铛 + 未读数 + 列表 + 全部已读；按收件人语言渲染中 / 英邮件模板；接入 PRD §6 的全部事件；`employer-daily-digest` 任务。
验收：PRD §6 每一行都有对应测试或 E2E 覆盖

#### [ ] M5-T09 职位搜索 service（精确 / 关联）
依赖：M5-T03
做：`services/job-search.ts`：`searchJobs({ q, mode, filters, page })`，实现 ARCHITECTURE §5.4；ILIKE 输入先转义反斜杠、`%` 和 `_`；默认模式和回退阈值读 `search.*`。
验收：与原型 C2 的测试用例一致（同一职位只出现一次、精确在前、不区分大小写、"Finance" 能搜到「财务」组）；pg_trgm 索引生效（EXPLAIN 里能看到 Bitmap Index Scan）；查看者打不开的职位，不能靠描述里的词被搜出来（对应原型测试 `locked jobs are not matched by their description`）；按薪资排序时隐藏薪资的职位排在最后

#### [ ] M5-T10 扩展筛选
依赖：M5-T09
做：两级行业（选大类包含全部子类）、公司定位标签（任一命中）、公司规模、薪资档（`jobs.salaryBands`）。
验收：与原型 C3 的测试用例一致；选了薪资档时隐藏薪资的职位不出现，也不能借筛选反推出它的薪资

---

## M6 · 运营后台（约 2.8 天）

#### [ ] M6-T01 后台布局与数据看板
依赖：M5-T08
做：`/admin` 布局 + 侧边导航；看板：PRD §4 的各项指标（总数 + 按周趋势图），含注册人数 / 上限进度。
验收：数字与数据库直接查询结果一致（集成测试）

#### [ ] M6-T02 学生管理
依赖：M6-T01
做：
- 搜索、详情（运营可见全部字段，查看联系方式要写审计）、人工学校认证（学生上传学生证 → 运营审核）、给学生加查看额度（ADMIN_GRANT，必须写原因）。
- 停用 / 恢复（`services/admin-users.ts`）：在同一个事务里把 User.status 设为 SUSPENDED、执行 `session.deleteMany`、写审计 `user.suspend` 和 `auth.session.revoke`。
验收：
- 停用后学生立刻无法登录，并从人才库消失
- E2E 用两个浏览器上下文：运营停用学生后，这名学生的下一次请求就被重定向到登录页

#### [ ] M6-T03 企业管理
依赖：M6-T01
做：列表、详情、停用、标记创始合作伙伴、设置公司定位标签、调整点数（调用 `credits.adminAdjust`）。`requireCompanyMember` 每次请求都检查 Company.isActive。
验收：停用企业的成员下一次请求就无法访问企业端

#### [ ] M6-T04 学校与合作伙伴
依赖：M6-T01
做：学校增删改（邮箱后缀管理）；合作伙伴增删改（Logo 上传、排序、首页显示开关）。
验收：首页合作伙伴墙随后台配置变化

#### [ ] M6-T05 系统设置
依赖：M6-T01
做：`/admin/settings`：按 PRD §5 的 key 渲染表单，按类型校验；保存时写审计 `setting.update`。
验收：修改后 60 秒内生效；非法值被拒

#### [ ] M6-T06 审计日志
依赖：M6-T01
做：`/admin/audit`：按动作、操作人、对象、时间范围筛选；分页。
验收：能查到 ARCHITECTURE §5.7 列出的所有动作

#### [ ] M6-T07 代管企业与公司名单导入
依赖：M3-T03、M3-T04、M5-T01
做：
- `services/managed-company.ts`：`createManagedCompany`、`postJobAsPlatform`、`transferCompany(companyId, ownerEmail)`。transferCompany 复用 M3-T04 的邀请机制；移交完成时，在同一个事务里删除平台账号的 CompanyMember，并设 `isManaged=false`。
- 新增 `scripts/import-companies.ts <path> [--dry-run]`：用 zod 校验输入，调用 `createManagedCompany` 导入；日志只输出条数和出错的行号。
- 真实名单放在仓库之外，由用户本人在服务器上通过 tools 服务运行导入；AI 只用 `companies.example.json` 测试。
验收：
- 移交后 `isManaged=false`，平台账号再以该企业身份操作会被拒；代发的职位跳过审核；每一步都有审计（`company.managed.create` / `.post` / `.transfer`）
- 对 companies.example.json 执行 `--dry-run`，输出「2 条有效，0 条错误」，并且不打印任何字段值
- `transferCompany` 必须带核实记录（目标邮箱的域名和企业官网一致，或经公开电话回拨确认，写明是哪一种），缺少时返回 ValidationError；核实记录写进 `company.managed.transfer` 审计的 metadata（TM-008）

#### [ ] M6-T08 增长与风控页（P1，可在试点后做）
依赖：M6-T01
做：注册数和上限进度、邀请记录（可作废）、举报队列、同义词表、反诈内容。
验收：作废邀请后，邀请人的额度立刻重算；处理举报写审计 `job.report.resolve`

---

## M7 · 上线准备（约 5.3 天，另有人工 1.25 天）

#### [ ] M7-T01 首页与介绍页
依赖：M6-T04
做：首页（中 / 英）：面向在马留学生的价值主张（学生免费，查看详情有额度，邀请可解锁）、企业价值主张、合作伙伴墙、最新职位、数据亮点；`/for-employers`（含公益期说明）；`/partners`。产品名只写 FindMYJob。
验收：Lighthouse 移动端性能 ≥ 85、可访问性 ≥ 90

#### [ ] M7-T02 法律页面
依赖：M0-T05
做：`/legal/privacy`、`/legal/terms`（中 / 英模板，页首标注「草案，待律师审阅」；隐私政策披露 SUBPROCESSORS 里的子处理者和跨境传输）；`legal.currentVersion` 变化后，用户下次登录须重新同意。
验收：版本升级后，旧用户登录被引导到重新同意页

#### [ ] M7-T03 数据权利
依赖：M6-T01
做：
- `services/data-rights.ts`：导出（worker 生成 zip）。邮件里只放站内链接 `/[locale]/s/privacy/exports/[id]`；用户登录后，服务端确认是本人且未满 24 小时，再现场签一个 300 秒的 GET。
- 删除申请（软删除，立即从人才库移除）；`purge-deleted-accounts` 按「status=DELETED、超过 30 天、仍有 PII」这个条件选人，可以重复执行；删除对象时用 ListObjectVersions 加 DeleteObjects 删掉全部版本，只有应用用户有 DeleteObjectVersion 权限；匿名化档案。
- 后台处理 DataRequest。
验收：
- 导出包内容完整；导出邮件里没有对象存储的域名
- purge 跑完后，该学生的 StudentContact、ResumeFile 记录和对象的所有版本都被清除；以 findmyjob_app 身份运行不报 42501（集成测试）
- purge 跑完后，用该学生的哨兵值（`哨兵测试同学甲`、`+60 12-000 0420`、`leak-sentinel@example.test`）查 User（name、email）、StudentProfile、Education、Experience、Application（coverNote、companyNote）、ApplicationEvent.note、TalentFolderItem.note、Invitation.message、Notification.payload，以及对象存储里该用户的 `exports/` 前缀，都查不到；CreditLedger 和 AuditLog 只剩内部 ID（AuditLog.ip 按 D22）（TM-029）

#### [ ] M7-T04 可观测性：Sentry 与健康检查
依赖：M0-T08
做：
- `@sentry/nextjs` 锁精确版本。在 `instrumentation.ts` 的 register() 和 onRequestError，以及 `instrumentation-client.ts` 里初始化；worker 用 `@sentry/node`。不运行 `npx @sentry/wizard`。
- 三处初始化共用 `src/lib/sentry-options.ts`：sendDefaultPii:false，tracesSampleRate:0，不启用 Replay，release 设为 APP_TAG，beforeSend 用 scrubEvent。scrubEvent 删除 cookies、data、query_string 以及除 user-agent 以外的所有 header；URL 换成路由模板；去掉 user 字段；message 再过一遍 redact。
- `alert()` 增加转发到 Sentry。`/api/health` 执行 SELECT 1，2 秒超时，返回 `{status, version}`，带 no-store。
- 只做 Sentry、pino 和 /api/health，不引入 OTel 或 Prometheus。
验收：
- 人为抛错能在 Sentry 里看到（用测试 DSN 或 mock 验证）
- 单测：scrubEvent 处理后的输出里，cookie、`?token=abc` 和两个哨兵值都不存在
- 停掉数据库后 /api/health 返回 503；CI 跑完 E2E 后，在应用日志里 grep 不到哨兵值

#### [ ] M7-T05 安全响应头与复查
依赖：M7-T03
做：
- `deploy/Caddyfile` 的 header 写 `Strict-Transport-Security max-age={$HSTS_MAX_AGE:300}`（不设变量时默认 300），不加 includeSubDomains 和 preload；再加 `X-Content-Type-Options nosniff`、`Referrer-Policy strict-origin-when-cross-origin`、`X-Frame-Options DENY`。
- next.config 设 `poweredByHeader:false`；加一条不带 nonce 的 `Content-Security-Policy-Report-Only`，用来收集违规。
- `/s`、`/e`、`/admin`、认证页和 `/api` 加 `X-Robots-Tag: noindex, nofollow`，并确认 Cache-Control 含 no-store。
- 复查所有限流；`pnpm audit`；补齐越权测试：每个企业侧 service 都要有「其他企业访问被拒」的用例（authz-matrix）。
验收：
- `tests/e2e/security-headers.spec.ts` 在 `pnpm build && pnpm start`、`APP_ENV=ci` 的环境下通过
- 学生页和企业页的响应都带 noindex 和 no-store
- 越权测试清单全部通过；`pnpm audit` 没有 high 及以上漏洞

#### [ ] M7-T06 镜像、生产 Compose 与 RUNBOOK
依赖：M7-T04
做：按 shipping-and-launch 检查清单加上本项目的补充项做。
- 部署相关文件统一放在 `deploy/` 下。`deploy/Dockerfile` 用精确 tag 的 `node:24.x-bookworm-slim`，builder 和 runtime 两个阶段；用 standalone 输出，COPY 时加 `--chown`；设 `HOSTNAME=0.0.0.0`，最后一行 `USER node`。另外两个 target：migrate 带 prisma CLI；tools 带 tsx、scripts、src、prisma，运行时用 `--conditions=react-server`，这个镜像不对外推送。秘密不进 ARG、ENV、COPY。
- `deploy/docker-compose.prod.yml`：只有 caddy 发布 80、443 和 443/udp；backend 网络设 internal，只放 postgres；app 和 worker 同时接入 backend 和一个普通出站网络（要访问 Turnstile、Resend、Sentry、对象存储和 healthchecks）；app 和 worker 设 `cap_drop: ALL` 和 `no-new-privileges`；环境变量文件按服务拆成 `/opt/findmyjob/env/app.env`、`db.env`、`migrate.env`、`backup.env`；migrate、tools、backup 三个服务放在 profiles `ops` 下；镜像 tag 用 `${APP_TAG}`。
- 内存上限：app 1g，worker 512m，postgres 1g，caddy 128m。日志用 json-file，10m×5。healthcheck 用 node fetch 请求 `/api/health`（slim 镜像里没有 curl）。
- `deploy/Caddyfile`：`reverse_proxy app:3000`，`header_up X-Real-IP {remote_host}`，`request_body max_size 11MB`；caddy 的 data 和 config 用命名卷。
- `docs/RUNBOOK.md` 填写部署、回滚、轮换密钥各节（骨架已在仓库里）。
验收：
- 本地用 prod compose 能完整跑起来
- 用 `docker compose config` 解析后，只有 caddy 有 ports；`docker compose run --rm app id -u` 输出 1000
- `docker run --rm --entrypoint sh <镜像> -c 'ls -a /app'` 里看不到 .env、docs、tests、.git、prototype

#### [ ] M7-T07 全流程 E2E 冒烟
依赖：M7-T01
做：一条 E2E 串起全部流程：学生注册 → 4 步资料 → 认证学校 → 开启人才库 → 邀请同学；企业注册 → 提交认证 → 运营通过 → 搜人 → 解锁 → 学生收到通知；企业发职位 → 审核 → 学生搜索、打开详情（扣额度）→ 投递 → 看板推进到 OFFER。
验收：CI 中稳定通过（连续 3 次）

#### [ ] M7-T08 PWA 与移动端走查
依赖：M7-T01
做：manifest、图标、离线页；在 375px 宽度下逐页检查学生端，修复布局问题；可点击区域不小于 24×24px。
验收：手机可「添加到主屏幕」；学生端所有页面在 375px 宽度下无横向滚动

#### [ ] M7-T09 反诈专区与职位举报（P1，可在试点后做）
依赖：M7-T01
做：`/safety` 反诈专区页（内容来自 Article）；职位详情页「举报」按钮，按用户限流每天 `limits.jobReportsPerDay` 次；`services/reports.ts`、`services/articles.ts`。
验收：举报出现在运营队列里；处理时写审计 `job.report.resolve`；第 11 次举报被拒

#### [ ] M7-T10 k6 压测脚本（browse+search 和 smoke）
依赖：M7-T06
做：
- `load/k6/browse-search.js`：ramping-vus 爬到 E2 人数的 1.2 倍，场景包括职位列表、EXACT 和 RELATED 两种搜索、人才库搜索（用 seed-load 预先生成的会话 cookie，不走登录）。
- `load/k6/smoke.js`：1 个虚拟用户跑 1 分钟，只访问公开页和 /api/health；这是唯一允许对生产跑的脚本。
- `prisma/seed-load.ts`：只有 `APP_ENV=staging` 时才运行；生成合成账号和会话，写入 `load/accounts.local.json`（已加入 .gitignore）。
- 用 grafana/k6 的精确 tag 镜像运行；在 Git Bash 里挂载路径写 `$(pwd -W)/load`。执行和记录在 M7-H02。
验收：
- seed-load.ts 在非 staging 环境下退出码不为 0
- 阈值写在脚本里：p(95) 小于 800ms，http_req_failed 小于 1%

> M7-T12 排在 M7-T11 前面：部署脚本在迁移前要调用备份脚本。

#### [ ] M7-T12 age 加密的异地备份、死信监控与恢复演练脚本
依赖：M7-T06
做：
- 新增 `deploy/server/findmyjob-backup`，开头 `set -euo pipefail`。流程：`pg_dump -Fc --exclude-schema=pgboss`，管道给 `age -r <公钥>`，输出到容器里挂载的普通磁盘目录（例如 /backup-tmp）中的临时密文；不用 /dev/shm（Docker 默认只给 64MB）；检查退出码后，只做一次 PutObject，上传到 `db/daily/<UTC时间>.dump.age` 或 `db/pre-migrate/`；成功后 curl healthchecks 的 ping 地址。全程不在磁盘上留明文。
- 主机 cron 按 UTC 写：每天 19:15 UTC（吉隆坡 03:15）运行 `docker compose --profile ops run --rm backup`。同时生成 counts.json，记录关键表的行数。
- 备份桶放在马来西亚区域，开启版本控制，设 30 天生命周期。应用桶也开版本控制，非当前版本 30 天后过期。IAM 按 M7-H01 的表配置。
- 新增 `scripts/db/restore-drill.sh <db_name>`：库名必须以 `_drill` 结尾；私钥通过 ssh 的 stdin 传进来，用 trap 在退出时删除；恢复前先执行 db-setup.sql。恢复后检查：迁移数一致、关键表不为空、RPO 不超过 26 小时、对账 SQL 返回 0 行、和 counts.json 的行数一致、用离线 PII_KEYS 通过 tools 服务解密 1 条记录（`scripts/db/verify-decrypt.ts`）；最后清空 Session，打印 RTO。
- RUNBOOK 写备份、恢复演练、真实恢复三节，并注明：恢复之后要补跑一次 purge-deleted-accounts。
验收：
- 手动跑一次备份：db/daily/ 下出现新对象，文件前 21 个字节是 `age-encryption.org/v1`，healthchecks 显示绿色
- 把口令故意改错再跑：脚本以非 0 退出，healthchecks 收不到 ping，也没有生成新对象；restore-drill.sh 对名为 findmyjob 的库直接拒绝

#### [ ] M7-T11 部署流水线：人工 SSH 执行 findmyjob-deploy
依赖：M7-T06、M7-T12
做：按 shipping-and-launch 检查清单加上本项目的补充项做。
- ci.yml 加一个 image job：只在 push 到 main 时运行，needs verify 和 e2e，job 级权限 `packages: write`；推送 `ghcr.io/fairchan/findmyjob:<sha>` 和 `findmyjob-migrate:<sha>`，不推 latest。
- 新增 `deploy/server/findmyjob-deploy`，安装到 `/opt/findmyjob/bin/`。用法是 `deploy <40位sha> [--approve-migrations]` 或 `rollback`，sha 用正则校验。执行顺序：pull；把 `_prisma_migrations` 和镜像里的迁移比对，有待执行迁移但没加批准参数时，打印 SQL 后 exit 3；先做一次 pre-migrate 备份（M7-T12 的 findmyjob-backup）；用 ops 跑 migrate；`APP_TAG=<sha> up -d app worker`；等 60 秒健康检查；成功就把 sha 和 digest 追加到 deploy-history.log，失败就回到上一个 tag 并 exit 1；迁移不回滚。
- 技术负责人执行：`ssh <admin>@<host> sudo -u deploy /opt/findmyjob/bin/findmyjob-deploy deploy <sha>`。GitHub 不持有部署私钥。
- `/opt/findmyjob/.env` 里只放 APP_TAG，不放秘密。RUNBOOK 写明部署、回滚，以及迁移失败（P3009、INVALID 索引）怎么处理。
验收：
- 本地用 prod compose 演练：部署 A、部署 B、再 rollback，每一步都不超过 2 分钟，deploy-history.log 里有 3 条记录
- 用一个健康检查返回 500 的镜像部署，脚本会自动回到上一个 tag 并以 exit 1 结束；有待执行迁移但没加批准参数时，在迁移之前就停下

#### [ ] M7-T13 事故与 PDPA 泄露处置手册、每周例行检查
依赖：M7-T06
做：按 shipping-and-launch 检查清单加上本项目的补充项做。
- RUNBOOK 增加「事故响应」：SEV 分级、角色、联系表（核实后再填，不编造号码）；五个止血场景：企业看到了不该看的数据、凭据泄露、账本不一致、整站不可用、备份失败。
- 只读 SQL 模板：按时间窗统计 AuditLog 里的 talent.view、talent.unlock、resume.download，只输出 ID 和数量。
- PDPA 通报：向专员 72 小时内、向受影响者 7 天内（这两个时限待律师核实）。新建 `docs/templates/breach-notice-zh.md` 和 `breach-notice-en.md`，只放占位内容。
- 隐私守则：事故处理时不把真实数据、完整的 AuditLog 行、.env 贴进 Claude 会话。
- 完善 RUNBOOK 里已预留的「每周一 30 分钟例行检查」清单。
验收：RUNBOOK 里包含以上各节；`docs/incidents/TEMPLATE.md` 已存在

#### [ ] M7-H01 云主机初始化、IAM、发信域、uptime 和 healthchecks（人工）
依赖：M7-T06
做：
- 云安全组入站只开 TCP 22、80、443 和 UDP 443。系统用 Ubuntu 24.04；每个管理员用自己的 ed25519 密钥；另建 deploy 用户。新建 `/etc/ssh/sshd_config.d/00-findmyjob-hardening.conf`（模板 `deploy/server/00-findmyjob-hardening.conf`），写 PasswordAuthentication no、KbdInteractiveAuthentication no、PermitRootLogin no、AllowUsers、MaxAuthTries 3。
- 执行 `ufw default deny incoming`，再放行 OpenSSH、80、443；配置 unattended-upgrades，自动重启时间设为 21:30（主机是 UTC，对应吉隆坡 05:30）；加 2G swap 并写入 /etc/fstab；`/etc/docker/daemon.json`（模板 `deploy/server/daemon.json`）设日志轮转，并开启 live-restore。
- `/opt/findmyjob/env/*.env` 先用 `install -m 600 -o deploy` 建空文件，再从密码管理器把值复制进去。PII_KEYS 和 BETTER_AUTH_SECRET 存两个人的密码管理器；age 私钥只做两份离线介质，不放进密码管理器，也不放到 VM 上。
- IAM：app 用户只能访问 `findmyjob-files/*`（包括 DeleteObjectVersion）；backup-writer 对 `db/*` 只能 PutObject；restore-reader 只读，平时离线保存，演练时临时注入。VM 拉 GHCR 用的 PAT 只给 read:packages，RUNBOOK 写明 90 天轮换。
- Resend 配好 SPF、DKIM，DMARC 设 p=none 并配 rua。注册 UptimeRobot 监控 /api/health，注册 healthchecks.io 监控备份，告警都发给 2 个人。
验收：
- 在 Windows 上执行 Test-NetConnection，5432 和 3000 端口的结果是 False，22、80、443 是 True；`sudo sshd -T` 里那三项都是 no
- Gmail、Outlook、QQ、163 邮箱和试点学校邮箱都能在 2 分钟内收到验证码，并且在收件箱里；邮件头显示 spf=pass、dkim=pass

#### [ ] M7-H02 k6 压测、三项演练和真机走查（人工）
依赖：M7-T10、M7-T11、M7-T12、M7-T13、M7-H01
做：
- GATE-M7 之前，生产主机就是 staging（A22）。在上面跑 browse-search.js，把结果、机器规格和镜像 tag 写进 `docs/CAPACITY.md`。
- 运维备份人独立完成两件事：按顺序部署 A、部署 B、再回滚；用 restore-drill.sh 做一次恢复，记录 RPO 和 RTO。
- 做一次 45 分钟的事故桌面演练，场景是企业 A 在未解锁时看到了学生 B 的手机号，记录止血用了多久。
- 真机走一遍流程：iPhone Safari、Android Chrome、微信内置浏览器各一次，走完后删除测试账号。
验收：CAPACITY.md 里有本阶段的记录；`docs/incidents/` 里有演练记录，并写明执行人

#### [ ] 🚦 GATE-M7 · 上线闸门（见文末清单）

> 以下是 P1 任务，GATE-M7 之后按各自的时点做（`AUTO_BUILD_SKIP_P1=1` 时跳过）。

#### [ ] M1-T07 架构测试：越权注册表全覆盖（P1，M7 之后）
依赖：M1-T03
做：新增 `tests/architecture/server-boundary.test.ts`：用 TS 编译器 API 扫描所有 `use server` 文件和 route.ts 的导出；`action()` 和 `route()` 的注册表与越权矩阵逐项对比。
验收：故意加一个没有包装的 export，测试失败

#### [ ] M6-T09 运营账号强制 2FA，敏感操作要求新鲜会话（P1，E3 之前必须完成）
依赖：M6-T02
做：
- 启用 Better Auth 的 twoFactor 插件。requireAdmin 检查 2FA，没开就跳转到设置页。试点期间先用密码管理器生成的独立强密码作为补偿控制。
- 查看联系方式、调整点数、确认订单这些操作，要求 10 分钟内的新鲜会话；ADMIN 会话最长 12 小时（实现方式待核实）。
验收：没开 2FA 的 ADMIN 访问 /admin，被引导去设置 2FA；连续输错 TOTP 5 次后被限流

#### [ ] M7-T14 止血开关、PostgreSQL 限流桶、任务心跳、邮件日上限（P1，E2 之前）
依赖：M7-T04、M0-T11
做：
- 新增 `unlock.enabled`、`talentPool.searchEnabled`、`uploads.enabled` 三个开关，用 getSetting 读取，关闭时抛 FeatureDisabledError。
- schema 新增 RateLimitBucket 表（Timestamptz、外键索引照约定），`hit()` 用 INSERT ON CONFLICT 实现，取代内存版；另加 `prune-rate-limit` 任务定期清理。
- 每个定时任务执行成功后，curl 它自己的 healthchecks 地址。
- 新增 `email.dailyCap`：达到上限后暂停非关键邮件，并通知运营。
验收：
- `unlock.enabled=false` 时，解锁抛出 FeatureDisabledError，CreditLedger 没有新增记录
- 用新的 Prisma client 发起第 6 次 hit，仍然被拒

#### [ ] M7-T15 CSP 改为 nonce 强制模式，HSTS 改为一年（P1，E3 之前）
依赖：M7-T05
做：
- middleware 为每个请求生成 nonce；script-src 写 self、nonce 和 strict-dynamic，再加 challenges.cloudflare.com；frame-src 只放 Turnstile；生产环境不允许 unsafe-eval。
- HSTS_MAX_AGE 改为 31536000；确认所有子域都已经是 https 之后，再加 includeSubDomains。
验收：强制模式下，375px 和 1280px 两种宽度走完「注册 → 上传」，控制台没有 CSP 报错；每次请求的 nonce 都不同

#### [ ] M7-T16 CI 扩展扫描（P1，M7 之后）
依赖：M7-T06
做：
- semgrep 用 registry 规则集做 PR 扫描，加 `--metrics=off` 和 `--error`。
- pnpm-lock.yaml 有变化时跑 osv-scanner（`osv-scanner.toml`）。
- 对 .github 跑 actionlint 和 zizmor。
- 对镜像跑 Trivy（HIGH 和 CRITICAL，`--ignore-unfixed`，`.trivyignore`），对 Dockerfile 跑 hadolint；所有豁免都要写到期日，并记进 DECISIONS。
验收：各 job 都通过，豁免文件里没有已过期的条目

#### [ ] M7-T17 质量包：a11y 全覆盖、锁版本 Lighthouse、SEO 元数据、Logo 缓存（P1，E2 之前）
依赖：M7-T01
做：用 accessibility、core-web-vitals、seo、web-quality-audit 这几个技能。
- `tests/e2e/a11y.spec.ts` 覆盖学生端、公开页和企业端的全部页面；moderate 及以下的问题记到 `docs/A11Y.md`。
- 把 lighthouse 锁精确版本加为 devDependency，配 `pnpm lh`（`scripts/lighthouse.mjs`）；阈值：performance ≥85、accessibility ≥90、LCP ≤2500ms、CLS ≤0.1、TBT ≤300ms。只在合成数据环境测。
- generateMetadata、`src/app/sitemap.ts` 只收录已认证的企业；hreflang 写 zh-Hans、en、x-default；分页页面的 canonical 指向自身。
- Logo 走 `/api/logos/[companyId]`，设 public 长缓存。
验收：4 个公开页都达到阈值；sitemap 里没有 /s、/e、/admin

#### [ ] M7-T18 k6 全场景与 5000 名学生的压测数据（P1，E4 之前）
依赖：M7-T10
做：新增 `load/k6/unlock.js`（10 个 VU 抢余额 3，以及 10 个 VU 解锁同一学生）、`upload.js`、`apply.js`；seed-load 扩到 5000 名学生、100 家企业、500 个职位。
验收：跑完后用 SQL 核对：成功的解锁数等于 UNLOCK 账本条数，余额 ≥0

> —— 公益试点运行约 3 个月：修 bug、按反馈迭代、同时做 M8。每次放量（E2 内测 200 人 → E3 本校公开 500 人 → E4 扩大 3000 人）之前按 E5 的 go/no-go 判断，记录写进 `docs/CAPACITY.md` ——

---

## M8 · 商业化（约 2 天）

#### [ ] M8-T01 套餐与定价页
依赖：GATE-M7
做：后台 Plan 增删改；seed 写入 business/01 §5.3 的占位套餐；`/pricing`（`billing.enabled=false` 时显示「公益期免费」）。
验收：定价页内容随后台配置变化

#### [ ] M8-T02 订单与银行转账
依赖：M8-T01
做：`services/billing.ts`：创建订单（orderNo 格式 `FMJ-YYYYMMDD-XXXX`）→ 显示收款信息 → 企业上传回单（经 `/api/uploads/PAYMENT_PROOF`，AWAITING_CONFIRMATION）→ 运营确认 → 同一事务内：订单 PAID + 发点（PURCHASE / PLAN_GRANT）+ 开通或续期订阅；审计 `order.confirm`。
验收：重复确认不会重复发点；只有 OWNER 能下单

#### [ ] M8-T03 在线支付
依赖：M8-T02
做：`PaymentProvider` 接口；Stripe Checkout 实现（卡 + FPX）；webhook 验签 + 按 externalRef 幂等；用测试模式密钥验证。
验收：同一个 webhook 重放多次只入账一次；验签失败返回 400

#### [ ] M8-T04 套餐权益执行
依赖：M8-T02
做：职位数、席位数、邀请配额按当前有效订阅计算（没有订阅 = 免费版）；`expire-subscriptions` 任务；到期前 7 天提醒。
验收：超过限额时给出升级引导；到期后自动降为免费版

#### [ ] M8-T05 发票
依赖：M8-T02
做：PDF 发票（公司抬头、SST 字段预留、MyInvois 字段预留）；企业在账单页下载。
验收：发票号唯一且连续；金额与订单一致

#### [ ] M8-T06 转收费切换
依赖：M8-T04
做：`billing.enabled=true` 时：停止公益发点；余额不足时引导购买；创始合作伙伴折扣（记录在 Order.discountSen）。写一份切换演练测试（false → true）。
验收：切换后现有余额保留；所有付费入口正常工作

#### [ ] 🚦 GATE-M8 · 开启收费前（见文末清单）

---

## M9 · AI 增强（约 2 天）

#### [ ] M9-T01 简历解析
依赖：M2-T05
做：上传 PDF → worker 提取文本 → 调用 Claude API，输出符合 zod schema 的结构化 JSON（模型 ID 读 `AI_MODEL_PARSE`）→ 预填档案，学生确认后才保存。
验收：解析失败不影响上传；未经学生确认不写入档案

#### [ ] M9-T02 JD 助手
依赖：M5-T01
做：企业输入岗位要点 → 生成中英双语职位描述（可编辑后发布）。
验收：生成内容进入编辑框，不会直接发布

#### [ ] M9-T03 语义匹配
依赖：M4-T03
做：启用 pgvector；为档案和职位生成 embedding（embedding 服务需另选，例如 Voyage AI，写入 DECISIONS）；企业职位页「推荐人才」、学生端「推荐职位」。
验收：推荐结果同样遵守人才库排除规则（`isStudentVisibleToCompany`）

#### [ ] M9-T04 周报邮件
依赖：M9-T03
做：学生每周推荐职位邮件；企业每周人才库简报。可退订（MARKETING Consent）。
验收：退订后不再发送

> 注意：AI 输出同样要经过 redact；把用户数据发给 AI 服务之前，要在隐私政策中披露（更新 `legal.currentVersion`），并加进 SUBPROCESSORS。

---

## M10 · 扩展（按需）
- [ ] M10-T01 多校扩张：学校自助申请；学校就业中心账号（查看本校数据报告）
- [ ] M10-T02 校园活动：宣讲会 / 招聘会发布、报名、签到二维码、现场扫码建档
- [ ] M10-T03 马来文界面
- [ ] M10-T04 WhatsApp 通知（WhatsApp Business Platform）
- [ ] M10-T05 Meilisearch 搜索
- [ ] M10-T06 雇主品牌页、职位置顶
- [ ] M10-T07 地图（P2）：企业在地图上选位置（Leaflet + OpenStreetMap）；学生按地标 / 商圈 / 地铁站 + 半径筛选。依赖 M5-T10；验收：半径筛选与原型的 `distanceKm` 用例一致

---

## 闸门检查清单

> AI 扫描的顺序、范围和花费记录方法见 `docs/AI-SKILLS.md`；扫描都在干净的 worktree 里由人交互运行，报告写到 `.reports/`。

### M0 合并前（人工）
- [x] verify、e2e、guard、gitleaks 全绿；第一个 Dependabot PR 不需要 secrets 也能跑绿
  > 2026-11-05 总控：本机 e2e 6/6、guard（迁移未改、无敏感文件、`pnpm audit --prod` 0 条）、gitleaks 全历史 0 条（先修了误报，见 M0-T09）；verify 由 autopilot 合并前跑。Dependabot 这条不适用：用户选了只在本机合并、暂不建 GitHub 仓库，建仓后补验
- [x] 用 supply-chain-risk-auditor 先跑 collect.py 再跑 render.py，读完 report.md 把结论记进 DECISIONS
  > 2026-11-05 总控：已记进 DECISIONS「开发中决策」和「已接受风险」
- [x] `git diff` 过一遍 package.json，新增的直接依赖都已在 DECISIONS 登记
  > 2026-11-05 总控：补登记了 14 个脚手架配套包

### 🚦 GATE-M4 · 隐私与扣点（人工逐项测试）
- [ ] `pnpm lint`、`typecheck`、`test`、`test:e2e` 全部通过，其中包含 pii-leak（人才侧）和 authz-matrix
- [ ] v1 原有的 7 项逐项人工测一遍：
  - [ ] 用未解锁的企业账号浏览人才库和详情页，打开浏览器 Network 面板，确认所有响应中都没有手机、邮箱、全名、简历 URL
  - [ ] 在学生经历描述里写手机号、邮箱、微信号，确认企业侧显示为「[已隐藏]」
  - [ ] 余额 1 点时快速连点两次解锁：只扣 1 点、只成功 1 次
  - [ ] 学生屏蔽企业后：企业搜不到；即使之前已解锁，也看不到联系方式
  - [ ] 学生关闭人才库后，立即从搜索结果中消失
  - [ ] 下载的简历每页都有水印
  - [ ] 审计日志里能查到以上每一步操作
- [ ] 直接 POST `/api/auth/sign-up/email`，不带 token 和名额已满这两种请求被拒；带 role ADMIN 的请求可以建号，但建出的账号必须是 STUDENT
- [ ] 被移除的企业成员下一次操作被拒；邀请链接换账号打开被拒，同一链接第二次使用也被拒
- [ ] 直接 POST 6MB 的 PDF、改名成 .pdf 的 .exe、30 页的 PDF、加密的 PDF，全部被拒，桶里也没有留下对象
- [ ] 同一家企业的两个成员合计查看人数超过 `limits.companyProfileViewsPerDay` 后被拒；请求 page=26 被拒；在人才列表停 3 秒，ProfileView 数量不变
- [ ] 以 findmyjob_app 身份 UPDATE CreditLedger 报 permission denied；跑完并发解锁后，按 SUM(delta) 对账返回 0 行；整个走查过程中，pino 日志里搜不到哨兵 PII
- [ ] AI 扫描：`/differential-review:diff-review m0-done..milestone/M4`，限定路径为 authz、crypto、storage、contact-access、credits、unlock、talent-search、talent-card、uploads，并附上 FindMYJob 检查表；基线用 `git show` 读取，报告写到 `.reports/<日期>-gate-m4/`；High 全部修复或写进已接受风险；花费记进 `.reports/COSTS.tsv`

### 🚦 GATE-M7 · 上线
- [ ] 要发布的 sha 在 CI 上全绿；gitleaks 扫全部历史结果为 0；`pnpm audit --prod` 没有 high；运行 shipping-and-launch 检查清单；supply-chain-risk-auditor 再复核一次
- [ ] 律师书面确认以下事项：D10（隐私政策、用户协议）、D11（就业中介牌照）、SUBPROCESSORS 的跨境传输、泄露通报时限和是否需要 DPO、备份里已删数据保留期限的写法、D22
- [ ] 运营主体已确定（D3）；域名已购买（D2 的商标和域名已查）
- [ ] Test-NetConnection 测 5432 和 3000 返回 False，测 22、80、443 返回 True；`sshd -T` 里那三项都是 no；unattended-upgrades 已启用；swap 为 2G；`/opt/findmyjob/env/*.env` 权限 600、属主 deploy；VM 上找不到 AGE-SECRET-KEY；app 的 `id -u` 是 1000
- [ ] 回滚演练由运维备份人独立完成：部署 A、部署 B、回滚，每一步都在 2 分钟内；有待执行迁移但没加 `--approve-migrations` 时，脚本在迁移前停下
- [ ] 恢复演练：restore-drill.sh 的检查全部通过，实测 RTO ≤4 小时并已记录；healthchecks 显示绿色；备份文件前 21 字节是 `age-encryption.org/v1`；两个桶都开了版本控制
- [ ] 伪造 X-Real-IP 或 X-Forwarded-For 后，仍按真实 IP 计数，第 6 次返回 429；AuditLog.ip 记录的是真实来源；停用一个已登录的学生后，他的下一次请求回到登录页；企业成员看其他企业的职位详情只显示锁定卡片；学校 OTP 第 6 次发送返回 429
- [ ] 用 `curl -sI` 检查：HSTS max-age=300、nosniff、X-Frame-Options DENY、Referrer-Policy、Report-Only CSP 都在；私有页带 noindex 和 no-store；`APP_ENV=production` 时，用测试 Turnstile secret 或 http 的 BETTER_AUTH_URL 都无法启动
- [ ] Sentry：人为抛错产生的事件 JSON 里，没有邮箱、手机号、cookie 和 token；没有开 Replay；数据区域和 D14 一致；告警能送到 2 个人
- [ ] 停掉 app 容器，10 分钟内两个人都收到 uptime 告警；日志轮转和 mem_limit 都已生效；k6 跑完后 dmesg 里没有 oom
- [ ] k6 的 browse-search 达到阈值（p95 < 800ms，错误率 < 1%），结果记进 CAPACITY.md（M7-T10、M7-H02）；上线后 smoke.js 跑通
- [ ] SPF 和 DKIM 都是 pass，5 类邮箱都进了收件箱；用 iPhone Safari、Android Chrome、微信内置浏览器各走一遍完整流程（替代「生产环境 E2E 冒烟」），之后把测试账号删掉
- [ ] 事故桌面演练已完成，止血用时有记录；PII_KEYS 和 age 私钥分开存放，各有两人离线持有；GitHub Secrets 里没有任何应用密钥
- [ ] AI 扫描：在交互会话里运行 security-best-practices，范围限定为 src/server、src/app/api、next.config.*、src/proxy.ts 或 middleware.ts、src/env.ts；只报告 .env 有没有被 git 跟踪，不读它的内容；报告写到 `.reports/`；High 全部修复或写进已接受风险；花费记进 COSTS.tsv
- [ ] 种子数据：试点学校的邮箱后缀已确认；合作伙伴 Logo 已上传；反诈页里的电话已核实
- [ ] 清空 staging 数据库，去掉 basic_auth，改为 `APP_ENV=production`；种子管理员改了密码；Turnstile 换成正式 key；`signup.studentCap` 设为 E2 的人数

### 🚦 GATE-M8 · 开启收费
- [ ] 价格已由双方确认（D8）
- [ ] 支付密钥从测试模式切到正式模式；webhook 地址已配置
- [ ] 公司银行账户信息正确
- [ ] 财务对账流程：每月导出订单 + 点数账本，与银行流水核对
- [ ] 已提前 2 周通知公益期企业，并发出创始合作伙伴优惠
- [ ] E7：RPO ≤1 小时已上线，并做过一次演练；用备份凭据删对象返回 AccessDenied
- [ ] AI 扫描：用 Stripe 测试模式做一次 differential-review，范围限定为 billing 和 webhook
