/**
 * Wraps `pnpm dev` and tees stdout+stderr to a temp log file for the E2E PII check.
 * Playwright's webServer.command points here; env vars from webServer.env are
 * forwarded automatically to this process and inherited by the inner pnpm dev.
 */
import { createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const port = process.env.PORT || '3000'
// SERVER_LOG_PATH is injected via playwright.config.ts webServer.env; fall back to tmpdir if absent.
const logPath = process.env.SERVER_LOG_PATH || join(tmpdir(), 'findmyjob-laneb-e2e-server.log')

const ws = createWriteStream(logPath)

const p = spawn('pnpm', ['dev', '--port', port], {
  shell: true,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
})

p.stdout.on('data', (data) => {
  ws.write(data)
  process.stdout.write(data)
})
p.stderr.on('data', (data) => {
  ws.write(data)
  process.stderr.write(data)
})
p.on('exit', (code) => {
  ws.end()
  process.exit(code ?? 0)
})
