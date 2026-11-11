import { headers } from 'next/headers'
import { requireStudent } from '@/server/authz'
import JobDetailPage from '@/components/jobs/job-detail-page'

export default async function StudentJobModal({ params }: {
  params: Promise<{ locale: string; id: string }>
}) {
  await requireStudent(await headers())
  return <JobDetailPage params={params} listHref="/s/jobs" presentation="modal" />
}
