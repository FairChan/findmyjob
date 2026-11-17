import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import type { UserCtx } from '../authz'
import { computeCompleteness } from '../lib/completeness'
import { hasStudentContact, hasStudentContactTx } from './contact-access'
import { qualifyReferral } from './referrals'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { logger } from '../lib/logger'
import { invalidateStudentMatchingIndexTx } from './semantic-matching'
import { requireApplicationMaterialsTx } from './application-materials'
// 建档四节的请求 schema 已挪到 src/shared/mobile-api/profile-inputs.ts（Web 与 App 共用，MA1-T08），这里 re-export 保持原有引用不变
export { step1Schema, step2Schema, step3Schema, step4Schema } from '@/shared/mobile-api/profile-inputs'
export type { Step1Data, Step2Data, Step3Data, Step4Data } from '@/shared/mobile-api/profile-inputs'
import type { Step1Data, Step2Data, Step3Data, Step4Data } from '@/shared/mobile-api/profile-inputs'

// ---- Profile read types ----

export type ProfileForOnboarding = {
  id: string
  editRevision: number
  fullName: string
  schoolId: string | null
  degreeLevel: string | null
  major: string | null
  graduationYear: number | null
  graduationMonth: number | null
  cgpa: Prisma.Decimal | null
  nationality: string | null
  workAuth: string | null
  intents: string[]
  availableFrom: Date | null
  preferredStates: string[]
  preferredIndustries: string[]
  expectedSalaryMin: number | null
  expectedSalaryMax: number | null
  skills: string[]
  headline: string | null
  summary: string | null
  onboardingStep: number
  languages: { language: string; level: string }[]
  educations: {
    id: string
    schoolName: string
    degreeLevel: string | null
    major: string | null
    startDate: Date | null
    endDate: Date | null
    gpa: string | null
    description: string | null
    sortOrder: number
  }[]
  experiences: {
    id: string
    kind: string
    title: string
    organization: string | null
    startDate: Date | null
    endDate: Date | null
    description: string | null
    sortOrder: number
  }[]
}

// ---- Completeness helpers ----

export async function recalcCompletenessTx(tx: Prisma.TransactionClient, profileId: string): Promise<void> {
  const profile = await tx.studentProfile.findUnique({
    where: { id: profileId },
    select: { workAuth: true, intents: true, skills: true, headline: true, summary: true },
  })
  if (!profile) return

  const langCount = await tx.studentLanguage.count({ where: { studentId: profileId } })
  const eduCount = await tx.education.count({ where: { studentId: profileId } })
  const expCount = await tx.experience.count({ where: { studentId: profileId } })
  const resumeCount = await tx.resumeFile.count({ where: { studentId: profileId } })

  const hasContact = await hasStudentContactTx(tx, profileId)

  const completeness = computeCompleteness({
    workAuth: profile.workAuth,
    intents: profile.intents,
    languages: Array(langCount).fill(null),
    skills: profile.skills,
    headline: profile.headline,
    summary: profile.summary,
    educations: Array(eduCount).fill(null),
    experiences: Array(expCount).fill(null),
    resumes: Array(resumeCount).fill(null),
    hasContact,
  })

  await tx.studentProfile.update({
    where: { id: profileId },
    data: { completeness },
  })
}

/** Caller holds STUDENT_DATA. Standalone eligibility changes own one revision; the pure recalc does not. */
export async function recalcMatchingEligibilityTx(tx: Prisma.TransactionClient, profileId: string): Promise<void> {
  const before = await tx.studentProfile.findUnique({ where: { id: profileId }, select: { userId: true, completeness: true } })
  if (!before) return
  await recalcCompletenessTx(tx, profileId)
  const after = await tx.studentProfile.findUnique({ where: { id: profileId }, select: { completeness: true } })
  if (after && after.completeness !== before.completeness) {
    await tx.studentProfile.update({ where: { id: profileId }, data: { editRevision: { increment: 1 } } })
    await invalidateStudentMatchingIndexTx(tx, before.userId)
  }
}

/** Recalculate and persist completeness for the calling student under the lifecycle lock. */
export async function recalcOwnCompleteness(ctx: UserCtx): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockActiveStudentTx(tx, ctx.userId)
    const profile = await tx.studentProfile.findUnique({ where: { userId: ctx.userId }, select: { id: true } })
    if (profile) await recalcMatchingEligibilityTx(tx, profile.id)
  })
}

async function lockActiveStudentTx(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await lockXact(tx, LOCK_NS.STUDENT_DATA, userId)
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true } })
  if (!user || user.role !== 'STUDENT' || user.status !== 'ACTIVE') throw new ForbiddenError()
}

