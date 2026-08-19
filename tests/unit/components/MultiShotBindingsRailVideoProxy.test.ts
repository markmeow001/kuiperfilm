import { describe, expect, it } from 'vitest'
import { resolveVideoSrc } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/MultiShotBindingsRail'

describe('MultiShotBindingsRail video source authorization', () => {
  it.each([
    'video/project-A/multi-shot.mp4',
    'https://cdn.example/multi-shot.mp4?token=signed',
  ])('routes task result media through the project-scoped proxy: %s', (raw) => {
    const resolved = resolveVideoSrc(raw, 'project-A', 'episode-1-group-1')

    expect(resolved).toContain('/api/novel-promotion/project-A/video-proxy?')
    const query = new URL(resolved!, 'http://localhost').searchParams
    expect(query.get('key')).toBe(raw)
    expect(query.get('filename')).toBe('episode-1-group-1')
  })

  it('fails closed without project scope', () => {
    expect(resolveVideoSrc('video/clip.mp4', undefined, 'download')).toBeNull()
  })
})
