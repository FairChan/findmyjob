// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/**', '.expo/**', 'android/**', 'ios/**', 'node_modules/**'],
  },
  {
    // 构建和测试配置文件跑在 Node 里
    files: ['*.config.js'],
    languageOptions: {
      globals: { __dirname: 'readonly', require: 'readonly', module: 'writable', process: 'readonly' },
    },
  },
  {
    rules: {
      // 生产包不留 console；调试输出走 Sentry（MA2 接入）
      'no-console': 'error',
    },
  },
])
