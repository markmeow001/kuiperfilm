import { Prisma, type PanelGenerationMode } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { defaultPanelGenerationMode } from '@/lib/novel-promotion/generation-mode'
import {
  deriveManualPanelInsertId,
  normalizeManualStoryboardIdempotencyKey,
  parseManualStoryboardInitialPanel,
  type ManualStoryboardInitialPanel,
} from '@/lib/novel-promotion/manual-storyboard-create'

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>
}

type PanelPosition = 'before' | 'after'
type PanelDirection = 'earlier' | 'later'

interface OrderedPanel {
  id: string
  storyboardId: string
  panelIndex: number
  panelNumber: number | null
  multiShotGroupId: string | null
  multiShotGroupOrder: number | null
  description: string | null
  characters: string | null
  location: string | null
  duration: number | null
}

interface OwnedEpisode {
  id: string
  novelPromotionProject: { generationMode: string | null } | null
}

const PANEL_INDEX_PARK_OFFSET = 1_000_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!isRecord(body)) throw new ApiError('INVALID_PARAMS')
  return body
}

function parseManualPanel(value: unknown): ManualStoryboardInitialPanel {
  try {
    const panel = parseManualStoryboardInitialPanel(value)
    if (!panel) throw new Error('missing panel')
    return panel
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }
}

function parseIdempotencyKey(value: unknown): string {
  try {
    return normalizeManualStoryboardIdempotencyKey(value)
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }
}

function parsePosition(value: unknown): PanelPosition {
  if (value !== 'before' && value !== 'after') {
    throw new ApiError('INVALID_PARAMS')
  }
  return value
}

function parseDirection(value: unknown): PanelDirection {
  if (value !== 'earlier' && value !== 'later') {
    throw new ApiError('INVALID_PARAMS')
  }
  return value
}

function readRequiredId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError('INVALID_PARAMS')
  }
  return value.trim()
}

