# M · E2E 測試情境集

> **目標：** 每個 Phase 定義「做完了」的客觀標準。Playwright + Vitest 共用同一份 test data factory，CI 強制 7 個 Phase 全綠才 ship。每個 happy path 平均 < 30 秒，整套 E2E < 30 分鐘。
>
> **狀態：** v1 · 2026-05-29
> **依賴：** A-schema-migration.md / B-api-endpoints.md / K-openapi.yaml / L-component-inventory.md
> **產出：** 本 md（情境清單 + Playwright pseudo-code）→ 對應實作放 `tests/e2e/<phase>/<scenario>.spec.ts`

---

## 1. 為什麼先寫情境

不寫情境直接 ship 的代價：
- 「做完了」是主觀的。dev 說 OK、QA 找出 bug、user 又補洞，三方來回兩個 sprint
- Scope creep：實作中順手加東西，沒人把關
- Regression：之前修好的，下個 PR 又壞，沒人發現直到 user 罵
- 上線 Day 1 才發現「點數退款邏輯沒測」「跨用戶權限沒測」「i18n 切 EN 整片 [!MISSING]」

寫情境的收益：
- 每個 Phase 有 5-10 條 happy path 寫死在 spec，全綠才 ship
- Edge case 列在前面，dev 主動防 bug 而非事後修
- QA 對著情境跑，回報也對得上
- 上線後 CI 持續跑，regression 30 秒抓出

---

## 2. 工具鏈

| 用途 | 工具 | 理由 |
|---|---|---|
| Browser E2E | Playwright | 跨瀏覽器、自動 wait、trace 強 |
| Component 測試 | Vitest + Testing Library | 與 unit test 共框架 |
| 合約測試 | Dredd (vs K-openapi.yaml) | API 不能跑偏 |
| Mock 服務 | Prism + msw | 前端離線開發、E2E 同步 |
| 視覺 regression | Playwright screenshot diff | 避免設計改動沒人發現 |
| A11y | @axe-core/playwright | 每頁強制過 0 critical |
| 效能 | Lighthouse CI | LCP / CLS / TBT 防退化 |

---

## 3. 測試帳號 / 資料準備

### 3.1 固定測試帳號

| 角色 | Email | 用途 |
|---|---|---|
| Owner | `owner@e2e.test` | workspace 主人 |
| Admin | `admin@e2e.test` | workspace 管理 |
| Editor | `editor@e2e.test` | 正常用戶 |
| Viewer | `viewer@e2e.test` | 申請編輯權限的角色 |
| Guest | `guest@e2e.test` | 跨 workspace 邀請對象 |
| Anonymous | (無帳號) | 公開頁訪客 |

### 3.2 種子資料

`scripts/seed-e2e.ts` 在 CI 跑前清庫 + 灌：
- 1 個 workspace (`ws_e2e`)
- 6 個帳號（上表）+ 對應 member 記錄
- 1 個範本 project (`prj_e2e_demo`) 含 1 集 3 個 panel + 3 個 character + 2 個 location + 1 個 prop
- 1 個已 publish 的 public share (`/v/e2e-demo`)
- 3 個 pending edit request（給 38 mockup 測）
- 5 條 audit log

### 3.3 Factory pattern

```ts
// tests/e2e/factories/index.ts
export const createProject = (overrides = {}) =>
  api.POST('/projects', {
    body: { title: 'E2E Project', ...overrides },
    headers: { 'X-Workspace-Id': 'ws_e2e' }
  });

export const createPanelWith = (config: {
  characters?: string[];
  generationMode?: GenerationMode;
  ...
}) => { /* ... */ };
```

每個 spec 用 factory 自建乾淨資料，**不依賴** seed 順序。Seed 只給「不會改」的範本。

---

## 4. 命名約定

### 4.1 檔案

```
tests/e2e/
├── phase-1-auth/
│   ├── magic-link.spec.ts
│   ├── oauth-google.spec.ts
│   └── invite-redemption.spec.ts
├── phase-2-workspace/
├── phase-3-creation/
├── phase-4-render/
├── phase-5-share/
├── phase-6-edit-requests/
├── phase-7-billing/
├── cross-cutting/      # i18n / mobile / a11y / 跨 Phase
└── factories/
```

### 4.2 test 名稱模板

```
describe('scenario name', () => {
  test('user can [action] when [precondition]', ...);
  test('user sees [error] when [edge case]', ...);
});
```

