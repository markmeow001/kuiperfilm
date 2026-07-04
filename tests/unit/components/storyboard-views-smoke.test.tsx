/**
 * @vitest-environment jsdom
 *
 * Phase 1 / backlog E (2026-07-04) — mount-smoke tests for the storyboard
 * sibling views. On this branch the shared storyboard types/helpers churn
 * frequently; these tests catch a view that stops mounting (bad import,
 * crash-on-render) after a refactor — the exact regression class E targets.
 *
 * Scope (this slice): the 3 leaf-like Timeline sub-views (Text / Shot /
 * Inspector). The 3 layout views (TimelineView / GroupsView / GalleryView)
 * have 55-93-prop interfaces + hook-bearing children (GroupCard →
 * useMultiShotTask) and need a heavier harness — deferred, see note at EOF.
 *
 * Run: npm run test:dom
 */

import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: (_ns?: string) => (key: string) => key,
}))
vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}))
// MultiShotBindingsRail is stubbed because it pulls useMultiShotTask (needs a
// react-query provider) — mocking keeps the smoke on the parent view. NOTE:
// this means MultiShotBindingsRail's OWN import health is NOT covered here; it
// would need its own smoke (or a QueryClient wrapper). PromptChipGroup is left
// unmocked on purpose — it's a pure leaf, so rendering it real also smoke-tests
// its import path for free.
vi.mock('@/app/[locale]/v2/workspace/[projectId]/storyboard/MultiShotBindingsRail', () => ({
  MultiShotBindingsRail: () => <div data-testid="multishot-bindings-rail" />,
}))

import { V2StoryboardTimelineText } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardTimelineText'
import { V2StoryboardTimelineShot } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardTimelineShot'
import { V2StoryboardTimelineInspector } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardTimelineInspector'
import type { PanelLike } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/storyboard-client-helpers'

// A minimal but real panel so live JSX branches mount (not just the
// null-selection early return).
const panel: PanelLike = {
  id: 'panel-1',
  description: 'a quiet room',
  characters: ['Alice'],
  location: 'room',
}

// Mutation / hook-result props are passed in (the views never create them),
// so a plain inert stub satisfies the mount smoke.
const mutationStub = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  isSuccess: false,
  reset: vi.fn(),
  data: undefined,
  error: null,
} as unknown

const noop = () => {}

describe('storyboard sibling views — mount smoke (backlog E, slice 1)', () => {
  it('V2StoryboardTimelineText mounts with a selected panel', () => {
    const { container } = render(
      <V2StoryboardTimelineText
        {...({
          selected: panel,
          selectedIndex: 0,
          descDraft: 'a quiet room',
          setDescDraft: noop,
          descChanged: false,
          onSaveDescription: noop,
          dialogueDraft: '',
          setDialogueDraft: noop,
          dialogueChanged: false,
          onSaveDialogue: noop,
          updatePanelText: mutationStub,
          updatePanel: mutationStub,
          canEdit: true,
        } as unknown as React.ComponentProps<typeof V2StoryboardTimelineText>)}
      />,
    )
    expect(container.firstChild).toBeTruthy()
  })

  it('V2StoryboardTimelineShot mounts with a selected panel', () => {
    const { container } = render(
      <V2StoryboardTimelineShot
        {...({
          selected: panel,
          selectedIndex: 0,
          project: undefined,
          projectVideoRatio: '9:16',
          isPortraitRatio: true,
          selectedMediaDisplayMode: null,
          setMediaDisplayOverride: noop,
          multiShotState: { status: 'idle' },
          canMultiShot: false,
          videoFamily: 'seedance',
          onSubmitMultiShot: noop,
          regenPanel: mutationStub,
          generateVideo: mutationStub,
          onGenerateVideo: noop,
          isCurrentPanelImageInFlight: false,
          isCurrentPanelVideoInFlight: false,
          activePanelImageTasks: { data: undefined } as unknown,
          setImageInFlight: noop,
          failedPanelImageIds: new Map(),
          failedPanelVideoIds: new Map(),
          setZoomImageUrl: noop,
          canEdit: true,
        } as unknown as React.ComponentProps<typeof V2StoryboardTimelineShot>)}
      />,
    )
    expect(container.firstChild).toBeTruthy()
  })

  it('V2StoryboardTimelineInspector mounts with a selected panel', () => {
    const { container } = render(
      <V2StoryboardTimelineInspector
        {...({
          projectId: 'proj-1',
          selected: panel,
          selectedGroupTaskId: null,
          selectedGroupLabel: null,
          currentEpisode: null,
          characterRoster: [],
          episodeBindings: [],
        } as unknown as React.ComponentProps<typeof V2StoryboardTimelineInspector>)}
      />,
    )
    expect(container.firstChild).toBeTruthy()
  })

  it('all three sub-views also mount with no selection (empty-state branch)', () => {
    expect(() =>
      render(
        <V2StoryboardTimelineText
          {...({
            selected: null,
            selectedIndex: -1,
            descDraft: '',
            setDescDraft: noop,
            descChanged: false,
            onSaveDescription: noop,
            dialogueDraft: '',
            setDialogueDraft: noop,
            dialogueChanged: false,
            onSaveDialogue: noop,
            updatePanelText: mutationStub,
            updatePanel: mutationStub,
            canEdit: true,
          } as unknown as React.ComponentProps<typeof V2StoryboardTimelineText>)}
        />,
      ),
    ).not.toThrow()

    expect(() =>
      render(
        <V2StoryboardTimelineShot
          {...({
            selected: null,
            selectedIndex: -1,
            project: undefined,
            projectVideoRatio: '9:16',
            isPortraitRatio: true,
            selectedMediaDisplayMode: null,
            setMediaDisplayOverride: noop,
            multiShotState: { status: 'idle' },
            canMultiShot: false,
            videoFamily: 'seedance',
            onSubmitMultiShot: noop,
            regenPanel: mutationStub,
            generateVideo: mutationStub,
            onGenerateVideo: noop,
            isCurrentPanelImageInFlight: false,
            isCurrentPanelVideoInFlight: false,
            activePanelImageTasks: { data: undefined } as unknown,
            setImageInFlight: noop,
            failedPanelImageIds: new Map(),
            failedPanelVideoIds: new Map(),
            setZoomImageUrl: noop,
            canEdit: true,
          } as unknown as React.ComponentProps<typeof V2StoryboardTimelineShot>)}
        />,
      ),
    ).not.toThrow()

    expect(() =>
      render(
        <V2StoryboardTimelineInspector
          {...({
            projectId: 'proj-1',
            selected: null,
            selectedGroupTaskId: null,
            selectedGroupLabel: null,
            currentEpisode: null,
            characterRoster: [],
            episodeBindings: [],
          } as unknown as React.ComponentProps<typeof V2StoryboardTimelineInspector>)}
        />,
      ),
    ).not.toThrow()
  })
})

// DEFERRED (logged, not silently dropped): smoke tests for the 3 layout views
// V2StoryboardTimelineView (93-prop), V2StoryboardGroupsView (55-prop),
// V2StoryboardGalleryView (70-prop). They render hook-bearing children
// (GroupCard → useMultiShotTask) so a faithful mount smoke needs those
// children mocked + large prop factories. Tracked as backlog E slice 2.
