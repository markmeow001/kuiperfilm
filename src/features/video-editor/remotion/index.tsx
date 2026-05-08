import React from 'react'
import { registerRoot, Composition } from 'remotion'
import { VideoComposition } from './VideoComposition'

const Root: React.FC = () => {
  return (
    <Composition
      id="VideoEditor"
       
      component={VideoComposition as any}
      durationInFrames={1}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        clips: [],
        bgmTrack: [],
        config: { fps: 30, width: 1920, height: 1080 },
      }}
    />
  )
}

registerRoot(Root)
