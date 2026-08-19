import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('voice system catalog client contract', () => {
  it('[V2 and legacy casting surfaces] -> [system catalog only; exact preset payload; no raw/custom creation path]', () => {
    const v2 = read('src/app/[locale]/v2/workspace/[projectId]/voice/V2VoiceClient.tsx')
    const legacy = read('src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/SpeakerVoiceBindingDialog.tsx')
    const runtime = read('src/lib/novel-promotion/stages/voice-stage-runtime-core.tsx')
    const mutations = read('src/lib/query/mutations/useVoiceMutations.ts')

    expect(v2).toContain('useProjectVoicePresets')
    expect(v2).not.toContain('useGlobalVoices')
    expect(v2).not.toContain('characterVoiceBySpeaker')
    expect(v2).toContain('voicePresetId: selectedVoice.id')

    expect(legacy).toContain('useProjectVoicePresets')
    expect(legacy).not.toContain('VoicePickerDialog')
    expect(legacy).not.toContain('VoiceCreationModal')
    expect(legacy).toContain('disabled')
    expect(runtime).toContain('voicePresetId')
    expect(runtime).not.toContain('audioUrl,\n    voiceType')

    expect(mutations).toContain('/voice-presets')
    expect(mutations).toContain('voicePresetId: string')
    expect(mutations).not.toContain('audioUrl: string\n            voiceType?: string')
  })

})
