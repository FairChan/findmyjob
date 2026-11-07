'use client'
import { useState, useTransition, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  setVisibilityAction,
  addBlockedCompanyAction,
  removeBlockedCompanyAction,
  searchVerifiedCompaniesAction,
} from '@/server/actions/privacy'

interface Company {
  id: string
  name: string
}

interface BlockedEntry {
  companyId: string
  companyName: string
  createdAt: Date
}

interface ViewEntry {
  companyId: string
  companyName: string
  viewedAt: string
  viewedAtKey: string
}

interface UnlockEntry {
  companyId: string
  companyName: string
  unlockedAt: string
  unlockedAtKey: string
}

interface Props {
  initialVisible: boolean
  initialBlocked: BlockedEntry[]
  profileViews: ViewEntry[]
  unlocks: UnlockEntry[]
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  id,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  id: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      id={id}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

export default function PrivacyCenter({
  initialVisible,
  initialBlocked,
  profileViews,
  unlocks,
}: Props) {
  const t = useTranslations('privacy')
  const [visible, setVisible] = useState(initialVisible)
  const [blocked, setBlocked] = useState<BlockedEntry[]>(initialBlocked)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Company[]>([])
  const [visibilityError, setVisibilityError] = useState('')
  const [blockError, setBlockError] = useState('')
  const [isVisibilityPending, startVisibility] = useTransition()
  const [isSearchPending, startSearch] = useTransition()
  const [isBlockPending, startBlock] = useTransition()
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleVisibilityChange(granted: boolean) {
    setVisibilityError('')
    startVisibility(async () => {
      const res = await setVisibilityAction({ granted })
      if (res.ok) {
        setVisible(granted)
      } else {
        setVisibilityError(t('errorGeneric'))
      }
    })
  }

  function handleSearchChange(q: string) {
    setSearchQuery(q)
    setBlockError('')
    if (searchRef.current) clearTimeout(searchRef.current)
    if (!q.trim()) {
      setSearchResults([])
      return
    }
    searchRef.current = setTimeout(() => {
      startSearch(async () => {
        const res = await searchVerifiedCompaniesAction({ query: q.trim() })
        if (res.ok) {
          setSearchResults(res.data.companies)
        }
      })
    }, 300)
  }

  function handleAddBlock(company: Company) {
    if (blocked.some((b) => b.companyId === company.id)) return
    setBlockError('')
    startBlock(async () => {
      const res = await addBlockedCompanyAction({ companyId: company.id })
      if (res.ok) {
        setBlocked((prev) => [
          { companyId: company.id, companyName: company.name, createdAt: new Date() },
          ...prev,
        ])
        setSearchQuery('')
        setSearchResults([])
      } else {
        setBlockError(t('errorGeneric'))
      }
    })
  }

  function handleRemoveBlock(companyId: string) {
    setBlockError('')
    startBlock(async () => {
      const res = await removeBlockedCompanyAction({ companyId })
      if (res.ok) {
        setBlocked((prev) => prev.filter((b) => b.companyId !== companyId))
      } else {
        setBlockError(t('errorGeneric'))
      }
    })
  }

  return (
    <div className="space-y-10">
      {/* Visibility section */}
      <section aria-labelledby="visibility-heading">
        <h2 id="visibility-heading" className="mb-1 text-lg font-semibold">
          {t('visibilityTitle')}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">{t('visibilityDesc')}</p>
        <div className="flex min-h-[24px] items-center gap-3">
          <ToggleSwitch
            id="talent-pool-toggle"
            checked={visible}
            onChange={handleVisibilityChange}
            disabled={isVisibilityPending}
          />
          <label htmlFor="talent-pool-toggle" className="cursor-pointer text-sm">
            {visible ? t('visibilityOn') : t('visibilityOff')}
          </label>
        </div>
        {visibilityError && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {visibilityError}
          </p>
        )}
      </section>

      {/* Block companies section */}
      <section aria-labelledby="block-heading">
        <h2 id="block-heading" className="mb-1 text-lg font-semibold">
          {t('blockTitle')}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">{t('blockDesc')}</p>

        <div className="relative mb-4">
          <Input
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t('blockSearchPlaceholder')}
            aria-label={t('blockSearchPlaceholder')}
            disabled={isSearchPending || isBlockPending}
          />
          {searchResults.length > 0 && (
            <ul
              role="listbox"
              aria-label={t('blockSearchResults')}
              className="absolute z-10 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md"
            >
              {searchResults.map((c) => (
                <li key={c.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    className="w-full px-4 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => handleAddBlock(c)}
                    disabled={blocked.some((b) => b.companyId === c.id)}
                  >
                    {c.name}
                    {blocked.some((b) => b.companyId === c.id) && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('blockAlreadyBlocked')}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {blockError && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {blockError}
          </p>
        )}

        {blocked.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('blockEmpty')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {blocked.map((b) => (
              <li key={b.companyId} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">{b.companyName}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveBlock(b.companyId)}
                  disabled={isBlockPending}
                  aria-label={`${t('blockRemove')} ${b.companyName}`}
                >
                  {t('blockRemove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Profile views section */}
      <section aria-labelledby="views-heading">
        <h2 id="views-heading" className="mb-1 text-lg font-semibold">
          {t('viewsTitle')}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">{t('viewsDesc')}</p>
        {profileViews.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('viewsEmpty')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {profileViews.map((v) => (
              <li key={`${v.companyId}-${v.viewedAtKey}`} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">{v.companyName}</span>
                <span className="text-xs text-muted-foreground">
                  {v.viewedAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Unlocks section */}
      <section aria-labelledby="unlocks-heading">
        <h2 id="unlocks-heading" className="mb-1 text-lg font-semibold">
          {t('unlocksTitle')}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">{t('unlocksDesc')}</p>
        {unlocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('unlocksEmpty')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {unlocks.map((u) => (
              <li key={`${u.companyId}-${u.unlockedAtKey}`} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">{u.companyName}</span>
                <span className="text-xs text-muted-foreground">
                  {u.unlockedAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
