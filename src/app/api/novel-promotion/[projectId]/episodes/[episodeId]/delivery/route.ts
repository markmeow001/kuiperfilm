import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getSignedUrl } from '@/lib/cos'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import {
  EpisodeDeliverySourceError,
  requireEpisodePackageStorageKey,
} from '@/lib/novel-promotion/final-delivery'
import {
  episodePackageStorageKey,
  parseEpisodeDeliveryManifestSummary,
  type EpisodeDeliveryManifestSummary,
} from '@/lib/novel-promotion/episode-delivery-manifest'
import {
  getEpisodeDeliveryInputSnapshot,
  type EpisodeDeliveryInputSummary,
} from '@/lib/novel-promotion/episode-delivery-snapshot'

type ReadyEpisodeDeliveryBase = {
  status: 'ready'
  filename: string
  downloadUrl: string
  createdAt: string
}

type ReadyEpisodeDeliveryV1 = ReadyEpisodeDeliveryBase & {
  version: 'v1'
  taskId: string
  sourceFingerprint: string
  stale: boolean
  manifest: EpisodeDeliveryManifestSummary
}

type ReadyEpisodeDeliveryLegacy = ReadyEpisodeDeliveryBase & {
  version: 'legacy'
  taskId: null
  sourceFingerprint: null
  stale: null
  manifest: null
}

export type EpisodeDeliveryCatalogResponse = {
  success: true
  input: EpisodeDeliveryInputSummary
  delivery: ReadyEpisodeDeliveryV1 | ReadyEpisodeDeliveryLegacy | null
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isSourceFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

type V1ReceiptClassification =
  | { kind: 'legacy' }
  | { kind: 'invalid' }
  | {
      kind: 'v1'
      receipt: Omit<ReadyEpisodeDeliveryV1, 'status' | 'filename' | 'downloadUrl'>
    }

async function classifyV1Receipt(
  projectId: string,
  episodeId: string,
  packageKey: string,
  currentSourceFingerprint: string,
): Promise<V1ReceiptClassification> {
  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      episodeId,
      type: TASK_TYPE.EPISODE_STITCH_MP4,
      targetType: 'NovelPromotionEpisode',
      targetId: episodeId,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      status: true,
      finishedAt: true,
      payload: true,
      result: true,
    },
  })

  for (const task of tasks) {
    let expectedPackageKey: string
    try {
      expectedPackageKey = episodePackageStorageKey(episodeId, task.id)
    } catch (error) {
      if (error instanceof EpisodeDeliverySourceError) continue
      throw error
    }
    if (expectedPackageKey !== packageKey) continue

    if (task.status !== 'completed' || !task.finishedAt) return { kind: 'invalid' }
    const payload = jsonRecord(task.payload)
    const result = jsonRecord(task.result)
    if (!result || result.outputUrl !== packageKey) return { kind: 'invalid' }
    if (!isSourceFingerprint(payload?.sourceFingerprint)) return { kind: 'invalid' }
    if (!isSourceFingerprint(result.sourceFingerprint)) return { kind: 'invalid' }
    if (payload.sourceFingerprint !== result.sourceFingerprint) return { kind: 'invalid' }
    const manifest = parseEpisodeDeliveryManifestSummary(result.manifest)
    if (!manifest) return { kind: 'invalid' }

    return {
      kind: 'v1',
      receipt: {
        version: 'v1',
        taskId: task.id,
        createdAt: task.finishedAt.toISOString(),
        sourceFingerprint: result.sourceFingerprint,
        stale: result.sourceFingerprint !== currentSourceFingerprint,
        manifest,
      },
    }
  }

  return { kind: 'legacy' }
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
) => {
  const { projectId, episodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
  if (isErrorResponse(authResult)) return authResult

  let snapshot
  try {
    snapshot = await getEpisodeDeliveryInputSnapshot(projectId, episodeId)
  } catch (error) {
    if (error instanceof EpisodeDeliverySourceError) {
      throw new ApiError('INVALID_PARAMS', { code: 'EPISODE_DELIVERY_SOURCE_INVALID' })
    }
    throw error
  }
  if (!snapshot) throw new ApiError('NOT_FOUND')
  const { episode, input } = snapshot

  // A replacement task may be rendering or may have failed while a previously
  // completed package remains the durable delivery. Availability is therefore
  // derived from the exact owned package receipt, never the latest job state.
  if (!episode.stitchedVideoUrl || !episode.stitchedAt) {
    return NextResponse.json({
      success: true,
      delivery: null,
      input,
    } satisfies EpisodeDeliveryCatalogResponse)
  }

  let packageKey: string
  try {
    packageKey = requireEpisodePackageStorageKey(episode.id, episode.stitchedVideoUrl)
  } catch (error) {
    if (error instanceof EpisodeDeliverySourceError) throw new ApiError('NOT_FOUND')
    throw error
  }

  const receiptClassification = await classifyV1Receipt(
    projectId,
    episode.id,
    packageKey,
    snapshot.sourceFingerprint,
  )
  if (receiptClassification.kind === 'invalid') {
    throw new ApiError('CONFLICT', { code: 'EPISODE_DELIVERY_RECEIPT_INVALID' })
  }

  if (request.nextUrl.searchParams.get('download') === '1') {
    const signedUrl = getSignedUrl(packageKey, 3600)
    let target: URL
    try {
      target = new URL(signedUrl, request.url)
    } catch {
      throw new ApiError('NOT_FOUND')
    }
    const response = NextResponse.redirect(target, { status: 302 })
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const pathname = `/api/novel-promotion/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/delivery`
  const readyBase: ReadyEpisodeDeliveryBase = {
    status: 'ready',
    filename: `episode-${episode.id}-assets.zip`,
    downloadUrl: `${pathname}?download=1`,
    createdAt: episode.stitchedAt.toISOString(),
  }
  return NextResponse.json({
    success: true,
    delivery: receiptClassification.kind === 'v1'
      ? { ...readyBase, ...receiptClassification.receipt }
      : {
          ...readyBase,
          version: 'legacy',
          taskId: null,
          sourceFingerprint: null,
          stale: null,
          manifest: null,
        },
    input,
  } satisfies EpisodeDeliveryCatalogResponse)
})
