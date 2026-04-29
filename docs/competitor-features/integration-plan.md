# KuiperAI 整合建議:對標分析 → 具體實施計畫

> 整理日期:2026-04-28
> 來源:`polyfilm.md`、`lumenx.md`、`localminidrama.md`、`_summary.md`
> 對應 codebase 勘查:`prisma/schema.prisma`、`src/app/[locale]/workspace/`

---

## 0. 重要發現:你的核心需求,**schema 已經支援了**

你提到的:

> 「**最重要的功能是劇集,我要像 polyfilm 一樣可以建置一個劇,每個劇裡面去增加集數,同一個劇當中共用角色跟場景**」

這個需求,**你目前的資料模型已經支援**。看現況:

```
Project(這就是「劇」/show)
├── name, description, mode = 'novel-promotion'
└── novelPromotionData: NovelPromotionProject(1:1)
     ├── videoRatio (9:16 / 16:9)
     ├── targetDuration、artStyle、各種 model 設定
     │
     ├── episodes[]: NovelPromotionEpisode  ← 集數,每個有 episodeNumber
     │    ├── name、description、novelText
     │    ├── audioUrl + srtContent
     │    ├── clips[]、shots[]、storyboards[]、voiceLines[]
     │    └── editorProject: VideoEditorProject(視頻合成)
     │
     ├── characters[]: NovelPromotionCharacter  ← 角色,Project-scoped
     │    ├── 跨所有 episodes 共用 ✅
     │    ├── appearances[]: CharacterAppearance(多個形象變化)
     │    └── sourceGlobalCharacterId(從全局角色庫複製來的話會記)
     │
     └── locations[]: NovelPromotionLocation  ← 場景,Project-scoped
          ├── 跨所有 episodes 共用 ✅
          ├── images[]: LocationImage(多張場景圖,可選 selectedImage)
          └── sourceGlobalLocationId
```

加上**全局資產中心**(跨 Project 復用):

```
User
├── globalAssetFolders[]: GlobalAssetFolder(一層資料夾)
├── globalCharacters[]: GlobalCharacter
│    └── appearances[]: GlobalCharacterAppearance
├── globalLocations[]: GlobalLocation
│    └── images[]: GlobalLocationImage
└── globalVoices[]: GlobalVoice(全局音色)
```

**結論**:資料模型上,你已經有「劇 → 集 → 共用角色/場景」的結構,還比 PolyFilm 多了「全局音色(GlobalVoice)」。

## 1. 真正的差距:在 UI / 體驗層,不在 schema

對照 PolyFilm 的 dashboard,你**還沒做或做得不到位**的是:

### 1.1 入口 / 命名

PolyFilm Dashboard 5 大入口:
```
創建短劇 / 創建廣告 / 創建長劇 / 角色管理 / 場景素材庫
```

你目前:`Project` 概念存在,但**創建入口沒有區分「短劇 vs 長劇 vs 廣告」**。`mode` 欄位有(`novel-promotion`)但只有一種類型。

### 1.2 集 (Episode) 第一級可見性

PolyFilm Project Workspace 一進去:
- 大標題寫劇名
- 25 集 badge、9:16、爱情、年轻女性 tag
- 故事設定、劇集大綱獨立區塊
- ⚡ 一鍵生成 5 階段門禁卡片

你目前(從 `StageNavigation.tsx` 看):
- 5 階段 nav:`config → assets → storyboard → videos → voice`
- 接受 `episodeId` URL param
- **但「集」概念在 UI 是當參數而不是當主軸**

### 1.3 沒有道具(Prop)概念

| 對手 | 道具支援 |
|---|---|
| PolyFilm | 角色庫底下「道具」分類 |
| LumenX | first-class asset(Step 3 Assets) |
| LocalMiniDrama | first-class step(Step 5 道具生成) |
| **KuiperAI** | **沒有** ❌ |

schema 沒有 `Prop` / `NovelPromotionProp` model,沒有 `GlobalProp`。

### 1.4 風格 lock(正向/負向 prompt)弱

