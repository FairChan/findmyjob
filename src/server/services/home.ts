import 'server-only'
import { db } from '../db'
import { toJobListItem, type JobListItem } from '../serializers/job'

export interface HomeStats {
  verifiedCompanyCount: number
  publishedJobCount: number
}

export async function getHomeStats(): Promise<HomeStats> {
  const now = new Date()
  const [verifiedCompanyCount, publishedJobCount] = await Promise.all([
    db.company.count({ where: { verificationStatus: 'VERIFIED', isActive: true } }),
    db.job.count({
      where: {
        status: 'PUBLISHED',
        OR: [{ deadline: null }, { deadline: { gte: now } }],
      },
    }),
  ])
  return { verifiedCompanyCount, publishedJobCount }
}

export async function getLatestJobs(limit = 6): Promise<JobListItem[]> {
  const now = new Date()
  const rows = await db.job.findMany({
    where: {
      status: 'PUBLISHED',
      OR: [{ deadline: null }, { deadline: { gte: now } }],
    },
    select: {
      id: true,
      title: true,
      type: true,
      category: true,
      workMode: true,
      state: true,
      city: true,
      salaryMin: true,
      salaryMax: true,
      salaryVisible: true,
      languages: true,
      skills: true,
      acceptsStudentPass: true,
      sponsorsWorkPass: true,
      headcount: true,
      deadline: true,
      publishedAt: true,
      company: {
        select: {
          id: true,
          displayNameZh: true,
          displayNameEn: true,
          legalName: true,
        },
      },
    },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  })
  return rows.map(toJobListItem)
}