async function qualifySavedProfile(profileId: string): Promise<void> {
  try { await qualifyReferral(profileId) }
  catch { logger.error({ studentId: profileId, code: 'REFERRAL_RECALC_REQUIRED' }, 'Profile saved; referral qualification requires recovery') }
}

// ---- Dashboard ----

export type DashboardData = {
  completeness: number
  schoolVerifiedAt: Date | null
  hasResume: boolean
  hasContact: boolean
  talentPoolEnabled: boolean
}

export async function getDashboardData(ctx: UserCtx): Promise<DashboardData | null> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: {
      id: true,
      completeness: true,
      schoolVerifiedAt: true,
      visibility: true,
      _count: { select: { resumes: true } },
    },
  })
  if (!profile) return null

  const contactExists = await hasStudentContact(profile.id)

  return {
    completeness: profile.completeness,
    schoolVerifiedAt: profile.schoolVerifiedAt,
    hasResume: profile._count.resumes > 0,
    hasContact: contactExists,
    talentPoolEnabled: profile.visibility === 'PUBLIC',
  }
}

// ---- Service functions ----

export async function getProfileForOnboarding(ctx: UserCtx): Promise<ProfileForOnboarding | null> {
  return db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: {
      id: true,
      editRevision: true,
      fullName: true,
      schoolId: true,
      degreeLevel: true,
      major: true,
      graduationYear: true,
      graduationMonth: true,
      cgpa: true,
      nationality: true,
      workAuth: true,
      intents: true,
      availableFrom: true,
      preferredStates: true,
      preferredIndustries: true,
      expectedSalaryMin: true,
      expectedSalaryMax: true,
      skills: true,
      headline: true,
      summary: true,
      onboardingStep: true,
      languages: { select: { language: true, level: true } },
      educations: {
        select: {
          id: true,
          schoolName: true,
          degreeLevel: true,
          major: true,
          startDate: true,
          endDate: true,
          gpa: true,
          description: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
      experiences: {
        select: {
          id: true,
          kind: true,
          title: true,
          organization: true,
          startDate: true,
          endDate: true,
          description: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
}

export async function saveStep1(ctx: UserCtx, input: Step1Data, options?: { advance?: boolean }): Promise<void> {
  const advance = options?.advance ?? true
  let profileId: string | undefined
  await db.$transaction(async (tx) => {
    await lockActiveStudentTx(tx, ctx.userId)
    const profile = await tx.studentProfile.findUnique({
      where: { userId: ctx.userId },
      select: { id: true, onboardingStep: true, schoolId: true, schoolVerifiedAt: true },
    })
    if (!profile) throw new NotFoundError()
    profileId = profile.id

    if (input.schoolId) {
      const school = await tx.school.findFirst({ where: { id: input.schoolId, active: true }, select: { id: true } })
      if (!school) throw new ValidationError('School not found or not active')
    }

    // If school changes, clear verification so the student must re-verify the new school email
    const newSchoolId = input.schoolId ?? null
    const schoolChanged = profile.schoolVerifiedAt !== null && newSchoolId !== profile.schoolId

    await tx.studentProfile.update({
      where: { id: profile.id },
      data: {
        fullName: input.fullName,
        editRevision: { increment: 1 },
        schoolId: newSchoolId,
        degreeLevel: input.degreeLevel ?? null,
        major: input.major ?? null,
        graduationYear: input.graduationYear ?? null,
        graduationMonth: input.graduationMonth ?? null,
        cgpa: input.cgpa != null ? new Prisma.Decimal(input.cgpa) : null,
        nationality: input.nationality ? input.nationality.toUpperCase() : null,
        workAuth: input.workAuth,
        ...(advance ? { onboardingStep: Math.max(profile.onboardingStep, 2) } : {}),
        ...(schoolChanged ? { schoolVerifiedAt: null, schoolEmail: null } : {}),
        lastActiveAt: new Date(),
      },
    })

    await recalcCompletenessTx(tx, profile.id)
    await invalidateStudentMatchingIndexTx(tx, ctx.userId)
  })
  if (profileId) await qualifySavedProfile(profileId)
}

export async function saveStep2(ctx: UserCtx, input: Step2Data, options?: { advance?: boolean }): Promise<void> {
  const advance = options?.advance ?? true
  let profileId: string | undefined
  await db.$transaction(async (tx) => {
    await lockActiveStudentTx(tx, ctx.userId)
    const profile = await tx.studentProfile.findUnique({
      where: { userId: ctx.userId },
      select: { id: true, onboardingStep: true },
    })
    if (!profile) throw new NotFoundError()
    profileId = profile.id

    await tx.studentProfile.update({
      where: { id: profile.id },
      data: {
        intents: input.intents,
        editRevision: { increment: 1 },
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
        preferredStates: input.preferredStates ?? [],
        preferredIndustries: input.preferredIndustries ?? [],
        expectedSalaryMin: input.expectedSalaryMin ?? null,
        expectedSalaryMax: input.expectedSalaryMax ?? null,
        ...(advance ? { onboardingStep: Math.max(profile.onboardingStep, 3) } : {}),
        lastActiveAt: new Date(),
      },
    })

    await recalcCompletenessTx(tx, profile.id)
    await invalidateStudentMatchingIndexTx(tx, ctx.userId)
  })
  if (profileId) await qualifySavedProfile(profileId)
}

export async function saveStep3(ctx: UserCtx, input: Step3Data, options?: { advance?: boolean }): Promise<void> {
  const advance = options?.advance ?? true
  let profileId: string | undefined
  await db.$transaction(async (tx) => {
    await lockActiveStudentTx(tx, ctx.userId)
    const profile = await tx.studentProfile.findUnique({
      where: { userId: ctx.userId }, select: { id: true, onboardingStep: true },
    })
    if (!profile) throw new NotFoundError()
    profileId = profile.id
    await tx.studentLanguage.deleteMany({ where: { studentId: profile.id } })

    if (input.languages.length > 0) {
      await tx.studentLanguage.createMany({
        data: input.languages.map((l) => ({
          studentId: profile.id,
          language: l.language,
          level: l.level,
        })),
        skipDuplicates: true,
      })
    }

    await tx.studentProfile.update({
      where: { id: profile.id },
      data: {
        skills: input.skills,
        editRevision: { increment: 1 },
        headline: input.headline ?? null,
        summary: input.summary ?? null,
        ...(advance ? { onboardingStep: Math.max(profile.onboardingStep, 4) } : {}),
        lastActiveAt: new Date(),
      },
    })

    await recalcCompletenessTx(tx, profile.id)
    await invalidateStudentMatchingIndexTx(tx, ctx.userId)
  })
  if (profileId) await qualifySavedProfile(profileId)
}

export async function saveStep4(ctx: UserCtx, input: Step4Data, options?: { advance?: boolean }): Promise<void> {
  const advance = options?.advance ?? true
  let profileId: string | undefined
  await db.$transaction(async (tx) => {
    await lockActiveStudentTx(tx, ctx.userId)
    const profile = await tx.studentProfile.findUnique({
      where: { userId: ctx.userId }, select: { id: true, onboardingStep: true },
    })
    if (!profile) throw new NotFoundError()
    profileId = profile.id
    await tx.education.deleteMany({ where: { studentId: profile.id } })
    await tx.experience.deleteMany({ where: { studentId: profile.id } })

    if (input.educations.length > 0) {
      await tx.education.createMany({
        data: input.educations.map((e, i) => ({
          studentId: profile.id,
          schoolName: e.schoolName,
          degreeLevel: e.degreeLevel ?? null,
          major: e.major ?? null,
          startDate: e.startDate ? new Date(e.startDate) : null,
          endDate: e.endDate ? new Date(e.endDate) : null,
          gpa: e.gpa ?? null,
          description: e.description ?? null,
          sortOrder: e.sortOrder ?? i,
        })),
      })
    }

    if (input.experiences.length > 0) {
      await tx.experience.createMany({
        data: input.experiences.map((e, i) => ({
          studentId: profile.id,
          kind: e.kind,
          title: e.title,
          organization: e.organization ?? null,
          startDate: e.startDate ? new Date(e.startDate) : null,
          endDate: e.endDate ? new Date(e.endDate) : null,
          description: e.description ?? null,
          sortOrder: e.sortOrder ?? i,
        })),
      })
    }

    await tx.studentProfile.update({
      where: { id: profile.id },
      data: {
        ...(advance ? { onboardingStep: Math.max(profile.onboardingStep, 5) } : {}),
        editRevision: { increment: 1 },
        lastActiveAt: new Date(),
      },
    })

    await recalcCompletenessTx(tx, profile.id)
    await invalidateStudentMatchingIndexTx(tx, ctx.userId)
  })
  if (profileId) await qualifySavedProfile(profileId)
}

/** Step 5 completes only once both contact and an owned PDF resume are saved. */
export async function completeOnboarding(ctx: UserCtx): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockActiveStudentTx(tx, ctx.userId)
    const profile = await tx.studentProfile.findUnique({
      where: { userId: ctx.userId }, select: { id: true, onboardingStep: true },
    })
    if (!profile) throw new NotFoundError()
    if (profile.onboardingStep < 5) throw new ValidationError('Complete the profile steps first')
    await requireApplicationMaterialsTx(tx, profile.id)
    await tx.studentProfile.update({
      where: { id: profile.id }, data: { onboardingStep: 6, lastActiveAt: new Date() },
    })
  })
}
