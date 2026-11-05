// Better Auth handler — the only route.ts that is NOT wrapped in route()
// per ARCHITECTURE §5.1 and CLAUDE.md "安全"
import { auth } from '@/server/auth'
import type { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  return auth.handler(req)
}

export async function POST(req: NextRequest) {
  return auth.handler(req)
}
