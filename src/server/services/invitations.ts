import 'server-only'
import { InvitationStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '../db'
import { NotFoundError, ForbiddenError, InvitationQuotaError, DuplicateApplicationError } from '../errors'
import { applyToJob } from './applications'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { getSetting } from './settings'
import { resolveCompanyEntitlements } from './subscription-entitlements'
import { klMonthBounds } from '../lib/kl-month'
import { isStudentVisibleToCompany } from './talent-visibility'
import { canSeeIdentity, canSeeIdentityMany } from './contact-access'
import { toTalentCard } from '../serializers/talent-card'
import { createNotification, buildEmployerStudentPayload } from './notifications'
import { sendNotificationEmail } from './notify'
import { logger } from '../lib/logger'
import type { TalentCard } from '../serializers/talent-card'

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

  const result = await db.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.CREDIT, ctx.companyId)
    await lockXact(tx, LOCK_NS.INVITATION, ctx.companyId)
    const now = new Date()
    const member = await tx.companyMember.findUnique({
      where: { companyId_userId: { companyId: ctx.companyId, userId: ctx.userId } },
      select: {
        user: { select: { status: true, role: true } },
        company: { select: { isActive: true, verificationStatus: true } },
      },
    })
    if (!member || member.user.status !== 'ACTIVE' || member.user.role !== 'EMPLOYER'
      || !member.company.isActive || member.company.verificationStatus !== 'VERIFIED') throw new ForbiddenError()
    const job = await tx.job.findUnique({
      where: { id: input.jobId }, select: { companyId: true, status: true, deadline: true },
    })
    if (!job || job.companyId !== ctx.companyId || job.status !== 'PUBLISHED'
      || (job.deadline !== null && job.deadline <= now)) throw new NotFoundError('Job not found or not accepting invitations')
    if (!await isStudentVisibleToCompany(input.studentId, ctx.companyId, tx)) throw new NotFoundError('Student not found')

    const application = await tx.application.findUnique({
      where: { jobId_studentId: { jobId: input.jobId, studentId: input.studentId } },
      select: { status: true },
    })
    if (application && application.status !== 'WITHDRAWN') {
      throw new DuplicateApplicationError()
    }

    // Idempotency: return existing SENT invitation for same company+student+job
    const existing = await tx.invitation.findFirst({
      where: {
        companyId: ctx.companyId,
        studentId: input.studentId,
        jobId: input.jobId,
        status: InvitationStatus.SENT,
        expiresAt: { gt: now },
      },
      select: { id: true },
    })
    if (existing) {
      return { invitationId: existing.id, alreadyExists: true }
    }

    // Count quota: invitations created this KL month (any status counts towards quota)
    const { invitationQuota: quota } = await resolveCompanyEntitlements(tx, { companyId: ctx.companyId, now })
    const { start, end } = klMonthBounds(now)
    const usedThisMonth = await tx.invitation.count({
      where: { companyId: ctx.companyId, createdAt: { gte: start, lt: end } },
    })
    if (quota !== null && usedThisMonth >= quota) {
      throw new InvitationQuotaError()
    }

    const expiry = z.number().int().positive().max(365).safeParse(
      await getSetting<unknown>('invitations.expireDays', 14, { tx, fresh: true }),
    )
    const expireDays = expiry.success ? expiry.data : 14
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
        createdAt: now,
      },
      select: { id: true },
    })

    return { invitationId: inv.id, alreadyExists: false }
  }, { maxWait: 10_000, timeout: 15_000 })

  // Post-commit: notify student about new invitation (skip if idempotent return)
  if (!result.alreadyExists) {
    const studentUser = await db.studentProfile.findUnique({
      where: { id: input.studentId },
      select: { userId: true },
    })
    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: { title: true, company: { select: { legalName: true, displayNameZh: true, displayNameEn: true } } },
    })
    if (studentUser && job) {
      const companyName = job.company.displayNameZh ?? job.company.legalName
      await createNotification(db, studentUser.userId, 'invitation.received', {
        invitationId: result.invitationId,
        jobId: input.jobId,
        jobTitle: job.title,
        companyName,
      }).catch((err) => { logger.error({ err }, 'Failed to send invitation.received notification') })
      await sendNotificationEmail(studentUser.userId, {
        template: 'invitation-received',
        jobTitle: job.title,
        companyName,
      }).catch(() => {})
    }
  }

  return result
}

export interface AcceptInvitationInput {
  invitationId: string
}

export interface AcceptInvitationResult {
  applicationId: string
}

