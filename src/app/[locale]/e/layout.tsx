import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { requireEmployer } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'

export default async function EmployerLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  try {
    await requireEmployer(await headers())
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(`/${locale}/login`)
    }
    throw err
  }
  return <>{children}</>
}
