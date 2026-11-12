import assert from 'node:assert/strict'
import { Prisma, type PrismaClient } from '@prisma/client'

type Pair = { jobId: string; studentId: string; companyId: string }
type Terminal = { slot: number; outcome: string; startedAt: number; completedAt: number }
type Race = { companyId: string; walletId: string; initialBalance: number }
export type MutationManifest = {
  balanceRace: Race & { studentIds: string[] }
  idempotentUnlock: Race & { studentId: string }
  applyPairs: Pair[]
  duplicateApplyPair: Pair
  scope?: { companyIds: string[]; studentIds: string[]; jobIds: string[] }
}
type Wallet = { id: string; companyId: string; balance: number }
type Ledger = { id: string; walletId: string; reason: string; delta: number; refType: string | null; refId: string | null }
type Unlock = { id: string; companyId: string; studentId: string; source: string; creditsSpent: number }
export type MutationSnapshot = {
  wallets: Wallet[]; ledger: Ledger[]; unlocks: Unlock[]
  applications: (Pair & { id: string; status: string })[]
  applicationEvents: { id: string; applicationId: string; fromStatus: string | null; toStatus: string }[]
  jobViews: { jobId: string; studentId: string }[]
}
type MutationEvidence = {
  manifest: MutationManifest
  outcomes: { balanceRace: Terminal[]; idempotentUnlock: Terminal[]; apply: (Terminal & Pair)[]; duplicateApply: Terminal[] }
  snapshot: MutationSnapshot
}
const pairKey = (r: { jobId: string; studentId: string }) => JSON.stringify([r.jobId, r.studentId])
const unlockKey = (r: { companyId: string; studentId: string }) => JSON.stringify([r.companyId, r.studentId])
function unique<T>(rows: T[], key: (r: T) => unknown, label: string) {
  assert.equal(new Set(rows.map(key)).size, rows.length, `Duplicate ${label}`)
}
function terminals(rows: Terminal[], count: number, allowed: string[]) {
  assert.equal(rows.length, count, 'Missing attempts')
  unique(rows, r => r.slot, 'slot')
  for (const r of rows) {
    assert(Number.isInteger(r.slot) && r.slot >= 0 && r.slot < count, 'Invalid slot')
    assert(allowed.includes(r.outcome), 'Unexpected UI outcome')
    assert(Number.isFinite(r.startedAt) && Number.isFinite(r.completedAt) && r.completedAt >= r.startedAt && r.completedAt - r.startedAt <= 120000, 'Incomplete or unbounded attempt')
  }
}

export function assertMutationEvidence({ manifest: m, outcomes: o, snapshot: s }: MutationEvidence): void {
  assert.equal(m.balanceRace.initialBalance, 3)
  assert.equal(m.idempotentUnlock.initialBalance, 100)
  assert.equal(m.balanceRace.studentIds.length, 10)
  assert.equal(new Set(m.balanceRace.studentIds).size, 10)
  assert.notEqual(m.balanceRace.companyId, m.idempotentUnlock.companyId)
  terminals(o.balanceRace, 10, ['unlocked', 'insufficient_credits'])
  terminals(o.idempotentUnlock, 10, ['unlocked'])
  terminals(o.duplicateApply, 2, ['applied'])
  assert.equal(o.balanceRace.filter((r) => r.outcome === 'unlocked').length, 3)
  assert(o.apply.length > 0, 'Empty measured application set')
  terminals(o.apply, o.apply.length, ['applied'])
  unique(m.applyPairs, pairKey, 'scheduled pair')
  unique(m.applyPairs, r => r.studentId, 'scheduled student')
  unique(o.apply, pairKey, 'measured pair')
  const schedule = new Map(m.applyPairs.map(p => [pairKey(p), p]))
  for (const p of o.apply) assert.equal(p.companyId, schedule.get(pairKey(p))?.companyId, 'Unscheduled application')
  assert(!schedule.has(pairKey(m.duplicateApplyPair)), 'Duplicate control overlaps schedule')
  const expectedPairs = [...o.apply, m.duplicateApplyPair]
  for (const p of expectedPairs) assert(![m.balanceRace.companyId, m.idempotentUnlock.companyId].includes(p.companyId), 'Application overlaps race company')
  unique(s.wallets, r => r.id, 'wallet')
  unique(s.wallets, r => r.companyId, 'company wallet')
  unique(s.ledger, r => r.id, 'ledger')
  unique(s.unlocks, r => r.id, 'unlock id')
  unique(s.unlocks, unlockKey, 'unlock pair')
  unique(s.applications, pairKey, 'application pair')
  unique(s.applications, r => r.id, 'application id')
  unique(s.applicationEvents, r => r.id, 'event')
  unique(s.jobViews, pairKey, 'job view')
  for (const race of [m.balanceRace, m.idempotentUnlock]) {
    const wallet = s.wallets.find((w) => w.id === race.walletId)
    assert(wallet, 'Missing race wallet')
    assert.equal(wallet?.companyId, race.companyId, 'Missing race wallet')
    const ledger = s.ledger.filter((l) => l.walletId === wallet.id)
    const grants = ledger.filter((l) => l.reason !== 'UNLOCK')
    assert.equal(grants.length, 1, 'Unexpected grant history')
    assert.equal(grants[0].reason, 'PILOT_GRANT')
    assert.equal(grants[0].delta, race.initialBalance)
    assert.equal(wallet.balance, race.initialBalance === 3 ? 0 : 99)
  }
  for (const w of s.wallets) {
    assert(Number.isInteger(w.balance) && w.balance >= 0, 'Negative or invalid balance')
    assert.equal(w.balance, s.ledger.filter((l) => l.walletId === w.id).reduce((sum: number, l) => { assert(Number.isInteger(l.delta)); return sum + l.delta }, 0), 'Incoherent wallet')
  }
  const expectedUnlocks = [
    ...o.balanceRace.filter((r) => r.outcome === 'unlocked').map((r) => ({ companyId: m.balanceRace.companyId, studentId: m.balanceRace.studentIds[r.slot], source: 'CREDIT', creditsSpent: 1 })),
    { companyId: m.idempotentUnlock.companyId, studentId: m.idempotentUnlock.studentId, source: 'CREDIT', creditsSpent: 1 },
    ...expectedPairs.map((p) => ({ companyId: p.companyId, studentId: p.studentId, source: 'APPLICATION', creditsSpent: 0 })),
  ]
  // Several jobs may grant the same free company/student unlock.
  const expectedMap = new Map(expectedUnlocks.map(p => [unlockKey(p), p]))
  assert.equal(s.unlocks.length, expectedMap.size, 'Unexpected unlock count')
  for (const u of s.unlocks) {
    const expected = expectedMap.get(unlockKey(u))
    assert(expected, 'Unexpected unlock pair')
    assert.equal(u.source, expected.source)
    assert.equal(u.creditsSpent, expected.creditsSpent)
    const charges = s.ledger.filter((l) => l.reason === 'UNLOCK' && l.refId === u.id)
    assert.equal(charges.length, u.source === 'CREDIT' ? 1 : 0, 'Unlock charge bijection')
    for (const charge of charges) {
      assert.equal(charge.refType, 'TalentUnlock')
      assert.equal(charge.delta, -u.creditsSpent)
      assert.equal(s.wallets.find((w) => w.id === charge.walletId)?.companyId, u.companyId)
    }
  }
  for (const l of s.ledger) {
    assert(s.wallets.some((w) => w.id === l.walletId), 'Unknown wallet')
    if (l.reason === 'UNLOCK') assert(s.unlocks.some((u) => u.id === l.refId && u.source === 'CREDIT'), 'Orphan charge')
  }
  assert.equal(s.applications.length, expectedPairs.length, 'Unexpected application count')
  assert.equal(s.applicationEvents.length, expectedPairs.length, 'Unexpected event count')
  assert.equal(s.jobViews.length, expectedPairs.length, 'Unexpected job view count')
  for (const p of expectedPairs) {
    const app = s.applications.find((a) => pairKey(a) === pairKey(p))
    assert(app, 'Missing application')
    assert.equal(app.companyId, p.companyId)
    assert.equal(app.status, 'APPLIED')
    const events = s.applicationEvents.filter((e) => e.applicationId === app.id)
    assert.equal(events.length, 1)
    assert.equal(events[0].fromStatus, null)
    assert.equal(events[0].toStatus, 'APPLIED')
    assert(s.jobViews.some((v) => pairKey(v) === pairKey(p)), 'Missing real job view')
  }
}

