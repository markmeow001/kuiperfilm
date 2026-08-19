export type CharacterCreateMode = 'description' | 'reference' | 'upload'
export type LocationCreateMode = 'description' | 'upload'

interface CharacterCreatePolicyParams {
  name: string
  description: string
  mode: CharacterCreateMode
  referenceImageCount: number
  isBusy: boolean
}

export function getCharacterCreatePolicy({
  name,
  description,
  mode,
  referenceImageCount,
  isBusy,
}: CharacterCreatePolicyParams) {
  const hasName = name.trim().length > 0
  const hasGenerationInput = mode === 'description' ? description.trim().length > 0 : referenceImageCount > 0

  return {
    canCreateOnly: hasName && !isBusy,
    canGenerate: hasName && hasGenerationInput && !isBusy,
    hint: !hasName
      ? '請先輸入角色名稱'
      : !hasGenerationInput
        ? mode === 'description'
          ? '可直接建立角色；如要同時生成設定圖，請填寫外觀描述'
          : '請先上傳圖片，或直接建立角色後再補圖'
        : null,
  }
}

export function getNamedSubjectCreatePolicy(name: string, subjectLabel: string, isBusy: boolean) {
  const hasName = name.trim().length > 0
  return {
    canSubmit: hasName && !isBusy,
    hint: hasName ? null : `請先輸入${subjectLabel}名稱`,
  }
}

export function getLocationCreatePolicy({
  name,
  mode,
  hasFile,
  isBusy,
}: {
  name: string
  mode: LocationCreateMode
  hasFile: boolean
  isBusy: boolean
}) {
  const hasName = name.trim().length > 0
  const hasRequiredInput = mode === 'description' || hasFile
  return {
    canSubmit: hasName && hasRequiredInput && !isBusy,
    hint: !hasName
      ? '請先輸入場景名稱'
      : mode === 'upload' && !hasFile
        ? '請先選擇要上傳的場景圖片'
        : null,
  }
}

export function resolveLocationCreateSubmission(mode: LocationCreateMode, description: string) {
  const trimmedDescription = description.trim()
  return {
    apiDescription: trimmedDescription,
    summaryNote: mode === 'upload' ? trimmedDescription : '',
    shouldUpload: mode === 'upload',
  }
}
