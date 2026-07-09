'use client'

/**
 * Playground / Freedom Mode — shell.
 *
 * Layout (2026-07-08 redesign, "两套介面" направление approved after a 3-agent
 * competitor survey — Western + Chinese tools + a Playwright teardown of
 * Higgsfield): Image and Video get DISTINCT studios, because video is
 * param-rich/slow/expensive and image is fast/high-volume.
 *   - Image → {@link ImageStudio}: masonry gallery + bottom composer, click a
 *     tile to open {@link ResultLightbox}. No permanent "current result" block
 *     (that pattern has ~zero market use and gets buried as history grows).
 *   - Video → {@link VideoStudio}: 3-column params | stage | detail.
 * All state/handlers live in {@link usePlaygroundController}; this shell only
 * renders the top bar, the 圖片/影片 mode toggle, and the active studio.
 * Keeps KuiperAI's amber-on-stone identity (borrowed layout, not colours).
 */

import Link from 'next/link'
import { AppIcon } from '@/components/ui/icons'
import { usePlaygroundController } from './usePlaygroundController'
import { ImageStudio } from './ImageStudio'
import { VideoStudio } from './VideoStudio'
import { ResultLightbox } from './ResultLightbox'

interface V2PlaygroundClientProps {
  locale: string
}

export function V2PlaygroundClient({ locale }: V2PlaygroundClientProps) {
  const ctrl = usePlaygroundController()
  const { outputType, setOutputType, isBusy } = ctrl

  return (
    <div className="flex h-screen flex-col bg-stone-950 text-stone-300">
      {/* TOP — brand + mode toggle + tab strip */}
      <header className="flex items-center justify-between border-b border-stone-800 px-8 py-3">
        <div className="flex items-center gap-6">
          <Link
            href={`/${locale}/v2`}
            className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-stone-500 hover:text-amber-400"
          >
            <AppIcon name="chevronLeft" className="h-3 w-3" />
            回到專案
          </Link>
          <div className="font-display text-xl font-semibold italic text-amber-400">KuiperAI · Playground</div>
          {/* 圖片 / 影片 mode toggle — switches the entire studio layout. */}
          <div className="inline-flex items-center gap-0 rounded-sm border border-stone-800 bg-stone-900 p-0.5">
            <button
              type="button"
              onClick={() => setOutputType('image')}
              disabled={isBusy}
              className={`rounded-sm px-4 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                outputType === 'image' ? 'bg-amber-500/15 text-amber-400' : 'text-stone-500 hover:text-stone-300'
              }`}
            >
              圖片
            </button>
            <button
              type="button"
              onClick={() => setOutputType('video')}
              disabled={isBusy}
              className={`rounded-sm px-4 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                outputType === 'video' ? 'bg-amber-500/15 text-amber-400' : 'text-stone-500 hover:text-stone-300'
              }`}
            >
              影片
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider">
          <span className="rounded-sm border-b-2 border-amber-500 bg-stone-900 px-3 py-1.5 text-amber-400">體驗</span>
          <span className="px-3 py-1.5 text-stone-600">API</span>
          <span className="px-3 py-1.5 text-stone-600">範例</span>
        </div>
      </header>

      {/* BODY — the active studio */}
      {outputType === 'image' ? <ImageStudio ctrl={ctrl} /> : <VideoStudio ctrl={ctrl} />}

      {/* Shared detail lightbox (Image studio) */}
      <ResultLightbox ctrl={ctrl} />
    </div>
  )
}
