import 'server-only'

// Only reads x-real-ip, which is written by Caddy. Never trust x-forwarded-for
// since it can be spoofed by clients.
export function getClientIp(headers: Headers | { get(name: string): string | null }): string | null {
  return headers.get('x-real-ip')
}
