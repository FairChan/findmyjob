import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { validateMutationInputs, reserveMutationRunDirectory, selectApplyPair, createMutationCoordinator } from '../../scripts/load/run-mutations.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('coordinator exact start/completion replays preserve evidence without overcounting', async () => {
  const coordinator = await createMutationCoordinator({ runId: 'test-replay' })
  const post = async body => fetch(`http://127.0.0.1:${coordinator.port}/test-replay`, { method: 'POST', body: JSON.stringify(body) })
  const start = { event: 'started', scenario: 'apply', slot: 0 }
  const complete = { event: 'completed', scenario: 'apply', slot: 0, outcome: 'applied', studentId: 's', jobId: 'j', companyId: 'c', uiDurationMs: 20 }
  try {
    assert.equal((await post(start)).status, 200)
    assert.equal((await post(start)).status, 200)
    assert.equal((await post(complete)).status, 200)
    const original = structuredClone(coordinator.outcomes.apply[0])
    assert.equal((await post({ uiDurationMs: 20, ...complete })).status, 200)
    assert.deepEqual(coordinator.outcomes.apply, [original])
    assert.deepEqual(coordinator.transportStats(), { startedReplays: 1, completedReplays: 1 })
  } finally { await coordinator.close() }
})

test('coordinator rejects unknown start payload and never permits clicked replays', async () => {
  const coordinator = await createMutationCoordinator({ runId: 'test-strict', releaseDelayMs: 5 })
  const post = async body => fetch(`http://127.0.0.1:${coordinator.port}/test-strict`, { method: 'POST', body: JSON.stringify(body) })
  try {
    assert.equal((await post({ event: 'started', scenario: 'apply', slot: 0, cookie: 'forbidden' })).status, 400)
    for (let slot = 0; slot < 2; slot++) await post({ event: 'started', scenario: 'duplicateApply', slot })
    const releases = await Promise.all([0, 1].map(slot => post({ event: 'ready', scenario: 'duplicateApply', slot })))
    const { releaseAt } = await releases[0].json()
    await new Promise(resolve => setTimeout(resolve, Math.max(0, releaseAt - Date.now()) + 5))
    const click = { event: 'clicked', scenario: 'duplicateApply', slot: 0 }
    assert.equal((await post(click)).status, 200)
    assert.equal((await post(click)).status, 400)
    assert.equal((await post({ event: 'ready', scenario: 'duplicateApply', slot: 0 })).status, 400)
    assert.deepEqual(coordinator.transportStats(), { startedReplays: 0, completedReplays: 0 })
  } finally { await coordinator.close() }
})

