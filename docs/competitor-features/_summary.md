# KuiperAI 對標總體分析與戰略建議

> 整理日期:2026-04-28
> 對標對象:PolyFilm AI、Alibaba LumenX、LocalMiniDrama
> 詳細個別分析參見:`polyfilm.md`、`lumenx.md`、`localminidrama.md`

---

## 1. 三家對手定位光譜

```
封閉雲端 SaaS                     開源工具
─────────┼─────────────────┼─────────────►
PolyFilm AI       LumenX(阿里)       LocalMiniDrama
B2B 商業影視       開源 + 阿里雲綁定     本地 + 多 provider
高定價,工作室級      MIT,FastAPI 後端   MIT,Electron 桌面
        │
        └─ KuiperAI 應該定位在這附近(SaaS + 多 provider + 多 storage)
```

**KuiperAI 的差異化空間**:
- **位置**:在 PolyFilm 的成熟 SaaS 與 LocalMiniDrama 的 power-user 工具之間
- **優勢**:技術成熟度(已有完整 BullMQ + LangGraph + 30+ guards)、多 provider、雙 storage(local/cos/r2)
- **劣勢**:目前缺乏「跨集一致性」、「道具」、「正向/負向風格 lock」等業界已成形的核心功能

## 2. 三家共同的核心架構模式

不論是封閉 SaaS(PolyFilm)還是開源工具(LumenX、LocalMiniDrama),核心都是**門禁式 N-stage pipeline**:

```
故事/劇本 ─► 實體提取(角色/場景/道具) ─► 風格設定 ─► 資產生成 ─► 分鏡 ─► 視頻 ─► 合成
```

差別只在 stage 切分粒度:

| 對手 | Stage 數 | Stage 切分 |
|---|---|---|
| PolyFilm | 5 | 劇本 → 角色 → 場景 → 故事板 → 合成 |
| LumenX | 6 | Script → Art Direction → Assets → Storyboard → Motion → Assembly |
| LocalMiniDrama | 8 | 故事 → 劇本 → 角色 → 場景 → 道具 → 分鏡 → 圖/視頻 → 合成 |

**結論**:KuiperAI 應該採用 **6-7 stage**(在三家中間,平衡細緻度與管理複雜度)。

## 3. 三家共同的核心功能(必有)

把三家共同強調的列出來,這些是「**做這類產品的最低門檻**」:

| 功能 | PolyFilm | LumenX | LocalMiniDrama | KuiperAI 現況 |
|---|---|---|---|---|
| 多 stage 門禁 pipeline | ✅ | ✅ | ✅ | ⚠️ 部分(graph_runs 有但 UI 沒做) |
| 角色一致性(reference image) | ✅ | ✅ | ✅ | ⚠️ 有 character-reference 但不確定多強 |
| 場景庫 | ✅ | ✅ | ✅ | ⚠️ 部分 |
| 16:9 / 9:16 比例切換 | ✅ | (推測有) | ✅ | ❌ |
| 多集 / 分集管理 | ✅ | ✅ | ✅ | ⚠️ 有 episode_split 但不確定有完整 UI |
| 字幕生成 + 導出 | ✅ | ✅ | ✅ | ⚠️ 部分 |
| 批量生成 | ✅ | ✅ | ✅ | ❌ |
| 失敗重試 | ✅ | (推測) | ✅ | ✅(BullMQ 內建) |
| 從多種起點創建(劇本 / 小說 / 創意) | ✅ | ⚠️ | ✅ | ⚠️ |

## 4. 三家差異化亮點(可選)

哪些**只有部分對手有,且做得好**——KuiperAI 可以策略性挑選:

