# PolyFilm AI — 對標分析(深度版)

> 對標日期:2026-04-28
> 對標目標:`https://polyfilm.tech/`(中文短劇 AI 生成 SaaS)
> 採集範圍:Landing、Dashboard、Project Workspace、5 階段 Pipeline 全部、角色 / 場景庫、創建 Wizard

## 1. 一句話定位

**「對手只能做單鏡頭,我們做整部成片」**——強調工業化資產復用與全模型聚合,B2B 商業影視取向(廣告 + 多集短劇)。

## 2. 模型棧(關鍵)

**SeeDance 2.0(BYTEDANCE)+ Gemini 3 + GPT-Image 2 + Nano Banana Pro 一次訂閱整合**

預設用 SeeDance 2.0(從 dashboard 所有專案的 model badge 看)。

## 3. 商業包裝

| 維度 | PolyFilm |
|---|---|
| 痛點對比 | 傳統:3 周 + 8 萬人民幣 → AI:1 分鐘輸入 + 30 分鐘生產 + ¥80 起 |
| 註冊優惠 | 200 積分 |
| 退款 | 7 天無理由 |
| 商用 | 商用授權交付(內建) |
| 工作區 | Personal + Team workspace 雙模式 |

## 4. 後端架構線索

從錯誤訊息「**Edge Function returned a non-2xx status code**」可推測:**他們用 Supabase Edge Functions(或類似 serverless)而非 BullMQ-style 長任務 worker**。這是跟 KuiperAI 完全不同的路線。

## 5. 產品結構(完整骨架)

```
PolyFilm
├── Dashboard(/dashboard)
│   ├── Multi-workspace 切換器(Personal / Team)
│   ├── 5 大入口卡片:創建短劇 / 創建廣告 / 創建長劇 / 角色管理 / 場景素材庫
│   └── 我的項目列表(項目卡 + 新建項目)
│
├── 角色素材庫(/character-manager)
│   ├── Categories: 全部 / 人物 / 怪物 / 敵人 / 動物 / 機器人 / 奇幻 / 道具(8 類)
│   ├── 跨項目導入支持
│   ├── 按項目分組視圖
│   └── 搜尋(名稱、標籤)
│
├── 場景素材庫(/scene-manager)
│   ├── Categories: 全部 / 室內 / 室外 / 虛擬(3 類)
│   ├── 跨項目管理和復用
│   └── 按項目分組視圖
│
├── 創建項目 Wizard(/create-project?mode=drama)
│   ├── Step 1: 創意起點(5 種)+ 項目名稱 + 比例
│   ├── Step 2: 故事大綱(❓ 未深入,backend 失敗)
│   └── Step 3: 確認創建(❓ 未深入)
│
└── Project Workspace(/workspace/{projectId})
    ├── 總覽(項目資訊、故事設定、劇集大綱、項目設置、⚡一鍵生成、任務列表)
    └── 5 階段 Pipeline(門禁式)
        1. 劇本(Script)
        2. 角色(Characters)
        3. 場景(Locations)
        4. 故事板(Storyboard)
        5. 合成(Composition / 最終輸出)
```

## 6. 三大產品場景

| 場景 | 切入點 | 賣點 |
|---|---|---|
| **品牌廣告** | 上傳產品圖 + Logo | 30 秒生成專業廣告劇本、分鏡、成片;品牌資產自動注入 |
| **AI 短劇** | 一句創意 | 一晚做出整部短劇 |
| **多集長劇** | 故事大綱 / 小說 | 百集級別連續劇規劃,**角色與場景跨集一致** |

## 7. 創建流程

**Step 1:選擇創意起點**(5 種)
1. AI 靈感抽卡 — 隨機生成創意
2. 我有創意 — 文字描述(顯示「描述你的創意」textarea)
3. 上傳小說 — 文件改編
4. 上傳劇本 — 已有劇本製作
5. 空白項目 — 從零開始

**Step 1 同頁面同時設定**:
- 項目名稱
- 視頻比例:**16:9 橫屏**(YouTube/B站)/ **9:16 豎屏**(抖音/小紅書)

選擇「我有創意」會出現 idea description textarea(placeholder:詳細描述你的故事創意,包括類型、背景、主要角色和核心衝突),提示「描述越詳細,AI 生成的大綱越精準」。

**Step 2: 故事大綱** — 用戶提交後 AI 自動生成大綱,大綱可編輯(推測)
**Step 3: 確認創建** — 最終確認(推測)

## 8. 項目工作台核心能力

