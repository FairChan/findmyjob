import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { currentRequestClient } from '../lib/request-client'

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
  // App 发起的请求由 route() 标记来源；Web 请求没有标记，metadata 保持原样
  const requestClient = currentRequestClient()
  const metadata = requestClient ? { ...params.metadata, client: requestClient } : params.metadata
  await client.auditLog.create({
    data: {
      ...params,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  })
}
