'use server'
import { action } from '@/server/action'
import {
  updateContactSchema,
  getOwnContact,
  updateOwnContact,
} from '@/server/services/contact-access'
import { recalcOwnCompleteness } from '@/server/services/student-profile'

export const getOwnContactAction = action({ auth: 'student' }, async ({ userId }) => {
  const contact = await getOwnContact({ userId: userId! })
  return { contact }
})

export const updateOwnContactAction = action(
  { auth: 'student', input: updateContactSchema },
  async ({ userId, input }) => {
    await updateOwnContact({ userId: userId! }, input)
    await recalcOwnCompleteness({ userId: userId! })
    return {}
  },
)
