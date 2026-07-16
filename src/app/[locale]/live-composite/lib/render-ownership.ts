/**
 * The preview and recorder share one canvas. During export the recorder must
 * be the only writer, otherwise the selected preview view can leak into video.
 */
export function shouldRenderPreview(recordingActive: boolean): boolean {
  return !recordingActive
}
