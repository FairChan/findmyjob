#!/usr/bin/env node
// import-companies.ts
// Imports managed companies from a JSON file.
//
// Usage:
//   tsx --env-file-if-exists=.env scripts/import-companies.ts <path> --actor-id <adminUserId> [--dry-run]
//
// IMPORT_ACTOR_ID env var may be used instead of --actor-id.
// In dry-run mode, only validation is performed; nothing is written to the DB.
// Log output contains only counts and error line numbers, never field values.

import { readFileSync } from 'fs'
import { z } from 'zod'
import { PrismaClient, Prisma } from '@prisma/client'

const COMPANY_SIZES = ['S1_10', 'S11_50', 'S51_200', 'S201_1000', 'S1000_PLUS'] as const

const companyImportSchema = z.object({
  legalName: z.string().min(2).max(200),
  displayNameZh: z.string().max(100).optional(),
  displayNameEn: z.string().max(100).optional(),
  ssmRegNo: z.string().max(50).optional(),
  industryCode: z.string().optional(),
  size: z.enum(COMPANY_SIZES).optional(),
  website: z.string().max(255).optional(),
  state: z.string().max(50).optional(),
  city: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
})

export type CompanyImportInput = z.infer<typeof companyImportSchema>

export interface ValidationResult {
  valid: { input: CompanyImportInput; originalLine: number }[]
  errorLines: number[]
}

/** Pure validation step — no I/O. Exported for unit testing. */
export function validateCompanies(raw: unknown[]): ValidationResult {
  const valid: { input: CompanyImportInput; originalLine: number }[] = []
  const errorLines: number[] = []

  for (let i = 0; i < raw.length; i++) {
    const result = companyImportSchema.safeParse(raw[i])
    if (result.success) {
      valid.push({ input: result.data, originalLine: i + 1 })
    } else {
      errorLines.push(i + 1)
    }
  }
  return { valid, errorLines }
}

/** Deduplicates rows: SSM numbers must be unique; rows without SSM deduplicated by legalName. */
export function deduplicateRows(
  rows: { input: CompanyImportInput; originalLine: number }[],
): { deduped: { input: CompanyImportInput; originalLine: number }[]; skippedLines: number[] } {
  const seenSsm = new Set<string>()
  const seenLegalName = new Set<string>()
  const deduped: { input: CompanyImportInput; originalLine: number }[] = []
  const skippedLines: number[] = []

  for (const row of rows) {
    const { ssmRegNo, legalName } = row.input
    if (ssmRegNo) {
      const key = ssmRegNo.trim().toLowerCase()
      if (seenSsm.has(key)) {
        skippedLines.push(row.originalLine)
        continue
      }
      seenSsm.add(key)
    } else {
      const key = legalName.trim().toLowerCase()
      if (seenLegalName.has(key)) {
        skippedLines.push(row.originalLine)
        continue
      }
      seenLegalName.add(key)
    }
    deduped.push(row)
  }
  return { deduped, skippedLines }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const filePath = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--actor-id')
  const actorIdArg = (() => {
    const idx = args.indexOf('--actor-id')
    return idx !== -1 ? args[idx + 1] : undefined
  })()
  const actorId = actorIdArg ?? process.env.IMPORT_ACTOR_ID

  if (!filePath) {
    console.error('Usage: import-companies.ts <path> --actor-id <adminUserId> [--dry-run]')
    process.exit(1)
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    console.error('Failed to read or parse input file')
    process.exit(1)
  }

  if (!Array.isArray(raw)) {
    console.error('Input file must contain a JSON array')
    process.exit(1)
  }

  const { valid, errorLines } = validateCompanies(raw)
  const { deduped, skippedLines } = deduplicateRows(valid)

  if (dryRun) {
    console.log(`验证通过 ${deduped.length} 条，校验失败 ${errorLines.length} 条，重复跳过 ${skippedLines.length} 条`)
    if (errorLines.length > 0) console.log(`验证失败行号: ${errorLines.join(', ')}`)
    if (skippedLines.length > 0) console.log(`重复跳过行号: ${skippedLines.join(', ')}`)
    return
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL is required for actual import')
    process.exit(1)
  }

  if (!actorId) {
    console.error('--actor-id <adminUserId> or IMPORT_ACTOR_ID env var is required for actual import')
    process.exit(1)
  }

  const prisma = new PrismaClient({ datasourceUrl: dbUrl })

  // Verify actor is an active admin
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { role: true, status: true },
  })
  if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE') {
    console.error('Actor is not an active admin user')
    await prisma.$disconnect()
    process.exit(1)
  }

  let imported = 0
  const importErrors: number[] = []

  for (const { input, originalLine } of deduped) {
    try {
      const company = await prisma.$transaction(async tx => {
        const c = await tx.company.create({
          data: {
            legalName: input.legalName,
            displayNameZh: input.displayNameZh ?? null,
            displayNameEn: input.displayNameEn ?? null,
            ssmRegNo: input.ssmRegNo || null,
            industryCode: input.industryCode || null,
            size: input.size ?? null,
            website: input.website || null,
            state: input.state || null,
            city: input.city || null,
            address: input.address || null,
            description: input.description || null,
            isManaged: true,
            verificationStatus: 'VERIFIED',
            verifiedAt: new Date(),
          },
        })
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'company.managed.create',
            targetType: 'Company',
            targetId: c.id,
            metadata: { importedFromFile: true } as Prisma.InputJsonValue,
          },
        })
        return c
      })
      void company
      imported++
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Duplicate SSM number from a concurrent insert — treat as a skipped duplicate
        console.log(`行 ${originalLine}: 跳过（SSM 号已存在）`)
      }
      importErrors.push(originalLine)
    }
  }

  await prisma.$disconnect()

  const totalErrors = errorLines.length + skippedLines.length + importErrors.length
  console.log(`导入完成：${imported} 条成功，${totalErrors} 条未导入`)
  if (errorLines.length > 0) console.log(`验证失败行号: ${errorLines.join(', ')}`)
  if (skippedLines.length > 0) console.log(`重复跳过行号: ${skippedLines.join(', ')}`)
  if (importErrors.length > 0) console.log(`导入失败行号: ${importErrors.join(', ')}`)
}

// Only run when executed directly (not when imported by tests)
if (process.argv[1]?.endsWith('import-companies.ts') || process.argv[1]?.endsWith('import-companies.js')) {
  main().catch(() => {
    console.error('Fatal error during import')
    process.exit(1)
  })
}
