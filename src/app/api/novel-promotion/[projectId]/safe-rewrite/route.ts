import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeAiTextStep } from '@/lib/ai-runtime'

const SAFE_REWRITE_SYSTEM_PROMPT = `你是一个专业的图片/视频生成提示词改写助手。

用户会给你一段描述词（可能包含暴力、血腥、色情、政治敏感、毒品等内容），你需要将其改写为"安全版本"——在保留原始画面构图、角色动作、情绪氛围的前提下，替换或弱化可能触发 AI 图片生成 API 内容审查的元素。

改写原则：
1. 保留核心画面构图和镜头语言（景别、运镜、光影）
2. 保留角色的基本动作和情感表达
3. 将暴力动作替换为张力等价但不血腥的表达（如"挥刀砍杀"→"挥剑格挡"）
4. 将色情/裸露内容替换为含蓄但仍有美感的表达
5. 将血液/伤口替换为光效或暗示性描述
6. 将武器细节弱化或改为非致命表达
7. 移除毒品、自杀、恐怖主义等绝对禁区内容，改为意境相近的替代
8. 保持描述的专业性和画面感

你只需要返回改写后的描述文字，不要加任何解释。如果原文已经安全，原样返回即可。`

/**
 * POST /api/novel-promotion/[projectId]/safe-rewrite
 *
 * 将可能违规的描述词用 LLM 改写为安全版本。
 *
 * Q-004 fix: routes through executeAiTextStep (ai-runtime) instead of
 * the legacy chatCompletion direct call so the strong-constraint
 * "AI 必須走 ai-runtime" / "no-api-direct-llm-call" guard passes.
 * Behaviour is identical — same model, same prompt, same temperature.
 */
export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> },
) => {
    const { projectId } = await context.params

    const authResult = await requireProjectAuth(projectId)
    if (isErrorResponse(authResult)) return authResult

    const { session, novelData } = authResult

    const body = await request.json()
    const { description, videoPrompt } = body as {
        description?: string
        videoPrompt?: string
    }

    if (!description && !videoPrompt) {
        throw new ApiError('INVALID_PARAMS', { message: 'description or videoPrompt is required' })
    }

    const analysisModel = (novelData as Record<string, unknown>).analysisModel as string | undefined
    if (!analysisModel) {
        throw new ApiError('INVALID_PARAMS', { message: 'Analysis model not configured' })
    }

    const results: { description?: string; videoPrompt?: string } = {}

    if (description) {
        const completion = await executeAiTextStep({
            userId: session.user.id,
            model: analysisModel,
            messages: [
                { role: 'system', content: SAFE_REWRITE_SYSTEM_PROMPT },
                { role: 'user', content: description },
            ],
            temperature: 0.3,
            projectId,
            action: 'safe_rewrite_description',
            meta: {
                stepId: 'safe_rewrite_description',
                stepTitle: 'Safe rewrite (description)',
                stepIndex: 1,
                stepTotal: videoPrompt ? 2 : 1,
            },
        })
        results.description = completion.text.trim() || description
    }

    if (videoPrompt) {
        const completion = await executeAiTextStep({
            userId: session.user.id,
            model: analysisModel,
            messages: [
                { role: 'system', content: SAFE_REWRITE_SYSTEM_PROMPT },
                { role: 'user', content: videoPrompt },
            ],
            temperature: 0.3,
            projectId,
            action: 'safe_rewrite_video_prompt',
            meta: {
                stepId: 'safe_rewrite_video_prompt',
                stepTitle: 'Safe rewrite (video prompt)',
                stepIndex: description ? 2 : 1,
                stepTotal: description ? 2 : 1,
            },
        })
        results.videoPrompt = completion.text.trim() || videoPrompt
    }

    return NextResponse.json(results)
})
