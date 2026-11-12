import { createHash, randomBytes } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Prisma, PrismaClient } from '@prisma/client'
import { createLoadSessionCookie, requireLoadSessionOptions } from './session-cookie'

type LoadCookie = Awaited<ReturnType<typeof createLoadSessionCookie>>
type Account = { userId: string; cookie: LoadCookie }
type Pair = { studentId: string; jobId: string; companyId: string; account: Account }
export type MutationManifest = {
  runId: string
  baseURL: string
  profile: 'smoke' | 'full'
  legalVersion: string
  createdAt: string
  scope: { schoolIds: string[]; userIds: string[]; companyIds: string[]; walletIds: string[]; studentIds: string[]; jobIds: string[] }
  balanceRace: { companyId: string; walletId: string; initialBalance: 3; studentIds: string[]; account: Account }
  idempotentUnlock: { companyId: string; walletId: string; initialBalance: 100; studentId: string; account: Account }
  applyPairs: Pair[]
  duplicateApplyPair: Pair
}
export type MutationFixtureOptions = {
  databaseUrl: string
  baseURL: string
  runId: string
  runDir: string
  repositoryRoot: string
  disallowedDatabaseUrls: string[]
  secret: string
  profile: 'smoke' | 'full'
}

const id = () => `c${randomBytes(16).toString('hex')}`
class MutationFixturePrerequisiteError extends Error {}
const fail = (message: string): never => { throw new MutationFixturePrerequisiteError(`Mutation fixture prerequisite: ${message}`) }
const unique = (values: string[]) => new Set(values).size === values.length

