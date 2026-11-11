import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import { getInviteDetails } from '@/server/services/team'
import AcceptInviteClient from '@/components/team/accept-invite-client'
import { WorkspacePage } from '@/components/layout/workspace-page'

export default async function AcceptInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ token?: string }>
}) {
  const { locale } = await params
  const { token } = await searchParams
  const t = await getTranslations('teamAccept')

  if (!token) {
    redirect(`/${locale}`)
  }

  // Check user is logged in; preserve the token so they land back here after auth.
  try {
    await requireUser(await headers())
  } catch (err) {
    if (err instanceof ForbiddenError) {
      const acceptUrl = `/${locale}/e/team/accept?token=${token}`
      redirect(`/${locale}/login?redirect=${encodeURIComponent(acceptUrl)}`)
    }
    throw err
  }

  const details = await getInviteDetails(token)

  return (
    <WorkspacePage title={t('title')} width="narrow">
      {details ? (
        <AcceptInviteClient
          token={token}
          companyName={details.companyName}
          role={details.role}
          locale={locale}
          t={{
            companyLabel: t('companyLabel'),
            roleLabel: t('roleLabel'),
            roleAdmin: t('roleAdmin'),
            roleRecruiter: t('roleRecruiter'),
            acceptButton: t('acceptButton'),
            successMessage: t('successMessage'),
            errorForbidden: t('errorForbidden'),
            errorAlreadyUsed: t('errorAlreadyUsed'),
            errorExpired: t('errorExpired'),
            errorUnknown: t('errorUnknown'),
          }}
        />
      ) : (
        <div className="rounded-card bg-destructive-muted p-5">
          <p className="text-sm text-destructive">{t('invalidOrExpired')}</p>
        </div>
      )}
    </WorkspacePage>
  )
}
