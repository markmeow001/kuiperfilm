import { describe, expect, it } from 'vitest'
import {
  assertDepthRebuildMediaLimits,
  buildDepthRebuildFinalizeFfmpegArgs,
  buildDepthRebuildResultKey,
  DepthRebuildFinalizeError,
  parseDepthRebuildFinalizeInput,
  resolveDepthRebuildWorkflowContract,
  resolveOrderedSegmentKeys,
  type FinalizeMediaProbe,
  type SegmentTaskRow,
} from '@/lib/live-composite/depth-rebuild-finalize'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

const video = (hasAudio = true): FinalizeMediaProbe => ({
  durationSec: 5,
  width: 1280,
  height: 720,
  hasVideo: true,
  hasAudio,
})

const sourceKey = 'video/playground-ref/user-1/source.mp4'
const depthKey = 'video/playground-ref/user-1/depth.mp4'

function segmentPayload(
  segmentIndex: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const depthRebuildContract = {
    version: 1,
    workflowId: 'workflow_1',
    segmentIndex,
    segmentCount: 2,
    depthRebuildDualGuide: true,
    normalizeSeedanceReferenceVideo: true,
    referenceVideos: [sourceKey, depthKey],
    referenceVideoWindow: { startSeconds: segmentIndex * 5, durationSeconds: 5 },
    duration: 5,
    modelKey: 'atlascloud::seedance-2.0-r2v',
    resolution: '720p',
    aspectRatio: '16:9',
    sourceAudioMode: 'reference-only',
    ...overrides,
  }
  // Completed/progress payloads may replace top-level runtime fields. The
  // immutable server contract must therefore be recoverable from meta alone.
  return {
    stage: 'completed',
    meta: { depthRebuildContract },
  }
}

function task(id: string, overrides: Partial<SegmentTaskRow> = {}): SegmentTaskRow {
  return {
    id,
    userId: 'user-1',
    projectId: 'playground',
    type: TASK_TYPE.PLAYGROUND_VIDEO,
    status: TASK_STATUS.COMPLETED,
    result: { resultUrls: [`video/generated/${id}.mp4`] },
    payload: {},
    ...overrides,
  }
}

function errorCode(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof DepthRebuildFinalizeError ? error.code : null
  }
}

