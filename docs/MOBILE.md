# 移动端（Android App）设计

> 来源：2026-11-18 安卓 App 计划 v1（用户同日确认按默认值执行）。本文只保留架构、接口、设计和安全约定；排期、成本、风险在仓库外的计划文件里。任务见 TASKS.md 的 MA 段，决策见 DECISIONS.md。

## 0. 已定范围（2026-11-18 用户确认）

- 学生端完整版先上；企业端 v1.1 做轻量版；管理后台不进 App。
- 等 D3 的 Sdn Bhd 注册下来，用组织账号上架 Google Play。
- 没有 Google 服务的手机：官网提供同签名 APK；推送降级为邮件 + 打开 App 时拉取。
- iOS 这次不做（技术选型保留以后出 iOS 的可能）。
- App 内不出现任何购买入口或购买外链，只显示点数余额。

## 1. 现状盘点（对照代码）

| 项 | 现状 | 对 App 的影响 |
|---|---|---|
| Web 框架 | Next.js 16 App Router，React 19，Tailwind 4 | App 不能复用 DOM 组件，只能复用逻辑和文案 |
| 写操作 | 38 个 `use server` 文件，都用 `action()` 包装，返回 `ActionResult<T> = {ok,data}\|{ok:false,code}` | 原生端调不了 Server Action，**要补 JSON API**；错误码体系可以原样沿用 |
| 读操作 | 页面在 Server Component 里直接调 services | 同上 |
| Route Handler | 14 个，都用 `route()` 包装；**非 GET 请求强制校验 Origin** | App 的 Origin 是自定义 scheme，要给它单独开一条路（§4.1） |
| 业务层 | `src/server/services/*` 约 50 个，签名是 `(ctx,{userId,companyId?}, input)` | **可以直接复用**，这是这条方案成立的前提 |
| 校验 | zod 4，`src/schemas`、`src/server/schemas` | 不依赖 server-only 的 schema 可以直接给 App 共用 |
| 认证 | better-auth 1.7：邮箱密码 + email OTP + 2FA；Cookie 会话；Turnstile 挡在登录、注册、发 OTP、找回密码、重发验证 5 个端点 | 原生端把 Cookie 存进安全存储、手动带上（@better-auth/expo）；**Turnstile 在原生端换成 Play Integrity**（§4.1） |
| 国际化 | next-intl，`messages/zh.json` 和 `en.json` | App 用 `use-intl`（next-intl 的底层库），**直接读同一份 JSON** |
| 通知 | 站内 `Notification` 表 + 邮件（`notify.ts`，有每日上限），**没有任何推送** | 推送整条链路都要新建（§4.3） |
| 上传 | 只走 `/api/uploads/[purpose]`：简历 PDF，认证材料 PDF/PNG/JPEG，上限 10–11MB | App 直接用同一端点，只在这个端点放行 App Origin |
| PWA | 有 `manifest.ts`、`sw.js`（只做离线页） | 和 App 互不影响，保留 |
| 品牌 | `--brand: hsl(210 100% 40%)`（约 #0066CC），有深色模式，系统字体，"苹果风"克制设计 | App 沿用同一套 token |
| 学生页面 | `/s` 下 18 个页面：首页、职位列表/详情、企业列表/详情、投递、邀请、邀请同学、通知、建档引导、档案、简历、隐私（含导出）、学校认证、设置、联系方式 | App 的范围按这个清单裁剪（§5.3） |
| 企业页面 | `/e` 下 22 个页面，含计费 3 个 | v1.1 只做其中 8 个左右 |

---

## 2. 目标与范围

### 2.1 目标
1. 学生在 Android 上完成"注册 → 认证 → 建档 → 找职位 → 投递 → 跟进"的完整闭环，体验不输网页版。
2. **推送**：投递状态变化、企业邀请、认证结果能在 1 分钟内送达（有 Google 服务的手机）。
3. 不破坏任何现有红线：隐私序列化、额度扣减、点数账本、审计、PDPA。
4. 一套代码以后能出 iOS。

### 2.2 v1.0（学生版）范围

