import 'server-only'

export interface EmailContent {
  subject: string
  html: string
  text: string
}

export type EmailTemplateName =
  | 'company-verification'
  | 'job-review'
  | 'application-status'
  | 'talent-unlocked'
  | 'invitation-received'
  | 'credits-granted'
  | 'credits-low'
  | 'daily-digest'
  | 'signup-cap-warn'
  | 'signup-attempt'

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function appUrl(): string {
  return process.env.APP_URL ?? 'https://findmyjob.asia'
}

function wrap(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">${body}<hr style="margin-top:40px;border:none;border-top:1px solid #eee"><p style="font-size:12px;color:#888">FindMYJob · <a href="${esc(appUrl())}">findmyjob.asia</a></p></body></html>`
}

// ---- company-verification ------------------------------------------------

function companyVerificationZh(vars: { approved: boolean; reviewNote?: string }): EmailContent {
  const statusText = vars.approved ? '已通过认证' : '认证未通过'
  const body = vars.approved
    ? `<p>您好，</p><p>您的企业认证申请<strong>已通过</strong>。您现在可以在 <a href="${esc(appUrl())}/zh/e">FindMYJob 企业端</a>发布职位、搜索人才。</p>`
    : `<p>您好，</p><p>很遗憾，您的企业认证申请<strong>未通过</strong>。</p>${vars.reviewNote ? `<p>驳回原因：${esc(vars.reviewNote)}</p>` : ''}<p>如有疑问，请联系 FindMYJob 运营团队。</p>`
  return {
    subject: `FindMYJob 企业认证${vars.approved ? '通过' : '未通过'}`,
    html: wrap(body),
    text: `FindMYJob 企业认证${statusText}${vars.reviewNote ? `\n驳回原因：${vars.reviewNote}` : ''}`,
  }
}

function companyVerificationEn(vars: { approved: boolean; reviewNote?: string }): EmailContent {
  const body = vars.approved
    ? `<p>Hello,</p><p>Your company verification has been <strong>approved</strong>. You can now post jobs and search talent on <a href="${esc(appUrl())}/en/e">FindMYJob</a>.</p>`
    : `<p>Hello,</p><p>Unfortunately, your company verification was <strong>not approved</strong>.</p>${vars.reviewNote ? `<p>Reason: ${esc(vars.reviewNote)}</p>` : ''}<p>Please contact the FindMYJob team if you have questions.</p>`
  return {
    subject: `FindMYJob Company Verification ${vars.approved ? 'Approved' : 'Rejected'}`,
    html: wrap(body),
    text: `FindMYJob company verification ${vars.approved ? 'approved' : 'rejected'}${vars.reviewNote ? `\nReason: ${vars.reviewNote}` : ''}`,
  }
}

// ---- job-review ----------------------------------------------------------

function jobReviewZh(vars: { approved: boolean; jobTitle: string; reviewNote?: string }): EmailContent {
  const body = vars.approved
    ? `<p>您好，</p><p>您发布的职位「<strong>${esc(vars.jobTitle)}</strong>」已通过审核，现已对外公开。</p><p><a href="${esc(appUrl())}/zh/e/jobs">查看我的职位</a></p>`
    : `<p>您好，</p><p>您发布的职位「<strong>${esc(vars.jobTitle)}</strong>」审核未通过。</p>${vars.reviewNote ? `<p>驳回原因：${esc(vars.reviewNote)}</p>` : ''}<p>请修改后重新提交。</p>`
  return {
    subject: `FindMYJob 职位审核${vars.approved ? '通过' : '未通过'}：${vars.jobTitle}`,
    html: wrap(body),
    text: `FindMYJob 职位「${vars.jobTitle}」审核${vars.approved ? '通过' : '未通过'}${vars.reviewNote ? `\n原因：${vars.reviewNote}` : ''}`,
  }
}

function jobReviewEn(vars: { approved: boolean; jobTitle: string; reviewNote?: string }): EmailContent {
  const body = vars.approved
    ? `<p>Hello,</p><p>Your job posting "<strong>${esc(vars.jobTitle)}</strong>" has been approved and is now live.</p><p><a href="${esc(appUrl())}/en/e/jobs">View my jobs</a></p>`
    : `<p>Hello,</p><p>Your job posting "<strong>${esc(vars.jobTitle)}</strong>" was not approved.</p>${vars.reviewNote ? `<p>Reason: ${esc(vars.reviewNote)}</p>` : ''}<p>Please revise and resubmit.</p>`
  return {
    subject: `FindMYJob Job Review ${vars.approved ? 'Approved' : 'Rejected'}: ${vars.jobTitle}`,
    html: wrap(body),
    text: `FindMYJob job "${vars.jobTitle}" review ${vars.approved ? 'approved' : 'rejected'}${vars.reviewNote ? `\nReason: ${vars.reviewNote}` : ''}`,
  }
}

