import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { getSetting, setSetting } from './settings'
import { SignupClosedError } from '../errors'
import { alert } from '../lib/alert'

async function countVerifiedStudents(): Promise<number> {
  return db.user.count({
    where: {
      role: 'STUDENT',
      status: 'ACTIVE',
      emailVerified: true,
    },
  })
}

export async function assertStudentSignupOpen(): Promise<void> {
  const [cap, count] = await Promise.all([
    getSetting<number>('signup.studentCap', 3000),
    countVerifiedStudents(),
  ])
  if (count >= cap) {
    throw new SignupClosedError()
  }
}

// Call after a new student verifies their email to check if warn threshold is crossed.
// Notifies only once — subsequent calls are no-ops until the flag is reset.
export async function maybeWarnCap(): Promise<void> {
  const [cap, warnRatio, count] = await Promise.all([
    getSetting<number>('signup.studentCap', 3000),
    getSetting<number>('signup.warnRatio', 0.9),
    countVerifiedStudents(),
  ])
  const threshold = Math.floor(cap * warnRatio)
  if (count < threshold) return

  const alreadySent = await getSetting<boolean>('signup.capWarnSent', false)
  if (alreadySent) return

  alert('signup.cap.warn', { count, cap, threshold })
  await setSetting('signup.capWarnSent', true)
}

export async function purgeUnverifiedAccounts(): Promise<number> {
  const rawTtl = await getSetting<unknown>('signup.unverifiedTtlHours', 48)
  const parsed = z.number().int().min(1).safeParse(rawTtl)
  const ttlHours = parsed.success ? parsed.data : 48
  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000)

  const where = {
    role: 'STUDENT' as const,
    emailVerified: false,
    createdAt: { lt: cutoff },
  }

  let total = 0
  let batchSize: number
  do {
    const ids = await db.user.findMany({ where, select: { id: true }, take: 1000 })
    if (ids.length === 0) break
    // Re-apply the original filters to avoid deleting users who verified between findMany and deleteMany.
    const result = await db.user.deleteMany({
      where: {
        id: { in: ids.map((u) => u.id) },
        emailVerified: false,
        createdAt: { lt: cutoff },
      },
    })
    total += result.count
    batchSize = ids.length
  } while (batchSize === 1000)

  return total
}
