# O · Responsive Breakpoints + Component Boundaries

> **目標：** UX Architect H-5 抓出「全 36 mockup 零 @media query」是嚴重危機；M-6 抓出「13-narrative-editor 1075 行單檔太大」實作會撞牆。本文件統一斷點 + 拆 13 為 8 個 sub-component 邊界。
>
> **狀態：** v1 · 2026-05-30
> **依賴：** L-component-inventory.md / tokens.css / 36 mockup
> **適用範圍：** Foundation Phase（Week 1-2）就要把 breakpoint token 進 tokens.ts

---

## 0. TL;DR

| 任務 | 數量 |
|---|---|
| 斷點 token | 5 個（xs / sm / md / lg / xl）|
| 響應式策略 page-by-page | 36 mockup × 4 breakpoint = 144 個 layout 決策 |
| 13-narrative 拆 | 8 個 sub-component（從 1,075 行 → 8 × ~150 行）|
| 08-storyboard 拆 | 7 個 sub-component（~860 行 → 7 × ~120 行）|
| 36/37/38 workspace 拆 | 各 4-5 個 sub-component |
| 共用 layout primitive | 6 個（AppShell / Sidebar / Drawer / TopBar / Stepper / Footer）|

---

## 1. 斷點 token

### 1.1 進 tokens.css → tokens.ts

```typescript
// src/lib/tokens.ts
export const breakpoints = {
  xs: '0px',        // 手機直
  sm: '480px',      // 手機橫
  md: '768px',      // tablet 直
  lg: '1024px',     // tablet 橫 / 小 laptop
  xl: '1440px',     // desktop
  '2xl': '1920px',  // 大螢幕（4K downscale）
} as const;

export const media = {
  xs: '@media (min-width: 0px)',
  sm: '@media (min-width: 480px)',
  md: '@media (min-width: 768px)',
  lg: '@media (min-width: 1024px)',
  xl: '@media (min-width: 1440px)',
  '2xl': '@media (min-width: 1920px)',
  // 反向
  belowMd: '@media (max-width: 767px)',
  belowLg: '@media (max-width: 1023px)',
  // 高度（控制小螢幕）
  shortViewport: '@media (max-height: 700px)',
  // 觸控偵測
  touch: '@media (hover: none) and (pointer: coarse)',
  hover: '@media (hover: hover) and (pointer: fine)',
};
```

### 1.2 Mobile redirect 規則（V2 既有，明文化）

| viewport | UA 偵測 | 行為 |
|---|---|---|
| < 768px | 手機 UA | middleware 自動 redirect `/m/*` 對應頁 |
| < 768px | tablet 直（iPad）| 保留桌面版（V2 已避開）|
| < 768px | desktop UA + 視窗縮小 | 觸發 responsive layout，不 redirect |
| ≥ 768px | 任何 | 桌面版 |

cookie `kp_view=desktop` 可強制；MobileRevertBanner 提供。

---

## 2. 全站 layout 4 mode

### 2.1 Mode

| Mode | viewport | sidebar | inspector | content cols |
|---|---|---|---|---|
| `mobile` | < 768px | drawer（漢堡）| bottom sheet | 1 col |
| `compact` | 768-1023px | icon-only rail 56px | popover | 1-2 col |
| `comfort` | 1024-1439px | 240px fixed | 380px right | 2-3 col |
| `wide` | ≥ 1440px | 280px fixed | 420px right + spacing | 3+ col |

### 2.2 AppShell primitive

```tsx
<AppShell
  sidebar={<ProjectSidebar />}
  topBar={<WsTopBar />}
  inspector={inspector}     // optional 右欄
>
  {children}
</AppShell>
```

內部自動切 4 mode；child 不用知道斷點細節。

---

## 3. 每頁響應式策略（36 mockup）

> **格式：** 每行 `mobile / compact / comfort / wide` 的 column layout。

### 3.1 公開層

| Mockup | mobile | compact | comfort | wide | 備註 |
|---|---|---|---|---|---|
| 01 landing | 1 col stack | 1 col + hero | hero + 3-col feature | hero + 4-col feature | hero 影片 lazy |
| 05 pricing | 1 col 卡片 | 2 col | 4 col matrix | 4 col matrix | 月/年 toggle 永遠上方 |
| 19 auth | 1 col form | 1 col form | 480 form + 1fr brand | 同 | 480 以下 brand canvas 隱藏 |
| 31 public-share | 1 col + nav 收起 | 1 col + sticky player | player + sidebar | 同 wide + comment 拉開 | OG meta SEO |
| 32 discover | 1 col grid | 2 col | 3 col grid + filter | 4 col grid | infinite scroll |

