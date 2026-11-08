'use server'

import { z } from 'zod'
import { action } from '@/server/action'
import {
  createPartner,
  updatePartner,
  deletePartner,
  createPartnerSchema,
  updatePartnerSchema,
} from '@/server/services/admin-schools-partners'

export const createPartnerAction = action(
  {
    auth: 'admin',
    input: createPartnerSchema,
  },
  async (ctx) => {
    return createPartner({ userId: ctx.userId! }, ctx.input)
  },
)

const updatePartnerInput = z.object({
  id: z.string().cuid(),
  data: updatePartnerSchema,
})

export const updatePartnerAction = action(
  {
    auth: 'admin',
    input: updatePartnerInput,
  },
  async (ctx) => {
    await updatePartner({ userId: ctx.userId! }, ctx.input.id, ctx.input.data)
  },
)

const deletePartnerInput = z.object({
  id: z.string().cuid(),
})

export const deletePartnerAction = action(
  {
    auth: 'admin',
    input: deletePartnerInput,
  },
  async (ctx) => {
    await deletePartner({ userId: ctx.userId! }, ctx.input.id)
  },
)
