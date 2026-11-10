import 'server-only'
import { Prisma } from '@prisma/client'
import { deleteAllVersions } from '@/lib/storage'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { invalidateLifecycleExportsTx } from '../services/data-rights'
import { cancelResumeParseDraftsTx } from '../services/resume-parsing'
import { invalidateStudentMatchingIndexTx } from '../services/semantic-matching'
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
  const signal = AbortSignal.timeout(45_000)
  const objects: { Key: string; VersionId?: string }[] = []
  const markers = new Set<string>()
  let keyMarker: string | undefined, versionIdMarker: string | undefined
  for (let page = 0; page < 100; page++) {
    const list = await s3.send(new ListObjectVersionsCommand({
      Bucket: env.S3_BUCKET, Prefix: prefix, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker,
    }), { abortSignal: signal })
    for (const version of [...(list.Versions ?? []), ...(list.DeleteMarkers ?? [])]) {
      if (!version.Key?.startsWith(prefix)) throw new Error('PURGE_STORAGE_PREFIX_MISMATCH')
      objects.push({ Key: version.Key, VersionId: version.VersionId })
    }
    if (objects.length > 100_000) throw new Error('PURGE_STORAGE_VERSION_LIMIT')
    if (!list.IsTruncated) {
      for (let index = 0; index < objects.length; index += 1000) {
        const deleted = await s3.send(new DeleteObjectsCommand({
          Bucket: env.S3_BUCKET, Delete: { Objects: objects.slice(index, index + 1000) },
        }), { abortSignal: signal })
        if (deleted.Errors?.length) throw new Error('PURGE_STORAGE_DELETE_FAILED')
      }
      return
    }
    if (!list.NextKeyMarker) throw new Error('PURGE_STORAGE_MARKER_INVALID')
    const marker = JSON.stringify([list.NextKeyMarker, list.NextVersionIdMarker])
    if (markers.has(marker)) throw new Error('PURGE_STORAGE_MARKER_REPEATED')
    markers.add(marker); keyMarker = list.NextKeyMarker; versionIdMarker = list.NextVersionIdMarker
  }
  throw new Error('PURGE_STORAGE_PAGE_LIMIT')
}

