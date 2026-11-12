'use client'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
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
    <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={pending} className="shrink-0">
      {label}
    </Button>
  )
}
