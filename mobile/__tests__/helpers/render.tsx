import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react-native'
import type { ReactElement } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ToastProvider } from '@/components/ui'
import { AppIntlProvider } from '@/i18n/provider'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }

export function testQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
}

/** 360dp 宽的真实 Provider 组合（查询、文案、Toast、安全区），只把网络层换成桩 */
export function renderScreen(ui: ReactElement, { locale = 'zh', client = testQueryClient() }: { locale?: 'zh' | 'en'; client?: QueryClient } = {}) {
  const utils = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <AppIntlProvider locale={locale}>
        <QueryClientProvider client={client}>
          <ToastProvider>{ui}</ToastProvider>
        </QueryClientProvider>
      </AppIntlProvider>
    </SafeAreaProvider>,
  )
  return Object.assign(utils, { client })
}
