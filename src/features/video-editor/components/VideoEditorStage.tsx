'use client'
import { logError as _ulogError } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useEditorState } from '../hooks/useEditorState'
import { useEditorActions } from '../hooks/useEditorActions'
import { VideoEditorProject } from '../types/editor.types'
import { calculateTimelineDuration, framesToTime } from '../utils/time-utils'
import { RemotionPreview } from './Preview'
import { Timeline } from './Timeline'
import { TransitionPicker, TransitionType } from './TransitionPicker'

interface RenderState {
    status: 'pending' | 'rendering' | 'completed' | 'failed' | null
    progress: number
    outputUrl: string | null
    taskId: string | null
}

interface VideoEditorStageProps {
    projectId: string
    episodeId: string
    initialProject?: VideoEditorProject
    onBack?: () => void
}

/**
 * 视频编辑器主页面
 *
 * 布局:
 * ┌──────────────────────────────────────────────────────────┐
 * │ Toolbar (返回 | 保存 | 导出)                              │
 * ├──────────────┬───────────────────────────────────────────┤
 * │  素材库       │       Preview (Remotion Player)           │
 * │              │                                           │
 * │              ├───────────────────────────────────────────┤
 * │              │       Properties Panel                    │
 * ├──────────────┴───────────────────────────────────────────┤
 * │                      Timeline                            │
 * └──────────────────────────────────────────────────────────┘
 */
