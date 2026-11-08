'use client'
import { useTransition } from 'react'
import { markAllNotificationsReadAction } from '@/server/actions/notifications'

interface Props {
  label: string
}

export function MarkAllReadButton({ label }: Props) {
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      await markAllNotificationsReadAction({})
      // Reload to reflect read state without full navigation
      window.location.reload()
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="shrink-0 rounded-md px-3 py-1.5 text-sm text-muted-foreground ring-1 ring-border hover:bg-muted disabled:opacity-50"
    >
      {label}
    </button>
  )
}
