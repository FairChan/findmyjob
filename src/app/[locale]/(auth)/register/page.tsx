import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { GraduationCap, Building2 } from 'lucide-react'

interface Props {
  params: Promise<{ locale: string }>
}

export default async function RegisterLandingPage(_: Props) {
  const t = await getTranslations('registerLanding')
  const tReg = await getTranslations('register')

  return (
    <div className="container mx-auto max-w-2xl px-4 py-16">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Student card */}
        <Link
          href="/register/student"
          className="group flex flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center transition-colors hover:border-brand hover:bg-brand/5"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand transition-colors group-hover:bg-brand/20">
            <GraduationCap className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t('studentTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('studentDesc')}</p>
          </div>
        </Link>

        {/* Employer card */}
        <Link
          href="/register/employer"
          className="group flex flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center transition-colors hover:border-brand hover:bg-brand/5"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-muted/80">
            <Building2 className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t('employerTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('employerDesc')}</p>
          </div>
        </Link>
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        {tReg('loginHint')}{' '}
        <Link href="/login" className="text-brand hover:underline underline-offset-4">
          {tReg('loginLink')}
        </Link>
      </p>
    </div>
  )
}
