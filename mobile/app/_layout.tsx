import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AppIntlProvider, deviceLocale } from '@/i18n/provider'
import { paletteFor } from '@/theme/tokens'

export default function RootLayout() {
  const palette = paletteFor(useColorScheme())
  return (
    <AppIntlProvider locale={deviceLocale()}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.background },
          }}
        />
      </SafeAreaProvider>
    </AppIntlProvider>
  )
}