### 3.2 創作流

| Mockup | mobile | compact | comfort | wide | 備註 |
|---|---|---|---|---|---|
| 02 home | sidebar drawer + 1 col project | sidebar 56px + 2 col | sidebar 240 + 3 col | 同 + 4 col | redirect /m/home if phone UA |
| 06 script-input | 1 col stack（form 全寬）| 1 col | 1fr + 380 settings | 同 | dropzone touch 友善 |
| 07 pre-generation | 1 col stack | 1 col + cards | 1fr + 380 confirm | 同 | 統計卡 mobile 2x2 grid |
| 13 narrative | 1 col + drawer rosters/inspector | rosters 56px + content + inspector popover | 280 + content + 380 | 320 + content + 420 | 雙視圖切換永遠頂端 |
| 08 storyboard | 1 col panel list + drawer | timeline + panel detail full | timeline + preview big + inspector | 同 wide + extra spacing | 拖曳 touch 友善 |
| 23 voice | 1 col line list | line list + preview | list + voice picker drawer | list + voice picker + preview | 音頻播放器固定底部 |
| 24 render | 1 col queue | queue + progress | progress hero + queue | 同 + cross-browser badge | SSE 進度 |
| 25 final | 1 col player | player + actions | player + sidebar + publish | 同 wide | player aspect ratio 動態 |

### 3.3 劇集設定

| Mockup | mobile | compact | comfort | wide | 備註 |
|---|---|---|---|---|---|
| 15 character | drawer list + full edit | rail 56 + edit + appearance | sidebar 280 + edit + appearance 380 | + extra | drawer 從左滑進 |
| 16 location | 同 15 | 同 15 | 同 15 + views 3 col grid | 同 + 4 col | views/variants 切 tab |
| 17 prop | 同 15 | 同 15 | 同 15 | 同 | holder 綁定 mobile 用 modal |

### 3.4 系統

| Mockup | mobile | compact | comfort | wide | 備註 |
|---|---|---|---|---|---|
| 18 admin | 1 col KPI 卡 | 2 col KPI + table | 6 KPI + table | 同 + chart | force studio-dark |
| 20 workspace | drawer list + member detail | tab + list | sidebar + member table | 同 | tab: members / general / models / audit / edit-requests |
| 28 settings | 1 col | tab + form | sidebar + form | 同 | profile/lang/password/api-key tab |
| 29 notifications | full list | list + filter | list + filter + preview | 同 | swipe to dismiss mobile |
| 30 history | 1 col version list | list + preview | list + diff side-by-side | 同 | mobile preview 全螢幕 |
| 38 edit-requests | 1 col card | 1 col card | 2 col card + filter | 同 | approve flow modal mobile |
| 36 workspace billing | 1 col | 1 col + cards | 2 col | 同 | Stripe Elements iframe |
| 37 workspace models/audit | tab + list | tab + grid | sidebar + tab | 同 + extra | provider 卡 grid 2/3/4 col |

### 3.5 手機 / 命令面板 / 狀態

| Mockup | 備註 |
|---|---|
| 11 mobile-home | 永遠 mobile mode；不適用其他斷點 |
| 12 mobile-review | 永遠 mobile mode；swipe 切 panel |
| 21 walkthrough | mobile 直接 fullscreen modal；desktop hotspot |
| 22 command palette | ⌘K 永遠居中 modal；mobile 全螢幕 |
| 26 onboarding | mobile = fullscreen step；desktop = centered card |
| 27 empty-states | 純 component 展示頁，不對 production |
| 33 errors | 純 component 展示頁，不對 production |

---

## 4. 共用 layout primitive（補 L Foundation）

### 4.1 `<AppShell>`

```tsx
interface AppShellProps {
  topBar?: ReactNode;       // 60px
  sidebar?: ReactNode;      // 280px (wide) / 240 (comfort) / 56 (compact) / drawer (mobile)
  inspector?: ReactNode;    // 380-420px right column
  footer?: ReactNode;       // optional
  fluid?: boolean;          // true = max-width 不限
  children: ReactNode;
}
```

LOC: 220
Mockup 用到：全部 36

### 4.2 `<SidebarDrawer>`（mobile）

```tsx
<SidebarDrawer open onOpenChange={...}>
  <ProjectSidebar />
</SidebarDrawer>
```

LOC: 130（建立在 Radix Dialog 上）
Mockup 用到：02/15/16/17/20/29/30 mobile

