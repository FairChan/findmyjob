import 'server-only'
import { z } from 'zod'
import type { CompanyMemberRole } from '@prisma/client'
import { AppError } from '../errors'
import type { CompanyCtx } from '../authz'

const idSchema = z.string().cuid()

/**
 * route() 只把 Request 交给 handler（不传 Next 的 params），所以动态段从 pathname 里取：
 * 取最后一个名为 `segment` 的段后面那一段，并按 cuid 校验；不合法时返回 400 VALIDATION_ERROR，
 * 与 route() 对请求体的校验失败同一个码，App 只需要处理一种。
 */
export function pathIdAfter(req: Request, segment: string): string {
  const parts = new URL(req.url).pathname.split('/')
  const idx = parts.lastIndexOf(segment)
  const parsed = idSchema.safeParse(idx >= 0 ? decodeURIComponent(parts[idx + 1] ?? '') : '')
  if (!parsed.success) throw new AppError('Invalid path parameter', 'VALIDATION_ERROR', 400)
  return parsed.data
}

/** /api/m/v1 的统一成功响应；缓存头由 route() 补上 */
export function mobileOk<T>(schema: z.ZodType<T>, data: unknown): Response {
  return Response.json({ ok: true, data: schema.parse(data) })
}

export function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

// 企业端（/api/m/v1/e/*）的鉴权选项，与 Web 企业端页面和 action 的要求一一对应；
// companyId 只来自 route() 里的 requireCompanyMember / requireVerifiedCompany。
// 写成常量，也让 tests/architecture/app-origin-routes.test.ts 能直接看到 route({ ... origin: 'app' })。
export const COMPANY_MEMBER = { type: 'company', minRole: 'RECRUITER' } as const
export const VERIFIED_COMPANY_MEMBER = { type: 'company', minRole: 'RECRUITER', verified: true } as const

/** route() 给 handler 的企业身份 → service 用的 CompanyCtx；三个字段都由 route() 从会话和成员表里解析 */
export function companyCtxOf(ctx: { userId?: string; companyId?: string; companyRole?: CompanyMemberRole }): CompanyCtx {
  if (!ctx.userId || !ctx.companyId || !ctx.companyRole) throw new AppError('Company context missing', 'FORBIDDEN', 403)
  return { userId: ctx.userId, companyId: ctx.companyId, role: ctx.companyRole }
}
