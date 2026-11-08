import 'server-only'
import { Prisma } from '@prisma/client'
import type { JobType, WorkMode, CompanyTag, CompanySize } from '@prisma/client'
import { db } from '../db'
import { getSetting } from './settings'
import { INDUSTRIES, getIndustryLabel } from '../lib/taxonomy/industries'
import { toJobListItem, type JobListItem } from '../serializers/job'

export type SearchMode = 'EXACT' | 'RELATED'

export interface SearchFilters {
  type?: JobType
  workMode?: WorkMode
  state?: string
  sort?: 'relevance' | 'salary'
  /** Two-level industry code; selecting a parent includes all its children. */
  industry?: string
  /** Company positioning tags; job matches if company has any of the selected tags. */
  tags?: CompanyTag[]
  /** Company size filter. */
  size?: CompanySize
  /** Salary band: job must have salaryMax >= this value; hidden-salary jobs are excluded. */
  salaryAtLeast?: number
}

export interface SearchPage {
  cursor?: string
  limit?: number
}

export interface SearchParams {
  q: string
  mode?: SearchMode
  filters?: SearchFilters
  page?: SearchPage
  /**
   * Pass true only when the caller confirmed the viewer has remaining quota
   * (or is staff). Prevents description words from leaking locked jobs.
   */
  canSeeDescription?: boolean
}

export interface SearchHit {
  job: JobListItem
  score: number
  matchedBy: 'exact' | 'related'
}

export interface SearchResult {
  exact: SearchHit[]
  related: SearchHit[]
  nextCursor: string | null
}

// ----- Pure helpers (exported for testing) -----

/** Escape backslash, %, and _ so they cannot act as ILIKE wildcards. */
export function escapeIlike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

const isAscii = (s: string) => /^[\x20-\x7e]+$/.test(s)

/**
 * Expand a query term to its synonym group (from SearchSynonymGroup table or in-memory default).
 * English words ≤3 chars require exact boundary match to avoid "ai" pulling out "email".
 * Chinese terms allow substring matching within synonyms.
 */
export function expandTerms(term: string, groups: string[][]): string[] {
  const t = term.trim().toLowerCase()
  const out = [t]
  for (const g of groups) {
    const words = g.map((w) => w.toLowerCase())
    if (words.some((w) => w === t || (!isAscii(w) && t.includes(w)))) {
      out.push(...words)
    }
  }
  return [...new Set(out)]
}

/** Check if haystack contains term (English short words require word boundary). */
function termContains(hay: string, term: string): boolean {
  if (isAscii(term) && term.length <= 3) {
    return new RegExp(
      `(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`,
    ).test(hay)
  }
  return hay.includes(term)
}

// Weights: [exact, related] per haystack field index
// 0: title, 1: skills+category, 2: company+industry, 3: description+requirements
const EXACT_W = [100, 40, 20, 10]
const RELATED_W = [60, 25, 15, 5]

interface CandidateJob {
  id: string
  title: string
  type: JobType
  category: string | null
  workMode: WorkMode
  state: string | null
  city: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryVisible: boolean
  languages: string[]
  skills: string[]
  acceptsStudentPass: boolean
  sponsorsWorkPass: boolean
  headcount: number | null
  deadline: Date | null
  publishedAt: Date | null
  description: string
  requirements: string | null
  company: {
    id: string
    legalName: string
    displayNameZh: string | null
    displayNameEn: string | null
    industryCode: string | null
  }
}

