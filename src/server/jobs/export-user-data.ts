import { zipSync, strToU8 } from 'fflate'
import { getObjectBytes, putObject } from '@/lib/storage'
import { sendNotificationEmail } from '../services/notify'
import { logger } from '../lib/logger'
import {
  claimDataExport, beginDataExportUpload, acknowledgeDataExportUpload, settleDataExport,
  cleanupDataExport, reconcileExportRequest, reserveExportNotification, isExportPublished,
  type ExportClaim, type ExportPayload,
} from '../services/data-export-artifacts'

const MAX_RESUME_BYTES = 20 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_RESUMES = 256

async function buildArchive(claim: ExportClaim): Promise<Buffer> {
  const files: Record<string, Uint8Array> = {}
  let total = 0
  const add = (name: string, bytes: Uint8Array) => {
    total += bytes.byteLength
    if (total > MAX_ARCHIVE_BYTES) throw new Error('DATA_EXPORT_SIZE_LIMIT')
    files[name] = bytes
  }
  for (const [name, value] of Object.entries(claim.snapshot.files)) add(name, strToU8(JSON.stringify(value, null, 2)))
  if (claim.snapshot.resumes.length > MAX_RESUMES) throw new Error('DATA_EXPORT_SIZE_LIMIT')
  const preparationDeadline = AbortSignal.timeout(90_000)
  const skippedResumes: Array<{ id: string; reason: 'SOURCE_UNAVAILABLE' }> = []
  for (const resume of claim.snapshot.resumes) {
    if (preparationDeadline.aborted) throw new Error('DATA_EXPORT_PREPARATION_TIMEOUT')
    let bytes: Buffer
    try {
      bytes = await getObjectBytes(resume.storageKey, {
        maxBytes: MAX_RESUME_BYTES, signal: AbortSignal.any([preparationDeadline, AbortSignal.timeout(15_000)]),
      })
    } catch {
      if (preparationDeadline.aborted) throw new Error('DATA_EXPORT_PREPARATION_TIMEOUT')
      skippedResumes.push({ id: resume.id, reason: 'SOURCE_UNAVAILABLE' })
      logger.warn({ artifactId: claim.id, code: 'DATA_EXPORT_RESUME_UNAVAILABLE' }, 'export skipped an unavailable resume')
      continue
    }
    const safeName = resume.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
    add(`resumes/${resume.id}_${safeName}`, bytes)
  }
  add('export-manifest.json', strToU8(JSON.stringify({ snapshotAt: claim.snapshot.snapshotAt, skippedResumes }, null, 2)))
  const archive = Buffer.from(zipSync(files))
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error('DATA_EXPORT_SIZE_LIMIT')
  return archive
}

export async function runExportUserData(payload: ExportPayload): Promise<void> {
  let claim: ExportClaim | null = null
  let settlement: Awaited<ReturnType<typeof settleDataExport>> = 'MISSING'
  let failed = false
  try {
    // Rejected/anonymized users and losing generations still have discoverable cleanup.
    await reconcileExportRequest(payload)
    claim = await claimDataExport(payload)
    if (!claim) return
    const archive = await buildArchive(claim)
    if (await beginDataExportUpload(claim)) {
      // Requires the additive shared storage fragment. No SDK retry on this physical key.
      await putObject(claim.storageKey, archive, 'application/zip', {
        signal: AbortSignal.timeout(60_000), maxAttempts: 1,
      })
      await acknowledgeDataExportUpload(claim.id, claim.userId)
      settlement = await settleDataExport(claim.id, claim.userId, true)
    } else {
      settlement = await settleDataExport(claim.id, claim.userId, false)
    }
  } catch {
    failed = true
    logger.warn({ requestId: payload.requestId, code: 'DATA_EXPORT_RECONCILE' }, 'export requires persistent-state reconciliation')
    if (!claim) throw new Error('DATA_EXPORT_RETRY_REQUIRED')
    try {
      // A transaction may have committed despite rejection. Never infer that its object is a loser.
      settlement = await settleDataExport(claim.id, claim.userId, false)
    } catch {
      // Database unavailable: the durable ledger is the recovery route. No speculative delete.
      throw new Error('DATA_EXPORT_RETRY_REQUIRED')
    }
  }
  if (!claim) return
  if (settlement === 'CLEANUP_REQUIRED') {
    try { await cleanupDataExport(claim.id, claim.userId) } catch { throw new Error('DATA_EXPORT_RETRY_REQUIRED') }
  }
  if (settlement === 'PUBLISHED') {
    try {
      if (await reserveExportNotification(claim.id, claim.userId) && await isExportPublished(claim.id, claim.userId)) {
        await sendNotificationEmail(claim.userId, { template: 'data-export-ready', requestId: claim.requestId })
      }
    } catch {
      logger.warn({ requestId: claim.requestId, code: 'DATA_EXPORT_NOTIFICATION_UNCONFIRMED' }, 'export publication retained after notification failure')
    }
    return
  }
  if (failed) throw new Error('DATA_EXPORT_RETRY_REQUIRED')
}
