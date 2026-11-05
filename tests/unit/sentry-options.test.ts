import { describe, it, expect } from 'vitest'
import { sentryOptions } from '@/lib/sentry-options'

describe('sentryOptions configuration', () => {
  it('sendDefaultPii is false', () => {
    expect(sentryOptions.sendDefaultPii).toBe(false)
  })

  it('tracesSampleRate is 0', () => {
    expect(sentryOptions.tracesSampleRate).toBe(0)
  })

  it('tracesSampler always returns 0 regardless of parentSampled', () => {
    expect(sentryOptions.tracesSampler()).toBe(0)
  })

  it('beforeSendTransaction always returns null', () => {
    expect(sentryOptions.beforeSendTransaction()).toBeNull()
  })

  describe('dataCollection', () => {
    it('userInfo is false', () => {
      expect(sentryOptions.dataCollection.userInfo).toBe(false)
    })

    it('cookies is false', () => {
      expect(sentryOptions.dataCollection.cookies).toBe(false)
    })

    it('httpBodies is empty array', () => {
      expect(sentryOptions.dataCollection.httpBodies).toEqual([])
    })

    it('urlQueryParams is false', () => {
      expect(sentryOptions.dataCollection.urlQueryParams).toBe(false)
    })

    it('stackFrameVariables is false', () => {
      expect(sentryOptions.dataCollection.stackFrameVariables).toBe(false)
    })

    it('databaseQueryData is false', () => {
      expect(sentryOptions.dataCollection.databaseQueryData).toBe(false)
    })

    it('queues is false', () => {
      expect(sentryOptions.dataCollection.queues).toBe(false)
    })

    it('graphQL variables and document are false', () => {
      expect(sentryOptions.dataCollection.graphQL.document).toBe(false)
      expect(sentryOptions.dataCollection.graphQL.variables).toBe(false)
    })

    it('genAI inputs and outputs are false', () => {
      expect(sentryOptions.dataCollection.genAI.inputs).toBe(false)
      expect(sentryOptions.dataCollection.genAI.outputs).toBe(false)
    })

    it('mcp inputs and outputs are false', () => {
      expect(sentryOptions.dataCollection.mcp.inputs).toBe(false)
      expect(sentryOptions.dataCollection.mcp.outputs).toBe(false)
    })

    it('httpHeaders only allows User-Agent for requests, nothing for responses', () => {
      const { httpHeaders } = sentryOptions.dataCollection
      expect((httpHeaders.request as { allow: string[] }).allow).toEqual(['User-Agent'])
      expect(httpHeaders.response).toBe(false)
    })
  })
})
