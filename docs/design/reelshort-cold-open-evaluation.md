# ReelShort 8-Second Cold-Open 公式評估 + 整合計畫

**日期**: 2026-05-13
**來源**:
- 用戶分享: https://m.aitntnews.com/newDetail.html?newId=6155
- 用戶提供的 master prompt(Kling 3.0-Omni vertical micro-drama director)
- awesome-seedance-2-prompts repo
- AI Tool Curator Kling 3.0 cinematic guide
- Alibaba 官方 text-to-video prompt guide

---

## TL;DR

| 維度 | 結論 |
|---|---|
| **這公式好嗎?** | 對 ReelShort/DramaBox 原生英文短劇 ★★★★★ 已驗證爆款 |
| **適合 KuiperAI 嗎?** | **部分適合** — 開場用 ★★★★★ / 全劇用 ★★ |
| **建議用法** | **opt-in 模式**,只套在每集第 1 個 group(鉤子位置) |
| **不該用法** | 強制全劇所有 group 都跑 4-shot×2s 公式 |
| **整合工作量** | Phase 1 模板版 ~1 天 / Phase 2 LLM 版 ~3 天 |

**核心理由**:這公式的精髓是「**模型最穩定的場景組合**」(2 角色鎖定 / 1 靜態室內 / 1 句畫外音 / push-in 到震驚臉)— 對 Kling 來說容易,因此爆款率高。但**犧牲了戲劇豐富度**換來執行可靠性。對「8 秒鉤子」這個高轉化關鍵時刻是正確 tradeoff;對「整集 30-60 秒劇情」會變得機械無聊。

---

## 1. 公式拆解

### 結構(8s = 4 shots × 2s)

```
Shot 1 (0-2s):  Wide establishing       — 場景設立
Shot 2 (2-4s):  Medium / character intro — 主角環境鎖定
Shot 3 (4-6s):  Over-shoulder / dialogue — 對話發生
Shot 4 (6-8s):  Slow push-in to STUNNED FACE — 反轉揭露
```

### 4 個 AI 不會幻覺的條件

來自 Alici AI 的「Secret Billionaire Reveal」master prompt 拆解:

1. 兩個鎖定的角色(我們已實作:`element_list`)
2. 一個靜態的室內場景(避免 Kling 仙俠/CG 偏見)
3. **一句畫外音**(不需要對口型)
4. 對著一張震驚的臉慢推(Kling 表現最穩的鏡頭運動)

### 證據強度

- 《The Double Life of My Billionaire Husband》在 ReelShort 跑出 5 億+ 觀看
- 這條 8 秒結構撐起 ReelShort 12 億美元生意
- 公式對 Seedance 2.0 / Sora 2 / Veo 3.1 / Hailuo 02 / **Kling** 都實測穩定

---

## 2. 跟 KuiperAI 平台對齊度分析

### ✅ 完美對齊的部分(5 點)

| 公式要求 | KuiperAI 現狀 |
|---|---|
| 2 角色鎖定 | `element_list` + SubjectInfos 3 槽位已 ship(2026-05-13) |
| 英文 prompt 風格詞 | STYLE_HEADER 全英文化 + LIGHTING/MOTION 具體詞已 ship |
| 反向錨(NOT animation, NOT CG) | STRICT 子句已 ship |
| 畫外音不動嘴 | OS/VO 偵測 + `Voiceover (off-camera)` wrapper 已 ship(本輪) |
| Push-in / slow dolly | `CAMERA_MOVE_TO_EN` 已映射 |

**意義**:本平台**底層能力**已完整支援這套公式,不缺技術底盤。

### ⚠️ 部分對齊(3 點)

| 公式要求 | KuiperAI 現狀 | 缺什麼 |
|---|---|---|
| 4 shots × 2s 固定結構 | 多鏡頭 group 數量浮動(2-6 鏡),時長依對白動態 | 一個 "強制 4×2s" 的 opt-in 模式 |
| Wide / Medium / OS / Push-in 鏡頭序列 | LLM 切組時不主動編排鏡頭類型 | shot director(模板或 LLM) |
| ElementList 雙角色 + 1 場景 | 全自由(0-3 角色,任意場景) | UI 提示「鉤子建議 2 主角 + 1 室內景」 |

### ❌ 不對齊的部分(5 點 — 這些是公式的天生限制)

#### 1. 中文古裝/仙俠的開場節奏不同

