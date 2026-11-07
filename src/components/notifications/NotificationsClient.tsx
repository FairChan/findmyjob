'use client'
import { useEffect } from 'react'
import { markNotificationsReadAction } from '@/server/actions/notifications'

interface Props {
  ids: string[]
}

export function NotificationsClient({ ids }: Props) {
  useEffect(() => {
    if (ids.length === 0) return
    // Fire-and-forget: mark displayed notifications as read
    void markNotificationsReadAction({ ids })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
