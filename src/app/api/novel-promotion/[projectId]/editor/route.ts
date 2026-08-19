import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { assertNoVoiceLineTaskOutputReferences } from '@/lib/media/recursive-write-policy'

/**
 * GET /api/novel-promotion/[projectId]/editor
 * 获取剧集的编辑器项目数据
 */
export const GET = apiHandler(async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
    if (isErrorResponse(authResult)) return authResult

    const episodeId = request.nextUrl.searchParams.get('episodeId')

    if (!episodeId) {
        throw new ApiError('INVALID_PARAMS')
    }

    const episode = await prisma.novelPromotionEpisode.findFirst({
        where: {
            id: episodeId,
            novelPromotionProject: { projectId },
        },
        select: { id: true },
    })
    if (!episode) {
        throw new ApiError('NOT_FOUND')
    }

    const editorProject = await prisma.videoEditorProject.findFirst({
        where: {
            episodeId,
            episode: { novelPromotionProject: { projectId } },
        },
    })

    if (!editorProject) {
        return NextResponse.json({ projectData: null }, { status: 200 })
    }

    return NextResponse.json({
        id: editorProject.id,
        episodeId: editorProject.episodeId,
        projectData: JSON.parse(editorProject.projectData),
        renderStatus: editorProject.renderStatus,
        outputUrl: editorProject.outputUrl,
        updatedAt: editorProject.updatedAt
    })
})

/**
 * PUT /api/novel-promotion/[projectId]/editor
 * 保存编辑器项目数据
 */
export const PUT = apiHandler(async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json()
    const { episodeId, projectData } = body

    if (!episodeId || !projectData) {
        throw new ApiError('INVALID_PARAMS')
    }

    await assertNoVoiceLineTaskOutputReferences(projectData)

    const editorProject = await prisma.$transaction(async (tx) => {
        const episode = await tx.novelPromotionEpisode.findFirst({
            where: {
                id: episodeId,
                novelPromotionProject: { projectId },
            },
            select: { id: true },
        })
        if (!episode) {
            throw new ApiError('NOT_FOUND')
        }

        // episodeId is unique and was authorized in this same transaction.
        // A concurrent delete can only make the FK write fail; it cannot turn
        // this upsert into a write to another project's episode.
        return await tx.videoEditorProject.upsert({
            where: { episodeId },
            create: {
                episodeId,
                projectData: JSON.stringify(projectData),
            },
            update: {
                projectData: JSON.stringify(projectData),
                updatedAt: new Date(),
            },
        })
    })

    return NextResponse.json({
        success: true,
        id: editorProject.id,
        updatedAt: editorProject.updatedAt
    })
})

/**
 * DELETE /api/novel-promotion/[projectId]/editor
 * 删除编辑器项目
 */
export const DELETE = apiHandler(async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const episodeId = request.nextUrl.searchParams.get('episodeId')

    if (!episodeId) {
        throw new ApiError('INVALID_PARAMS')
    }

    await prisma.$transaction(async (tx) => {
        const episode = await tx.novelPromotionEpisode.findFirst({
            where: {
                id: episodeId,
                novelPromotionProject: { projectId },
            },
            select: { id: true },
        })
        if (!episode) {
            throw new ApiError('NOT_FOUND')
        }

        await tx.videoEditorProject.deleteMany({
            where: {
                episodeId,
                episode: { novelPromotionProject: { projectId } },
            },
        })
    })

    return NextResponse.json({ success: true })
})
