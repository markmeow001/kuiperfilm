/**
 * Server-side canvas save schema — regression net for the 2026-07-18 mask
 * incident: NODE_TYPES / edge portType / role enums live in THREE synced
 * copies (client canvas-tokens, client canvas-serialize, server
 * canvas-validation). The server copy was missed when the mask node (45a1285)
 * and the mask→image edge shipped, so any canvas containing them failed the
 * whole save silently. Every client-known node type and edge port/role must
 * pass the server schema.
 */
import { describe, expect, it } from 'vitest'
import { canvasSaveSchema } from '@/lib/canvas/canvas-validation'

const BASE = {
  title: 't',
  kind: 'canvas' as const,
  viewport: { x: 0, y: 0, zoom: 1 },
}

function nodeOf(type: string) {
  return { id: `n-${type}`, type, x: 0, y: 0, data: {} }
}

// Mirror of client canvas-tokens CanvasNodeType — update BOTH when adding a type.
const CLIENT_NODE_TYPES = ['character', 'image', 'video', 'text', 'director', 'script', 'audio', 'composition', 'mask', 'group']
// Mirror of client canvas-types CanvasPortType.
const CLIENT_PORT_TYPES = ['text', 'script', 'identity-image', 'frame-image', 'video-clip', 'audio-voice', 'audio-music', 'storyboard-group', 'mask-image']
// Mirror of client canvas-types CanvasEdgeData.role.
const CLIENT_EDGE_ROLES = ['first-frame', 'last-frame', 'reference', 'clip', 'voice', 'music', 'mask']

describe('canvasSaveSchema stays in sync with the client type copies', () => {
  it.each(CLIENT_NODE_TYPES)('accepts a canvas containing a %s node', (type) => {
    const parsed = canvasSaveSchema.safeParse({ ...BASE, nodes: [nodeOf(type)], edges: [] })
    expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues[0])).toBe(true)
  })

  it.each(CLIENT_PORT_TYPES)('accepts an edge with portType %s', (portType) => {
    const parsed = canvasSaveSchema.safeParse({
      ...BASE,
      nodes: [nodeOf('image'), nodeOf('mask')],
      edges: [{ id: 'e1', source: 'n-mask', target: 'n-image', data: { portType } }],
    })
    expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues[0])).toBe(true)
  })

  it.each(CLIENT_EDGE_ROLES)('accepts an edge with role %s', (role) => {
    const parsed = canvasSaveSchema.safeParse({
      ...BASE,
      nodes: [nodeOf('image'), nodeOf('mask')],
      edges: [{ id: 'e1', source: 'n-mask', target: 'n-image', data: { portType: 'mask-image', role } }],
    })
    expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues[0])).toBe(true)
  })

  it('the 2026-07-18 incident payload — mask node + mask→image edge — round-trips', () => {
    const parsed = canvasSaveSchema.safeParse({
      ...BASE,
      nodes: [
        nodeOf('image'),
        { ...nodeOf('mask'), data: { maskPaths: [{ mode: 'add', brushSize: 18, points: [{ x: 0.1, y: 0.1 }] }] } },
      ],
      edges: [{ id: 'e1', source: 'n-mask', target: 'n-image', data: { portType: 'mask-image', role: 'mask' } }],
    })
    expect(parsed.success).toBe(true)
  })

  it('still rejects unknown node types loudly', () => {
    expect(canvasSaveSchema.safeParse({ ...BASE, nodes: [nodeOf('not-a-type')], edges: [] }).success).toBe(false)
  })
})
