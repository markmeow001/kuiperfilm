'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'

import { UiStatePanel, type UiStateKind } from '@/components/v2/UiStatePanel'
import { ProductionBrand } from '@/components/v2/ProductionBrand'

type SystemState = 'loading' | 'error' | 'not-found' | 'forbidden'

type StateCopy = {
  label: string
  title: string
  description: string
  retry: string
  projects: string
  home: string
}

const COPY: Record<'zh' | 'en', Record<SystemState, StateCopy>> = {
  zh: {
    loading: {
      label: '載入中',
      title: '正在準備工作區',
      description: '正在讀取已保存的專案與製作資料，完成後會自動顯示。',
      retry: '重新載入',
      projects: '回到專案總覽',
      home: '首頁',
    },
    error: {
      label: '系統狀態',
      title: '這個頁面暫時無法顯示',
      description: '既有專案與素材沒有被修改。你可以重新載入，或先回到專案總覽。',
      retry: '重新載入',
      projects: '回到專案總覽',
      home: '首頁',
    },
    'not-found': {
      label: '找不到內容',
      title: '找不到這個頁面',
      description: '連結可能已變更，或內容已被移除。請從專案總覽重新進入。',
      retry: '重新載入',
      projects: '回到專案總覽',
      home: '首頁',
    },
    forbidden: {
      label: '權限不足',
      title: '無法開啟這個頁面',
      description: '你目前沒有檢視權限。請回到可存取的專案，或向專案擁有者申請權限。',
      retry: '重新載入',
      projects: '回到專案總覽',
      home: '首頁',
    },
  },
  en: {
    loading: {
      label: 'Loading',
      title: 'Preparing your workspace',
      description: 'Loading saved projects and production data. This view will update automatically.',
      retry: 'Reload',
      projects: 'Back to projects',
      home: 'Home',
    },
    error: {
      label: 'System status',
      title: 'This page is temporarily unavailable',
      description: 'Your projects and media were not changed. Reload the page or return to your projects.',
      retry: 'Reload',
      projects: 'Back to projects',
      home: 'Home',
    },
    'not-found': {
      label: 'Not found',
      title: 'This page could not be found',
      description: 'The link may have changed or the content may have been removed. Return to your projects to continue.',
      retry: 'Reload',
      projects: 'Back to projects',
      home: 'Home',
    },
    forbidden: {
      label: 'Permission required',
      title: 'This page cannot be opened',
      description: 'You do not currently have access. Return to an available project or ask the project owner for permission.',
      retry: 'Reload',
      projects: 'Back to projects',
      home: 'Home',
    },
  },
}

const PANEL_STATES: Record<SystemState, UiStateKind> = {
  loading: 'loading',
  error: 'error',
  'not-found': 'empty',
  forbidden: 'permission',
}

export type SystemStateScreenProps = {
  state: SystemState
  locale?: string
  onRetry?: () => void
  errorDigest?: string
}

const actionClassName =
  'inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B0F]'

export function SystemStateScreen({
  state,
  locale: localeOverride,
  onRetry,
}: SystemStateScreenProps) {
  const params = useParams<{ locale?: string }>()
  const locale = localeOverride ?? params?.locale ?? 'zh'
  const language = locale.toLowerCase().startsWith('en') ? 'en' : 'zh'
  const copy = COPY[language][state]

  const retryAction = onRetry ? (
    <button
      type="button"
      className={`${actionClassName} bg-[#3E73B9] text-white hover:bg-[#4B82C8]`}
      onClick={onRetry}
    >
      {copy.retry}
    </button>
  ) : null

  const projectsAction = state === 'loading' ? null : (
    <Link
      href={`/${locale}/v2`}
      className={`${actionClassName} border border-[#354956] bg-[#17232D] text-[#F2F6F7] hover:bg-[#1E2D38]`}
    >
      {copy.projects}
    </Link>
  )

  return (
    <main
      data-testid="system-state-screen"
      className="grid min-h-screen place-items-center overflow-x-hidden bg-[#070B0F] px-4 py-10 text-[#F2F6F7] [--primary-400:#55AFC0] sm:px-6"
    >
      <div className="w-full max-w-2xl">
        <ProductionBrand
          locale={locale}
          href={`/${locale}`}
          tone="dark"
          className="mx-auto mb-7 flex w-fit"
        />

        <UiStatePanel
          state={PANEL_STATES[state]}
          locale={language}
          label={copy.label}
          title={copy.title}
          description={copy.description}
          primaryAction={retryAction ?? projectsAction}
          secondaryAction={retryAction ? projectsAction : state === 'not-found' ? (
            <Link
              href={`/${locale}`}
              className={`${actionClassName} text-[#A7B3BC] hover:text-[#F2F6F7]`}
            >
              {copy.home}
            </Link>
          ) : null}
        />
      </div>
    </main>
  )
}
