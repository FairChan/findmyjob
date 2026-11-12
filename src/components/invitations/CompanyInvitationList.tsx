'use client'
import { useTranslations } from 'next-intl'
import type { CompanyInvitationItem } from '@/server/services/invitations'

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

const STATUS_CLASSES: Record<string, string> = {
  SENT: 'bg-warning-muted text-warning',
  ACCEPTED: 'bg-success-muted text-success',
  DECLINED: 'bg-muted text-muted-foreground',
  EXPIRED: 'bg-muted text-muted-foreground',
}

interface Props {
  invitations: CompanyInvitationItem[]
  locale: string
}

export function CompanyInvitationList({ invitations, locale }: Props) {
  const t = useTranslations('invitations')

  const statusLabel: Record<string, string> = {
    SENT: t('statusSent'),
    ACCEPTED: t('statusAccepted'),
    DECLINED: t('statusDeclined'),
    EXPIRED: t('statusExpired'),
  }

  if (invitations.length === 0) {
    return (
      <div className="rounded-card border p-8 text-center text-muted-foreground">
        <p className="font-medium">{t('companyEmpty')}</p>
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {invitations.map((inv) => (
        <li key={inv.id} className="rounded-card border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{inv.student.name}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {inv.job?.title ?? '—'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
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
            <blockquote className="mt-2 rounded-control bg-muted/40 p-2 text-sm italic text-muted-foreground">
              &ldquo;{inv.message}&rdquo;
            </blockquote>
          )}
        </li>
      ))}
    </ul>
  )
}
