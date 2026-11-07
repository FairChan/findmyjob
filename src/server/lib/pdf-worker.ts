import 'server-only'
import { Worker } from 'worker_threads'
import { getSetting } from '../services/settings'
// Static import so Next.js standalone nft follows the pnpm symlinks.
// Runtime usage is in the eval worker string below; nft cannot see eval strings.
import 'pdf-lib'
// nft: ensure DecodeStream sub-path is traced for the eval worker
// @ts-ignore
import 'pdf-lib/cjs/core/streams/DecodeStream'

/**
 * runCappedPdfWorker — load and process a user-supplied PDF in an isolated
 * worker_threads Worker, with a hard decompression-budget cap on every
 * DecodeStream.ensureBuffer call.
 *
 * WHY a worker? Uint8Array backing stores live outside the JS heap, so
 * Node's --max-old-space-size cannot bound pdf-lib inflation; resourceLimits
 * only applies to the Worker heap, not the main process.
 *
 * WHAT the script receives: { pdfLib, input: Buffer, params?: unknown }
 *   - pdfLib   the full pdf-lib module (already patched)
 *   - input    the raw PDF bytes as a Buffer
 *   - params   optional caller-defined value passed through postMessage
 * The script's return value must be structurally cloneable; transfer
 * Uint8Array with { transfer: [buf.buffer] }.
 *
 * IMPORTANT: on too_large the caller MUST NOT fall back to returning the
 * original file — the document may contain a bomb that never got inflated.
 */

const DEFAULT_TIMEOUT_MS = 10_000

// CJS worker that patches ensureBuffer BEFORE requiring pdf-lib, then runs
// caller-supplied script. The eval string is static so nft can trace it.
const CAPPED_WORKER_BOOTSTRAP = `
const { parentPort, workerData } = require('worker_threads');

// Patch DecodeStream.prototype.ensureBuffer BEFORE requiring pdf-lib.
// All decoders inherit ensureBuffer; patching the prototype here means
// pdf-lib sees the patched version on every decode regardless of module cache.
const DecodeStream = require('pdf-lib/cjs/core/streams/DecodeStream').default;

let inflatedTotal = 0;
let inflatedBudget = 50 * 1024 * 1024; // overwritten per message

const _origEnsureBuffer = DecodeStream.prototype.ensureBuffer;
DecodeStream.prototype.ensureBuffer = function ensureBufferWithBudget(requested) {
  if (requested > inflatedBudget) {
    throw new Error('[pdf-inflate-bomb] single request exceeds budget');
  }
  const before = this.buffer.byteLength;
  const result = _origEnsureBuffer.call(this, requested);
  if (this.buffer.byteLength > before) {
    inflatedTotal += (this.buffer.byteLength - before);
    if (inflatedTotal > inflatedBudget) {
      throw new Error('[pdf-inflate-bomb] cumulative budget exceeded');
    }
  }
  return result;
};

const pdfLib = require('pdf-lib');

parentPort.once('message', async ({ input, params, maxInflatedBytes, script }) => {
  inflatedBudget = maxInflatedBytes;
  inflatedTotal = 0;
  try {
    const fn = new Function('pdfLib', 'input', 'params', '"use strict"; return (async () => { ' + script + ' })()');
    const result = await fn(pdfLib, Buffer.from(input), params);
    parentPort.postMessage({ ok: true, result }, result instanceof Uint8Array ? [result.buffer] : []);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('[pdf-inflate-bomb]')) {
      parentPort.postMessage({ ok: false, reason: 'too_large' });
    } else {
      parentPort.postMessage({ ok: false, reason: 'failed' });
    }
  }
});
`

export type CappedPdfResult<T> =
  | { ok: true; result: T }
  | { ok: false; reason: 'too_large' | 'timeout' | 'failed' }

/**
 * Run `script` in an isolated Worker with a decompression budget cap.
 *
 * @param script  CJS async function body. Receives `pdfLib`, `input` (Buffer), `params`.
 *                Return value must be structurally cloneable; transfer Uint8Array via
 *                `postMessage({ ... }, [buf.buffer])` from inside the script if needed —
 *                or simply return the Uint8Array and the harness will transfer it.
 * @param input   Raw PDF bytes.
 * @param params  Optional caller-defined value forwarded to the script.
 * @param opts    maxInflatedBytes (default: getSetting), timeoutMs (default: 10 s).
 */
export async function runCappedPdfWorker<T>(
  script: string,
  input: Buffer,
  params?: unknown,
  opts?: { maxInflatedBytes?: number; timeoutMs?: number },
): Promise<CappedPdfResult<T>> {
  const maxInflatedBytes =
    opts?.maxInflatedBytes ??
    (await getSetting('upload.pdfMaxInflatedBytes', 50 * 1024 * 1024))
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<CappedPdfResult<T>>((resolve) => {
    const worker = new Worker(CAPPED_WORKER_BOOTSTRAP, {
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 64,
      },
    })

    const timer = setTimeout(() => {
      worker.terminate()
      resolve({ ok: false, reason: 'timeout' })
    }, timeoutMs)

    worker.once('message', (msg: { ok: boolean; result?: T; reason?: string }) => {
      clearTimeout(timer)
      worker.terminate()
      if (msg.ok) {
        resolve({ ok: true, result: msg.result as T })
      } else {
        const r = msg.reason
        resolve({
          ok: false,
          reason: r === 'too_large' ? 'too_large' : 'failed',
        })
      }
    })

    worker.on('error', () => {
      clearTimeout(timer)
      resolve({ ok: false, reason: 'failed' })
    })

    worker.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) resolve({ ok: false, reason: 'failed' })
    })

    worker.postMessage({ input, params, maxInflatedBytes, script })
  })
}
