/**
 * Test-only endpoint that creates fixtures for the E2E talent-search tests.
 * Returns 404 in production and staging.
 */
import { randomBytes, scrypt } from 'node:crypto'
import { env } from '@/env'
import { db } from '@/server/db'

const TEST_EMPLOYER_EMAIL = 'e2e-employer@example.test'
const TEST_EMPLOYER_PASSWORD = 'TestPass123!'
const TEST_EMPLOYER_NAME = 'E2E Test Employer'
const TEST_STUDENT_EMAIL = 'e2e-student@example.test'
const TEST_STUDENT_NAME = 'E2E Test Student'

// Replicates @better-auth/utils/dist/password.node.cjs hash format: "salt_hex:hash_hex"
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (err, key) => {
        if (err) reject(err)
        else resolve(key as Buffer)
      },
    )
  })
  return `${salt}:${hash.toString('hex')}`
}

export async function POST() {
  if (env.APP_ENV === 'production' || env.APP_ENV === 'staging') {
    return new Response(null, { status: 404 })
  }

  // ---- Employer user ----
  let employer = await db.user.findUnique({ where: { email: TEST_EMPLOYER_EMAIL } })

  if (!employer) {
    const hashedPw = await hashPassword(TEST_EMPLOYER_PASSWORD)

    employer = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          name: TEST_EMPLOYER_NAME,
          email: TEST_EMPLOYER_EMAIL,
          emailVerified: true,
          role: 'EMPLOYER',
          status: 'ACTIVE',
        },
      })
      // Create credential account so the user can log in
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
    // Ensure employer is active and verified
    employer = await db.user.update({
      where: { id: employer.id },
      data: { emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
  }

  // ---- Company ----
  let member = await db.companyMember.findFirst({
    where: { userId: employer.id },
    include: { company: true },
  })

  if (!member) {
    const company = await db.company.create({
      data: {
        legalName: 'E2E Test Company Sdn Bhd',
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        isActive: true,
      },
    })
    member = await db.companyMember.create({
      data: { userId: employer.id, companyId: company.id, role: 'OWNER' },
      include: { company: true },
    })
  } else if (member.company.verificationStatus !== 'VERIFIED' || !member.company.isActive) {
    await db.company.update({
      where: { id: member.companyId },
      data: { verificationStatus: 'VERIFIED', verifiedAt: new Date(), isActive: true },
    })
  }

  // ---- Student ----
  let studentUser = await db.user.findUnique({ where: { email: TEST_STUDENT_EMAIL } })

  if (!studentUser) {
    studentUser = await db.user.create({
      data: {
        name: TEST_STUDENT_NAME,
        email: TEST_STUDENT_EMAIL,
        emailVerified: true,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
  }

  // Find a school for the student
  const school = await db.school.findFirst({ where: { active: true } })

  let studentProfile = await db.studentProfile.findUnique({ where: { userId: studentUser.id } })

  if (!studentProfile) {
    studentProfile = await db.studentProfile.create({
      data: {
        userId: studentUser.id,
        fullName: TEST_STUDENT_NAME,
        visibility: 'PUBLIC',
        completeness: 85,
        schoolId: school?.id ?? null,
        schoolVerifiedAt: new Date(),
        major: 'Computer Science',
        degreeLevel: 'BACHELOR',
        graduationYear: 2025,
        skills: ['Python', 'React', 'TypeScript'],
        workAuth: 'STUDENT_PASS',
        headline: 'Full-stack developer with 2 years Python experience',
        intents: ['INTERNSHIP', 'FULL_TIME'],
        lastActiveAt: new Date(),
      },
    })
  } else {
    studentProfile = await db.studentProfile.update({
      where: { id: studentProfile.id },
      data: {
        visibility: 'PUBLIC',
        completeness: 85,
        schoolId: studentProfile.schoolId ?? school?.id ?? null,
        schoolVerifiedAt: studentProfile.schoolVerifiedAt ?? new Date(),
        major: 'Computer Science',
        degreeLevel: 'BACHELOR',
        graduationYear: 2025,
        skills: ['Python', 'React', 'TypeScript'],
        workAuth: 'STUDENT_PASS',
        intents: ['INTERNSHIP', 'FULL_TIME'],
        lastActiveAt: new Date(),
      },
    })
  }

  return Response.json(
    {
      employerEmail: TEST_EMPLOYER_EMAIL,
      employerPassword: TEST_EMPLOYER_PASSWORD,
      companyId: member.companyId,
      studentProfileId: studentProfile.id,
      studentName: TEST_STUDENT_NAME,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
