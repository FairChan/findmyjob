import { describe, expect, it, vi, afterEach } from 'vitest'
import { androidAssetLinks } from '@/server/lib/android-app-links'
import { GET } from '@/app/.well-known/assetlinks.json/route'

const FP = Array.from({ length: 32 }, (_, i) => (i * 7).toString(16).padStart(2, '0').toUpperCase()).join(':')

describe('androidAssetLinks', () => {
  it('builds one statement per valid package and drops malformed input', () => {
    expect(androidAssetLinks(`asia.findmyjob.app=${FP}|${FP.toLowerCase()},bad pkg=${FP},asia.findmyjob.app.staging=nope`)).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'asia.findmyjob.app', sha256_cert_fingerprints: [FP, FP] },
      },
    ])
    expect(androidAssetLinks(undefined)).toEqual([])
  })
})

describe('GET /.well-known/assetlinks.json', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('is public JSON, cacheable, and empty when unconfigured', async () => {
    vi.stubEnv('ANDROID_APP_LINKS', '')
    const res = await GET(new Request('http://localhost:3000/.well-known/assetlinks.json'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(await res.json()).toEqual([])
    vi.stubEnv('ANDROID_APP_LINKS', `asia.findmyjob.app=${FP}`)
    const body = await (await GET(new Request('http://localhost:3000/.well-known/assetlinks.json'))).json()
    expect(body[0].target.package_name).toBe('asia.findmyjob.app')
  })
})
