import { notFound } from 'next/navigation'

// Addresses that match no route would otherwise get the framework's bare 404.
// Raising notFound here hands them to the localized not-found page instead.
export default function UnmatchedPage() {
  notFound()
}
