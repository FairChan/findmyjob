import assert from 'node:assert/strict'
import { existsSync, realpathSync, createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { spawn } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { parseEnv } from 'node:util'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createRequire } from 'node:module'

const loopback = host => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)
const within = (child, parent) => { const r = relative(parent, child); return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r) }
function databaseIdentity(value) {
  const url = new URL(value)
  return `${loopback(url.hostname) ? 'loopback' : url.hostname}:${url.port || '5432'}${url.pathname}`
}
function validateRunPath(runDir, repositoryRoot) {
  assert(typeof runDir === 'string' && isAbsolute(runDir), 'Explicit absolute run directory required')
  const target = resolve(runDir)
  assert(!target.endsWith('.local.json') && within(target, realpathSync(tmpdir())), 'Run output must be a fresh OS-temp directory')
  assert(!within(target, resolve(repositoryRoot, 'load')) && target !== resolve(repositoryRoot, 'load'), 'Repository load output is forbidden')
  // Resolve the nearest existing ancestor so a junction cannot escape the temp tree.
  let ancestor = target
  while (!existsSync(ancestor)) ancestor = dirname(ancestor)
  const actual = realpathSync(ancestor)
  assert(actual === realpathSync(tmpdir()) || within(actual, realpathSync(tmpdir())), 'Run directory escapes OS-temp through a link')
}
export function validateMutationInputs(input) {
  const { databaseUrl, baseURL, runId, runDir, repositoryRoot, disallowedDatabaseUrls, allowReservedRunDirectory = false } = input
  assert(typeof databaseUrl === 'string' && databaseUrl, 'Explicit isolated database URL required')
  const db = new URL(databaseUrl)
  assert(['postgres:', 'postgresql:'].includes(db.protocol) && loopback(db.hostname) && /^\/[a-z0-9_]+_test$/.test(db.pathname), 'Only a loopback _test database is permitted')
  assert(Array.isArray(disallowedDatabaseUrls) && disallowedDatabaseUrls.length > 0, 'Explicit parent database exclusions required')
  assert(!disallowedDatabaseUrls.some(value => databaseIdentity(value) === databaseIdentity(databaseUrl)), 'Parent database is forbidden')
  const app = new URL(baseURL)
  assert(['http:', 'https:'].includes(app.protocol) && loopback(app.hostname) && !app.username && !app.password && app.pathname === '/' && !app.search && !app.hash, 'Explicit loopback app origin required')
  assert(typeof runId === 'string' && /^[a-z0-9][a-z0-9-]{3,63}$/.test(runId), 'Explicit fresh run ID required')
  assert(typeof repositoryRoot === 'string' && isAbsolute(repositoryRoot), 'Repository root required')
  validateRunPath(runDir, repositoryRoot)
  assert(allowReservedRunDirectory || !existsSync(runDir), 'Run directory already exists; refusing reuse')
}
export async function reserveMutationRunDirectory(runDir) {
  validateRunPath(runDir, resolve(import.meta.dirname, '../..'))
  await mkdir(runDir, { mode: 0o700 }) // No recursive creation; EEXIST is a hard failure.
}
export function selectApplyPair(pairs, iterationInTest) {
  assert(Array.isArray(pairs) && new Set(pairs.map(p => p.studentId)).size === pairs.length, 'Duplicate student assignment')
  assert(new Set(pairs.map(p => JSON.stringify([p.studentId, p.jobId]))).size === pairs.length, 'Duplicate pair assignment')
  assert(Number.isInteger(iterationInTest) && iterationInTest >= 0 && iterationInTest < pairs.length, 'Application schedule exhausted or index out of range')
  return pairs[iterationInTest]
}

