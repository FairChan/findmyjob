import { readFileSync } from 'fs'
import { join } from 'path'

export type LegalDoc = 'privacy' | 'terms'

export function readLegalMarkdown(doc: LegalDoc, locale: string): string {
  const fileMap: Record<LegalDoc, Record<string, string>> = {
    privacy: {
      zh: 'privacy-policy.zh.md',
      en: 'privacy-policy.en.md',
    },
    terms: {
      zh: 'terms.zh.md',
      en: 'terms.en.md',
    },
  }

  const filename = fileMap[doc][locale] ?? fileMap[doc]['zh']
  const filePath = join(process.cwd(), 'src', 'content', 'legal', filename)
  return readFileSync(filePath, 'utf-8')
}
