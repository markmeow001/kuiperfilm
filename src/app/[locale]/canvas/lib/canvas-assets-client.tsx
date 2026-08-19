'use client'

import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJsonWithError } from '@/lib/query/mutations/mutation-shared'
import type { CanvasAssetType } from '@/lib/canvas/canvas-assets-contract'
import { CANVAS_TOKENS } from './canvas-tokens'

export type CanvasAssetSource =
  | { kind: 'task'; taskId: string }
  | { kind: 'storage-key'; storageKey: string }

export interface CanvasAssetLibraryItem {
  id: string
  type: CanvasAssetType
  name: string
  folder: string | null
  description: string | null
  storageKey: string
  mediaUrl: string
  mimeType: string | null
  firstFrameKey: string | null
  firstFrameUrl: string | null
  lastFrameKey: string | null
  lastFrameUrl: string | null
  createdAt: string
}

const CanvasIdContext = createContext<string | null>(null)

export function CanvasAssetsProvider({ canvasId, children }: { canvasId: string | null; children: ReactNode }) {
  return <CanvasIdContext.Provider value={canvasId}>{children}</CanvasIdContext.Provider>
}

export function useActiveCanvasId(): string | null {
  return useContext(CanvasIdContext)
}

export function useCanvasAssetLibrary(canvasId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['canvasAssets', canvasId],
    enabled: enabled && Boolean(canvasId),
    staleTime: 30_000,
    queryFn: async () => {
      const data = await requestJsonWithError(
        `/api/canvas/assets?canvasId=${encodeURIComponent(canvasId!)}`,
        { method: 'GET' },
        '加载资产库失败',
      ) as { assets?: CanvasAssetLibraryItem[] }
      return data.assets ?? []
    },
  })
}

interface SaveButtonProps {
  source: CanvasAssetSource | null
  defaultName: string
  allowedTypes: CanvasAssetType[]
  firstFrameKey?: string | null
  lastFrameKey?: string | null
  /** 'full' = panel full-width button; 'chip' = compact result-hover trigger. */
  variant?: 'full' | 'chip'
}

const TYPE_LABEL: Record<CanvasAssetType, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  image: '图片',
  video: '视频',
}

export function SaveCanvasAssetButton({ source, defaultName, allowedTypes, firstFrameKey, lastFrameKey, variant = 'full' }: SaveButtonProps) {
  const canvasId = useContext(CanvasIdContext)
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [type, setType] = useState<CanvasAssetType>(allowedTypes[0])
  const [folder, setFolder] = useState('')
  const [description, setDescription] = useState('')
  const mutation = useMutation({
    mutationFn: async () => requestJsonWithError('/api/canvas/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canvasId,
        name,
        type,
        folder: folder || undefined,
        description: description || undefined,
        source,
        firstFrameKey: firstFrameKey || undefined,
        lastFrameKey: lastFrameKey || undefined,
      }),
    }, '保存资产失败'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['canvasAssets', canvasId] })
      setOpen(false)
    },
  })

  if (!source) return null
  const disabled = !canvasId
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!disabled && name.trim()) mutation.mutate()
  }

  const openDialog = () => {
    mutation.reset()
    setName(defaultName)
    setType(allowedTypes[0])
    setFolder('')
    setDescription('')
    setOpen(true)
  }

  return <>
    {variant === 'chip' ? (
      <button
        type="button"
        disabled={disabled}
        title={disabled ? '画布保存完成后才能入库' : '存资产（角色 / 场景 / 图片）'}
        onClick={openDialog}
        className="nodrag rounded-md px-2 py-1 text-[11px] disabled:opacity-40"
        style={{ background: `${CANVAS_TOKENS.bg.canvas}e6`, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
      >
        ＋ 存资产
      </button>
    ) : (
      <button
        type="button"
        disabled={disabled}
        title={disabled ? '画布保存完成后才能入库' : '保存到资产库'}
        onClick={openDialog}
        className="nodrag w-full rounded-md px-2 py-1 text-[11px] disabled:opacity-40"
        style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
      >
        保存到资产库
      </button>
    )}
    {open && typeof document !== 'undefined' ? createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onMouseDown={() => setOpen(false)}>
        <form onSubmit={submit} onMouseDown={(event) => event.stopPropagation()} className="w-[380px] space-y-3 rounded-xl p-4" style={{ background: CANVAS_TOKENS.bg.panel, border: `1px solid ${CANVAS_TOKENS.hairline}`, color: CANVAS_TOKENS.text.primary }}>
          <div className="text-[14px] font-semibold">保存到资产库</div>
          <label className="block text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>名称<input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-md px-2 py-1.5 outline-none" style={{ background: CANVAS_TOKENS.bg.input, border: `1px solid ${CANVAS_TOKENS.hairline}` }} /></label>
          <label className="block text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>类型<select value={type} onChange={(event) => setType(event.target.value as CanvasAssetType)} className="mt-1 w-full rounded-md px-2 py-1.5" style={{ background: CANVAS_TOKENS.bg.input, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>{allowedTypes.map((value) => <option key={value} value={value}>{TYPE_LABEL[value]}</option>)}</select></label>
          <label className="block text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>分类文件夹<input value={folder} maxLength={120} onChange={(event) => setFolder(event.target.value)} placeholder="例如：主要角色" className="mt-1 w-full rounded-md px-2 py-1.5 outline-none" style={{ background: CANVAS_TOKENS.bg.input, border: `1px solid ${CANVAS_TOKENS.hairline}` }} /></label>
          <label className="block text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>说明<textarea value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1 w-full resize-y rounded-md px-2 py-1.5 outline-none" style={{ background: CANVAS_TOKENS.bg.input, border: `1px solid ${CANVAS_TOKENS.hairline}` }} /></label>
          {mutation.error ? <div className="text-[11px]" style={{ color: '#FF8A8A' }}>{mutation.error.message}</div> : null}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-[12px]">取消</button><button type="submit" disabled={mutation.isPending || !name.trim()} className="rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40" style={{ background: CANVAS_TOKENS.cta, color: CANVAS_TOKENS.ctaText }}>{mutation.isPending ? '保存中…' : '保存'}</button></div>
        </form>
      </div>,
      document.body,
    ) : null}
  </>
}
