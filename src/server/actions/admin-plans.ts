'use server'

import { action } from '@/server/action'
import {
  createPlan, createPlanSchema, updatePlan, updatePlanSchema, deletePlan, deletePlanSchema,
} from '@/server/services/admin-plans'

export const createPlanAction = action(
  { auth: 'admin', input: createPlanSchema },
  async ctx => createPlan({ userId: ctx.userId! }, ctx.input),
)

export const updatePlanAction = action(
  { auth: 'admin', input: updatePlanSchema },
  async ctx => updatePlan({ userId: ctx.userId! }, ctx.input),
)

export const deletePlanAction = action(
  { auth: 'admin', input: deletePlanSchema },
  async ctx => deletePlan({ userId: ctx.userId! }, ctx.input),
)
