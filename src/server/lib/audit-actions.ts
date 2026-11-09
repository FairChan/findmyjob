import 'server-only'

/**
 * Canonical set of action strings that MUST be written to AuditLog.
 * Source of truth: ARCHITECTURE §5.7. Keep this list in sync with that section.
 */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.session.revoke',
  'student.visibility.change',
  'student.block_company',
  'student.unblock_company',
  'talent.view',
  'talent.unlock',
  'talent.limit.hit',
  'contact.read',
  'resume.download',
  'upload.reject',
  'credits.adjust',
  'company.verify',
  'company.reject',
  'company.invite.accept',
  'company.verification.doc_view',
  'company.managed.create',
  'company.managed.post',
  'company.managed.transfer',
  'job.review',
  'job.report.resolve',
  'referral.void',
  'order.confirm',
  'setting.update',
  'user.suspend',
  'data.export',
  'data.delete',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]
