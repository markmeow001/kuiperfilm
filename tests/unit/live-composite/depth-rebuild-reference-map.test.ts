// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type {
  DepthRebuildCharacterReference,
  DepthRebuildSceneReference,
  LocalDepthReferenceImage,
} from '@/app/[locale]/live-composite/depth-rebuild-assets'
import { buildDepthRebuildReferenceMap } from '@/app/[locale]/live-composite/lib/depth-rebuild-reference-map'

function image(name: string): LocalDepthReferenceImage {
  return {
    file: new File(['image'], name, { type: 'image/png' }),
    previewUrl: `blob:${name}`,
  }
}

function character(
  id: string,
  label: string,
  fileName: string | null,
): DepthRebuildCharacterReference {
  return {
    id,
    label,
    sourceBinding: `原片人物 ${id}`,
    brief: '',
    description: `${label} 的完整外觀`,
    image: fileName ? image(fileName) : null,
  }
}

function scene(id: string, note: string, fileName: string): DepthRebuildSceneReference {
  return {
    id,
    note,
    image: image(fileName),
  }
}

describe('深度重建參考圖 canonical map', () => {
  it('兩人加兩場景 -> 不受 UI 分區影響，固定角色優先再場景並連續編 image N', () => {
    const result = buildDepthRebuildReferenceMap(
      [
        character('groom', '新郎', 'groom.png'),
        character('bride', '新娘', 'bride.png'),
      ],
      [
        scene('courtyard', '宅邸庭院', 'courtyard.png'),
        scene('lighting', '雨夜光影', 'lighting.png'),
      ],
    )

    expect(result.ordered.map((reference) => ({
      id: reference.id,
      ownerId: reference.ownerId,
      kind: reference.kind,
      token: reference.token,
      name: reference.name,
      fileName: reference.image.file.name,
    }))).toEqual([
      {
        id: 'character:groom',
        ownerId: 'groom',
        kind: 'character',
        token: 'image 1',
        name: '角色：新郎',
        fileName: 'groom.png',
      },
      {
        id: 'character:bride',
        ownerId: 'bride',
        kind: 'character',
        token: 'image 2',
        name: '角色：新娘',
        fileName: 'bride.png',
      },
      {
        id: 'scene:courtyard',
        ownerId: 'courtyard',
        kind: 'scene',
        token: 'image 3',
        name: '場景參考 1',
        fileName: 'courtyard.png',
      },
      {
        id: 'scene:lighting',
        ownerId: 'lighting',
        kind: 'scene',
        token: 'image 4',
        name: '場景參考 2',
        fileName: 'lighting.png',
      },
    ])
    expect([...result.tokensByCharacterId.entries()]).toEqual([
      ['groom', 'image 1'],
      ['bride', 'image 2'],
    ])
    expect(result.sceneTokens).toEqual(['image 3', 'image 4'])
  })

  it('角色尚未上圖 -> 不占用 image N，後續角色與場景仍連續編號', () => {
    const result = buildDepthRebuildReferenceMap(
      [
        character('pending', '尚未上圖角色', null),
        character('ready', '已上圖角色', 'ready.png'),
      ],
      [scene('street', '街景', 'street.png')],
    )

    expect(result.ordered.map((reference) => reference.token)).toEqual(['image 1', 'image 2'])
    expect(result.ordered.map((reference) => reference.id)).toEqual([
      'character:ready',
      'scene:street',
    ])
    expect(result.tokensByCharacterId.has('pending')).toBe(false)
    expect(result.tokensByCharacterId.get('ready')).toBe('image 1')
    expect(result.sceneTokens).toEqual(['image 2'])
  })

  it('沒有場景參考 -> 只回傳角色順序且 sceneTokens 為空', () => {
    const result = buildDepthRebuildReferenceMap(
      [
        character('left', '左側人物', 'left.png'),
        character('right', '右側人物', 'right.png'),
      ],
      [],
    )

    expect(result.ordered.map((reference) => reference.token)).toEqual(['image 1', 'image 2'])
    expect(result.ordered.every((reference) => reference.kind === 'character')).toBe(true)
    expect(result.sceneTokens).toEqual([])
  })
})
