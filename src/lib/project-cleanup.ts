/**
 * Phase 12.5 — project hard-delete helpers, shared between
 * scripts/workspace-collab-cron.ts and (legacy/admin) imperative
 * delete paths.
 *
 * Soft-delete (DELETE /api/projects/:id) only sets `deletedAt`. The
 * 30-day grace cron in workspace-collab-cron.ts uses these helpers
 * to actually drop the row + COS objects once the window closes.
 */
import { prisma } from '@/lib/prisma'
import { deleteCOSObjects } from '@/lib/cos'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { logInfo as _ulogInfo } from '@/lib/logging/core'

/**
 * Collect every COS object key the project owns.
 * Walks: characters→appearances, locations→images, episodes→
 * audio + storyboards→{storyboardImage, candidateImages, panels→
 * imageUrl + videoUrl}.
 */
export async function collectProjectCOSKeys(projectId: string): Promise<string[]> {
  const keys: string[] = []

  const novelPromotion = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: { include: { appearances: true } },
      locations: { include: { images: true } },
      episodes: {
        include: {
          storyboards: { include: { panels: true } },
        },
      },
    },
  })

  if (!novelPromotion) return keys

  for (const character of novelPromotion.characters) {
    for (const appearance of character.appearances) {
      const key = await resolveStorageKeyFromMediaValue(appearance.imageUrl)
      if (key) keys.push(key)
    }
  }

  for (const location of novelPromotion.locations) {
    for (const image of location.images) {
      const key = await resolveStorageKeyFromMediaValue(image.imageUrl)
      if (key) keys.push(key)
    }
  }

  for (const episode of novelPromotion.episodes) {
    const audioKey = await resolveStorageKeyFromMediaValue(episode.audioUrl)
    if (audioKey) keys.push(audioKey)

    for (const storyboard of episode.storyboards) {
      const sbKey = await resolveStorageKeyFromMediaValue(storyboard.storyboardImageUrl)
      if (sbKey) keys.push(sbKey)

      if (storyboard.candidateImages) {
        try {
          const candidates = JSON.parse(storyboard.candidateImages)
          if (Array.isArray(candidates)) {
            for (const url of candidates) {
              const key = await resolveStorageKeyFromMediaValue(url)
              if (key) keys.push(key)
            }
          }
        } catch {
          // candidateImages is occasionally non-JSON legacy data; ignore.
        }
      }

      for (const panel of storyboard.panels) {
        const imgKey = await resolveStorageKeyFromMediaValue(panel.imageUrl)
        if (imgKey) keys.push(imgKey)

        const videoKey = await resolveStorageKeyFromMediaValue(panel.videoUrl)
        if (videoKey) keys.push(videoKey)
      }
    }
  }

  _ulogInfo(`[Project ${projectId}] 收集到 ${keys.length} 个 COS 文件待删除`)
  return keys
}

/**
 * Hard-delete a project — assumes caller has already verified
 * `deletedAt` is set and outside the restore window. Best-effort
 * removes COS objects first, then drops the row (cascade clears
 * child rows via Prisma onDelete).
 *
 * Returns counts so the caller (cron) can log meaningful stats.
 */
export async function hardDeleteProject(projectId: string): Promise<{
  cosSuccess: number
  cosFailed: number
  rowDropped: boolean
}> {
  const keys = await collectProjectCOSKeys(projectId)

  let cosSuccess = 0
  let cosFailed = 0
  if (keys.length > 0) {
    try {
      const result = await deleteCOSObjects(keys)
      cosSuccess = result.success
      cosFailed = result.failed
    } catch (err) {
      // Don't block DB delete — orphaned COS objects are recoverable
      // via bucket lifecycle policy. Worse outcome would be a row
      // we can't delete because COS is flaky.
      _ulogInfo(`[Project ${projectId}] COS cleanup error: ${err instanceof Error ? err.message : String(err)}`)
      cosFailed = keys.length
    }
  }

  try {
    await prisma.project.delete({ where: { id: projectId } })
    return { cosSuccess, cosFailed, rowDropped: true }
  } catch (err) {
    _ulogInfo(`[Project ${projectId}] DB delete failed: ${err instanceof Error ? err.message : String(err)}`)
    return { cosSuccess, cosFailed, rowDropped: false }
  }
}
