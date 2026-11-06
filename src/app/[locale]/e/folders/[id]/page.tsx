import 'server-only'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import type { DegreeLevel } from '@prisma/client'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError, NotFoundError } from '@/server/errors'
import { getFolderItems } from '@/server/services/talent-folders'
import type { FolderItem } from '@/server/services/talent-folders'
import type { TalentCard } from '@/server/serializers/talent-card'
import { Button } from '@/components/ui/button'
import { FolderItemActions } from './FolderItemActions'

const DEGREE_LABELS: Record<DegreeLevel, string> = {
  FOUNDATION: 'degreeLevelFoundation',
  DIPLOMA: 'degreeLevelDiploma',
  BACHELOR: 'degreeLevelBachelor',
  MASTER: 'degreeLevelMaster',
  PHD: 'degreeLevelPhd',
}

function FolderCard({
  item,
  locale,
  folderId,
  tLabel,
}: {
  item: FolderItem
  locale: string
  folderId: string
  tLabel: (key: string) => string
}) {
  const { card } = item
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/${locale}/e/talent/${card.id}`}
              prefetch={false}
              className="font-semibold hover:text-primary"
            >
              {card.name}
            </Link>
            {card.unlocked && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                {tLabel('unlocked')}
              </span>
            )}
            {card.graduationYear !== null && (
              <span className="text-sm text-muted-foreground">{card.graduationYear}</span>
            )}
            {card.degreeLevel !== null && (
              <span className="text-sm text-muted-foreground">
                · {tLabel(DEGREE_LABELS[card.degreeLevel as DegreeLevel])}
              </span>
            )}
          </div>

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

          {card.skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.skills.slice(0, 5).map((skill) => (
                <span
                  key={skill}
                  className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                >
                  {skill}
                </span>
              ))}
            </div>
          )}

          {item.note && (
            <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {item.note}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/${locale}/e/talent/${card.id}`} prefetch={false}>
              {tLabel('viewDetail')}
            </Link>
          </Button>
          <FolderItemActions
            folderId={folderId}
            studentId={item.studentId}
            initialNote={item.note}
            onRemoved={() => {}}
            labels={{
              editNote: tLabel('editNote'),
              remove: tLabel('removeFromFolder'),
              cancel: tLabel('cancel'),
              save: tLabel('save'),
              deleteConfirm: tLabel('removeConfirm'),
              confirm: tLabel('confirm'),
              notePlaceholder: tLabel('notePlaceholder'),
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default async function FolderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const t = await getTranslations('talentFolders')
  const tLabel = (key: string) => t(key as Parameters<typeof t>[0])

  let ctx: { userId: string; companyId: string }
  try {
    ctx = await requireCompanyMember('RECRUITER', await headers())
  } catch (err) {
    if (err instanceof ForbiddenError) redirect(`/${locale}/e/onboarding`)
    throw err
  }

  let result: Awaited<ReturnType<typeof getFolderItems>>
  try {
    result = await getFolderItems({ userId: ctx.userId, companyId: ctx.companyId }, id)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    throw err
  }

  const { folder, items } = result

  return (
    <main id="main-content" className="container mx-auto max-w-3xl px-4 py-6">
      <nav aria-label="breadcrumb" className="mb-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/${locale}/e/folders`} prefetch={false}>
            ← {tLabel('backToFolders')}
          </Link>
        </Button>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">{folder.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {items.length} {tLabel('visibleItems')}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          {tLabel('emptyFolder')}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <FolderCard
              key={item.studentId}
              item={item}
              locale={locale}
              folderId={id}
              tLabel={tLabel}
            />
          ))}
        </div>
      )}
    </main>
  )
}
