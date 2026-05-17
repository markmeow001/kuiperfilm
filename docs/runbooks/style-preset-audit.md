# Style Preset Audit & Manual QA Checklist

Generated: 2026-05-17T05:23:19.713Z
Total presets in picker: **22** across **6** categories.

Companion deterministic check: `tests/unit/style-profile/presets.test.ts` (179 structural invariants).
This document covers the visual half — does Tencent VOD actually render xianxia when you pick `cn-xianxia`?

## 0. Reproducible test recipe

To keep visual differences attributable to the preset (not the prompt), every preset should be tested with the SAME character + panel inputs:

**Test character profile** (paste into admin "新增角色" form):
```
name: 林夏
introduction: 28 歲女性，亞洲面孔，黑色及肩直髮，穿白色襯衫。職場 OL 設定。
visual_description: 亞洲面孔，黑色及肩直髮，柳眉杏眼，膚色偏白，身穿純白色襯衫搭配灰色西裝外套。氣質乾淨利落，30 歲左右。
```

**Test panel prompt** (paste into manual panel gen):
```
一個 28 歲女性，黑色及肩直髮，穿白色襯衫，坐在咖啡廳窗邊看書。室內柔光，傍晚時分。
```

**Per-preset steps:**
1. 開測試專案 → V2ProjectSettingsPanel → 「畫面風格」chip → 切到該 preset
2. 進角色頁 → 林夏 → 重新生成角色形象 → 等 30-60s
3. 進分鏡頁 → 任一 panel → 用上面的 panel prompt 觸發 panel image gen → 等 30-60s
4. 對照下面 §1 該 preset 的 zhDescription，眼判生圖是否吻合
5. 在該行的「Character image OK?」/「Panel image OK?」打勾或寫筆記
6. 撞 sensitive content / Tencent VOD 真人审核 timeout / 風格 leak 也記下來

預估時間：22 preset × 2 圖 × 60s + 觀察 ≈ 90-120 分鐘

## 1. Preset checklist (group by category)

### 寫實與影視 (`realistic`)

#### `realistic` — 寫實風格 (Realistic)

**zhDescription:**
> 影院級寫實攝影。自然皮膚紋理(毛孔/微細節),物理精準光照,柔影 + 體積霧 + 鏡頭效果(散景、色差)。真實材質。Arri Alexa 調色風格。

**Positive prompt (550 chars):**
```
real-life photograph captured on a DSLR full-frame camera, 35mm lens, cinematic photorealistic photography, natural skin texture with visible pores wrinkles freckles and micro imperfections, asymmetric realistic facial features, physically accurate lighting, soft shadows with volumetric fog, lens effects including bokeh and chromatic aberration, real-world materials (weathered wood, polished metal, woven fabric), subtle film grain, Arri Alexa color grading, documentary realism — NOT a 3D render, NOT CG, NOT game graphics, NOT a digital painting
```

**Negative prompt (501 chars):**
```
cartoon, anime, illustration, painted, digital painting, 3D render, CGI, CG render, computer graphics, game CG, video game style, Genshin Impact style, MiHoYo style, Honkai aesthetic, Pixar style, Disney animation, semi-realistic, anime realism, stylized character render, doll-like, porcelain skin, glossy plastic skin, perfectly symmetric face, idealized beauty, smoothed skin, airbrushed skin, plastic skin, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**Style reference images (photo anchor path — overrides text):**
- `period` → realistic-period: https://images.pexels.com/photos/19728893/pexels-photo-19728893.jpeg
- `modern` → realistic-modern: https://images.pexels.com/photos/33999354/pexels-photo-33999354.png
- `neutral` → realistic-neutral: https://images.pexels.com/photos/6642970/pexels-photo-6642970.jpeg

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `cyberpunk` — 賽博朋克 (Cyberpunk)

**zhDescription:**
> 賽博朋克霓虹黑色美學。霓虹粉/青/紫主導,深色背景。雨夜街面/鉻反射、全息 UI、LED 廣告。高對比黑 + 爆光霓虹。鏡頭光暈 + 色差。頹廢都市 × 高科技。

**Positive prompt (299 chars):**
```
cyberpunk neon noir aesthetic, neon pink cyan and purple dominant palette, dark background, rainy night street scenes with chrome reflections, holographic UI overlays, LED billboards, high contrast black with blown-out neon highlights, lens flare and chromatic aberration, dystopian city × high tech
```

**Negative prompt (177 chars):**
```
bright daylight, pastoral, vintage warm tones, ink painting, low contrast, washed out, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `steampunk` — 蒸汽朋克 (Steampunk)