| 功能 | 來源 | 評分(對 KuiperAI 戰略價值) |
|---|---|---|
| **正向/負向 prompt 風格 lock** | LumenX | ⭐⭐⭐⭐⭐ 直接可移植,效益大 |
| **角色全身→三視圖→頭像**結構化 reference | LumenX | ⭐⭐⭐⭐⭐ 解決「跨集一致性」的具體技術 |
| **道具(prop)作為 first-class asset** | LumenX + LocalMiniDrama | ⭐⭐⭐⭐ 增加敘事豐富度 |
| **解說旁白與對白分離** | LocalMiniDrama | ⭐⭐⭐⭐ 對 TTS / 字幕體驗大幅提升 |
| **視頻版本歷史 + 主版本選擇** | LocalMiniDrama | ⭐⭐⭐⭐ 抽卡機制完整化 |
| **multi-batch 抽卡** | LumenX | ⭐⭐⭐⭐ 同上 |
| **批量補全 + 智能跳過已完成** | LocalMiniDrama | ⭐⭐⭐⭐ 大幅提升 UX |
| **i2v vs r2v 雙模式** | LumenX | ⭐⭐⭐ 看 model 支援度 |
| **跨項目角色 / 場景 / 道具庫** | PolyFilm + LocalMiniDrama | ⭐⭐⭐⭐ workspace 級資產復用 |
| **連貫幀模式** | LocalMiniDrama | ⭐⭐⭐ 過場優化 |
| **Team Workspace + BYOK** | PolyFilm | ⭐⭐⭐ B2B 訴求,看商模 |
| **三大產品場景模板**(廣告/短劇/長劇) | PolyFilm | ⭐⭐⭐ 採納門檻降低 |
| **「全能模式」+ @圖片N 語法** | LocalMiniDrama | ⭐⭐ 適配多參考圖 model |
| **四宮格序列圖** | LocalMiniDrama | ⭐⭐ 細節優化 |
| **工程 ZIP 導出/導入** | LocalMiniDrama | ⭐⭐ 對 SaaS 不那麼必要 |
| **「五要素導演法」prompt 框架** | PolyFilm | ⭐⭐ 可學概念,名稱要改 |

## 5. 推薦 Phase 11+ 路線圖

把上面的 takeaways 整理成 KuiperAI master plan 可吸收的 Phase 11~14 結構:

### Phase 11: 核心一致性能力(2-4 週,最高優先)

**目標**:讓 KuiperAI 達到三家對手的「跨集 / 跨鏡頭一致性」基礎水準。

```markdown
## Phase 11.1 角色 reference 三視圖系統 [P0, 高難度]
- ⏸ 任務:角色 asset 結構化(全身像 → 三視圖 → 頭像特寫)
  - 文件:`prisma/schema.prisma`(GlobalCharacterAsset 新欄位:fullBodyUrl、threeViewUrl、portraitUrl)
  - 文件:`src/lib/character-library/three-view-generator.ts`(新)
  - 邏輯:全身像生成完成後,自動觸發 3 個 sub-task 生三視圖 + 頭像
  - 整合:後續分鏡生成,自動帶上對應 reference image
- 驗收:同角色在 N 集視覺一致(人類 review)

## Phase 11.2 風格 lock(正向/負向 prompt) [P0, 中]
- ⏸ 任務:Project 層級加入 styleProfile
  - 文件:`prisma/schema.prisma`(Project.styleProfile JSON)
  - 文件:`src/lib/style-profile/`(新模組,positive + negative prompt 管理)
  - 整合:每次 image / video generate 自動 inject style profile
- 驗收:全片畫風統一

## Phase 11.3 道具(Props)first-class asset [P0, 中]
- ⏸ 任務:道具作為獨立 entity,跟角色 / 場景並列
  - 文件:`prisma/schema.prisma`(GlobalProp 新表)
  - 文件:`src/lib/prop-library/`(新模組)
  - 整合:劇本實體提取要包含道具;分鏡可綁定道具 reference
- 驗收:能從劇本自動提取道具並生成圖片

## Phase 11.4 場景 reference + 跨集一致性 [P0, 中]
- ⏸ 任務:場景 asset 同樣結構化
  - 文件:延伸既有 location library
  - 邏輯:同場景跨集用同一個 reference
- 驗收:同場景跨集視覺一致
```

