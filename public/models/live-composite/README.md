# Live Composite local model assets

These model assets are loaded locally by the Live Composite Studio. Uploaded
videos remain in the browser and are not sent to a segmentation service.

## Robust Video Matting (RVM)

- `rvm-mobilenetv3-fp32.onnx`
  - Source: `https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx` (official v1.0.0 release asset)
  - SHA-256: `88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828`
  - Runs via onnxruntime-web (WebGPU, falling back to single-threaded WASM);
    wasm binaries are self-hosted under `public/onnxruntime/`. Inference stays
    entirely in the browser.
  - ⚠️ **License: GPL-3.0.** The RobustVideoMatting repository (and therefore
    these published model weights) is licensed under GPL-3.0, unlike every
    other model in this directory (Apache-2.0). We redistribute the weights
    file with this application. Whether GPL-3.0 obligations attach to model
    weights (and whether shipping them alongside a proprietary app is
    acceptable) is **unresolved and needs legal review before public
    distribution**. Flagged deliberately — do not remove this note without a
    legal decision.

## MediaPipe models

- `selfie-segmenter-landscape.tflite`
  - Source: `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite`
- `selfie-segmenter-square.tflite`
  - Source: `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`
- `magic-touch.tflite`
  - Source: `https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite`
  - SHA-256: `e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25`
  - Used for click-guided foreground object selection; inference remains in the browser.
- `pose-landmarker-lite.task`
  - Source: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
  - SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`
  - Used to derive local pose-driven position, scale and shoulder rotation keyframes.
- `face-landmarker.task`
  - Source: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`
  - SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
  - Used for the face performance track (stable face crops, blendshape-based
    expression summaries, problem timecodes). Inference stays in the browser;
    face data is never sent to a generation provider.

The implementation uses the landscape model for wide video and the square
model for portrait or near-square video. See the Google MediaPipe Image
Segmenter documentation and model cards for model scope and limitations.

All models above are published by Google under the Apache License 2.0 as
part of MediaPipe Solutions; see each model's MediaPipe model card for
scope, limitations and fairness notes.
