# 决策记录

> 规则：代码中所有「待定」事项一律先按「默认值」实现，并做成配置或环境变量；人类拍板后只改配置。
> 会议里没拍板的数字（Q1–Q7）拍板后只改参数，不改代码。
> AI 在开发过程中自己做的新决策，追加到文末「开发中决策」表；安全类技能里标为 Ask First 的事项，如果在 TASKS 范围内，也在那里记一行。
> 安全例外只认本文件里的条目，或者用户在对话里明确说的。

## 待人拍板（都有默认值，不阻塞开发）

| ID | 决策 | 默认值（先这么做） | 备选 | 谁定 | 状态 |
|---|---|---|---|---|---|
| D1 | 云服务商 | AWS 亚太（马来西亚）区域 ap-southeast-5 | 阿里云吉隆坡区域；Vercel + Neon（新加坡，最快上手，但数据不在马来西亚） | 你 | 待定 |
| D2 | 产品名 / 域名 | 已定：FindMYJob，域名 `findmyjob.asia`（11-04 用户告知；DNS 在阿里云，根域名和 www 现在指向原型服务器 43.134.49.247）。建议正式版上线时根域名切到正式主机，原型改用子域名（如 demo.）。MyIPO 商标上线前还要查 | 另注册 findmyjob.my / .com 防抢注 | 双方 | 名称和域名已定，商标待查 |
| D3 | 运营主体 | 马来西亚 Sdn Bhd | 挂靠协会或学校 | 对方 + 律师 | 待定 |
| D4 | 邮件服务 | Resend | AWS SES、SMTP | 你 | 待定 |
| D5 | 在线支付（M8） | Stripe（银行卡 + FPX） | Billplz、iPay88 | 双方 | 待定 |
| D6 | 上线语言 | 中文 + 英文 | + 马来文 | 双方 | 默认 |
| D7 | 公益期参数 | 每家企业每月 30 点；解锁 1 点 / 次 | — | 对方 | 待定 |
| D8 | 收费价格 | 见 business/01 §5.3 | — | 双方 | 待验证 |
| D9 | 首个试点学校 | ⚠️ 厦门大学马来西亚分校（学生邮箱后缀待确认） | — | 对方 | 待确认 |
| D10 | 隐私政策 / 用户协议 | 先用模板并标注「草案」，上线前请律师审阅。要问律师的问题（GATE-M7 前一次性提交）：① 跨境传输（SUBPROCESSORS 里不在马来西亚的子处理者，尤其是 Sentry EU 和开发期 AI 中转）怎么披露、要不要额外同意；② 是否需要任命 DPO；③ 泄露通报时限（默认向专员 72 小时内、向受影响者 7 天内）；④ 账号清除时 AuditLog 是否要匿名化（D22）；⑤ 备份里已删除的数据最多再保留 30 天，隐私政策怎么写 | — | 律师 | 待办 |
| D11 | 是否需要私营就业中介牌照 | 未知，上线前请律师确认 | — | 律师 | 🚦 阻塞上线 |
| D12 | AI 中转和真实数据 | 把开发期用的第三方中转当成不可信的第三方，只给它合成数据；真实公司名单放在仓库外，由人工处理，不进 Claude 会话；LLM 扫描只做限定路径的两项（GATE-M4、GATE-M7）。中转的数据保留和日志条款、实际提供哪些模型 ID 待查；SECURITY_REVIEW_MODEL 先填 claude-sonnet-4-6，以 log.txt 里 Review usage 记录的 model= 为准。暂不买第一方订阅或 API key，GATE-M7 前再决定（花钱的决定由人做） | 买第一方订阅 / API key，用来处理真实数据和做全库扫描 | 你 | 默认 |
| D13 | GitHub 账号形态 | 个人私有仓库 FairChan/findmyjob，只有技术负责人是协作者；没有 Pro 时只通过 PR 合并。Education 照常申请 | 免费组织，镜像地址相应改为 ghcr.io/<org>/findmyjob | 你 | 默认 |
| D14 | 错误监控的供应商和区域 | Sentry SaaS 免费档的 EU 区域，配合 scrubEvent 脱敏，并写进 SUBPROCESSORS | 律师不同意时，在马来西亚自建 GlitchTip（P2） | 你 + 律师 | 默认 |
| D15 | 职位详情页的 SEO | 试点期详情页设 noindex，不输出 JobPosting JSON-LD，只让列表页和企业主页被收录 | 详情页可收录（要先解决「看详情要登录、有额度」的冲突） | 双方 | 默认 |
| D16 | uptime 和定时任务心跳 | UptimeRobot 免费档监控 /api/health，healthchecks.io 免费档监控备份和定时任务；两家的条款待核实 | 其他 uptime 服务 | 你 | 默认 |
| D17 | 上传方式 | 走 app 中转，请求体不超过 11MB | presigned POST，等单份文件变大或流量明显增加时再换 | 你 | 默认 |
| D18 | 企业侧的产品限制 | 企业成员只能看本企业职位详情；团队最多 3 人（`team.maxMembers`）；每家企业每天最多看 400 份档案；每人每天最多翻 300 页搜索；最多翻到第 25 页；每个邀请人每天最多 3 个有效邀请。都是 getSetting 参数，运营可以随时调 | 合伙人确认后改参数 | 双方 | 默认，下次开会确认 |
| D19 | 试点日期和范围 | 接受推迟：GATE-M7 约在 2027-01-11 至 01-15，E2 约在 2027 年 1 月第三周（先对照校历；2027 年农历新年约 02-06，待核实） | 必须 12 月中上线时用压缩方案：M4-T05 的企业级上限、M2-T09 的每日上限、M5-T03 中 noindex 以外的部分、M7-T05 的 Report-Only 降为 P1，同时每周投入 25 小时以上 | 双方 | 默认 |
| D20 | 收费前 RPO ≤ 1 小时的方案 | 按 E7：每小时备份（或 WAL 归档），服务器上的备份凭据没有删除权限；GATE-M8 前完成 | PITR（托管数据库） | 你 | 默认 |
| D21 | 恢复演练在哪台机器上做 | 同区域开一台按小时计费的临时 VM（费用待查），做完就销毁，私钥只进这台临时机 | 成本不划算时在生产 VM 上做，私钥经 ssh stdin 传入，trap 结束时删除 | 你 | 默认 |
| D22 | 账号清除时 AuditLog 里的 IP 是否匿名化 | 应用不改 AuditLog（首个迁移收回 findmyjob_app 的 UPDATE） | 律师要求时，改成列级授权 GRANT UPDATE (ip) 给 findmyjob_app | 律师 | 默认 |
| D23 | AI 用量上限和由谁付费 | 每轮 3 美元、每次运行 30 美元（auto-build 默认值）；总上限等 M0-H01 实测后再定；试点前闸门的 LLM 扫描不超过 300 元。实测记录（2026-11-05 autopilot，claude-sonnet-4-6，订阅登录，按牌价折算）：M0 的 11 个开发任务每个平均 2.39 美元（1.03–4.56；把 T01 超预算那一轮也算上是 2.66），M0 共 29.48 美元（含探针）；M0–M7 还剩 73 个开发任务，预计约 175–195 美元。**用户 2026-11-05 在对话里拍板：不设总上限**，autopilot 用 BUDGET_USD 设成极大值、每轮上限 10 美元（防单轮失控）；付款：子进程走用户本机 claude.ai 订阅登录，上面的美元数是按牌价折算的用量，不另付 API 费 | 订阅额度用完时 autopilot 会因认证/限额失败停下，等额度恢复后重跑 | 用户 | 已定 2026-11-05 |
| D24 | 云服务器 43.134.49.247 能否用作正式版主机 | 先只部署原型（mock 数据，noindex）。S2 查到区域和规格后由用户决定：在马来西亚区域且不低于 2 vCPU / 4GB 才作为正式版候选；否则只做演示或 staging，正式版另开马来西亚区域主机（A6、PDPA） | 复用这台主机（要先处理 root 部署和 apt 版 Caddy 占 80 端口两个冲突） | 你 | 待 S2 |

