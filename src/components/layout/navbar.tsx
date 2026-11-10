import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/i18n/routing'
import { Navbar1 } from '@/components/ui/navbar-1'
import LocaleSwitcher from './locale-switcher'
import { Wordmark } from './wordmark'

export default async function Navbar({ locale }: { locale: Locale }) {
  const t = await getTranslations('nav')

  return (
    <Navbar1
      brand={<Wordmark prominent />}
      brandLabel="FindMYJob"
      links={[
        { href: '/jobs', label: t('jobs') },
        { href: '/companies', label: t('companies') },
        { href: '/for-employers', label: t('forEmployers') },
        { href: '/safety', label: t('safety') },
      ]}
      login={{ href: '/login', label: t('login') }}
      cta={{ href: '/register', label: t('register') }}
      extra={<LocaleSwitcher currentLocale={locale} />}
      labels={{ primaryNavigation: t('primaryNavigation'), openMenu: t('openMenu') }}
    />
  )
}
