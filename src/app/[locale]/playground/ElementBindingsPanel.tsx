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
import { AppIcon } from '@/components/ui/icons'
import { elementDotClass } from './PromptHighlight'
import { MAX_KLING_ELEMENTS, MAX_KLING_ELEMENT_IMAGES } from './useKlingElements'
import type { PlaygroundController } from './usePlaygroundController'

interface ElementBindingsPanelProps {
  ctrl: PlaygroundController
}

export function ElementBindingsPanel({ ctrl }: ElementBindingsPanelProps) {
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
        <span className="font-mono text-[11px] uppercase tracking-wider text-stone-500">
          主體綁定 <span className="text-stone-600">({elements.length}/{MAX_KLING_ELEMENTS})</span>
        </span>
        <button
          type="button"
          onClick={addElement}
          disabled={isBusy || elements.length >= MAX_KLING_ELEMENTS}
          className="rounded-sm border border-stone-700 px-2 py-0.5 font-mono text-[10px] text-stone-400 hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-40"
        >
          + 主體
        </button>
      </div>
      <div className="mb-2 font-serif-cn text-[11px] leading-relaxed text-stone-600">
        人物 / 場景各建一個主體，命名後在 prompt 直接打名字即可綁定
      </div>

      {elements.length === 0 ? (
        <button
          type="button"
          onClick={addElement}
          disabled={isBusy}
          className="w-full rounded-sm border border-dashed border-stone-800 px-3 py-3 font-mono text-[10px] uppercase tracking-wider text-stone-600 hover:border-amber-500/40 hover:text-stone-400 disabled:opacity-40"
        >
          + 新增主體（人物 / 場景）
        </button>
      ) : (
        <div className="space-y-2">
          {elements.map((el, idx) => (
            <div key={el.id} className="rounded-sm border border-stone-800 bg-stone-900/40 p-2">
              <div className="mb-2 flex items-center gap-2">
                {/* Color dot matches this subject's in-prompt highlight. */}
                <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${elementDotClass(idx)}`} title="prompt 中此主體名字會以同色標示" />
                <input
                  type="text"
                  value={el.name}
                  onChange={(e) => setElementName(el.id, e.target.value)}
                  disabled={isBusy}
                  placeholder={`主體名稱（例：${idx % 2 === 0 ? 'Vera' : '古宅'}）`}
                  maxLength={80}
                  className="min-w-0 flex-1 rounded-sm border border-stone-800 bg-stone-950/60 px-2 py-1 font-mono text-[12px] text-stone-200 outline-none placeholder:text-stone-600 focus:border-amber-500/40"
                />
                <button
                  type="button"
                  onClick={() => removeElement(el.id)}
                  disabled={isBusy}
                  title="移除主體"
                  className="rounded-sm border border-stone-800 px-1.5 py-1 font-mono text-[10px] text-stone-500 hover:border-rose-500/60 hover:text-rose-400 disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {el.images.map((img, imgIdx) => (
                  <div key={img.key} className="group relative h-12 w-12 overflow-hidden rounded-sm border border-stone-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.signedUrl} alt={`${el.name || '主體'} 參考圖 ${imgIdx + 1}`} className="h-full w-full object-cover" />
                    {imgIdx === 0 ? (
                      <span className="absolute left-0 top-0 rounded-br-sm bg-amber-500/90 px-1 font-mono text-[8px] font-semibold text-stone-950">正面</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeElementImage(el.id, img.key)}
                      disabled={isBusy}
                      className="absolute inset-0 hidden items-center justify-center bg-stone-950/70 font-mono text-[11px] text-rose-300 group-hover:flex"
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
                    title={`上傳參考圖（${el.images.length}/${MAX_KLING_ELEMENT_IMAGES}，第 1 張為正面照）`}
                    className="flex h-12 w-12 items-center justify-center rounded-sm border border-dashed border-stone-700 text-stone-500 hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-40"
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
