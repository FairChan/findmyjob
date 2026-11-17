import 'server-only'
import { db } from '../db'
import { NotFoundError } from '../errors'
import { getSetting } from './settings'
import { mobileConfigSchema, mobileMeSchema, type MobileConfig, type MobileMe } from '@/shared/mobile-api'

/** App 启动配置；未登录可读，只放非敏感的版本与开关 */
export async function getMobileConfig(): Promise<MobileConfig> {
  const [minSupportedVersion, latestVersion, legalVersion] = await Promise.all([
    getSetting<string>('mobile.minSupportedVersion', '0.0.0'),
    getSetting<string>('mobile.latestVersion', '0.1.0'),
    // 与 needsReconsent() 的默认值一致
    getSetting<string>('legal.currentVersion', '2026-11-draft'),
  ])
  return mobileConfigSchema.parse({ minSupportedVersion, latestVersion, legalVersion })
}

/** 当前登录用户自己的基本信息（只给本人） */
export async function getMobileMe(ctx: { userId: string }): Promise<MobileMe> {
  const user = await db.user.findUnique({
    where: { id: ctx.userId },
    select: { id: true, role: true, name: true, email: true, emailVerified: true, locale: true },
  })
  if (!user) throw new NotFoundError()
  return mobileMeSchema.parse(user)
}
