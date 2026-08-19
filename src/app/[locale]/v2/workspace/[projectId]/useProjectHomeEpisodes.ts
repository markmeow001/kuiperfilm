'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import type { ProjectHomeEpisode, ProjectHomeEpisodeProgress } from './project-home-model'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string') {
    throw new Error(`劇集資料格式錯誤：${field} 必須是字串`)
  }
  return value
}

function nullableString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field]
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new Error(`劇集資料格式錯誤：${field} 必須是字串或 null`)
  }
  return value
}

function requiredNonNegativeNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`劇集資料格式錯誤：${field} 必須是非負數字`)
  }
  return value
}

function parseProgress(value: unknown): ProjectHomeEpisodeProgress {
  if (!isRecord(value)) {
    throw new Error('劇集資料格式錯誤：progress 不存在')
  }
  return {
    scriptDone: requiredNonNegativeNumber(value, 'scriptDone'),
    scriptTotal: requiredNonNegativeNumber(value, 'scriptTotal'),
    storyboardDone: requiredNonNegativeNumber(value, 'storyboardDone'),
    storyboardTotal: requiredNonNegativeNumber(value, 'storyboardTotal'),
    videoDone: requiredNonNegativeNumber(value, 'videoDone'),
    videoTotal: requiredNonNegativeNumber(value, 'videoTotal'),
  }
}

function parseEpisode(value: unknown, index: number): ProjectHomeEpisode {
  if (!isRecord(value)) {
    throw new Error(`劇集資料格式錯誤：episodes[${index}] 不是物件`)
  }
  const episodeNumber = requiredNonNegativeNumber(value, 'episodeNumber')
  if (!Number.isInteger(episodeNumber)) {
    throw new Error('劇集資料格式錯誤：episodeNumber 必須是整數')
  }
  return {
    id: requiredString(value, 'id'),
    episodeNumber,
    name: requiredString(value, 'name'),
    description: nullableString(value, 'description'),
    novelText: nullableString(value, 'novelText'),
    createdAt: requiredString(value, 'createdAt'),
    updatedAt: requiredString(value, 'updatedAt'),
    progress: parseProgress(value.progress),
    thumbnailUrl: nullableString(value, 'thumbnailUrl'),
  }
}

export function parseProjectHomeEpisodes(payload: unknown): ProjectHomeEpisode[] {
  if (!isRecord(payload) || !Array.isArray(payload.episodes)) {
    throw new Error('劇集回應格式錯誤：缺少 episodes 陣列')
  }
  return payload.episodes.map(parseEpisode)
}

export function useProjectHomeEpisodes(projectId: string) {
  return useQuery({
    queryKey: queryKeys.project.episodes(projectId),
    queryFn: async () => {
      const response = await fetch(`/api/novel-promotion/${projectId}/episodes`)
      if (!response.ok) {
        throw new Error(`讀取劇集進度失敗：HTTP ${response.status}`)
      }
      return parseProjectHomeEpisodes(await response.json())
    },
    staleTime: 5_000,
  })
}
