import type { ExpoConfig } from 'expo/config'

// 三个变体用不同的包名和 scheme，可以在同一台手机上并存；服务端 trustedOrigins 只放对应变体的精确 scheme。
type Variant = 'dev' | 'staging' | 'prod'

const VARIANTS: Record<Variant, { name: string; androidPackage: string; scheme: string; apiBaseUrl: string }> = {
  dev: {
    name: 'FindMYJob Dev',
    androidPackage: 'asia.findmyjob.app.dev',
    scheme: 'findmyjob-dev',
    // Android 模拟器访问宿主机的固定地址；真机调试时用 FINDMYJOB_API_BASE_URL 覆盖
    apiBaseUrl: 'http://10.0.2.2:3000',
  },
  staging: {
    name: 'FindMYJob Staging',
    androidPackage: 'asia.findmyjob.app.staging',
    scheme: 'findmyjob-staging',
    apiBaseUrl: 'https://findmyjob.asia',
  },
  prod: {
    name: 'FindMYJob',
    androidPackage: 'asia.findmyjob.app',
    scheme: 'findmyjob',
    // 正式主机上线（GATE-M7）前与 staging 相同；切换时只改这里
    apiBaseUrl: 'https://findmyjob.asia',
  },
}

function resolveVariant(raw: string | undefined): Variant {
  return raw === 'staging' || raw === 'prod' ? raw : 'dev'
}

const variant = resolveVariant(process.env.APP_VARIANT)
const v = VARIANTS[variant]

const config: ExpoConfig = {
  name: v.name,
  slug: 'findmyjob',
  version: '0.1.0',
  scheme: v.scheme,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  platforms: ['android'],
  android: {
    package: v.androidPackage,
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    // 只申请 MOBILE.md §5.6 允许的权限；通知权限在 MA3 再加
    permissions: [],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    allowBackup: false,
  },
  plugins: ['expo-router'],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    variant,
    apiBaseUrl: process.env.FINDMYJOB_API_BASE_URL ?? v.apiBaseUrl,
    // Google Cloud 项目编号（不是密钥）；没填时 App 直接走 WebView Turnstile（MA1-T03）
    playIntegrityProjectNumber: process.env.PLAY_INTEGRITY_PROJECT_NUMBER ?? '',
  },
}

export default config
