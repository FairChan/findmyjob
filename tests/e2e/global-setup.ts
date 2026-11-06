/**
 * Playwright global setup: creates E2E fixture accounts in the test database.
 * Writes credentials to tests/e2e/fixtures.json (gitignored).
 *
 * SAFETY: only writes to TEST_DATABASE_URL. Validates that the URL points to
 * a *_test database on localhost (same rules as tests/setup/db.ts).
 */
import { createE2eDb } from './helpers/db'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, scrypt } from 'node:crypto'

// Bootstrap env vars from .env if the shell didn't export them (local dev convenience).
// Only parse if TEST_DATABASE_URL is not already set — in CI it comes from the environment.
if (!process.env.TEST_DATABASE_URL) {
  try {
    const env = readFileSync(resolve(process.cwd(), '.env'), 'utf-8')
    for (const line of env.split('\n')) {
      const eq = line.indexOf('=')
      if (eq <= 0 || line.trimStart().startsWith('#')) continue
      const k = line.slice(0, eq).trim()
      let v = line.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (k && !(k in process.env)) process.env[k] = v
    }
  } catch {}
}

// Also set SKIP_ENV_VALIDATION so the env.ts module doesn't fail during setup
process.env.SKIP_ENV_VALIDATION = '1'

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (err, key) => { if (err) reject(err); else resolve(key as Buffer) },
    )
  })
  return `${salt}:${hash.toString('hex')}`
}

export interface E2EFixtures {
  verifiedEmployer: { email: string; password: string; companyId: string }
  unverifiedEmployer: { email: string; password: string; companyId: string }
  student: { profileId: string }
  folder: { folderId: string }
}

const VERIFIED_EMAIL = 'e2e-verified-employer@example.test'
const UNVERIFIED_EMAIL = 'e2e-unverified-employer@example.test'
const STUDENT_EMAIL = 'e2e-talent-student@example.test'

