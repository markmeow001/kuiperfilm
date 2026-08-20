'use client'

/**
 * 脚本生成器步骤二「准备资产」——全局风格 + 角色/场景/道具卡片板。
 * 每张卡：设定图（上传或 AI 生成）、名称、描述、删除。生成走 playground run
 * 脊柱（gen.submitNode），完成后由 ScriptNode 的 ingest effect 换成 durable key。
 */
import { useRef, useState } from 'react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import type { CanvasGenerationValue } from '../lib/canvas-generation'
import type { CanvasScriptAsset } from '../lib/canvas-types'
import { ASSET_KIND_LABEL, assetImagePrompt, newScriptAssetId } from './script-gen-lib'

export interface AssetBoardProps {
  assets: readonly CanvasScriptAsset[]
  globalStyle: string
  gen: CanvasGenerationValue
  imageModelKey: string
  onSetGlobalStyle: (value: string) => void
  onEditAsset: (id: string, patch: Partial<CanvasScriptAsset>) => void
  onAddAsset: (asset: CanvasScriptAsset) => void
  onDeleteAsset: (id: string) => void
  onOpenBatchDialog: () => void
}

const KINDS: ReadonlyArray<CanvasScriptAsset['kind']> = ['character', 'scene', 'prop']

export function AssetBoard({
  assets,
  globalStyle,
  gen,
  imageModelKey,
  onSetGlobalStyle,
  onEditAsset,
  onAddAsset,
  onDeleteAsset,
  onOpenBatchDialog,
}: AssetBoardProps) {
  const missing = assets.filter((asset) => !asset.imageKey && !asset.runId)
  const missingByKind = (kind: CanvasScriptAsset['kind']) =>
    missing.filter((asset) => asset.kind === kind).length

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        <div className="flex items-start gap-2">
          <span
            className="mt-1 shrink-0 rounded px-1.5 py-0.5 text-[11px]"
            style={{ background: `${CANVAS_TOKENS.accent}26`, color: '#8FD3E8' }}
          >
            全局风格
          </span>
          <textarea
            value={globalStyle}
            rows={3}
            placeholder="全片统一的题材/媒介/色彩基调/光影特征/画质…"
            onChange={(e) => onSetGlobalStyle(e.target.value)}
            className="w-full resize-y rounded-md px-2.5 py-2 text-[13px] leading-relaxed outline-none"
            style={{ background: 'transparent', color: CANVAS_TOKENS.text.primary, border: `1px solid transparent` }}
          />
        </div>

        {KINDS.map((kind) => {
          const list = assets.filter((asset) => asset.kind === kind)
          return (
            <section key={kind}>
              <h3 className="mb-2 text-[13px]" style={{ color: CANVAS_TOKENS.text.secondary }}>{ASSET_KIND_LABEL[kind]}</h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {list.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    gen={gen}
                    globalStyle={globalStyle}
                    imageModelKey={imageModelKey}
                    onEdit={(patch) => onEditAsset(asset.id, patch)}
                    onDelete={() => onDeleteAsset(asset.id)}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => onAddAsset({
                    id: newScriptAssetId(),
                    kind,
                    name: '',
                    description: '',
                    imageKey: null,
                    imageUrl: null,
                    runId: null,
                  })}
                  className="flex min-h-[180px] flex-col items-center justify-center gap-1 rounded-lg text-[12px]"
                  style={{ border: `1px dashed ${CANVAS_TOKENS.hairline}`, color: CANVAS_TOKENS.text.muted }}
                >
                  <span className="text-[20px]">＋</span>
                  新增
                </button>
              </div>
            </section>
          )
        })}
      </div>

      <div
        className="mt-3 flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2.5"
        style={{ background: CANVAS_TOKENS.bg.panel, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
      >
        <span className="text-[12px]" style={{ color: missing.length > 0 ? CANVAS_TOKENS.gold : CANVAS_TOKENS.text.muted }}>
          {missing.length > 0
            ? `⚠ 检测到有 ${missingByKind('character')} 个人物角色和 ${missingByKind('scene')} 个场景和 ${missingByKind('prop')} 个道具没有设定图，您可以手动上传或 AI 批量生成`
            : '✓ 全部资产已有设定图'}
        </span>
        <button
          type="button"
          onClick={onOpenBatchDialog}
          disabled={missing.length === 0}
          className="shrink-0 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
          style={{ background: CANVAS_TOKENS.cta, color: CANVAS_TOKENS.ctaText }}
        >
          一键生成所有资产
        </button>
      </div>
    </div>
  )
}

function AssetCard({
  asset,
  gen,
  globalStyle,
  imageModelKey,
  onEdit,
  onDelete,
}: {
  asset: CanvasScriptAsset
  gen: CanvasGenerationValue
  globalStyle: string
  imageModelKey: string
  onEdit: (patch: Partial<CanvasScriptAsset>) => void
  onDelete: () => void
}) {
  const upload = useUploadPlaygroundReference()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  // runId 要等 submitNode 往返完成才落地——本地 pending 在第一个 await 前
  // 同步置位，双击不会提交两个计费 run（review #3）。
  const [submitting, setSubmitting] = useState(false)
  const run = gen.runById(asset.runId)
  const generating = submitting || (Boolean(asset.runId) && run?.status !== 'failed')

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    try {
      const result = await upload.mutateAsync({ file, type: 'image' })
      onEdit({ imageKey: result.key, imageUrl: result.signedUrl, runId: null })
    } catch (err) {
      setError((err as Error)?.message ?? '上传失败')
    }
  }

  async function handleGenerate() {
    if (generating) return
    if (!asset.name.trim() || !asset.description.trim()) {
      setError('先填名称与描述')
      return
    }
    if (!imageModelKey) {
      setError('无可用图片模型 — 请到 /profile 启用')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const runId = await gen.submitNode({
        prompt: assetImagePrompt(asset, globalStyle),
        outputType: 'image',
        modelKey: imageModelKey,
        aspectRatio: '1:1',
      })
      onEdit({ runId })
    } catch (err) {
      setError((err as Error)?.message ?? '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-lg p-2" style={{ border: `1px dashed ${CANVAS_TOKENS.hairline}` }}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending || generating}
        className="relative flex h-32 w-full items-center justify-center overflow-hidden rounded-md text-[11px]"
        style={{ background: CANVAS_TOKENS.bg.app, color: CANVAS_TOKENS.text.muted }}
      >
        {asset.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.imageUrl} alt={asset.name} className="h-full w-full object-cover" />
        ) : generating ? (
          '生成中…'
        ) : upload.isPending ? (
          '上传中…'
        ) : (
          `生成或上传${ASSET_KIND_LABEL[asset.kind]}图`
        )}
      </button>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePick} />
      <input
        value={asset.name}
        placeholder="名称"
        maxLength={40}
        onChange={(e) => onEdit({ name: e.target.value })}
        className="mt-2 w-full rounded px-1 text-[13px] outline-none focus:bg-white/5"
        style={{ background: 'transparent', color: CANVAS_TOKENS.text.primary }}
      />
      <textarea
        value={asset.description}
        placeholder="外观设定描述…"
        rows={2}
        onChange={(e) => onEdit({ description: e.target.value })}
        className="mt-1 w-full resize-none rounded px-1 text-[11px] leading-relaxed outline-none focus:bg-white/5"
        style={{ background: 'transparent', color: CANVAS_TOKENS.text.muted }}
      />
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <button type="button" onClick={handleGenerate} disabled={generating} style={{ color: '#8FD3E8' }} className="disabled:opacity-40">
          {generating ? '生成中…' : 'AI 生成'}
        </button>
        <button type="button" onClick={onDelete} style={{ color: '#FF8A8A' }}>删除</button>
      </div>
      {error ? <div className="mt-1 text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
    </div>
  )
}
