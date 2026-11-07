/**
 * Integration tests for company verification service (M3-T02).
 */
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { submitVerification, getVerificationInfo } from '@/server/services/verification'
import { ForbiddenError, ValidationError } from '@/server/errors'

setupTestDb()

async function makeCtx(db: typeof testDb, overrides?: { verificationStatus?: string }) {
  const { userId, companyId } = await createEmployer(db)
  if (overrides?.verificationStatus) {
    await db.company.update({
      where: { id: companyId },
      data: { verificationStatus: overrides.verificationStatus as never },
    })
  }
  return { userId, companyId, role: 'OWNER' as const }
}

describe('submitVerification', () => {
  it('creates CompanyVerification and sets company status to PENDING', async () => {
    const ctx = await makeCtx(testDb)
    const key = `verifications/${ctx.companyId}/abc.pdf`

    await submitVerification(ctx, { documentKeys: [key] })

    const company = await testDb.company.findUnique({ where: { id: ctx.companyId } })
    expect(company?.verificationStatus).toBe('PENDING')

    const cv = await testDb.companyVerification.findFirst({ where: { companyId: ctx.companyId } })
    expect(cv?.status).toBe('PENDING')
    expect(cv?.documentKeys).toEqual([key])
    expect(cv?.submittedById).toBe(ctx.userId)
  })

  it('allows re-submission when REJECTED', async () => {
    const ctx = await makeCtx(testDb, { verificationStatus: 'REJECTED' })
    const key = `verifications/${ctx.companyId}/doc.pdf`

    await expect(submitVerification(ctx, { documentKeys: [key] })).resolves.not.toThrow()

    const company = await testDb.company.findUnique({ where: { id: ctx.companyId } })
    expect(company?.verificationStatus).toBe('PENDING')
  })

  it('rejects submission when already PENDING → ValidationError', async () => {
    const ctx = await makeCtx(testDb, { verificationStatus: 'PENDING' })
    const key = `verifications/${ctx.companyId}/doc.pdf`

    await expect(submitVerification(ctx, { documentKeys: [key] })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('rejects submission when already VERIFIED → ValidationError', async () => {
    const ctx = await makeCtx(testDb, { verificationStatus: 'VERIFIED' })
    const key = `verifications/${ctx.companyId}/doc.pdf`

    await expect(submitVerification(ctx, { documentKeys: [key] })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('rejects key belonging to a different company → ForbiddenError', async () => {
    const ctx = await makeCtx(testDb)
    const { companyId: otherId } = await createEmployer(testDb)
    const foreignKey = `verifications/${otherId}/doc.pdf`

    await expect(submitVerification(ctx, { documentKeys: [foreignKey] })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('writes audit log on successful submission', async () => {
    const ctx = await makeCtx(testDb)
    const key = `verifications/${ctx.companyId}/audit.pdf`

    await submitVerification(ctx, { documentKeys: [key] })

    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.verification.submit', targetId: ctx.companyId },
    })
    expect(audit).not.toBeNull()
    expect(audit?.actorId).toBe(ctx.userId)
  })

  it('stores optional note', async () => {
    const ctx = await makeCtx(testDb)
    const key = `verifications/${ctx.companyId}/note.pdf`

    await submitVerification(ctx, { documentKeys: [key], note: 'Business registration cert' })

    const cv = await testDb.companyVerification.findFirst({ where: { companyId: ctx.companyId } })
    expect(cv?.note).toBe('Business registration cert')
  })

  it('deduplicates documentKeys before storing', async () => {
    const ctx = await makeCtx(testDb)
    const key = `verifications/${ctx.companyId}/dup.pdf`

    await submitVerification(ctx, { documentKeys: [key, key] })

    const cv = await testDb.companyVerification.findFirst({ where: { companyId: ctx.companyId } })
    expect(cv?.documentKeys).toEqual([key])
  })

  it('concurrent submissions: only one PENDING record created', async () => {
    const ctx = await makeCtx(testDb)
    const key1 = `verifications/${ctx.companyId}/con1.pdf`
    const key2 = `verifications/${ctx.companyId}/con2.pdf`

    const results = await Promise.allSettled([
      submitVerification(ctx, { documentKeys: [key1] }),
      submitVerification(ctx, { documentKeys: [key2] }),
    ])

    const successes = results.filter(r => r.status === 'fulfilled')
    const failures = results.filter(r => r.status === 'rejected')
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)

    const count = await testDb.companyVerification.count({ where: { companyId: ctx.companyId } })
    expect(count).toBe(1)

    const company = await testDb.company.findUnique({ where: { id: ctx.companyId } })
    expect(company?.verificationStatus).toBe('PENDING')
  })
})

describe('getVerificationInfo', () => {
  it('returns UNSUBMITTED when no submission has been made', async () => {
    const ctx = await makeCtx(testDb)
    const info = await getVerificationInfo(ctx)
    expect(info.status).toBe('UNSUBMITTED')
    expect(info.latest).toBeNull()
  })

  it('returns latest verification record after submission', async () => {
    const ctx = await makeCtx(testDb)
    const key = `verifications/${ctx.companyId}/info.pdf`
    await submitVerification(ctx, { documentKeys: [key] })

    const info = await getVerificationInfo(ctx)
    expect(info.status).toBe('PENDING')
    expect(info.latest?.status).toBe('PENDING')
    expect(info.latest?.documentKeys).toEqual([key])
  })

  it('returns reviewNote when company is REJECTED', async () => {
    const ctx = await makeCtx(testDb, { verificationStatus: 'REJECTED' })
    // Insert a rejected verification with a reviewNote
    await testDb.companyVerification.create({
      data: {
        companyId: ctx.companyId,
        documentKeys: [`verifications/${ctx.companyId}/old.pdf`],
        status: 'REJECTED',
        submittedById: ctx.userId,
        reviewNote: 'SSM document expired',
        reviewedAt: new Date(),
      },
    })

    const info = await getVerificationInfo(ctx)
    expect(info.status).toBe('REJECTED')
    expect(info.latest?.reviewNote).toBe('SSM document expired')
  })
})