## 已定

| ID | 决策 | 理由 |
|---|---|---|
| A1 | Next.js 全栈单体 + PostgreSQL + Prisma | 团队小；AI 生成这套技术栈的代码质量高；部署简单 |
| A2 | 点数账本从第一天就做，公益期价格为 0 | 转收费只需改配置 |
| A3 | 学生投递 = 自动授权该企业查看联系方式 | 学生主动投递就是同意，不应该再收企业的钱 |
| A4 | 联系方式单表加密 + 唯一出口 | 隐私是平台信誉的核心 |
| A5 | 不做站内聊天 | 马来西亚普遍用 WhatsApp；省开发量 |
| A6 | 数据库和文件存储放在马来西亚区域 | PDPA 合规和国企合作方的顾虑 |
| A7 | 学生查看额度 + 邀请解锁（可以关闭，`studentQuota.enabled`） | 会议共识：用邀请换额度带来增长；数字先按 Q1–Q3 默认值 |
| A8 | 关联搜索先用同义词表，不先上 AI 或向量检索 | 成本；试点规模下同义词表够用 |
| A9 | 人机验证用 Cloudflare Turnstile | 免费、成熟方案（会议共识） |
| A10 | 用注册上限控制放量节奏（`signup.studentCap`） | 每个阶段先压测再放量 |
| A11 | 代管企业：运营先替企业建号、代发职位，之后移交 | 冷启动时企业不愿自己注册 |
| A12 | 工具链和 security-guidance 分阶段配置：B/C 阶段用户级关闭 Stop 审查（ENABLE_STOP_REVIEW=0），保留提交审查；auto-build 经 `scripts/headless-settings.json` 降级；交互会话需要深度审查时手动 /security-review。待填：Z0-4 的 python3 / pnpm / gitleaks 版本；Z0-6 的 env 优先级结论；若出现 API error，记录 ENABLE_CODE_SECURITY_REVIEW=0 的降级方案；`npx skills update` 后要重新给 4 个技能加 disable-model-invocation | -p 模式下 Stop 审查会强制多跑一轮；钩子经中转是否可用尚未实测 |
| A13 | 生产仓库用 pnpm（corepack，packageManager 精确版本）；原型仍用 npm | 原型已有 package-lock，迁移不划算；生产要 frozen-lockfile 和 install 脚本白名单 |
| A14 | 环境变量模板叫 `env.example`（不以 .env 开头） | deny 规则 `Read(**/.env*)` 优先于 allow，没法单独放行模板；改名后 .gitignore 不需要例外 |
| A15 | 命名、主键和令牌：表和列不做名称映射；主键用 cuid()；本项目自己发的令牌只存 sha256 哈希，比较用 timingSafeEqual | 第一个迁移之前定下来不花成本；数据库泄露时令牌不能直接用 |
| A16 | 数据库角色：findmyjob_owner（迁移）和 findmyjob_app（应用），超时设在角色上；账本和审计的只追加靠 REVOKE 保证 | 官方镜像默认用户是超级用户，「只追加」不能只是口头约定 |
| A17 | 时间一律 Timestamptz(3)、UTC 存储；主机时区也保持 UTC，cron 和 unattended-upgrades 按 UTC 写（重启 21:30 UTC = 吉隆坡 05:30）；展示按 Asia/Kuala_Lumpur | 数据库、cron、日志统一用 UTC，排查时不用换算；只在展示层转换 |
| A18 | 迁移只往前滚：已提交的迁移不改、不删，没有 down 迁移；GATE-M7 之后只做 expand；回滚 = 部署上一个镜像 + 前滚迁移 | Prisma 没有 down 机制；生产数据不能靠回滚恢复 |
| A19 | PII 密钥环（PII_KEYS + PII_ACTIVE_KEY_ID，带 keyId 前缀和 AAD），取代旧的单密钥变量。PII_KEYS 和 BETTER_AUTH_SECRET 存两个人的密码管理器；age 私钥只做两份离线介质，不进密码管理器、不上 VM；GitHub Secrets 里没有应用密钥 | 单密钥没法轮换；密钥和备份私钥分开，任何一处泄露都不足以还原 PII |
| A20 | 备份：每天 pg_dump → age 加密 → 只 PutObject 到马来西亚区域的备份桶（版本控制、30 天生命周期）→ healthchecks 死信监控；GATE-M7 前做过恢复演练 | 备份凭据只能写，服务器被攻破也删不掉历史备份 |
| A21 | 部署：CI 只推 sha 镜像；技术负责人 SSH 执行 findmyjob-deploy（先备份、再迁移、再 up、健康检查失败自动回到上一个 tag）；GitHub 不持有部署私钥 | 三套部署方案合并成一套；迁移需要人工批准 |
| A22 | GATE-M7 之前，生产主机就是 staging（basic_auth + 合成数据）；上线前清空数据库、去掉 basic_auth、改 APP_ENV=production | 试点期只有一台主机，省钱 |
| A23 | 生产判断只看 APP_ENV（production / staging / ci / development），不看 NODE_ENV | CI、本地 prod 构建和压测都是 NODE_ENV=production，按它判断会启动失败 |
| A24 | 限流：认证限流用 Better Auth 的 database 存储；可信 IP 只认 Caddy 写入的 X-Real-IP；业务限流按业务表计数；PostgreSQL 限流桶放到 P1（M7-T14），不引入 Redis | X-Forwarded-For 可以伪造；内存限流重启即丢 |
| A25 | 不用 CodeQL（本地和私有仓库都不用） | 私有仓库用不了免费的 code scanning；确定性红线改用 ESLint，semgrep 放到 M7-T16 |
| A26 | 试点期不扫描上传文件里的恶意代码（不装 ClamAV） | 已有白名单、文件头、页数和加密检查，PDF 用 copyPages 重建；ClamAV 放进备选清单 |
| A27 | 试点期所有职位人工审核（`jobs.autoPublishAfter=1000`） | 反诈：招聘诈骗是留学生最大的风险之一 |
| A28 | 按批次放量：E2 内测 200 人 → E3 本校公开 500 人 → E4 扩大 3000 人；每次放量前按 E5 的绝对数门槛判断，至少观察 7 天 | 「没有 P0 bug」没法核对；单校试点不适合百分比金丝雀 |
| A29 | 安全文档哪些入库：只有 docs/security/threat-model.md 和 FINDINGS.md（只写编号、位置、状态）入库；扫描报告写到 .reports/（已忽略），CI 原始输出写到 .sec-out/ | 报告里可能有代码片段和路径细节，不该进仓库历史 |

