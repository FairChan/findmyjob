import { CATEGORIES, companyById as defaultCompanyById, type Company, type Job } from '../data/mock'
import { SYNONYM_GROUPS } from '../data/synonyms'
import { industryName } from '../data/taxonomy'

// 职位搜索：精确 / 关联两种模式（PRD v0.2 §2.4，ARCHITECTURE §5.4 v0.2）
export type SearchMode = 'EXACT' | 'RELATED'
export interface SearchHit { job: Job; score: number; matchedBy: 'exact' | 'related' }

const isAscii = (s: string) => /^[\x20-\x7e]+$/.test(s)

/** 原词 + 同组词，全部小写去重，原词排第一。中文词允许"包含"命中，英文词必须完全相同，避免 bim 被 bi 带出去 */
export function expandTerms(term: string, groups: string[][] = SYNONYM_GROUPS): string[] {
  const t = term.trim().toLowerCase()
  const out = [t]
  for (const g of groups) {
    const words = g.map((w) => w.toLowerCase())
    if (words.some((w) => w === t || (!isAscii(w) && t.includes(w)))) out.push(...words)
  }
  return [...new Set(out)]
}

// 短英文词按单词边界匹配，免得 ai 命中 email
function contains(hay: string, term: string) {
  if (isAscii(term) && term.length <= 3) return new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(hay)
  return hay.includes(term)
}

// 字段权重：[精确命中, 经同义词命中]
const FIELDS: { pick: (j: Job, c: Company) => string; exact: number; related: number }[] = [
  { pick: (j) => j.title, exact: 100, related: 60 },
  { pick: (j) => [...j.skills, CATEGORIES.find((x) => x.key === j.category)?.name ?? ''].join(' '), exact: 40, related: 25 },
  { pick: (j, c) => [c.name, c.short, industryName(c.industryCode)].join(' '), exact: 20, related: 15 },
  { pick: (j) => [...j.description, ...j.requirements].join(' '), exact: 10, related: 5 },
]

export function searchJobs(
  jobs: Job[], q: string, mode: SearchMode,
  opts: { fallbackBelow?: number; groups?: string[][]; companyById?: (id: string) => Company; canSeeBody?: (job: Job) => boolean } = {},
): { exact: SearchHit[]; related: SearchHit[] } {
  // canSeeBody：看不到详情的职位，不拿描述和要求参与匹配，否则搜索结果会泄露锁住的内容
  const { fallbackBelow = 5, groups = SYNONYM_GROUPS, companyById = defaultCompanyById, canSeeBody = () => true } = opts
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const byNewest = (a: SearchHit, b: SearchHit) => b.score - a.score || +new Date(b.job.publishedAt) - +new Date(a.job.publishedAt)
  if (!tokens.length) return { exact: jobs.map((job) => ({ job, score: 0, matchedBy: 'exact' as const })).sort(byNewest), related: [] }

  const expanded = tokens.map((t) => expandTerms(t, groups))
  const exact: SearchHit[] = []
  const related: SearchHit[] = []
  for (const job of jobs) {
    const c = companyById(job.companyId)
    const body = canSeeBody(job)
    const hays = FIELDS.map((f, k) => (k === FIELDS.length - 1 && !body ? '' : f.pick(job, c).toLowerCase()))
    let exactScore = 0, relatedScore = 0, allExact = true, allRelated = true
    tokens.forEach((t, i) => {
      const e = Math.max(0, ...FIELDS.map((f, k) => (contains(hays[k], t) ? f.exact : 0)))
      const r = Math.max(e, ...FIELDS.map((f, k) => (expanded[i].some((w) => contains(hays[k], w)) ? f.related : 0)))
      if (!e) allExact = false
      if (!r) allRelated = false
      exactScore += e
      relatedScore += r
    })
    if (allExact) exact.push({ job, score: exactScore, matchedBy: 'exact' })
    else if (allRelated) related.push({ job, score: relatedScore, matchedBy: 'related' })
  }
  exact.sort(byNewest)
  related.sort(byNewest)
  const showRelated = mode === 'RELATED' || exact.length < fallbackBelow
  return { exact, related: showRelated ? related : [] }
}