你的 `artStyle` 是固定 enum(`american-comic` 等),`artStylePrompt` 是 free text。**沒有正向 + 負向兩段式結構**(LumenX 標準做法)。

### 1.5 角色一致性沒到「三視圖」結構

你有 `CharacterAppearance.appearanceIndex` + `imageUrl`(s),但**沒有結構化的「全身像 / 三視圖 / 頭像特寫」分離**。LumenX 的方法:
- `fullBodyUrl` ← 主 reference
- `threeViewUrl` ← 三視圖,適合不同角度
- `portraitUrl` ← 頭像特寫,適合近景對白

### 1.6 視頻沒有版本歷史

`NovelPromotionPanel.videoUrl` 是單一 URL,沒有版本管理。LocalMiniDrama 的「視頻歷史 + 主版本選擇」沒有。

### 1.7 一鍵生成門禁式 Pipeline UI 沒做

你有 `graph_runs` 後端基礎設施,但**前端沒有 PolyFilm 那種「劇本 13/25 → 角色 0/25 🔒」的可視化卡片**。

### 1.8 多起點創建 wizard 缺

PolyFilm 的 5 種起點(AI 抽卡 / 我有創意 / 上傳小說 / 上傳劇本 / 空白)→ 你目前可能只有 1-2 種。

## 2. 推薦 Phase 11 路線圖(最契合你的需求)

把上面的差距對應到具體 Phase 子任務,**優先級依「你的主要需求」排序**。

### Phase 11.1 「劇 → 集」UI 第一公民化 ⭐⭐⭐ [你的核心需求]

**目標**:讓「Project = 劇」、「Episode = 集」在介面上明確,跟 PolyFilm 一樣直覺。

**子任務**:

```markdown
- ⏸ 任務:Project 詳情頁加「集列表」主視圖
  - 文件:`src/app/[locale]/workspace/[projectId]/page.tsx`
  - 邏輯:進到 project 第一眼看到所有 episodes 的 grid / list
  - 可加新集(目前可能藏在某個地方)
  - 顯示每集進度(劇本完成?分鏡完成?視頻完成?)
  
- ⏸ 任務:Episode 切換器在 workspace header 永久存在
  - 文件:`src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/WorkspaceHeaderShell.tsx`
  - 邏輯:類似 PolyFilm 故事板的 tab(第1集 / 第2集 / ...),所有階段都能切集
  
- ⏸ 任務:Project 層級設定獨立區塊
  - 顯示:videoRatio、targetDuration、artStyle、各種 model 配置
  - 集會繼承這些設定,但每集可 override
  - 仿:PolyFilm 項目設置區塊
```

**驗收**:
- 進到 project 看到一個 dashboard,寫著「劇名」+ N 集 + 角色 N 個 + 場景 N 個
- 點一集進去做 stage workflow,header 能輕鬆切其他集
- 「新增集」一鍵搞定

### Phase 11.2 角色 / 場景跨集共用 UX 強化 ⭐⭐⭐ [你的核心需求]

**目標**:「同一個劇當中共用角色跟場景」實際上已經有資料層,但要讓使用者**看得見、用得到**。

**子任務**:

```markdown
- ⏸ 任務:Project 層級的「角色面板」+「場景面板」
  - 文件:`src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/ProjectAssets.tsx`(新)
  - 邏輯:不論在哪集,都能看到該 project 所有角色 / 場景
  - 操作:新增、編輯、刪除、從全局庫複製進來
  
- ⏸ 任務:Episode-Character / Episode-Location 顯式關聯
  - 目前:characters / locations 是 project-scoped,episodes 透過 panels.characters / panels.location 文字欄位間接引用
  - 改善:加 junction table `EpisodeCharacter`、`EpisodeLocation`
  - 用途:能查「Character A 在哪幾集出現」,「Episode 5 用了哪些角色」
  
- ⏸ 任務:從全局庫一鍵導入角色 / 場景
  - 文件:`src/app/api/projects/[projectId]/import-character/route.ts`(若沒有)
  - 邏輯:選一個 GlobalCharacter,複製成 NovelPromotionCharacter,並把 sourceGlobalCharacterId 標好
  - UI:「從資產中心導入」按鈕
```

