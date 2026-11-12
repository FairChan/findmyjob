import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@/server/services/contact-access', async (original) => ({
  ...(await original()),
  canSeeIdentity: vi.fn(),
}))
vi.mock('@/server/services/notify', () => ({
  sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/server/lib/alert', () => ({ alert: vi.fn() }))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createJob } from '../factories'
import { seedApplicationMaterials } from '../helpers/application-materials'
import { acceptInvitation, declineInvitation } from '@/server/services/invitations'
import { canSeeIdentity } from '@/server/services/contact-access'
import { clearSettingsCache } from '@/server/services/settings'
import { maskName } from '@/lib/mask-name'

setupTestDb()

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache()
  vi.mocked(canSeeIdentity).mockResolvedValue(false)
})

async function invitationFixture() {
  const employer = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: employer.companyId }, data: { verificationStatus: 'VERIFIED' },
  })
  const job = await createJob(testDb, employer.companyId, employer.userId, { status: 'PUBLISHED' })
  const student = await createStudent(testDb, { name: 'Mira Sentinel', completeness: 80 })
  await seedApplicationMaterials(testDb, student.profileId)
  await testDb.studentProfile.update({
    where: { id: student.profileId },
    data: { headline: 'Contact me: notification-gate@example.test' },
  })
  const invitation = await testDb.invitation.create({
    data: {
      companyId: employer.companyId, jobId: job.id, studentId: student.profileId,
      sentById: employer.userId, expiresAt: new Date(Date.now() + 86_400_000),
    },
  })
  return { employer, student, invitation }
}

describe('M4-T17: production invitation notification uses the identity gate', () => {
  it.each([false, true])('acceptance reveals the name only when canSeeIdentity=%s', async (allowed) => {
    const { employer, student, invitation } = await invitationFixture()
    vi.mocked(canSeeIdentity).mockResolvedValue(allowed)

    await acceptInvitation({ userId: student.userId }, { invitationId: invitation.id })

    // A real APPLICATION unlock exists in either case. It cannot replace the
    // current identity gate when constructing this production notification.
    expect(await testDb.talentUnlock.findUnique({
      where: { companyId_studentId: { companyId: employer.companyId, studentId: student.profileId } },
      select: { source: true },
    })).toEqual({ source: 'APPLICATION' })
    expect(canSeeIdentity).toHaveBeenCalledExactlyOnceWith(employer.companyId, student.profileId)
    const notification = await testDb.notification.findFirst({
      where: { userId: employer.userId, type: 'invitation.accepted' },
    })
    expect(notification).not.toBeNull()
    const payload = notification!.payload as { student: { name: string; headline: string | null } }
    expect(payload.student.name).toBe(allowed ? student.name : maskName(student.name))
    expect(JSON.stringify(payload)).not.toContain('notification-gate@example.test')
  })

  it('decline stays masked even if the identity gate would allow revealing the name', async () => {
    const { employer, student, invitation } = await invitationFixture()
    vi.mocked(canSeeIdentity).mockResolvedValue(true)

    await declineInvitation({ userId: student.userId }, { invitationId: invitation.id })

    const notification = await testDb.notification.findFirst({
      where: { userId: employer.userId, type: 'invitation.declined' },
    })
    expect(notification).not.toBeNull()
    const payload = notification!.payload as { student: { name: string } }
    expect(payload.student.name).toBe(maskName(student.name))
    expect(canSeeIdentity).not.toHaveBeenCalled()
    expect(JSON.stringify(payload)).not.toContain('notification-gate@example.test')
  })
})
