import type { MetadataRoute } from 'next'
import { db } from '@/server/db'

const BASE_URL = (process.env.APP_URL ?? '').replace(/\/$/, '')
const LOCALES = ['zh', 'en'] as const

function altLinks(path: string) {
  return {
    'zh-Hans': `${BASE_URL}/zh${path}`,
    en: `${BASE_URL}/en${path}`,
    'x-default': `${BASE_URL}/zh${path}`,
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = []

  // Static public pages (both locales)
  const staticPaths = ['', '/for-employers', '/partners', '/jobs', '/companies']
  for (const locale of LOCALES) {
    for (const path of staticPaths) {
      entries.push({
        url: `${BASE_URL}/${locale}${path}`,
        lastModified: new Date(),
        alternates: { languages: altLinks(path) },
      })
    }
  }

  // Verified company pages
  const companies = await db.company.findMany({
    where: { verificationStatus: 'VERIFIED', isActive: true },
    select: { id: true, updatedAt: true },
    orderBy: { id: 'asc' },
  })

  for (const locale of LOCALES) {
    for (const company of companies) {
      entries.push({
        url: `${BASE_URL}/${locale}/companies/${company.id}`,
        lastModified: company.updatedAt,
        alternates: { languages: altLinks(`/companies/${company.id}`) },
      })
    }
  }

  return entries
}
