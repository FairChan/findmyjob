/// <reference types="vitest/config" />
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 打包成单个 HTML 文件：可以直接发给合伙人，双击即可打开
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // 缓存放系统临时目录：Windows 应用商店版的 AppData 虚拟化会让 node_modules/.vite 改名失败
  cacheDir: join(tmpdir(), 'findmyjob-prototype-vite'),
  server: { port: 5180 },
  // 业务规则写成纯函数放在 src/lib，用 node 环境测试即可
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