**包含**：注册、登录、2FA、找回密码、学校邮箱认证、建档引导、档案编辑、简历上传与解析草稿确认、职位搜索与筛选、职位详情（按额度）、投递与撤回、投递状态时间线、企业邀请的接受与拒绝、企业主页、通知中心、邀请同学（系统分享）、隐私设置（屏蔽企业、可见性）、数据导出申请、注销账号、语言切换、通知偏好、深色模式。

**不包含**（留在网页）：管理后台；所有计费页面；企业注册和企业认证材料提交（企业端 v1.1 也只做登录后的轻量功能）；JD 智能助手；文章 CMS。

### 2.3 v1.1（企业轻量版）范围
企业成员登录；工作台概览；职位列表（暂停/恢复，不在 App 里新建或编辑）；某职位的候选人列表与详情（只经 `talent-card` 序列化）；更新投递状态；发出和查看邀请；人才库搜索与解锁（扣点 1 次，有确认弹窗）；通知；点数余额（只读）。

---

## 3. 技术路线对比

| 方案 | 交付速度 | 体验 | 推送 | 上架风险 | 结论 |
|---|---|---|---|---|---|
| A. TWA（把 PWA 包成 App） | 1 周 | 网页 | 只有 Web Push，国行机不可用 | 中 | ✗ 只是换了个图标 |
| B. Capacitor 远程 URL | 2 周 | 网页 + 少量原生能力 | FCM | **高**（WebView 套壳） | ✗ |
| **C. Expo / React Native** | 10–12 周 | **原生** | FCM | 低 | **✓ 推荐** |
| D. Kotlin + Compose 纯原生 | 14–18 周 | 最佳 | FCM | 低 | ✗ 换语言，不能共享 TS 逻辑，iOS 要再写一遍 |

**选 C 的理由**：
- 全栈都是 TS：zod schema、错误码、i18n JSON 和类型都能共享。
- 团队靠 AI 协作开发，RN/Expo 的语料和工具链最成熟。
- 以后出 iOS 基本零成本。
- EAS 可以云构建、做 OTA 热更新，Windows 本机没有 Android Studio 也能出包。
- 要用 Kotlin 写的原生能力（Play Integrity、FLAG_SECURE）可以用 Expo Module 小量补上。

**关键选型**（每个新依赖按仓库规则先在 DECISIONS 记一行）：

| 用途 | 选型 | 备选 |
|---|---|---|
| 框架 | Expo SDK（动工时的最新稳定版）+ Expo Router（文件路由，心智和 Next 一致） | React Navigation 裸用 |
| 服务端状态 | TanStack Query（缓存、重试、分页、离线持久化） | SWR |
| 表单 | react-hook-form + zod resolver（共用 schema） | — |
| 认证客户端 | `@better-auth/expo`（server 插件 + expoClient）+ expo-secure-store；better-auth 要升到 ^1.7.25 | bearer 插件（MA0-T04 否决：Web 响应会多带 set-auth-token，接不上 2FA） |
| 国际化 | use-intl（读 `messages/*.json`） | i18next（要转换格式，不选） |
| UI | 自建组件 + 品牌 token；图标用 lucide-react-native（和 Web 同一套） | react-native-paper（Material 味太重） |
| 列表 | FlashList | FlatList |
| 推送 | expo-notifications + FCM v1 | Notifee |
| 文件 | expo-document-picker（SAF，**不申请存储权限**） | — |
| 错误监控 | @sentry/react-native（EU，沿用 scrubEvent 规则） | — |
| E2E | Maestro | Detox |
| 单测 | Jest + React Native Testing Library | — |

---

## 4. 架构与后端改造

```
┌──────────── Android App (mobile/) ────────────┐
│ Expo Router 页面 → TanStack Query → apiClient │
│   │ SecureStore(会话令牌)  │ FCM token        │
└───┼────────────────────────┼──────────────────┘
    │ HTTPS  cookie(SecureStore)  expo-origin  X-App-Version
    ▼
Caddy (TLS) ─► Next.js
   ├─ /api/auth/*        better-auth（+ expo 插件，Play Integrity 替代 Turnstile）
   ├─ /api/m/v1/*        新增：mobileRoute() → 现有 services（零业务逻辑）
   ├─ /api/uploads/*     现有，放行 App Origin
   └─ /.well-known/assetlinks.json   新增（App Links）
            │
            ▼
   services/* ── Prisma ── PostgreSQL
            │
   worker (pg-boss) ── 新增 push 任务 ──► FCM HTTP v1
```

