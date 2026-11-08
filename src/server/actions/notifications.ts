'use server'
import { z } from 'zod'
import { action } from '@/server/action'
import { db } from '@/server/db'

export const markNotificationsReadAction = action(
  {
    auth: 'student',
    input: z.object({ ids: z.array(z.string().cuid()).min(1).max(50) }),
  },
  async ({ userId, input }) => {
    await db.notification.updateMany({
      where: { userId, id: { in: input.ids }, readAt: null },
      data: { readAt: new Date() },
    })
  },
)

export const markAllNotificationsReadAction = action(
  {
    auth: 'user',
    input: z.object({}),
  },
  async ({ userId }) => {
    await db.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    })
  },
)
