import { describe, expect, it } from 'vitest'
import { roleAtLeast } from '@/lib/api-auth'

describe('roleAtLeast — admin > editor > member hierarchy', () => {
  describe('threshold = "admin"', () => {
    it('only admin passes', () => {
      expect(roleAtLeast('admin', 'admin')).toBe(true)
      expect(roleAtLeast('editor', 'admin')).toBe(false)
      expect(roleAtLeast('member', 'admin')).toBe(false)
    })
  })

  describe('threshold = "editor" (admin auto-covers)', () => {
    it('admin passes (auto-covers editor capability)', () => {
      expect(roleAtLeast('admin', 'editor')).toBe(true)
    })
    it('editor passes', () => {
      expect(roleAtLeast('editor', 'editor')).toBe(true)
    })
    it('member fails', () => {
      expect(roleAtLeast('member', 'editor')).toBe(false)
    })
  })

  describe('threshold = "member" (any active role)', () => {
    it('all three roles pass', () => {
      expect(roleAtLeast('admin', 'member')).toBe(true)
      expect(roleAtLeast('editor', 'member')).toBe(true)
      expect(roleAtLeast('member', 'member')).toBe(true)
    })
  })

  describe('null / undefined / unknown role inputs', () => {
    it('returns false for null/undefined regardless of threshold', () => {
      expect(roleAtLeast(null, 'admin')).toBe(false)
      expect(roleAtLeast(undefined, 'editor')).toBe(false)
      expect(roleAtLeast(null, 'member')).toBe(false)
    })
    it('returns false for unrecognised role strings', () => {
      expect(roleAtLeast('superuser', 'admin')).toBe(false)
      expect(roleAtLeast('viewer', 'editor')).toBe(false)
      expect(roleAtLeast('', 'member')).toBe(false)
    })
  })
})
