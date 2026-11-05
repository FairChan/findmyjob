import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // server-only throws outside Next.js; shim it to a no-op for Vitest
      'server-only': path.resolve(__dirname, 'tests/setup/server-only-shim.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['prototype/**', 'node_modules/**', '.next/**', 'tests/e2e/**'],
    // 全局要求每条测试至少一个断言（见文件内注释）
    setupFiles: ['tests/setup/assertions.ts'],
    // Required for integration tests that share DB state; unit tests pay a small speed cost
    fileParallelism: false,
  },
})
