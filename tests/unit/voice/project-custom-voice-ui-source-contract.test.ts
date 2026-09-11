import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectUiFiles = [
  'src/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterEditModal.tsx',
  'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/VoiceSettings.tsx',
  'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/AssetsStage.tsx',
  'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/AssetsStageModals.tsx',
  'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/VoiceDesignDialog.tsx',
] as const

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('project custom voice UI source contract', () => {
  // These are source-shape assertions only: they stop the UI from growing a
  // new caller. The authoritative guard that the endpoints themselves refuse
  // is tests/integration/api/voice-design-consent-boundary.test.ts, which
  // asserts the actual 400 + VOICE_SOURCE_CONSENT_REQUIRED response.
  it('[Consent schema is absent] -> [reachable project UI has no custom upload or AI-design mutation hook]', () => {
    const combinedSource = projectUiFiles.map(source).join('\n')

    expect(combinedSource).not.toContain('useUploadProjectCharacterVoice')
    expect(combinedSource).not.toContain('useDesignProjectVoice')
    expect(source(projectUiFiles[2])).not.toContain('useTTSGeneration')
    expect(source(projectUiFiles[3])).not.toContain('<VoiceDesignDialog')
  })

  it('[AI voice design is closed] -> [the mutation hook is absent from the whole query layer, not just the UI]', () => {
    const queryLayer = [
      'src/lib/query/mutations/useVoiceMutations.ts',
      'src/lib/query/hooks/index.ts',
    ].map(source).join('\n')

    expect(queryLayer).not.toContain('useDesignProjectVoice')
    expect(queryLayer).not.toContain('/voice-design')
  })

  it('[zh/en catalogs load] -> [both locales explain the consent and revocation gate]', () => {
    const zh = JSON.parse(source('messages/zh/voice.json')) as {
      inlineBinding: { customSourceUnavailable: string }
    }
    const en = JSON.parse(source('messages/en/voice.json')) as {
      inlineBinding: { customSourceUnavailable: string }
    }

    expect(zh.inlineBinding.customSourceUnavailable).toContain('同意')
    expect(zh.inlineBinding.customSourceUnavailable).toContain('撤销')
    expect(en.inlineBinding.customSourceUnavailable).toContain('consent')
    expect(en.inlineBinding.customSourceUnavailable).toContain('revocation')
  })

  // This case used to assert the opposite -- that the Asset Hub kept a live
  // file input and AI-design entry, on the premise that the shutdown was
  // project-only. That premise expired 7 minutes after it was written: the
  // AtlasCloud cutover (9acd5e7) put rejectLegacyCustomVoiceWrite(), which
  // throws unconditionally, in front of every Asset Hub voice write
  // (/voices/upload, /voice-design, /voices, /character-voice), and
  // tests/integration/api/asset-hub-voice-consent-boundary.test.ts asserts the
  // resulting 400s. The stale assertion held the known defect in place, so it
  // now guards the alignment instead of the misalignment.
  it('[Asset Hub voice writes are closed] -> [its VoiceSettings offers no upload or AI-design control]', () => {
    const globalVoiceSettings = source(
      'src/app/[locale]/workspace/asset-hub/components/VoiceSettings.tsx',
    )

    expect(globalVoiceSettings).not.toContain('type="file"')
    expect(globalVoiceSettings).not.toContain('onVoiceDesign(')
    expect(globalVoiceSettings).not.toContain('useUploadCharacterVoice')
    expect(globalVoiceSettings).toContain('customSourceUnavailable')
  })
})
