/**
 * M7-T03 acceptance: after purge, every version of the student's resume objects and everything
 * under exports/<userId>/ is gone from object storage. data-rights.test.ts mocks S3, so this file
 * talks to the real local MinIO, using a dedicated versioned bucket so the shared findmyjob-files
 * bucket's configuration is not touched.
 */
import { vi, describe, it, expect, beforeAll } from 'vitest'
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3'

const BUCKET = 'findmyjob-purge-versions-test'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@/env', async (importOriginal) => {
  const actual = (await importOriginal()) as { env: Record<string, unknown> }
  // vi.mock is hoisted above top-level constants, so the bucket name is repeated here.
  return { env: { ...actual.env, S3_BUCKET: 'findmyjob-purge-versions-test' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import { env } from '@/env'
import { runPurgeDeletedAccounts } from '@/server/jobs/purge-deleted-accounts'

setupTestDb()

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '' },
  forcePathStyle: true,
})

async function versionsUnder(prefix: string): Promise<number> {
  const r = await s3.send(new ListObjectVersionsCommand({ Bucket: BUCKET, Prefix: prefix }))
  return (r.Versions?.length ?? 0) + (r.DeleteMarkers?.length ?? 0)
}

beforeAll(async () => {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
  } catch (err) {
    const name = (err as { name?: string }).name
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw err
  }
  await s3.send(new PutBucketVersioningCommand({ Bucket: BUCKET, VersioningConfiguration: { Status: 'Enabled' } }))
})

describe('purge-deleted-accounts removes every object version', () => {
  it('resume key (2 versions) and exports/<userId>/ are empty after purge', async () => {
    const { userId, profileId } = await createStudent(testDb)
    const resumeKey = `resumes/${profileId}/purge-versions-${Date.now()}.pdf`
    const exportKey = `exports/${userId}/req-${Date.now()}.zip`

    // Two versions of the resume, one export archive
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: resumeKey, Body: Buffer.from('%PDF-1.4 v1') }))
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: resumeKey, Body: Buffer.from('%PDF-1.4 v2') }))
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: exportKey, Body: Buffer.from('PK zip') }))
    expect(await versionsUnder(resumeKey)).toBe(2)
    expect(await versionsUnder(`exports/${userId}/`)).toBe(1)

    await testDb.resumeFile.create({
      data: { studentId: profileId, storageKey: resumeKey, fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 11, isPrimary: true },
    })
    await testDb.user.update({
      where: { id: userId },
      data: { status: 'DELETED', deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    })

    const { purged } = await runPurgeDeletedAccounts()
    expect(purged).toBe(1)

    expect(await versionsUnder(resumeKey)).toBe(0)
    expect(await versionsUnder(`exports/${userId}/`)).toBe(0)
    expect(await testDb.resumeFile.count({ where: { studentId: profileId } })).toBe(0)
  })
})
