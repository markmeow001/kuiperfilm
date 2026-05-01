/**
 * 主形象的 appearanceIndex 值。
 * 所有判断主/子形象的逻辑必须引用此常量，禁止硬编码数字。
 * 子形象的 appearanceIndex 从 PRIMARY_APPEARANCE_INDEX + 1 开始递增。
 */
export const PRIMARY_APPEARANCE_INDEX = 0

// 比例配置（nanobanana 支持的所有比例，按常用程度排序）
export const ASPECT_RATIO_CONFIGS: Record<string, { label: string; isVertical: boolean }> = {
  '16:9': { label: '16:9', isVertical: false },
  '9:16': { label: '9:16', isVertical: true },
  '1:1': { label: '1:1', isVertical: false },
  '3:2': { label: '3:2', isVertical: false },
  '2:3': { label: '2:3', isVertical: true },
  '4:3': { label: '4:3', isVertical: false },
  '3:4': { label: '3:4', isVertical: true },
  '5:4': { label: '5:4', isVertical: false },
  '4:5': { label: '4:5', isVertical: true },
  '21:9': { label: '21:9', isVertical: false },
}

// 配置页面使用的选项列表（从 ASPECT_RATIO_CONFIGS 派生）
export const VIDEO_RATIOS = Object.entries(ASPECT_RATIO_CONFIGS).map(([value, config]) => ({
  value,
  label: config.label
}))

// 获取比例配置
export function getAspectRatioConfig(ratio: string) {
  return ASPECT_RATIO_CONFIGS[ratio] || ASPECT_RATIO_CONFIGS['16:9']
}