**原则**：`/api/m/v1` 的每个 handler 只做四件事：鉴权、zod 校验、调 service、序列化。**不在这一层写业务判断**。这样 Web 和 App 永远走同一套规则，防泄漏测试也能直接覆盖到 App。

### 4.1 认证

1. **会话载体**：
   - 用官方 `@better-auth/expo`（MA0-T04 结论，不用 bearer 插件）：App 把服务端下发的 Cookie 存进 expo-secure-store（Android Keystore 加密），之后手动带上 `cookie` 和 `expo-origin` 头，fetch 设成 `credentials: 'omit'`。
   - Web 的 Cookie 配置一行不动；CLAUDE.md 的约束继续生效：不关 useSecureCookies、不开 cookieCache、trustedOrigins 不用通配符。
   - App 的来源标识是各变体的自定义 scheme，用 `MOBILE_APP_ORIGINS` 配置，每个环境**只放自己那个精确值**。
   - App 发出的请求永远不传自定义 scheme 的 callbackURL，否则 expo 插件会把 Cookie 拼进跳转 URL，被抢注同一 scheme 的 App 截获。
2. **CSRF / Origin**：
   - 给 `route()` 加 `origin: 'app'` 选项（不另写包装器，保住"route.ts 只导出 route(...)"的架构测试）：会话从 Cookie 读，**Origin（或 expo-origin）必须精确等于 `MOBILE_APP_ORIGINS` 里的值**。浏览器不能伪造 Origin，所以这就是 CSRF 防线。
   - 现有 `route()` 的 Origin 校验保持不变。
   - `authz-matrix.test.ts` 加行，覆盖三条反例：浏览器 Origin → 403、没有 Origin → 403、前缀相同但不完全相等的 scheme → 403。
3. **人机校验**：
   - 原生端跑不了 Turnstile 小组件（能跑也只能塞 WebView，体验差）。
   - 方案：App 在 5 个受保护端点请求前先拿 **Play Integrity token**（标准请求，nonce 绑定请求摘要），服务端用 Google API 验证；判定条件是应用正版、设备可信、包名和签名证书一致。
   - 验证通过就视为 Turnstile 通过，失败时回退到 WebView 里的 Turnstile 页面。
   - 没有 Google 服务的手机拿不到 Integrity token，**也走 WebView Turnstile**。
   - 两条路径**共用同一套** better-auth 限流和 `getClientIp()`。
4. **2FA / OTP**：沿用现有接口；OTP 输入框开启 Android 自动填充（`textContentType=oneTimeCode` / autofill hints），但不读短信，也不申请短信权限。
5. **会话生命周期**：
   - 设置页显示"已登录设备"，可以单独注销某一台。
   - 改密码、注销账号时吊销该用户的所有会话和 DeviceToken；App 端同时清空 SecureStore 里的 Cookie 和会话缓存。
   - 退出登录时同时删除本机令牌，并在服务端注销 FCM token。
6. **重新同意条款**：
   - Web 靠 `proxy.ts` 重定向，App 没有这一层。
   - `/api/m/v1` 在需要时统一返回 `409 NEEDS_RECONSENT`，App 收到后全局弹出条款页；数据权利和注销的端点除外，规则和 Web 一致。

### 4.2 移动端 API v1（端点清单）

统一约定：
- 响应体：`{ ok: true, data } | { ok: false, code }`，错误码沿用 AppError。
- 分页：游标。
- 头部：`Cache-Control: private, no-store` 和 `X-Robots-Tag: noindex`。
- 请求头 `X-App-Version` 用于版本门控。
- 文案不由 API 返回，App 按 code 映射。

