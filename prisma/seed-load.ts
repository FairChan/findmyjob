/**
 * Load-test seed — staging only.
 * Creates 100 employer accounts, 5000 student profiles, 500 published jobs.
 * Writes session cookies and IDs to load/*.local.json for k6 scripts.
 * Also generates load/fixtures/minimal.pdf for upload tests.
 *
 * Re-entrant: re-running resets the race-condition company and skips existing records.
 */
import { PrismaClient } from '@prisma/client'
import { Faker, zh_CN, en } from '@faker-js/faker'
import { PDFDocument } from 'pdf-lib'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

const APP_ENV = process.env.APP_ENV

if (APP_ENV !== 'staging') {
  console.error(`seed-load requires APP_ENV=staging (got: ${APP_ENV ?? 'undefined'})`)
  process.exit(1)
}

const faker = new Faker({ locale: [zh_CN, en] })

const db = new PrismaClient()

const COMPANY_COUNT = 100
const STUDENT_COUNT = 5000
const JOBS_PER_COMPANY = 5 // 500 total
const STUDENT_BATCH = 20

const LOAD_DIR = path.join(__dirname, '..', 'load')
const ACCOUNTS_PATH = path.join(LOAD_DIR, 'accounts.local.json')
const STUDENTS_PATH = path.join(LOAD_DIR, 'students.local.json')
const JOBS_PATH = path.join(LOAD_DIR, 'jobs.local.json')
const FIXTURES_DIR = path.join(LOAD_DIR, 'fixtures')

type Account = { cookie: string; userId: string; companyId: string; email: string }
type StudentAccount = { cookie: string; userId: string; studentId: string; email: string }
type JobRef = { jobId: string; companyId: string }

async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  await db.session.deleteMany({ where: { userId, userAgent: 'k6/load-test' } })
  const session = await db.session.create({
    data: { userId, token, expiresAt, ipAddress: '127.0.0.1', userAgent: 'k6/load-test' },
  })
  return `better-auth.session_token=${session.token}`
}

async function createStudentRecord(
  idx: number,
  schoolId: string,
): Promise<StudentAccount> {
  const email = `loadtest-student-${idx}@example.test`
  const user = await db.user.upsert({
    where: { email },
    create: {
      email,
      name: faker.person.fullName(),
      role: 'STUDENT',
      status: 'ACTIVE',
      emailVerified: true,
      locale: 'zh',
    },
    update: { status: 'ACTIVE', emailVerified: true },
  })
  const profile = await db.studentProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      fullName: user.name,
      schoolId,
      schoolVerifiedAt: new Date('2024-01-01'),
      visibility: 'PUBLIC',
      completeness: 70,
      major: faker.helpers.arrayElement(['计算机科学', '金融学', '市场营销', '工商管理']),
      degreeLevel: 'BACHELOR',
      graduationYear: 2025 + (idx % 3),
      workAuth: 'STUDENT_PASS',
      intents: ['INTERNSHIP'],
    },
    update: {},
  })
  const cookie = await createSession(user.id)
  return { cookie, userId: user.id, studentId: profile.id, email }
}

