# FindMYJob 移动端 API v1（学生端）

前缀 `/api/m/v1`。本文件随 MA1-T04～T07 生成，端点以代码为准；新增端点时同步更新这里和 `tests/integration/mobile-reconsent.test.ts` 的表格（那张表漏登记时测试会失败）。

## 通用约定

| 项 | 规则 |
|---|---|
| 来源 | 每个端点都是 `route({ origin: 'app' })`：`Origin`（或没有 Origin 时的 `expo-origin`）必须精确等于 `MOBILE_APP_ORIGINS` 里的值，否则 403 `FORBIDDEN`。浏览器 Origin、前缀相同的仿冒 scheme、没有来源头，一律 403 |
| 版本 | 必须带 `x-app-version: MAJOR.MINOR.PATCH`；低于 `mobile.minSupportedVersion`（或缺失、格式不对）返回 426 `APP_UPDATE_REQUIRED` |
| 会话 | @better-auth/expo：App 手动带 `cookie`，`credentials: 'omit'`。没有 Cookie 时 proxy 先返回 401；Cookie 失效、账号停用、角色不对时返回 403 `FORBIDDEN` |
| 重新同意 | 已登录、但没有同意当前版本条款和隐私政策时返回 409 `NEEDS_RECONSENT`（豁免见下表"同意"列）。App 收到后弹出条款页，同意后调 `POST /legal/reconsent` |
| 响应 | 成功 `{ ok: true, data }`，失败 `{ ok: false, code }`；`code` 见 `src/shared/mobile-api/error-codes.ts`，文案由 App 按 code 映射 |
| 校验 | 请求体和查询串都用 zod；新增端点的 schema 是 strict，多余字段返回 400 `VALIDATION_ERROR`；请求体不是 JSON 返回 400 `INVALID_JSON`；路径里的 id 不是 cuid 返回 400 `VALIDATION_ERROR`。service 层的业务校验失败（如学校邮箱域名不符）返回 422 `VALIDATION_ERROR` |
| 头部 | 所有响应带 `Cache-Control: private, no-store` 和 `X-Robots-Tag: noindex, nofollow` |
| 时间 | ISO 8601 字符串（UTC），App 按 Asia/Kuala_Lumpur 展示 |
| 分页 | 游标：`?cursor=<上一页 nextCursor>`，`nextCursor: null` 表示没有下一页 |
| 审计 | Web 会写的审计，经 App 触发时照样写，metadata 额外带 `client: 'android'`（route() 在 App origin 校验通过后标记请求来源，logAudit 自动补上） |
| 契约 | 响应 schema 在 `src/shared/mobile-api/contracts.ts` 和 `student-contracts.ts`，请求 schema 在 `student-inputs.ts`；服务端返回前会用契约 parse 一遍，丢掉多余字段 |

"认证"列：`公开` 不需要登录；`用户` 任何已登录的有效账号；`学生` 只允许学生（企业账号 403）。"同意"列：`检查` 表示需要重新同意时返回 409；`豁免` 表示照常可用。

## 端点

### 启动与账号

| 方法 | 路径 | 认证 | 同意 | 输入 | 输出（契约） | 说明 |
|---|---|---|---|---|---|---|
| GET | `/config` | 公开 | — | — | `mobileConfigSchema` | 最低版本、最新版本、当前条款版本 |
| GET | `/me` | 用户 | 豁免 | — | `mobileMeSchema` | 本人 id、角色、姓名、邮箱、语言 |
| POST | `/legal/reconsent` | 用户 | 豁免 | `mobileReconsentSchema`：`{ agreed: true, version }` | `mobileEmptySchema` | 记录 TERMS 和 PRIVACY 两条同意（带 IP 和 UA），写 `user.reconsent` 审计；version 不是当前版本时 409 `VERSION_MISMATCH` |
| PATCH | `/me/locale` | 用户 | 检查 | `mobileLocaleSchema`：`{ locale: 'zh' \| 'en' }` | `mobileLocaleResultSchema` | 与 Web 设置页相同 |
| GET | `/me/notification-prefs` | 学生 | 豁免 | — | `mobileNotificationPrefsSchema` | 目前只有每周职位周报（MARKETING 同意） |
| PUT | `/me/notification-prefs` | 学生 | 豁免 | `marketingConsentSchema`：`{ granted: true, submittedVersion }` 或 `{ granted: false }` | `mobileNotificationPrefsSchema` | 写 Consent 和 `marketing.consent` 审计；周报未开放时开启返回 `FEATURE_DISABLED` |

### 建档

