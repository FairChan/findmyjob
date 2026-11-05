import 'server-only'
import { z } from 'zod'
import { AppError, ForbiddenError } from './errors'
import { logger } from './lib/logger'
import type { CompanyMemberRole } from '@prisma/client'

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string }

export type CompanyAuthOpt = { type: 'company'; minRole?: CompanyMemberRole; verified?: boolean }

export type AuthOption =
  | 'public'
  | 'user'
  | 'student'
  | 'company'
  | CompanyAuthOpt
  | 'admin'

export type ActionContext<TInput> = {
  input: TInput
  userId?: string
  companyId?: string
  companyRole?: CompanyMemberRole
}

async function resolveAuth(auth: AuthOption): Promise<{
  userId?: string
  companyId?: string
  companyRole?: CompanyMemberRole
}> {
  if (auth === 'public') return {}

  const { headers } = await import('next/headers')
  const h = await headers()

  if (auth === 'user') {
    const { requireUser } = await import('./authz')
    return await requireUser(h)
  }

  if (auth === 'student') {
    const { requireStudent } = await import('./authz')
    return await requireStudent(h)
  }

  if (auth === 'admin') {
    const { requireAdmin } = await import('./authz')
    return await requireAdmin(h)
  }

  // 'company' or { type: 'company', ... }
  const opt: CompanyAuthOpt =
    auth === 'company' ? { type: 'company' } : (auth as CompanyAuthOpt)
  const minRole: CompanyMemberRole = opt.minRole ?? 'RECRUITER'

  if (opt.verified) {
    const { requireVerifiedCompany } = await import('./authz')
    const ctx = await requireVerifiedCompany(minRole, h)
    return { userId: ctx.userId, companyId: ctx.companyId, companyRole: ctx.role }
  }

  const { requireCompanyMember } = await import('./authz')
  const ctx = await requireCompanyMember(minRole, h)
  return { userId: ctx.userId, companyId: ctx.companyId, companyRole: ctx.role }
}

export function action<TInput = void, TOutput = void>(
  opts: {
    auth: AuthOption
    input?: z.ZodType<TInput>
  },
  handler: (ctx: ActionContext<TInput>) => Promise<TOutput>,
): (rawInput?: unknown) => Promise<ActionResult<TOutput>> {
  return async (rawInput?: unknown): Promise<ActionResult<TOutput>> => {
    try {
      const authCtx = await resolveAuth(opts.auth)

      let input: TInput
      if (opts.input) {
        const parsed = opts.input.safeParse(rawInput)
        if (!parsed.success) {
          return { ok: false, code: 'VALIDATION_ERROR' }
        }
        input = parsed.data
      } else {
        input = undefined as unknown as TInput
      }

      const data = await handler({ input, ...authCtx })
      return { ok: true, data }
    } catch (err) {
      if (err instanceof AppError) {
        return { ok: false, code: err.code }
      }
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Unhandled action error',
      )
      return { ok: false, code: 'INTERNAL_ERROR' }
    }
  }
}

// Keep ForbiddenError re-export for existing callers
export { ForbiddenError }
