import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireStudent } from '@/server/authz'

export default async function StudentEntry({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await requireStudent(await headers())
  redirect(`/${locale}/s/jobs`)
}