**zhDescription:**
> 維多利亞蒸汽朋克工業風。黃銅/銅/暗鐵主材。可見齒輪、鉚接金屬板、蒸汽管。煤氣燈琥珀暖光。皮革 + 木質紋理。維多利亞鑄鐵建築 + 機械增強。蒸汽 + 煙霧氛圍。

**Positive prompt (268 chars):**
```
Victorian steampunk industrial style, brass copper and dark iron primary materials, visible gears and rivets and steam pipes, gas lamp amber warm glow, leather and wood textures, Victorian cast-iron architecture with mechanical augmentation, steam and smoke atmosphere
```

**Negative prompt (176 chars):**
```
futuristic neon, cartoon style, anime, photorealistic photography, modern minimalist, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

### 日系動漫 (`anime`)

#### `anime-classic` — 日系動漫 (Anime)

**zhDescription:**
> 經典日系賽璐珞動畫。1-2px 乾淨粗線,2-3 階 cel shading。大眼 + 詳細虹膜高光。簡化背景。頭髮乾淨色塊 + 銳利高光條。皮膚暖色平塗 + 微紅暈。

**Positive prompt (239 chars):**
```
classic Japanese cel-shaded animation, 1-2px clean line art, 2-3 step cel shading, large expressive eyes with detailed iris highlights, simplified backgrounds, clean color blocks with sharp hair highlights, warm flat skin with subtle blush
```

**Negative prompt (148 chars):**
```
photorealistic, photo, western comic ink, gritty texture, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `ghibli` — 吉卜力 (Ghibli)

**zhDescription:**
> 吉卜力手繪動畫。水彩感背景 + 筆觸可見。暖大地色 + 翠綠天藍。角色柔和圓潤,小巧細節眼。雲彩極致細節。建築充滿煙火氣(苔蘚牆、木紋)。光線永遠溫暖金色。

**Positive prompt (286 chars):**
```
Studio Ghibli hand-drawn animation, watercolor backgrounds with visible brush strokes, warm earth tones and emerald sky blue, soft rounded characters with small detailed eyes, exquisitely detailed clouds, lived-in buildings with moss walls and wood grain, eternally warm golden lighting
```

**Negative prompt (144 chars):**
```
photorealistic, neon, sharp digital edges, cyberpunk, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `anime-isekai` — 日漫異世界 (Isekai)

**zhDescription:**
> 日系異世界輕小說插畫。RPG 奇幻世界 + 魔法粒子 + 發光符文 + 技能光環。比標準動漫更精細。鮮艷飽和度,歐洲中世紀 × 魔法元素。狀態窗 / 物品欄 UI 美學。

**Positive prompt (247 chars):**
```
Japanese isekai light novel illustration, RPG fantasy world with magic particles and glowing runes and skill auras, more detail than standard anime, vibrant saturation, European medieval × magical elements, status window and inventory UI aesthetic
```

**Negative prompt (136 chars):**
```
photorealistic, low saturation, modern urban, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `anime-modern` — 動漫通用 (Modern Anime)

**zhDescription:**
> 標準日本動畫制作質量。京都動畫 / A-1 Pictures 級背景。明亮通透色調,2-3 階 cel 陰影。富表現力大眼 + 多層虹膜。頭髮乾淨色塊 + 高光。理想化藍紫陰影。

**Positive prompt (265 chars):**
```
standard Japanese animation production quality, Kyoto Animation and A-1 Pictures level backgrounds, bright translucent palette, 2-3 step cel shadows, expressive large eyes with multi-layer iris, clean hair color blocks with highlights, idealized blue-purple shadows
```

