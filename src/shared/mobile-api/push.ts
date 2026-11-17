// 推送相关的请求、响应和通知分类（MA3）。App 与服务端共用。
import { z } from 'zod'

export const mobileRegisterDeviceSchema = z
  .object({
    // FCM 注册 token 大约 160 字符；留足余量但拒绝离谱的输入
    token: z.string().min(20).max(4096),
    appVersion: z.string().max(32).nullable().optional(),
    locale: z.enum(['zh', 'en']),
  })
  .strict()
export type MobileRegisterDevice = z.infer<typeof mobileRegisterDeviceSchema>

export const mobileDeviceSchema = z.object({ id: z.string() })

export const mobilePushPreferencesSchema = z.object({
  applications: z.boolean(),
  invitations: z.boolean(),
  account: z.boolean(),
  lockScreenDetails: z.boolean(),
  quietHours: z.boolean(),
})
export type MobilePushPreferences = z.infer<typeof mobilePushPreferencesSchema>
export const mobilePushPreferencesPatchSchema = mobilePushPreferencesSchema.partial().strict()

/** 推送的 data 字段只有这些：App 收到后按 type 和 id 自己拉详情，绝不在推送里带 PII */
export const pushDataSchema = z.object({
  type: z.string(),
  notificationId: z.string(),
  /** App 点开后跳转的页面（App 内路由，不是 URL） */
  route: z.string(),
})
export type PushData = z.infer<typeof pushDataSchema>

/** 通知 type → 偏好分类与 App 路由。不在表里的类型不推送（只留在站内通知）。 */
export const PUSHABLE_NOTIFICATION_TYPES = {
  'application.status.changed': { category: 'applications', route: '/applications' },
  'invitation.received': { category: 'invitations', route: '/applications?tab=invitations' },
  'referral.qualified': { category: 'account', route: '/me' },
  'quota.exhausted': { category: 'account', route: '/home' },
} as const satisfies Record<string, { category: 'applications' | 'invitations' | 'account'; route: string }>
export type PushableNotificationType = keyof typeof PUSHABLE_NOTIFICATION_TYPES

export function isPushableNotificationType(type: string): type is PushableNotificationType {
  return Object.prototype.hasOwnProperty.call(PUSHABLE_NOTIFICATION_TYPES, type)
}
