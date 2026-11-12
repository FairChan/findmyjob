import { getTranslations } from 'next-intl/server'
import { db } from '@/server/db'
import { getMemberIdentity } from '@/server/services/member-identity'
import type { Locale } from '@/i18n/routing'
import { MemberHeader, type MemberLink } from './member-header'

export async function MemberNavigation({ locale }: { locale: Locale }) {
  const user = await getMemberIdentity()
  if (!user || user.role === 'ADMIN') return null
  const [t, nav, app, employer, invitations, marketing] = await Promise.all([
    getTranslations('memberNav'), getTranslations('nav'), getTranslations('appNav'),
    getTranslations('employerDashboard'), getTranslations('invitations'), getTranslations('marketing'),
  ])
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } })
  let links: MemberLink[]
  let accountLinks: MemberLink[]
  let displayName = user.name
  if (user.role === 'STUDENT') {
    const profile = await db.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true, fullName: true } })
    displayName = profile?.fullName || user.name
    const pending = profile ? await db.invitation.count({ where: { studentId: profile.id, status: 'SENT' } }) : 0
    links = [
      { href: '/s/jobs', label: app('findJobs') },
      { href: '/s/companies', label: t('exploreCompanies') },
      { href: '/s/applications', label: nav('myApplications') },
      { href: '/s/invitations', label: invitations('navInvitations'), count: pending },
      { href: '/s/resume', label: app('resume') },
      { href: '/s/notifications', label: nav('notifications'), count: unread },
    ]
    accountLinks = [
      { href: '/s/profile', label: t('profile') },
      { href: '/s/contact', label: t('contact') },
      { href: '/s/school-verify', label: t('schoolVerification') },
      { href: '/s/invite', label: app('inviteFriends') },
      { href: '/s/privacy', label: nav('privacy') },
      { href: '/s/settings', label: app('settings') },
    ]
  } else {
    const member = await db.companyMember.findFirst({ where: { userId: user.id }, select: { role: true } })
    links = member ? [
      { href: '/e/jobs', label: app('jobs') },
      { href: '/e/talent', label: app('talent') },
      { href: '/e/folders', label: app('folders') },
      { href: '/e/invitations', label: app('sentInvitations') },
      { href: '/e/team', label: employer('linkTeam') },
      { href: '/e/notifications', label: nav('notifications'), count: unread },
    ] : [
      { href: '/e/onboarding', label: t('companyOnboarding') },
      { href: '/e/notifications', label: nav('notifications'), count: unread },
    ]
    accountLinks = [{ href: '/e/settings', label: t('account') }]
    if (member?.role === 'OWNER' || member?.role === 'ADMIN') accountLinks.push(
      { href: '/e/company', label: employer('linkCompany') },
      { href: '/e/verification', label: employer('linkVerification') },
    )
    if (member?.role === 'OWNER') accountLinks.push({ href: '/e/billing', label: employer('linkBilling') })
    accountLinks.push({ href: '/e/preferences', label: marketing('preferencesLink') })
  }
  return <MemberHeader locale={locale} home={user.role === 'STUDENT' ? '/s/jobs' : '/e'} name={displayName} image={user.image}
    navigationLabel={user.role === 'STUDENT' ? nav('studentNavigation') : app('employerNavigation')} links={links} accountLinks={accountLinks} />
}
