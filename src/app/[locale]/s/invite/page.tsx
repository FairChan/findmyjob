import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { getQuota } from '@/server/services/job-view-quota'
import { getOrCreateReferralCode } from '@/server/services/referrals'
import { getSetting } from '@/server/services/settings'
import { db } from '@/server/db'
import { maskName } from '@/lib/mask-name'
import { CopyLinkButton } from './_components/CopyLinkButton'

export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('invite')
  const ctx = await requireStudent(await headers())

  // Resolve the StudentProfile id from the authenticated User id
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })
  if (!profile) {
    redirect(`/${locale}/s/onboarding`)
  }
  const profileId = profile.id

  const [quota, referralCode, tierSize, unlimitedAt, tierBonus] = await Promise.all([
    getQuota(profileId),
    getOrCreateReferralCode(profileId),
    getSetting<number>('studentQuota.tierSize', 3),
    getSetting<number>('studentQuota.unlimitedAt', 12),
    getSetting<number>('studentQuota.tierBonus', 10),
  ])

  // Build invite link using the current request's host
  const headersList = await headers()
  const host = headersList.get('host') ?? 'localhost:3000'
  const proto = headersList.get('x-forwarded-proto') ?? 'http'
  const inviteLink = `${proto}://${host}/${locale}/register/student?ref=${referralCode}`

  // Load referrals with invitee details
  const referrals = await db.referral.findMany({
    where: { referrerId: profileId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      invitee: {
        select: { fullName: true, completeness: true },
      },
    },
  })

  // Build milestone list: every tierSize referrals up to unlimitedAt
  const milestones: number[] = []
  for (let m = tierSize; m <= unlimitedAt; m += tierSize) {
    milestones.push(m)
  }
  if (milestones[milestones.length - 1] !== unlimitedAt) {
    milestones.push(unlimitedAt)
  }

  const isUnlimited = quota.limit === null

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      {/* Quota summary */}
      <section aria-label={t('quotaUsed')} className="rounded-lg border p-6 space-y-3">
        <div className="text-sm font-medium flex items-center justify-between">
          <span>
            {isUnlimited
              ? t('quotaProgressUnlimited', { used: quota.used })
              : t('quotaProgress', { used: quota.used, limit: quota.limit! })}
          </span>
          {!isUnlimited && (
            <span className="text-muted-foreground text-xs">
              {t('quotaLimit')}: {quota.limit}
            </span>
          )}
        </div>

        {!isUnlimited && (
          <div
            role="progressbar"
            aria-valuenow={quota.used}
            aria-valuemin={0}
            aria-valuemax={quota.limit ?? 0}
            aria-label={t('quotaUsed')}
            className="h-2 w-full rounded-full bg-muted overflow-hidden"
          >
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${Math.min(100, ((quota.used / (quota.limit ?? 1)) * 100))}%` }}
            />
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {isUnlimited
            ? t('alreadyUnlimited')
            : quota.next === unlimitedAt - quota.qualified
              ? t('nextUnlimited', { count: quota.next })
              : t('nextTier', { count: quota.next, bonus: tierBonus })}
        </p>
      </section>

      {/* Invite link */}
      <section className="space-y-2">
        <p className="text-sm font-medium">{t('inviteLinkLabel')}</p>
        <CopyLinkButton link={inviteLink} />
      </section>

      {/* Milestone progress */}
      <section aria-label={t('milestoneLabel')} className="space-y-2">
        <p className="text-sm font-medium">{t('milestoneLabel')}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {milestones.map((m) => {
            const reached = quota.qualified >= m
            const isLast = m === unlimitedAt
            return (
              <div
                key={m}
                className={[
                  'flex flex-col items-center rounded-md border px-3 py-2 text-xs font-medium min-w-[52px]',
                  reached ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground',
                ].join(' ')}
              >
                <span>{isLast ? t('milestoneUnlimited') : `+${(m / tierSize) * tierBonus}`}</span>
                <span className="font-normal">{m}</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Referral list */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('referralsTitle')}</h2>
        {referrals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('referralsEmpty')}</p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">{t('colName')}</th>
                  <th className="text-left px-4 py-2 font-medium">{t('colCompleteness')}</th>
                  <th className="text-left px-4 py-2 font-medium">{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((ref) => (
                  <tr key={ref.id} className="border-t">
                    <td className="px-4 py-3">
                      {ref.invitee?.fullName ? maskName(ref.invitee.fullName) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {ref.invitee ? `${ref.invitee.completeness}%` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {ref.status === 'QUALIFIED'
                        ? t('statusQualified')
                        : ref.status === 'VOID'
                          ? t('statusVoid')
                          : t('statusPending')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