### 4.3 Tag

```
@happy        — 主要 happy path（必跑）
@edge         — edge case（必跑）
@slow         — > 30s（PR 跳過，nightly 跑）
@flaky        — 有重試（追蹤中）
@a11y         — a11y 檢查
@visual       — 視覺 diff
```

CI 預設跑 `--grep "@happy|@edge"`。

---

## Phase 編號對照（D-8 拍板 2026-05-30）

> M 的 Phase 1-7 是「E2E 測試 Phase」，對應到 **README Phase 5（API + frontend 實作）的 7 個子階段**。完整 phase 編號規範以 README Phase 0-10 為唯一來源。

| M Phase | README Phase | L Week | 主題 |
|---|---|---|---|
| Phase 1 | README Phase 5 / Phase 9 (soft launch) | L Week 14 | Auth + Onboarding |
| Phase 2 | README Phase 5 | L Week 8-11 | Workspace + Subjects |
| Phase 3 | README Phase 5 | L Week 5-7 | 創作流雙視圖 |
| Phase 4 | README Phase 5 | L Week 12-13 | Voice + Render + Final |
| Phase 5 | README Phase 5 | L Week 15-16 | Share + Discover |
| Phase 6 | README Phase 5 | L Week 10-11 | EditRequest + Audit |
| Phase 7 | README Phase 6 | L Week 17 | Pricing + Billing |
| cross-cutting | README Phase 9-10 | L Week 18-20 | i18n / mobile / a11y / perf / security |

---

## 5. Phase 1 — Auth + Onboarding

### Happy paths

| # | 情境 | precondition | 預期結果 |
|---|---|---|---|
| 1.1 | Magic link 成功登入 | 用 `owner@e2e.test`，未登入 | 收信、點連結、進 /workspaces |
| 1.2 | Google OAuth 新用戶 | 沒帳號 | 自動建帳號 + 進 /onboarding step 1 |
| 1.3 | Google OAuth 既有用戶 | 已綁定 | 跳過 onboarding 直進 /home |
| 1.4 | Password login | `editor@e2e.test` + 對密碼 | 進 /home |
| 1.5 | Signup with invite code | code 對應 ws_e2e Editor 邀請 | 自動加入 workspace |
| 1.6 | Logout | 已登入 | 清 session + 跳 / |
| 1.7 | Onboarding 5 步完整跑完 | 新用戶 | 自動建第一個 sample project + 進 storyboard 13 |
| 1.8 | Onboarding 第 3 步跳過 | 在 step 3 | 直接結束 + 進 /home（無 sample project）|

### Edge cases

| # | 情境 | 預期 |
|---|---|---|
| 1.E1 | Magic link 過期（> 15 min） | 顯示「连结已过期」 + 重發按鈕 |
| 1.E2 | Magic link 已用過 | 同上 + 不可重用 |
| 1.E3 | Email 不存在仍回 200 | 防 enumeration（K spec §9 magic-link）|
| 1.E4 | 同帳號 5 分鐘內第 6 次申請 | 429 + Retry-After |
| 1.E5 | OAuth callback state 不對 | 顯示安全錯誤 + 不建立 session |
| 1.E6 | Invite code 過期 / 已 redeemed | 顯示「邀请已失效」 + 改走一般 signup |
| 1.E7 | Onboarding 中途關瀏覽器再回來 | 從同一步繼續 |
| 1.E8 | 已登入用戶造訪 /auth | 直接 redirect /home |

### Playwright pseudo-code（1.1）

```ts
test('1.1 @happy magic link login end-to-end', async ({ page, mailbox }) => {
  await page.goto('/auth');
  await page.getByLabel('Email').fill('owner@e2e.test');
  await page.getByRole('button', { name: '寄送登入连结' }).click();

  await expect(page.getByText('我们已寄出登入连结')).toBeVisible();

  const email = await mailbox.waitFor('owner@e2e.test', { subject: /登入连结/ });
  const link = email.extractLink(/auth\/magic-callback/);

  await page.goto(link);

  await expect(page).toHaveURL(/\/workspaces/);
  await expect(page.getByText('Filmstar Studio')).toBeVisible();
});
```

---

## 6. Phase 2 — Workspace + Subjects（劇集設定）

### Happy paths

