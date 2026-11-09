import { describe, expect, it } from 'vitest'
import {
  bankTransferSettingsSchema, foundingOfferSettingsSchema,
  EMPTY_BANK_TRANSFER, DEFAULT_FOUNDING_OFFER,
} from '@/server/lib/billing-settings'

const bank = {
  bankName: 'SYNTHETIC BANK', accountName: 'SYNTHETIC ACCOUNT',
  accountNumber: '0012-0000 0034', instructions: 'TEST ONLY',
}
const offer = {
  ...DEFAULT_FOUNDING_OFFER, enabled: true,
  eligiblePlanCodes: ['STANDARD_Y'], eligibleCompanyIds: ['synthetic-company'],
  startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z',
}

describe('billing configuration input boundaries', () => {
  it('keeps leading zeros and internal account separators while trimming edges', () => {
    expect(bankTransferSettingsSchema.parse({ ...bank, accountNumber: '  ' + bank.accountNumber + '  ' }))
      .toEqual(bank)
    expect(bankTransferSettingsSchema.parse(EMPTY_BANK_TRANSFER)).toEqual(EMPTY_BANK_TRANSFER)
  })
  it.each(['bankName', 'accountName', 'accountNumber'] as const)('rejects a missing %s', key => {
    expect(bankTransferSettingsSchema.safeParse({ ...bank, [key]: '' }).success).toBe(false)
  })
  it('rejects instructions without any account', () => {
    expect(bankTransferSettingsSchema.safeParse({ ...EMPTY_BANK_TRANSFER, instructions: 'SYNTHETIC' }).success).toBe(false)
  })
  it.each([
    { ...bank, accountNumber: 123 },
    { ...bank, instructions: 'x'.repeat(1001) },
    { ...bank, accountNumber: 'x'.repeat(81) },
    { ...bank, extra: true },
  ])('rejects malformed bank configuration %#', value => {
    expect(bankTransferSettingsSchema.safeParse(value).success).toBe(false)
  })
  it('defaults the founding offer to disabled and accepts a complete reviewed policy', () => {
    expect(foundingOfferSettingsSchema.parse(DEFAULT_FOUNDING_OFFER).enabled).toBe(false)
    expect(foundingOfferSettingsSchema.parse(offer)).toEqual(offer)
  })
  it.each([
    { ...offer, eligiblePlanCodes: [] },
    { ...offer, eligibleCompanyIds: [] },
    { ...offer, startsAt: null },
    { ...offer, endsAt: offer.startsAt },
    { ...offer, endsAt: '2025-01-01T00:00:00.000Z' },
    { ...offer, rateBps: 10001 },
    { ...offer, rateBps: 5000.5 },
    { ...offer, enabled: 'true' },
    { ...offer, version: '' },
    { ...offer, extra: true },
  ])('rejects an incomplete or malformed offer %#', value => {
    expect(foundingOfferSettingsSchema.safeParse(value).success).toBe(false)
  })
})