| 域 | 端点（示意） | 复用的 service |
|---|---|---|
| 配置 | `GET /config`：最低支持版本、功能开关、学校列表 | settings, feature-flags |
| 我 | `GET /me`，`PATCH /me/locale`，`GET/PUT /me/notification-prefs` | account |
| 建档 | `GET/PUT /profile`，教育/经历/语言的增删改，`GET /profile/completeness` | student-profile, profile |
| 简历 | `GET /resumes`，`POST /uploads/RESUME`（现有），`GET/POST /resume-drafts/:id/confirm` | resume, resume-parsing |
| 学校认证 | `POST /school-verification/send`，`POST /school-verification/confirm` | school-verification |
| 职位 | `GET /jobs?cursor&q&filters`（列表**不扣额度**）；`GET /jobs/:id/preview`（不扣）；`POST /jobs/:id/open`（**扣额度，显式调用**） | job-search, jobs, job-view-quota |
| 投递 | `POST /applications`，`GET /applications`，`GET /applications/:id/timeline`，`POST /applications/:id/withdraw` | applications |
| 邀请 | `GET /invitations`，`POST /invitations/:id/accept\|decline` | invitations |
| 企业 | `GET /companies`，`GET /companies/:id` | company-browse, public-showcase |
| 通知 | `GET /notifications`，`POST /notifications/read` | notifications |
| 邀请同学 | `GET /referrals/me`（邀请码、解锁进度） | referrals |
| 隐私 | `GET/PUT /privacy`，屏蔽企业，`POST /data-requests/export`，`POST /account/delete` | privacy, data-rights |
| 设备 | `POST /devices`（注册 FCM token），`DELETE /devices/:id` | 新增 device-tokens |
| 企业端（v1.1） | `/e/jobs`，`/e/jobs/:id/applicants`，`/e/applications/:id/status`，`/e/talent?cursor`，`/e/talent/:id/unlock`，`/e/invitations`，`/e/wallet` | applicants, talent-search, unlock, credits(只读), invitations |

**额度相关的硬性规则**：Web 要求"指向计数页面的 Link 设 `prefetch={false}`"，App 对应的写法是：**任何会计数的端点只能由用户点击触发**，TanStack Query 对这类端点禁止预取和自动重取。这一条写进 lint 规则或代码评审清单，并补一条 E2E："划过列表 50 条，额度不变"。

**契约**：
- 用 zod 4 的 `toJSONSchema` 生成 OpenAPI 文档。
- App 端的类型直接 import 共享 schema，不手写。
- vitest 契约测试覆盖每个端点的 200、401、403 和 zod 400。

### 4.3 推送（新链路）

**数据模型**（新 migration，只做 expand）：
- `DeviceToken`：id、userId（带索引）、platform、tokenHash、tokenEnc、appVersion、locale、lastSeenAt、createdAt、revokedAt。
  - **token 用 `encryptField` 加密存储（带 AAD）**，另存 sha256 哈希用于去重。
- `PushDelivery`（可选，用于排查和限频）：notificationId、deviceTokenId、status、error、sentAt。

**流程**：
1. 现有 `createNotification` 落库、事务提交后，投递一个 pg-boss 任务 `push.send`。
   - 遵守"事务里不发 HTTP"：推送一定在提交之后、在 worker 里发。
2. worker 查出该用户的有效设备，按偏好过滤，调 FCM HTTP v1。服务账号 JSON 只放服务器 `/opt/findmyjob/secrets/`。
3. FCM 返回 UNREGISTERED 时，吊销对应 token。

**内容规则**：
- **推送正文是锁屏可见的 PII 外泄面**，只放类型化的通用文案，例如"你的投递有新进展"。
- 不放企业名以外的任何信息；学生侧连企业名都默认不放，设置里可以打开"锁屏显示详情"。
- 企业侧推送绝不包含学生姓名或联系方式。
- data 字段只放 `{type, id}`，App 收到后自己拉详情。

**偏好与频率**：分类开关（投递进展、邀请、认证结果、营销——营销默认关，和 marketing-consent 联动）；静默时段 23:00–08:00（马来西亚时间）；同类通知合并。

