// Web 服务端和 Android App（mobile/）共用的移动端 API 约定。
// 这个目录只放纯 TypeScript 和 zod：不 import server-only、@prisma/client、next 或 react-native，
// 两边都能直接引用（tests/architecture/shared-boundary.test.ts 守着）。

/** 路径前缀；破坏性改动开 v2 并行，不改 v1 */
export const MOBILE_API_PREFIX = '/api/m/v1'

/** App 每个请求都带上自己的版本号，服务端据此返回 426 强制更新 */
export const APP_VERSION_HEADER = 'x-app-version'

/**
 * @better-auth/expo 的客户端用这个头传 App 的 scheme origin（如 findmyjob://）。
 * 浏览器不能伪造 Origin，所以 /api/m 只认"Origin 或 expo-origin 精确等于 App origin"。
 */
export const APP_ORIGIN_HEADER = 'expo-origin'

export type ApiSuccess<T> = { ok: true; data: T }
export type ApiFailure = { ok: false; code: string }
export type ApiResult<T> = ApiSuccess<T> | ApiFailure

/** 分页统一用游标；nextCursor 为 null 表示没有下一页 */
export type CursorPage<T> = { items: T[]; nextCursor: string | null }

/** 语义化版本比较，只认 MAJOR.MINOR.PATCH；格式不对的一律当作最旧版本 */
export function compareAppVersions(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [-1, -1, -1]
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}
