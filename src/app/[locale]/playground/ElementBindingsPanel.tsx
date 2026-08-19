'use client'

/**
 * Kling O3 named-subject bindings (2026-07-10) — 「主體綁定」panel.
 *
 * Only rendered for kling-o3-* video models. Each subject = a NAME
 * (人物/場景, e.g. Vera / 古宅) + 1-4 reference images (first upload =
 * frontal_image). The user references subjects by typing their name in
 * the prompt; the worker swaps names for the <<<element_N>>> tokens the
 * Kling API binds on, so no token syntax ever leaks into the UI.
 */

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { elementDotClass } from './PromptHighlight'
import { MAX_KLING_ELEMENTS, MAX_KLING_ELEMENT_IMAGES } from './useKlingElements'
import type { PlaygroundController } from './usePlaygroundController'

interface ElementBindingsPanelProps {
  ctrl: PlaygroundController
}

export function ElementBindingsPanel({ ctrl }: ElementBindingsPanelProps) {
  const t = useTranslations('playground.video')
  const {
    elements, isBusy,
    addElement, removeElement, setElementName, handleElementImagePick, removeElementImage,
  } = ctrl
  // One hidden file input shared by all cards; the target element's stable
  // id routes the pick (index would mis-target after a mid-flight removal).
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const targetIdRef = useRef<string>('')

  function pickImageFor(id: string) {
    targetIdRef.current = id
    fileInputRef.current?.click()
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleElementImagePick(targetIdRef.current, e)}
      />

      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-text-tertiary">
          {t('elementPanelTitle')} <span className="text-text-tertiary">({elements.length}/{MAX_KLING_ELEMENTS})</span>
        </span>
        <button
          type="button"
          onClick={addElement}
          disabled={isBusy || elements.length >= MAX_KLING_ELEMENTS}
          className="rounded-sm border border-white/[0.12] px-2 py-0.5 font-mono text-[10px] text-text-secondary hover:border-cyan-400/60 hover:text-cyan-200 disabled:opacity-40"
        >
          + {t('addElement')}
        </button>
      </div>
      <div className="mb-2 font-serif-cn text-[11px] leading-relaxed text-text-tertiary">
        {t('elementPanelHint')}
      </div>

      {elements.length === 0 ? (
        <button
          type="button"
          onClick={addElement}
          disabled={isBusy}
          className="w-full rounded-sm border border-dashed border-white/[0.08] px-3 py-3 font-mono text-[10px] uppercase tracking-wider text-text-tertiary hover:border-cyan-400/40 hover:text-text-secondary disabled:opacity-40"
        >
          + {t('addElementEmpty')}
        </button>
      ) : (
        <div className="space-y-2">
          {elements.map((el, idx) => (
            <div key={el.id} className="rounded-sm border border-white/[0.08] bg-raised/40 p-2">
              <div className="mb-2 flex items-center gap-2">
                {/* Color dot matches this subject's in-prompt highlight. */}
                <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${elementDotClass(idx)}`} title={t('elementColorHint')} />
                <input
                  type="text"
                  value={el.name}
                  onChange={(e) => setElementName(el.id, e.target.value)}
                  disabled={isBusy}
                  placeholder={t('elementNamePlaceholder', {
                    example: idx % 2 === 0 ? t('elementPersonExample') : t('elementPlaceExample'),
                  })}
                  maxLength={80}
                  className="min-w-0 flex-1 rounded-sm border border-white/[0.08] bg-canvas/60 px-2 py-1 font-mono text-[12px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-cyan-400/40"
                />
                <button
                  type="button"
                  onClick={() => removeElement(el.id)}
                  disabled={isBusy}
                  title={t('removeElement')}
                  aria-label={t('removeElement')}
                  className="rounded-sm border border-white/[0.08] px-1.5 py-1 font-mono text-[10px] text-text-tertiary hover:border-rose-500/60 hover:text-rose-400 disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {el.images.map((img, imgIdx) => (
                  <div key={img.key} className="group relative h-12 w-12 overflow-hidden rounded-sm border border-white/[0.08]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.signedUrl} alt={t('elementReferenceAlt', { name: el.name || t('elements'), index: imgIdx + 1 })} className="h-full w-full object-cover" />
                    {imgIdx === 0 ? (
                      <span className="absolute left-0 top-0 rounded-br-sm bg-cyan-400/90 px-1 font-mono text-[8px] font-semibold text-black">{t('frontView')}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeElementImage(el.id, img.key)}
                      disabled={isBusy}
                      aria-label={t('removeElementReference')}
                      className="absolute inset-0 hidden items-center justify-center bg-canvas/70 font-mono text-[11px] text-rose-300 group-hover:flex"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {el.images.length < MAX_KLING_ELEMENT_IMAGES ? (
                  <button
                    type="button"
                    onClick={() => pickImageFor(el.id)}
                    disabled={isBusy}
                    title={t('uploadElementReference', { count: el.images.length, max: MAX_KLING_ELEMENT_IMAGES })}
                    aria-label={t('uploadElementReference', { count: el.images.length, max: MAX_KLING_ELEMENT_IMAGES })}
                    className="flex h-12 w-12 items-center justify-center rounded-sm border border-dashed border-white/[0.12] text-text-tertiary hover:border-cyan-400/40 hover:text-cyan-200 disabled:opacity-40"
                  >
                    <AppIcon name="plus" className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
