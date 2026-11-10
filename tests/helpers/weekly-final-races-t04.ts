import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'
import { PrismaClient, type Prisma } from '@prisma/client'
import { testDb, validateTestDbUrl } from '../setup/db'

export function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
type Barrier = { model: 'job' | 'studentProfile'; id: string; entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }
type Actor = { client: PrismaClient; pid?: number; barrier?: Barrier }
const actors = new AsyncLocalStorage<Actor>()

// Only route calls and pause before a real query; never substitute query results.
export const actorDb = new Proxy(testDb, {
  get(_target, property) {
    const actor = actors.getStore(), client = actor?.client ?? testDb
    if (property === '$transaction' && actor) {
      return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) => client.$transaction(async tx => {
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
        actor.pid = backend.pid
        const wrapped = new Proxy(tx, {
          get(target, key) {
            const value = Reflect.get(target, key)
            if (key === actor.barrier?.model) return new Proxy(value, {
              get(model, operation) {
                const method = Reflect.get(model, operation)
                if (operation !== 'findUnique') return typeof method === 'function' ? method.bind(model) : method
                return async (args: { where: { id?: string } }) => {
                  const barrier = actor.barrier
                  if (barrier && args.where.id === barrier.id) {
                    actor.barrier = undefined
                    barrier.entered.resolve()
                    await barrier.release.promise
                  }
                  return method.call(model, args)
                }
              },
            })
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
        return work(wrapped)
      }, { maxWait: 5_000, timeout: 15_000, ...options })
    }
    const value = Reflect.get(client, property)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export function raceActors(model: Barrier['model'], id: string) {
  const raw = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  validateTestDbUrl(raw)
  const url = new URL(raw!)
  url.searchParams.set('connection_limit', '1')
  const create = (): Actor => ({ client: new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] }) })
  const sender = create(), writer = create()
  const barrier: Barrier = { model, id, entered: deferred(), release: deferred() }
  sender.barrier = barrier
  const owned: Promise<unknown>[] = []
  const start = <T>(actor: Actor, work: () => Promise<T>) => {
    const promise = actors.run(actor, work)
    owned.push(promise)
    // Keep rejection owned even if an earlier assertion fails.
    void promise.catch(() => {})
    return promise
  }
  return {
    sender: <T>(work: () => Promise<T>) => start(sender, work),
    writer: <T>(work: () => Promise<T>) => start(writer, work),
    entered: () => bounded(barrier.entered.promise),
    release: barrier.release.resolve,
    async expectWriterBlocked(work: Promise<unknown>) {
      let settled = false
      void work.then(() => { settled = true }, () => { settled = true })
      const deadline = performance.now() + 4_000
      while (performance.now() < deadline) {
        if (settled) throw new Error('Writer committed/rejected before final SENDING transaction finished')
        if (writer.pid && sender.pid) {
          const [row] = await testDb.$queryRaw<Array<{ blockers: number[] }>>`SELECT pg_blocking_pids(${writer.pid}::int) AS blockers`
          if (row.blockers.includes(sender.pid)) return
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error('No real sender → writer PostgreSQL blocker observed')
    },
    async close() {
      barrier.release.resolve()
      await Promise.allSettled(owned)
      await Promise.all([sender.client.$disconnect(), writer.client.$disconnect()])
    },
  }
}
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Real final query barrier not reached')), 5_000) })]) }
  finally { clearTimeout(timer) }
}
