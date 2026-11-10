'use server'

import { action } from '@/server/action'
import { matchingConsentSchema, recommendJobsSchema, recommendTalentsSchema } from '@/schemas/semantic-matching'
import { recommendJobs, recommendTalents, setMatchingConsent } from '@/server/services/semantic-matching'

export const recommendJobsAction = action(
  { auth: 'student', input: recommendJobsSchema },
  async ctx => recommendJobs({ userId: ctx.userId! }, ctx.input),
)

export const recommendTalentsAction = action(
  { auth: { type: 'company', minRole: 'RECRUITER', verified: true }, input: recommendTalentsSchema },
  async ctx => recommendTalents({ userId: ctx.userId!, companyId: ctx.companyId! }, ctx.input),
)

export const setMatchingConsentAction = action(
  { auth: 'student', input: matchingConsentSchema },
  async ctx => setMatchingConsent({ userId: ctx.userId! }, ctx.input),
)