| # | 情境 | 預期結果 |
|---|---|---|
| 2.1 | Owner 在 /workspaces 邀請 3 個新成員 | 3 封信寄出 + 3 條 pending invite + audit log 3 條 |
| 2.2 | Admin 改其他成員 role Editor→Viewer | role 變 + audit log + 對方下次 reload 反映 |
| 2.3 | Owner 設定 workspace 名/slug/icon | 即時生效 + slug URL 變 + 圖示 sidebar 更新 |
| 2.4 | Editor 在 project 內建 character「林夜」+ 上傳 v1 appearance | DB 寫入 + 在 sidebar 看到 |
| 2.5 | Editor 對「林夜」追加 v2 appearance + 切 currentAppearance 到 v2 | panel 內參考 v2 |
| 2.6 | Editor 建 location「巷弄」+ 加 wide/medium/close 三角 | 三張圖入庫 |
| 2.7 | Editor 建 prop「油燈」+ 綁 holder=「林夜」 | holder 顯示 |
| 2.8 | Test-generate 角色 3 點扣費 | 點數扣 + 預覽圖回來 |
| 2.9 | 從另一專案 import 角色（linked） | 兩專案共用同一 character ref |

### Edge cases

| # | 情境 | 預期 |
|---|---|---|
| 2.E1 | 邀請第 8 個成員但 Studio 方案 5 seat 上限 | 422 + 顯示 PLAN_LIMIT_EXCEEDED + 升級 CTA |
| 2.E2 | Viewer 嘗試開 character 編輯 | 403 + 顯示「申请编辑权限」按鈕（接 38）|
| 2.E3 | Owner 刪掉「林夜」但 27 個 panel 用中 | confirm dialog 警告 + 強制 fork OR 阻擋 |
| 2.E4 | 兩個 Editor 同時改 location.description | 後者收 409 + 顯示「他人改动，请重读」 |
| 2.E5 | 上傳 11MB jpg（超過 10MB） | 413 + 友善訊息 |
| 2.E6 | 上傳 .heic（非支援格式） | 415 + 「请用 PNG / JPG / WebP」 |
| 2.E7 | Slug 改成已被佔用的「filmstar」 | 422 + 「此 slug 已被使用」 |
| 2.E8 | Owner 試圖刪 workspace 但仍有 active subscription | 強制先 cancel subscription |

---

## 7. Phase 3 — 創作流（13 narrative + 08 storyboard 雙視圖）

> **這 Phase 是最重的，含最複雜的互動與雙視圖切換**

### Happy paths

| # | 情境 | 預期 |
|---|---|---|
| 3.1 | 上傳 .docx 劇本（PROSE 模式）3000 字 | 自動拆 2 集 + 進 07 預覽 |
| 3.2 | 07 確認拆集 + LLM 分析（角色/場景/道具） | 拆出 8 個 panel + sidebar 自動建 3 char + 2 loc |
| 3.3 | 13 narrative view 看到 8 段敘事 + inline @chip | @林夜 / @巷弄 / @油灯 各顯 chip |
| 3.4 | 13 點 @林夜 chip 開抽屜 | SubjectEditDrawer 開、顯示同一個 character |
| 3.5 | 13 輸入 `@` 觸發自動完成 + 選「老婆婆」 | chip 插入敘事文 + 自動加入 panel.characters |
| 3.6 | 13 改第 3 段敘事 + 點「重生本段」 | 啟動 Run + SSE 即時更新進度 + 完成切版本 |
| 3.7 | 切到 08 storyboard view | 同一 8 panel 變卡片 + 大預覽 |
| 3.8 | 08 拖曳第 5 panel 到第 2 位 | sequence 更新 + 後端寫入 |
| 3.9 | 08 點 PanelMediaToggle 切圖/影 | 預覽切換 |
| 3.10 | 08 多選 3 個 panel + 批次重生（同 provider/mode） | 啟動 BulkRegenerate Run + 3 個子任務並行 |

### Edge cases

