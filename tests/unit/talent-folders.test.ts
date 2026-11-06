import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before imports
vi.mock('@/server/db', () => ({ db: { talentFolder: {}, talentFolderItem: {} } }))
vi.mock('@/server/authz', () => ({
  assertCompanyVerified: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/server/services/talent-visibility', () => ({
  isStudentVisibleToCompany: vi.fn(),
}))
vi.mock('@/server/serializers/talent-card', () => ({
  toTalentCard: vi.fn((profile: { id: string; fullName: string }, opts: { unlocked: boolean }) => ({
    id: profile.id,
    name: opts.unlocked ? profile.fullName : '***',
    unlocked: opts.unlocked,
    school: null,
    major: null,
    degreeLevel: null,
    graduationYear: null,
    cgpa: null,
    skills: [],
    headline: null,
    completeness: 0,
    workAuth: null,
    lastActiveAt: null,
  })),
}))

import { db } from '@/server/db'
import { isStudentVisibleToCompany } from '@/server/services/talent-visibility'
import {
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  addToFolder,
  removeFromFolder,
  updateNote,
  getFolderItems,
  getStudentFolderIds,
} from '@/server/services/talent-folders'
import { NotFoundError, ValidationError } from '@/server/errors'

const mockDb = db as typeof db & {
  talentFolder: Record<string, ReturnType<typeof vi.fn>>
  talentFolderItem: Record<string, ReturnType<typeof vi.fn>>
}

const ctx = { userId: 'user-1', companyId: 'company-1' }

const makeFolder = (id: string, name: string, companyId = ctx.companyId) => ({
  id,
  companyId,
  name,
  createdById: ctx.userId,
  createdAt: new Date('2026-11-07'),
  _count: { items: 0 },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listFolders', () => {
  it('returns folders for the company', async () => {
    const folders = [makeFolder('f1', 'Shortlist'), makeFolder('f2', 'Interview')]
    mockDb.talentFolder.findMany = vi.fn().mockResolvedValue(folders)

    const result = await listFolders(ctx)
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('f1')
    expect(mockDb.talentFolder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: ctx.companyId } }),
    )
  })
})

describe('createFolder', () => {
  it('creates a folder with trimmed name', async () => {
    const folder = makeFolder('f1', 'Shortlist')
    mockDb.talentFolder.create = vi.fn().mockResolvedValue(folder)

    const result = await createFolder(ctx, { name: '  Shortlist  ' })
    expect(result.name).toBe('Shortlist')
    expect(mockDb.talentFolder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Shortlist' }) }),
    )
  })

  it('throws ValidationError for empty name', async () => {
    await expect(createFolder(ctx, { name: '   ' })).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('renameFolder', () => {
  it('renames a folder owned by the company', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: ctx.companyId })
    mockDb.talentFolder.update = vi.fn().mockResolvedValue({})

    await renameFolder(ctx, { id: 'f1', name: 'New Name' })
    expect(mockDb.talentFolder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'New Name' } }),
    )
  })

  it('throws NotFoundError for folder from another company', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: 'other-company' })
    await expect(renameFolder(ctx, { id: 'f1', name: 'New' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when folder does not exist', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue(null)
    await expect(renameFolder(ctx, { id: 'f1', name: 'New' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ValidationError for empty name', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: ctx.companyId })
    await expect(renameFolder(ctx, { id: 'f1', name: '' })).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('deleteFolder', () => {
  it('deletes a folder owned by the company', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: ctx.companyId })
    mockDb.talentFolder.delete = vi.fn().mockResolvedValue({})

    await deleteFolder(ctx, { id: 'f1' })
    expect(mockDb.talentFolder.delete).toHaveBeenCalledWith({ where: { id: 'f1' } })
  })

  it('throws NotFoundError for folder from another company', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: 'other' })
    await expect(deleteFolder(ctx, { id: 'f1' })).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('addToFolder', () => {
  it('adds a visible student to a company folder', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: ctx.companyId })
    vi.mocked(isStudentVisibleToCompany).mockResolvedValue(true)
    mockDb.talentFolderItem.upsert = vi.fn().mockResolvedValue({})

    await addToFolder(ctx, { folderId: 'f1', studentId: 's1' })
    expect(mockDb.talentFolderItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { folderId_studentId: { folderId: 'f1', studentId: 's1' } },
      }),
    )
  })

  it('throws NotFoundError when student is not visible', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: ctx.companyId })
    vi.mocked(isStudentVisibleToCompany).mockResolvedValue(false)
    await expect(addToFolder(ctx, { folderId: 'f1', studentId: 's1' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('throws NotFoundError for folder from another company', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: 'other' })
    await expect(addToFolder(ctx, { folderId: 'f1', studentId: 's1' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('stores trimmed note', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: ctx.companyId })
    vi.mocked(isStudentVisibleToCompany).mockResolvedValue(true)
    mockDb.talentFolderItem.upsert = vi.fn().mockResolvedValue({})

    await addToFolder(ctx, { folderId: 'f1', studentId: 's1', note: '  Good candidate  ' })
    const call = (mockDb.talentFolderItem.upsert as any).mock.calls[0][0]
    expect(call.create.note).toBe('Good candidate')
  })
})

