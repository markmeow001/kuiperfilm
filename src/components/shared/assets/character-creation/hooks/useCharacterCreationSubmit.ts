'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { shouldShowError } from '@/lib/error-utils'
import {
  useAiCreateProjectCharacter,
  useAiDesignCharacter,
  useCreateAssetHubCharacter,
  useCreateProjectCharacter,
  useCreateProjectCharacterAppearance,
  useExtractAssetHubReferenceCharacterDescription,
  useExtractProjectReferenceCharacterDescription,
  useUploadAssetHubTempMedia,
  useUploadProjectCharacterImage,
  useUploadProjectTempMedia,
} from '@/lib/query/hooks'
import { dataUrlToImageFile } from '../character-upload-utils'
import {
  createSubjectUploadRequestId,
  runResumableCreateWithUpload,
  type SubjectUploadTarget,
} from '@/app/[locale]/v2/workspace/[projectId]/subjects/subject-create-upload-flow'

type Mode = 'asset-hub' | 'project'

interface UseCharacterCreationSubmitParams {
  mode: Mode
  folderId?: string | null
  projectId?: string
  episodeId?: string | null
  name: string
  description: string
  introduction?: string
  aiInstruction: string
  // Q-006: artStyle removed — styleProfile replaces it.
  referenceImagesBase64: string[]
  referenceSubMode: 'direct' | 'extract'
  isSubAppearance: boolean
  selectedCharacterId: string
  changeReason: string
  setDescription: (value: string) => void
  setAiInstruction: (value: string) => void
  onSuccess: () => void
  onClose: () => void
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function useCharacterCreationSubmit({
  mode,
  folderId,
  projectId,
  episodeId,
  name,
  description,
  introduction = '',
  aiInstruction,
  // Q-006: artStyle removed — styleProfile replaces it.
  referenceImagesBase64,
  referenceSubMode,
  isSubAppearance,
  selectedCharacterId,
  changeReason,
  setDescription,
  setAiInstruction,
  onSuccess,
  onClose,
}: UseCharacterCreationSubmitParams) {
  const t = useTranslations('assetModal')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAiDesigning, setIsAiDesigning] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [uploadRecovery, setUploadRecovery] = useState<SubjectUploadTarget | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const manualUploadRequestIdRef = useRef<string | null>(null)

  const uploadAssetHubTemp = useUploadAssetHubTempMedia()
  const uploadProjectTemp = useUploadProjectTempMedia()
  const aiDesignAssetHubCharacter = useAiDesignCharacter()
  const aiCreateProjectCharacter = useAiCreateProjectCharacter(projectId ?? '')
  const extractAssetHubDescription = useExtractAssetHubReferenceCharacterDescription()
  const extractProjectDescription = useExtractProjectReferenceCharacterDescription(projectId ?? '')
  const createAssetHubCharacter = useCreateAssetHubCharacter()
  const createProjectCharacter = useCreateProjectCharacter(projectId ?? '')
  const createProjectAppearance = useCreateProjectCharacterAppearance(projectId ?? '')
  const uploadProjectCharacterImage = useUploadProjectCharacterImage(projectId ?? '')

  const uploadReferenceImages = useCallback(async () => {
    const uploadMutation = mode === 'asset-hub' ? uploadAssetHubTemp : uploadProjectTemp
    return Promise.all(
      referenceImagesBase64.map(async (base64) => {
        const data = await uploadMutation.mutateAsync({ imageBase64: base64 })
        if (!data.url) throw new Error(t('errors.uploadFailed'))
        return data.url
      }),
    )
  }, [mode, referenceImagesBase64, t, uploadAssetHubTemp, uploadProjectTemp])

