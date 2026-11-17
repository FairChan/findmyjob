import { useTranslations } from 'use-intl'

import { EmptyState, Screen } from '@/components/ui'

// 占位：页面内容在 MA2-T06 / T07 接入学生端 API 后实现
export default function Tab() {
  const t = useTranslations('mobile.tabs')
  return (
    <Screen>
      <EmptyState title={t('jobs')} />
    </Screen>
  )
}
