import {
  mobileEmptySchema,
  mobileProfileCompletenessSchema,
  mobileProfileSchema,
  mobileSchoolListSchema,
  type MobileProfile,
} from '@shared/mobile-api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'
import type { BasicInput, PreferencesInput, SkillsInput } from './schemas'

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
    mutationFn: (body: S extends 'basic' ? BasicInput : S extends 'preferences' ? PreferencesInput : SkillsInput) =>
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
