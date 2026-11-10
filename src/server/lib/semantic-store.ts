import 'server-only'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { embeddingVectorSchema, MATCHING_CONFIGURATION_ID } from '@/schemas/semantic-matching'
import { db } from '../db'
import { AppError, ConflictError, ValidationError } from '../errors'
import { getSetting } from '../services/settings'
import { getMatchingConfiguration } from './matching-config'

export type SemanticNeighbor = { indexId: string; subjectId: string; generation: number; sourceHash: string; distance: number }
export class SemanticStoreUnavailableError extends AppError {
  constructor() { super('Semantic storage unavailable', 'SEMANTIC_STORE_UNAVAILABLE', 503) }
}

/** No vector cast/operator/table reference is parsed before extension + correctly typed side-table probing. */
export async function isSemanticStoreAvailable(tx: Prisma.TransactionClient = db): Promise<boolean> {
  try {
    const rows = await tx.$queryRaw<Array<{ available: boolean }>>(Prisma.sql`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector' AND extversion = '0.8.7')
        AND EXISTS (
          SELECT 1 FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
          WHERE a.attrelid = to_regclass('public.semantic_vectors') AND a.attname = 'embedding'
            AND NOT a.attisdropped AND t.typname = 'vector' AND a.atttypmod = 1024
        ) AS available
    `)
    return rows[0]?.available === true
  } catch { return false }
}

const neighborInput = z.object({
  vector: embeddingVectorSchema, configurationId: z.literal(MATCHING_CONFIGURATION_ID), gateEpoch: z.string().uuid(),
  limit: z.number().int().min(1).max(20),
})
function vectorLiteral(vector: number[]): string {
  const parsed = embeddingVectorSchema.safeParse(vector)
  if (!parsed.success) throw new ValidationError('Invalid matching vector')
  return `[${parsed.data.map(value => Math.fround(value)).join(',')}]`
}

async function readContext(tx: Prisma.TransactionClient, configurationId: string, gateEpoch: string) {
  if (!await isSemanticStoreAvailable(tx)) throw new SemanticStoreUnavailableError()
  const config = await getMatchingConfiguration(tx)
  if (!config || config.configurationId !== configurationId || config.gateEpoch !== gateEpoch) throw new SemanticStoreUnavailableError()
  return config
}

export async function findTalentNeighbors(input: {
  vector: number[]; configurationId: string; gateEpoch: string; companyId: string; limit: number
}): Promise<SemanticNeighbor[]> {
  if (!neighborInput.safeParse(input).success || !z.string().cuid().safeParse(input.companyId).success) throw new ValidationError()
  const vector = vectorLiteral(input.vector)
  try {
    return await db.$transaction(async tx => {
      const config = await readContext(tx, input.configurationId, input.gateEpoch)
      const threshold = z.number().int().min(0).max(100).safeParse(await getSetting<unknown>('talentPool.minCompleteness', 60, { tx, fresh: true }))
      if (!threshold.success) throw new SemanticStoreUnavailableError()
      return tx.$queryRaw<SemanticNeighbor[]>(Prisma.sql`
        SELECT i.id AS "indexId", p.id AS "subjectId", i.generation, i."sourceHash",
          (v.embedding <=> ${vector}::vector) AS distance
        FROM public.semantic_vectors v JOIN "SemanticIndex" i ON i.id = v."indexId"
        JOIN "StudentProfile" p ON p.id = i."studentId" JOIN "User" u ON u.id = p."userId"
        JOIN LATERAL (SELECT c.id,c.granted,c.version FROM "Consent" c
          WHERE c."userId"=u.id AND c.type='AI_MATCHING' ORDER BY c."createdAt" DESC,c.id DESC LIMIT 1) ai ON true
        JOIN LATERAL (SELECT c.granted,c.version FROM "Consent" c
          WHERE c."userId"=u.id AND c.type='TERMS' ORDER BY c."createdAt" DESC,c.id DESC LIMIT 1) terms ON true
        JOIN LATERAL (SELECT c.granted,c.version FROM "Consent" c
          WHERE c."userId"=u.id AND c.type='PRIVACY' ORDER BY c."createdAt" DESC,c.id DESC LIMIT 1) privacy ON true
        WHERE i.kind='STUDENT' AND i.state='READY' AND i.generation=v.generation
          AND i."sourceRevision"=p."editRevision" AND i."configurationId"=${config.configurationId}
          AND i.model=${config.model} AND i."gateEpoch"=${config.gateEpoch} AND i."legalVersion"=${config.legalVersion}
          AND u.status='ACTIVE' AND u.role='STUDENT' AND p.visibility='PUBLIC' AND p."schoolVerifiedAt" IS NOT NULL
          AND p.completeness >= ${threshold.data}
          AND ai.granted AND ai.version=${config.legalVersion} AND ai.id=i."consentGrantId"
          AND terms.granted AND terms.version=${config.legalVersion} AND privacy.granted AND privacy.version=${config.legalVersion}
          AND NOT EXISTS (SELECT 1 FROM "BlockedCompany" b WHERE b."studentId"=p.id AND b."companyId"=${input.companyId})
          AND EXISTS (SELECT 1 FROM "Company" co WHERE co.id=${input.companyId} AND co."isActive" AND co."verificationStatus"='VERIFIED')
        ORDER BY distance ASC, p.id ASC LIMIT ${input.limit}
      `)
    })
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new SemanticStoreUnavailableError()
  }
}