## 会议默认值（2026-11-02 会议没拍板的事项）

详细说明见方案文档《FindMYJob 重构计划 v2》Part V §2。参数见 PRD §5。

| 编号 | 问题 | 默认做法 |
|---|---|---|
| Q1 | 学生额度怎么算 | 登录后可看 20 个职位详情；每 3 个有效邀请多 10 个；累计 12 个有效邀请后不限 |
| Q2 | 什么算「看了一个」 | 主动点开某个职位详情才计 1 次；同一职位再看不计；已投递、被邀请投递的不计不锁；访客看详情要登录 |
| Q3 | 什么算有效邀请 | 通过邀请链接注册、邮箱已验证、完成度 ≥ 90；只记给一个邀请人；作废的不计；删号不收回 |
| Q4 | 投递门槛 | 完成度 ≥ 60 |
| Q5 | 注册上限 | 只限学生；达到上限显示「名额已满」；90% 时通知运营 |
| Q6 | 搜索默认模式 | 精确；结果少于 5 条时追加「相关职位」 |
| Q7 | 薪资档 | 2000+ / 3000+ / 5000+ / 8000+（MYR / 月） |
| Q8 | 公司定位标签谁来定 | 只由运营设置 |
| Q9 | 地图 | 原型只做「预设地标 + 半径」；正式版 P2（Leaflet + OpenStreetMap） |
| Q10 | 学生付费 | 只留接口，`billing.studentEnabled=false` |
| Q11 | GitHub 仓库改不改名 | 原型仓库改成 findmyjob-prototype，执行前先问用户（公网地址会变） |
| Q12 | 首页背书字样 | 不动，沿用 2026-10-30 的决定 |

