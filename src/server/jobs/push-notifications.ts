import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { logger } from '../lib/logger'
import { isFcmConfigured, sendFcm, type FcmMessage, type FcmResult } from '../lib/fcm'
import { decryptDeviceToken, getPushPreferences, revokeDeviceTokenById } from '../services/device-tokens'
import { isPushableNotificationType, PUSHABLE_NOTIFICATION_TYPES, type MobilePushPreferences } from '@/shared/mobile-api'

/**
 * 推送分发（MA3-T02）：每分钟扫描最近提交的通知，推给对应学生的有效设备。
 * 用 Notification 表本身当发件箱：只看得到已提交的行，不需要改动 22 处 createNotification，
 * 也不在业务事务里做任何 HTTP。PushDelivery 的唯一约束是"每条通知对每台设备最多推一次"的凭据。
 *
 * - 时间窗 12 小时：静默时段（23:00–08:00 吉隆坡）里产生的通知留到早上 8 点合并成一条推送。
 * - 推送文案只有类型化的通用句子，不含企业名、学生姓名、联系方式（MOBILE.md §4.3）。
 * - 设备必须绑定着仍有效的登录会话；会话删除时 token 级联删除。
 */

const WINDOW_MS = 12 * 3600_000
const BATCH = 500

type Category = 'applications' | 'invitations' | 'account'

const TEXT: Record<'zh' | 'en', Record<Category | 'many', { title: string; body: string }>> = {
  zh: {
    applications: { title: 'FindMYJob', body: '你的投递有新进展，点开查看' },
    invitations: { title: 'FindMYJob', body: '你收到一个新的邀请，点开查看' },
    account: { title: 'FindMYJob', body: '你的账号有新消息，点开查看' },
    many: { title: 'FindMYJob', body: '你有 {n} 条新消息，点开查看' },
  },
  en: {
    applications: { title: 'FindMYJob', body: 'There is an update on your application. Tap to view.' },
    invitations: { title: 'FindMYJob', body: 'You have a new invitation. Tap to view.' },
    account: { title: 'FindMYJob', body: 'There is news about your account. Tap to view.' },
    many: { title: 'FindMYJob', body: 'You have {n} new updates. Tap to view.' },
  },
}

/** 吉隆坡时间 23:00–08:00 */
export function isQuietHourKL(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }).format(now))
  return hour >= 23 || hour < 8
}

type Candidate = { notificationId: string; type: string; userId: string; deviceTokenId: string }

async function claim(notificationId: string, deviceTokenId: string): Promise<boolean> {
  try {
    // 先占位再发送：即使两个 worker 同时跑，同一条通知也只会推给同一台设备一次（宁少勿重）
    await db.pushDelivery.create({ data: { notificationId, deviceTokenId, status: 'FAILED', errorCode: 'CLAIMED' } })
    return true
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false
    throw err
  }
}

export type PushDispatchResult = { sent: number; skipped: number; failed: number; deferred: number }

