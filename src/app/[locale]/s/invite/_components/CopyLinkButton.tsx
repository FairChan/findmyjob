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
    <div className="flex gap-2 items-center">
      <Input readOnly value={link} className="flex-1 text-sm" aria-label={t('inviteLinkLabel')} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCopy}
        aria-live="polite"
        className="shrink-0"
      >
        {copied ? t('copied') : t('copyLink')}
      </Button>
    </div>
  )
}