## 已接受风险

> TM-ID 由 B8 的威胁模型（docs/security/threat-model.md）分配；B8 完成前先写「待 B8」。威胁模型里每个 High 都要落到 TASKS 的验收句，或者写进这张表。

| TM-ID | 风险 | 补偿控制 | 负责人 | 复评日期 |
|---|---|---|---|---|
| 待 B8 | 学生注册上限是软上限，并发注册时可能略超 | 只统计已验证学生；运营看板监控；超出时下调 `signup.studentCap` | 技术负责人 | GATE-M7 |
| TM-026 | 试点期运营账号还没有强制 2FA（M6-T09 在 E3 前完成） | 每个运营一个账号、密码管理器生成的独立强密码；后台操作全部写审计；运营账号的 `auth.login` 记录列入每周例行检查（M7-T13） | 技术负责人 | E3 前 |
| 待 B8 | Sentry 数据在 EU 区域，属于跨境传输（D14） | sendDefaultPii:false、scrubEvent、不开 Replay、tracesSampleRate:0；写进 SUBPROCESSORS 和隐私政策 | 技术负责人 + 律师 | GATE-M7 |
| 待 B8 | 不扫描上传文件里的恶意代码（A26） | 类型白名单、文件头检查、PDF 页数和加密检查、copyPages 重建、下载带 attachment | 技术负责人 | E4 之后 |
| 待 B8 | 少于 3 个字的关键词走全表扫描 | 试点规模小；人才库翻页上限和每日上限限制总量 | 技术负责人 | 档案超过 5000 条时 |
| 待 B8 | 开发期源码和 diff 会经过第三方 AI 中转（D12） | 只用合成数据；真实名单不进会话；LLM 扫描限定路径；全库扫描放到 E6 | 你 | GATE-M7 |
| 待 B8 | 开发依赖里有 3 条已知公告：deepmerge-ts <8（high，经 prisma>@prisma/config）、minimatch <11.0.1（moderate，经 eslint）、deepmerge 4.3.1（low，经 shadcn CLI）。生产依赖 `pnpm audit --prod` 为 0 | 三者只处理仓库自己的配置和 lint 规则，输入可信；deepmerge-ts 的修复版是大版本，prisma 按规定锁 6.19.3；Dependabot 跟进上游修复 | 技术负责人 | GATE-M7 或 prisma 6.x 下个补丁版 |

## 备选方案清单（E8，暂不采用）

> E4 之后逐项复评，每一项写明采用或不采用，以及下次复评日期。

| 编号 | 方案 | 现在的结论 | 复评时点 |
|---|---|---|---|
| E8-01 | 盲索引和重加密脚本 | 暂不采用：E2/E3 只有 200–500 人 | E4 之后 |
| E8-02 | detect-abuse 告警 | 暂不采用：运营人工巡查 | E4 之后 |
| E8-03 | OWASP ZAP 扫描 | 暂不采用：费用和运维成本 | E4 之后 |
| E8-04 | 每周定时安全扫描 | 暂不采用：Dependabot alerts 邮件已起到提醒作用 | E4 之后 |
| E8-05 | sops / age 管理配置 | 暂不采用：试点期用密码管理器 | E4 之后 |
| E8-06 | cosign 镜像签名 | 暂不采用 | E4 之后 |
| E8-07 | distroless 镜像 | 暂不采用：slim + USER node 已够 | E4 之后 |
| E8-08 | Tailscale 管理通道 | 暂不采用 | E4 之后 |
| E8-09 | RUM 真实用户性能监控 | 暂不采用 | E4 之后 |
| E8-10 | 自托管 GlitchTip | 暂不采用，除非律师不同意 D14 | E4 之后 |
| E8-11 | PITR | 由 D20 / E7 决定 | GATE-M8 前 |
| E8-12 | ClamAV | 暂不采用（A26） | E4 之后 |
| E8-13 | CodeQL（用于公开的原型仓库） | 暂不采用（A25） | E4 之后 |
| E8-14 | claude-mem PII 正则 | 暂不采用：整个 MyJob 工作区已排除 | E4 之后 |
| E8-15 | 出站白名单 | 暂不采用：语义未核实，会影响其他项目 | E4 之后 |
| E8-16 | 大规模技能归档 | 暂不采用，由用户自己决定 | E4 之后 |
| E8-17 | 闸门流程做成项目技能 | 暂不采用：流程写在 docs/AI-SKILLS.md | E4 之后 |
| E8-18 | PDF 处理放进 Worker 沙箱（resourceLimits + terminate） | 暂不采用：页数上限、拒绝加密、copyPages 已覆盖主要风险 | E4 之后 |