ReelShort 公式是針對「**現代都會 billionaire / 偽身份 / Cinderella**」這種劇情寫的。冷開場的 4 shot 假設:
- 主角是 working-class 女主
- 場景是現代室內(diner / 公寓 / 辦公室)
- 對話揭露對方的「真實身份」是大富翁
- 慢推到震驚臉

我們平台的劇本主流是**古裝仙俠**(王玄、洞府、修真)。古裝開場常用的鉤子是:
- 災劫降臨(雷 / 妖獸 / 異變)— 動作戲開場,不是對話
- 仙人下凡 / 飛劍登場 — 視覺奇觀,push-in 不合適
- 朝堂議事 — 多人對話,2 主角不夠
- 重生回到過去 — 時間軸跳躍,單一場景不夠

**結論**:現代劇開場 100% 套公式 / 古裝開場需要**仙俠變體**(下面提供)。

#### 2. 整集 30-60 秒不可能全是 4-shot×2s

ReelShort 完整集約 1-2 分鐘(垂直短劇),由 5-8 個 8 秒 chunk 拼成。每個 chunk 都用相同公式 = 高度機械感。

實際的 ReelShort 是:
- 第 1 個 chunk(0-8s)→ cold-open 公式(用)
- 第 2 個 chunk(8-16s)→ 對白堆疊,中景反打
- 第 3 個 chunk(16-24s)→ 場景轉換 + 推進
- ...

我們的 group 結構**已經符合這個分塊邏輯**,只是欠缺「第 1 個 group 特殊化」的能力。

#### 3. 短劇對話量大於 8s 時公式破功

公式假設 1 句畫外音 + 1 句反差揭露 = 大約 4-6 秒對白。但實際短劇對話常常一個 group 內就有:
- 主角 OS 內心想法
- 配角質問
- 主角回應
- 配角反應

對白驅動時長下,一個 group 可能會被 chunker 拆成 2-3 個 Kling call(我們已實作 multi-Kling chunker)。這時 cold-open 公式會被打散,變不出 push-in。

#### 4. ReelShort 公式假設「靜態室內」

「沒有人群、沒有追逐」是公式的硬條件 — Kling 對群眾鏡頭與追逐戲表現差。但我們的劇本不可控:
- 城牆攻防(古裝)
- 仙宗大典(多人)
- 朝堂(20+ 群演)
- 機場追逐(現代)

如果硬套公式,worker 必須**裁切群眾鏡頭** — 但這會跟原劇本不符,user 會抱怨「跟我寫的不一樣」。

#### 5. 用戶劇本控制權 vs 模板強制

KuiperAI 設計哲學:**user 寫什麼 → 平台儘量遵守**(已實作的對白語言鎖定、per-shot LLM 意圖 > episode binding 都是這個邏輯)。

但 ReelShort 公式本質是「**LLM 重寫劇本以匹配模板**」。這跟「保留 user 原意」哲學衝突。

**結論**:必須做成 **opt-in**,讓 user 自己決定哪個 group 套公式。

---

## 3. 建議的整合策略

### 命名

UI 顯示: **「冷開場鉤子模式 / ReelShort Cold-Open」**
內部識別: `coldOpenMode: 'off' | 'modern' | 'period' | 'action'`

### 套用範圍(預設)

```
Episode 1 / Group 1 → 預設 ON(opt-out)
其他所有 group   → 預設 OFF(opt-in)
```

理由:第一集第一個 group **就是 8 秒鉤子**,這是 ReelShort 公式精準命中的位置。其他位置 user 自由選。

### 三個 genre 變體

#### A. Modern Drama Variant(原版公式)
```
Shot 1: Wide establishing — 現代室內(咖啡廳 / 公寓 / 辦公室)
Shot 2: Medium shot — 主角在環境中,日常動作(擦桌 / 工作)
Shot 3: Over-shoulder — 對方角色入鏡,1 句 dialogue
Shot 4: Slow push-in to STUNNED FACE — VO 揭露身份秘密
```

#### B. Period / Cultivation Variant(古裝變體)
```
Shot 1: Wide establishing — 古裝室內或仙俠外景(洞府 / 宮殿 / 山巔)
Shot 2: Medium character reveal — 主角立於景中,袍角飄動
Shot 3: Over-shoulder or close-up dialogue — 對方 / VO 道出衝突
Shot 4: Slow push-in to STUNNED / DETERMINED FACE — 主角覺醒 / 震怒 / 立誓
```

