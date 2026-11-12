import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { getQuota } from '@/server/services/job-view-quota'
import { getOrCreateReferralCode } from '@/server/services/referrals'
import { getSetting } from '@/server/services/settings'
import { db } from '@/server/db'
import { maskName } from '@/lib/mask-name'
import { cn } from '@/lib/utils'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { CopyLinkButton } from './_components/CopyLinkButton'

const REFERRAL_TONE: Record<string, BadgeProps['tone']> = {
  QUALIFIED: 'success',
  VOID: 'plain',
  PENDING: 'warning',
}

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
    <WorkspacePage title={t('title')}>
      {/* Quota summary */}
      <section aria-label={t('quotaUsed')}>
        <Card size="tile" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-title">
              {isUnlimited
                ? t('quotaProgressUnlimited', { used: quota.used })
                : t('quotaProgress', { used: quota.used, limit: quota.limit! })}
            </p>
            {!isUnlimited && (
              <span className="text-sm text-muted-foreground">
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
              className="h-2 w-full overflow-hidden rounded-full bg-foreground/10"
            >
              <div
                className="h-full rounded-full bg-foreground transition-[width] motion-reduce:transition-none"
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
        </Card>
      </section>

      {/* Invite link */}
      <section className="space-y-3">
        <h2 className="text-title">{t('inviteLinkLabel')}</h2>
        <CopyLinkButton link={inviteLink} />
      </section>

      {/* Milestone progress */}
      <section aria-labelledby="invite-milestones" className="space-y-3">
        <h2 id="invite-milestones" className="text-title">
          {t('milestoneLabel')}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {milestones.map((m) => {
            const reached = quota.qualified >= m
            const isLast = m === unlimitedAt
            return (
              <li
                key={m}
                className={cn(
                  'flex min-w-[4.5rem] flex-col items-center rounded-control px-3 py-2.5 text-sm font-medium',
                  reached ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
                )}
              >
                <span>{isLast ? t('milestoneUnlimited') : `+${(m / tierSize) * tierBonus}`}</span>
                <span className="text-xs font-normal">{m}</span>
                {/* Colour alone must not carry which tiers are already earned. */}
                {reached && <span className="sr-only">{t('milestoneReached')}</span>}
              </li>
            )
          })}
        </ul>
      </section>

      {/* Referral list */}
      <section className="space-y-3">
        <h2 id="invite-referrals" className="text-title">{t('referralsTitle')}</h2>
        {referrals.length === 0 ? (
          <p className="rounded-card bg-muted px-5 py-6 text-sm text-muted-foreground">{t('referralsEmpty')}</p>
        ) : (
          // Focusable so the table can still be scrolled by keyboard if it ever overflows.
          <div
            role="region"
            aria-labelledby="invite-referrals"
            tabIndex={0}
            className="overflow-x-auto rounded-card bg-muted"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-3 font-medium">{t('colName')}</th>
                  <th scope="col" className="px-5 py-3 font-medium">{t('colCompleteness')}</th>
                  <th scope="col" className="px-5 py-3 font-medium">{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((ref) => (
                  <tr key={ref.id} className="border-t border-foreground/10">
                    <td className="px-5 py-3.5">
                      {ref.invitee?.fullName ? maskName(ref.invitee.fullName) : '—'}
                    </td>
                    <td className="px-5 py-3.5 tabular-nums">
                      {ref.invitee ? `${ref.invitee.completeness}%` : '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge tone={REFERRAL_TONE[ref.status] ?? 'warning'}>
                        {ref.status === 'QUALIFIED'
                          ? t('statusQualified')
                          : ref.status === 'VOID'
                            ? t('statusVoid')
                            : t('statusPending')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </WorkspacePage>
  )
}