**Negative prompt (141 chars):**
```
photorealistic, gritty, oil painting, low quality, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `anime-urban` — 都市動漫 (Urban Anime)

**zhDescription:**
> 都市動漫 / 新海誠城市美學。極致細節現代日本城市(電線、自販機、車站)。戲劇化天空漸變(橙粉紫日落)。濕街霓虹反射。冷暖色溫過渡。電影感景深。

**Positive prompt (290 chars):**
```
urban anime / Makoto Shinkai cityscape aesthetic, ultra-detailed modern Japanese city with power lines and vending machines and train stations, dramatic sky gradients (orange-pink-purple sunset), wet street neon reflections, cool-warm color temperature transitions, cinematic depth of field
```

**Negative prompt (131 chars):**
```
pastoral, fantasy, low detail, flat sky, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `anime-school` — 校園卡通 (School Anime)

**zhDescription:**
> 日系校園動畫。櫻花粉 / 晴空藍 / 嫩草綠。明媚陽光 + 暖金邊光。校服細節 + 教室 + 操場。青春活力氛圍。聚焦角色表情。日常系柔和打光。

**Positive prompt (263 chars):**
```
Japanese school anime, sakura pink with sunny blue and tender grass green, bright sunshine with warm gold rim light, detailed school uniforms with classrooms and sports field, youthful energetic atmosphere, focus on character expressions, daily-life soft lighting
```

**Negative prompt (131 chars):**
```
dark, gritty, dystopian, photorealistic, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

### 國風 (`chinese`)

#### `cn-xianxia` — 國漫仙俠 (Xianxia)

**zhDescription:**
> 國漫仙俠修真美學。雲海 + 浮山 + 仙宮。配色:玉綠 / 仙白 / 神金 / 靈紫。飄逸絲綢長袍 + 風動。霧中丁達爾光柱。飛簷、龍柱。水墨遠景透視。

**Positive prompt (320 chars):**
```
Chinese cultivation xianxia aesthetic, sea of clouds with floating mountains and immortal palaces, color palette of jade green / immortal white / divine gold / spiritual purple, flowing silk robes with wind motion, Tyndall light shafts through fog, flying eaves and dragon pillars, ink wash distant landscape perspective
```

**Negative prompt (135 chars):**
```
cyberpunk, modern western, neon, low detail, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `cn-cartoon` — 國風卡通 (Chinese Cartoon)

**zhDescription:**
> 國風卡通。傳統中式元素 + 現代 CG 渲染。配色:朱紅 / 帝藍 / 金 / 墨綠。飛簷、雕梁畫棟。漢服 + 現代動畫上色。水墨意境 × 鮮艷動畫色。

**Positive prompt (239 chars):**
```
Chinese-style cartoon, traditional Chinese elements with modern CG rendering, vermilion / imperial blue / gold / ink green palette, flying eaves and carved beams, hanfu with modern animation coloring, ink wash mood × vivid animation colors
```

**Negative prompt (145 chars):**
```
photorealistic, western comic, sketch, low saturation, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `chinese-ink` — 古風水墨 (Sumi-e)

**zhDescription:**
> 古風水墨(國畫 / sumi-e)。濃淡墨色全譜。生宣紙紋理可見。書法筆觸 + 飛白。皴法描山石。大面積留白。偶現朱砂印章。禪意極簡構圖。

**Positive prompt (253 chars):**
```
classical Chinese ink wash (国画 / sumi-e), full ink tonal range, visible rice paper texture, calligraphy brush strokes with flying-white (飞白), axe-cut cliff strokes (皴法), large negative space, occasional vermillion seal stamps, zen minimalist composition
```

**Negative prompt (136 chars):**
```
photorealistic, neon, vibrant CG, full color, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

### 韓漫 (`korean`)

#### `korean-webtoon-fine` — 極細韓漫 (Webtoon)

**zhDescription:**
> 極細韓漫 webtoon。超精細變粗細線條。理想化美貌 + 自然身材比例。莫蘭迪高級配色 + 自然漸變。時尚前衛造型。柔和肖像光強調皮膚光澤。浪漫優雅構圖。

**Positive prompt (275 chars):**
```
ultra-fine Korean webtoon style, super-fine variable line weight, idealized beauty with natural body proportions, Morandi sophisticated palette with natural gradients, fashionable avant-garde styling, soft portrait lighting emphasizing skin glow, romantic elegant composition
```

