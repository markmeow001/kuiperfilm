export type MaskTool = 'keep' | 'erase'
export type MaskEditTarget = 'person' | 'occlusion'

export type CompositeView = 'source' | 'mask' | 'composite'

export interface NormalizedPoint {
  x: number
  y: number
}

export interface MaskStroke {
  id: string
  tool: MaskTool
  /** Brush diameter as a fraction of the shorter source edge. */
  size: number
  points: NormalizedPoint[]
}

export interface MaskRaster {
  width: number
  height: number
  alpha: Uint8ClampedArray
}

export interface MaskKeyframe {
  id: string
  time: number
  strokes: MaskStroke[]
  baseMask?: MaskRaster
}

export interface PersonMaskAnalysisFrame {
  mask: MaskRaster
  /** false = 骨架範圍裁切關閉，或這一影格偵測不到骨架（未裁切，結果需回報 UI）。 */
  poseRoiApplied: boolean
}

export type MaskAnalysisStatus = 'idle' | 'loading-model' | 'analyzing' | 'completed' | 'failed'

export interface MaskAnalysisProgress {
  status: MaskAnalysisStatus
  completed: number
  total: number
  message: string
}

export type CompositeExportStatus = 'idle' | 'preparing' | 'recording' | 'completed' | 'failed'

export interface CompositeExportProgress {
  status: CompositeExportStatus
  currentTime: number
  duration: number
  message: string
}

export interface VideoMetadata {
  width: number
  height: number
  duration: number
  name: string
}

export type VirtualCharacterAssetType = 'image' | 'video'
export type VirtualCharacterDepth = 'behind-person' | 'in-front'
export type VirtualCharacterAnchor = 'screen' | 'person'

export interface VirtualCharacterTrackingKeyframe {
  id: string
  time: number
  /** Manual correction added to the AI-tracked center. */
  offsetX: number
  offsetY: number
}

export interface VirtualCharacterAppearance {
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  blur: number
  lightWrap: number
  shadowOpacity: number
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
}

export interface VirtualCharacterMotionKeyframe {
  id: string
  time: number
  x: number
  y: number
  scale: number
  rotation: number
  confidence: number
}

export interface VirtualCharacterLayer {
  assetType: VirtualCharacterAssetType
  assetName: string
  assetUrl: string
  assetKey: string | null
  anchor: VirtualCharacterAnchor
  /** Screen-space center, normalized to the stage. */
  x: number
  y: number
  /** Offset from the detected person's center, normalized to the stage. */
  offsetX: number
  offsetY: number
  /** Rendered height as a fraction of the stage height. */
  scale: number
  rotation: number
  opacity: number
  startTime: number
  endTime: number
  loop: boolean
  depth: VirtualCharacterDepth
  /** Optional for projects saved before tracking correction shipped. */
  trackingKeyframes?: VirtualCharacterTrackingKeyframe[]
  /** Optional for projects saved before appearance matching shipped. */
  appearance?: VirtualCharacterAppearance
  motionEnabled?: boolean
  motionKeyframes?: VirtualCharacterMotionKeyframe[]
}