// ---- application-status --------------------------------------------------

const STATUS_LABEL_ZH: Record<string, string> = {
  VIEWED: '已查看',
  SHORTLISTED: '已入围',
  INTERVIEW: '面试邀请',
  OFFER: '已发 Offer',
  HIRED: '已录用',
  REJECTED: '未通过',
}

const STATUS_LABEL_EN: Record<string, string> = {
  VIEWED: 'Viewed',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  HIRED: 'Hired',
  REJECTED: 'Not selected',
}

function applicationStatusZh(vars: { jobTitle: string; toStatus: string }): EmailContent {
  const label = STATUS_LABEL_ZH[vars.toStatus] ?? vars.toStatus
  const body = `<p>您好，</p><p>您申请的职位「<strong>${esc(vars.jobTitle)}</strong>」投递状态更新为：<strong>${esc(label)}</strong>。</p><p><a href="${esc(appUrl())}/zh/s">查看我的投递</a></p>`
  return {
    subject: `FindMYJob 投递状态更新：${vars.jobTitle}`,
    html: wrap(body),
    text: `FindMYJob 投递「${vars.jobTitle}」状态更新为：${label}`,
  }
}

function applicationStatusEn(vars: { jobTitle: string; toStatus: string }): EmailContent {
  const label = STATUS_LABEL_EN[vars.toStatus] ?? vars.toStatus
  const body = `<p>Hello,</p><p>Your application for "<strong>${esc(vars.jobTitle)}</strong>" has been updated to: <strong>${esc(label)}</strong>.</p><p><a href="${esc(appUrl())}/en/s">View my applications</a></p>`
  return {
    subject: `FindMYJob Application Update: ${vars.jobTitle}`,
    html: wrap(body),
    text: `FindMYJob application "${vars.jobTitle}" updated to: ${label}`,
  }
}

// ---- talent-unlocked -----------------------------------------------------

function talentUnlockedZh(): EmailContent {
  const body = `<p>您好，</p><p>有企业查看了您的完整档案（联系方式已解锁）。</p><p>您可以在<a href="${esc(appUrl())}/zh/s/privacy">隐私中心</a>查看详情。</p>`
  return {
    subject: 'FindMYJob 有企业解锁了您的档案',
    html: wrap(body),
    text: '有企业解锁了您的档案。请前往隐私中心查看。',
  }
}

function talentUnlockedEn(): EmailContent {
  const body = `<p>Hello,</p><p>A company has unlocked your profile and can now view your contact details.</p><p>Visit your <a href="${esc(appUrl())}/en/s/privacy">Privacy Centre</a> for details.</p>`
  return {
    subject: 'FindMYJob — Your profile was unlocked',
    html: wrap(body),
    text: 'A company has unlocked your profile. Visit your Privacy Centre for details.',
  }
}

// ---- invitation-received -------------------------------------------------

function invitationReceivedZh(vars: { jobTitle: string; companyName: string }): EmailContent {
  const body = `<p>您好，</p><p><strong>${esc(vars.companyName)}</strong> 邀请您投递职位「<strong>${esc(vars.jobTitle)}</strong>」。</p><p><a href="${esc(appUrl())}/zh/s/invitations">查看邀请</a></p>`
  return {
    subject: `FindMYJob 您收到了一份邀请：${vars.jobTitle}`,
    html: wrap(body),
    text: `${vars.companyName} 邀请您投递职位「${vars.jobTitle}」。请前往 FindMYJob 查看邀请。`,
  }
}

function invitationReceivedEn(vars: { jobTitle: string; companyName: string }): EmailContent {
  const body = `<p>Hello,</p><p><strong>${esc(vars.companyName)}</strong> has invited you to apply for "<strong>${esc(vars.jobTitle)}</strong>".</p><p><a href="${esc(appUrl())}/en/s/invitations">View invitation</a></p>`
  return {
    subject: `FindMYJob — Invitation to apply: ${vars.jobTitle}`,
    html: wrap(body),
    text: `${vars.companyName} invited you to apply for "${vars.jobTitle}". Visit FindMYJob to view the invitation.`,
  }
}

