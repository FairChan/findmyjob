// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/**', '.expo/**', 'android/**', 'ios/**', 'node_modules/**'],
  },
  {
    rules: {
      // 生产包不留 console；调试输出走 Sentry（MA2 接入）
      'no-console': 'error',
    },
  },
])
