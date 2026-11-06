/**
 * Playwright global setup: creates E2E fixture accounts in the dev database.
 * Writes credentials to tests/e2e/fixtures.json (gitignored).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, scrypt } from 'node:crypto'

// Load .env if DATABASE_URL is not already set (local dev without exported env)
if (!process.env.DATABASE_URL) {
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
const EMPLOYER_PASSWORD = 'TestPass123!'
const STUDENT_EMAIL = 'e2e-talent-student@example.test'

export default async function globalSetup() {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  try {
    const hashedPw = await hashPassword(EMPLOYER_PASSWORD)

    // ---- Helper: create or update employer user + company + member ----
    async function ensureEmployer(
      email: string,
      verified: boolean,
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
        // Update account password
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
    const verifiedEmp = await ensureEmployer(VERIFIED_EMAIL, true)

    // ---- Create/update unverified employer ----
    const unverifiedEmp = await ensureEmployer(UNVERIFIED_EMAIL, false)

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

    // ---- Write fixtures ----
    const fixtures: E2EFixtures = {
      verifiedEmployer: {
        email: VERIFIED_EMAIL,
        password: EMPLOYER_PASSWORD,
        companyId: verifiedEmp.companyId,
      },
      unverifiedEmployer: {
        email: UNVERIFIED_EMAIL,
        password: EMPLOYER_PASSWORD,
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
