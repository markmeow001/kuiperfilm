// ============================================================
// AI 短劇平台 — 視覺風格庫 Seed Data (29 個風格)
// ============================================================
// 對應文檔: style-library-design-v3.md (第二部分)
// 變動: 加入「遊戲 CG」進 F 分類，總數從 28 → 29
// ============================================================

import type { VisualStyle } from './types'

export const visualStyles: VisualStyle[] = [
  // ========================================================
  // A. 寫實影視 (Realistic Cinema) — 5 個
  // ========================================================
  {
    id: 'cinematic_realism',
    nameZh: '院線寫實',
    nameEn: 'Cinematic Realism',
    category: 'A',
    categoryNameZh: '寫實影視',
    thumbnailUrl: null,
    styleAnchor:
      'Cinematic photorealistic style, 35mm anamorphic lens, professional film production quality, Arri Alexa color grading, natural skin texture with realistic pores and micro-details',
    visualModifiers:
      'shallow depth of field, volumetric atmospheric haze, naturalistic lighting with practical sources, subtle film grain, authentic textures (weathered wood, brushed metal, fabric weave), color-graded for theatrical release',
    negativePrompt:
      'animation, anime, cartoon, 3D render, plastic skin, oversaturated, harsh digital sharpening, video game aesthetic, distorted, low quality, smooth airbrushed faces',
    referenceArtists: ['Roger Deakins', 'Emmanuel Lubezki', 'HBO prestige drama'],
    bestForGenres: ['billionaire CEO', 'revenge', 'thriller', 'corporate drama', 'noir'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['realistic', 'cinematic', 'premium'],
    displayOrder: 1,
    isActive: true,
  },
  {
    id: 'american_vertical_drama',
    nameZh: '北美短劇',
    nameEn: 'American Vertical Drama',
    category: 'A',
    categoryNameZh: '寫實影視',
    thumbnailUrl: null,
    styleAnchor:
      'ReelShort vertical drama style, contemporary American photorealism, bright clean cinematography, soap opera production aesthetic with cinematic polish',
    visualModifiers:
      'warm flattering lighting, glossy magazine-quality skin rendering, vibrant but balanced color palette, 9:16 vertical composition, close-up focused framing, modern suburban or luxury interior settings',
    negativePrompt:
      'animation, anime, cartoon, 3D render, dark gritty, art house, experimental, washed out, distorted, low quality, low budget look',
    referenceArtists: [
      'The Double Life of My Billionaire Husband',
      'DramaBox titles',
      'ReelShort productions',
    ],
    bestForGenres: ['billionaire CEO', 'fake marriage', 'secret identity', 'werewolf alpha', 'Cinderella'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['realistic', 'vertical', 'drama'],
    displayOrder: 2,
    isActive: true,
  },
  {
    id: 'kdrama_cinematic',
    nameZh: '韓劇電影感',
    nameEn: 'K-Drama Cinematic',
    category: 'A',
    categoryNameZh: '寫實影視',
    thumbnailUrl: null,
    styleAnchor:
      'Korean drama cinematic style, soft luminous photorealism, premium K-content production value, modern Korean cinematography',
    visualModifiers:
      'soft diffused lighting, peach and rose color grading, dewy luminous skin finish, autumn or winter palette, blurred urban backgrounds with bokeh, anamorphic lens flare, intimate close-ups, melancholic romantic mood',
    negativePrompt:
      'animation, anime, cartoon, harsh shadows, oversaturated, action movie palette, dark gritty, distorted, low quality, American sitcom aesthetic',
    referenceArtists: ['Crash Landing on You', 'Goblin', 'Park Chan-wook cinematography'],
    bestForGenres: ['romance', 'contract marriage', 'second chance', 'memory loss', 'rich-poor romance'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['realistic', 'romantic', 'korean'],
    displayOrder: 3,
    isActive: true,
  },
  {
    id: 'hk_cinema',
    nameZh: '港片質感',
    nameEn: 'HK Cinema',
    category: 'A',
    categoryNameZh: '寫實影視',
    thumbnailUrl: null,
    styleAnchor:
      'Hong Kong cinema aesthetic, Wong Kar-wai inspired, 1990s-2000s HK film stock look, expired film color shift, smoky neon-lit urban Asia',
    visualModifiers:
      'step-printed motion blur, saturated reds and greens, neon signage reflections, rain-soaked streets, cigarette smoke haze, cramped interior compositions, telephoto compression, melancholic urban isolation',
    negativePrompt:
      'American style, clean digital look, modern smartphone aesthetic, Marvel, anime, cartoon, bright cheerful, suburban, distorted, low quality',
    referenceArtists: ['Wong Kar-wai', 'Christopher Doyle', 'In the Mood for Love', 'Chungking Express'],
    bestForGenres: ['noir romance', 'triad drama', 'memory romance', 'urban melancholy'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['realistic', 'stylized', 'asian-cinema'],
    displayOrder: 4,
    isActive: true,
  },
  {
    id: 'documentary',
    nameZh: '紀錄片風',
    nameEn: 'Documentary',
    category: 'A',
    categoryNameZh: '寫實影視',
    thumbnailUrl: null,
    styleAnchor:
      'Documentary film style, handheld camera realism, natural unposed compositions, observational cinema verite aesthetic',
    visualModifiers:
      'available light only, slight camera shake, candid expressions, real-world textures, unfiltered authenticity, journalistic framing, ambient sound implied, news-camera quality',
    negativePrompt:
      'polished, cinematic, dramatic lighting, animation, anime, 3D render, posed, glamorous, distorted, low quality, fashion shoot',
    referenceArtists: ['Vice documentaries', 'Netflix true crime', 'Errol Morris'],
    bestForGenres: ['true crime', 'found footage horror', 'social issue drama', 'investigation'],
    recommendedKlingVersion: '3.0',
    tags: ['realistic', 'documentary', 'raw'],
    displayOrder: 5,
    isActive: true,
  },

  // ========================================================
  // B. 日系動漫 (Japanese Anime) — 6 個
  // ========================================================
  {
    id: 'kyoani_school',
    nameZh: '京阿尼校園',
    nameEn: 'KyoAni Slice-of-Life',
    category: 'B',
    categoryNameZh: '日系動漫',
    thumbnailUrl: null,
    styleAnchor:
      'Kyoto Animation anime style, modern slice-of-life anime aesthetic, crisp precise line art, expressive subtle character animation, A-1 Pictures level background quality',
    visualModifiers:
      'soft natural lighting, detailed everyday Japanese school backgrounds, vibrant balanced colors, glossy hair highlights with cool tints, subtle facial expression shifts, blush moments, school uniform details, sakura petal accents',
    negativePrompt:
      '3D render, CGI, photorealistic, dark gritty, hyperrealistic, sketchy unfinished, exaggerated proportions, Western cartoon, distorted, low quality',
    referenceArtists: ['Kyoto Animation', 'Violet Evergarden', 'K-On!', 'A Silent Voice'],
    bestForGenres: ['school romance', 'slice of life', 'coming of age', 'summer festival'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['anime', '2d', 'warm'],
    displayOrder: 6,
    isActive: true,
  },
  {
    id: 'shinkai_urban',
    nameZh: '新海誠都市',
    nameEn: 'Shinkai Urban',
    category: 'B',
    categoryNameZh: '日系動漫',
    thumbnailUrl: null,
    styleAnchor:
      'Makoto Shinkai anime style, hyper-detailed photorealistic anime backgrounds with stylized characters, CoMix Wave Films aesthetic',
    visualModifiers:
      'ultra-vivid skies with dramatic cloud formations, lens flare, god rays through windows, volumetric lighting, saturated sunset palette, golden hour atmosphere, sharp environmental detail (telephone poles, vending machines, train stations), atmospheric depth',
    negativePrompt:
      'flat colors, sketchy unfinished, 3D render, photorealistic humans, dull lighting, muted palette, daytime overcast, distorted, low quality',
    referenceArtists: ['Makoto Shinkai', 'Your Name', 'Weathering With You', '5 Centimeters Per Second'],
    bestForGenres: ['urban romance', 'long distance love', 'magical realism', 'yearning'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['anime', '2d', 'vibrant'],
    displayOrder: 7,
    isActive: true,
  },
  {
    id: 'ghibli_fantasy',
    nameZh: '吉卜力奇幻',
    nameEn: 'Ghibli Fantasy',
    category: 'B',
    categoryNameZh: '日系動漫',
    thumbnailUrl: null,
    styleAnchor:
      'Studio Ghibli anime style, hand-painted watercolor backgrounds, Hayao Miyazaki aesthetic, traditional 2D cel animation, painterly natural environments',
    visualModifiers:
      'warm pastel palette, gentle natural lighting, lush detailed scenery, soft rounded character outlines, nostalgic atmosphere, painterly clouds, whimsical small creatures, food-as-art rendering, wind through grass',
    negativePrompt:
      '3D render, CGI, photorealistic, dark gritty, hyperrealistic, harsh shadows, plastic texture, urban modernity, distorted, low quality',
    referenceArtists: [
      'Studio Ghibli',
      'Hayao Miyazaki',
      'Spirited Away',
      'Princess Mononoke',
      "Howl's Moving Castle",
    ],
    bestForGenres: [
      'fantasy adventure',
      'isekai',
      'coming of age',
      'magical realism',
      'nature spirits',
    ],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['anime', '2d', 'warm', 'fantasy'],
    displayOrder: 8,
    isActive: true,
  },
  {
    id: '90s_cel_anime',
    nameZh: '90s 賽璐璐',
    nameEn: '90s Cel Anime',
    category: 'B',
    categoryNameZh: '日系動漫',
    thumbnailUrl: null,
    styleAnchor:
      '1990s anime style, traditional cel animation, retro Japanese animation aesthetic, Akira and Ghost in the Shell era, analog film transfer look',
    visualModifiers:
      'limited color palette, visible cel shading layers, slight film grain, hand-painted matte backgrounds, classic anime composition, analog warmth, vintage neon, VHS color bleed, mature themes aesthetic',
    negativePrompt:
      'modern digital anime, 3D render, CGI, ultra-smooth gradients, photorealistic, plastic, cute moe, distorted, low quality, overly clean',
    referenceArtists: ['Akira', 'Ghost in the Shell', 'Cowboy Bebop', 'Perfect Blue', 'Satoshi Kon'],
    bestForGenres: ['cyberpunk', 'noir thriller', 'psychological drama', 'mecha', 'mature romance'],
    recommendedKlingVersion: '3.0',
    tags: ['anime', '2d', 'retro', 'mature'],
    displayOrder: 9,
    isActive: true,
  },
  {
    id: 'isekai_light_novel',
    nameZh: '異世界輕小說',
    nameEn: 'Isekai Light Novel',
    category: 'B',
    categoryNameZh: '日系動漫',
    thumbnailUrl: null,
    styleAnchor:
      'Japanese isekai light novel illustration style, modern light novel cover aesthetic, RPG fantasy world with magic particles, glowing runes and skill auras',
    visualModifiers:
      'more detailed than standard anime, vibrant saturated palette, European medieval × magical elements, status window UI aesthetic, glowing magical effects, ornate weapons and armor, dramatic lighting on protagonist, mob silhouettes in background',
    negativePrompt:
      'modern realistic, slice of life, urban, photorealistic, 3D render, dark gritty horror, distorted, low quality, plain clothing',
    referenceArtists: ['Re:Zero', 'Sword Art Online', 'Mushoku Tensei', 'Overlord'],
    bestForGenres: ['isekai reincarnation', 'magic academy', 'demon lord', 'level up', 'harem fantasy'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['anime', '2d', 'fantasy', 'vibrant'],
    displayOrder: 10,
    isActive: true,
  },
  {
    id: 'modern_painterly_anime',
    nameZh: '現代厚塗',
    nameEn: 'Modern Painterly Anime',
    category: 'B',
    categoryNameZh: '日系動漫',
    thumbnailUrl: null,
    styleAnchor:
      'Modern semi-realistic anime illustration style, thick painted rendering, digital painting with anime sensibilities, key visual quality artwork',
    visualModifiers:
      'rich color depth, soft brush strokes, painterly textures, dynamic dramatic lighting, detailed character rendering, magazine cover quality composition, anime portrait style with realistic proportions',
    negativePrompt:
      'flat colors, cel shading only, sketchy lineart, 3D render, photorealistic humans, plastic, chibi, distorted, low quality, simple watercolor',
    referenceArtists: ['Range Murata', 'Yoshitaka Amano', 'modern Pixiv illustrators'],
    bestForGenres: ['mature romance', 'fantasy epic', 'dark fantasy', 'character drama'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['anime', '2d', 'painterly', 'semi-realistic'],
    displayOrder: 11,
    isActive: true,
  },

  // ========================================================
  // C. 美漫/西方插畫 (Western Comic & Illustration) — 5 個 ⭐ 競品空白
  // ========================================================
  {
    id: 'marvel_action_comic',
    nameZh: 'Marvel 動作',
    nameEn: 'Marvel Action Comic',
    category: 'C',
    categoryNameZh: '美漫與西方插畫',
    thumbnailUrl: null,
    styleAnchor:
      'Marvel comic book style, bold ink outlines (3-5px confident black lines), dynamic action compositions, classic American superhero comic aesthetic, halftone Ben-Day dots shading',
    visualModifiers:
      'saturated primary colors (red, blue, yellow), dramatic chiaroscuro lighting, hero pose framing, action speed lines, impact frames, dramatic foreshortening, cinematic low angles, muscle-defined character proportions, comic panel composition',
    negativePrompt:
      'anime, manga, watercolor, soft pastel, photorealistic, 3D render, plastic, blurry, distorted, low quality, soft edges, gentle lighting',
    referenceArtists: ['Jim Lee', 'Marvel Comics', 'Stuart Immonen', 'Bryan Hitch'],
    bestForGenres: ['superhero', 'action thriller', 'vigilante', 'power fantasy', 'revenge'],
    recommendedKlingVersion: '3.0',
    tags: ['comic', '2d', 'action', 'western'],
    displayOrder: 12,
    isActive: true,
  },
  {
    id: 'spider_verse',
    nameZh: 'Spider-Verse 風',
    nameEn: 'Multiverse Comic',
    category: 'C',
    categoryNameZh: '美漫與西方插畫',
    thumbnailUrl: null,
    styleAnchor:
      'Spider-Verse animation style, mixed-media comic aesthetic, halftone print texture overlay, dimensional shift visual language, contemporary American animated comic',
    visualModifiers:
      'chromatic aberration on color separations, visible Ben-Day dot patterns, hand-drawn line work mixed with painterly fills, dynamic motion lines, panel-fragment compositions, neon palette accents, kinetic energy in every frame, multiple frame rate effect',
    negativePrompt:
      'traditional anime, realistic 3D, photorealistic, classic Disney, distorted, low quality, smooth uniform rendering',
    referenceArtists: [
      'Into the Spider-Verse',
      'Across the Spider-Verse',
      'Sony Pictures Animation',
    ],
    bestForGenres: ['superhero origin', 'multiverse adventure', 'teen action', 'stylized thriller'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['comic', 'stylized', 'modern', 'western'],
    displayOrder: 13,
    isActive: true,
  },
  {
    id: 'arcane_painterly',
    nameZh: 'Arcane 風',
    nameEn: 'Arcane Painterly',
    category: 'C',
    categoryNameZh: '美漫與西方插畫',
    thumbnailUrl: null,
    styleAnchor:
      'Arcane animation style, Fortiche Studio aesthetic, painterly 3D animation with 2D illustration overlay, gritty stylized fantasy',
    visualModifiers:
      'thick painterly textures with visible brush strokes, dramatic volumetric lighting, steampunk-fantasy hybrid environments, smoky atmosphere, rich saturated jewel tones (teal, magenta, gold), detailed character expressions, cinematic action poses',
    negativePrompt:
      'smooth Pixar, anime, manga, photorealistic, clean digital animation, distorted, low quality, simple colors',
    referenceArtists: ['Arcane Netflix', 'Fortiche Studio', 'League of Legends cinematics'],
    bestForGenres: [
      'dark fantasy',
      'steampunk adventure',
      'sibling drama',
      'rebellion',
      'magical politics',
    ],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['western', 'painterly', 'fantasy', 'premium'],
    displayOrder: 14,
    isActive: true,
  },
  {
    id: 'dc_dark_heroic',
    nameZh: 'DC 黑暗英雄',
    nameEn: 'DC Dark Heroic',
    category: 'C',
    categoryNameZh: '美漫與西方插畫',
    thumbnailUrl: null,
    styleAnchor:
      'DC Comics dark heroic style, Frank Miller / Jim Lee aesthetic, noir-influenced American comic art, mature comic book illustration',
    visualModifiers:
      'high contrast black and white core with selective color (red accents), heavy ink shadows, rain-soaked urban settings, brooding hero silhouettes, gothic architecture, low-key lighting, weathered textures, dramatic vigilante atmosphere',
    negativePrompt:
      'bright cheerful, anime cute, pastel, Pixar, watercolor, soft lighting, daytime, distorted, low quality, Marvel saturated palette',
    referenceArtists: ['Frank Miller', 'Sin City', 'The Dark Knight Returns', 'Mike Mignola'],
    bestForGenres: ['vigilante', 'dark superhero', 'crime noir', 'anti-hero', 'urban thriller'],
    recommendedKlingVersion: '3.0',
    tags: ['comic', 'noir', 'dark', 'western'],
    displayOrder: 15,
    isActive: true,
  },
  {
    id: 'american_storybook',
    nameZh: '美式繪本',
    nameEn: 'American Storybook',
    category: 'C',
    categoryNameZh: '美漫與西方插畫',
    thumbnailUrl: null,
    styleAnchor:
      "American children's storybook illustration style, Cartoon Saloon meets contemporary picture book aesthetic, hand-drawn warmth",
    visualModifiers:
      'soft watercolor washes, gentle pencil outlines, warm earth-tone palette, rounded friendly character designs, paper texture overlay, cozy domestic scenes, whimsical imagination, fairytale lighting',
    negativePrompt:
      'realistic, anime, manga, dark, gritty, 3D render, sharp edges, neon, urban, distorted, low quality, scary',
    referenceArtists: [
      'Cartoon Saloon',
      'The Secret of Kells',
      'Wolfwalkers',
      'Mary Blair',
      'modern picture books',
    ],
    bestForGenres: ['family drama', 'wholesome romance', 'fairytale', 'childhood memories', 'magical kids'],
    recommendedKlingVersion: '3.0',
    tags: ['western', 'illustration', 'warm', 'wholesome'],
    displayOrder: 16,
    isActive: true,
  },

  // ========================================================
  // D. 韓系 (Korean Style) — 3 個
  // ========================================================
  {
    id: 'webtoon_premium',
    nameZh: '極細韓漫',
    nameEn: 'Webtoon Premium',
    category: 'D',
    categoryNameZh: '韓系',
    thumbnailUrl: null,
    styleAnchor:
      'Premium Korean webtoon style (Manhwa aesthetic), ultra-clean digital illustration, vertical scroll comic art, idealized beauty rendering',
    visualModifiers:
      'super-fine variable line weight, idealized beauty proportions, Moranda-inspired sophisticated color palette with natural gradients, on-trend fashion styling, soft portrait lighting emphasizing skin glow, romantic elegant composition',
    negativePrompt:
      'sketchy unfinished, traditional Japanese anime, watercolor, 3D render, photorealistic, dark gritty, distorted, low quality, harsh lines, retro',
    referenceArtists: ['True Beauty', 'Lookism', 'Solo Leveling webtoon', 'Lezhin premium'],
    bestForGenres: ['romance', 'rich kids', 'school drama', 'second life', 'revenge glow-up'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['korean', '2d', 'clean', 'premium'],
    displayOrder: 17,
    isActive: true,
  },
  {
    id: 'webtoon_urban',
    nameZh: '韓漫都市',
    nameEn: 'Webtoon Modern Urban',
    category: 'D',
    categoryNameZh: '韓系',
    thumbnailUrl: null,
    styleAnchor:
      'Contemporary Korean webtoon urban style, modern fashion-forward webtoon aesthetic, commercial illustration polish',
    visualModifiers:
      'luxury apartment / office / high-end restaurant settings, sophisticated grey + business navy + clean white palette, commercial photography level lighting, K-drama chaebol aesthetic, clean digital rendering with subtle texture',
    negativePrompt:
      'traditional Japanese anime, ancient historical, fantasy, watercolor, 3D render, photorealistic, distorted, low quality, rural setting',
    referenceArtists: ['Cheese in the Trap', 'modern Korean office webtoons'],
    bestForGenres: ['office romance', 'chaebol drama', 'modern Cinderella', 'secret identity rich'],
    recommendedKlingVersion: '3.0',
    tags: ['korean', '2d', 'modern', 'urban'],
    displayOrder: 18,
    isActive: true,
  },
  {
    id: 'kdrama_romance',
    nameZh: '韓劇浪漫',
    nameEn: 'K-Drama Romance',
    category: 'D',
    categoryNameZh: '韓系',
    thumbnailUrl: null,
    styleAnchor:
      'K-drama romance cinematic style, soft luminous Korean photography aesthetic, optimized for emotional close-ups',
    visualModifiers:
      'extreme soft focus, dreamy peach-pink-cream palette, snow or rain weather, slow motion implied, sweater weather wardrobe, intimate framing, cherry blossom or first snow moments, glowing skin finish',
    negativePrompt:
      'animation, anime, harsh, action, dark, urban gritty, daytime harsh sun, distorted, low quality, American style',
    referenceArtists: ['Crash Landing on You', 'Goblin', 'Hotel Del Luna'],
    bestForGenres: [
      'second chance romance',
      'memory loss',
      'rich-poor love',
      'fated love',
      'season-themed romance',
    ],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['realistic', 'korean', 'romance', 'soft'],
    displayOrder: 19,
    isActive: true,
  },

  // ========================================================
  // E. 國風 (Chinese Style) — 3 個
  // ========================================================
  {
    id: 'xianxia_animation',
    nameZh: '國漫仙俠',
    nameEn: 'Xianxia Animation',
    category: 'E',
    categoryNameZh: '國風',
    thumbnailUrl: null,
    styleAnchor:
      'Chinese xianxia animation style (国漫仙侠), cultivation immortal aesthetic, modern Chinese animation production quality',
    visualModifiers:
      'cloud sea + floating mountains + immortal palaces, jade green / fairy white / divine gold / spirit purple palette, flowing silk robes with wind animation, Tyndall light beams through mist, flying eaves and dragon pillars, ink-wash distant perspective',
    negativePrompt:
      'Japanese anime style, Western cartoon, photorealistic, modern clothing, urban setting, distorted, low quality, K-pop aesthetic',
    referenceArtists: ['雾山五行', '白蛇缘起', '凡人修仙传 animation', '灵笼'],
    bestForGenres: [
      'xianxia cultivation',
      'immortal romance',
      'sect rivalry',
      'demon hunter',
      'ancient revenge',
    ],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['chinese', 'animation', 'fantasy', 'ancient'],
    displayOrder: 20,
    isActive: true,
  },
  {
    id: 'ink_wash_wuxia',
    nameZh: '古風水墨',
    nameEn: 'Ink Wash Wuxia',
    category: 'E',
    categoryNameZh: '國風',
    thumbnailUrl: null,
    styleAnchor:
      'Traditional Chinese ink wash painting style (国画 / 水墨), full ink gradation spectrum, rice paper texture visible, wuxia aesthetic',
    visualModifiers:
      'calligraphic brushstrokes with feibai (flying white) effect, cun-fa rock texture technique, large white space composition, occasional cinnabar seal stamp, Zen minimalist composition, monochrome with selective red accent (sword tassel)',
    negativePrompt:
      'anime, cartoon, photorealistic, 3D render, saturated colors, modern, urban, neon, distorted, low quality, Western painting',
    referenceArtists: ['八大山人', '石涛', 'modern wuxia ink illustrators'],
    bestForGenres: [
      'wuxia',
      'lone swordsman',
      'mountain hermit',
      'Zen philosophy drama',
      'historical poetry',
    ],
    recommendedKlingVersion: '3.0',
    tags: ['chinese', 'traditional', 'minimalist', 'ancient'],
    displayOrder: 21,
    isActive: true,
  },
  {
    id: 'modern_chinese_cg',
    nameZh: '國風 CG',
    nameEn: 'Modern Chinese CG',
    category: 'E',
    categoryNameZh: '國風',
    thumbnailUrl: null,
    styleAnchor:
      'Modern Chinese CG animation style, contemporary mainland Chinese 3D animation aesthetic, AAA cinematic CG quality',
    visualModifiers:
      'PBR ultra-detailed armor and weapons, dramatic volumetric divine light, gold / deep crimson / royal blue palette, grand architecture (temples / throne halls / battlefields), epic hero poses, UE5 level rendering, Chinese mythological references',
    negativePrompt:
      'anime 2D, watercolor, sketchy, photorealistic humans, K-drama aesthetic, distorted, low quality, modern urban',
    referenceArtists: ['黑神话悟空 cinematic', '三体动画', '灵笼'],
    bestForGenres: [
      'mythological epic',
      'wuxia action',
      'demon slaying',
      'imperial war',
      'cultivation battle',
    ],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['chinese', '3d', 'epic', 'ancient'],
    displayOrder: 22,
    isActive: true,
  },

  // ========================================================
  // F. CG/3D — 4 個 (原 3 + 遊戲 CG)
  // ========================================================
  {
    id: 'pixar_3d',
    nameZh: 'Pixar 3D',
    nameEn: 'Pixar 3D',
    category: 'F',
    categoryNameZh: 'CG 與 3D',
    thumbnailUrl: null,
    styleAnchor:
      'Pixar 3D animation style, Disney/Pixar production quality, stylized 3D characters with subsurface scattering skin, family-friendly polished CG',
    visualModifiers:
      'warm cinematic lighting (rim light + soft AO), exaggerated but believable proportions, large expressive eyes, polished surfaces with subtle imperfections, vibrant complementary color palette, professional studio key lighting, warm atmospheric mood',
    negativePrompt:
      'photorealistic, anime 2D, flat cartoon, sketchy, harsh shadows, dark gritty, scary, distorted, low quality',
    referenceArtists: ['Pixar', 'Inside Out', 'Coco', 'Soul', 'Disney Animation'],
    bestForGenres: ['family adventure', 'wholesome romance', 'magical creatures', 'emotional journey', 'kids fantasy'],
    recommendedKlingVersion: '3.0',
    tags: ['3d', 'western', 'warm', 'wholesome'],
    displayOrder: 23,
    isActive: true,
  },
  {
    id: 'plush_chibi',
    nameZh: 'Q 版毛絨英雄',
    nameEn: 'Plush Chibi Hero',
    category: 'F',
    categoryNameZh: 'CG 與 3D',
    thumbnailUrl: null,
    styleAnchor:
      'Plush toy IP style, Q-version 3-4 head-body ratio chibi characters, visible knit / felt fiber texture with subsurface scattering',
    visualModifiers:
      'thick black angry eyebrows, eye-roll expressions, apple-blush cheeks, smug pouty mouth, scene environments in Japanese animation universal aesthetic, soft plush rendering, cute fierce attitude contrast',
    negativePrompt:
      'realistic, adult proportions, anime humans, photorealistic, dark gritty, distorted, low quality, scary, mature',
    referenceArtists: ['Sanrio', 'Pop Mart Labubu', 'modern plush IP designs'],
    bestForGenres: ['comedy parody', 'kids adventure', 'merchandise IP shorts', 'cute meme'],
    recommendedKlingVersion: '3.0',
    tags: ['3d', 'chibi', 'cute', 'comedy'],
    displayOrder: 24,
    isActive: true,
  },
  {
    id: 'ue5_cinematic',
    nameZh: 'UE5 史詩',
    nameEn: 'Unreal Cinematic',
    category: 'F',
    categoryNameZh: 'CG 與 3D',
    thumbnailUrl: null,
    styleAnchor:
      'Unreal Engine 5 cinematic quality, AAA game cinematic CG, photorealistic 3D rendering, Lumen + Nanite quality',
    visualModifiers:
      'PBR ultra-detailed materials (armor / weapons / fabric), dramatic volumetric god rays, gold / deep crimson / royal blue epic palette, grand architecture (cathedrals / throne halls / battlefields), movie poster hero poses, RTX raytracing level lighting',
    negativePrompt:
      'anime 2D, cartoon, watercolor, hand-drawn, photographed real life, distorted, low quality, low poly, mobile game',
    referenceArtists: ['Unreal Engine demos', 'Hellblade', 'AAA game cinematics'],
    bestForGenres: ['epic fantasy', 'war drama', 'mythological battle', 'sci-fi action', 'post-apocalypse'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['3d', 'epic', 'realistic', 'fantasy'],
    displayOrder: 25,
    isActive: true,
  },
  {
    id: 'game_cg',
    nameZh: '遊戲 CG',
    nameEn: 'Game Cinematic',
    category: 'F',
    categoryNameZh: 'CG 與 3D',
    thumbnailUrl: null,
    styleAnchor:
      'AAA game cinematic CG style, pre-rendered game cutscene aesthetic, console game promotional video quality (Blizzard / Square Enix / miHoYo)',
    visualModifiers:
      'stylized realistic characters with idealized features, dramatic action poses, particle VFX (sparks / energy trails / magical effects), atmospheric volumetric fog, cinematic camera angles with motion blur, vibrant fantasy color grading, game UI implied but not shown',
    negativePrompt:
      'photorealistic real life, documentary, anime 2D flat, watercolor, hand-drawn, distorted, low quality, low poly retro game',
    referenceArtists: ['Blizzard cinematics', 'Final Fantasy CG', '原神 / 崩坏 cutscenes', 'Riot Games cinematics'],
    bestForGenres: [
      'isekai game world',
      'reincarnation MMORPG',
      'cultivation game protagonist',
      'fantasy quest',
      'class change',
    ],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['3d', 'game', 'fantasy', 'stylized'],
    displayOrder: 26,
    isActive: true,
  },

  // ========================================================
  // G. 復古/概念 (Retro & Conceptual) — 3 個 ⭐ 競品空白
  // ========================================================
  {
    id: 'cyberpunk',
    nameZh: '賽博朋克',
    nameEn: 'Cyberpunk',
    category: 'G',
    categoryNameZh: '復古與概念',
    thumbnailUrl: null,
    styleAnchor:
      'Cyberpunk neon-noir aesthetic, Blade Runner 2049 + Cyberpunk 2077 visual language, high-tech low-life atmosphere',
    visualModifiers:
      'neon pink / cyan / purple dominant palette, dark moody backgrounds, rain-soaked night streets, chrome reflections, full holographic UI, LED billboards, high contrast black + blown-out neon, lens halation + chromatic aberration, decaying urban × high tech',
    negativePrompt:
      'bright cheerful daylight, pastoral, photorealistic 1950s, rural, traditional, low contrast, muted, distorted, low quality',
    referenceArtists: ['Blade Runner', 'Ghost in the Shell', 'Cyberpunk 2077', 'Akira'],
    bestForGenres: ['sci-fi noir', 'hacker thriller', 'AI uprising', 'augmented romance', 'corporate dystopia'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['scifi', 'neon', 'dark', 'stylized'],
    displayOrder: 27,
    isActive: true,
  },
  {
    id: 'synthwave_80s',
    nameZh: '80s 合成波',
    nameEn: 'Synthwave 80s',
    category: 'G',
    categoryNameZh: '復古與概念',
    thumbnailUrl: null,
    styleAnchor:
      'Synthwave 1980s retro-futurism aesthetic, neon sunset visual language, VHS analog video texture',
    visualModifiers:
      'magenta-cyan gradient skies, chrome wireframe grid landscapes, palm tree silhouettes, sports car aesthetic, scan line overlay, lens flare halos, retro typography, Miami Vice atmosphere, sunset gradient backdrops',
    negativePrompt:
      'modern, photorealistic 2020s, anime, manga, ancient historical, distorted, low quality, daytime overcast',
    referenceArtists: ['Drive (2011)', 'Miami Vice', 'Stranger Things', 'Outrun'],
    bestForGenres: ['80s nostalgia', 'romance with retro vibe', 'sci-fi adventure', 'music video', 'stylized chase'],
    recommendedKlingVersion: '3.0',
    tags: ['retro', 'stylized', 'neon', 'nostalgic'],
    displayOrder: 28,
    isActive: true,
  },
  {
    id: 'steampunk',
    nameZh: '蒸汽朋克',
    nameEn: 'Steampunk',
    category: 'G',
    categoryNameZh: '復古與概念',
    thumbnailUrl: null,
    styleAnchor:
      'Victorian steampunk industrial aesthetic, brass / copper / dark iron primary materials, mechanical Victorian fantasy',
    visualModifiers:
      'visible gears, riveted metal plates, steam pipes, gas lamp amber warmth, leather + wood textures, Victorian cast-iron architecture, mechanical augmentations, steam + smoke ambient atmosphere, sepia-tinged photography feel',
    negativePrompt:
      'modern smartphone, futuristic clean, anime cute, K-drama, distorted, low quality, simple cartoon',
    referenceArtists: ["Howl's Moving Castle", 'BioShock Infinite', 'Treasure Planet'],
    bestForGenres: ['alternate history', 'inventor romance', 'airship adventure', 'Victorian mystery', 'mechanical fantasy'],
    recommendedKlingVersion: '3.0',
    tags: ['retro', 'stylized', 'fantasy', 'victorian'],
    displayOrder: 29,
    isActive: true,
  },
  {
    // 2026-05-20 — Imported from a reference cinematic prompt the user
    // shared as the quality bar to chase. The reference prompt
    // (https://art.kuiperfilmailab.com — robot-sweeper / zombie scene)
    // packed 7 sub-fields into its 【氛围与画质】 section:
    //   風格核心、攝影機+鏡頭、色彩分級、顆粒+濾鏡、光線品質、參考作品、情緒基調
    // Our existing styles average 25-word anchors; this one runs 60+ to
    // give the model enough grip to overcome Seedance 2.0's bias toward
    // "modern digital clean" / "video game CG" looks. The explicit
    // anti-CG declaration on the POSITIVE prompt side ("NOT video game
    // CG, live-action photography only") reinforces the negativePrompt
    // — Seedance training data leaks a lot of 3D-rendered content and
    // single-side suppression isn't always enough.
    id: 'atomic_punk_apocalypse',
    nameZh: '原子朋克末日',
    nameEn: 'Atomic-Punk Apocalypse',
    category: 'G',
    categoryNameZh: '復古與概念',
    thumbnailUrl: null,
    styleAnchor:
      'Atomic-punk post-apocalypse cinematic style, 1960s retro-futurism, anamorphic widescreen on IMAX film stock with Panavision C-series lenses, ultra-photorealistic live-action capture, dynamic motion blur, NOT video game CG, NOT animation',
    visualModifiers:
      'warm-orange + sea-salt blue high-contrast 1960s color grade, vintage film grain, wide-angle retro lens, low-saturation vintage film filter, natural daylight side-light through floor-to-ceiling windows, soft terrazzo floor reflections, balanced highlights with no clipping, full shadow detail, smooth tonal transitions, vintage soft film haze, suffocating lonely last-survivor mood, absurd contrast between leisure resort architecture and post-apocalyptic decay',
    negativePrompt:
      'video game CG, anime, cartoon, 3D render, plastic skin, oversaturated, harsh digital sharpening, smooth airbrushed faces, modern digital color grading, sterile clean digital look, fluorescent lighting, distorted, low quality',
    referenceArtists: ['Fallout (HBO series)', 'Pixar character motion control', 'Kubrick (2001: A Space Odyssey)', 'Blade Runner 2049 (Roger Deakins)'],
    bestForGenres: ['atomic-punk apocalypse', 'retro post-apocalypse', 'lone survivor / last hero', 'post-war ruins', 'desolate vacation noir', '1960s sci-fi'],
    recommendedKlingVersion: '3.0-Omni',
    tags: ['retro', 'apocalypse', 'atomic-punk', 'cinematic', 'photorealistic', 'premium'],
    displayOrder: 30,
    isActive: true,
  },
];

// 統計
export const STATS = {
  total: visualStyles.length, // 30 (2026-05-20: +atomic_punk_apocalypse)
  byCategory: {
    A: visualStyles.filter((s) => s.category === 'A').length, // 5
    B: visualStyles.filter((s) => s.category === 'B').length, // 6
    C: visualStyles.filter((s) => s.category === 'C').length, // 5
    D: visualStyles.filter((s) => s.category === 'D').length, // 3
    E: visualStyles.filter((s) => s.category === 'E').length, // 3
    F: visualStyles.filter((s) => s.category === 'F').length, // 4
    G: visualStyles.filter((s) => s.category === 'G').length, // 4 (2026-05-20)
  },
};
