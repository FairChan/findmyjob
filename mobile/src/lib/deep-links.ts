/**
 * App Links（MA3-T04）：把网页地址映射成 App 内路由。只认白名单里的几类页面，
 * 其余一律回到启动分流页（'/'），不把外部传进来的任意路径交给路由器。
 * 带一次性令牌的链接（邮箱验证、重置密码）不在 intent-filter 里，始终由浏览器打开。
 */

const ID = '([A-Za-z0-9_-]{1,64})'
const LOCALE = '/(?:zh|en)'

const RULES: [RegExp, (m: RegExpMatchArray, query: URLSearchParams) => string][] = [
  [new RegExp(`^${LOCALE}(?:/s)?/jobs/${ID}/?$`), (m) => `/jobs/${m[1]}`],
  [new RegExp(`^${LOCALE}(?:/s)?/jobs/?$`), () => '/jobs'],
  [new RegExp(`^${LOCALE}/s/applications/?$`), () => '/applications'],
  [new RegExp(`^${LOCALE}/s/invitations/?$`), () => '/applications?tab=invitations'],
  [new RegExp(`^${LOCALE}(?:/s)?/companies/${ID}/?$`), (m) => `/companies/${m[1]}`],
  [new RegExp(`^${LOCALE}/s/notifications/?$`), () => '/notifications'],
  [new RegExp(`^${LOCALE}/s/?$`), () => '/home'],
]

export function mapIncomingPath(raw: string): string {
  let pathname = raw
  let query = new URLSearchParams()
  try {
    // 既可能是完整 https 链接，也可能只是路径（自定义 scheme 时 expo-router 给的是路径）
    const url = new URL(raw, 'https://findmyjob.asia')
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      // findmyjob://jobs/abc 这种：host 当作第一段路径
      pathname = `/${url.host}${url.pathname}`
    } else {
      pathname = url.pathname
    }
    query = url.searchParams
  } catch {
    return '/'
  }
  // App 自己的路由（推送、内部跳转）原样放行，但只限几种已知形态
  if (/^\/(jobs|companies|applications)(\/[A-Za-z0-9_-]{1,64})?\/?$/.test(pathname) || pathname === '/notifications' || pathname === '/home') {
    return pathname + (pathname === '/applications' && query.get('tab') === 'invitations' ? '?tab=invitations' : '')
  }
  for (const [re, to] of RULES) {
    const m = pathname.match(re)
    if (m) return to(m, query)
  }
  return '/'
}

/** app.config 的 intent-filter 用：哪些网页路径前缀由 App 接管 */
// 只列具体页面：/s/privacy/exports 之类的下载链接、设置页必须留给浏览器
export const APP_LINK_PATH_PREFIXES = ['/zh/s/jobs', '/en/s/jobs', '/zh/s/applications', '/en/s/applications', '/zh/s/invitations', '/en/s/invitations', '/zh/s/notifications', '/en/s/notifications', '/zh/jobs/', '/en/jobs/', '/zh/companies/', '/en/companies/'] as const
