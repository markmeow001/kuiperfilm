'use client'

/**
 * Phase 12 — 場景手動新增 modal.
 *
 * 鏡像 V2LocationEditModal 的右側 metadata 欄位 (場景類型 / 分類 /
 * 天氣 / 時段 / 光源 / 光照方向 / 色溫 / 標籤),左側放上傳/AI 生成
 * 入口。設計參考 user 提供的「新场景」mockup。
 *
 * 兩種建立路徑:
 *   1. 上傳模式 — 選了圖,POST 建立 location(無 description),再用
 *      upload-asset-image 把圖綁上去。沒有自動 AI 生成。
 *   2. AI 生成模式 — 描述非空,POST 建立 location(帶 description),
 *      API 會自動觸發 generate-image task 在後台跑。
 *
 * Metadata 透過 stringifyLocationSummary 存進 summary 欄位(沿用既
 * 有 schema,不動 DB)。
 */

import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { LOCATION_METADATA_OPTIONS, stringifyLocationSummary, type LocationMetadata } from '@/lib/location-metadata'
import {
  getLocationCreatePolicy,
  resolveLocationCreateSubmission,
  type LocationCreateMode,
} from './subject-create-policy'

export interface V2LocationCreationModalProps {
  onClose: () => void
  onSubmit: (params: {
    name: string
    description: string
    summary: string | null
    file: File | null
  }) => void | Promise<void>
  isSubmitting: boolean
}

const EMPTY_META: LocationMetadata = {
  type: null,
  category: null,
  weather: null,
  timeOfDay: null,
  lightSource: null,
  lightDirection: null,
  colorTone: null,
  tags: [],
}

const DESC_MAX = 600