export async function runPushDispatch(opts: { now?: Date; send?: (msg: FcmMessage) => Promise<FcmResult> } = {}): Promise<PushDispatchResult> {
  const now = opts.now ?? new Date()
  const send = opts.send ?? sendFcm
  const result: PushDispatchResult = { sent: 0, skipped: 0, failed: 0, deferred: 0 }
  if (!opts.send && !isFcmConfigured()) return result

  const types = Object.keys(PUSHABLE_NOTIFICATION_TYPES)
  const rows = await db.$queryRaw<Candidate[]>`
    SELECT n."id" AS "notificationId", n."type", n."userId", d."id" AS "deviceTokenId"
    FROM "Notification" n
    JOIN "DeviceToken" d ON d."userId" = n."userId" AND d."revokedAt" IS NULL
    JOIN "Session" s ON s."id" = d."sessionId" AND s."expiresAt" > ${now}
    JOIN "User" u ON u."id" = n."userId" AND u."status" = 'ACTIVE' AND u."role" = 'STUDENT'
    WHERE n."createdAt" >= ${new Date(now.getTime() - WINDOW_MS)}
      AND n."createdAt" <= ${now}
      AND n."readAt" IS NULL
      AND n."type" IN (${Prisma.join(types)})
      AND NOT EXISTS (
        SELECT 1 FROM "PushDelivery" p WHERE p."notificationId" = n."id" AND p."deviceTokenId" = d."id"
      )
    ORDER BY n."createdAt" ASC
    LIMIT ${BATCH}
  `
  if (rows.length === 0) return result

  // 按设备分组：同一设备有多条待推送时合并成一条
  const byDevice = new Map<string, Candidate[]>()
  for (const r of rows) byDevice.set(r.deviceTokenId, [...(byDevice.get(r.deviceTokenId) ?? []), r])

  const prefsCache = new Map<string, MobilePushPreferences>()
  for (const [deviceTokenId, items] of byDevice) {
    const userId = items[0]!.userId
    const prefs = prefsCache.get(userId) ?? (await getPushPreferences({ userId }))
    prefsCache.set(userId, prefs)

    if (prefs.quietHours && isQuietHourKL(now)) {
      result.deferred += items.length
      continue
    }

    const wanted: Candidate[] = []
    for (const item of items) {
      const category = isPushableNotificationType(item.type) ? PUSHABLE_NOTIFICATION_TYPES[item.type].category : null
      if (!category || !prefs[category]) {
        if (await claim(item.notificationId, deviceTokenId)) {
          await db.pushDelivery.update({
            where: { notificationId_deviceTokenId: { notificationId: item.notificationId, deviceTokenId } },
            data: { status: 'SKIPPED', errorCode: 'PREFERENCE' },
          })
          result.skipped++
        }
        continue
      }
      if (await claim(item.notificationId, deviceTokenId)) wanted.push(item)
    }
    if (wanted.length === 0) continue

    const device = await db.deviceToken.findUnique({ where: { id: deviceTokenId }, select: { tokenHash: true, tokenEnc: true, locale: true } })
    if (!device) continue
    const lang = device.locale === 'en' ? 'en' : 'zh'
    const first = wanted[0]!
    const firstCategory = PUSHABLE_NOTIFICATION_TYPES[first.type as keyof typeof PUSHABLE_NOTIFICATION_TYPES].category
    const text = wanted.length > 1 ? TEXT[lang].many : TEXT[lang][firstCategory]
    const route = wanted.length > 1 ? '/notifications' : PUSHABLE_NOTIFICATION_TYPES[first.type as keyof typeof PUSHABLE_NOTIFICATION_TYPES].route

    let outcome: FcmResult
    try {
      outcome = await send({
        token: decryptDeviceToken(device),
        title: text.title,
        body: text.body.replace('{n}', String(wanted.length)),
        data: { type: wanted.length > 1 ? 'batch' : first.type, notificationId: first.notificationId, route },
      })
    } catch {
      outcome = { outcome: 'transient', code: 'SEND_THREW' }
    }

    const ids = wanted.map((w) => w.notificationId)
    if (outcome.outcome === 'ok') {
      await db.pushDelivery.updateMany({ where: { deviceTokenId, notificationId: { in: ids } }, data: { status: 'SENT', errorCode: null } })
      result.sent += ids.length
    } else if (outcome.outcome === 'permanent') {
      await db.pushDelivery.updateMany({ where: { deviceTokenId, notificationId: { in: ids } }, data: { status: 'FAILED', errorCode: outcome.code.slice(0, 64) } })
      await revokeDeviceTokenById(deviceTokenId)
      result.failed += ids.length
    } else {
      // 临时错误：删掉占位，下一分钟再试
      await db.pushDelivery.deleteMany({ where: { deviceTokenId, notificationId: { in: ids } } })
      result.deferred += ids.length
    }
  }
  logger.info({ ...result }, 'push dispatch finished')
  return result
}
