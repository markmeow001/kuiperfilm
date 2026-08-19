import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { shouldHideInternalPrototypeRoutes } from '@/lib/internal-route-policy'

type DevLayoutProps = {
  children: ReactNode
}

export default function DevLayout({ children }: DevLayoutProps): ReactNode {
  if (shouldHideInternalPrototypeRoutes()) {
    notFound()
  }

  return children
}
