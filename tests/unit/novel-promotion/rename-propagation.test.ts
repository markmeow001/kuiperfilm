/**
 * Phase R-2 regression — rename propagation rewrites panel refs safely.
 *
 * Locks the substring-collision guards that prevent renaming "王" from
 * corrupting "王國" in another panel, and the JSON-structured rewrite
 * that targets only the `name` field (never blindly REPLACE()s the
 * whole row).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  propagateCharacterRename,
  propagatePropRename,
  propagateLocationRename,
} from '@/lib/novel-promotion/rename-propagation'

function makeTxStub(panels: Array<{ id: string; characters?: string | null; props?: string | null; location?: string | null }>) {
  const updateSpy = vi.fn(async () => ({}))
  return {
    tx: {
      novelPromotionPanel: {
        findMany: vi.fn(async ({ where }: { where: { characters?: { contains: string }; props?: { contains: string }; location?: { contains: string } } }) => {
          if (where.characters?.contains) {
            const needle = where.characters.contains
            return panels.filter((p) => p.characters?.includes(needle)).map((p) => ({ id: p.id, characters: p.characters ?? null }))
          }
          if (where.props?.contains) {
            const needle = where.props.contains
            return panels.filter((p) => p.props?.includes(needle)).map((p) => ({ id: p.id, props: p.props ?? null }))
          }
          if (where.location?.contains) {
            const needle = where.location.contains
            return panels.filter((p) => p.location?.includes(needle)).map((p) => ({ id: p.id, location: p.location ?? null }))
          }
          return []
        }),
        update: updateSpy,
      },
    },
    updateSpy,
  }
}

describe('propagateCharacterRename', () => {
  it('rewrites name in JSON object form', async () => {
    const { tx, updateSpy } = makeTxStub([
      { id: 'p1', characters: JSON.stringify([{ name: 'Karrug', appearance: 'a1' }, { name: 'Zara' }]) },
    ])
    const result = await propagateCharacterRename(tx as any, 'proj1', 'Karrug', 'Khoda')
    expect(result.panelsRewritten).toBe(1)
    expect(updateSpy).toHaveBeenCalledOnce()
    const call = updateSpy.mock.calls[0][0]
    const next = JSON.parse(call.data.characters)
    expect(next[0].name).toBe('Khoda')
    expect(next[0].appearance).toBe('a1') // unchanged sibling fields preserved
    expect(next[1].name).toBe('Zara')     // unrelated character untouched
  })

  it('rewrites name in legacy string-array form', async () => {
    const { tx, updateSpy } = makeTxStub([
      { id: 'p1', characters: JSON.stringify(['Karrug', 'Zara']) },
    ])
    await propagateCharacterRename(tx as any, 'proj1', 'Karrug', 'Khoda')
    const call = updateSpy.mock.calls[0][0]
    expect(JSON.parse(call.data.characters)).toEqual(['Khoda', 'Zara'])
  })

  it('NEVER substring-collides — renaming 王 does NOT touch 王國', async () => {
    // The prisma LIKE %王% prefilter WILL return panels with 王國;
    // structured rewrite must compare `name === oldName` strictly so
    // 王國 stays unchanged when renaming 王 → 王玄.
    const { tx, updateSpy } = makeTxStub([
      { id: 'p1', characters: JSON.stringify([{ name: '王國' }]) },
    ])
    const result = await propagateCharacterRename(tx as any, 'proj1', '王', '王玄')
    expect(result.panelsRewritten).toBe(0)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('no-op when oldName === newName', async () => {
    const { tx, updateSpy } = makeTxStub([
      { id: 'p1', characters: JSON.stringify([{ name: 'Karrug' }]) },
    ])
    const result = await propagateCharacterRename(tx as any, 'proj1', 'Karrug', 'Karrug')
    expect(result.panelsRewritten).toBe(0)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('no-op when names are empty / whitespace', async () => {
    const { tx, updateSpy } = makeTxStub([{ id: 'p1', characters: '[]' }])
    expect((await propagateCharacterRename(tx as any, 'p1', '', 'Khoda')).panelsRewritten).toBe(0)
    expect((await propagateCharacterRename(tx as any, 'p1', '   ', 'Khoda')).panelsRewritten).toBe(0)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('handles malformed JSON gracefully (leaves panel untouched)', async () => {
    const { tx, updateSpy } = makeTxStub([
      { id: 'p1', characters: 'not-json{{' },
    ])
    const result = await propagateCharacterRename(tx as any, 'proj1', 'Karrug', 'Khoda')
    expect(result.panelsRewritten).toBe(0)
    expect(updateSpy).not.toHaveBeenCalled()
  })
})

describe('propagatePropRename', () => {
  it('rewrites prop name structurally', async () => {
    const { tx, updateSpy } = makeTxStub([
      { id: 'p1', props: JSON.stringify([{ name: '骨杖' }, { name: '銀劍' }]) },
    ])
    await propagatePropRename(tx as any, 'proj1', '骨杖', '靈骨杖')
    const call = updateSpy.mock.calls[0][0]
    expect(JSON.parse(call.data.props)).toEqual([{ name: '靈骨杖' }, { name: '銀劍' }])
  })
})

describe('propagateLocationRename', () => {
  it('rewrites bare "Name" location', async () => {
    const { tx, updateSpy } = makeTxStub([
      { id: 'p1', location: '懸崖洞穴' },
    ])
    await propagateLocationRename(tx as any, 'proj1', '懸崖洞穴', '神殿廢墟')
    expect(updateSpy.mock.calls[0][0].data.location).toBe('神殿廢墟')
  })

  it('rewrites "Name#viewHint" preserving the hint segment', async () => {
    const { tx, updateSpy } = makeTxStub([
      { id: 'p1', location: '懸崖洞穴#深夜' },
    ])
    await propagateLocationRename(tx as any, 'proj1', '懸崖洞穴', '神殿廢墟')
    expect(updateSpy.mock.calls[0][0].data.location).toBe('神殿廢墟#深夜')
  })

  it('does NOT touch location when head segment differs (substring hit only)', async () => {
    // Renaming "院子" should NOT touch "別院子" — head segment must
    // be exact match, not substring.
    const { tx, updateSpy } = makeTxStub([
      { id: 'p1', location: '別院子' },
    ])
    const result = await propagateLocationRename(tx as any, 'proj1', '院子', '中庭')
    expect(result.panelsRewritten).toBe(0)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('does NOT touch location when oldName matches viewHint but not head', async () => {
    // "森林#中央" — renaming "中央" should leave it alone (the head
    // segment "森林" is the actual location). prisma prefilter via LIKE
    // %中央% would return this row; structured guard rejects.
    const { tx, updateSpy } = makeTxStub([
      { id: 'p1', location: '森林#中央' },
    ])
    const result = await propagateLocationRename(tx as any, 'proj1', '中央', '南方')
    expect(result.panelsRewritten).toBe(0)
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
