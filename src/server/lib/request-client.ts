import 'server-only'
import { AsyncLocalStorage } from 'async_hooks'

// 标记"这次请求来自 Android App"，让 logAudit 在 metadata 里补 client: 'android'（MOBILE.md §6）。
// 用请求级上下文而不是给每个 service 加参数：审计分散在十几个 service 里，改签名牵连太广，
// 而且 Web 调用方完全不受影响（上下文为空时 metadata 原样写入）。
// 只由 route() 在 App origin 通过校验之后设置，客户端无法自己声明。
export type RequestClient = 'android'

const requestClientStore = new AsyncLocalStorage<RequestClient>()

export function runAsRequestClient<T>(client: RequestClient, fn: () => Promise<T>): Promise<T> {
  return requestClientStore.run(client, fn)
}

export function currentRequestClient(): RequestClient | undefined {
  return requestClientStore.getStore()
}