/** Prisma findMany binds every scope value; no SQL identifiers or IDs are interpolated. */
export async function collectMutationSnapshot(prisma: PrismaClient, m: MutationManifest): Promise<MutationSnapshot> {
  const pairs = [...m.applyPairs, m.duplicateApplyPair]
  const companies = m.scope?.companyIds ?? [...new Set([m.balanceRace.companyId, m.idempotentUnlock.companyId, ...pairs.map(p => p.companyId)])]
  const students = m.scope?.studentIds ?? [...new Set([...m.balanceRace.studentIds, m.idempotentUnlock.studentId, ...pairs.map(p => p.studentId)])]
  const jobs = m.scope?.jobIds ?? [...new Set(pairs.map(p => p.jobId))]
  for (const ids of [companies, students, jobs]) assert(Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string' && id.length > 0), 'Missing manifest scope')
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    const wallets = await tx.$queryRaw<Wallet[]>(Prisma.sql`SELECT "id", "companyId", "balance" FROM "CreditWallet" WHERE "companyId" IN (${Prisma.join(companies)})`)
    const unlocks = await tx.talentUnlock.findMany({ where: { OR: [{ companyId: { in: companies } }, { studentId: { in: students } }] } })
    const walletScope = wallets.length ? Prisma.sql`"walletId" IN (${Prisma.join(wallets.map(w => w.id))})` : Prisma.sql`FALSE`
    const unlockScope = unlocks.length ? Prisma.sql`("refType" = 'TalentUnlock' AND "refId" IN (${Prisma.join(unlocks.map(u => u.id))}))` : Prisma.sql`FALSE`
    const ledger = await tx.$queryRaw<Ledger[]>(Prisma.sql`SELECT "id", "walletId", "reason", "delta", "refType", "refId" FROM "CreditLedger" WHERE ${walletScope} OR ${unlockScope}`)
    const applications = await tx.application.findMany({ where: { OR: [{ job: { companyId: { in: companies } } }, { jobId: { in: jobs } }, { studentId: { in: students } }] }, include: { job: { select: { companyId: true } } } })
    const applicationEvents = await tx.applicationEvent.findMany({ where: { applicationId: { in: applications.map((a) => a.id) } } })
    const jobViews = await tx.jobView.findMany({ where: { OR: [{ jobId: { in: jobs } }, { studentId: { in: students } }, { job: { companyId: { in: companies } } }] } })
    return { wallets, unlocks, ledger, applications: applications.map((a) => ({ ...a, companyId: a.job.companyId, job: undefined })), applicationEvents, jobViews }
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 })
}
