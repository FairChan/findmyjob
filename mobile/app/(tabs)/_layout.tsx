import { Tabs } from 'expo-router'
import { Briefcase, FileText, House, UserRound } from 'lucide-react-native'
import { useTranslations } from 'use-intl'

import { useTheme } from '@/theme/use-theme'

/** 学生端底部导航（MOBILE.md §5.3）：首页 / 职位 / 投递 / 我的 */
export default function TabsLayout() {
  const t = useTranslations('mobile.tabs')
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
      <Tabs.Screen name="home" options={{ title: t('home'), tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
      <Tabs.Screen name="jobs" options={{ title: t('jobs'), tabBarIcon: ({ color, size }) => <Briefcase color={color} size={size} /> }} />
      <Tabs.Screen name="applications" options={{ title: t('applications'), tabBarIcon: ({ color, size }) => <FileText color={color} size={size} /> }} />
      <Tabs.Screen name="me" options={{ title: t('me'), tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
    </Tabs>
  )
}
