import 'server-only'

// Better Auth 请求体里会带跳转地址的字段
const CALLBACK_FIELDS = ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL', 'redirectTo'] as const

/**
 * 跳转地址只允许站内相对路径（/zh/...）或 http(s) 绝对地址；http(s) 是否同源仍由
 * Better Auth 按 trustedOrigins 校验。自定义 scheme（findmyjob://、exp://、javascript: 等）
 * 一律拒绝：Expo 插件会把 Set-Cookie 拼进这类跳转 URL，被抢注同一 scheme 的 App 截获。
 * 返回第一个不安全的字段名；都安全时返回 null。
 */
export function findUnsafeCallbackUrl(body: Record<string, unknown> | undefined): string | null {
  if (!body) return null
  for (const field of CALLBACK_FIELDS) {
    const value = body[field]
    if (value === undefined || value === null || value === '') continue
    if (typeof value !== 'string') return field
    const trimmed = value.trim()
    // 协议相对地址（//evil.example）和反斜杠变体都不是站内路径
    if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) continue
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      return field
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return field
  }
  return null
}
