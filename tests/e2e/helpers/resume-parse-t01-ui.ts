import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { expect, type Page } from '@playwright/test'
import { e2eDb as db } from './db'
import { loginAs } from './session'
import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'

export const t01Copy = (locale: 'en' | 'zh') => locale === 'zh' ? zh : en
export const syntheticSuggestion = {
  headline: 'SYNTHETIC AI 标题', summary: 'SYNTHETIC AI 简介', skills: ['SYNTHETIC SQL'],
  languages: [{ language: 'English', level: 'FLUENT' }],
  educations: [{ schoolName: 'SYNTHETIC AI School', degreeLevel: 'MASTER', major: null, startDate: null, endDate: null, gpa: null, description: null }],
  experiences: [{ kind: 'PROJECT', title: 'SYNTHETIC AI project', organization: null, startDate: null, endDate: null, description: null }],
}

export class ResumeReviewFixture {
  readonly marker = 'M9T01_' + randomUUID().replaceAll('-', '').slice(0, 12)
  readonly resumeIds: string[] = []
  private snapshot: { value: Prisma.JsonValue; updatedById: string | null; updatedAt: Date } | null = null
  private touched = false
  private epoch = randomUUID()
  userId = ''
  profileId = ''
  version = ''
  constructor(readonly page: Page) {}
  async init() {
    if (process.env.ANTHROPIC_API_KEY !== 'SYNTHETIC_T01_NO_EXTERNAL_AI'
      || process.env.AI_MODEL_PARSE !== 'synthetic-t01-no-external-ai' || !process.env.T01_AI_BLOCK_LOG) throw new Error('Use playwright.t01-ui.config.ts')
    expect(await db.resumeParseDraft.count({ where: { state: { in: ['QUEUED', 'PROCESSING'] } } })).toBe(0)
    this.snapshot = await db.systemSetting.findUnique({ where: { key: 'ai.resumeParse' }, select: { value: true, updatedAt: true, updatedById: true } })
    const value = this.snapshot?.value
    expect(value == null || typeof value === 'object' && !Array.isArray(value) && value.enabled === false,
      'Refusing to replace an enabled or invalid baseline AI setting').toBe(true)
    const legal = (await db.systemSetting.findUnique({ where: { key: 'legal.currentVersion' } }))?.value ?? '2026-11-draft'
    if (typeof legal !== 'string' || !legal.length || legal.length > 100) throw new Error('Valid current legal version required')
    this.version = legal
    const actor = await loginAs(this.page, { role: 'STUDENT' })
    this.userId = actor.userId
    const profile = await db.studentProfile.create({ data: {
      userId: this.userId, fullName: this.marker + ' Student', headline: 'SYNTHETIC existing headline', summary: 'SYNTHETIC existing summary',
      skills: ['SYNTHETIC existing skill'], visibility: 'HIDDEN', workAuth: 'STUDENT_PASS', onboardingStep: 5,
      languages: { create: [{ language: 'English', level: 'BASIC' }] },
      educations: { create: [{ schoolName: 'SYNTHETIC original school', degreeLevel: 'BACHELOR' }] },
      experiences: { create: [{ kind: 'WORK', title: 'SYNTHETIC original role' }] },
    } })
    this.profileId = profile.id
    this.touched = true
    await this.gate(true)
  }
  async gate(enabled: boolean) {
    const value = { enabled, legalVersion: this.version, epoch: this.epoch }
    await db.systemSetting.upsert({ where: { key: 'ai.resumeParse' }, create: { key: 'ai.resumeParse', value }, update: { value } })
  }
  async resume() {
    const resume = await db.resumeFile.create({ data: {
      studentId: this.profileId, storageKey: 'resumes/' + this.profileId + '/' + this.marker + '-' + this.resumeIds.length + '.pdf',
      fileName: this.marker + '-' + this.resumeIds.length + '.pdf', mimeType: 'application/pdf', sizeBytes: 100,
      pageCount: 1, isPrimary: this.resumeIds.length === 0, contentSha256: 'a'.repeat(64),
    } })
    this.resumeIds.push(resume.id)
    return resume
  }
  async seedReady(resumeId: string) {
    if (!this.resumeIds.includes(resumeId)) throw new Error('Unowned resume seed')
    const resume = await db.resumeFile.findUniqueOrThrow({ where: { id: resumeId } })
    const grant = await db.consent.findFirstOrThrow({ where: { userId: this.userId, type: 'AI_RESUME_PARSE' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    expect(grant.granted).toBe(true); expect(grant.version).toBe(this.version)
    return db.resumeParseDraft.create({ data: {
      resumeId, state: 'READY', generation: 1, sourceStorageKey: resume.storageKey, sourceSha256: resume.contentSha256!,
      consentGrantId: grant.id, legalVersion: this.version, gateEpoch: this.epoch,
      promptVersion: 'resume-parse-v1', schemaVersion: 1, requestedModel: 'synthetic-t01-no-external-ai',
      payload: syntheticSuggestion, completedAt: new Date(), attempts: 1,
    } })
  }
  async state() {
    return db.studentProfile.findUniqueOrThrow({ where: { id: this.profileId }, include: {
      languages: { orderBy: { language: 'asc' } }, educations: { orderBy: { id: 'asc' } }, experiences: { orderBy: { id: 'asc' } }, contact: true,
    } })
  }
  async open(locale: 'en' | 'zh', resumeId: string) {
    const t = t01Copy(locale).resumeParse
    await this.page.goto('/' + locale + '/s/resume')
    const panel = this.page.getByTestId('resume-parse-panel')
    await panel.getByRole('combobox', { name: t.sourceFile, exact: true }).selectOption(resumeId)
    await panel.getByRole('button', { name: t.loadDraft, exact: true }).click()
    return panel
  }
  async cleanup() {
    try {
      if (this.touched) {
        if (this.snapshot) {
          const data = { ...this.snapshot, value: this.snapshot.value === null ? Prisma.JsonNull : this.snapshot.value }
          await db.systemSetting.upsert({ where: { key: 'ai.resumeParse' }, create: { key: 'ai.resumeParse', ...data }, update: data })
        } else await db.systemSetting.deleteMany({ where: { key: 'ai.resumeParse' } })
      }
    } finally {
      if (this.userId) {
        await db.resumeFile.deleteMany({ where: { id: { in: this.resumeIds }, studentId: this.profileId } })
        await db.studentProfile.updateMany({ where: { id: this.profileId, userId: this.userId }, data: { visibility: 'HIDDEN' } })
        await db.session.deleteMany({ where: { userId: this.userId } })
        await db.account.deleteMany({ where: { userId: this.userId } })
        await db.user.updateMany({ where: { id: this.userId }, data: { status: 'SUSPENDED' } })
      }
    }
    expect(existsSync(process.env.T01_AI_BLOCK_LOG!)).toBe(false)
  }
}