**Negative prompt (145 chars):**
```
bold ink lines, american comic, anime, photorealistic, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `korean-historical` — 韓漫古裝 (Korean Historical)

**zhDescription:**
> 韓漫古裝。精繡韓服。宮殿庭院 + 韓式古建築。配色:緋紅 / 午夜藍 / 金箔。燭光 + 月光氛圍。裝飾邊框優雅構圖。韓劇史劇美學 + 理想化美人。

**Positive prompt (309 chars):**
```
Korean historical drama webtoon style, exquisitely embroidered hanbok, palace courtyards with Korean traditional architecture, palette of crimson / midnight blue / gold leaf, candlelight and moonlight atmosphere, decorative bordered elegant composition, Korean drama historical aesthetic with idealized beauty
```

**Negative prompt (143 chars):**
```
modern urban, cyberpunk, photorealistic photography, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `korean-urban` — 韓漫都市 (Korean Urban)

**zhDescription:**
> 韓漫都市 webtoon。當代時尚造型。豪華公寓 / 寫字樓 / 高端餐廳。配色:高級灰 / 商務藏青 / 乾淨白。商業攝影級打光。韓劇財閥美學。乾淨數字畫 + 微紋理。

**Positive prompt (290 chars):**
```
Korean urban webtoon, contemporary fashionable styling, luxury apartments and office buildings and high-end restaurants, sophisticated gray and business navy and clean white palette, commercial photography lighting, Korean drama chaebol aesthetic, clean digital painting with subtle texture
```

**Negative prompt (120 chars):**
```
historical, anime, cyberpunk, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

### CG 與 3D (`cg-3d`)

#### `pixar-3d` — 皮克斯3D (Pixar 3D)

**zhDescription:**
> 皮克斯 / 迪士尼 3D 動畫質量。皮膚次表面散射。圓潤討喜角色。專業影棚燈(邊光 + 柔和 AO)。誇張但可信比例。乾淨拋光表面。豐富飽和 + 互補色設計。溫暖氛圍。

**Positive prompt (281 chars):**
```
Pixar / Disney 3D animation quality, subsurface scattering skin, rounded appealing characters, professional studio lighting with rim light and soft AO, exaggerated but believable proportions, clean polished surfaces, rich saturated colors with complementary design, warm atmosphere
```

**Negative prompt (153 chars):**
```
photorealistic photography, anime cel shading, sketch, gritty, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `q-plush` — Q版毛絨英雄 (Q-Plush)

**zhDescription:**
> Q版 3-4 頭身毛絨玩偶 IP。可見針織/羊毛氈纖維 + SSS 膨皮。粗黑怒眉、翻白眼、蘋果腮紅、傲嬌撅嘴。場景沿用日系動漫通用美學。

**Positive prompt (206 chars):**
```
Q-style 3-4 head proportion plush IP, visible knit and wool felt fiber with SSS skin, bold angry brows / eye rolls / apple cheeks / tsundere pouty mouth, environments follow Japanese anime general aesthetic
```

**Negative prompt (128 chars):**
```
photorealistic, gritty, dark, mature, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `cg-epic` — CG史詩 (Epic CG)

**zhDescription:**
> AAA 電影級 CG,奇幻大片質量。PBR 超精細盔甲武器。戲劇化體積神光。配色:金 / 深緋 / 皇家藍。宏偉建築(教堂 / 王座廳 / 戰場)。電影海報英雄姿勢。UE5 級渲染。

**Positive prompt (279 chars):**
```
AAA cinematic CG fantasy blockbuster quality, PBR ultra-detailed armor and weapons, dramatic volumetric god rays, palette of gold / deep crimson / royal blue, grand architecture (cathedrals / throne rooms / battlefields), film poster heroic poses, Unreal Engine 5 level rendering
```

**Negative prompt (116 chars):**
```
cartoon, anime, low poly, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `cg-urban` — CG都市 (CG Urban)

**zhDescription:**
> CG 渲染現代都市。照片級 3D 建築(玻璃幕墻 + 鋼結構)。專業影棚燈(反射 + AO + GI)。豪華現代室內 + 高端材質。城市天際線 + 夜景。介於寫實與風格化之間,乾淨拋光。

**Positive prompt (280 chars):**
```
CG-rendered modern city, photorealistic 3D buildings (glass curtain walls and steel frame), professional studio lighting with reflection and AO and GI, luxurious modern interiors with premium materials, city skyline with night view, between realism and stylization, clean polished
```

