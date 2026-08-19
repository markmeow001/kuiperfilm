import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const GUARD_SCRIPT = path.resolve(process.cwd(), 'scripts/check-capability-catalog.mjs')
const temporaryDirectories: string[] = []

async function runGuard(capabilities: Record<string, unknown>) {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'capability-catalog-guard-'))
  temporaryDirectories.push(workingDirectory)

  const catalogDirectory = path.join(workingDirectory, 'standards', 'capabilities')
  await mkdir(catalogDirectory, { recursive: true })
  await writeFile(path.join(catalogDirectory, 'audio.catalog.json'), JSON.stringify([{
    modelType: 'audio',
    provider: 'atlascloud',
    modelId: 'bytedance/seed-audio-1.0',
    capabilities,
  }]))

  return spawnSync(process.execPath, [GUARD_SCRIPT], {
    cwd: workingDirectory,
    encoding: 'utf8',
  })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })))
})

describe('capability catalog guard audio contract', () => {
  it('[canonical Atlas audio capability metadata] -> [standalone guard accepts every supported field]', async () => {
    const result = await runGuard({
      audio: {
        supportReferenceAudio: true,
        supportEmotionPrompt: true,
        supportEmotionStrength: true,
        emotionStrengthRange: { min: 0, max: 1, step: 0.1, defaultValue: 0.5 },
        supportEmotionVector: false,
        supportSpeed: true,
        speedRange: { min: -50, max: 100, step: 1, defaultValue: 0 },
        supportPitch: true,
        pitchRange: { min: -12, max: 12, step: 1, defaultValue: 0 },
        supportVolume: true,
        volumeRange: { min: -50, max: 100, step: 1, defaultValue: 0 },
        supportPause: false,
      },
    })

    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('[check-capability-catalog] OK (1 files)')
  })

  it('[invalid Atlas audio flags and ranges] -> [standalone guard enforces the canonical contract]', async () => {
    const result = await runGuard({
      audio: {
        supportReferenceAudio: 'yes',
        supportSpeed: true,
        speedRange: { min: 100, max: -50, step: 0, defaultValue: 200, unit: '%' },
        supportPitch: true,
        supportVolume: false,
        volumeRange: { min: -50, max: 100, step: 1, defaultValue: 0 },
      },
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('capabilities.audio.supportReferenceAudio: supportReferenceAudio must be boolean')
    expect(result.stdout).toContain('capabilities.audio.speedRange.unit: Unknown range field: unit')
    expect(result.stdout).toContain('capabilities.audio.speedRange: speedRange min must be less than max')
    expect(result.stdout).toContain('capabilities.audio.speedRange.step: speedRange step must be greater than zero')
    expect(result.stdout).toContain('capabilities.audio.speedRange.defaultValue: speedRange defaultValue must be within min and max')
    expect(result.stdout).toContain('capabilities.audio.pitchRange: pitchRange is required when supportPitch is true')
    expect(result.stdout).toContain('capabilities.audio.volumeRange: volumeRange requires supportVolume to be true')
  })
})
