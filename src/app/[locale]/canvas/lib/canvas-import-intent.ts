export interface CanvasImportIntent {
  canvasId: string
  assetId: string
}

export function parseCanvasImportIntent(input: {
  canvas?: string | string[]
  asset?: string | string[]
}): CanvasImportIntent | null {
  const canvasId = typeof input.canvas === 'string' ? input.canvas.trim() : ''
  const assetId = typeof input.asset === 'string' ? input.asset.trim() : ''
  return canvasId && assetId ? { canvasId, assetId } : null
}

export function buildCanvasImportHref(locale: string, intent: CanvasImportIntent): string {
  const params = new URLSearchParams({ canvas: intent.canvasId, asset: intent.assetId })
  return `/${encodeURIComponent(locale)}/canvas?${params.toString()}`
}

export function clearCanvasImportAssetFromHref(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('asset')
  return `${url.pathname}${url.search}${url.hash}`
}
