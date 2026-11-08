import 'server-only'
import { db } from '../db'
import { createEmailProvider } from '@/lib/email'
import { checkEmailCap, type EmailTemplate } from '../lib/email-cap'
import { logger } from '../lib/logger'
import { renderEmailTemplate } from '../email/templates'
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

/** Stub entry for M8-T02 order confirmed notification. */
export async function notifyOrderConfirmed(
  _companyId: string,
  _payload: { orderId: string; amount: number },
): Promise<void> {
  // M8-T02: wire up credits.order.confirmed notification here
  logger.info({ _companyId }, 'notifyOrderConfirmed: not yet implemented (M8-T02)')
}

/** Stub entry for M7-T09 new report notification. */
export async function notifyNewReport(_reportId: string): Promise<void> {
  // M7-T09: wire up report.new notification here
  logger.info({ _reportId }, 'notifyNewReport: not yet implemented (M7-T09)')
}