### Phase 12: Pipeline UX 升級(2-3 週)

```markdown
## Phase 12.1 一鍵生成門禁式 Pipeline UI [P0, 中]
- ⏸ 任務:利用既有 graph_runs 做門禁式 pipeline 視圖
  - 文件:`src/app/[locale]/workspace/[projectId]/components/PipelineGate.tsx`
  - 邏輯:5-7 階段橫向卡片,每階段獨立進度 + 失敗計數,前未完成下一階段鎖定
  - 仿:PolyFilm「⚡一鍵生成」UI

## Phase 12.2 批量生成 + 補全模式 [P0, 中]
- ⏸ 任務:批量任務 + 智能跳過已完成
  - 文件:`src/app/api/runs/batch/route.ts`(新)
  - 文件:`src/lib/workers/handlers/batch-dispatcher.ts`(新)
  - 邏輯:detect already-done 跳過,只跑缺失部分
  - 仿:LocalMiniDrama「補全並生成」

## Phase 12.3 視頻版本歷史 + 主版本選擇 [P0, 中]
- ⏸ 任務:每個分鏡視頻保留所有歷史版本
  - 文件:`prisma/schema.prisma`(ShotVideoVersion 新表)
  - UI:縮略圖條帶,點擊切換 main version
  - 整合:合成階段用當前選定 main version
  - 仿:LocalMiniDrama「視頻歷史記錄與主視頻選擇」+ LumenX multi-batch 抽卡
```

### Phase 13: 創建 / 輸入體驗(1-2 週)

