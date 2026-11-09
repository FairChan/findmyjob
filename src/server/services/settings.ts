import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { logAudit } from './audit'
import { bankTransferSettingsSchema, EMPTY_BANK_TRANSFER } from '../lib/billing-settings'
import { configuredInvoiceIssuerSchema, EMPTY_INVOICE_ISSUER } from '../lib/invoice-settings'

const TTL_MS = 60_000

interface CacheEntry {
  value: unknown
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
let cacheGeneration = 0

export function clearSettingsCache(): void {
  cacheGeneration++
  cache.clear()
}

export async function getSetting<T>(
  key: string, defaultValue: T,
  options?: { tx?: Prisma.TransactionClient; fresh?: boolean },
): Promise<T> {
  if (options?.tx || options?.fresh) {
    const row = await (options.tx ?? db).systemSetting.findUnique({ where: { key } })
    return row !== null ? (row.value as T) : defaultValue
  }
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T
  }

  const generation = cacheGeneration
  const row = await db.systemSetting.findUnique({ where: { key } })
  const value: T = row !== null ? (row.value as T) : defaultValue
  if (generation === cacheGeneration) cache.set(key, { value, expiresAt: Date.now() + TTL_MS })
  return value
}

export async function setSetting(
  key: string,
  value: unknown,
  actorId?: string,
): Promise<void> {
  const jsonValue = value as Prisma.InputJsonValue
  await db.$transaction(async (tx) => {
    const existing = await tx.systemSetting.findUnique({ where: { key }, select: { value: true } })
    const from = existing?.value ?? null
    await tx.systemSetting.upsert({
      where: { key },
      create: { key, value: jsonValue, updatedById: actorId },
      update: { value: jsonValue, updatedById: actorId },
    })
    await logAudit(
      {
        actorId,
        action: 'setting.update',
        targetType: 'SystemSetting',
        targetId: key,
        metadata: key === 'billing.bankTransfer' ? bankAudit(from, value)
          : key === 'billing.invoiceIssuer' ? invoiceIssuerAudit(from, value) : { key, from, to: value },
      },
      tx,
    )
  })
  clearSettingsCache()
}

function bankAudit(from: unknown, to: unknown) {
  const fields = Object.keys(EMPTY_BANK_TRANSFER) as (keyof typeof EMPTY_BANK_TRANSFER)[]
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const configured = (value: unknown) => {
    const parsed = bankTransferSettingsSchema.safeParse(value)
    return parsed.success && Boolean(parsed.data.bankName && parsed.data.accountName && parsed.data.accountNumber)
  }
  const previous = object(from)
  const next = object(to)
  return {
    key: 'billing.bankTransfer', fromConfigured: configured(from), toConfigured: configured(to),
    changedFields: fields.filter(field => previous[field] !== next[field]),
  }
}

function invoiceIssuerAudit(from: unknown, to: unknown) {
  const fields = Object.keys(EMPTY_INVOICE_ISSUER) as (keyof typeof EMPTY_INVOICE_ISSUER)[]
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const previous = object(from)
  const next = object(to)
  return {
    key: 'billing.invoiceIssuer',
    fromConfigured: configuredInvoiceIssuerSchema.safeParse(from).success,
    toConfigured: configuredInvoiceIssuerSchema.safeParse(to).success,
    changedFields: fields.filter(field => previous[field] !== next[field]),
  }
}