| 方法 | 路径 | 认证 | 同意 | 输入 | 输出 | 说明 |
|---|---|---|---|---|---|---|
| GET | `/profile` | 学生 | 检查 | — | `mobileProfileSchema` | 档案全部可编辑字段，不含联系方式和学校邮箱 |
| GET | `/profile/completeness` | 学生 | 检查 | — | `mobileProfileCompletenessSchema` | 完成度和待办（学校认证、简历、联系方式、人才库） |
| PUT | `/profile/basic` | 学生 | 检查 | `step1Schema`（服务端 student-profile） | `mobileEmptySchema` | 基本信息；换学校会清掉学校认证 |
| PUT | `/profile/preferences` | 学生 | 检查 | `step2Schema` | `mobileEmptySchema` | 求职意向 |
| PUT | `/profile/skills` | 学生 | 检查 | `step3Schema` | `mobileEmptySchema` | 语言（整组替换）、技能、介绍 |
| PUT | `/profile/experience` | 学生 | 检查 | `step4Schema` | `mobileEmptySchema` | 教育和经历（整组替换，sortOrder 决定顺序） |
| GET | `/schools` | 学生 | 检查 | — | `mobileSchoolListSchema` | 启用中的学校和邮箱域名 |
| POST | `/school-verification/send` | 学生 | 检查 | `{ schoolId, schoolEmail }` | `mobileEmptySchema` | 发 OTP 到学校邮箱；每小时、每邮箱每天限次，超限 429 |
| POST | `/school-verification/confirm` | 学生 | 检查 | `{ otp }` | `mobileEmptySchema` | 错 5 次锁 30 分钟（429） |
| POST | `/onboarding/complete` | 学生 | 检查 | — | `mobileEmptySchema` | Web 新手引导最后一步：前四节没填完 422，缺联系方式 `CONTACT_REQUIRED`，缺简历 `RESUME_REQUIRED`（MA1-T08） |

step1~4 的请求 schema 在 `src/shared/mobile-api/profile-inputs.ts`（MA1-T08 起 Web 与 App 共用）。

### 简历与联系方式（MA1-T08）

| 方法 | 路径 | 认证 | 同意 | 输入 | 输出 | 说明 |
|---|---|---|---|---|---|---|
| GET | `/resumes` | 学生 | 检查 | — | `mobileResumeListSchema` | 本人简历（主简历在前），不含存储 key |
| POST | `/resumes/:id/primary` | 学生 | 检查 | — | `mobileEmptySchema` | 别人的简历 403，不存在 404 |
| DELETE | `/resumes/:id` | 学生 | 检查 | — | `mobileEmptySchema` | 删库后清理存储全部版本；别人的简历 403 |
| GET | `/contact` | 学生 | 检查 | — | `mobileContactSchema` | 本人联系方式明文（只经 contact-access；解密失败直接报错，不当成空值） |
| PUT | `/contact` | 学生 | 检查 | contact-access 的 `updateContactSchema` | `mobileContactSchema` | 整份提交，没带的字段清空；电话规范成 E.164，LinkedIn 只收 linkedin.com |

简历上传走现有的 `POST /api/uploads/RESUME`（multipart，`route({ origin: 'web+app' })`，MA1-T06），校验与 Web 完全相同。

### 职位（额度）

| 方法 | 路径 | 认证 | 同意 | 输入 | 输出 | 说明 |
|---|---|---|---|---|---|---|
| GET | `/jobs` | 学生 | 检查 | `mobileJobsQuerySchema`：`q, type, state, workMode, sort, cursor, industry, tags(逗号分隔), size, salary` | `mobileJobPageSchema` | 与 Web /s/jobs 同一个 searchJobs，每页 20 条；**不扣额度**；隐藏薪资为 null |
| GET | `/jobs/:id/preview` | 学生 | 检查 | — | `mobileJobPreviewSchema` | 列表级字段 + `opensFree` + 当前额度；**不建 JobView、不扣额度** |
| POST | `/jobs/:id/open` | 学生 | 检查 | — | `mobileJobOpenSchema` | **唯一扣额度的端点**，只经 job-view-quota 的 openJob：投过、被邀请过的职位不扣，同一职位重复打开不重复扣；额度用完时 `allowed: false`、`detail: null`。附带投递状态、投递阻碍和简历列表 |

App 端硬性规则：`open` 只能由用户点击触发，查询层不得预取或自动重取（MOBILE.md §4.2）。

### 投递与企业邀请

