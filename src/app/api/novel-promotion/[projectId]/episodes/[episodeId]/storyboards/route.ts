/**
 * GET /api/novel-promotion/[projectId]/episodes/[episodeId]/storyboards
 *
 * Lists every storyboard belonging to the episode, with a one-line
 * preview (description + location + character names from the first
 * panel) so the user can identify which storyboard contains the stale
 * panels they want to remove.
 *
 * 2026-05-13 — added to support the "stale panel cleanup" UX after a
 * partial script_to_storyboard re-analyze. The orchestrator's per-clip
 * atomic-replace strategy means that if clip N's phase2 / phase3
 * fails, clip N's previous panels stay in the DB intact while the
 * other clips' panels are replaced. Result: leftover panels from a
 * stale analyze pollute downstream auto-grouping and storyboard
 * playback. This endpoint surfaces those storyboards so the user can
 * delete them via the sibling DELETE handler.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

interface PanelPreview {
  id: string
  panelIndex: number
  description: string
  location: string
  characterNames: string[]
}

interface StoryboardSummary {
  id: string
  clipId: string
  createdAt: string
  updatedAt: string
  panelCount: number
  lastError: string | null
  firstPanel: PanelPreview | null
}

function parseCharacterNames(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    for (const item of parsed) {
      if (typeof item === 'string') {
        const trimmed = item.trim()
        if (trimmed) out.push(trimmed)
      } else if (item && typeof item === 'object') {
        const r = item as { name?: unknown }
        if (typeof r.name === 'string' && r.name.trim()) out.push(r.name.trim())
      }
    }
    return out
  } catch {
    return []
  }
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
) => {
  const { projectId, episodeId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      novelPromotionProject: {
        select: { id: true, projectId: true },
      },
      storyboards: {
        select: {
          id: true,
          clipId: true,
          createdAt: true,
          updatedAt: true,
          lastError: true,
          panels: {
            select: {
              id: true,
              panelIndex: true,
              description: true,
              location: true,
              characters: true,
            },
            orderBy: { panelIndex: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_FOUND' })
  }
  if (episode.novelPromotionProject?.projectId !== projectId) {
    throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_IN_PROJECT' })
  }

  const storyboards: StoryboardSummary[] = episode.storyboards.map((sb) => {
    const first = sb.panels[0]
    const firstPreview: PanelPreview | null = first
      ? {
          id: first.id,
          panelIndex: first.panelIndex,
          description: (first.description ?? '').slice(0, 200),
          location: (first.location ?? '').slice(0, 80),
          characterNames: parseCharacterNames(first.characters),
        }
      : null
    return {
      id: sb.id,
      clipId: sb.clipId,
      createdAt: sb.createdAt.toISOString(),
      updatedAt: sb.updatedAt.toISOString(),
      panelCount: sb.panels.length,
      lastError: sb.lastError,
      firstPanel: firstPreview,
    }
  })

  return NextResponse.json({ storyboards })
})