export function V2LocationCreationModal({ onClose, onSubmit, isSubmitting }: V2LocationCreationModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [createMode, setCreateMode] = useState<LocationCreateMode>('description')
  const [meta, setMeta] = useState<LocationMetadata>(EMPTY_META)
  const [tagsInput, setTagsInput] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, isSubmitting])

  const createPolicy = getLocationCreatePolicy({
    name,
    mode: createMode,
    hasFile: !!file,
    isBusy: isSubmitting,
  })
  const descTooShort = description.trim().length > 0 && description.trim().length < 10

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    if (f && !f.type.startsWith('image/')) {
      alert('只接受圖片檔(JPG / PNG / WebP)')
      return
    }
    setFile(f)
    if (f) setCreateMode('upload')
  }

  function buildSummary(note: string): string | null {
    // 收集 tags(逗號或頓號分隔)
    const tags = tagsInput
      .split(/[,，、]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    const hasMeta =
      !!meta.type ||
      !!meta.category ||
      !!meta.weather ||
      !!meta.timeOfDay ||
      !!meta.lightSource ||
      !!meta.lightDirection ||
      !!meta.colorTone ||
      tags.length > 0
    if (!hasMeta && !note) return null
    return stringifyLocationSummary({
      note,
      metadata: { ...meta, tags },
    })
  }

  function handleSubmit() {
    if (!createPolicy.canSubmit) return
    const submission = resolveLocationCreateSubmission(createMode, description)
    void onSubmit({
      name: name.trim(),
      description: submission.apiDescription,
      summary: buildSummary(submission.summaryNote),
      file: submission.shouldUpload ? file : null,
    })
  }

  return (
    <div
      className="kuiper-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose()
      }}
    >
      <form
        className="kuiper-modal-surface flex max-h-[90vh] w-full max-w-4xl flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          handleSubmit()
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-primary-900/20 px-6 py-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <AppIcon name="image" className="h-4 w-4 text-primary-400" />
            <div className="font-fraunces text-lg italic text-text-primary">新場景</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary-600/80">MANUAL · CREATE</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-raised hover:text-primary-400 disabled:opacity-50"
            aria-label="關閉"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        {/* Body — two-column grid: image/desc on left, metadata on right */}
        <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-y-auto">
          {/* Left column */}
          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={isSubmitting}
              className="hidden"
            />

            {/* Image preview / drop area */}
            <div className="aspect-video w-full overflow-hidden rounded-sm border border-dashed border-border-strong bg-raised/60">
              {previewUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={previewUrl} alt="預覽" className="h-full w-full object-contain" />
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={isSubmitting}
                  className="flex h-full w-full flex-col items-center justify-center gap-2 transition-colors hover:bg-primary-500/5"
                >
                  <AppIcon name="upload" className="h-8 w-8 text-text-tertiary" />
                  <div className="font-serif-cn text-sm text-text-secondary">點擊上傳</div>
                </button>
              )}
            </div>

            {/* Explicitly exclusive create modes — avoids AI/upload races. */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setCreateMode('upload')
                  fileRef.current?.click()
                }}
                disabled={isSubmitting}
                className={`flex items-center justify-center gap-2 rounded-sm border px-4 py-2.5 font-serif-cn text-sm transition-all disabled:opacity-50 ${
                  createMode === 'upload'
                    ? 'border-primary-500/60 bg-primary-500/10 text-primary-300'
                    : 'border-border-strong bg-raised/40 text-text-secondary hover:border-primary-500/40'
                }`}
              >
                <AppIcon name="upload" className="h-4 w-4" />
                {file ? '自行上傳 · 已選圖片' : '自行上傳'}
              </button>
              <button
                type="button"
                onClick={() => setCreateMode('description')}
                disabled={isSubmitting}
                className={`flex items-center justify-center gap-2 rounded-sm border px-4 py-2.5 font-serif-cn text-sm transition-all disabled:opacity-50 ${
                  createMode === 'description'
                    ? 'border-primary-500/60 bg-primary-500/10 text-primary-300'
                    : 'border-border-strong bg-raised/40 text-text-secondary hover:border-primary-500/40'
                }`}
              >
                <AppIcon name="sparklesAlt" className="h-4 w-4" />
                AI 描述詞生成
              </button>
            </div>

            {/* Description with counter */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="font-mono text-[11px] uppercase tracking-wider text-text-secondary">
                  {createMode === 'upload'
                    ? '場景說明（可選 · 不會啟動 AI）'
                    : '描述（可選 · 填寫後由 AI 生圖）'}
                </label>
                <span className="font-mono text-[10px] tracking-wider text-text-tertiary">
                  {description.length}/{DESC_MAX}
                </span>
              </div>
              <textarea
                value={description}
                maxLength={DESC_MAX}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                rows={6}
                placeholder="詳細描述場景的視覺細節（牆面、家具、光線、氣氛...）"
                className="w-full resize-none rounded-sm border border-border-soft bg-raised/60 px-3 py-2 font-serif-cn text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-500/50 focus:outline-none disabled:opacity-50"
              />
              {descTooShort ? (
                <div className="mt-1.5 flex items-center gap-1.5 rounded-sm border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 font-mono text-[11px] tracking-wider text-rose-300">
                  <AppIcon name="alert" className="h-3 w-3" />
                  描述過於簡單,可能影響生成品質
                </div>
              ) : null}
            </div>
          </div>

          {/* Right column — metadata */}
          <div className="space-y-4">
            <Field label="名稱 *">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
                placeholder="例:雨夜停車場"
                className="w-full rounded-sm border border-border-soft bg-raised/60 px-3 py-2 font-serif-cn text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-500/50 focus:outline-none disabled:opacity-50"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="場景類型">
                <Select
                  value={meta.type ?? ''}
                  onChange={(v) =>
                    setMeta((m) => ({
                      ...m,
                      type: (v as 'interior' | 'exterior' | null) || null,
                    }))
                  }
                  options={LOCATION_METADATA_OPTIONS.type.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  placeholder="未設定"
                  disabled={isSubmitting}
                />
              </Field>
              <Field label="分類">
                <Select
                  value={meta.category ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, category: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.category.map((v) => ({
                    value: v,
                    label: v,
                  }))}
                  placeholder="未設定"
                  disabled={isSubmitting}
                />
              </Field>
            </div>

            <SectionLabel>環境設置</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="天氣">
                <Select
                  value={meta.weather ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, weather: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.weather.map((v) => ({
                    value: v,
                    label: v,
                  }))}
                  placeholder="未設定"
                  disabled={isSubmitting}
                />
              </Field>
              <Field label="時間段">
                <Select
                  value={meta.timeOfDay ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, timeOfDay: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.timeOfDay.map((v) => ({
                    value: v,
                    label: v,
                  }))}
                  placeholder="未設定"
                  disabled={isSubmitting}
                />
              </Field>
            </div>

            <SectionLabel>光照設置</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="光源類型">
                <Select
                  value={meta.lightSource ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, lightSource: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.lightSource.map((v) => ({
                    value: v,
                    label: v,
                  }))}
                  placeholder="未設定"
                  disabled={isSubmitting}
                />
              </Field>
              <Field label="光照方向">
                <Select
                  value={meta.lightDirection ?? ''}
                  onChange={(v) => setMeta((m) => ({ ...m, lightDirection: v || null }))}
                  options={LOCATION_METADATA_OPTIONS.lightDirection.map((v) => ({ value: v, label: v }))}
                  placeholder="未設定"
                  disabled={isSubmitting}
                />
              </Field>
            </div>
            <Field label="色溫">
              <Select
                value={meta.colorTone ?? ''}
                onChange={(v) => setMeta((m) => ({ ...m, colorTone: v || null }))}
                options={LOCATION_METADATA_OPTIONS.colorTone.map((v) => ({
                  value: v,
                  label: v,
                }))}
                placeholder="未設定"
                disabled={isSubmitting}
              />
            </Field>

            <Field label="標籤">
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                disabled={isSubmitting}
                placeholder="用逗號分隔,如:溫馨, 家庭, 工業風"
                className="w-full rounded-sm border border-border-soft bg-raised/60 px-3 py-2 font-serif-cn text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-500/50 focus:outline-none disabled:opacity-50"
              />
            </Field>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-primary-900/20 bg-raised/30 px-6 py-4 flex-shrink-0">
          {createPolicy.hint ? (
            <div className="mb-3 font-mono text-[11px] tracking-wider text-primary-300/80" role="status">
              {createPolicy.hint}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-sm px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!createPolicy.canSubmit}
              className="flex items-center gap-2 rounded-sm bg-primary-500 px-5 py-2 font-serif-cn text-sm font-medium text-canvas transition-all hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <AppIcon name="loader" className="h-4 w-4 animate-spin" />
                  建立中…
                </>
              ) : (
                <>
                  <AppIcon name="plus" className="h-4 w-4" />
                {createMode === 'upload'
                  ? '建立並上傳'
                  : description.trim()
                    ? '生成並建立'
                    : '只建立場景'}
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-text-secondary">{label}</div>
      {children}
    </label>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border-soft/60 pb-1.5 font-fraunces text-xs italic text-primary-500/80">{children}</div>
  )
}

interface SelectOption {
  value: string
  label: string
}

function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  placeholder: string
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full appearance-none rounded-sm border border-border-soft bg-raised/60 bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%226%22%20viewBox%3D%220%200%2010%206%22%3E%3Cpath%20fill%3D%22%23737373%22%20d%3D%22M0%200l5%206%205-6z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:10px_6px] bg-[right_0.75rem_center] bg-no-repeat px-3 py-2 pr-8 font-serif-cn text-sm text-text-primary focus:border-primary-500/50 focus:outline-none disabled:opacity-50"
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
