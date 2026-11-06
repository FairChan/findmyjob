import 'server-only'
import { z } from 'zod'
import { DegreeLevel, JobType, LanguageLevel, WorkAuth, Prisma } from '@prisma/client'
import { db } from '../db'
import { getSetting } from './settings'
import { assertTalentSearchEnabled } from './feature-flags'
import { logAudit } from './audit'
import { checkRateLimit } from '../lib/rate-limit'
import { ValidationError, RateLimitedError, ForbiddenError } from '../errors'
import { redact } from '@/lib/redact'
import { toTalentCard, employerFreeText } from '../serializers/talent-card'
import type { TalentCard } from '../serializers/talent-card'

// ---- Language level ordering ----

const LANGUAGE_LEVEL_ORDER: LanguageLevel[] = [
  LanguageLevel.BASIC,
  LanguageLevel.CONVERSATIONAL,
  LanguageLevel.FLUENT,
  LanguageLevel.NATIVE,
]

function getLevelsAtOrAbove(minLevel: LanguageLevel): LanguageLevel[] {
  const idx = LANGUAGE_LEVEL_ORDER.indexOf(minLevel)
  return LANGUAGE_LEVEL_ORDER.slice(idx)
}

// ---- Input schema ----

export const searchFiltersSchema = z.object({
  page: z.number().int().min(1).default(1),
  schoolId: z.string().cuid().optional(),
  majorKeyword: z.string().max(100).optional(),
  degreeLevel: z.nativeEnum(DegreeLevel).optional(),
  graduationYearFrom: z.number().int().optional(),
  graduationYearTo: z.number().int().optional(),
  intents: z.array(z.nativeEnum(JobType)).optional(),
  languages: z
    .array(
      z.object({
        language: z.string().max(10),
        minLevel: z.nativeEnum(LanguageLevel),
      }),
    )
    .optional(),
  workAuths: z.array(z.nativeEnum(WorkAuth)).optional(),
  skills: z.array(z.string().max(50)).optional(),
  skillsMatchAll: z.boolean().default(false),
  preferredStates: z.array(z.string().max(10)).optional(),
  availableBefore: z.coerce.date().optional(),
  lastActiveSince: z.coerce.date().optional(),
  keyword: z.string().max(100).optional(),
  sort: z.enum(['lastActive', 'completeness', 'graduationYear']).default('lastActive'),
})

export type SearchFilters = z.infer<typeof searchFiltersSchema>
export type SearchFiltersInput = z.input<typeof searchFiltersSchema>

// ---- Output types ----

export interface TalentSearchResult {
  students: TalentCard[]
  total: number
  page: number
  pageSize: number
  maxPage: number
}

export const PAGE_SIZE = 20

// ---- Main search function ----

