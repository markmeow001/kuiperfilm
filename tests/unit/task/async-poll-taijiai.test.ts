import { describe, expect, it } from 'vitest'
import { parseExternalId } from '@/lib/async-poll'

describe('parseExternalId — TAIJIAI', () => {
  it('parses TAIJIAI:VIDEO:<id>', () => {
    const parsed = parseExternalId('TAIJIAI:VIDEO:vid_abc')
    expect(parsed.provider).toBe('TAIJIAI')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.requestId).toBe('vid_abc')
  })

  it('rejects non-VIDEO type', () => {
    expect(() => parseExternalId('TAIJIAI:IMAGE:x')).toThrow(/无效 TAIJIAI externalId/)
  })

  it('rejects missing id', () => {
    expect(() => parseExternalId('TAIJIAI:VIDEO:')).toThrow(/无效 TAIJIAI externalId/)
  })
})
