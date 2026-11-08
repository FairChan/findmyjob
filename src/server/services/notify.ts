import 'server-only'
import { db } from '../db'
import { createEmailProvider } from '@/lib/email'
import { checkEmailCap, type EmailTemplate } from '../lib/email-cap'
import { logger } from '../lib/logger'
import { renderEmailTemplate } from '../email/templates'
import { createNotification } from './notifications'
import type { TemplateVars } from '../email/templates'

export type { TemplateVars }

/** Distributive Omit that works with discriminated union types. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type TemplateVarsWithoutLocale = DistributiveOmit<TemplateVars, 'locale'>

/**
 * Send an email notification to a user post-commit.
 * - Looks up email + locale from DB (never from payload).
 * - Checks daily email cap before sending.
 * - On failure: logs, does not throw. Never call inside $transaction.
 */
export async function sendNotificationEmail(
  userId: string,
  vars: TemplateVarsWithoutLocale,
): Promise<void> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, locale: true },
    })
    if (!user) return

    const locale = user.locale ?? 'zh'
    const templateVars = { ...vars, locale } as TemplateVars

    const templateName = vars.template
    const allowed = await checkEmailCap({ template: templateName as EmailTemplate })
    if (!allowed) {
      logger.info({ userId, template: templateName }, 'email cap reached, skipping')
      return
    }

    const content = renderEmailTemplate(templateVars)
    await createEmailProvider().sendEmail({
      to: user.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
    })
  } catch (err) {
    logger.error({ err, userId, template: vars.template }, 'sendNotificationEmail failed')
  }
}

/**
 * Send a daily digest email directly (not via the generic userId lookup path, since
 * we already have the email from the job runner).
 */
export async function sendDailyDigestEmail(opts: {
  to: string
  locale: string
  rows: import('../email/templates').DigestJobRow[]
}): Promise<void> {
  try {
    const allowed = await checkEmailCap({ template: 'daily-digest' })
    if (!allowed) {
      logger.info({ to: opts.to }, 'daily-digest email cap reached, skipping')
      return
    }
    const content = renderEmailTemplate({ template: 'daily-digest', locale: opts.locale, rows: opts.rows })
    await createEmailProvider().sendEmail({
      to: opts.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    })
  } catch (err) {
    logger.error({ err, to: opts.to }, 'sendDailyDigestEmail failed')
  }
}

/**
 * Send the "someone tried to register with your email" reminder.
 * Looks up locale from DB; falls back to 'zh'. Never throws.
 */
export async function sendExistingUserReminder(email: string): Promise<void> {
  try {
    const user = await db.user.findUnique({
      where: { email },
      select: { locale: true },
    })
    const locale = user?.locale ?? 'zh'
    const content = renderEmailTemplate({ template: 'signup-attempt', locale })
    await createEmailProvider().sendEmail({
      to: email,
      subject: content.subject,
      html: content.html,
      text: content.text,
    })
  } catch (err) {
    logger.error({ err, template: 'signup-attempt' }, 'sendExistingUserReminder failed')
  }
}

/**
 * PRD §6「订单确认到账」→ 企业 OWNER：站内 + 邮件。
 * M8-T02 在确认到账的事务提交之后调用；金额用整数「分」(sen)。
 */
export async function notifyOrderConfirmed(
  companyId: string,
  payload: { orderId: string; amountSen: number },
): Promise<void> {
  const owners = await db.companyMember.findMany({
    where: { companyId, role: 'OWNER' },
    select: { userId: true },
  })
  for (const o of owners) {
    await createNotification(db, o.userId, 'order.confirmed', {
      orderId: payload.orderId,
      amountSen: payload.amountSen,
    })
    await sendNotificationEmail(o.userId, { template: 'order-confirmed', amountSen: payload.amountSen })
  }
}

/** PRD §6「收到新举报」→ 运营（所有 ACTIVE 的 ADMIN）：只发站内。M7-T09 建好举报之后调用。 */
export async function notifyNewReport(reportId: string): Promise<void> {
  const admins = await db.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  })
  for (const a of admins) {
    await createNotification(db, a.id, 'report.new', { reportId })
  }
}
