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

export async function logAudit(params: AuditParams): Promise<void> {
  await db.auditLog.create({
    data: {
      ...params,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  })
}
