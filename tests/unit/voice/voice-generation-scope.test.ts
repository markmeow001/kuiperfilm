import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionVoiceLine: {
    findFirst: vi.fn(),
  },
  voicePreset: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  parseVoiceLineGenerationInput,
  resolveVoiceLineGenerationInput,
  resolveVoiceLineGenerationSnapshot,
  voiceLineGenerationFingerprint,
  VoiceGenerationScopeError,
  type CanonicalVoiceSource,
  type VoiceLineGenerationSnapshot,
} from '@/lib/voice/voice-generation-scope'

function scopedLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-ann',
    episodeId: 'episode-a',
    speaker: 'Ann',
    content: 'Hello',
    voicePresetId: null,
    emotionPrompt: null,
    emotionStrength: 0.4,
    audioUrl: null,
    audioMediaId: null,
    audioDuration: null,
    episode: {
      speakerVoices: JSON.stringify({
        Ann: { voicePresetId: 'preset-ann' },
      }),
      novelPromotionProject: {
        characters: [
          {
            name: 'Anna',
            voiceType: 'custom',
            voiceId: 'voice-anna',
            customVoiceUrl: 'https://attacker.example/anna.wav',
          },
        ],
      },
    },
    ...overrides,
  }
}

function systemPreset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'preset-ann',
    isSystem: true,
    audioUrl: 'voice/system/ann.wav',
    audioMediaId: null,
    audioMedia: null,
    ...overrides,
  }
}