| # | 情境 | 預期 |
|---|---|---|
| 3.E1 | 上傳 PDF（不支援） | 415 + 友善訊息 |
| 3.E2 | 上傳 50MB docx | 413 |
| 3.E3 | 劇本含 0 對白 | LLM 仍能拆鏡（NarrativeOnly）+ 顯示 banner「未偵測到對白」 |
| 3.E4 | 點數不足無法重生 | 402 + 「升級 / 加購」按鈕 |
| 3.E5 | 重生中途 cancel | Run 變 CANCELED + 已扣點全退（失敗不扣點）+ 通知 |
| 3.E6 | Provider AtlasCloud 502 一次 | 自動重試 1 次；第二次也失敗 → FAILED + 退點 + 顯示換 provider 建議 |
| 3.E7 | 雙視圖切換時 panel 1 編輯中 | autosave 寫入 + 切過去顯示同樣資料 |
| 3.E8 | 13 narrative 一段刪到只剩 1 字 | autosave 阻擋（empty fail）+ 顯示警告 |
| 3.E9 | 13 編輯時他人改了同 panel | 409 + 友善「他人改动」+ 「合并 / 覆盖」選項 |
| 3.E10 | @ 自動完成下拉時鍵盤上下 + Enter | 鍵盤導航全通 |
| 3.E11 | mobile UA 進 /storyboard | middleware 自動 redirect `/m/storyboard` |
| 3.E12 | 編輯一段 + 切到別 tab 又回來 | autosave 已存 + 狀態還在 |

### Playwright pseudo-code（3.4 + 3.5）

```ts
test('3.4 @happy click @character chip opens drawer', async ({ page, project }) => {
  await page.goto(`/projects/${project.id}/narrative`);

  // 第 3 段敘事文裡有 @林夜
  const chip = page.locator('[data-chip="character"][data-id="char_linye"]');
  await expect(chip).toBeVisible();
  await chip.click();

  await expect(page.getByRole('dialog', { name: '林夜' })).toBeVisible();
  await expect(page.getByText('v2 · 灰色衬衣')).toBeVisible();
});

test('3.5 @happy autocomplete @ inserts chip and binds panel', async ({ page, project }) => {
  await page.goto(`/projects/${project.id}/narrative`);

  const editor = page.locator('[data-testid="narrative-editor"]');
  await editor.focus();
  await editor.click({ position: { x: 100, y: 200 } }); // 段尾
  await page.keyboard.type('@老婆');

  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: '老婆婆' }).click();

  await expect(editor.locator('[data-chip="character"][data-id="char_pop"]')).toBeVisible();

  // 後端 panel.characters 已加
  const panelData = await api.GET('/panels/{id}', {
    params: { path: { id: project.panels[2].id } },
    headers: { 'X-Workspace-Id': 'ws_e2e' }
  });
  expect(panelData.data.characters).toContainEqual(
    expect.objectContaining({ characterId: 'char_pop' })
  );
});
```

---

## 8. Phase 4 — Voice + Render + Final（24 / 23 / 25）

### Happy paths

| # | 情境 | 預期 |
|---|---|---|
| 4.1 | 23 對白行批次合成 | Run 啟動 + 進度 + 全行 audioUrl 回填 |
| 4.2 | 23 改 voice + speed + tone 預覽 | 即時播放器更新 |
| 4.3 | 23 切 voice 語言 zh-CN→en | 對白文字保留 + 合成出英文音 |
| 4.4 | 24 點「開始渲染」全集 8 panel | 8 個 Run 進 queue + 並行 ≤ 5（plan 限制）|
| 4.5 | 24 progress hero 顯示總進度 + ETA | 隨 SSE 即時更新 |
| 4.6 | 24 cross-browser sync：另一 tab 開同 episode | 看到一樣的進度（V2 機制延用）|
| 4.7 | 24 某 panel 失敗 → 點「retry」 | 重新 enqueue + 退原扣點 |
| 4.8 | 25 完成後 compose 9:16 | 啟動 COMPOSE Run + 完成後顯示 player |
| 4.9 | 25 切 16:9 顯示既有版本（不存在 → 啟動新 compose）| compose 對應 aspectRatio |
| 4.10 | 25 點下載 9:16 + subtitle burn-in | mp4 stream 開始下載 |
| 4.11 | 25 publish 到抖音 | OAuth + 上傳 + 回 externalUrl |

### Edge cases

| # | 情境 | 預期 |
|---|---|---|
| 4.E1 | 對白超 15 秒（單 chunk 上限） | 自動拆 chunked dispatch（V2 已 ship）|
| 4.E2 | 語言 hint 衝突（描述中文 + voice 英文） | 以 voice 為準 |
| 4.E3 | Render queue 滿（plan 限 5 並發） | 第 6 個進 QUEUED 等位 |
| 4.E4 | Render 中 user 改了 panel 描述 | 提示「该 panel 在渲染中，改动不影响当前 render」 |
| 4.E5 | Compose 期間 cancel | Run CANCELED + 退點 |
| 4.E6 | 嘗試 publish 但對應 platform OAuth 過期 | 跳重新授權 |
| 4.E7 | 對白合成 provider 全擋（內容審核） | FAILED + 友善訊息 + 退點 + 允許關音頻繞過 |
| 4.E8 | 下載中網路斷 | 客戶端可 resume（Range header）|
| 4.E9 | Publish 後刪 project | 公開頁變 410 Gone |

