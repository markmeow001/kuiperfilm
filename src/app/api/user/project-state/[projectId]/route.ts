import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse, badRequest } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const STEP_VALUES = ['home', 'script', 'subjects', 'storyboard', 'voice', 'final'] as const

const bodySchema = z.object({
    lastStep: z.enum(STEP_VALUES),
})

interface RouteContext {
    params: Promise<{ projectId: string }>
}

/**
 * GET /api/user/project-state/[projectId]
 * 读取当前 user 在该 project 上的 sticky lastStep。
 */
export const GET = apiHandler(async (_req: NextRequest, ctx: RouteContext) => {
    const { projectId } = await ctx.params
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const state = await prisma.userProjectState.findUnique({
        where: {
            userId_projectId: {
                userId: session.user.id,
                projectId,
            },
        },
        select: { lastStep: true, updatedAt: true },
    })

    return NextResponse.json({
        success: true,
        lastStep: state?.lastStep ?? null,
        updatedAt: state?.updatedAt ?? null,
    })
})

/**
 * POST /api/user/project-state/[projectId]
 * 更新（upsert）当前 user 在该 project 上的 sticky lastStep。
 */
export const POST = apiHandler(async (req: NextRequest, ctx: RouteContext) => {
    const { projectId } = await ctx.params
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
        return badRequest('Invalid lastStep value')
    }

    const { lastStep } = parsed.data

    await prisma.userProjectState.upsert({
        where: {
            userId_projectId: {
                userId: session.user.id,
                projectId,
            },
        },
        create: {
            userId: session.user.id,
            projectId,
            lastStep,
        },
        update: { lastStep },
    })

    return NextResponse.json({ success: true, lastStep })
})
