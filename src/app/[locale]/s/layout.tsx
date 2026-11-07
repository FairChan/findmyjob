import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { requireStudent } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import StudentNav from '@/components/layout/StudentNav'

export default async function StudentLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  let userId: string
  try {
    const ctx = await requireStudent(await headers())
    userId = ctx.userId
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(`/${locale}/login`)
    }
    throw err
  }
  return (
    <>
      <StudentNav userId={userId} locale={locale} />
      {children}
    </>
  )
}
