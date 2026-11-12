import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireEmployer } from '@/server/authz'
import { db } from '@/server/db'

export default async function EmployerEntry({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const { userId } = await requireEmployer(await headers())
  const member = await db.companyMember.findFirst({ where: { userId }, select: { id: true } })
  redirect(`/${locale}/e/${member ? 'jobs' : 'onboarding'}`)
}
