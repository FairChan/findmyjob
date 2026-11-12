import { randomUUID } from 'node:crypto'
import { testDb } from '../setup/db'
import { seedT03Gate, t03Student, t03Employer, readyT03Student, readyT03Job, T03_VERSION } from './semantic-matching-t03'
import { setMarketingConsent } from '@/server/services/marketing-consent'
import { scheduleWeeklyDigests } from '@/server/jobs/weekly-digest'
import { getWeeklyDigestWindow } from '@/server/lib/weekly-digest'
import { toJobListItem } from '@/server/serializers/job'
import { toTalentCard } from '@/server/serializers/talent-card'

export async function seedT04Gate() {
  await seedT03Gate()
  const value = { enabled: true, legalVersion: T03_VERSION, epoch: randomUUID() }
  await testDb.systemSetting.upsert({ where: { key: 'marketing.weekly' }, create: { key: 'marketing.weekly', value }, update: { value } })
}
export async function t04StudentRecipient() {
  const student = await t03Student()
  await setMarketingConsent(student, { granted: true, submittedVersion: T03_VERSION })
  return student
}
export async function t04EmployerRecipient() {
  const employer = await t03Employer()
  await setMarketingConsent(employer, { granted: true, submittedVersion: T03_VERSION })
  return employer
}
export async function t04Job(title: string) {
  const employer = await t03Employer()
  const job = await testDb.job.update({ where: { id: employer.jobId }, data: {
    title, description: 'PRIVATE_JOB_BODY', requirements: 'PRIVATE_REQUIREMENTS', salaryVisible: false, salaryMax: 765432,
  }, include: { company: true } })
  await readyT03Job(employer)
  return { employer, item: toJobListItem(job) }
}
export async function t04Talent() {
  const student = await t03Student()
  const profile = await testDb.studentProfile.findUniqueOrThrow({ where: { id: student.profileId }, include: { school: true } })
  await readyT03Student(student)
  return { student, item: toTalentCard(profile, { unlocked: true }) }
}
export async function t04Queued(userId: string) {
  await scheduleWeeklyDigests()
  return testDb.weeklyDigestDelivery.findFirstOrThrow({ where: { userId, weekKey: getWeeklyDigestWindow(new Date()).weekKey } })
}