### 4.3 `<InspectorPanel>`

```tsx
<InspectorPanel
  position="right"
  collapsible
  defaultCollapsed={false}
  width={{ comfort: 380, wide: 420 }}
>
  {inspector}
</InspectorPanel>
```

LOC: 180
Mockup 用到：13/08/15/23/25

### 4.4 `<BottomSheet>`（mobile inspector）

```tsx
<BottomSheet open onOpenChange snapPoints={[200, 480, 720]}>
  {content}
</BottomSheet>
```

LOC: 200（gesture handling）
Mockup 用到：13/08/23 mobile

### 4.5 `<RailNav>`（compact mode）

```tsx
<RailNav width={56}>
  <RailItem icon="□" href="/projects" />
  <RailItem icon="◇" href="/cast-sets" />
</RailNav>
```

LOC: 150
Mockup 用到：02/15/16/17/20/28/29 compact

### 4.6 `<SectionToggle>`

```tsx
<SectionToggle defaultOpen={false} label="進階設定">
  {children}
</SectionToggle>
```

LOC: 90（mobile 折疊 / desktop 全展開的常用 pattern）

**4 個 layout primitive 合計：~970 行** — 補進 L §3.3 資料層後，§3.4 Primitives

---

## 5. 13-narrative-editor 拆 component

> **問題：** 1,075 行單檔，含 6 大子系統互相耦合。實作 React 直接照 mockup 寫會卡死。

### 5.1 拆 8 個 sub-component

```
src/components/narrative/
├── NarrativeView.tsx                 # 主容器，140 行
│   ├── 拼裝下面 8 個 child
│   └── 處理 view-switcher（narrative ↔ storyboard）
│
├── NarrativeRostersRail.tsx          # 左欄 cast/scenes/props 列表，220 行
│   ├── 3 sections（角色 / 場景 / 道具）
│   ├── 每 section 有 add 按鈕
│   └── 拖曳到敘事編輯器產生 @chip
│
├── NarrativeEditor.tsx               # 中央 Tiptap 編輯器，380 行
│   ├── Tiptap 設定 + Mark/Node 自訂
│   ├── inline @chip 渲染
│   ├── @ autocomplete trigger
│   └── autosave debounce
│
├── NarrativeSegment.tsx              # 8 段獨立 segment，180 行
│   ├── segment header（集數 + 時長）
│   ├── 段落級 regen button + provider 選擇
│   ├── status badge（draft / generating / done）
│   └── 對白 dialogue line 內嵌顯示
│
├── ChipAutocomplete.tsx              # @ 自動完成下拉，200 行
│   ├── @ trigger 偵測
│   ├── 模糊搜尋 character/location/prop
│   ├── 鍵盤導航
│   └── 選擇後 insert mark
│
├── InlineChip.tsx                    # @chip 單元，160 行
│   ├── 4 kind: character/location/prop/empty
│   ├── click 開 SubjectEditDrawer
│   ├── hover preview popover
│   └── delete handling
│
├── NarrativeInspector.tsx            # 右欄 inspector，220 行
│   ├── GenerationModePicker（4 mode grid）
│   ├── CinemaPillsField（風格 preset）
│   ├── PreviewMini（即時預覽縮圖）
│   └── 全域設定（targetDuration / aspect / fps）
│
├── GlobalConstraintsBar.tsx          # 頂部常駐約束列，110 行
│   ├── 風格 preset 一句 summary
│   ├── 全集應用按鈕
│   └── 變更歷史 popover
│
└── EpisodeNarrativeTab.tsx           # 集數切換 tab，120 行
    ├── 集數列表（多集劇本）
    ├── 拖曳重排
    └── 新增集數按鈕
```

**總計 8 個檔：~1,730 行**（從 mockup 推估的實際實作）

### 5.2 共享 state（Zustand store）

```typescript
// src/lib/stores/narrative-store.ts
interface NarrativeStore {
  activeEpisodeId: string;
  activeSegmentId: string | null;
  selectedChipId: string | null;
  inspectorOpen: boolean;
  rostersCollapsed: boolean;

  setActiveEpisode: (id: string) => void;
  selectChip: (id: string | null) => void;
  toggleInspector: () => void;
}
```

LOC: 120
8 個 component 共用，避免 prop drilling。

### 5.3 dependency graph

```
NarrativeView
  ├── NarrativeRostersRail ──┐
  ├── NarrativeEditor ────┐  │
  │   ├── NarrativeSegment │  │
  │   ├── InlineChip ──────┼──┤
  │   └── ChipAutocomplete │  │
  ├── NarrativeInspector ──┤  │
  ├── GlobalConstraintsBar │  │
  └── EpisodeNarrativeTab  │  │
                           ▼  ▼
                      narrative-store
```

