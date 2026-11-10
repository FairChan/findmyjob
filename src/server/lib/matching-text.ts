import 'server-only'
import { createHash } from 'node:crypto'
import type { DegreeLevel, JobType, WorkMode } from '@prisma/client'
import { MATCHING_TEMPLATE_VERSION } from '@/schemas/semantic-matching'
import { redact, REDACTED } from '@/lib/redact'
import { ValidationError } from '../errors'
import { employerFreeText } from '../serializers/talent-card'

export type MatchingText = { text: string; sourceHash: string }
export type StudentMatchingInput = {
  fullName: string; headline: string | null; major: string | null; degreeLevel: DegreeLevel | null
  skills: string[]; intents: JobType[]; preferredStates: string[]
}
export type JobMatchingInput = {
  title: string; type: JobType; category: string | null; workMode: WorkMode
  state: string | null; city: string | null; skills: string[]; languages: string[]
}

const useful = (value: string) => value.replaceAll(REDACTED, '').trim().length > 0
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
function normalizedSet(values: string[], clean: (value: string) => string): string[] {
  return [...new Set(values.map(value => clean(value).trim().toLowerCase()).filter(useful))].sort(compare)
}
function finish(kind: 'student' | 'job', fields: Record<string, string | string[] | null>): MatchingText {
  // Fixed insertion order, normalized set arrays, no source identity or private fields.
  const text = JSON.stringify({ template: MATCHING_TEMPLATE_VERSION, kind, ...fields })
  if (text.length > 8000 || Buffer.byteLength(text, 'utf8') > 32 * 1024) {
    throw new ValidationError('Matching career text exceeds its limit')
  }
  return { text, sourceHash: createHash('sha256').update(text, 'utf8').digest('hex') }
}

export function buildStudentMatchingText(input: StudentMatchingInput): MatchingText | null {
  const clean = (value: string) => employerFreeText(value, input.fullName, false).trim()
  const fields = {
    headline: clean(input.headline ?? ''), major: clean(input.major ?? ''), degreeLevel: clean(input.degreeLevel ?? ''),
    skills: normalizedSet(input.skills, clean), intents: normalizedSet(input.intents, clean),
    preferredStates: normalizedSet(input.preferredStates, clean),
  }
  if (!Object.values(fields).some(value => Array.isArray(value) ? value.length > 0 : useful(value))) return null
  return finish('student', fields)
}

export function buildJobMatchingText(input: JobMatchingInput): MatchingText {
  const clean = (value: string) => redact(value).trim()
  const fields = {
    title: clean(input.title), type: clean(input.type), category: clean(input.category ?? ''),
    workMode: clean(input.workMode), state: clean(input.state ?? ''), city: clean(input.city ?? ''),
    skills: normalizedSet(input.skills, clean), languages: normalizedSet(input.languages, clean),
  }
  if (!useful(fields.title)) throw new ValidationError('Matching career title is unavailable')
  return finish('job', fields)
}