/** Runner-only readiness coordination. No cookies, business inputs or mutation endpoints. */
export async function createMutationCoordinator({ runId, timeoutMs = 45000, releaseDelayMs = 2000, dispatchWindowMs = 2000 }) {
  const counts = { balanceRace: 10, idempotentUnlock: 10, duplicateApply: 2 }
  const groups = new Map()
  const outcomes = { balanceRace: [], idempotentUnlock: [], apply: [], duplicateApply: [] }
  const started = new Map()
  const eventBodies = { started: new Map(), completed: new Map() }
  const replayCounts = { startedReplays: 0, completedReplays: 0 }
  const errors = []
  const timers = new Set()
  const respond = (res, code, value) => { if (!res.destroyed) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) } }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET' && url.pathname === `/${runId}/probe`) { respond(res, 200, { runId }); return }
      assert(req.method === 'POST' && url.pathname === `/${runId}`, 'Unknown coordinator endpoint')
      let body = ''
      for await (const chunk of req) { body += chunk; assert(Buffer.byteLength(body) < 4096, 'Oversized coordinator message') }
      const { event, scenario, slot, ...data } = JSON.parse(body)
      assert(Object.hasOwn(outcomes, scenario) && Number.isInteger(slot) && slot >= 0, 'Invalid scenario/slot')
      const key = `${scenario}:${slot}`
      if (event === 'started' || event === 'completed') {
        const allowed = event === 'started' ? [] : ['outcome', 'studentId', 'jobId', 'companyId', 'uiDurationMs']
        assert(Object.keys(data).every(field => allowed.includes(field)), 'Unknown coordinator evidence field')
        const previous = eventBodies[event].get(key)
        if (previous) {
          assert.deepEqual(data, previous, 'Conflicting coordinator evidence replay')
          replayCounts[`${event}Replays`]++
          respond(res, 200, { accepted: true }); return
        }
      }
      if (event === 'started') {
        assert(!started.has(key), 'Duplicate started slot'); started.set(key, { scenario, slot, startedAt: Date.now() })
        eventBodies.started.set(key, data)
      } else if (event === 'ready') {
        assert(counts[scenario] && slot < counts[scenario] && started.has(key), 'Invalid ready slot')
        if (!groups.has(scenario)) {
          const group = { clients: new Map(), clicks: new Map(), failed: false, released: false }
          group.timer = setTimeout(() => {
            group.failed = true; errors.push(`${scenario}: readiness timeout`)
            for (const reply of group.clients.values()) respond(reply, 409, { released: false })
          }, timeoutMs)
          timers.add(group.timer); groups.set(scenario, group)
        }
        const group = groups.get(scenario)
        assert(!group.failed && !group.released && !group.clients.has(slot), 'Barrier failed or duplicate readiness')
        group.clients.set(slot, res)
        if (group.clients.size === counts[scenario]) {
          clearTimeout(group.timer); group.released = true; group.releaseAt = Date.now() + releaseDelayMs
          for (const reply of group.clients.values()) respond(reply, 200, { released: true, releaseAt: group.releaseAt })
        }
        return
      } else if (event === 'clicked') {
        const group = groups.get(scenario)
        const now = Date.now()
        assert(group?.released && group.clients.has(slot) && !group.clicks.has(slot), 'Invalid confirmation slot')
        assert(now >= group.releaseAt && now <= group.releaseAt + dispatchWindowMs, 'Confirmation missed the shared release window')
        group.clicks.set(slot, now)
      } else if (event === 'completed') {
        assert(started.has(key) && !outcomes[scenario].some(r => r.slot === slot), 'Missing start or duplicate completion')
        assert(['unlocked', 'insufficient_credits', 'applied', 'unexpected'].includes(data.outcome), 'Invalid terminal outcome')
        const terminal = { ...started.get(key), completedAt: Date.now(), outcome: data.outcome }
        for (const field of ['studentId', 'jobId', 'companyId', 'uiDurationMs']) if (data[field] !== undefined) terminal[field] = data[field]
        outcomes[scenario].push(terminal)
        eventBodies.completed.set(key, data)
      } else throw new Error('Unknown coordinator event')
      respond(res, 200, { accepted: true })
    } catch (error) { errors.push(error.message); respond(res, 400, { accepted: false }) }
  })
  server.keepAliveTimeout = 300000
  server.headersTimeout = 310000
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes) })
  return {
    port: server.address().port, outcomes,
    transportStats() { return { ...replayCounts } },
    assertComplete() {
      assert.deepEqual(errors, [], 'Coordinator failure')
      assert.equal(Object.values(outcomes).reduce((n, rows) => n + rows.length, 0), started.size, 'Started attempt has no terminal outcome')
      for (const [name, count] of Object.entries(counts)) assert(groups.get(name)?.released && groups.get(name).clicks.size === count && outcomes[name].length === count, `Incomplete ${name}`)
    },
    burstTimings() { return Object.fromEntries([...groups].map(([name, group]) => [name, { ready: group.clients.size, releaseAt: group.releaseAt, clickedAt: Object.fromEntries(group.clicks) }])) },
    async close() {
      for (const timer of timers) clearTimeout(timer)
      server.closeAllConnections()
      await new Promise(yes => server.close(yes))
    },
  }
}

