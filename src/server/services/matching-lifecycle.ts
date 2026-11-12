import 'server-only'
import type { Prisma } from '@prisma/client'
import { invalidateJobMatchingIndexTx } from './semantic-matching'

/** Caller holds CREDIT(companyId) and changes company eligibility in this transaction. */
export async function invalidateCompanyMatchingIndexesTx(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  // All source rows are locked in a stable order before touching any metadata.
  // CREDIT also serializes create/update/review so a new job cannot miss this transition.
  const jobs = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Job" WHERE "companyId" = ${companyId} ORDER BY id FOR UPDATE
  `
  for (const job of jobs) {
    await tx.job.update({ where: { id: job.id }, data: { matchingRevision: { increment: 1 } } })
    await invalidateJobMatchingIndexTx(tx, job.id)
  }
}
