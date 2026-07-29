import type { ModelCapabilities } from '@/lib/model-config-contract'

export type VisualDevelopmentMediaType = 'image' | 'video'

export function getVisualDevelopmentAspectRatios(
  capabilities: ModelCapabilities | undefined,
  mediaType: VisualDevelopmentMediaType,
): string[] {
  const configured = mediaType === 'image'
    ? capabilities?.image?.aspectRatioOptions
    : capabilities?.video?.aspectRatioOptions
  if (configured?.length) return [...configured]
  // Fail closed. A generic list can expose values that a provider rejects.
  // Models without registered ratio capabilities stay on provider defaults
  // until their exact enum is added to the capability catalog.
  return []
}

export function pickVisualDevelopmentAspectRatio(
  ratios: readonly string[],
  mediaType: VisualDevelopmentMediaType,
): string {
  const preferred = mediaType === 'image'
    ? ['3:4', '4:5', '2:3', '9:16', '1:1', '16:9']
    : ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']
  return preferred.find((ratio) => ratios.includes(ratio)) ?? ratios[0] ?? ''
}

export function reconcileVisualDevelopmentAspectRatio(
  current: string,
  capabilities: ModelCapabilities | undefined,
  mediaType: VisualDevelopmentMediaType,
): string {
  const ratios = getVisualDevelopmentAspectRatios(capabilities, mediaType)
  return ratios.includes(current) ? current : pickVisualDevelopmentAspectRatio(ratios, mediaType)
}
