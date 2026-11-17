/**
 * MA1-T08：建档 step1~4 schema 挪进 src/shared/mobile-api 之后语义不变——
 * student-profile 导出的就是共享的同一个对象，枚举与 Prisma、简历解析 schema 一致。
 */
import { describe, it, expect, vi } from 'vitest'
import { DegreeLevel, LanguageLevel, ExperienceKind, WorkAuth, JobType } from '@prisma/client'

vi.mock('server-only', () => ({}))

import * as shared from '@/shared/mobile-api/profile-inputs'
import {
  resumeDegreeLevelSchema,
  resumeExperienceKindSchema,
  resumeLanguageLevelSchema,
} from '@/server/schemas/resume-parsing'

describe('shared profile step schemas', () => {
  it('server student-profile re-exports the very same schema objects', async () => {
    const server = await import('@/server/services/student-profile')
    expect(server.step1Schema).toBe(shared.step1Schema)
    expect(server.step2Schema).toBe(shared.step2Schema)
    expect(server.step3Schema).toBe(shared.step3Schema)
    expect(server.step4Schema).toBe(shared.step4Schema)
  })

  it('enums match Prisma and the resume-parsing schema', () => {
    expect(shared.degreeLevelSchema.options).toEqual(Object.values(DegreeLevel))
    expect(shared.languageLevelSchema.options).toEqual(Object.values(LanguageLevel))
    expect(shared.experienceKindSchema.options).toEqual(Object.values(ExperienceKind))
    expect(shared.workAuthSchema.options).toEqual(Object.values(WorkAuth))
    expect(shared.jobTypeSchema.options).toEqual(Object.values(JobType))
    expect(shared.degreeLevelSchema.options).toEqual(resumeDegreeLevelSchema.options)
    expect(shared.languageLevelSchema.options).toEqual(resumeLanguageLevelSchema.options)
    expect(shared.experienceKindSchema.options).toEqual(resumeExperienceKindSchema.options)
  })

  it('keeps the same validation behaviour', () => {
    expect(shared.step1Schema.parse({ fullName: 'A', workAuth: 'OTHER', nationality: 'cn' }).nationality).toBe('CN')
    expect(shared.step1Schema.safeParse({ fullName: '', workAuth: 'OTHER' }).success).toBe(false)
    expect(shared.step2Schema.safeParse({ intents: [] }).success).toBe(false)
    expect(shared.step3Schema.safeParse({ languages: [], skills: Array(31).fill('x') }).success).toBe(false)
    expect(shared.step4Schema.safeParse({ educations: [], experiences: [{ kind: 'WORK', title: 'T' }] }).success).toBe(true)
    expect(shared.step4Schema.safeParse({ educations: [{ schoolName: 'S', startDate: '2026-01-01' }], experiences: [] }).success).toBe(false)
  })
})