// ---- credits-granted -----------------------------------------------------

function creditsGrantedZh(vars: { amount: number; balance: number }): EmailContent {
  const body = `<p>您好，</p><p>FindMYJob 已向您的账户发放 <strong>${esc(String(vars.amount))}</strong> 点数。当前余额：<strong>${esc(String(vars.balance))}</strong> 点。</p><p><a href="${esc(appUrl())}/zh/e">前往企业端</a></p>`
  return {
    subject: 'FindMYJob 点数已到账',
    html: wrap(body),
    text: `FindMYJob 已发放 ${vars.amount} 点数。当前余额：${vars.balance} 点。`,
  }
}

function creditsGrantedEn(vars: { amount: number; balance: number }): EmailContent {
  const body = `<p>Hello,</p><p>FindMYJob has granted <strong>${esc(String(vars.amount))}</strong> credit(s) to your account. Current balance: <strong>${esc(String(vars.balance))}</strong>.</p><p><a href="${esc(appUrl())}/en/e">Go to dashboard</a></p>`
  return {
    subject: 'FindMYJob — Credits granted',
    html: wrap(body),
    text: `FindMYJob granted ${vars.amount} credit(s). Current balance: ${vars.balance}.`,
  }
}

// ---- order-confirmed -----------------------------------------------------

function ringgit(sen: number): string {
  return (sen / 100).toFixed(2)
}

function orderConfirmedZh(vars: { amountSen: number }): EmailContent {
  const body = `<p>您好，</p><p>FindMYJob 已确认收到您的银行转账：<strong>RM ${esc(ringgit(vars.amountSen))}</strong>，对应的点数或套餐已经开通。</p><p><a href="${esc(appUrl())}/zh/e">前往企业端</a></p>`
  return {
    subject: 'FindMYJob 订单已确认到账',
    html: wrap(body),
    text: `FindMYJob 已确认收到您的转账 RM ${ringgit(vars.amountSen)}，对应的点数或套餐已经开通。`,
  }
}

function orderConfirmedEn(vars: { amountSen: number }): EmailContent {
  const body = `<p>Hello,</p><p>FindMYJob has confirmed your bank transfer of <strong>RM ${esc(ringgit(vars.amountSen))}</strong>. Your credits or plan are now active.</p><p><a href="${esc(appUrl())}/en/e">Go to dashboard</a></p>`
  return {
    subject: 'FindMYJob — Payment confirmed',
    html: wrap(body),
    text: `FindMYJob confirmed your bank transfer of RM ${ringgit(vars.amountSen)}. Your credits or plan are now active.`,
  }
}

// ---- credits-low ---------------------------------------------------------

function creditsLowZh(vars: { balance: number; threshold: number }): EmailContent {
  const body = `<p>您好，</p><p>您的 FindMYJob 点数余额已不足（当前余额：<strong>${esc(String(vars.balance))}</strong> 点，提醒阈值：${esc(String(vars.threshold))} 点）。</p><p>公益期内点数将在每月初自动补足。</p>`
  return {
    subject: 'FindMYJob 点数余额不足提醒',
    html: wrap(body),
    text: `FindMYJob 点数余额不足，当前余额：${vars.balance} 点。公益期内将在每月初自动补足。`,
  }
}

function creditsLowEn(vars: { balance: number; threshold: number }): EmailContent {
  const body = `<p>Hello,</p><p>Your FindMYJob credit balance is low (current: <strong>${esc(String(vars.balance))}</strong>, threshold: ${esc(String(vars.threshold))}).</p><p>During the pilot period, credits are automatically topped up at the start of each month.</p>`
  return {
    subject: 'FindMYJob — Low credit balance',
    html: wrap(body),
    text: `FindMYJob low credit balance: ${vars.balance} credits remaining.`,
  }
}

// ---- daily-digest --------------------------------------------------------

export interface DigestJobRow {
  jobTitle: string
  newApplications: number
}

function dailyDigestZh(vars: { rows: DigestJobRow[] }): EmailContent {
  const rows = vars.rows.map(r => `<li><strong>${esc(r.jobTitle)}</strong>：新增 ${esc(String(r.newApplications))} 份投递</li>`).join('')
  const body = `<p>您好，</p><p>以下职位昨日收到了新投递：</p><ul>${rows}</ul><p><a href="${esc(appUrl())}/zh/e/jobs">查看投递</a></p>`
  const text = vars.rows.map(r => `${r.jobTitle}：${r.newApplications} 份`).join('\n')
  return {
    subject: 'FindMYJob 每日投递汇总',
    html: wrap(body),
    text: `FindMYJob 每日投递汇总\n${text}`,
  }
}

