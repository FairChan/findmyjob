import { APP_ORIGIN_HEADER, APP_VERSION_HEADER, type ApiResult } from '@shared/mobile-api'
import type { z } from 'zod'

import { appVersion, mobileApiUrl } from './api-config'
import { emitAppEvent } from './app-events'
import { appOrigin, authClient, sessionCookie } from './auth-client'

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code)
    this.name = 'ApiError'
  }
}

/**
 * 会计数的端点（扣学生的职位查看额度）只能由用户的点击触发：
 * 调用时必须显式传 userInitiated: true，查询层也禁止对它们做预取和自动重取（MOBILE.md §4.2）。
 */
const COUNTING_ENDPOINTS: RegExp[] = [/^\/jobs\/[^/]+\/open$/]

export function isCountingEndpoint(path: string): boolean {
  return COUNTING_ENDPOINTS.some((re) => re.test(path))
}

type Options<T> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  schema?: z.ZodType<T>
  userInitiated?: boolean
  signal?: AbortSignal
}

export async function apiFetch<T>(path: string, opts: Options<T> = {}): Promise<T> {
  if (isCountingEndpoint(path) && !opts.userInitiated) {
    // 编程错误：宁可直接失败，也不能悄悄扣学生的额度
    throw new ApiError('COUNTING_ENDPOINT_NOT_USER_INITIATED', 0)
  }
  const cookie = await sessionCookie()
  let res: Response
  try {
    res = await fetch(mobileApiUrl(path), {
      method: opts.method ?? 'GET',
      credentials: 'omit',
      signal: opts.signal,
      headers: {
        Accept: 'application/json',
        [APP_ORIGIN_HEADER]: appOrigin(),
        [APP_VERSION_HEADER]: appVersion(),
        ...(cookie ? { cookie } : {}),
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError('NETWORK_ERROR', 0)
  }

  let json: ApiResult<unknown> | null = null
  try {
    json = (await res.json()) as ApiResult<unknown>
  } catch {
    json = null
  }

  if (res.ok && json?.ok) {
    return opts.schema ? opts.schema.parse(json.data) : (json.data as T)
  }

  const code = json && !json.ok ? json.code : res.ok ? 'INVALID_RESPONSE' : 'INTERNAL_ERROR'
  await handleGlobalFailure(res.status, code)
  throw new ApiError(code, res.status)
}

async function handleGlobalFailure(status: number, code: string): Promise<void> {
  if (status === 426 || code === 'APP_UPDATE_REQUIRED') {
    emitAppEvent('update-required')
    return
  }
  if (status === 409 && code === 'NEEDS_RECONSENT') {
    emitAppEvent('needs-reconsent')
    return
  }
  // 会话过期时 proxy 回 401、authz 回 403 FORBIDDEN（和"没权限"一样），所以先确认会话还在不在
  if (status === 401 || (status === 403 && code === 'FORBIDDEN')) {
    const session = await authClient.getSession().catch(() => null)
    if (!session?.data) emitAppEvent('signed-out')
  }
}
