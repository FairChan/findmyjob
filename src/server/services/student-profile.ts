import 'server-only'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { NotFoundError } from '../errors'
import type { UserCtx } from '../authz'
import { computeCompleteness } from '../lib/completeness'
import { hasStudentContact } from './contact-access'

// ---- Enums (mirror Prisma enums for Zod) ----

const WorkAuthEnum = z.enum([
  'MY_CITIZEN',
  'MY_PR',
  'STUDENT_PASS',
  'DEPENDANT_PASS',
  'NEEDS_WORK_PASS',
  'OTHER',
])

const DegreeLevelEnum = z.enum(['FOUNDATION', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD'])
const JobTypeEnum = z.enum(['INTERNSHIP', 'FULL_TIME', 'PART_TIME'])
const LanguageLevelEnum = z.enum(['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'])
const ExperienceKindEnum = z.enum(['INTERNSHIP', 'WORK', 'PROJECT', 'CAMPUS', 'AWARD'])

// ---- Step Schemas ----

export const step1Schema = z.object({
  fullName: z.string().min(1).max(100),
  schoolId: z.string().cuid().nullable().optional(),
  degreeLevel: DegreeLevelEnum.nullable().optional(),
  major: z.string().max(100).nullable().optional(),
  graduationYear: z.number().int().min(2000).max(2040).nullable().optional(),
  graduationMonth: z.number().int().min(1).max(12).nullable().optional(),
  cgpa: z.number().min(0).max(4).nullable().optional(),
  nationality: z.string().length(2).toUpperCase().nullable().optional(),
  workAuth: WorkAuthEnum,
})

export const step2Schema = z.object({
  intents: z.array(JobTypeEnum).min(1),
  availableFrom: z.string().datetime({ offset: true }).nullable().optional(),
  preferredStates: z.array(z.string().max(10)).max(20).optional(),
  preferredIndustries: z.array(z.string().max(50)).max(20).optional(),
  expectedSalaryMin: z.number().int().nonnegative().nullable().optional(),
  expectedSalaryMax: z.number().int().nonnegative().nullable().optional(),
})

const languageEntrySchema = z.object({
  language: z.string().min(1).max(20),
  level: LanguageLevelEnum,
})

export const step3Schema = z.object({
  languages: z.array(languageEntrySchema).max(20),
  skills: z.array(z.string().min(1).max(50)).max(30),
  headline: z.string().max(100).nullable().optional(),
  summary: z.string().max(2000).nullable().optional(),
})

const educationEntrySchema = z.object({
  schoolName: z.string().min(1).max(200),
  degreeLevel: DegreeLevelEnum.nullable().optional(),
  major: z.string().max(100).nullable().optional(),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  gpa: z.string().max(20).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})

const experienceEntrySchema = z.object({
  kind: ExperienceKindEnum,
  title: z.string().min(1).max(200),
  organization: z.string().max(200).nullable().optional(),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})

export const step4Schema = z.object({
  educations: z.array(educationEntrySchema).max(20),
  experiences: z.array(experienceEntrySchema).max(50),
})

export type Step1Data = z.infer<typeof step1Schema>
export type Step2Data = z.infer<typeof step2Schema>
export type Step3Data = z.infer<typeof step3Schema>
export type Step4Data = z.infer<typeof step4Schema>

// ---- Profile read types ----

export type ProfileForOnboarding = {
  id: string
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

async function recalcCompleteness(tx: Prisma.TransactionClient, profileId: string): Promise<void> {
  const profile = await tx.studentProfile.findUnique({
    where: { id: profileId },
    select: { workAuth: true, intents: true, skills: true, headline: true, summary: true },
  })
  if (!profile) return

  const langCount = await tx.studentLanguage.count({ where: { studentId: profileId } })
  const eduCount = await tx.education.count({ where: { studentId: profileId } })
  const expCount = await tx.experience.count({ where: { studentId: profileId } })
  const resumeCount = await tx.resumeFile.count({ where: { studentId: profileId } })
  const hasContact = await hasStudentContact(profileId)

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

// ---- Service functions ----

export async function getProfileForOnboarding(ctx: UserCtx): Promise<ProfileForOnboarding | null> {
  return db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: {
      id: true,
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

export async function saveStep1(ctx: UserCtx, input: Step1Data): Promise<void> {
  await db.$transaction(async (tx) => {
    const profile = await tx.studentProfile.findUnique({
      where: { userId: ctx.userId },
      select: { id: true, onboardingStep: true },
    })
    if (!profile) throw new NotFoundError()

    await tx.studentProfile.update({
      where: { id: profile.id },
      data: {
        fullName: input.fullName,
        schoolId: input.schoolId ?? null,
        degreeLevel: input.degreeLevel ?? null,
        major: input.major ?? null,
        graduationYear: input.graduationYear ?? null,
        graduationMonth: input.graduationMonth ?? null,
        cgpa: input.cgpa != null ? new Prisma.Decimal(input.cgpa) : null,
        nationality: input.nationality ? input.nationality.toUpperCase() : null,
        workAuth: input.workAuth,
        onboardingStep: Math.max(profile.onboardingStep, 2),
        lastActiveAt: new Date(),
      },
    })

    await recalcCompleteness(tx, profile.id)
  })
}

export async function saveStep2(ctx: UserCtx, input: Step2Data): Promise<void> {
  await db.$transaction(async (tx) => {
    const profile = await tx.studentProfile.findUnique({
      where: { userId: ctx.userId },
      select: { id: true, onboardingStep: true },
    })
    if (!profile) throw new NotFoundError()

    await tx.studentProfile.update({
      where: { id: profile.id },
      data: {
        intents: input.intents,
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
        preferredStates: input.preferredStates ?? [],
        preferredIndustries: input.preferredIndustries ?? [],
        expectedSalaryMin: input.expectedSalaryMin ?? null,
        expectedSalaryMax: input.expectedSalaryMax ?? null,
        onboardingStep: Math.max(profile.onboardingStep, 3),
        lastActiveAt: new Date(),
      },
    })

    await recalcCompleteness(tx, profile.id)
  })
}

export async function saveStep3(ctx: UserCtx, input: Step3Data): Promise<void> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true, onboardingStep: true },
  })
  if (!profile) throw new NotFoundError()

  await db.$transaction(async (tx) => {
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
        headline: input.headline ?? null,
        summary: input.summary ?? null,
        onboardingStep: Math.max(profile.onboardingStep, 4),
        lastActiveAt: new Date(),
      },
    })

    await recalcCompleteness(tx, profile.id)
  })
}

export async function saveStep4(ctx: UserCtx, input: Step4Data): Promise<void> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })
  if (!profile) throw new NotFoundError()

  await db.$transaction(async (tx) => {
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
        onboardingStep: 5,
        lastActiveAt: new Date(),
      },
    })

    await recalcCompleteness(tx, profile.id)
  })
}
