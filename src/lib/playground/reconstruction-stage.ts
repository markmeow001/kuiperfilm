export interface ReconstructionStageInput {
  hasVideo: boolean
  hasAnalysis: boolean
  hasCharacterReference: boolean
  hasKeyframeModel: boolean
}

export interface ReconstructionStageAvailability {
  showSetup: boolean
  canGenerateKeyframe: boolean
}

export function getReconstructionStageAvailability(
  input: ReconstructionStageInput,
): ReconstructionStageAvailability {
  return {
    // Uploading references and filling the creative brief are free setup work.
    // They must not be hidden behind the paid AI analysis step.
    showSetup: input.hasVideo,
    canGenerateKeyframe:
      input.hasAnalysis && input.hasCharacterReference && input.hasKeyframeModel,
  }
}
