# Alibaba LumenX Studio — 對標分析

> 對標日期:2026-04-28
> 對標目標:`https://github.com/alibaba/lumenx`
> 性質:**阿里巴巴官方開源專案**(MIT License)
> 採集範圍:GitHub README 完整內容

## 1. 一句話定位

**「AI 短漫劇一站式生產平台,從劇本分析到視頻合成的完整創作鏈路。」**

Render Noise into Narrative — 阿里官方背書,主打「將小說文本轉化為動態視頻」。

## 2. 技術棧

| 層 | 技術 |
|---|---|
| Frontend | Next.js 14 + React 18 + TypeScript + Tailwind CSS |
| Backend | FastAPI + Python 3.11+ |
| AI Logic | Alibaba Cloud Qwen |
| AI Visuals | Alibaba Cloud Wanx(萬相) |
| Render | Three.js (Canvas) + FFmpeg |
| 啟動 | `start_backend.sh` + `npm run dev` |

**重要差異**:KuiperAI 走 Next.js + Node 全棧 + Tencent + 多 provider;LumenX 是 Next.js 前端 + **Python FastAPI 後端**,純綁阿里雲 Qwen + Wanx。

## 3. 核心 6-Step SOP

```
1. Script(剧本)
   ↓ 提取实体(角色/场景/道具)
2. Art Direction(风格定调)
   ↓ 正向/負向提示詞
3. Assets(资产生成)
   ↓ 角色全身圖→三視圖+頭像特寫
4. StoryBoard(分镜图故事版)
   ↓ AI 提示詞潤色
5. Motion(分镜视频生成)
   ↓ i2v / r2v 雙模式 + multi-batch 抽卡
6. Assembly(分镜视频拼接)
   ↓ 選最佳 + Merge & Proceed
最終影片
```

## 4. 核心亮點(對 KuiperAI 高啟發)

### 4.1 角色一致性的具體技術實作 ⭐⭐⭐

> 「對於角色而言,為了保持角色在不同場景的一致性,**採用先生成人物的無背景全身圖,再基於該全身圖作為參考圖生成對應的三視圖、頭像特寫**作為該角色的核心資產,後續若涉及到更換服裝、形態,皆可以沿用該全身照或三視圖進行二次圖像編輯得來。」

這是 PolyFilm「跨集一致性」核心 IP 的**具體可實作技術**:
- Step A: 先生成「無背景全身圖」
- Step B: 以全身圖為 reference,生成「三視圖 + 頭像特寫」
- Step C: 後續所有分鏡都用這組資產作為 reference
- Step D: 換裝 / 變型 → 用全身照或三視圖二次編輯

**這是 KuiperAI 應該照抄的具體做法。**

### 4.2 正向 / 負向提示詞風格 lock

每個風格是由一組 **正向 + 負向 prompt** 組成,在 Step 2 確定後,後續所有生成環節都遵守,**建立全局統一的視覺標準**。

KuiperAI 目前沒有這個概念。

### 4.3 i2v vs r2v 雙模式

- **i2v(image-to-video)**:從首幀圖驅動 → 逐分鏡生成
- **r2v(reference-to-video,萬相 2.6 系列)**:用角色 / 場景 / 道具的**參考視頻**驅動

「**萬相 2.6 系列支持參考生視頻,所以此處也可以為每個角色、場景、道具生成參考視頻。**」

KuiperAI 目前可能只有 i2v 思路,這個 r2v 路線值得評估(看 SeeDance 2.0 與其他模型是否支援)。

### 4.4 Multi-batch 抽卡 + 人工選最佳

「**該階段支持多 Batch Size 生成的抽卡機制,可在 Step 6 針對每個分鏡進行最終分鏡視頻的選取。**」

機制:
- 每個分鏡同時跑 N 個 batch(不同 seed / 略不同 prompt)
- 全部完成後進 Step 6,人工挑最佳
- 點 Merge & Proceed 一鍵拼接成片

### 4.5 提示詞潤色助手

> 「該階段融入 AI 提示詞潤色能力,可以直接利用 Qwen-Plus 對現有提示詞進行潤色,**已嵌入圖像編輯的提示詞指南作為最佳實踐**。」

每個生成階段都有「提示詞潤色」按鈕,內建最佳實踐 prompt 範本。

### 4.6 Local-first 媒體存儲

「**所有上傳/生成媒體都會先寫入 output/,作為穩定項目數據源。OSS 是可選鏡像與簽名 URL 服務,不是必選前置依賴。**」

策略:
- Local-first(寫到 `output/`)
- OSS 是 optional mirror,不是 dependency
- 提供 4 種運行模式:DashScope-only / DashScope+OSS / +Kling vendor-direct / +Vidu vendor-direct

對比 KuiperAI 的 `STORAGE_TYPE=local|cos|r2`,概念相同但 LumenX 把 cloud 設計成 mirror 而非 primary。

## 5. 介面預覽推測(README 描述)

從用戶手冊與 GitHub README 描述,核心介面有:
- **拖拽式分鏡編輯器**(visual storyboard editor)
- **角色 / 場景 / 道具編輯面板**
- **參考圖選擇器**(分鏡綁定哪些 character / scene / prop refs)
- **提示詞潤色按鈕**(每個 prompt 旁)

## 6. 對 KuiperAI 的具體 takeaways

| Takeaway | 優先級 | 預估難度 |
|---|---|---|
| **角色全身圖 → 三視圖 + 頭像特寫**結構化 reference 庫 | P0 | 高 |
| **正向 / 負向 prompt** 風格 lock | P0 | 中 |
| **道具(props)作為 first-class asset** | P1 | 中 |
| **Multi-batch 抽卡 + 人工選最佳** | P1 | 中 |
| **每個 prompt 旁的「潤色」按鈕** | P2 | 低 |
| **Local-first + OSS mirror** 策略 | P2 | 中(已部分實作) |
| **r2v(reference-to-video)模式** | P2 | 高(看 model 是否支援) |
| **Art Direction 全局風格設定**獨立 step | P1 | 中 |

## 7. 為什麼這個 repo 特別有價值

1. **阿里官方背書**:`alibaba/` 命名空間,代表大廠認證的最佳實踐
2. **MIT License**:可以直接讀 source code 學實作
3. **完整 README + 用戶手冊 + API 文件**:文件成熟度高
4. **Python 後端**:跟 KuiperAI 的 Node.js 不同,但邏輯可移植

## 8. 不該抄的

- **整體技術棧切換**:KuiperAI 已經是 Next.js + Node + BullMQ,不要為了抄 LumenX 切到 FastAPI
- **綁阿里雲 Qwen + Wanx**:KuiperAI 已經多 provider,保留多元
- **Three.js Canvas 編輯器**:可考慮但不是必要,Remotion 已經能做很多事
