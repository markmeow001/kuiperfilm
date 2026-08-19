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
  it('[Consent schema is absent] -> [reachable project UI has no custom upload or AI-design mutation hook]', () => {
    const combinedSource = projectUiFiles.map(source).join('\n')

    expect(combinedSource).not.toContain('useUploadProjectCharacterVoice')
    expect(combinedSource).not.toContain('useDesignProjectVoice')
    expect(source(projectUiFiles[2])).not.toContain('useTTSGeneration')
    expect(source(projectUiFiles[3])).not.toContain('<VoiceDesignDialog')
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

  it('[project-only shutdown] -> [global Asset Hub voice tools remain available]', () => {
    const globalVoiceSettings = source(
      'src/app/[locale]/workspace/asset-hub/components/VoiceSettings.tsx',
    )

    expect(globalVoiceSettings).toContain('type="file"')
    expect(globalVoiceSettings).toContain('onVoiceDesign')
  })
})