async function main(): Promise<void> {
  // ── Load-test school ───────────────────────────────────────────────────
  let ltSchool = await db.school.findFirst({ where: { shortName: 'LT-LOAD' } })
  if (!ltSchool) {
    ltSchool = await db.school.create({
      data: {
        nameZh: '压测大学',
        nameEn: 'LoadTest University',
        shortName: 'LT-LOAD',
        emailDomains: ['lt.example.test'],
        active: true,
      },
    })
    console.log(`Created load-test school: ${ltSchool.id}`)
  }

  // ── Employer accounts (100 companies) ─────────────────────────────────
  console.log(`Creating ${COMPANY_COUNT} employer accounts…`)
  const accounts: Account[] = []

  for (let i = 0; i < COMPANY_COUNT; i++) {
    const email = `loadtest-employer-${i}@example.test`
    const user = await db.user.upsert({
      where: { email },
      create: {
        email,
        name: faker.person.fullName(),
        role: 'EMPLOYER',
        status: 'ACTIVE',
        emailVerified: true,
        locale: 'zh',
      },
      update: { status: 'ACTIVE', emailVerified: true },
    })
    const ssm = `LL${String(i + 1).padStart(6, '0')}-X`
    const company = await db.company.upsert({
      where: { ssmRegNo: ssm },
      create: {
        legalName: `LoadTest Company ${i + 1} Sdn Bhd`,
        displayNameZh: `压测企业 ${i + 1}`,
        ssmRegNo: ssm,
        industryCode: 'technology.software',
        state: 'Kuala Lumpur',
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        isActive: true,
      },
      update: { verificationStatus: 'VERIFIED', isActive: true },
    })
    await db.creditWallet.upsert({
      where: { companyId: company.id },
      create: { companyId: company.id },
      update: {},
    })
    await db.companyMember.upsert({
      where: { companyId_userId: { companyId: company.id, userId: user.id } },
      create: { companyId: company.id, userId: user.id, role: 'OWNER' },
      update: {},
    })
    const cookie = await createSession(user.id)
    accounts.push({ cookie, userId: user.id, companyId: company.id, email })
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${COMPANY_COUNT} companies`)
  }

  // ── Race-condition setup ───────────────────────────────────────────────
  // accounts[0]: balance reset to 3 — for "10 VUs fighting over balance 3"
  // accounts[1]: balance reset to 100 — for "10 VUs unlocking the same student"
  for (const [idx, targetBalance] of [[0, 3], [1, 100]] as const) {
    const { companyId } = accounts[idx]
    // Reset any prior TalentUnlock records so the scenario is repeatable
    await db.talentUnlock.deleteMany({ where: { companyId } })

    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { companyId } })
    const delta = targetBalance - wallet.balance
    if (delta !== 0) {
      await db.$transaction(async (tx) => {
        await tx.creditLedger.create({
          data: {
            walletId: wallet.id,
            delta,
            balanceAfter: wallet.balance + delta,
            reason: 'PILOT_GRANT',
          },
        })
        await tx.creditWallet.update({
          where: { id: wallet.id },
          data: { balance: wallet.balance + delta },
        })
      })
    }
    console.log(`accounts[${idx}] (${companyId}): balance = ${targetBalance}`)
  }

  // ── Student accounts (5000) ────────────────────────────────────────────
  console.log(`Creating ${STUDENT_COUNT} student accounts (batch ${STUDENT_BATCH})…`)
  const students: StudentAccount[] = []

  for (let i = 0; i < STUDENT_COUNT; i += STUDENT_BATCH) {
    const indices = Array.from(
      { length: Math.min(STUDENT_BATCH, STUDENT_COUNT - i) },
      (_, j) => i + j,
    )
    const batch = await Promise.all(indices.map((idx) => createStudentRecord(idx, ltSchool!.id)))
    students.push(...batch)
    if (i + STUDENT_BATCH >= STUDENT_COUNT || (i / STUDENT_BATCH + 1) % 25 === 0) {
      console.log(`  ${Math.min(i + STUDENT_BATCH, STUDENT_COUNT)}/${STUDENT_COUNT} students`)
    }
  }

  // ── Published jobs (500) ───────────────────────────────────────────────
  console.log(`Creating ${COMPANY_COUNT * JOBS_PER_COMPANY} published jobs…`)
  const jobs: JobRef[] = []
  const JOB_BATCH = 10

  for (let ci = 0; ci < COMPANY_COUNT; ci += JOB_BATCH) {
    const companySlice = accounts.slice(ci, Math.min(ci + JOB_BATCH, COMPANY_COUNT))
    const batchJobs = await Promise.all(
      companySlice.flatMap(({ companyId, userId }, relIdx) => {
        const baseIdx = (ci + relIdx) * JOBS_PER_COMPANY
        return Array.from({ length: JOBS_PER_COMPANY }, async (_, j) => {
          const title = `LoadTest Job ${baseIdx + j}`
          const existing = await db.job.findFirst({
            where: { companyId, title },
            select: { id: true },
          })
          if (existing) return { jobId: existing.id, companyId }
          const job = await db.job.create({
            data: {
              companyId,
              createdById: userId,
              title,
              type: j % 2 === 0 ? 'INTERNSHIP' : 'FULL_TIME',
              description: `Load test job ${baseIdx + j} — do not apply in production.`,
              status: 'PUBLISHED',
              publishedAt: new Date(),
              state: 'Kuala Lumpur',
              acceptsStudentPass: true,
            },
          })
          return { jobId: job.id, companyId }
        })
      }),
    )
    jobs.push(...batchJobs)
    console.log(`  ${Math.min(ci + JOB_BATCH, COMPANY_COUNT) * JOBS_PER_COMPANY} jobs`)
  }

  // ── Minimal PDF fixture (for upload.js) ───────────────────────────────
  const pdfDoc = await PDFDocument.create()
  pdfDoc.addPage([595, 842])
  const pdfBytes = await pdfDoc.save()
  fs.mkdirSync(FIXTURES_DIR, { recursive: true })
  const pdfPath = path.join(FIXTURES_DIR, 'minimal.pdf')
  fs.writeFileSync(pdfPath, Buffer.from(pdfBytes))
  console.log(`Wrote minimal PDF fixture: ${pdfPath}`)

  // ── Write output files ─────────────────────────────────────────────────
  fs.mkdirSync(LOAD_DIR, { recursive: true })
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2))
  fs.writeFileSync(STUDENTS_PATH, JSON.stringify(students, null, 2))
  fs.writeFileSync(JOBS_PATH, JSON.stringify(jobs, null, 2))
  console.log(`\nOutput files:`)
  console.log(`  ${ACCOUNTS_PATH} (${accounts.length} employers)`)
  console.log(`  ${STUDENTS_PATH} (${students.length} students)`)
  console.log(`  ${JOBS_PATH} (${jobs.length} jobs)`)
}

main()
  .then(() => db.$disconnect())
  .catch((e: unknown) => {
    console.error(e)
    void db.$disconnect()
    process.exit(1)
  })
