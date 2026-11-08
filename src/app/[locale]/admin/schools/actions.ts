'use server'

import { z } from 'zod'
import { action } from '@/server/action'
import {
  createSchool,
  updateSchool,
  createSchoolSchema,
  updateSchoolSchema,
} from '@/server/services/admin-schools-partners'

export const createSchoolAction = action(
  {
    auth: 'admin',
    input: createSchoolSchema,
  },
  async (ctx) => {
    return createSchool({ userId: ctx.userId! }, ctx.input)
  },
)

const updateSchoolInput = z.object({
  id: z.string().cuid(),
  data: updateSchoolSchema,
})

export const updateSchoolAction = action(
  {
    auth: 'admin',
    input: updateSchoolInput,
  },
  async (ctx) => {
    await updateSchool({ userId: ctx.userId! }, ctx.input.id, ctx.input.data)
  },
)
