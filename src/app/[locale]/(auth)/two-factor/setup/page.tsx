import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import { db } from '@/server/db'
import TwoFactorSetup from '@/components/auth/TwoFactorSetup'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function TwoFactorSetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  let userId: string
  try {
    const ctx = await requireUser(await headers())
    userId = ctx.userId
  } catch (error) {
    if (error instanceof ForbiddenError) {
      redirect(`/${locale}/login`)
    }
    throw error
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true, twoFactorEnabled: true },
  })
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
    redirect(`/${locale}/login`)
  }

  const t = await getTranslations('twoFactorSetup')
  return (
    <div className="container mx-auto max-w-lg px-4 py-8 sm:py-12">
      <div className="rounded-tile bg-card p-5 sm:p-8">
        <h1 className="mb-4 text-2xl font-bold">{t(user.twoFactorEnabled ? 'alreadyEnabledTitle' : 'title')}</h1>
        <TwoFactorSetup locale={locale} alreadyEnabled={user.twoFactorEnabled} />
      </div>
    </div>
  )
}
