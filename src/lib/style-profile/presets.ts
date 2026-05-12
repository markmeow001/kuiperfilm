/**
 * Style profile preset catalog.
 *
 * 22 active presets across 6 categories, mirroring the reference
 * library the user supplied. Each preset carries an English label
 * (used as the canonical short id), a Chinese label and description
 * (shown in the UI), and a positive + negative prompt pair that the
 * worker layer prepends/applies to every image / video generation.
 *
 * Legacy keys (`anime`, `thick-paint`) are kept in the type union for
 * backwards compatibility with existing project rows in the DB, but
 * are excluded from the picker (see PRESET_ORDER_BY_CATEGORY).
 */

export type PresetCategory = 'realistic' | 'anime' | 'chinese' | 'korean' | 'cg-3d' | 'western'

export type PresetKey =
  // Realistic / film
  | 'realistic'
  | 'cyberpunk'
  | 'steampunk'
  // Anime
  | 'anime-classic'
  | 'ghibli'
  | 'anime-isekai'
  | 'anime-modern'
  | 'anime-urban'
  | 'anime-school'
  // Chinese
  | 'cn-xianxia'
  | 'cn-cartoon'
  | 'chinese-ink'
  // Korean webtoon
  | 'korean-webtoon-fine'
  | 'korean-historical'
  | 'korean-urban'
  // CG / 3D
  | 'pixar-3d'
  | 'q-plush'
  | 'cg-epic'
  | 'cg-urban'
  | 'game-cg'
  // Western
  | 'american-comic'
  | 'fantasy-cute'
  // Legacy backwards-compat (not shown in UI)
  | 'anime'
  | 'thick-paint'

export interface StylePresetEntry {
  label: string
  zhLabel: string
  zhDescription: string
  category: PresetCategory
  positivePrompt: string
  negativePrompt: string
}

const NEG_BASE = 'low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs'

