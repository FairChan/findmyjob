import { zipSync, strToU8 } from 'fflate'
import { db } from '../db'
import { getObjectBytes, putObject } from '@/lib/storage'
import { sendNotificationEmail } from '../services/notify'
import { logger } from '../lib/logger'

export async function runExportUserData(payload: { requestId: string; userId: string }): Promise<void> {
  const { requestId, userId } = payload

  const req = await db.dataRequest.findUnique({
    where: { id: requestId },
    select: { id: true, userId: true, status: true },
  })

  if (!req || req.userId !== userId || req.status !== 'OPEN') {
    logger.warn({ requestId }, 'export-user-data: request not found or not OPEN, skipping')
    return
  }

  try {
    const files: Record<string, Uint8Array> = {}

    // ── User basic info ────────────────────────────────────────────────────
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, createdAt: true, locale: true },
    })
    if (!user) return

    files['user.json'] = strToU8(JSON.stringify(user, null, 2))

    // ── StudentProfile ──────────────────────────────────────────────────────
    const profile = await db.studentProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        fullName: true,
        headline: true,
        summary: true,
        degreeLevel: true,
        major: true,
        graduationYear: true,
        graduationMonth: true,
        cgpa: true,
        nationality: true,
        workAuth: true,
        intents: true,
        availableFrom: true,
        preferredStates: true,
        preferredIndustries: true,
        expectedSalaryMin: true,
        expectedSalaryMax: true,
        skills: true,
        visibility: true,
        completeness: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (profile) {
      files['profile.json'] = strToU8(JSON.stringify(profile, null, 2))

      // ── Education ────────────────────────────────────────────────────────
      const educations = await db.education.findMany({
        where: { studentId: profile.id },
        select: { id: true, schoolName: true, degreeLevel: true, major: true, startDate: true, endDate: true, gpa: true, description: true },
        orderBy: { sortOrder: 'asc' },
      })
      files['educations.json'] = strToU8(JSON.stringify(educations, null, 2))

      // ── Experience ────────────────────────────────────────────────────────
      const experiences = await db.experience.findMany({
        where: { studentId: profile.id },
        select: { id: true, kind: true, title: true, organization: true, startDate: true, endDate: true, description: true },
        orderBy: { sortOrder: 'asc' },
      })
      files['experiences.json'] = strToU8(JSON.stringify(experiences, null, 2))

      // ── Languages ────────────────────────────────────────────────────────
      const languages = await db.studentLanguage.findMany({
        where: { studentId: profile.id },
        select: { language: true, level: true },
      })
      files['languages.json'] = strToU8(JSON.stringify(languages, null, 2))

      // ── Applications (student-visible fields only, no companyNote) ────────
      const applications = await db.application.findMany({
        where: { studentId: profile.id },
        select: {
          id: true,
          jobId: true,
          coverNote: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          job: { select: { id: true, title: true } },
          events: {
            select: { id: true, fromStatus: true, toStatus: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      files['applications.json'] = strToU8(JSON.stringify(applications, null, 2))

      // ── Invitations ───────────────────────────────────────────────────────
      const invitations = await db.invitation.findMany({
        where: { studentId: profile.id },
        select: {
          id: true,
          status: true,
          message: true,
          createdAt: true,
          respondedAt: true,
          expiresAt: true,
          job: { select: { id: true, title: true } },
          company: { select: { id: true, legalName: true, displayNameZh: true, displayNameEn: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      files['invitations.json'] = strToU8(JSON.stringify(invitations, null, 2))

      // ── Privacy settings ────────────────────────────────────────────────
      const privacySettings = {
        visibility: profile.visibility,
        blockedCompanies: await db.blockedCompany.findMany({
          where: { studentId: profile.id },
          select: { companyId: true, createdAt: true },
        }),
        consents: await db.consent.findMany({
          where: { userId },
          select: { type: true, version: true, granted: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
      }
      files['privacy.json'] = strToU8(JSON.stringify(privacySettings, null, 2))

      // ── Resume files ──────────────────────────────────────────────────────
      const resumes = await db.resumeFile.findMany({
        where: { studentId: profile.id },
        select: { id: true, storageKey: true, fileName: true, mimeType: true, sizeBytes: true, isPrimary: true, createdAt: true },
      })

      for (const r of resumes) {
        try {
          const bytes = await getObjectBytes(r.storageKey, { maxBytes: 20 * 1024 * 1024 })
          const safeName = r.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
          files[`resumes/${r.id}_${safeName}`] = bytes
        } catch (err) {
          logger.warn({ resumeId: r.id, err }, 'export-user-data: failed to fetch resume, skipping')
        }
      }
    }

    // ── Notifications ────────────────────────────────────────────────────────
    const notifications = await db.notification.findMany({
      where: { userId },
      select: { id: true, type: true, createdAt: true, readAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    files['notifications.json'] = strToU8(JSON.stringify(notifications, null, 2))

    // ── Build zip ────────────────────────────────────────────────────────────
    const zipBuffer = Buffer.from(zipSync(files))
    const storageKey = `exports/${userId}/${requestId}.zip`

    // Upload outside transaction
    await putObject(storageKey, zipBuffer, 'application/zip')

    // Update request
    await db.dataRequest.update({
      where: { id: requestId },
      data: { status: 'DONE', resultKey: storageKey, resolvedAt: new Date() },
    })

    // Send notification email (outside transaction, non-fatal)
    await sendNotificationEmail(userId, { template: 'data-export-ready', requestId })
  } catch (err) {
    logger.error({ requestId, userId, err }, 'export-user-data: failed')
    await db.dataRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', note: 'Internal error during export', resolvedAt: new Date() },
    }).catch(() => {})
    throw err
  }
}
