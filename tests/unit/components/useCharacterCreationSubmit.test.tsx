import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mutations = vi.hoisted(() => ({
  createProjectCharacter: vi.fn(),
  uploadProjectCharacterImage: vi.fn(),
  noop: vi.fn(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) =>
    key === 'errors.createdButUploadFailed' ? '素材已建立，圖片上傳失敗' : key,
}))

vi.mock('@/lib/query/hooks', () => ({
  useAiCreateProjectCharacter: () => ({ mutateAsync: mutations.noop }),
  useAiDesignCharacter: () => ({ mutateAsync: mutations.noop }),
  useCreateAssetHubCharacter: () => ({ mutateAsync: mutations.noop }),
  useCreateProjectCharacter: () => ({ mutateAsync: mutations.createProjectCharacter }),
  useCreateProjectCharacterAppearance: () => ({ mutateAsync: mutations.noop }),
  useExtractAssetHubReferenceCharacterDescription: () => ({ mutateAsync: mutations.noop }),
  useExtractProjectReferenceCharacterDescription: () => ({ mutateAsync: mutations.noop }),
  useUploadAssetHubTempMedia: () => ({ mutateAsync: mutations.noop }),
  useUploadProjectCharacterImage: () => ({ mutateAsync: mutations.uploadProjectCharacterImage }),
  useUploadProjectTempMedia: () => ({ mutateAsync: mutations.noop }),
}))

import { useCharacterCreationSubmit } from '@/components/shared/assets/character-creation/hooks/useCharacterCreationSubmit'

describe('useCharacterCreationSubmit resumable project upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('alert', vi.fn())
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => '44444444-4444-4444-8444-444444444444'),
    })
  })

  it('角色已建立但圖片上傳失敗 -> 保留 target，重試同一 target 且 introduction 隨 create 保存', async () => {
    mutations.createProjectCharacter.mockResolvedValue({
      character: {
        id: 'character-1',
        appearances: [{ id: 'appearance-1' }],
      },
    })
    mutations.uploadProjectCharacterImage
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce({ success: true })
    const onSuccess = vi.fn()
    const onClose = vi.fn()

    const { result } = renderHook(() => useCharacterCreationSubmit({
      mode: 'project',
      projectId: 'project-1',
      episodeId: 'episode-1',
      name: '林醫師',
      description: '',
      introduction: '冷靜的急診醫師',
      aiInstruction: '',
      referenceImagesBase64: ['data:image/png;base64,aGVsbG8='],
      referenceSubMode: 'direct',
      isSubAppearance: false,
      selectedCharacterId: '',
      changeReason: '',
      setDescription: vi.fn(),
      setAiInstruction: vi.fn(),
      onSuccess,
      onClose,
    }))

    await act(async () => {
      await result.current.handleCreateWithUpload()
    })

    expect(mutations.createProjectCharacter).toHaveBeenCalledWith({
      name: '林醫師',
      description: '',
      introduction: '冷靜的急診醫師',
      episodeId: 'episode-1',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    })
    expect(result.current.uploadRecovery).toEqual({
      createdId: 'character-1',
      targetId: 'appearance-1',
    })
    expect(result.current.uploadError).toBe('素材已建立，圖片上傳失敗')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.handleRetryUpload()
    })

    expect(mutations.createProjectCharacter).toHaveBeenCalledTimes(1)
    expect(mutations.uploadProjectCharacterImage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      characterId: 'character-1',
      appearanceId: 'appearance-1',
      imageIndex: 0,
      labelText: '林醫師',
    }))
    expect(result.current.uploadRecovery).toBeNull()
    expect(result.current.uploadError).toBeNull()
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(globalThis.alert).not.toHaveBeenCalled()
  })

  it('角色 create response 遺失 -> 下一次送出沿用同 key，server replay 後才 upload', async () => {
    mutations.createProjectCharacter
      .mockRejectedValueOnce(new TypeError('network response lost'))
      .mockResolvedValueOnce({
        character: {
          id: 'character-replayed',
          appearances: [{ id: 'appearance-replayed' }],
        },
      })
    mutations.uploadProjectCharacterImage.mockResolvedValue({ success: true })
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    const { result } = renderHook(() => useCharacterCreationSubmit({
      mode: 'project',
      projectId: 'project-1',
      episodeId: 'episode-1',
      name: '蘇導演',
      description: '',
      introduction: '沉著寡言',
      aiInstruction: '',
      referenceImagesBase64: ['data:image/png;base64,aGVsbG8='],
      referenceSubMode: 'direct',
      isSubAppearance: false,
      selectedCharacterId: '',
      changeReason: '',
      setDescription: vi.fn(),
      setAiInstruction: vi.fn(),
      onSuccess,
      onClose,
    }))

    await act(async () => {
      await result.current.handleCreateWithUpload()
    })
    expect(mutations.uploadProjectCharacterImage).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.handleCreateWithUpload()
    })

    expect(mutations.createProjectCharacter).toHaveBeenCalledTimes(2)
    const createKeys = mutations.createProjectCharacter.mock.calls
      .map(([payload]) => payload.idempotencyKey)
    expect(createKeys).toEqual([
      '44444444-4444-4444-8444-444444444444',
      '44444444-4444-4444-8444-444444444444',
    ])
    expect(mutations.uploadProjectCharacterImage).toHaveBeenCalledTimes(1)
    expect(mutations.uploadProjectCharacterImage).toHaveBeenCalledWith(expect.objectContaining({
      characterId: 'character-replayed',
      appearanceId: 'appearance-replayed',
    }))
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
