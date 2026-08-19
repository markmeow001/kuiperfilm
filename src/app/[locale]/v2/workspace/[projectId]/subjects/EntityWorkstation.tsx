'use client'

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { AppIcon } from '@/components/ui/icons'
import { EntityListPanel } from '@/components/v2/EntityListPanel'
import { PageHeader } from '@/components/v2/PageHeader'
import { StatusPill } from '@/components/v2/StatusPill'
import { UiStatePanel } from '@/components/v2/UiStatePanel'
import styles from '../PlanningWorkspace.module.css'

export interface EntityWorkstationItem {
  id: string
  name: string
  caption: string
  description: string | null
  imageUrl: string | null
  isRegenerating?: boolean
  isLocked?: boolean
}

export interface EntityWorkstationTab<TabId extends string> {
  id: TabId
  label: string
  count: number
}

export interface EntityWorkstationCopy {
  listTitle: string
  searchLabel: string
  searchPlaceholder: string
  countLabel: string
  backToList: string
  detailRegionLabel: string
  ready: string
  needsImage: string
  generating: string
  approved: string
  readOnly: string
  loadingTitle: string
  loadingDescription: string
  emptyTitle: string
  emptyDescription: string
  errorTitle: string
  errorDescription: string
  staleTitle: string
  staleDescription: string
  permissionTitle: string
  permissionDescription: string
  partialTitle: string
  partialDescription: string
}

interface EntityWorkstationProps<
  TabId extends string,
  Item extends EntityWorkstationItem,
> {
  locale?: string
  eyebrow: ReactNode
  title: ReactNode
  description?: ReactNode
  context?: ReactNode
  headerActions?: ReactNode
  tabs: readonly EntityWorkstationTab<TabId>[]
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  items: readonly Item[]
  renderDetail: (item: Item) => ReactNode
  copy: EntityWorkstationCopy
  scopeStatus?: string
  toolbarActions?: ReactNode
  notice?: ReactNode
  footer?: ReactNode
  emptyAction?: ReactNode
  retryAction?: ReactNode
  loading?: boolean
  error?: boolean
  stale?: boolean
  accessLoading?: boolean
  accessDenied?: boolean
  readOnly?: boolean
  missingImageCount?: number
}

function EntityThumbnail({ item }: { item: EntityWorkstationItem }) {
  return (
    <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[10px] border border-[var(--production-border)] bg-[var(--production-muted)]">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          className="grid h-full w-full place-items-center text-[var(--production-ink-muted)]"
          aria-hidden="true"
        >
          <AppIcon name="image" className="h-5 w-5" />
        </span>
      )}
    </span>
  )
}

function EntityItemStatus({
  item,
  copy,
}: {
  item: EntityWorkstationItem
  copy: EntityWorkstationCopy
}) {
  if (item.isRegenerating)
    return <StatusPill label={copy.generating} tone="active" />
  if (item.isLocked) return <StatusPill label={copy.approved} tone="approval" />
  if (item.imageUrl) return <StatusPill label={copy.ready} tone="info" />
  return <StatusPill label={copy.needsImage} tone="warning" />
}

export function EntityWorkstation<
  TabId extends string,
  Item extends EntityWorkstationItem,
