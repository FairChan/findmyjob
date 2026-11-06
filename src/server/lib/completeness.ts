import 'server-only'

/**
 * Weights: 基本信息 30 · 求职意向 15 · 能力 20 · 经历 20 · 简历 PDF 10 · 联系方式 5 = 100
 * Source: PRD §2.2
 */
export type ProfileForCompleteness = {
  workAuth: string | null
  intents: string[]
  languages: Array<unknown>
  skills: string[]
  headline: string | null
  summary: string | null
  educations: Array<unknown>
  experiences: Array<unknown>
  resumes: Array<unknown>
  hasContact: boolean
}

export function computeCompleteness(p: ProfileForCompleteness): number {
  let score = 0

  if (p.workAuth) score += 30

  if (p.intents.length > 0) score += 15

  if (
    p.languages.length > 0 ||
    p.skills.length > 0 ||
    p.headline != null ||
    p.summary != null
  ) {
    score += 20
  }

  if (p.educations.length > 0 || p.experiences.length > 0) score += 20

  if (p.resumes.length > 0) score += 10

  if (p.hasContact) score += 5

  return score
}
