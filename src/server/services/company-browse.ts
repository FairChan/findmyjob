import 'server-only'
import type { JobType, WorkMode } from '@prisma/client'
import { db } from '../db'

const JOB_PAGE_SIZE = 20

export interface CompanyBrowseJob {
  id: string
  title: string
  type: JobType
  workMode: WorkMode
  state: string | null
  city: string | null
  salaryMin: number | null
  salaryMax: number | null
  acceptsStudentPass: boolean
  sponsorsWorkPass: boolean
}

export async function listCompanyBrowseJobs(companyId: string, cursor?: string): Promise<{
  items: CompanyBrowseJob[]
  nextCursor: string | null
}> {
  const jobs = await db.job.findMany({
    where: {
      companyId,
      company: { isActive: true, verificationStatus: 'VERIFIED' },
      status: 'PUBLISHED',
      OR: [{ deadline: null }, { deadline: { gt: new Date() } }],
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    select: {
      id: true,
      title: true,
      type: true,
      workMode: true,
      state: true,
      city: true,
      salaryMin: true,
      salaryMax: true,
      salaryVisible: true,
      acceptsStudentPass: true,
      sponsorsWorkPass: true,
    },
    orderBy: { id: 'asc' },
    take: JOB_PAGE_SIZE + 1,
  })
  const hasMore = jobs.length > JOB_PAGE_SIZE
  const items = jobs.slice(0, JOB_PAGE_SIZE).map(({ salaryVisible, ...summary }) => ({
    ...summary,
    salaryMin: salaryVisible ? summary.salaryMin : null,
    salaryMax: salaryVisible ? summary.salaryMax : null,
  }))
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null }
}