export default async function globalSetup() {
  // 与 helpers/db.ts 同一个工厂：库名必须以 _test 结尾、主机必须是本机，APP_ENV=production/staging 直接拒绝
  const prisma = createE2eDb()

  // Generate random passwords each run; stored in fixtures.json read by auth.setup.ts
  const verifiedPassword = randomBytes(16).toString('base64url') + 'Aa1!'
  const unverifiedPassword = randomBytes(16).toString('base64url') + 'Aa1!'
  const verifiedHashedPw = await hashPassword(verifiedPassword)
  const unverifiedHashedPw = await hashPassword(unverifiedPassword)

  try {
    // ---- Helper: create or update employer user + company + member ----
    async function ensureEmployer(
      email: string,
      verified: boolean,
      hashedPw: string,
    ): Promise<{ userId: string; companyId: string }> {
      let user = await prisma.user.findUnique({ where: { email } })
      if (!user) {
        user = await prisma.$transaction(async (tx) => {
          const u = await tx.user.create({
            data: {
              name: `E2E Employer ${verified ? 'Verified' : 'Unverified'}`,
              email,
              emailVerified: true,
              role: 'EMPLOYER',
              status: 'ACTIVE',
            },
          })
          await tx.account.create({
            data: {
              userId: u.id,
              accountId: u.id,
              providerId: 'credential',
              password: hashedPw,
            },
          })
          return u
        })
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
        })
        // Update account password with freshly generated one
        await prisma.account.updateMany({
          where: { userId: user.id, providerId: 'credential' },
          data: { password: hashedPw },
        })
      }

      let member = await prisma.companyMember.findFirst({
        where: { userId: user.id },
        include: { company: true },
      })
      if (!member) {
        const company = await prisma.company.create({
          data: {
            legalName: `E2E ${verified ? 'Verified' : 'Unverified'} Co Sdn Bhd`,
            verificationStatus: verified ? 'VERIFIED' : 'UNSUBMITTED',
            isActive: true,
            ...(verified ? { verifiedAt: new Date() } : {}),
          },
        })
        member = await prisma.companyMember.create({
          data: { userId: user.id, companyId: company.id, role: 'OWNER' },
          include: { company: true },
        })
      } else {
        await prisma.company.update({
          where: { id: member.companyId },
          data: {
            verificationStatus: verified ? 'VERIFIED' : 'UNSUBMITTED',
            isActive: true,
            ...(verified ? { verifiedAt: new Date() } : {}),
          },
        })
      }
      return { userId: user.id, companyId: member.companyId }
    }

    // ---- Create/update verified employer ----
    const verifiedEmp = await ensureEmployer(VERIFIED_EMAIL, true, verifiedHashedPw)

    // ---- Create/update unverified employer ----
    const unverifiedEmp = await ensureEmployer(UNVERIFIED_EMAIL, false, unverifiedHashedPw)

    // ---- Create/update student ----
    let studentUser = await prisma.user.findUnique({ where: { email: STUDENT_EMAIL } })
    if (!studentUser) {
      studentUser = await prisma.user.create({
        data: {
          name: 'E2E Talent Student',
          email: STUDENT_EMAIL,
          emailVerified: true,
          role: 'STUDENT',
          status: 'ACTIVE',
        },
      })
    }

    const school = await prisma.school.findFirst({ where: { active: true } })

    let profile = await prisma.studentProfile.findUnique({ where: { userId: studentUser.id } })
    if (!profile) {
      profile = await prisma.studentProfile.create({
        data: {
          userId: studentUser.id,
          fullName: 'E2E Talent Student',
          visibility: 'PUBLIC',
          completeness: 85,
          schoolId: school?.id ?? null,
          schoolVerifiedAt: new Date(),
          major: 'Computer Science',
          degreeLevel: 'BACHELOR',
          graduationYear: 2025,
          skills: ['Python', 'React', 'TypeScript'],
          workAuth: 'STUDENT_PASS',
          headline: 'Full-stack developer with Python experience',
          intents: ['INTERNSHIP', 'FULL_TIME'],
          lastActiveAt: new Date(),
        },
      })
    } else {
      profile = await prisma.studentProfile.update({
        where: { id: profile.id },
        data: {
          visibility: 'PUBLIC',
          completeness: 85,
          schoolId: profile.schoolId ?? school?.id ?? null,
          schoolVerifiedAt: new Date(),
          skills: ['Python', 'React', 'TypeScript'],
          headline: 'Full-stack developer with Python experience',
          intents: ['INTERNSHIP', 'FULL_TIME'],
          lastActiveAt: new Date(),
        },
      })
    }

    // ---- Ensure CreditWallet for verified employer (M4-T07: unlock) ----
    await prisma.creditWallet.upsert({
      where: { companyId: verifiedEmp.companyId },
      create: { companyId: verifiedEmp.companyId, balance: 100 },
      update: { balance: 100 },
    })
    // Clear any TalentUnlock records so the unlock button is always visible each run
    await prisma.talentUnlock.deleteMany({ where: { companyId: verifiedEmp.companyId } })

    // ---- Create/update a folder with the student added ----
    let folder = await prisma.talentFolder.findFirst({
      where: { companyId: verifiedEmp.companyId, name: 'E2E Test Folder' },
    })
    if (!folder) {
      folder = await prisma.talentFolder.create({
        data: {
          companyId: verifiedEmp.companyId,
          name: 'E2E Test Folder',
          createdById: verifiedEmp.userId,
        },
      })
    }
    // Upsert student into folder
    await prisma.talentFolderItem.upsert({
      where: { folderId_studentId: { folderId: folder.id, studentId: profile.id } },
      create: { folderId: folder.id, studentId: profile.id, addedById: verifiedEmp.userId },
      update: {},
    })

    // ---- Write fixtures (passwords stored here for auth.setup.ts) ----
    const fixtures: E2EFixtures = {
      verifiedEmployer: {
        email: VERIFIED_EMAIL,
        password: verifiedPassword,
        companyId: verifiedEmp.companyId,
      },
      unverifiedEmployer: {
        email: UNVERIFIED_EMAIL,
        password: unverifiedPassword,
        companyId: unverifiedEmp.companyId,
      },
      student: { profileId: profile.id },
      folder: { folderId: folder.id },
    }
    writeFileSync(
      resolve(process.cwd(), 'tests/e2e/fixtures.json'),
      JSON.stringify(fixtures, null, 2),
    )

    // auth-verified.json and auth-unverified.json are written by tests/e2e/auth.setup.ts
    // which runs as a Playwright setup project before the main test suites.
  } finally {
    await prisma.$disconnect()
  }
}
