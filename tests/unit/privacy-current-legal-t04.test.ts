import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ get: vi.fn(), legal: vi.fn(), user: vi.fn(), profile: vi.fn(), invalidate: vi.fn(), update: vi.fn(), create: vi.fn(), audit: vi.fn() }))
vi.mock('@/server/services/settings', () => ({ getSetting: io.get }))
vi.mock('@/server/services/audit', () => ({ logAudit: io.audit }))
vi.mock('@/server/lib/advisory-locks', () => ({ LOCK_NS: { STUDENT_DATA: 1008 }, lockXact: vi.fn() }))
vi.mock('@/server/db', () => {
  const tx = { user: { findUnique: io.user }, semanticIndex: { updateMany: io.invalidate }, studentProfile: { findUnique: io.profile, update: io.update }, consent: { findFirst: io.legal, create: io.create } }
  return { db: { ...tx, $transaction: (work: ((client: typeof tx) => Promise<void>) | Array<Promise<unknown>>) => typeof work === 'function' ? work(tx) : Promise.all(work) } }
})
import { setVisibility } from '@/server/services/privacy'
beforeEach(() => {
  vi.clearAllMocks()
  io.user.mockResolvedValue({ role: 'STUDENT', status: 'ACTIVE' })
  io.profile.mockResolvedValue({ id: 'profile', visibility: 'HIDDEN' })
  io.invalidate.mockResolvedValue({ count: 0 })
  io.get.mockResolvedValue('current')
  io.legal.mockResolvedValue({ granted: true, version: 'current' })
})
describe('visibility grant after exact withdrawal-page exemption', () => {
  it.each([null, { granted: false, version: 'current' }, { granted: true, version: 'old' }])('blocks fresh grant with legal row %j', async legal => {
    io.legal.mockResolvedValue(legal)
    await expect(setVisibility({ userId: 'owner' }, { granted: true })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(io.update).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled()
  })
  it('checks both latest legal types and fresh transaction version for grant', async () => {
    await setVisibility({ userId: 'owner' }, { granted: true })
    expect(io.get).toHaveBeenCalledWith('legal.currentVersion', null, expect.objectContaining({ fresh: true, tx: expect.anything() }))
    expect(io.legal.mock.calls.map(([query]) => query.where.type).sort()).toEqual(['PRIVACY', 'TERMS'])
    expect(io.update).toHaveBeenCalledWith(expect.objectContaining({ data: { visibility: 'PUBLIC', editRevision: { increment: 1 } } }))
  })
  it.each([null, 7, '', 'changed'])('keeps withdrawal available with legal metadata %s', async version => {
    io.profile.mockResolvedValue({ id: 'profile', visibility: 'PUBLIC' })
    io.get.mockResolvedValue(version)
    io.legal.mockResolvedValue(null)
    await setVisibility({ userId: 'owner' }, { granted: false })
    expect(io.legal).not.toHaveBeenCalled()
    expect(io.update).toHaveBeenCalledWith(expect.objectContaining({ data: { visibility: 'HIDDEN', editRevision: { increment: 1 } } }))
    expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ granted: false }) }))
  })
})
