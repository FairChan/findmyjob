import 'server-only'
import { ApplicationStatus, Prisma } from '@prisma/client'
import { db } from '../db'
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../errors'
import { assertCompanyVerified } from '../authz'
import type { CompanyCtx } from '../authz'
import { logger } from '../lib/logger'
import { createNotification } from './notifications'
import { sendNotificationEmail } from './notify'
import { canSeeIdentityMany, canSeeIdentity } from './contact-access'
import { toTalentCard, toTalentDetail, toEmployerCoverNote } from '../serializers/talent-card'
import type { TalentCard, TalentDetail } from '../serializers/talent-card'

// Statuses the company can set (not WITHDRAWN — only student can do that)
const COMPANY_SETTABLE: Set<ApplicationStatus> = new Set([
  ApplicationStatus.VIEWED,
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
  ApplicationStatus.HIRED,
  ApplicationStatus.REJECTED,
])

// Status columns shown in kanban (all except WITHDRAWN which is student-only)
export const KANBAN_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.APPLIED,
  ApplicationStatus.VIEWED,
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
  ApplicationStatus.HIRED,
  ApplicationStatus.REJECTED,
]

export interface ApplicantRow {
  applicationId: string
  studentId: string
  status: ApplicationStatus
  coverNote: string | null
  companyNote: string | null
  createdAt: Date
  updatedAt: Date
  card: TalentCard
  graduationMonth: number | null
  languages: string[]
  internshipCount: number
  campusCount: number
}

export interface ListApplicantsResult {
  applicants: ApplicantRow[]
  jobTitle: string
}

export async function listJobApplicants(
  ctx: CompanyCtx,
  jobId: string,
): Promise<ListApplicantsResult> {
  await assertCompanyVerified(ctx.companyId)

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, title: true, companyId: true },
  })
  if (!job || job.companyId !== ctx.companyId) throw new NotFoundError('Job not found')

  const rows = await db.application.findMany({
    where: { jobId, status: { not: ApplicationStatus.WITHDRAWN } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      coverNote: true,
      companyNote: true,
      createdAt: true,
      updatedAt: true,
      student: {
        select: {
          id: true,
          fullName: true,
          headline: true,
          skills: true,
          major: true,
          degreeLevel: true,
          graduationYear: true,
          graduationMonth: true,
          cgpa: true,
          workAuth: true,
          completeness: true,
          visibility: true,
          lastActiveAt: true,
          school: { select: { id: true, nameZh: true, nameEn: true } },
          languages: { select: { language: true } },
          experiences: { select: { kind: true } },
        },
      },
    },
  })

  const studentIds = rows.map((r) => r.student.id)
  const unlockedSet = await canSeeIdentityMany(ctx.companyId, studentIds)

  const applicants: ApplicantRow[] = rows.map((r) => {
    const unlocked = unlockedSet.has(r.student.id)
    return {
      applicationId: r.id,
      studentId: r.student.id,
      status: r.status,
      coverNote: toEmployerCoverNote(r.coverNote, r.student.fullName, unlocked),
      companyNote: r.companyNote,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      card: toTalentCard(
        { ...r.student, cgpa: r.student.cgpa, lastActiveAt: r.student.lastActiveAt },
        { unlocked },
      ),
      graduationMonth: r.student.graduationMonth,
      languages: r.student.languages.map((l) => l.language),
      internshipCount: r.student.experiences.filter((e) => e.kind === 'INTERNSHIP').length,
      campusCount: r.student.experiences.filter((e) => e.kind === 'CAMPUS').length,
    }
  })

  return { applicants, jobTitle: job.title }
}

export interface ChangeStatusInput {
  applicationId: string
  toStatus: ApplicationStatus
  note?: string | null
}

export async function changeApplicationStatus(
  ctx: CompanyCtx,
  input: ChangeStatusInput,
): Promise<void> {
  await assertCompanyVerified(ctx.companyId)

  if (!COMPANY_SETTABLE.has(input.toStatus)) {
    throw new ValidationError('Invalid status transition')
  }

  const app = await db.application.findUnique({
    where: { id: input.applicationId },
    select: { id: true, status: true, jobId: true, studentId: true, job: { select: { companyId: true } } },
  })
  if (!app || app.job.companyId !== ctx.companyId) throw new NotFoundError('Application not found')

  if (app.status === ApplicationStatus.WITHDRAWN) {
    throw new ForbiddenError('Cannot change status of a withdrawn application')
  }

  const prevStatus = app.status
  if (prevStatus === input.toStatus) return

  // Student user id for notification
  const studentUser = await db.studentProfile.findUnique({
    where: { id: app.studentId },
    select: { userId: true },
  })

  await db.$transaction(async (tx) => {
    // Optimistic concurrency: only update if status has not changed since we read it.
    // This prevents WITHDRAWN from being overridden if the student withdraws concurrently.
    const result = await tx.application.updateMany({
      where: { id: app.id, status: prevStatus },
      data: { status: input.toStatus },
    })
    if (result.count !== 1) throw new ConflictError('Application status was modified concurrently')
    await tx.applicationEvent.create({
      data: {
        applicationId: app.id,
        fromStatus: prevStatus,
        toStatus: input.toStatus,
        actorId: ctx.userId,
        note: input.note ?? null,
      },
    })
  })

  if (studentUser) {
    try {
      await createNotification(db, studentUser.userId, 'application.status.changed', {
        applicationId: app.id,
        jobId: app.jobId,
        fromStatus: prevStatus,
        toStatus: input.toStatus,
        // Note: company note intentionally excluded from payload
      })
    } catch (err) {
      logger.error({ applicationId: app.id, err }, 'Failed to send status-change notification')
    }

    // Post-commit email (best-effort); no company note in email
    const jobInfo = await db.job.findUnique({ where: { id: app.jobId }, select: { title: true } })
    await sendNotificationEmail(studentUser.userId, {
      template: 'application-status',
      jobTitle: jobInfo?.title ?? '',
      toStatus: input.toStatus,
    }).catch((err) => {
      logger.error({ applicationId: app.id, err }, 'Failed to send status-change email')
    })
  }
}

