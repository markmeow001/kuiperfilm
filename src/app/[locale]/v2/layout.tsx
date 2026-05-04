/**
 * V2 layout — mounts the mobile-revert banner so phone users with a
 * lingering desktop_override cookie get a one-tap escape back to the
 * /m/* mobile UI. Otherwise it's a passthrough; the children render
 * inside the existing V2 chrome (TopBar / Sidebar / etc).
 */
import type { ReactNode } from 'react'
import { MobileRevertBanner } from './MobileRevertBanner'

export default function V2Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <MobileRevertBanner />
      {children}
    </>
  )
}
