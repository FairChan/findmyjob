/**
 * Load-test seed — staging only.
 * Creates synthetic employer accounts with active sessions and writes
 * session cookies to load/accounts.local.json for use by k6 scripts.
 */
import { PrismaClient } from '@prisma/client'
import { Faker, zh_CN, en } from '@faker-js/faker'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

const APP_ENV = process.env.APP_ENV

if (APP_ENV !== 'staging') {
  console.error(`seed-load requires APP_ENV=staging (got: ${APP_ENV ?? 'undefined'})`)
  process.exit(1)
}

const faker = new Faker({ locale: [zh_CN, en] })

const db = new PrismaClient()

const COUNT = 20
const OUTPUT_PATH = path.join(__dirname, '..', 'load', 'accounts.local.json')

type Account = { cookie: string; userId: string; companyId: string; email: string }

async function main(): Promise<void> {
  const accounts: Account[] = []

  for (let i = 0; i < COUNT; i++) {
    const email = `loadtest-employer-${i}@example.test`

    // Upsert user
    const user = await db.user.upsert({
      where: { email },
      create: {
        email,
        name: faker.person.fullName(),
        role: 'EMPLOYER',
        status: 'ACTIVE',
        emailVerified: true,
        locale: 'zh',
      },
      update: { status: 'ACTIVE', emailVerified: true },
    })

    // Upsert company
    const ssm = `LL${String(i + 1).padStart(6, '0')}-X`
    const company = await db.company.upsert({
      where: { ssmRegNo: ssm },
      create: {
        legalName: `LoadTest Company ${i + 1} Sdn Bhd`,
        displayNameZh: `压测企业 ${i + 1}`,
        ssmRegNo: ssm,
        industryCode: 'technology.software',
        state: 'Kuala Lumpur',
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        isActive: true,
      },
      update: { verificationStatus: 'VERIFIED', isActive: true },
    })

    // Ensure CreditWallet exists (balance stays 0 — credits.ts not yet available)
    await db.creditWallet.upsert({
      where: { companyId: company.id },
      create: { companyId: company.id },
      update: {},
    })

    // Ensure CompanyMember (OWNER) link
    await db.companyMember.upsert({
      where: { companyId_userId: { companyId: company.id, userId: user.id } },
      create: { companyId: company.id, userId: user.id, role: 'OWNER' },
      update: {},
    })

    // Upsert session with a cryptographically random token
    const token = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    // Delete stale load-test sessions for this user before creating a fresh one
    await db.session.deleteMany({
      where: { userId: user.id, userAgent: 'k6/load-test' },
    })
    const session = await db.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
        ipAddress: '127.0.0.1',
        userAgent: 'k6/load-test',
      },
    })

    // Better Auth default session cookie name
    accounts.push({
      cookie: `better-auth.session_token=${session.token}`,
      userId: user.id,
      companyId: company.id,
      email,
    })
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(accounts, null, 2))
  console.log(`Wrote ${accounts.length} accounts to ${OUTPUT_PATH}`)
}

main()
  .then(() => db.$disconnect())
  .catch((e: unknown) => {
    console.error(e)
    void db.$disconnect()
    process.exit(1)
  })
