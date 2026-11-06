/**
 * Unit tests for contact actions (M2-T13 item 1).
 * Verifies updateOwnContactAction calls updateOwnContact then recalcOwnCompleteness.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/env', () => ({ env: {} }))

const mockRequireStudent = vi.hoisted(() => vi.fn())
const mockSafeParse = vi.hoisted(() => vi.fn())
const mockUpdateOwnContact = vi.hoisted(() => vi.fn())
const mockRecalcOwnCompleteness = vi.hoisted(() => vi.fn())

vi.mock('@/server/authz', () => ({
  requireStudent: mockRequireStudent,
}))

vi.mock('@/server/services/contact-access', () => ({
  updateContactSchema: { safeParse: mockSafeParse },
  getOwnContact: vi.fn(),
  updateOwnContact: mockUpdateOwnContact,
}))

vi.mock('@/server/services/student-profile', () => ({
  recalcOwnCompleteness: mockRecalcOwnCompleteness,
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

import { updateOwnContactAction } from '@/server/actions/contact'

const contactInput = {
  phone: '+60 12-000 0420',
  contactEmail: null,
  whatsapp: null,
  wechat: null,
  linkedin: null,
}

describe('updateOwnContactAction — calls recalcOwnCompleteness after updateOwnContact (M2-T13 item 1)', () => {
  beforeEach(() => {
    mockRequireStudent.mockResolvedValue({ userId: 'u1' })
    mockSafeParse.mockImplementation((v: unknown) => ({ success: true, data: v }))
    mockUpdateOwnContact.mockResolvedValue(undefined)
    mockRecalcOwnCompleteness.mockResolvedValue(undefined)
  })

  it('calls updateOwnContact then recalcOwnCompleteness in order', async () => {
    const callOrder: string[] = []
    mockUpdateOwnContact.mockImplementation(async () => {
      callOrder.push('updateOwnContact')
    })
    mockRecalcOwnCompleteness.mockImplementation(async () => {
      callOrder.push('recalcOwnCompleteness')
    })

    const result = await updateOwnContactAction(contactInput)

    expect(result).toEqual({ ok: true, data: {} })
    expect(callOrder).toEqual(['updateOwnContact', 'recalcOwnCompleteness'])
  })

  it('recalcOwnCompleteness is called with correct userId', async () => {
    await updateOwnContactAction(contactInput)
    expect(mockRecalcOwnCompleteness).toHaveBeenCalledOnce()
    expect(mockRecalcOwnCompleteness).toHaveBeenCalledWith({ userId: 'u1' })
  })
})
