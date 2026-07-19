const BACKGROUND_ASPECT_RATIOS = [
  { value: '16:9', ratio: 16 / 9 },
  { value: '9:16', ratio: 9 / 16 },
  { value: '4:3', ratio: 4 / 3 },
  { value: '3:4', ratio: 3 / 4 },
  { value: '1:1', ratio: 1 },
] as const

export function closestBackgroundAspectRatio(width?: number, height?: number): string {
  if (!width || !height || width <= 0 || height <= 0) return '16:9'
  const ratio = width / height
  return BACKGROUND_ASPECT_RATIOS.reduce((closest, candidate) => (
    Math.abs(candidate.ratio - ratio) < Math.abs(closest.ratio - ratio) ? candidate : closest
  )).value
}

export function generatedBackgroundDownloadHref(resultUrl: string): string {
  const trimmed = resultUrl.trim()
  if (!trimmed) throw new Error('生成任務沒有回傳背景圖片')
  return `/api/playground/download?${new URLSearchParams({ url: trimmed, filename: 'live-composite-background.png' }).toString()}`
}

export async function downloadGeneratedBackground(resultUrl: string, signal?: AbortSignal): Promise<File> {
  const response = await fetch(generatedBackgroundDownloadHref(resultUrl), { signal })
  if (!response.ok) throw new Error(`下載生成背景失敗（${response.status}）`)
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('生成結果不是可用的圖片格式')
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
  return new File([blob], `ai-background.${extension}`, { type: blob.type })
}
