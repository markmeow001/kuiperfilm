// Phase D — Thumbnail prompts for the 30 visual styles + 8 lighting presets.
// Originally targeted Kling Image O1 (5/16 blocked by no credits);
// 2026-05-30 補：also drives the AtlasCloud Gemini-3-Pro-Image flow used by
// design-preview mockups. See scripts/design-preview/gen-style-thumbs.mjs.
// One prompt per visualStyles[].id, drawn from
// docs/runbooks/style-library-thumbnails.md. Shared shape: 1:1 square,
// negative bakes "no text, no watermark, no logo" so a single negative
// covers all 29 calls.
//
// Keys MUST match visualStyles[].id exactly — the seeder + thumbnail
// script look them up by id.

export const STYLE_THUMBNAIL_NEGATIVE =
  'no text, no watermark, no logo, no signature, distorted face, low quality, blurry, extra limbs, deformed hands'

export const STYLE_THUMBNAIL_PROMPTS: Record<string, string> = {
  // ── A. 寫實影視 ───────────────────────────────────────────
  cinematic_realism:
    'Cinematic photorealistic portrait, young Asian woman in profile by a window at golden hour, 35mm anamorphic lens, shallow depth of field, natural skin texture with visible pores, Arri Alexa color grading, volumetric atmospheric haze, theatrical color grade, HBO prestige drama quality, 1:1 square composition',
  american_vertical_drama:
    'ReelShort vertical drama portrait style, young woman in cream sweater, modern luxury apartment, soft warm lighting, glossy magazine-quality skin, vibrant balanced palette, close-up framing, contemporary American photorealism, soap opera production aesthetic with cinematic polish, 1:1 square',
  kdrama_cinematic:
    'K-drama cinematic portrait, young woman with autumn coat against blurred urban background, soft diffused lighting, peach and rose color grading, dewy luminous skin finish, anamorphic lens flare, intimate close-up, melancholic romantic mood, Crash Landing on You aesthetic, 1:1 square',
  hk_cinema:
    'Hong Kong cinema portrait, woman in cheongsam against neon-lit alley at night, Wong Kar-wai inspired, step-printed motion blur, saturated reds and greens, expired film stock color shift, telephoto compression, melancholic urban isolation, 1990s HK film aesthetic, 1:1 square',
  documentary:
    'Documentary-style candid portrait, young woman on a busy street, natural unposed expression, available light only, slight camera shake, real-world textures, journalistic framing, news-camera quality, observational cinema verite, 1:1 square',

  // ── B. 日系動漫 ───────────────────────────────────────────
  kyoani_school:
    'Kyoto Animation anime style portrait, high school girl with sakura petals, crisp precise line art, soft natural lighting, vibrant balanced colors, glossy hair highlights with cool tints, blush on cheeks, school uniform details, A-1 Pictures background quality, 1:1 square',
  shinkai_urban:
    'Makoto Shinkai anime style, anime girl on train platform at sunset, ultra-vivid sky with dramatic clouds, lens flare, god rays, volumetric lighting, saturated sunset palette, sharp environmental detail (train station signs), CoMix Wave Films aesthetic, 1:1 square',
  ghibli_fantasy:
    'Studio Ghibli watercolor anime portrait, young girl in countryside meadow, hand-painted watercolor backgrounds, warm pastel palette, gentle natural lighting, soft rounded character outlines, painterly clouds, wind through grass, Hayao Miyazaki aesthetic, 1:1 square',
  '90s_cel_anime':
    '1990s anime cel animation portrait, mature anime woman with retro neon backdrop, traditional cel shading, limited color palette, slight film grain, hand-painted matte background, analog warmth, vintage neon, VHS color bleed, Akira / Ghost in the Shell era aesthetic, 1:1 square',
  isekai_light_novel:
    'Japanese isekai light novel illustration, anime adventurer girl with glowing magical staff, more detailed than standard anime, vibrant saturated palette, European medieval fantasy, glowing magical effects, ornate weapons, dramatic lighting, Re:Zero / Mushoku Tensei cover quality, 1:1 square',
  modern_painterly_anime:
    'Modern semi-realistic painterly anime portrait, young woman with thick painted rendering, rich color depth, soft brush strokes, painterly textures, dynamic dramatic lighting, detailed character rendering, magazine cover composition, Range Murata inspired, 1:1 square',

  // ── C. 美漫 / 西方插畫 ────────────────────────────────────
  marvel_action_comic:
    'Marvel comic book style superhero portrait, dynamic action pose, bold 3-5px black ink outlines, halftone Ben-Day dots shading, saturated primary colors, dramatic chiaroscuro, muscle-defined proportions, comic panel composition, Jim Lee aesthetic, 1:1 square',
  spider_verse:
    'Spider-Verse animation style portrait, dynamic mixed-media character, chromatic aberration on color separations, visible Ben-Day dot patterns, hand-drawn line work mixed with painterly fills, motion lines, neon palette, Into the Spider-Verse aesthetic, 1:1 square',
  arcane_painterly:
    'Arcane animation style character portrait, painterly 3D with 2D illustration overlay, thick painterly textures with visible brush strokes, dramatic volumetric lighting, rich saturated jewel tones (teal magenta gold), gritty stylized fantasy, Fortiche Studio aesthetic, 1:1 square',
  dc_dark_heroic:
    'DC Comics dark heroic portrait, brooding vigilante silhouette in rain, Frank Miller noir aesthetic, high contrast black and white with red accent, heavy ink shadows, gothic urban setting, low-key lighting, weathered textures, Sin City inspired, 1:1 square',
  american_storybook:
    'American storybook illustration portrait, cute child character in cozy scene, soft watercolor washes, gentle pencil outlines, warm earth-tone palette, rounded friendly designs, paper texture overlay, whimsical imagination, Cartoon Saloon / Wolfwalkers aesthetic, 1:1 square',

  // ── D. 韓系 ─────────────────────────────────────────────
  webtoon_premium:
    'Premium Korean webtoon portrait, idealized beauty young man and woman, ultra-clean digital illustration, super-fine variable line weight, Moranda-inspired sophisticated palette with natural gradients, on-trend fashion styling, soft portrait lighting emphasizing skin glow, romantic elegant composition, True Beauty / Lookism style, 1:1 square',
  webtoon_urban:
    'Contemporary Korean webtoon urban portrait, fashionable man in business attire, luxury apartment interior, sophisticated grey + business navy palette, commercial photography level lighting, K-drama chaebol aesthetic, clean digital rendering with subtle texture, 1:1 square',
  kdrama_romance:
    'K-drama romance cinematic portrait, young Korean woman in cream knit sweater, extreme soft focus, dreamy peach-pink-cream palette, first snow falling, intimate framing, glowing skin finish, sweater weather wardrobe, Crash Landing on You aesthetic, 1:1 square',

  // ── E. 國風 ─────────────────────────────────────────────
  xianxia_animation:
    'Chinese xianxia animation portrait, immortal cultivator in flowing silk robes, cloud sea + floating mountains backdrop, jade green and fairy white palette, Tyndall light beams through mist, ink-wash distant perspective, modern Chinese animation production quality, 雾山五行 aesthetic, 1:1 square',
  ink_wash_wuxia:
    'Traditional Chinese ink wash painting (国画 水墨), lone swordsman silhouette on mountain peak, calligraphic brushstrokes with feibai (flying white) effect, rice paper texture, large white space composition, cinnabar seal stamp in corner, Zen minimalist composition, monochrome with red sword tassel accent, 1:1 square',
  modern_chinese_cg:
    'Modern Chinese CG portrait, mythological hero in ornate armor, PBR ultra-detailed materials, dramatic volumetric divine light, gold + deep crimson + royal blue palette, grand temple background, UE5 level rendering, 黑神话悟空 cinematic aesthetic, 1:1 square',

  // ── F. CG / 3D ─────────────────────────────────────────
  pixar_3d:
    'Pixar 3D animation portrait, stylized cheerful character with large expressive eyes, subsurface scattering skin, warm cinematic lighting (rim light + soft AO), exaggerated believable proportions, polished surfaces, vibrant complementary palette, Disney/Pixar production quality, 1:1 square',
  plush_chibi:
    'Plush toy IP style character, Q-version 3-4 head-body ratio chibi, visible knit / felt fiber texture, thick black angry eyebrows, apple-blush cheeks, smug pouty expression, subsurface scattering on soft plush, Sanrio / Pop Mart Labubu style, 1:1 square',
  ue5_cinematic:
    'Unreal Engine 5 cinematic character portrait, heroic warrior in detailed armor, PBR ultra-detailed materials, dramatic volumetric god rays, gold and royal blue palette, grand cathedral background, movie poster hero pose, RTX raytracing level lighting, Hellblade aesthetic, 1:1 square',
  game_cg:
    'AAA game cinematic CG portrait, idealized fantasy hero character, stylized realistic features, dramatic action pose, particle VFX (energy trails), atmospheric volumetric fog, cinematic camera angle with motion blur, vibrant fantasy color grading, Blizzard / 原神 cinematic quality, 1:1 square',

  // ── G. 復古 / 概念 ────────────────────────────────────────
  cyberpunk:
    'Cyberpunk neon-noir portrait, character in chrome augmentations, neon pink + cyan + purple palette, rain-soaked night cityscape backdrop, holographic UI overlay, LED billboards, high contrast black with blown-out neon, lens halation and chromatic aberration, Blade Runner 2049 aesthetic, 1:1 square',
  synthwave_80s:
    'Synthwave 1980s retro-futurism scene, vintage sports car driving toward sunset, magenta-cyan gradient sky, chrome wireframe grid landscape, palm tree silhouettes, scan line overlay, lens flare halos, Miami Vice atmosphere, Outrun / Drive (2011) aesthetic, 1:1 square',
  steampunk:
    'Victorian steampunk portrait, character with mechanical brass goggles and gear-adorned outfit, brass + copper + dark iron materials, visible gears and steam pipes background, gas lamp amber warmth, leather and wood textures, Victorian cast-iron architecture, sepia-tinged photography feel, BioShock Infinite aesthetic, 1:1 square',
  atomic_punk_apocalypse:
    'Atomic-punk post-apocalyptic portrait, weathered survivor in patchwork leather armor with retro-futurist gas mask, rust + bleached khaki + radioactive green palette, ruined 1950s atomic-age city in background with crashed flying car, dust storm haze, harsh sun glare, vintage Fallout / Mad Max aesthetic, gritty atmospheric film grain, 1:1 square',
}

