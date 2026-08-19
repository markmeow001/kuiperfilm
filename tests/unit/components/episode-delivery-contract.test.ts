import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  parseEpisodeDeliveryResponse,
  resolveSafeDeliveryDownloadUrl,
} from '@/lib/query/hooks/useEpisodeDelivery'

const inputFixture = {
  canCreate: true,
  selectedVideoCount: 2,
  imageCount: 4,
  multiShotVideoCount: 1,
  voiceAudioCount: 3,
  missingVoiceAudioCount: 2,
}

const manifestFixture = {
  version: 1,
  fileCount: 13,
  selectedVideoCount: 2,
  multiShotVideoCount: 1,
  imageCount: 4,
  voiceAudioCount: 3,
  excludedVoiceLineCount: 2,
  scriptIncluded: true,
  checksumAlgorithm: 'sha256',
}

const readyV1Fixture = {
  status: 'ready',
  filename: 'episode-assets.zip',
  downloadUrl: '/api/delivery/download',
  version: 'v1',
  taskId: 'delivery-task-1',
  createdAt: '2026-08-10T10:02:00.000Z',
  sourceFingerprint: 'source-fingerprint-1',
  stale: false,
  manifest: manifestFixture,
}

describe('episode delivery client contract', () => {
  it('390/768/1440 source contract -> mobile-first spacing, tablet flow, desktop receipt rail', () => {
    const source = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/final/V2FinalClient.tsx',
      'utf8',
    )

    expect(source).toContain('px-[var(--workspace-gutter)]')
    expect(source).toContain('sm:p-4')
    expect(source).toContain('sm:grid-cols-2')
    expect(source).toContain('xl:grid-cols-[minmax(0,1fr)_340px]')
    expect(source).toContain('min-w-0')
    expect(source).not.toMatch(/min-w-\[(?:7|8|9)\d{2}px\]/)
  })

  it('v1 ready response -> 保留版本、task、fingerprint、stale 與 manifest summary', () => {
    expect(
      parseEpisodeDeliveryResponse({
        success: true,
        input: inputFixture,
        delivery: readyV1Fixture,
      }),
    ).toEqual({
      success: true,
      input: inputFixture,
      delivery: readyV1Fixture,
    })
  })

  it('server input contract -> 保留影片、圖片與配音來源精確數量', () => {
    expect(
      parseEpisodeDeliveryResponse({
        success: true,
        input: {
          canCreate: false,
          selectedVideoCount: 3,
          imageCount: 5,
          multiShotVideoCount: 2,
          voiceAudioCount: 7,
          missingVoiceAudioCount: 4,
        },
        delivery: null,
      }),
    ).toEqual({
      success: true,
      input: {
        canCreate: false,
        selectedVideoCount: 3,
        imageCount: 5,
        multiShotVideoCount: 2,
        voiceAudioCount: 7,
        missingVoiceAudioCount: 4,
      },
      delivery: null,
    })
  })

  it('explicit legacy ready -> 僅接受 server 明示的 null metadata，不自行推測 manifest', () => {
    const legacy = {
      status: 'ready',
      filename: 'legacy-assets.zip',
      downloadUrl: '/api/delivery/download',
      version: 'legacy',
      taskId: null,
      createdAt: '2026-08-01T10:00:00.000Z',
      sourceFingerprint: null,
      stale: null,
      manifest: null,
    }

    expect(
      parseEpisodeDeliveryResponse({
        success: true,
        input: inputFixture,
        delivery: legacy,
      }),
    ).toEqual({ success: true, input: inputFixture, delivery: legacy })
  })

  it('old ready shape without explicit version -> fail-closed，不自行當 legacy', () => {
    expect(() =>
      parseEpisodeDeliveryResponse({
        success: true,
        input: inputFixture,
        delivery: {
          status: 'ready',
          filename: 'old-assets.zip',
          downloadUrl: '/api/delivery/download',
        },
      }),
    ).toThrow('Invalid episode delivery response')
  })

  it.each([
    ['v1 missing manifest', { ...readyV1Fixture, manifest: null }],
    ['v1 missing taskId', { ...readyV1Fixture, taskId: null }],
    ['v1 invalid stale', { ...readyV1Fixture, stale: null }],
    [
      'v1 invalid checksum',
      {
        ...readyV1Fixture,
        manifest: { ...manifestFixture, checksumAlgorithm: 'md5' },
      },
    ],
    [
      'v1 negative manifest count',
      { ...readyV1Fixture, manifest: { ...manifestFixture, voiceAudioCount: -1 } },
    ],
    [
      'legacy with guessed manifest',
      {
        ...readyV1Fixture,
        version: 'legacy',
        taskId: null,
        sourceFingerprint: null,
        stale: null,
      },
    ],
    [
      'legacy with non-null stale',
      {
        ...readyV1Fixture,
        version: 'legacy',
        taskId: null,
        sourceFingerprint: null,
        stale: false,
        manifest: null,
      },
    ],
  ])('%s -> reject malformed delivery union', (_label, delivery) => {
    expect(() =>
      parseEpisodeDeliveryResponse({
        success: true,
        input: inputFixture,
        delivery,
      }),
    ).toThrow('Invalid episode delivery response')
  })

  it('missing/negative input counts -> 明確拒絕 malformed receipt', () => {
    expect(() =>
      parseEpisodeDeliveryResponse({
        success: true,
        input: {
          canCreate: true,
          selectedVideoCount: -1,
          imageCount: 0,
          multiShotVideoCount: 0,
          voiceAudioCount: 0,
          missingVoiceAudioCount: 0,
        },
        delivery: null,
      }),
    ).toThrow('Invalid episode delivery response')
  })

  it('malformed response -> 明確失敗，不把 raw key 當下載網址', () => {
    expect(() =>
      parseEpisodeDeliveryResponse({
        success: true,
        input: inputFixture,
        delivery: {
          status: 'ready',
          filename: '',
          downloadUrl: 'deliveries/raw-storage-key.zip',
        },
      }),
    ).toThrow('Invalid episode delivery response')
  })

  it.each([
    ['/api/delivery/download', '/api/delivery/download'],
    ['http://localhost:3042/api/delivery/download', 'http://localhost:3042/api/delivery/download'],
    ['https://cdn.example/delivery.zip', 'https://cdn.example/delivery.zip'],
  ])('safe download URL %s -> accepted', (candidate, expected) => {
    expect(
      resolveSafeDeliveryDownloadUrl(candidate, 'http://localhost:3042'),
    ).toBe(expected)
  })

  it.each([
    'http://evil.example/delivery.zip',
    '//evil.example/delivery.zip',
    'javascript:alert(1)',
    'data:application/zip;base64,AAAA',
  ])('unsafe download URL %s -> rejected', (candidate) => {
    expect(
      resolveSafeDeliveryDownloadUrl(candidate, 'http://localhost:3042'),
    ).toBeNull()
  })
})
