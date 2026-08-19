'use client'

import type { ReactNode } from 'react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'

export type UiStateKind =
  | 'loading'
  | 'empty'
  | 'partial'
  | 'offline'
  | 'stale'
  | 'permission'
  | 'low-credits'
  | 'error'
  | 'conflict'

interface UiStatePreset {
  label: string
  title: string
  description: string
  icon: AppIconName
  toneClassName: string
}

const STATE_PRESETS: Record<UiStateKind, UiStatePreset> = {
  loading: {
    label: '處理中',
    title: '正在整理製作資料',
    description: '請保留這個頁面開啟；完成後內容會自動更新。',
    icon: 'loader',
    toneClassName:
      'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]',
  },
  empty: {
    label: '尚無內容',
    title: '從第一個製作項目開始',
    description: '目前沒有可顯示的內容，建立後會集中顯示在這裡。',
    icon: 'folderOpen',
    toneClassName:
      'bg-[var(--production-muted)] text-[var(--production-ink-muted)]',
  },
  partial: {
    label: '部分完成',
    title: '部分資料尚未準備完成',
    description: '已完成的內容仍可使用；請補齊標示的項目再進入下一步。',
    icon: 'info',
    toneClassName:
      'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]',
  },
  offline: {
    label: '離線',
    title: '目前無法連線',
    description: '你的變更仍保留在畫面上。恢復連線後再重新送出。',
    icon: 'unplug',
    toneClassName: 'bg-[var(--production-muted)] text-[var(--production-ink)]',
  },
  stale: {
    label: '資料已更新',
    title: '上游內容已有新版本',
    description: '目前畫面不是最新結果；請重新整理後再繼續製作。',
    icon: 'refresh',
    toneClassName: 'bg-amber-400/10 text-amber-200',
  },
  permission: {
    label: '權限不足',
    title: '你沒有這項操作的權限',
    description: '內容沒有被修改。請向專案擁有者申請編輯權限。',
    icon: 'lock',
    toneClassName: 'bg-[var(--production-muted)] text-[var(--production-ink)]',
  },
  'low-credits': {
    label: '點數不足',
    title: '目前點數不足以送出生成',
    description: '這筆任務尚未建立，也不會扣款。補充點數後即可繼續。',
    icon: 'coins',
    toneClassName: 'bg-amber-400/10 text-amber-200',
  },
  error: {
    label: '發生錯誤',
    title: '這次操作沒有完成',
    description: '既有資料仍然保留。請查看錯誤內容後再試一次。',
    icon: 'alert',
    toneClassName:
      'bg-[var(--production-muted)] text-[var(--production-danger)]',
  },
  conflict: {
    label: '版本衝突',
    title: '其他人已更新這份內容',
    description: '你的變更尚未覆蓋他人資料。請比較版本後決定如何處理。',
    icon: 'copy',
    toneClassName:
      'bg-[var(--production-muted)] text-[var(--production-danger)]',
  },
}

const EN_STATE_PRESETS: Record<UiStateKind, UiStatePreset> = {
  loading: {
    ...STATE_PRESETS.loading,
    label: 'Processing',
    title: 'Preparing production data',
    description: 'Keep this page open. The content will update automatically.',
  },
  empty: {
    ...STATE_PRESETS.empty,
    label: 'No content',
    title: 'Start with the first production item',
    description: 'There is nothing to show yet. New items will appear here.',
  },
  partial: {
    ...STATE_PRESETS.partial,
    label: 'Partially ready',
    title: 'Some data is not ready yet',
    description:
      'Available content is still safe to use. Complete the marked items before continuing.',
  },
  offline: {
    ...STATE_PRESETS.offline,
    label: 'Offline',
    title: 'Unable to connect',
    description:
      'Your changes remain on screen. Submit again after the connection returns.',
  },
  stale: {
    ...STATE_PRESETS.stale,
    label: 'Update available',
    title: 'An upstream item has a newer version',
    description:
      'This view is no longer current. Refresh it before continuing.',
  },
  permission: {
    ...STATE_PRESETS.permission,
    label: 'Permission required',
    title: 'You cannot perform this action',
    description: 'Nothing was changed. Ask the project owner for edit access.',
  },
  'low-credits': {
    ...STATE_PRESETS['low-credits'],
    label: 'Insufficient credits',
    title: 'There are not enough credits to generate',
    description:
      'No job was created and no charge was made. Add credits to continue.',
  },
  error: {
    ...STATE_PRESETS.error,
    label: 'Error',
    title: 'The operation did not complete',
    description: 'Existing data is still safe. Review the error and try again.',
  },
  conflict: {
    ...STATE_PRESETS.conflict,
    label: 'Version conflict',
    title: 'Someone else updated this content',
    description:
      'Your changes have not overwritten theirs. Compare both versions before continuing.',
  },
}