**没有 Google 服务的手机**：拿不到 FCM，靠邮件（现有）、App 回到前台时拉取通知、通知 tab 的角标兜底。设置页提示"你的手机不支持推送，重要消息会发到邮箱"。

**Android 13+ 运行时权限**：**不在首次启动时申请**。在用户第一次投递成功之后提示："开启通知，第一时间收到企业回复"，再弹系统授权。

### 4.4 深链（App Links）
- 新增 `GET /.well-known/assetlinks.json`，写入包名和签名证书 SHA-256（Play App Signing 的证书和上传证书都要写）。
- intent-filter 覆盖 `https://findmyjob.asia/{zh,en}/` 下的：`s/jobs/:id`、`jobs/:id`、`s/invitations`、`s/applications`、`s/invite?code=`、邮件验证/重置密码链接、`e/...`（v1.1）。
- 没装 App 的人点链接，照常打开网页，零影响。
- 邮件里的链接不改，App Links 自动接管。
- 带一次性令牌的链接（验证、重置密码）在 App 里处理完立刻从导航栈清掉，不进日志，也不进 Sentry breadcrumb。

### 4.5 版本与发布控制
- `GET /config` 返回 `minSupportedVersion` 和 `latestVersion`：低于最低版本强制更新，低于最新版本只做软提示。
- JS 层的修复用 EAS Update（OTA）推送，原生层的改动走商店。OTA 只推同一 runtimeVersion，**不用 OTA 改权限或原生行为**（Play 政策 ⚠️）。
- 服务端 API 只增不删。v1 存续期间不做破坏性改动；真要破坏，就开 v2 并行，等 v1 用户低于 5% 再下线。

### 4.6 其他后端小改
- `/api/uploads/[purpose]` 用 `route()` 的 `allowAppOrigin` 选项放行 App Origin，校验逻辑一字不改。
- 账号注销：Play 要求 **App 内能注销，而且有网页注销入口**（⚠️）。现有 data-rights 流程要补一个公开的注销说明页 URL，填进 Play Console。
- `env.example` 和 `src/env.ts` 新增 `FCM_PROJECT_ID`、`FCM_SERVICE_ACCOUNT_PATH`、`PLAY_INTEGRITY_*`、`ANDROID_CERT_SHA256`、`MOBILE_MIN_VERSION`。

---

## 5. 产品与交互设计（Android 端）

### 5.1 设计原则
1. **品牌一致，平台原生**：沿用 Web 的品牌蓝、灰阶、圆角和"苹果风"克制感。交互遵守 Android 习惯：系统返回手势、预测性返回动画、底部导航、FAB 少用。
2. **单手、拇指优先**：主操作放在屏幕下 1/3（底部固定操作栏）；触控目标 ≥ 48dp（比 Web 的 24px 更严）。
3. **信任感**：认证企业徽章、额度和点数这类"会花掉东西"的操作一律有确认步骤，并显示剩余量；防骗提示在投递前出现。
4. **弱网友好**：骨架屏代替菊花；列表缓存秒开；离线时有横幅提示，写操作排队或禁用（**投递不做离线排队**，必须在线确认）。

### 5.2 设计 token（从 `globals.css` 映射）

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| brand | hsl(210 100% 40%) ≈ #0066CC | hsl(210 100% 62%) | 主按钮、链接、选中态 |
| brand-muted | hsl(210 100% 96%) | 按 Web 深色值 | 标签底色 |
| primary | hsl(240 3% 12%) | hsl(210 40% 98%) | 标题文字 |
| 圆角 | 卡片 16，按钮 12，标签 999 | 同 | |
| 字体 | 系统字体（中文：Noto Sans CJK / 厂商字体），**跟随系统字号缩放，测到 200%** | | |
| 间距 | 4 的倍数；页面左右 16dp | | |

- 状态色（成功/警告/错误）直接取 Web 现有值。
- 对比度用 axe 规则手工核对（大字门槛 24px / 粗体 18.66px，和 CLAUDE.md 一致）。
- 实现：`mobile/src/theme/tokens.ts`；并写一个脚本从 `globals.css` 抽取，防止两边漂移。

### 5.3 信息架构

**学生端底部导航（4 个）**

