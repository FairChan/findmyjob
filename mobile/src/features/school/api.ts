import { mobileEmptySchema } from '@shared/mobile-api'

import { apiFetch } from '@/lib/api-client'

/** 与服务端一致：域名必须"完全等于"学校登记的某个邮箱域名（不接受子域名） */
export function emailMatchesSchool(email: string, domains: readonly string[]): boolean {
  const normalized = email.trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  if (at <= 0) return false
  return domains.map((d) => d.toLowerCase()).includes(normalized.slice(at + 1))
}

// MA1-T05：POST /school-verification/send 与 /confirm（输入同 Web 的 requestOtpSchema / verifyOtpSchema）
export function sendSchoolOtp(input: { schoolId: string; schoolEmail: string }) {
  return apiFetch('/school-verification/send', { method: 'POST', body: input, schema: mobileEmptySchema })
}

export function confirmSchoolOtp(input: { otp: string }) {
  return apiFetch('/school-verification/confirm', { method: 'POST', body: input, schema: mobileEmptySchema })
}
