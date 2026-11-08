'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { StudentInvitationItem } from '@/server/services/invitations'
import { acceptInvitationAction, declineInvitationAction } from '@/server/actions/invitations'
import { Button } from '@/components/ui/button'

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

const STATUS_CLASSES: Record<string, string> = {
  SENT: 'bg-orange-100 text-orange-700',
  ACCEPTED: 'bg-green-100 text-green-700',
  DECLINED: 'bg-gray-100 text-gray-600',
  EXPIRED: 'bg-gray-100 text-gray-400',
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
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        <p className="font-medium">{t('empty')}</p>
        <p className="mt-1 text-sm">{t('emptyDesc')}</p>
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {invitations.map((inv) => (
        <li
          key={inv.id}
          className={`rounded-lg border p-5${inv.status === 'SENT' ? ' border-primary/30' : ''}`}
        >
          {/* Toast for this item */}
          {toast?.id === inv.id && (
            <div
              role="status"
              className={`mb-3 rounded-md px-3 py-2 text-sm ${toast.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
            >
              {toast.msg}
            </div>
          )}

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {inv.company.displayNameZh ?? inv.company.legalName}
                {inv.job ? `  邀请你投递「${inv.job.title}」` : ''}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t('sentAt', { date: formatDate(inv.createdAt) })}
                {' · '}
                {t('expiresAt', { date: formatDate(inv.expiresAt) })}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[inv.status] ?? STATUS_CLASSES['EXPIRED']}`}
            >
              {statusLabel[inv.status] ?? inv.status}
            </span>
          </div>

          {inv.message && (
            <blockquote className="mt-3 rounded-lg bg-muted/50 p-3 text-sm italic text-muted-foreground">
              &ldquo;{inv.message}&rdquo;
            </blockquote>
          )}

          {inv.status === 'SENT' && (
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={pending === inv.id}
                onClick={() => handleDecline(inv.id)}
              >
                {t('declineButton')}
              </Button>
              <Button
                size="sm"
                disabled={pending === inv.id}
                onClick={() => handleAccept(inv.id)}
              >
                {t('acceptButton')}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