function dailyDigestEn(vars: { rows: DigestJobRow[] }): EmailContent {
  const rows = vars.rows.map(r => `<li><strong>${esc(r.jobTitle)}</strong>: ${esc(String(r.newApplications))} new application(s)</li>`).join('')
  const body = `<p>Hello,</p><p>The following jobs received new applications:</p><ul>${rows}</ul><p><a href="${esc(appUrl())}/en/e/jobs">View applications</a></p>`
  const text = vars.rows.map(r => `${r.jobTitle}: ${r.newApplications} application(s)`).join('\n')
  return {
    subject: 'FindMYJob — Daily applications digest',
    html: wrap(body),
    text: `FindMYJob daily applications digest\n${text}`,
  }
}

// ---- signup-cap-warn -----------------------------------------------------

function signupCapWarnZh(vars: { count: number; cap: number; threshold: number }): EmailContent {
  const body = `<p>运营提醒：FindMYJob 学生注册人数（${esc(String(vars.count))} 人）已达到注册上限 ${esc(String(vars.cap))} 的 ${Math.round(vars.count / vars.cap * 100)}%，超过预警阈值（${esc(String(vars.threshold))} 人）。</p><p>请及时处理。</p>`
  return {
    subject: 'FindMYJob 学生注册人数预警',
    html: wrap(body),
    text: `FindMYJob 学生注册人数预警：当前 ${vars.count} 人，上限 ${vars.cap} 人，阈值 ${vars.threshold} 人。`,
  }
}

function signupCapWarnEn(vars: { count: number; cap: number; threshold: number }): EmailContent {
  const body = `<p>Ops alert: FindMYJob student registrations (${esc(String(vars.count))}) have exceeded the warning threshold (${esc(String(vars.threshold))} of ${esc(String(vars.cap))}).</p><p>Please take action.</p>`
  return {
    subject: 'FindMYJob — Student signup cap warning',
    html: wrap(body),
    text: `FindMYJob signup cap warning: ${vars.count} students (threshold: ${vars.threshold}, cap: ${vars.cap}).`,
  }
}

// ---- data-export-ready ---------------------------------------------------

function dataExportReadyZh(vars: { requestId: string; locale: string }): EmailContent {
  const url = `${appUrl()}/${vars.locale}/s/privacy/exports/${vars.requestId}`
  const body = `<p>您好，</p><p>您申请的个人数据导出已准备好。请在 <strong>24 小时内</strong>登录 FindMYJob 下载：</p><p><a href="${esc(url)}">查看下载链接</a></p><p>下载链接在站内页面上生成后 5 分钟内有效。如超时请重新进入该页面。</p>`
  return {
    subject: 'FindMYJob 数据导出已就绪',
    html: wrap(body),
    text: `FindMYJob 数据导出已就绪。请在 24 小时内登录 FindMYJob 访问：${url}`,
  }
}

function dataExportReadyEn(vars: { requestId: string; locale: string }): EmailContent {
  const url = `${appUrl()}/${vars.locale}/s/privacy/exports/${vars.requestId}`
  const body = `<p>Hello,</p><p>Your personal data export is ready. Please <strong>sign in to FindMYJob within 24 hours</strong> to download it:</p><p><a href="${esc(url)}">View download link</a></p><p>Once on the page, the download link is valid for 5 minutes. If it expires, reload the page.</p>`
  return {
    subject: 'FindMYJob — Your data export is ready',
    html: wrap(body),
    text: `FindMYJob data export ready. Sign in within 24 hours: ${url}`,
  }
}

// ---- account-deletion-confirmed ------------------------------------------

function accountDeletionConfirmedZh(): EmailContent {
  const body = `<p>您好，</p><p>您的 FindMYJob 账号删除申请已收到，账号已停用并立即从人才库中移除。</p><p>30 天后，您的个人联系方式和简历文件将被永久删除，档案将被匿名化处理。</p><p>如有疑问，请联系 FindMYJob 团队。</p>`
  return {
    subject: 'FindMYJob 账号删除申请已确认',
    html: wrap(body),
    text: 'FindMYJob 账号删除申请已收到，账号已停用。30 天后个人信息将被永久删除。',
  }
}