仙俠關鍵差異:
- 第 4 shot 的「震驚臉」變成「覺醒臉 / 決絕臉」(更符合古裝戲劇 archetypes)
- 場景允許野外(山 / 雲海 / 古道)但需要靜態構圖
- 服裝紋理 / 飄動感入 visualModifiers

#### C. Action / Reveal Variant(動作 / 災劫變體)
```
Shot 1: Wide establishing — 異變降臨的環境(雷雲 / 戰場 / 廢墟)
Shot 2: Mid-action close — 主角動作中(揮劍 / 結印 / 起身)
Shot 3: Quick whip-pan or rack-focus — 災劫主體現身
Shot 4: Slow push-in to STUNNED / SHOCKED FACE — 主角反應
```

注意:Kling 對快速運鏡(whip-pan / rack-focus)穩定度較低 — 這個變體仍保留 push-in 作為最後一鏡。

### 共同硬規則(三個變體都遵守)

1. **8 秒整數**: 嚴格 4 shots × 2s,不可被對白驅動拆散
2. **2 角色上限**: 入鏡角色不超過 2 個(降低 Kling identity confusion)
3. **室內或單一外景**: 不允許多場景切換(group 內 panel.location 必須相同)
4. **1 句 voice-over**: 鎖定一句 OS / VO 作為情緒鉤子
5. **第 4 shot 必須是 push-in**: 不可換鏡頭運動

---

## 4. 整合架構(三階段)

### Phase 1: 模板版(機械 reformat)— ~1 天

最簡單最快,完全 frontend:

```ts
// GroupCard.tsx
const coldOpenMode = isFirstGroupOfEpisode && episodeGenre === 'modern'
  ? 'modern' : 'off'

function buildColdOpenNarrative(): string {
  // 取 group 內的 panel,機械分配到 4 個 shot slot:
  //   shot1 = panels[0] reformatted as wide establishing
  //   shot2 = panels[1] reformatted as medium intro
  //   shot3 = panels[2] reformatted as over-shoulder + first dialogue
  //   shot4 = synthesize push-in to stunned face + last dialogue as VO
  return [
    STYLE_HEADER_REALISTIC,
    'HOOK: 8-second cold open, 4 shots × 2 seconds, ReelShort vertical drama format.',
    `Shot 1 (0-2s): Wide establishing — ${reformatToWide(panels[0])} ${PER_SHOT_STYLE_TAG}`,
    `Shot 2 (2-4s): Medium shot — ${reformatToMedium(panels[1])} ${PER_SHOT_STYLE_TAG}`,
    `Shot 3 (4-6s): Over-shoulder — ${reformatToOverShoulder(panels[2], firstDialogue)} ${PER_SHOT_STYLE_TAG}`,
    `Shot 4 (6-8s): Slow push-in to STUNNED FACE — ${reformatToStunnedFace(panels[3], lastVO)} ${PER_SHOT_STYLE_TAG}`,
  ].join('\n\n')
}
```

**優點**:
- 零 LLM 成本
- 確定性 output
- 可立即 ship

**缺點**:
- reformat 函數是純字串拼接,沒辦法理解語意 → 「reformatToWide」實際上只是把 panel.description 加個 "Wide establishing shot of ..." 前綴,不會聰明地砍掉細節
- 古裝 / 動作變體效果差,因為機械模板無法判斷劇情類型

### Phase 2: LLM Shot Director 版 — ~3 天

加一個 server endpoint,用 user 提供的 master prompt 模板呼叫 LLM:

```
POST /api/novel-promotion/[projectId]/cold-open-rewrite
Body:
  groupId, episodeId, coldOpenMode ('modern' | 'period' | 'action')
Response:
  {
    shots: Array<{ index, prompt, duration: 2 }>,
    negativePrompt: string,
    aspectRatio: '9:16',
    durationTotal: 8
  }
```

實作:
1. 把 user 提供的 master prompt(那個 `You are a vertical micro-drama prompt director` template)作為 system prompt
2. 注入 group 的 panels / characters / scene / dialogues / preset
3. 用戶選的 coldOpenMode 決定 modern/period/action variant
4. LLM 回 4-shot JSON
5. Cache 結果到 DB(`NovelPromotionPanel.coldOpenShotJson` 新欄位?或新表)
6. GroupCard 顯示 LLM rewrite 後的 shot,user 可以再 edit
7. 提交時 worker 直接讀這個 JSON 餵 Kling customize mode

