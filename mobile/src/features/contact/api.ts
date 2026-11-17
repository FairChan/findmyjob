import { mobileContactSchema, type MobileContact } from '@shared/mobile-api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'

const CONTACT_KEY = ['contact'] as const

/** 本人联系方式明文（只经服务端 contact-access）；不在离线缓存白名单里，只放内存 */
export function useContact() {
  return useQuery({ queryKey: CONTACT_KEY, queryFn: ({ signal }) => apiFetch('/contact', { schema: mobileContactSchema, signal }) })
}

export const CONTACT_FIELDS = ['phone', 'email', 'whatsapp', 'wechat', 'linkedinUrl'] as const
export type ContactField = (typeof CONTACT_FIELDS)[number]

/** PUT /contact 是整份替换：五个字段都要带上，空串一律变 null（服务端清空该项） */
export function toContactBody(form: Record<ContactField, string>): MobileContact {
  return Object.fromEntries(CONTACT_FIELDS.map((k) => [k, form[k].trim() || null])) as MobileContact
}

export function useSaveContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: MobileContact) => apiFetch('/contact', { method: 'PUT', body, schema: mobileContactSchema }),
    onSuccess: async (data) => {
      queryClient.setQueryData(CONTACT_KEY, data)
      // hasContact 影响完成度卡片和投递阻碍
      await queryClient.invalidateQueries({ queryKey: qk.profile })
    },
  })
}
