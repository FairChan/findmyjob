import 'server-only'
import { db } from '../db'
import { isStudentVisibleToCompany } from './talent-visibility'
import { NotFoundError, ValidationError } from '../errors'
import { assertCompanyVerified } from '../authz'
import { toTalentCard } from '../serializers/talent-card'
import type { TalentCard } from '../serializers/talent-card'

export interface FolderSummary {
  id: string
  name: string
  itemCount: number
  createdAt: Date
}

export interface FolderItem {
  studentId: string
  note: string | null
  addedAt: Date
  card: TalentCard
}

export async function listFolders(
  ctx: { userId: string; companyId: string },
): Promise<FolderSummary[]> {
  await assertCompanyVerified(ctx.companyId)
  const folders = await db.talentFolder.findMany({
    where: { companyId: ctx.companyId },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return folders.map((f) => ({
    id: f.id,
    name: f.name,
    itemCount: f._count.items,
    createdAt: f.createdAt,
  }))
}

export async function createFolder(
  ctx: { userId: string; companyId: string },
  input: { name: string },
): Promise<FolderSummary> {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Folder name cannot be empty')
  const folder = await db.talentFolder.create({
    data: { companyId: ctx.companyId, name, createdById: ctx.userId },
    include: { _count: { select: { items: true } } },
  })
  return { id: folder.id, name: folder.name, itemCount: 0, createdAt: folder.createdAt }
}

export async function renameFolder(
  ctx: { userId: string; companyId: string },
  input: { id: string; name: string },
): Promise<void> {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Folder name cannot be empty')
  const folder = await db.talentFolder.findUnique({
    where: { id: input.id },
    select: { companyId: true },
  })
  if (!folder || folder.companyId !== ctx.companyId) throw new NotFoundError('Folder not found')
  await db.talentFolder.update({ where: { id: input.id }, data: { name } })
}

export async function deleteFolder(
  ctx: { userId: string; companyId: string },
  input: { id: string },
): Promise<void> {
  const folder = await db.talentFolder.findUnique({
    where: { id: input.id },
    select: { companyId: true },
  })
  if (!folder || folder.companyId !== ctx.companyId) throw new NotFoundError('Folder not found')
  await db.talentFolder.delete({ where: { id: input.id } })
}

export async function addToFolder(
  ctx: { userId: string; companyId: string },
  input: { folderId: string; studentId: string; note?: string },
): Promise<void> {
  const folder = await db.talentFolder.findUnique({
    where: { id: input.folderId },
    select: { companyId: true },
  })
  if (!folder || folder.companyId !== ctx.companyId) throw new NotFoundError('Folder not found')
  const visible = await isStudentVisibleToCompany(input.studentId, ctx.companyId)
  if (!visible) throw new NotFoundError('Student profile not found')
  await db.talentFolderItem.upsert({
    where: { folderId_studentId: { folderId: input.folderId, studentId: input.studentId } },
    create: {
      folderId: input.folderId,
      studentId: input.studentId,
      note: input.note?.trim() || null,
      addedById: ctx.userId,
    },
    update: { note: input.note?.trim() || null },
  })
}

export async function removeFromFolder(
  ctx: { userId: string; companyId: string },
  input: { folderId: string; studentId: string },
): Promise<void> {
  const folder = await db.talentFolder.findUnique({
    where: { id: input.folderId },
    select: { companyId: true },
  })
  if (!folder || folder.companyId !== ctx.companyId) throw new NotFoundError('Folder not found')
  await db.talentFolderItem.deleteMany({
    where: { folderId: input.folderId, studentId: input.studentId },
  })
}

export async function updateNote(
  ctx: { userId: string; companyId: string },
  input: { folderId: string; studentId: string; note: string | null },
): Promise<void> {
  const folder = await db.talentFolder.findUnique({
    where: { id: input.folderId },
    select: { companyId: true },
  })
  if (!folder || folder.companyId !== ctx.companyId) throw new NotFoundError('Folder not found')
  await db.talentFolderItem.updateMany({
    where: { folderId: input.folderId, studentId: input.studentId },
    data: { note: input.note?.trim() || null },
  })
}

export async function getFolderItems(
  ctx: { userId: string; companyId: string },
  folderId: string,
): Promise<{ folder: FolderSummary; items: FolderItem[] }> {
  // §5.1: talent operations require verified company
  await assertCompanyVerified(ctx.companyId)

  const folder = await db.talentFolder.findUnique({
    where: { id: folderId },
    include: {
      _count: { select: { items: true } },
      items: {
        include: {
          student: {
            include: {
              school: { select: { id: true, nameZh: true, nameEn: true } },
              unlocks: {
                where: { companyId: ctx.companyId },
                take: 1,
                select: { companyId: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!folder || folder.companyId !== ctx.companyId) throw new NotFoundError('Folder not found')

  const items: FolderItem[] = []
  for (const item of folder.items) {
    const visible = await isStudentVisibleToCompany(item.studentId, ctx.companyId)
    if (!visible) continue
    const unlocked = item.student.unlocks.length > 0
    const card = toTalentCard(item.student, { unlocked })
    items.push({ studentId: item.studentId, note: item.note, addedAt: item.createdAt, card })
  }

  return {
    folder: {
      id: folder.id,
      name: folder.name,
      itemCount: folder._count.items,
      createdAt: folder.createdAt,
    },
    items,
  }
}

export async function getStudentFolderIds(
  ctx: { userId: string; companyId: string },
  studentId: string,
): Promise<string[]> {
  const items = await db.talentFolderItem.findMany({
    where: { studentId, folder: { companyId: ctx.companyId } },
    select: { folderId: true },
  })
  return items.map((i) => i.folderId)
}