describe('Depth Rebuild server finalize contract', () => {
  it('same user workflow retry -> reuses one deterministic output key', () => {
    const fingerprint = 'a'.repeat(64)
    const first = buildDepthRebuildResultKey('user-1', 'workflow_1', fingerprint)
    const retry = buildDepthRebuildResultKey('user-1', 'workflow_1', fingerprint)
    expect(first).toBe(
      `video/playground-ref/user-1/depth-rebuild/workflow_1/${fingerprint}/final.mp4`,
    )
    expect(retry).toBe(first)
    expect(buildDepthRebuildResultKey('user-2', 'workflow_1', fingerprint)).not.toBe(first)
    expect(buildDepthRebuildResultKey('user-1', 'workflow_1', 'b'.repeat(64))).not.toBe(first)
  })

  it('valid first-party input -> preserves caller segment order', () => {
    expect(parseDepthRebuildFinalizeInput({
      workflowId: 'workflow_1',
      segmentRunIds: ['run-b', 'run-a'],
      sourceVideoKey: 'video/playground-ref/user-1/source.mp4',
      sourceAudioMode: 'preserve',
    })).toEqual({
      workflowId: 'workflow_1',
      segmentRunIds: ['run-b', 'run-a'],
      sourceVideoKey: 'video/playground-ref/user-1/source.mp4',
      sourceAudioMode: 'preserve',
    })
  })

  it('URL or path traversal source -> rejects before fetching', () => {
    expect(errorCode(() => parseDepthRebuildFinalizeInput({
      workflowId: 'workflow_1',
      segmentRunIds: ['run-a'],
      sourceVideoKey: 'https://attacker.example/source.mp4',
      sourceAudioMode: 'preserve',
    }))).toBe('DEPTH_REBUILD_FINALIZE_SOURCE_KEY_INVALID')
    expect(errorCode(() => parseDepthRebuildFinalizeInput({
      workflowId: 'workflow_1',
      segmentRunIds: ['run-a'],
      sourceVideoKey: 'video/playground-ref/user-1/%2e%2e/source.mp4',
      sourceAudioMode: 'preserve',
    }))).toBe('DEPTH_REBUILD_FINALIZE_SOURCE_KEY_INVALID')
  })

  it('unordered database rows -> resolves generated clips in request order', () => {
    expect(resolveOrderedSegmentKeys(
      [task('run-a'), task('run-b')],
      ['run-b', 'run-a'],
      'user-1',
    )).toEqual([
      'video/generated/run-b.mp4',
      'video/generated/run-a.mp4',
    ])
  })

  it('foreign or incomplete Playground runs -> returns explicit errors', () => {
    expect(errorCode(() => resolveOrderedSegmentKeys(
      [task('run-a', { userId: 'other-user' })],
      ['run-a'],
      'user-1',
    ))).toBe('DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_FOUND_OR_NOT_OWNED')
    expect(errorCode(() => resolveOrderedSegmentKeys(
      [task('run-a', { status: TASK_STATUS.PROCESSING })],
      ['run-a'],
      'user-1',
    ))).toBe('DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_COMPLETED')
  })

  it('valid RGB＋Depth tasks -> validates order and produces a stable input fingerprint', () => {
    const input = parseDepthRebuildFinalizeInput({
      workflowId: 'workflow_1',
      segmentRunIds: ['run-a', 'run-b'],
      sourceVideoKey: sourceKey,
      sourceAudioMode: 'preserve',
    })
    const tasks = [
      task('run-b', { payload: segmentPayload(1) }),
      task('run-a', { payload: segmentPayload(0) }),
    ]
    const first = resolveDepthRebuildWorkflowContract(tasks, input, 'user-1')
    const retry = resolveDepthRebuildWorkflowContract(tasks, input, 'user-1')

    expect(first.segmentKeys).toEqual([
      'video/generated/run-a.mp4',
      'video/generated/run-b.mp4',
    ])
    expect(first.totalDurationSec).toBe(10)
    expect(first.inputFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(retry.inputFingerprint).toBe(first.inputFingerprint)
  })

  it('ordinary Playground task -> cannot be finalized as RGB＋Depth', () => {
    const input = parseDepthRebuildFinalizeInput({
      workflowId: 'workflow_1',
      segmentRunIds: ['run-a'],
      sourceVideoKey: sourceKey,
      sourceAudioMode: 'reference-only',
    })
    expect(errorCode(() => resolveDepthRebuildWorkflowContract(
      [task('run-a', { payload: { prompt: 'ordinary Playground task' } })],
      input,
      'user-1',
    ))).toBe('DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID')
  })

  it('wrong workflow or discontinuous windows -> rejects the mixed workflow', () => {
    const input = parseDepthRebuildFinalizeInput({
      workflowId: 'workflow_1',
      segmentRunIds: ['run-a', 'run-b'],
      sourceVideoKey: sourceKey,
      sourceAudioMode: 'preserve',
    })
    expect(errorCode(() => resolveDepthRebuildWorkflowContract([
      task('run-a', { payload: segmentPayload(0, { workflowId: 'other_workflow' }) }),
      task('run-b', { payload: segmentPayload(1) }),
    ], input, 'user-1'))).toBe('DEPTH_REBUILD_FINALIZE_WORKFLOW_MISMATCH')

    expect(errorCode(() => resolveDepthRebuildWorkflowContract([
      task('run-a', { payload: segmentPayload(0) }),
      task('run-b', {
        payload: segmentPayload(1, {
          referenceVideoWindow: { startSeconds: 5.25, durationSeconds: 5 },
        }),
      }),
    ], input, 'user-1'))).toBe('DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID')
  })

  it('same workflow with different validated inputs -> does not reuse the output key', () => {
    const firstInput = parseDepthRebuildFinalizeInput({
      workflowId: 'workflow_1',
      segmentRunIds: ['run-a', 'run-b'],
      sourceVideoKey: sourceKey,
      sourceAudioMode: 'preserve',
    })
    const first = resolveDepthRebuildWorkflowContract([
      task('run-a', { payload: segmentPayload(0) }),
      task('run-b', { payload: segmentPayload(1) }),
    ], firstInput, 'user-1')

    const secondSource = 'video/playground-ref/user-1/source-v2.mp4'
    const secondInput = parseDepthRebuildFinalizeInput({
      workflowId: 'workflow_1',
      segmentRunIds: ['run-c', 'run-d'],
      sourceVideoKey: secondSource,
      sourceAudioMode: 'preserve',
    })
    const second = resolveDepthRebuildWorkflowContract([
      task('run-c', {
        payload: segmentPayload(0, { referenceVideos: [secondSource, depthKey] }),
      }),
      task('run-d', {
        payload: segmentPayload(1, { referenceVideos: [secondSource, depthKey] }),
      }),
    ], secondInput, 'user-1')

    expect(second.inputFingerprint).not.toBe(first.inputFingerprint)
    expect(buildDepthRebuildResultKey('user-1', 'workflow_1', second.inputFingerprint))
      .not.toBe(buildDepthRebuildResultKey('user-1', 'workflow_1', first.inputFingerprint))
  })

  it('oversized dimensions or duration -> rejects before ffmpeg/output buffering', () => {
    expect(errorCode(() => assertDepthRebuildMediaLimits({
      segmentMedia: [{ ...video(false), width: 7680, height: 4320 }],
      sourceMedia: null,
      expectedDurations: [5],
    }))).toBe('DEPTH_REBUILD_FINALIZE_MEDIA_LIMIT_EXCEEDED')

    expect(errorCode(() => assertDepthRebuildMediaLimits({
      segmentMedia: [{ ...video(false), durationSec: 8 }],
      sourceMedia: null,
      expectedDurations: [5],
    }))).toBe('DEPTH_REBUILD_FINALIZE_MEDIA_LIMIT_EXCEEDED')

    expect(errorCode(() => assertDepthRebuildMediaLimits({
      segmentMedia: [video(false)],
      sourceMedia: { ...video(true), durationSec: 10 },
      expectedDurations: [5],
    }))).toBe('DEPTH_REBUILD_FINALIZE_MEDIA_LIMIT_EXCEEDED')
  })

  it('preserve mode -> hard-concats video and muxes source audio once', () => {
    const args = buildDepthRebuildFinalizeFfmpegArgs({
      segmentPaths: ['/tmp/one.mp4', '/tmp/two.mp4'],
      segmentMedia: [video(false), video(false)],
      sourceVideoPath: '/tmp/source.mp4',
      sourceMedia: { ...video(true), durationSec: 11.2 },
      sourceAudioMode: 'preserve',
      outputPath: '/tmp/final.mp4',
    })
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('[v0][v1]concat=n=2:v=1:a=0[joinedv]')
    expect(filter).toContain('trim=duration=11.200')
    expect(filter).toContain('[2:a]')
    expect(filter.match(/\[2:a\]/g)).toHaveLength(1)
    expect(filter).not.toContain('xfade')
    expect(args.filter((value) => value === '/tmp/source.mp4')).toHaveLength(1)
    expect(args).toContain('[outa]')
    expect(args[args.indexOf('-t') + 1]).toBe('11.200')
  })

  it('reference-only mode -> creates a silent hard concat', () => {
    const args = buildDepthRebuildFinalizeFfmpegArgs({
      segmentPaths: ['/tmp/one.mp4', '/tmp/two.mp4'],
      segmentMedia: [video(), video()],
      sourceVideoPath: null,
      sourceMedia: null,
      sourceAudioMode: 'reference-only',
      outputPath: '/tmp/final.mp4',
    })
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(args).toContain('-an')
    expect(args).not.toContain('[outa]')
    expect(filter).not.toContain('[0:a]')
    expect(filter).not.toContain('xfade')
  })

  it('generate mode -> concats segment audio and rejects missing audio', () => {
    const args = buildDepthRebuildFinalizeFfmpegArgs({
      segmentPaths: ['/tmp/one.mp4', '/tmp/two.mp4'],
      segmentMedia: [video(), video()],
      sourceVideoPath: null,
      sourceMedia: null,
      sourceAudioMode: 'generate',
      outputPath: '/tmp/final.mp4',
    })
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('[a0][a1]concat=n=2:v=0:a=1[outa]')

    expect(errorCode(() => buildDepthRebuildFinalizeFfmpegArgs({
      segmentPaths: ['/tmp/one.mp4', '/tmp/two.mp4'],
      segmentMedia: [video(), video(false)],
      sourceVideoPath: null,
      sourceMedia: null,
      sourceAudioMode: 'generate',
      outputPath: '/tmp/final.mp4',
    }))).toBe('DEPTH_REBUILD_FINALIZE_GENERATED_AUDIO_MISSING')
  })
})
