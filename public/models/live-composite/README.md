# MediaPipe Selfie Segmenter models

These model assets are loaded locally by the Live Composite Studio. Uploaded
videos remain in the browser and are not sent to a segmentation service.

- `selfie-segmenter-landscape.tflite`
  - Source: `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite`
- `selfie-segmenter-square.tflite`
  - Source: `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`

The implementation uses the landscape model for wide video and the square
model for portrait or near-square video. See the Google MediaPipe Image
Segmenter documentation and model cards for model scope and limitations.
