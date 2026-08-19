import type { ReactNode } from 'react'
import styles from './MediaWorkspaceSurface.module.css'

interface MediaWorkspaceSurfaceProps {
  children: ReactNode
  className?: string
}

export const mediaWorkspaceClasses = {
  chrome: styles.chrome,
  deliverAction: styles.deliverAction,
  deliverCue: styles.deliverCue,
  deliveryPanel: styles.deliveryPanel,
  editorFrame: styles.editorFrame,
  mediaWell: styles.mediaWell,
  mobileDock: styles.mobileDock,
  stage: styles.stage,
} as const

export function MediaWorkspaceSurface({
  children,
  className,
}: MediaWorkspaceSurfaceProps) {
  return (
    <div
      className={`${styles.root}${className ? ` ${className}` : ''}`}
      data-media-workspace="darkroom"
    >
      {children}
    </div>
  )
}
