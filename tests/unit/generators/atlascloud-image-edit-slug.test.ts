import { describe, it, expect } from 'vitest'
import { resolveAtlasCloudImageModel } from '@/lib/generators/image/atlascloud'

describe('resolveAtlasCloudImageModel', () => {
  describe('text-to-image (no references)', () => {
    it('maps logical ids to /text-to-image slugs', () => {
      expect(resolveAtlasCloudImageModel('gpt-image-2', false)).toBe('openai/gpt-image-2/text-to-image')
      expect(resolveAtlasCloudImageModel('nano-banana-pro', false)).toBe('google/nano-banana-pro/text-to-image')
      expect(resolveAtlasCloudImageModel('nano-banana', false)).toBe('google/nano-banana/text-to-image')
      expect(resolveAtlasCloudImageModel('nano-banana-2', false)).toBe('google/nano-banana-2/text-to-image')
    })

    it('defaults to nano-banana-pro t2i for unknown ids', () => {
      expect(resolveAtlasCloudImageModel('does-not-exist', false)).toBe('google/nano-banana-pro/text-to-image')
      expect(resolveAtlasCloudImageModel(undefined, false)).toBe('google/nano-banana-pro/text-to-image')
    })
  })

  describe('img2img (references present → useEdit)', () => {
    it('maps logical ids to /edit slugs', () => {
      expect(resolveAtlasCloudImageModel('gpt-image-2', true)).toBe('openai/gpt-image-2/edit')
      expect(resolveAtlasCloudImageModel('nano-banana-pro', true)).toBe('google/nano-banana-pro/edit')
      expect(resolveAtlasCloudImageModel('nano-banana', true)).toBe('google/nano-banana/edit')
      expect(resolveAtlasCloudImageModel('nano-banana-2', true)).toBe('google/nano-banana-2/edit')
    })

    it('defaults to nano-banana-pro /edit for unknown ids', () => {
      expect(resolveAtlasCloudImageModel('does-not-exist', true)).toBe('google/nano-banana-pro/edit')
    })
  })

  describe('full-slug passthrough swaps the suffix to match mode', () => {
    it('swaps a full t2i slug to /edit when useEdit', () => {
      expect(resolveAtlasCloudImageModel('google/nano-banana-pro/text-to-image', true)).toBe('google/nano-banana-pro/edit')
    })

    it('swaps a full /edit slug to t2i when not useEdit', () => {
      expect(resolveAtlasCloudImageModel('google/nano-banana-pro/edit', false)).toBe('google/nano-banana-pro/text-to-image')
    })

    it('keeps a full slug stable when mode already matches', () => {
      expect(resolveAtlasCloudImageModel('openai/gpt-image-2/edit', true)).toBe('openai/gpt-image-2/edit')
      expect(resolveAtlasCloudImageModel('openai/gpt-image-2/text-to-image', false)).toBe('openai/gpt-image-2/text-to-image')
    })

    it('only swaps an END-anchored suffix, not a substring mid-slug', () => {
      // A hypothetical model whose NAME contains "edit" must not be corrupted.
      // It has no /text-to-image or /edit suffix → falls back to the default.
      expect(resolveAtlasCloudImageModel('vendor/photo-editor/preview', true)).toBe('google/nano-banana-pro/edit')
    })
  })
})
