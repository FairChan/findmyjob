import 'server-only'
import { createHash } from 'crypto'
import type { Locale, Prisma } from '@prisma/client'
import { db } from '../db'
import { NotFoundError } from '../errors'
import { decryptField, encryptField } from '../lib/crypto'
import type { MobilePushPreferences } from '@/shared/mobile-api'

// FCM token 当作敏感凭据：只存 encryptField 密文（AAD 绑定哈希），去重和查找只用 sha256 哈希
export function deviceTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function tokenAad(tokenHash: string): string {
  return `DeviceToken.tokenEnc:${tokenHash}`
}

export function decryptDeviceToken(row: { tokenHash: string; tokenEnc: string }): string {
  return decryptField(row.tokenEnc, tokenAad(row.tokenHash))
}

/**
 * 注册（或刷新）本机的推送 token，绑定到当前登录会话。
 * 同一台设备换账号登录时，token 相同：直接改归属到新用户和新会话，旧账号不会再收到推送。
 */
export async function registerDeviceToken(
  ctx: { userId: string; sessionId: string },
  input: { token: string; appVersion?: string | null; locale: Locale },
): Promise<{ id: string }> {
  const tokenHash = deviceTokenHash(input.token)
  const data = {
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    tokenEnc: encryptField(input.token, tokenAad(tokenHash)),
    appVersion: input.appVersion ?? null,
    locale: input.locale,
    lastSeenAt: new Date(),
    revokedAt: null,
  }
  const row = await db.deviceToken.upsert({
    where: { tokenHash },
    create: { tokenHash, ...data },
    update: data,
    select: { id: true },
  })
  return row
}

/** 本人注销本机 token（App 退出登录前调用）；不是自己的 token 一律当作不存在 */
export async function revokeDeviceToken(ctx: { userId: string }, id: string): Promise<void> {
  const { count } = await db.deviceToken.updateMany({
    where: { id, userId: ctx.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (count === 0) throw new NotFoundError()
}

/** FCM 回报 token 已失效时由推送 worker 调用 */
export async function revokeDeviceTokenById(id: string): Promise<void> {
  await db.deviceToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } })
}

const DEFAULT_PREFS: MobilePushPreferences = {
  applications: true,
  invitations: true,
  account: true,
  lockScreenDetails: false,
  quietHours: true,
}

export async function getPushPreferences(ctx: { userId: string }, tx: Prisma.TransactionClient | typeof db = db): Promise<MobilePushPreferences> {
  const row = await tx.pushPreference.findUnique({ where: { userId: ctx.userId } })
  if (!row) return { ...DEFAULT_PREFS }
  return {
    applications: row.applications,
    invitations: row.invitations,
    account: row.account,
    lockScreenDetails: row.lockScreenDetails,
    quietHours: row.quietHours,
  }
}

export async function updatePushPreferences(ctx: { userId: string }, input: Partial<MobilePushPreferences>): Promise<MobilePushPreferences> {
  await db.pushPreference.upsert({
    where: { userId: ctx.userId },
    create: { userId: ctx.userId, ...DEFAULT_PREFS, ...input },
    update: input,
  })
  return getPushPreferences(ctx)
}