async function lifecycleNow(tx: Prisma.TransactionClient, userId: string): Promise<Date> {
  await lockXact(tx, LOCK_NS.STUDENT_DATA, userId)
  await lockXact(tx, LOCK_NS.DATA_EXPORT, userId)
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`
  if (!clock) throw new Error('PURGE_CLOCK_UNAVAILABLE')
  return clock.now
}

async function eligibleUser(tx: Prisma.TransactionClient, userId: string, now: Date) {
  return tx.user.findFirst({
    where: { id: userId, status: 'DELETED', deletedAt: { lte: new Date(now.getTime() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000) },
      NOT: { email: { endsWith: '@purged.internal' } } },
    select: { id: true, deletedAt: true, studentProfile: { select: { id: true,
      resumes: { select: { id: true, storageKey: true }, orderBy: { id: 'asc' } }, contact: { select: { studentId: true } },
    } } },
  })
}

function anonEmail(userId: string): string {
  return `deleted-${userId}@purged.internal`
}

function anonName(userId: string): string {
  return `Deleted User ${userId.slice(-8)}`
}

export async function runPurgeDeletedAccounts(): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000)

  // Selection is only a bounded hint; recheck after lifecycle locks before storage and DB writes.
  const deletedUsers = await db.user.findMany({
    where: { status: 'DELETED', deletedAt: { lte: cutoff }, NOT: { email: { endsWith: '@purged.internal' } } },
    select: { id: true }, take: BATCH_SIZE, orderBy: { id: 'asc' },
  })

  if (deletedUsers.length === 0) return { purged: 0 }

  const s3 = makeS3Client()
  let purged = 0

  for (const candidate of deletedUsers) {
    const prepared = await db.$transaction(async tx => {
      const now = await lifecycleNow(tx, candidate.id)
      const current = await eligibleUser(tx, candidate.id, now)
      if (!current) return null
      await invalidateLifecycleExportsTx(tx, candidate.id)
      await cancelResumeParseDraftsTx(tx, candidate.id)
      await invalidateStudentMatchingIndexTx(tx, candidate.id)
      return current
    })
    if (!prepared) continue
    // Storage I/O is after commit; failures preserve DB sources for later retry.
    try {
      for (const resume of prepared.studentProfile?.resumes ?? []) await deleteAllVersions(resume.storageKey)
      // Additional legacy cleanup only; the artifact ledger remains authoritative
      // for a delayed new-protocol PUT after this prefix deletion.
      await deleteAllVersionsForPrefix(s3, `exports/${prepared.id}/`)
    } catch {
      logger.warn({ userId: prepared.id, code: 'ACCOUNT_PURGE_STORAGE_PENDING' }, 'Account purge storage cleanup remains pending')
      throw new Error('ACCOUNT_PURGE_STORAGE_PENDING')
    }

    const changed = await db.$transaction(async tx => {
      const now = await lifecycleNow(tx, candidate.id)
      const user = await eligibleUser(tx, candidate.id, now)
      if (!user || user.deletedAt?.getTime() !== prepared.deletedAt?.getTime() ||
        user.studentProfile?.id !== prepared.studentProfile?.id ||
        JSON.stringify(user.studentProfile?.resumes ?? []) !== JSON.stringify(prepared.studentProfile?.resumes ?? [])) return false
      await invalidateLifecycleExportsTx(tx, user.id)
      await cancelResumeParseDraftsTx(tx, user.id)
      await invalidateStudentMatchingIndexTx(tx, user.id)
      const profileId = user.studentProfile?.id
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
            editRevision: { increment: 1 },
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
      return true
    })

    if (changed) {
      purged++
      logger.info({ userId: candidate.id }, 'purge: account purged')
    }
  }

  return { purged }
}

/**
 * Explicit cutover-only sweep. Do not schedule until old exporter processes and
 * remote PUTs are proven quiescent. Finite leases/timeouts are NOT that proof.
 * Scan is independent of User/Profile presence, status, email or anonymization.
 */
export async function cleanupLegacyDataExports(options: { cutoverAt: Date; oldWritersQuiesced: true }): Promise<{ cleaned: number; pending: number }> {
  if (options?.oldWritersQuiesced !== true || !Number.isFinite(options.cutoverAt?.getTime())) {
    throw new Error('LEGACY_EXPORT_CUTOVER_REQUIRED')
  }
  const cutoverAt = options.cutoverAt, started = Date.now()
  const [clock] = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`
  if (!clock || cutoverAt > clock.now) throw new Error('LEGACY_EXPORT_CUTOVER_INVALID')
  const candidates = await db.$queryRaw<Array<{ id: string; userId: string }>>(Prisma.sql`
    SELECT r.id, r."userId" FROM "DataRequest" r
    WHERE r.type = 'EXPORT' AND r."createdAt" <= ${cutoverAt}
      AND r."resultKey" = 'exports/' || r."userId" || '/' || r.id || '.zip'
      AND NOT EXISTS (SELECT 1 FROM "DataExportArtifact" a WHERE a."storageKey" = r."resultKey")
    ORDER BY COALESCE(r."resolvedAt", r."createdAt") ASC, r.id ASC LIMIT 20
  `)
  let cleaned = 0, pending = 0
  for (const candidate of candidates) {
    if (Date.now() - started > 45_000) break
    const intent = await db.$transaction(async tx => {
      const now = await lifecycleNow(tx, candidate.userId)
      const request = await tx.dataRequest.findUnique({ where: { id: candidate.id } })
      if (!request || request.userId !== candidate.userId || request.type !== 'EXPORT' || request.createdAt > cutoverAt ||
        request.resultKey !== `exports/${candidate.userId}/${candidate.id}.zip` ||
        await tx.dataExportArtifact.findUnique({ where: { storageKey: request.resultKey }, select: { id: true } })) return null
      const invalidated = await tx.dataRequest.update({ where: { id: request.id }, data: {
        status: 'REJECTED', exportGeneration: { increment: 1 }, exportLeaseToken: null, exportLeaseExpiresAt: null, resolvedAt: now,
      } })
      return { storageKey: request.resultKey, generation: invalidated.exportGeneration }
    })
    if (!intent) continue
    try { await deleteAllVersions(intent.storageKey) }
    catch { pending++; continue }
    const changed = await db.$transaction(async tx => {
      await lifecycleNow(tx, candidate.userId)
      if (await tx.dataExportArtifact.findUnique({ where: { storageKey: intent.storageKey }, select: { id: true } })) return false
      const request = await tx.dataRequest.findUnique({ where: { id: candidate.id }, select: { note: true } })
      const result = await tx.dataRequest.updateMany({
        where: { id: candidate.id, userId: candidate.userId, type: 'EXPORT', status: 'REJECTED',
          createdAt: { lte: cutoverAt }, exportGeneration: intent.generation, resultKey: intent.storageKey },
        data: { resultKey: null, ...(request?.note === 'EXPORT_CLEANUP_REQUIRED' ? { note: null } : {}) },
      })
      return result.count === 1
    })
    if (changed) cleaned++; else pending++
  }
  return { cleaned, pending }
}
