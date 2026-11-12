'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function CopyLinkButton({ link }: { link: string }) {
  const t = useTranslations('invite')
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      {/* Grows only in the row layout: as a column item, flex-1 would drop the fixed height. */}
      <Input readOnly value={link} className="h-11 min-w-0 sm:flex-1" aria-label={t('inviteLinkLabel')} />
      <Button type="button" variant="brand" onClick={handleCopy} aria-live="polite" className="h-11 shrink-0">
        {copied ? t('copied') : t('copyLink')}
      </Button>
    </div>
  )
}