for (const patch of [{ outcome: 'unexpected' }, { studentId: 'other' }, { jobId: 'other' }, { companyId: 'other' }, { uiDurationMs: 21 }]) {
  test(`coordinator rejects conflicting completion replay ${JSON.stringify(patch)}`, async () => {
    const coordinator = await createMutationCoordinator({ runId: 'test-conflict' })
    const post = async body => fetch(`http://127.0.0.1:${coordinator.port}/test-conflict`, { method: 'POST', body: JSON.stringify(body) })
    try {
      await post({ event: 'started', scenario: 'apply', slot: 0 })
      const complete = { event: 'completed', scenario: 'apply', slot: 0, outcome: 'applied', studentId: 's', jobId: 'j', companyId: 'c', uiDurationMs: 20 }
      await post(complete)
      const original = structuredClone(coordinator.outcomes.apply)
      assert.equal((await post({ ...complete, ...patch })).status, 400)
      assert.deepEqual(coordinator.outcomes.apply, original)
      assert.throws(() => coordinator.assertComplete())
    } finally { await coordinator.close() }
  })
}
test('runner refuses implicit DB/output and nonisolated targets', async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'm7-t18-contract-'))
  const valid = {
    databaseUrl: 'postgresql://synthetic:synthetic@127.0.0.1:5999/m7_t18_synthetic_test',
    baseURL: 'http://127.0.0.1:3991', runId: 'synthetic-run',
    runDir: resolve(temporaryRoot, 'new-run'), repositoryRoot: root,
    disallowedDatabaseUrls: ['postgresql://owner:ignored@127.0.0.1:5999/parent_test'],
  }
  assert.doesNotThrow(() => validateMutationInputs(valid))
  for (const patch of [
    { databaseUrl: undefined }, { runDir: undefined }, { runId: undefined },
    { databaseUrl: 'postgresql://synthetic:synthetic@db.example.test/m7_t18_synthetic_test' },
    { databaseUrl: 'postgresql://synthetic:synthetic@127.0.0.1:5999/development' },
    { databaseUrl: 'postgresql://app:different@localhost:5999/parent_test' },
    { baseURL: 'https://external.example.test' },
    { runDir: resolve(root, 'load', 'new-run') },
    { runDir: resolve(temporaryRoot, 'accounts.local.json') },
  ]) assert.throws(() => validateMutationInputs({ ...valid, ...patch }))
})
test('exclusive output reservation refuses to reuse a directory', async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'm7-t18-exclusive-'))
  const target = resolve(temporaryRoot, 'new-run')
  await reserveMutationRunDirectory(target)
  await assert.rejects(reserveMutationRunDirectory(target), /exist|reuse/i)
  await assert.rejects(mkdir(target), { code: 'EEXIST' })
})
test('each application assignment is fresh; exhaustion never wraps', () => {
  const pairs = [
    { studentId: 'fresh-s1', jobId: 'job-a', companyId: 'company-a' },
    { studentId: 'fresh-s2', jobId: 'job-a', companyId: 'company-a' },
  ]
  assert.deepEqual(selectApplyPair(pairs, 0), pairs[0])
  assert.deepEqual(selectApplyPair(pairs, 1), pairs[1])
  assert.throws(() => selectApplyPair(pairs, 2), /exhaust|capacity|range/i)
  assert.throws(() => selectApplyPair([pairs[0], { ...pairs[0] }], 0), /duplicate/i)
  assert.throws(() => selectApplyPair([pairs[0], { ...pairs[0], jobId: 'different-job' }], 0), /duplicate|student/i)
})

test('barrier waits for every distinct client and returns one future release epoch', async () => {
  const coordinator = await createMutationCoordinator({ runId: 'test-barrier', timeoutMs: 1000, releaseDelayMs: 100 })
  const post = async data => {
    const response = await fetch(`http://127.0.0.1:${coordinator.port}/test-barrier`, { method: 'POST', body: JSON.stringify(data) })
    return { status: response.status, ...await response.json() }
  }
  try {
    for (let slot = 0; slot < 10; slot++) await post({ event: 'started', scenario: 'balanceRace', slot })
    const before = Date.now()
    const releases = await Promise.all(Array.from({ length: 10 }, (_, slot) => post({ event: 'ready', scenario: 'balanceRace', slot })))
    assert(releases.every(r => r.released && Number.isFinite(r.releaseAt) && r.releaseAt >= before + 100))
    assert.equal(new Set(releases.map(r => r.releaseAt)).size, 1)
    assert.equal((await post({ event: 'clicked', scenario: 'balanceRace', slot: 0 })).status, 400, 'Early confirmation must invalidate the burst')
    assert.throws(() => coordinator.assertComplete())
  } finally { await coordinator.close() }
})

test('an unready client fails the barrier without releasing any mutation', async () => {
  const coordinator = await createMutationCoordinator({ runId: 'test-unready', timeoutMs: 25 })
  try {
    const url = `http://127.0.0.1:${coordinator.port}/test-unready`
    await fetch(url, { method: 'POST', body: JSON.stringify({ event: 'started', scenario: 'balanceRace', slot: 0 }) })
    const response = await fetch(url, { method: 'POST', body: JSON.stringify({ event: 'ready', scenario: 'balanceRace', slot: 0 }) })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).released, false)
    assert.throws(() => coordinator.assertComplete())
  } finally { await coordinator.close() }
})
