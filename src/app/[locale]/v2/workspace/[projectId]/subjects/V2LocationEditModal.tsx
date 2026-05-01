'use client'

/**
 * V2 場景編輯 Modal — 環境設置 (Approach A 延伸)
 *
 * 點場景卡片 → 開這個 modal。讓使用者:
 *   - 預覽 / 重新生成 / 上傳 / 放大 主圖
 *   - 改場景名稱、簡短備註、AI 描述詞
 *   - 設定環境條件:場景類型 / 分類 / 天氣 / 時段 / 光源 / 色溫 / 標籤
 *   - metadata 透過 location-metadata 模組序列化進 summary 欄位,
 *     不需要動 schema。worker 端會 parse 回來注入 prompt。
 *
 * 不在 scope 內(留給後續迭代):
 *   - 多視角(LocationView 子表 — 任務 2)
 *   - 同場景日夜變體
 *   - 全景 360° 預覽
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  LOCATION_METADATA_OPTIONS,
  parseLocationSummary,
  type LocationMetadata,
} from '@/lib/location-metadata'
import { V2LocationViewsPanel } from './V2LocationViewsPanel'

interface LocationImageLike {
  id: string
  imageIndex?: number | null
  description?: string | null
}

interface LocationLike {
  id: string
  name?: string | null
  summary?: string | null
  description?: string | null
  images?: LocationImageLike[] | null
}

export interface V2LocationEditModalProps {
  location: LocationLike
  imageUrl: string | null
  onClose: () => void
  onZoomImage: (url: string) => void

  onRegenerate: () => void
  onUploadFile: (file: File) => void
  isRegenerating: boolean
  isUploading: boolean

  /** PATCH name + note + metadata. */
  onSaveBasics: (params: {
    name: string
    note: string
    metadata: LocationMetadata | null
  }) => void
  isSavingBasics: boolean

  /** PATCH first image's description (the AI prompt). */
  onSaveDescription: (description: string) => void
  isSavingDescription: boolean

  // Approach B-Standard 多視角:額外視角的 CRUD + 重生委派給父層,
  // 因為它跟既有的 regenLoc / 場景圖任務生命週期糾纏在一起,modal
  // 自己拉 mutation 反而造成 cascade 不一致。
  views?: ViewLikeForModal[]
  onCreateView?: (params: { viewName: string; description: string }) => Promise<void> | void
  isCreatingView?: boolean
  onRegenerateView?: (imageIndex: number) => void
  onDeleteView?: (imageIndex: number) => Promise<void> | void
  isViewRegenerating?: (imageIndex: number) => boolean
  isDeletingView?: boolean
}

interface ViewLikeForModal {
  id: string
  imageIndex: number
  viewName?: string | null
  description?: string | null
  imageUrl?: string | null
}

