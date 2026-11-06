#!/usr/bin/env node
// import-companies.ts
// Imports managed companies from a JSON file.
//
// Usage:
//   tsx --env-file-if-exists=.env scripts/import-companies.ts <path> [--dry-run]
//
// In dry-run mode, only validation is performed; nothing is written to the DB.
// Log output contains only counts and error line numbers, never field values.

import { readFileSync } from 'fs'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'

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

type CompanyImportInput = z.infer<typeof companyImportSchema>

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const filePath = args.find(a => !a.startsWith('--'))

  if (!filePath) {
    console.error('Usage: import-companies.ts <path> [--dry-run]')
    process.exit(1)
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (err) {
    console.error(`Failed to read or parse file: ${(err as Error).message}`)
    process.exit(1)
  }

  if (!Array.isArray(raw)) {
    console.error('Input file must contain a JSON array')
    process.exit(1)
  }

  const valid: { input: CompanyImportInput; originalLine: number }[] = []
  const errors: number[] = []

  for (let i = 0; i < raw.length; i++) {
    const result = companyImportSchema.safeParse(raw[i])
    if (result.success) {
      valid.push({ input: result.data, originalLine: i + 1 })
    } else {
      errors.push(i + 1)
    }
  }

  if (dryRun) {
    console.log(`${valid.length} 条有效，${errors.length} 条错误`)
    if (errors.length > 0) {
      console.log(`出错行号: ${errors.join(', ')}`)
    }
    return
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL is required for actual import')
    process.exit(1)
  }

  const prisma = new PrismaClient({ datasourceUrl: dbUrl })

  // Find the platform admin user
  const adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!adminUser) {
    console.error('No active admin user found in database')
    await prisma.$disconnect()
    process.exit(1)
  }

  let imported = 0
  const importErrors: number[] = []

  for (const { input, originalLine } of valid) {
    try {
      await prisma.$transaction(async tx => {
        await tx.company.create({
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
            actorId: adminUser.id,
            action: 'company.managed.create',
            targetType: 'Company',
            metadata: { legalName: input.legalName, importedFromFile: true },
          },
        })
      })
      imported++
    } catch {
      importErrors.push(originalLine)
    }
  }

  await prisma.$disconnect()

  console.log(`导入完成：${imported} 条成功，${importErrors.length + errors.length} 条错误`)
  if (errors.length > 0) {
    console.log(`验证失败行号: ${errors.join(', ')}`)
  }
  if (importErrors.length > 0) {
    console.log(`导入失败行号: ${importErrors.join(', ')}`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