  const handleExtractDescription = useCallback(async () => {
    if (referenceImagesBase64.length === 0) return

    try {
      setIsExtracting(true)
      const referenceImageUrls = await uploadReferenceImages()
      const result =
        mode === 'asset-hub'
          ? await extractAssetHubDescription.mutateAsync(referenceImageUrls)
          : await extractProjectDescription.mutateAsync(referenceImageUrls)
      if (result?.description) {
        setDescription(result.description)
      }
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.extractDescriptionFailed')))
      }
    } finally {
      setIsExtracting(false)
    }
  }, [
    extractAssetHubDescription,
    extractProjectDescription,
    mode,
    referenceImagesBase64.length,
    setDescription,
    t,
    uploadReferenceImages,
  ])

  const handleCreateWithReference = useCallback(async () => {
    if (!name.trim() || referenceImagesBase64.length === 0) return

    try {
      setIsSubmitting(true)
      const referenceImageUrls = await uploadReferenceImages()

      let finalDescription = description.trim()
      if (referenceSubMode === 'extract') {
        const result =
          mode === 'asset-hub'
            ? await extractAssetHubDescription.mutateAsync(referenceImageUrls)
            : await extractProjectDescription.mutateAsync(referenceImageUrls)
        finalDescription = result?.description || finalDescription
      }

      if (mode === 'asset-hub') {
        await createAssetHubCharacter.mutateAsync({
          name: name.trim(),
          description: finalDescription || t('character.defaultDescription', { name: name.trim() }),
          folderId: folderId ?? null,
          generateFromReference: true,
          referenceImageUrls,
          customDescription: referenceSubMode === 'extract' ? finalDescription : undefined,
        })
      } else {
        await createProjectCharacter.mutateAsync({
          name: name.trim(),
          description: finalDescription || t('character.defaultDescription', { name: name.trim() }),
          introduction: introduction.trim(),
          episodeId: episodeId || undefined,
          generateFromReference: true,
          referenceImageUrls,
          customDescription: referenceSubMode === 'extract' ? finalDescription : undefined,
        })
      }

      onSuccess()
      onClose()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.createFailed')))
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [
    createAssetHubCharacter,
    createProjectCharacter,
    description,
    episodeId,
    extractAssetHubDescription,
    extractProjectDescription,
    folderId,
    introduction,
    mode,
    name,
    onClose,
    onSuccess,
    referenceImagesBase64.length,
    referenceSubMode,
    t,
    uploadReferenceImages,
  ])

  const handleAiDesign = useCallback(async () => {
    if (!aiInstruction.trim()) return

    try {
      setIsAiDesigning(true)
      const result =
        mode === 'asset-hub'
          ? await aiDesignAssetHubCharacter.mutateAsync(aiInstruction)
          : await aiCreateProjectCharacter.mutateAsync({
              userInstruction: aiInstruction,
            })

      if (result?.prompt) {
        setDescription(result.prompt)
        setAiInstruction('')
      }
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.aiDesignFailed')))
      }
    } finally {
      setIsAiDesigning(false)
    }
  }, [aiCreateProjectCharacter, aiDesignAssetHubCharacter, aiInstruction, mode, setAiInstruction, setDescription, t])

  const handleSubmit = useCallback(async () => {
    if (isSubAppearance) {
      if (!selectedCharacterId.trim() || !changeReason.trim() || !description.trim()) return
      try {
        setIsSubmitting(true)
        await createProjectAppearance.mutateAsync({
          characterId: selectedCharacterId,
          changeReason: changeReason.trim(),
          description: description.trim(),
        })
        onSuccess()
        onClose()
      } catch (error: unknown) {
        if (shouldShowError(error)) {
          alert(getErrorMessage(error, t('errors.addSubAppearanceFailed')))
        }
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    if (!name.trim() || !description.trim()) return
    try {
      setIsSubmitting(true)
      if (mode === 'asset-hub') {
        await createAssetHubCharacter.mutateAsync({
          name: name.trim(),
          description: description.trim(),
          folderId: folderId ?? null,
        })
      } else {
        await createProjectCharacter.mutateAsync({
          name: name.trim(),
          description: description.trim(),
          introduction: introduction.trim(),
          episodeId: episodeId || undefined,
        })
      }
      onSuccess()
      onClose()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.createFailed')))
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [
    changeReason,
    createAssetHubCharacter,
    createProjectAppearance,
    createProjectCharacter,
    description,
    episodeId,
    folderId,
    isSubAppearance,
    introduction,
    mode,
    name,
    onClose,
    onSuccess,
    selectedCharacterId,
    t,
  ])

  const handleCreateOnly = useCallback(async () => {
    if (!name.trim() || isSubAppearance) return

    try {
      setIsSubmitting(true)
      if (mode === 'asset-hub') {
        await createAssetHubCharacter.mutateAsync({
          name: name.trim(),
          description: t('character.defaultDescription', { name: name.trim() }),
          folderId: folderId ?? null,
        })
      } else {
        // The project API intentionally skips image generation when description
        // is empty, while still creating the character and primary appearance.
        await createProjectCharacter.mutateAsync({
          name: name.trim(),
          description: '',
          introduction: introduction.trim(),
          episodeId: episodeId || undefined,
        })
      }
      onSuccess()
      onClose()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.createFailed')))
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [createAssetHubCharacter, createProjectCharacter, episodeId, folderId, introduction, isSubAppearance, mode, name, onClose, onSuccess, t])

  const runProjectUpload = useCallback(async (existingTarget: SubjectUploadTarget | null) => {
    if (!projectId) throw new Error(t('errors.createFailed'))
    const imageSource = referenceImagesBase64[0]
    if (!imageSource) throw new Error(t('errors.uploadFailed'))

    const imageFile = dataUrlToImageFile(imageSource, `${name.trim()}-四視圖.png`)
    return await runResumableCreateWithUpload({
      existingTarget,
      createTarget: async () => {
        const idempotencyKey = manualUploadRequestIdRef.current ?? createSubjectUploadRequestId()
        manualUploadRequestIdRef.current = idempotencyKey
        const result = await createProjectCharacter.mutateAsync({
          name: name.trim(),
          description: '',
          introduction: introduction.trim(),
          episodeId: episodeId || undefined,
          idempotencyKey,
        })
        const characterId = result.character?.id
        const appearanceId = result.character?.appearances?.[0]?.id
        if (!characterId || !appearanceId) throw new Error(t('errors.createFailed'))
        return { createdId: characterId, targetId: appearanceId }
      },
      onCreated: async () => undefined,
      uploadTarget: async (target) => {
        await uploadProjectCharacterImage.mutateAsync({
          file: imageFile,
          characterId: target.createdId,
          appearanceId: target.targetId,
          imageIndex: 0,
          labelText: name.trim(),
        })
      },
    })
  }, [
    createProjectCharacter,
    episodeId,
    introduction,
    name,
    projectId,
    referenceImagesBase64,
    t,
    uploadProjectCharacterImage,
  ])

  const completeProjectUpload = useCallback(async (existingTarget: SubjectUploadTarget | null) => {
    const result = await runProjectUpload(existingTarget)
    if (result.status === 'upload-failed') {
      setUploadRecovery(result.target)
      setUploadError(t('errors.createdButUploadFailed'))
      return
    }

    setUploadRecovery(null)
    setUploadError(null)
    manualUploadRequestIdRef.current = null
    onSuccess()
    onClose()
  }, [onClose, onSuccess, runProjectUpload, t])

  const handleRetryUpload = useCallback(async () => {
    if (mode !== 'project' || !uploadRecovery) return
    try {
      setIsSubmitting(true)
      await completeProjectUpload(uploadRecovery)
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.uploadFailed')))
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [completeProjectUpload, mode, t, uploadRecovery])

  const handleCreateWithUpload = useCallback(async () => {
    if (!name.trim() || referenceImagesBase64.length === 0) return

    if (mode === 'project' && uploadRecovery) {
      await handleRetryUpload()
      return
    }

    try {
      setIsSubmitting(true)
      if (mode === 'asset-hub') {
        const data = await uploadAssetHubTemp.mutateAsync({
          imageBase64: referenceImagesBase64[0],
        })
        if (!data.url) throw new Error(t('errors.uploadFailed'))
        await createAssetHubCharacter.mutateAsync({
          name: name.trim(),
          description: description.trim() || t('character.defaultDescription', { name: name.trim() }),
          folderId: folderId ?? null,
          referenceImageUrls: [data.url],
          generateFromReference: true,
        })
      } else {
        await completeProjectUpload(null)
        return
      }

      onSuccess()
      onClose()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.createFailed')))
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [
    createAssetHubCharacter,
    completeProjectUpload,
    description,
    folderId,
    handleRetryUpload,
    mode,
    name,
    onClose,
    onSuccess,
    referenceImagesBase64,
    t,
    uploadAssetHubTemp,
    uploadRecovery,
  ])

  return {
    isSubmitting,
    isAiDesigning,
    isExtracting,
    uploadRecovery,
    uploadError,
    handleExtractDescription,
    handleCreateWithReference,
    handleCreateWithUpload,
    handleRetryUpload,
    handleAiDesign,
    handleSubmit,
    handleCreateOnly,
  }
}