describe('removeFromFolder', () => {
  it('removes an item from a company folder', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: ctx.companyId })
    mockDb.talentFolderItem.deleteMany = vi.fn().mockResolvedValue({})

    await removeFromFolder(ctx, { folderId: 'f1', studentId: 's1' })
    expect(mockDb.talentFolderItem.deleteMany).toHaveBeenCalledWith({
      where: { folderId: 'f1', studentId: 's1' },
    })
  })

  it('throws NotFoundError for folder from another company', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: 'other' })
    await expect(removeFromFolder(ctx, { folderId: 'f1', studentId: 's1' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('updateNote', () => {
  it('updates the note for an item in a company folder', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: ctx.companyId })
    mockDb.talentFolderItem.updateMany = vi.fn().mockResolvedValue({})

    await updateNote(ctx, { folderId: 'f1', studentId: 's1', note: 'Great fit' })
    expect(mockDb.talentFolderItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { folderId: 'f1', studentId: 's1' },
        data: { note: 'Great fit' },
      }),
    )
  })

  it('stores null for empty note', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ companyId: ctx.companyId })
    mockDb.talentFolderItem.updateMany = vi.fn().mockResolvedValue({})

    await updateNote(ctx, { folderId: 'f1', studentId: 's1', note: null })
    const call = (mockDb.talentFolderItem.updateMany as any).mock.calls[0][0]
    expect(call.data.note).toBeNull()
  })
})

describe('getFolderItems', () => {
  it('returns only visible students and uses unlock status for card', async () => {
    const student1 = {
      id: 's1',
      fullName: 'Alice',
      headline: null,
      skills: [],
      major: null,
      degreeLevel: null,
      graduationYear: null,
      cgpa: null,
      workAuth: null,
      completeness: 80,
      visibility: 'PUBLIC',
      school: null,
      lastActiveAt: null,
      unlocks: [{ companyId: ctx.companyId }],
    }
    const student2 = {
      id: 's2',
      fullName: 'Bob',
      headline: null,
      skills: [],
      major: null,
      degreeLevel: null,
      graduationYear: null,
      cgpa: null,
      workAuth: null,
      completeness: 80,
      visibility: 'PUBLIC',
      school: null,
      lastActiveAt: null,
      unlocks: [],
    }

    const folderData = {
      id: 'f1',
      companyId: ctx.companyId,
      name: 'Shortlist',
      createdAt: new Date(),
      _count: { items: 2 },
      items: [
        { studentId: 's1', note: 'Good', createdAt: new Date(), student: student1 },
        { studentId: 's2', note: null, createdAt: new Date(), student: student2 },
        { studentId: 's3', note: null, createdAt: new Date(), student: { ...student1, id: 's3', fullName: 'Carol', unlocks: [] } },
      ],
    }

    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue(folderData)
    vi.mocked(isStudentVisibleToCompany)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false) // s3 is not visible

    const result = await getFolderItems(ctx, 'f1')
    expect(result.items).toHaveLength(2)
    expect(result.items[0].card.unlocked).toBe(true)
    expect(result.items[1].card.unlocked).toBe(false)
  })

  it('throws NotFoundError for folder from another company', async () => {
    mockDb.talentFolder.findUnique = vi.fn().mockResolvedValue({ id: 'f1', companyId: 'other', items: [], _count: { items: 0 } })
    await expect(getFolderItems(ctx, 'f1')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('getStudentFolderIds', () => {
  it('returns folderIds for the student in the company', async () => {
    mockDb.talentFolderItem.findMany = vi.fn().mockResolvedValue([
      { folderId: 'f1' },
      { folderId: 'f2' },
    ])
    const ids = await getStudentFolderIds(ctx, 's1')
    expect(ids).toEqual(['f1', 'f2'])
    expect(mockDb.talentFolderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId: 's1', folder: { companyId: ctx.companyId } },
      }),
    )
  })
})