**Negative prompt (123 chars):**
```
cartoon, anime, fantasy, gritty, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `game-cg` — 遊戲CG (Game CG)

**zhDescription:**
> 遊戲 CG 半寫實風格(原神 / 崩鐵美學)。介於寫實與卡通——非概念圖、非皮克斯。完美瓷感皮膚。僅面部輕度風格化(眼大 20-25%、柔下頜、小鼻)。頭髮眉毛真實絲感。身體寫實。

**Positive prompt (279 chars):**
```
game CG semi-realistic style (Genshin / Honkai aesthetic), between realism and cartoon — not concept art, not Pixar, perfect ceramic-like skin, slight facial stylization (eyes enlarged 20-25%, soft jawline, small nose), realistic hair and brow strands, realistic body proportions
```

**Negative prompt (140 chars):**
```
pure photography, anime cel shading, low quality, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

### 歐美與奇幻 (`western`)

#### `american-comic` — 美式漫畫 (American Comic)

**zhDescription:**
> 美式漫畫 / Marvel-DC 風。3-5px 粗黑墨線。動態透視 + 動作姿勢。本戴半調網點陰影。高飽和原色(紅 / 藍 / 黃)。荷蘭角 + 速度線。肌肉英雄比例。強明暗對比。

**Positive prompt (263 chars):**
```
American comic book style / Marvel-DC, 3-5px bold black ink lines, dynamic perspective with action poses, Ben-Day half-tone shading, high saturation primary colors (red / blue / yellow), Dutch angles with speed lines, muscular hero proportions, strong chiaroscuro
```

**Negative prompt (166 chars):**
```
photo, photorealistic, soft watercolor, blurry edges, muted pastel palette, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

#### `fantasy-cute` — 奇幻卡通 (Fantasy Cute)

**zhDescription:**
> 可愛奇幻卡通。柔和馬卡龍色(薰衣草 / 薄荷 / 桃)。圓潤角色 + 誇張可愛比例。魔法閃粉 + 光粒子。童話氛圍(蘑菇屋 / 水晶塔)。柔和漫射光(無硬影)。繪本插畫質感。

**Positive prompt (288 chars):**
```
cute fantasy cartoon, soft macaron palette (lavender / mint / peach), rounded characters with exaggerated cute proportions, magic sparkles with light particles, fairy tale atmosphere (mushroom houses / crystal towers), soft diffuse lighting (no harsh shadows), storybook illustration feel
```

**Negative prompt (143 chars):**
```
photorealistic, dark, gritty, mature, harsh shadows, low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs
```

**QA — 林夏 + 咖啡廳場景:**
- [ ] Character image matches zhDescription
- [ ] Panel image matches zhDescription
- [ ] No sensitive-content / timeout failures
- Notes: ___

---

## 2. Known watch-outs (from prior bug history)

- **`realistic`**: Kling-2.1 / 3.0-Omni's Genshin-CG training prior can leak through text-only anchors. We added `styleReferences` (3 photos covering period/modern/neutral) on 2026-05-13 to dominate via image attention. If output looks CG/painted instead of photographic, check worker log for `source:"styleReference"` to confirm the photo anchor was attached.
- **`chinese-ink` / `thick-paint`**: heavily painterly. Watch that Tencent VOD doesn't fall back to its realistic default when scene contains modern keywords (phone, car, etc.).
- **`korean-webtoon-fine`**: super-fine line work is hard for Tencent's default model — likely needs Kling Omni to render correctly. If output still looks anime, route the gen through the Omni provider.
- **`game-cg`**: deliberately between realism and Pixar. Easy to confuse with `realistic` if you don't compare side-by-side; the porcelain skin is the give-away.
- **Legacy `anime` / `thick-paint`** keys: hidden from picker but valid in DB; if a pre-2026-05 project still references them they should resolve (covered by `resolvePresetKeyByPositivePrompt` roundtrip test).

## 3. Tracking the result

When done, copy the filled-in checklist back into the project memory at:

`~/.claude/projects/-Users-joshhung/memory/project_kuiperfilm_style_preset_followups.md`

Or summarise pass/fail counts in chat — anything below ~18/22 passing means the preset catalog needs prompt-tuning before shipping more visual-style features.