/**
 * Student accepts an invitation. The application itself goes through applyToJob, so accepting
 * applies exactly the same guards as applying from the job page (profile completeness, job still
 * published and before its deadline, canApplyToJob, notifying the employer); an invitation only
 * waives the job-view quota, which canApplyToJob already handles.
 *
 * Decision (D-INV-01): if the student already applied to this job, the existing application is
 * linked to the invitation rather than rejecting the accept.
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

  const inv = await db.invitation.findUnique({
    where: { id: input.invitationId },
    select: { id: true, studentId: true, jobId: true, status: true, expiresAt: true },
  })
  if (!inv || inv.studentId !== studentId) {
    throw new NotFoundError('Invitation not found')
  }
  if (inv.status !== InvitationStatus.SENT) {
    throw new ForbiddenError('Invitation is not in SENT status')
  }
  if (inv.expiresAt <= new Date()) {
    throw new ForbiddenError('Invitation has expired')
  }
  const jobId = inv.jobId
  if (!jobId) throw new NotFoundError('Invitation job no longer exists')

  let applicationId: string
  try {
    applicationId = (await applyToJob(ctx, { jobId })).applicationId
  } catch (err) {
    if (!(err instanceof DuplicateApplicationError)) throw err
    const existing = await db.application.findUnique({
      where: { jobId_studentId: { jobId, studentId } },
      select: { id: true },
    })
    if (!existing) throw err
    applicationId = existing.id
  }

  // Keep the unique application link on the first invitation. A losing concurrent accept
  // can still accept its own invitation, but must re-check status and expiry on the retry.
  const markAccepted = (linkedApplicationId: string | null) => db.invitation.updateMany({
    where: { id: inv.id, status: InvitationStatus.SENT, expiresAt: { gt: new Date() } },
    data: { status: InvitationStatus.ACCEPTED, applicationId: linkedApplicationId, respondedAt: new Date() },
  })
  let updated
  try {
    updated = await markAccepted(applicationId)
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002' ||
      !Array.isArray(err.meta?.target) || !err.meta.target.includes('applicationId')) {
      throw err
    }
    updated = await markAccepted(null)
  }
  if (updated.count === 0) {
    throw new ForbiddenError('Invitation already responded to')
  }

  // Post-commit: notify invitation sender (employer) of acceptance
  const sentInv = await db.invitation.findUnique({
    where: { id: inv.id },
    select: {
      sentById: true,
      student: {
        select: {
          id: true, fullName: true, headline: true, skills: true, major: true,
          degreeLevel: true, graduationYear: true, cgpa: true, workAuth: true,
          completeness: true, visibility: true, lastActiveAt: true,
          school: { select: { id: true, nameZh: true, nameEn: true } },
        },
      },
    },
  })
  if (sentInv?.sentById) {
    const companyMember = await db.companyMember.findFirst({
      where: { userId: sentInv.sentById },
      select: { companyId: true },
    })
    const canSeeName = companyMember
      ? await canSeeIdentity(companyMember.companyId, profile.id)
      : false
    const payload = buildEmployerStudentPayload(sentInv.student as never, { canSeeName })
    await createNotification(db, sentInv.sentById, 'invitation.accepted', {
      invitationId: inv.id,
      applicationId,
      student: payload,
    }).catch((err) => { logger.error({ err }, 'Failed to send invitation.accepted notification') })
  }

  return { applicationId }
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

  // Post-commit: notify invitation sender (employer) of decline
  const declinedInv = await db.invitation.findUnique({
    where: { id: input.invitationId },
    select: {
      sentById: true,
      student: {
        select: {
          id: true, fullName: true, headline: true, skills: true, major: true,
          degreeLevel: true, graduationYear: true, cgpa: true, workAuth: true,
          completeness: true, visibility: true, lastActiveAt: true,
          school: { select: { id: true, nameZh: true, nameEn: true } },
        },
      },
    },
  })
  if (declinedInv?.sentById) {
    const payload = buildEmployerStudentPayload(declinedInv.student as never, { canSeeName: false })
    await createNotification(db, declinedInv.sentById, 'invitation.declined', {
      invitationId: input.invitationId,
      student: payload,
    }).catch((err) => { logger.error({ err }, 'Failed to send invitation.declined notification') })
  }
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
export async function getMonthlyInvitationUsage(companyId: string): Promise<{ used: number; quota: number | null }> {
  return db.$transaction(async tx => {
    const now = new Date()
    const { invitationQuota: quota } = await resolveCompanyEntitlements(tx, { companyId, now })
    const { start, end } = klMonthBounds(now)
    const used = await tx.invitation.count({
      where: { companyId, createdAt: { gte: start, lt: end } },
    })
    return { used, quota }
  })
}
