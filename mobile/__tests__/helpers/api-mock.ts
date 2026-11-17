// 页面级测试用的 API 桩：按 "METHOD /path" 配路由；响应照样过 zod schema（夹具写错就当场失败），
// 会计数的端点照样要求 userInitiated（和真实 apiFetch 同一个判断）。
import type { z } from 'zod'

type Handler = (body: unknown, path: string) => unknown
type Call = { method: string; path: string; body: unknown; userInitiated: boolean }

export const apiRoutes = new Map<string, Handler | unknown>()
export const apiCalls: Call[] = []

export function resetApi() {
  apiRoutes.clear()
  apiCalls.length = 0
}

/** 精确路径或去掉查询串后的路径都能匹配；值是函数就调用它（可以抛 ApiError） */
export function route(key: string, value: Handler | unknown) {
  apiRoutes.set(key, value)
}

export function callsTo(method: string, pathPrefix: string): Call[] {
  return apiCalls.filter((c) => c.method === method && c.path.startsWith(pathPrefix))
}

export function apiClientMock() {
  const actual = jest.requireActual('@/lib/api-client') as typeof import('@/lib/api-client')
  return {
    ...actual,
    apiFetch: jest.fn(async (path: string, opts: { method?: string; body?: unknown; schema?: z.ZodType; userInitiated?: boolean } = {}) => {
      const method = opts.method ?? 'GET'
      if (actual.isCountingEndpoint(path) && !opts.userInitiated) throw new actual.ApiError('COUNTING_ENDPOINT_NOT_USER_INITIATED', 0)
      apiCalls.push({ method, path, body: opts.body, userInitiated: !!opts.userInitiated })
      const key = `${method} ${path}`
      const bare = `${method} ${path.split('?')[0]}`
      const hit = apiRoutes.has(key) ? apiRoutes.get(key) : apiRoutes.get(bare)
      if (hit === undefined) throw new actual.ApiError('NOT_FOUND', 404)
      const data = typeof hit === 'function' ? await (hit as Handler)(opts.body, path) : hit
      return opts.schema ? opts.schema.parse(data) : data
    }),
  }
}
