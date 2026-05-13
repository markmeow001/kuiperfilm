# 範例圖生成 Prompt 清單

> **用途**: 為每個風格生成「UI 卡片用的範例縮圖」
> **建議工具**: Kling Image O1（已在你 VOD AIGC 體系內）或 Midjourney v6.1
> **規格**: 1:1 方形，建議 1024×1024，最終存進 CDN 後填回 `visualStyles[].thumbnailUrl`
>
> **設計原則**:
> 1. 每個風格用**統一場景**（少女側臉肖像 + 自然背景）來生範例，讓用戶純粹比較「美學差異」而非「題材差異」
> 2. 不放真人臉、不放品牌 logo、不放文字
> 3. 若某風格不適合人物（如水墨、合成波），則改用該風格的標誌性物件

---

## A. 寫實影視

### A1. 院線寫實
```
Cinematic photorealistic portrait, young Asian woman in profile by a window at golden hour,
35mm anamorphic lens, shallow depth of field, natural skin texture with visible pores,
Arri Alexa color grading, volumetric atmospheric haze, theatrical color grade,
HBO prestige drama quality, no text, no watermark, 1:1 square composition
```

### A2. 北美短劇
```
ReelShort vertical drama portrait style, young woman in cream sweater, modern luxury apartment,
soft warm lighting, glossy magazine-quality skin, vibrant balanced palette, close-up framing,
contemporary American photorealism, soap opera production aesthetic with cinematic polish,
no text, no watermark, 1:1 square
```

### A3. 韓劇電影感
```
K-drama cinematic portrait, young woman with autumn coat against blurred urban background,
soft diffused lighting, peach and rose color grading, dewy luminous skin finish,
anamorphic lens flare, intimate close-up, melancholic romantic mood,
Crash Landing on You aesthetic, no text, no watermark, 1:1 square
```

### A4. 港片質感
```
Hong Kong cinema portrait, woman in cheongsam against neon-lit alley at night,
Wong Kar-wai inspired, step-printed motion blur, saturated reds and greens,
expired film stock color shift, telephoto compression, melancholic urban isolation,
1990s HK film aesthetic, no text, no watermark, 1:1 square
```

### A5. 紀錄片風
```
Documentary-style candid portrait, young woman on a busy street, natural unposed expression,
available light only, slight camera shake, real-world textures, journalistic framing,
news-camera quality, observational cinema verite,
no text, no watermark, 1:1 square
```

---

## B. 日系動漫

### B1. 京阿尼校園
```
Kyoto Animation anime style portrait, high school girl with sakura petals,
crisp precise line art, soft natural lighting, vibrant balanced colors,
glossy hair highlights with cool tints, blush on cheeks, school uniform details,
A-1 Pictures background quality, no text, no watermark, 1:1 square
```

### B2. 新海誠都市
```
Makoto Shinkai anime style, anime girl on train platform at sunset,
ultra-vivid sky with dramatic clouds, lens flare, god rays, volumetric lighting,
saturated sunset palette, sharp environmental detail (train station signs),
CoMix Wave Films aesthetic, no text, no watermark, 1:1 square
```

### B3. 吉卜力奇幻
```
Studio Ghibli watercolor anime portrait, young girl in countryside meadow,
hand-painted watercolor backgrounds, warm pastel palette, gentle natural lighting,
soft rounded character outlines, painterly clouds, wind through grass,
Hayao Miyazaki aesthetic, no text, no watermark, 1:1 square
```

### B4. 90s 賽璐璐
```
1990s anime cel animation portrait, mature anime woman with retro neon backdrop,
traditional cel shading, limited color palette, slight film grain,
hand-painted matte background, analog warmth, vintage neon, VHS color bleed,
Akira / Ghost in the Shell era aesthetic, no text, no watermark, 1:1 square
```

### B5. 異世界輕小說
```
Japanese isekai light novel illustration, anime adventurer girl with glowing magical staff,
more detailed than standard anime, vibrant saturated palette, European medieval fantasy,
glowing magical effects, ornate weapons, dramatic lighting,
Re:Zero / Mushoku Tensei cover quality, no text, no watermark, 1:1 square
```

