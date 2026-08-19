# Kuiperfilm 平台 UI／UX 升級計畫

日期：2026-08-08  
狀態：P0／P1 UI 完成，P2 待接線  
依據：`mmlone-kuiperfilm-platform-analysis.md`、`mmlone-uiux-audit-kuiperfilm-page-spec.md`

## 1. 產品目標

Kuiperfilm 不再以一組彼此分離的 AI 工具呈現，而是成為一套可追蹤的電影製作系統：

`專案 → 劇本 → 角色／場景／道具 → 分鏡 → 鏡頭 → 聲音 → 剪輯 → 交付`

現有生成能力先保留。第一輪只重整資訊架構、共用介面與工作流程，不改資料庫 schema，也不更換既有模型／計費／任務邏輯。

## 2. 視覺決策

2026-08-08 視覺 mockup 驗收後，決定採用單一「深色製片工作室」環境，而不是規劃頁／影像頁雙主題：

- Dashboard／Projects／New Project：夜藍灰畫布、深色內容面、深藍操作色。
- Screenplay：沿用深色工作室，但以較亮的內容面與更寬行距維持長文可讀性。
- Storyboard／Canvas／Video／Composite：沿用相同三層深色表面，媒體井可再降低明度。
- 黃金色只用於定版、核准與最終交付；不作主導覽色。
- Magenta 不再作新介面的主操作色；舊頁逐頁遷移，避免一次性破壞。

代表元素是「製片進度軌」：每個專案畫面都必須清楚顯示目前階段、已完成階段與下一步。

### 2.1 統一深色主題契約

新版介面不提供會讓跨頁色調漂移的工作情境主題，也不把所有區塊壓成同一片黑。所有 V2 頁面共用三層夜藍灰表面，工作性質只影響密度與媒體井明度，不再改變整體色相：

- **全域框架（Studio chrome）**：`#0D141B`，承載側欄、專案切換與帳號操作。
- **製片畫布（Canvas）**：`#070B0F`，作為所有 Dashboard、規劃與媒體頁底層。
- **工作表面（Surface）**：`#111B24`，承載主要表單、劇本與內容卡。
- **抬升控制（Raised）**：`#17232D`，承載導覽選取、Inspector、次級工具與 inset 區域。
- **工具與進度（Tool blue / process cyan）**：藍色 `#3E73B9` 表示主要操作，青色 `#55AFC0` 表示選取、時間線、進度與焦點。
- **定版與交付（Editorial brass）**：金色 `#C89432` 只表示核准、鎖定、定版與交付。
- **語義色**：成功、警告、錯誤必須搭配文字或 icon，不得只靠顏色區分。

字體角色維持克制：標題使用既有 heading family，正文使用 Geist／系統 CJK sans，鏡號、時間碼、版本與成本使用 mono。長文工作區以字級、行距、欄寬與表面明度建立閱讀性，不以淺色紙張製造例外。

跨頁一致性由固定深色框架與「製片進度軌」維持；主題不得改變任何資料狀態、權限或生成行為。

## 3. 三種 Shell

### Dashboard Shell

- Desktop ≥1280：272px 完整側欄。
- 1024–1279：76px 工具 rail。
- <1024：行動導覽。
- 適用：Projects、Assets、AI Lab、Workspace、Plans、Settings。

### Project Shell

- 全域導覽＋專案工具列＋製片進度軌。
- Desktop 顯示完整流程名稱；tablet 收成 icon rail。
- Mobile 顯示「上一階段／階段選擇／下一階段」，一次只處理一個任務。

### Editor Shell

- Desktop：Library／Canvas／Inspector／Timeline。
- Tablet：Library 與 Inspector 互斥 drawer。
- Mobile：Preview／Timeline／Media／Inspector task modes。

## 4. 共用 UI Contract

第一階段元件：

- `PageHeader`
- `StatusPill`
- `ProductionProgress`
- `StickyNextStep`
- `EntityListPanel`
- `GenerationComposer`
- `JobCard`
- `VersionGallery`
- `UiStatePanel`
- 現有 `Button`、`Card`、`Input`、`Field`、`Modal`、`Inspector` 的新版 token 適配

每個生成介面固定順序：

`Prompt → References → Style → Model → Ratio → Count → Advanced → Cost → Generate`

每筆生成工作固定狀態：

`Estimated → Queued → Running → Succeeded / Failed / Cancelled / Refunded`

## 5. 黃金路徑頁面

### P0：框架與狀態

- [x] Production tokens
- [x] Dashboard responsive rail
- [x] Project responsive rail
- [x] Mobile stage switcher
- [x] Projects 第一版
- [x] New Project 三步 wizard
- [x] 共用元件狀態展演頁
- [x] 1440／1280／1024／768／390 responsive QA

### P1：專案核心

- [x] Project Home＋Story Bible
- [x] Screenplay editor shell
- [x] Characters entity workstation
- [x] World／Locations entity workstation
- [x] Props entity workstation
- [x] Storyboard shell migration
- [x] Shot Builder shell
- [x] Voice shell migration
- [x] Clip Composer shell
- [x] Deliver shell migration

接線邊界：Project Home、Screenplay、Subjects、Storyboard、Voice、Deliver 沿用現有真實 API；Shot Builder 目前是 Storyboard 資料的唯讀鏡頭工作面，付費生成仍回到既有 Storyboard 入口；Clip Composer 已接真實分鏡媒體、預覽與時間線選取，split／trim／caption／effects／多軌儲存仍列入後續 API 工作。未接線能力在介面中明確標示，不會建立任務或產生成本。

### P2：追蹤與協作

- [ ] Generation Job Center
- [ ] Asset Version Compare／Lock／Approve
- [ ] Comments／Review drawer
- [ ] Public review link
- [ ] Branch Graph／Action Queue
- [ ] Notifications／Audit 統一狀態語言

### P3：平台生態

- [ ] Personal Assets 統一媒體庫
- [ ] Models／Usage／Billing／Settings
- [ ] Publish Center
- [ ] Community
- [ ] Public marketing pages

## 6. 全頁狀態矩陣

任何頁面不得只設計「成功且有資料」的狀態。至少必須定義：

- loading／first empty／filtered empty／partial
- dirty／saving／saved／offline
- stale dependency／permission denied／low credits
- estimated／awaiting confirmation／queued／running／failed／refunded
- invalid upload／destructive impact／session conflict
- locked／approved／rejected／needs changes／superseded／archived

狀態不能只靠顏色，必須有可讀文字、下一步與資料是否已安全保存的說明。

## 7. 驗收標準

- 1440、1280、1024、768、390px 無頁面級水平溢位。
- 200% zoom 仍能完成主要任務。
- Mobile touch target 最少 44×44px。
- Keyboard 可完成導覽、表單與主要操作。
- `prefers-reduced-motion` 不顯示非必要長動畫。
- H1 與主要 CTA 不互相擠壓。
- 所有生成前顯示模型、參考素材覆蓋與估計成本。
- 所有失敗顯示原因、資料保存狀態、退款狀態與可執行下一步。

## 8. 後端接線原則

UI contract 穩定後，才逐站補齊 Project Graph、Asset／Media Version、Timeline、Comment／Review、Branch 與 Publication。接線期間：

- 不製造假資料或靜默 fallback。
- 沒有 API 的操作顯示明確 unavailable／planned 狀態。
- 現有真實資料與 API 優先沿用。
- 每接一站，同步補 loading／empty／error／permission／stale／cost／job tests。
