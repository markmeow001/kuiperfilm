import type { ReactNode } from 'react'
import Link from 'next/link'
import { AppIcon } from '@/components/ui/icons'
import { ProductionBrand } from './ProductionBrand'
import styles from './CreativeToolShell.module.css'

export interface CreativeToolShellProps {
  locale: string
  title: ReactNode
  eyebrow: ReactNode
  description?: ReactNode
  backHref: string
  backLabel: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Shared full-screen frame for project-adjacent creative tools.
 * It owns visual chrome only: feature state, requests and keyboard behaviour
 * stay with the tool rendered inside the workspace slot.
 */
export function CreativeToolShell({
  locale,
  title,
  eyebrow,
  description,
  backHref,
  backLabel,
  actions,
  children,
  className = '',
}: CreativeToolShellProps) {
  return (
    <div
      className={`${styles.root} kuiper-workspace ${className}`.trim()}
      data-creative-tool-shell="studio"
      data-studio-theme="dark"
    >
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <ProductionBrand
            locale={locale}
            href={`/${locale}/v2`}
            tone="dark"
            className={styles.brand}
          />
          <div className={styles.context}>
            <Link href={backHref} aria-label={backLabel} className={styles.backLink}>
              <AppIcon name="chevronLeft" aria-hidden="true" className="h-[18px] w-[18px]" />
              <span>{backLabel}</span>
            </Link>
            <div className={styles.identity}>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1 className={styles.title}>{title}</h1>
              {description ? (
                <p className={styles.description} data-creative-tool-description>
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          {actions ? (
            <div className={styles.actions} data-creative-tool-actions>
              {actions}
            </div>
          ) : null}
        </div>
      </header>
      <main className={styles.main} data-creative-tool-content>
        {children}
      </main>
    </div>
  )
}
