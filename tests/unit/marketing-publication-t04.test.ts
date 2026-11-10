import { expect, it } from 'vitest'
import { isMarketingDisclosurePublished } from '@/server/lib/marketing-disclosure'

it.each(['2026-11-draft', 'synthetic-policy', ''])('keeps unpublished release %s disabled', async version => {
  await expect(isMarketingDisclosurePublished(version)).resolves.toBe(false)
})