---

## 9. Phase 5 — Share + Discover（31 / 32）

### Happy paths

| # | 情境 | 預期 |
|---|---|---|
| 5.1 | Owner publish project visibility=UNLISTED | 拿到 `/v/<slug>` 連結 |
| 5.2 | 任何人（含未登入）打開 `/v/<slug>` | 看到公開頁 |
| 5.3 | 未登入點 like | 跳登入流；登入後回來 like 成功 |
| 5.4 | 已登入點 clone | 在自家 workspace 多一個 project |
| 5.5 | Comment 一條 + 別人回覆 | 巢狀正確 |
| 5.6 | 廣場 /discover trending 排序 | 按 likeCount 7 天視窗 |
| 5.7 | Follow 創作者 + 出現在 /following | 追蹤關係寫入 |
| 5.8 | Public share 加密碼 | 訪客先輸密碼才看內容 |

### Edge cases

| # | 情境 | 預期 |
|---|---|---|
| 5.E1 | Share 過期（expiresAt 已過） | 410 + 友善訊息 |
| 5.E2 | Share 期間 owner unpublish | 訪客中途看，自動跳「已下架」 |
| 5.E3 | 密碼錯 3 次 | rate limit 1 分鐘 |
| 5.E4 | 廣場 cursor 翻 10 頁無限滾動 | 不重複、不漏 |
| 5.E5 | Clone 但對方 workspace 已 seat 滿 | 顯示「升級或建新 workspace」 |
| 5.E6 | Comment 含敏感詞 | 過濾 / 標記待審 |
| 5.E7 | 公開頁被 reverse-proxy 抓 SSR | meta og: 正確（含封面）|

---

## 10. Phase 6 — Edit Requests + Audit（38 / 37）

### Happy paths

| # | 情境 | 預期 |
|---|---|---|
| 6.1 | Viewer 從 character 編輯按鈕申請編輯權限 | EditRequest 建 + Owner 收通知 |
| 6.2 | Owner 在 /edit-requests 看到 3 條 pending | 38 mockup 列表正確 |
| 6.3 | Owner 點 approve 給 7 天 | 申請人變 EDITOR scope 子集 + 7 天後自動收回 |
| 6.4 | Owner 點 deny | 通知申請人 + audit log |
| 6.5 | 申請人在期限內可改範圍內資源 | 寫入成功 |
| 6.6 | 過期後仍嘗試改 | 403 + 「权限已過期，请重新申请」 |
| 6.7 | Owner 主動 revoke 期內權限 | 即時失效 |
| 6.8 | Audit log 顯示所有 invite/approve/modify/upgrade 8 種動作 | 37 mockup audit list 正確 |
| 6.9 | Audit log 篩 scope=BILLING | 只顯示 billing 動作 |
| 6.10 | Audit log 匯出 CSV | 下載含 header 的 csv |

### Edge cases

| # | 情境 | 預期 |
|---|---|---|
| 6.E1 | 申請後 owner 1 周沒回 | 自動 EXPIRED + 通知申請人 |
| 6.E2 | 申請範圍含 workspaceSettings 但申請人是 Viewer | 顯示「需要 Owner 批准」+ 標 high impact |
| 6.E3 | 多 owner 都 approve（雙 approve） | 只第一筆生效，第二筆友善訊息 |
| 6.E4 | Approve 後 Owner 改了 grant duration | 重新算過期時間 + 通知 |
| 6.E5 | 申請被 deny 後再申請（同範圍 24h 內） | 限流 1 次 / 24h |
| 6.E6 | Audit log 保留期 90 天，第 91 天的記錄查不到 | 老資料封存或刪 |
| 6.E7 | Audit log 搜尋「林夕」找到 actor 含此名 | 命中 |

### Playwright pseudo-code（6.3）

