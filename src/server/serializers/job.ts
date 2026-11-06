import 'server-only'
import type { JobType, WorkMode } from '@prisma/client'

export interface JobListItemInput {
  id: string
  title: string
  type: JobType
  category: string | null
  workMode: WorkMode
  state: string | null
  city: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryVisible: boolean
  languages: string[]
  skills: string[]
  acceptsStudentPass: boolean
  sponsorsWorkPass: boolean
  headcount: number | null
  deadline: Date | null
  publishedAt: Date | null
  company: { id: string; displayNameZh: string | null; displayNameEn: string | null; legalName: string }
}

export interface JobListItem {
  id: string
  title: string
  type: JobType
  category: string | null
  workMode: WorkMode
  state: string | null
  city: string | null
  salaryMin: number | null
  salaryMax: number | null
  languages: string[]
  skills: string[]
  acceptsStudentPass: boolean
  sponsorsWorkPass: boolean
  headcount: number | null
  deadline: Date | null
  publishedAt: Date | null
  company: { id: string; displayNameZh: string | null; displayNameEn: string | null; legalName: string }
}

/** List view: no description/requirements/benefits; salary omitted when salaryVisible=false. */
export function toJobListItem(job: JobListItemInput): JobListItem {
  return {
    id: job.id,
    title: job.title,
    type: job.type,
    category: job.category,
    workMode: job.workMode,
    state: job.state,
    city: job.city,
    salaryMin: job.salaryVisible ? job.salaryMin : null,
    salaryMax: job.salaryVisible ? job.salaryMax : null,
    languages: job.languages,
    skills: job.skills,
    acceptsStudentPass: job.acceptsStudentPass,
    sponsorsWorkPass: job.sponsorsWorkPass,
    headcount: job.headcount,
    deadline: job.deadline,
    publishedAt: job.publishedAt,
    company: job.company,
  }
}

export interface JobDetailInput extends JobListItemInput {
  description: string
  requirements: string | null
  benefits: string | null
  viewCount: number
}

export interface JobDetail extends JobListItem {
  description: string
  requirements: string | null
  benefits: string | null
  viewCount: number
}

/** Full detail view (shown only when student has quota / is unlocked). */
export function toJobDetail(job: JobDetailInput): JobDetail {
  return {
    ...toJobListItem(job),
    description: job.description,
    requirements: job.requirements,
    benefits: job.benefits,
    viewCount: job.viewCount,
  }
}