### B6. 現代厚塗
```
Modern semi-realistic painterly anime portrait, young woman with thick painted rendering,
rich color depth, soft brush strokes, painterly textures, dynamic dramatic lighting,
detailed character rendering, magazine cover composition,
Range Murata inspired, no text, no watermark, 1:1 square
```

---

## C. 美漫/西方插畫

### C1. Marvel 動作
```
Marvel comic book style superhero portrait, dynamic action pose,
bold 3-5px black ink outlines, halftone Ben-Day dots shading, saturated primary colors,
dramatic chiaroscuro, muscle-defined proportions, comic panel composition,
Jim Lee aesthetic, no text, no watermark, 1:1 square
```

### C2. Spider-Verse 風
```
Spider-Verse animation style portrait, dynamic mixed-media character,
chromatic aberration on color separations, visible Ben-Day dot patterns,
hand-drawn line work mixed with painterly fills, motion lines, neon palette,
Into the Spider-Verse aesthetic, no text, no watermark, 1:1 square
```

### C3. Arcane 風
```
Arcane animation style character portrait, painterly 3D with 2D illustration overlay,
thick painterly textures with visible brush strokes, dramatic volumetric lighting,
rich saturated jewel tones (teal magenta gold), gritty stylized fantasy,
Fortiche Studio aesthetic, no text, no watermark, 1:1 square
```

### C4. DC 黑暗英雄
```
DC Comics dark heroic portrait, brooding vigilante silhouette in rain,
Frank Miller noir aesthetic, high contrast black and white with red accent,
heavy ink shadows, gothic urban setting, low-key lighting, weathered textures,
Sin City inspired, no text, no watermark, 1:1 square
```

### C5. 美式繪本
```
American storybook illustration portrait, cute child character in cozy scene,
soft watercolor washes, gentle pencil outlines, warm earth-tone palette,
rounded friendly designs, paper texture overlay, whimsical imagination,
Cartoon Saloon / Wolfwalkers aesthetic, no text, no watermark, 1:1 square
```

---

## D. 韓系

### D1. 極細韓漫
```
Premium Korean webtoon portrait, idealized beauty young man and woman,
ultra-clean digital illustration, super-fine variable line weight,
Moranda-inspired sophisticated palette with natural gradients, on-trend fashion styling,
soft portrait lighting emphasizing skin glow, romantic elegant composition,
True Beauty / Lookism style, no text, no watermark, 1:1 square
```

### D2. 韓漫都市
```
Contemporary Korean webtoon urban portrait, fashionable man in business attire,
luxury apartment interior, sophisticated grey + business navy palette,
commercial photography level lighting, K-drama chaebol aesthetic,
clean digital rendering with subtle texture, no text, no watermark, 1:1 square
```

### D3. 韓劇浪漫
```
K-drama romance cinematic portrait, young Korean woman in cream knit sweater,
extreme soft focus, dreamy peach-pink-cream palette, first snow falling,
intimate framing, glowing skin finish, sweater weather wardrobe,
Crash Landing on You aesthetic, no text, no watermark, 1:1 square
```

---

## E. 國風

### E1. 國漫仙俠
```
Chinese xianxia animation portrait, immortal cultivator in flowing silk robes,
cloud sea + floating mountains backdrop, jade green and fairy white palette,
Tyndall light beams through mist, ink-wash distant perspective,
modern Chinese animation production quality, 雾山五行 aesthetic,
no text, no watermark, 1:1 square
```

### E2. 古風水墨
```
Traditional Chinese ink wash painting (国画 水墨), lone swordsman silhouette on mountain peak,
calligraphic brushstrokes with feibai (flying white) effect, rice paper texture,
large white space composition, cinnabar seal stamp in corner, Zen minimalist composition,
monochrome with red sword tassel accent, no text, no watermark, 1:1 square
```

