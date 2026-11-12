import { redirect } from 'next/navigation'
import { getMemberIdentity } from '@/server/services/member-identity'
import CompanyDetailPage from '@/components/company/company-detail-page'
export { generateMetadata } from '@/components/company/company-detail-page'

export default async function PublicCompanyPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  const member = await getMemberIdentity()
  if (member?.role === 'STUDENT') redirect(`/${locale}/s/companies/${encodeURIComponent(id)}`)
  return <CompanyDetailPage params={params} />
}