export async function searchTalents(
  ctx: { userId: string; companyId: string },
  raw: SearchFiltersInput,
): Promise<TalentSearchResult> {
  const input = searchFiltersSchema.parse(raw)
  await assertTalentSearchEnabled()

  // §5.1: talent operations require verified company
  const company = await db.company.findUnique({
    where: { id: ctx.companyId },
    select: { isActive: true, verificationStatus: true },
  })
  if (!company || !company.isActive || company.verificationStatus !== 'VERIFIED') {
    throw new ForbiddenError()
  }

  const [maxPage, searchPagesPerDay, minCompleteness] = await Promise.all([
    getSetting<number>('talentSearch.maxPage', 25),
    getSetting<number>('limits.searchPagesPerDay', 300),
    getSetting<number>('talentPool.minCompleteness', 60),
  ])

  if (input.page > maxPage) {
    throw new ValidationError(`Page ${input.page} exceeds maximum allowed page ${maxPage}`)
  }

  const rateResult = await checkRateLimit(`talent-search-pages:${ctx.userId}`, {
    windowMs: 24 * 60 * 60 * 1000,
    limit: searchPagesPerDay,
  })
  if (!rateResult.allowed) {
    await logAudit({
      actorId: ctx.userId,
      action: 'talent.limit.hit',
      targetType: 'TalentSearch',
      metadata: { kind: 'searchPages', companyId: ctx.companyId },
    })
    throw new RateLimitedError('Daily search page limit reached')
  }

  // TM-002: redact the keyword; if the keyword itself contains PII, return empty
  const rawKeyword = input.keyword?.trim()
  let effectiveKeyword: string | undefined
  if (rawKeyword) {
    const sanitized = redact(rawKeyword)
    if (sanitized !== rawKeyword) {
      return { students: [], total: 0, page: input.page, pageSize: PAGE_SIZE, maxPage }
    }
    effectiveKeyword = rawKeyword.toLowerCase()
  }

  // ---- Build WHERE clause ----

  const where: Prisma.StudentProfileWhereInput = {
    visibility: 'PUBLIC',
    schoolVerifiedAt: { not: null },
    completeness: { gte: minCompleteness },
    user: { status: 'ACTIVE' },
    blockedCompanies: { none: { companyId: ctx.companyId } },
  }

  if (input.schoolId) where.schoolId = input.schoolId
  if (input.degreeLevel) where.degreeLevel = input.degreeLevel

  if (input.graduationYearFrom !== undefined || input.graduationYearTo !== undefined) {
    const range: Prisma.IntNullableFilter = {}
    if (input.graduationYearFrom !== undefined) range.gte = input.graduationYearFrom
    if (input.graduationYearTo !== undefined) range.lte = input.graduationYearTo
    where.graduationYear = range
  }

  if (input.intents?.length) {
    where.intents = { hasSome: input.intents }
  }

  if (input.workAuths?.length) {
    where.workAuth = { in: input.workAuths }
  }

  if (input.skills?.length) {
    where.skills = input.skillsMatchAll
      ? { hasEvery: input.skills }
      : { hasSome: input.skills }
  }

  if (input.preferredStates?.length) {
    where.preferredStates = { hasSome: input.preferredStates }
  }

  if (input.availableBefore) {
    where.availableFrom = { lte: input.availableBefore }
  }

  if (input.lastActiveSince) {
    where.lastActiveAt = { gte: input.lastActiveSince }
  }

  if (input.majorKeyword) {
    where.major = { contains: input.majorKeyword, mode: 'insensitive' }
  }

  if (input.languages?.length) {
    where.languages = {
      some: {
        OR: input.languages.map((lang) => ({
          language: lang.language,
          level: { in: getLevelsAtOrAbove(lang.minLevel) },
        })),
      },
    }
  }

  // ---- Build ORDER BY ----

  const orderBy: Prisma.StudentProfileOrderByWithRelationInput[] =
    input.sort === 'completeness'
      ? [{ completeness: 'desc' }, { lastActiveAt: 'desc' }]
      : input.sort === 'graduationYear'
        ? [{ graduationYear: 'desc' }, { lastActiveAt: 'desc' }]
        : [{ lastActiveAt: 'desc' }]

  if (!effectiveKeyword) {
    // No keyword: use DB-level pagination (fast path)
    const [total, rows] = await Promise.all([
      db.studentProfile.count({ where }),
      db.studentProfile.findMany({
        where,
        orderBy,
        skip: (input.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          school: { select: { id: true, nameZh: true, nameEn: true } },
          unlocks: {
            where: { companyId: ctx.companyId },
            take: 1,
            select: { companyId: true },
          },
        },
      }),
    ])

    const students = rows.map((s) =>
      toTalentCard(
        { ...s, cgpa: s.cgpa, lastActiveAt: s.lastActiveAt },
        { unlocked: s.unlocks.length > 0 },
      ),
    )
    return { students, total, page: input.page, pageSize: PAGE_SIZE, maxPage }
  }

  // With keyword: fetch all candidates, apply redact in app to enforce TM-002
  const rows = await db.studentProfile.findMany({
    where,
    orderBy,
    include: {
      school: { select: { id: true, nameZh: true, nameEn: true } },
      unlocks: {
        where: { companyId: ctx.companyId },
        take: 1,
        select: { companyId: true },
      },
      experiences: { select: { title: true } },
    },
  })

  const kw = effectiveKeyword
  const matched = rows.filter((s) => {
    const searchText = [
      employerFreeText(s.major ?? '', s.fullName, false),
      employerFreeText(s.headline ?? '', s.fullName, false),
      ...s.skills.map((sk) => employerFreeText(sk, s.fullName, false)),
      ...s.experiences.map((e) => employerFreeText(e.title, s.fullName, false)),
    ]
      .join(' ')
      .toLowerCase()
    return searchText.includes(kw)
  })

  const total = matched.length
  const paginated = matched.slice((input.page - 1) * PAGE_SIZE, input.page * PAGE_SIZE)
  const students = paginated.map((s) =>
    toTalentCard(
      { ...s, cgpa: s.cgpa, lastActiveAt: s.lastActiveAt },
      { unlocked: s.unlocks.length > 0 },
    ),
  )
  return { students, total, page: input.page, pageSize: PAGE_SIZE, maxPage }
}
