import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { shouldHideInternalPrototypeRoutes } from '@/lib/internal-route-policy'

type V5LayoutProps = {
  children: ReactNode
}

export default function V5Layout({ children }: V5LayoutProps): ReactNode {
  if (shouldHideInternalPrototypeRoutes()) {
    notFound()
  }

  return children
}
