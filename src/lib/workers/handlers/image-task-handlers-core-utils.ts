import { createScopedLogger } from '@/lib/logging/core'

export const logger = createScopedLogger({ module: 'worker.modify-asset-image' })

export interface LocationImageRecord {
  id: string
  locationId: string
  imageUrl: string | null
  location: {
    name: string
  } | null
}

/** Collect extra reference image URLs from a payload array, filtering out blank entries. */
export function collectExtraReferenceUrls(extraImageUrls: unknown): string[] {
  if (!Array.isArray(extraImageUrls)) return []
  const result: string[] = []
  for (const url of extraImageUrls) {
    if (typeof url === 'string' && url.trim().length > 0) {
      result.push(url.trim())
    }
  }
  return result
}
