import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer, createStudent } from '../factories'
import { qualifyReferral, requalifyReferrals, voidReferral } from '@/server/services/referrals'
import { getQuota, openJob } from '@/server/services/job-view-quota'
import { clearSettingsCache } from '@/server/services/settings'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'

setupTestDb()
beforeEach(() => clearSettingsCache())

async function referralFixture(status: 'PENDING' | 'QUALIFIED' = 'QUALIFIED') {
  const admin = await createAdmin(testDb)
  const referrer = await createStudent(testDb)
  const invitee = await createStudent(testDb, { completeness: 100 })
  const referral = await testDb.referral.create({
    data: {
      referrerId: referrer.profileId,
      inviteeId: invitee.profileId,
      status,
      qualifiedAt: status === 'QUALIFIED' ? new Date('2026-11-01T00:00:00Z') : null,
    },
  })
  return { admin, referrer, invitee, referral }
}

describe('voidReferral with the real database', () => {
  it.each(['PENDING', 'QUALIFIED'] as const)('voids %s and writes one exact redacted audit', async (status) => {
    const { admin, referral } = await referralFixture(status)
    const reason = 'synthetic-private-reason@example.test'
    await voidReferral('  ' + referral.id + '  ', '  ' + reason + '  ', admin.userId)

    expect(await testDb.referral.findUnique({ where: { id: referral.id } })).toMatchObject({
      status: 'VOID',
      voidReason: reason,
      qualifiedAt: referral.qualifiedAt,
    })
    const audits = await testDb.auditLog.findMany({ where: { targetId: referral.id } })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      actorId: admin.userId,
      action: 'referral.void',
      targetType: 'Referral',
      targetId: referral.id,
    })
    expect(audits[0].metadata).toEqual({
      fromStatus: status,
      toStatus: 'VOID',
      reasonLength: reason.length,
    })
    expect(JSON.stringify(audits)).not.toContain(reason)
  })

  it.each([
    { role: 'STUDENT', status: 'ACTIVE' },
    { role: 'EMPLOYER', status: 'ACTIVE' },
    { role: 'ADMIN', status: 'SUSPENDED' },
    { role: 'ADMIN', status: 'DELETED' },
  ] as const)('rejects $role/$status without changing the referral', async (actor) => {
    const { admin, referral } = await referralFixture()
    await testDb.user.update({ where: { id: admin.userId }, data: actor })
    await expect(voidReferral(referral.id, 'synthetic reason', admin.userId))
      .rejects.toBeInstanceOf(ForbiddenError)
    expect(await testDb.referral.findUnique({ where: { id: referral.id } })).toEqual(referral)
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it('rejects a nonexistent actor', async () => {
    const { referral } = await referralFixture()
    await expect(voidReferral(referral.id, 'synthetic reason', 'missing-actor'))
      .rejects.toBeInstanceOf(ForbiddenError)
    expect(await testDb.referral.findUnique({ where: { id: referral.id } })).toEqual(referral)
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it.each(['', '   ', 'x'.repeat(501)])('rejects invalid reason %j', async (reason) => {
    const { admin, referral } = await referralFixture()
    await expect(voidReferral(referral.id, reason, admin.userId)).rejects.toBeInstanceOf(ValidationError)
    expect(await testDb.referral.findUnique({ where: { id: referral.id } })).toEqual(referral)
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it.each(['', '   ', 'x'.repeat(129)])('rejects invalid referral id %j', async (id) => {
    const { admin } = await referralFixture()
    await expect(voidReferral(id, 'synthetic reason', admin.userId)).rejects.toBeInstanceOf(ValidationError)
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it('returns NotFound for an absent referral', async () => {
    const admin = await createAdmin(testDb)
    await expect(voidReferral('missing-referral', 'synthetic reason', admin.userId))
      .rejects.toBeInstanceOf(NotFoundError)
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it('preserves the first reason and audit when repeated with either reason', async () => {
    const { admin, referral } = await referralFixture()
    await voidReferral(referral.id, 'first reason', admin.userId)
    const first = await testDb.referral.findUnique({ where: { id: referral.id } })
    await voidReferral(referral.id, 'first reason', admin.userId)
    await voidReferral(referral.id, 'replacement reason', admin.userId)
    expect(await testDb.referral.findUnique({ where: { id: referral.id } })).toEqual(first)
    expect(await testDb.auditLog.count({ where: { action: 'referral.void', targetId: referral.id } })).toBe(1)
  })

  it('serializes competing voids into one transition and audit', async () => {
    const { admin, referral } = await referralFixture()
    const results = await Promise.allSettled([
      voidReferral(referral.id, 'first reason', admin.userId),
      voidReferral(referral.id, 'second reason', admin.userId),
    ])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    const saved = await testDb.referral.findUniqueOrThrow({ where: { id: referral.id } })
    expect(saved.status).toBe('VOID')
    expect(['first reason', 'second reason']).toContain(saved.voidReason)
    const audits = await testDb.auditLog.findMany({ where: { action: 'referral.void', targetId: referral.id } })
    expect(audits).toHaveLength(1)
    expect(audits[0].metadata).toEqual({
      fromStatus: 'QUALIFIED', toStatus: 'VOID', reasonLength: saved.voidReason!.length,
    })
  })

  it('never requalifies a voided referral on profile save or the daily job', async () => {
    const { admin, invitee, referral } = await referralFixture('PENDING')
    await voidReferral(referral.id, 'synthetic reason', admin.userId)
    await qualifyReferral(invitee.profileId)
    expect(await requalifyReferrals()).toEqual({ qualified: 0 })
    expect(await testDb.referral.findUnique({ where: { id: referral.id } })).toMatchObject({
      status: 'VOID', voidReason: 'synthetic reason', qualifiedAt: null,
    })
    expect(await testDb.notification.count({ where: { type: 'referral.qualified' } })).toBe(0)
  })

  it.each([
    { qualified: 3, before: 30, after: 20 },
    { qualified: 12, before: null, after: 50 },
  ])('immediately recalculates $qualified referrals after void, retaining historical access', async ({ qualified, before, after }) => {
    const { admin, referrer, referral } = await referralFixture()
    for (let index = 1; index < qualified; index++) {
      const invitee = await createStudent(testDb)
      await testDb.referral.create({
        data: { referrerId: referrer.profileId, inviteeId: invitee.profileId, status: 'QUALIFIED', qualifiedAt: new Date() },
      })
    }
    const employer = await createEmployer(testDb)
    const jobIds = Array.from({ length: after + 3 }, () => randomUUID())
    await testDb.job.createMany({
      data: jobIds.map((id) => ({
        id, companyId: employer.companyId, createdById: employer.userId,
        title: 'Synthetic quota fixture', description: 'Synthetic description',
        type: 'INTERNSHIP' as const, workMode: 'HYBRID' as const, status: 'PUBLISHED' as const,
      })),
    })
    await testDb.jobView.createMany({
      data: jobIds.slice(0, after).map((jobId) => ({ studentId: referrer.profileId, jobId })),
    })
    await testDb.application.create({ data: { studentId: referrer.profileId, jobId: jobIds[after + 1] } })
    await testDb.invitation.create({
      data: {
        studentId: referrer.profileId, jobId: jobIds[after + 2],
        companyId: employer.companyId, sentById: employer.userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
    expect(await getQuota(referrer.profileId)).toMatchObject({ qualified, limit: before, used: after })

    await voidReferral(referral.id, 'synthetic correction', admin.userId)

    expect(await getQuota(referrer.profileId)).toMatchObject({ qualified: qualified - 1, limit: after, used: after })
    expect(await openJob(referrer.profileId, jobIds[after])).toMatchObject({ allowed: false, isNewView: false })
    expect(await openJob(referrer.profileId, jobIds[0])).toMatchObject({ allowed: true, isNewView: false })
    expect(await openJob(referrer.profileId, jobIds[after + 1])).toMatchObject({ allowed: true, isNewView: false })
    expect(await openJob(referrer.profileId, jobIds[after + 2])).toMatchObject({ allowed: true, isNewView: false })
    expect(await testDb.jobView.count({ where: { studentId: referrer.profileId } })).toBe(after)
  })

  it('retains manual view grants while recalculating referral quota', async () => {
    const { admin, referrer, referral } = await referralFixture()
    const grant = await testDb.jobViewGrant.create({
      data: { studentId: referrer.profileId, amount: 7, source: 'ADMIN_GRANT', createdById: admin.userId },
    })
    await voidReferral(referral.id, 'synthetic correction', admin.userId)
    expect(await getQuota(referrer.profileId)).toMatchObject({ qualified: 0, limit: 27 })
    expect(await testDb.jobViewGrant.findUnique({ where: { id: grant.id } })).toEqual(grant)
  })
})
