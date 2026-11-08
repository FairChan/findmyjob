import 'server-only'
import { InvitationStatus, Prisma } from '@prisma/client'
import { db } from '../db'
import { NotFoundError, ForbiddenError, InvitationQuotaError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { getSetting } from './settings'
import { isStudentVisibleToCompany } from './talent-visibility'
import { canSeeIdentity, canSeeIdentityMany } from './contact-access'
import { toTalentCard } from '../serializers/talent-card'
import type { TalentCard } from '../serializers/talent-card'

/** Returns start of current month in Asia/Kuala_Lumpur (UTC+8) expressed as UTC. */
function klMonthStartUtc(): Date {
  const now = new Date()
  const klMs = now.getTime() + 8 * 60 * 60 * 1000
  const klNow = new Date(klMs)
  return new Date(Date.UTC(klNow.getUTCFullYear(), klNow.getUTCMonth(), 1) - 8 * 60 * 60 * 1000)
}

export interface SendInvitationInput {
  studentId: string
  jobId: string
  message?: string | null
}

export interface SendInvitationResult {
  invitationId: string
  alreadyExists: boolean
}

/**
 * Send an invitation to a student to apply to a specific job.
 * Quota is counted per company per KL calendar month.
 * Uses an advisory lock to prevent concurrent over-quota.
 */
export async function sendInvitation(
  ctx: { userId: string; companyId: string },
  input: SendInvitationInput,
): Promise<SendInvitationResult> {
  const message = input.message?.trim() ?? null

  // Verify job belongs to this company and is published + not past deadline
  const now = new Date()
  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, companyId: true, status: true, deadline: true },
  })
  if (!job || job.companyId !== ctx.companyId || job.status !== 'PUBLISHED' || (job.deadline !== null && job.deadline <= now)) {
    throw new NotFoundError('Job not found or not accepting invitations')
  }

  // Visibility check: same error as "student not found" to avoid leaking existence
  const visible = await isStudentVisibleToCompany(input.studentId, ctx.companyId)
  if (!visible) throw new NotFoundError('Student not found')

  const quota = await getSetting<number>('invitations.freeMonthlyQuota', 20)
  const expireDays = await getSetting<number>('invitations.expireDays', 14)

  const result = await db.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.INVITATION, ctx.companyId)

    // Idempotency: return existing SENT invitation for same company+student+job
    const existing = await tx.invitation.findFirst({
      where: {
        companyId: ctx.companyId,
        studentId: input.studentId,
        jobId: input.jobId,
        status: InvitationStatus.SENT,
      },
      select: { id: true },
    })
    if (existing) {
      return { invitationId: existing.id, alreadyExists: true }
    }

    // Count quota: invitations created this KL month (any status counts towards quota)
    const monthStart = klMonthStartUtc()
    const usedThisMonth = await tx.invitation.count({
      where: { companyId: ctx.companyId, createdAt: { gte: monthStart } },
    })
    if (usedThisMonth >= quota) {
      throw new InvitationQuotaError()
    }

    const expiresAt = new Date(now.getTime() + expireDays * 24 * 60 * 60 * 1000)

    const inv = await tx.invitation.create({
      data: {
        companyId: ctx.companyId,
        jobId: input.jobId,
        studentId: input.studentId,
        sentById: ctx.userId,
        message,
        status: InvitationStatus.SENT,
        expiresAt,
      },
      select: { id: true },
    })

    return { invitationId: inv.id, alreadyExists: false }
  })

  return result
}

export interface AcceptInvitationInput {
  invitationId: string
}

export interface AcceptInvitationResult {
  applicationId: string
}

/**
 * Student accepts an invitation: creates an Application (or re-links an existing one) in the
 * same transaction that marks the invitation ACCEPTED.
 *
 * Decision (D-INV-01): if the student already applied to this job, the existing application is
 * re-linked to the invitation rather than rejecting the accept.
 */
