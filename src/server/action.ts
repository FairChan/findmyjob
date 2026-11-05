import 'server-only'
import { z } from 'zod'
import { AppError, ForbiddenError } from './errors'
import { logger } from './lib/logger'

async function getSessionUserId(): Promise<string | null> {
  try {
    const { headers } = await import('next/headers')
    const { getSession } = await import('./auth')
    const h = await headers()
    const session = await getSession(h)
    return session?.user?.id ?? null
  } catch {
    return null
  }
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string }

type ActionContext<TInput> = { input: TInput; userId?: string }

export function action<TInput = void, TOutput = void>(opts: {
  auth: 'public' | 'user'
  input?: z.ZodType<TInput>
}, handler: (ctx: ActionContext<TInput>) => Promise<TOutput>): (rawInput?: unknown) => Promise<ActionResult<TOutput>> {
  return async (rawInput?: unknown): Promise<ActionResult<TOutput>> => {
    try {
      let userId: string | undefined

      if (opts.auth === 'user') {
        const id = await getSessionUserId()
        if (!id) throw new ForbiddenError('Authentication required')
        userId = id
      }

      let input: TInput
      if (opts.input) {
        const parsed = opts.input.safeParse(rawInput)
        if (!parsed.success) {
          return { ok: false, code: 'VALIDATION_ERROR' }
        }
        input = parsed.data
      } else {
        input = undefined as unknown as TInput
      }

      const data = await handler({ input, userId })
      return { ok: true, data }
    } catch (err) {
      if (err instanceof AppError) {
        return { ok: false, code: err.code }
      }
      logger.error({
        err: err instanceof Error ? err.message : String(err),
      }, 'Unhandled action error')
      return { ok: false, code: 'INTERNAL_ERROR' }
    }
  }
}