| Tab | 内容 |
|---|---|
| 首页 | 推荐职位、档案完成度卡片、额度卡片、邀请同学入口、防骗提示 |
| 职位 | 搜索框 + 筛选（地区/州、行业、类型、语言、薪资公开）、列表、企业 tab 切换 |
| 投递 | 分段：进行中 / 已结束 / 收到的邀请 |
| 我的 | 档案与简历、学校认证、隐私、通知偏好、语言、设置、帮助与防骗、关于 |

顶栏右侧放通知铃铛（带角标）。

**企业端底部导航（v1.1，4 个）**：工作台 / 职位与候选人 / 人才库 / 我的（团队、余额只读、设置）。一个账号如果同时是学生和企业成员（理论上不该有），按 `/me` 的角色进入对应外壳。

### 5.4 页面清单（学生 v1.0）

| # | 页面 | 关键内容与交互 | 状态设计 |
|---|---|---|---|
| S01 | 启动/欢迎 | 品牌页 → 2–3 张价值卡（"Finding my Job While Studying in Malaysia"）→ 注册/登录 | 首装才展示 |
| S02 | 注册 | 邮箱、密码、同意条款（勾选，链接到条款页）；人机校验无感（Integrity） | 注册名额满（signup-cap）有专门提示 |
| S03 | 邮箱验证 OTP | 6 位输入、自动填充、60 秒重发倒计时 | 错误/过期/次数用尽 |
| S04 | 登录 / 2FA / 找回密码 | 与 Web 同流程 | 账号锁定提示 |
| S05 | 建档引导（Stepper） | 基本信息 → 教育 → 语言 → 求职意向 → 简历（可跳过） | 每步可存草稿；进度条 |
| S06 | 学校认证 | 选学校 → 学校邮箱 → OTP | 未开通学校时提示 |
| S07 | 首页 | §5.3 | 空态："完善档案获得更准推荐" |
| S08 | 职位列表 | 卡片：职位、企业（认证徽章）、地点、类型、薪资（公开才显示）；下拉刷新；无限滚动 | 无结果给出放宽筛选的建议 |
| S09 | 筛选 Sheet | 底部抽屉，多选 chip，"显示 N 个结果"按钮 | 中文输入法组字期间不触发搜索（对应 `isImeComposing`） |
| S10 | 职位预览 → 详情 | 预览不扣额度；"查看完整详情（剩余 X 次）"按钮，点击才扣；已投递或被邀请的职位不扣（和 Web 的 9bc0095 修复一致） | 额度用完 → 引导邀请同学 |
| S11 | 投递确认 | 选简历 → 检查档案完整度（application-readiness）→ 防骗提示 → 确认 | 不满足条件时列出缺项并给跳转 |
| S12 | 我的投递 | 列表 + 状态 chip | |
| S13 | 投递详情 | 状态时间线（ApplicationEvent）、撤回 | |
| S14 | 邀请 | 企业邀请卡片：接受/拒绝（拒绝原因可选） | 已过期 |
| S15 | 企业列表/主页 | Logo、简介、在招职位、认证标识、标签 | |
| S16 | 通知中心 | 分组、全部已读、点击深链到对应页 | |
| S17 | 档案编辑 | 分区卡片，单区编辑；完成度实时更新 | |
| S18 | 简历 | 上传 PDF（SAF 选择器）、解析草稿逐项确认、设为默认、删除 | 上传进度、文件过大或格式不对 |
| S19 | 邀请同学 | 邀请码 + 系统分享 Sheet（WhatsApp、微信、复制） | 解锁进度 |
| S20 | 隐私 | 档案可见性、屏蔽企业（搜索添加）、数据导出（申请与下载）、注销账号（二次确认） | |
| S21 | 设置 | 语言（中/英，立即生效）、通知偏好与静默时段、深色模式（跟随系统/浅/深）、已登录设备、退出 | |
| S22 | 条款重新同意 | 全屏，阻断式 | |
| S23 | 强制更新 / 维护 / 离线 | 全局状态页 | |
| S24 | 帮助与防骗 | 复用 safety 页内容（API 下发 Markdown） | |

