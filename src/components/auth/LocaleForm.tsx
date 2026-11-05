'use client'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { updateLocaleAction } from '@/server/actions/account'

interface Props {
  currentLocale: 'zh' | 'en'
}

export default function LocaleForm({ currentLocale }: Props) {
  const t = useTranslations('settings')
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<'zh' | 'en'>(currentLocale)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSuccess(false)

    startTransition(async () => {
      const result = await updateLocaleAction({ locale: selected })
      if (result.ok) {
        setSuccess(true)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="locale"
            value="zh"
            checked={selected === 'zh'}
            onChange={() => setSelected('zh')}
            className="accent-brand"
          />
          <span className="text-sm">{t('localeChinese')}</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="locale"
            value="en"
            checked={selected === 'en'}
            onChange={() => setSelected('en')}
            className="accent-brand"
          />
          <span className="text-sm">{t('localeEnglish')}</span>
        </label>
      </div>

      {success && (
        <p role="status" className="text-sm text-green-600">
          {t('localeUpdateSuccess')}
        </p>
      )}

      <Button type="submit" disabled={isPending || selected === currentLocale}>
        {isPending ? '...' : t('localeSubmit')}
      </Button>
    </form>
  )
}
