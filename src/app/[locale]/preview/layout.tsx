import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { shouldHideInternalPrototypeRoutes } from '@/lib/internal-route-policy'

type PreviewLayoutProps = {
  children: ReactNode
}

export default function PreviewLayout({ children }: PreviewLayoutProps): ReactNode {
  if (shouldHideInternalPrototypeRoutes()) {
    notFound()
  }

  return children
}
