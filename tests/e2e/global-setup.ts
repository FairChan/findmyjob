/**
 * Playwright global setup: creates E2E fixture accounts in the test database.
 * Writes credentials to tests/e2e/fixtures.json (gitignored).
 *
 * SAFETY: only writes to TEST_DATABASE_URL. Validates that the URL points to
 * a *_test database on localhost (same rules as tests/setup/db.ts).
 */
import { createE2eDb } from './helpers/db'
import { writeCurrentVersionConsent } from './helpers/consent'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, scrypt } from 'node:crypto'
import { LedgerReason } from '@prisma/client'
import { loadEnvConfig } from '@next/env'
import { encryptWithKeyring } from '../../src/server/lib/crypto-core'
import { PDFDocument } from 'pdf-lib'

// Load env vars using same file priority as Next.js dev server:
// .env.development.local → .env.local → .env.development → .env
// This ensures E2E-side PII_KEYS match what Next.js uses to decrypt.
// Store combinedEnv to access S3 creds — loadEnvConfig skips vars already in process.env,
// so we use combinedEnv for S3 to avoid picking up stale system-level env vars.
const { combinedEnv: loadedEnv } = loadEnvConfig(process.cwd())

// Suppress env.ts validation — global-setup is not a Next.js runtime context.
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
  unlockedStudent: { profileId: string; resumeId: string; phone: string }
  folder: { folderId: string }
  m4t12Student: { email: string; password: string; profileId: string }
}

const VERIFIED_EMAIL = 'e2e-verified-employer@example.test'
const UNVERIFIED_EMAIL = 'e2e-unverified-employer@example.test'
const STUDENT_EMAIL = 'e2e-talent-student@example.test'
const UNLOCKED_STUDENT_EMAIL = 'e2e-talent-student-unlocked@example.test'
const M4T12_STUDENT_EMAIL = 'e2e-m4t12-student@example.test'

// Known phone for unlocked student — asserted visible in m4-t18-smoke.spec.ts
const UNLOCKED_STUDENT_PHONE = '+60115550001'

