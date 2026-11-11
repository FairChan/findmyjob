import { headers } from 'next/headers'
import { requireStudent } from '@/server/authz'
import CompanyDetailPage from '@/components/company/company-detail-page'

export const metadata = { robots: { index: false, follow: false } }

export default async function StudentCompanyPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{cursor?: string}> }) {
  await requireStudent(await headers())
  return <CompanyDetailPage params={params} searchParams={searchParams} member />
}
