import { describe, it, expect } from 'vitest'
import { computeCompleteness, type ProfileForCompleteness } from '@/server/lib/completeness'

const empty: ProfileForCompleteness = {
  workAuth: null,
  intents: [],
  languages: [],
  skills: [],
  headline: null,
  summary: null,
  educations: [],
  experiences: [],
  resumes: [],
  hasContact: false,
}

const full: ProfileForCompleteness = {
  workAuth: 'STUDENT_PASS',
  intents: ['INTERNSHIP'],
  languages: [{}],
  skills: ['TypeScript'],
  headline: 'Software Engineer',
  summary: 'Looking for internships',
  educations: [{}],
  experiences: [{}],
  resumes: [{}],
  hasContact: true,
}

describe('computeCompleteness', () => {
  it('returns 0 for empty profile', () => {
    expect(computeCompleteness(empty)).toBe(0)
  })

  it('returns 100 when all sections are filled', () => {
    expect(computeCompleteness(full)).toBe(100)
  })

  it('returns 90 when all filled except resume PDF', () => {
    expect(computeCompleteness({ ...full, resumes: [] })).toBe(90)
  })

  it('基本信息 contributes 30 when workAuth is set', () => {
    expect(computeCompleteness({ ...empty, workAuth: 'MY_CITIZEN' })).toBe(30)
  })

  it('基本信息 contributes 0 when workAuth is null', () => {
    expect(computeCompleteness({ ...full, workAuth: null })).toBe(70)
  })

  it('求职意向 contributes 15 when intents has at least one entry', () => {
    expect(computeCompleteness({ ...empty, workAuth: 'MY_CITIZEN', intents: ['FULL_TIME'] })).toBe(45)
  })

  it('求职意向 contributes 0 when intents is empty', () => {
    expect(computeCompleteness({ ...full, intents: [] })).toBe(85)
  })

  it('能力 contributes 20 when at least one language is present', () => {
    expect(computeCompleteness({ ...empty, languages: [{}] })).toBe(20)
  })

  it('能力 contributes 20 when skills are present', () => {
    expect(computeCompleteness({ ...empty, skills: ['Python'] })).toBe(20)
  })

  it('能力 contributes 20 when headline is present', () => {
    expect(computeCompleteness({ ...empty, headline: 'Developer' })).toBe(20)
  })

  it('能力 contributes 20 when summary is present', () => {
    expect(computeCompleteness({ ...empty, summary: 'Motivated student' })).toBe(20)
  })

  it('能力 contributes 0 when all ability fields are empty', () => {
    expect(computeCompleteness({ ...full, languages: [], skills: [], headline: null, summary: null })).toBe(80)
  })

  it('经历 contributes 20 when educations has entries', () => {
    expect(computeCompleteness({ ...empty, educations: [{}] })).toBe(20)
  })

  it('经历 contributes 20 when experiences has entries', () => {
    expect(computeCompleteness({ ...empty, experiences: [{}] })).toBe(20)
  })

  it('经历 contributes 0 when both arrays are empty', () => {
    expect(computeCompleteness({ ...full, educations: [], experiences: [] })).toBe(80)
  })

  it('简历 PDF contributes 10 when resumes has entries', () => {
    expect(computeCompleteness({ ...empty, resumes: [{}] })).toBe(10)
  })

  it('简历 PDF contributes 0 when resumes is empty', () => {
    expect(computeCompleteness({ ...full, resumes: [] })).toBe(90)
  })

  it('联系方式 contributes 5 when hasContact is true', () => {
    expect(computeCompleteness({ ...empty, hasContact: true })).toBe(5)
  })

  it('联系方式 contributes 0 when hasContact is false', () => {
    expect(computeCompleteness({ ...full, hasContact: false })).toBe(95)
  })

  it('能力 is not double-counted when multiple fields are set', () => {
    const p: ProfileForCompleteness = {
      ...empty,
      languages: [{}],
      skills: ['JS'],
      headline: 'Dev',
      summary: 'Summary',
    }
    expect(computeCompleteness(p)).toBe(20)
  })

  it('经历 is not double-counted when both education and experience are present', () => {
    const p: ProfileForCompleteness = {
      ...empty,
      educations: [{}],
      experiences: [{}],
    }
    expect(computeCompleteness(p)).toBe(20)
  })
})