**驗收**:
- Project 詳情頁有獨立的「角色 / 場景」分頁
- 在 Episode 1 加一個角色,Episode 2 自動看得到、可選用
- Junction table 能跑 query:`SELECT episodes WHERE character_id = X`

### Phase 11.3 道具(Props)first-class asset ⭐⭐ [補對手共有功能]

```markdown
- ⏸ 任務:新增 NovelPromotionProp + GlobalProp 模型
  - 文件:`prisma/schema.prisma`
  - 結構參考既有 `NovelPromotionLocation` + `LocationImage`
  - migration:新表 + 新欄位
  
- ⏸ 任務:UI 加「道具」分頁(跟角色 / 場景並列)
  - 文件:延伸 ProjectAssets.tsx
  - Categories(對標 PolyFilm):武器 / 物品 / 載具 / 特殊
  
- ⏸ 任務:劇本實體提取要包含道具
  - 文件:`lib/prompts/novel-promotion/agent_storyboard_*.{zh,en}.txt`
  - 改 prompt:輸出 characters + locations + **props** 三類
  - 文件:`src/lib/workers/handlers/analyze-novel.ts`、`analyze-global.ts`
  
- ⏸ 任務:Panel 可綁定道具 reference
  - 文件:`prisma/schema.prisma`(NovelPromotionPanel 加 propIds 欄位)
  - 圖片生成 prompt 自動拉道具 reference
```

### Phase 11.4 角色三視圖結構化 ⭐⭐ [跨集一致性核心]

對標 LumenX 的具體技術。

```markdown
- ⏸ 任務:CharacterAppearance / GlobalCharacterAppearance 加結構化視圖
  - 文件:`prisma/schema.prisma`
    - 加欄位:fullBodyUrl、fullBodyMediaId、threeViewUrl、threeViewMediaId、portraitUrl、portraitMediaId
  - 或新表:CharacterReferenceSet,讓一個 appearance 有一組三視圖
  
- ⏸ 任務:角色生成流程改成兩步
  - Step 1: 生「無背景全身圖」
  - Step 2: 用全身圖當 reference,生三視圖 + 頭像
  - 文件:`src/lib/workers/handlers/character-profile.ts`、`character_image_to_description`
  
- ⏸ 任務:storyboard / panel 生成自動帶上對應 reference
  - 邏輯:當 panel 涉及 Character A,picture prompt 自動 inject character A 的最適 reference(主鏡頭用三視圖,近景對白用頭像)
```

### Phase 11.5 風格 lock(正向 + 負向)⭐⭐ [LumenX 借鑑]

```markdown
- ⏸ 任務:Project 加 styleProfile JSON
  - 文件:`prisma/schema.prisma`(NovelPromotionProject 加 stylePositivePrompt + styleNegativePrompt + styleReferenceImages)
  - 或新表:`StyleProfile`(可被多 project 引用)
  
- ⏸ 任務:全片所有 image generate / video generate 自動 inject style
  - 文件:`src/lib/ai-runtime/`(image / video adapter 加 styleProfile 參數)
  
- ⏸ 任務:UI 風格設定面板
  - 內建幾個 preset(寫實 / 美漫 / 動漫 / 厚塗)
  - 可自定義 positive + negative
  - 可上傳 reference image 當風格錨點
```

### Phase 11.6 一鍵生成門禁式 Pipeline UI ⭐ [PolyFilm 借鑑]

```markdown
- ⏸ 任務:Project 詳情頁底部加 PipelineGate 元件
  - 文件:`src/app/[locale]/workspace/[projectId]/components/PipelineGate.tsx`(新)
  - 邏輯:根據既有 graph_runs / NovelPromotionEpisode 進度,呈現 5 階段卡片
  - 規則:前階段未完成,下階段鎖定
  - 一鍵生成 = 觸發批量 run
```

### Phase 11.7 視頻版本管理 ⭐ [LocalMiniDrama 借鑑]

