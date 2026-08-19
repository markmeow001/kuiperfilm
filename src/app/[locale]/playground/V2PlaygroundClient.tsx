'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { CreativeToolShell } from '@/components/v2/CreativeToolShell'
import { usePlaygroundController } from './usePlaygroundController'
import { ImageStudio } from './ImageStudio'
import { VideoStudio } from './VideoStudio'
import { ResultLightbox } from './ResultLightbox'
import { DiscussionStudio } from './DiscussionStudio'
import { PlaygroundWorkspacePicker } from './PlaygroundWorkspacePicker'
import { ReconstructionStudio } from './ReconstructionStudio'

interface V2PlaygroundClientProps {
  locale: string
}

type PlaygroundMode = 'image' | 'video' | 'reconstruction' | 'discussion'

export function V2PlaygroundClient({ locale }: V2PlaygroundClientProps) {
  const searchParams = useSearchParams()
  const workspaceId = searchParams?.get('ws')?.trim() || null
  const ctrl = usePlaygroundController(workspaceId)
  const t = useTranslations('playground.header')
  const [mode, setMode] = useState<PlaygroundMode>('image')

  function selectMode(nextMode: PlaygroundMode) {
    if (nextMode !== 'discussion') {
      ctrl.setOutputType(nextMode === 'image' ? 'image' : 'video')
    }
    setMode(nextMode)
  }

  const modes: Array<{ id: PlaygroundMode; icon: 'image' | 'video' | 'sparklesAlt' | 'fileText'; label: string; hint: string }> = [
    { id: 'image', icon: 'image', label: t('image'), hint: t('imageHint') },
    { id: 'video', icon: 'video', label: t('video'), hint: t('videoHint') },
    { id: 'reconstruction', icon: 'sparklesAlt', label: t('reconstruction'), hint: t('reconstructionHint') },
    { id: 'discussion', icon: 'fileText', label: t('discussion'), hint: t('discussionHint') },
  ]

  return (
    <CreativeToolShell
      locale={locale}
      eyebrow={t('eyebrow')}
      title={t('title')}
      backHref={`/${locale}/v2`}
      backLabel={t('back')}
      actions={(
        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          <PlaygroundWorkspacePicker
            workspaceId={workspaceId}
            label={t('workspaceLabel')}
            historyLabel={t('workspaceHistory')}
            personalLabel={t('personalWorkspace')}
          />
          <div
            role="group"
            aria-label={t('title')}
            data-playground-mode-nav
            className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-[var(--darkroom-border)] bg-[var(--darkroom-raised)] p-1"
          >
            {modes.map((item) => {
              const active = mode === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectMode(item.id)}
                  disabled={ctrl.isBusy}
                  aria-label={`${item.label}：${item.hint}`}
                  aria-pressed={active}
                  title={item.hint}
                  className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--process-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--studio-chrome)] disabled:cursor-not-allowed disabled:opacity-45 sm:px-4 ${
                    active
                      ? 'bg-[var(--process-cyan-soft)] text-[var(--darkroom-text)]'
                      : 'text-[var(--darkroom-muted)] hover:bg-white/[0.045] hover:text-[var(--darkroom-text)]'
                  }`}
                >
                  <AppIcon
                    name={item.icon}
                    className={`h-4 w-4 ${active ? 'text-[var(--process-cyan-strong)]' : 'text-current'}`}
                  />
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    >

      {mode === 'discussion'
        ? <DiscussionStudio />
        : mode === 'reconstruction'
          ? <ReconstructionStudio ctrl={ctrl} locale={locale} />
        : mode === 'video'
          ? <VideoStudio ctrl={ctrl} />
          : <ImageStudio ctrl={ctrl} />}

      {mode !== 'discussion' && mode !== 'reconstruction' ? <ResultLightbox ctrl={ctrl} /> : null}
    </CreativeToolShell>
  )
}
