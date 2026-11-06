'use server'
import { action } from '@/server/action'
import {
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  getProfileForOnboarding,
  saveStep1,
  saveStep2,
  saveStep3,
  saveStep4,
} from '@/server/services/student-profile'

export const getOnboardingDataAction = action({ auth: 'student' }, async ({ userId }) => {
  const profile = await getProfileForOnboarding({ userId: userId! })
  return { profile }
})

export const saveStep1Action = action(
  { auth: 'student', input: step1Schema },
  async ({ userId, input }) => {
    await saveStep1({ userId: userId! }, input)
    return {}
  },
)

export const saveStep2Action = action(
  { auth: 'student', input: step2Schema },
  async ({ userId, input }) => {
    await saveStep2({ userId: userId! }, input)
    return {}
  },
)

export const saveStep3Action = action(
  { auth: 'student', input: step3Schema },
  async ({ userId, input }) => {
    await saveStep3({ userId: userId! }, input)
    return {}
  },
)

export const saveStep4Action = action(
  { auth: 'student', input: step4Schema },
  async ({ userId, input }) => {
    await saveStep4({ userId: userId! }, input)
    return {}
  },
)

// Draft variants: save data without advancing onboardingStep (used by "Save and exit")
export const saveStep1DraftAction = action(
  { auth: 'student', input: step1Schema },
  async ({ userId, input }) => {
    await saveStep1({ userId: userId! }, input, { advance: false })
    return {}
  },
)

export const saveStep2DraftAction = action(
  { auth: 'student', input: step2Schema },
  async ({ userId, input }) => {
    await saveStep2({ userId: userId! }, input, { advance: false })
    return {}
  },
)

export const saveStep3DraftAction = action(
  { auth: 'student', input: step3Schema },
  async ({ userId, input }) => {
    await saveStep3({ userId: userId! }, input, { advance: false })
    return {}
  },
)

export const saveStep4DraftAction = action(
  { auth: 'student', input: step4Schema },
  async ({ userId, input }) => {
    await saveStep4({ userId: userId! }, input, { advance: false })
    return {}
  },
)
