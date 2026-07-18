'use client'

import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { characterMediaTime, computeCharacterTransform, isCharacterVisible, resolveCharacterMotion, resolveTrackedPersonCenter } from './lib/virtual-character'
import { characterFilter, DEFAULT_CHARACTER_APPEARANCE } from './lib/character-appearance'
import type { MaskKeyframe, MaskRaster, VirtualCharacterLayer } from './live-composite-types'

interface VirtualCharacterMediaOptions {
  layer: VirtualCharacterLayer | null
  keyframes: MaskKeyframe[]
  playing: boolean
  timelineTime: number
  requestRender: () => void
  onError: (message: string | null) => void
}

interface VirtualCharacterMedia {
  element: ReactNode
  draw: (context: CanvasRenderingContext2D, raster: MaskRaster | undefined, time: number) => void
  assertReady: () => void
}

export function useVirtualCharacterMedia({
  layer,
  keyframes,
  playing,
  timelineTime,
  requestRender,
  onError,
}: VirtualCharacterMediaOptions): VirtualCharacterMedia {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const timelineTimeRef = useRef(timelineTime)
  const assetType = layer?.assetType
  const assetUrl = layer?.assetUrl

  useEffect(() => {
    timelineTimeRef.current = timelineTime
  }, [timelineTime])

  const draw = useCallback((context: CanvasRenderingContext2D, raster: MaskRaster | undefined, time: number) => {
    if (!layer || !isCharacterVisible(layer, time)) return
    const source = layer.assetType === 'image' ? imageRef.current : videoRef.current
    if (!source) return
    const sourceWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.videoWidth
    const sourceHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.videoHeight
    if (sourceWidth <= 0 || sourceHeight <= 0) return
    if (source instanceof HTMLVideoElement && source.paused && Number.isFinite(source.duration)) {
      const targetTime = characterMediaTime(layer, time, source.duration)
      if (Math.abs(source.currentTime - targetTime) > 0.04) source.currentTime = targetTime
    }
    const motion = layer.motionEnabled ? resolveCharacterMotion(layer.motionKeyframes ?? [], time) : null
    const renderLayer = motion ? { ...layer, anchor: 'person' as const, scale: layer.scale * motion.scale, rotation: layer.rotation + motion.rotation } : layer
    const transform = computeCharacterTransform(
      renderLayer,
      raster,
      context.canvas.width,
      context.canvas.height,
      sourceWidth,
      sourceHeight,
      motion ? { x: motion.x, y: motion.y } : layer.anchor === 'person' ? resolveTrackedPersonCenter(keyframes, time, layer.trackingKeyframes) : null,
    )
    context.save()
    context.translate(transform.centerX, transform.centerY)
    context.rotate(transform.rotationRadians)
    context.globalAlpha = transform.opacity
    const appearance = layer.appearance ?? DEFAULT_CHARACTER_APPEARANCE
    context.filter = characterFilter(appearance)
    context.shadowColor = `rgba(0, 0, 0, ${appearance.shadowOpacity})`
    context.shadowBlur = appearance.shadowBlur
    context.shadowOffsetX = appearance.shadowOffsetX
    context.shadowOffsetY = appearance.shadowOffsetY
    context.drawImage(source, -transform.width / 2, -transform.height / 2, transform.width, transform.height)
    if (appearance.lightWrap > 0) {
      context.globalCompositeOperation = 'source-atop'
      context.globalAlpha = transform.opacity * appearance.lightWrap
      context.filter = `blur(${Math.max(2, appearance.blur + 4)}px)`
      context.drawImage(source, -transform.width / 2 - 2, -transform.height / 2 - 2, transform.width + 4, transform.height + 4)
    }
    context.restore()
  }, [keyframes, layer])

  useEffect(() => {
    imageRef.current = null
    if (assetType !== 'image' || !assetUrl) return
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      imageRef.current = image
      onError(null)
      requestRender()
    }
    image.onerror = () => onError('虛擬角色圖片無法讀取')
    image.src = assetUrl
    return () => {
      image.onload = null
      image.onerror = null
    }
  }, [assetType, assetUrl, onError, requestRender])

  useEffect(() => {
    const video = videoRef.current
    if (!layer || layer.assetType !== 'video' || !video) return
    const targetTime = characterMediaTime(layer, timelineTimeRef.current, video.duration)
    if (Number.isFinite(video.duration) && Math.abs(video.currentTime - targetTime) > 0.08) video.currentTime = targetTime
    if (playing) void video.play().catch(() => onError('虛擬角色影片無法播放'))
    else video.pause()
  }, [layer, onError, playing])

  const assertReady = useCallback(() => {
    if (layer?.assetType === 'image' && !imageRef.current) throw new Error('虛擬角色圖片仍在載入，請稍後再輸出')
    if (layer?.assetType === 'video' && (videoRef.current?.readyState ?? 0) < 2) throw new Error('虛擬角色影片仍在載入，請稍後再輸出')
  }, [layer?.assetType])

  const element = layer?.assetType === 'video' ? (
    <video
      ref={videoRef}
      src={layer.assetUrl}
      className="pointer-events-none absolute h-px w-px opacity-0"
      muted
      crossOrigin="anonymous"
      playsInline
      preload="auto"
      loop={layer.loop}
      onLoadedData={() => {
        onError(null)
        requestRender()
      }}
      onSeeked={requestRender}
      onError={() => onError('虛擬角色影片格式無法由瀏覽器解碼')}
    />
  ) : null

  return { element, draw, assertReady }
}
