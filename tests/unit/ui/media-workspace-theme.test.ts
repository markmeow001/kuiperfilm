import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const WORKSPACE_ROOT = 'src/app/[locale]/v2/workspace/[projectId]'

describe('media workspace darkroom theme', () => {
  it('five media workspaces share the same darkroom surface contract', () => {
    const clients = [
      `${WORKSPACE_ROOT}/storyboard/V2StoryboardClient.tsx`,
      `${WORKSPACE_ROOT}/shot-builder/V2ShotBuilderClient.tsx`,
      `${WORKSPACE_ROOT}/clip-composer/V2ClipComposerClient.tsx`,
      `${WORKSPACE_ROOT}/voice/V2VoiceClient.tsx`,
      `${WORKSPACE_ROOT}/final/V2FinalClient.tsx`,
    ]

    for (const client of clients) {
      expect(readFileSync(client, 'utf8')).toContain('MediaWorkspaceSurface')
    }
  })

  it('preview wells use layered stages and final delivery alone uses editorial gold', () => {
    const shotBuilder = readFileSync(
      `${WORKSPACE_ROOT}/shot-builder/V2ShotBuilderClient.tsx`,
      'utf8',
    )
    const clipComposer = readFileSync(
      `${WORKSPACE_ROOT}/clip-composer/V2ClipComposerClient.tsx`,
      'utf8',
    )
    const finalDelivery = readFileSync(
      `${WORKSPACE_ROOT}/final/V2FinalClient.tsx`,
      'utf8',
    )
    const theme = readFileSync(
      'src/components/v2/MediaWorkspaceSurface.module.css',
      'utf8',
    )

    expect(shotBuilder).toContain('mediaWorkspaceClasses.stage')
    expect(shotBuilder).toContain('mediaWorkspaceClasses.mediaWell')
    expect(clipComposer).toContain('mediaWorkspaceClasses.editorFrame')
    expect(clipComposer).toContain('mediaWorkspaceClasses.stage')
    expect(clipComposer).toContain('mediaWorkspaceClasses.mobileDock')
    expect(finalDelivery).toContain('mediaWorkspaceClasses.deliveryPanel')
    expect(finalDelivery).toContain('mediaWorkspaceClasses.deliverAction')
    expect(theme).toContain('--surface-canvas: var(--darkroom-canvas)')
    expect(theme).toContain('--primary-400: var(--process-cyan)')
    expect(theme).toContain('--media-gold: var(--editorial-500)')
    expect(theme).toContain(':global(:focus-visible)')
    expect(theme).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