export async function acceptInvitation(
  ctx: { userId: string },
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })
  if (!profile) throw new ForbiddenError('Student profile not found')
  const studentId = profile.id

  const result = await db.$transaction(async (tx) => {
    // Re-fetch invitation with a lock to prevent concurrent accepts
    await lockXact(tx, LOCK_NS.INVITATION, input.invitationId)

    const inv = await tx.invitation.findUnique({
      where: { id: input.invitationId },
      select: {
        id: true,
        studentId: true,
        jobId: true,
        companyId: true,
        status: true,
        expiresAt: true,
        applicationId: true,
      },
    })

    if (!inv || inv.studentId !== studentId) {
      throw new NotFoundError('Invitation not found')
    }
    if (inv.status !== InvitationStatus.SENT) {
      throw new ForbiddenError('Invitation is not in SENT status')
    }
    const checkNow = new Date()
    if (inv.expiresAt <= checkNow) {
      throw new ForbiddenError('Invitation has expired')
    }

    // Find or create application; re-link if already applied (D-INV-01)
    const jobId = inv.jobId
    if (!jobId) throw new NotFoundError('Invitation job no longer exists')

    let applicationId: string

    const existingApp = await tx.application.findUnique({
      where: { jobId_studentId: { jobId, studentId } },
      select: { id: true },
    })

    if (existingApp) {
      applicationId = existingApp.id
    } else {
      // Create TalentUnlock (APPLICATION) if not present
      await tx.talentUnlock.createMany({
        data: [
          {
            companyId: inv.companyId,
            studentId,
            unlockedById: ctx.userId,
            source: 'APPLICATION',
            creditsSpent: 0,
          },
        ],
        skipDuplicates: true,
      })

      const app = await tx.application.create({
        data: {
          jobId,
          studentId,
          status: 'APPLIED',
        },
        select: { id: true },
      })
      await tx.applicationEvent.create({
        data: { applicationId: app.id, toStatus: 'APPLIED', actorId: ctx.userId },
      })
      applicationId = app.id
    }

    // Mark invitation accepted — conditional update prevents double-accept races
    const updated = await tx.invitation.updateMany({
      where: { id: inv.id, status: InvitationStatus.SENT },
      data: {
        status: InvitationStatus.ACCEPTED,
        applicationId,
        respondedAt: new Date(),
      },
    })
    if (updated.count === 0) {
      throw new ForbiddenError('Invitation already responded to')
    }

    return { applicationId }
  })

  return result
}

export interface DeclineInvitationInput {
  invitationId: string
}

/** Student declines an invitation. */
export async function declineInvitation(
  ctx: { userId: string },
  input: DeclineInvitationInput,
): Promise<void> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })
  if (!profile) throw new ForbiddenError('Student profile not found')
  const studentId = profile.id

  await db.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.INVITATION, input.invitationId)

    const inv = await tx.invitation.findUnique({
      where: { id: input.invitationId },
      select: { id: true, studentId: true, status: true, expiresAt: true },
    })

    if (!inv || inv.studentId !== studentId) {
      throw new NotFoundError('Invitation not found')
    }
    if (inv.status !== InvitationStatus.SENT) {
      throw new ForbiddenError('Invitation is not in SENT status')
    }
    const checkNow = new Date()
    if (inv.expiresAt <= checkNow) {
      throw new ForbiddenError('Invitation has expired')
    }

    const updated = await tx.invitation.updateMany({
      where: { id: inv.id, status: InvitationStatus.SENT },
      data: { status: InvitationStatus.DECLINED, respondedAt: new Date() },
    })
    if (updated.count === 0) {
      throw new ForbiddenError('Invitation already responded to')
    }
  })
}

// ---- Student list ----

export interface StudentInvitationItem {
  id: string
  status: InvitationStatus
  message: string | null
  expiresAt: Date
  createdAt: Date
  respondedAt: Date | null
  applicationId: string | null
  job: {
    id: string
    title: string
    type: string
    workMode: string | null
    city: string | null
    salaryMin: number | null
    salaryMax: number | null
    salaryVisible: boolean
  } | null
  company: {
    id: string
    legalName: string
    displayNameZh: string | null
    displayNameEn: string | null
  }
}

