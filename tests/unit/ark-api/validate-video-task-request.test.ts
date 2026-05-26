import { describe, expect, it } from 'vitest'
import { validateArkVideoTaskRequest, type ArkVideoTaskRequest } from '@/lib/ark-api'

/**
 * Wrapper validator only — per-model accuracy (which model accepts which
 * duration / resolution / mode) lives in src/lib/generators/ark.ts
 * ARK_SEEDANCE_MODEL_SPECS and is exercised by the generator's own tests.
 * These cases lock the cross-cutting rules: 2.0 multi-modal content
 * types + new top-level fields + the widened duration upper bound.
 */
describe('validateArkVideoTaskRequest — 2026-05-26 (Seedance 2.0 P1/P2)', () => {
  function baseRequest(): ArkVideoTaskRequest {
    return {
      model: 'doubao-seedance-2-0-260128',
      content: [{ type: 'text', text: 'a quiet lavender field at dusk' }],
    }
  }

  describe('duration upper bound widened to 15s (P1 #4)', () => {
    it('accepts duration=15 (was rejected pre-widening)', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), duration: 15 }),
      ).not.toThrow()
    })

    it('accepts duration=13 / 14', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), duration: 13 }),
      ).not.toThrow()
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), duration: 14 }),
      ).not.toThrow()
    })

    it('rejects duration=16 (above widened bound)', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), duration: 16 }),
      ).toThrow(/duration=16/)
    })

    it('accepts duration=-1 (smart pick) verbatim', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), duration: -1 }),
      ).not.toThrow()
    })

    it('rejects non-integer duration', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), duration: 4.5 }),
      ).toThrow(/duration must be integer/)
    })
  })

  describe('video_url content item (P2 #6)', () => {
    it('accepts a reference_video content item with valid url', () => {
      expect(() =>
        validateArkVideoTaskRequest({
          ...baseRequest(),
          content: [
            { type: 'text', text: 'extend this clip' },
            { type: 'video_url', video_url: { url: 'https://example.com/clip.mp4' }, role: 'reference_video' },
          ],
        }),
      ).not.toThrow()
    })

    it('rejects video_url without url field', () => {
      expect(() =>
        validateArkVideoTaskRequest({
          ...baseRequest(),
          content: [
            { type: 'video_url', video_url: {} as { url: string } },
          ],
        }),
      ).toThrow(/video_url\.url is required/)
    })

    it('rejects video_url with role=reference_image (cross-type)', () => {
      expect(() =>
        validateArkVideoTaskRequest({
          ...baseRequest(),
          content: [
            {
              type: 'video_url',
              video_url: { url: 'https://example.com/clip.mp4' },
              role: 'reference_image',
            } as unknown as ArkVideoTaskRequest['content'][number],
          ],
        }),
      ).toThrow(/video_url only accepts 'reference_video'/)
    })
  })

  describe('audio_url content item (P2 #6)', () => {
    it('accepts a reference_audio content item with valid url', () => {
      expect(() =>
        validateArkVideoTaskRequest({
          ...baseRequest(),
          content: [
            { type: 'image_url', image_url: { url: 'https://example.com/face.jpg' }, role: 'first_frame' },
            { type: 'audio_url', audio_url: { url: 'https://example.com/dub.mp3' }, role: 'reference_audio' },
          ],
        }),
      ).not.toThrow()
    })

    it('rejects audio_url without url field', () => {
      expect(() =>
        validateArkVideoTaskRequest({
          ...baseRequest(),
          content: [
            { type: 'audio_url' } as unknown as ArkVideoTaskRequest['content'][number],
          ],
        }),
      ).toThrow(/audio_url\.url is required/)
    })

    it('rejects audio_url with role=reference_video (cross-type)', () => {
      expect(() =>
        validateArkVideoTaskRequest({
          ...baseRequest(),
          content: [
            {
              type: 'audio_url',
              audio_url: { url: 'https://example.com/dub.mp3' },
              role: 'reference_video',
            } as unknown as ArkVideoTaskRequest['content'][number],
          ],
        }),
      ).toThrow(/audio_url only accepts 'reference_audio'/)
    })
  })

  describe('priority field (P2 #7)', () => {
    it('accepts priority=0 (default) and priority=9 (boundary)', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), priority: 0 }),
      ).not.toThrow()
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), priority: 9 }),
      ).not.toThrow()
    })

    it('rejects priority outside 0-9', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), priority: -1 }),
      ).toThrow(/priority=-1/)
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), priority: 10 }),
      ).toThrow(/priority=10/)
    })

    it('rejects non-integer priority', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), priority: 3.5 }),
      ).toThrow(/priority=3\.5/)
    })
  })

  describe('safety_identifier field (P2 #7)', () => {
    it('accepts a 1-64 char string', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), safety_identifier: 'sha256-userhash' }),
      ).not.toThrow()
    })

    it('rejects empty string', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), safety_identifier: '' }),
      ).toThrow(/safety_identifier must be string 1-64 chars/)
    })

    it('rejects > 64 chars', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), safety_identifier: 'x'.repeat(65) }),
      ).toThrow(/safety_identifier must be string 1-64 chars/)
    })
  })

  describe('tools field (P2 #7)', () => {
    it('accepts an empty array', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), tools: [] }),
      ).not.toThrow()
    })

    it('accepts an array of opaque objects', () => {
      expect(() =>
        validateArkVideoTaskRequest({
          ...baseRequest(),
          tools: [{ type: 'web_search' }],
        }),
      ).not.toThrow()
    })

    it('rejects non-array', () => {
      expect(() =>
        // @ts-expect-error — intentionally malformed
        validateArkVideoTaskRequest({ ...baseRequest(), tools: { type: 'web_search' } }),
      ).toThrow(/tools must be an array/)
    })

    it('rejects non-object tool entry', () => {
      expect(() =>
        // @ts-expect-error — intentionally malformed
        validateArkVideoTaskRequest({ ...baseRequest(), tools: ['web_search'] }),
      ).toThrow(/tools\[0\] must be object/)
    })
  })

  describe('callback_url field (P2 #7)', () => {
    it('accepts an https URL', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), callback_url: 'https://example.com/webhook' }),
      ).not.toThrow()
    })

    it('rejects a non-http URL', () => {
      expect(() =>
        validateArkVideoTaskRequest({ ...baseRequest(), callback_url: 'ftp://example.com' }),
      ).toThrow(/callback_url must be http\(s\) URL/)
    })
  })

  describe('top-level field allowlist still rejects junk', () => {
    it('rejects an unknown top-level key', () => {
      expect(() =>
        // @ts-expect-error — intentionally unknown
        validateArkVideoTaskRequest({ ...baseRequest(), surprise: 'value' }),
      ).toThrow(/ARK_VIDEO_REQUEST_FIELD_UNSUPPORTED: surprise/)
    })
  })
})
