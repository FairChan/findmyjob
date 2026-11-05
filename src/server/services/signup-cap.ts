import 'server-only'
import { db } from '../db'
import { getSetting } from './settings'
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
export async function maybeWarnCap(): Promise<void> {
  const [cap, warnRatio, count] = await Promise.all([
    getSetting<number>('signup.studentCap', 3000),
    getSetting<number>('signup.warnRatio', 0.9),
    countVerifiedStudents(),
  ])
  const threshold = Math.floor(cap * warnRatio)
  if (count >= threshold) {
    alert('signup.cap.warn', { count, cap, threshold })
  }
}

export async function purgeUnverifiedAccounts(): Promise<number> {
  const ttlHours = await getSetting<number>('signup.unverifiedTtlHours', 48)
  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000)

  const result = await db.user.deleteMany({
    where: {
      role: 'STUDENT',
      emailVerified: false,
      createdAt: { lt: cutoff },
    },
  })
  return result.count
}
