import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// next-intl 的中间件在 vitest 的 ESM 解析下加载不了（它 import 'next/server' 不带扩展名）；这里只测会话 cookie 分支，语言路由用直通替身
vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }))

const { default: middleware } = await import('@/proxy')

// 生产环境 useSecureCookies 会给会话 cookie 加 __Secure- 前缀；proxy 必须两种名字都认，否则上线后已登录用户一律被踢回登录页
function req(path: string, cookie?: string) {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  return new NextRequest(new URL(path, 'https://app.example.test'), { headers })
}

describe('proxy session cookie check', () => {
  it('redirects a protected page to login when there is no session cookie', async () => {
    const res = await middleware(req('/zh/s'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/zh/login?redirect=%2Fzh%2Fs')
  })

  it('lets a protected page through with the plain cookie name (development)', async () => {
    const res = await middleware(req('/zh/s', 'better-auth.session_token=abc.def'))
    expect(res.headers.get('location') ?? '').not.toContain('/login')
  })

  it('lets a protected page through with the __Secure- cookie name (production)', async () => {
    const res = await middleware(req('/zh/s', '__Secure-better-auth.session_token=abc.def'))
    expect(res.headers.get('location') ?? '').not.toContain('/login')
  })

  it('returns 401 for a protected API without a session cookie', async () => {
    const res = await middleware(req('/api/example'))
    expect(res.status).toBe(401)
  })

  it('lets a protected API through with the __Secure- cookie name', async () => {
    const res = await middleware(req('/api/example', '__Secure-better-auth.session_token=abc.def'))
    expect(res.status).not.toBe(401)
  })
})
