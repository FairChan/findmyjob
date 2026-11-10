import type { Prisma } from '@prisma/client'
import { normalizeResumeSuggestion, resumeParseFailureCodeSchema } from '../schemas/resume-parsing'

type Draft = {
  resumeId: string; generation: number; state: string; payload: unknown; failureCode: unknown
  sourceSha256: string; schemaVersion: number; promptVersion: string
  requestedModel: string; responseModel: string | null; appliedProfileRevision: number | null
  requestedAt: string; completedAt: string | null; confirmedAt: string | null
  source: { fileName: string; createdAt: string }
}
export type ExportSnapshot = {
  snapshotAt: string
  files: Record<string, unknown>
  resumes: Array<{ id: string; storageKey: string; fileName: string }>
}
type SnapshotRow = Omit<ExportSnapshot, 'snapshotAt'> & { snapshotAt: Date; drafts: Draft[]; hasProfile: boolean }

const dateFields = new Set([
  'createdAt', 'updatedAt', 'availableFrom', 'startDate', 'endDate', 'respondedAt', 'expiresAt',
  'readAt', 'requestedAt', 'completedAt', 'confirmedAt',
])
function normalizeDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeDates)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    dateFields.has(key) && typeof item === 'string' ? new Date(item).toISOString() : normalizeDates(item),
  ]))
}

/**
 * Invoke AFTER STUDENT_DATA then DATA_EXPORT locks, in a READ COMMITTED transaction.
 * PostgreSQL gives this one statement one MVCC snapshot, including every subquery.
 * A repeatable-read snapshot started by an earlier lock query would be stale after waiting.
 * External resume bytes are read later and are not part of this database snapshot.
 */
