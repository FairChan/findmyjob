'use client'
import { useState } from 'react'

export function ShareJobButton({ jobId, label }: { jobId: string; label: string }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    // Build absolute URL using origin + locale-prefixed jobs path
    const pathParts = window.location.pathname.split('/')
    // pathname: /zh/jobs/<id> → origin + /zh/jobs/<id>
    const idx = pathParts.findIndex((p) => p === 'jobs')
    const base = idx !== -1 ? pathParts.slice(0, idx + 1).join('/') : '/jobs'
    const url = `${window.location.origin}${base}/${jobId}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="mt-4 inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors min-h-[24px] min-w-[24px]"
    >
      {copied ? '✓' : label}
    </button>
  )
}