```ts
test('6.3 @happy owner approves request with 7d duration', async ({
  ownerPage, viewerPage, api
}) => {
  // viewer 先申請
  await viewerPage.goto('/projects/prj_e2e_demo/characters/char_linye');
  await viewerPage.getByText('Viewer · 仅查看').click();
  await viewerPage.getByRole('button', { name: '申请编辑权限' }).click();
  await viewerPage.getByLabel('申请理由').fill('需要调整林夜 v3 服装细节');
  await viewerPage.getByRole('button', { name: '送出申请' }).click();

  // owner 收通知
  await ownerPage.goto('/notifications');
  await expect(ownerPage.getByText('viewer 申请编辑「林夜」')).toBeVisible();

  // owner 進 38 批准
  await ownerPage.goto('/workspaces/ws_e2e/edit-requests');
  const card = ownerPage.locator(`[data-er-id]`).first();
  await card.getByRole('combobox').selectOption('TEMP_7D');
  await card.getByRole('button', { name: '✓ 批准' }).click();

  await expect(card).toHaveAttribute('data-status', 'APPROVED');

  // viewer 改 character 成功
  await viewerPage.reload();
  await viewerPage.getByRole('button', { name: '编辑' }).click();
  await viewerPage.getByLabel('appearance v3 描述').fill('鬍渣淡一点');
  await viewerPage.getByRole('button', { name: '儲存' }).click();

  await expect(viewerPage.getByText('已儲存')).toBeVisible();
});
```

---

## 11. Phase 7 — Pricing + Billing（05 / 36）

### Happy paths

| # | 情境 | 預期 |
|---|---|---|
| 7.1 | 訪客造訪 /pricing 切月/年 | 4 tier 對照、年付 -20% |
| 7.2 | Free 用戶點 Studio 月付升級 | Stripe Checkout 跳轉 + 完成回 /workspaces/{id}/billing |
| 7.3 | Studio 用戶看 36 月度進度 | 用量 / 上限 / 預估月底使用 |
| 7.4 | Studio 用戶買 5,000 加購點 | 點數加 + 永不過期（D §8 拍板）+ 發票收信 |
| 7.5 | Studio 升 Team 4 seat | seat 變 + 補差價計算正確 |
| 7.6 | Team 降 Studio | grace period 到期月底才生效 |
| 7.7 | 退訂 | 期末仍可用 + 期末後降 Free |
| 7.8 | Render 失敗自動退點到帳 | 退款記錄出現 + 餘額對 |
| 7.9 | 切年/月付 | proration 正確 |

### Edge cases

| # | 情境 | 預期 |
|---|---|---|
| 7.E1 | Stripe webhook 重送（網路抖） | idempotent 處理 + 不重扣 |
| 7.E2 | 升級當下並發任務超新 plan 限 | 不主動殺、舊任務跑完即新限 |
| 7.E3 | 卡片 3DS 驗證失敗 | Checkout 自然 fail + 不變方案 |
| 7.E4 | 退款後想刪用戶 | 警告「未來退款無法追回」 |
| 7.E5 | 月底剛好過期 + 加購未過期 | 加購點繼續可用，月度配額重置 |
| 7.E6 | 嘗試把 Owner role 拿走（轉移） | 必須先指派新 Owner |
| 7.E7 | 改信用卡時新卡綁定失敗 | 舊卡保留 + 友善訊息 |
| 7.E8 | Quota 警告（8 成、9 成、滿） | 各推一次通知，不重發 |

---

## 12. 跨 Phase 情境（cross-cutting）

### 12.1 i18n（每 Phase 都跑）

| # | 情境 | 預期 |
|---|---|---|
| C.1 | 切換 EN 後所有 mockup 36 個無 `[!MISSING]` | screenshot diff 過 |
| C.2 | 切換 EN 後刷新仍是 EN | localStorage 保存 |
| C.3 | 中文 fallback：缺 EN key 時不要顯示空白 | 顯示 zh 內容 |
| C.4 | RTL 語言（未來） | not in scope，但 layout 不寫死 ltr |

### 12.2 Mobile

| # | 情境 | 預期 |
|---|---|---|
| C.5 | iPhone UA 進 /home auto-redirect /m/home | V2 既有 |
| C.6 | iPad 不要被當 phone（V2 既有） | 桌面版顯示 |
| C.7 | 手機橫向螢幕 | 不破版 |
| C.8 | MobileRevertBanner 點「切桌面」清 cookie 跳 /home | V2 既有 |

### 12.3 A11y（每 Phase 都跑）

