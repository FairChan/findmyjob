// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    // .maestro/scripts 跑在 Maestro 的 JS 沙箱里（http、json、output 是它注入的全局）
    ignores: ['dist/**', '.expo/**', 'android/**', 'ios/**', 'node_modules/**', '.maestro/**'],
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
