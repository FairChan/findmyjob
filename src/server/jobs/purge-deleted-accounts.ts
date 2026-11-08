import { S3Client, ListObjectVersionsCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { db } from '../db'
import { logger } from '../lib/logger'
import { env } from '@/env'
import { purgeContactForStudent } from '../services/contact-access'

const PURGE_AFTER_DAYS = 30
const BATCH_SIZE = 100

function makeS3Client(): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  })
}

async function deleteAllVersionsForPrefix(s3: S3Client, prefix: string): Promise<void> {
  let keyMarker: string | undefined
  let versionIdMarker: string | undefined

  for (;;) {
    const list = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    )

    const toDelete = [
      ...(list.Versions ?? []),
      ...(list.DeleteMarkers ?? []),
    ].map(v => ({ Key: v.Key!, VersionId: v.VersionId }))

    if (toDelete.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: env.S3_BUCKET,
          Delete: { Objects: toDelete as { Key: string; VersionId?: string }[] },
        }),
      )
    }

    if (!list.IsTruncated) break
    keyMarker = list.NextKeyMarker
    versionIdMarker = list.NextVersionIdMarker
  }
}

async function deleteAllVersionsForKey(s3: S3Client, key: string): Promise<void> {
  const list = await s3.send(
    new ListObjectVersionsCommand({ Bucket: env.S3_BUCKET, Prefix: key }),
  )

  const toDelete = [
    ...(list.Versions ?? []),
    ...(list.DeleteMarkers ?? []),
  ]
    .filter(v => v.Key === key)
    .map(v => ({ Key: v.Key!, VersionId: v.VersionId }))

  if (toDelete.length === 0) return

  await s3.send(
    new DeleteObjectsCommand({
      Bucket: env.S3_BUCKET,
      Delete: { Objects: toDelete as { Key: string; VersionId?: string }[] },
    }),
  )
}

function anonEmail(userId: string): string {
  return `deleted-${userId}@purged.internal`
}

function anonName(userId: string): string {
  return `Deleted User ${userId.slice(-8)}`
}

export async function runPurgeDeletedAccounts(): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000)

  // Find all deleted users with PII still present (email not yet anonymized to @purged.internal)
  const deletedUsers = await db.user.findMany({
    where: {
      status: 'DELETED',
      deletedAt: { lte: cutoff },
      NOT: { email: { endsWith: '@purged.internal' } },
    },
    select: {
      id: true,
      studentProfile: {
        select: {
          id: true,
          resumes: { select: { id: true, storageKey: true } },
          contact: { select: { studentId: true } },
        },
      },
    },
    take: BATCH_SIZE,
  })

  if (deletedUsers.length === 0) return { purged: 0 }

  const s3 = makeS3Client()
  let purged = 0

  for (const user of deletedUsers) {
    // ── S3 cleanup (outside transaction) ──────────────────────────────────
    const profileId = user.studentProfile?.id
    const resumes = user.studentProfile?.resumes ?? []

    for (const r of resumes) {
      try {
        await deleteAllVersionsForKey(s3, r.storageKey)
      } catch (err) {
        logger.error({ userId: user.id, resumeKey: r.storageKey, err }, 'purge: failed to delete resume from S3')
        throw err
      }
    }

    // Delete all export objects for this user
    try {
      await deleteAllVersionsForPrefix(s3, `exports/${user.id}/`)
    } catch (err) {
      logger.error({ userId: user.id, err }, 'purge: failed to delete exports from S3')
      throw err
    }

    // ── Database anonymization (per-user transaction) ─────────────────────
    await db.$transaction(async (tx) => {
      // Delete StudentContact
      if (user.studentProfile?.contact) {
        await purgeContactForStudent(tx, user.studentProfile.id)
      }

      // Delete ResumeFile records
      if (profileId) {
        await tx.resumeFile.deleteMany({ where: { studentId: profileId } })
      }

      // Anonymize User
      await tx.user.update({
        where: { id: user.id },
        data: {
          name: anonName(user.id),
          email: anonEmail(user.id),
          emailVerified: false,
        },
      })

      if (profileId) {
        // Anonymize StudentProfile
        await tx.studentProfile.update({
          where: { id: profileId },
          data: {
            fullName: anonName(user.id),
            headline: null,
            summary: null,
            nationality: null,
            schoolEmail: null,
          },
        })

        // Anonymize Education descriptions
        await tx.education.updateMany({
          where: { studentId: profileId },
          data: { description: null },
        })

        // Anonymize Experience descriptions
        await tx.experience.updateMany({
          where: { studentId: profileId },
          data: { description: null },
        })

        // Clear Application coverNote and companyNote
        await tx.application.updateMany({
          where: { studentId: profileId },
          data: { coverNote: null, companyNote: null },
        })

        // Clear ApplicationEvent notes
        const appIds = await tx.application.findMany({
          where: { studentId: profileId },
          select: { id: true },
        })
        if (appIds.length > 0) {
          await tx.applicationEvent.updateMany({
            where: { applicationId: { in: appIds.map(a => a.id) } },
            data: { note: null },
          })
        }

        // Clear TalentFolderItem notes
        await tx.talentFolderItem.updateMany({
          where: { studentId: profileId },
          data: { note: null },
        })

        // Clear Invitation messages
        await tx.invitation.updateMany({
          where: { studentId: profileId },
          data: { message: null },
        })

        // Notifications that carry this student's data: their own inbox, employer-side rows that
        // reference the student by top-level studentId (e.g. job.application.new), and rows that
        // embed a talent card under `student` (invitation.accepted / declined, which may hold the
        // full name once the student applied).
        await tx.notification.deleteMany({
          where: {
            OR: [
              { userId: user.id },
              { payload: { path: ['studentId'], equals: profileId } },
              { payload: { path: ['student', 'id'], equals: profileId } },
            ],
          },
        })
      }
    })

    purged++
    logger.info({ userId: user.id }, 'purge: account purged')
  }

  return { purged }
}
