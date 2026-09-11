import type { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import type { GlobalCharacter } from '../hooks/useGlobalAssets'

export interface SelectCharacterImageContext {
  previousQueries: Array<{
    queryKey: readonly unknown[]
    data: GlobalCharacter[] | undefined
  }>
  targetKey: string
  requestId: number
}

export interface DeleteCharacterContext {
  previousQueries: Array<{
    queryKey: readonly unknown[]
    data: GlobalCharacter[] | undefined
  }>
}

export function applyCharacterSelection(
  characters: GlobalCharacter[] | undefined,
  characterId: string,
  appearanceIndex: number,
  imageIndex: number | null,
): GlobalCharacter[] | undefined {
  if (!characters) return characters
  return characters.map((character) => {
    if (character.id !== characterId) return character
    return {
      ...character,
      appearances: (character.appearances || []).map((appearance) => {
        if (appearance.appearanceIndex !== appearanceIndex) return appearance
        const selectedUrl =
          imageIndex !== null && imageIndex >= 0
            ? (appearance.imageUrls[imageIndex] ?? null)
            : null
        return {
          ...appearance,
          selectedIndex: imageIndex,
          imageUrl: selectedUrl ?? appearance.imageUrl ?? null,
        }
      }),
    }
  })
}

export function captureCharacterQuerySnapshots(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient
    .getQueriesData<GlobalCharacter[]>({
      queryKey: queryKeys.globalAssets.characters(),
      exact: false,
    })
    .map(([queryKey, data]) => ({ queryKey, data }))
}

export function restoreCharacterQuerySnapshots(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: Array<{ queryKey: readonly unknown[]; data: GlobalCharacter[] | undefined }>,
) {
  snapshots.forEach((snapshot) => {
    queryClient.setQueryData(snapshot.queryKey, snapshot.data)
  })
}

export function buildCharacterImageFormData(params: {
  file: File
  characterId: string
  appearanceIndex: number
  labelText: string
  imageIndex?: number
}): FormData {
  const formData = new FormData()
  formData.append('file', params.file)
  formData.append('type', 'character')
  formData.append('id', params.characterId)
  formData.append('appearanceIndex', params.appearanceIndex.toString())
  formData.append('labelText', params.labelText)
  if (params.imageIndex !== undefined) {
    formData.append('imageIndex', params.imageIndex.toString())
  }
  return formData
}