export interface UpdateNoteInput {
  applicationId: string
  note: string | null
}

export async function updateApplicationNote(
  ctx: CompanyCtx,
  input: UpdateNoteInput,
): Promise<void> {
  await assertCompanyVerified(ctx.companyId)

  const app = await db.application.findUnique({
    where: { id: input.applicationId },
    select: { id: true, job: { select: { companyId: true } } },
  })
  if (!app || app.job.companyId !== ctx.companyId) throw new NotFoundError('Application not found')

  const note = input.note?.trim() || null
  if (note !== null && note.length > 2000) {
    throw new ValidationError('Note too long')
  }

  await db.application.update({
    where: { id: app.id },
    data: { companyNote: note },
  })
}

/** Mark APPLIED → VIEWED on first open. No-op if already past APPLIED. */
export async function markApplicationViewed(
  ctx: CompanyCtx,
  applicationId: string,
): Promise<void> {
  await assertCompanyVerified(ctx.companyId)

  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { id: true, status: true, studentId: true, jobId: true, job: { select: { companyId: true } } },
  })
  if (!app || app.job.companyId !== ctx.companyId) return
  if (app.status !== ApplicationStatus.APPLIED) return

  const studentUser = await db.studentProfile.findUnique({
    where: { id: app.studentId },
    select: { userId: true },
  })

  let wasUpdated = false
  await db.$transaction(async (tx) => {
    // Optimistic concurrency: only mark VIEWED if status is still APPLIED.
    // Prevents WITHDRAWN from being overridden if the student withdraws concurrently.
    const result = await tx.application.updateMany({
      where: { id: app.id, status: ApplicationStatus.APPLIED },
      data: { status: ApplicationStatus.VIEWED },
    })
    if (result.count === 0) return
    wasUpdated = true
    await tx.applicationEvent.create({
      data: {
        applicationId: app.id,
        fromStatus: ApplicationStatus.APPLIED,
        toStatus: ApplicationStatus.VIEWED,
        actorId: ctx.userId,
      },
    })
  })

  if (!wasUpdated) return

  if (studentUser) {
    try {
      await createNotification(db, studentUser.userId, 'application.status.changed', {
        applicationId: app.id,
        jobId: app.jobId,
        fromStatus: ApplicationStatus.APPLIED,
        toStatus: ApplicationStatus.VIEWED,
      })
    } catch (err) {
      logger.error({ applicationId: app.id, err }, 'Failed to send viewed notification')
    }
  }
}

export interface ApplicantDetail {
  applicationId: string
  studentId: string
  status: ApplicationStatus
  coverNote: string | null
  companyNote: string | null
  createdAt: Date
  profile: TalentDetail
}

export async function getApplicantDetail(
  ctx: CompanyCtx,
  applicationId: string,
): Promise<ApplicantDetail> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      status: true,
      coverNote: true,
      companyNote: true,
      createdAt: true,
      studentId: true,
      job: { select: { companyId: true } },
      student: {
        select: {
          id: true,
          fullName: true,
          headline: true,
          summary: true,
          skills: true,
          major: true,
          degreeLevel: true,
          graduationYear: true,
          cgpa: true,
          workAuth: true,
          completeness: true,
          visibility: true,
          lastActiveAt: true,
          school: { select: { id: true, nameZh: true, nameEn: true } },
          educations: {
            select: {
              id: true,
              schoolName: true,
              major: true,
              degreeLevel: true,
              startDate: true,
              endDate: true,
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
          resumes: {
            select: { id: true, storageKey: true, isPrimary: true },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
          },
        },
      },
    },
  })

  if (!app || app.job.companyId !== ctx.companyId) throw new NotFoundError('Application not found')

  await assertCompanyVerified(ctx.companyId)

  const unlocked = await canSeeIdentity(ctx.companyId, app.student.id)
  const profile = toTalentDetail(
    { ...app.student, cgpa: app.student.cgpa, lastActiveAt: app.student.lastActiveAt },
    { unlocked, contact: null },
  )

  return {
    applicationId: app.id,
    studentId: app.student.id,
    status: app.status,
    coverNote: toEmployerCoverNote(app.coverNote, app.student.fullName, unlocked),
    companyNote: app.companyNote,
    createdAt: app.createdAt,
    profile,
  }
}