### 8.1 「⚡ 一鍵生成」門禁式 Pipeline(關鍵差異化)

5 卡片橫向 UI,每卡片獨立進度,**前一階段未完成則後一階段鎖定**:

```
[劇本 13/25] → [角色 0/25 🔒] → [場景 41/41 🔒] → [分鏡 48/65 🔒] → [視頻 0/65 ⚠失敗 8 🔒]
   生成中            鎖定               鎖定                 鎖定                    鎖定
```

關鍵實作細節:
- 每階段獨立計數,依集數 / 鏡頭數
- 失敗獨立追蹤(視頻顯示「失敗 8」)
- 鎖定狀態用 🔒 圖示明示
- 進度條與數字同時呈現

### 8.2 任務列表 + 批量生成 + 生產隊列

- **批量生成**:對 25 集一次下單
- **生產隊列**:獨立 queue 視圖
- **項目製作概覽**:展示這個項目實際產生 Credits 消耗的成員(team 計費維度)

### 8.3 故事板編輯器(Storyboard,Stage 4)

- 集為單位的水平 tabs(第 1 集~第 25 集)+ 「新建集」按鈕
- **「五要素導演法」提示詞寫作指南**(這是他們的 prompt 工程 IP,有可摺疊面板)
- 兩種建構方式:**手動添加段落** / **AI 生成敘事**
- 「禁止背景音樂」toggle(BGM 預設自動生成,可選擇關閉)
- 模型 badge:SeeDance 2.0

### 8.4 合成階段(Composition,Stage 5)

**多軌時間線編輯器** + 導出面板:

- **時間軸 tracks**:視頻軌、字幕軌(雙 track)
- **播放器**:prev / play / next / volume / fullscreen
- **集 tabs**:每集獨立合成
- **Right Panel**(雙 tab):
  - 字幕(Subtitles)
  - **導出(Export)** — 顯示分鏡數量、總時長、視頻就緒、待生成
- **下載視頻** + **下載分鏡** 兩種輸出
- **導出歷史**:版本管理,過往導出可重新下載

### 8.5 項目設置

- **視覺風格**(寫實風格 / 寫實與影視 / ...)
- **畫幅比例**:16:9 / 9:16
- **每集時長**:可調(範例:2 分鐘)
- **對話語言**:跟隨界面語言 / 指定

### 8.6 全域資產(跨項目復用)

**角色素材庫**:
- **跨項目導入**支持
- 8 大分類:全部 / 人物 / 怪物 / 敵人 / 動物 / 機器人 / 奇幻 / 道具
- 按項目分組視圖
- 搜尋名稱、標籤

**場景素材庫**:
- **跨項目管理和復用**
- 3 大分類:全部 / 室內 / 室外 / 虛擬
- 按項目分組視圖

## 9. 「為什麼是 PolyFilm」四項差異化

| 能力 | PolyFilm | 對手(Runway/Pika) |
|---|---|---|
| **工業化資產庫** | 角色、場景、物品**跨集復用**,長劇也保持一致性 | 每次重畫 |
| **全模型聚合** | SeeDance 2.0 + Gemini 3 + GPT-Image 2 + Nano Banana Pro 一次訂閱 | 單一模型限制 |
| **團隊工作區** | 共享積分、資產與 **BYOK 密鑰**,工作室級協作 | 僅個人帳號 |
| **可商用交付** | 字幕、配音、品牌資產、商用授權**一鍵打包** | 只輸出視頻 |

## 10. UI/UX 觀察

- **配色**:純黑底 + 紫橙漸層強調(類似 Linear / Vercel 風格)
- **底部 step nav 持久存在**:5 階段切換永遠可見
- **左側固定 icon sidebar**:總覽、劇本、角色、場景、故事板、合成快速跳轉
- **breadcrumb 一致性**:Workspace > Project > Stage 三層導航
- **批量操作為一級公民**
- **進度可視化**:每階段都有完成數字 + 進度條 + 失敗計數

## 11. 採集出處

- Landing:截自 polyfilm.tech 首頁(2026-04-28)
- Dashboard 結構:截自 /dashboard
- 角色 / 場景庫:截自 /character-manager 與 /scene-manager
- Project workspace + 5-stage pipeline:截自 /workspace/{projectId} 總覽
- Storyboard editor + 五要素導演法:截自 /workspace/{projectId} 故事板 tab
- 合成階段:截自 /workspace/{projectId} 合成 tab
- Wizard:截自 /create-project?mode=drama
