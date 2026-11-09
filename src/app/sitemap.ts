import type { MetadataRoute } from 'next'
import { db } from '@/server/db'
import { env } from '@/env'

// Built per request, not at `next build`: the image build has no database (and no APP_URL), and a
// build-time list would miss companies verified later and keep rejected or deactivated ones.
export const dynamic = 'force-dynamic'

const LOCALES = ['zh', 'en'] as const
// Upper bound for one sitemap file is 50,000 URLs; each company appears once per locale.
const MAX_COMPANIES = 20_000

function altLinks(baseUrl: string, path: string) {
  return {
    'zh-Hans': `${baseUrl}/zh${path}`,
    en: `${baseUrl}/en${path}`,
    'x-default': `${baseUrl}/zh${path}`,
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.APP_URL.replace(/\/$/, '')
  const entries: MetadataRoute.Sitemap = []

  // Static public pages (both locales)
  const staticPaths = ['', '/for-employers', '/partners', '/jobs', '/companies']
  for (const locale of LOCALES) {
    for (const path of staticPaths) {
      entries.push({
        url: `${baseUrl}/${locale}${path}`,
        lastModified: new Date(),
        alternates: { languages: altLinks(baseUrl, path) },
      })
    }
  }

  // Verified, active company pages only
  const companies = await db.company.findMany({
    where: { verificationStatus: 'VERIFIED', isActive: true },
    select: { id: true, updatedAt: true },
    orderBy: { id: 'asc' },
    take: MAX_COMPANIES,
  })

  for (const locale of LOCALES) {
    for (const company of companies) {
      entries.push({
        url: `${baseUrl}/${locale}/companies/${company.id}`,
        lastModified: company.updatedAt,
        alternates: { languages: altLinks(baseUrl, `/companies/${company.id}`) },
      })
    }
  }

  return entries
}