/** Explicit-client reads, with the same absent-setting defaults as the real services. */
export async function readMutationFixturePrerequisites(client: Pick<PrismaClient, 'systemSetting'>): Promise<string> {
  const defaults: Record<string, unknown> = {
    'legal.currentVersion': '2026-11-draft', 'unlock.enabled': true, 'unlock.costCredits': 1,
    'limits.unlocksPerDay': 50, 'limits.profileViewsPerDay': 200, 'limits.companyProfileViewsPerDay': 400,
    'talentPool.minCompleteness': 60, 'apply.minCompleteness': 60,
    'studentQuota.enabled': true, 'studentQuota.baseJobViews': 20,
  }
  const settings = await client.systemSetting.findMany({ where: { key: { in: Object.keys(defaults) } }, select: { key: true, value: true } })
  const current = { ...defaults, ...Object.fromEntries(settings.map(row => [row.key, row.value])) }
  const integer = (key: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
    const value = current[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(key)
  }
  if (current['unlock.enabled'] !== true || current['unlock.costCredits'] !== 1) fail('unlock must be enabled at cost 1')
  integer('limits.unlocksPerDay', 10)
  integer('limits.profileViewsPerDay', 10)
  integer('limits.companyProfileViewsPerDay', 10)
  integer('talentPool.minCompleteness', 0, 70)
  integer('apply.minCompleteness', 0, 70)
  if (current['studentQuota.enabled'] !== true) fail('normal student quota must remain enabled')
  integer('studentQuota.baseJobViews', 1)
  const legalVersion = current['legal.currentVersion']
  if (typeof legalVersion !== 'string' || !legalVersion.trim() || legalVersion.length > 100) fail('current legal version')
  return legalVersion as string
}

/** Read-only initial state assertion; call before any owned UI preflight creates views. */
export async function assertInitialMutationFixtures(client: PrismaClient, manifest: MutationManifest): Promise<void> {
  const { scope } = manifest
  const expected = manifest.profile === 'full' ? { companies: 100, students: 5000, jobs: 500 } : { companies: 3, students: 32, jobs: 5 }
  if (scope.companyIds.length !== expected.companies || scope.studentIds.length !== expected.students || scope.jobIds.length !== expected.jobs ||
    ![scope.schoolIds, scope.userIds, scope.companyIds, scope.walletIds, scope.studentIds, scope.jobIds].every(unique)) fail('scope counts/uniqueness')
  const version = await readMutationFixturePrerequisites(client)
  if (version !== manifest.legalVersion) fail('legal version changed during fixture creation')
  const [users, students, companies, jobs, members, wallets, ledger, consents] = await Promise.all([
    client.user.findMany({ where: { id: { in: scope.userIds } }, select: { id: true, role: true, status: true, emailVerified: true } }),
    client.studentProfile.findMany({ where: { id: { in: scope.studentIds } }, select: { id: true, userId: true, visibility: true, schoolVerifiedAt: true, completeness: true, onboardingStep: true, schoolId: true } }),
    client.company.findMany({ where: { id: { in: scope.companyIds } }, select: { id: true, isActive: true, verificationStatus: true } }),
    client.job.findMany({ where: { id: { in: scope.jobIds } }, select: { id: true, companyId: true, status: true, deadline: true } }),
    client.companyMember.findMany({ where: { companyId: { in: scope.companyIds } }, select: { companyId: true, userId: true, role: true } }),
    client.$queryRaw<Array<{ id: string; companyId: string; balance: number }>>(Prisma.sql`SELECT "id", "companyId", "balance" FROM "CreditWallet" WHERE "companyId" IN (${Prisma.join(scope.companyIds)})`),
    client.$queryRaw<Array<{ walletId: string; delta: number; balanceAfter: number; reason: string; refType: string | null; refId: string | null }>>(Prisma.sql`SELECT "walletId", "delta", "balanceAfter", "reason", "refType", "refId" FROM "CreditLedger" WHERE "walletId" IN (${Prisma.join(scope.walletIds)})`),
    client.consent.findMany({ where: { userId: { in: scope.userIds } }, select: { userId: true, type: true, granted: true, version: true } }),
  ])
  if (users.length !== scope.userIds.length || students.length !== expected.students || companies.length !== expected.companies || jobs.length !== expected.jobs ||
    members.length !== expected.companies || wallets.length !== expected.companies) fail('missing scoped entity')
  const userById = new Map(users.map(user => [user.id, user]))
  if (users.some(user => user.status !== 'ACTIVE' || !user.emailVerified)) fail('inactive/unverified account')
  if (students.some(student => student.visibility !== 'PUBLIC' || !student.schoolVerifiedAt || student.completeness !== 70 || student.onboardingStep !== 5 ||
    !student.schoolId || !scope.schoolIds.includes(student.schoolId) || userById.get(student.userId)?.role !== 'STUDENT')) fail('student eligibility')
  if (companies.some(company => !company.isActive || company.verificationStatus !== 'VERIFIED') ||
    members.some(member => member.role !== 'OWNER' || userById.get(member.userId)?.role !== 'EMPLOYER')) fail('company owner eligibility')
  if (jobs.some(job => job.status !== 'PUBLISHED' || job.deadline !== null && job.deadline <= new Date() ||
    !scope.companyIds.includes(job.companyId) || [manifest.balanceRace.companyId, manifest.idempotentUnlock.companyId].includes(job.companyId))) fail('job eligibility/ownership')
  if (consents.length !== users.length * 2) fail('legal grants must be the only consent rows')
  for (const user of users) {
    const grants = consents.filter(consent => consent.userId === user.id)
    if (grants.length !== 2 || !(['TERMS', 'PRIVACY'] as const).every(type => grants.some(consent => consent.type === type && consent.granted && consent.version === version))) fail('current legal grants')
  }
  if (ledger.length !== 2) fail('fresh grant history')
  for (const wallet of wallets) {
    const race = [manifest.balanceRace, manifest.idempotentUnlock].find(item => item.walletId === wallet.id)
    const entries = ledger.filter(entry => entry.walletId === wallet.id)
    if (race ? wallet.companyId !== race.companyId || wallet.balance !== race.initialBalance || entries.length !== 1 ||
      entries[0].reason !== 'PILOT_GRANT' || entries[0].delta !== race.initialBalance || entries[0].balanceAfter !== race.initialBalance || entries[0].refType !== null || entries[0].refId !== null
      : wallet.balance !== 0 || entries.length !== 0) fail('wallet/grant coherence')
  }
  const studentsOrCompanies = [{ companyId: { in: scope.companyIds } }, { studentId: { in: scope.studentIds } }]
  const [unlocks, applications, views, profileViews, invitations] = await Promise.all([
    client.talentUnlock.count({ where: { OR: studentsOrCompanies } }),
    client.application.count({ where: { OR: [{ studentId: { in: scope.studentIds } }, { jobId: { in: scope.jobIds } }] } }),
    client.jobView.count({ where: { OR: [{ studentId: { in: scope.studentIds } }, { jobId: { in: scope.jobIds } }] } }),
    client.profileView.count({ where: { OR: studentsOrCompanies } }),
    client.invitation.count({ where: { OR: studentsOrCompanies } }),
  ])
  if (unlocks || applications || views || profileViews || invitations) fail('initial mutation/view rows must be absent')
  const reserved = [...manifest.balanceRace.studentIds, manifest.idempotentUnlock.studentId]
  if (reserved.length !== 11 || !unique(reserved) || !reserved.every(studentId => scope.studentIds.includes(studentId)) ||
    manifest.applyPairs.length !== expected.students - 12 || !unique(manifest.applyPairs.map(pair => pair.studentId)) ||
    reserved.includes(manifest.duplicateApplyPair.studentId) || manifest.applyPairs.some(pair => reserved.includes(pair.studentId) || pair.studentId === manifest.duplicateApplyPair.studentId)) fail('scenario reservations')
  const jobById = new Map(jobs.map(job => [job.id, job]))
  const studentById = new Map(students.map(student => [student.id, student]))
  for (const pair of [...manifest.applyPairs, manifest.duplicateApplyPair]) {
    if (jobById.get(pair.jobId)?.companyId !== pair.companyId || studentById.get(pair.studentId)?.userId !== pair.account.userId) fail('application schedule references')
  }
}

/** Fresh synthetic entities only. This module has no CLI or ambient DATABASE_URL fallback. */
export async function createMutationFixtures(options: MutationFixtureOptions): Promise<MutationManifest> {
  // Keep this import dynamic: the parent runner owns OS-temp/DB identity guards,
  // and validates once more here before any Prisma construction or DB write.
  const runnerPath = './run-mutations.mjs'
  const runner = await import(runnerPath) as { validateMutationInputs(input: MutationFixtureOptions & { allowReservedRunDirectory: boolean }): void }
  runner.validateMutationInputs({ ...options, allowReservedRunDirectory: true })
  const sessionOptions = requireLoadSessionOptions({ secret: options.secret, baseURL: options.baseURL })
  if (options.profile !== 'smoke' && options.profile !== 'full') fail('profile must be smoke or full')
  const directory = resolve(options.runDir)
  const directoryStat = await lstat(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || await realpath(directory) !== directory) fail('reserved output directory')
  if (process.platform !== 'win32' && (directoryStat.mode & 0o077) !== 0) fail('run directory must be private')
  // Exclusive before DB writes: competing/reused manifests never mutate fixtures.
  // On failure leave the private run reservation in place; do not silently retry
  // or delete committed synthetic records/append-only grant history.
  const output = await open(resolve(directory, 'manifest.json'), 'wx', 0o600)
  let client: PrismaClient | undefined
  try {
    client = new PrismaClient({ datasources: { db: { url: options.databaseUrl } }, log: [] })
    // Import after explicit guards. Both write helpers use only the supplied tx,
    // never the credits module's ambient db client, for all fixture grants.
    const { createWallet, applyLedgerEntry } = await import('../../src/server/services/credits')
    const legalVersion = await readMutationFixturePrerequisites(client)
    const counts = options.profile === 'full' ? { companies: 100, students: 5000, jobs: 500 } : { companies: 3, students: 32, jobs: 5 }
    const namespace = createHash('sha256').update(options.runId).digest('hex')
    const schoolId = `c${namespace.slice(0, 32)}`
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const employers = Array.from({ length: counts.companies }, (_, index) => ({ userId: id(), companyId: id(), walletId: '', index }))
    const students = Array.from({ length: counts.students }, (_, index) => ({ userId: id(), studentId: id(), index }))
    const jobs = Array.from({ length: counts.jobs }, (_, index) => ({ jobId: id(), employer: employers[2 + index % (counts.companies - 2)], index }))
    const accountByUser = new Map<string, Account>()
    const sessions: Prisma.SessionCreateManyInput[] = []
    // Only the two race owners and scheduled applicant users need sessions.
    for (const userId of [employers[0].userId, employers[1].userId, ...students.slice(11).map(student => student.userId)]) {
      const token = randomBytes(32).toString('hex')
      sessions.push({ id: id(), userId, token, expiresAt, createdAt: now, updatedAt: now })
      accountByUser.set(userId, { userId, cookie: await createLoadSessionCookie(token, sessionOptions) })
    }
    const account = (userId: string): Account => {
      const found = accountByUser.get(userId)
      if (!found) fail('missing scheduled account')
      return found as Account
    }
    const pair = (student: typeof students[number], index: number): Pair => {
      const job = jobs[index % jobs.length]
      return { studentId: student.studentId, jobId: job.jobId, companyId: job.employer.companyId, account: account(student.userId) }
    }
    const manifest: MutationManifest = {
      runId: options.runId, baseURL: options.baseURL, profile: options.profile, legalVersion, createdAt: now.toISOString(),
      scope: { schoolIds: [schoolId], userIds: [...employers, ...students].map(item => item.userId), companyIds: employers.map(item => item.companyId),
        walletIds: employers.map(item => item.walletId), studentIds: students.map(item => item.studentId), jobIds: jobs.map(item => item.jobId) },
      balanceRace: { companyId: employers[0].companyId, walletId: employers[0].walletId, initialBalance: 3,
        studentIds: students.slice(0, 10).map(student => student.studentId), account: account(employers[0].userId) },
      idempotentUnlock: { companyId: employers[1].companyId, walletId: employers[1].walletId, initialBalance: 100,
        studentId: students[10].studentId, account: account(employers[1].userId) },
      applyPairs: students.slice(11, -1).map(pair), duplicateApplyPair: pair(students[students.length - 1], 0),
    }
    const createdWallets = await client.$transaction(async tx => {
      // PK uniqueness, not a nonunique shortName precheck, claims this exact run.
      await tx.school.create({ data: { id: schoolId, shortName: `m7-mutation-${options.runId}`, nameZh: '合成负载测试学校',
        nameEn: 'Synthetic Mutation Load School', country: 'MY', state: 'KUL', emailDomains: ['example.test'], active: true } })
      const users: Prisma.UserCreateManyInput[] = [
        ...employers.map(item => ({ id: item.userId, name: `Synthetic Owner ${item.index}`, email: `owner-${item.index}-${namespace}@example.test`,
          emailVerified: true, role: 'EMPLOYER' as const, status: 'ACTIVE' as const, locale: 'en' as const })),
        ...students.map(item => ({ id: item.userId, name: `Synthetic Student ${item.index}`, email: `student-${item.index}-${namespace}@example.test`,
          emailVerified: true, role: 'STUDENT' as const, status: 'ACTIVE' as const, locale: 'en' as const })),
      ]
      // Fixed-size createMany batches stay below PostgreSQL's bind parameter cap.
      for (let offset = 0; offset < users.length; offset += 250) await tx.user.createMany({ data: users.slice(offset, offset + 250) })
      for (let offset = 0; offset < users.length; offset += 250) await tx.consent.createMany({ data: users.slice(offset, offset + 250).flatMap(user =>
        (['TERMS', 'PRIVACY'] as const).map(type => ({ userId: user.id!, type, granted: true, version: legalVersion, createdAt: now }))) })
      await tx.company.createMany({ data: employers.map(item => ({ id: item.companyId, legalName: `Synthetic ${namespace.slice(0, 12)} Company ${item.index}`,
        displayNameEn: `Synthetic Company ${item.index}`, displayNameZh: `合成公司 ${item.index}`, isActive: true, verificationStatus: 'VERIFIED', verifiedAt: now,
        tags: [], state: 'KUL', city: 'Kuala Lumpur' })) })
      await tx.companyMember.createMany({ data: employers.map(item => ({ companyId: item.companyId, userId: item.userId, role: 'OWNER' })) })
      for (const item of employers) await createWallet(tx, item.companyId)
      // The public ledger service owns all balances and append-only grant rows.
      for (const item of employers.slice(0, 2)) await applyLedgerEntry(tx, { companyId: item.companyId, delta: item.index === 0 ? 3 : 100,
        reason: 'PILOT_GRANT', actorId: item.userId, note: 'Fresh synthetic mutation fixture grant' })
      for (let offset = 0; offset < students.length; offset += 250) await tx.studentProfile.createMany({ data: students.slice(offset, offset + 250).map(item => ({
        id: item.studentId, userId: item.userId, fullName: `Synthetic Student ${item.index}`, headline: 'Synthetic Software Intern', schoolId,
        schoolEmail: `school-${item.index}-${namespace}@example.test`, schoolVerifiedAt: now, degreeLevel: 'BACHELOR', major: 'Computer Science',
        intents: ['INTERNSHIP'], preferredStates: ['KUL'], preferredIndustries: [], skills: ['TypeScript'], visibility: 'PUBLIC', completeness: 70, onboardingStep: 5,
      })) })
      for (let offset = 0; offset < jobs.length; offset += 100) await tx.job.createMany({ data: jobs.slice(offset, offset + 100).map(item => ({
        id: item.jobId, companyId: item.employer.companyId, createdById: item.employer.userId, title: `Synthetic Internship ${item.index}`,
        type: 'INTERNSHIP', description: 'Synthetic internship for an isolated mutation correctness run.', workMode: 'ONSITE', state: 'KUL', city: 'Kuala Lumpur',
        skills: ['TypeScript'], languages: ['English'], status: 'PUBLISHED', publishedAt: now, deadline: new Date(now.getTime() + 30 * 86400_000), acceptsStudentPass: true,
      })) })
      for (let offset = 0; offset < sessions.length; offset += 250) await tx.session.createMany({ data: sessions.slice(offset, offset + 250) })
      return tx.$queryRaw<Array<{ id: string; companyId: string }>>(Prisma.sql`SELECT "id", "companyId" FROM "CreditWallet" WHERE "companyId" IN (${Prisma.join(manifest.scope.companyIds)})`)
    }, { maxWait: 10_000, timeout: 120_000 })
    const walletByCompany = new Map(createdWallets.map(wallet => [wallet.companyId, wallet.id]))
    manifest.scope.walletIds = employers.map(item => walletByCompany.get(item.companyId) ?? fail('missing created wallet'))
    manifest.balanceRace.walletId = walletByCompany.get(manifest.balanceRace.companyId) ?? fail('missing balance race wallet')
    manifest.idempotentUnlock.walletId = walletByCompany.get(manifest.idempotentUnlock.companyId) ?? fail('missing idempotency wallet')
    await assertInitialMutationFixtures(client, manifest)
    await output.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await output.sync()
    return manifest
  } catch (error) {
    // Prisma errors may contain datasource details or signed fixture values.
    // The reserved run remains consumed; diagnose through scoped parent-owned reads.
    if (error instanceof MutationFixturePrerequisiteError) throw error
    throw new Error('Mutation fixture creation failed; the reserved run is consumed and must not be reused')
  } finally {
    await Promise.allSettled([output.close(), client?.$disconnect()])
  }
}