**優點**:
- 真正理解劇情語意
- 三個 genre variant 共用同一個 LLM call,只換 variant constraint
- LLM 可以聰明地把 user 寫的長 panel 砍成 push-in 適合的短句

**缺點**:
- 每次 cold-open submit 多一次 LLM call(~3-5 秒延遲)
- LLM 偶爾不照模板,需要 schema validation + fallback
- 成本(每集第一個 group 一次 = 每集 1 次 LLM call,可接受)

### Phase 3: Genre 自動偵測 — ~1-2 天

讓 LLM 在 analyze-novel 階段就標 episode genre:
- `NovelPromotionEpisode.genreHint: 'modern' | 'period' | 'action' | 'mixed'`
- coldOpenMode 不需要 user 手動選,自動 derived from genre

---

## 5. 風險

### 風險 1: 模型 variance

Kling 對「STUNNED FACE」的詮釋有時會崩成 horror movie 表情。需要在 negative prompt 加 `not horror, not exaggerated grimace`。

### 風險 2: Genre 標籤錯誤

如果 LLM 把古裝劇標成 modern,出來的鉤子會用咖啡廳當「wide establishing」。需要 user override + UI 提示。

### 風險 3: Cold-open 套上去之後 user 抱怨「不像我寫的」

預設 opt-out 而不是 opt-in?**建議:第一集第一個 group opt-IN(預設啟用),其他全 opt-OUT(預設停用)**。第一集第一個 group 是高轉化關鍵點,user 通常願意接受平台優化。

### 風險 4: 對白驅動 vs 固定 8s 衝突

對白超過 8 秒時 cold-open 模式怎麼處理?三選一:
- A. 強制拆對白,只保留前 8 秒分配給的 1 句 VO
- B. 跳過 cold-open mode 退回 dialogue-driven(顯示 warning)
- C. 自動延長到 12s(4 shots × 3s)

建議 **A**:cold-open 鉤子本來就是「精煉到 1 句 hook」,後面用第 2 個 group 接續完整對白。

---

## 6. 我推薦的 ship 順序

1. **驗證本輪 P0a + P0b**(對白進敘事 + OS 不動嘴)— 你正在做
2. **Phase 1 模板版 cold-open**(1 天)— modern variant only
   - UI 第一個 group 顯示「冷開場鉤子模式 ON / OFF」toggle
   - 模板機械 reformat panels[0..3]
   - 先讓 user 看到效果,看是否值得繼續做 LLM 版
3. **驗證 Phase 1 效果**: 隨機 5 個專案套上去,看畫面 vs 不套對比
4. **Phase 2 LLM 版**(3 天)只有當 Phase 1 verified positive
   - 加 endpoint + master prompt + Period / Action variant
5. **Phase 3 genre auto-detect**(1-2 天)當 Phase 2 verified positive

每階段都有 verify gate,避免投入大量工程進去後發現公式不適合中文古裝。

---

## 7. 等你決定的事

| 問題 | 選項 |
|---|---|
| 鉤子套用範圍預設 | (a) 全部 opt-in / (b) **第一集 1 group opt-in(推薦)** / (c) 第一集全部 opt-in |
| Modern / Period / Action 三變體 | (a) Phase 1 只做 modern / (b) **Phase 1 三個都做模板(推薦)** / (c) Phase 2 才做 period+action |
| LLM model for shot director | (a) 用 admin 預設 chat model / (b) 固定走 cheap model(Gemini 3 flash 或 Hunyuan-lite) / (c) **走跟 analyze-novel 同一個 model** |
| 是否允許 user 編輯 LLM output | (a) Read-only / (b) **可編輯(narrativeDirty 模式,推薦)** |

回我這 4 題 + 「Phase 1 直接開始」就可以動工。

---

## 8. 結論

ReelShort 公式**核心思想是對的**(配合 Kling 短板,做 LLM 不會崩的場景組合),但**不能無腦套**(會殺死劇本豐富度)。

**正確姿勢**:把它當作「**開場鉤子 mode**」精準套用在每集 0-8 秒的最高轉化位置,其他 group 維持你已經建好的「對白驅動 + 自由結構」flexible 架構。

兩條路線並存:
- **鉤子 mode**(高度結構化)= 抓眼球
- **flexible mode**(對白驅動)= 講劇情

像 ReelShort 真實做法一樣:第 1 個 chunk 用公式硬抓人,後面 chunk 才講故事。
