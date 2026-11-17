import { Stack } from 'expo-router'

import { useTheme } from '@/theme/use-theme'

/** 企业外壳（MA4-T02，v1.1 轻量版）：底部四个 tab + 候选人、人才详情等二级页 */
export default function EmployerLayout() {
  const { colors } = useTheme()
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
}