>({
  locale = 'zh',
  eyebrow,
  title,
  description,
  context,
  headerActions,
  tabs,
  activeTab,
  onTabChange,
  items,
  renderDetail,
  copy,
  scopeStatus,
  toolbarActions,
  notice,
  footer,
  emptyAction,
  retryAction,
  loading = false,
  error = false,
  stale = false,
  accessLoading = false,
  accessDenied = false,
  readOnly = false,
  missingImageCount = 0,
}: EntityWorkstationProps<TabId, Item>) {
  const [selectionByTab, setSelectionByTab] = useState<
    Record<string, string | null>
  >({})
  const [mobilePane, setMobilePane] = useState<'list' | 'detail'>('list')
  const selectedId = selectionByTab[activeTab] ?? items[0]?.id ?? null
  const selectedItem =
    items.find((item) => item.id === selectedId) ?? items[0] ?? null
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const workstationId = useId()
  const tabDomId = (tabId: TabId) => `${workstationId}-tab-${tabId}`
  const panelDomId = (tabId: TabId) => `${workstationId}-panel-${tabId}`

  const selectItem = (item: Item) => {
    setSelectionByTab((current) => ({ ...current, [activeTab]: item.id }))
    setMobilePane('detail')
  }

  const changeTab = (nextTab: TabId) => {
    setMobilePane('list')
    onTabChange(nextTab)
  }

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let targetIndex: number | null = null
    if (event.key === 'ArrowRight')
      targetIndex = (currentIndex + 1) % tabs.length
    if (event.key === 'ArrowLeft')
      targetIndex = (currentIndex - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') targetIndex = 0
    if (event.key === 'End') targetIndex = tabs.length - 1
    if (targetIndex === null) return

    event.preventDefault()
    const targetTab = tabs[targetIndex]
    if (!targetTab) return
    tabRefs.current[targetTab.id]?.focus()
    changeTab(targetTab.id)
  }

  const isInitialLoading = loading || accessLoading
  const blockingState = accessDenied
    ? 'permission'
    : error && !stale
      ? 'error'
      : null

  return (
    <div className={`${styles.studioRoot} px-3 py-5 sm:px-5 sm:py-7 xl:px-8`}>
      <div className={`mx-auto w-full max-w-[1600px] ${styles.boundPage}`}>
        <PageHeader
          eyebrow={eyebrow}
          title={title}
          description={description}
          context={context}
          actions={headerActions}
        />

        <div className="mt-6 flex flex-col gap-3 border-y border-[var(--production-border)] py-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            className="flex max-w-full gap-1 overflow-x-auto rounded-[12px] border border-[var(--production-border)] bg-[var(--production-surface)] p-1"
            role="tablist"
            aria-label={typeof eyebrow === 'string' ? eyebrow : copy.listTitle}
            aria-orientation="horizontal"
          >
            {tabs.map((tab, index) => (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[tab.id] = node
                }}
                id={tabDomId(tab.id)}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={panelDomId(tab.id)}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => changeTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={[
                  'flex min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-[9px] px-4 text-[14px] font-semibold outline-none',
                  'motion-safe:transition-colors motion-safe:duration-200 focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]',
                  activeTab === tab.id
                    ? 'bg-[var(--production-tool-soft)] text-[var(--production-tool)]'
                    : 'text-[var(--production-ink-muted)] hover:bg-[var(--production-muted)] hover:text-[var(--production-ink)]',
                ].join(' ')}
              >
                {tab.label}
                <span className="font-mono text-[12px] opacity-70">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
          {toolbarActions ? (
            <div className="flex flex-wrap items-center gap-2 [&_a]:min-h-11 [&_button]:min-h-11">
              {toolbarActions}
            </div>
          ) : null}
        </div>

        {tabs
          .filter((tab) => tab.id !== activeTab)
          .map((tab) => (
            <div
              key={tab.id}
              id={panelDomId(tab.id)}
              role="tabpanel"
              aria-labelledby={tabDomId(tab.id)}
              hidden
            />
          ))}

        <div
          id={panelDomId(activeTab)}
          role="tabpanel"
          aria-labelledby={tabDomId(activeTab)}
          tabIndex={0}
          className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
        >
          {notice ? <div className="mt-5 space-y-3">{notice}</div> : null}

          {readOnly && !accessDenied ? (
            <UiStatePanel
              state="permission"
              locale={locale}
              compact
              className="mt-5"
              title={copy.permissionTitle}
              description={copy.permissionDescription}
            />
          ) : null}

          {stale ? (
            <UiStatePanel
              state="stale"
              locale={locale}
              compact
              className="mt-5"
              title={copy.staleTitle}
              description={copy.staleDescription}
              primaryAction={retryAction}
            />
          ) : null}

          {!isInitialLoading && !blockingState && missingImageCount > 0 ? (
            <UiStatePanel
              state="partial"
              locale={locale}
              compact
              className="mt-5"
              title={copy.partialTitle}
              description={copy.partialDescription}
            />
          ) : null}

          {isInitialLoading ? (
            <UiStatePanel
              state="loading"
              locale={locale}
              className="mt-6"
              title={copy.loadingTitle}
              description={copy.loadingDescription}
            />
          ) : blockingState === 'permission' ? (
            <UiStatePanel
              state="permission"
              locale={locale}
              className="mt-6"
              title={copy.permissionTitle}
              description={copy.permissionDescription}
              primaryAction={retryAction}
            />
          ) : blockingState === 'error' ? (
            <UiStatePanel
              state="error"
              locale={locale}
              className="mt-6"
              title={copy.errorTitle}
              description={copy.errorDescription}
              primaryAction={retryAction}
            />
          ) : (
            <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]">
              <div
                className={
                  mobilePane === 'detail' ? 'hidden lg:block' : 'block'
                }
              >
                <EntityListPanel
                  className={styles.studioPanel}
                  title={copy.listTitle}
                  items={items}
                  getItemId={(item) => item.id}
                  getSearchText={(item) =>
                    `${item.name} ${item.caption} ${item.description ?? ''}`
                  }
                  renderItem={({ item }) => (
                    <div className="flex items-center gap-3">
                      <EntityThumbnail item={item} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-[var(--production-ink)]">
                          {item.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-[var(--production-ink-muted)]">
                          {item.caption}
                        </span>
                      </span>
                      <EntityItemStatus item={item} copy={copy} />
                    </div>
                  )}
                  selectedId={selectedItem?.id ?? null}
                  onSelect={selectItem}
                  searchLabel={copy.searchLabel}
                  searchPlaceholder={copy.searchPlaceholder}
                  statusText={
                    scopeStatus
                      ? `${copy.countLabel} · ${scopeStatus}`
                      : copy.countLabel
                  }
                  emptySlot={
                    <UiStatePanel
                      state="empty"
                      locale={locale}
                      compact
                      title={copy.emptyTitle}
                      description={copy.emptyDescription}
                      primaryAction={emptyAction}
                      className="m-3"
                    />
                  }
                />
              </div>

              <section
                aria-label={copy.detailRegionLabel}
                className={[
                  `min-w-0 rounded-[14px] border border-[var(--production-border)] bg-[var(--production-surface)] p-4 sm:p-5 ${styles.studioPanel}`,
                  mobilePane === 'list' ? 'hidden lg:block' : 'block',
                ].join(' ')}
              >
                <button
                  type="button"
                  onClick={() => setMobilePane('list')}
                  className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-[var(--production-border)] bg-[var(--production-surface)] px-3 text-[14px] font-semibold text-[var(--production-ink)] outline-none hover:bg-[var(--production-muted)] focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] lg:hidden"
                >
                  <AppIcon name="arrowLeft" className="h-4 w-4" />
                  {copy.backToList}
                </button>

                {selectedItem ? (
                  <>
                    <div className="mb-5 flex flex-col gap-3 border-b border-[var(--production-border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--production-tool)]">
                          {selectedItem.caption}
                        </p>
                        <h2 className="mt-1 break-words text-[22px] font-semibold leading-8 text-[var(--production-ink)]">
                          {selectedItem.name}
                        </h2>
                        {selectedItem.description ? (
                          <p className="mt-1 line-clamp-2 text-[14px] leading-6 text-[var(--production-ink-muted)]">
                            {selectedItem.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {readOnly ? (
                          <StatusPill label={copy.readOnly} tone="neutral" />
                        ) : null}
                        <EntityItemStatus item={selectedItem} copy={copy} />
                      </div>
                    </div>
                    {renderDetail(selectedItem)}
                  </>
                ) : (
                  <UiStatePanel
                    state="empty"
                    locale={locale}
                    title={copy.emptyTitle}
                    description={copy.emptyDescription}
                    primaryAction={emptyAction}
                  />
                )}
              </section>
            </div>
          )}

          {footer ? <div className="mt-6">{footer}</div> : null}
        </div>
      </div>
    </div>
  )
}
