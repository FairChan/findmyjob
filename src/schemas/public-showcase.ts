import { z } from 'zod'

export const PUBLIC_SHOWCASE_KEY = 'public.showcase'
export const SHOWCASE_LIMIT = 12
const ids = z.array(z.string().trim().min(1).max(64)).max(SHOWCASE_LIMIT)
  .refine(value => new Set(value).size === value.length, 'Duplicate selections')
const copy = z.object({ title: z.string().trim().max(80), description: z.string().trim().max(240) }).strict()
const bilingualCopy = z.object({ zh: copy, en: copy }).strict()

export const publicShowcaseSchema = z.object({
  jobIds: ids,
  companyIds: ids,
  jobs: bilingualCopy,
  companies: bilingualCopy,
}).strict()

export type PublicShowcaseConfig = z.infer<typeof publicShowcaseSchema>
export const DEFAULT_PUBLIC_SHOWCASE: PublicShowcaseConfig = {
  jobIds: [], companyIds: [],
  jobs: { zh: { title: '', description: '' }, en: { title: '', description: '' } },
  companies: { zh: { title: '', description: '' }, en: { title: '', description: '' } },
}

export function parsePublicShowcase(value: unknown): PublicShowcaseConfig {
  const parsed = publicShowcaseSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_PUBLIC_SHOWCASE
}
