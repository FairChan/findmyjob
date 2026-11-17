import { mobileMeSchema } from '@shared/mobile-api'
import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'
import { authClient } from '@/lib/auth-client'

export const ME_QUERY_KEY = ['me'] as const

/** 会话 + 角色。没有会话时不请求 /me */
export function useMe() {
  const session = authClient.useSession()
  const signedIn = !!session.data?.user
  const me = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => apiFetch('/me', { schema: mobileMeSchema, signal }),
    enabled: signedIn,
  })
  return {
    loading: session.isPending || (signedIn && me.isPending),
    signedIn,
    me: me.data ?? null,
    error: me.error,
    refetch: me.refetch,
  }
}
