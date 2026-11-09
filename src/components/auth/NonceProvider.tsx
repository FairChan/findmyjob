'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

const NonceContext = createContext<string | undefined>(undefined)

export function NonceProvider({ nonce, children }: { nonce: string | undefined; children: ReactNode }) {
  // Client navigation may fetch a new RSC nonce, but the browser keeps the CSP
  // of the original document until the next full navigation.
  const [documentNonce] = useState(nonce)
  return <NonceContext.Provider value={documentNonce}>{children}</NonceContext.Provider>
}

export function useNonce() {
  return useContext(NonceContext)
}
