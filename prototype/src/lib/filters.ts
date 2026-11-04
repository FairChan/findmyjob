import type { Company, Job, JobType } from '../data/mock'
import { industryMatches, type CompanyTag, type Landmark } from '../data/taxonomy'

// 职位筛选：可选项，不选就不限（PRD v0.2 §2.4）
export interface JobFilters {
  type?: JobType; state?: string; cat?: string; lang?: string; pass?: 'sp' | 'wp'
  industry?: string; tags?: CompanyTag[]; size?: string; salaryAtLeast?: number
  near?: { landmarkId: string; radiusKm: number }
}

const rad = (d: number) => (d * Math.PI) / 180
/** 球面距离（haversine），单位公里 */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export function filterJobs(jobs: Job[], f: JobFilters, ctx: { companyById: (id: string) => Company; landmarks: Landmark[] }): Job[] {
  const center = f.near && ctx.landmarks.find((l) => l.id === f.near!.landmarkId)
  return jobs.filter((j) => {
    const c = ctx.companyById(j.companyId)
    if (f.type && j.type !== f.type) return false
    if (f.state && j.state !== f.state) return false
    if (f.cat && j.category !== f.cat) return false
    if (f.lang && !j.languages.includes(f.lang)) return false
    if (f.pass && !(f.pass === 'sp' ? j.acceptsStudentPass : j.sponsorsWorkPass)) return false
    if (f.industry && !industryMatches(c.industryCode, f.industry)) return false
    if (f.tags?.length && !f.tags.some((t) => c.tags.includes(t))) return false
    if (f.size && c.size !== f.size) return false
    // 隐藏薪资的职位不参与薪资档筛选，避免借筛选反推出薪资
    if (f.salaryAtLeast && (j.salaryHidden || j.salaryMax < f.salaryAtLeast)) return false
    if (center && distanceKm(j, center) > f.near!.radiusKm) return false
    return true
  })
}

const TAGS: CompanyTag[] = ['FORTUNE_500', 'MULTINATIONAL', 'MY_LEADING', 'CN_OVERSEAS', 'SOE', 'ALUMNI', 'CHINESE_MY']

export function parseFilters(p: URLSearchParams): JobFilters {
  const f: JobFilters = {}
  const s = (k: string) => p.get(k) || undefined
  if (s('type')) f.type = s('type') as JobType
  for (const k of ['state', 'cat', 'lang', 'industry', 'size'] as const) if (s(k)) f[k] = s(k)
  if (s('pass') === 'sp' || s('pass') === 'wp') f.pass = s('pass') as 'sp' | 'wp'
  const tags = (s('tags') ?? '').split(',').filter((t): t is CompanyTag => TAGS.includes(t as CompanyTag))
  if (tags.length) f.tags = tags
  const salary = Number(s('salary'))
  if (salary > 0) f.salaryAtLeast = salary
  const r = Number(s('r'))
  if (s('near') && r > 0) f.near = { landmarkId: s('near')!, radiusKm: r }
  return f
}

export function toParams(f: JobFilters): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of ['type', 'state', 'cat', 'lang', 'pass', 'industry', 'size'] as const) if (f[k]) o[k] = f[k]!
  if (f.tags?.length) o.tags = f.tags.join(',')
  if (f.salaryAtLeast) o.salary = String(f.salaryAtLeast)
  if (f.near) { o.near = f.near.landmarkId; o.r = String(f.near.radiusKm) }
  return o
}

/** 已选了几项，用来显示"更多筛选（3）" */
export const activeFilterCount = (f: JobFilters) => Object.keys(toParams(f)).filter((k) => k !== 'r').length
