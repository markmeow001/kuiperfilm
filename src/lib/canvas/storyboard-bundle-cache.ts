import path from 'node:path'
import { bundle } from '@remotion/bundler'
import { webpackOverride } from '@/features/video-editor/remotion/webpack-override'

let bundlePromise: Promise<string> | null = null

/** One bundle per worker process; failed bundles reset so a later job can retry. */
export function getCanvasStoryboardBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({ entryPoint: path.resolve(process.cwd(), 'src/features/canvas-storyboard/remotion-entry.tsx'), webpackOverride })
      .catch((error) => { bundlePromise = null; throw error })
  }
  return bundlePromise
}

export function resetCanvasStoryboardBundleForTest() {
  bundlePromise = null
}
