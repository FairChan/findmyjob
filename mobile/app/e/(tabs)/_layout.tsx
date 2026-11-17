import { Tabs } from 'expo-router'
import { Briefcase, LayoutDashboard, UserRound, Users } from 'lucide-react-native'
import { useTranslations } from 'use-intl'

import { useTheme } from '@/theme/use-theme'

/** 企业端底部导航（MOBILE.md §5.3）：工作台 / 职位与候选人 / 人才库 / 我的 */
export default function EmployerTabs() {
  const t = useTranslations('mobile.employer.tabs')
  const { colors } = useTheme()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: t('dashboard'), tabBarButtonTestID: 'tab-e-dashboard', tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} /> }} />
      <Tabs.Screen name="jobs" options={{ title: t('jobs'), tabBarButtonTestID: 'tab-e-jobs', tabBarIcon: ({ color, size }) => <Briefcase color={color} size={size} /> }} />
      {/* 人才库 tab 不会自动搜索：进入页面不发请求，用户点"搜索"才计一页 */}
      <Tabs.Screen name="talent" options={{ title: t('talent'), tabBarButtonTestID: 'tab-e-talent', tabBarIcon: ({ color, size }) => <Users color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: t('account'), tabBarButtonTestID: 'tab-e-account', tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
    </Tabs>
  )
}
