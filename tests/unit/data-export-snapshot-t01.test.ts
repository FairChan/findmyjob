import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { readDataExportSnapshot } from '@/server/services/data-export-snapshot'

describe('M9-T01 export snapshot SQL boundary', () => {
  it('uses one SQL timestamp and explicitly projects safe versions without private draft fields', async () => {
    const databaseTime = new Date('2001-02-03T04:05:06.007Z')
    const versions = {
      sourceSha256: 'a'.repeat(64), schemaVersion: 3, promptVersion: 'synthetic-prompt-v3',
      requestedModel: 'synthetic-request-model', responseModel: 'synthetic-response-model', appliedProfileRevision: 19,
    }
    const source = { fileName: 'synthetic.pdf', createdAt: '2026-01-01T01:02:03+00:00', storageKey: 'private-source-sentinel' }
    const query = vi.fn().mockResolvedValue([{
      hasProfile: true, snapshotAt: databaseTime, files: { 'user.json': { id: 'synthetic-owner' } }, resumes: [],
      drafts: [{
        resumeId: 'synthetic-resume', generation: 4, state: 'CONFIRMED', ...versions,
        payload: { headline: 'private-confirmed-body-sentinel' }, failureCode: 'unsafe-provider-exception-sentinel',
        requestedAt: '2026-01-02T03:04:05+00:00', completedAt: '2026-01-02T03:05:06+00:00',
        confirmedAt: '2026-01-02T03:06:07+00:00', source,
        sourceStorageKey: 'private-source-sentinel', consentGrantId: 'private-grant-sentinel',
        gateEpoch: 'private-epoch-sentinel', legalVersion: 'private-legal-sentinel', leaseToken: 'private-lease-sentinel',
        rawResponse: 'private-response-sentinel', extractedText: 'private-text-sentinel',
      }],
    }])
    const snapshot = await readDataExportSnapshot({ $queryRaw: query } as unknown as Prisma.TransactionClient, 'synthetic-owner')
    expect(query).toHaveBeenCalledOnce()
    const [fragments, owner] = query.mock.calls[0]
    const sql = (fragments as TemplateStringsArray).join('?')
    expect(owner).toBe('synthetic-owner')
    expect(sql).toMatch(/statement_timestamp\(\)\s+AS\s+"snapshotAt"/)
    expect(sql.match(/statement_timestamp\(\)/g)).toHaveLength(1)
    expect(sql).toContain('WHERE r."studentId" = p.id')
    for (const key of Object.keys(versions)) expect(sql).toContain(`'${key}', d."${key}"`)
    expect(snapshot).toEqual({
      snapshotAt: databaseTime.toISOString(), resumes: [], files: {
        'user.json': { id: 'synthetic-owner' },
        'resume-parse-drafts.json': [{
          resumeId: 'synthetic-resume', generation: 4, state: 'CONFIRMED', ...versions, payload: null, failureCode: null,
          requestedAt: '2026-01-02T03:04:05.000Z', completedAt: '2026-01-02T03:05:06.000Z', confirmedAt: '2026-01-02T03:06:07.000Z',
          source: { fileName: 'synthetic.pdf', createdAt: '2026-01-01T01:02:03.000Z' },
        }],
      },
    })
    expect(JSON.stringify(snapshot)).not.toContain('private-')
    expect(JSON.stringify(snapshot)).not.toContain('unsafe-provider-exception-sentinel')
  })
})
