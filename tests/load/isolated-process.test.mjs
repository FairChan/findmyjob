import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const preload = fileURLToPath(new URL('../../scripts/load/isolated-process.cjs', import.meta.url))
const runDir = await mkdtemp(join(tmpdir(), 'load-preload-probe-'))
const server = createServer((request, response) => {
  if (request.url === '/redirect-external') {
    response.writeHead(302, { location: 'https://external.example/private-token' })
    response.end()
  } else response.end('local-ok')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const env = {
  ...process.env, APP_ENV: 'ci', LOAD_RUN_ID: 'synthetic-preload-probe', LOAD_RUN_DIR: runDir,
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:54329/synthetic_test',
  INTERNAL_BASE_URL: `http://127.0.0.1:${port}`, SMTP_URL: 'smtp://127.0.0.1:10259',
  NEXT_TELEMETRY_DISABLED: '1',
}
async function probe(code, overrides = {}, command = ['--input-type=module', '-e', code], cwd = runDir) {
  const child = spawn(process.execPath, ['--require', preload, ...command], {
    env: { ...env, ...overrides }, cwd, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  child.stdout.on('data', data => { stdout += data })
  child.stderr.on('data', data => { stderr += data })
  const timeout = setTimeout(() => child.kill(), 10_000)
  const exit = await new Promise(resolve => child.on('close', resolve))
  clearTimeout(timeout)
  return { exit, stdout, stderr }
}

test.after(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(runDir, { recursive: true, force: true })
})

test('requires explicit isolated configuration before executing caller code', async () => {
  for (const overrides of [{ APP_ENV: 'production' }, { LOAD_RUN_ID: '' }, { LOAD_RUN_DIR: '' },
    { DATABASE_URL: 'postgresql://synthetic:private@external.example/synthetic_test' },
    { DATABASE_URL: 'postgresql://synthetic:private@127.0.0.1:54329/synthetic' },
    { INTERNAL_BASE_URL: 'https://external.example' }, { SMTP_URL: '' }]) {
    const result = await probe('console.log("caller-ran")', overrides)
    assert.notEqual(result.exit, 0)
    assert.equal(result.stdout, '')
    assert.doesNotMatch(result.stderr, /private|synthetic:private/)
  }
})

test('hides synthetic environment files through sync, callback, promises and ESM fs APIs', async () => {
  const fixture = join(runDir, '.env.synthetic')
  await writeFile(fixture, 'synthetic-only-no-private-content')
  const result = await probe(`
    import assert from 'node:assert/strict';
    import fs, { readFileSync, statSync } from 'node:fs';
    import promises from 'node:fs/promises';
    const target = ${JSON.stringify(fixture)};
    for (const call of [() => readFileSync(target), () => statSync(target), () => fs.openSync(target, 'r')]) {
      assert.throws(call, {code: 'ENOENT'});
    }
    assert.equal(fs.existsSync(target), false);
    for (const method of ['readFile', 'stat', 'lstat', 'access', 'open']) {
      await assert.rejects(promises[method](target), {code: 'ENOENT'});
      await new Promise((resolve, reject) => fs[method](target, (error) => {
        try { assert.equal(error?.code, 'ENOENT'); resolve(); } catch(error) { reject(error); }
      }));
    }
    assert.throws(() => readFileSync(new URL('file://' + target.replaceAll('\\\\', '/'))), {code: 'ENOENT'});
  `)
  assert.equal(result.exit, 0, result.stderr)
})

test('rejects external and unowned loopback access without contacting them or exposing credentials', async () => {
  const result = await probe(`
    import assert from 'node:assert/strict';
    import net from 'node:net'; import http from 'node:http'; import https from 'node:https';
    for (const options of [{host:'203.0.113.1',port:443}, {host:'127.0.0.1',port:1}]) {
      assert.throws(() => net.connect(options), {code:'LOAD_ISOLATION_BLOCKED'});
    }
    assert.throws(() => http.get('http://private:credential@external.example'), {code:'LOAD_ISOLATION_BLOCKED'});
    assert.throws(() => https.get('https://private:credential@external.example'), {code:'LOAD_ISOLATION_BLOCKED'});
    await assert.rejects(fetch('https://external.example/private-token'), {code:'LOAD_ISOLATION_BLOCKED'});
  `)
  assert.equal(result.exit, 0, result.stderr)
  assert.match(result.stderr, /load-isolation-blocked/)
  assert.doesNotMatch(result.stderr, /203\.0\.113|external\.example|private|credential/)
})

test('allows actual fetch and HTTP requests to the explicitly owned local listener', async () => {
  const result = await probe(`
    import assert from 'node:assert/strict'; import http from 'node:http';
    assert.equal(await (await fetch(process.env.INTERNAL_BASE_URL)).text(), 'local-ok');
    await new Promise((resolve, reject) => http.get(process.env.INTERNAL_BASE_URL, response => {
      let body = ''; response.on('data', value => body += value);
      response.on('end', () => { try { assert.equal(body, 'local-ok'); resolve(); } catch(error) { reject(error); } });
    }).on('error', reject));
  `)
  assert.equal(result.exit, 0, result.stderr)
})

test('does not follow an external redirect from an allowed local endpoint', async () => {
  const result = await probe(`
    import assert from 'node:assert/strict';
    await assert.rejects(fetch(process.env.INTERNAL_BASE_URL + '/redirect-external'), {code:'LOAD_ISOLATION_BLOCKED'});
    const manual = await fetch(process.env.INTERNAL_BASE_URL + '/redirect-external', {redirect:'manual'});
    assert.equal(manual.status, 302);
  `)
  assert.equal(result.exit, 0, result.stderr)
  assert.match(result.stderr, /load-isolation-blocked/)
  assert.doesNotMatch(result.stderr, /external\.example|private-token/)
})

test('preserves guarded realpath native APIs and stat missing-entry semantics', async () => {
  const result = await probe(`
    import assert from 'node:assert/strict'; import fs from 'node:fs'; import { promisify } from 'node:util';
    assert.equal(typeof fs.realpathSync.native, 'function');
    assert.equal(typeof fs.realpath.native, 'function');
    assert.equal(fs.realpathSync.native(process.env.LOAD_RUN_DIR), fs.realpathSync(process.env.LOAD_RUN_DIR));
    const hidden = process.env.LOAD_RUN_DIR + '/.env.synthetic';
    assert.equal(await promisify(fs.exists)(process.env.LOAD_RUN_DIR), true);
    assert.equal(await promisify(fs.exists)(hidden), false);
    assert.equal(await promisify(fs.exists)(process.env.LOAD_RUN_DIR + '/absent'), false);
    assert.throws(() => fs.realpathSync.native(hidden), {code:'ENOENT'});
    await new Promise((resolve, reject) => fs.realpath.native(hidden, error => {
      try { assert.equal(error?.code, 'ENOENT'); resolve(); } catch(error) { reject(error); }
    }));
    for (const method of ['statSync', 'lstatSync']) {
      assert.equal(fs[method](hidden, {throwIfNoEntry:false}), undefined);
      assert.throws(() => fs[method](hidden, {throwIfNoEntry:true}), {code:'ENOENT'});
    }
  `)
  assert.equal(result.exit, 0, result.stderr)
})

test('installed Prisma version CLI starts under isolation without a database operation', async () => {
  const result = await probe('', { CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' }, [
    fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url)), '--version',
  ], fileURLToPath(new URL('../../', import.meta.url)))
  assert.equal(result.exit, 0, result.stderr)
  assert.match(result.stdout, /prisma\s*:\s*6\./)
})