企业 v1.1 页面（E01–E10）在 MA4 开工前单独出线框，先不展开。

### 5.5 关键流程

1. **首用闭环**：安装 → S01 → S02 → S03 → S05（可跳过的步骤可后补）→ S06 → S07 → 第一次投递 → 请求通知权限。
   - 目标：首次投递在 5 分钟内完成。
   - 埋点只记事件名和内部 ID，不带 PII。
2. **推送 → 深链**：锁屏通知"你收到一个面试邀请" → 点开 →（会话过期就先登录，登录后回到原目标）→ S14 → 接受 → 状态同步到投递 tab。
3. **额度**：列表 → S10 预览 → 点"查看完整详情" → 确认扣 1 次 → 详情；额度不足 → S19。
4. **离线**：打开 App 时缓存的列表和档案立即可见；顶部横幅显示"离线"；投递、上传按钮禁用并说明原因。

### 5.6 Android 平台细节清单
- **edge-to-edge**：状态栏和导航栏透明，内容避开系统栏 inset。⚠️ 新版 targetSdk 已强制 edge-to-edge。
- **预测性返回**：在建档 Stepper 中按返回，先确认是否放弃未保存的修改。
- **最小适配宽度 360dp**（Web 是 375px）；测试小屏、折叠屏和平板横屏（布局不崩即可，不专门优化）。
- **字体缩放到 200%** 不截断、不重叠。
- **TalkBack**：所有图标按钮有 contentDescription（中英）；列表卡片合并为一个可读单元。
- **权限**：只申请"通知"一项（Android 13+）。不要存储、相机、定位、通讯录权限。
- **分享**：职位分享出去的是网页 URL（App Links 可回流）。
- **截屏**：简历预览和企业端候选人详情页开启 FLAG_SECURE ⚠️（先评估：学生截自己的简历很正常，可能只在企业端开）。
- **国产 ROM**：后台被杀后冷启动要快（目标 < 2 秒到首屏骨架）；不依赖后台常驻。
- **包体积**：目标 AAB 下载 < 25MB；启用 R8 混淆，启用 Hermes。

---

## 6. 安全与隐私（PDPA + 仓库红线映射）

| 红线 | App 端的落实 |
|---|---|
| 隐私序列化 | 企业端 API 只返回 `talent-card` 序列化结果；联系方式只经 `contact-access`；防泄漏测试覆盖 `/api/m/v1/e/*` |
| 点数 | 解锁走现有 `unlock` → `applyLedgerEntry` 事务；App 只展示结果 |
| 额度 | 只经 `job-view-quota`；计数端点只能由用户点击触发（§4.2） |
| 权限 | companyId 只来自 `requireCompanyMember()`；API 永远不接收客户端传来的 companyId 或 userId |
| 校验 | 每个端点都用 zod 校验；App 端也校验，只为体验，不作为安全边界 |
| 审计 | ARCHITECTURE §5.7 里的动作经 App 触发时照样写 AuditLog，metadata 加 `client: 'android'` |
| 本地存储 | 令牌放 SecureStore；查询缓存（MMKV/AsyncStorage）**不持久化联系方式、简历文件和导出包**；退出登录时清空全部缓存 |
| 日志 | 生产包移除 console；Sentry RN 设 `sendDefaultPii:false`，beforeSend 复用 scrubEvent 规则，不开 Replay |
| 传输 | 只走 HTTPS（`usesCleartextTraffic=false`）；先不做证书固定（证书轮换的风险大于收益），在威胁模型里记一条已接受风险 |
| 逆向 | R8 混淆；App 内不放任何秘密（Integrity 的验证在服务端）；`google-services.json` 是公开配置，不算秘密 |
| 截屏与最近任务缩略图 | 见 §5.6 |
| 跨境 | FCM 是新的子处理者（Google），要写进 SUBPROCESSORS 和隐私政策，**交给律师（D10）**；推送内容最小化 |
| Play 数据安全表单 | 按实际收集的项填写：邮箱、姓名、教育、简历、设备 ID（FCM token）、崩溃日志；在传输中加密；可申请删除 |

