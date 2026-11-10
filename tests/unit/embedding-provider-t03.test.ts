import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/env', () => ({ env: { VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model' } }))
vi.mock('@/server/services/settings', () => ({
  getSetting: vi.fn(async (key: string, fallback: unknown) => key === 'ai.matching' ? {
    enabled: true, legalVersion: '2026-11-draft',
    epoch: 'b0dd49f6-6ec8-44b8-b146-2c263afefce1', configurationId: 'matching-public-v1',
  } : key === 'legal.currentVersion' ? '2026-11-draft' : fallback),
}))
import { embedMatchingText } from '@/server/lib/ai/embedding-provider'

const fetchMock = vi.fn<typeof fetch>()
const input = { text: 'Synthetic public career text', inputType: 'query' as const, model: 'synthetic-embedding-model', configurationId: 'matching-public-v1' }
const vector = [1, ...Array<number>(1023).fill(0)]
const valid = () => ({ object: 'list', model: input.model, data: [{ object: 'embedding', index: 0, embedding: vector }], usage: { total_tokens: 5 } })
const options = () => ({ signal: new AbortController().signal })
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals() })

describe('M9-T03 Voyage boundary with offline fetch', () => {
  it('uses fixed endpoint and distinct query/document input_type without truncation', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(valid()), { headers: { 'content-type': 'application/json' } }))
    const result = await embedMatchingText(input, options())
    expect(result).toEqual({ ok: true, vector, model: input.model })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://api.voyageai.com/v1/embeddings')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      input: [input.text], model: input.model, input_type: 'query', output_dimension: 1024, output_dtype: 'float', truncation: false,
    })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(valid()), { headers: { 'content-type': 'application/json' } }))
    await embedMatchingText({ ...input, inputType: 'document' }, options())
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).input_type).toBe('document')
  })

  it.each(['dimension', 'index', 'model', 'missing', 'zero-vector'] as const)('rejects invalid %s in the actual adapter', async fault => {
    const body = valid()
    if (fault === 'dimension') body.data[0].embedding = [1]
    if (fault === 'index') body.data[0].index = 1
    if (fault === 'model') body.model = 'other-model'
    if (fault === 'missing') body.data = []
    if (fault === 'zero-vector') body.data[0].embedding = Array<number>(1024).fill(0)
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }))
    await expect(embedMatchingText(input, options())).resolves.toEqual({ ok: false, reason: 'invalid' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([429, 503])('does not multiply queue retries on HTTP %s or return private body', async status => {
    fetchMock.mockResolvedValue(new Response('PRIVATE_PROVIDER_ERROR', { status }))
    await expect(embedMatchingText(input, options())).resolves.toEqual({ ok: false, reason: 'unavailable' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