export default async function globalSetup() {
  // 与 helpers/db.ts 同一个工厂：库名必须以 _test 结尾、主机必须是本机，APP_ENV=production/staging 直接拒绝
  const prisma = createE2eDb()

  // Generate random passwords each run; stored in fixtures.json read by auth.setup.ts
  const verifiedPassword = randomBytes(16).toString('base64url') + 'Aa1!'
  const unverifiedPassword = randomBytes(16).toString('base64url') + 'Aa1!'
  const m4t12StudentPassword = randomBytes(16).toString('base64url') + 'Aa1!'
  const verifiedHashedPw = await hashPassword(verifiedPassword)
  const unverifiedHashedPw = await hashPassword(unverifiedPassword)
  const m4t12StudentHashedPw = await hashPassword(m4t12StudentPassword)

  try {
    // 不按邮箱删用户和企业：CreditLedger 对钱包是 Restrict，findmyjob_app 不能删账本行，一旦有账本行第二次运行就会抛错（M4-T16 第 6 条）。
    // 线 B 当初加删除清理是误诊：真正原因是 vitest 在后台跑的同时启动了 E2E，TRUNCATE 清掉了刚建的行。下面全部用幂等写法。

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

      // Guard: member might reference a deleted company (orphaned row). Discard it.
      if (member) {
        const companyExists = await prisma.company.findUnique({ where: { id: member.companyId } })
        if (!companyExists) {
          await prisma.companyMember.deleteMany({ where: { userId: user.id } })
          member = null
        }
      }

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
    await writeCurrentVersionConsent(verifiedEmp.userId)

    // ---- Create/update unverified employer ----
    const unverifiedEmp = await ensureEmployer(UNVERIFIED_EMAIL, false, unverifiedHashedPw)
    await writeCurrentVersionConsent(unverifiedEmp.userId)

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

    await writeCurrentVersionConsent(studentUser.id)

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
    // Use proper ledger entries to maintain reconciliation (balance = sum of all deltas)
    const TARGET_BALANCE = 100
    let wallet = await prisma.creditWallet.findUnique({
      where: { companyId: verifiedEmp.companyId },
      select: { id: true, balance: true },
    })
    if (!wallet) {
      const created = await prisma.creditWallet.create({
        data: { companyId: verifiedEmp.companyId, balance: 0 },
        select: { id: true, balance: true },
      })
      wallet = created
    }
    if (wallet.balance !== TARGET_BALANCE) {
      const delta = TARGET_BALANCE - wallet.balance
      await prisma.creditLedger.create({
        data: {
          walletId: wallet.id,
          delta,
          balanceAfter: TARGET_BALANCE,
          reason: LedgerReason.ADMIN_ADJUST,
        },
      })
      await prisma.creditWallet.update({
        where: { id: wallet.id },
        data: { balance: TARGET_BALANCE },
      })
    }
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

    // ---- Create/update unlocked student with a resume (M4-T09: download watermark smoke test) ----
    let unlockedStudentUser = await prisma.user.findUnique({ where: { email: UNLOCKED_STUDENT_EMAIL } })
    if (!unlockedStudentUser) {
      unlockedStudentUser = await prisma.user.create({
        data: {
          name: 'E2E Unlocked Student',
          email: UNLOCKED_STUDENT_EMAIL,
          emailVerified: true,
          role: 'STUDENT',
          status: 'ACTIVE',
        },
      })
    }

    await writeCurrentVersionConsent(unlockedStudentUser.id)

    let unlockedProfile = await prisma.studentProfile.findUnique({ where: { userId: unlockedStudentUser.id } })
    if (!unlockedProfile) {
      unlockedProfile = await prisma.studentProfile.create({
        data: {
          userId: unlockedStudentUser.id,
          fullName: 'E2E Unlocked Student',
          visibility: 'PUBLIC',
          completeness: 85,
          schoolId: school?.id ?? null,
          schoolVerifiedAt: new Date(),
          major: 'Computer Science',
          degreeLevel: 'BACHELOR',
          graduationYear: 2025,
          skills: ['Python'],
          workAuth: 'STUDENT_PASS',
          intents: ['INTERNSHIP'],
          lastActiveAt: new Date(),
        },
      })
    } else {
      unlockedProfile = await prisma.studentProfile.update({
        where: { id: unlockedProfile.id },
        data: { visibility: 'PUBLIC', completeness: 85, schoolVerifiedAt: new Date() },
      })
    }

    // Create or reuse a resume file for the unlocked student, and upload a real PDF
    // to MinIO so the download route can actually sanitize and watermark it.
    // Use S3Client directly — storage.ts has 'server-only' and cannot be imported here.
    // Use loadedEnv (combinedEnv from loadEnvConfig) instead of process.env — loadEnvConfig
    // does not override pre-existing process.env values, so loadedEnv has the definitive creds.
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
    const s3 = new S3Client({
      endpoint: loadedEnv.S3_ENDPOINT,
      region: loadedEnv.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: loadedEnv.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: loadedEnv.S3_SECRET_ACCESS_KEY ?? '',
      },
      forcePathStyle: true,
    })
    const putObject = async (key: string, body: Buffer, contentType: string) => {
      await s3.send(new PutObjectCommand({
        Bucket: loadedEnv.S3_BUCKET ?? 'findmyjob-files',
        Key: key,
        Body: body,
        ContentType: contentType,
      }))
    }

    let unlockedResume = await prisma.resumeFile.findFirst({
      where: { studentId: unlockedProfile.id },
    })
    const minimalPdfDoc = await PDFDocument.create()
    minimalPdfDoc.addPage([612, 792])
    const minimalPdfBytes = Buffer.from(await minimalPdfDoc.save())
    const resumeStorageKey = `resumes/e2e-unlocked/${unlockedProfile.id}/cv.pdf`

    // Upload the real PDF to MinIO (idempotent — overwrites each run)
    await putObject(resumeStorageKey, minimalPdfBytes, 'application/pdf')

    if (!unlockedResume) {
      unlockedResume = await prisma.resumeFile.create({
        data: {
          studentId: unlockedProfile.id,
          storageKey: resumeStorageKey,
          fileName: 'cv.pdf',
          mimeType: 'application/pdf',
          sizeBytes: minimalPdfBytes.length,
          isPrimary: true,
        },
      })
    } else {
      unlockedResume = await prisma.resumeFile.update({
        where: { id: unlockedResume.id },
        data: { sizeBytes: minimalPdfBytes.length, storageKey: resumeStorageKey },
      })
    }

    // Write encrypted phone for unlocked student so the detail page can show contact info.
    // Uses the same key as Next.js dev server (loaded via loadEnvConfig above).
    const piiKeys = process.env.PII_KEYS
    if (piiKeys) {
      const activeKeyId = process.env.PII_ACTIVE_KEY_ID ?? 'v1'
      const encPhone = encryptWithKeyring(
        UNLOCKED_STUDENT_PHONE,
        `StudentContact.phone:${unlockedProfile.id}`,
        piiKeys,
        activeKeyId,
      )
      await prisma.studentContact.upsert({
        where: { studentId: unlockedProfile.id },
        create: { studentId: unlockedProfile.id, phone: encPhone },
        update: { phone: encPhone },
      })
    }

    // Create TalentUnlock so the detail page shows the download link
    await prisma.talentUnlock.upsert({
      where: {
        companyId_studentId: {
          companyId: verifiedEmp.companyId,
          studentId: unlockedProfile.id,
        },
      },
      create: {
        companyId: verifiedEmp.companyId,
        studentId: unlockedProfile.id,
        unlockedById: verifiedEmp.userId,
        source: 'CREDIT',
        creditsSpent: 0,
      },
      update: {},
    })

    // ---- Create/update M4-T12 student with credentials (notification flow test) ----
    let m4t12StudentUser = await prisma.user.findUnique({ where: { email: M4T12_STUDENT_EMAIL } })
    if (!m4t12StudentUser) {
      m4t12StudentUser = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            name: 'E2E M4T12 Student',
            email: M4T12_STUDENT_EMAIL,
            emailVerified: true,
            role: 'STUDENT',
            status: 'ACTIVE',
          },
        })
        await tx.account.create({
          data: {
            userId: u.id,
            accountId: u.id,
            providerId: 'credential',
            password: m4t12StudentHashedPw,
          },
        })
        return u
      })
    } else {
      m4t12StudentUser = await prisma.user.update({
        where: { id: m4t12StudentUser.id },
        data: { emailVerified: true, role: 'STUDENT', status: 'ACTIVE' },
      })
      await prisma.account.updateMany({
        where: { userId: m4t12StudentUser.id, providerId: 'credential' },
        data: { password: m4t12StudentHashedPw },
      })
    }

    await writeCurrentVersionConsent(m4t12StudentUser.id)

    let m4t12Profile = await prisma.studentProfile.findUnique({ where: { userId: m4t12StudentUser.id } })
    if (!m4t12Profile) {
      m4t12Profile = await prisma.studentProfile.create({
        data: {
          userId: m4t12StudentUser.id,
          fullName: 'E2E M4T12 Student',
          visibility: 'PUBLIC',
          completeness: 80,
          schoolId: school?.id ?? null,
          schoolVerifiedAt: new Date(),
          major: 'Computer Science',
          degreeLevel: 'BACHELOR',
          graduationYear: 2026,
          skills: ['Java'],
          workAuth: 'STUDENT_PASS',
          intents: ['INTERNSHIP'],
          lastActiveAt: new Date(),
        },
      })
    }

    // M4-T21: Do NOT pre-seed TalentUnlock or Notification for m4t12 student.
    // The E2E test performs the real unlock flow: employer clicks unlock → student sees notification.
    // Clear any stale notifications from previous runs so each run starts fresh.
    await prisma.notification.deleteMany({
      where: { userId: m4t12StudentUser.id, type: 'talent.unlock' },
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
      unlockedStudent: { profileId: unlockedProfile.id, resumeId: unlockedResume.id, phone: UNLOCKED_STUDENT_PHONE },
      folder: { folderId: folder.id },
      m4t12Student: {
        email: M4T12_STUDENT_EMAIL,
        password: m4t12StudentPassword,
        profileId: m4t12Profile.id,
      },
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