const image = 'grafana/k6:0.54.0-with-browser@sha256:5c86c85ca978549352bdec7b8192adf0db2cdf6e942d1d19c87e077f90dd0c48'
async function capture(command, args, root) {
  return new Promise((yes, no) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.once('error', no)
    child.once('close', code => code === 0 ? yes(output.trim()) : no(new Error(`${command} metadata capture failed`)))
  })
}
async function sourceIdentity(root) {
  const paths = (await capture('git', ['ls-files', '-z', '--', 'src', 'messages', 'public', 'assets', 'next.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'prisma/schema.prisma'], root)).split('\0').filter(Boolean).sort()
  const digest = createHash('sha256')
  for (const path of paths) { digest.update(path); digest.update(await readFile(resolve(root, path))) }
  return { revision: await capture('git', ['rev-parse', 'HEAD'], root), sourceSha256: digest.digest('hex'),
    lockfileSha256: createHash('sha256').update(await readFile(resolve(root, 'pnpm-lock.yaml'))).digest('hex'),
    next: JSON.parse(await readFile(resolve(root, 'node_modules/next/package.json'), 'utf8')).version }
}
async function loadToolIdentity(root) {
  const digest = createHash('sha256')
  // Explicit paths include new, as-yet-untracked implementation files.
  for (const file of ['scripts/load/run-mutations.mjs', 'scripts/load/fixtures.ts', 'scripts/load/session-cookie.ts',
    'scripts/load/verify-mutations.ts', 'scripts/load/isolated-process.cjs', 'prisma/seed-load.ts',
    'load/k6/apply.js', 'load/k6/unlock.js', 'load/k6/lib/mutation-browser.js', 'load/k6/lib/session-preflight.mjs', 'load/k6/transport-probe.js']) {
    digest.update(file); digest.update(await readFile(resolve(root, file)))
  }
  return digest.digest('hex')
}
function ownedProcess(command, args, { env, root, log }) {
  const output = createWriteStream(log, { flags: 'wx', mode: 0o600 })
  const child = spawn(command, args, { env, cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  // These logs contain synthetic diagnostics only and remain in the private run directory.
  child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false })
  let settled = false
  const done = new Promise(resolveDone => {
    child.once('error', () => { settled = true; output.end(); resolveDone(1) })
    child.once('close', code => { settled = true; output.end(); resolveDone(code ?? 1) })
  })
  return { child, done, async stop() { if (!settled) child.kill(); await done } }
}
async function checkedProcess(command, args, options) {
  const process = ownedProcess(command, args, options)
  const code = await process.done
  assert.equal(code, 0, `${command} failed (exit ${code}); inspect private run log`)
}
async function smtpSink(runId) {
  let messages = 0
  let rejectedRecipients = 0
  const namespace = createHash('sha256').update(runId).digest('hex')
  const recipient = new RegExp(`^RCPT TO:<(?:owner|student)-[0-9]+-${namespace}@example\\.test>$`, 'i')
  const sockets = new Set()
  const server = createTcpServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket))
    socket.setEncoding('utf8'); socket.write('220 synthetic.local ESMTP\r\n')
    let pending = ''; let data = false
    socket.on('data', chunk => {
      pending += chunk
      let newline
      while ((newline = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 2)
        if (data) { if (line === '.') { data = false; messages++; socket.write('250 accepted locally\r\n') } }
        else if (/^EHLO|^HELO/.test(line)) socket.write('250 synthetic.local\r\n')
        else if (/^RCPT TO:/i.test(line)) {
          if (recipient.test(line)) socket.write('250 local synthetic recipient\r\n')
          else { rejectedRecipients++; socket.write('550 recipient outside this synthetic run\r\n') }
        }
        else if (line === 'DATA') { data = true; socket.write('354 end with dot\r\n') }
        else if (line === 'QUIT') socket.end('221 bye\r\n')
        else socket.write('250 OK\r\n')
      }
    })
  })
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes) })
  return { port: server.address().port, count: () => messages, rejected: () => rejectedRecipients, async close() { for (const socket of sockets) socket.destroy(); await new Promise(yes => server.close(yes)) } }
}
async function waitForApp(app, baseURL) {
  const until = Date.now() + 90000
  while (Date.now() < until) {
    assert(app.child.exitCode === null, 'Owned app exited before readiness')
    try { const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(2000) }); if (response.ok) return } catch { /* server still starting */ }
    await delay(500)
  }
  throw new Error('Owned app did not become ready')
}

