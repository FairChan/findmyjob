import 'server-only'
import { db } from '../db'
import { getSetting } from './settings'
import { DEFAULT_PUBLIC_SHOWCASE, parsePublicShowcase, PUBLIC_SHOWCASE_KEY } from '@/schemas/public-showcase'
import type { UserCtx } from '../authz'
import { ForbiddenError } from '../errors'

const companyEligibility = { isActive: true, verificationStatus: 'VERIFIED' } as const
const companySelect = {
  id: true, legalName: true, displayNameZh: true, displayNameEn: true,
  logoKey: true, industryCode: true, state: true, city: true,
} as const

function orderSelected<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  if (!ids.length) return rows
  const byId = new Map(rows.map(row => [row.id, row]))
  return ids.flatMap(id => { const row = byId.get(id); return row ? [row] : [] })
}

export async function getPublicShowcaseConfig() {
  return parsePublicShowcase(await getSetting<unknown>(PUBLIC_SHOWCASE_KEY, DEFAULT_PUBLIC_SHOWCASE, { fresh: true }))
}

export async function getPublicJobShowcase() {
  const config = await getPublicShowcaseConfig()
  const ids = config.jobIds
  const items = await db.job.findMany({
    where: {
      status: 'PUBLISHED', company: companyEligibility,
      OR: [{ deadline: null }, { deadline: { gt: new Date() } }],
      ...(ids.length ? { id: { in: ids } } : {}),
    },
    select: {
      id: true, title: true, type: true, workMode: true, city: true, state: true,
      company: { select: companySelect },
    },
    take: ids.length || 6,
    orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
  })
  return { copy: config.jobs, items: orderSelected(items, ids) }
}

export async function getPublicCompanyShowcase() {
  const config = await getPublicShowcaseConfig()
  const ids = config.companyIds
  const items = await db.company.findMany({
    where: { ...companyEligibility, ...(ids.length ? { id: { in: ids } } : {}) },
    select: companySelect,
    take: ids.length || 6,
    orderBy: { id: 'asc' },
  })
  return { copy: config.companies, items: orderSelected(items, ids) }
}

/** Admin-only option data; no application bodies or private contacts. */
export async function getPublicShowcaseOptions(ctx: UserCtx) {
  const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { role: true, status: true } })
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') throw new ForbiddenError()
  const [jobs, companies] = await Promise.all([
    db.job.findMany({
      where: { status: 'PUBLISHED', company: companyEligibility, OR: [{ deadline: null }, { deadline: { gt: new Date() } }] },
      select: { id: true, title: true, company: { select: { legalName: true } } },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    }),
    db.company.findMany({ where: companyEligibility, select: { id: true, legalName: true }, orderBy: [{ legalName: 'asc' }, { id: 'asc' }] }),
  ])
  return {
    jobs: jobs.map(job => ({ id: job.id, label: `${job.title} · ${job.company.legalName}` })),
    companies: companies.map(company => ({ id: company.id, label: company.legalName })),
  }
}