| # | 情境 | 預期 |
|---|---|---|
| C.9 | 每頁 axe-core 0 critical / 0 serious | 強制過 |
| C.10 | 鍵盤 Tab 順序合理 | screen reader 友善 |
| C.11 | Focus visible 全頁可見 | 外接鍵盤可用 |
| C.12 | Modal 開時 focus trap | esc 關 |
| C.13 | aria-live region 對話框更新 | screen reader 讀得到 |
| C.14 | 色盲：所有狀態不只靠顏色（含 icon/text） | ✓ icon + ✕ icon |

### 12.4 效能（Lighthouse CI）

| # | 頁面 | LCP | CLS | TBT |
|---|---|---|---|---|
| C.15 | /  (landing) | < 2.5s | < 0.05 | < 200ms |
| C.16 | /home | < 2.0s | < 0.05 | < 300ms |
| C.17 | /storyboard | < 3.0s | < 0.1 | < 500ms |
| C.18 | /v/{slug} | < 1.5s | < 0.05 | < 200ms |

### 12.5 安全

| # | 情境 | 預期 |
|---|---|---|
| C.19 | 跨用戶讀別人 workspace project | 403 |
| C.20 | XSS：character description 塞 `<script>` | escape 不執行 |
| C.21 | CSRF：偽造 POST | reject |
| C.22 | SQL injection：search 帶 `'; DROP TABLE` | escape，正常搜尋 |
| C.23 | API key scope=read 嘗試 POST | 403 |
| C.24 | Workspace API key 嘗試讀別 workspace | 403 |
| C.25 | Magic link token 重用 | 第二次失效 |
| C.26 | Rate limit：1 帳號 1 分鐘 100 個 PATCH | 429 |

---

## 13. CI 整合

### 13.1 PR pipeline（< 8 min）

```yaml
jobs:
  unit: vitest run --coverage
  contracts: dredd K-openapi.yaml http://localhost:3000
  e2e-happy: playwright test --grep "@happy"
  e2e-edge: playwright test --grep "@edge"
  lighthouse: lhci autorun
  a11y: playwright test --grep "@a11y"
```

### 13.2 Nightly（< 30 min）

```yaml
jobs:
  e2e-full: playwright test  # 含 @slow
  visual-diff: playwright test --grep "@visual" --update-snapshots=missing
  load: k6 run loads/typical-day.js
```

### 13.3 Pre-deploy gate

```yaml
ship:
  - all PR jobs green ✓
  - nightly job green last 3 runs ✓
  - smoke (5 條最關鍵) 在 staging 跑過 ✓
  - manual approval（owner） ✓
```

### 13.4 觀察期 SLO

上線後第一週：
- E2E 成功率 ≥ 99%
- 沒 happy-path scenario 連續 fail 2 次
- prod sentry 0 critical
否則 rollback。

---

## 14. 「完成」定義

每個 Phase 收尾必須全綠：

- [ ] 該 Phase happy + edge scenarios 全綠
- [ ] 跨 Phase i18n / a11y / mobile 部分綠
- [ ] Lighthouse 該 Phase 涉及頁面達標
- [ ] 合約測試（K-openapi.yaml 對應 endpoint）綠
- [ ] 視覺 diff 無 unapproved
- [ ] PR review 簽核（code-reviewer + security-reviewer agent + 1 人類）

否則該 Phase 不算 done，不開下個 Phase。

---

## 15. 已知 trade-off

| 決定 | 為何 | 代價 |
|---|---|---|
| 不灌「100% coverage」KPI | 行覆蓋會誘導寫沒意義的測試 | 必須靠 review 看測試質量 |
| E2E 跑真 Chromium 不 mock browser | 信任度高 | CI 慢、要付 minute |
| Mock email 服務（mailbox helper） | 真寄信慢且不可重複 | 額外維護 mock |
| 不跑 Safari E2E（只 Chromium） | minute 預算有限 | 由人工驗 + sentry 補 |
| Visual diff 只跑 nightly | PR 時太多假陽性 | regression 隔天才抓 |
| Lighthouse PR 看分數，不阻擋 ship | 早期太嚴會卡 dev velocity | 上線後一週要連續達標再加 gate |

---

**完成順序：** K （合約）→ L（盤點）→ M（情境）→ 開工 Phase 1

**下一份：** 等 user 決定要不要做 N（Email/通知矩陣）/ O（Onboarding 細節）/ P（狀態盤點）等中等價值的 plan。
