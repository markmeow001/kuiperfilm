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
    if (!window.confirm(`確定刪除「${viewName ?? `視角 ${imageIndex}`}」?\n圖片與描述會一起移除,無法復原。`)) {
      return
    }
    await onDeleteView(imageIndex)
  }

  return (
    <div className="border-t border-stone-800/60 pt-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-fraunces text-xs italic text-amber-500/80">場景多視角</div>
          <div className="mt-0.5 font-mono text-[14px] tracking-wider text-stone-600">
            分鏡 panel.location 寫「{locationName}#視角名」即可切換
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="rounded-sm border border-stone-700 px-3 py-1.5 font-serif-cn text-xs text-stone-300 transition-colors hover:bg-stone-800"
        >
          {showForm ? '取消' : '+ 新增視角'}
        </button>
      </div>

      {showForm ? (
        <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-sm border border-stone-800/80 bg-stone-900/40 p-4">
          <label className="block">
            <div className="mb-1.5 font-mono text-[14px] tracking-wider text-stone-500">視角名稱(短)</div>
            <input
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              className="w-full rounded-sm border border-stone-800 bg-stone-900 px-3 py-2 font-body text-sm text-stone-200 outline-none focus:border-amber-500/50"
              placeholder="例:窗邊 / 正門 / 夜晚 / 從玄關望進來"
              autoFocus
              required
            />
          </label>
          <label className="block">
            <div className="mb-1.5 font-mono text-[14px] tracking-wider text-stone-500">視角描述(可選,給 AI 出圖用)</div>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={3}
              className="w-full rounded-sm border border-stone-800 bg-stone-900 px-3 py-2 font-body text-sm text-stone-200 outline-none focus:border-amber-500/50"
              placeholder="從哪個方位看?重點構圖元素是什麼?例如「從沙發後方看向落地窗,前景是茶几,陽光從右側打進來」。空白會用主視角描述繼承。"
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
              className="rounded-sm border border-stone-700 px-3 py-1.5 font-serif-cn text-xs text-stone-400 transition-colors hover:bg-stone-800"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isCreating || !newViewName.trim()}
              className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-1.5 font-serif-cn text-xs text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isCreating ? '建立中…' : '建立並生圖'}
            </button>
          </div>
        </form>
      ) : null}

      {subViews.length === 0 ? (
        <div className="rounded-sm border border-dashed border-stone-800/60 px-4 py-6 text-center font-fraunces text-xs italic text-stone-500">
          {showForm ? '填寫上方欄位以新增第一個視角' : '尚無額外視角 — 主視角已足以涵蓋大多數情境;角度落差大時新增'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {subViews.map((img) => {
            const regen = isRegenerating(img.imageIndex)
            return (
              <div
                key={img.id}
                className="group flex gap-3 rounded-sm border border-stone-800/60 bg-stone-900/30 p-3"
              >
                <div
                  className={`relative h-20 w-32 flex-shrink-0 overflow-hidden rounded-sm border border-stone-800 bg-gradient-to-br from-stone-800 to-stone-900 ${
                    img.imageUrl ? 'cursor-zoom-in' : ''
                  }`}
                  onClick={() => img.imageUrl && onZoomImage(img.imageUrl)}
                >
                  {img.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img.imageUrl} alt={img.viewName ?? `視角 ${img.imageIndex}`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <AppIcon name="image" className="h-5 w-5 text-stone-600" />
                    </div>
                  )}
                  {regen ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-stone-950/70 backdrop-blur-sm">
                      <AppIcon name="sparklesAlt" className="h-4 w-4 animate-pulse text-amber-400" />
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col">
                  <div className="font-serif-cn text-sm text-stone-100">
                    {img.viewName ?? `視角 ${img.imageIndex}`}
                  </div>
                  <div className="mt-1 line-clamp-2 font-body text-[11px] text-stone-500">
                    {img.description ?? <span className="italic">繼承主視角描述</span>}
                  </div>
                  <div className="mt-auto flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => onRegenerateView(img.imageIndex)}
                      disabled={regen}
                      className="rounded-sm border border-amber-500/40 px-2 py-1 font-mono text-[14px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/10 disabled:opacity-40"
                    >
                      {regen ? '生圖中…' : '重生'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(img.imageIndex, img.viewName ?? null)}
                      disabled={isDeleting}
                      className="rounded-sm border border-stone-700 px-2 py-1 font-mono text-[14px] tracking-wider text-stone-400 transition-colors hover:bg-stone-800 hover:text-rose-300 disabled:opacity-40"
                    >
                      刪除
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