function scoreCandidate(
  job: CandidateJob,
  tokens: string[],
  expandedTokens: string[][],
  canSeeDescription: boolean,
): { score: number; matchedBy: 'exact' | 'related' } | null {
  const title = job.title.toLowerCase()
  const skillsCat = [...(job.skills ?? []), job.category ?? ''].join(' ').toLowerCase()
  const companyNames = [
    job.company.legalName,
    job.company.displayNameZh,
    job.company.displayNameEn,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const industryLabel = job.company.industryCode
    ? [
        getIndustryLabel(job.company.industryCode, 'zh'),
        getIndustryLabel(job.company.industryCode, 'en'),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    : ''
  const companyIndustry = `${companyNames} ${industryLabel}`.trim()
  const bodyText = canSeeDescription
    ? [job.description, job.requirements ?? ''].join(' ').toLowerCase()
    : ''

  const hays = [title, skillsCat, companyIndustry, bodyText]

  let exactScore = 0
  let relatedScore = 0
  let allExact = true
  let allRelated = true

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const expanded = expandedTokens[i]

    // Best exact score across all fields
    const e = Math.max(0, ...hays.map((h, k) => (termContains(h, t) ? EXACT_W[k] : 0)))
    // Best related score across fields × synonyms
    const r = Math.max(
      e,
      ...hays.flatMap((h, k) =>
        expanded.map((w) => (termContains(h, w) ? RELATED_W[k] : 0)),
      ),
    )

    if (!e) allExact = false
    if (!r) allRelated = false
    exactScore += e
    relatedScore += r
  }

  if (allExact) return { score: exactScore, matchedBy: 'exact' }
  if (allRelated) return { score: relatedScore, matchedBy: 'related' }
  return null
}

// ----- Synonym cache -----

let _synonymCache: { groups: string[][]; expiresAt: number } | null = null

/** Clear the synonym cache; for unit tests only. */
export function _clearSynonymCache(): void {
  _synonymCache = null
}

async function getCachedSynonymGroups(): Promise<string[][]> {
  if (_synonymCache && Date.now() < _synonymCache.expiresAt) return _synonymCache.groups
  const rows = await db.searchSynonymGroup.findMany({
    where: { active: true },
    select: { terms: true },
  })
  const groups = rows.map((r) => r.terms)
  _synonymCache = { groups, expiresAt: Date.now() + 60_000 }
  return groups
}

// ----- Industry codes matching -----

function findIndustryCodes(terms: string[]): string[] {
  const codes: string[] = []
  for (const term of terms) {
    for (const parent of INDUSTRIES) {
      if (
        parent.labelZh.toLowerCase().includes(term) ||
        parent.labelEn.toLowerCase().includes(term)
      ) {
        codes.push(...parent.children.map((c) => c.code))
      }
      for (const child of parent.children) {
        if (
          child.labelZh.toLowerCase().includes(term) ||
          child.labelEn.toLowerCase().includes(term) ||
          child.code.toLowerCase().includes(term)
        ) {
          codes.push(child.code)
        }
      }
    }
  }
  return [...new Set(codes)]
}

// ----- Raw query row type -----

type RawJobRow = {
  id: string
  title: string
  type: string
  category: string | null
  workMode: string
  state: string | null
  city: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryVisible: boolean
  languages: string[]
  skills: string[]
  acceptsStudentPass: boolean
  sponsorsWorkPass: boolean
  headcount: number | null
  deadline: Date | null
  publishedAt: Date | null
  description: string
  requirements: string | null
  cId: string
  legalName: string
  displayNameZh: string | null
  displayNameEn: string | null
  industryCode: string | null
}

// ----- Main search function -----

export async function searchJobs(params: SearchParams): Promise<SearchResult> {
  const { q, filters = {}, page = {}, canSeeDescription = false } = params
  const { cursor, limit = 20 } = page
  const { type, workMode, state, sort = 'relevance', industry, tags, size, salaryAtLeast } = filters

  const [defaultMode, fallbackBelow, candidateWindowSetting] = await Promise.all([
    getSetting<string>('search.defaultMode', 'RELATED'),
    getSetting<number>('search.relatedFallbackBelow', 5),
    getSetting<unknown>('search.candidateWindow', 500),
  ])
  // SystemSetting values are untyped JSON (and editable from the admin settings page): coerce to an
  // integer in [1, 5000] before it reaches LIMIT, and bind it as a parameter, never as raw SQL.
  const windowNum = Number(candidateWindowSetting)
  const candidateWindow =
    Number.isInteger(windowNum) && windowNum > 0 ? Math.min(windowNum, 5000) : 500
  const mode: SearchMode = (params.mode ?? defaultMode) as SearchMode

  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean)

  // ----- Empty query: return all published jobs -----
  if (!tokens.length) {
    const baseSelect = {
      id: true, title: true, type: true, category: true, workMode: true,
      state: true, city: true, salaryMin: true, salaryMax: true, salaryVisible: true,
      languages: true, skills: true, acceptsStudentPass: true, sponsorsWorkPass: true,
      headcount: true, deadline: true, publishedAt: true,
      company: { select: { id: true, legalName: true, displayNameZh: true, displayNameEn: true } },
    } as const
    const now = new Date()

    // Build company-level filter for industry / tags / size
    const companyWhere: Prisma.CompanyWhereInput = {}
    if (industry) {
      // Use raw SQL to properly escape LIKE wildcards (industry comes from user input)
      const matchingCos = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Company"
        WHERE "industryCode" = ${industry}
           OR "industryCode" LIKE ${escapeIlike(industry) + '.%'}
      `
      companyWhere.id = { in: matchingCos.map((r) => r.id) }
    }
    if (tags?.length) companyWhere.tags = { hasSome: tags }
    if (size) companyWhere.size = size

    const jobWhere: Prisma.JobWhereInput = {
      status: 'PUBLISHED',
      AND: [{ OR: [{ deadline: null }, { deadline: { gt: now } }] }],
      ...(type ? { type } : {}),
      ...(workMode ? { workMode } : {}),
      ...(state ? { state } : {}),
      ...(salaryAtLeast ? { salaryVisible: true, salaryMax: { gte: salaryAtLeast } } : {}),
      company: { isActive: true, ...companyWhere },
    }

    if (sort === 'salary') {
      // Salary sort needs all candidates ranked by salary; cap with candidateWindow
      const jobs = await db.job.findMany({
        where: jobWhere,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        take: candidateWindow,
        select: baseSelect,
      })
      const all: SearchHit[] = jobs.map((j) => ({
        job: toJobListItem(j),
        score: 0,
        matchedBy: 'exact' as const,
      }))
      all.sort((a, b) => {
        const av = a.job.salaryMax !== null ? a.job.salaryMax : -Infinity
        const bv = b.job.salaryMax !== null ? b.job.salaryMax : -Infinity
        return bv - av
      })
      const start = cursor ? all.findIndex((h) => h.job.id === cursor) + 1 : 0
      const pageItems = all.slice(start, start + limit)
      return {
        exact: pageItems,
        related: [],
        nextCursor:
          start + pageItems.length < all.length
            ? pageItems[pageItems.length - 1]?.job.id ?? null
            : null,
      }
    }

    // Relevance sort: sort-key cursor via Prisma cursor pagination (bounded, no full-scan)
    const jobs = await db.job.findMany({
      where: jobWhere,
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: baseSelect,
    })
    const hasMore = jobs.length > limit
    const pageItems = hasMore ? jobs.slice(0, limit) : jobs
    const hits: SearchHit[] = pageItems.map((j) => ({
      job: toJobListItem(j),
      score: 0,
      matchedBy: 'exact' as const,
    }))
    return {
      exact: hits,
      related: [],
      nextCursor: hasMore ? (pageItems[pageItems.length - 1]?.id ?? null) : null,
    }
  }

  // ----- Synonym expansion -----
  const synonymGroups = await getCachedSynonymGroups()
  const expandedTokens = tokens.map((t) => expandTerms(t, synonymGroups))

  // All search patterns (original + synonyms for RELATED, only original for EXACT SQL pre-filter)
  const sqlTerms =
    mode === 'RELATED' ? [...new Set(expandedTokens.flat())] : tokens

  const likePatterns = sqlTerms.map((t) => `%${escapeIlike(t)}%`)

  // Build OR conditions for each searchable field
  const titleConds = Prisma.join(
    likePatterns.map((p) => Prisma.sql`j."title" ILIKE ${p}`),
    ' OR ',
  )
  const skillsConds = Prisma.join(
    likePatterns.map((p) =>
      Prisma.sql`EXISTS (SELECT 1 FROM unnest(j."skills") s WHERE s ILIKE ${p})`,
    ),
    ' OR ',
  )
  const catConds = Prisma.join(
    likePatterns.map((p) => Prisma.sql`j."category" ILIKE ${p}`),
    ' OR ',
  )
  const companyConds = Prisma.join(
    likePatterns.map(
      (p) =>
        Prisma.sql`(c."legalName" ILIKE ${p} OR c."displayNameZh" ILIKE ${p} OR c."displayNameEn" ILIKE ${p})`,
    ),
    ' OR ',
  )

  const descConds = canSeeDescription
    ? Prisma.sql`OR (${Prisma.join(likePatterns.map((p) => Prisma.sql`(j."description" ILIKE ${p} OR j."requirements" ILIKE ${p})`), ' OR ')})`
    : Prisma.empty

  // Industry code filter: convert term matches to industry codes
  const allSearchTerms = [...new Set(expandedTokens.flat())]
  const industryCodes = findIndustryCodes(allSearchTerms)
  const industryFilter =
    industryCodes.length > 0
      ? Prisma.sql`OR c."industryCode" = ANY(${industryCodes})`
      : Prisma.empty

  // Static filters
  const typeFilter = type ? Prisma.sql`AND j."type"::text = ${type}` : Prisma.empty
  const stateFilter = state ? Prisma.sql`AND j."state" = ${state}` : Prisma.empty
  const workModeFilter = workMode
    ? Prisma.sql`AND j."workMode"::text = ${workMode}`
    : Prisma.empty

  // Extended filters (M5-T10)
  const industryParamFilter = industry
    ? Prisma.sql`AND (c."industryCode" = ${industry} OR c."industryCode" LIKE ${escapeIlike(industry) + '.%'})`
    : Prisma.empty
  const tagsParamFilter =
    tags?.length
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM unnest(c."tags") t WHERE t::text = ANY(ARRAY[${Prisma.join(tags.map((t) => Prisma.sql`${t}`), ',')}]))`
      : Prisma.empty
  const sizeParamFilter = size ? Prisma.sql`AND c."size"::text = ${size}` : Prisma.empty
  const salaryBandFilter = salaryAtLeast
    ? Prisma.sql`AND j."salaryVisible" = true AND j."salaryMax" >= ${salaryAtLeast}`
    : Prisma.empty

  // Only fetch description/requirements when the caller is allowed to search them.
  // This avoids transferring large text columns on every search request.
  const descSelect = canSeeDescription
    ? Prisma.sql`j."description", j."requirements",`
    : Prisma.sql`'' AS "description", null AS "requirements",`

  // Fetch candidate jobs using ILIKE (triggers gin_trgm_ops index on "title").
  // LIMIT bounds the candidate window so the app-side scorer never processes
  // the entire table — search.candidateWindow rows at most per request.
  const rows = await db.$queryRaw<RawJobRow[]>`
    SELECT DISTINCT
      j."id", j."title", j."type", j."category", j."workMode",
      j."state", j."city", j."salaryMin", j."salaryMax", j."salaryVisible",
      j."languages", j."skills", j."acceptsStudentPass", j."sponsorsWorkPass",
      j."headcount", j."deadline", j."publishedAt",
      ${descSelect}
      c."id" AS "cId", c."legalName", c."displayNameZh", c."displayNameEn", c."industryCode"
    FROM "Job" j
    JOIN "Company" c ON c."id" = j."companyId"
    WHERE j."status" = 'PUBLISHED'
      AND (j."deadline" IS NULL OR j."deadline" > NOW())
      AND c."isActive" = true
      ${typeFilter}
      ${stateFilter}
      ${workModeFilter}
      ${industryParamFilter}
      ${tagsParamFilter}
      ${sizeParamFilter}
      ${salaryBandFilter}
      AND (
        (${titleConds})
        OR (${skillsConds})
        OR (${catConds})
        OR (${companyConds})
        ${descConds}
        ${industryFilter}
      )
    ORDER BY j."publishedAt" DESC, j."id" ASC
    LIMIT ${candidateWindow}
  `

  // ----- Score candidates in app code -----
  const exact: SearchHit[] = []
  const related: SearchHit[] = []

  for (const row of rows) {
    const job: CandidateJob = {
      id: row.id,
      title: row.title,
      type: row.type as JobType,
      category: row.category,
      workMode: row.workMode as WorkMode,
      state: row.state,
      city: row.city,
      salaryMin: row.salaryMin,
      salaryMax: row.salaryMax,
      salaryVisible: row.salaryVisible,
      languages: row.languages ?? [],
      skills: row.skills ?? [],
      acceptsStudentPass: row.acceptsStudentPass,
      sponsorsWorkPass: row.sponsorsWorkPass,
      headcount: row.headcount,
      deadline: row.deadline,
      publishedAt: row.publishedAt,
      description: row.description,
      requirements: row.requirements,
      company: {
        id: row.cId,
        legalName: row.legalName,
        displayNameZh: row.displayNameZh,
        displayNameEn: row.displayNameEn,
        industryCode: row.industryCode,
      },
    }
    const result = scoreCandidate(job, tokens, expandedTokens, canSeeDescription)
    if (!result) continue
    const hit: SearchHit = { job: toJobListItem(job), score: result.score, matchedBy: result.matchedBy }
    if (result.matchedBy === 'exact') exact.push(hit)
    else related.push(hit)
  }

  // Sort by score desc, then publishedAt desc
  const byScore = (a: SearchHit, b: SearchHit) =>
    b.score - a.score || (b.job.publishedAt?.getTime() ?? 0) - (a.job.publishedAt?.getTime() ?? 0)
  exact.sort(byScore)

  const showRelated = mode === 'RELATED' || exact.length < fallbackBelow
  if (showRelated) related.sort(byScore)

  // Salary sort overrides score sort
  if (sort === 'salary') {
    const salaryCmp = (a: SearchHit, b: SearchHit) => {
      const av = a.job.salaryMax !== null ? a.job.salaryMax : -Infinity
      const bv = b.job.salaryMax !== null ? b.job.salaryMax : -Infinity
      return bv - av
    }
    exact.sort(salaryCmp)
    if (showRelated) related.sort(salaryCmp)
  }

  // Cursor pagination on combined sorted array
  const all = showRelated ? [...exact, ...related] : exact
  const start = cursor ? all.findIndex((h) => h.job.id === cursor) + 1 : 0
  const pageExact: SearchHit[] = []
  const pageRelated: SearchHit[] = []
  let count = 0
  for (let i = start; i < all.length && count < limit; i++, count++) {
    if (all[i].matchedBy === 'exact') pageExact.push(all[i])
    else pageRelated.push(all[i])
  }

  const hasMore = start + count < all.length
  const lastItem = count > 0 ? all[start + count - 1] : null

  return {
    exact: pageExact,
    related: showRelated ? pageRelated : [],
    nextCursor: hasMore && lastItem ? lastItem.job.id : null,
  }
}
