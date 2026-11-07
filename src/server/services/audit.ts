import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '../db'

export interface AuditParams {
  actorId?: string
  action: string
  targetType: string
  targetId?: string
  metadata?: Record<string, unknown>
  ip?: string
}

export async function logAudit(
  params: AuditParams,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<void> {
  await client.auditLog.create({
    data: {
      ...params,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  })
}
