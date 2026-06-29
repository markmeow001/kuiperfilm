/**
 * 运镜 (camera-movement) presets for video nodes. Each appends a concise
 * Chinese cinematography phrase to the prompt so the model gets explicit camera
 * language (LibTV's 运镜广场 equivalent). Pure data.
 */
export interface CameraMove {
  key: string
  label: string
  /** phrase appended to the prompt at generation. '' = none. */
  phrase: string
}

export const CAMERA_MOVES: CameraMove[] = [
  { key: 'none', label: '无运镜', phrase: '' },
  { key: 'push', label: '推近', phrase: '镜头缓缓推近（推镜）' },
  { key: 'pull', label: '拉远', phrase: '镜头缓缓拉远（拉镜）' },
  { key: 'orbit', label: '环绕', phrase: '镜头环绕主体旋转（环绕运镜）' },
  { key: 'pan', label: '横移', phrase: '镜头水平横移（横移运镜）' },
  { key: 'crane', label: '升降', phrase: '镜头垂直升降（升降镜头）' },
  { key: 'handheld', label: '手持跟拍', phrase: '手持跟拍，轻微晃动，跟随主体移动' },
  { key: 'dolly_zoom', label: '滑动变焦', phrase: '滑动变焦（dolly zoom），背景透视拉伸' },
  { key: 'fpv', label: '穿梭', phrase: '第一人称穿梭运镜，快速穿过场景' },
  { key: 'tilt_up', label: '上摇', phrase: '镜头自下而上摇起（上摇）' },
  { key: 'tilt_down', label: '下摇', phrase: '镜头自上而下摇下（下摇）' },
  { key: 'whip', label: '甩镜', phrase: '快速甩镜转场' },
]

export function cameraMovePhrase(key: string | undefined): string {
  return CAMERA_MOVES.find((m) => m.key === key)?.phrase ?? ''
}
