import 'server-only'
import { ApplicationStatus, UnlockSource, Prisma } from '@prisma/client'
import { db } from '../db'
import { NotFoundError, ForbiddenError, DuplicateApplicationError, CompletenessLowError } from '../errors'
import type { UserCtx } from '../authz'
import { logger } from '../lib/logger'
import { getSetting } from './settings'
import { createNotification } from './notifications'
import { canApplyToJob } from './job-view-quota'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { requireApplicationMaterialsTx } from './application-materials'

async function getStudentProfileId(userId: string): Promise<string> {
  const profile = await db.studentProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (!profile) throw new ForbiddenError('Student profile not found')
  return profile.id
}

export interface ApplyInput {
  jobId: string
  /** Defaults to the student's primary/latest resume; an owned resume is required. */
  resumeId?: string | null
  coverNote?: string | null
}

export interface ApplyResult {
  applicationId: string
}

/**
 * Apply to a job. Creates Application + TalentUnlock(source=APPLICATION) in one transaction.
 * Throws CompletenessLowError if profile completeness is below the configured minimum.
 * Requires saved contact details and an owned resume, checked under STUDENT_DATA.
 * Throws DuplicateApplicationError if already applied.
 */
export async function applyToJob(ctx: UserCtx, input: ApplyInput): Promise<ApplyResult> {
  const studentId = await getStudentProfileId(ctx.userId)

  const minCompleteness = await getSetting<number>('apply.minCompleteness', 60)

  const profile = await db.studentProfile.findUnique({
    where: { id: studentId },
    select: { completeness: true, onboardingStep: true },
  })
  if (!profile) throw new ForbiddenError('Student profile not found')

  if (profile.completeness < minCompleteness) {
    throw new CompletenessLowError()
  }

  const now = new Date()
  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: {
      id: true, status: true, deadline: true, companyId: true, createdById: true, title: true,
      company: { select: { isActive: true } },
    },
  })
  if (
    !job ||
    job.status !== 'PUBLISHED' ||
    (job.deadline !== null && job.deadline <= now) ||
    !job.company.isActive
  ) {
    throw new NotFoundError('Job not found or not accepting applications')
  }

  // Prevent quota bypass: student must have viewed the job (or have an invitation, or unlimited quota)
  // before applying. Same error code as "job not found" to avoid leaking existence.
  const allowed = await canApplyToJob(studentId, input.jobId)
  if (!allowed) {
    throw new NotFoundError('Job not found or not accepting applications')
  }

  const coverNote = input.coverNote?.trim() ?? null

  let applicationId: string
  try {
    const result = await db.$transaction(async (tx) => {
      await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
      const resumeId = await requireApplicationMaterialsTx(tx, studentId, input.resumeId)
      const app = await tx.application.create({
        data: {
          jobId: input.jobId,
          studentId,
          resumeId,
          coverNote,
          status: ApplicationStatus.APPLIED,
        },
        select: { id: true },
      })

      // Create TalentUnlock(source=APPLICATION) if none exists — the unique constraint on
      // (companyId, studentId) prevents duplicates; skipDuplicates handles the race.
      await tx.talentUnlock.createMany({
        data: [
          {
            companyId: job.companyId,
            studentId,
            unlockedById: ctx.userId,
            source: UnlockSource.APPLICATION,
            creditsSpent: 0,
          },
        ],
        skipDuplicates: true,
      })

      await tx.applicationEvent.create({
        data: {
          applicationId: app.id,
          toStatus: ApplicationStatus.APPLIED,
          actorId: ctx.userId,
        },
      })

      return app
    })
    applicationId = result.id
  } catch (err) {
    // P2002 = unique constraint violation on (jobId, studentId)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateApplicationError()
    }
    throw err
  }

  // Notify job creator post-commit; failure must not roll back the already-committed application
  if (job.createdById) {
    const creator = await db.user.findUnique({
      where: { id: job.createdById },
      select: { id: true },
    })
    if (creator) {
      try {
        await createNotification(db, creator.id, 'job.application.new', {
          applicationId,
          jobId: job.id,
          jobTitle: job.title,
          studentId,
        })
      } catch (err) {
        logger.error({ applicationId, err }, 'Failed to send new-application notification')
      }
    }
  }

  return { applicationId }
}

