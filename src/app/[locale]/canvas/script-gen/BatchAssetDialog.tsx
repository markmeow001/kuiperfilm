'use client'

/**
 * 「一键生成所有资产」对话框：勾选缺图资产、微调描述、选生图模型与比例，
 * 顺序提交（避免瞬间打爆队列/余额；单发失败立即停，后续不再扣费）。
 */
import { useMemo, useState } from 'react'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import type { CanvasGenerationValue } from '../lib/canvas-generation'
import type { CanvasScriptAsset } from '../lib/canvas-types'
import { ASSET_KIND_LABEL, assetImagePrompt } from './script-gen-lib'

const ASPECTS = ['1:1', '2:1', '3:4', '9:16', '16:9'] as const

export function BatchAssetDialog({
  assets,
  globalStyle,
  gen,
  defaultModelKey,
  onEditAsset,
  onClose,
}: {
  /** 缺图资产（无 imageKey 且无 runId）。 */
  assets: readonly CanvasScriptAsset[]
  globalStyle: string
  gen: CanvasGenerationValue
  defaultModelKey: string
  onEditAsset: (id: string, patch: Partial<CanvasScriptAsset>) => void
  onClose: () => void
}) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [modelKey, setModelKey] = useState(defaultModelKey)
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>('1:1')
  const [progress, setProgress] = useState<{ done: number; total: number; running: boolean; error: string | null }>(
    { done: 0, total: 0, running: false, error: null },
  )

  const selected = useMemo(
    () => assets.filter((asset) => !excluded.has(asset.id) && asset.name.trim() && asset.description.trim()),
    [assets, excluded],
  )

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleGenerate() {
    if (selected.length === 0 || progress.running || !modelKey) return
    setProgress({ done: 0, total: selected.length, running: true, error: null })
    for (let i = 0; i < selected.length; i++) {
      const asset = selected[i]
      try {
        const runId = await gen.submitNode({
          prompt: assetImagePrompt(asset, globalStyle),
          outputType: 'image',
          modelKey,
          aspectRatio: aspect,
        })
        onEditAsset(asset.id, { runId })
        setProgress((p) => ({ ...p, done: i + 1 }))
      } catch (err) {
        setProgress((p) => ({
          ...p,
          running: false,
          error: `「${asset.name}」提交失败：${(err as Error)?.message ?? '未知错误'}（其余已停止）`,
        }))
        return
      }
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="一键生成所有资产"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl p-5"
        style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: CANVAS_TOKENS.shadowPopover }}
      >
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h2 className="text-[16px] font-semibold" style={{ color: CANVAS_TOKENS.text.primary }}>一键生成所有资产</h2>
          <button type="button" onClick={onClose} aria-label="关闭" style={{ color: CANVAS_TOKENS.text.muted }}>✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {assets.map((asset) => (
            <div key={asset.id} className="rounded-lg p-3" style={{ border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
              <label className="flex items-center gap-2 text-[13px]" style={{ color: CANVAS_TOKENS.text.primary }}>
                <input
                  type="checkbox"
                  checked={!excluded.has(asset.id)}
                  onChange={() => toggle(asset.id)}
                  className="h-4 w-4 accent-current"
                />
                {asset.name || '（未命名）'}
                <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.muted }}>
                  {ASSET_KIND_LABEL[asset.kind]}
                </span>
              </label>
              <textarea
                value={asset.description}
                rows={2}
                placeholder="外观设定描述…"
                onChange={(e) => onEditAsset(asset.id, { description: e.target.value })}
                className="mt-2 w-full resize-y rounded-md px-2 py-1.5 text-[12px] leading-relaxed outline-none"
                style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              />
            </div>
          ))}
        </div>

        {progress.error ? <div className="mt-2 shrink-0 text-[12px]" style={{ color: '#FF8A8A' }}>{progress.error}</div> : null}

        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-[12px]" style={{ color: CANVAS_TOKENS.text.muted }}>已选 {selected.length}/{assets.length}</span>
          <select
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value)}
            className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 font-mono text-[12px] outline-none"
            style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
          >
            {gen.imageModels.length === 0 ? <option value="">无可用模型 · 去 /profile 启用</option> : null}
            {gen.imageModels.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value as (typeof ASPECTS)[number])}
            className="rounded-md px-2 py-1.5 font-mono text-[12px] outline-none"
            style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
          >
            {ASPECTS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={selected.length === 0 || progress.running || !modelKey}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
            style={{ background: '#FFFFFF', color: '#111' }}
          >
            {progress.running ? `提交中… ${progress.done}/${progress.total}` : `生成(${selected.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}
