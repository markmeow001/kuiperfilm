import type { VirtualCharacterAppearance } from '../live-composite-types'
import { clamp } from './virtual-character'

export const DEFAULT_CHARACTER_APPEARANCE: VirtualCharacterAppearance = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  blur: 0,
  lightWrap: 0.08,
  shadowOpacity: 0.25,
  shadowBlur: 18,
  shadowOffsetX: 0,
  shadowOffsetY: 12,
}

export function characterFilter(appearance: VirtualCharacterAppearance): string {
  const brightness = Math.round((1 + appearance.exposure * 0.7) * 100)
  const contrast = Math.round((1 + appearance.contrast * 0.65) * 100)
  const saturation = Math.round((1 + appearance.saturation) * 100)
  const temperatureAmount = Math.abs(appearance.temperature) * 0.22
  const hue = appearance.temperature >= 0 ? -12 : 168
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) sepia(${temperatureAmount}) hue-rotate(${hue}deg) blur(${appearance.blur}px)`
}

/** Samples the current practical plate and suggests reproducible matching controls. */
export function sampleVideoAppearance(video: HTMLVideoElement): Partial<VirtualCharacterAppearance> {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 36
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || video.videoWidth <= 0 || video.videoHeight <= 0) throw new Error('目前影格尚未準備完成')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let red = 0
  let green = 0
  let blue = 0
  let luminanceSquared = 0
  const count = pixels.length / 4
  for (let index = 0; index < pixels.length; index += 4) {
    red += pixels[index]
    green += pixels[index + 1]
    blue += pixels[index + 2]
    const luminance = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722
    luminanceSquared += luminance * luminance
  }
  red /= count
  green /= count
  blue /= count
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
  const variance = Math.max(0, luminanceSquared / count - luminance * luminance)
  return {
    exposure: clamp((luminance - 128) / 180, -0.55, 0.55),
    contrast: clamp((Math.sqrt(variance) - 45) / 100, -0.45, 0.45),
    saturation: clamp((Math.max(red, green, blue) - Math.min(red, green, blue) - 45) / 130, -0.35, 0.45),
    temperature: clamp((red - blue) / 130, -0.65, 0.65),
  }
}
