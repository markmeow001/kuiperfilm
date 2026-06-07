/**
 * 2026-06-07 — shared OpenAI-compatible base-URL normalization.
 *
 * The ⚡ test-connection used the RAW provider baseUrl (no /v1) while the
 * runtime LLM path appended /v1 via normalizeProviderBaseUrl — so a custom
 * OpenAI-compatible provider (e.g. X-AIO, base https://api.x-aio.com) tested
 * against https://api.x-aio.com/models (wrong) but actually ran against
 * https://api.x-aio.com/v1/... (right), giving a false-negative 401 in the
 * UI even though generation worked. This extracts the /v1 logic so both
 * paths use the SAME function.
 */
import { describe, expect, it } from 'vitest'
import { ensureOpenAiV1Path } from '@/lib/llm/openai-base-url'

describe('ensureOpenAiV1Path', () => {
  it('appends /v1 when the base URL has no path', () => {
    expect(ensureOpenAiV1Path('https://api.x-aio.com')).toBe('https://api.x-aio.com/v1')
  })
  it('appends /v1 when the base URL has only a trailing slash', () => {
    expect(ensureOpenAiV1Path('https://api.x-aio.com/')).toBe('https://api.x-aio.com/v1')
  })
  it('does NOT double up when /v1 is already present', () => {
    expect(ensureOpenAiV1Path('https://api.x-aio.com/v1')).toBe('https://api.x-aio.com/v1')
  })
  it('leaves a deeper path that already contains a v1 segment alone', () => {
    expect(ensureOpenAiV1Path('https://api.x-aio.com/v1/')).toContain('/v1')
    expect(ensureOpenAiV1Path('https://gw.example.com/proxy/v1')).toBe('https://gw.example.com/proxy/v1')
  })
  it('preserves a non-v1 sub-path and appends /v1 after it', () => {
    expect(ensureOpenAiV1Path('https://gw.example.com/openai')).toBe('https://gw.example.com/openai/v1')
  })
  it('returns the input unchanged when it is not a valid URL', () => {
    expect(ensureOpenAiV1Path('not a url')).toBe('not a url')
  })
})