export async function listStudentInvitations(ctx: { userId: string }): Promise<StudentInvitationItem[]> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })
  if (!profile) return []

  const invitations = await db.invitation.findMany({
    where: { studentId: profile.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      message: true,
      expiresAt: true,
      createdAt: true,
      respondedAt: true,
      applicationId: true,
      job: {
        select: {
          id: true,
          title: true,
          type: true,
          workMode: true,
          city: true,
          salaryMin: true,
          salaryMax: true,
          salaryVisible: true,
        },
      },
      company: {
        select: {
          id: true,
          legalName: true,
          displayNameZh: true,
          displayNameEn: true,
        },
      },
    },
  })

  // Mask salary when salaryVisible=false before returning to RSC payload (PRD §3.2 / ARCHITECTURE §5.2)
  return invitations.map((inv) => ({
    ...inv,
    job: inv.job
      ? {
          ...inv.job,
          salaryMin: inv.job.salaryVisible ? inv.job.salaryMin : null,
          salaryMax: inv.job.salaryVisible ? inv.job.salaryMax : null,
        }
      : null,
  }))
}

// ---- Company list ----

export interface CompanyInvitationItem {
  id: string
  status: InvitationStatus
  message: string | null
  expiresAt: Date
  createdAt: Date
  respondedAt: Date | null
  applicationId: string | null
  job: {
    id: string
    title: string
  } | null
  student: TalentCard
}

export async function listCompanyInvitations(ctx: { userId: string; companyId: string }): Promise<CompanyInvitationItem[]> {
  const invitations = await db.invitation.findMany({
    where: { companyId: ctx.companyId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      message: true,
      expiresAt: true,
      createdAt: true,
      respondedAt: true,
      applicationId: true,
      jobId: true,
      job: { select: { id: true, title: true } },
      student: {
        select: {
          id: true,
          fullName: true,
          headline: true,
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
        },
      },
    },
  })

  if (invitations.length === 0) return []

  // Re-check visibility for each student (live check per PRD TM-003)
  const studentIds = [...new Set(invitations.map((i) => i.student.id))]
  const identitySet = await canSeeIdentityMany(ctx.companyId, studentIds)

  // Filter out students no longer visible (blocked the company, deactivated, etc.)
  const visibleStudentIds = new Set<string>()
  await Promise.all(
    studentIds.map(async (sid) => {
      const visible = await isStudentVisibleToCompany(sid, ctx.companyId)
      if (visible) visibleStudentIds.add(sid)
    }),
  )

  return invitations
    .filter((inv) => visibleStudentIds.has(inv.student.id))
    .map((inv) => ({
      id: inv.id,
      status: inv.status,
      message: inv.message,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      respondedAt: inv.respondedAt,
      applicationId: inv.applicationId,
      job: inv.job,
      student: toTalentCard(
        {
          id: inv.student.id,
          fullName: inv.student.fullName,
          headline: inv.student.headline,
          skills: inv.student.skills,
          major: inv.student.major,
          degreeLevel: inv.student.degreeLevel,
          graduationYear: inv.student.graduationYear,
          cgpa: inv.student.cgpa,
          workAuth: inv.student.workAuth,
          completeness: inv.student.completeness,
          visibility: inv.student.visibility,
          school: inv.student.school,
          lastActiveAt: inv.student.lastActiveAt,
        },
        { unlocked: identitySet.has(inv.student.id) },
      ),
    }))
}

/** Returns how many invitations this company has sent in the current KL calendar month. */
export async function getMonthlyInvitationUsage(companyId: string): Promise<{ used: number; quota: number }> {
  const quota = await getSetting<number>('invitations.freeMonthlyQuota', 20)
  const monthStart = klMonthStartUtc()
  const used = await db.invitation.count({
    where: { companyId, createdAt: { gte: monthStart } },
  })
  return { used, quota }
}
