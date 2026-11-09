import 'server-only'
import type { UserCtx } from '../authz'
import { db } from '../db'
import { ForbiddenError } from '../errors'
import { getSetting } from './settings'

export async function getGrowthSummary(
  ctx: UserCtx,
): Promise<{ studentCount: number; signupCap: number }> {
  const actor = await db.user.findUnique({
    where: { id: ctx.userId },
    select: { role: true, status: true },
  })
  if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE') {
    throw new ForbiddenError()
  }

  // Keep the same enrollment definition and cap as signup-cap/admin-dashboard.
  const [studentCount, signupCap] = await Promise.all([
    db.user.count({ where: { role: 'STUDENT', status: 'ACTIVE', emailVerified: true } }),
    getSetting<number>('signup.studentCap', 3000),
  ])
  return { studentCount, signupCap }
}
