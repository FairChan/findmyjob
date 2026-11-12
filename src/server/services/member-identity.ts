import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { getSession } from '@/server/auth'
import { db } from '@/server/db'

/** Request-local identity for navigation; page/action authorization remains authoritative. */
export const getMemberIdentity = cache(async () => {
  const session = await getSession(await headers())
  if (!session?.user?.id) return null
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, image: true, role: true, status: true },
  })
  return user?.status === 'ACTIVE' ? user : null
})