describe('voice generation scope and source policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValue(scopedLine())
    prismaMock.voicePreset.findFirst.mockResolvedValue(systemPreset())
  })

  it('[URL project/episode 不擁有 line] -> [顯式 scope error 且不讀 preset]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)

    await expect(resolveVoiceLineGenerationInput({
      projectId: 'project-a',
      episodeId: 'episode-a',
      lineId: 'line-from-project-b',
    })).rejects.toMatchObject({
      code: 'VOICE_LINE_SCOPE_MISMATCH',
    } satisfies Partial<VoiceGenerationScopeError>)

    expect(prismaMock.novelPromotionVoiceLine.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'line-from-project-b',
        episodeId: 'episode-a',
        episode: { novelPromotionProject: { projectId: 'project-a' } },
      },
      select: expect.any(Object),
    })
    expect(prismaMock.voicePreset.findFirst).not.toHaveBeenCalled()
  })

  it('[paid task resume] -> [reads scoped line snapshot without resolving the removed preset]', async () => {
    const resolved = await resolveVoiceLineGenerationSnapshot({
      projectId: 'project-a',
      episodeId: 'episode-a',
      lineId: 'line-ann',
    })

    expect(resolved).toEqual(expect.objectContaining({
      id: 'line-ann',
      episodeId: 'episode-a',
      audioUrl: null,
      audioMediaId: null,
      audioDuration: null,
    }))
    expect(prismaMock.voicePreset.findFirst).not.toHaveBeenCalled()
  })

  it('[Ann 有精確 episode binding 且 Anna 有 custom voice] -> [Ann 只採用精確 system preset]', async () => {
    const resolved = await resolveVoiceLineGenerationInput({
      projectId: 'project-a',
      episodeId: 'episode-a',
      lineId: 'line-ann',
    })

    expect(resolved.source).toEqual({
      presetId: 'preset-ann',
      kind: 'storage-key',
      value: 'voice/system/ann.wav',
    })
    expect(prismaMock.voicePreset.findFirst).toHaveBeenCalledWith({
      where: { id: 'preset-ann', isSystem: true },
      select: expect.any(Object),
    })
  })

  it('[Ann 無 binding 且只有 Anna custom voice] -> [不得 substring 配對 Anna]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(scopedLine({
      episode: {
        speakerVoices: '{}',
        novelPromotionProject: {
          characters: [
            {
              name: 'Anna',
              voiceType: 'custom',
              voiceId: 'voice-anna',
              customVoiceUrl: 'https://attacker.example/anna.wav',
            },
          ],
        },
      },
    }))

    await expect(resolveVoiceLineGenerationInput({
      projectId: 'project-a',
      episodeId: 'episode-a',
      lineId: 'line-ann',
    })).rejects.toMatchObject({ code: 'VOICE_SOURCE_REQUIRED' })
    expect(prismaMock.voicePreset.findFirst).not.toHaveBeenCalled()
  })

  it('[Ann 無 binding 且 Ann 有 legacy custom voice] -> [consent schema 前 provider 前 fail-closed]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(scopedLine({
      episode: {
        speakerVoices: '{}',
        novelPromotionProject: {
          characters: [
            {
              name: 'Ann',
              voiceType: 'custom',
              voiceId: 'voice-ann',
              customVoiceUrl: '/m/unverified-ann',
            },
          ],
        },
      },
    }))

    await expect(resolveVoiceLineGenerationInput({
      projectId: 'project-a',
      episodeId: 'episode-a',
      lineId: 'line-ann',
    })).rejects.toMatchObject({ code: 'VOICE_SOURCE_CONSENT_REQUIRED' })
    expect(prismaMock.voicePreset.findFirst).not.toHaveBeenCalled()
  })

  it.each([
    'https://attacker.example/raw.wav',
    'data:audio/wav;base64,ZmFrZQ==',
    '/m/media-from-another-user',
  ])('[精確 speaker binding 是未證明 custom source %s] -> [provider 前 fail-closed]', async (audioUrl) => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(scopedLine({
      episode: {
        speakerVoices: JSON.stringify({ Ann: { audioUrl, voiceType: 'uploaded' } }),
        novelPromotionProject: { characters: [] },
      },
    }))

    await expect(resolveVoiceLineGenerationInput({
      projectId: 'project-a',
      episodeId: 'episode-a',
      lineId: 'line-ann',
    })).rejects.toMatchObject({ code: 'VOICE_SOURCE_CONSENT_REQUIRED' })
    expect(prismaMock.voicePreset.findFirst).not.toHaveBeenCalled()
  })

  it('[line preset 不是 system preset] -> [不得把 custom preset 當可信來源]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(scopedLine({
      voicePresetId: 'custom-preset',
      episode: {
        speakerVoices: '{}',
        novelPromotionProject: { characters: [] },
      },
    }))
    prismaMock.voicePreset.findFirst.mockResolvedValueOnce(null)

    await expect(resolveVoiceLineGenerationInput({
      projectId: 'project-a',
      episodeId: 'episode-a',
      lineId: 'line-ann',
    })).rejects.toMatchObject({ code: 'VOICE_PRESET_NOT_TRUSTED' })
    expect(prismaMock.voicePreset.findFirst).toHaveBeenCalledWith({
      where: { id: 'custom-preset', isSystem: true },
      select: expect.any(Object),
    })
  })

  it('[system preset 只有未綁定 /m] -> [視為 foreign media 並 fail-closed]', async () => {
    prismaMock.voicePreset.findFirst.mockResolvedValueOnce(systemPreset({
      audioUrl: '/m/media-without-preset-relation',
    }))

    await expect(resolveVoiceLineGenerationInput({
      projectId: 'project-a',
      episodeId: 'episode-a',
      lineId: 'line-ann',
    })).rejects.toMatchObject({ code: 'VOICE_PRESET_MEDIA_INVALID' })
  })

  it('[system preset 綁定 MediaObject] -> [以 relation storageKey 為唯一來源]', async () => {
    prismaMock.voicePreset.findFirst.mockResolvedValueOnce(systemPreset({
      audioUrl: '/m/legacy-or-foreign-value',
      audioMediaId: 'media-system',
      audioMedia: {
        id: 'media-system',
        publicId: 'public-system',
        storageKey: 'voice/system/canonical.wav',
        mimeType: 'audio/wav',
        sizeBytes: BigInt(1234),
      },
    }))

    const resolved = await resolveVoiceLineGenerationInput({
      projectId: 'project-a',
      episodeId: 'episode-a',
      lineId: 'line-ann',
    })
    expect(resolved.source).toEqual({
      presetId: 'preset-ann',
      kind: 'storage-key',
      value: 'voice/system/canonical.wav',
    })
  })
})

const fingerprintLine = {
  id: 'line-ann',
  episodeId: 'episode-a',
  speaker: 'Ann',
  content: 'Hello',
  voicePresetId: null,
  emotionPrompt: 'softly',
  emotionStrength: 0.4,
  speakerVoices: JSON.stringify({ Ann: { voicePresetId: 'preset-ann' } }),
  audioUrl: null,
  audioMediaId: null,
  audioDuration: null,
} satisfies VoiceLineGenerationSnapshot

