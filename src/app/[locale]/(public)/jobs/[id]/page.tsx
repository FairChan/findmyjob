import { redirect } from 'next/navigation'
import { getMemberIdentity } from '@/server/services/member-identity'
import JobDetailPage from '@/components/jobs/job-detail-page'
export { generateMetadata } from '@/components/jobs/job-detail-page'

export default async function PublicJobPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  const member = await getMemberIdentity()
  if (member?.role === 'STUDENT') redirect(`/${locale}/s/jobs/${encodeURIComponent(id)}`)
  return <JobDetailPage params={params} />
}