export const STYLE_PROFILE_PRESETS: Record<PresetKey, StylePresetEntry> = {
  // ───────── Realistic / Film ─────────
  'realistic': {
    label: 'Realistic',
    zhLabel: '寫實風格',
    zhDescription: '影院級寫實攝影。自然皮膚紋理(毛孔/微細節),物理精準光照,柔影 + 體積霧 + 鏡頭效果(散景、色差)。真實材質。Arri Alexa 調色風格。',
    category: 'realistic',
    // 2026-05-13 — Kling-2.1 (Tencent VOD) defaults toward Chinese-game-CG
    // training bias (Genshin / Honkai aesthetic) whenever the realistic
    // positive prompt is the only style anchor. User shipped this preset
    // expecting TikTok-short-drama-style real-photo output and kept getting
    // semi-realistic CG renders with glossy doll-skin and idealized features.
    // Beef both prompts: positive locks in concrete photographic equipment
    // signals (camera, lens, film grain, real-world flaws), negative
    // explicitly bans every CG/game/Pixar/anime adjacency we've seen leak
    // through plus the porcelain-skin / idealized-feature failure mode.
    positivePrompt: 'real-life photograph captured on a DSLR full-frame camera, 35mm lens, cinematic photorealistic photography, natural skin texture with visible pores wrinkles freckles and micro imperfections, asymmetric realistic facial features, physically accurate lighting, soft shadows with volumetric fog, lens effects including bokeh and chromatic aberration, real-world materials (weathered wood, polished metal, woven fabric), subtle film grain, Arri Alexa color grading, documentary realism — NOT a 3D render, NOT CG, NOT game graphics, NOT a digital painting',
    negativePrompt: `cartoon, anime, illustration, painted, digital painting, 3D render, CGI, CG render, computer graphics, game CG, video game style, Genshin Impact style, MiHoYo style, Honkai aesthetic, Pixar style, Disney animation, semi-realistic, anime realism, stylized character render, doll-like, porcelain skin, glossy plastic skin, perfectly symmetric face, idealized beauty, smoothed skin, airbrushed skin, plastic skin, ${NEG_BASE}`,
  },
  'cyberpunk': {
    label: 'Cyberpunk',
    zhLabel: '賽博朋克',
    zhDescription: '賽博朋克霓虹黑色美學。霓虹粉/青/紫主導,深色背景。雨夜街面/鉻反射、全息 UI、LED 廣告。高對比黑 + 爆光霓虹。鏡頭光暈 + 色差。頹廢都市 × 高科技。',
    category: 'realistic',
    positivePrompt: 'cyberpunk neon noir aesthetic, neon pink cyan and purple dominant palette, dark background, rainy night street scenes with chrome reflections, holographic UI overlays, LED billboards, high contrast black with blown-out neon highlights, lens flare and chromatic aberration, dystopian city × high tech',
    negativePrompt: `bright daylight, pastoral, vintage warm tones, ink painting, low contrast, washed out, ${NEG_BASE}`,
  },
  'steampunk': {
    label: 'Steampunk',
    zhLabel: '蒸汽朋克',
    zhDescription: '維多利亞蒸汽朋克工業風。黃銅/銅/暗鐵主材。可見齒輪、鉚接金屬板、蒸汽管。煤氣燈琥珀暖光。皮革 + 木質紋理。維多利亞鑄鐵建築 + 機械增強。蒸汽 + 煙霧氛圍。',
    category: 'realistic',
    positivePrompt: 'Victorian steampunk industrial style, brass copper and dark iron primary materials, visible gears and rivets and steam pipes, gas lamp amber warm glow, leather and wood textures, Victorian cast-iron architecture with mechanical augmentation, steam and smoke atmosphere',
    negativePrompt: `futuristic neon, cartoon style, anime, photorealistic photography, modern minimalist, ${NEG_BASE}`,
  },

  // ───────── Anime ─────────
  'anime-classic': {
    label: 'Anime',
    zhLabel: '日系動漫',
    zhDescription: '經典日系賽璐珞動畫。1-2px 乾淨粗線,2-3 階 cel shading。大眼 + 詳細虹膜高光。簡化背景。頭髮乾淨色塊 + 銳利高光條。皮膚暖色平塗 + 微紅暈。',
    category: 'anime',
    positivePrompt: 'classic Japanese cel-shaded animation, 1-2px clean line art, 2-3 step cel shading, large expressive eyes with detailed iris highlights, simplified backgrounds, clean color blocks with sharp hair highlights, warm flat skin with subtle blush',
    negativePrompt: `photorealistic, photo, western comic ink, gritty texture, ${NEG_BASE}`,
  },
  'ghibli': {
    label: 'Ghibli',
    zhLabel: '吉卜力',
    zhDescription: '吉卜力手繪動畫。水彩感背景 + 筆觸可見。暖大地色 + 翠綠天藍。角色柔和圓潤,小巧細節眼。雲彩極致細節。建築充滿煙火氣(苔蘚牆、木紋)。光線永遠溫暖金色。',
    category: 'anime',
    positivePrompt: 'Studio Ghibli hand-drawn animation, watercolor backgrounds with visible brush strokes, warm earth tones and emerald sky blue, soft rounded characters with small detailed eyes, exquisitely detailed clouds, lived-in buildings with moss walls and wood grain, eternally warm golden lighting',
    negativePrompt: `photorealistic, neon, sharp digital edges, cyberpunk, ${NEG_BASE}`,
  },
  'anime-isekai': {
    label: 'Isekai',
    zhLabel: '日漫異世界',
    zhDescription: '日系異世界輕小說插畫。RPG 奇幻世界 + 魔法粒子 + 發光符文 + 技能光環。比標準動漫更精細。鮮艷飽和度,歐洲中世紀 × 魔法元素。狀態窗 / 物品欄 UI 美學。',
    category: 'anime',
    positivePrompt: 'Japanese isekai light novel illustration, RPG fantasy world with magic particles and glowing runes and skill auras, more detail than standard anime, vibrant saturation, European medieval × magical elements, status window and inventory UI aesthetic',
    negativePrompt: `photorealistic, low saturation, modern urban, ${NEG_BASE}`,
  },
  'anime-modern': {
    label: 'Modern Anime',
    zhLabel: '動漫通用',
    zhDescription: '標準日本動畫制作質量。京都動畫 / A-1 Pictures 級背景。明亮通透色調,2-3 階 cel 陰影。富表現力大眼 + 多層虹膜。頭髮乾淨色塊 + 高光。理想化藍紫陰影。',
    category: 'anime',
    positivePrompt: 'standard Japanese animation production quality, Kyoto Animation and A-1 Pictures level backgrounds, bright translucent palette, 2-3 step cel shadows, expressive large eyes with multi-layer iris, clean hair color blocks with highlights, idealized blue-purple shadows',
    negativePrompt: `photorealistic, gritty, oil painting, low quality, ${NEG_BASE}`,
  },
  'anime-urban': {
    label: 'Urban Anime',
    zhLabel: '都市動漫',
    zhDescription: '都市動漫 / 新海誠城市美學。極致細節現代日本城市(電線、自販機、車站)。戲劇化天空漸變(橙粉紫日落)。濕街霓虹反射。冷暖色溫過渡。電影感景深。',
    category: 'anime',
    positivePrompt: 'urban anime / Makoto Shinkai cityscape aesthetic, ultra-detailed modern Japanese city with power lines and vending machines and train stations, dramatic sky gradients (orange-pink-purple sunset), wet street neon reflections, cool-warm color temperature transitions, cinematic depth of field',
    negativePrompt: `pastoral, fantasy, low detail, flat sky, ${NEG_BASE}`,
  },
  'anime-school': {
    label: 'School Anime',
    zhLabel: '校園卡通',
    zhDescription: '日系校園動畫。櫻花粉 / 晴空藍 / 嫩草綠。明媚陽光 + 暖金邊光。校服細節 + 教室 + 操場。青春活力氛圍。聚焦角色表情。日常系柔和打光。',
    category: 'anime',
    positivePrompt: 'Japanese school anime, sakura pink with sunny blue and tender grass green, bright sunshine with warm gold rim light, detailed school uniforms with classrooms and sports field, youthful energetic atmosphere, focus on character expressions, daily-life soft lighting',
    negativePrompt: `dark, gritty, dystopian, photorealistic, ${NEG_BASE}`,
  },

  // ───────── Chinese ─────────
  'cn-xianxia': {
    label: 'Xianxia',
    zhLabel: '國漫仙俠',
    zhDescription: '國漫仙俠修真美學。雲海 + 浮山 + 仙宮。配色:玉綠 / 仙白 / 神金 / 靈紫。飄逸絲綢長袍 + 風動。霧中丁達爾光柱。飛簷、龍柱。水墨遠景透視。',
    category: 'chinese',
    positivePrompt: 'Chinese cultivation xianxia aesthetic, sea of clouds with floating mountains and immortal palaces, color palette of jade green / immortal white / divine gold / spiritual purple, flowing silk robes with wind motion, Tyndall light shafts through fog, flying eaves and dragon pillars, ink wash distant landscape perspective',
    negativePrompt: `cyberpunk, modern western, neon, low detail, ${NEG_BASE}`,
  },
  'cn-cartoon': {
    label: 'Chinese Cartoon',
    zhLabel: '國風卡通',
    zhDescription: '國風卡通。傳統中式元素 + 現代 CG 渲染。配色:朱紅 / 帝藍 / 金 / 墨綠。飛簷、雕梁畫棟。漢服 + 現代動畫上色。水墨意境 × 鮮艷動畫色。',
    category: 'chinese',
    positivePrompt: 'Chinese-style cartoon, traditional Chinese elements with modern CG rendering, vermilion / imperial blue / gold / ink green palette, flying eaves and carved beams, hanfu with modern animation coloring, ink wash mood × vivid animation colors',
    negativePrompt: `photorealistic, western comic, sketch, low saturation, ${NEG_BASE}`,
  },
  'chinese-ink': {
    label: 'Sumi-e',
    zhLabel: '古風水墨',
    zhDescription: '古風水墨(國畫 / sumi-e)。濃淡墨色全譜。生宣紙紋理可見。書法筆觸 + 飛白。皴法描山石。大面積留白。偶現朱砂印章。禪意極簡構圖。',
    category: 'chinese',
    positivePrompt: 'classical Chinese ink wash (国画 / sumi-e), full ink tonal range, visible rice paper texture, calligraphy brush strokes with flying-white (飞白), axe-cut cliff strokes (皴法), large negative space, occasional vermillion seal stamps, zen minimalist composition',
    negativePrompt: `photorealistic, neon, vibrant CG, full color, ${NEG_BASE}`,
  },

  // ───────── Korean Webtoon ─────────
  'korean-webtoon-fine': {
    label: 'Webtoon',
    zhLabel: '極細韓漫',
    zhDescription: '極細韓漫 webtoon。超精細變粗細線條。理想化美貌 + 自然身材比例。莫蘭迪高級配色 + 自然漸變。時尚前衛造型。柔和肖像光強調皮膚光澤。浪漫優雅構圖。',
    category: 'korean',
    positivePrompt: 'ultra-fine Korean webtoon style, super-fine variable line weight, idealized beauty with natural body proportions, Morandi sophisticated palette with natural gradients, fashionable avant-garde styling, soft portrait lighting emphasizing skin glow, romantic elegant composition',
    negativePrompt: `bold ink lines, american comic, anime, photorealistic, ${NEG_BASE}`,
  },
  'korean-historical': {
    label: 'Korean Historical',
    zhLabel: '韓漫古裝',
    zhDescription: '韓漫古裝。精繡韓服。宮殿庭院 + 韓式古建築。配色:緋紅 / 午夜藍 / 金箔。燭光 + 月光氛圍。裝飾邊框優雅構圖。韓劇史劇美學 + 理想化美人。',
    category: 'korean',
    positivePrompt: 'Korean historical drama webtoon style, exquisitely embroidered hanbok, palace courtyards with Korean traditional architecture, palette of crimson / midnight blue / gold leaf, candlelight and moonlight atmosphere, decorative bordered elegant composition, Korean drama historical aesthetic with idealized beauty',
    negativePrompt: `modern urban, cyberpunk, photorealistic photography, ${NEG_BASE}`,
  },
  'korean-urban': {
    label: 'Korean Urban',
    zhLabel: '韓漫都市',
    zhDescription: '韓漫都市 webtoon。當代時尚造型。豪華公寓 / 寫字樓 / 高端餐廳。配色:高級灰 / 商務藏青 / 乾淨白。商業攝影級打光。韓劇財閥美學。乾淨數字畫 + 微紋理。',
    category: 'korean',
    positivePrompt: 'Korean urban webtoon, contemporary fashionable styling, luxury apartments and office buildings and high-end restaurants, sophisticated gray and business navy and clean white palette, commercial photography lighting, Korean drama chaebol aesthetic, clean digital painting with subtle texture',
    negativePrompt: `historical, anime, cyberpunk, ${NEG_BASE}`,
  },

  // ───────── CG / 3D ─────────
  'pixar-3d': {
    label: 'Pixar 3D',
    zhLabel: '皮克斯3D',
    zhDescription: '皮克斯 / 迪士尼 3D 動畫質量。皮膚次表面散射。圓潤討喜角色。專業影棚燈(邊光 + 柔和 AO)。誇張但可信比例。乾淨拋光表面。豐富飽和 + 互補色設計。溫暖氛圍。',
    category: 'cg-3d',
    positivePrompt: 'Pixar / Disney 3D animation quality, subsurface scattering skin, rounded appealing characters, professional studio lighting with rim light and soft AO, exaggerated but believable proportions, clean polished surfaces, rich saturated colors with complementary design, warm atmosphere',
    negativePrompt: `photorealistic photography, anime cel shading, sketch, gritty, ${NEG_BASE}`,
  },
  'q-plush': {
    label: 'Q-Plush',
    zhLabel: 'Q版毛絨英雄',
    zhDescription: 'Q版 3-4 頭身毛絨玩偶 IP。可見針織/羊毛氈纖維 + SSS 膨皮。粗黑怒眉、翻白眼、蘋果腮紅、傲嬌撅嘴。場景沿用日系動漫通用美學。',
    category: 'cg-3d',
    positivePrompt: 'Q-style 3-4 head proportion plush IP, visible knit and wool felt fiber with SSS skin, bold angry brows / eye rolls / apple cheeks / tsundere pouty mouth, environments follow Japanese anime general aesthetic',
    negativePrompt: `photorealistic, gritty, dark, mature, ${NEG_BASE}`,
  },
  'cg-epic': {
    label: 'Epic CG',
    zhLabel: 'CG史詩',
    zhDescription: 'AAA 電影級 CG,奇幻大片質量。PBR 超精細盔甲武器。戲劇化體積神光。配色:金 / 深緋 / 皇家藍。宏偉建築(教堂 / 王座廳 / 戰場)。電影海報英雄姿勢。UE5 級渲染。',
    category: 'cg-3d',
    positivePrompt: 'AAA cinematic CG fantasy blockbuster quality, PBR ultra-detailed armor and weapons, dramatic volumetric god rays, palette of gold / deep crimson / royal blue, grand architecture (cathedrals / throne rooms / battlefields), film poster heroic poses, Unreal Engine 5 level rendering',
    negativePrompt: `cartoon, anime, low poly, ${NEG_BASE}`,
  },
  'cg-urban': {
    label: 'CG Urban',
    zhLabel: 'CG都市',
    zhDescription: 'CG 渲染現代都市。照片級 3D 建築(玻璃幕墻 + 鋼結構)。專業影棚燈(反射 + AO + GI)。豪華現代室內 + 高端材質。城市天際線 + 夜景。介於寫實與風格化之間,乾淨拋光。',
    category: 'cg-3d',
    positivePrompt: 'CG-rendered modern city, photorealistic 3D buildings (glass curtain walls and steel frame), professional studio lighting with reflection and AO and GI, luxurious modern interiors with premium materials, city skyline with night view, between realism and stylization, clean polished',
    negativePrompt: `cartoon, anime, fantasy, gritty, ${NEG_BASE}`,
  },
  'game-cg': {
    label: 'Game CG',
    zhLabel: '遊戲CG',
    zhDescription: '遊戲 CG 半寫實風格(原神 / 崩鐵美學)。介於寫實與卡通——非概念圖、非皮克斯。完美瓷感皮膚。僅面部輕度風格化(眼大 20-25%、柔下頜、小鼻)。頭髮眉毛真實絲感。身體寫實。',
    category: 'cg-3d',
    positivePrompt: 'game CG semi-realistic style (Genshin / Honkai aesthetic), between realism and cartoon — not concept art, not Pixar, perfect ceramic-like skin, slight facial stylization (eyes enlarged 20-25%, soft jawline, small nose), realistic hair and brow strands, realistic body proportions',
    negativePrompt: `pure photography, anime cel shading, low quality, ${NEG_BASE}`,
  },

  // ───────── Western ─────────
  'american-comic': {
    label: 'American Comic',
    zhLabel: '美式漫畫',
    zhDescription: '美式漫畫 / Marvel-DC 風。3-5px 粗黑墨線。動態透視 + 動作姿勢。本戴半調網點陰影。高飽和原色(紅 / 藍 / 黃)。荷蘭角 + 速度線。肌肉英雄比例。強明暗對比。',
    category: 'western',
    positivePrompt: 'American comic book style / Marvel-DC, 3-5px bold black ink lines, dynamic perspective with action poses, Ben-Day half-tone shading, high saturation primary colors (red / blue / yellow), Dutch angles with speed lines, muscular hero proportions, strong chiaroscuro',
    negativePrompt: `photo, photorealistic, soft watercolor, blurry edges, muted pastel palette, ${NEG_BASE}`,
  },
  'fantasy-cute': {
    label: 'Fantasy Cute',
    zhLabel: '奇幻卡通',
    zhDescription: '可愛奇幻卡通。柔和馬卡龍色(薰衣草 / 薄荷 / 桃)。圓潤角色 + 誇張可愛比例。魔法閃粉 + 光粒子。童話氛圍(蘑菇屋 / 水晶塔)。柔和漫射光(無硬影)。繪本插畫質感。',
    category: 'western',
    positivePrompt: 'cute fantasy cartoon, soft macaron palette (lavender / mint / peach), rounded characters with exaggerated cute proportions, magic sparkles with light particles, fairy tale atmosphere (mushroom houses / crystal towers), soft diffuse lighting (no harsh shadows), storybook illustration feel',
    negativePrompt: `photorealistic, dark, gritty, mature, harsh shadows, ${NEG_BASE}`,
  },

  // ───────── Legacy (kept for DB backwards compat, hidden from picker) ─────────
  'anime': {
    label: 'Anime (legacy)',
    zhLabel: '日系動漫(舊)',
    zhDescription: '舊版 anime preset,新建議改用「日系動漫」(anime-classic)',
    category: 'anime',
    positivePrompt: 'anime style, clean cel shading, vibrant saturated colors, expressive large eyes, detailed hair strands, soft gradient skin, key light highlights',
    negativePrompt: `photo, photorealistic, ${NEG_BASE}`,
  },
  'thick-paint': {
    label: 'Thick Paint (legacy)',
    zhLabel: '厚塗油畫(舊)',
    zhDescription: '舊版厚塗油畫 preset,可繼續使用',
    category: 'realistic',
    positivePrompt: 'thick impasto oil painting style, visible brush strokes, rich painterly texture, layered pigments, warm dramatic lighting, classical composition',
    negativePrompt: `photo, photorealistic, flat vector, sharp digital edges, pixel art, ${NEG_BASE}`,
  },
}

/**
 * Order shown in the picker, grouped by category.
 * Legacy keys (`anime`, `thick-paint`) are intentionally excluded.
 */
export const PRESET_ORDER_BY_CATEGORY: Record<PresetCategory, PresetKey[]> = {
  'realistic': ['realistic', 'cyberpunk', 'steampunk'],
  'anime': ['anime-classic', 'ghibli', 'anime-isekai', 'anime-modern', 'anime-urban', 'anime-school'],
  'chinese': ['cn-xianxia', 'cn-cartoon', 'chinese-ink'],
  'korean': ['korean-webtoon-fine', 'korean-historical', 'korean-urban'],
  'cg-3d': ['pixar-3d', 'q-plush', 'cg-epic', 'cg-urban', 'game-cg'],
  'western': ['american-comic', 'fantasy-cute'],
}

export const CATEGORY_LABEL_ZH: Record<PresetCategory, string> = {
  'realistic': '寫實與影視',
  'anime': '日系動漫',
  'chinese': '國風',
  'korean': '韓漫',
  'cg-3d': 'CG 與 3D',
  'western': '歐美與奇幻',
}
