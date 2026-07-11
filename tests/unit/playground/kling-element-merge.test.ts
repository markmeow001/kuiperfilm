/**
 * mergeNamedRefImagesIntoElements (2026-07-10 shared naming UI).
 *
 * Named plain reference images become single-image Kling subjects appended
 * after the explicit 主體 cards; unnamed stay plain images. Element order
 * matters — <<<element_N>>> tokens index into the merged array.
 */
import { describe, expect, it } from 'vitest'
import { mergeNamedRefImagesIntoElements } from '@/app/[locale]/playground/useKlingElements'

const EL = { name: 'Vera', imageKeys: ['images/vera-1.png', 'images/vera-2.png'] }

describe('mergeNamedRefImagesIntoElements', () => {
  it('appends named images after explicit elements; unnamed stay plain', () => {
    const out = mergeNamedRefImagesIntoElements(
      [EL],
      [
        { key: 'images/a.png' },
        { key: 'images/hayes.png', name: 'Hayes' },
        { key: 'images/b.png', name: '  ' },
      ],
    )
    expect(out.error).toBeNull()
    expect(out.elements).toEqual([
      { name: 'Vera', imageKeys: ['images/vera-1.png', 'images/vera-2.png'] },
      { name: 'Hayes', imageKeys: ['images/hayes.png'] },
    ])
    expect(out.plainImageKeys).toEqual(['images/a.png', 'images/b.png'])
  })

  it('errors when combined count exceeds 6', () => {
    const els = Array.from({ length: 5 }, (_, i) => ({ name: `E${i}`, imageKeys: ['k'] }))
    const out = mergeNamedRefImagesIntoElements(els, [
      { key: 'x', name: 'X' },
      { key: 'y', name: 'Y' },
    ])
    expect(out.error).toMatch(/最多 6/)
  })

  it('errors on duplicate names across the two sources', () => {
    const out = mergeNamedRefImagesIntoElements([EL], [{ key: 'x', name: 'Vera' }])
    expect(out.error).toMatch(/重複/)
  })

  it('no elements + no names = empty merge, all plain', () => {
    const out = mergeNamedRefImagesIntoElements([], [{ key: 'a' }, { key: 'b' }])
    expect(out.error).toBeNull()
    expect(out.elements).toEqual([])
    expect(out.plainImageKeys).toEqual(['a', 'b'])
  })
})
