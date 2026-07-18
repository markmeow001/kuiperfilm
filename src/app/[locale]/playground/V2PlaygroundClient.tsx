'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { usePlaygroundController } from './usePlaygroundController'
import { ImageStudio } from './ImageStudio'
import { VideoStudio } from './VideoStudio'
import { ResultLightbox } from './ResultLightbox'
import { DiscussionStudio } from './DiscussionStudio'
import { PlaygroundWorkspacePicker } from './PlaygroundWorkspacePicker'

interface V2PlaygroundClientProps {
  locale: string
}

type PlaygroundMode = 'image' | 'video' | 'discussion'

export function V2PlaygroundClient({ locale }: V2PlaygroundClientProps) {
  const searchParams = useSearchParams()
  const workspaceId = searchParams?.get('ws')?.trim() || null
  const ctrl = usePlaygroundController(workspaceId)
  const t = useTranslations('playground.header')
  const [mode, setMode] = useState<PlaygroundMode>('image')

  function selectMode(nextMode: PlaygroundMode) {
    if (nextMode !== 'discussion') {
      ctrl.setOutputType(nextMode)
    }
    setMode(nextMode)
  }

  const modes: Array<{ id: PlaygroundMode; icon: 'image' | 'video' | 'fileText'; label: string; hint: string }> = [
    { id: 'image', icon: 'image', label: t('image'), hint: t('imageHint') },
    { id: 'video', icon: 'video', label: t('video'), hint: t('videoHint') },
    { id: 'discussion', icon: 'fileText', label: t('discussion'), hint: t('discussionHint') },
  ]

  return (
    <div className="kuiper-stage flex h-screen min-h-[640px] flex-col overflow-hidden text-text-primary">
      <header className="z-30 border-b border-white/[0.07] bg-[#050506]/90 px-4 backdrop-blur-xl sm:px-6">
        <div className="flex min-h-[72px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
            <Link
              href={`/${locale}/v2`}
              aria-label={t('back')}
              title={t('back')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-text-secondary transition-colors hover:border-primary-500/40 hover:text-primary-400"
            >
              <AppIcon name="chevronLeft" className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="font-mono text-[9px] tracking-[0.22em] text-primary-400">
                {t('eyebrow')}
              </div>
              <h1 className="mt-1 truncate font-serif-cn text-lg font-semibold text-white">
                {t('title')}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <PlaygroundWorkspacePicker workspaceId={workspaceId} />
            <nav
              aria-label={t('title')}
              className="flex items-center rounded-2xl border border-white/[0.08] bg-white/[0.04] p-1"
            >
            {modes.map((item) => {
              const active = mode === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectMode(item.id)}
                  disabled={ctrl.isBusy}
                  aria-current={active ? 'page' : undefined}
                  title={item.hint}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs transition-colors sm:px-4 ${
                    active
                      ? 'bg-white/[0.09] text-white'
                      : 'text-text-tertiary hover:text-text-primary'
                  }`}
                >
                  <AppIcon
                    name={item.icon}
                    className={`h-4 w-4 ${active ? 'text-primary-400' : 'text-current'}`}
                  />
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              )
            })}
            </nav>
          </div>
        </div>
      </header>

      {mode === 'discussion'
        ? <DiscussionStudio />
        : mode === 'video'
          ? <VideoStudio ctrl={ctrl} />
          : <ImageStudio ctrl={ctrl} />}

      {mode !== 'discussion' ? <ResultLightbox ctrl={ctrl} /> : null}
    </div>
  )
}