InlineChip 同時被 RostersRail 拖曳 + Editor 內顯示。

---

## 6. 08-storyboard-v2 拆 component

> **問題：** 860 行單檔，含 timeline / panel detail / preview 三大區。

### 6.1 拆 7 個 sub-component

```
src/components/storyboard/
├── StoryboardView.tsx               # 主容器，120 行
├── StoryboardTimeline.tsx           # 底部時間軸 + 拖曳，280 行
│   ├── 6 種 pt-1..pt-6 panel 寬度
│   ├── group banner（autoGroup V2 已有）
│   └── zoom in/out
├── PanelCard.tsx                    # 卡片本體，180 行
├── PanelPreview.tsx                 # 大 9:16 預覽，160 行
│   ├── 動態 aspect ratio
│   ├── PanelMediaToggle (V2 直接用)
│   └── progress overlay 渲染中
├── MultiShotBindingsRail.tsx        # V2 直接用，0 行新增
├── GenerationModeBanner.tsx         # 上方 banner，90 行
└── StoryboardInspector.tsx          # 右欄 inspector，220 行
    ├── 重生 button + provider 選
    ├── 對白 dialogue 預覽
    └── 版本歷史快查
```

**總計 7 個檔：~1,050 行**

---

## 7. 36/37/38 workspace 拆

### 7.1 36 workspace-general-billing

```
src/components/workspace/
├── WorkspaceGeneralForm.tsx         # 220 行
├── IconUploader.tsx                 # 130 行（共用 FileUploader）
├── CurrentPlanCard.tsx              # 180 行
├── MonthlyUsageBar.tsx              # 140 行
├── TopupHistoryTable.tsx            # 180 行（共用 DataTable）
├── InvoiceHistoryTable.tsx          # 180 行（共用 DataTable）
├── PaymentMethodCard.tsx            # 130 行（含 Stripe Elements）
└── DangerZoneCard.tsx               # 150 行
```

### 7.2 37 workspace-models-audit

```
├── ProvidersGrid.tsx                # 280 行
├── ProviderCard.tsx                 # 220 行
├── SmartRoutingViz.tsx              # 180 行
├── IntegrationsList.tsx             # 280 行
├── APIKeysTable.tsx                 # 200 行（共用 DataTable）
├── APIKeyCreateModal.tsx            # 220 行
├── AuditLogList.tsx                 # 280 行
└── AuditRow.tsx                     # 120 行
```

### 7.3 38 edit-requests

```
├── EditRequestCard.tsx              # 280 行
├── EditRequestApproveModal.tsx      # 180 行
├── EditRequestStatusTabs.tsx        # 90 行
└── EditRequestImpactPreview.tsx     # 130 行（顯示批准後影響範圍）
```

---

## 8. 共用 UI atom 對映表

> 每個 sub-component 該用什麼 atom（從 L §3.4 Primitives 取）

| Sub-component | 用到的 atom |
|---|---|
| NarrativeRostersRail | RailNav / Button / Pill |
| NarrativeEditor | Tiptap external + 自定 Mark/Node |
| NarrativeSegment | Button / DropdownMenu / Badge |
| ChipAutocomplete | radix-popover + 自定 list |
| InlineChip | Pill / Tooltip / SubjectEditDrawer |
| NarrativeInspector | Tabs / Select / Switch / Slider |
| GlobalConstraintsBar | Pill / Tooltip |
| EpisodeNarrativeTab | Tabs + DndContext |
| StoryboardTimeline | DndContext / SortableList / Button |
| PanelCard | Card 樣式 + Button / Badge |
| ProviderCard | Switch / Badge / Button / Tooltip |
| IntegrationsList | List + Button / Modal |
| APIKeysTable | DataTable / Pill / ConfirmDialog |
| AuditLogList | DataTable / Pill / Avatar / RelativeTime |
| EditRequestCard | Avatar / Pill / Select / Button / ConfirmDialog |

---

## 9. 響應式 anti-pattern

### 9.1 避免

- ✗ `width: 100vw` → iOS Safari 100vh bug；改 `width: 100%`
- ✗ `position: fixed` + transform parent → transform 會建 containing block 破 fixed
- ✗ 純靠 `min-width: 768px` 判斷 desktop → 改用 `useMediaQuery` hook 同時看 UA
- ✗ inline `style={{ width: ... }}` → 改 CSS var 給 token system 接管
- ✗ hardcode `px` 給 layout → 改 `rem` 或 tokens scale

