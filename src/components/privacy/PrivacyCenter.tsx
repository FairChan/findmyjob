'use client'
import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  setVisibilityAction,
  addBlockedCompanyAction,
  removeBlockedCompanyAction,
  searchVerifiedCompaniesAction,
} from '@/server/actions/privacy'
import {
  requestExportAction,
  requestDeletionAction,
} from '@/server/actions/data-rights'

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
  locale: string
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
  locale,
}: Props) {
  const t = useTranslations('privacy')
  const router = useRouter()
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

  const [exportPending, setExportPending] = useState(false)
  const [exportDone, setExportDone] = useState(false)
  const [exportRequestId, setExportRequestId] = useState<string | null>(null)
  const [exportError, setExportError] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  async function handleExport() {
    setExportError('')
    setExportPending(true)
    try {
      const res = await requestExportAction({})
      if (res.ok) {
        setExportDone(true)
        setExportRequestId((res.data as { requestId: string }).requestId)
      } else {
        setExportError(t('errorGeneric'))
      }
    } finally {
      setExportPending(false)
    }
  }

  async function handleDelete() {
    setDeleteError('')
    setDeletePending(true)
    try {
      const res = await requestDeletionAction({})
      if (res.ok) {
        router.push(`/${locale}/login`)
      } else {
        setDeleteError(t('errorGeneric'))
      }
    } finally {
      setDeletePending(false)
    }
  }

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

      {/* Data rights section */}
      <section aria-labelledby="data-rights-heading">
        <h2 id="data-rights-heading" className="mb-1 text-lg font-semibold">
          {t('dataRightsTitle')}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">{t('dataRightsDesc')}</p>

        <div className="space-y-4">
          {/* Export */}
          <div className="rounded-md border p-4">
            <h3 className="text-sm font-medium mb-1">{t('exportTitle')}</h3>
            <p className="text-xs text-muted-foreground mb-3">{t('exportDesc')}</p>
            {exportDone ? (
              <div className="space-y-2">
                <p className="text-sm text-green-700">{t('exportRequested')}</p>
                {exportRequestId && (
                  <a
                    href={`/${locale}/s/privacy/exports/${exportRequestId}`}
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {t('exportViewLink')}
                  </a>
                )}
              </div>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  disabled={exportPending}
                  className="min-h-[44px]"
                >
                  {exportPending ? t('exportPending') : t('exportButton')}
                </Button>
                {exportError && (
                  <p role="alert" className="mt-2 text-sm text-destructive">{exportError}</p>
                )}
              </>
            )}
          </div>

          {/* Delete */}
          <div className="rounded-md border border-destructive/30 p-4">
            <h3 className="text-sm font-medium mb-1 text-destructive">{t('deleteTitle')}</h3>
            <p className="text-xs text-muted-foreground mb-3">{t('deleteDesc')}</p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              className="min-h-[44px]"
            >
              {t('deleteButton')}
            </Button>
          </div>
        </div>
      </section>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('deleteConfirmDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{t('deleteConfirmType')}</p>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={t('deleteConfirmPlaceholder')}
              aria-label={t('deleteConfirmPlaceholder')}
            />
            {deleteError && (
              <p role="alert" className="text-sm text-destructive">{deleteError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deletePending}>
              {t('deleteCancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={deletePending || deleteConfirmText !== t('deleteConfirmPlaceholder')}
              onClick={handleDelete}
            >
              {deletePending ? t('deletePending') : t('deleteConfirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
