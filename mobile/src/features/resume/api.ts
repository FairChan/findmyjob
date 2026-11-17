import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as DocumentPicker from 'expo-document-picker'
import { mobileEmptySchema, mobileResumeListSchema } from '@shared/mobile-api'
import { z } from 'zod'

import { ApiError, apiFetch, apiUpload } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'

/** 与服务端 RESUME_MAX_BYTES 一致；超过就不上传，省流量也给出明确提示 */
export const RESUME_MAX_BYTES = 5 * 1024 * 1024

export function useResumes() {
  return useQuery({ queryKey: qk.resumes, queryFn: ({ signal }) => apiFetch('/resumes', { schema: mobileResumeListSchema, signal }) })
}

/** 设为主简历、删除（MA1-T08）；成功后简历列表和完成度（hasResume）都重拉 */
export function useResumeAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'primary' | 'delete' }) =>
      action === 'primary'
        ? apiFetch(`/resumes/${id}/primary`, { method: 'POST', schema: mobileEmptySchema })
        : apiFetch(`/resumes/${id}`, { method: 'DELETE', schema: mobileEmptySchema }),
    onSettled: () => Promise.all([queryClient.invalidateQueries({ queryKey: qk.resumes }), queryClient.invalidateQueries({ queryKey: qk.profile })]),
  })
}

const uploadResultSchema = z.object({ ok: z.literal(true), resumeId: z.string() })

export type PickedPdf = { uri: string; name: string; size: number | null; mimeType: string | null }

/**
 * 用系统文件选择器（SAF，ACTION_OPEN_DOCUMENT）选 PDF：不需要也不申请存储权限（MOBILE.md §5.6）。
 * 用户取消返回 null。
 */
export async function pickPdf(): Promise<PickedPdf | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false })
  if (res.canceled || !res.assets?.[0]) return null
  const a = res.assets[0]
  return { uri: a.uri, name: a.name, size: a.size ?? null, mimeType: a.mimeType ?? null }
}

/** 本地先挡掉明显不行的文件（大小、类型）；页数、加密等仍由服务端检查 */
export function localResumeProblem(file: PickedPdf): 'FILE_TOO_LARGE' | 'INVALID_FILE_TYPE' | null {
  if (file.size !== null && file.size > RESUME_MAX_BYTES) return 'FILE_TOO_LARGE'
  const isPdf = file.mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  return isPdf ? null : 'INVALID_FILE_TYPE'
}

export function useUploadResume() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: PickedPdf) => {
      const problem = localResumeProblem(file)
      if (problem) throw new ApiError(problem, 0)
      const form = new FormData()
      // React Native 的 FormData 用 { uri, name, type } 描述本地文件
      form.append('file', { uri: file.uri, name: file.name, type: 'application/pdf' } as unknown as Blob)
      return apiUpload('RESUME', form, uploadResultSchema)
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: qk.resumes }), queryClient.invalidateQueries({ queryKey: qk.profile })])
    },
  })
}

/** 上传端点的错误码 → Web 简历页已有的 resume.* 文案 */
export function uploadErrorKey(err: unknown): string | null {
  const code = err instanceof ApiError ? err.code : ''
  return (
    {
      FILE_TOO_LARGE: 'errorFileTooLarge',
      INVALID_FILE_TYPE: 'errorInvalidType',
      INVALID_PDF: 'errorInvalidType',
      ENCRYPTED_PDF: 'errorEncryptedPdf',
      TOO_MANY_PAGES: 'errorTooManyPages',
      RATE_LIMITED: 'errorRateLimit',
    } as Record<string, string>
  )[code] ?? null
}
