import { NextRequest } from 'next/server'
// Isolate only the human publication prerequisite, preserving actual state/provider seams.
vi.mock('@/server/lib/marketing-disclosure', () => ({ isMarketingDisclosurePublished: vi.fn().mockResolvedValue(true) }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic-queue-job') } }))
vi.mock('@/lib/email', async original => ({ ...await original<typeof import('@/lib/email')>(), createEmailProvider: () => ({ sendEmail: vi.fn(() => { throw new Error('No mail allowed in unsubscribe tests') }) }) }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn(() => { throw new Error('No real AI in unsubscribe tests') }) }))
vi.mock('@/server/lib/semantic-store', () => ({
  isSemanticStoreAvailable: vi.fn().mockResolvedValue(true), writeSemanticVector: vi.fn(), deleteSemanticVector: vi.fn(),
  findTalentNeighbors: vi.fn().mockResolvedValue([]), findJobNeighbors: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model', MARKETING_UNSUBSCRIBE_SECRET: 't'.repeat(48) } }
})

import { setupTestDb, testDb } from '../setup/db'
import { seedT04Gate, t04StudentRecipient, t04EmployerRecipient } from '../helpers/weekly-digest-t04'
import { createMarketingUnsubscribeToken } from '@/server/lib/marketing-unsubscribe'
import { clearSettingsCache } from '@/server/services/settings'
import { recordConsents } from '@/server/services/consent'
import { GET, POST } from '@/app/api/marketing/unsubscribe/route'

setupTestDb()
beforeEach(async () => { vi.clearAllMocks(); clearSettingsCache(); await seedT04Gate() })
function post(token: string, extras: Record<string, string> = {}) {
  return POST(new NextRequest('https://weekly.example.test/api/marketing/unsubscribe', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, ...extras }),
  }))
}

describe('M9-T04 public unsubscribe and controlled marketing writes', () => {
  it.each(['student', 'employer'] as const)('GET is inert and POST unsubscribes %s without login despite disabled gate/new legal version', async kind => {
    const recipient = kind === 'student' ? await t04StudentRecipient() : await t04EmployerRecipient()
    const token = createMarketingUnsubscribeToken(recipient.userId)
    const before = await testDb.consent.findMany({ where: { userId: recipient.userId } })
    const response = await GET(new NextRequest('https://weekly.example.test/api/marketing/unsubscribe?token=' + encodeURIComponent(token)))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await testDb.consent.findMany({ where: { userId: recipient.userId } })).toEqual(before)
    await testDb.systemSetting.update({ where: { key: 'marketing.weekly' }, data: { value: { enabled: false } } })
    await testDb.systemSetting.update({ where: { key: 'legal.currentVersion' }, data: { value: 'newer-policy' } })
    const first = await post(token)
    expect(first.status).toBe(200)
    const latest = await testDb.consent.findFirstOrThrow({ where: { userId: recipient.userId, type: 'MARKETING' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    expect(latest.granted).toBe(false)
    const after = await testDb.consent.count({ where: { userId: recipient.userId, type: 'MARKETING' } })
    const second = await post(token)
    expect(second.status).toBe(200)
    expect(await second.text()).toBe(await first.text())
    expect(await testDb.consent.count({ where: { userId: recipient.userId, type: 'MARKETING' } })).toBe(after)
    expect(await testDb.consent.findMany({ where: { userId: recipient.userId, type: { not: 'MARKETING' } } })).toEqual(before.filter(row => row.type !== 'MARKETING'))
  })

  it('invalid and unknown-user tokens cannot opt out another recipient or disclose addresses', async () => {
    const recipient = await t04StudentRecipient()
    const original = createMarketingUnsubscribeToken(recipient.userId)
    const unknown = createMarketingUnsubscribeToken('c9999999999999999999999999')
    const bad = (original[0] === 'A' ? 'B' : 'A') + original.slice(1)
    const a = await post(bad), b = await post(unknown)
    expect(a.status).toBe(200); expect(b.status).toBe(200)
    const text = await a.text()
    expect(await b.text()).toBe(text)
    expect(text).not.toContain(recipient.email); expect(text).not.toContain(original)
    expect(await testDb.consent.count({ where: { userId: recipient.userId, type: 'MARKETING', granted: false } })).toBe(0)
  })

  it('does not accept an alternate recipient, opt-in flag or redirect in the unsubscribe request', async () => {
    const a = await t04StudentRecipient(), b = await t04StudentRecipient()
    const response = await post(createMarketingUnsubscribeToken(a.userId), { userId: b.userId, granted: 'true', redirect: 'https://outside.example.test' })
    expect(response.status).toBe(400)
    expect(await testDb.consent.count({ where: { type: 'MARKETING', granted: false } })).toBe(0)
  })

  it('generic consent recording cannot bypass the controlled marketing service', async () => {
    const recipient = await t04StudentRecipient()
    const before = await testDb.consent.count({ where: { userId: recipient.userId, type: 'MARKETING' } })
    await expect(recordConsents(recipient.userId, [{ type: 'MARKETING', granted: true }], {})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(await testDb.consent.count({ where: { userId: recipient.userId, type: 'MARKETING' } })).toBe(before)
  })
})