function accountDeletionConfirmedEn(): EmailContent {
  const body = `<p>Hello,</p><p>We have received your request to delete your FindMYJob account. Your account has been deactivated and immediately removed from the talent pool.</p><p>After 30 days, your personal contact details and resume files will be permanently deleted and your profile will be anonymised.</p><p>If you have questions, please contact the FindMYJob team.</p>`
  return {
    subject: 'FindMYJob — Account deletion confirmed',
    html: wrap(body),
    text: 'FindMYJob account deletion confirmed. Your account is deactivated; personal data will be permanently deleted after 30 days.',
  }
}

// ---- signup-attempt ------------------------------------------------------

function signupAttemptZh(): EmailContent {
  const body = `<p>您好，</p><p>有人尝试使用您的邮箱注册 FindMYJob 账号。如果是您本人操作，请直接<a href="${esc(appUrl())}/zh/login">登录</a>即可。如果不是您本人，请忽略此邮件。</p>`
  return {
    subject: '有人尝试用您的 FindMYJob 账号注册',
    html: wrap(body),
    text: '有人尝试使用您的邮箱注册 FindMYJob 账号。如果是您本人操作，请直接登录即可。如果不是您本人，请忽略此邮件。',
  }
}

function signupAttemptEn(): EmailContent {
  const body = `<p>Hello,</p><p>Someone attempted to create a FindMYJob account using your email address. If this was you, please <a href="${esc(appUrl())}/en/login">log in</a> instead. If it was not you, please ignore this email.</p>`
  return {
    subject: 'Someone tried to register with your FindMYJob account',
    html: wrap(body),
    text: 'Someone attempted to create a FindMYJob account using your email address. If this was you, please log in instead. If it was not you, please ignore this email.',
  }
}

// ---- Public render function ----------------------------------------------

export type TemplateVars =
  | { template: 'company-verification'; locale: string; approved: boolean; reviewNote?: string }
  | { template: 'job-review'; locale: string; approved: boolean; jobTitle: string; reviewNote?: string }
  | { template: 'application-status'; locale: string; jobTitle: string; toStatus: string }
  | { template: 'talent-unlocked'; locale: string }
  | { template: 'invitation-received'; locale: string; jobTitle: string; companyName: string }
  | { template: 'credits-granted'; locale: string; amount: number; balance: number }
  | { template: 'credits-low'; locale: string; balance: number; threshold: number }
  | { template: 'order-confirmed'; locale: string; amountSen: number }
  | { template: 'daily-digest'; locale: string; rows: DigestJobRow[] }
  | { template: 'signup-cap-warn'; locale: string; count: number; cap: number; threshold: number }
  | { template: 'signup-attempt'; locale: string }
  | { template: 'data-export-ready'; locale: string; requestId: string }
  | { template: 'account-deletion-confirmed'; locale: string }

export function renderEmailTemplate(vars: TemplateVars): EmailContent {
  const zh = vars.locale === 'zh'
  switch (vars.template) {
    case 'company-verification':
      return zh ? companyVerificationZh(vars) : companyVerificationEn(vars)
    case 'job-review':
      return zh ? jobReviewZh(vars) : jobReviewEn(vars)
    case 'application-status':
      return zh ? applicationStatusZh(vars) : applicationStatusEn(vars)
    case 'talent-unlocked':
      return zh ? talentUnlockedZh() : talentUnlockedEn()
    case 'invitation-received':
      return zh ? invitationReceivedZh(vars) : invitationReceivedEn(vars)
    case 'credits-granted':
      return zh ? creditsGrantedZh(vars) : creditsGrantedEn(vars)
    case 'credits-low':
      return zh ? creditsLowZh(vars) : creditsLowEn(vars)
    case 'order-confirmed':
      return zh ? orderConfirmedZh(vars) : orderConfirmedEn(vars)
    case 'daily-digest':
      return zh ? dailyDigestZh(vars) : dailyDigestEn(vars)
    case 'signup-cap-warn':
      return zh ? signupCapWarnZh(vars) : signupCapWarnEn(vars)
    case 'signup-attempt':
      return zh ? signupAttemptZh() : signupAttemptEn()
    case 'data-export-ready':
      return zh ? dataExportReadyZh({ requestId: vars.requestId, locale: vars.locale }) : dataExportReadyEn({ requestId: vars.requestId, locale: vars.locale })
    case 'account-deletion-confirmed':
      return zh ? accountDeletionConfirmedZh() : accountDeletionConfirmedEn()
  }
}