// ─────────────────────────────────────────────────────────────
// Lighting preset thumbnails (8) — 2026-05-30 added
// 每張統一風格：anonymous figure / silhouette + 同樣 cinematic 寫實基底，
// 只變光影；用「相同主體在不同光下」最能讓 user 一眼看懂差別。
// ─────────────────────────────────────────────────────────────

export const LIGHTING_THUMBNAIL_PROMPTS: Record<string, string> = {
  golden_hour:
    'Cinematic portrait, anonymous silhouetted figure on hillside facing camera, golden hour sunset lighting, warm amber and rose tones, long soft shadows stretching behind, rim light through hair, hazy atmospheric warmth, sun flares filtered by leaves, photorealistic film still, 1:1 square',
  blue_hour:
    'Cinematic portrait, anonymous figure looking out across cityscape at pre-dawn, deep blue sky with subtle warm horizon line, cool ambient blue tone everywhere, mysterious soft glow, mist hanging in air, single distant warm window light, photorealistic film still, 1:1 square',
  dramatic_high_contrast:
    'Cinematic portrait, anonymous figure half in deep shadow half in razor-sharp keylight, dramatic Rembrandt chiaroscuro, high contrast deep blacks against bright highlights, single focused spotlight from above-side, theatrical noir mood, photorealistic film still, 1:1 square',
  rainy_neon_night:
    'Cinematic portrait, anonymous figure under glowing umbrella on wet city street at night, neon pink + cyan + magenta reflections on rain-soaked asphalt, blade-runner atmosphere, blurred bokeh neon signs in background, wet camera lens, photorealistic film still, 1:1 square',
  soft_window_light:
    'Cinematic portrait, anonymous figure seated by large window, soft natural diffused daylight wrapping the subject, gentle shadows, neutral peaceful palette, dust particles drifting in light beam, intimate domestic mood, Vermeer-inspired, photorealistic film still, 1:1 square',
  moonlight_cool:
    'Cinematic portrait, anonymous figure standing in moonlit forest clearing, cool silver-blue moonlight from above, deep navy shadows, atmospheric mist, subtle backlit edge glow, mysterious dreamlike night mood, photorealistic film still, 1:1 square',
  fluorescent_cold:
    'Cinematic portrait, anonymous figure under harsh overhead fluorescent tube lighting in clinical hallway, cool sterile blue-white tone, unflattering top-down shadows, institutional liminal-space atmosphere, slight green color cast typical of old fluorescents, photorealistic film still, 1:1 square',
  candlelight_warm:
    'Cinematic portrait, anonymous figure illuminated only by single warm candle flame held nearby, deep warm amber glow falling on face and hands, surrounding darkness, flickering soft shadows, intimate Caravaggio-inspired chiaroscuro, photorealistic film still, 1:1 square',
}

