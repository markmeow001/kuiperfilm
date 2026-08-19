/**
 * 批量创建剧集 API
 */

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

const MAX_BATCH_EPISODES = 200
const MAX_EPISODE_NAME_LENGTH = 191
const MAX_TEXT_BYTES = 65_535
const IMPORT_STATUSES = ['pending', 'completed', 'imported'] as const

type ImportStatus = (typeof IMPORT_STATUSES)[number]

interface BatchEpisode {
    name: string
    description?: string
    novelText: string
}

interface BatchRequestBody {
    episodes: BatchEpisode[]
    clearExisting: boolean
    importStatus?: ImportStatus
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidParams(field: string): never {
    throw new ApiError('INVALID_PARAMS', { field })
}

function exceedsUtf8Bytes(value: string, limit: number): boolean {
    return Buffer.byteLength(value, 'utf8') > limit
}

function isImportStatus(value: unknown): value is ImportStatus {
    return typeof value === 'string' && IMPORT_STATUSES.some(status => status === value)
}

function parseBatchRequestBody(value: unknown): BatchRequestBody {
    if (!isRecord(value)) {
        return invalidParams('body')
    }

    if (!Array.isArray(value.episodes) || value.episodes.length > MAX_BATCH_EPISODES) {
        return invalidParams('episodes')
    }

    if (value.clearExisting !== undefined && typeof value.clearExisting !== 'boolean') {
        return invalidParams('clearExisting')
    }

    if (value.importStatus !== undefined && !isImportStatus(value.importStatus)) {
        return invalidParams('importStatus')
    }

    const episodes = value.episodes.map((episode, index): BatchEpisode => {
        if (!isRecord(episode)) {
            return invalidParams(`episodes[${index}]`)
        }

        if (
            typeof episode.name !== 'string'
            || episode.name.trim().length === 0
            || episode.name.length > MAX_EPISODE_NAME_LENGTH
        ) {
            return invalidParams(`episodes[${index}].name`)
        }

        if (
            episode.description !== undefined
            && (
                typeof episode.description !== 'string'
                || exceedsUtf8Bytes(episode.description, MAX_TEXT_BYTES)
            )
        ) {
            return invalidParams(`episodes[${index}].description`)
        }

        if (
            typeof episode.novelText !== 'string'
            || exceedsUtf8Bytes(episode.novelText, MAX_TEXT_BYTES)
        ) {
            return invalidParams(`episodes[${index}].novelText`)
        }

        return {
            name: episode.name,
            description: episode.description,
            novelText: episode.novelText
        }
    })

    return {
        episodes,
        clearExisting: value.clearExisting ?? false,
        ...(value.importStatus !== undefined ? { importStatus: value.importStatus } : {})
    }
}

export const POST = apiHandler(async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    let rawBody: unknown
    try {
        rawBody = await request.json()
    } catch {
        throw new ApiError('INVALID_PARAMS', { field: 'body' })
    }
    const { episodes, clearExisting, importStatus } = parseBatchRequestBody(rawBody)

    // 验证项目存在
    const project = await prisma.novelPromotionProject.findFirst({
        where: { projectId }
    })

    if (!project) {
        throw new ApiError('NOT_FOUND')
    }

    // 清空、创建剧集与更新项目指针必须原子完成。
    // 任何一步失败时，Prisma 会回滚整个 transaction，保留原有剧集。
    const createdEpisodes = await prisma.$transaction(async (tx) => {
        // Serialize all batch writers for this project before any delete/read/create.
        // Prisma.sql keeps the project id parameterized instead of interpolating SQL.
        const lockedProjects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id
            FROM novel_promotion_projects
            WHERE id = ${project.id}
            FOR UPDATE
        `)
        if (lockedProjects.length !== 1) {
            throw new ApiError('NOT_FOUND')
        }

        if (clearExisting) {
            await tx.novelPromotionEpisode.deleteMany({
                where: { novelPromotionProjectId: project.id }
            })
        }

        if (episodes.length === 0) {
            const updateData: { lastEpisodeId?: null; importStatus?: string } = {}
            if (clearExisting) {
                updateData.lastEpisodeId = null
            }
            if (importStatus !== undefined) {
                updateData.importStatus = importStatus
            }

            if (Object.keys(updateData).length > 0) {
                await tx.novelPromotionProject.update({
                    where: { id: project.id },
                    data: updateData
                })
            }

            return []
        }

        // 清空后从 1 开始；追加时在同一 transaction 内读取当前最大集数。
        const lastEpisode = clearExisting
            ? null
            : await tx.novelPromotionEpisode.findFirst({
                where: { novelPromotionProjectId: project.id },
                orderBy: { episodeNumber: 'desc' }
            })
        const startNumber = clearExisting ? 1 : (lastEpisode?.episodeNumber || 0) + 1

        const nextEpisodes: Array<{ id: string; episodeNumber: number; name: string }> = []
        for (const [idx, ep] of episodes.entries()) {
            const createdEpisode = await tx.novelPromotionEpisode.create({
                data: {
                    novelPromotionProjectId: project.id,
                    episodeNumber: startNumber + idx,
                    name: ep.name,
                    description: ep.description || null,
                    novelText: ep.novelText
                }
            })
            nextEpisodes.push(createdEpisode)
        }

        const updateData: { lastEpisodeId: string; importStatus?: string } = {
            lastEpisodeId: nextEpisodes[0].id
        }
        if (importStatus !== undefined) {
            updateData.importStatus = importStatus
        }

        await tx.novelPromotionProject.update({
            where: { id: project.id },
            data: updateData
        })

        return nextEpisodes
    })

    if (createdEpisodes.length === 0) {
        return NextResponse.json({
            success: true,
            episodes: [],
            message: '已清空剧集'
        })
    }

    return NextResponse.json({
        success: true,
        episodes: createdEpisodes.map(ep => ({
            id: ep.id,
            episodeNumber: ep.episodeNumber,
            name: ep.name
        }))
    })
})
