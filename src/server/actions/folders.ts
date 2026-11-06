'use server'
import { z } from 'zod'
import { action } from '@/server/action'
import {
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  addToFolder,
  removeFromFolder,
  updateNote,
  getStudentFolderIds,
} from '@/server/services/talent-folders'

export const listFoldersAction = action(
  { auth: 'company' },
  async ({ userId, companyId }) => {
    return listFolders({ userId: userId!, companyId: companyId! })
  },
)

export const createFolderAction = action(
  { auth: 'company', input: z.object({ name: z.string().min(1).max(100) }) },
  async ({ userId, companyId, input }) => {
    return createFolder({ userId: userId!, companyId: companyId! }, input)
  },
)

export const renameFolderAction = action(
  {
    auth: 'company',
    input: z.object({ id: z.string().cuid(), name: z.string().min(1).max(100) }),
  },
  async ({ userId, companyId, input }) => {
    await renameFolder({ userId: userId!, companyId: companyId! }, input)
    return {}
  },
)

export const deleteFolderAction = action(
  { auth: 'company', input: z.object({ id: z.string().cuid() }) },
  async ({ userId, companyId, input }) => {
    await deleteFolder({ userId: userId!, companyId: companyId! }, input)
    return {}
  },
)

export const addToFolderAction = action(
  {
    auth: 'company',
    input: z.object({
      folderId: z.string().cuid(),
      studentId: z.string().cuid(),
      note: z.string().max(500).optional(),
    }),
  },
  async ({ userId, companyId, input }) => {
    await addToFolder({ userId: userId!, companyId: companyId! }, input)
    return {}
  },
)

export const removeFromFolderAction = action(
  {
    auth: 'company',
    input: z.object({ folderId: z.string().cuid(), studentId: z.string().cuid() }),
  },
  async ({ userId, companyId, input }) => {
    await removeFromFolder({ userId: userId!, companyId: companyId! }, input)
    return {}
  },
)

export const updateNoteAction = action(
  {
    auth: 'company',
    input: z.object({
      folderId: z.string().cuid(),
      studentId: z.string().cuid(),
      note: z.string().max(500).nullable(),
    }),
  },
  async ({ userId, companyId, input }) => {
    await updateNote({ userId: userId!, companyId: companyId! }, input)
    return {}
  },
)

export const getStudentFolderIdsAction = action(
  {
    auth: 'company',
    input: z.object({ studentId: z.string().cuid() }),
  },
  async ({ userId, companyId, input }) => {
    const folderIds = await getStudentFolderIds(
      { userId: userId!, companyId: companyId! },
      input.studentId,
    )
    return { folderIds }
  },
)
