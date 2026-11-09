/**
 * Sitemap (M7-T17): only VERIFIED + active companies, absolute URLs from the validated env,
 * no private areas, and rendered per request (the image build has no database).
 */
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

// A trailing slash must not produce '//' in the URLs.
vi.mock('@/env', () => ({ env: { APP_URL: 'https://findmyjob.example.test/' } }))

import { setupTestDb, testDb } from '../setup/db'
import * as sitemapModule from '@/app/sitemap'

setupTestDb()

async function mkCompany(legalName: string, verificationStatus: 'VERIFIED' | 'PENDING' | 'REJECTED', isActive: boolean) {
  return testDb.company.create({ data: { legalName, verificationStatus, isActive } })
}

describe('sitemap', () => {
  it('is rendered per request, not at build time', () => {
    // A statically prerendered sitemap queries the database during `next build`, which fails in
    // the Docker/CI image build (no database) and would freeze the company list at build time.
    expect(sitemapModule.dynamic).toBe('force-dynamic')
  })

  it('lists only VERIFIED and active companies, in both locales, with absolute URLs', async () => {
    const suffix = `${Date.now()}`
    const ok = await mkCompany(`Sitemap OK ${suffix}`, 'VERIFIED', true)
    const pending = await mkCompany(`Sitemap Pending ${suffix}`, 'PENDING', true)
    const rejected = await mkCompany(`Sitemap Rejected ${suffix}`, 'REJECTED', true)
    const inactive = await mkCompany(`Sitemap Inactive ${suffix}`, 'VERIFIED', false)

    const urls = (await sitemapModule.default()).map((e) => e.url)

    expect(urls).toContain(`https://findmyjob.example.test/zh/companies/${ok.id}`)
    expect(urls).toContain(`https://findmyjob.example.test/en/companies/${ok.id}`)
    for (const c of [pending, rejected, inactive]) {
      expect(urls.some((u) => u.includes(c.id))).toBe(false)
    }
    expect(urls.every((u) => u.startsWith('https://findmyjob.example.test/'))).toBe(true)
    expect(urls.some((u) => u.includes('//', 'https://'.length))).toBe(false)
  })

  it('never lists the student, employer or admin areas', async () => {
    const urls = (await sitemapModule.default()).map((e) => e.url)
    expect(urls.some((u) => /\/(zh|en)\/(s|e|admin)(\/|$)/.test(u))).toBe(false)
    expect(urls.some((u) => u.includes('/api/'))).toBe(false)
  })

  it('declares zh-Hans, en and x-default alternates', async () => {
    const first = (await sitemapModule.default())[0]
    expect(Object.keys(first.alternates?.languages ?? {}).sort()).toEqual(['en', 'x-default', 'zh-Hans'])
  })
})
