import 'server-only'
import { createHash } from 'node:crypto'
import { readLegalMarkdown } from '@/lib/legal-content'

type Publication = { legalVersion: string; zhSha256: string; enSha256: string }
// Release-owned: null deliberately closes activation while the bilingual policy remains a draft.
const publication: Publication | null = null
export async function isMarketingDisclosurePublished(version: string): Promise<boolean> {
  const current = publication as Publication | null
  if (!current || current.legalVersion !== version) return false
  try {
    return (['zh', 'en'] as const).every(locale => {
      const text = readLegalMarkdown('privacy', locale)
      const digest = createHash('sha256').update(text).digest('hex')
      return digest === current[locale === 'zh' ? 'zhSha256' : 'enSha256']
    })
  } catch { return false }
}
