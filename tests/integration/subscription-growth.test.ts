/** Cross-service quota guards; real DB counts, transactions and advisory locks. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ getObjectBytes: vi.fn(), notifyOrderConfirmed: vi.fn(), sendNotificationEmail: vi.fn() }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: io.getObjectBytes }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: io.notifyOrderConfirmed, sendNotificationEmail: io.sendNotificationEmail }))
import { setupTestDb, testDb } from '../setup/db'
import { createAdmin } from '../factories'
import { setting, PROOF_BYTES } from '../helpers/billing-t02'
import { configureBase, verifiedCompany, paidCompany, moveSegment, jobInput, seedJob, addMember, oldInvite, visibleStudent, countOpenJobs, whileCreditHeld, DAY, FREE_LIMITS, PAID_LIMITS } from '../helpers/subscriptions-t04'
import { createJob, updateJob, copyJob, closeJob } from '@/server/services/jobs'
import { approveJob } from '@/server/services/review-jobs'
import { inviteMember, acceptInvite, removeMember, changeRole } from '@/server/services/team'
import { sendInvitation, getMonthlyInvitationUsage } from '@/server/services/invitations'
import { postJobAsPlatform, acceptManagedTransfer } from '@/server/services/managed-company'
setupTestDb()
beforeEach(async () => {
  io.getObjectBytes.mockReset().mockResolvedValue(PROOF_BYTES)
  io.notifyOrderConfirmed.mockReset().mockResolvedValue(undefined)
  io.sendNotificationEmail.mockReset().mockResolvedValue(undefined)
  await configureBase()
})
afterEach(() => vi.useRealTimers())

describe('M8-T04 job capacity growth', () => {
  it('keeps pilot publishing free of the commercial FREE job cap', async () => {
    await configureBase(false)
    const ctx = await verifiedCompany()
    await Promise.all(Array.from({ length: 5 }, () => seedJob(ctx)))
    expect(await createJob(ctx, jobInput())).toMatchObject({ status: 'PUBLISHED' })
    expect(await countOpenJobs(ctx.companyId)).toBe(6)
  })

  it('blocks a new auto-published job when FREE is full', async () => {
    const ctx = await verifiedCompany()
    await seedJob(ctx); await seedJob(ctx)
    await expect(createJob(ctx, jobInput())).rejects.toMatchObject({ code: 'JOB_POST_LIMIT_EXCEEDED', httpStatus: 409 })
    expect(await testDb.job.count({ where: { companyId: ctx.companyId } })).toBe(2)
  })

  it.each(['DRAFT', 'PENDING_REVIEW'] as const)('blocks %s automatic resubmission at full capacity', async (status) => {
    const ctx = await verifiedCompany()
    await seedJob(ctx); await seedJob(ctx)
    const candidate = await seedJob(ctx, status)
    await expect(updateJob(ctx, candidate.id, jobInput({ updatedAt: candidate.updatedAt.toISOString() })))
      .rejects.toMatchObject({ code: 'JOB_POST_LIMIT_EXCEEDED', httpStatus: 409 })
    expect(await testDb.job.findUnique({ where: { id: candidate.id } })).toEqual(candidate)
  })

  it.each(['extend', 'clear'] as const)('treats %s of an expired PUBLISHED deadline as a fresh slot', async (mode) => {
    const ctx = await verifiedCompany()
    const occupied = await seedJob(ctx)
    await seedJob(ctx)
    const expired = await seedJob(ctx, 'PUBLISHED', new Date(Date.now() - DAY))
    const input = jobInput({ deadline: mode === 'extend' ? new Date(Date.now() + DAY).toISOString() : undefined, updatedAt: expired.updatedAt.toISOString() })
    await expect(updateJob(ctx, expired.id, input)).rejects.toMatchObject({ code: 'JOB_POST_LIMIT_EXCEEDED', httpStatus: 409 })
    expect(await testDb.job.findUnique({ where: { id: expired.id } })).toEqual(expired)
    await closeJob(ctx, occupied.id)
    expect(await updateJob(ctx, expired.id, input)).toMatchObject({ status: 'PUBLISHED' })
    expect(await countOpenJobs(ctx.companyId)).toBe(2)
  })

  it('preserves over-limit live jobs while permitting non-growth edits, drafts, copies and closure', async () => {
    const ctx = await verifiedCompany()
    const jobs = await Promise.all(Array.from({ length: 5 }, () => seedJob(ctx)))
    const edited = await updateJob(ctx, jobs[0].id, jobInput({ headcount: 2, updatedAt: jobs[0].updatedAt.toISOString() }))
    expect(edited).toMatchObject({ status: 'PUBLISHED', headcount: 2 })
    expect(await createJob(ctx, jobInput({ submit: false }))).toMatchObject({ status: 'DRAFT' })
    expect(await copyJob(ctx, jobs[0].id)).toMatchObject({ status: 'DRAFT', publishedAt: null })
    await closeJob(ctx, jobs[1].id)
    expect(await countOpenJobs(ctx.companyId)).toBe(4)
    expect(await testDb.job.count({ where: { companyId: ctx.companyId } })).toBe(7)
  })

  it.each([false, true])('does not reserve pending review slots and refuses full approval (previouslyPublished=%s)', async (previouslyPublished) => {
    const ctx = await verifiedCompany()
    const admin = await createAdmin(testDb)
    await seedJob(ctx); await seedJob(ctx)
    await setting('jobs.autoPublishAfter', 1000)
    let pending = await createJob(ctx, jobInput())
    if (previouslyPublished) {
      pending = await testDb.job.update({ where: { id: pending.id }, data: { publishedAt: new Date(Date.now() - DAY) } })
      await testDb.company.update({ where: { id: ctx.companyId }, data: { approvedJobCount: 1 } })
    }
    expect(pending.status).toBe('PENDING_REVIEW')
    await expect(approveJob(admin, { jobId: pending.id, updatedAt: pending.updatedAt }))
      .rejects.toMatchObject({ code: 'JOB_POST_LIMIT_EXCEEDED', httpStatus: 409 })
    expect(await testDb.job.findUnique({ where: { id: pending.id } })).toEqual(pending)
    expect(await testDb.company.findUnique({ where: { id: ctx.companyId } })).toMatchObject({ approvedJobCount: previouslyPublished ? 1 : 0 })
    expect(await testDb.notification.count({ where: { type: 'job.approved' } })).toBe(0)
    expect(io.sendNotificationEmail).not.toHaveBeenCalled()
  })

  it('serializes an automatic publish and a different manual approval for the last slot', async () => {
    const ctx = await verifiedCompany()
    const admin = await createAdmin(testDb)
    await seedJob(ctx)
    const pending = await seedJob(ctx, 'PENDING_REVIEW')
    const results = await Promise.allSettled([createJob(ctx, jobInput()), approveJob(admin, { jobId: pending.id, updatedAt: pending.updatedAt })])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'JOB_POST_LIMIT_EXCEEDED', httpStatus: 409 }) }),
    ])
    expect(await countOpenJobs(ctx.companyId)).toBe(2)
    const approved = results[1].status === 'fulfilled' ? 1 : 0
    expect(await testDb.notification.count({ where: { type: 'job.approved' } })).toBe(approved)
    expect(await testDb.company.findUnique({ where: { id: ctx.companyId } })).toMatchObject({ approvedJobCount: approved })
  })

  it('applies the same job cap to platform-managed publishing', async () => {
    const admin = await createAdmin(testDb)
    const company = await testDb.company.create({ data: { legalName: 'Synthetic managed quota company', isManaged: true, verificationStatus: 'VERIFIED' } })
    const ctx = { companyId: company.id, userId: admin.userId }
    await seedJob(ctx); await seedJob(ctx)
    await expect(postJobAsPlatform(admin, company.id, jobInput()))
      .rejects.toMatchObject({ code: 'JOB_POST_LIMIT_EXCEEDED', httpStatus: 409 })
    expect(await countOpenJobs(company.id)).toBe(2)
  })

  it('rechecks expiry after waiting on CREDIT instead of using the pre-lock paid allowance', async () => {
    const f = await paidCompany()
    const end = new Date(Date.now() + DAY)
    await moveSegment(f.subscription, end)
    await seedJob(f.ctx); await seedJob(f.ctx)
    const result = await whileCreditHeld(f.ctx.companyId, () => createJob(f.ctx, jobInput()), async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(end.getTime() + 1))
    })
    expect(result).toMatchObject({ status: 'rejected', reason: { code: 'JOB_POST_LIMIT_EXCEEDED', httpStatus: 409 } })
    expect(await countOpenJobs(f.ctx.companyId)).toBe(2)
  })

  it('keeps paid job capacity after new sales are disabled', async () => {
    const f = await paidCompany({ ...PAID_LIMITS, jobPostLimit: 3 })
    await seedJob(f.ctx); await seedJob(f.ctx)
    await setting('billing.enabled', false)
    expect(await createJob(f.ctx, jobInput())).toMatchObject({ status: 'PUBLISHED' })
    await expect(createJob(f.ctx, jobInput())).rejects.toMatchObject({ code: 'JOB_POST_LIMIT_EXCEEDED', httpStatus: 409 })
    expect(await countOpenJobs(f.ctx.companyId)).toBe(3)
  })
})

describe('M8-T04 membership capacity growth', () => {
  it('uses configured pilot seats rather than the commercial FREE seat limit', async () => {
    await configureBase(false)
    const ctx = await verifiedCompany()
    await Promise.all(Array.from({ length: 3 }, () => addMember(ctx.companyId)))
    await expect(inviteMember(ctx, { email: 'pilot-seat@example.test', role: 'RECRUITER' })).resolves.toHaveProperty('token')
    expect(await testDb.companyMember.count({ where: { companyId: ctx.companyId } })).toBe(4)
  })

  it.each(['member-invite', 'member-accept', 'managed-transfer', 'student-invite', 'managed-post', 'manual-approve', 'deadline-reopen'] as const)('%s waits on company CREDIT before growth', async (entry) => {
    const ctx = await verifiedCompany()
    const admin = await createAdmin(testDb)
    let operation: () => Promise<unknown>
    if (entry === 'member-invite') operation = () => inviteMember(ctx, { email: 'lock-wait@example.test', role: 'RECRUITER' })
    else if (entry === 'member-accept') {
      const invite = await oldInvite(ctx)
      operation = () => acceptInvite(invite, invite.token)
    } else if (entry === 'managed-transfer' || entry === 'managed-post') {
      await testDb.company.update({ where: { id: ctx.companyId }, data: { isManaged: true } })
      await testDb.companyMember.deleteMany({ where: { companyId: ctx.companyId } })
      if (entry === 'managed-transfer') {
        const invite = await oldInvite({ companyId: ctx.companyId, userId: admin.userId }, 'OWNER')
        operation = () => acceptManagedTransfer(invite, invite.token)
      } else operation = () => postJobAsPlatform(admin, ctx.companyId, jobInput())
    } else if (entry === 'student-invite') {
      const job = await seedJob(ctx)
      const student = await visibleStudent()
      operation = () => sendInvitation(ctx, { jobId: job.id, studentId: student.profileId })
    } else if (entry === 'manual-approve') {
      const job = await seedJob(ctx, 'PENDING_REVIEW')
      operation = () => approveJob(admin, { jobId: job.id, updatedAt: job.updatedAt })
    } else {
      const job = await seedJob(ctx, 'PUBLISHED', new Date(Date.now() - DAY))
      operation = () => updateJob(ctx, job.id, jobInput({ updatedAt: job.updatedAt.toISOString() }))
    }
    const result = await whileCreditHeld(ctx.companyId, operation, async () => {})
    expect(result.status).toBe('fulfilled')
  })

  it('admits only one concurrent reservation for the last seat', async () => {
    const ctx = await verifiedCompany()
    await addMember(ctx.companyId)
    const results = await Promise.allSettled(['first@example.test', 'second@example.test'].map((email) => inviteMember(ctx, { email, role: 'RECRUITER' })))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'SEAT_LIMIT_EXCEEDED', httpStatus: 409 }) }),
    ])
    expect(await testDb.companyInvite.count({ where: { companyId: ctx.companyId, acceptedAt: null } })).toBe(1)
    expect(await testDb.companyMember.count({ where: { companyId: ctx.companyId } })).toBe(2)
  })

  it('allows only one old token to consume the final real seat and preserves the loser token', async () => {
    const ctx = await verifiedCompany()
    await addMember(ctx.companyId)
    const candidates = [await oldInvite(ctx), await oldInvite(ctx)]
    const results = await Promise.allSettled(candidates.map((candidate) => acceptInvite(candidate, candidate.token)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'SEAT_LIMIT_EXCEEDED', httpStatus: 409 }) }),
    ])
    expect(await testDb.companyMember.count({ where: { companyId: ctx.companyId } })).toBe(3)
    const failed = candidates[results.findIndex((r) => r.status === 'rejected')]
    expect(await testDb.companyInvite.findUnique({ where: { id: failed.invite.id } })).toMatchObject({ acceptedAt: null })
  })

  it('does not count replacement OWNER transfer tokens as ordinary reservations', async () => {
    const ctx = await verifiedCompany()
    await oldInvite(ctx, 'OWNER'); await oldInvite(ctx, 'OWNER'); await oldInvite(ctx, 'OWNER')
    await expect(inviteMember(ctx, { email: 'ordinary@example.test', role: 'RECRUITER' })).resolves.toHaveProperty('token')
  })

  it('retains members on expiry and allows role changes and removal while blocking new seats', async () => {
    const f = await paidCompany()
    const members = await Promise.all(Array.from({ length: 5 }, () => addMember(f.ctx.companyId)))
    await moveSegment(f.subscription, new Date(Date.now() - 1))
    await expect(inviteMember(f.ctx, { email: 'denied@example.test', role: 'RECRUITER' }))
      .rejects.toMatchObject({ code: 'SEAT_LIMIT_EXCEEDED', httpStatus: 409 })
    expect(await testDb.companyMember.count({ where: { companyId: f.ctx.companyId } })).toBe(6)
    await changeRole(f.ctx, { memberId: members[0].member.id, role: 'ADMIN' })
    await removeMember(f.ctx, { memberId: members[1].member.id })
    expect(await testDb.companyMember.count({ where: { companyId: f.ctx.companyId } })).toBe(5)
  })

  it('preserves paid seat reservations after sales switch off', async () => {
    const f = await paidCompany({ ...PAID_LIMITS, seatLimit: 2 })
    await setting('billing.enabled', false)
    await inviteMember(f.ctx, { email: 'first-seat@example.test', role: 'RECRUITER' })
    await expect(inviteMember(f.ctx, { email: 'second-seat@example.test', role: 'RECRUITER' }))
      .rejects.toMatchObject({ code: 'SEAT_LIMIT_EXCEEDED', httpStatus: 409 })
    expect(await testDb.companyInvite.count({ where: { companyId: f.ctx.companyId } })).toBe(1)
  })

  it.each([false, true])('checks actual managed-transfer occupancy (alreadyFull=%s)', async (alreadyFull) => {
    await configureBase(true, { ...FREE_LIMITS, seatLimit: 1 })
    const admin = await createAdmin(testDb)
    const company = await testDb.company.create({ data: { legalName: 'Synthetic transfer capacity company', isManaged: true, verificationStatus: 'VERIFIED' } })
    if (alreadyFull) await addMember(company.id)
    const ctx = { companyId: company.id, userId: admin.userId }
    const first = await oldInvite(ctx, 'OWNER')
    await oldInvite(ctx, 'OWNER')
    const [result] = await Promise.allSettled([alreadyFull ? acceptManagedTransfer(first, first.token) : acceptInvite(first, first.token)])
    expect(result).toMatchObject(alreadyFull
      ? { status: 'rejected', reason: { code: 'SEAT_LIMIT_EXCEEDED', httpStatus: 409 } }
      : { status: 'fulfilled' })
    const stored = await testDb.companyInvite.findUniqueOrThrow({ where: { id: first.invite.id } })
    expect(stored.acceptedAt === null).toBe(alreadyFull)
    expect(await testDb.company.findUnique({ where: { id: company.id } })).toMatchObject({ isManaged: alreadyFull })
    const expectedOwner = expect.objectContaining({ companyId: company.id, role: 'OWNER' })
    expect(await testDb.companyMember.findUnique({ where: { userId: first.userId } })).toEqual(alreadyFull ? null : expectedOwner)
    expect(await testDb.companyMember.count({ where: { companyId: company.id } })).toBe(1)
  })
})

describe('M8-T04 student invitation quota growth', () => {
  it('uses the configured pilot invitation cap when no paid subscription exists', async () => {
    await configureBase(false)
    await setting('invitations.freeMonthlyQuota', 1)
    const ctx = await verifiedCompany()
    const job = await seedJob(ctx)
    const first = await visibleStudent()
    const second = await visibleStudent()
    await sendInvitation(ctx, { jobId: job.id, studentId: first.profileId })
    await expect(sendInvitation(ctx, { jobId: job.id, studentId: second.profileId }))
      .rejects.toMatchObject({ code: 'INVITATION_QUOTA_EXCEEDED', httpStatus: 429 })
    expect(await getMonthlyInvitationUsage(ctx.companyId)).toEqual({ used: 1, quota: 1 })
  })

  it('uses the post-lock KL month and write time when waiting crosses a month boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-06-30T15:59:59.000Z'))
    const f = await paidCompany({ ...PAID_LIMITS, invitationQuota: 1 })
    const job = await seedJob(f.ctx)
    const previous = await visibleStudent()
    const next = await visibleStudent()
    await testDb.invitation.create({ data: { companyId: f.ctx.companyId, jobId: job.id, studentId: previous.profileId, sentById: f.ctx.userId, status: 'DECLINED', createdAt: new Date(), expiresAt: new Date(Date.now() + DAY) } })
    const boundary = new Date('2030-06-30T16:00:00.000Z')
    const result = await whileCreditHeld(f.ctx.companyId, () => sendInvitation(f.ctx, { jobId: job.id, studentId: next.profileId }), async () => { vi.setSystemTime(boundary) })
    expect(result.status).toBe('fulfilled')
    if (result.status !== 'fulfilled') return
    const invitation = await testDb.invitation.findUniqueOrThrow({ where: { id: result.value.invitationId } })
    expect(invitation.createdAt.getTime()).toBeGreaterThanOrEqual(boundary.getTime())
    expect(await getMonthlyInvitationUsage(f.ctx.companyId)).toEqual({ used: 1, quota: 1 })
  })

  it('uses paid monthly limits after sales switch off without resetting used count', async () => {
    const f = await paidCompany({ ...PAID_LIMITS, invitationQuota: 2 })
    const job = await seedJob(f.ctx)
    const students = [await visibleStudent(), await visibleStudent(), await visibleStudent()]
    await sendInvitation(f.ctx, { jobId: job.id, studentId: students[0].profileId })
    await setting('billing.enabled', false)
    await sendInvitation(f.ctx, { jobId: job.id, studentId: students[1].profileId })
    await expect(sendInvitation(f.ctx, { jobId: job.id, studentId: students[2].profileId }))
      .rejects.toMatchObject({ code: 'INVITATION_QUOTA_EXCEEDED', httpStatus: 429 })
    expect(await getMonthlyInvitationUsage(f.ctx.companyId)).toEqual({ used: 2, quota: 2 })
    expect(await sendInvitation(f.ctx, { jobId: job.id, studentId: students[0].profileId })).toMatchObject({ alreadyExists: true })
    expect(await testDb.invitation.count({ where: { companyId: f.ctx.companyId } })).toBe(2)
  })

  it('distinguishes FREE zero from paid explicit unlimited', async () => {
    await configureBase(true, { ...FREE_LIMITS, invitationQuota: 0 })
    const ctx = await verifiedCompany()
    const job = await seedJob(ctx)
    const student = await visibleStudent()
    await expect(sendInvitation(ctx, { jobId: job.id, studentId: student.profileId }))
      .rejects.toMatchObject({ code: 'INVITATION_QUOTA_EXCEEDED', httpStatus: 429 })
    const paid = await paidCompany({ ...PAID_LIMITS, invitationQuota: null })
    const paidJob = await seedJob(paid.ctx)
    await sendInvitation(paid.ctx, { jobId: paidJob.id, studentId: student.profileId })
    expect(await getMonthlyInvitationUsage(paid.ctx.companyId)).toEqual({ used: 1, quota: null })
  })

  it('counts all current-month statuses but excludes future-month rows', async () => {
    const f = await paidCompany({ ...PAID_LIMITS, invitationQuota: 4 })
    const job = await seedJob(f.ctx)
    const students = [await visibleStudent(), await visibleStudent(), await visibleStudent(), await visibleStudent(), await visibleStudent()]
    const now = new Date()
    const kl = new Date(now.getTime() + 8 * 3600_000)
    const nextMonth = new Date(Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth() + 1, 1) - 8 * 3600_000)
    for (const [index, status] of (['DECLINED', 'ACCEPTED', 'EXPIRED', 'EXPIRED'] as const).entries()) {
      await testDb.invitation.create({ data: { companyId: f.ctx.companyId, jobId: job.id, studentId: students[index].profileId, sentById: f.ctx.userId, status, createdAt: index === 3 ? nextMonth : now, expiresAt: new Date(nextMonth.getTime() + DAY) } })
    }
    expect(await getMonthlyInvitationUsage(f.ctx.companyId)).toEqual({ used: 3, quota: 4 })
    await sendInvitation(f.ctx, { jobId: job.id, studentId: students[4].profileId })
    expect(await getMonthlyInvitationUsage(f.ctx.companyId)).toEqual({ used: 4, quota: 4 })
  })
})
