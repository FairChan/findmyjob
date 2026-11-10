'use server'

import { z } from 'zod'
import { action } from '@/server/action'
import { matchingGateInputSchema } from '@/schemas/semantic-matching'
import { updateMatchingSettingsAdmin, updateJdAssistantSettingsAdmin, updateSettingAdmin } from '@/server/services/admin-settings'
import { resumeParseGateSchema } from '@/server/schemas/resume-parsing'
import { bankTransferSettingsSchema } from '@/server/lib/billing-settings'
import { invoiceIssuerSettingsSchema } from '@/server/lib/invoice-settings'

const updateSettingInput = z.object({
  key: z.string().min(1).max(100),
  value: z.unknown(),
})

export const updateSettingAction = action(
  {
    auth: 'admin',
    input: updateSettingInput,
  },
  async (ctx) => {
    await updateSettingAdmin({ userId: ctx.userId! }, ctx.input.key, ctx.input.value)
  },
)

export const saveBankTransferSettingsAction = action(
  { auth: 'admin', input: bankTransferSettingsSchema },
  async ctx => updateSettingAdmin({ userId: ctx.userId! }, 'billing.bankTransfer', ctx.input),
)

export const saveInvoiceIssuerSettingsAction = action(
  { auth: 'admin', input: invoiceIssuerSettingsSchema },
  async ctx => updateSettingAdmin({ userId: ctx.userId! }, 'billing.invoiceIssuer', ctx.input),
)

export const saveJdAssistantSettingsAction = action(
  { auth: 'admin-fresh', input: resumeParseGateSchema.omit({ epoch: true }).strict() },
  async ctx => updateJdAssistantSettingsAdmin({ userId: ctx.userId! }, ctx.input),
)

export const saveMatchingSettingsAction = action(
  { auth: 'admin-fresh', input: matchingGateInputSchema },
  async ctx => updateMatchingSettingsAdmin({ userId: ctx.userId! }, ctx.input),
)