在 `docs/security/threat-model.md` 新增"移动端"一节：令牌被盗、深链劫持、恶意重打包、锁屏泄露、共享手机、Integrity 绕过。

---

## 7. 质量与测试

| 层 | 工具 | 门槛 |
|---|---|---|
| API 契约与权限 | vitest（沿用现有测试库机制） | 每个端点 200/401/403/400；authz-matrix 加行；防泄漏测试 |
| App 单测 | Jest + RNTL | 业务 hook、表单校验、错误码映射；覆盖率 ≥ 70%（只算 `mobile/src/lib`、`mobile/src/features`） |
| App E2E | Maestro（模拟器 + 1 台真机） | 6 条主路径：注册→认证、建档、搜索→预览→扣额度、投递、邀请接受、注销 |
| 推送 | 在 staging 用真机实测 | 送达 < 60 秒；锁屏文案不含 PII |
| 无障碍 | Android Accessibility Scanner + TalkBack 走查 | 0 个严重问题 |
| 性能 | Android Studio Profiler / Perfetto | 冷启动 < 2 秒（中端机）、列表滚动 60fps、内存 < 200MB |
| 兼容 | 真机/云测矩阵 | 见下表 |

**设备矩阵**（覆盖马来西亚留学生的常见机型）：

| 档位 | 代表机型 | 系统 |
|---|---|---|
| 低端 | Samsung Galaxy A1x、Redmi 低端机 | Android 11–13 |
| 中端 | Samsung A5x、Redmi Note、OPPO/vivo 中端 | Android 13–15 |
| 高端 | Pixel、Samsung S 系列 | Android 15–16 |
| 无 GMS | 国行小米/华为（验证 APK 直装 + 推送降级） | — |

最低支持版本：**Android 8.0（API 26）** ⚠️，以 Expo SDK 的最低要求为准。

**环境**：
- App 有三个构建变体：`dev`（连本机 3020 的 ergo 环境）、`staging`（连 findmyjob.asia）、`prod`（以后正式主机上线时启用）。
- **每个变体的包名不同**，可以在同一台手机上并存。
- 全程只用合成数据（faker，邮箱只用 example.test），和仓库规则一致。

---

## 8. 发布与分发

1. **开发者账号**：
   - Play Console 注册费一次性 25 美元 ⚠️。
   - 组织账号需要 D-U-N-S 编码（免费，申请需要几天到几周），**依赖 D3 公司主体**。
   - 个人账号要求：封闭测试 ≥ 12 名测试者连续 14 天，之后才能申请正式发布 ⚠️（2023-11 之后创建的个人账号适用）。
2. **签名**：
   - 用 Play App Signing。
   - 上传密钥离线备份两份（加密 U 盘 + 密码管理器），**不放进仓库，也不放进任何 AI 会话**。
   - 官网 APK 用 Play 分发的同一签名，或者单独说明不能互相覆盖安装 ⚠️（见 Q3）。
3. **轨道**：internal（自己和合伙人）→ closed（试点学生 20–50 人）→ production（分阶段放量 10% → 50% → 100%）。
4. **商店素材**：
   - 中英两套标题和描述。
   - 截图 4–8 张，只用合成数据，不出现任何真实公司名（D12）。
   - 512 图标沿用 `public/icons`，另做 Android 自适应图标（前景 + 背景两层）。
   - 隐私政策 URL、注销说明 URL、内容分级问卷、目标受众 18 岁以上。
5. **target SDK**：按 Play 当年要求的最新 API 级别 ⚠️（2026 年下半年很可能要求 API 36）。
6. **官网 APK**：在 `findmyjob.asia/app` 放下载页，附 SHA-256 校验值；App 内更新检查走 `/config`。
7. **构建方式**：
   - EAS Build 云构建（免费档有排队，必要时按月付费）。
   - 或者 GitHub Actions 自建：按 CI 规则，uses 固定 SHA，不引用 secrets；签名在 EAS 或本机完成，CI 只做 lint、test 和 debug 构建。
8. **部署联动**：后端的移动 API 照常走 ship.sh 上 staging（按 11-12 的长期授权，验证通过后直接部署）。App 发布不动服务器。

---

