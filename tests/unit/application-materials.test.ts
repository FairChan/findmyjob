import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'

const contactExists = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/contact-access', () => ({ hasStudentContactTx: contactExists }))

import { requireApplicationMaterialsTx } from '@/server/services/application-materials'
import { getApplicationBlocker } from '@/lib/application-readiness'

const resumeLookup = vi.fn()
const tx = { resumeFile: { findFirst: resumeLookup } } as unknown as Prisma.TransactionClient

beforeEach(() => {
  vi.resetAllMocks()
  contactExists.mockResolvedValue(true)
  resumeLookup.mockResolvedValue({ id: 'primary-resume' })
})

describe('application readiness', () => {
  it.each([
    [false, false, 100, 'contactAndResume'],
    [false, true, 100, 'contact'],
    [true, false, 100, 'resume'],
    [true, true, 59, 'profile'],
    [true, true, 60, null],
  ] as const)('contact=%s, resume=%s, completeness=%s => %s', (hasContact, hasResume, completeness, expected) => {
    expect(getApplicationBlocker({ hasContact, hasResume, completeness }, 60)).toBe(expected)
  })
})

describe('required application materials', () => {
  it('rejects a missing contact even when the student has a resume', async () => {
    contactExists.mockResolvedValue(false)
    await expect(requireApplicationMaterialsTx(tx, 'student')).rejects.toMatchObject({ code: 'CONTACT_REQUIRED' })
  })

  it('rejects a missing resume', async () => {
    resumeLookup.mockResolvedValue(null)
    await expect(requireApplicationMaterialsTx(tx, 'student')).rejects.toMatchObject({ code: 'RESUME_REQUIRED' })
  })

  it('returns the primary owned resume when no resume was selected', async () => {
    await expect(requireApplicationMaterialsTx(tx, 'student')).resolves.toBe('primary-resume')
    expect(resumeLookup).toHaveBeenCalledWith({
      where: { studentId: 'student' },
      select: { id: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    })
  })

  it('limits an explicit resume selection to the authenticated student', async () => {
    await requireApplicationMaterialsTx(tx, 'student', 'selected-resume')
    expect(resumeLookup.mock.calls[0][0].where).toEqual({ id: 'selected-resume', studentId: 'student' })
  })

  it('rejects a deleted or another student’s selected resume', async () => {
    resumeLookup.mockResolvedValue(null)
    await expect(requireApplicationMaterialsTx(tx, 'student', 'other-resume')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
