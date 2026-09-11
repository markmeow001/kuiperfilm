'use client'

/**
 * 音色设置组件 - 从 CharacterCard 提取
 *
 * Custom-voice upload and AI voice design are fail-closed here: every Asset Hub
 * write endpoint behind them (/api/asset-hub/voices/upload, /voice-design,
 * /voices, /character-voice) calls rejectLegacyCustomVoiceWrite() and returns
 * 400 VOICE_SOURCE_CONSENT_REQUIRED. Rendering them as live controls gave the
 * user buttons that could only fail. Playback of an already-stored sample stays
 * available (read-only legacy compatibility).
 */

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { shouldShowError } from '@/lib/error-utils'
import { AppIcon } from '@/components/ui/icons'

interface VoiceSettingsProps {
    characterId: string
    characterName: string
    customVoiceUrl: string | null | undefined
    projectId?: string  // 可选，Asset Hub 不需要
    onVoiceChange?: (characterId: string, customVoiceUrl?: string) => void
    onVoiceDesign?: (characterId: string, characterName: string) => void
    onVoiceSelect?: (characterId: string) => void  // 从音色库选择
    compact?: boolean  // 紧凑模式（单图卡片用）
}

export default function VoiceSettings({
    characterId,
    characterName,
    customVoiceUrl,
    projectId,
    onVoiceChange,
    onVoiceDesign,
    onVoiceSelect,
    compact = false
}: VoiceSettingsProps) {
    const t = useTranslations('assetHub')
    const tVoice = useTranslations('voice.inlineBinding')
    void projectId
    // Retained so the surrounding wiring (CharacterCard -> AssetGrid -> page)
    // stays intact while the voice-creation surface is decided; deliberately
    // not invoked because the endpoint behind it is closed.
    void onVoiceChange
    void onVoiceDesign
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [isPreviewingVoice, setIsPreviewingVoice] = useState(false)

    const hasCustomVoice = !!customVoiceUrl

    // 预览音色（播放/暂停自定义音频）
    const handlePreviewVoice = async () => {
        if (!customVoiceUrl) return

        // 如果正在播放，点击则暂停
        if (isPreviewingVoice && audioRef.current) {
            audioRef.current.pause()
            setIsPreviewingVoice(false)
            return
        }

        try {
            if (audioRef.current) {
                audioRef.current.pause()
            }
            const audio = new Audio(customVoiceUrl)
            audioRef.current = audio
            audio.play()
            audio.onended = () => setIsPreviewingVoice(false)
            audio.onerror = () => setIsPreviewingVoice(false)
            setIsPreviewingVoice(true)
        } catch (error: unknown) {
            if (shouldShowError(error)) {
                const message = error instanceof Error ? error.message : String(error)
                alert(t('voiceSettings.previewFailed', { error: message }))
            }
            setIsPreviewingVoice(false)
        }
    }

    // 紧凑模式样式
    const containerClass = compact
        ? 'glass-surface-soft border border-[var(--glass-stroke-base)] rounded-xl p-3'
        : 'mt-4 glass-surface-soft border border-[var(--glass-stroke-base)] rounded-xl p-4'

    const headerClass = compact
        ? 'flex items-center gap-2 mb-2 pb-2 border-b'
        : 'flex items-center gap-2 mb-3 pb-2 border-b'

    const iconSize = compact ? 'w-5 h-5' : 'w-6 h-6'
    const innerIconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5'

    return (
        <div className={containerClass}>
            <div className={`${headerClass} ${hasCustomVoice ? 'border-[var(--glass-stroke-base)]' : 'border-[var(--glass-stroke-warning)]'}`}>
                <div className={`${iconSize} rounded-full flex items-center justify-center ${hasCustomVoice ? 'glass-chip glass-chip-neutral p-0' : 'glass-chip glass-chip-warning p-0'}`}>
                    <AppIcon name="mic" className={`${innerIconSize} ${hasCustomVoice ? 'text-[var(--glass-text-secondary)]' : 'text-[var(--glass-tone-warning-fg)]'}`} />
                </div>
                <span className={`text-${compact ? 'xs' : 'sm'} font-medium ${hasCustomVoice ? 'text-[var(--glass-text-secondary)]' : 'text-[var(--glass-tone-warning-fg)]'}`}>
                    {t('voiceSettings.title')}{!hasCustomVoice && <span className="text-[var(--glass-tone-warning-fg)]">({t('voiceSettings.noVoice')})</span>}
                </span>
            </div>

            <div className="flex gap-2 w-full justify-center flex-wrap">
                <button
                    type="button"
                    disabled
                    title={tVoice('customSourceUnavailable')}
                    className="glass-btn-base glass-btn-secondary flex-1 min-w-[70px] px-2 py-1.5 rounded-lg text-xs font-medium opacity-55 cursor-not-allowed whitespace-nowrap"
                >
                    <div className="flex items-center justify-center gap-1">
                        <span>{t('voiceSettings.uploadAudio')}</span>
                    </div>
                </button>

                <button
                    type="button"
                    disabled
                    title={tVoice('customSourceUnavailable')}
                    className="glass-btn-base glass-btn-secondary flex-1 min-w-[70px] px-2 py-1.5 rounded-lg text-xs font-medium opacity-55 cursor-not-allowed whitespace-nowrap"
                >
                    <div className="flex items-center justify-center gap-1">
                        <AppIcon name="bolt" className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{t('voiceSettings.aiDesign')}</span>
                    </div>
                </button>

                {onVoiceSelect && (
                    <button
                        onClick={() => onVoiceSelect(characterId)}
                        className="glass-btn-base glass-btn-secondary flex-1 min-w-[70px] px-2 py-1.5 rounded-lg text-xs text-[var(--glass-tone-info-fg)] font-medium transition-all whitespace-nowrap"
                    >
                        <div className="flex items-center justify-center gap-1">
                            <AppIcon name="folderCards" className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{t('voiceSettings.voiceLibrary')}</span>
                        </div>
                    </button>
                )}
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-[var(--glass-text-tertiary)]">
                {tVoice('customSourceUnavailable')}
            </p>

            {/* 试听按钮 - 仅在有音频时显示 */}
            {hasCustomVoice && (
                <button
                    onClick={handlePreviewVoice}
                    className={`glass-btn-base w-full mt-2 px-3 py-2 border rounded-lg text-sm font-medium transition-all ${isPreviewingVoice
                        ? 'glass-btn-tone-info border-[var(--glass-stroke-focus)]'
                        : 'glass-btn-secondary text-[var(--glass-tone-info-fg)] border-[var(--glass-stroke-base)]'
                        }`}
                >
                    <div className="flex items-center justify-center gap-2">
                        {isPreviewingVoice ? (
                            <AppIcon name="pause" className="w-4 h-4" />
                        ) : (
                            <AppIcon name="play" className="w-4 h-4" />
                        )}
                        {isPreviewingVoice ? t('voiceSettings.pause') : t('voiceSettings.preview')}
                    </div>
                </button>
            )}
        </div>
    )
}