export interface WithdrawInput {
  applicationId: string
}

/**
 * Withdraw an application. Only the student who applied can withdraw.
 * Sets status to WITHDRAWN and writes an ApplicationEvent.
 */
export async function withdrawApplication(ctx: UserCtx, input: WithdrawInput): Promise<void> {
  const studentId = await getStudentProfileId(ctx.userId)

  const app = await db.application.findUnique({
    where: { id: input.applicationId },
    select: { id: true, studentId: true, status: true },
  })

  if (!app || app.studentId !== studentId) {
    throw new NotFoundError('Application not found')
  }

  if (app.status === ApplicationStatus.WITHDRAWN) {
    return
  }

  const prevStatus = app.status

  await db.$transaction(async (tx) => {
    await tx.application.update({
      where: { id: app.id },
      data: { status: ApplicationStatus.WITHDRAWN },
    })
    await tx.applicationEvent.create({
      data: {
        applicationId: app.id,
        fromStatus: prevStatus,
        toStatus: ApplicationStatus.WITHDRAWN,
        actorId: ctx.userId,
      },
    })
  })
}

/**
 * Get student's application for a specific job, or null.
 * Used by the job detail page to show apply/applied state.
 */
export async function getMyApplicationForJob(
  ctx: UserCtx,
  jobId: string,
): Promise<{ id: string; status: ApplicationStatus } | null> {
  const studentId = await getStudentProfileId(ctx.userId)
  return db.application.findUnique({
    where: { jobId_studentId: { jobId, studentId } },
    select: { id: true, status: true },
  })
}

export interface StudentApplicationEvent {
  id: string
  fromStatus: ApplicationStatus | null
  toStatus: ApplicationStatus
  createdAt: Date
}

export interface StudentApplicationSummary {
  id: string
  status: ApplicationStatus
  coverNote: string | null
  createdAt: Date
  job: {
    id: string
    title: string
    companyName: string
  }
  events: StudentApplicationEvent[]
}

/**
 * Returns all applications for the calling student, newest first.
 * Company internal notes are intentionally excluded from each event.
 */
export async function listStudentApplications(ctx: UserCtx): Promise<StudentApplicationSummary[]> {
  const studentId = await getStudentProfileId(ctx.userId)

  const rows = await db.application.findMany({
    where: { studentId },
    select: {
      id: true,
      status: true,
      coverNote: true,
      createdAt: true,
      job: {
        select: {
          id: true,
          title: true,
          company: { select: { legalName: true } },
        },
      },
      events: {
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          createdAt: true,
          // note and actorId are intentionally excluded — company notes must not reach students
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    coverNote: row.coverNote,
    createdAt: row.createdAt,
    job: {
      id: row.job.id,
      title: row.job.title,
      companyName: row.job.company.legalName,
    },
    events: row.events,
  }))
}

/**
 * Returns the status-change timeline for the student's own application.
 * The company's internal note (ApplicationEvent.note) is intentionally excluded —
 * it must never reach the student side. M5-T06 must maintain this contract.
 */
export async function getStudentApplicationTimeline(
  ctx: UserCtx,
  applicationId: string,
): Promise<StudentApplicationEvent[]> {
  const studentId = await getStudentProfileId(ctx.userId)

  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { id: true, studentId: true },
  })

  if (!app || app.studentId !== studentId) {
    throw new NotFoundError('Application not found')
  }

  return db.applicationEvent.findMany({
    where: { applicationId },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      createdAt: true,
      // note and actorId are intentionally omitted — company notes must not reach student
    },
    orderBy: { createdAt: 'asc' },
  })
}