```markdown
- ⏸ 任務:Panel video 改成多版本
  - 文件:`prisma/schema.prisma`(新表 PanelVideoVersion,1:N from Panel)
  - 欄位:versionId、videoUrl、createdAt、isMain、prompt、modelUsed
  
- ⏸ 任務:UI 縮略圖條帶切換主版本
  - 文件:Panel 編輯區
  
- ⏸ 任務:合成階段用當前 main 版本
  - 文件:`src/lib/workers/handlers/...`(合成 worker)
```

### Phase 11.8 解說旁白 ↔ 對白分離 ⭐ [LocalMiniDrama 借鑑]

```markdown
- ⏸ 任務:NovelPromotionPanel 加 narration 欄位
  - 與既有 voiceLines(對白)分離
  
- ⏸ 任務:storyboard prompt 同時要求兩種輸出
  - 文件:`lib/prompts/novel-promotion/agent_storyboard_*.{zh,en}.txt`
  
- ⏸ 任務:TTS 流程支援雙軌
  - 旁白用獨立旁白音色(GlobalVoice 中標 type='narrator')
  - 字幕導出可選只導對白 / 只導旁白 / 全部
```

## 3. 怎麼把這個寫進 master plan

打開 `docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md`,在最後加一段:

```markdown
# Phase 11: 競品對標功能補完(基於 docs/competitor-features/ 分析)

## 11.1 「劇 → 集」UI 第一公民化(P0)
[從上方範本複製]

## 11.2 角色 / 場景跨集共用 UX 強化(P0)
[從上方範本複製]

...
```

或叫 Claude 自己做這件事:進 claude code 後 `/sync-master-plan` 並指示「把 docs/competitor-features/integration-plan.md 的 Phase 11 內容加進 master plan」。

## 4. 給你的 Top 5 建議(濃縮)

如果只挑 5 件事,順序這樣最契合你的核心需求:

| # | 項目 | 為什麼 | 估時 |
|---|---|---|---|
| 1 | **Phase 11.1 「劇 → 集」UI 第一公民化** | 你的主要需求,改 UI 沒改 schema,風險低 | 1-2 週 |
| 2 | **Phase 11.2 角色 / 場景跨集共用 UX** | 同上,把既有 schema 用好 | 1-2 週 |
| 3 | **Phase 11.4 角色三視圖** | 跨集一致性的核心技術,做了競爭力大幅提升 | 2-3 週 |
| 4 | **Phase 11.5 風格 lock** | 投入小、效果大、LumenX 已開源 | 1 週 |
| 5 | **Phase 11.3 道具** | 三家對手都有,你沒有,補齊基本盤 | 1-2 週 |

**Phase 11.6 / 11.7 / 11.8** 是 nice-to-have,看時間。

## 5. 風險提醒

- **11.2 加 junction table** 涉及 schema migration,要寫 migration playbook,既有資料(`panels.characters` text 欄位)要轉換到 junction table
- **11.3 道具**新增 model 影響 prompt → 影響既有測試,範圍大
- **11.4 三視圖**改變既有 character generation pipeline,要全面 review
- **11.7 視頻版本**會改 video URL 引用方式,合成 worker 要全改

## 6. 我建議的下一步

選一條走:

### 路線 A:慢慢來,先驗證設計
1. 你先 review 這份計畫,告訴我哪些 Phase 砍 / 加 / 改順序
2. 我把確認的版本寫進 `docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md`
3. 你進 claude code 跑 `/continue`,Claude 從 Phase 11.1 開始做

### 路線 B:直接動手,Phase 11.1 先試水溫
1. 直接讓 Claude 用 plan mode 設計 Phase 11.1 的具體實作
2. 你看完計畫拍板
3. Claude 派 implementer 寫
4. 一週後 review 成果,決定是否續做 11.2

### 路線 C:先做最小驗證
1. 直接做 Phase 11.5 風格 lock(最小改動,驗證流程)
2. 順帶把 sub-agent 隊伍跑一輪,確認 orchestrator pattern 沒問題
3. 再進 11.1 / 11.2 大工程

我建議 **路線 C**:第一輪用低風險任務 debug 你的 Claude Code 自主流程,確認 sub-agent 隊伍運作正常,再上重頭戲。

要哪一條?
