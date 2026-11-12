'use server'

import { action } from '@/server/action'
import {
  resumeParseConsentSchema, requestResumeParseSchema, resumeIdSchema,
  confirmResumeParseSchema, discardResumeParseSchema,
} from '@/server/schemas/resume-parsing'
import {
  setResumeParseConsent, requestResumeParse, getResumeParseDraft,
  confirmResumeParse, discardResumeParseDraft,
} from '@/server/services/resume-parsing'

export const setResumeParseConsentAction = action(
  { auth: 'student', input: resumeParseConsentSchema },
  async ctx => setResumeParseConsent({ userId: ctx.userId! }, ctx.input),
)

export const requestResumeParseAction = action(
  { auth: 'student', input: requestResumeParseSchema },
  async ctx => requestResumeParse({ userId: ctx.userId! }, ctx.input),
)

export const getResumeParseDraftAction = action(
  { auth: 'student', input: resumeIdSchema },
  async ctx => getResumeParseDraft({ userId: ctx.userId! }, ctx.input),
)

export const confirmResumeParseAction = action(
  { auth: 'student', input: confirmResumeParseSchema },
  async ctx => confirmResumeParse({ userId: ctx.userId! }, ctx.input),
)

export const discardResumeParseDraftAction = action(
  { auth: 'student', input: discardResumeParseSchema },
  async ctx => {
    await discardResumeParseDraft({ userId: ctx.userId! }, ctx.input)
    return {}
  },
)
