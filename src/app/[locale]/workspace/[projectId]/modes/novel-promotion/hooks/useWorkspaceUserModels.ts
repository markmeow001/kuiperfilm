'use client'

import { useEffect, useMemo } from 'react'
import { logError as _ulogError } from '@/lib/logging/core'
import { useUserModels } from '@/lib/query/hooks'
import type { ModelCapabilities } from '@/lib/model-config-contract'
import type { VideoPricingTier } from '@/lib/model-pricing/video-tier'

export interface UserModelOption {
  value: string
  label: string
  provider?: string
  providerName?: string
  capabilities?: ModelCapabilities
  videoPricingTiers?: VideoPricingTier[]
}

export interface UserModelsPayload {
  llm: UserModelOption[]
  image: UserModelOption[]
  video: UserModelOption[]
  audio: UserModelOption[]
  lipsync: UserModelOption[]
}

export function useWorkspaceUserModels() {
  const userModelsQuery = useUserModels()
  const userModelsForSettings = (userModelsQuery.data || null) as UserModelsPayload | null
  const userVideoModels = useMemo<UserModelOption[]>(() => {
    if (!userModelsForSettings || !Array.isArray(userModelsForSettings.video)) return []
    // 仅允许 AtlasCloud 视频模型
    const allowed = userModelsForSettings.video.filter(
      (m) =>
        m.value === 'atlascloud::seedance-v1.5-pro' ||
        m.value === 'atlascloud::wan-2.6' ||
        m.value === 'atlascloud::seedance-2.0-t2v' ||
        m.value === 'atlascloud::seedance-2.0-i2v' ||
        m.value === 'atlascloud::seedance-2.0-r2v' ||
        m.value === 'atlascloud::seedance-2.0-fast-t2v' ||
        m.value === 'atlascloud::seedance-2.0-fast-i2v' ||
        m.value === 'atlascloud::seedance-2.0-fast-r2v'
    )
    return allowed.length > 0 ? allowed : userModelsForSettings.video
  }, [userModelsForSettings])
  const userModelsLoaded = userModelsQuery.isFetched

  useEffect(() => {
    if (userModelsQuery.error) {
      _ulogError('Failed to fetch user models:', userModelsQuery.error)
    }
  }, [userModelsQuery.error])

  return {
    userModelsForSettings,
    userVideoModels,
    userModelsLoaded,
  }
}
