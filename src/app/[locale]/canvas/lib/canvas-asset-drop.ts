import type { CanvasAssetLibraryItem } from './canvas-assets-client'
import type { CanvasNodeData } from './canvas-types'
import type { CanvasNodeType } from './canvas-tokens'

export function canvasAssetNodeType(asset: CanvasAssetLibraryItem): CanvasNodeType {
  if (asset.type === 'character') return 'character'
  if (asset.type === 'video') return 'video'
  return 'image'
}

/** Map a library item back to a node without degrading its durable storage key. */
export function canvasAssetNodeData(asset: CanvasAssetLibraryItem): Partial<CanvasNodeData> {
  const type = canvasAssetNodeType(asset)
  if (type === 'video') {
    return {
      title: asset.name,
      resultUrl: asset.mediaUrl,
      assetStorageKey: asset.storageKey,
      referenceVideoKey: asset.storageKey,
      referenceVideoUrl: asset.mediaUrl,
      tailFrameUrl: asset.lastFrameUrl,
    }
  }
  return {
    title: asset.name,
    resultUrl: asset.mediaUrl,
    assetStorageKey: asset.storageKey,
    referenceKey: asset.storageKey,
  }
}
