import 'server-only'
import type { DegreeLevel, ExperienceKind, Visibility, WorkAuth } from '@prisma/client'
import { maskName } from '@/lib/mask-name'
import { redact } from '@/lib/redact'

// --- Input types (narrow shapes to match Prisma results) ---

export interface SchoolSnippet {
  id: string
  nameZh: string
  nameEn: string
}

export interface EducationInput {
  id: string
  schoolName: string
  major: string | null
  degreeLevel: DegreeLevel | null
  startDate: Date | null
  endDate: Date | null
  description: string | null
  sortOrder: number
}

export interface ExperienceInput {
  id: string
  kind: ExperienceKind
  title: string
  organization: string | null
  startDate: Date | null
  endDate: Date | null
  description: string | null
  sortOrder: number
}

export interface ResumeInput {
  id: string
  storageKey: string
  isPrimary: boolean
  parsedJson: unknown
}

export interface ProfileCardInput {
  id: string
  fullName: string
  headline: string | null
  skills: string[]
  major: string | null
  degreeLevel: DegreeLevel | null
  graduationYear: number | null
  cgpa: { toString(): string } | null
  workAuth: WorkAuth | null
  completeness: number
  visibility: Visibility
  school: SchoolSnippet | null
}

export interface ProfileDetailInput extends ProfileCardInput {
  summary: string | null
  educations: EducationInput[]
  experiences: ExperienceInput[]
  resumes: ResumeInput[]
}

export interface ContactInput {
  phone: string | null
  email: string | null
  whatsapp: string | null
  wechat: string | null
  linkedinUrl: string | null
}

// --- Output types ---

export interface TalentCard {
  id: string
  name: string
  school: { id: string; nameZh: string; nameEn: string } | null
  major: string | null
  degreeLevel: DegreeLevel | null
  graduationYear: number | null
  cgpa: string | null
  skills: string[]
  headline: string | null
  completeness: number
  workAuth: WorkAuth | null
}

export interface TalentEducation {
  id: string
  schoolName: string
  major: string | null
  degreeLevel: DegreeLevel | null
  startDate: Date | null
  endDate: Date | null
  description: string | null
  sortOrder: number
}

export interface TalentExperience {
  id: string
  kind: ExperienceKind
  title: string
  organization: string | null
  startDate: Date | null
  endDate: Date | null
  description: string | null
  sortOrder: number
}

export interface TalentDetail extends TalentCard {
  summary: string | null
  educations: TalentEducation[]
  experiences: TalentExperience[]
  resumeCount: number
  resumePreview: unknown
  contact: ContactInput | null
}

// --- Name redaction for free-text fields (§5.2: full name must not appear when unlocked=false) ---

const COMPOUND_SURNAMES_REDACT = [
  '欧阳', '司马', '诸葛', '上官', '东方', '皇甫', '尉迟', '公孙', '慕容', '长孙', '令狐', '夏侯',
]

function redactNameParts(text: string, fullName: string): string {
  if (!fullName || !text) return text
  const HIDDEN = '[已隐藏]'
  let result = text
  if (result.includes(fullName)) {
    result = result.split(fullName).join(HIDDEN)
  }
  const chars = [...fullName]
  const firstCp = chars[0]?.codePointAt(0) ?? 0
  const isCjkFirst = firstCp >= 0x4e00 && firstCp <= 0x9fff
  if (isCjkFirst) {
    let surnameLen = 1
    for (const cs of COMPOUND_SURNAMES_REDACT) {
      if (fullName.startsWith(cs)) {
        surnameLen = [...cs].length
        break
      }
    }
    const given = chars.slice(surnameLen).join('')
    if ([...given].length >= 2 && result.includes(given)) {
      result = result.split(given).join(HIDDEN)
    }
  } else {
    for (const seg of fullName.split(/\s+/)) {
      if ([...seg].length >= 3) {
        const escaped = seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        result = result.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), HIDDEN)
      }
    }
  }
  return result
}

// --- Serializers ---

/**
 * Serializes a student profile for the employer talent card (list view).
 * When unlocked=false, PII in free-text fields is stripped; name is masked.
 * School name and major always go through redact() regardless of unlock state (TM-002).
 */
export function toTalentCard(
  profile: ProfileCardInput,
  opts: { unlocked: boolean },
): TalentCard {
  const { unlocked } = opts
  return {
    id: profile.id,
    name: unlocked ? profile.fullName : maskName(profile.fullName),
    school: profile.school
      ? {
          id: profile.school.id,
          nameZh: redact(profile.school.nameZh),
          nameEn: redact(profile.school.nameEn),
        }
      : null,
    major: profile.major != null ? redact(profile.major) : null,
    degreeLevel: profile.degreeLevel,
    graduationYear: profile.graduationYear,
    cgpa: profile.cgpa != null ? profile.cgpa.toString() : null,
    skills: unlocked
      ? profile.skills
      : profile.skills.map((s) => redactNameParts(redact(s), profile.fullName)),
    headline:
      profile.headline != null
        ? unlocked
          ? profile.headline
          : redactNameParts(redact(profile.headline), profile.fullName)
        : null,
    completeness: profile.completeness,
    workAuth: profile.workAuth,
  }
}

/**
 * Serializes a student profile for the employer talent detail view.
 * When unlocked=false, additional fields (summary, education description, experience fields)
 * are also redacted; structured resume preview and contact are withheld.
 */
export function toTalentDetail(
  profile: ProfileDetailInput,
  opts: { unlocked: boolean; contact?: ContactInput | null },
): TalentDetail {
  const { unlocked, contact = null } = opts
  const card = toTalentCard(profile, { unlocked })

  const primary =
    profile.resumes.find((r) => r.isPrimary) ?? profile.resumes[0] ?? null

  return {
    ...card,
    summary:
      profile.summary != null
        ? unlocked
          ? profile.summary
          : redactNameParts(redact(profile.summary), profile.fullName)
        : null,
    educations: [...profile.educations]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((edu) => ({
        id: edu.id,
        schoolName: redact(edu.schoolName),
        major:
          edu.major != null
            ? unlocked
              ? redact(edu.major)
              : redactNameParts(redact(edu.major), profile.fullName)
            : null,
        degreeLevel: edu.degreeLevel,
        startDate: edu.startDate,
        endDate: edu.endDate,
        description:
          edu.description != null
            ? unlocked
              ? edu.description
              : redactNameParts(redact(edu.description), profile.fullName)
            : null,
        sortOrder: edu.sortOrder,
      })),
    experiences: [...profile.experiences]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((exp) => ({
        id: exp.id,
        kind: exp.kind,
        title: unlocked
          ? exp.title
          : redactNameParts(redact(exp.title), profile.fullName),
        organization:
          exp.organization != null
            ? unlocked
              ? exp.organization
              : redactNameParts(redact(exp.organization), profile.fullName)
            : null,
        startDate: exp.startDate,
        endDate: exp.endDate,
        description:
          exp.description != null
            ? unlocked
              ? exp.description
              : redactNameParts(redact(exp.description), profile.fullName)
            : null,
        sortOrder: exp.sortOrder,
      })),
    resumeCount: profile.resumes.length,
    resumePreview: unlocked && primary ? primary.parsedJson : null,
    contact: unlocked ? contact : null,
  }
}
