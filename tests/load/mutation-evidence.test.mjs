import assert from 'node:assert/strict'
import test from 'node:test'
import { assertMutationEvidence, collectMutationSnapshot } from '../../scripts/load/verify-mutations.ts'
async function subject() { return { assertMutationEvidence } }

test('collector reads the full namespace in one read-only repeatable snapshot', async () => {
  const calls = []
  const tx = {
    $executeRaw: async strings => { calls.push(['readonly', strings[0]]) },
    $queryRaw: async query => { calls.push(['sql', query]); return [] },
  }
  for (const model of ['talentUnlock', 'application', 'applicationEvent', 'jobView']) {
    tx[model] = { findMany: async query => { calls.push([model, query]); return [] } }
  }
  const prisma = { $transaction: async (read, options) => { assert.equal(options.isolationLevel, 'RepeatableRead'); return read(tx) } }
  const manifest = evidence().manifest
  manifest.scope = { companyIds: ['whole-run-company'], studentIds: ['whole-run-student'], jobIds: ['whole-run-job'] }
  await collectMutationSnapshot(prisma, manifest)
  assert.deepEqual(calls[0], ['readonly', 'SET TRANSACTION READ ONLY'])
  const sqlQueries = calls.filter(([model]) => model === 'sql').map(([, query]) => query)
  assert.deepEqual(sqlQueries[0].values, ['whole-run-company'])
  assert(!sqlQueries[0].text.includes('whole-run-company'))
  assert(sqlQueries[1].text.includes('FALSE OR FALSE'))
  assert(calls.find(([model]) => model === 'talentUnlock')[1].where.OR.some(clause => clause.studentId?.in.includes('whole-run-student')))
  assert(calls.find(([model]) => model === 'jobView')[1].where.OR.some(clause => clause.jobId?.in.includes('whole-run-job')))
})

test('collector binds wallet IDs and reverse unlock references in ledger SQL', async () => {
  const queries = []
  const tx = {
    $executeRaw: async () => {},
    $queryRaw: async query => {
      queries.push(query)
      return queries.length === 1 ? [{ id: "wallet'quoted", companyId: 'balance-c', balance: 0 }] : []
    },
    talentUnlock: { findMany: async () => [{ id: "unlock'quoted" }] },
    application: { findMany: async () => [] },
    applicationEvent: { findMany: async () => [] },
    jobView: { findMany: async () => [] },
  }
  await collectMutationSnapshot({ $transaction: read => read(tx) }, evidence().manifest)
  assert.deepEqual(queries[1].values, ["wallet'quoted", "unlock'quoted"])
  assert(queries[1].text.includes('"walletId" IN'))
  assert(queries[1].text.includes('"refType" = \'TalentUnlock\''))
  assert(queries[1].text.includes('"refId" IN'))
  assert(!queries[1].text.includes("wallet'quoted"))
  assert(!queries[1].text.includes("unlock'quoted"))
})
function evidence() {
  const pair = { studentId: 'app-s', jobId: 'app-j', companyId: 'app-c' }
  const duplicatePair = { studentId: 'duplicate-s', jobId: 'app-j', companyId: 'app-c' }
  const terminal = (slot, outcome) => ({ slot, outcome, startedAt: 100, completedAt: 200 })
  return {
    manifest: {
      runId: 'synthetic-run',
      balanceRace: { companyId: 'balance-c', walletId: 'balance-w', initialBalance: 3, studentIds: Array.from({ length: 10 }, (_, i) => `balance-s${i}`) },
      idempotentUnlock: { companyId: 'idempotent-c', walletId: 'idempotent-w', initialBalance: 100, studentId: 'idempotent-s' },
      applyPairs: [pair], duplicateApplyPair: duplicatePair,
    },
    outcomes: {
      balanceRace: Array.from({ length: 10 }, (_, i) => terminal(i, i < 3 ? 'unlocked' : 'insufficient_credits')),
      idempotentUnlock: Array.from({ length: 10 }, (_, i) => terminal(i, 'unlocked')),
      apply: [{ ...terminal(0, 'applied'), ...pair }],
      duplicateApply: [terminal(0, 'applied'), terminal(1, 'applied')],
    },
    snapshot: {
      wallets: [{ id: 'balance-w', companyId: 'balance-c', balance: 0 }, { id: 'idempotent-w', companyId: 'idempotent-c', balance: 99 }],
      ledger: [
        { id: 'grant-b', walletId: 'balance-w', reason: 'PILOT_GRANT', delta: 3, refType: null, refId: null },
        { id: 'grant-i', walletId: 'idempotent-w', reason: 'PILOT_GRANT', delta: 100, refType: null, refId: null },
        ...Array.from({ length: 3 }, (_, i) => ({ id: `charge-b${i}`, walletId: 'balance-w', reason: 'UNLOCK', delta: -1, refType: 'TalentUnlock', refId: `unlock-b${i}` })),
        { id: 'charge-i', walletId: 'idempotent-w', reason: 'UNLOCK', delta: -1, refType: 'TalentUnlock', refId: 'unlock-i' },
      ],
      unlocks: [
        ...Array.from({ length: 3 }, (_, i) => ({ id: `unlock-b${i}`, companyId: 'balance-c', studentId: `balance-s${i}`, source: 'CREDIT', creditsSpent: 1 })),
        { id: 'unlock-i', companyId: 'idempotent-c', studentId: 'idempotent-s', source: 'CREDIT', creditsSpent: 1 },
        { id: 'unlock-app', companyId: 'app-c', studentId: 'app-s', source: 'APPLICATION', creditsSpent: 0 },
        { id: 'unlock-duplicate', companyId: 'app-c', studentId: 'duplicate-s', source: 'APPLICATION', creditsSpent: 0 },
      ],
      applications: [{ id: 'application', ...pair, status: 'APPLIED' }, { id: 'duplicate-application', ...duplicatePair, status: 'APPLIED' }],
      applicationEvents: [
        { id: 'event', applicationId: 'application', fromStatus: null, toStatus: 'APPLIED' },
        { id: 'duplicate-event', applicationId: 'duplicate-application', fromStatus: null, toStatus: 'APPLIED' },
      ],
      jobViews: [pair, duplicatePair],
    },
  }
}