export interface UiStatePanelProps {
  state: UiStateKind
  locale?: string
  label?: string
  title?: string
  description?: string
  primaryAction?: ReactNode
  secondaryAction?: ReactNode
  details?: ReactNode
  compact?: boolean
  className?: string
}

const ALERT_STATES = new Set<UiStateKind>([
  'offline',
  'permission',
  'low-credits',
  'error',
  'conflict',
])

export function UiStatePanel({
  state,
  locale = 'zh',
  label,
  title,
  description,
  primaryAction,
  secondaryAction,
  details,
  compact = false,
  className,
}: UiStatePanelProps) {
  const preset = (
    locale.toLowerCase().startsWith('en') ? EN_STATE_PRESETS : STATE_PRESETS
  )[state]
  const isLoading = state === 'loading'
  const panelClassName = [
    'rounded-[14px] border border-[var(--production-border)] bg-[var(--production-surface)]',
    compact ? 'p-4' : 'px-5 py-6 sm:p-8',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section
      className={panelClassName}
      data-state={state}
      role={ALERT_STATES.has(state) ? 'alert' : 'status'}
      aria-live={ALERT_STATES.has(state) ? 'assertive' : 'polite'}
      aria-busy={isLoading || undefined}
    >
      <div
        className={
          compact ? 'flex items-start gap-3' : 'mx-auto max-w-xl text-center'
        }
      >
        <span
          className={[
            'grid shrink-0 place-items-center rounded-full',
            compact ? 'h-10 w-10' : 'mx-auto h-12 w-12',
            preset.toneClassName,
          ].join(' ')}
          aria-hidden="true"
        >
          <AppIcon
            name={preset.icon}
            className={[
              compact ? 'h-5 w-5' : 'h-6 w-6',
              isLoading ? 'animate-spin motion-reduce:animate-none' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        </span>

        <div className={compact ? 'min-w-0 flex-1' : ''}>
          <p
            className={`${compact ? '' : 'mt-3'} text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--production-ink-muted)]`}
          >
            {label ?? preset.label}
          </p>
          <h2
            className={`${compact ? 'mt-1 text-[16px]' : 'mt-1 text-[20px]'} font-semibold leading-7 text-[var(--production-ink)]`}
          >
            {title ?? preset.title}
          </h2>
          <p
            className={`${compact ? 'mt-1' : 'mt-2'} text-[14px] leading-6 text-[var(--production-ink-muted)]`}
          >
            {description ?? preset.description}
          </p>

          {details ? (
            <div
              className={`${compact ? 'mt-3' : 'mt-4'} rounded-[10px] bg-[var(--production-paper)] p-3 text-left text-[13px] leading-5 text-[var(--production-ink-muted)]`}
            >
              {details}
            </div>
          ) : null}

          {primaryAction || secondaryAction ? (
            <div
              className={[
                'mt-5 flex flex-wrap items-center gap-2',
                compact ? '' : 'justify-center',
                '[&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_button]:min-h-11',
              ].join(' ')}
            >
              {primaryAction}
              {secondaryAction}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
