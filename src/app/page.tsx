import { redirect } from 'next/navigation'

// Middleware redirects '/' to '/zh', but just in case:
export default function RootPage() {
  redirect('/zh')
}
