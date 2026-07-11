'use client'

/**
 * Kling O3 named-subject (elements) state + handlers (2026-07-10).
 *
 * Extracted from usePlaygroundController (file was already at its
 * line-count budget). Owns the 主體綁定 drafts: ≤6 subjects, each a name
 * + 1-4 uploaded reference images (first = frontal_image). The Kling API
 * binds subjects via <<<element_N>>> prompt tokens; users type NAMES and
 * the worker swaps them (see lib/playground/element-tokens.ts), so this
 * hook never exposes token syntax.
 */

import { useState } from 'react'
import type { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'

export const MAX_KLING_ELEMENTS = 6
export const MAX_KLING_ELEMENT_IMAGES = 4
/** Kling O3 schema enum — the shared aspect picker offers more (4:3 …) which 400s. */
export const KLING_O3_ASPECT_RATIO_VALUES = ['16:9', '9:16', '1:1'] as const
/** Kling O3 plain-images cap: 7, or 4 when a reference video is bound. */
export const MAX_KLING_IMAGES = 7
export const MAX_KLING_IMAGES_WITH_VIDEO = 4

export interface KlingElementDraft {
  /**
   * Stable identity for updates + React keys. Array INDEX must not be used
   * to target async updates: an upload resolving after another subject was
   * removed would re-index and attach the image to the wrong subject.
   * (2026-07-10 review HIGH-3)
   */
  id: string
  name: string
  images: Array<{ key: string; signedUrl: string }>
}

/**
 * Pre-submit validation. Returns a blocking error message, or null when
 * submittable. `unmentioned` lists subject names absent from the prompt —
 * a soft warning (unreferenced subjects still bind, just weaker), the
 * caller decides whether to confirm with the user.
 */
export function validateKlingElements(
  elements: readonly KlingElementDraft[],
  effectivePrompt: string,
): { error: string | null; unmentioned: string[] } {
  const emptyName = elements.find((el) => !el.name.trim())
  if (emptyName) {
    return { error: '每個主體都需要名稱（例如「Vera」「古宅」），prompt 裡打名字即可綁定', unmentioned: [] }
  }
  const noImage = elements.find((el) => el.images.length === 0)
  if (noImage) {
    return { error: `主體「${noImage.name}」還沒有參考圖（需要 1-${MAX_KLING_ELEMENT_IMAGES} 張）`, unmentioned: [] }
  }
  const names = elements.map((el) => el.name.trim())
  if (new Set(names).size !== names.length) {
    return { error: '主體名稱不能重複', unmentioned: [] }
  }
  return { error: null, unmentioned: names.filter((n) => !effectivePrompt.includes(n)) }
}

export function useKlingElements(upload: ReturnType<typeof useUploadPlaygroundReference>) {
  const [elements, setElements] = useState<KlingElementDraft[]>([])

  function addElement() {
    if (elements.length >= MAX_KLING_ELEMENTS) {
      alert(`主體最多 ${MAX_KLING_ELEMENTS} 個`)
      return
    }
    setElements((prev) => [...prev, { id: crypto.randomUUID(), name: '', images: [] }])
  }

  function removeElement(id: string) {
    setElements((prev) => prev.filter((el) => el.id !== id))
  }

  function setElementName(id: string, name: string) {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, name } : el)))
  }

  async function handleElementImagePick(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const el = elements.find((entry) => entry.id === id)
    if (!el) return
    if (el.images.length >= MAX_KLING_ELEMENT_IMAGES) {
      alert(`每個主體最多 ${MAX_KLING_ELEMENT_IMAGES} 張參考圖`)
      return
    }
    try {
      const result = await upload.mutateAsync({ file, type: 'image' })
      // Match by id, NOT index — the array may have re-indexed while the
      // upload was in flight (subject removed mid-upload).
      setElements((prev) => prev.map((entry) => (
        entry.id === id
          ? { ...entry, images: [...entry.images, { key: result.key, signedUrl: result.signedUrl }] }
          : entry
      )))
    } catch (err) {
      alert(`圖片上傳失敗:${(err as Error)?.message ?? '未知錯誤'}`)
    }
  }

  function removeElementImage(id: string, imgKey: string) {
    setElements((prev) => prev.map((entry) => (
      entry.id === id
        ? { ...entry, images: entry.images.filter((img) => img.key !== imgKey) }
        : entry
    )))
  }

  function clearElements() {
    setElements([])
  }

  return {
    elements,
    addElement, removeElement, setElementName, handleElementImagePick, removeElementImage,
    clearElements,
  }
}
