import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), key: crypto.randomUUID() }))
vi.mock('server-only', () => ({}))
vi.mock('@/env', () => ({ env: {
  S3_ENDPOINT: 'https://synthetic.example.test', S3_REGION: 'test', S3_ACCESS_KEY_ID: fake.key,
  S3_SECRET_ACCESS_KEY: fake.key, S3_BUCKET: 'synthetic-bucket',
} }))
vi.mock('@aws-sdk/client-s3', () => {
  class Command { constructor(public input: Record<string, unknown>) {} }
  return {
    S3Client: class { send = fake.send; destroy = fake.destroy },
    PutObjectCommand: class extends Command {}, GetObjectCommand: class extends Command {},
    ListObjectVersionsCommand: class extends Command {}, DeleteObjectsCommand: class extends Command {},
  }
})
import { ListObjectVersionsCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { deleteAllVersions } from '@/lib/storage'

beforeEach(() => { fake.send.mockReset(); fake.destroy.mockClear() })
const key = 'exports/owner/request/artifact.zip'

describe('T01 exact-key version pagination continuation', () => {
  it.each([undefined, ''])('rejects missing/empty exact-key version marker: %s', async nextVersionIdMarker => {
    fake.send.mockResolvedValueOnce({
      Versions: [{ Key: key, VersionId: 'first' }], IsTruncated: true,
      NextKeyMarker: key, NextVersionIdMarker: nextVersionIdMarker,
    }).mockResolvedValueOnce({ IsTruncated: false }).mockResolvedValueOnce({})
    await expect(deleteAllVersions(key)).rejects.toThrow('Object deletion invalid pagination')
    expect(fake.send).toHaveBeenCalledTimes(1)
    expect(fake.send.mock.calls[0]![0]).toBeInstanceOf(ListObjectVersionsCommand)
    expect(fake.send.mock.calls.some(([command]) => command instanceof DeleteObjectsCommand)).toBe(false)
    expect(fake.destroy).toHaveBeenCalledTimes(1)
  })

  it('continues within the exact key when both markers are present, including version id null', async () => {
    fake.send.mockResolvedValueOnce({
      Versions: [{ Key: key, VersionId: 'null' }], IsTruncated: true, NextKeyMarker: key, NextVersionIdMarker: 'null',
    }).mockResolvedValueOnce({ Versions: [{ Key: key, VersionId: 'older' }], IsTruncated: false })
      .mockResolvedValueOnce({})
    await deleteAllVersions(key)
    expect(fake.send.mock.calls[1]![0].input).toMatchObject({ KeyMarker: key, VersionIdMarker: 'null' })
    expect(fake.send.mock.calls[2]![0]).toBeInstanceOf(DeleteObjectsCommand)
    expect(fake.send.mock.calls[2]![0].input.Delete.Objects).toEqual([
      { Key: key, VersionId: 'null' }, { Key: key, VersionId: 'older' },
    ])
  })

  it.each([undefined, ''])('allows a later prefix key without a version marker: %s', async nextVersionIdMarker => {
    const laterKey = `${key}.later`
    fake.send.mockResolvedValueOnce({
      Versions: [{ Key: key, VersionId: 'target' }, { Key: laterKey, VersionId: 'neighbor' }],
      IsTruncated: true, NextKeyMarker: laterKey, NextVersionIdMarker: nextVersionIdMarker,
    }).mockResolvedValueOnce({
      Versions: [{ Key: `${key}.last`, VersionId: 'neighbor-last' }], IsTruncated: false,
    }).mockResolvedValueOnce({})
    await deleteAllVersions(key)
    expect(fake.send.mock.calls[1]![0]).toBeInstanceOf(ListObjectVersionsCommand)
    expect(fake.send.mock.calls[1]![0].input).toMatchObject({ KeyMarker: laterKey, VersionIdMarker: nextVersionIdMarker })
    expect(fake.send.mock.calls[2]![0].input.Delete.Objects).toEqual([{ Key: key, VersionId: 'target' }])
    expect(fake.send).toHaveBeenCalledTimes(3)
  })
})