| 方法 | 路径 | 认证 | 同意 | 输入 | 输出 | 说明 |
|---|---|---|---|---|---|---|
| GET | `/applications` | 学生 | 检查 | — | `mobileApplicationListSchema` | 本人全部投递（与 Web 一样不分页，nextCursor 恒为 null） |
| POST | `/applications` | 学生 | 检查 | `mobileApplySchema`：`{ jobId, resumeId?, coverNote? }` | `mobileApplicationRefSchema` | 与 Web 投递同一个 applyToJob：完成度不足 `COMPLETENESS_LOW`，缺联系方式 `CONTACT_REQUIRED`，缺简历 `RESUME_REQUIRED`，重复 409 `DUPLICATE_APPLICATION`，没打开过也没被邀请（且额度有限）返回 404 |
| GET | `/applications/:id/timeline` | 学生 | 检查 | — | `mobileApplicationTimelineSchema` | 状态变更；企业内部备注和操作人永远不给 |
| POST | `/applications/:id/withdraw` | 学生 | 检查 | — | `mobileEmptySchema` | 只能撤回自己的投递，幂等 |
| GET | `/invitations` | 学生 | 检查 | — | `mobileInvitationListSchema` | 企业发来的邀请，隐藏薪资为 null |
| POST | `/invitations/:id/accept` | 学生 | 检查 | — | `mobileApplicationRefSchema` | 等于投递该职位（走 applyToJob 的全部校验），不扣查看额度 |
| POST | `/invitations/:id/decline` | 学生 | 检查 | — | `mobileEmptySchema` | 已回复过返回 403 |

### 企业、通知、邀请同学

| 方法 | 路径 | 认证 | 同意 | 输入 | 输出 | 说明 |
|---|---|---|---|---|---|---|
| GET | `/companies` | 学生 | 检查 | `{ tag?, cursor? }` | `mobileCompanyPageSchema` | 已认证且有效的企业，每页 24 条 |
| GET | `/companies/:id` | 学生 | 检查 | `{ jobsCursor? }` | `mobileCompanyDetailSchema` | 企业介绍和在招职位（每页 20 条）；网址只给 http(s) |
| GET | `/notifications` | 学生 | 检查 | `{ cursor? }` | `mobileNotificationPageSchema` | 每页 50 条，只给 type 和时间（不给 payload），另给 unreadCount；游标必须是自己的通知 |
| POST | `/notifications/read` | 学生 | 检查 | `{ ids: cuid[1..50] }` 或 `{ all: true }` | `mobileEmptySchema` | 只改自己的通知 |
| GET | `/referrals/me` | 学生 | 检查 | — | `mobileReferralsSchema` | 邀请码、邀请链接（用 APP_URL 拼）、额度和阶梯设置；被邀请人只给打码名和完成度 |

### 隐私与数据权利（全部豁免重新同意，与 Web /s/privacy 一致）

| 方法 | 路径 | 认证 | 同意 | 输入 | 输出 | 说明 |
|---|---|---|---|---|---|---|
| GET | `/privacy` | 学生 | 豁免 | — | `mobilePrivacySchema` | 人才库开关、已屏蔽企业、近 90 天谁看过我、谁解锁过我 |
| PUT | `/privacy` | 学生 | 豁免 | `{ granted: boolean }` | `mobileEmptySchema` | 人才库开关：开启要求已同意当前版本条款（否则 403），关闭随时可以；写 TALENT_POOL Consent 和 `student.visibility.change` 审计 |
| GET | `/privacy/companies` | 学生 | 豁免 | `{ query }` | `mobileCompanySearchSchema` | 按名称搜已认证企业（最多 20 条），用于屏蔽 |
| POST | `/privacy/blocked-companies` | 学生 | 豁免 | `{ companyId }` | `mobileEmptySchema` | 写 `student.block_company` 审计 |
| DELETE | `/privacy/blocked-companies/:companyId` | 学生 | 豁免 | — | `mobileEmptySchema` | 写 `student.unblock_company` 审计 |
| POST | `/data-requests/export` | 学生 | 豁免 | `{}` | `mobileDataExportSchema` | 24 小时内去重（`existing: true`）；写 `data.export` 审计；导出包在 Web 隐私中心下载，App 不缓存 |
| POST | `/account/delete` | 学生 | 豁免 | `{ confirm: true }` | `mobileEmptySchema` | 标记 DELETED、隐藏档案、吊销全部会话、写 `data.delete` 审计；App 收到后清空 SecureStore 和缓存 |

### 企业端 `/e/*`（MA4-T01）

