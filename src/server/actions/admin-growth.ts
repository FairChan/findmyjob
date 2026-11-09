'use server'

import { action } from '@/server/action'
import { voidReferral, voidReferralSchema } from '@/server/services/referrals'
import { saveSynonymGroup, saveSynonymGroupSchema } from '@/server/services/search-synonyms'

export const voidReferralAction = action(
  { auth: 'admin', input: voidReferralSchema },
  async ctx => voidReferral(ctx.input.referralId, ctx.input.reason, ctx.userId!),
)

export const saveSynonymGroupAction = action(
  { auth: 'admin', input: saveSynonymGroupSchema },
  async ctx => saveSynonymGroup({ userId: ctx.userId! }, ctx.input),
)
