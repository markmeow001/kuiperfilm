import React from 'react'
import { Composition, registerRoot } from 'remotion'
import { StoryboardStill } from './StoryboardStill'

const StoryboardComposition: React.FC<Record<string, unknown>> = (props) => <StoryboardStill {...(props as unknown as React.ComponentProps<typeof StoryboardStill>)} />

function StoryboardRoot() {
  return <Composition id="CanvasStoryboardStill" component={StoryboardComposition} durationInFrames={1} fps={30} width={3840} height={2160} defaultProps={{ items: [], columns: 4, showShotNumber: true }} />
}

registerRoot(StoryboardRoot)
