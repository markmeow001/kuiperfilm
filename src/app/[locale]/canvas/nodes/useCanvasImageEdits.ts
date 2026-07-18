'use client'

import { useState } from 'react'
import { useReactFlow, type Node } from '@xyflow/react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { useCanvasGeneration } from '../lib/canvas-generation'
import { centerCropRect, outpaintGeometry } from '../lib/canvas-image-edit'
import { canvasDownloadHref } from '../lib/canvas-download'
import { DEFAULT_NODE_DATA, type CanvasNodeData } from '../lib/canvas-types'

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('CANVAS_IMAGE_ENCODE_FAILED')), 'image/png')
  })
}

async function loadSourceBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(canvasDownloadHref(url, 'canvas-edit-source'))
  if (!response.ok) throw new Error(`读取来源图片失败（${response.status}）`)
  return await createImageBitmap(await response.blob())
}

function versionData(id: string, data: CanvasNodeData, operation: 'crop' | 'outpaint', aspectRatio: string) {
  return {
    rootNodeId: data.imageVersion?.rootNodeId ?? id,
    parentNodeId: id,
    version: (data.imageVersion?.version ?? 0) + 1,
    operation,
    aspectRatio,
  } as const
}

export function useCanvasImageEdits(input: {
  nodeId: string
  data: CanvasNodeData
  sourceUrl: string | null
}) {
  const { addNodes, getNode } = useReactFlow()
  const upload = useUploadPlaygroundReference()
  const generation = useCanvasGeneration()
  const [busy, setBusy] = useState<'crop' | 'outpaint' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const spawn = (data: CanvasNodeData) => {
    const self = getNode(input.nodeId)
    const version = data.imageVersion?.version ?? 1
    addNodes({
      id: `n_${Date.now()}_edit_${version}`,
      type: 'image',
      position: { x: (self?.position.x ?? 0) + 360, y: (self?.position.y ?? 0) + (version - 1) * 48 },
      data,
    } satisfies Node<CanvasNodeData>)
  }

  const crop = async (aspectRatio: string) => {
    if (!input.sourceUrl || busy) return
    setBusy('crop'); setError(null)
    let bitmap: ImageBitmap | null = null
    try {
      bitmap = await loadSourceBitmap(input.sourceUrl)
      const rect = centerCropRect(bitmap.width, bitmap.height, aspectRatio)
      const canvas = document.createElement('canvas')
      canvas.width = rect.width
      canvas.height = rect.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('CANVAS_2D_CONTEXT_UNAVAILABLE')
      context.drawImage(bitmap, rect.left, rect.top, rect.width, rect.height, 0, 0, rect.width, rect.height)
      const uploaded = await upload.mutateAsync({ file: new File([await canvasBlob(canvas)], 'canvas-crop.png', { type: 'image/png' }), type: 'image' })
      const imageVersion = versionData(input.nodeId, input.data, 'crop', aspectRatio)
      spawn({
        ...DEFAULT_NODE_DATA,
        title: `${input.data.title} · 裁切 v${imageVersion.version}`,
        prompt: input.data.prompt,
        modelKey: input.data.modelKey,
        aspectRatio,
        resultUrl: uploaded.signedUrl,
        anchorKey: uploaded.key,
        anchorUrl: uploaded.signedUrl,
        referenceKey: uploaded.key,
        imageVersion,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '裁切失败')
    } finally {
      bitmap?.close()
      setBusy(null)
    }
  }

  const outpaint = async (aspectRatio: string, prompt: string) => {
    if (!input.sourceUrl || busy) return
    const model = generation.imageModels.find((candidate) => candidate.capabilities?.image?.supportMaskEdit === true)
    if (!model) {
      setError('没有已启用的局部重绘模型；请在 /profile 启用 GPT Image 1')
      return
    }
    if (!prompt.trim()) {
      setError('请先描述要向外补出的环境内容')
      return
    }
    setBusy('outpaint'); setError(null)
    let bitmap: ImageBitmap | null = null
    try {
      bitmap = await loadSourceBitmap(input.sourceUrl)
      const geometry = outpaintGeometry(bitmap.width, bitmap.height, aspectRatio)
      const plate = document.createElement('canvas')
      plate.width = geometry.width
      plate.height = geometry.height
      const plateContext = plate.getContext('2d')
      if (!plateContext) throw new Error('CANVAS_2D_CONTEXT_UNAVAILABLE')
      plateContext.clearRect(0, 0, geometry.width, geometry.height)
      plateContext.drawImage(bitmap, geometry.source.left, geometry.source.top)

      const mask = document.createElement('canvas')
      mask.width = geometry.width
      mask.height = geometry.height
      const maskContext = mask.getContext('2d')
      if (!maskContext) throw new Error('CANVAS_2D_CONTEXT_UNAVAILABLE')
      maskContext.clearRect(0, 0, geometry.width, geometry.height)
      maskContext.fillStyle = '#ffffff'
      maskContext.fillRect(geometry.source.left, geometry.source.top, geometry.source.width, geometry.source.height)

      const [plateUpload, maskUpload] = await Promise.all([
        canvasBlob(plate).then((blob) => upload.mutateAsync({ file: new File([blob], 'canvas-outpaint-plate.png', { type: 'image/png' }), type: 'image' })),
        canvasBlob(mask).then((blob) => upload.mutateAsync({ file: new File([blob], 'canvas-outpaint-mask.png', { type: 'image/png' }), type: 'image' })),
      ])
      const runId = await generation.submitNode({
        prompt: prompt.trim(),
        outputType: 'image',
        modelKey: model.value,
        aspectRatio,
        referenceImages: [plateUpload.key],
        maskImage: maskUpload.key,
      })
      const imageVersion = versionData(input.nodeId, input.data, 'outpaint', aspectRatio)
      spawn({
        ...DEFAULT_NODE_DATA,
        title: `${input.data.title} · 扩图 v${imageVersion.version}`,
        prompt: prompt.trim(),
        modelKey: model.value,
        aspectRatio,
        anchorKey: plateUpload.key,
        anchorUrl: plateUpload.signedUrl,
        runId,
        imageVersion,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '扩图失败')
    } finally {
      bitmap?.close()
      setBusy(null)
    }
  }

  return { crop, outpaint, busy, error, clearError: () => setError(null) }
}
