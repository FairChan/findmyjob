/** Observe immediately without converting a rejected operation into success. */
export function observe<T>(pending: Promise<T>): Promise<T> {
  void pending.catch(() => undefined)
  return pending
}

/** Bounds the test's wait; it does not claim to cancel the underlying operation. */
export async function bounded<T>(pending: PromiseLike<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: test boundary timed out`)), 5_000)
      }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}

export function reachBarrier<T>(entered: Promise<T>, running: Promise<unknown>, label: string): Promise<T> {
  return bounded(Promise.race([
    entered,
    running.then(() => { throw new Error(`${label}: operation ended before reaching barrier`) }),
  ]), label)
}

/** After releasing every held barrier, observe all started operations before returning. */
export async function finishAll(pending: Promise<unknown>[], label: string): Promise<void> {
  const outcomes = await bounded(Promise.allSettled(pending), label)
  const rejected = outcomes.find(result => result.status === 'rejected')
  if (rejected?.status === 'rejected') throw rejected.reason
}
