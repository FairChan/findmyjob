'use strict'

// Owned local test processes only. This preload is not a production security boundary.
const fs = require('node:fs')
const net = require('node:net')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { fileURLToPath } = require('node:url')
const { syncBuiltinESMExports } = require('node:module')
const { promisify } = require('node:util')

function invalid() {
  throw new Error('Invalid explicit load process isolation configuration')
}
function loopback(host) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase())
}
function endpoint(value, protocols, defaultPort) {
  let url
  try { url = new URL(value) } catch { invalid() }
  if (!protocols.includes(url.protocol) || !loopback(url.hostname)) invalid()
  const port = Number(url.port || defaultPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalid()
  return { url, port }
}
const env = process.env
if (env.APP_ENV !== 'ci' || !/^[a-zA-Z0-9_-]+$/.test(env.LOAD_RUN_ID || '') ||
    !env.LOAD_RUN_DIR || !path.isAbsolute(env.LOAD_RUN_DIR)) invalid()
const relativeRunDir = path.relative(fs.realpathSync(tmpdir()), fs.realpathSync(env.LOAD_RUN_DIR))
if (!relativeRunDir || relativeRunDir.startsWith('..') || path.isAbsolute(relativeRunDir)) invalid()
const database = endpoint(env.DATABASE_URL, ['postgres:', 'postgresql:'], 5432)
if (!/^\/[a-zA-Z0-9_-]+_test$/.test(database.url.pathname)) invalid()
const internal = endpoint(env.INTERNAL_BASE_URL, ['http:', 'https:'],
  env.INTERNAL_BASE_URL?.startsWith('https:') ? 443 : 80)
const smtp = endpoint(env.SMTP_URL, ['smtp:', 'smtps:'],
  env.SMTP_URL?.startsWith('smtps:') ? 465 : 25)
const allowedPorts = new Set([database.port, internal.port, smtp.port])

function blocked(kind) {
  // Never include a URL, hostname, path, headers or configuration in diagnostics.
  process.stderr.write(JSON.stringify({ event: 'load-isolation-blocked', kind }) + '\n')
  const error = new Error('Load process isolation blocked an operation')
  error.code = 'LOAD_ISOLATION_BLOCKED'
  return error
}
function environmentFile(value) {
  if (value instanceof URL) {
    if (value.protocol !== 'file:') return false
    value = fileURLToPath(value)
  }
  if (Buffer.isBuffer(value)) value = value.toString()
  return typeof value === 'string' && value.split(/[\\/]/).some(part => part.toLowerCase().startsWith('.env'))
}
function missing() {
  const error = new Error('ENOENT: environment file unavailable in isolated load process')
  error.code = 'ENOENT'
  error.errno = -2
  return error
}
function preserveMetadata(original, wrapped, overrides = {}) {
  const descriptors = Object.getOwnPropertyDescriptors(original)
  // Native variants need their own path guard; copying them directly would bypass isolation.
  delete descriptors.native
  Object.defineProperties(wrapped, { ...descriptors, ...overrides })
  return wrapped
}
for (const method of ['readFile', 'stat', 'lstat', 'access', 'open', 'realpath', 'readlink']) {
  const original = fs[method]
  const wrapCallback = source => preserveMetadata(source, function (target, ...args) {
    if (!environmentFile(target)) return source.call(this, target, ...args)
    const callback = args.at(-1)
    if (typeof callback !== 'function') throw missing()
    queueMicrotask(() => callback(missing()))
  })
  fs[method] = wrapCallback(original)
  if (original.native) Object.defineProperty(fs[method], 'native', {
    ...Object.getOwnPropertyDescriptor(original, 'native'), value: wrapCallback(original.native),
  })
  const sync = `${method}Sync`
  const originalSync = fs[sync]
  const wrapSync = source => preserveMetadata(source, function (target, ...args) {
    if (environmentFile(target)) {
      if ((method === 'stat' || method === 'lstat') && args[0]?.throwIfNoEntry === false) return undefined
      throw missing()
    }
    return source.call(this, target, ...args)
  })
  fs[sync] = wrapSync(originalSync)
  if (originalSync.native) Object.defineProperty(fs[sync], 'native', {
    ...Object.getOwnPropertyDescriptor(originalSync, 'native'), value: wrapSync(originalSync.native),
  })
  const originalPromise = fs.promises[method]
  fs.promises[method] = async function (target, ...args) {
    if (environmentFile(target)) throw missing()
    return originalPromise.call(this, target, ...args)
  }
}
const existsSync = fs.existsSync
fs.existsSync = preserveMetadata(existsSync, function (target) {
  return !environmentFile(target) && existsSync.call(this, target)
})
const exists = fs.exists
fs.exists = preserveMetadata(exists, function (target, callback) {
  if (environmentFile(target)) return queueMicrotask(() => callback(false))
  return exists.call(this, target, callback)
}, { [promisify.custom]: {
  ...Object.getOwnPropertyDescriptor(exists, promisify.custom),
  value: async target => environmentFile(target) ? false : promisify(exists)(target),
} })
const createReadStream = fs.createReadStream
fs.createReadStream = preserveMetadata(createReadStream, function (target, ...args) {
  if (environmentFile(target)) throw missing()
  return createReadStream.call(this, target, ...args)
})

function permit(host, port) {
  if (!loopback(host) || !allowedPorts.has(Number(port))) throw blocked('network')
}
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  // Node may pass its normalized argument array internally.
  const parameters = Array.isArray(args[0]) ? args[0] : args
  const first = parameters[0]
  const options = first && typeof first === 'object' ? first :
    typeof first === 'string' && !/^\d+$/.test(first) ? { path: first } :
      { port: first, host: typeof parameters[1] === 'string' ? parameters[1] : 'localhost' }
  if (options.path) {
    // Named pipes are local IPC used by Node/Next on Windows; reject remote UNC pipes.
    const localPipe = process.platform === 'win32' && /^\\\\[.?]\\pipe\\/i.test(options.path)
    const relative = path.relative(env.LOAD_RUN_DIR, String(options.path))
    const localUnixSocket = process.platform !== 'win32' && path.isAbsolute(options.path) &&
      relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    if (!localPipe && !localUnixSocket) throw blocked('pipe')
  } else permit(options.host || options.hostname || 'localhost', options.port)
  return connect.apply(this, args)
}
function guardHttp(module, secure) {
  for (const method of ['request', 'get']) {
    const original = module[method]
    module[method] = function (input, ...args) {
      let options = input
      if (typeof input === 'string' || input instanceof URL) {
        let url
        try { url = new URL(input) } catch { throw blocked('network') }
        options = { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
          ...(args[0] && typeof args[0] === 'object' ? args[0] : {}) }
      }
      if (options?.socketPath) throw blocked('pipe')
      permit(options?.hostname || options?.host || 'localhost', options?.port || (secure ? 443 : 80))
      return original.call(this, input, ...args)
    }
  }
}
guardHttp(http, false)
guardHttp(https, true)
const fetch = globalThis.fetch
globalThis.fetch = async function (input, init) {
  let url
  try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url) }
  catch { throw blocked('fetch') }
  if (!['http:', 'https:'].includes(url.protocol)) throw blocked('fetch')
  permit(url.hostname, url.port || (url.protocol === 'https:' ? 443 : 80))
  // Redirects must be inspected before following; automatic redirects can escape the allowlist.
  const response = await fetch.call(this, input, { ...init, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400 && response.headers.has('location') && init?.redirect !== 'manual') {
    throw blocked('redirect')
  }
  return response
}
syncBuiltinESMExports()