export function VideoEditorStage({
    projectId,
    episodeId,
    initialProject,
    onBack
}: VideoEditorStageProps) {
    const t = useTranslations('video')
    const {
        project,
        timelineState,
        isDirty,
        removeClip,
        updateClip,
        reorderClips,
        play,
        pause,
        seek,
        selectClip,
        setZoom,
        markSaved
    } = useEditorState({ episodeId, initialProject })

    const { saveProject, startRender, getRenderStatus } = useEditorActions({ projectId, episodeId })

    const [renderState, setRenderState] = useState<RenderState>({
        status: null,
        progress: 0,
        outputUrl: null,
        taskId: null,
    })
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const stopPolling = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
        }
    }, [])

    // Cleanup polling on unmount
    useEffect(() => {
        return () => stopPolling()
    }, [stopPolling])

    const pollRenderStatus = useCallback((editorProjectId: string) => {
        stopPolling()
        pollingRef.current = setInterval(async () => {
            try {
                const data = await getRenderStatus(editorProjectId)
                setRenderState(prev => ({
                    ...prev,
                    status: data.status,
                    progress: data.progress ?? 0,
                    outputUrl: data.outputUrl ?? null,
                }))
                if (data.status === 'completed' || data.status === 'failed') {
                    stopPolling()
                }
            } catch {
                // Continue polling on transient errors
            }
        }, 3000)
    }, [getRenderStatus, stopPolling])

    const totalDuration = calculateTimelineDuration(project.timeline)
    const totalTime = framesToTime(totalDuration, project.config.fps)
    const currentTime = framesToTime(timelineState.currentFrame, project.config.fps)

    const handleSave = async () => {
        try {
            await saveProject(project)
            markSaved()
            alert(t('editor.alert.saveSuccess'))
        } catch (error) {
            _ulogError('Save failed:', error)
            alert(t('editor.alert.saveFailed'))
        }
    }

    const handleExport = async () => {
        if (isRendering) return
        try {
            // Save project first to ensure latest data is persisted
            await saveProject(project)
            markSaved()

            const result = await startRender(project.id)
            setRenderState({
                status: 'pending',
                progress: 0,
                outputUrl: null,
                taskId: result.taskId,
            })
            pollRenderStatus(project.id)
        } catch (error) {
            _ulogError('Export failed:', error)
            alert(t('editor.alert.exportFailed'))
        }
    }

    const handleCancelRender = () => {
        stopPolling()
        setRenderState({ status: null, progress: 0, outputUrl: null, taskId: null })
    }

    const isRendering = renderState.status === 'pending' || renderState.status === 'rendering'
    const isCompleted = renderState.status === 'completed' && renderState.outputUrl

    const selectedClip = project.timeline.find(c => c.id === timelineState.selectedClipId)

    const renderExportButton = () => {
        if (isCompleted) {
            return (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <a
                        href={renderState.outputUrl!}
                        download
                        className="glass-btn-base glass-btn-tone-success px-4 py-2"
                        style={{ textDecoration: 'none' }}
                    >
                        {t('editor.toolbar.download')}
                    </a>
                    <button
                        onClick={() => setRenderState({ status: null, progress: 0, outputUrl: null, taskId: null })}
                        className="glass-btn-base glass-btn-ghost px-2 py-2"
                        title={t('editor.toolbar.dismissRender')}
                    >
                        <AppIcon name="close" className="w-4 h-4" />
                    </button>
                </div>
            )
        }

        if (isRendering) {
            return (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 16px',
                        background: 'var(--glass-bg-surface-strong)',
                        borderRadius: '6px',
                        fontSize: '13px',
                    }}>
                        <div style={{
                            width: '120px',
                            height: '6px',
                            background: 'var(--glass-bg-muted)',
                            borderRadius: '3px',
                            overflow: 'hidden',
                        }}>
                            <div style={{
                                width: `${renderState.progress}%`,
                                height: '100%',
                                background: 'var(--glass-accent-from)',
                                borderRadius: '3px',
                                transition: 'width 0.3s ease',
                            }} />
                        </div>
                        <span style={{ color: 'var(--glass-text-secondary)', minWidth: '36px' }}>
                            {renderState.progress}%
                        </span>
                    </div>
                    <button
                        onClick={handleCancelRender}
                        className="glass-btn-base glass-btn-ghost px-2 py-2"
                        title={t('editor.toolbar.cancelRender')}
                    >
                        <AppIcon name="close" className="w-4 h-4" />
                    </button>
                </div>
            )
        }

        if (renderState.status === 'failed') {
            return (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                        onClick={handleExport}
                        className="glass-btn-base glass-btn-tone-danger px-4 py-2"
                    >
                        {t('editor.toolbar.retryExport')}
                    </button>
                </div>
            )
        }

        return (
            <button
                onClick={handleExport}
                className="glass-btn-base glass-btn-tone-success px-4 py-2"
            >
                {t('editor.toolbar.export')}
            </button>
        )
    }

    return (
        <div className="video-editor-stage" style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            background: 'var(--glass-bg-canvas)',
            color: 'var(--glass-text-primary)'
        }}>
            {/* Toolbar */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                borderBottom: '1px solid var(--glass-stroke-base)',
                background: 'var(--glass-bg-surface)'
            }}>
                <button
                    onClick={onBack}
                    className="glass-btn-base glass-btn-secondary px-4 py-2"
                >
                    {t('editor.toolbar.back')}
                </button>

                <div style={{ flex: 1 }} />

                <span style={{ color: 'var(--glass-text-secondary)', fontSize: '14px' }}>
                    {currentTime} / {totalTime}
                </span>

                <button
                    onClick={handleSave}
                    className={`glass-btn-base px-4 py-2 ${isDirty ? 'glass-btn-primary text-white' : 'glass-btn-secondary'}`}
                >
                    {isDirty ? t('editor.toolbar.saveDirty') : t('editor.toolbar.saved')}
                </button>

                {renderExportButton()}
            </div>

            {/* Main Content */}
            <div style={{
                display: 'flex',
                flex: 1,
                overflow: 'hidden'
            }}>
                {/* Left Panel - Media Library */}
                <div style={{
                    width: '200px',
                    borderRight: '1px solid var(--glass-stroke-base)',
                    padding: '12px',
                    background: 'var(--glass-bg-surface-strong)'
                }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--glass-text-secondary)' }}>
                        {t('editor.left.title')}
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--glass-text-tertiary)' }}>
                        {t('editor.left.description')}
                    </p>
                </div>

                {/* Center - Preview + Properties */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {/* Preview */}
                    <div style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--glass-bg-muted)',
                        padding: '20px'
                    }}>
                        <RemotionPreview
                            project={project}
                            currentFrame={timelineState.currentFrame}
                            playing={timelineState.playing}
                            onFrameChange={seek}
                            onPlayingChange={(playing) => playing ? play() : pause()}
                        />
                    </div>

                    {/* Playback Controls */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '16px',
                        padding: '12px',
                        background: 'var(--glass-bg-surface-strong)',
                        borderTop: '1px solid var(--glass-stroke-base)'
                    }}>
                        <button
                            onClick={() => seek(0)}
                            className="glass-btn-base glass-btn-ghost px-3 py-1.5"
                        >
                            <AppIcon name="chevronLeft" className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => timelineState.playing ? pause() : play()}
                            style={{
                                background: 'var(--glass-accent-from)',
                                border: 'none',
                                color: 'var(--glass-text-on-accent)',
                                cursor: 'pointer',
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                fontSize: '18px'
                            }}
                        >
                            {timelineState.playing
                                ? <AppIcon name="pause" className="w-4 h-4" />
                                : <AppIcon name="play" className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={() => seek(totalDuration)}
                            className="glass-btn-base glass-btn-ghost px-3 py-1.5"
                        >
                            <AppIcon name="chevronRight" className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Right Panel - Properties */}
                <div style={{
                    width: '280px',
                    borderLeft: '1px solid var(--glass-stroke-base)',
                    padding: '12px',
                    background: 'var(--glass-bg-surface-strong)',
                    overflowY: 'auto'
                }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--glass-text-secondary)' }}>
                        {t('editor.right.title')}
                    </h3>
                    {selectedClip ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* 基础信息 */}
                            <div style={{ fontSize: '12px' }}>
                                <p style={{ margin: '0 0 8px 0' }}>
                                    <span style={{ color: 'var(--glass-text-secondary)' }}>{t('editor.right.clipLabel')}</span> {selectedClip.metadata?.description || t('editor.right.clipFallback', { index: project.timeline.findIndex(c => c.id === selectedClip.id) + 1 })}
                                </p>
                                <p style={{ margin: '0 0 8px 0' }}>
                                    <span style={{ color: 'var(--glass-text-secondary)' }}>{t('editor.right.durationLabel')}</span> {framesToTime(selectedClip.durationInFrames, project.config.fps)}
                                </p>
                            </div>

                            {/* 转场设置 */}
                            <div>
                                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--glass-text-secondary)' }}>
                                    {t('editor.right.transitionLabel')}
                                </h4>
                                <TransitionPicker
                                    value={(selectedClip.transition?.type as TransitionType) || 'none'}
                                    duration={selectedClip.transition?.durationInFrames || 15}
                                    onChange={(type, duration) => {
                                        updateClip(selectedClip.id, {
                                            transition: type === 'none' ? undefined : { type, durationInFrames: duration }
                                        })
                                    }}
                                />
                            </div>

                            {/* 删除按钮 */}
                            <button
                                onClick={() => {
                                    if (confirm(t('editor.right.deleteConfirm'))) {
                                        removeClip(selectedClip.id)
                                        selectClip(null)
                                    }
                                }}
                                className="glass-btn-base glass-btn-tone-danger mt-2 px-3 py-2 text-xs"
                            >
                                {t('editor.right.deleteClip')}
                            </button>
                        </div>
                    ) : (
                        <p style={{ fontSize: '12px', color: 'var(--glass-text-tertiary)' }}>
                            {t('editor.right.selectClipHint')}
                        </p>
                    )}
                </div>
            </div>

            {/* Timeline */}
            <div style={{
                height: '220px',
                borderTop: '1px solid var(--glass-stroke-base)'
            }}>
                <Timeline
                    clips={project.timeline}
                    timelineState={timelineState}
                    config={project.config}
                    onReorder={reorderClips}
                    onSelectClip={selectClip}
                    onZoomChange={setZoom}
                    onSeek={seek}
                />
            </div>
        </div>
    )
}

export default VideoEditorStage
