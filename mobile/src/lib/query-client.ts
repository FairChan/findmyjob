import { QueryClient } from '@tanstack/react-query'

import { ApiError } from './api-client'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // 4xx 是确定的结果，重试没有意义；网络错误和 5xx 最多再试 2 次
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
        refetchOnWindowFocus: false,
      },
      mutations: {
        // 写操作（投递、扣额度）绝不自动重试，避免重复提交
        retry: false,
        // 离线时直接失败，不进入"暂停、联网后自动补发"：投递必须是学生在线时亲手确认的（MOBILE.md §5.1）
        networkMode: 'always',
      },
    },
  })
}
