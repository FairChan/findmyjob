/**
 * Unit tests for contact actions (M2-T13 item 1).
 * Verifies delegation to the contact service, which owns atomic completeness and matching updates.
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

describe('updateOwnContactAction — delegates atomic contact updates to the service (M2-T13 item 1)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequireStudent.mockResolvedValue({ userId: 'u1' })
    mockSafeParse.mockImplementation((v: unknown) => ({ success: true, data: v }))
    mockUpdateOwnContact.mockResolvedValue(undefined)
    mockRecalcOwnCompleteness.mockResolvedValue(undefined)
  })

  it('calls the contact service once without a second standalone completeness update', async () => {
    const result = await updateOwnContactAction(contactInput)

    expect(result).toEqual({ ok: true, data: {} })
    expect(mockUpdateOwnContact).toHaveBeenCalledOnce()
    expect(mockRecalcOwnCompleteness).not.toHaveBeenCalled()
  })

  it('passes the authenticated student and parsed input to the contact service', async () => {
    const parsedInput = { ...contactInput, phone: '+60120000420' }
    mockSafeParse.mockReturnValueOnce({ success: true, data: parsedInput })
    await updateOwnContactAction(contactInput)
    expect(mockRequireStudent).toHaveBeenCalledOnce()
    expect(mockSafeParse).toHaveBeenCalledExactlyOnceWith(contactInput)
    expect(mockUpdateOwnContact).toHaveBeenCalledExactlyOnceWith({ userId: 'u1' }, parsedInput)
    expect(mockRecalcOwnCompleteness).not.toHaveBeenCalled()
  })
})