export function V2LocationEditModal({
  location,
  imageUrl,
  onClose,
  onZoomImage,
  onRegenerate,
  onUploadFile,
  isRegenerating,
  isUploading,
  onSaveBasics,
  isSavingBasics,
  onSaveDescription,
  isSavingDescription,
  views,
  onCreateView,
  isCreatingView,
  onRegenerateView,
  onDeleteView,
  isViewRegenerating,
  isDeletingView,
}: V2LocationEditModalProps) {
  const initial = useMemo(() => parseLocationSummary(location.summary || null), [location.summary])
  const firstImage = location.images?.[0] ?? null
  const initialDescription = firstImage?.description ?? location.description ?? ''

  const [name, setName] = useState(location.name ?? '')
  const [note, setNote] = useState(initial.note)
  const [meta, setMeta] = useState<LocationMetadata>(initial.metadata ?? {})
  const [tagsInput, setTagsInput] = useState((initial.metadata?.tags ?? []).join(', '))
  const [descriptionDraft, setDescriptionDraft] = useState(initialDescription)

  // Re-seed when location changes
  useEffect(() => {
    setName(location.name ?? '')
  }, [location.id, location.name])
  useEffect(() => {
    const parsed = parseLocationSummary(location.summary || null)
    setNote(parsed.note)
    setMeta(parsed.metadata ?? {})
    setTagsInput((parsed.metadata?.tags ?? []).join(', '))
  }, [location.id, location.summary])
  useEffect(() => {
    setDescriptionDraft(firstImage?.description ?? location.description ?? '')
  }, [firstImage?.description, location.description])

  // ESC closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function buildMetaForSave(): LocationMetadata | null {
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const out: LocationMetadata = {
      ...meta,
      tags: tags.length > 0 ? tags : undefined,
    }
    // Strip empty values so we don't store {weather: ''}
    const cleaned: LocationMetadata = {}
    let hasAny = false
    for (const k of Object.keys(out) as (keyof LocationMetadata)[]) {
      const v = out[k]
      if (Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v) {
        // @ts-expect-error union narrow
        cleaned[k] = v
        hasAny = true
      }
    }
    return hasAny ? cleaned : null
  }

  const basicsChanged = (() => {
    if (name !== (location.name ?? '')) return true
    if (note !== initial.note) return true
    const nextMeta = buildMetaForSave()
    return JSON.stringify(nextMeta) !== JSON.stringify(initial.metadata ?? null)
  })()
  const descriptionChanged = descriptionDraft !== initialDescription

  function handleSaveBasics() {
    onSaveBasics({
      name: name.trim() || (location.name ?? ''),
      note: note.trim(),
      metadata: buildMetaForSave(),
    })
  }
  function handleSaveDescription() {
    onSaveDescription(descriptionDraft.trim())
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-stone-950/90 p-6 backdrop-blur-md sm:p-10"
      onClick={onClose}
    >
      <div
        className="relative my-10 w-full max-w-5xl rounded-sm border border-stone-800 bg-stone-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-800/60 px-6 py-4">
          <div>
            <div className="font-fraunces text-xl italic text-amber-400">編輯場景</div>
            <div className="mt-1 font-mono text-[10px] tracking-wider text-stone-500">
              EDIT_LOCATION · {location.id.slice(0, 8)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-stone-800 text-stone-400 transition-colors hover:border-stone-700 hover:text-stone-200"
            aria-label="關閉"
          >
            ×
          </button>
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-[320px_1fr]">
          {/* Left: image + actions */}
          <div className="space-y-3">
            <div
              className={`relative aspect-video overflow-hidden rounded-sm border border-stone-800 bg-gradient-to-br from-stone-800 to-stone-900 ${
                imageUrl ? 'cursor-zoom-in' : ''
              }`}
              onClick={() => imageUrl && onZoomImage(imageUrl)}
            >
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={location.name ?? '場景'} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <AppIcon name="image" className="h-10 w-10 text-stone-600" />
                </div>
              )}
              {isRegenerating ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-950/70 backdrop-blur-sm">
                  <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-amber-400" />
                  <div className="font-mono text-[10px] tracking-wider text-amber-300">生圖中…</div>
                </div>
              ) : null}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onUploadFile(f)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onRegenerate}
                disabled={isRegenerating}
                className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-serif-cn text-xs text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
              >
                {isRegenerating ? '生圖中…' : '重新生成'}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="rounded-sm border border-stone-700 px-3 py-2 font-serif-cn text-xs text-stone-300 transition-colors hover:bg-stone-800 disabled:opacity-50"
              >
                {isUploading ? '上傳中…' : '上傳替換'}
              </button>
            </div>
          </div>

          {/* Right: name + metadata + AI prompt */}
          <div className="space-y-5">
            <Field label="場景名稱">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-sm border border-stone-800 bg-stone-900 px-3 py-2 font-body text-sm text-stone-200 outline-none focus:border-amber-500/50"
                placeholder="例:客廳"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="場景類型">
                <Select
                  value={meta.type ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, type: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.type.map((o) => ({ value: o.value, label: o.label }))}
                  placeholder="未設定"
                />
              </Field>
              <Field label="風格分類">
                <Select
                  value={meta.category ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, category: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.category.map((v) => ({ value: v, label: v }))}
                  placeholder="未設定"
                />
              </Field>
            </div>

            <SectionLabel>環境設置</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="天氣">
                <Select
                  value={meta.weather ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, weather: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.weather.map((v) => ({ value: v, label: v }))}
                  placeholder="未設定"
                />
              </Field>
              <Field label="時間段">
                <Select
                  value={meta.timeOfDay ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, timeOfDay: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.timeOfDay.map((v) => ({ value: v, label: v }))}
                  placeholder="未設定"
                />
              </Field>
            </div>

            <SectionLabel>光照設置</SectionLabel>
            <div className="grid grid-cols-3 gap-3">
              <Field label="光源類型">
                <Select
                  value={meta.lightSource ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, lightSource: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.lightSource.map((v) => ({ value: v, label: v }))}
                  placeholder="未設定"
                />
              </Field>
              <Field label="光照方向">
                <Select
                  value={meta.lightDirection ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, lightDirection: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.lightDirection.map((v) => ({ value: v, label: v }))}
                  placeholder="未設定"
                />
              </Field>
              <Field label="色溫">
                <Select
                  value={meta.colorTone ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, colorTone: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.colorTone.map((v) => ({ value: v, label: v }))}
                  placeholder="未設定"
                />
              </Field>
            </div>

            <Field label="標籤(逗號分隔)">
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="w-full rounded-sm border border-stone-800 bg-stone-900 px-3 py-2 font-body text-sm text-stone-200 outline-none focus:border-amber-500/50"
                placeholder="例:溫馨, 家庭, 工業風"
              />
            </Field>

            <Field label="簡短備註(用途/人物關聯)">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full rounded-sm border border-stone-800 bg-stone-900 px-3 py-2 font-body text-sm text-stone-200 outline-none focus:border-amber-500/50"
              />
            </Field>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveBasics}
                disabled={!basicsChanged || isSavingBasics}
                className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-2 font-serif-cn text-xs text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSavingBasics ? '儲存中…' : '儲存基本資料'}
              </button>
            </div>

            <div className="border-t border-stone-800/60 pt-5">
              <Field label="AI 描述詞(下次重生時送給模型)">
                <textarea
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  rows={5}
                  className="w-full rounded-sm border border-stone-800 bg-stone-900 px-3 py-2 font-body text-sm text-stone-200 outline-none focus:border-amber-500/50"
                  placeholder="描述場景的視覺細節 — 牆面、家具、地板、裝飾,例如:北歐風格客廳,白色牆面,木地板,沙發朝向窗戶..."
                />
              </Field>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveDescription}
                  disabled={!descriptionChanged || isSavingDescription}
                  className="rounded-sm border border-stone-700 px-4 py-2 font-serif-cn text-xs text-stone-300 transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSavingDescription ? '儲存中…' : '儲存描述詞'}
                </button>
              </div>
            </div>

            {views && onCreateView && onRegenerateView && onDeleteView && isViewRegenerating ? (
              <V2LocationViewsPanel
                locationName={location.name ?? '場景'}
                images={views}
                onCreateView={onCreateView}
                isCreating={!!isCreatingView}
                onRegenerateView={onRegenerateView}
                onDeleteView={onDeleteView}
                isRegenerating={isViewRegenerating}
                isDeleting={!!isDeletingView}
                onZoomImage={onZoomImage}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 font-mono text-[10px] tracking-wider text-stone-500">{label}</div>
      {children}
    </label>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-stone-800/60 pb-1 font-fraunces text-xs italic text-amber-500/80">
      {children}
    </div>
  )
}

interface SelectOption { value: string; label: string }
function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-sm border border-stone-800 bg-stone-900 px-3 py-2 font-body text-sm text-stone-200 outline-none focus:border-amber-500/50"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