```markdown
## Phase 13.1 多起點 wizard [P1, 中]
- ⏸ 任務:5 種創建起點(AI 抽卡 / 我有創意 / 上傳小說 / 上傳劇本 / 空白)
  - 文件:`src/app/[locale]/workspace/[projectId]/create/page.tsx`(新)
  - 仿:PolyFilm 創建流程

## Phase 13.2 比例與時長設定 [P1, 低]
- ⏸ 任務:Project 加 aspectRatio + episodeDurationSec
  - 文件:`prisma/schema.prisma`
  - 文件:`src/remotion/...`(composition 接收 aspectRatio)
  - 仿:PolyFilm + LocalMiniDrama 都有

## Phase 13.3 三大場景模板 [P2, 中]
- ⏸ 任務:廣告 / 短劇 / 長劇 prompt template 分組
  - 文件:`lib/prompts/scenarios/{ad,drama,series}/*.{zh,en}.txt`
  - 仿:PolyFilm 三大場景
```

### Phase 14: 進階 / 差異化(看商模決定)

```markdown
## Phase 14.1 解說旁白與對白分離 [P0, 中]
- ⏸ 任務:Storyboard 分鏡同時有 narration + dialogue 兩個欄位
  - 文件:`prisma/schema.prisma`(Shot 加 narration 欄位)
  - 文件:`lib/prompts/novel-promotion/agent_storyboard_*.{zh,en}.txt`(prompt 同時要求兩種)
  - TTS:旁白用旁白音色,對白依角色分配
  - 字幕導出:可選擇導對白 / 旁白 / 全部

## Phase 14.2 跨項目資產庫(workspace-scoped) [P1, 高]
- ⏸ 任務:角色 / 場景 / 道具庫從 project-scoped 升級為 workspace-scoped
  - 文件:`prisma/schema.prisma`(加 workspaceId)
  - migration:現有 project-scoped 資料轉換
  - 仿:PolyFilm + LocalMiniDrama

## Phase 14.3 提示詞潤色助手 [P2, 低]
- ⏸ 任務:每個 prompt 旁加「✨ 潤色」按鈕
  - 文件:`src/components/PromptPolisher.tsx`(新)
  - 後端:用 LLM 改寫 + 加入最佳實踐 hint
  - 仿:LumenX

## Phase 14.4 連貫幀模式 [P2, 高]
- ⏸ 任務:相鄰分鏡的最後幀 ↔ 下一鏡首幀關聯
  - 仿:LocalMiniDrama

## Phase 14.5 接更多 provider [P2, 中]
- ⏸ 任務:火山引擎(Volcengine / Doubao)、可靈(Kling)、Vidu
  - 文件:`src/lib/ai-runtime/providers/`(新增 vendor)
  - 走 capability catalog,不 hardcode
```

## 6. 我會這樣安排接下來 6-8 週

如果只能挑 **5 件事先做**,順序是:

1. **Phase 11.1 角色三視圖系統** — 核心差異化,沒這個就只是換包裝
2. **Phase 12.1 門禁 Pipeline UI** — 產品感大幅提升,使用者立刻有感
3. **Phase 11.2 風格 lock** — 投入小、效果大、技術直接可移植自 LumenX
4. **Phase 12.3 視頻版本管理** — UX 質的飛躍
5. **Phase 14.1 解說旁白分離** — 字幕 / TTS 體驗從及格到優秀

第 6-10 件:
6. Phase 12.2 批量補全
7. Phase 11.3 道具
8. Phase 13.1 多起點 wizard
9. Phase 13.2 比例切換
10. Phase 14.2 workspace 級資產庫

**Phase 14.3 / 14.4 / 14.5** 是長尾,看時間決定。

## 7. KuiperAI 既有的優勢(別忘了)

對標完不要妄自菲薄,KuiperAI 已經有的東西**比三家對手強**:

| 優勢 | KuiperAI | 對手狀況 |
|---|---|---|
| **架構成熟度** | LangGraph + MySQL Checkpointer + 30+ guard scripts | LumenX 是初版,LocalMiniDrama 純 JS,PolyFilm 是 SaaS 黑盒 |
| **測試覆蓋** | 完整 vitest 行為測試 + behavior guard | LumenX / LocalMiniDrama 看不出測試文化 |
| **多 provider** | OpenAI / Google / OpenRouter / Fal | LumenX 只有阿里 |
| **多 storage** | local / COS / R2 | LumenX 只有 OSS |
| **i18n 雙語** | 完整 zh + en prompt | 對手主要中文 |
| **Tencent VOD 整合** | 是 | 對手沒有 |
| **計費系統** | BILLING_MODE 完整實作 | LumenX / LocalMiniDrama 沒談 |

**結論**:KuiperAI 的工程地基比對手紮實,缺的是**產品功能完整度**。Phase 11~14 補完功能 + 維持工程紀律,有機會打贏。

## 8. 風險提醒

- **Phase 11.1 跨集一致性是最高風險**:做不好就只是另一個 single-shot 工具,做好了是核心競爭力。先做 spike(2-3 天小實驗)驗證 reference image 強度
- **Phase 14.2 schema migration 風險高**:workspace 級資產庫會動到既有資料,要有完整的 migration playbook
- **不要為了抄而抄**:有些功能(如 LocalMiniDrama 的全能模式 + @圖片N 語法)是針對特定 video model 設計,如果 KuiperAI 不接那個 model 就不需要
- **法律風險**:不要直接抄 PolyFilm 的命名(「五要素導演法」、「視頻方案編輯器」等),用自己的命名

## 9. 下一步建議

1. **你 review 這份報告** — 看哪些 Phase 你不同意 / 想砍 / 想加
2. **跑一個 spike** — 拿 KuiperAI 既有的 character-reference pipeline 試「角色三視圖」概念,看可行性多高
3. **更新 master plan** — 確認後把 Phase 11~14 寫進 `docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md`
4. **跑 `/continue`** — 讓 Claude 開始做第一個子任務(建議從 Phase 11.2 風格 lock 開始,風險小、學經驗)
