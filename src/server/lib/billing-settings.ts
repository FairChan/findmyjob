import { z } from 'zod'

export const BANK_TRANSFER_LIMITS = {
  bankName: 160,
  accountName: 200,
  accountNumber: 80,
  instructions: 1000,
} as const

export const EMPTY_BANK_TRANSFER = {
  bankName: '', accountName: '', accountNumber: '', instructions: '',
}

export const bankTransferSettingsSchema = z.object({
  bankName: z.string().trim().max(BANK_TRANSFER_LIMITS.bankName),
  accountName: z.string().trim().max(BANK_TRANSFER_LIMITS.accountName),
  accountNumber: z.string().trim().max(BANK_TRANSFER_LIMITS.accountNumber),
  instructions: z.string().trim().max(BANK_TRANSFER_LIMITS.instructions),
}).strict().refine(value => {
  const required = [value.bankName, value.accountName, value.accountNumber]
  return required.every(Boolean) || Object.values(value).every(field => field === '')
}, { message: 'Provide all required bank fields or clear the configuration' })

export type BankTransferSettings = z.infer<typeof bankTransferSettingsSchema>

export const DEFAULT_FOUNDING_OFFER = {
  enabled: false,
  version: 'v1',
  rateBps: 5000,
  eligiblePlanCodes: [] as string[],
  eligibleCompanyIds: [] as string[],
  startsAt: null,
  endsAt: null,
}

export const foundingOfferSettingsSchema = z.object({
  enabled: z.boolean(),
  version: z.string().trim().min(1).max(100),
  rateBps: z.number().int().min(1).max(9999),
  eligiblePlanCodes: z.array(z.string().min(1).max(64)).max(100),
  eligibleCompanyIds: z.array(z.string().min(1).max(64)).max(10000),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && (!value.startsAt || !value.endsAt ||
    value.eligiblePlanCodes.length === 0 || value.eligibleCompanyIds.length === 0)) {
    ctx.addIssue({ code: 'custom', message: 'An active offer requires a window and reviewed allowlists' })
  }
  if (value.startsAt && value.endsAt && Date.parse(value.startsAt) >= Date.parse(value.endsAt)) {
    ctx.addIssue({ code: 'custom', message: 'The offer must end after it starts' })
  }
})

export type FoundingOfferSettings = z.infer<typeof foundingOfferSettingsSchema>
