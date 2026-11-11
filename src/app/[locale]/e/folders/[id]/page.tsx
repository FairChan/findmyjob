import 'server-only'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import type { DegreeLevel } from '@prisma/client'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError, NotFoundError } from '@/server/errors'
import { db } from '@/server/db'
import { getFolderItems } from '@/server/services/talent-folders'
import type { FolderItem } from '@/server/services/talent-folders'
import { BACK_LINK_CLASS, WorkspacePage } from '@/components/layout/workspace-page'
import { WorkspaceNotice } from '@/components/layout/workspace-notice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
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
    <div className="rounded-card bg-muted p-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
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
                <Badge key={skill} tone="plain">
                  {skill}
                </Badge>
              ))}
            </div>
          )}

          {item.note && (
            <p className="mt-3 rounded-control bg-background px-3 py-2 text-sm text-muted-foreground">
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

  let result: Awaited<ReturnType<typeof getFolderItems>>
  try {
    result = await getFolderItems({ userId: ctx.userId, companyId: ctx.companyId }, id)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    throw err
  }

  const { folder, items } = result

  return (
    <WorkspacePage
      width="list"
      title={folder.name}
      lead={`${items.length} ${tLabel('visibleItems')}`}
      eyebrow={
        <nav aria-label="breadcrumb">
          <Link href={`/${locale}/e/folders`} prefetch={false} className={BACK_LINK_CLASS}>
            <ChevronLeft aria-hidden="true" className="size-4" />
            {tLabel('backToFolders')}
          </Link>
        </nav>
      }
    >
      {items.length === 0 ? (
        <EmptyState title={tLabel('emptyFolder')} />
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
    </WorkspacePage>
  )
}
