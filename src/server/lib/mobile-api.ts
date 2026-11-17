import 'server-only'
import { z } from 'zod'
import { AppError } from '../errors'

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
