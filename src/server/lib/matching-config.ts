import 'server-only'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { env } from '@/env'
import { matchingGateSchema } from '@/schemas/semantic-matching'
import { db } from '../db'
import { getSetting } from '../services/settings'

export type MatchingConfiguration = { configurationId: string; model: string; gateEpoch: string; legalVersion: string }
export async function getMatchingConfiguration(tx: Prisma.TransactionClient = db): Promise<MatchingConfiguration | null> {
  const [rawGate, rawLegal] = await Promise.all([
    getSetting<unknown>('ai.matching', null, { tx, fresh: true }),
    getSetting<unknown>('legal.currentVersion', '2026-11-draft', { tx, fresh: true }),
  ])
  const gate = matchingGateSchema.safeParse(rawGate)
  const legal = z.string().min(1).max(100).safeParse(rawLegal)
  const model = z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f]/u.test(value)).safeParse(env.AI_MODEL_EMBED)
  if (!gate.success || !gate.data.enabled || !gate.data.legalVersion || !legal.success ||
    gate.data.legalVersion !== legal.data || !model.success || !env.VOYAGE_API_KEY?.trim()) return null
  return { configurationId: gate.data.configurationId, model: model.data, gateEpoch: gate.data.epoch, legalVersion: legal.data }
}

export function sameMatchingConfiguration(a: MatchingConfiguration, b: MatchingConfiguration): boolean {
  return a.configurationId === b.configurationId && a.model === b.model && a.gateEpoch === b.gateEpoch && a.legalVersion === b.legalVersion
}
