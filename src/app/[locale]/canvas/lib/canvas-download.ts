/**
 * Same-origin download href for canvas result media.
 *
 * A direct `<a download>` to the R2/COS URL is ignored cross-origin (the file
 * just opens in a new tab), so downloads route through /api/playground/download,
 * which re-streams with Content-Disposition: attachment → a real save-to-disk.
 * The route already SSRF/cross-user guards the `url` (own key or https storage
 * URL only), so canvas nodes reuse it as-is.
 */
export function canvasDownloadHref(url: string, filename?: string): string {
  const params = new URLSearchParams({ url })
  const trimmed = (filename ?? '').trim()
  if (trimmed) params.set('filename', trimmed)
  return `/api/playground/download?${params.toString()}`
}
