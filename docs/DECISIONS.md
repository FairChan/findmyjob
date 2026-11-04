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
| D23 | AI 用量上限和由谁付费 | 每轮 3 美元、每次运行 30 美元（auto-build 默认值）；总上限等 M0-H01 实测后再定；试点前闸门的 LLM 扫描不超过 300 元。实测记录：单轮 X 美元（待填）、预计总共 Y 元（待填）、上限 Z 元（待定）；付款人待定 | 超上限时改用方式 A，或设 AUTO_BUILD_MODEL | 双方 | 待 M0-H01 |
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
