// Same owned dev-server lifecycle as start-dev-server.mjs, with query-token redaction.
const { createWriteStream } = require('node:fs')
const { spawn } = require('node:child_process')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { StringDecoder } = require('node:string_decoder')
const port = process.env.PORT || '3000'
const output = createWriteStream(process.env.SERVER_LOG_PATH || join(tmpdir(), `findmyjob-e2e-server-${port}.log`))
const child = spawn('pnpm', ['dev', '--port', port], { shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
function pipe(stream, destination) {
  const decoder = new StringDecoder('utf8')
  let buffer = ''
  function emit(line) {
    const safe = line.replace(/([?&]token=)[^&\s"'<>]+/g, '$1[REDACTED]')
    output.write(safe); destination.write(safe)
  }
  stream.on('data', chunk => {
    buffer += decoder.write(chunk)
    let end
    while ((end = buffer.indexOf('\n')) !== -1) { emit(buffer.slice(0, end + 1)); buffer = buffer.slice(end + 1) }
    // Never flush an unterminated token fragment. Oversized diagnostic lines are dropped.
    if (buffer.length > 1024 * 1024) buffer = '[oversized diagnostic line omitted]\n'
  })
  stream.on('end', () => { buffer += decoder.end(); if (buffer) emit(buffer) })
}
pipe(child.stdout, process.stdout)
pipe(child.stderr, process.stderr)
child.on('error', () => { output.end(); process.exitCode = 1 })
child.on('close', code => { output.end(() => { process.exitCode = code ?? 1 }) })