### 9.2 sticky / fixed 統一規則

- 頂部 ws-top：`position: sticky; top: 0; z-index: 100`
- 底部 action bar：`position: sticky; bottom: 0; z-index: 50`
- modal / drawer：z-index 1000+
- toast：z-index 2000
- command palette：z-index 3000

### 9.3 viewport 高度策略

```css
/* iOS Safari 100vh bug 對策 */
:root {
  --vh: 1vh;
}

/* 用 JS 算 */
window.addEventListener('resize', () => {
  document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
});

.full-height { min-height: calc(var(--vh, 1vh) * 100); }
```

---

## 10. 觸控優化

### 10.1 最小可點區

- button / link：≥ 44 × 44 px（iOS HIG）
- icon-only button：48 × 48 px（含 hit-area）
- 列表 row：≥ 48 px 高

### 10.2 hover-only feature 替代

```tsx
const { isTouch } = useTouchDevice();

return (
  <Card>
    {!isTouch && <HoverActions />}
    {isTouch && <SwipeActions />}
  </Card>
);
```

### 10.3 swipe gesture（mobile only）

- 08 panel 卡片：左滑刪除 / 右滑重生
- 29 通知：左滑標已讀 / 右滑刪除
- 30 版本歷史：左右滑切版本

用 `react-swipeable` 或自家 useSwipe hook。

---

## 11. 字體 scale

### 11.1 mobile 縮小

```css
:root {
  --fs-h1: 32px;
  --fs-h2: 24px;
  --fs-h3: 18px;
  --fs-body: 14px;
  --fs-sm: 12px;
}

@media (max-width: 767px) {
  :root {
    --fs-h1: 24px;  /* -25% */
    --fs-h2: 20px;
    --fs-h3: 16px;
    --fs-body: 14px;
    --fs-sm: 12px;
  }
}
```

### 11.2 prose 內容

`<NarrativeEditor>` 內 paragraph：`16px` 不縮（閱讀舒適度）；但 chrome（toolbar 等）跟 system scale。

---

## 12. 圖片 / Video 響應

### 12.1 img srcset

```html
<img
  src="/api/img/{id}?w=1024"
  srcset="
    /api/img/{id}?w=480 480w,
    /api/img/{id}?w=768 768w,
    /api/img/{id}?w=1024 1024w,
    /api/img/{id}?w=1440 1440w
  "
  sizes="(max-width: 480px) 100vw, (max-width: 1024px) 50vw, 1024px"
  loading="lazy"
/>
```

Cloudflare Worker 自動 resize（cf-image-transformations）。

### 12.2 video adaptive

- HLS / DASH 多碼率
- mobile 限 480p；wifi 才 1080p
- LCP 圖（landing hero）priority 不 lazy

---

## 13. Lighthouse 目標（M cross-cutting 對映）

| 頁面 | mobile LCP | desktop LCP | mobile CLS | mobile TBT |
|---|---|---|---|---|
| 01 landing | < 2.5s | < 1.5s | < 0.05 | < 200ms |
| 02 home | < 2.0s | < 1.2s | < 0.05 | < 300ms |
| 13/08 storyboard | < 3.0s | < 2.0s | < 0.1 | < 500ms |
| 31 share | < 1.5s | < 1.0s | < 0.05 | < 200ms |
| 32 discover | < 2.0s | < 1.5s | < 0.05 | < 300ms |

---

## 14. RTL 預留（未來）

- 不寫死 `padding-left/right` → 用 `padding-inline-start/end`
- 不用 `text-align: left/right` → 用 `start/end`
- Icon 方向（→）給 RTL 鏡像 class `[dir="rtl"] .arrow-right { transform: scaleX(-1); }`
- 一期不做（中文 + 英文都 LTR），但 layout 不寫死方向，避免未來重寫

---

## 15. Checklist（PR review 用）

- [ ] 新 component 標明 mobile / compact / comfort / wide 表現
- [ ] 用 token / media util，不寫死 px
- [ ] hover-only feature 有 touch 替代
- [ ] button 最小 44×44
- [ ] 圖片有 srcset + loading=lazy（非 LCP）
- [ ] 沒有 `100vh`，用 `calc(var(--vh, 1vh) * 100)`
- [ ] sticky 元素 z-index 對齊規範
- [ ] 13-narrative / 08-storyboard 改動 → 確認沒重新整合 1000+ 行單檔

---

**下一份：** P（M 補強情境）
