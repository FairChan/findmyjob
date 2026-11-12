import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Prisma } from '@prisma/client'
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { e2eDb as db } from './db'
import { loginAs } from './session'
import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'
export const matchingCopy = (locale: 'zh' | 'en') => locale === 'zh' ? zh : en
const vectorLiteral = '[' + Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0).join(',') + ']'
export async function watchMatchingResponses(page: Page) {
  const bodies: string[] = []
  const source = new URL(page.url())
  if (!/^\/(?:zh|en)\/(?:s|e\/jobs\/[^/]+\/recommendations)\/?$/.test(source.pathname)) {
    throw new Error('Matching response guard requires a matching page')
  }
  const match = (url: URL) => url.origin === source.origin && url.pathname === source.pathname
  // Capture the real action RSC before delivery; Chromium may discard a later
  // response.text() body during router.refresh(). Keep navigation streaming.
  await page.route(match, async route => {
    const request = route.request()
    if (request.isNavigationRequest() || request.method() !== 'POST' || !request.headers()['next-action']) {
      await route.continue()
      return
    }
    if (bodies.length >= 30) throw new Error('Unexpected matching action response count')
    const response = await route.fetch({ maxRedirects: 0 })
    try {
      const body = await response.body()
      expect(response.headers()['content-type']).toContain('text/x-component')
      bodies.push(body.toString('utf8'))
      await route.fulfill({ response, body })
    } finally { await response.dispose() }
  })
  return async (privateValues: string[]) => {
    try {
      await page.waitForLoadState('networkidle')
      expect(bodies.length).toBeGreaterThan(0)
      for (const body of bodies) {
        expect(privateValues.every(value => !body.includes(value))).toBe(true)
        expect(body).not.toContain(vectorLiteral)
        expect(body).not.toMatch(/"(?:distance|embedding|rawVector|score|explanation)"\s*:/)
      }
    } finally { await page.unroute(match) }
  }
}
async function sourceHash(kind: 'JOB' | 'STUDENT', input: unknown): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const child = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', resolve('tests/e2e/helpers/matching-t03-hash.ts')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '' },
    })
    let output = ''
    const timer = setTimeout(() => child.kill(), 10_000)
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 128) child.kill() })
    child.stderr.resume()
    child.on('error', () => { clearTimeout(timer); reject(new Error('Synthetic projection child failed')) })
    child.on('close', code => { clearTimeout(timer); if (code === 0 && /^[a-f0-9]{64}$/.test(output)) resolveHash(output); else reject(new Error('Synthetic projection child failed')) })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ kind, input }))
  })
}
export class MatchingFixture {
  readonly marker = 'M9T03_' + randomUUID().replaceAll('-', '').slice(0, 12)
  readonly epoch = randomUUID()
  private snapshot: { value: Prisma.JsonValue; updatedAt: Date; updatedById: string | null } | null = null
  private touched = false
  employerContext?: BrowserContext
  employerPage!: Page
  studentUserId = ''; employerUserId = ''; profileId = ''; companyId = ''; jobId = ''; draftId = ''; foreignId = ''; foreignCompanyId = ''; version = ''
  readonly privateBody = 'SYNTHETIC_PRIVATE_JOB_BODY'
  readonly fullName = 'SYNTHETIC PRIVATE IDENTITY'
  constructor(readonly studentPage: Page, readonly browser: Browser) {}
  log() { return existsSync(process.env.T03_AI_LOG!) ? readFileSync(process.env.T03_AI_LOG!, 'utf8').trim().split('\n').filter(Boolean) : [] }
  async init(vector: boolean) {
    if (process.env.VOYAGE_API_KEY !== 'SYNTHETIC_T03_NO_EXTERNAL_AI' || !process.env.T03_AI_LOG || (process.env.T03_VECTOR_LANE === '1') !== vector) throw new Error('Use dedicated matching Playwright config')
    const capability = await db.$queryRaw<Array<{ available: boolean }>>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector' AND extversion='0.8.7') AND to_regclass('public.semantic_vectors') IS NOT NULL AS available`)
    expect(capability[0].available, 'Use the correct prepared lane; missing vectors must not skip ranking coverage').toBe(vector)
    expect(await db.semanticIndex.count({ where: { state: { in: ['QUEUED', 'PROCESSING'] } } })).toBe(0)
    this.snapshot = await db.systemSetting.findUnique({ where: { key: 'ai.matching' }, select: { value: true, updatedAt: true, updatedById: true } })
    const previous = this.snapshot?.value
    expect(previous == null || typeof previous === 'object' && !Array.isArray(previous) && previous.enabled === false, 'Refusing enabled or invalid baseline matching gate').toBe(true)
    const legal = (await db.systemSetting.findUnique({ where: { key: 'legal.currentVersion' } }))?.value ?? '2026-11-draft'
    if (typeof legal !== 'string' || !legal.trim() || legal.length > 100) throw new Error('Valid baseline policy required')
    this.version = legal
    const search = (await db.systemSetting.findUnique({ where: { key: 'talentPool.searchEnabled' } }))?.value ?? true
    expect(search).toBe(true)
    const student = await loginAs(this.studentPage, { role: 'STUDENT' }); this.studentUserId = student.userId
    const profile = await db.studentProfile.create({ data: { userId: student.userId, fullName: this.fullName, headline: 'SYNTHETIC data skills',
      summary: 'SYNTHETIC_PRIVATE_PROFILE_BODY', major: 'Testing', degreeLevel: 'BACHELOR', skills: ['SYNTHETIC SQL'], intents: ['INTERNSHIP'], preferredStates: ['KUL'],
      visibility: 'HIDDEN', completeness: 100, schoolVerifiedAt: new Date(), workAuth: 'STUDENT_PASS', onboardingStep: 5,
    } }); this.profileId = profile.id
    this.employerContext = await this.browser.newContext({ baseURL: 'http://localhost:3009' }); this.employerPage = await this.employerContext.newPage()
    const employer = await loginAs(this.employerPage, { role: 'EMPLOYER', company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER' } })
    this.employerUserId = employer.userId; this.companyId = employer.companyId!
    const data = { companyId: this.companyId, createdById: this.employerUserId, title: this.marker + ' Analyst', type: 'INTERNSHIP' as const,
      workMode: 'HYBRID' as const, description: this.privateBody, skills: ['SYNTHETIC SQL'], languages: ['English'], salaryMin: 12345, salaryMax: 23456, salaryVisible: false }
    this.jobId = (await db.job.create({ data: { ...data, status: 'PUBLISHED', publishedAt: new Date() } })).id
    this.draftId = (await db.job.create({ data: { ...data, title: this.marker + ' Draft', status: 'DRAFT' } })).id
    const foreign = await db.company.create({ data: { legalName: this.marker + ' Foreign', isActive: true, verificationStatus: 'VERIFIED' } }); this.foreignCompanyId = foreign.id
    this.foreignId = (await db.job.create({ data: { ...data, companyId: foreign.id, title: this.marker + ' Foreign job', status: 'PUBLISHED', publishedAt: new Date() } })).id
    this.touched = true; await this.gate(true)
  }
  async gate(enabled: boolean) {
    const value = { enabled, legalVersion: this.version, epoch: this.epoch, configurationId: 'matching-public-v1' }
    await db.systemSetting.upsert({ where: { key: 'ai.matching' }, create: { key: 'ai.matching', value }, update: { value } })
  }
  async counts() {
    return {
      jobs: await db.jobView.count({ where: { studentId: this.profileId } }),
      profiles: await db.profileView.count({ where: { viewerId: this.employerUserId } }),
      unlocks: await db.talentUnlock.count({ where: { companyId: this.companyId } }),
      applications: await db.application.count({ where: { studentId: this.profileId } }),
      invitations: await db.invitation.count({ where: { companyId: this.companyId } }),
      credits: await db.creditLedger.count({ where: { wallet: { companyId: this.companyId } } }),
    }
  }
  async seedConsent() {
    return db.consent.create({ data: { userId: this.studentUserId, type: 'AI_MATCHING', version: this.version, granted: true } })
  }
  async seedIndex(kind: 'JOB' | 'STUDENT') {
    const subject = kind === 'JOB' ? await db.job.findUniqueOrThrow({ where: { id: this.jobId } }) : await db.studentProfile.findUniqueOrThrow({ where: { id: this.profileId } })
    const grant = kind === 'STUDENT' ? await db.consent.findFirstOrThrow({ where: { userId: this.studentUserId, type: 'AI_MATCHING' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) : null
    if (grant) expect(grant).toMatchObject({ granted: true, version: this.version })
    const input = 'title' in subject
      ? { title: subject.title, type: subject.type, category: subject.category, workMode: subject.workMode, state: subject.state, city: subject.city, skills: subject.skills, languages: subject.languages }
      : { fullName: subject.fullName, headline: subject.headline, major: subject.major, degreeLevel: subject.degreeLevel, skills: subject.skills, intents: subject.intents, preferredStates: subject.preferredStates }
    const index = await db.semanticIndex.create({ data: { kind, ...(kind === 'JOB' ? { jobId: this.jobId } : { studentId: this.profileId }),
      state: 'READY', generation: 1, sourceHash: await sourceHash(kind, input), sourceRevision: kind === 'JOB' ? (subject as { matchingRevision: number }).matchingRevision : (subject as { editRevision: number }).editRevision,
      configurationId: 'matching-public-v1', model: 'synthetic-t03-embedding', gateEpoch: this.epoch, legalVersion: this.version,
      consentGrantId: grant?.id ?? null, completedAt: new Date(),
    } })
    await db.$executeRaw(Prisma.sql`INSERT INTO public.semantic_vectors ("indexId",generation,embedding) VALUES (${index.id},1,${vectorLiteral}::vector)`)
    return index
  }
  async cleanup() {
    try {
      if (this.touched) {
        if (this.snapshot) {
          const data = { ...this.snapshot, value: this.snapshot.value === null ? Prisma.JsonNull : this.snapshot.value }
          await db.systemSetting.upsert({ where: { key: 'ai.matching' }, create: { key: 'ai.matching', ...data }, update: data })
        } else await db.systemSetting.deleteMany({ where: { key: 'ai.matching' } })
      }
    } finally {
      if (this.profileId) {
        await db.semanticIndex.deleteMany({ where: { studentId: this.profileId } })
        await db.studentProfile.updateMany({ where: { id: this.profileId }, data: { visibility: 'HIDDEN' } })
      }
      await db.job.deleteMany({ where: { id: { in: [this.jobId, this.draftId, this.foreignId].filter(Boolean) } } })
      await db.company.updateMany({ where: { id: { in: [this.companyId, this.foreignCompanyId].filter(Boolean) } }, data: { isActive: false } })
      const userIds = [this.studentUserId, this.employerUserId].filter(Boolean)
      await db.session.deleteMany({ where: { userId: { in: userIds } } }); await db.account.deleteMany({ where: { userId: { in: userIds } } })
      await db.user.updateMany({ where: { id: { in: userIds } }, data: { status: 'SUSPENDED' } })
      await this.employerContext?.close()
    }
    expect(this.log().every(line => line === 'SYNTHETIC_QUERY')).toBe(true)
  }
}
