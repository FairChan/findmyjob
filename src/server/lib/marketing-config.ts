import 'server-only'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '../db'
import { getSetting } from '../services/settings'
import { isMarketingDisclosurePublished } from './marketing-disclosure'
import { marketingUnsubscribeConfigured } from './marketing-unsubscribe'

export const marketingWeeklyGateSchema = z.object({
  enabled: z.boolean(), legalVersion: z.string().min(1).max(100), epoch: z.string().uuid(),
}).strict()
export type MarketingConfiguration = { legalVersion: string; epoch: string }
export async function getMarketingConfiguration(tx: Prisma.TransactionClient = db): Promise<MarketingConfiguration | null> {
  const [rawGate, current] = await Promise.all([
    getSetting<unknown>('marketing.weekly', null, { tx, fresh: true }),
    getSetting<unknown>('legal.currentVersion', null, { tx, fresh: true }),
  ])
  const gate = marketingWeeklyGateSchema.safeParse(rawGate)
  if (!gate.success || !gate.data.enabled || gate.data.legalVersion !== current || !marketingUnsubscribeConfigured()) return null
  if (!await isMarketingDisclosurePublished(gate.data.legalVersion)) return null
  return { legalVersion: gate.data.legalVersion, epoch: gate.data.epoch }
}
