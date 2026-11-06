/**
 * Integration tests for team management service (M3-T04).
 * Tests invite, accept, remove, and role-change flows.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

vi.mock('@/lib/email', () => ({
  createEmailProvider: vi.fn(() => ({ sendEmail: vi.fn().mockResolvedValue(undefined) })),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import {
  inviteMember,
  acceptInvite,
  removeMember,
  changeRole,
  listTeamMembers,
  getInviteDetails,
} from '@/server/services/team'
import { clearSettingsCache } from '@/server/services/settings'
import { ForbiddenError, ValidationError, NotFoundError } from '@/server/errors'

setupTestDb()

async function getCtx(userId: string) {
  const member = await testDb.companyMember.findFirst({
    where: { userId },
    select: { companyId: true, role: true },
  })
  if (!member) throw new Error('No member found')
  return { userId, companyId: member.companyId, role: member.role } as {
    userId: string
    companyId: string
    role: 'OWNER' | 'ADMIN' | 'RECRUITER'
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache()
})

// Seed settings that the service reads via getSetting
async function seedSettings(overrides?: { maxMembers?: number; maxInvitesPerDay?: number }) {
  const maxMembers = overrides?.maxMembers ?? 3
  const maxInvitesPerDay = overrides?.maxInvitesPerDay ?? 3
  await testDb.systemSetting.upsert({
    where: { key: 'team.maxMembers' },
    create: { key: 'team.maxMembers', value: JSON.stringify(maxMembers) },
    update: { value: JSON.stringify(maxMembers) },
  })
  await testDb.systemSetting.upsert({
    where: { key: 'team.maxInvitesPerDay' },
    create: { key: 'team.maxInvitesPerDay', value: JSON.stringify(maxInvitesPerDay) },
    update: { value: JSON.stringify(maxInvitesPerDay) },
  })
}

describe('inviteMember', () => {
  it('OWNER can invite a new member', async () => {
    await seedSettings()
    const { userId } = await createEmployer(testDb)
    const ctx = await getCtx(userId)

    const result = await inviteMember(ctx, { email: 'new@example.test', role: 'RECRUITER' })
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(20)

    // token hash stored, plaintext not in DB
    const invite = await testDb.companyInvite.findFirst({ where: { companyId: ctx.companyId } })
    expect(invite).toBeTruthy()
    expect(invite!.tokenHash).not.toBe(result.token)
    expect(invite!.email).toBe('new@example.test')
  })

  it('RECRUITER cannot invite members', async () => {
    await seedSettings()
    const { userId } = await createEmployer(testDb)
    await testDb.companyMember.updateMany({ where: { userId }, data: { role: 'RECRUITER' } })
    const ctx = await getCtx(userId)

    await expect(
      inviteMember(ctx, { email: 'x@example.test', role: 'RECRUITER' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects when team already at max members', async () => {
    await seedSettings({ maxMembers: 1, maxInvitesPerDay: 10 })
    const { userId } = await createEmployer(testDb)
    const ctx = await getCtx(userId)

    await expect(
      inviteMember(ctx, { email: 'x@example.test', role: 'RECRUITER' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects invite to existing member email', async () => {
    await seedSettings()
    const { userId, email } = await createEmployer(testDb)
    const ctx = await getCtx(userId)

    await expect(
      inviteMember(ctx, { email, role: 'RECRUITER' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('enforces daily invite limit', async () => {
    await seedSettings({ maxMembers: 10, maxInvitesPerDay: 2 })
    const { userId } = await createEmployer(testDb)
    const ctx = await getCtx(userId)

    await inviteMember(ctx, { email: 'a1@example.test', role: 'RECRUITER' })
    await inviteMember(ctx, { email: 'a2@example.test', role: 'RECRUITER' })
    await expect(
      inviteMember(ctx, { email: 'a3@example.test', role: 'RECRUITER' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('acceptInvite', () => {
  it('valid token adds member and writes audit', async () => {
    await seedSettings()
    const { userId: ownerUserId, companyId } = await createEmployer(testDb)
    const ownerCtx = await getCtx(ownerUserId)

    // Create invited user
    const invitedUser = await testDb.user.create({
      data: {
        name: 'Invited',
        email: 'invited@example.test',
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })

    const { token } = await inviteMember(ownerCtx, { email: 'invited@example.test', role: 'ADMIN' })
    await acceptInvite({ userId: invitedUser.id }, token)

    const member = await testDb.companyMember.findFirst({
      where: { userId: invitedUser.id, companyId },
    })
    expect(member).toBeTruthy()
    expect(member!.role).toBe('ADMIN')

    // invite marked as accepted
    const invite = await testDb.companyInvite.findFirst({ where: { companyId } })
    expect(invite!.acceptedAt).not.toBeNull()

    // audit written
    const audit = await testDb.auditLog.findFirst({ where: { action: 'company.invite.accept' } })
    expect(audit).toBeTruthy()
  })

  it('rejects expired token', async () => {
    await seedSettings()
    const { userId: ownerUserId } = await createEmployer(testDb)
    const ownerCtx = await getCtx(ownerUserId)
    const { token } = await inviteMember(ownerCtx, { email: 'exp@example.test', role: 'RECRUITER' })

    // Expire the invite
    await testDb.companyInvite.updateMany({
      where: { companyId: ownerCtx.companyId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const invitedUser = await testDb.user.create({
      data: { name: 'User', email: 'exp@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await expect(acceptInvite({ userId: invitedUser.id }, token)).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects already-used token', async () => {
    await seedSettings()
    const { userId: ownerUserId } = await createEmployer(testDb)
    const ownerCtx = await getCtx(ownerUserId)
    const { token } = await inviteMember(ownerCtx, { email: 'used@example.test', role: 'RECRUITER' })

    const invitedUser = await testDb.user.create({
      data: { name: 'User', email: 'used@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await acceptInvite({ userId: invitedUser.id }, token)

    // Second accept with same token → already used
    await expect(acceptInvite({ userId: invitedUser.id }, token)).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects when user email does not match invite email', async () => {
    await seedSettings()
    const { userId: ownerUserId } = await createEmployer(testDb)
    const ownerCtx = await getCtx(ownerUserId)
    const { token } = await inviteMember(ownerCtx, { email: 'correct@example.test', role: 'RECRUITER' })

    const wrongUser = await testDb.user.create({
      data: { name: 'Wrong', email: 'wrong@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await expect(acceptInvite({ userId: wrongUser.id }, token)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects unverified email', async () => {
    await seedSettings()
    const { userId: ownerUserId } = await createEmployer(testDb)
    const ownerCtx = await getCtx(ownerUserId)
    const { token } = await inviteMember(ownerCtx, { email: 'unverf@example.test', role: 'RECRUITER' })

    const unverified = await testDb.user.create({
      data: { name: 'Unverified', email: 'unverf@example.test', emailVerified: false, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await expect(acceptInvite({ userId: unverified.id }, token)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects fake token', async () => {
    const user = await testDb.user.create({
      data: { name: 'User', email: 'faketoken@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await expect(acceptInvite({ userId: user.id }, 'invalid_token')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejects invite to company B when user already belongs to company A → ValidationError', async () => {
    await seedSettings({ maxMembers: 10, maxInvitesPerDay: 10 })

    // Company A owner invites userInA
    const { userId: ownerA } = await createEmployer(testDb)
    const ctxA = await getCtx(ownerA)
    const userInA = await testDb.user.create({
      data: { name: 'InA', email: 'ina@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    const { token: tokenA } = await inviteMember(ctxA, { email: 'ina@example.test', role: 'ADMIN' })
    await acceptInvite({ userId: userInA.id }, tokenA)

    // Company B owner tries to invite the same user
    const { userId: ownerB } = await createEmployer(testDb)
    const ctxB = await getCtx(ownerB)
    const { token: tokenB } = await inviteMember(ctxB, { email: 'ina@example.test', role: 'RECRUITER' })

    // userInA accepting company B invite must be rejected
    await expect(
      acceptInvite({ userId: userInA.id }, tokenB)
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('removeMember', () => {
  it('OWNER can remove ADMIN/RECRUITER', async () => {
    await seedSettings()
    const { userId: ownerUserId, companyId } = await createEmployer(testDb)
    const ownerCtx = await getCtx(ownerUserId)

    // Add an ADMIN member directly
    const admin = await testDb.user.create({
      data: { name: 'Admin', email: 'admin@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    const adminMember = await testDb.companyMember.create({
      data: { companyId, userId: admin.id, role: 'ADMIN' },
    })

    await removeMember(ownerCtx, { memberId: adminMember.id })
    const gone = await testDb.companyMember.findUnique({ where: { id: adminMember.id } })
    expect(gone).toBeNull()
  })

  it('cannot remove OWNER', async () => {
    await seedSettings()
    const { userId: ownerUserId, companyId } = await createEmployer(testDb)
    const ownerCtx = await getCtx(ownerUserId)

    const ownerMember = await testDb.companyMember.findFirst({ where: { userId: ownerUserId, companyId } })
    await expect(
      removeMember(ownerCtx, { memberId: ownerMember!.id }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('RECRUITER cannot remove members', async () => {
    await seedSettings()
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.companyMember.updateMany({ where: { userId }, data: { role: 'RECRUITER' } })
    const ctx = await getCtx(userId)

    const other = await testDb.user.create({
      data: { name: 'Other', email: 'other@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    const m = await testDb.companyMember.create({ data: { companyId, userId: other.id, role: 'ADMIN' } })
    await expect(removeMember(ctx, { memberId: m.id })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('cannot remove member of another company', async () => {
    await seedSettings()
    const { userId: ownerA } = await createEmployer(testDb)
    const ctxA = await getCtx(ownerA)
    const { userId: ownerB, companyId: companyB } = await createEmployer(testDb)

    const memberB = await testDb.companyMember.findFirst({ where: { companyId: companyB } })
    await expect(
      removeMember(ctxA, { memberId: memberB!.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('changeRole', () => {
  it('OWNER can change ADMIN to RECRUITER', async () => {
    await seedSettings()
    const { userId: ownerUserId, companyId } = await createEmployer(testDb)
    const ownerCtx = await getCtx(ownerUserId)

    const admin = await testDb.user.create({
      data: { name: 'Admin', email: 'admin2@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    const adminMember = await testDb.companyMember.create({
      data: { companyId, userId: admin.id, role: 'ADMIN' },
    })

    await changeRole(ownerCtx, { memberId: adminMember.id, role: 'RECRUITER' })
    const updated = await testDb.companyMember.findUnique({ where: { id: adminMember.id } })
    expect(updated!.role).toBe('RECRUITER')
  })

  it('ADMIN cannot change roles', async () => {
    await seedSettings()
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.companyMember.updateMany({ where: { userId }, data: { role: 'ADMIN' } })
    const ctx = await getCtx(userId)

    const r = await testDb.user.create({
      data: { name: 'R', email: 'r@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    const rm = await testDb.companyMember.create({ data: { companyId, userId: r.id, role: 'RECRUITER' } })
    await expect(changeRole(ctx, { memberId: rm.id, role: 'ADMIN' })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('cannot change OWNER role', async () => {
    await seedSettings()
    const { userId: ownerUserId, companyId } = await createEmployer(testDb)
    const ownerCtx = await getCtx(ownerUserId)

    const ownerMember = await testDb.companyMember.findFirst({ where: { userId: ownerUserId, companyId } })
    await expect(
      changeRole(ownerCtx, { memberId: ownerMember!.id, role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('listTeamMembers', () => {
  it('returns all members', async () => {
    await seedSettings()
    const { userId, companyId } = await createEmployer(testDb)
    const ctx = await getCtx(userId)

    const r = await testDb.user.create({
      data: { name: 'Rec', email: 'rec@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await testDb.companyMember.create({ data: { companyId, userId: r.id, role: 'RECRUITER' } })

    const members = await listTeamMembers(ctx)
    expect(members.length).toBe(2)
    const roles = members.map(m => m.role)
    expect(roles).toContain('OWNER')
    expect(roles).toContain('RECRUITER')
  })
})

describe('getInviteDetails', () => {
  it('returns details for valid token', async () => {
    await seedSettings()
    const { userId } = await createEmployer(testDb)
    const ctx = await getCtx(userId)
    const { token } = await inviteMember(ctx, { email: 'detail@example.test', role: 'ADMIN' })

    const details = await getInviteDetails(token)
    expect(details).not.toBeNull()
    expect(details!.email).toBe('detail@example.test')
    expect(details!.role).toBe('ADMIN')
  })

  it('returns null for invalid token', async () => {
    const details = await getInviteDetails('notavalidtoken')
    expect(details).toBeNull()
  })

  it('returns null for expired token', async () => {
    await seedSettings()
    const { userId } = await createEmployer(testDb)
    const ctx = await getCtx(userId)
    const { token } = await inviteMember(ctx, { email: 'exp2@example.test', role: 'RECRUITER' })

    await testDb.companyInvite.updateMany({
      where: { companyId: ctx.companyId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const details = await getInviteDetails(token)
    expect(details).toBeNull()
  })
})
