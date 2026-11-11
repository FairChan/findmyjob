import 'server-only'
import { Suspense } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import type { DegreeLevel, JobType, WorkAuth } from '@prisma/client'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError, FeatureDisabledError, RateLimitedError, ValidationError } from '@/server/errors'
import { db } from '@/server/db'
import { searchTalents } from '@/server/services/talent-search'
import type { TalentSearchResult } from '@/server/services/talent-search'
import type { TalentCard } from '@/server/serializers/talent-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { WorkspaceNotice } from '@/components/layout/workspace-notice'
import { TalentFilterPanel } from '@/components/talent/TalentFilterPanel'
import { buildSearchString } from '@/lib/talent-search-params'
import type { FilterState } from '@/lib/talent-search-params'
import { SaveToFolderButton } from '@/components/talent/SaveToFolderButton'

// ---- URL param helpers ----

function sp_str(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key]
  return typeof v === 'string' && v ? v : undefined
}

function sp_int(sp: Record<string, string | string[] | undefined>, key: string): number | undefined {
  const v = sp_str(sp, key)
  if (!v) return undefined
  const n = parseInt(v, 10)
  return isNaN(n) ? undefined : n
}

function sp_arr(sp: Record<string, string | string[] | undefined>, key: string): string[] {
  const v = sp[key]
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

// ---- Time ago utility ----

function timeAgo(date: Date | null): string {
  if (!date) return ''
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

// ---- i18n label maps (used in Server Component) ----

const DEGREE_LABELS: Record<DegreeLevel, string> = {
  FOUNDATION: 'degreeLevelFoundation',
  DIPLOMA: 'degreeLevelDiploma',
  BACHELOR: 'degreeLevelBachelor',
  MASTER: 'degreeLevelMaster',
  PHD: 'degreeLevelPhd',
}

const WORK_AUTH_LABELS: Record<WorkAuth, string> = {
  MY_CITIZEN: 'workAuthMyCitizen',
  MY_PR: 'workAuthMyPr',
  STUDENT_PASS: 'workAuthStudentPass',
  DEPENDANT_PASS: 'workAuthDependantPass',
  NEEDS_WORK_PASS: 'workAuthNeedsWorkPass',
  OTHER: 'workAuthOther',
}

// ---- Talent card row ----

function TalentCardItem({
  card,
  locale,
  tLabel,
  tFolders,
}: {
  card: TalentCard
  locale: string
  tLabel: (key: string) => string
  tFolders: (key: string) => string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card bg-muted p-5 transition-[background-color,box-shadow] hover:bg-card hover:shadow-float motion-reduce:transition-none sm:flex-row">
      <div className="min-w-0 flex-1">
        {/* Header row */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/${locale}/e/talent/${card.id}`}
            prefetch={false}
            className="font-semibold underline-offset-4 hover:underline"
          >
            {card.name}
          </Link>
          {card.unlocked && <Badge tone="success">{tLabel('unlocked')}</Badge>}
          {card.graduationYear !== null && (
            <span className="text-sm text-muted-foreground">{card.graduationYear}</span>
          )}
          {card.degreeLevel !== null && (
            <span className="text-sm text-muted-foreground">
              · {tLabel(DEGREE_LABELS[card.degreeLevel])}
            </span>
          )}
          {card.workAuth !== null && <Badge tone="plain">{tLabel(WORK_AUTH_LABELS[card.workAuth])}</Badge>}
        </div>

        {/* School + major */}
        {(card.school !== null || card.major !== null) && (
          <p className="mt-1 text-sm text-muted-foreground">
            {card.school !== null
              ? locale === 'zh'
                ? card.school.nameZh
                : card.school.nameEn
              : null}
            {card.major !== null && ` · ${card.major}`}
          </p>
        )}

        {/* Headline */}
        {card.headline !== null && (
          <p className="mt-1.5 line-clamp-1 text-sm">{card.headline}</p>
        )}

        {/* Skills */}
        {card.skills.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {card.skills.slice(0, 5).map((skill) => (
              <Badge key={skill} tone="plain">
                {skill}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Right: last active + action buttons */}
      <div className="flex shrink-0 flex-row items-center justify-between gap-2 sm:flex-col sm:items-end">
        {card.lastActiveAt !== null && (
          <span className="text-xs text-muted-foreground">
            {tLabel('lastActiveLabel').replace('{time}', timeAgo(card.lastActiveAt))}
          </span>
        )}
        <div className="flex gap-2">
          <SaveToFolderButton
            studentId={card.id}
            labels={{
              save: tFolders('saveButton'),
              saveToFolder: tFolders('saveToFolder'),
              noFolders: tFolders('noFoldersHint'),
              createNew: tFolders('createFolder'),
              folderNamePlaceholder: tFolders('folderNamePlaceholder'),
              create: tFolders('create'),
              added: tFolders('added'),
              remove: tFolders('remove'),
              close: tFolders('cancel'),
              loading: tFolders('loading'),
              errorOccurred: tFolders('errorOccurred'),
            }}
          />
          <Button asChild size="sm" variant="outline">
            <Link href={`/${locale}/e/talent/${card.id}`} prefetch={false}>
              {tLabel('viewDetail')}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---- Results list ----

function ResultsList({
  result,
  locale,
  currentPage,
  tLabel,
  tFolders,
  paginationUrl,
}: {
  result: TalentSearchResult
  locale: string
  currentPage: number
  tLabel: (key: string) => string
  tFolders: (key: string) => string
  paginationUrl: (page: number) => string
}) {
  const { students, total, maxPage } = result

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {tLabel('totalResults').replace('{total}', String(total))}
        </p>
        {maxPage > 1 && (
          <p className="text-sm text-muted-foreground">
            {tLabel('pageInfo')
              .replace('{page}', String(currentPage))
              .replace('{maxPage}', String(maxPage))}
          </p>
        )}
      </div>

      {students.length === 0 ? (
        <EmptyState title={tLabel('noResults')} />
      ) : (
        <div className="space-y-3">
          {students.map((card) => (
            <TalentCardItem key={card.id} card={card} locale={locale} tLabel={tLabel} tFolders={tFolders} />
          ))}
        </div>
      )}

      {maxPage > 1 && (
        <nav aria-label="pagination" className="mt-6 flex items-center justify-center gap-4">
          {currentPage > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/${locale}/e/talent${paginationUrl(currentPage - 1)}`}>
                {tLabel('prevPage')}
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled aria-disabled="true">
              {tLabel('prevPage')}
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            {tLabel('pageInfo')
              .replace('{page}', String(currentPage))
              .replace('{maxPage}', String(maxPage))}
          </span>
          {currentPage < maxPage ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/${locale}/e/talent${paginationUrl(currentPage + 1)}`}>
                {tLabel('nextPage')}
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled aria-disabled="true">
              {tLabel('nextPage')}
            </Button>
          )}
        </nav>
      )}
    </div>
  )
}

// ---- Main page ----

export default async function TalentSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const sp = await searchParams
  const t = await getTranslations('talentSearch')
  const tLabel = (key: string) => t(key as Parameters<typeof t>[0])
  const tFoldersMsg = await getTranslations('talentFolders')
  const tFolders = (key: string) => tFoldersMsg(key as Parameters<typeof tFoldersMsg>[0])

  // Auth: require company membership (layout already checked requireEmployer)
  let ctx: { userId: string; companyId: string }
  try {
    ctx = await requireCompanyMember('RECRUITER', await headers())
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(`/${locale}/e/onboarding`)
    }
    throw err
  }

  // Check company verification
  const company = await db.company.findUnique({
    where: { id: ctx.companyId },
    select: { verificationStatus: true },
  })

  if (company?.verificationStatus !== 'VERIFIED') {
    return (
      <WorkspaceNotice
        title={t('verifyRequired')}
        description={t('verifyDesc')}
        action={{ label: t('verifyAction'), href: `/${locale}/e/onboarding` }}
      />
    )
  }

  // Parse filters from URL
  const page = sp_int(sp, 'page') ?? 1
  const rawFilters = {
    keyword: sp_str(sp, 'keyword'),
    sort: (sp_str(sp, 'sort') ?? 'lastActive') as 'lastActive' | 'completeness' | 'graduationYear',
    schoolId: sp_str(sp, 'schoolId'),
    degreeLevel: sp_str(sp, 'degreeLevel') as DegreeLevel | undefined,
    graduationYearFrom: sp_int(sp, 'gradFrom'),
    graduationYearTo: sp_int(sp, 'gradTo'),
    intents: sp_arr(sp, 'intent') as JobType[],
    workAuths: sp_arr(sp, 'workAuth') as WorkAuth[],
    page,
  }

  // Filter panel state shape (for pagination URL generation)
  const filterState: FilterState = {
    keyword: sp_str(sp, 'keyword') ?? '',
    sort: sp_str(sp, 'sort') ?? 'lastActive',
    schoolId: sp_str(sp, 'schoolId') ?? '',
    degreeLevel: sp_str(sp, 'degreeLevel') ?? '',
    gradFrom: sp_str(sp, 'gradFrom') ?? '',
    gradTo: sp_str(sp, 'gradTo') ?? '',
    intent: sp_arr(sp, 'intent'),
    workAuth: sp_arr(sp, 'workAuth'),
  }

  const paginationUrl = (p: number) => buildSearchString(filterState, p)

  // Fetch schools for filter dropdown
  const schools = await db.school.findMany({
    where: { active: true },
    select: { id: true, nameZh: true, nameEn: true },
    orderBy: { nameZh: 'asc' },
  })

  // Fetch search results
  type SearchOutcome =
    | { kind: 'ok'; result: TalentSearchResult }
    | { kind: 'featureDisabled' }
    | { kind: 'rateLimited' }
    | { kind: 'validationError'; message: string }

  const outcome: SearchOutcome = await searchTalents(
    { userId: ctx.userId, companyId: ctx.companyId },
    rawFilters,
  ).then(
    (result) => ({ kind: 'ok' as const, result }),
    (err: unknown) => {
      if (err instanceof FeatureDisabledError) return { kind: 'featureDisabled' as const }
      if (err instanceof RateLimitedError) return { kind: 'rateLimited' as const }
      if (err instanceof ValidationError)
        return { kind: 'validationError' as const, message: err.message }
      throw err
    },
  )

  return (
    <WorkspacePage title={t('title')} width="full">
      <div className="flex gap-6">
        {/* Filter panel: Suspense required because TalentFilterPanel uses useSearchParams */}
        <Suspense fallback={null}>
          <TalentFilterPanel schools={schools} locale={locale} />
        </Suspense>

        {/* Results area */}
        <div className="min-w-0 flex-1">
          {outcome.kind === 'featureDisabled' ? (
            <EmptyState title={t('featureDisabled')} />
          ) : outcome.kind === 'rateLimited' ? (
            <EmptyState title={t('rateLimited')} />
          ) : outcome.kind === 'validationError' ? (
            <EmptyState title={t('invalidParams')} />
          ) : (
            <ResultsList
              result={outcome.result}
              locale={locale}
              currentPage={page}
              tLabel={tLabel}
              tFolders={tFolders}
              paginationUrl={paginationUrl}
            />
          )}
        </div>
      </div>
    </WorkspacePage>
  )
}
