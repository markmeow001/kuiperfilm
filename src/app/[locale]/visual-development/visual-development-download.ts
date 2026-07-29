export function visualDevelopmentDownloadHref(url: string, filename: string): string {
  const query = new URLSearchParams({ url, filename })
  return `/api/playground/download?${query.toString()}`
}
