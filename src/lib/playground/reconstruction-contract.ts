import { z } from 'zod'

const shortText = z.string().trim().min(1).max(500)

export const reconstructionAnalysisSchema = z.object({
  summary: shortText,
  camera: z.object({
    shotSize: shortText,
    angle: shortText,
    movement: shortText,
    continuity: shortText,
  }),
  subjects: z.array(z.object({
    id: z.string().trim().min(1).max(40),
    description: shortText,
    action: shortText,
    position: shortText,
    relation: z.string().trim().max(300),
  })).min(1).max(12),
  performance: z.object({
    emotion: shortText,
    timing: shortText,
    mustPreserve: z.array(shortText).min(1).max(20),
  }),
  environment: z.object({
    description: shortText,
    greenScreen: z.boolean(),
    studioEquipmentVisible: z.boolean(),
    motionNotes: shortText,
  }),
  risks: z.array(shortText).max(20),
})

export type ReconstructionAnalysis = z.infer<typeof reconstructionAnalysisSchema>

export interface ReconstructionVideoMetadata {
  durationSec: number
  width: number
  height: number
  fps: number | null
  hasAudio: boolean
}

export interface ReconstructionDialogueLine {
  id: string
  speaker: string
  startSec: number
  endSec: number
  text: string
  emotion: string
}

export type ReconstructionAudioMode = 'preserve-original' | 'generate'

export type ReconstructionReferenceRole = 'character' | 'environment' | 'wardrobe'

export interface ReconstructionReferenceBinding {
  imageIndex: number
  name: string
  role: ReconstructionReferenceRole
}

export interface ReconstructionCreativeBrief {
  era: string
  location: string
  story: string
  characterDesign: string
  wardrobe: string
  mood: string
  weatherAndTime: string
  backgroundMotion: string
  replacePeople: boolean
}

export interface ReconstructionPromptInput {
  analysis: ReconstructionAnalysis
  metadata: ReconstructionVideoMetadata
  creative: ReconstructionCreativeBrief
  dialogue: ReconstructionDialogueLine[]
  audioMode: ReconstructionAudioMode
  references?: ReconstructionReferenceBinding[]
  outputDurationSec?: number
}

export interface ReconstructionAnalysisResult extends Record<string, unknown> {
  analysis: ReconstructionAnalysis
  metadata: ReconstructionVideoMetadata
  model: string
}
