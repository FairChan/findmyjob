'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { StudentInvitationItem } from '@/server/services/invitations'
import { acceptInvitationAction, declineInvitationAction } from '@/server/actions/invitations'
import { formatKLDate } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

// Cards sit on the muted surface, so the closed states use the plain chip.
const STATUS_TONE: Record<string, BadgeProps['tone']> = {
  SENT: 'warning',
  ACCEPTED: 'success',
  DECLINED: 'plain',
  EXPIRED: 'plain',
}

interface Props {
  invitations: StudentInvitationItem[]
  locale: string
}

export function InvitationList({ invitations, locale }: Props) {
  const t = useTranslations('invitations')
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [toast, setToast] = useState<{ id: string; msg: string; ok: boolean } | null>(null)

  const statusLabel: Record<string, string> = {
    SENT: t('statusSent'),
    ACCEPTED: t('statusAccepted'),
    DECLINED: t('statusDeclined'),
    EXPIRED: t('statusExpired'),
  }

  async function handleAccept(invitationId: string) {
    setPending(invitationId)
    try {
      const result = await acceptInvitationAction({ invitationId })
      if (result.ok) {
        setToast({ id: invitationId, msg: t('acceptSuccess'), ok: true })
        router.refresh()
      } else {
        setToast({
          id: invitationId,
          msg: result.code === 'INVITATION_QUOTA_EXCEEDED' ? t('inviteErrorQuota') : t('acceptError'),
          ok: false,
        })
      }
    } finally {
      setPending(null)
    }
  }

  async function handleDecline(invitationId: string) {
    setPending(invitationId)
    try {
      const result = await declineInvitationAction({ invitationId })
      if (result.ok) {
        setToast({ id: invitationId, msg: t('declineSuccess'), ok: true })
        router.refresh()
      } else {
        setToast({ id: invitationId, msg: t('declineError'), ok: false })
      }
    } finally {
      setPending(null)
    }
  }

  if (invitations.length === 0) {
    return <EmptyState title={t('empty')} description={t('emptyDesc')} />
  }

  return (
    <ul className="space-y-3">
      {invitations.map((inv) => {
        const companyName =
          locale === 'zh'
            ? (inv.company.displayNameZh ?? inv.company.legalName)
            : (inv.company.displayNameEn ?? inv.company.legalName)
        return (
          <li key={inv.id}>
            <Card>
              {toast?.id === inv.id && (
                <div
                  role="status"
                  className={cn(
                    'mb-4 rounded-control px-3 py-2 text-sm',
                    toast.ok ? 'bg-success-muted text-success' : 'bg-destructive-muted text-destructive',
                  )}
                >
                  {toast.msg}
                </div>
              )}

              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold leading-snug">{companyName}</p>
                  {inv.job && <p className="mt-1 text-sm">{t('invitedForJob', { job: inv.job.title })}</p>}
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {t('sentAt', { date: formatKLDate(inv.createdAt, locale) })}
                    {' · '}
                    {t('expiresAt', { date: formatKLDate(inv.expiresAt, locale) })}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[inv.status] ?? 'plain'} className="shrink-0">
                  {statusLabel[inv.status] ?? inv.status}
                </Badge>
              </div>

              {inv.message && (
                <blockquote className="mt-4 rounded-control bg-background p-3 text-sm text-muted-foreground">
                  &ldquo;{inv.message}&rdquo;
                </blockquote>
              )}

              {inv.status === 'SENT' && (
                <div className="mt-5 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending === inv.id}
                    onClick={() => handleDecline(inv.id)}
                  >
                    {t('declineButton')}
                  </Button>
                  <Button size="sm" disabled={pending === inv.id} onClick={() => handleAccept(inv.id)}>
                    {t('acceptButton')}
                  </Button>
                </div>
              )}
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
