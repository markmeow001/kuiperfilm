import { resolveTaskErrorMessage } from '@/lib/task/error-message'
import { getPageLocale } from './mutation-shared'

export interface ModifyStoryboardImagePayload {
    storyboardId: string
    panelIndex: number
    modifyPrompt: string
    extraImageUrls: string[]
    selectedAssets: Array<{
        id: string
        name: string
        type: 'character' | 'location'
        imageUrl: string | null
        appearanceId?: number
        appearanceName?: string
    }>
}

export interface CreatePanelVariantPayload {
    storyboardId: string
    insertAfterPanelId: string
    sourcePanelId: string
    variant: {
        title: string
        description: string
        shot_type: string
        camera_move: string
        video_prompt: string
    }
    includeCharacterAssets: boolean
    includeLocationAsset: boolean
}

/**
 * Executes a panel image regeneration fetch request with standardized error handling.
 * Handles 402 (insufficient balance), 400 sensitive content, and 429 rate limit errors.
 */
export async function fetchRegeneratePanelImage(
    projectId: string,
    panelId: string,
    count: number,
): Promise<unknown> {
    const res = await fetch(`/api/novel-promotion/${projectId}/regenerate-panel-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': getPageLocale() },
        body: JSON.stringify({ panelId, count }),
    })
    if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        if (res.status === 402) throw new Error('余额不足，请充值后继续使用')
        if (res.status === 400 && String(error?.error || '').includes('敏感')) {
            throw new Error(resolveTaskErrorMessage(error, '提示词包含敏感内容'))
        }
        if (res.status === 429 || error?.code === 'RATE_LIMIT') {
            const retryAfter = error?.retryAfter || 60
            throw new Error(`API 配额超限，请等待 ${retryAfter} 秒后重试`)
        }
        throw new Error(resolveTaskErrorMessage(error, '重新生成失败'))
    }
    return res.json()
}

/**
 * Downloads all episode images as a zip blob with standardized error handling.
 */
export async function fetchDownloadProjectImages(
    projectId: string,
    episodeId: string,
): Promise<Blob> {
    const response = await fetch(`/api/novel-promotion/${projectId}/download-images?episodeId=${episodeId}`, {
        headers: { 'Accept-Language': getPageLocale() },
    })
    if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(resolveTaskErrorMessage(error, '下载失败'))
    }
    return response.blob()
}

/**
 * Executes a panel image upload fetch request with standardized error handling.
 */
export async function fetchUploadPanelImage(
    projectId: string,
    panelId: string,
    file: File,
): Promise<{ imageUrl?: string }> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('panelId', panelId)

    const res = await fetch(`/api/novel-promotion/${projectId}/upload-panel-image`, {
        method: 'POST',
        body: formData,
    })
    if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(resolveTaskErrorMessage(error, '上传失败'))
    }
    return res.json()
}