## 开发中决策（AI 追加）

| 日期 | 任务 | 决策 | 理由 |
|---|---|---|---|
| 2026-11-05 | M0-T02 | MIGRATE_DATABASE_URL 对 app/worker 进程必须设置，且应使用 findmyjob_app 凭据（与 DATABASE_URL 相同）；仅迁移进程使用 findmyjob_owner 凭据 | Prisma schema 中 directUrl = env("MIGRATE_DATABASE_URL") 在客户端初始化时就会读取，若未设置则抛错。生产环境 app.env 和 migrate.env 分开，各自配置不同用户 |
| 2026-11-05 | M0-T04 | 新增 @faker-js/faker@10.6.0（devDep）：测试数据生成；备选：chance.js（功能较弱）。新增 @axe-core/playwright@4.10.1（devDep）：E2E 可访问性断言；备选：playwright-axe（wrapper，包裹层过深）。两者均无 install script，无需加入 allowBuilds | 确定性种子生成测试数据；axe 是业界标准 a11y 检测库 |
| 2026-11-05 | M0-T07 | 新增 server-only（dep）：在 src/server 模块首行标记只能在 Next.js 服务端使用；备选：手写运行时检查（不如编译期保证）。无 install script，无需加入 allowBuilds | ARCHITECTURE §4 要求 src/server 只在服务端运行；vitest.config.ts 已有 shim |
| 2026-11-05 | M0-T08 | 新增 pino@9（dep）：结构化 JSON 日志输出到 stdout，内置 redact 路径机制脱敏 PII；备选：winston（更重，配置复杂）、bunyan（维护低）。加进 serverExternalPackages 避免 Next.js webpack 打包报错。无 install script，无需加入 allowBuilds | ARCHITECTURE §5.6 要求 JSON 日志和 PII 脱敏；pino 是 Node.js 生态最快的结构化日志库 |
| 2026-11-05 | M0-T11 | 新增 pg-boss@12.38.0（dep）：基于 PostgreSQL 的队列和定时任务；备选：BullMQ（依赖 Redis，不符合架构只用 PostgreSQL 的原则）、node-cron（无持久化）。无 install script，无需加入 allowBuilds。worker 实例 max=4；Next.js send-only 实例 max=2、supervise=false、schedule=false（pg-boss v12 ConstructorOptions 选项名） | ARCHITECTURE §2 指定使用 pg-boss；无 Redis 依赖；M0-T11 要求 M0 就启动 worker |
| 2026-11-05 | M0-T02 | 本地对象存储镜像改为 Pigsty 维护的社区分支 `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` 和 `pgsty/mc:RELEASE.2026-10-26T00-00-00Z`，compose 里同时固定 sha256 digest；宿主机端口改为 127.0.0.1:9010（API）/9011（控制台），S3_ENDPOINT 跟着改。备选：bitnamilegacy/minio（已停更）、RustFS、SeaweedFS（S3 兼容度和建桶脚本都要重写）。用户 2026-11-05 在对话里确认用 pgsty | 官方镜像 2026-11 已从 Docker Hub 下架、quay.io 需登录；pgsty 镜像基于 UBI9 micro，自带 sh 和 curl，现有 healthcheck 和建桶脚本不用改；本机 9000 端口被其他项目的 MinIO 占用。生产对象存储按 ARCHITECTURE §7 用云厂商 S3，不受影响 |
| 2026-11-05 | M0 合并前 | 补登记 M0 随脚手架带进来、此前没单独登记的直接依赖（都是 ARCHITECTURE §2 已选技术栈的标准配套，没有 install 脚本）：shadcn/ui 组件依赖 @radix-ui/react-dialog、@radix-ui/react-slot、class-variance-authority、clsx、tailwind-merge；React 配套 react-dom、@types/react-dom；Tailwind 4 的 tailwindcss、@tailwindcss/postcss；Next 的 ESLint 配置 eslint-config-next、@eslint/eslintrc（flat config 兼容层）；Vitest 配套 @vitejs/plugin-react、@vitest/coverage-v8、jsdom。备选：不用 shadcn 就得自己写 Dialog/Sheet（CLAUDE.md 要求弹窗只用 shadcn）；jsdom 可换 happy-dom（兼容性差一些） | 合并前清单要求新增直接依赖都在 DECISIONS 登记；版本由 pnpm-lock.yaml 锁定，minimumReleaseAge=1440 |
| 2026-11-05 | M0 合并前 | 从本仓库删掉 `prototype/package-lock.json`，并在 .gitignore 里忽略 | M0-T01 验收要求仓库里没有 package-lock.json；本仓库的 prototype/ 只是界面参考副本（tsconfig、eslint、vitest 都排除了它），原型自己的仓库仍保留锁文件 |
| 2026-11-05 | M0 合并前 | supply-chain-risk-auditor 结论：35 个直接依赖都没有已知公告、没有安装脚本、没有弃用或归档；clsx、class-variance-authority、server-only 只有一个发布者（周下载量都在 3300 万以上），靠锁文件 + minimumReleaseAge=1440 + 人工审 Dependabot 兜底，不换包。采集器不读 pnpm-lock.yaml，补跑 `pnpm audit`：生产 0 条，开发依赖 3 条，记进「已接受风险」。报告在方案目录 .reports/2026-11-05-supply-chain/report.md | M0 合并前清单第 2 项 |
| 2026-11-05 | M0 合并前 | 根路径 `/` 的语言选择保持 next-intl 默认顺序：cookie（用户切换过的语言）→ 浏览器 Accept-Language → 默认 zh。E2E 改为固定浏览器语言：马来文浏览器进 /zh，英文浏览器进 /en | 规格只写「zh 默认」；关掉自动识别会连 cookie 一起失效，用户切到英文后再访问 `/` 又回中文；之后要扩展到其他国际生。原测试没固定浏览器语言，结果随机器的系统语言变化 |
| 2026-11-05 | M7-T02 | 新增 react-markdown@9.1.0（dep）：服务端渲染 Markdown 为 React 组件，ESM-only，兼容 Next.js App Router Server Component；备选：marked（需 dangerouslySetInnerHTML）、next-mdx-remote（配置更重）。新增 remark-gfm@4.0.1（dep）：GitHub Flavored Markdown 扩展，支持表格、任务列表等；备选：不加则 GFM 表格无法渲染。两者均无 install script，无需加入 allowBuilds。法律页正文从 src/content/legal/*.md 读取，页面用 `generateMetadata` 设 robots:index=false | 法律页需要渲染含表格的 GFM Markdown；react-markdown 是服务端友好的选择，不需要客户端 JS；remark-gfm 支持隐私政策和用户协议里的表格结构 |
| 2026-11-05 | M7-T04 | 新增 @sentry/nextjs（dep，锁精确版本）：Next.js App Router 的错误监控，在 instrumentation.ts / instrumentation-client.ts 中初始化；备选：自建 GlitchTip（E8-10，律师不同意时备用）。新增 @sentry/node（dep，锁精确版本）：worker 进程的错误监控；备选：同上。两者均有 postinstall 脚本，加入 onlyBuiltDependencies。详见 D14 | Sentry 是 D14 已决定的供应商；instrumentation API 是 Next.js 官方推荐的初始化位置；不运行 @sentry/wizard，不用 withSentryConfig（仅需 error capture，不需 source maps 或 tunneling） |
| 2026-11-05 | M7-T12 | 备份 Docker 镜像（`findmyjob-backup`）以 `postgres:16.6-bookworm` 为基础镜像，安装 `age`（加密）和 `awscli`（S3 上传）；不共用 runner 镜像，保持镜像层分离。备选：debian:bookworm-slim + pgdg apt 源（需额外安装 pg_client；构建复杂度高）。restore-drill.sh 要求宿主机安装 `age`、`postgresql-client-16`、`awscli`、`python3`，或通过 backup 容器代为执行 S3 操作（RUNBOOK 均有说明）。verify-decrypt.ts 自包含（不 import src/server/lib/crypto.ts），直接用 Node.js 内置 crypto，避免 server-only 和 env 模块的依赖链，且不受 contact-access ESLint 约束 | 备份镜像独立：postgres:16.6-bookworm 有 pg_dump 16，与生产数据库版本一致；awscli v1 from apt 支持 --endpoint-url S3 兼容存储；verify-decrypt.ts 自包含可在工具容器里单独运行 |
| 2026-11-05 | M4-T02 修复 | Notification.payload 是发送时的快照：学生之后屏蔽企业或删号，旧通知里存储的姓名不会被回收；这是已接受风险，靠 purge-deleted-accounts（M7-T03）清理删号用户的通知兜底 | buildEmployerStudentPayload 只决定当时是否写入全名，无法追溯修改已落库的记录 |
| 2026-11-05 | lane B 工具（总控改动） | 这是总控（orchestrator）改动，不是开发轮次：开发轮次不许碰的规则文件 `scripts/auto_build_status.py`、`scripts/auto-build.sh` 由总控按用户「多会话并行推进」的要求修改。新增任务清单模式 `AUTO_BUILD_TASKS="M4-T01,..."`：`next` 不看里程碑顺序，返回清单里第一个未勾选、依赖都已 `[x]` 的任务，清单之外的任务不碰；这时允许在 `lane/*` 分支上运行。另加 `AUTO_BUILD_COMPOSE_PROJECT`（只用于 worktree 里检查 postgres 是否在跑，不传给子进程，免得子进程的 `docker compose up` 重建另一条车道的容器）、`AUTO_BUILD_PROMPT_NOTE`（提示词末尾追加车道环境说明）；`playwright.config.ts` 改读 `PORT`（默认 3000）。三个变量都不设时行为不变（M0–M10 的 `next` 输出与改动前逐项一致） | lane B 在独立 worktree（`lane/b`，库 `findmyjob_laneb*`，端口 3001）里跑只依赖 M0 的 M4-T01/T02 和 M7 部署类任务，不排在 M1→M6 后面 |
| 2026-11-05 | M7-T12 修复 | 试点期 BACKUP_DATABASE_URL 仍使用 findmyjob_app（可读写）凭据；已接受风险：备份进程可写库，泄露时影响面略大于只读凭据。M7-H01 建好 findmyjob_backup 只读角色后换用，届时更新 backup.env 和此决策 | 只读角色须 GRANT SELECT 到所有表（含未来迁移新表），试点前手动维护成本高，不如 M7-H01 一并完成 |
| 2026-11-05 | M4-T01 修复（二） | redact() 有意不覆盖、记为已接受风险的写法：每位数字之间都隔开的号码（「1 3 8 1 2 3 4 5 6 7 8」）；at/dot 拼写只认常见邮箱服务商（gmail、outlook、qq、163 等，见 redact.ts 的 MAIL_PROVIDERS），其他域名的「x at y dot com」不遮；汉字本地部分的邮箱会连同前面最多 6 个汉字一起遮掉。兜底靠职位和档案举报、运营抽查（GATE-M4 清单第 2 项照常人工测） | 要覆盖这些写法，就会误伤「look at this dot com」、年份、学号、成绩一类的普通文本；隐私优先的取舍是宁可多遮汉字，不多放过账号 |
| 2026-11-05 | M4-T01 修复（三） | redact() 为减少误伤做的取舍，记为已接受风险：(1) 英文「WeChat」后面不带连接词的纯字母词（「WeChat alicewong」）不遮，带冒号、等号、是或为时照遮；微信、vx、wx 后面的纯字母词照遮，产品词除外（PRODUCT_WORDS）。(2) 弱连接词（- / is）后面只认带数字或下划线的账号。(3) 网址里的中文只在 / - _ = 之后、最多 20 个字时算路径。(4) 带空格的 @ 只对常见邮箱服务商和汉字本地部分生效。兜底同上：举报、运营抽查、GATE-M4 第 2 项人工测 | 独立复查实测：f79f286 的写法会把 162 个常见英文词里的 109 个（Programme、Analytics、Enterprise 等）当成微信号遮掉，还会吞掉网址后面整句中文；隐私和可读性两头都要顾，只在有明确信号（连接词、数字、下划线、中文关键词）时才把词当账号 |
| 2026-11-05 | M4-T01 修复（四） | 修订「修复（三）」第 (1)(4) 条：英文「WeChat」后面，小写的纯字母词（6 位以上、不是产品词）当账号遮掉，首字母大写的不遮（「WeChat Programme」照常显示）；「WeChat ID」后面的纯字母词都遮；弱连接词「is」后面仍只认带数字或下划线的账号（「WeChat is widely used」不遮）。带空格的 @：本地部分是小写、含数字、点、下划线，或前面有邮箱、email、contact 等字样时遮，「Intern @ Shopee.com.my」这类首字母大写的头衔不遮。网址路径里的括号和撇号仍算网址结束 | 5452dab 的提交审查把「WeChat alicewong」「alice @ example.com」定为高风险漏网；微信号通常是小写，求职头衔和产品名通常首字母大写，按大小写区分，能同时顾到泄露和误伤 |
| 2026-11-05 | M4-T01 收尾 | redact() 不再追着新写法改正则。完成标准固定为 tests/unit/redact.test.ts 的「固定验收语料」：MUST_HIDE 全部遮住、MUST_KEEP 一个不变、30 种 4 万字的恶意输入各自在 250ms 内完成（线性）。之后审查或运营报出的新写法，只有现有类别里的明显漏洞（例如一种常见的电话格式）才补正则和语料，其余记为已接受风险。补偿控制：(1) 举报；(2) 运营抽查企业端看到的文本；(3) 企业端只拿到 talent-card serializer 输出的脱敏文本；(4) 联系方式只存在 StudentContact、要解锁才能看到，自由文本里的联系方式只是额外的一层 | 正则脱敏做不到完美，前后四轮手工修复每轮都被审查挑出新写法；固定验收集加补偿控制，比无限追正则更可控（主线 2026-11-05 定） |
| 2026-11-05 | M4-T01 收尾（二） | 最终复查（三条完成标准全部通过）之外又测出的误伤，按完成标准第 2 条修掉，并加进 MUST_KEEP：日期区间（「2021-09-01 - 2025-06-30」）不再被当成电话，手机号的运营商前缀（012、011…）和固话区号要连着写；英文「WeChat」后面不带「ID」时，不再把小写词当账号（原规则在英文句子里会遮掉 49 个常见词中的 47 个，比如「through WeChat within seconds」）；平台名后面要是像账号的写法（@、带数字或下划线），「Product line: consumer electronics」「IG: 5000 followers」照常显示。已接受风险（补偿控制同「M4-T01 收尾」）：「WeChat alicewong」「My WeChat is alicewong」（英文、不带 ID 或冒号的纯字母账号）；首字母大写的本地部分加带空格的 @（「Alice @ company.com」）；平台名后面不带冒号（「Telegram alice_tg」「IG alice.wong」）或纯字母账号（「Telegram: alicetg」）；「小红书号」「抖音号」；用 # 代 @、用 · 代 .；带空格的斜杠分隔号码（「012 / 345 / 6789」）；小写头衔加带空格的 @（「intern @ shopee.com.my」会被遮，属于误伤） | 遵守主线定的收尾规则：只修现有类别里的明显漏洞和普通文本的误伤，其余写法记风险 |
| 2026-11-05 | M4-T01 收尾（三） | 7b4f3d1 的提交审查提出三条，按收尾规则只修「现有类别里的明显漏洞」：东马固话（082–089 区号加 6 位号码，「088-123456」）；平台名加冒号后的纯字母账号（「IG: alice.wong」「Telegram: alicewong」），只排除短数字和产品词；「WeChat alicewong」改为窄规则：小写账号在文末，或后面紧跟标点、中文时才遮，所以英文句子「through WeChat within seconds」不受影响。这条从「收尾（二）」的已接受风险里移出，放回 MUST_HIDE。仍记为已接受风险的：「My WeChat is alicewong」「WeChat alice.wong」；平台名不带冒号；分组少见的固话（「03-21 23 4567」）。会多遮的：「TikTok: viral marketing」这类平台名加冒号后接普通词 | 东马号码和 IG 账号都是常见写法；窄规则让英文句子和文末账号可以同时兼顾 |
| 2026-11-05 | M7-T04 修复 | NEXT_PUBLIC_APP_TAG 和 NEXT_PUBLIC_SENTRY_ENVIRONMENT 须在构建镜像时作为非秘密的 build env 传入（连同已有的 NEXT_PUBLIC_SENTRY_DSN），构建命令形如 `--build-arg NEXT_PUBLIC_APP_TAG=${APP_TAG}`；Dockerfile 在 pnpm build 的 RUN 里内联这三个变量。待 GATE-M7 前由 M7-T06 修复轮统一处理 | NEXT_PUBLIC_* 变量在浏览器包里是编译期常量，运行时 process.env 不再包含它们，必须在构建时注入 |
| 2026-11-05 | M7-T14 修复 | `assertFeatureEnabled` 改为 `enabled !== true`：只有严格布尔 `true` 才算开启；`"false"` / `0` / `null` / `"true"` 一律视为关闭。`checkEmailCap` 的 critical 参数改为 `template: string`，由 `CRITICAL_TEMPLATES`（`otp`、`password-reset`、`email-verify`）封闭决定；调用方只传模板名，不能自行声明 critical。alert 只在每窗口第一次超限（count === cap+1）时触发，避免重复报警。RateLimitBucket 列名统一加双引号。`rate-limit.ts` 改为 async，底层调用 `hitBucket`，`clearRateLimit` 改写为 DELETE FROM RateLimitBucket。止血开关已就绪，待各入口实现时调用：`assertUnlockEnabled()` 在 M4-T07 解锁服务入口调；`assertTalentSearchEnabled()` 在 M4-T03 人才库搜索入口调；`assertUploadsEnabled()` 在 M2-T05 上传服务入口调。`HEALTHCHECKS_EXAMPLE` 和 `HEALTHCHECKS_PRUNE_RATE_LIMIT` 加入 env.ts（可选 URL，空值表示不 ping） | 安全审查确认：字符串 "false" 经 !enabled 判断为 false 会放行功能；critical 布尔值调用方可随手传 true 绕过上限；重复 alert 会淹没 Sentry |
| 2026-11-05 | lane B 收尾遗留 | lane B 合并前已知、延后处理的 Medium 和 Low 项，写成 docs/TASKS.md 的 M7-T19（P1，M7-H02 之前），不挡这次合并。挡合并的只有三类：验收没满足；High 或 must-fix（安全漏洞、上线就坏、绕过红线）；本机验证不全绿（主线收尾规则）。因依赖还没做、暂时没法满足的验收：M7-T02 重同意跳转（等 M1-T04）、M7-T14 解锁开关（等 M4-T07）；要真机的验收：M7-T06、T11、T12 的 prod compose、部署、备份、恢复演练（M7-H01、M7-H02） | 避免收尾时越修越多；遗留项都有出处，可以逐条追踪 |
