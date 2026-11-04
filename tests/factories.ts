/**
 * Test data factories.
 *
 * Uses a deterministic faker seed so the same call sequence always produces
 * the same values. Reset with `faker.seed(FAKER_SEED)` before each test suite
 * that needs reproducible data.
 *
 * Email domains: example.test (preferred) or example.com only.
 *
 * Sentinel values: inject into free-text fields to verify PII-leak detection.
 */
import { Faker, zh_CN, en } from '@faker-js/faker'
import type { PrismaClient } from '@prisma/client'

// Single Faker instance: Chinese locale with English fallback
export const faker = new Faker({ locale: [zh_CN, en] })

/** Default seed — reset to this for reproducible test runs. */
export const FAKER_SEED = 20261109
faker.seed(FAKER_SEED)

// ---- Sentinel values (write into free-text to test PII-leak detection) --

export const SENTINEL = {
  phone: '+60 12-000 0420',
  email: 'leak-sentinel@example.test',
  name: '哨兵测试同学甲',
} as const

// ---- Helpers ------------------------------------------------------------

function testEmail(prefix?: string): string {
  const local = prefix ?? faker.string.alphanumeric(10).toLowerCase()
  // Alternate between example.test and example.com
  const domain = faker.datatype.boolean() ? 'example.test' : 'example.com'
  return `${local}@${domain}`
}

// ---- Student factory ----------------------------------------------------

export interface StudentResult {
  userId: string
  profileId: string
  name: string
  email: string
}

export async function createStudent(
  db: PrismaClient,
  overrides?: {
    name?: string
    email?: string
    emailVerified?: boolean
    completeness?: number
  }
): Promise<StudentResult> {
  const name = overrides?.name ?? faker.person.fullName()
  const email = overrides?.email ?? testEmail()

  const user = await db.user.create({
    data: {
      name,
      email,
      emailVerified: overrides?.emailVerified ?? true,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  })

  const profile = await db.studentProfile.create({
    data: {
      userId: user.id,
      fullName: name,
      visibility: 'HIDDEN',
      completeness: overrides?.completeness ?? 0,
    },
  })

  return { userId: user.id, profileId: profile.id, name, email }
}

// ---- Employer / Company factory -----------------------------------------

export interface EmployerResult {
  userId: string
  companyId: string
  email: string
}

export async function createEmployer(
  db: PrismaClient,
  overrides?: {
    email?: string
    legalName?: string
  }
): Promise<EmployerResult> {
  const email = overrides?.email ?? testEmail()

  const user = await db.user.create({
    data: {
      name: faker.person.fullName(),
      email,
      emailVerified: true,
      role: 'EMPLOYER',
      status: 'ACTIVE',
    },
  })

  const company = await db.company.create({
    data: {
      legalName: overrides?.legalName ?? faker.company.name(),
      verificationStatus: 'UNSUBMITTED',
      isActive: true,
    },
  })

  await db.companyMember.create({
    data: {
      userId: user.id,
      companyId: company.id,
      role: 'OWNER',
    },
  })

  return { userId: user.id, companyId: company.id, email }
}

// ---- Job factory --------------------------------------------------------

export async function createJob(
  db: PrismaClient,
  companyId: string,
  createdById: string,
  overrides?: {
    status?: 'DRAFT' | 'PUBLISHED' | 'PENDING_REVIEW' | 'CLOSED' | 'REJECTED'
  }
) {
  return db.job.create({
    data: {
      companyId,
      createdById,
      title: faker.person.jobTitle(),
      description: faker.lorem.paragraphs(2),
      type: 'INTERNSHIP',
      workMode: 'HYBRID',
      status: overrides?.status ?? 'PUBLISHED',
    },
  })
}
