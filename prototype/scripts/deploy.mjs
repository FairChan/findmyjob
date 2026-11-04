// 把打包好的单文件原型复制到本地部署目录（默认 C:\tmp\findmyjob-local）
//   npm run deploy                      构建并部署到默认目录
//   npm run deploy -- D:\demo\findmyjob      部署到指定目录
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(process.argv[2] ?? 'C:/tmp/findmyjob-local')
const built = join(root, 'dist', 'index.html')

if (!existsSync(built)) {
  console.error('没有找到 dist/index.html，请先运行 npm run build')
  process.exit(1)
}
mkdirSync(target, { recursive: true })
copyFileSync(built, join(target, 'index.html'))
console.log(`已部署到 ${target}\\index.html`)
if (!existsSync(join(target, 'serve.mjs'))) console.log('提示：目标目录里还没有 serve.mjs 和启动脚本，从 C:\\tmp\\findmyjob-local 复制过去即可')