test('accepts complete business outcomes with bijective charges and uncharged application grants', async () => {
  const { assertMutationEvidence } = await subject('scripts/load/verify-mutations.ts')
  assert.doesNotThrow(() => assertMutationEvidence(evidence()))
})

const corruptions = [
  ['zero attempts', e => { e.outcomes.balanceRace = [] }],
  ['an empty measured application set', e => { e.outcomes.apply = [] }],
  ['ten terminal outcomes with four successes instead of three', e => { e.outcomes.balanceRace[3].outcome = 'unlocked' }],
  ['an HTTP-200/login-like unexpected UI result', e => { e.outcomes.balanceRace[0].outcome = 'unexpected'; e.outcomes.balanceRace[0].httpStatus = 200 }],
  ['a started attempt without a terminal result', e => { e.outcomes.balanceRace[0].outcome = null; e.outcomes.balanceRace[0].completedAt = null }],
  ['duplicate burst slot hiding a missing client', e => { e.outcomes.balanceRace[9].slot = 0 }],
  ['equal charge counts but a wrong ledger reference', e => { e.snapshot.ledger[2].refId = 'absent-unlock' }],
  ['a charge assigned to the wrong wallet', e => { e.snapshot.ledger[2].walletId = 'idempotent-w' }],
  ['a second charge with no unlock', e => { e.snapshot.ledger.push({ ...e.snapshot.ledger[2], id: 'orphan-charge', refId: 'absent-unlock' }) }],
  ['APPLICATION grants masquerading as paid CREDIT unlocks', e => { e.snapshot.unlocks[4].source = 'CREDIT' }],
  ['a duplicate initial application event', e => { e.snapshot.applicationEvents.push({ ...e.snapshot.applicationEvents[0], id: 'extra-event' }) }],
  ['a missing real job-view prerequisite', e => { e.snapshot.jobViews = [] }],
  ['an application for an unscheduled pair', e => { e.snapshot.applications[0].studentId = 'unscheduled-student' }],
  ['a wallet inconsistent with its grant and ledger', e => { e.snapshot.wallets[0].balance = 1 }],
]
for (const [name, mutate] of corruptions) {
  test(`rejects ${name}`, async () => {
    const { assertMutationEvidence } = await subject('scripts/load/verify-mutations.ts')
    const input = evidence()
    mutate(input)
    assert.throws(() => assertMutationEvidence(input))
  })
}
