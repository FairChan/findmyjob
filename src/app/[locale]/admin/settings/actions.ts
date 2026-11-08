'use server'

import { z } from 'zod'
import { action } from '@/server/action'
import { updateSettingAdmin } from '@/server/services/admin-settings'

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
