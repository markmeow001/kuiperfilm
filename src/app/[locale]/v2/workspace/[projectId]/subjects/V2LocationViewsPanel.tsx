'use client'

/**
 * Approach B-Standard 場景多視角 panel — 嵌在 V2LocationEditModal 底部。
 *
 * 每個 location 預設有一張主視角 (imageIndex=0,viewName=null)。這個
 * panel 列出 imageIndex>=1 的額外視角(「窗邊」「正門」「夜晚」等),
 * 提供:
 *   - 列出每個額外視角:viewName + 縮圖 + 描述詞 + 重新生成 + 刪除
 *   - 「+ 新增視角」表單:viewName + 描述詞 + 創建 → 立即觸發生圖
 *
 * panel 端如何使用視角:storyboard panel.location 欄位寫
 * 「<locationName>#<viewName>」(例如「客廳#窗邊」),worker
 * (collectPanelReferenceImages / panel-image-task-handler) 看到 # 就
 * 改抓對應視角當 ref。沒寫 # 就走主視角(legacy)。
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

interface LocationImageRow {
  id: string
  imageIndex: number
  viewName?: string | null
  description?: string | null
  imageUrl?: string | null
}

interface V2LocationViewsPanelProps {
  locationName: string
  images: LocationImageRow[]
  onCreateView: (params: { viewName: string; description: string }) => Promise<void> | void
  isCreating: boolean

  onRegenerateView: (imageIndex: number) => void
  onDeleteView: (imageIndex: number) => Promise<void> | void
  isRegenerating: (imageIndex: number) => boolean
  isDeleting: boolean

  onZoomImage: (url: string) => void
}

export function V2LocationViewsPanel({
  locationName,
  images,
  onCreateView,
  isCreating,
  onRegenerateView,
  onDeleteView,
  isRegenerating,
  isDeleting,
  onZoomImage,
}: V2LocationViewsPanelProps) {
  const t = useTranslations('v2Subjects.locationViews')
  // imageIndex=0 is the main view rendered above by the parent modal.
  const subViews = images.filter((img) => img.imageIndex >= 1)

  const [newViewName, setNewViewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [showForm, setShowForm] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = newViewName.trim()
    if (!name) return
    await onCreateView({ viewName: name, description: newDescription.trim() })
    setNewViewName('')
    setNewDescription('')
    setShowForm(false)
  }

  async function handleDelete(imageIndex: number, viewName: string | null) {
    const displayName = viewName ?? t('viewFallback', { index: imageIndex })
    if (!window.confirm(t('deleteConfirm', { view: displayName }))) {
      return
    }
    await onDeleteView(imageIndex)
  }

  return (
    <div className="border-t border-[var(--production-border)] pt-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--process-cyan-strong)]">
            {t('title')}
          </div>
          <div className="mt-1 text-[13px] text-[var(--production-ink-muted)]">
            {t('usage', { locationName })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="min-h-11 rounded-xl border border-[var(--production-border)] px-3 text-xs font-semibold text-[var(--production-ink-muted)] transition-colors hover:border-[var(--process-cyan)]/45 hover:bg-[var(--process-cyan-soft)] hover:text-[var(--production-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
        >
          {showForm ? t('cancel') : t('addView')}
        </button>
      </div>

      {showForm ? (
        <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-xl border border-[var(--production-border)] bg-[var(--production-muted)] p-4">
          <label className="block">
            <div className="mb-1.5 text-[13px] font-medium text-[var(--production-ink-muted)]">
              {t('nameLabel')}
            </div>
            <input
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-[var(--production-border)] bg-[var(--production-surface)] px-3 text-sm text-[var(--production-ink)] outline-none placeholder:text-[var(--production-ink-muted)] focus-visible:border-[var(--process-cyan)] focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
              placeholder={t('namePlaceholder')}
              autoFocus
              required
            />
          </label>
          <label className="block">
            <div className="mb-1.5 text-[13px] font-medium text-[var(--production-ink-muted)]">
              {t('descriptionLabel')}
            </div>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-[var(--production-border)] bg-[var(--production-surface)] px-3 py-2 text-sm text-[var(--production-ink)] outline-none placeholder:text-[var(--production-ink-muted)] focus-visible:border-[var(--process-cyan)] focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
              placeholder={t('descriptionPlaceholder')}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setNewViewName('')
                setNewDescription('')
              }}
              className="min-h-11 rounded-xl border border-[var(--production-border)] px-3 text-xs font-semibold text-[var(--production-ink-muted)] transition-colors hover:bg-[var(--production-surface)] hover:text-[var(--production-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isCreating || !newViewName.trim()}
              className="min-h-11 rounded-xl border border-[var(--process-cyan)]/45 bg-[var(--process-cyan-soft)] px-4 text-xs font-semibold text-[var(--process-cyan-strong)] transition-colors hover:border-[var(--process-cyan)] hover:bg-[var(--process-cyan-soft)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
            >
              {isCreating ? t('creating') : t('createAndGenerate')}
            </button>
          </div>
        </form>
      ) : null}

      {subViews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--production-border)] px-4 py-6 text-center text-xs text-[var(--production-ink-muted)]">
          {showForm ? t('emptyForm') : t('empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {subViews.map((img) => {
            const regen = isRegenerating(img.imageIndex)
            const imageUrl = img.imageUrl ?? null
            const thumbnailContent = (
              <>
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt={img.viewName ?? t('viewFallback', { index: img.imageIndex })} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    <AppIcon name="image" className="h-5 w-5 text-[var(--production-ink-muted)]" />
                  </span>
                )}
                {regen ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-canvas/70 backdrop-blur-sm">
                    <AppIcon name="sparklesAlt" className="h-4 w-4 animate-pulse text-[var(--process-cyan-strong)]" />
                  </span>
                ) : null}
              </>
            )
            return (
              <div
                key={img.id}
                className="group flex gap-3 rounded-xl border border-[var(--production-border)] bg-[var(--production-muted)] p-3"
              >
                {imageUrl ? (
                  <button
                    type="button"
                    onClick={() => onZoomImage(imageUrl)}
                    aria-label={t('previewAria', {
                      view: img.viewName ?? t('viewFallback', { index: img.imageIndex }),
                    })}
                    className="relative min-h-11 h-20 w-32 flex-shrink-0 cursor-zoom-in overflow-hidden rounded-xl border border-[var(--production-border)] bg-[var(--production-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
                  >
                    {thumbnailContent}
                  </button>
                ) : (
                  <div className="relative h-20 w-32 flex-shrink-0 overflow-hidden rounded-xl border border-[var(--production-border)] bg-[var(--production-surface)]">
                    {thumbnailContent}
                  </div>
                )}
                <div className="flex flex-1 flex-col">
                  <div className="text-sm font-medium text-[var(--production-ink)]">
                    {img.viewName ?? t('viewFallback', { index: img.imageIndex })}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] text-[var(--production-ink-muted)]">
                    {img.description ?? <span className="italic">{t('inheritedDescription')}</span>}
                  </div>
                  <div className="mt-auto flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => onRegenerateView(img.imageIndex)}
                      disabled={regen}
                      className="min-h-11 rounded-xl border border-[var(--process-cyan)]/45 px-3 font-mono text-[12px] tracking-wider text-[var(--process-cyan-strong)] transition-colors hover:bg-[var(--process-cyan-soft)] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
                    >
                      {regen ? t('generating') : img.imageUrl ? t('regenerate') : t('generate')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(img.imageIndex, img.viewName ?? null)}
                      disabled={isDeleting}
                      className="min-h-11 rounded-xl border border-red-400/30 px-3 font-mono text-[12px] tracking-wider text-red-200 transition-colors hover:bg-red-400/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
                    >
                      {t('delete')}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
