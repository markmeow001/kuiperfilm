/**
 * 图片节点「预设」配方目录 — LibTV 的 预设/九宫格 menu (分镜叙事/质感调节/
 * 空间与机位/设定图). Each recipe is a prompt template (+ optional aspect) that
 * sets the image node's prompt with one click — reusing our storyboard prompt
 * engineering as one-tap recipes. The 720全景 recipe produces a 2:1 equirect
 * panorama (feeds the 导演台 全景球) via the user's own image model (e.g. AtlasCloud).
 */
export interface ImageRecipe {
  key: string
  group: '分镜叙事' | '质感调节' | '空间与机位' | '设定图'
  label: string
  prompt: string
  /** force an aspect ratio when this recipe needs one (e.g. 720全景 → 2:1). */
  aspectRatio?: string
}

export const IMAGE_RECIPES: ImageRecipe[] = [
  // 分镜叙事
  { key: 'blocking-board', group: '分镜叙事', label: '调度故事板', prompt: '生成带有运动轨迹与机位调度标注的分镜草图，用箭头标示人物走位与镜头运动方向' },
  { key: 'storyboard', group: '分镜叙事', label: '故事板', prompt: '生成完整剧情片段的分镜故事板，清晰的景别与构图' },
  { key: 'grid25', group: '分镜叙事', label: '25宫格连贯分镜', prompt: '生成 25 格连贯分镜长图，将一段连续动作分解为 25 个关键帧' },
  { key: 'grid4', group: '分镜叙事', label: '剧情推演四宫格', prompt: '生成 4 格剧情推演分镜，展示剧情的起承转合' },
  { key: 'extrapolate-after', group: '分镜叙事', label: '画面推演 - 3秒后', prompt: '推演该画面 3 秒后的后续动作与构图，保持人物与场景一致' },
  { key: 'extrapolate-before', group: '分镜叙事', label: '画面推演 - 5秒前', prompt: '还原该画面 5 秒前的前置状态，保持人物与场景一致' },
  // 质感调节
  { key: 'portrait-texture', group: '质感调节', label: '人像质感调节', prompt: '优化人物皮肤质感与光影，降低 AI 感，保持五官与造型完全一致' },
  { key: 'cine-light', group: '质感调节', label: '电影级光影校正', prompt: '电影级光影校正，调整画面光影质感、对比与色调，保持内容不变' },
  // 空间与机位
  { key: 'pano720', group: '空间与机位', label: '720全景', prompt: '以参考图的场景内容、材质、光线与氛围为依据，重新生成为一张真正的【等距圆柱投影全景图 equirectangular / ERP，2:1】，不是普通宽幅透视照。严格要求：① 相机位于空间正中央，拍摄完整 360° 水平 × 180° 垂直的环境，必须补全并包含原视角正后方的墙体与陈设；② 不要保留原图的单点透视与消失点，改用全景球面投影几何重新构图；③ 地平线是一条贯穿画面垂直正中的水平直线；④ 天花板向画面顶边强烈拉伸弯曲、地板向底边强烈拉伸，越靠上下边缘畸变越夸张；⑤ 画面最左与最右边缘的像素必须完全连续、可无缝环绕拼接（同一位置）；⑥ 保持原场景的建筑风格、材质与光氛一致。用途：贴到 Three.js 反面球体作为环绕环境背景球。', aspectRatio: '2:1' },
  { key: 'multicam9', group: '空间与机位', label: '多机位九宫格', prompt: '生成同一场景的多机位九宫格视角图，9 个不同机位与景别' },
  // 设定图
  { key: 'face-3view', group: '设定图', label: '角色脸部三视图', prompt: '基于参考图生成角色脸部细节三视图：正面、侧面、四分之三侧面，统一造型' },
  { key: 'char-sheet', group: '设定图', label: '角色设定图', prompt: '角色主视觉设定图，全身造型与细节拆解，白色背景' },
  { key: 'char-3view', group: '设定图', label: '角色三视图', prompt: '角色正面、侧面、背面三视图，统一姿势与造型，白色背景' },
  { key: 'scene-sheet', group: '设定图', label: '场景设定图', prompt: '场景设定图，完整呈现空间结构与陈设细节，画面中没有人物' },
  { key: 'product-sheet', group: '设定图', label: '产品设定图', prompt: '产品设定图，多角度展示与材质细节' },
]

export const RECIPE_GROUPS: ImageRecipe['group'][] = ['分镜叙事', '质感调节', '空间与机位', '设定图']
