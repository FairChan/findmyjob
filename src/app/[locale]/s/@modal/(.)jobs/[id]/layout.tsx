import type { ReactNode } from 'react'
import { JobRouteModal } from '@/components/jobs/job-route-modal'

export default async function JobModalLayout({ children, params }: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <JobRouteModal jobId={id}>{children}</JobRouteModal>
}