export const ANALYSIS_MODELS = [
  { value: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro' },
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' }
]

export const IMAGE_MODELS = [
  { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
  { value: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0' }
]

// 图像模型选项（ 生成完整图片）
export const IMAGE_MODEL_OPTIONS = [
  { value: 'banana', label: 'Banana Pro (FAL)' },
  { value: 'banana-2', label: 'Banana 2 (FAL)' },
  { value: 'gemini-3-pro-image-preview', label: 'Banana (Google)' },
  { value: 'gemini-3-pro-image-preview-batch', label: 'Banana (Google Batch) 省50%' },
  { value: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0' },
  { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
  { value: 'imagen-4.0-generate-001', label: 'Imagen 4.0 (Google)' },
  { value: 'imagen-4.0-ultra-generate-001', label: 'Imagen 4.0 Ultra' },
  { value: 'imagen-4.0-fast-generate-001', label: 'Imagen 4.0 Fast' }
]

// Banana 模型分辨率选项（仅用于九宫格分镜图，单张生成固定2K）
export const BANANA_RESOLUTION_OPTIONS = [
  { value: '2K', label: '2K (推荐，快速)' },
  { value: '4K', label: '4K (高清，较慢)' }
]

// 支持分辨率选择的 Banana 模型
export const BANANA_MODELS = ['banana', 'banana-2', 'gemini-3-pro-image-preview', 'gemini-3-pro-image-preview-batch']

export const VIDEO_MODELS = [
  { value: 'doubao-seedance-1-0-pro-fast-251015', label: 'Seedance 1.0 Pro Fast' },
  { value: 'doubao-seedance-1-0-pro-fast-251015-batch', label: 'Seedance 1.0 Pro Fast (批量) 省50%' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428', label: 'Seedance 1.0 Lite' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428-batch', label: 'Seedance 1.0 Lite (批量) 省50%' },
  { value: 'doubao-seedance-1-5-pro-251215', label: 'Seedance 1.5 Pro' },
  { value: 'doubao-seedance-1-5-pro-251215-batch', label: 'Seedance 1.5 Pro (批量) 省50%' },
  { value: 'doubao-seedance-1-0-pro-250528', label: 'Seedance 1.0 Pro' },
  { value: 'doubao-seedance-1-0-pro-250528-batch', label: 'Seedance 1.0 Pro (批量) 省50%' },
  { value: 'fal-wan25', label: 'Wan 2.6' },
  { value: 'fal-veo31', label: 'Veo 3.1 Fast' },
  { value: 'fal-sora2', label: 'Sora 2' },
  { value: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', label: 'Kling 2.5 Turbo Pro' },
  { value: 'fal-ai/kling-video/v3/standard/image-to-video', label: 'Kling 3 Standard' },
  { value: 'fal-ai/kling-video/v3/pro/image-to-video', label: 'Kling 3 Pro' }
]

// SeeDream 批量模型列表（使用 GPU 空闲时间，成本降低50%）
export const SEEDANCE_BATCH_MODELS = [
  'doubao-seedance-1-5-pro-251215-batch',
  'doubao-seedance-1-0-pro-250528-batch',
  'doubao-seedance-1-0-pro-fast-251015-batch',
  'doubao-seedance-1-0-lite-i2v-250428-batch',
]

// 支持生成音频的模型（仅 Seedance 1.5 Pro 支持，包含批量版本）
export const AUDIO_SUPPORTED_MODELS = ['doubao-seedance-1-5-pro-251215', 'doubao-seedance-1-5-pro-251215-batch']

// 首尾帧视频模型（能力权威来源是 standards/capabilities；此常量仅作静态兜底展示）
export const FIRST_LAST_FRAME_MODELS = [
  { value: 'doubao-seedance-1-5-pro-251215', label: 'Seedance 1.5 Pro (首尾帧)' },
  { value: 'doubao-seedance-1-5-pro-251215-batch', label: 'Seedance 1.5 Pro (首尾帧/批量) 省50%' },
  { value: 'doubao-seedance-1-0-pro-250528', label: 'Seedance 1.0 Pro (首尾帧)' },
  { value: 'doubao-seedance-1-0-pro-250528-batch', label: 'Seedance 1.0 Pro (首尾帧/批量) 省50%' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428', label: 'Seedance 1.0 Lite (首尾帧)' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428-batch', label: 'Seedance 1.0 Lite (首尾帧/批量) 省50%' },
  { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 (首尾帧)' },
  { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast (首尾帧)' }
]

export const VIDEO_RESOLUTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' }
]

export const TTS_RATES = [
  { value: '+0%', label: '正常速度 (1.0x)' },
  { value: '+20%', label: '轻微加速 (1.2x)' },
  { value: '+50%', label: '加速 (1.5x)' },
  { value: '+100%', label: '快速 (2.0x)' }
]

export const TTS_VOICES = [
  { value: 'zh-CN-YunxiNeural', label: '云希 (男声)', preview: '男' },
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓 (女声)', preview: '女' },
  { value: 'zh-CN-YunyangNeural', label: '云扬 (男声)', preview: '男' },
  { value: 'zh-CN-XiaoyiNeural', label: '晓伊 (女声)', preview: '女' }
]

export const ART_STYLES = [
  // ── 写实 ──
  {
    value: 'realistic',
    label: '写实风格',
    preview: '实',
    promptZh: '严格写实摄影风格，禁止任何卡通、漫画、插画、动漫元素。必须像真实相机拍摄的照片或电影截图。真实人体比例和面部结构，真实皮肤毛孔与纹理，真实光影与环境反射，真实景深与镜头虚化效果，真实材质质感（布料、金属、皮肤、毛发），8K超高清画质，电影级调色',
    promptEn: 'Strictly photorealistic style. ABSOLUTELY NO cartoon, comic, illustration, anime, or stylized elements. Must look like a real photograph or movie screenshot. Real human proportions and facial structure, real skin pores and texture, realistic lighting with natural shadows and reflections, real depth of field and lens bokeh, realistic material textures (fabric, metal, skin, hair), 8K ultra HD quality, cinematic color grading.'
  },
  {
    value: 'cyberpunk',
    label: '赛博朋克',
    preview: '赛',
    promptZh: '赛博朋克未来科技风格，霓虹灯光，暗色调城市背景，高科技低生活美学，电子荧光色彩，未来都市氛围',
    promptEn: 'Cyberpunk futuristic style, neon lighting, dark urban backdrop, high-tech low-life aesthetics, electric fluorescent colors, dystopian city atmosphere.'
  },
  {
    value: 'steampunk',
    label: '蒸汽朋克',
    preview: '蒸',
    promptZh: '蒸汽朋克机械风格，维多利亚时代美学，黄铜齿轮管道，蒸汽动力机械装置，复古工业质感，暖色调金属光泽',
    promptEn: 'Steampunk mechanical style, Victorian era aesthetics, brass gears and pipes, steam-powered machinery, retro industrial texture, warm metallic tones.'
  },
  // ── 日系动漫 ──
  {
    value: 'japanese-anime',
    label: '日系动漫',
    preview: '日',
    promptZh: '现代日系动漫风格，赛璐璐上色，清晰干净的线条，视觉小说CG感，高质量经典动漫风格',
    promptEn: 'Modern Japanese anime style, cel shading, clean line art, visual-novel CG look, high-quality classic anime style.'
  },
  {
    value: 'ghibli',
    label: '吉卜力',
    preview: '宫',
    promptZh: '吉卜力工作室宫崎骏风格，水彩般柔和色调，温暖治愈的氛围，细腻的自然风景，手绘质感，梦幻童话般的场景',
    promptEn: 'Studio Ghibli Miyazaki style, soft watercolor tones, warm healing atmosphere, detailed natural scenery, hand-drawn texture, dreamlike fairy-tale scenes.'
  },
  {
    value: 'isekai-anime',
    label: '日漫异世界',
    preview: '异',
    promptZh: '日系异世界冒险动漫风格，奇幻魔法世界观，史诗冒险场景，鲜艳饱和色彩，精致角色设计，动态战斗构图',
    promptEn: 'Japanese isekai adventure anime style, fantasy magical world, epic adventure scenes, vivid saturated colors, detailed character design, dynamic action composition.'
  },
  {
    value: 'american-comic',
    label: '动漫通用',
    preview: '通',
    promptZh: '通用动漫风格，色彩明亮，线条清晰，角色表情生动，画面干净整洁，适合多种题材的动漫画风',
    promptEn: 'General anime style, bright colors, clean lines, expressive characters, neat visuals, versatile anime art suitable for various genres.'
  },
  {
    value: 'urban-anime',
    label: '都市动漫',
    preview: '都',
    promptZh: '都市动漫风格，现代城市背景，精致的都市街景，日系都市生活氛围，温暖的城市灯光，写实与动漫结合',
    promptEn: 'Urban anime style, modern city backdrop, detailed urban streetscapes, Japanese urban life atmosphere, warm city lights, blend of realism and anime.'
  },
  {
    value: 'campus-cartoon',
    label: '校园卡通',
    preview: '校',
    promptZh: '校园可爱卡通风格，明亮柔和的色彩，Q版可爱角色造型，青春校园场景，温馨活泼的氛围',
    promptEn: 'Campus cute cartoon style, bright soft colors, chibi cute character design, youthful school scenes, warm lively atmosphere.'
  },
  // ── 国风 ──
  {
    value: 'xianxia',
    label: '国漫仙侠',
    preview: '仙',
    promptZh: '中国仙侠修真风格，仙气飘渺的场景，古风角色服饰，灵气特效，云雾缭绕的仙境，东方玄幻美学',
    promptEn: 'Chinese xianxia cultivation style, ethereal mystical scenes, ancient character costumes, spiritual energy effects, misty celestial realm, Eastern fantasy aesthetics.'
  },
  {
    value: 'chinese-comic',
    label: '国风卡通',
    preview: '国',
    promptZh: '中国风卡通画风格，国风元素，传统纹样与现代卡通结合，色彩鲜艳，角色造型圆润可爱，中式美学',
    promptEn: 'Chinese-style cartoon, traditional Chinese elements, blend of classic patterns with modern cartoon, vibrant colors, rounded cute character design, Chinese aesthetics.'
  },
  {
    value: 'ink-wash',
    label: '古风水墨',
    preview: '墨',
    promptZh: '中国古风水墨画风格，淡雅留白，墨色浓淡渲染，山水意境，传统国画质感，诗意东方美学',
    promptEn: 'Chinese traditional ink wash painting style, elegant whitespace, ink gradient rendering, landscape mood, classical Chinese painting texture, poetic Eastern aesthetics.'
  },
  // ── 韩漫 ──
  {
    value: 'korean-webtoon',
    label: '极细韩漫',
    preview: '韩',
    promptZh: '韩国网络漫画风格，极细精致线条，柔和渐变色彩，精致的五官描绘，唯美浪漫氛围，高质量韩漫画风',
    promptEn: 'Korean webtoon style, ultra-fine detailed lines, soft gradient colors, delicate facial features, romantic aesthetic atmosphere, high-quality manhwa art.'
  },
  {
    value: 'korean-historical',
    label: '韩漫古装',
    preview: '韩古',
    promptZh: '韩漫古装风格，韩服传统服饰，古代宫廷场景，精致华丽的服饰细节，东方古典美学，韩式历史画风',
    promptEn: 'Korean manhwa historical style, traditional hanbok costumes, ancient palace scenes, ornate clothing details, Eastern classical aesthetics, Korean historical art.'
  },
  {
    value: 'korean-urban',
    label: '韩漫都市',
    preview: '韩都',
    promptZh: '韩漫都市现代风格，时尚都市背景，精致的现代角色造型，柔和光影，浪漫都市氛围，韩式现代漫画画风',
    promptEn: 'Korean manhwa modern urban style, fashionable city backdrop, refined modern character design, soft lighting, romantic urban atmosphere, Korean modern comic art.'
  },
  // ── CG与3D ──
  {
    value: 'pixar-3d',
    label: '皮克斯3D',
    preview: '3D',
    promptZh: '皮克斯风格3D动画，卡通渲染，圆润柔和的角色造型，丰富细腻的表情，温暖明亮的灯光，电影级渲染质感，高质量3D角色动画风格',
    promptEn: 'Pixar-style 3D animation, cartoon rendering, rounded soft character design, rich expressive faces, warm bright lighting, cinematic render quality, high-quality 3D character animation style.'
  },
  {
    value: 'cg-epic',
    label: 'CG史诗',
    preview: 'CG',
    promptZh: '史诗级CG渲染风格，电影级画面质感，宏大场景，戏剧性光影，超写实材质细节，大片视觉效果',
    promptEn: 'Epic CG rendering style, cinematic quality visuals, grand scenes, dramatic lighting, hyper-realistic material detail, blockbuster visual effects.'
  },
  {
    value: 'cg-urban',
    label: 'CG都市',
    preview: 'CG都',
    promptZh: '都市CG风格，现代城市场景渲染，精致的建筑与环境细节，电影级都市氛围，写实光影效果，都市生活质感',
    promptEn: 'Urban CG style, modern city scene rendering, detailed architecture and environment, cinematic urban atmosphere, realistic lighting effects, urban life texture.'
  },
  {
    value: 'game-cg',
    label: '游戏CG',
    preview: '游',
    promptZh: '半写实游戏CG风格，精致角色建模质感，游戏过场动画画面，细腻的皮肤与材质渲染，动态光影，3A游戏视觉品质',
    promptEn: 'Semi-realistic game CG style, refined character model texture, game cutscene visuals, detailed skin and material rendering, dynamic lighting, AAA game visual quality.'
  },
  // ── 欧美与奇幻 ──
  {
    value: 'western-comic',
    label: '美式漫画',
    preview: '美',
    promptZh: '美式漫画风格，粗犷有力的线条，鲜明对比色彩，漫威DC式英雄画风，波普艺术元素，夸张的动态构图',
    promptEn: 'American comic book style, bold powerful lines, high contrast colors, Marvel/DC hero art style, pop art elements, exaggerated dynamic composition.'
  },
  {
    value: 'fantasy-cartoon',
    label: '奇幻卡通',
    preview: '幻',
    promptZh: '奇幻卡通风格，魔法童话世界，梦幻柔和色彩，可爱奇幻角色，魔法光效，童话故事般的温馨场景',
    promptEn: 'Fantasy cartoon style, magical fairy-tale world, dreamy soft colors, cute fantasy characters, magical light effects, warm storybook-like scenes.'
  }
]

/**
 * 🔥 实时从 ART_STYLES 常量获取风格 prompt
 * 这是获取风格 prompt 的唯一正确方式，确保始终使用最新的常量定义
 * 
 * @param artStyle - 风格标识符，如 'realistic', 'american-comic' 等
 * @returns 对应的风格 prompt，如果找不到则返回空字符串
 */
export function getArtStylePrompt(
  artStyle: string | null | undefined,
  locale: 'zh' | 'en',
): string {
  if (!artStyle) return ''
  const style = ART_STYLES.find(s => s.value === artStyle)
  if (!style) return ''
  return locale === 'en' ? style.promptEn : style.promptZh
}

// 角色形象生成的系统后缀（始终添加到提示词末尾，不显示给用户）- 左侧面部特写+右侧三视图
// 強化版:加上明確負面條件防止 Tencent VOD 誤判成街景人物。觀察到女性
// 角色描述含「都市女孩」「妆容精致」等詞時偶爾會生出單張街拍而非三視圖,
// 加負面詞 + 純白背景 + 無人類雜物的硬性約束改善穩定度。
export const CHARACTER_PROMPT_SUFFIX = '【最重要 — 構圖規格,禁止違反】角色設定圖規格,僅一張圖且必須嚴格遵守以下版型: 畫面分為左右兩個區域: 【左側區域】佔約 1/3 寬度,是角色的正面特寫(如果是人類則展示完整正臉,如果是動物/生物則展示最具辨識度的正面形態);【右側區域】佔約 2/3 寬度,是角色三視圖橫向排列(從左到右依次為: 正面全身、側面全身、背面全身),三視圖高度一致。⚠️ 左側特寫和右側三視圖必須是完全相同的角色,面部五官、髮型、髮色、膚色完全一致,只是角度不同。【背景必須是純白色】,無街景、無建築、無傢俱、無其他人物、無背景人群、無城市場景、無店面、無自然風景。整張圖只有此角色與純白背景。'

// 场景图片生成的系统后缀（已禁用四视图，直接生成单张场景图）
//
// 強化:加上「無人物」硬性條件。Tencent VOD GEM-3.1 對含「餐桌」「客廳」
// 「咖啡店」等空間描述偶爾會自動補進角色 / 路人,這對下游 storyboard 拼接
// 是 noise(角色由分鏡層管,場景圖只負責空間)。明確排除人物 + 動物 + 主動
// 物件遮擋,讓場景圖回歸純空間 plate。
export const LOCATION_PROMPT_SUFFIX = '【場景空間圖,純空鏡】畫面中**絕對不能出現人物、人形、人影、剪影、人類臉孔、人手或腳的局部**;沒有寵物、動物、機器人或任何生命體。鏡頭描繪的是空無一人的場景空間本身,著重在建築結構、家具陳設、光影氛圍、材質紋理。'

// 角色图片生成比例（16:9横版，左侧面部特写+右侧全身）
export const CHARACTER_IMAGE_RATIO = '16:9'
// 角色图片尺寸（用于Seedream API）
export const CHARACTER_IMAGE_SIZE = '3840x2160'  // 16:9 横版
// 角色图片尺寸（用于Banana API）
export const CHARACTER_IMAGE_BANANA_RATIO = '3:2'

// 场景图片生成比例（1:1 正方形单张场景）
export const LOCATION_IMAGE_RATIO = '1:1'
// 场景图片尺寸（用于Seedream API）- 4K
export const LOCATION_IMAGE_SIZE = '4096x4096'  // 1:1 正方形 4K
// 场景图片尺寸（用于Banana API）
export const LOCATION_IMAGE_BANANA_RATIO = '1:1'

// 从提示词中移除角色系统后缀（用于显示给用户）
export function removeCharacterPromptSuffix(prompt: string): string {
  if (!prompt) return ''
  return prompt.replace(CHARACTER_PROMPT_SUFFIX, '').trim()
}

// 添加角色系统后缀到提示词（用于生成图片）
// Format spec goes FIRST so the model treats the 三视图 + 純白背景 contract
// as the leading instruction. Tencent VOD GEM-3.1 weights leading tokens
// more strongly; trailing format hints were occasionally drowned out by
// adjective-heavy descriptions ("都市女孩" / "光鮮亮麗" → single street
// shot instead of a sheet).
export function addCharacterPromptSuffix(prompt: string): string {
  if (!prompt) return CHARACTER_PROMPT_SUFFIX
  const cleanPrompt = removeCharacterPromptSuffix(prompt)
  return cleanPrompt
    ? `${CHARACTER_PROMPT_SUFFIX}\n\n【角色具體描述】\n${cleanPrompt}`
    : CHARACTER_PROMPT_SUFFIX
}

// 从提示词中移除场景系统后缀（用于显示给用户）
export function removeLocationPromptSuffix(prompt: string): string {
  if (!prompt) return ''
  return prompt.replace(LOCATION_PROMPT_SUFFIX, '').replace(/，$/, '').trim()
}

// 添加场景系统后缀到提示词（用于生成图片）
// Location format spec goes FIRST (same reasoning as addCharacterPromptSuffix
// — leading tokens carry more weight on Tencent VOD GEM-3.1).
export function addLocationPromptSuffix(prompt: string): string {
  // 后缀为空时直接返回原提示词
  if (!LOCATION_PROMPT_SUFFIX) return prompt || ''
  if (!prompt) return LOCATION_PROMPT_SUFFIX
  const cleanPrompt = removeLocationPromptSuffix(prompt)
  return cleanPrompt
    ? `${LOCATION_PROMPT_SUFFIX}\n\n【場景具體描述】\n${cleanPrompt}`
    : LOCATION_PROMPT_SUFFIX
}

/**
 * 构建角色介绍字符串（用于发送给 AI，帮助理解"我"和称呼对应的角色）
 * @param characters - 角色列表，需要包含 name 和 introduction 字段
 * @returns 格式化的角色介绍字符串
 */
export function buildCharactersIntroduction(characters: Array<{ name: string; introduction?: string | null }>): string {
  if (!characters || characters.length === 0) return '暂无角色介绍'

  const introductions = characters
    .filter(c => c.introduction && c.introduction.trim())
    .map(c => `- ${c.name}：${c.introduction}`)

  if (introductions.length === 0) return '暂无角色介绍'

  return introductions.join('\n')
}
