'use server'
import { z } from 'zod'
import { action } from '@/server/action'
import { unlockStudent } from '@/server/services/unlock'

const VERIFIED_COMPANY = { type: 'company', verified: true } as const

export const unlockStudentAction = action(
  {
    auth: VERIFIED_COMPANY,
    input: z.object({ studentId: z.string().cuid() }),
  },
  async ({ userId, companyId, input }) => {
    return unlockStudent(
      { userId: userId!, companyId: companyId! },
      input.studentId,
    )
  },
)
