'use client'

import {
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { AppIcon } from '@/components/ui/icons'

export interface EntityListRenderContext<T> {
  item: T
  selected: boolean
  query: string
}

export interface EntityListPanelProps<T> {
  title: string
  description?: string
  items: readonly T[]
  getItemId: (item: T) => string
  getSearchText: (item: T) => string
  renderItem: (context: EntityListRenderContext<T>) => ReactNode
  selectedId?: string | null
  onSelect?: (item: T) => void
  searchLabel?: string
  searchPlaceholder?: string
  searchValue?: string
  defaultSearchValue?: string
  onSearchValueChange?: (value: string) => void
  statusText?: string
  actions?: ReactNode
  loading?: boolean
  loadingSlot?: ReactNode
  emptySlot?: ReactNode
  filterEmptySlot?: ReactNode
  className?: string
}

function DefaultLoadingState() {
  return (
    <div className="space-y-2 p-3" role="status" aria-label="正在載入清單">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          aria-hidden="true"
          className="h-14 animate-pulse rounded-[10px] bg-[var(--production-muted)] motion-reduce:animate-none"
        />
      ))}
      <span className="sr-only">正在載入清單</span>
    </div>
  )
}

function DefaultEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div
      className="flex min-h-40 flex-col items-center justify-center gap-2 px-5 py-8 text-center"
      role="status"
    >
      <span
        className="grid h-10 w-10 place-items-center rounded-full bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]"
        aria-hidden="true"
      >
        <AppIcon name={filtered ? 'search' : 'folderOpen'} className="h-5 w-5" />
      </span>
      <p className="text-[14px] font-semibold text-[var(--production-ink)]">
        {filtered ? '沒有符合條件的項目' : '目前還沒有項目'}
      </p>
      <p className="max-w-64 text-[13px] leading-5 text-[var(--production-ink-muted)]">
        {filtered ? '調整關鍵字，或清除搜尋後查看完整清單。' : '建立第一個項目後，會顯示在這裡。'}
      </p>
    </div>
  )
}

export function EntityListPanel<T>({
  title,
  description,
  items,
  getItemId,
  getSearchText,
  renderItem,
  selectedId,
  onSelect,
  searchLabel = '搜尋清單',
  searchPlaceholder = '搜尋名稱或關鍵字',
  searchValue,
  defaultSearchValue = '',
  onSearchValueChange,
  statusText,
  actions,
  loading = false,
  loadingSlot,
  emptySlot,
  filterEmptySlot,
  className,
}: EntityListPanelProps<T>) {
  const [internalSearchValue, setInternalSearchValue] = useState(defaultSearchValue)
  const query = searchValue ?? internalSearchValue
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const visibleItems = useMemo(() => {
    if (!normalizedQuery) return items
    return items.filter((item) =>
      getSearchText(item).toLocaleLowerCase().includes(normalizedQuery),
    )
  }, [getSearchText, items, normalizedQuery])

  const updateSearchValue = (value: string) => {
    if (searchValue === undefined) setInternalSearchValue(value)
    onSearchValueChange?.(value)
  }

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: T) => {
    if (!onSelect || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onSelect(item)
  }

  const panelClassName = [
    'overflow-hidden rounded-[14px] border border-[var(--production-border)]',
    'bg-[var(--production-surface)] text-[var(--production-ink)]',
    className ?? '',
  ].filter(Boolean).join(' ')

  return (
    <section className={panelClassName} aria-label={title}>
      <header className="border-b border-[var(--production-border)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-6">{title}</h2>
            {description ? (
              <p className="mt-1 text-[13px] leading-5 text-[var(--production-ink-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex min-h-11 shrink-0 items-center gap-2 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_button]:min-h-11">
              {actions}
            </div>
          ) : null}
        </div>

        <label className="relative mt-4 block">
          <span className="sr-only">{searchLabel}</span>
          <AppIcon
            name="search"
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--production-ink-muted)]"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => updateSearchValue(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-11 w-full rounded-[10px] border border-[var(--production-border)] bg-[var(--production-paper)] pl-10 pr-3 text-[14px] text-[var(--production-ink)] outline-none placeholder:text-[var(--production-ink-muted)] hover:border-[var(--production-border-dark)] focus-visible:border-[var(--production-focus)] focus-visible:ring-2 focus-visible:ring-[color:var(--production-focus)]/25"
          />
        </label>

        {statusText ? (
          <p className="mt-3 flex items-center gap-2 text-[13px] leading-5 text-[var(--production-ink-muted)]" aria-live="polite">
            <AppIcon name="info" aria-hidden="true" className="h-4 w-4 shrink-0" />
            {statusText}
          </p>
        ) : null}
      </header>

      {loading ? (
        loadingSlot ?? <DefaultLoadingState />
      ) : visibleItems.length === 0 ? (
        normalizedQuery
          ? filterEmptySlot ?? <DefaultEmptyState filtered />
          : emptySlot ?? <DefaultEmptyState filtered={false} />
      ) : (
        <ul className="divide-y divide-[var(--production-border)]" role="listbox" aria-label={`${title}項目`}>
          {visibleItems.map((item) => {
            const id = getItemId(item)
            const selected = selectedId === id
            return (
              <li key={id}>
                <div
                  role="option"
                  aria-selected={selected}
                  tabIndex={onSelect ? 0 : undefined}
                  onClick={onSelect ? () => onSelect(item) : undefined}
                  onKeyDown={(event) => handleOptionKeyDown(event, item)}
                  className={[
                    'relative min-h-14 px-4 py-3 outline-none sm:px-5',
                    'motion-safe:transition-colors motion-safe:duration-200',
                    onSelect ? 'cursor-pointer hover:bg-[var(--production-blue-soft)]' : '',
                    'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--production-focus)]',
                    selected
                      ? 'bg-[var(--production-blue-soft)] pl-5 before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-full before:bg-[var(--production-blue)] sm:pl-6'
                      : '',
                  ].filter(Boolean).join(' ')}
                >
                  {renderItem({ item, selected, query })}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
