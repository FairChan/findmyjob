import 'server-only'
import { Worker } from 'worker_threads'
import { getSetting } from '../services/settings'
// Static import so Next.js standalone nft follows the pnpm symlinks.
// Runtime usage is in the eval worker string below; nft cannot see eval strings.
import 'pdf-lib'
import '@pdf-lib/fontkit'
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
 *
 * SECURITY: `script` is compiled with new Function inside the worker. It must be a
 * static string constant written in server code (like CHECK_PDF_SCRIPT). Never build
 * it from request data, file contents, DB values or anything a user controls;
 * pass such values through `params` instead.
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
// pdf-lib's parser catches errors from invalid objects and keeps parsing, so the throw below can be
// swallowed (an ObjStm bomb appended to a valid PDF still loads). This flag records that the budget
// tripped at all; the harness then reports too_large no matter what the script returned.
let budgetExceeded = false;

const _origEnsureBuffer = DecodeStream.prototype.ensureBuffer;
DecodeStream.prototype.ensureBuffer = function ensureBufferWithBudget(requested) {
  if (requested > inflatedBudget) {
    budgetExceeded = true;
    throw new Error('[pdf-inflate-bomb] single request exceeds budget');
  }
  const before = this.buffer.byteLength;
  const result = _origEnsureBuffer.call(this, requested);
  if (this.buffer.byteLength > before) {
    inflatedTotal += (this.buffer.byteLength - before);
    if (inflatedTotal > inflatedBudget) {
      budgetExceeded = true;
      throw new Error('[pdf-inflate-bomb] cumulative budget exceeded');
    }
  }
  return result;
};

const pdfLib = require('pdf-lib');

parentPort.once('message', async ({ input, params, maxInflatedBytes, script, includeFontkit }) => {
  inflatedBudget = maxInflatedBytes;
  inflatedTotal = 0;
  budgetExceeded = false;
  try {
    const fontkit = includeFontkit ? require('@pdf-lib/fontkit') : undefined;
    const fn = new Function('pdfLib', 'input', 'params', 'fontkit', '"use strict"; return (async () => { ' + script + ' })()');
    const result = await fn(pdfLib, Buffer.from(input), params, fontkit);
    if (budgetExceeded) {
      parentPort.postMessage({ ok: false, reason: 'too_large' });
      return;
    }
    parentPort.postMessage({ ok: true, result }, result instanceof Uint8Array ? [result.buffer] : []);
  } catch (e) {
    if (budgetExceeded || (e instanceof Error && e.message.startsWith('[pdf-inflate-bomb]'))) {
      parentPort.postMessage({ ok: false, reason: 'too_large' });
    } else {
      parentPort.postMessage({ ok: false, reason: 'failed' });
    }
  }
});
`

export type CappedPdfResult<T> =
  | { ok: true; result: T }
  | { ok: false; reason: 'too_large' | 'timeout' | 'failed' | 'aborted' }

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
  opts?: { maxInflatedBytes?: number; timeoutMs?: number; signal?: AbortSignal; includeFontkit?: boolean },
): Promise<CappedPdfResult<T>> {
  const signal = opts?.signal
  if (signal?.aborted) return { ok: false, reason: 'aborted' }
  const maxInflatedBytes =
    opts?.maxInflatedBytes ??
    (await getSetting('upload.pdfMaxInflatedBytes', 50 * 1024 * 1024))
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (signal?.aborted) return { ok: false, reason: 'aborted' }

  return new Promise<CappedPdfResult<T>>((resolve) => {
    const worker = new Worker(CAPPED_WORKER_BOOTSTRAP, {
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 64,
      },
    })

    let settling = false
    const exited = new Promise<void>((resolveExit) => {
      worker.once('exit', () => {
        resolveExit()
        void finish({ ok: false, reason: 'failed' })
      })
    })

    // A lease may be released only after the underlying thread has exited.
    // Merely racing a worker promise against cancellation leaves work running.
    async function finish(result: CappedPdfResult<T>): Promise<void> {
      if (settling) return
      settling = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try {
        await worker.terminate()
      } catch {
        // Even if termination reports an error, wait for the actual exit.
      }
      await exited
      resolve(signal?.aborted ? { ok: false, reason: 'aborted' } : result)
    }

    const onAbort = () => { void finish({ ok: false, reason: 'aborted' }) }
    const timer = setTimeout(() => {
      void finish({ ok: false, reason: 'timeout' })
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.once('message', (msg: { ok: boolean; result?: T; reason?: string }) => {
      if (msg.ok) {
        void finish({ ok: true, result: msg.result as T })
      } else {
        const r = msg.reason
        void finish({
          ok: false,
          reason: r === 'too_large' ? 'too_large' : 'failed',
        })
      }
    })

    worker.on('error', () => {
      void finish({ ok: false, reason: 'failed' })
    })

    if (signal?.aborted) {
      onAbort()
    } else {
      try {
        worker.postMessage({ input, params, maxInflatedBytes, script, includeFontkit: opts?.includeFontkit === true })
      } catch {
        void finish({ ok: false, reason: 'failed' })
      }
    }
  })
}
