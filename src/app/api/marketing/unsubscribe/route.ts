import { createHash } from 'node:crypto'
import { route } from '@/server/route'
import { unsubscribeMarketing } from '@/server/services/marketing-consent'
import { getClientIp } from '@/server/lib/client-ip'
import { checkRateLimit } from '@/server/lib/rate-limit'

export const runtime = 'nodejs'
const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'x-content-type-options': 'nosniff' }
const documentStart = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe / 退订</title></head><body><main aria-labelledby="unsubscribe-title"><h1 id="unsubscribe-title">Unsubscribe / <span lang="zh-Hans">退订</span></h1>'
const documentEnd = '</main></body></html>'
const completion = documentStart + '<p role="status" aria-live="polite" tabindex="-1" autofocus>Your weekly email preference has been processed. <span lang="zh-Hans">每周邮件偏好已处理。</span></p>' + documentEnd
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
async function rateLimit(request: Request): Promise<Response | null> {
  // Deployment already trusts only Caddy's x-real-ip, never caller x-forwarded-for.
  const ip = getClientIp(request.headers)
  const identity = createHash('sha256').update(ip && ip.length <= 64 ? ip : 'unknown').digest('hex')
  try {
    const result = await checkRateLimit(`marketing-unsubscribe:${request.method}:${identity}`, { windowMs: 60_000, limit: request.method === 'POST' ? 30 : 60 })
    return result.allowed ? null : new Response('Please try again later. 请稍后重试。', { status: 429, headers: { ...headers, 'retry-after': '60' } })
  } catch { return new Response('Please try again later. 请稍后重试。', { status: 503, headers }) }
}
export const GET = route({ auth: 'public' }, async request => {
  const limited = await rateLimit(request)
  if (limited) return limited
  const token = new URL(request.url).searchParams.get('token') ?? ''
  const value = token.length <= 512 ? token : ''
  return new Response(documentStart + `<form method="post" action="/api/marketing/unsubscribe"><input type="hidden" name="token" value="${escape(value)}"><button type="submit" autofocus>Stop weekly emails / <span lang="zh-Hans">停止每周邮件</span></button></form>` + documentEnd, { headers })
})
// The signed token authorizes withdrawal only. No cookie, Origin or current
// policy is required; strict bounded parsing and signature validation stay below.
export const POST = route({ auth: 'public', skipOriginCheck: true }, async request => {
  const limited = await rateLimit(request)
  if (limited) return limited
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (type !== 'application/x-www-form-urlencoded') return new Response('Invalid request', { status: 400, headers })
  const reader = request.body?.getReader()
  if (!reader) return new Response('Invalid request', { status: 400, headers })
  const chunks: Uint8Array[] = []; let bytes = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > 2048) { await reader.cancel(); return new Response('Invalid request', { status: 400, headers }) }
      chunks.push(result.value)
    }
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
    if ([...form.keys()].some(key => key !== 'token') || form.getAll('token').length !== 1) return new Response('Invalid request', { status: 400, headers })
    await unsubscribeMarketing(form.get('token')!)
    return new Response(completion, { headers })
  } catch { return new Response('Please try again later. 请稍后重试。', { status: 503, headers }) }
  finally { reader.releaseLock() }
})
