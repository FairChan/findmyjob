// /api/m/v1 的响应约定（zod）。服务端用它约束输出，App 用它解析响应；改字段只能加，不能删或改语义。
import { z } from 'zod'

export const mobileConfigSchema = z.object({
  minSupportedVersion: z.string(),
  latestVersion: z.string(),
  legalVersion: z.string(),
})
export type MobileConfig = z.infer<typeof mobileConfigSchema>

export const mobileMeSchema = z.object({
  id: z.string(),
  role: z.enum(['STUDENT', 'EMPLOYER', 'ADMIN']),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  locale: z.enum(['zh', 'en']),
})
export type MobileMe = z.infer<typeof mobileMeSchema>