export async function readDataExportSnapshot(tx: Prisma.TransactionClient, userId: string): Promise<ExportSnapshot | null> {
  const [row] = await tx.$queryRaw<SnapshotRow[]>`
    SELECT p.id IS NOT NULL AS "hasProfile", statement_timestamp() AS "snapshotAt",
      jsonb_build_object(
        'user.json', jsonb_build_object(
          'id', u.id, 'name', u.name, 'email', u.email, 'role', u.role,
          'createdAt', u."createdAt", 'locale', u.locale),
        'profile.json', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', p.id, 'fullName', p."fullName", 'headline', p.headline, 'summary', p.summary,
          'degreeLevel', p."degreeLevel", 'major', p.major, 'graduationYear', p."graduationYear",
          'graduationMonth', p."graduationMonth", 'cgpa', trim(trailing '.' from trim(trailing '0' from p.cgpa::text)), 'nationality', p.nationality,
          'workAuth', p."workAuth", 'intents', p.intents, 'availableFrom', p."availableFrom",
          'preferredStates', p."preferredStates", 'preferredIndustries', p."preferredIndustries",
          'expectedSalaryMin', p."expectedSalaryMin", 'expectedSalaryMax', p."expectedSalaryMax",
          'skills', p.skills, 'visibility', p.visibility, 'completeness', p.completeness,
          'createdAt', p."createdAt", 'updatedAt', p."updatedAt") END,
        'educations.json', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', e.id, 'schoolName', e."schoolName", 'degreeLevel', e."degreeLevel", 'major', e.major,
          'startDate', e."startDate", 'endDate', e."endDate", 'gpa', e.gpa, 'description', e.description)
          ORDER BY e."sortOrder", e.id) FROM "Education" e WHERE e."studentId" = p.id), '[]'::jsonb),
        'experiences.json', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', e.id, 'kind', e.kind, 'title', e.title, 'organization', e.organization,
          'startDate', e."startDate", 'endDate', e."endDate", 'description', e.description)
          ORDER BY e."sortOrder", e.id) FROM "Experience" e WHERE e."studentId" = p.id), '[]'::jsonb),
        'languages.json', COALESCE((SELECT jsonb_agg(jsonb_build_object('language', l.language, 'level', l.level)
          ORDER BY l.language) FROM "StudentLanguage" l WHERE l."studentId" = p.id), '[]'::jsonb),
        'applications.json', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', a.id, 'jobId', a."jobId", 'coverNote', a."coverNote", 'status', a.status,
          'createdAt', a."createdAt", 'updatedAt', a."updatedAt",
          'job', jsonb_build_object('id', j.id, 'title', j.title),
          'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id,
            'fromStatus', e."fromStatus", 'toStatus', e."toStatus", 'createdAt', e."createdAt")
            ORDER BY e."createdAt", e.id) FROM "ApplicationEvent" e WHERE e."applicationId" = a.id), '[]'::jsonb))
          ORDER BY a."createdAt" DESC, a.id) FROM "Application" a JOIN "Job" j ON j.id = a."jobId"
          WHERE a."studentId" = p.id), '[]'::jsonb),
        'invitations.json', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', i.id, 'status', i.status, 'message', i.message, 'createdAt', i."createdAt",
          'respondedAt', i."respondedAt", 'expiresAt', i."expiresAt",
          'job', CASE WHEN j.id IS NULL THEN NULL ELSE jsonb_build_object('id', j.id, 'title', j.title) END,
          'company', jsonb_build_object('id', c.id, 'legalName', c."legalName",
            'displayNameZh', c."displayNameZh", 'displayNameEn', c."displayNameEn"))
          ORDER BY i."createdAt" DESC, i.id)
          FROM "Invitation" i JOIN "Company" c ON c.id = i."companyId" LEFT JOIN "Job" j ON j.id = i."jobId"
          WHERE i."studentId" = p.id), '[]'::jsonb),
        'privacy.json', jsonb_build_object('visibility', p.visibility,
          'blockedCompanies', COALESCE((SELECT jsonb_agg(jsonb_build_object('companyId', b."companyId", 'createdAt', b."createdAt")
            ORDER BY b."companyId") FROM "BlockedCompany" b WHERE b."studentId" = p.id), '[]'::jsonb),
          'consents', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', c.type, 'version', c.version,
            'granted', c.granted, 'createdAt', c."createdAt") ORDER BY c."createdAt", c.id)
            FROM "Consent" c WHERE c."userId" = u.id), '[]'::jsonb)),
        'notifications.json', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'type', n.type,
          'createdAt', n."createdAt", 'readAt', n."readAt") ORDER BY n."createdAt" DESC, n.id)
          FROM (SELECT id, type, "createdAt", "readAt" FROM "Notification" WHERE "userId" = u.id
            ORDER BY "createdAt" DESC, id LIMIT 500) n), '[]'::jsonb)
      ) AS files,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'storageKey', r."storageKey", 'fileName', r."fileName")
        ORDER BY r."createdAt", r.id) FROM "ResumeFile" r WHERE r."studentId" = p.id), '[]'::jsonb) AS resumes,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('resumeId', d."resumeId", 'generation', d.generation,
        'sourceSha256', d."sourceSha256", 'schemaVersion', d."schemaVersion", 'promptVersion', d."promptVersion",
        'requestedModel', d."requestedModel", 'responseModel', d."responseModel", 'appliedProfileRevision', d."appliedProfileRevision",
        'state', d.state, 'payload', CASE WHEN d.state = 'READY' THEN d.payload ELSE NULL END,
        'failureCode', d."failureCode", 'requestedAt', d."requestedAt", 'completedAt', d."completedAt",
        'confirmedAt', d."confirmedAt", 'source', jsonb_build_object('fileName', r."fileName", 'createdAt', r."createdAt"))
        ORDER BY d."requestedAt", d.id) FROM "ResumeParseDraft" d JOIN "ResumeFile" r ON r.id = d."resumeId"
        WHERE r."studentId" = p.id), '[]'::jsonb) AS drafts
    FROM "User" u LEFT JOIN "StudentProfile" p ON p."userId" = u.id
    WHERE u.id = ${userId} AND u.status = 'ACTIVE'
  `
  if (!row) return null
  // Re-normalize persisted JSON and reconstruct the safe DTO. Never spread raw drafts.
  row.files['resume-parse-drafts.json'] = row.drafts.map(draft => {
    let payload: unknown = null
    if (draft.state === 'READY' && draft.payload !== null) {
      try { payload = normalizeResumeSuggestion(draft.payload) } catch { /* Omit malformed legacy/provider data. */ }
    }
    const code = resumeParseFailureCodeSchema.safeParse(draft.failureCode)
    return {
      resumeId: draft.resumeId, generation: draft.generation, state: draft.state, payload,
      sourceSha256: draft.sourceSha256, schemaVersion: draft.schemaVersion, promptVersion: draft.promptVersion,
      requestedModel: draft.requestedModel, responseModel: draft.responseModel, appliedProfileRevision: draft.appliedProfileRevision,
      failureCode: code.success ? code.data : null,
      requestedAt: draft.requestedAt, completedAt: draft.completedAt, confirmedAt: draft.confirmedAt,
      source: { fileName: draft.source.fileName, createdAt: draft.source.createdAt },
    }
  })
  if (!row.hasProfile) {
    for (const file of ['profile.json', 'educations.json', 'experiences.json', 'languages.json', 'applications.json', 'invitations.json']) {
      delete row.files[file]
    }
  }
  // Keep existing Date.toJSON() and Prisma Decimal JSON representation for owner files.
  return {
    snapshotAt: row.snapshotAt.toISOString(),
    files: Object.fromEntries(Object.entries(row.files).map(([name, value]) => [name, normalizeDates(value)])), resumes: row.resumes,
  }
}
