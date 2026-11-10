import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Prisma, WeeklyDigestDelivery, WeeklyDigestKind } from '@prisma/client'
import { redact } from '@/lib/redact'
import { getMarketingConfiguration } from '../lib/marketing-config'
import { getMatchingConfiguration, type MatchingConfiguration } from '../lib/matching-config'
import { buildJobMatchingText, buildStudentMatchingText } from '../lib/matching-text'
import { toJobListItem } from '../serializers/job'
import { toTalentCard } from '../serializers/talent-card'
import { latestMarketingConsentTx, marketingLegalGrantsTx } from './marketing-consent'
import { isStudentVisibleToCompany } from './talent-visibility'
import { getSetting } from './settings'
import type { WeeklyJobRow, WeeklyTalentRow } from '../email/templates/weekly'

export type Cohort = { kind: WeeklyDigestKind; userId: string; companyId: string | null }
export type WeeklyContext = {
  cohort: Cohort; email: string; locale: string; sourceId: string; sourceHash: string
  marketingGrantId: string; matchingGrantId: string | null; gateEpoch: string; config: MatchingConfiguration
}
async function matchingGrant(tx: Prisma.TransactionClient, userId: string, version: string) {
  const grant = await tx.consent.findFirst({ where: { userId, type: 'AI_MATCHING' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  return grant?.granted && grant.version === version ? grant.id : null
}
export async function loadWeeklyContextTx(tx: Prisma.TransactionClient, cohort: Cohort, sourceId?: string): Promise<WeeklyContext | null> {
  const [user, gate, config, marketing] = await Promise.all([
    tx.user.findUnique({ where: { id: cohort.userId } }), getMarketingConfiguration(tx),
    getMatchingConfiguration(tx), latestMarketingConsentTx(tx, cohort.userId),
  ])
  if (!user || user.status !== 'ACTIVE' || !user.emailVerified || !gate || !config || gate.legalVersion !== config.legalVersion ||
    !marketing?.granted || marketing.version !== gate.legalVersion) return null
  const legal = await marketingLegalGrantsTx(tx, user.id, gate.legalVersion)
  if (!legal) return null
  let projection: { sourceHash: string } | null, revision: number, subjectId: string, memberId: string | null = null, matchingGrantId: string | null = null
  if (cohort.kind === 'STUDENT_JOBS') {
    if (cohort.companyId !== null || user.role !== 'STUDENT') return null
    const profile = await tx.studentProfile.findUnique({ where: { userId: user.id } })
    matchingGrantId = await matchingGrant(tx, user.id, config.legalVersion)
    if (!profile || !matchingGrantId || (sourceId && sourceId !== profile.id)) return null
    projection = buildStudentMatchingText(profile)
    revision = profile.editRevision; subjectId = profile.id
  } else {
    if (!cohort.companyId || user.role !== 'EMPLOYER') return null
    const member = await tx.companyMember.findUnique({
      where: { companyId_userId: { userId: user.id, companyId: cohort.companyId } }, include: { company: true },
    })
    if (!member || member.role !== 'OWNER' || !member.company.isActive || member.company.verificationStatus !== 'VERIFIED' ||
      await getSetting<unknown>('talentPool.searchEnabled', true, { tx, fresh: true }) !== true) return null
    const job = await tx.job.findFirst({
      where: { ...(sourceId ? { id: sourceId } : {}), companyId: cohort.companyId, status: 'PUBLISHED', OR: [{ deadline: null }, { deadline: { gt: new Date() } }] },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
    })
    if (!job) return null
    projection = buildJobMatchingText(job)
    revision = job.matchingRevision; subjectId = job.id; memberId = member.id
  }
  if (!projection) return null
  // Include grant identities and query configuration so revoke/regrant and
  // same-text revision changes cannot revive an in-flight recommendation.
  const sourceHash = createHash('sha256').update(JSON.stringify({ projection: projection.sourceHash, revision, legal, memberId, config })).digest('hex')
  return { cohort, email: user.email, locale: user.locale === 'en' ? 'en' : 'zh', sourceId: subjectId, sourceHash,
    marketingGrantId: marketing.id, matchingGrantId, gateEpoch: gate.epoch, config }
}
export function contextMatches(row: WeeklyDigestDelivery, context: WeeklyContext): boolean {
  return row.sourceId === context.sourceId && row.sourceHash === context.sourceHash &&
    row.marketingGrantId === context.marketingGrantId && row.matchingGrantId === context.matchingGrantId &&
    row.gateEpoch === context.gateEpoch && row.matchingEpoch === context.config.gateEpoch
}
export function contextMetadata(context: WeeklyContext) {
  return { sourceId: context.sourceId, sourceHash: context.sourceHash, marketingGrantId: context.marketingGrantId,
    matchingGrantId: context.matchingGrantId, gateEpoch: context.gateEpoch, matchingEpoch: context.config.gateEpoch }
}
function currentIndex(index: { state: string; sourceHash: string; sourceRevision: number; consentGrantId: string | null; configurationId: string; model: string; gateEpoch: string; legalVersion: string } | null,
  config: MatchingConfiguration, sourceHash: string, revision: number, grant: string | null): boolean {
  return !!index && index.state === 'READY' && index.sourceHash === sourceHash && index.sourceRevision === revision &&
    index.consentGrantId === grant && index.configurationId === config.configurationId && index.model === config.model &&
    index.gateEpoch === config.gateEpoch && index.legalVersion === config.legalVersion
}
export async function reloadWeeklyRowsTx(tx: Prisma.TransactionClient, context: WeeklyContext, ids: string[]): Promise<WeeklyJobRow[] | WeeklyTalentRow[]> {
  if (context.cohort.kind === 'STUDENT_JOBS') {
    const rows: WeeklyJobRow[] = []
    for (const id of ids) {
      const [job, index] = await Promise.all([
        tx.job.findUnique({ where: { id }, include: { company: true } }), tx.semanticIndex.findUnique({ where: { jobId: id } }),
      ])
      if (!job || job.status !== 'PUBLISHED' || !job.company.isActive || (job.deadline && job.deadline <= new Date())) continue
      if (!currentIndex(index, context.config, buildJobMatchingText(job).sourceHash, job.matchingRevision, null)) continue
      const card = toJobListItem(job)
      const displayName = context.locale === 'en' ? card.company.displayNameEn : card.company.displayNameZh
      rows.push({ id: card.id, title: redact(card.title), companyName: redact(displayName ?? card.company.displayNameEn ?? card.company.displayNameZh ?? card.company.legalName),
        type: card.type, workMode: card.workMode, state: card.state ? redact(card.state) : null, city: card.city ? redact(card.city) : null })
    }
    return rows
  }
  const rows: WeeklyTalentRow[] = []
  // Match T03's strict eligibility boundary; the shared visibility helper also
  // serves older callers and its numeric comparison does not validate JSON.
  const minimum = z.number().int().min(0).max(100).safeParse(
    await getSetting<unknown>('talentPool.minCompleteness', 60, { tx, fresh: true }),
  )
  if (!minimum.success) return rows
  for (const id of ids) {
    const [profile, index] = await Promise.all([
      tx.studentProfile.findUnique({ where: { id }, include: { school: true, user: { select: { role: true, status: true } } } }),
      tx.semanticIndex.findUnique({ where: { studentId: id } }),
    ])
    if (!profile || profile.user.role !== 'STUDENT' || profile.user.status !== 'ACTIVE' || profile.completeness < minimum.data ||
      !await isStudentVisibleToCompany(id, context.cohort.companyId!, tx)) continue
    const [grant, legal] = await Promise.all([
      matchingGrant(tx, profile.userId, context.config.legalVersion), marketingLegalGrantsTx(tx, profile.userId, context.config.legalVersion),
    ])
    const source = buildStudentMatchingText(profile)
    if (!grant || !legal || !source || !currentIndex(index, context.config, source.sourceHash, profile.editRevision, grant)) continue
    const card = toTalentCard(profile, { unlocked: false })
    rows.push({ id: card.id, headline: card.headline, major: card.major, degreeLevel: card.degreeLevel, skills: card.skills })
  }
  return rows
}
