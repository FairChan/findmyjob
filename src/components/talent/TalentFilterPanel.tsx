'use client'

import { Select } from '@/components/ui/select'
import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { SlidersHorizontal } from 'lucide-react'
import { type FilterState, buildSearchString } from '@/lib/talent-search-params'

interface School {
  id: string
  nameZh: string
  nameEn: string
}

interface Props {
  schools: School[]
  locale: string
}

const DEGREE_LEVELS = ['FOUNDATION', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD'] as const
const INTENTS = ['INTERNSHIP', 'FULL_TIME', 'PART_TIME'] as const
const WORK_AUTHS = [
  'MY_CITIZEN',
  'MY_PR',
  'STUDENT_PASS',
  'DEPENDANT_PASS',
  'NEEDS_WORK_PASS',
  'OTHER',
] as const

function readFiltersFromParams(params: URLSearchParams): FilterState {
  return {
    keyword: params.get('keyword') ?? '',
    sort: params.get('sort') ?? 'lastActive',
    schoolId: params.get('schoolId') ?? '',
    degreeLevel: params.get('degreeLevel') ?? '',
    gradFrom: params.get('gradFrom') ?? '',
    gradTo: params.get('gradTo') ?? '',
    intent: params.getAll('intent'),
    workAuth: params.getAll('workAuth'),
  }
}

function FilterForm({
  filters,
  setFilters,
  schools,
  locale,
  onApply,
}: {
  filters: FilterState
  setFilters: (f: FilterState) => void
  schools: School[]
  locale: string
  onApply: () => void
}) {
  const t = useTranslations('talentSearch')

  const toggleArray = (key: 'intent' | 'workAuth', value: string) => {
    const arr = filters[key]
    setFilters({
      ...filters,
      [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
    })
  }

  const degreeLevelKey = (dl: string) => {
    const map: Record<string, string> = {
      FOUNDATION: 'degreeLevelFoundation',
      DIPLOMA: 'degreeLevelDiploma',
      BACHELOR: 'degreeLevelBachelor',
      MASTER: 'degreeLevelMaster',
      PHD: 'degreeLevelPhd',
    }
    return map[dl] as keyof typeof t
  }

  const intentKey = (intent: string) => {
    const map: Record<string, string> = {
      INTERNSHIP: 'intentInternship',
      FULL_TIME: 'intentFullTime',
      PART_TIME: 'intentPartTime',
    }
    return map[intent] as keyof typeof t
  }

  const workAuthKey = (auth: string) => {
    const map: Record<string, string> = {
      MY_CITIZEN: 'workAuthMyCitizen',
      MY_PR: 'workAuthMyPr',
      STUDENT_PASS: 'workAuthStudentPass',
      DEPENDANT_PASS: 'workAuthDependantPass',
      NEEDS_WORK_PASS: 'workAuthNeedsWorkPass',
      OTHER: 'workAuthOther',
    }
    return map[auth] as keyof typeof t
  }

  return (
    <div className="space-y-5">
      {/* Keyword */}
      <div className="space-y-1.5">
        <Label htmlFor="filter-keyword">{t('keywordLabel')}</Label>
        <Input
          id="filter-keyword"
          placeholder={t('keywordPlaceholder')}
          value={filters.keyword}
          onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') onApply() }}
        />
      </div>

      {/* Sort */}
      <div className="space-y-1.5">
        <Label htmlFor="filter-sort">{t('sortLabel')}</Label>
        <Select
          id="filter-sort"
          className="h-9 w-full rounded-control border border-input bg-background px-3 py-1 text-sm shadow-sm"
          value={filters.sort}
          onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
        >
          <option value="lastActive">{t('sortLastActive')}</option>
          <option value="completeness">{t('sortCompleteness')}</option>
          <option value="graduationYear">{t('sortGraduationYear')}</option>
        </Select>
      </div>

      {/* School */}
      <div className="space-y-1.5">
        <Label htmlFor="filter-school">{t('schoolLabel')}</Label>
        <Select
          id="filter-school"
          className="h-9 w-full rounded-control border border-input bg-background px-3 py-1 text-sm shadow-sm"
          value={filters.schoolId}
          onChange={(e) => setFilters({ ...filters, schoolId: e.target.value })}
        >
          <option value="">{t('schoolAll')}</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {locale === 'zh' ? s.nameZh : s.nameEn}
            </option>
          ))}
        </Select>
      </div>

      {/* Degree Level */}
      <div className="space-y-1.5">
        <Label htmlFor="filter-degree">{t('degreeLevelLabel')}</Label>
        <Select
          id="filter-degree"
          className="h-9 w-full rounded-control border border-input bg-background px-3 py-1 text-sm shadow-sm"
          value={filters.degreeLevel}
          onChange={(e) => setFilters({ ...filters, degreeLevel: e.target.value })}
        >
          <option value="">{t('degreeLevelAll')}</option>
          {DEGREE_LEVELS.map((dl) => (
            <option key={dl} value={dl}>
              {t(degreeLevelKey(dl))}
            </option>
          ))}
        </Select>
      </div>

      {/* Graduation Year Range */}
      <div className="space-y-1.5">
        <Label>{t('gradYearLabel')}</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            placeholder={t('gradYearFrom')}
            value={filters.gradFrom}
            min={2000}
            max={2035}
            onChange={(e) => setFilters({ ...filters, gradFrom: e.target.value })}
            className="w-20"
          />
          <span className="text-sm text-muted-foreground">–</span>
          <Input
            type="number"
            placeholder={t('gradYearTo')}
            value={filters.gradTo}
            min={2000}
            max={2035}
            onChange={(e) => setFilters({ ...filters, gradTo: e.target.value })}
            className="w-20"
          />
        </div>
      </div>

      {/* Intents */}
      <div className="space-y-1.5">
        <Label>{t('intentsLabel')}</Label>
        <div className="space-y-1.5">
          {INTENTS.map((intent) => (
            <label key={intent} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={filters.intent.includes(intent)}
                onChange={() => toggleArray('intent', intent)}
              />
              {t(intentKey(intent))}
            </label>
          ))}
        </div>
      </div>

      {/* Work Auth */}
      <div className="space-y-1.5">
        <Label>{t('workAuthLabel')}</Label>
        <div className="space-y-1.5">
          {WORK_AUTHS.map((auth) => (
            <label key={auth} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={filters.workAuth.includes(auth)}
                onChange={() => toggleArray('workAuth', auth)}
              />
              {t(workAuthKey(auth))}
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button type="button" onClick={onApply} className="flex-1">
          {t('applyFilters')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setFilters({
              keyword: '',
              sort: 'lastActive',
              schoolId: '',
              degreeLevel: '',
              gradFrom: '',
              gradTo: '',
              intent: [],
              workAuth: [],
            })
          }
        >
          {t('clearFilters')}
        </Button>
      </div>
    </div>
  )
}

export function TalentFilterPanel({ schools, locale }: Props) {
  const t = useTranslations('talentSearch')
  const router = useRouter()
  const searchParams = useSearchParams()

  // Derived state pattern: when URL params change, reset form state to match
  const urlKey = searchParams.toString()
  const [prevUrlKey, setPrevUrlKey] = useState(urlKey)
  const [filters, setFilters] = useState<FilterState>(() => readFiltersFromParams(searchParams))

  if (urlKey !== prevUrlKey) {
    setPrevUrlKey(urlKey)
    setFilters(readFiltersFromParams(searchParams))
  }

  const handleApply = useCallback(() => {
    router.push(`/${locale}/e/talent${buildSearchString(filters, 1)}`)
  }, [router, locale, filters])

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 lg:block">
        {/* Below the 48px top bar, so the panel never slides under it. */}
        <div className="sticky top-16 rounded-card bg-muted p-5">
          <h2 className="mb-4 font-semibold">{t('filterTitle')}</h2>
          <FilterForm
            filters={filters}
            setFilters={setFilters}
            schools={schools}
            locale={locale}
            onApply={handleApply}
          />
        </div>
      </aside>

      {/* Mobile trigger */}
      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              {t('filterButton')}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{t('filterTitle')}</SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              <FilterForm
                filters={filters}
                setFilters={setFilters}
                schools={schools}
                locale={locale}
                onApply={handleApply}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}