async function lockOwnedEpisode(
  tx: Prisma.TransactionClient,
  projectId: string,
  episodeId: string,
): Promise<OwnedEpisode> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT episode.id
    FROM novel_promotion_episodes AS episode
    INNER JOIN novel_promotion_projects AS novel_project
      ON novel_project.id = episode.novelPromotionProjectId
    WHERE episode.id = ${episodeId}
      AND novel_project.projectId = ${projectId}
    FOR UPDATE
  `)
  if (locked.length !== 1) throw new ApiError('NOT_FOUND')

  const episode = await tx.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    select: {
      id: true,
      novelPromotionProject: { select: { generationMode: true } },
    },
  })
  if (!episode) throw new ApiError('NOT_FOUND')
  return episode
}

async function readOrderedPanels(
  tx: Prisma.TransactionClient,
  projectId: string,
  episodeId: string,
): Promise<OrderedPanel[]> {
  return await tx.novelPromotionPanel.findMany({
    where: {
      storyboard: {
        episodeId,
        episode: { novelPromotionProject: { projectId } },
      },
    },
    orderBy: [{ storyboardId: 'asc' }, { panelIndex: 'asc' }],
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      panelNumber: true,
      multiShotGroupId: true,
      multiShotGroupOrder: true,
      description: true,
      characters: true,
      location: true,
      duration: true,
    },
  })
}

function panelsInStoryboard(panels: OrderedPanel[], storyboardId: string): OrderedPanel[] {
  return panels.filter((panel) => panel.storyboardId === storyboardId)
}

async function parkStoryboardPanelIndexes(
  tx: Prisma.TransactionClient,
  projectId: string,
  episodeId: string,
  storyboardId: string,
): Promise<void> {
  const parked = await tx.novelPromotionPanel.updateMany({
    where: {
      storyboardId,
      panelIndex: { gte: 0 },
      storyboard: {
        episodeId,
        episode: { novelPromotionProject: { projectId } },
      },
    },
    data: {
      panelIndex: { increment: PANEL_INDEX_PARK_OFFSET },
      panelNumber: { increment: PANEL_INDEX_PARK_OFFSET },
    },
  })
  if (parked.count < 1) throw new ApiError('NOT_FOUND')
}

async function writeExactPanelOrder(
  tx: Prisma.TransactionClient,
  projectId: string,
  episodeId: string,
  orderedPanels: OrderedPanel[],
): Promise<void> {
  const groupOrder = new Map<string, number>()
  for (const [index, panel] of orderedPanels.entries()) {
    const nextGroupOrder = panel.multiShotGroupId
      ? groupOrder.get(panel.multiShotGroupId) ?? 0
      : null
    if (panel.multiShotGroupId) {
      groupOrder.set(panel.multiShotGroupId, (nextGroupOrder ?? 0) + 1)
    }
    const moved = await tx.novelPromotionPanel.updateMany({
      where: {
        id: panel.id,
        storyboardId: panel.storyboardId,
        storyboard: {
          episodeId,
          episode: { novelPromotionProject: { projectId } },
        },
      },
      data: {
        panelIndex: index,
        panelNumber: index + 1,
        multiShotGroupOrder: nextGroupOrder,
      },
    })
    if (moved.count !== 1) throw new ApiError('NOT_FOUND')

    await tx.novelPromotionVoiceLine.updateMany({
      where: {
        episodeId,
        matchedPanelId: panel.id,
      },
      data: {
        matchedStoryboardId: panel.storyboardId,
        matchedPanelIndex: index,
      },
    })
  }
}

async function updateStoryboardCount(
  tx: Prisma.TransactionClient,
  projectId: string,
  episodeId: string,
  storyboardId: string,
  panelCount: number,
): Promise<void> {
  const updated = await tx.novelPromotionStoryboard.updateMany({
    where: {
      id: storyboardId,
      episodeId,
      episode: { novelPromotionProject: { projectId } },
    },
    data: { panelCount },
  })
  if (updated.count !== 1) throw new ApiError('NOT_FOUND')
}

function panelGenerationMode(episode: OwnedEpisode): PanelGenerationMode {
  return defaultPanelGenerationMode({
    projectGenerationMode: episode.novelPromotionProject?.generationMode,
  })
}

function manualInsertMatches(
  allPanels: OrderedPanel[],
  panelId: string,
  anchorPanelId: string,
  position: PanelPosition,
  expected: ManualStoryboardInitialPanel,
): boolean {
  const panel = allPanels.find((candidate) => candidate.id === panelId)
  const anchor = allPanels.find((candidate) => candidate.id === anchorPanelId)
  if (!panel || !anchor || panel.storyboardId !== anchor.storyboardId) return false

  const currentOrder = panelsInStoryboard(allPanels, anchor.storyboardId)
  const panelIndex = currentOrder.findIndex((candidate) => candidate.id === panel.id)
  const anchorIndex = currentOrder.findIndex((candidate) => candidate.id === anchor.id)
  const hasExpectedPosition = position === 'before'
    ? panelIndex === anchorIndex - 1
    : panelIndex === anchorIndex + 1

  return hasExpectedPosition
    && panel.panelIndex === panelIndex
    && panel.panelNumber === panelIndex + 1
    && panel.multiShotGroupId === anchor.multiShotGroupId
    && panel.description === expected.description
    && panel.characters === JSON.stringify(expected.characterNames)
    && panel.location === expected.locationName
    && panel.duration === expected.durationSeconds
}

function manualInsertConflict(): ApiError {
  return new ApiError('CONFLICT', {
    code: 'MANUAL_PANEL_INSERT_IDEMPOTENCY_CONFLICT',
    message: 'Manual panel insert outcome could not be safely reconciled',
  })
}

/** Synchronously inserts one manual panel inside the anchor's storyboard. */
export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId, episodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, { action: 'write' })
  if (isErrorResponse(authResult)) return authResult

  const body = await readBody(request)
  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey)
  const anchorPanelId = readRequiredId(body.anchorPanelId)
  const position = parsePosition(body.position)
  const panelDraft = parseManualPanel(body.panel)
  const panelId = deriveManualPanelInsertId(projectId, episodeId, idempotencyKey)

  const result = await prisma.$transaction(async (tx) => {
    const episode = await lockOwnedEpisode(tx, projectId, episodeId)
    const allPanels = await readOrderedPanels(tx, projectId, episodeId)
    const anchor = allPanels.find((candidate) => candidate.id === anchorPanelId)
    if (!anchor) throw new ApiError('NOT_FOUND')

    const existing = allPanels.find((candidate) => candidate.id === panelId)
    if (existing) {
      if (!manualInsertMatches(
        allPanels,
        panelId,
        anchorPanelId,
        position,
        panelDraft,
      )) {
        throw manualInsertConflict()
      }
      return { panel: existing, replayed: true }
    }

    const currentOrder = panelsInStoryboard(allPanels, anchor.storyboardId)
    const anchorIndex = currentOrder.findIndex((candidate) => candidate.id === anchor.id)
    if (anchorIndex < 0) throw new ApiError('NOT_FOUND')
    const insertIndex = position === 'before' ? anchorIndex : anchorIndex + 1

    await parkStoryboardPanelIndexes(tx, projectId, episodeId, anchor.storyboardId)
    const createData = {
      id: panelId,
      storyboardId: anchor.storyboardId,
      panelIndex: insertIndex,
      panelNumber: insertIndex + 1,
      shotType: null,
      cameraMove: null,
      description: panelDraft.description,
      characters: JSON.stringify(panelDraft.characterNames),
      location: panelDraft.locationName,
      duration: panelDraft.durationSeconds,
      multiShotGroupId: anchor.multiShotGroupId,
      // writeExactPanelOrder normalizes this to the anchor group's local
      // order after the row exists. Do not use the storyboard-global index.
      multiShotGroupOrder: null,
      panelGenerationMode: panelGenerationMode(episode),
    }
    const created = await tx.novelPromotionPanel.createMany({
      data: [createData],
      skipDuplicates: true,
    })
    if (created.count !== 1) throw manualInsertConflict()

    const nextOrder = currentOrder.slice()
    nextOrder.splice(insertIndex, 0, {
      id: panelId,
      storyboardId: anchor.storyboardId,
      panelIndex: insertIndex,
      panelNumber: insertIndex + 1,
      multiShotGroupId: anchor.multiShotGroupId,
      multiShotGroupOrder: null,
      description: panelDraft.description,
      characters: JSON.stringify(panelDraft.characterNames),
      location: panelDraft.locationName,
      duration: panelDraft.durationSeconds,
    })
    await writeExactPanelOrder(tx, projectId, episodeId, nextOrder)
    await updateStoryboardCount(
      tx,
      projectId,
      episodeId,
      anchor.storyboardId,
      nextOrder.length,
    )

    const reconciledPanels = await readOrderedPanels(tx, projectId, episodeId)
    const reconciled = reconciledPanels.find((candidate) => candidate.id === panelId)
    if (
      !reconciled
      || !manualInsertMatches(
        reconciledPanels,
        panelId,
        anchorPanelId,
        position,
        panelDraft,
      )
    ) {
      throw manualInsertConflict()
    }
    return { panel: reconciled, replayed: false }
  })

  return NextResponse.json({ success: true, ...result })
})

/** Moves a panel one position earlier/later inside its current storyboard. */
export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId, episodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, { action: 'write' })
  if (isErrorResponse(authResult)) return authResult

  const body = await readBody(request)
  const panelId = readRequiredId(body.panelId)
  const direction = parseDirection(body.direction)

  const result = await prisma.$transaction(async (tx) => {
    await lockOwnedEpisode(tx, projectId, episodeId)
    const allPanels = await readOrderedPanels(tx, projectId, episodeId)
    const panel = allPanels.find((candidate) => candidate.id === panelId)
    if (!panel) throw new ApiError('NOT_FOUND')

    const currentOrder = panelsInStoryboard(allPanels, panel.storyboardId)
    const currentIndex = currentOrder.findIndex((candidate) => candidate.id === panel.id)
    const targetIndex = direction === 'earlier' ? currentIndex - 1 : currentIndex + 1
    if (currentIndex < 0) throw new ApiError('NOT_FOUND')
    if (targetIndex < 0 || targetIndex >= currentOrder.length) {
      throw new ApiError('CONFLICT', { code: 'PANEL_MOVE_OUT_OF_BOUNDS' })
    }

    const nextOrder = currentOrder.slice()
    const [moving] = nextOrder.splice(currentIndex, 1)
    nextOrder.splice(targetIndex, 0, moving)
    await parkStoryboardPanelIndexes(tx, projectId, episodeId, panel.storyboardId)
    await writeExactPanelOrder(tx, projectId, episodeId, nextOrder)
    await updateStoryboardCount(
      tx,
      projectId,
      episodeId,
      panel.storyboardId,
      nextOrder.length,
    )
    return { panelId, panelIndex: targetIndex, panelNumber: targetIndex + 1 }
  })

  return NextResponse.json({ success: true, ...result })
})

/** Deletes one panel and closes the exact index gap inside its storyboard. */
export const DELETE = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId, episodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, { action: 'write' })
  if (isErrorResponse(authResult)) return authResult

  const body = await readBody(request)
  const panelId = readRequiredId(body.panelId)

  await prisma.$transaction(async (tx) => {
    await lockOwnedEpisode(tx, projectId, episodeId)
    const allPanels = await readOrderedPanels(tx, projectId, episodeId)
    const panel = allPanels.find((candidate) => candidate.id === panelId)
    if (!panel) throw new ApiError('NOT_FOUND')
    const currentOrder = panelsInStoryboard(allPanels, panel.storyboardId)

    await tx.novelPromotionVoiceLine.updateMany({
      where: {
        episodeId,
        matchedPanelId: panel.id,
      },
      data: {
        matchedPanelId: null,
        matchedStoryboardId: null,
        matchedPanelIndex: null,
      },
    })

    const deleted = await tx.novelPromotionPanel.deleteMany({
      where: {
        id: panel.id,
        storyboardId: panel.storyboardId,
        storyboard: {
          episodeId,
          episode: { novelPromotionProject: { projectId } },
        },
      },
    })
    if (deleted.count !== 1) throw new ApiError('NOT_FOUND')

    const nextOrder = currentOrder.filter((candidate) => candidate.id !== panel.id)
    if (nextOrder.length > 0) {
      await parkStoryboardPanelIndexes(tx, projectId, episodeId, panel.storyboardId)
      await writeExactPanelOrder(tx, projectId, episodeId, nextOrder)
    }
    await updateStoryboardCount(
      tx,
      projectId,
      episodeId,
      panel.storyboardId,
      nextOrder.length,
    )
  })

  return NextResponse.json({ success: true })
})