"认证"列：`成员` = `{ type: 'company', minRole: 'RECRUITER' }`；`已认证成员` = 同上再加 `verified: true`（企业未认证返回 403）。companyId 只来自会话里的成员关系，请求里带 companyId 会被 strict schema 拒绝（400）。学生数据只来自 talent-card 序列化器：未解锁时 `name` 是打码名、自由文本已 redact，没有联系方式和简历 id。全部端点都检查重新同意。**没有任何购买、充值或账单端点。**

| 方法 | 路径 | 认证 | 输入 | 输出 | 说明 |
|---|---|---|---|---|---|
| GET | `/e/jobs` | 成员 | — | `mobileEmployerJobListSchema` | 本公司全部职位和投递数 |
| POST | `/e/jobs/:id/close` | 成员 | — | `mobileEmployerJobStatusSchema` | 关闭职位（Web 没有暂停/恢复）；草稿和被拒的 422，别家公司的 404 |
| GET | `/e/jobs/:id/applicants` | 已认证成员 | — | `mobileApplicantListSchema` | 不含已撤回；别家公司的职位 404 |
| GET | `/e/applications/:id` | 已认证成员 | — | `mobileApplicantDetailSchema` | **计数**：与 Web 看板点开候选人相同——只认本公司、非 WITHDRAWN 的投递（否则 404），`profile` 就是 `/e/talent/:studentId` 的 viewTalentProfile 输出（屏蔽或不在人才库 404，写 ProfileView 和 talent.view，每日查看上限 429，解锁后带联系方式）；求职信未解锁时 redact；另给 `studentId` |
| POST | `/e/applications/:id/status` | 已认证成员 | `{ toStatus, note? }` | `mobileEmptySchema` | 不能设 APPLIED/WITHDRAWN（422），已撤回 403，并发冲突 409；通知学生（不含备注） |
| POST | `/e/applications/:id/viewed` | 已认证成员 | — | `mobileEmptySchema` | APPLIED → VIEWED，其余情况 no-op |
| GET | `/e/invitations` | 成员 | — | `mobileCompanyInvitationListSchema` | 已发邀请（不可见的学生被过滤）和本月用量 |
| POST | `/e/invitations` | 已认证成员 | `{ studentId, jobId, message? }` | `mobileSendInvitationResultSchema` | 按 KL 自然月计额度（超额 429）；同一职位未过期的邀请幂等 |
| GET | `/e/talent` | 成员（服务端再查已认证） | `mobileTalentQuerySchema`：`cursor(页码), keyword, sort, schoolId, degreeLevel, gradFrom, gradTo, intents, workAuths` | `mobileTalentPageSchema` | **计数**：每次调用计入 `limits.searchPagesPerDay`（超了 429）；超过 `talentSearch.maxPage` 422 |
| GET | `/e/talent/:id` | 成员（服务端再查已认证） | — | `mobileTalentViewSchema` | **计数**：写 ProfileView 和 talent.view 审计，按成员和公司计每日查看上限（429）；解锁后带联系方式（写 contact.read）和简历 id |
| POST | `/e/talent/:id/unlock` | 已认证成员 | — | `mobileUnlockResultSchema` | CREDIT 锁事务内 applyLedgerEntry 扣点；已解锁的不重复扣；点数不足 402；返回扣后余额 |
| GET | `/e/wallet` | 成员 | — | `mobileWalletSchema` | 余额只读，未认证为 null |

App 端硬性规则：`/e/talent`、`/e/talent/:id` 和 `/e/applications/:id` 会计数，和学生端的 `open` 一样只能由用户操作触发，查询层不预取、不自动重取。

### 推送（MA3 实现，这里只登记同意规则）

| 方法 | 路径 | 认证 | 同意 | 说明 |
|---|---|---|---|---|
| POST | `/devices` | 学生 | 检查 | 注册 FCM token，见 MA3-T01 |
| DELETE | `/devices/:id` | 学生 | 豁免 | 退出登录时注销本机 token，不能被重新同意挡住 |
| GET / PATCH | `/push-preferences` | 学生 | 检查 | 推送偏好，见 MA3-T02 |

## 没有做的（不在 MA1-T04～T07 范围）

- 简历解析草稿（`/resume-drafts/*`）。
- 企业端的备注修改、通知列表（MA4-T01 清单外）。
- OpenAPI JSON：未生成。本文件和共享 zod 契约已经覆盖 App 的需要（App 直接 import schema 拿类型）；如需机器可读文档，可以对 `src/shared/mobile-api` 里的 schema 调 `z.toJSONSchema()` 生成。
