import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockCaptureException = vi.fn()

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: mockCaptureException,
}))

vi.mock('@/server/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}))

vi.mock('@/server/lib/healthchecks', () => ({
  pingHealthcheck: vi.fn(),
}))

const mockExecuteRaw = vi.fn()

vi.mock('@/server/db', () => ({
  db: {
    $executeRaw: mockExecuteRaw,
  },
}))

const { registerJobs } = await import('@/server/jobs/registry')

describe('registerJobs error capture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports prune-rate-limit handler errors to Sentry and re-throws', async () => {
    const workHandlers: Record<string, (jobs: unknown[]) => Promise<void>> = {}

    const mockBoss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue(undefined),
      work: vi.fn().mockImplementation(async (queue: string, handler: (jobs: unknown[]) => Promise<void>) => {
        workHandlers[queue] = handler
      }),
    }

    await registerJobs(mockBoss as never)

    const dbError = new Error('DB connection lost')
    mockExecuteRaw.mockRejectedValueOnce(dbError)

    await expect(workHandlers['prune-rate-limit']!([])).rejects.toThrow('DB connection lost')
    expect(mockCaptureException).toHaveBeenCalledWith(dbError)
  })

  it('reports example job handler errors to Sentry and re-throws', async () => {
    const workHandlers: Record<string, (jobs: unknown[]) => Promise<void>> = {}

    const mockBoss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue(undefined),
      work: vi.fn().mockImplementation(async (queue: string, handler: (jobs: unknown[]) => Promise<void>) => {
        workHandlers[queue] = handler
      }),
    }

    await registerJobs(mockBoss as never)

    // Inject a job that causes internal error (pingHealthcheck throws)
    const { pingHealthcheck } = await import('@/server/lib/healthchecks')
    const hcError = new Error('healthcheck ping failed')
    vi.mocked(pingHealthcheck).mockImplementationOnce(() => { throw hcError })

    await expect(workHandlers['example']!([{ id: 'j1', name: 'example' }])).rejects.toThrow('healthcheck ping failed')
    expect(mockCaptureException).toHaveBeenCalledWith(hcError)
  })
})