async function runMutationLoad(config) {
  const root = resolve(import.meta.dirname, '../..')
  const loadToolSha256 = await loadToolIdentity(root)
  validateMutationInputs({ ...config, repositoryRoot: root })
  validateMutationInputs({ ...config, databaseUrl: config.fixtureDatabaseUrl, repositoryRoot: root })
  assert(databaseIdentity(config.databaseUrl) === databaseIdentity(config.fixtureDatabaseUrl), 'App and fixture must use the same isolated DB')
  assert(['smoke', 'full'].includes(config.profile), 'Explicit smoke/full profile required')
  assert(!config.negative || ['unsigned', 'stale-consent', 'missing-target', 'unready'].includes(config.negative), 'Unknown negative control')
  const origin = new URL(config.baseURL)
  assert(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port, 'Owned local runner requires HTTP 127.0.0.1 and an explicit port')
  // Docker Desktop provides this host-only transport alias. Same Origin/Host is
  // used throughout the app and browser; no CSP/CSRF/auth exemption is introduced.
  const browserBaseURL = `http://host.docker.internal:${origin.port}`
  const template = parseEnv(await readFile(resolve(root, 'env.example'), 'utf8'))
  const system = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|home|userprofile|comspec|pathext)$/i.test(key)))
  await reserveMutationRunDirectory(config.runDir)
  const sink = await smtpSink(config.runId)
  let coordinator
  try { coordinator = await createMutationCoordinator({ runId: config.runId, timeoutMs: config.negative ? 15000 : 45000 }) }
  catch (error) { await sink.close(); throw error }
  const secret = randomBytes(40).toString('hex')
  const piiKey = `v1:${randomBytes(32).toString('base64')}`
  const env = { ...system, ...template, APP_ENV: 'ci', NODE_ENV: 'production', PORT: origin.port,
    APP_URL: browserBaseURL, BETTER_AUTH_URL: browserBaseURL, INTERNAL_BASE_URL: origin.origin,
    DATABASE_URL: config.databaseUrl, WORKER_DATABASE_URL: config.databaseUrl, MIGRATE_DATABASE_URL: config.fixtureDatabaseUrl,
    BETTER_AUTH_SECRET: secret, PII_KEYS: piiKey, PII_ACTIVE_KEY_ID: 'v1',
    EMAIL_PROVIDER: 'smtp', EMAIL_VERIFICATION_PROVIDER: 'smtp', SMTP_URL: `smtp://127.0.0.1:${sink.port}`,
    S3_ACCESS_KEY_ID: 'synthetic', S3_SECRET_ACCESS_KEY: 'synthetic', MARKETING_UNSUBSCRIBE_SECRET: randomBytes(40).toString('hex'),
    ANTHROPIC_API_KEY: '', VOYAGE_API_KEY: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
    RESEND_API_KEY: '', EMAIL_VERIFICATION_RESEND_API_KEY: '', NEXT_TELEMETRY_DISABLED: '1',
    LOAD_RUN_DIR: config.runDir, LOAD_RUN_ID: config.runId,
  }
  // Fixture services are loaded only after all explicit inputs and synthetic env exist.
  const savedEnv = { ...process.env }
  Object.assign(process.env, env)
  const preload = resolve(root, 'scripts/load/isolated-process.cjs')
  let app
  let client
  let manifest
  let failure
  try {
    // The CLI's own fixture/verifier imports receive the same file/network guard.
    // Generated Prisma clients from other workspaces may retain environment paths.
    createRequire(import.meta.url)(preload)
    await checkedProcess('docker', ['run', '--rm', '--mount', `type=bind,source=${resolve(root, 'load/k6')},target=/scripts,readonly`,
      '-e', `LOAD_COORDINATOR=http://host.docker.internal:${coordinator.port}`, '-e', `LOAD_RUN_ID=${config.runId}`,
      image, 'run', '/scripts/transport-probe.js'], { env: system, root, log: resolve(config.runDir, 'transport.log') })
    const { PrismaClient } = await import('@prisma/client')
    const { createMutationFixtures } = await import('./fixtures.ts')
    const { collectMutationSnapshot, assertMutationEvidence } = await import('./verify-mutations.ts')
    manifest = await createMutationFixtures({ ...config, databaseUrl: config.fixtureDatabaseUrl, secret, repositoryRoot: root })
    manifest.browserBaseURL = browserBaseURL
    client = new PrismaClient({ datasources: { db: { url: config.fixtureDatabaseUrl } }, log: [] })
    if (config.negative === 'unsigned') {
      const c = manifest.balanceRace.account.cookie
      c.value = decodeURIComponent(c.value).split('.')[0]; c.header = `${c.name}=${c.value}`
    }
    if (config.negative === 'stale-consent') await client.consent.updateMany({ where: { userId: manifest.balanceRace.account.userId, type: 'TERMS' }, data: { version: 'synthetic-previous-version' } })
    await writeFile(resolve(config.runDir, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 })
    selectApplyPair(manifest.applyPairs, manifest.applyPairs.length - 1)
    console.log(`Fixture ready: ${manifest.scope.companyIds.length} companies / ${manifest.scope.studentIds.length} students / ${manifest.scope.jobIds.length} jobs`)
    const source = await sourceIdentity(root)
    const buildRecord = resolve(root, '.next/m7-mutation-build.json')
    if (config.build) {
      console.log('Building owned application with synthetic configuration')
      await checkedProcess(process.execPath, ['--require', preload, 'node_modules/next/dist/bin/next', 'build'], { env, root, log: resolve(config.runDir, 'build.log') })
      assert.equal((await sourceIdentity(root)).sourceSha256, source.sourceSha256, 'Application source changed while building')
      await writeFile(buildRecord, JSON.stringify({ ...source, buildId: (await readFile(resolve(root, '.next/BUILD_ID'), 'utf8')).trim() }))
    }
    const buildId = (await readFile(resolve(root, '.next/BUILD_ID'), 'utf8')).trim()
    const built = JSON.parse(await readFile(buildRecord, 'utf8'))
    assert.equal(built.buildId, buildId, 'Unknown build; rerun with --build')
    assert.equal(built.sourceSha256, source.sourceSha256, 'Source differs from owned build; rerun with --build')
    const k6Version = await capture('docker', ['run', '--rm', '--network', 'none', image, 'version'], root)
    const chromiumVersion = await capture('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'chromium', image, '--version'], root)
    await writeFile(resolve(config.runDir, 'run-metadata.json'), JSON.stringify({ runId: config.runId, profile: config.profile, negative: config.negative,
      buildId, ...source, loadToolSha256, k6Version, chromiumVersion, image }, null, 2), { mode: 0o600 })
    app = ownedProcess(process.execPath, ['--require', preload, 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', origin.port], { env, root, log: resolve(config.runDir, 'app.log') })
    await waitForApp(app, origin.origin)
    // Observe the original nonexistent routes using an actual signed session.
    const legacy = []
    for (const [path, account] of [
      [`/api/e/talent/${manifest.balanceRace.studentIds[0]}/unlock`, manifest.balanceRace.account],
      [`/api/s/jobs/${manifest.applyPairs[0].jobId}/apply`, manifest.applyPairs[0].account],
    ]) {
      const response = await fetch(`${origin.origin}${path}`, { method: 'POST', headers: { Cookie: account.cookie.header }, redirect: 'manual' })
      legacy.push({ status: response.status, accepted: false })
      assert(response.status === 404, 'Legacy route behavior changed; inspect before continuing')
    }
    const unsigned = manifest.idempotentUnlock.account.cookie
    const raw = `${unsigned.name}=${decodeURIComponent(unsigned.value).split('.')[0]}`
    const control = await fetch(`${origin.origin}/api/auth/get-session`, { headers: { Cookie: raw } })
    assert.equal((await control.json())?.user, undefined, 'Unsigned cookie unexpectedly authenticated')
    console.log('Original route 404s and unsigned-session rejection observed')
    const measurements = {}
    for (const scenario of config.negative ? ['balanceRace'] : ['balanceRace', 'idempotentUnlock', 'apply', 'duplicateApply']) {
      console.log(`Running ${scenario} (${config.profile}${config.negative ? ` / ${config.negative}` : ''})`)
      const file = scenario === 'balanceRace' || scenario === 'idempotentUnlock' ? 'unlock.js' : 'apply.js'
      const containerName = `${config.runId}-${scenario.toLowerCase()}`
      const resources = []
      const sampling = new Set()
      const timer = setInterval(() => {
        const sample = capture('docker', ['stats', '--no-stream', '--format', '{{json .}}', containerName], root)
          .then(value => { if (value) { const row = JSON.parse(value); resources.push({ cpu: row.CPUPerc, memory: row.MemUsage, pids: row.PIDs }) } }).catch(() => {})
        sampling.add(sample); sample.finally(() => sampling.delete(sample))
      }, 2000)
      try { await checkedProcess('docker', ['run', '--rm', '--name', containerName, '--shm-size=2g',
        '--mount', `type=bind,source=${resolve(root, 'load/k6')},target=/scripts,readonly`,
        '--mount', `type=bind,source=${config.runDir},target=/run`,
        '-e', 'LOAD_RUN_DIR=/run', '-e', `LOAD_COORDINATOR=http://host.docker.internal:${coordinator.port}`,
        '-e', `LOAD_SCENARIO=${scenario}`, '-e', `LOAD_PROFILE=${config.profile}`, '-e', `LOAD_NEGATIVE=${config.negative || ''}`,
        image, 'run', '--summary-export', `/run/${scenario}-summary.json`, `/scripts/${file}`,
      ], { env: system, root, log: resolve(config.runDir, `${scenario}.log`) }) }
      finally { clearInterval(timer); await Promise.allSettled(sampling) }
      const metrics = JSON.parse(await readFile(resolve(config.runDir, `${scenario}-summary.json`), 'utf8')).metrics
      measurements[scenario] = { samples: metrics.mutation_completed?.count ?? metrics.mutation_completed?.values?.count,
        uiP95Ms: metrics.mutation_ui_duration?.['p(95)'] ?? metrics.mutation_ui_duration?.values?.['p(95)'],
        browserHttpFailureRate: metrics.browser_http_req_failed?.value ?? metrics.browser_http_req_failed?.values?.rate ?? null,
        coordinatorTransportRetries: metrics.coordinator_transport_retries?.count ?? 0,
        sessionPreflightTransportRetries: metrics.session_preflight_transport_retries?.count ?? 0, resources }
      assert(Number.isFinite(measurements[scenario].uiP95Ms) && measurements[scenario].samples > 0 && resources.length > 0, 'Missing timing/resource measurements')
      assert.equal(measurements[scenario].samples, metrics.mutation_attempted.count, 'An attempted journey did not finish successfully')
      assert.equal(measurements[scenario].samples, metrics.iterations.count, 'An iteration escaped journey accounting')
      assert.equal(measurements[scenario].samples, coordinator.outcomes[scenario].length, 'A journey lost its coordinator acknowledgement')
    }
    coordinator.assertComplete()
    const snapshot = await collectMutationSnapshot(client, manifest)
    assertMutationEvidence({ manifest, outcomes: coordinator.outcomes, snapshot })
    assert.equal(sink.rejected(), 0, 'Notification attempted a recipient outside the current synthetic run')
    assert.equal((await readFile(resolve(root, '.next/BUILD_ID'), 'utf8')).trim(), buildId, 'Build changed during run')
    assert.equal((await sourceIdentity(root)).sourceSha256, source.sourceSha256, 'Application source changed during run')
    assert.equal(await loadToolIdentity(root), loadToolSha256, 'Load tooling changed during run')
    const summary = { runId: config.runId, profile: config.profile, buildId, ...source, loadToolSha256, image, k6Version, chromiumVersion, measurements, legacy, unsignedSessionRejected: true,
      companies: manifest.scope.companyIds.length, students: manifest.scope.studentIds.length, jobs: manifest.scope.jobIds.length,
      outcomes: Object.fromEntries(Object.entries(coordinator.outcomes).map(([name, rows]) => [name, rows.reduce((counts, row) => ({ ...counts, [row.outcome]: (counts[row.outcome] || 0) + 1 }), {})])),
      applications: snapshot.applications.length, initialEvents: snapshot.applicationEvents.length, jobViews: snapshot.jobViews.length,
      paidUnlocks: snapshot.unlocks.filter(u => u.source === 'CREDIT').length, charges: snapshot.ledger.filter(l => l.reason === 'UNLOCK').length,
      raceBalances: [manifest.balanceRace, manifest.idempotentUnlock].map(race => snapshot.wallets.find(w => w.id === race.walletId).balance), smtpMessages: sink.count(), bursts: coordinator.burstTimings(), transport: coordinator.transportStats(), verified: true,
    }
    await writeFile(resolve(config.runDir, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 })
    console.log(JSON.stringify(summary))
  } catch (error) {
    failure = error
    if (config.negative && client && manifest) {
      const { collectMutationSnapshot } = await import('./verify-mutations.ts')
      const snapshot = await collectMutationSnapshot(client, manifest)
      const log = await readFile(resolve(config.runDir, 'balanceRace.log'), 'utf8').catch(() => '')
      const witness = { unsigned: 'Session preflight rejected', 'stale-consent': 'Stale legal consent', 'missing-target': 'unlock-button', unready: 'Controlled unready client' }[config.negative]
      const proven = log.includes(witness) && coordinator.outcomes.balanceRace.length === 10 &&
        coordinator.outcomes.balanceRace.every(row => row.outcome === 'unexpected') && snapshot.unlocks.length === 0 && snapshot.applications.length === 0
      await writeFile(resolve(config.runDir, 'negative-proof.json'), JSON.stringify({ runId: config.runId, control: config.negative,
        failedAttempts: coordinator.outcomes.balanceRace.length, unlocks: snapshot.unlocks.length, applications: snapshot.applications.length, proven }, null, 2), { mode: 0o600 })
    }
  }
  finally {
    const cleanup = await Promise.allSettled([
      writeFile(resolve(config.runDir, 'outcomes.json'), JSON.stringify(coordinator.outcomes, null, 2), { mode: 0o600 }),
      app?.stop(), client?.$disconnect(), coordinator.close(), sink.close(),
    ])
    if (cleanup.some(result => result.status === 'rejected')) failure ??= new Error('Owned run cleanup failed')
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
    Object.assign(process.env, savedEnv)
  }
  if (failure) throw failure
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=') || true] }))
  runMutationLoad({
    databaseUrl: process.env.LOAD_DATABASE_URL, fixtureDatabaseUrl: process.env.LOAD_FIXTURE_DATABASE_URL,
    disallowedDatabaseUrls: JSON.parse(process.env.LOAD_DISALLOWED_DATABASE_URLS || '[]'),
    baseURL: process.env.LOAD_BASE_URL, runDir: process.env.LOAD_RUN_DIR, runId: process.env.LOAD_RUN_ID,
    profile: args.get('profile') || 'smoke', negative: args.get('negative'), build: args.has('build'),
  }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
