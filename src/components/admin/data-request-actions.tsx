'use client'
import { useState } from 'react'
import { resolveDataRequestAction } from '@/server/actions/data-rights'

interface Props {
  requestId: string
  locale: string
}

export function DataRequestActions({ requestId, locale }: Props) {
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  async function handle(resolution: 'DONE' | 'REJECTED') {
    setPending(true)
    try {
      await resolveDataRequestAction({ requestId, resolution, note: note || undefined })
      setDone(true)
      window.location.reload()
    } finally {
      setPending(false)
    }
  }

  if (done) return <span className="text-sm text-green-600">✓</span>

  return (
    <div className="flex flex-col gap-1 items-end min-w-48">
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="text-xs border rounded px-2 py-1 w-full max-w-xs"
        aria-label="Resolution note"
      />
      <div className="flex gap-2">
        <button
          onClick={() => handle('DONE')}
          disabled={pending}
          className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
        >
          Done
        </button>
        <button
          onClick={() => handle('REJECTED')}
          disabled={pending}
          className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