export async function findJobNeighbors(input: {
  vector: number[]; configurationId: string; gateEpoch: string; studentId: string; limit: number
}): Promise<SemanticNeighbor[]> {
  if (!neighborInput.safeParse(input).success || !z.string().cuid().safeParse(input.studentId).success) throw new ValidationError()
  const vector = vectorLiteral(input.vector)
  try {
    return await db.$transaction(async tx => {
      const config = await readContext(tx, input.configurationId, input.gateEpoch)
      return tx.$queryRaw<SemanticNeighbor[]>(Prisma.sql`
        SELECT i.id AS "indexId", j.id AS "subjectId", i.generation, i."sourceHash",
          (v.embedding <=> ${vector}::vector) AS distance
        FROM public.semantic_vectors v JOIN "SemanticIndex" i ON i.id=v."indexId"
        JOIN "Job" j ON j.id=i."jobId" JOIN "Company" co ON co.id=j."companyId"
        WHERE i.kind='JOB' AND i.state='READY' AND i.generation=v.generation
          AND i."sourceRevision"=j."matchingRevision" AND i."configurationId"=${config.configurationId}
          AND i.model=${config.model} AND i."gateEpoch"=${config.gateEpoch} AND i."legalVersion"=${config.legalVersion}
          AND i."consentGrantId" IS NULL AND j.status='PUBLISHED' AND (j.deadline IS NULL OR j.deadline > now()) AND co."isActive"
          AND EXISTS (SELECT 1 FROM "StudentProfile" p JOIN "User" u ON u.id=p."userId"
            WHERE p.id=${input.studentId} AND u.status='ACTIVE' AND u.role='STUDENT')
        ORDER BY distance ASC, j.id ASC LIMIT ${input.limit}
      `)
    })
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new SemanticStoreUnavailableError()
  }
}

/** Caller has locked the existing metadata row and checked its lease/source; vector and READY CAS share the transaction. */
export async function writeSemanticVector(tx: Prisma.TransactionClient, input: { indexId: string; generation: number; vector: number[] }): Promise<void> {
  if (!z.string().cuid().safeParse(input.indexId).success || !Number.isSafeInteger(input.generation) || input.generation < 1) throw new ValidationError()
  const vector = vectorLiteral(input.vector)
  if (!await isSemanticStoreAvailable(tx)) throw new SemanticStoreUnavailableError()
  const count = await tx.$executeRaw(Prisma.sql`
    INSERT INTO public.semantic_vectors ("indexId",generation,embedding)
    SELECT id,generation,${vector}::vector FROM "SemanticIndex"
      WHERE id=${input.indexId} AND generation=${input.generation} AND state IN ('PROCESSING','READY')
    ON CONFLICT ("indexId") DO UPDATE SET generation=EXCLUDED.generation,embedding=EXCLUDED.embedding
      WHERE semantic_vectors.generation <= EXCLUDED.generation
  `)
  if (count !== 1) throw new ConflictError()
}

/** Best-effort physical cleanup belongs after the durable metadata invalidation commit. */
export async function deleteSemanticVector(tx: Prisma.TransactionClient, indexId: string): Promise<void> {
  if (!z.string().cuid().safeParse(indexId).success) throw new ValidationError()
  if (!await isSemanticStoreAvailable(tx)) throw new SemanticStoreUnavailableError()
  await tx.$executeRaw(Prisma.sql`DELETE FROM public.semantic_vectors WHERE "indexId"=${indexId}`)
}
