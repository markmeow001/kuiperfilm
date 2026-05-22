import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { decodePanelCharacters } from '@/lib/novel-promotion/panel-characters-decode'

/**
 * GET /api/novel-promotion/[projectId]/storyboards
 * 获取剧集的分镜数据（用于测试页面）
 */
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
    if (isErrorResponse(authResult)) return authResult

    const { searchParams } = new URL(request.url)
    const episodeId = searchParams.get('episodeId')

    if (!episodeId) {
        throw new ApiError('INVALID_PARAMS')
    }

    // 获取剧集的分镜数据
    const storyboards = await prisma.novelPromotionStoryboard.findMany({
        where: { episodeId },
        include: {
            clip: true,
            panels: { orderBy: { panelIndex: 'asc' } }
        },
        orderBy: { createdAt: 'asc' }
    })

    const withMedia = await attachMediaFieldsToProject({ storyboards })
    const processedStoryboards = withMedia.storyboards || storyboards

    // 2026-05-13 — Join voice lines into the panel payload.
    //
    // Background: NovelPromotionPanel.srtSegment is a freeform string
    // populated by script_to_storyboard via extractDialogueFromSourceText
    // (regex on panel.source_text). That regex misses screenplay-format
    // dialogue like `王玄OS: 不好...` when the LLM doesn't include the
    // line verbatim in panel.source_text. Result: srtSegment is null,
    // V2 cinematic narrative shows no dialogue, user thinks dialogue
    // got lost (user-reported 2026-05-13).
    //
    // The actual dialogue lives in NovelPromotionVoiceLine, joined via
    // matchedPanelId. The multi-shot worker reads voice lines directly,
    // so the video output still has dialogue — but the UI preview
    // misleads. Fix: join voice lines here and either expose them as
    // panel.voiceLines OR backfill srtSegment when it's empty.
    //
    // We do BOTH:
    //   1. panel.voiceLines: full Array<{speaker, content, isVoiceover}>
    //      for clients that want richer rendering (OS chip, no-lip-sync
    //      indicator).
    //   2. panel.srtSegment fallback: when DB srtSegment is null/empty
    //      but voice lines exist, synthesize a multi-line string
    //      `speaker: content\nspeaker2: content2` so legacy readers
    //      (V2 buildInitialNarrative) don't need to change.
    const panelIds = storyboards.flatMap((sb) => (sb.panels ?? []).map((p) => p.id))
    const voiceLineRows = panelIds.length > 0
        ? await prisma.novelPromotionVoiceLine.findMany({
            where: { matchedPanelId: { in: panelIds } },
            orderBy: [{ matchedPanelIndex: 'asc' }, { lineIndex: 'asc' }],
            select: { matchedPanelId: true, speaker: true, content: true, lineIndex: true },
        })
        : []
    /**
     * Detect off-camera voice-over markers in the speaker string.
     * Covers Chinese screenplay conventions (OS/VO/画外音/独白/旁白)
     * and English screenplay (V.O./O.S.).
     */
    const isVoiceoverSpeaker = (raw: string): boolean => {
        return /(\(|（)\s*(VO|V\.?O\.?|OS|O\.?S\.?|画外音|畫外音|旁白|独白|獨白)\s*(\)|）)/i.test(raw)
            || /\b(VO|V\.?O\.?|OS|O\.?S\.?)\b/i.test(raw)
            || /(画外音|畫外音|旁白|独白|獨白)/.test(raw)
    }
    /**
     * Strip the OS/VO suffix so the displayed speaker name is just the
     * character (e.g. `桃桃(VO)` → `桃桃`). Worker / UI gets a clean
     * name; the isVoiceover flag carries the off-camera signal.
     */
    const cleanSpeakerName = (raw: string): string => {
        return raw
            .replace(/[(（]\s*(VO|V\.?O\.?|OS|O\.?S\.?|画外音|畫外音|旁白|独白|獨白)\s*[)）]/gi, '')
            .replace(/\b(VO|V\.?O\.?|OS|O\.?S\.?)\b/gi, '')
            .replace(/(画外音|畫外音|旁白|独白|獨白)/g, '')
            .trim() || raw.trim()
    }
    const voiceLinesByPanelId = new Map<string, Array<{ speaker: string; content: string; isVoiceover: boolean }>>()
    for (const row of voiceLineRows) {
        if (!row.matchedPanelId) continue
        const speakerRaw = (row.speaker ?? '').trim()
        const content = (row.content ?? '').trim()
        if (!content) continue
        const arr = voiceLinesByPanelId.get(row.matchedPanelId) ?? []
        arr.push({
            speaker: cleanSpeakerName(speakerRaw) || '旁白',
            content,
            isVoiceover: isVoiceoverSpeaker(speakerRaw) || speakerRaw === '旁白',
        })
        voiceLinesByPanelId.set(row.matchedPanelId, arr)
    }

    // Decode panel.characters from raw JSON string → structured array
    // so V2/V3/V4 clients can do `panel.characters[i].name` without
    // having to JSON.parse themselves. Legacy bare-string entries
    // (older projects) and the post-2026-05-04 `{name, appearance}`
    // form are both normalised to `{name, appearance?}`. See
    // panel-characters-decode.ts for shape history.
    const normalised = (processedStoryboards as Array<{
        panels?: Array<{ id?: string; characters?: string | unknown; srtSegment?: string | null; [k: string]: unknown }>
        [k: string]: unknown
    }>).map((sb) => ({
        ...sb,
        panels: (sb.panels ?? []).map((p) => {
            const panelId = typeof p.id === 'string' ? p.id : ''
            const voiceLines = panelId ? voiceLinesByPanelId.get(panelId) ?? [] : []
            const existingSrt = (typeof p.srtSegment === 'string' ? p.srtSegment : '').trim()
            // Backfill srtSegment from voice lines only when empty.
            // Preserves any user-edited srtSegment verbatim.
            const synthesizedSrt = voiceLines.length > 0 && !existingSrt
                ? voiceLines
                    .map((v) => v.isVoiceover
                        ? `${v.speaker}(VO): ${v.content}`
                        : `${v.speaker}: ${v.content}`)
                    .join('\n')
                : null
            return {
                ...p,
                characters:
                    typeof p.characters === 'string'
                        ? decodePanelCharacters(p.characters)
                        : Array.isArray(p.characters)
                            ? p.characters
                            : [],
                voiceLines,
                srtSegment: synthesizedSrt ?? p.srtSegment ?? null,
            }
        }),
    }))

    return NextResponse.json({ storyboards: normalised })
})

/**
 * PATCH /api/novel-promotion/[projectId]/storyboards
 * 清除指定 storyboard 的 lastError
 */
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json().catch(() => ({}))
    const storyboardId = typeof body?.storyboardId === 'string' ? body.storyboardId : ''
    if (!storyboardId) {
        throw new ApiError('INVALID_PARAMS')
    }

    await prisma.novelPromotionStoryboard.update({
        where: { id: storyboardId },
        data: { lastError: null }})

    return NextResponse.json({ success: true })
})
