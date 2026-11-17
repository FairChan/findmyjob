import { vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import * as authMod from '@/server/auth'

/** dev 变体的 scheme；测试里通过 MOBILE_APP_ORIGINS 配成唯一允许的 App origin */
export const APP_ORIGIN = 'findmyjob-dev://'
export const BROWSER_ORIGIN = 'http://localhost:3000'

/** 和 needsReconsent() 的默认值保持一致 */
export const LEGAL_VERSION = '2026-11-draft'

export function mockSession(userId: string | null) {
  vi.mocked(authMod.getSession).mockResolvedValue(
    userId ? ({ user: { id: userId }, session: { id: 's1', createdAt: new Date() } } as never) : null,
  )
}

type AppRequestInit = { method?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string }

/** 模拟 App 发出的请求：expo-origin + 版本头；headers 里带 origin 可模拟浏览器 */
export function appRequest(path: string, init: AppRequestInit = {}) {
  const method = init.method ?? (init.body !== undefined || init.rawBody !== undefined ? 'POST' : 'GET')
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      'expo-origin': APP_ORIGIN,
      'x-app-version': '0.1.0',
      ...(init.body !== undefined || init.rawBody !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    ...(init.rawBody !== undefined ? { body: init.rawBody } : init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

/** 学生已同意当前版本条款（否则 MA1-T07 之后 /api/m/v1 会返回 409 NEEDS_RECONSENT） */
export async function grantLegalConsent(db: PrismaClient, userId: string, version = LEGAL_VERSION) {
  await db.consent.createMany({
    data: [
      { userId, type: 'TERMS', version, granted: true },
      { userId, type: 'PRIVACY', version, granted: true },
    ],
  })
}

export async function readJson(res: Response): Promise<{ ok: boolean; data?: any; code?: string }> {
  return (await res.json()) as { ok: boolean; data?: any; code?: string }
}
