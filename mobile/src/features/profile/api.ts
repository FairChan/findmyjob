import {
  mobileEmptySchema,
  mobileProfileCompletenessSchema,
  mobileProfileSchema,
  mobileSchoolListSchema,
  type MobileProfile,
  type Step1Data,
  type Step2Data,
  type Step3Data,
} from '@shared/mobile-api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'

// 表单用的"全字段"形态：共享 step schema 的可选字段在这里一律给出（null 表示未填），
// 因为三个 PUT 都是整节替换，漏传就等于清空
export type BasicInput = Required<Step1Data>
export type PreferencesInput = Required<Step2Data>
export type SkillsInput = Required<Step3Data>

export function useProfile() {
  return useQuery({ queryKey: qk.profile, queryFn: ({ signal }) => apiFetch('/profile', { schema: mobileProfileSchema, signal }) })
}

export function useCompleteness() {
  return useQuery({
    queryKey: qk.completeness,
    queryFn: ({ signal }) => apiFetch('/profile/completeness', { schema: mobileProfileCompletenessSchema, signal }),
  })
}

export function useSchools() {
  // 学校列表很少变，缓存一小时
  return useQuery({
    queryKey: qk.schools,
    queryFn: ({ signal }) => apiFetch('/schools', { schema: mobileSchoolListSchema, signal }),
    staleTime: 60 * 60_000,
  })
}

export type ProfileSection = 'basic' | 'preferences' | 'skills'

/**
 * 三个分区端点由 MA1-T05 提供：PUT /profile/basic | /preferences | /skills，整节替换。
 * 保存成功后档案和完成度都要重拉（完成度在服务端重算；qk.profile 是两者的公共前缀）。
 */
export function useSaveProfileSection<S extends ProfileSection>(section: S) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: S extends 'basic' ? Step1Data : S extends 'preferences' ? Step2Data : Step3Data) =>
      apiFetch(`/profile/${section}`, { method: 'PUT', body, schema: mobileEmptySchema }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.profile })
    },
  })
}

/** 当前档案 → 各分区表单的初始值 */
export function basicFromProfile(p: MobileProfile | undefined, fallbackName = ''): BasicInput {
  return {
    fullName: p?.fullName ?? fallbackName,
    schoolId: p?.schoolId ?? null,
    degreeLevel: (p?.degreeLevel as BasicInput['degreeLevel']) ?? null,
    major: p?.major ?? null,
    graduationYear: p?.graduationYear ?? null,
    graduationMonth: p?.graduationMonth ?? null,
    cgpa: p?.cgpa ?? null,
    nationality: p?.nationality ?? null,
    workAuth: (p?.workAuth as BasicInput['workAuth']) ?? 'STUDENT_PASS',
  }
}

export function preferencesFromProfile(p: MobileProfile | undefined): PreferencesInput {
  return {
    intents: (p?.intents as PreferencesInput['intents']) ?? [],
    availableFrom: p?.availableFrom ?? null,
    preferredStates: p?.preferredStates ?? [],
    preferredIndustries: p?.preferredIndustries ?? [],
    expectedSalaryMin: p?.expectedSalaryMin ?? null,
    expectedSalaryMax: p?.expectedSalaryMax ?? null,
  }
}

export function skillsFromProfile(p: MobileProfile | undefined): SkillsInput {
  return {
    languages: (p?.languages as SkillsInput['languages']) ?? [],
    skills: p?.skills ?? [],
    headline: p?.headline ?? null,
    summary: p?.summary ?? null,
  }
}

/** POST /onboarding/complete（MA1-T08）：建档最后一步；前四节没填完 422，缺联系方式或简历时返回对应错误码 */
export function useCompleteOnboarding() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch('/onboarding/complete', { method: 'POST', schema: mobileEmptySchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.profile }),
  })
}
