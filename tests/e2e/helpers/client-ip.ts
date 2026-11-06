import { randomInt } from 'node:crypto'

/**
 * 每条用例一个独立的客户端 IP，通过 x-real-ip 发给 dev server。
 * 本地没有 Caddy，所有请求都来自 127.0.0.1；并行走注册、登录表单的用例会共用 Better Auth
 * 的限流桶（注册 60 秒 3 次、登录 60 秒 5 次），结果是「登录失败次数过多」。
 * 线 B 的 loginAs 在 helpers/session.ts 里用的是同样的做法。
 */
export function uniqueClientIp(): string {
  return `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`
}
