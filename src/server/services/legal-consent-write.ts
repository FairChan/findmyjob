import 'server-only'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { ValidationError } from '../errors'
import { getSetting } from './settings'

// All TERMS/PRIVACY appenders share the sender's source lock. Allocate a
// monotonic timestamp so same-millisecond revoke/regrant cannot reverse order.
export async function prepareLegalConsentWriteTx(tx: Prisma.TransactionClient, userId: string, defaultVersion = '2026-11-draft') {
  await lockXact(tx, LOCK_NS.STUDENT_DATA, userId)
  const parsed = z.string().min(1).max(100).safeParse(await getSetting<unknown>('legal.currentVersion', defaultVersion, { tx, fresh: true }))
  if (!parsed.success) throw new ValidationError('Legal version unavailable')
  const [latest, [clock]] = await Promise.all([
    tx.consent.findFirst({ where: { userId, type: { in: ['TERMS', 'PRIVACY'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { createdAt: true } }),
    tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`,
  ])
  return { version: parsed.data, createdAt: new Date(Math.max(clock.now.getTime(), (latest?.createdAt.getTime() ?? 0) + 1)) }
}