### E3. 國風 CG
```
Modern Chinese CG portrait, mythological hero in ornate armor,
PBR ultra-detailed materials, dramatic volumetric divine light,
gold + deep crimson + royal blue palette, grand temple background,
UE5 level rendering, 黑神话悟空 cinematic aesthetic,
no text, no watermark, 1:1 square
```

---

## F. CG/3D

### F1. Pixar 3D
```
Pixar 3D animation portrait, stylized cheerful character with large expressive eyes,
subsurface scattering skin, warm cinematic lighting (rim light + soft AO),
exaggerated believable proportions, polished surfaces, vibrant complementary palette,
Disney/Pixar production quality, no text, no watermark, 1:1 square
```

### F2. Q 版毛絨英雄
```
Plush toy IP style character, Q-version 3-4 head-body ratio chibi,
visible knit / felt fiber texture, thick black angry eyebrows, apple-blush cheeks,
smug pouty expression, subsurface scattering on soft plush,
Sanrio / Pop Mart Labubu style, no text, no watermark, 1:1 square
```

### F3. UE5 史詩
```
Unreal Engine 5 cinematic character portrait, heroic warrior in detailed armor,
PBR ultra-detailed materials, dramatic volumetric god rays, gold and royal blue palette,
grand cathedral background, movie poster hero pose, RTX raytracing level lighting,
Hellblade aesthetic, no text, no watermark, 1:1 square
```

### F4. 遊戲 CG
```
AAA game cinematic CG portrait, idealized fantasy hero character,
stylized realistic features, dramatic action pose, particle VFX (energy trails),
atmospheric volumetric fog, cinematic camera angle with motion blur,
vibrant fantasy color grading, Blizzard / 原神 cinematic quality,
no text, no watermark, 1:1 square
```

---

## G. 復古/概念

### G1. 賽博朋克
```
Cyberpunk neon-noir portrait, character in chrome augmentations,
neon pink + cyan + purple palette, rain-soaked night cityscape backdrop,
holographic UI overlay, LED billboards, high contrast black with blown-out neon,
lens halation and chromatic aberration, Blade Runner 2049 aesthetic,
no text, no watermark, 1:1 square
```

### G2. 80s 合成波
```
Synthwave 1980s retro-futurism scene, vintage sports car driving toward sunset,
magenta-cyan gradient sky, chrome wireframe grid landscape, palm tree silhouettes,
scan line overlay, lens flare halos, Miami Vice atmosphere,
Outrun / Drive (2011) aesthetic, no text, no watermark, 1:1 square
```

### G3. 蒸汽朋克
```
Victorian steampunk portrait, character with mechanical brass goggles and gear-adorned outfit,
brass + copper + dark iron materials, visible gears and steam pipes background,
gas lamp amber warmth, leather and wood textures, Victorian cast-iron architecture,
sepia-tinged photography feel, BioShock Infinite aesthetic,
no text, no watermark, 1:1 square
```

---

## 批量生成建議

1. **走 Kling Image O1**（如你已開通 VOD AIGC，這是最便宜路線）
   - 端點: `CreateAigcImageTask` (`vod.tencentcloudapi.com`)
   - 參數: `ModelName: "Kling"`, `ModelVersion: "O1"`, `Resolution: "1K"`
   - 每張預估 ~$0.028 USD，29 張總成本 ~$0.81
   - 建議每個風格生 4 張，挑最好的 1 張

2. **走 Midjourney v6.1**
   - 適合品質要求最高的情況
   - 每張勾上 `--ar 1:1 --style raw --stylize 200`
   - 成本較高但風格純度通常更穩

3. **跑完後的工作流**
   ```
   生成 4 張 → 用騰訊 AssessQuality 過濾（ClarityScore ≥ 70, AestheticScore ≥ 65）
   → 挑分數最高的 1 張 → 上傳 CDN → UPDATE visual_styles SET thumbnail_url = ?
   ```

4. **建議的 CDN 路徑命名**:
   ```
   https://your-cdn.com/style-thumbs/{styleId}.jpg
   例: https://your-cdn.com/style-thumbs/cinematic_realism.jpg
   ```
