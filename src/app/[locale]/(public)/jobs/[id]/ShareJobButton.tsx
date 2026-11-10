'use client'
import { useState } from 'react'

export function ShareJobButton({ jobId, label, copiedLabel }: { jobId: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)

  async function handleCopy() {
    const pathParts = window.location.pathname.split('/')
    const idx = pathParts.findIndex((p) => p === 'jobs')
    const base = idx !== -1 ? pathParts.slice(0, idx + 1).join('/') : '/jobs'
    const url = `${window.location.origin}${base}/${jobId}`

    if (!navigator.clipboard) {
      setError(true)
      setTimeout(() => setError(false), 2000)
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(true)
      setTimeout(() => setError(false), 2000)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="mt-4 inline-flex h-10 min-w-6 items-center rounded-full border border-input bg-background px-5 text-sm font-medium transition-colors hover:bg-accent"
    >
      {error ? '✗' : copied ? `✓ ${copiedLabel}` : label}
    </button>
  )
}