const fingerprintSource = {
  presetId: 'preset-ann',
  kind: 'storage-key',
  value: 'voice/system/ann.wav',
} satisfies CanonicalVoiceSource

describe('voice generation submit-time fingerprint', () => {
  it('[相同 provider-visible snapshot] -> [fingerprint deterministic 且是 64hex]', () => {
    const first = voiceLineGenerationFingerprint({
      line: fingerprintLine,
      source: fingerprintSource,
      audioModel: 'fal::fal-ai/index-tts-2/text-to-speech',
    })
    const second = voiceLineGenerationFingerprint({
      line: {
        speakerVoices: fingerprintLine.speakerVoices,
        emotionStrength: fingerprintLine.emotionStrength,
        emotionPrompt: fingerprintLine.emotionPrompt,
        voicePresetId: fingerprintLine.voicePresetId,
        content: fingerprintLine.content,
        speaker: fingerprintLine.speaker,
        episodeId: fingerprintLine.episodeId,
        id: fingerprintLine.id,
        audioUrl: fingerprintLine.audioUrl,
        audioMediaId: fingerprintLine.audioMediaId,
        audioDuration: fingerprintLine.audioDuration,
      },
      source: {
        value: fingerprintSource.value,
        kind: fingerprintSource.kind,
        presetId: fingerprintSource.presetId,
      },
      audioModel: 'fal::fal-ai/index-tts-2/text-to-speech',
    })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toBe(first)
  })

  const variations: Array<{
    field: string
    line?: Partial<VoiceLineGenerationSnapshot>
    source?: Partial<CanonicalVoiceSource>
    audioModel?: string
  }> = [
    { field: 'line.id', line: { id: 'line-b' } },
    { field: 'line.episodeId', line: { episodeId: 'episode-b' } },
    { field: 'line.speaker', line: { speaker: 'Ben' } },
    { field: 'line.content', line: { content: 'Changed dialogue' } },
    { field: 'line.voicePresetId', line: { voicePresetId: 'preset-line' } },
    { field: 'line.emotionPrompt', line: { emotionPrompt: 'angrily' } },
    { field: 'line.emotionStrength', line: { emotionStrength: 0.8 } },
    {
      field: 'line.speakerVoices',
      line: { speakerVoices: JSON.stringify({ Ann: { voicePresetId: 'preset-other' } }) },
    },
    { field: 'line.audioUrl', line: { audioUrl: 'voice/user-replacement.wav' } },
    { field: 'line.audioMediaId', line: { audioMediaId: 'media-user-replacement' } },
    { field: 'line.audioDuration', line: { audioDuration: 2_000 } },
    { field: 'source.presetId', source: { presetId: 'preset-other' } },
    { field: 'source.kind', source: { kind: 'external-url' } },
    { field: 'source.value', source: { value: 'voice/system/other.wav' } },
    { field: 'audioModel', audioModel: 'fal::another-audio-model' },
  ]

  it.each(variations)('[$field 變更] -> [fingerprint 不同]', (variation) => {
    const baseline = voiceLineGenerationFingerprint({
      line: fingerprintLine,
      source: fingerprintSource,
      audioModel: 'fal::fal-ai/index-tts-2/text-to-speech',
    })
    const changed = voiceLineGenerationFingerprint({
      line: { ...fingerprintLine, ...variation.line },
      source: { ...fingerprintSource, ...variation.source },
      audioModel: variation.audioModel || 'fal::fal-ai/index-tts-2/text-to-speech',
    })

    expect(changed).toMatch(/^[a-f0-9]{64}$/)
    expect(changed).not.toBe(baseline)
  })

  it('[malformed queued generation snapshot] -> [fails closed before provider work]', () => {
    expect(parseVoiceLineGenerationInput({
      line: { ...fingerprintLine, audioDuration: -1 },
      source: fingerprintSource,
    })).toBeNull()
    expect(parseVoiceLineGenerationInput({
      line: fingerprintLine,
      source: { ...fingerprintSource, kind: 'raw-url' },
    })).toBeNull()
    expect(parseVoiceLineGenerationInput({
      line: fingerprintLine,
      source: fingerprintSource,
    })).toEqual({ line: fingerprintLine, source: fingerprintSource })
  })
})
