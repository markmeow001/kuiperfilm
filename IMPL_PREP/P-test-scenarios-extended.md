# P · M 補強測試情境（QA reviewer 抓出的 critical 缺）

> **目標：** QA reviewer 點出 M 的 7 個 Phase × 5-10 情境覆蓋率不足，列出 25+ 條 critical/high 應補測試。本文件補齊「沒測會上線炸」的測試情境，全部對應 Playwright spec 骨架。
>
> **狀態：** v1 · 2026-05-30
> **依賴：** M-e2e-scenarios.md / K-openapi.yaml / C-rbac-matrix.md / N-security-baseline.md
> **執行：** Phase 5 開工後，每個 component PR 必含對應 spec；Phase 9 soft launch 前全綠才 ship

---

## 0. 對應 QA reviewer 8 條 Critical + 12 條 High

| QA 報告 | 對映 P 章節 |
|---|---|
| CR-1 Idempotency-Key 真實重送 | §1 |
| CR-2 失敗不扣點完整路徑 | §2 |
| CR-3 Stripe webhook signature | §3 |
| CR-4 RBAC 240 cell 矩陣 | §4 |
| CR-5 跨 workspace 資料外洩 | §5 |
| CR-6 SSE 重連 / 漏 seq | §6 |
| CR-7 並發 race condition | §7 |
| CR-8 Plan 升降級 rollover | §8 |
| H-1 timezone / DST | §9 |
| H-2 quota 警告不重發 | §10 |
| H-3 audit log retention | §11 |
| H-4 GDPR 匯出 / 刪除 grace | §12 |
| H-5 公開頁 SEO / sitemap | §13 |
| H-6 mobile touch / swipe | §14 |
| H-7 i18n 動態切換 | §15 |
| H-8 公開分享頁未登入互動 | §16 |
| H-9 效能極限值 | §17 |
| H-10 Onboarding 斷點恢復 | §18 |
| H-11 Visual regression 列頁 | §19 |
| H-12 Webhook 順序顛倒 | §20 |

---

## 1. Idempotency-Key 重送（CR-1）

### 1.1 情境清單

| # | 情境 | 預期 |
|---|---|---|
| P1.1 | 同 key 立即重送（0ms）| 第二次回 200 + 同 run_id（不重啟）|
| P1.2 | 同 key 100ms 重送 | 同上 |
| P1.3 | 同 key 500ms 重送 | 同上 |
| P1.4 | 同 key 24h 後重送 | 視為新請求，可啟新 run（TTL 過期）|
| P1.5 | 同 key 不同 body | 400 + `IDEMPOTENCY_BODY_MISMATCH` |
| P1.6 | 並發雙 POST 同 key | 第一個 starts run；第二個 等鎖回同 run_id（不雙啟）|
| P1.7 | 第一次 5xx，第二次重送 | 第二次重新啟動（失敗不算 idempotency 鎖定）|
| P1.8 | 完全沒帶 key 的 POST | 視為新請求每次都跑 |

### 1.2 Playwright skeleton

```typescript
test('P1.1 @critical idempotent regenerate within 0ms', async ({ api, panel }) => {
  const key = `idem-${Date.now()}`;
  const [res1, res2] = await Promise.all([
    api.POST('/panels/{id}:regenerate', {
      params: { path: { id: panel.id } },
      headers: { 'Idempotency-Key': key, 'X-Workspace-Id': WS },
      body: { provider: 'ARK_SEEDANCE_2', mode: 'R2V_WITH_SUBJECTS' }
    }),
    api.POST('/panels/{id}:regenerate', {
      params: { path: { id: panel.id } },
      headers: { 'Idempotency-Key': key, 'X-Workspace-Id': WS },
      body: { provider: 'ARK_SEEDANCE_2', mode: 'R2V_WITH_SUBJECTS' }
    })
  ]);
  expect(res1.data.data.id).toBe(res2.data.data.id);
});
```

### 1.3 Server-side 要驗

- Redis lock key: `idem:{userId}:{key}`，TTL 24h
- 同 key 第二次：fetch 已存 response 直接回
- 不同 body：hash body 比對

---

## 2. 失敗不扣點完整路徑（CR-2）

### 2.1 情境

| # | 失敗類型 | 退點時點 | 驗證 |
|---|---|---|---|
| P2.1 | Provider 回 5xx | retry × 2 後 final fail → ledger append `run_refund_failed` | `creditsLedger` 看到 charge + refund 兩筆，net=0 |
| P2.2 | Worker OOM / pod 被殺 | bullmq stalled detection → fail → refund | 同上 |
| P2.3 | DB tx rollback（panel.write 失敗 in middle）| catch + refund | 同上 |
| P2.4 | User cancel mid-run | refund 已扣 credits | ledger `run_refund_cancel` |
| P2.5 | Batch render 5/8 panel 成功，3/8 失敗 | 5 個正常扣，3 個各別 refund | 8 筆 charge + 3 筆 refund |
| P2.6 | Run 重試又失敗（不可雙退）| 第一次失敗 refund；第二次又失敗 → 只退一次 | ledger 1 charge + 1 refund，不是 2 refund |
| P2.7 | user 主動 cancel 跟 system fail 區分 | ledger.kind 不同 | UI 顯示原因不同 |
| P2.8 | Refund 後 audit log 對得上 | `AuditLog.action='REFUNDED'`、 `target.kind=run`、`target.id` 對 | audit + ledger 雙寫 |
| P2.9 | Workspace 餘額 = sum(ledger.credits) | 所有 ledger entry 加總 = 當前 balance | 對帳一致 |

### 2.2 對帳 SQL 測試

```typescript
test('P2.9 @critical workspace balance reconciles', async ({ db, workspace }) => {
  // 跑 50 個 random run，部分 success 部分 fail
  await Promise.all(Array.from({ length: 50 }, () => triggerRandomRun()));
  await waitForAllRunsTerminal();

  const ledgerSum = await db.creditLedger.aggregate({
    where: { workspaceId: workspace.id },
    _sum: { credits: true }
  });
  const balance = await db.workspace.findUnique({ where: { id: workspace.id } });

  expect(ledgerSum._sum.credits).toBe(balance.creditsRemaining);
});
```

---

## 3. Stripe Webhook Signature（CR-3）

| # | 情境 | 預期 |
|---|---|---|
| P3.1 | 簽名正確 | 200 + 事件處理 |
| P3.2 | 簽名偽造 | 400 + log `invalid_signature` |
| P3.3 | timestamp 超 5min tolerance | 400 + log `stale` |
| P3.4 | Replay 同 event.id 兩次 | 第二次 200 但跳過處理 |
| P3.5 | event 順序顛倒（subscription.updated 早於 created） | 應有 buffer 機制等 `created`，OR 順序檢測 |
| P3.6 | `invoice.payment_failed` 後緊跟 `invoice.paid` | 兩個都處理；最終狀態 paid |
| P3.7 | webhook 24h 內重送 100 次（極端）| idempotent，不重扣 / 不重發信 |
| P3.8 | webhook secret 過 rotation 後（雙簽期）| 新舊 secret 都接受 24h |

---

## 4. RBAC 240 Cell 矩陣（CR-4）

### 4.1 矩陣化測試

```typescript
// tests/e2e/cross-cutting/rbac-matrix.spec.ts
import { ALL_ROLES, ALL_ACTIONS } from '@/lib/rbac/constants';
import { RBAC_MATRIX } from '@/lib/rbac/matrix';  // 從 C-rbac 產出

for (const role of ALL_ROLES) {
  for (const action of ALL_ACTIONS) {
    const expected = RBAC_MATRIX[role][action];  // 'allow' | 'deny' | 'conditional'

    test(`P4 RBAC ${role} × ${action} = ${expected}`, async ({ api, asRole }) => {
      const user = await asRole(role);
      const res = await callAction(api, action, user);

      if (expected === 'allow') {
        expect(res.status).toBeLessThan(400);
      } else if (expected === 'deny') {
        expect(res.status).toBe(403);
        expect(res.data.error.code).toBe('INSUFFICIENT_PERMISSION');
      } else {
        // conditional: 自己創的 OK，他人的 deny
        const own = await callAction(api, action, user, { onOwn: true });
        const others = await callAction(api, action, user, { onOwn: false });
        expect(own.status).toBeLessThan(400);
        expect(others.status).toBe(403);
      }
    });
  }
}
```

### 4.2 Plan layer 4 × 30

```typescript
for (const plan of ['FREE', 'CREATOR', 'STUDIO', 'TEAM']) {
  for (const action of ALL_ACTIONS) {
    const expected = PLAN_GUARDS[plan][action];
    test(`P4 Plan ${plan} × ${action}`, /* ... */);
  }
}
```

### 4.3 Conditional 細項

- `project.write` editor 自己創 vs 他人創
- `project.publish` editor 限自己創
- `comment.delete.any` workspace owner override
- `workspace.member.role.write` 升 Owner 唯有 Owner

---

## 5. 跨 Workspace 資料外洩（CR-5）

### 5.1 系統化掃描

每個 GET endpoint × 3 種偽造：

```typescript
// scripts/test-cross-workspace-leak.ts
const ALL_GET_ENDPOINTS = parseFromOpenAPI('K-openapi.yaml').filter(e => e.method === 'GET');

for (const endpoint of ALL_GET_ENDPOINTS) {
  test(`P5 leak: ${endpoint.path}`, async ({ asUser }) => {
    // 1. 帶別 workspace 的 ID
    const userA = await asUser('editorA', { workspaceId: 'ws_A' });
    const resourceB = await db.create({ workspaceId: 'ws_B' });

    const res = await userA.api.GET(endpoint.path, {
      params: { path: { id: resourceB.id } },
      headers: { 'X-Workspace-Id': 'ws_A' }  // 偽造：用自己 workspace 但抓別人 ID
    });

    // 應該 404（不洩漏存在）或 403
    expect([403, 404]).toContain(res.status);
    expect(res.data).not.toContainAny(['ws_B', 'workspaceB', resourceB.name]);
  });
}
```

### 5.2 重點 endpoint

- `/projects/{id}`、`/episodes/{id}`、`/panels/{id}`
- `/characters/{id}`、`/locations/{id}`、`/props/{id}`
- `/runs/{id}`、`/runs/{id}/events`
- `/notifications/{id}`
- `/users/me/api-keys`
- `/workspaces/{id}/audit-log`

### 5.3 ID enumeration 防

- 用 ULID 而非自增 ID
- 404 不洩漏（不要 "404 ws_xxxx not found in your workspace"，純 generic）
- search endpoint 不接受 workspace 外 ID

---

## 6. SSE 重連 / Seq（CR-6）

### 6.1 情境

| # | 情境 | 預期 |
|---|---|---|
| P6.1 | 斷網 30s 後重連，帶 lastEventId | server 從該 seq 之後續推 |
| P6.2 | Seq 跳號（client 收到 5, 7）| client `useGraphEventReplay` 自動補拉 seq 6 |
| P6.3 | 重複 event（reconnect 後重發 seq 7）| client dedupe |
| P6.4 | Tab 凍結 60s 喚醒 | 重連 + resume 過去 seq |
| P6.5 | 多 tab 同 Run | 各 tab 自己一條 stream；都收到完整事件 |
| P6.6 | Worker publish 早於 frontend attach | events 進 buffer（24h TTL）；attach 時補拉 |
| P6.7 | SSE 連線 5 min 後 server 主動關（healthy）| client 自動重連 |
| P6.8 | 完全離線 → 上線後直接看歷史 | 走 `GET /runs/{id}/events?afterSeq=N` 補拉非 SSE |

### 6.2 client skeleton

```typescript
function useRunEvents(runId: string) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const lastSeq = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;

    function connect() {
      es = new EventSource(`/runs/${runId}/events`, {
        headers: lastSeq.current > 0 ? { 'Last-Event-ID': String(lastSeq.current) } : {}
      });

      es.addEventListener('run.update', (e) => {
        const data = JSON.parse(e.data);
        const seq = Number(e.lastEventId);

        // P6.2: 跳號補拉
        if (seq > lastSeq.current + 1) {
          fetch(`/runs/${runId}/events?afterSeq=${lastSeq.current}&beforeSeq=${seq}`)
            .then(r => r.json())
            .then(missed => setEvents(prev => [...prev, ...missed, data]));
        } else {
          setEvents(prev => [...prev, data]);
        }
        lastSeq.current = seq;
      });

      es.onerror = () => {
        es?.close();
        setTimeout(connect, 1000);  // P6.1 / P6.4 重連
      };
    }

    connect();
    return () => es?.close();
  }, [runId]);

  return events;
}
```

---

## 7. 並發 Race Condition（CR-7）

### 7.1 情境

| # | 情境 | 預期 |
|---|---|---|
| P7.1 | 兩 editor 同改 panel.description | 第二者收 409 + currentVersion；UI 顯示 merge dialog |
| P7.2 | A regenerate panel；B 同時 delete panel | regenerate fail with `RESOURCE_NOT_FOUND`，已扣點退 |
| P7.3 | A rename character；B 同時用該 character 寫敘事 | B 的寫入用新名 ref（解析時走 char ID）|
| P7.4 | 同 episode 兩個衝突任務（5/16 F-QA-2）| episode-level conflict guard 擋第二個 |
| P7.5 | Panel reorder 並發 | 用 lexorank 不撞；後者重新算 |
| P7.6 | Comment 並發回覆同條 | 不撞；ID 各自 |
| P7.7 | EditRequest 雙 owner 同時 approve | 只第一筆生效，第二筆友善訊息 |

### 7.2 並發測試

```typescript
test('P7.1 @critical concurrent panel update conflict', async ({ apiA, apiB, panel }) => {
  const [res1, res2] = await Promise.all([
    apiA.PATCH('/panels/{id}', {
      params: { path: { id: panel.id } },
      headers: { 'If-Match': String(panel.version) },
      body: { description: 'A 的版本' }
    }),
    apiB.PATCH('/panels/{id}', {
      params: { path: { id: panel.id } },
      headers: { 'If-Match': String(panel.version) },
      body: { description: 'B 的版本' }
    })
  ]);

  // 一個成功一個 409
  const codes = [res1.status, res2.status].sort();
  expect(codes).toEqual([200, 409]);

  const conflict = res1.status === 409 ? res1 : res2;
  expect(conflict.data.error.code).toBe('CONFLICT');
  expect(conflict.data.error.details).toHaveProperty('currentVersion');
});
```

---

## 8. Plan Rollover（CR-8）

| # | 情境 | 預期 |
|---|---|---|
| P8.1 | 月中升 Creator→Studio | proration 對；月底 grant 5000-1500 差額 |
| P8.2 | Studio→Free 降級 | grace period 期末才生效；當下仍 5000 quota |
| P8.3 | 月底 23:59:59 升級 | quota 是否重置？test 兩種：升完後立即重置 vs 下月才重置 |
| P8.4 | Cancel subscription 期內 | 期末過期；過後降 Free |
| P8.5 | Cancel 後又恢復（grace period 內）| subscription resume；quota 不變 |
| P8.6 | Monthly grant cron 與升降級同時觸發 | lock + serialize；不雙倍給 |
| P8.7 | Annual 訂閱中 cancel | 期末（年）才降；不退已付款 |
| P8.8 | Top-up 跟月度 quota 分開 ledger | TopUp 永不過期；月度配額過期 |

---

## 9. Timezone / DST（H-1）

| # | 情境 | 預期 |
|---|---|---|
| P9.1 | UTC 月底 quota reset；亞洲 +8 用戶看到 reset 時間 | reset 時點以 UTC 00:00 為準；UI 顯示 local time |
| P9.2 | DST 春跳 02:00→03:00 | 凡跨此時點的計時都用 UTC，UI 不顯異常 |
| P9.3 | DST 秋退 02:00 重複 | 同上 |
| P9.4 | 月底 30 / 31 / 閏 2 月 | reset 用 `start of next month UTC`，不依日數 |
| P9.5 | EditRequest 7 天到期跨 DST | UTC 計算，不延遲也不提前 |
| P9.6 | 跨日生成歸哪天 | 啟動時 timestamp 為準，不是完成時 |

---

## 10. Quota 警告不重發（H-2）

| # | 情境 | 預期 |
|---|---|---|
| P10.1 | 80% → 推一次 | DB `Workspace.quotaWarning80SentAt` 記錄；不重發 |
| P10.2 | 90% → 推一次 | 同上 |
| P10.3 | 100% → 推一次 | 同上 |
| P10.4 | 95% → 85% → 90% | 第二次到 90% 不重發（90 已在本月發過）|
| P10.5 | 月底重置後再到 80% | 重新發（前月 flag clear）|
| P10.6 | 觸發瞬間並發 100 個 run 都過閾值 | lock + 只 1 個 worker 發通知 |

### 10.2 lock skeleton

```typescript
async function checkAndSendQuotaWarning(workspace: Workspace) {
  const used = workspace.creditsUsed;
  const limit = workspace.creditsLimit;
  const pct = used / limit;

  const thresholds = [
    { pct: 0.8, flag: 'quotaWarning80SentAt' },
    { pct: 0.9, flag: 'quotaWarning90SentAt' },
    { pct: 1.0, flag: 'quotaWarning100SentAt' },
  ];

  for (const { pct: threshold, flag } of thresholds) {
    if (pct >= threshold && !workspace[flag]) {
      // optimistic lock: 只第一個成功
      const updated = await db.workspace.updateMany({
        where: { id: workspace.id, [flag]: null },
        data: { [flag]: new Date() }
      });
      if (updated.count > 0) {
        await sendQuotaNotification(workspace, threshold);
      }
    }
  }
}
```

---

## 11. Audit Log Retention（H-3）

| # | 情境 | 預期 |
|---|---|---|
| P11.1 | Day 89 寫入 | 仍可查 |
| P11.2 | Day 90 cron 跑 | 標 expiresAt 過期 |
| P11.3 | Day 91 查 90 天前的 | 一般 audit 查不到；billing 仍在（7 年）|
| P11.4 | retention job 跑時並發寫入 | 新寫入不會被本次 retention 掃到（lock） |
| P11.5 | search「林夕」命中過期 | 已封存資料不在 result（除 billing）|
| P11.6 | CSV 匯出 | 不含已封存 |

---

## 12. GDPR Export / Delete Grace（H-4）

| # | 情境 | 預期 |
|---|---|---|
| P12.1 | POST `/users/me:export` 啟動 | 202 + 24h 內 email 連結 |
| P12.2 | Export JSON 含完整 PII（owned/member/share/comment/run/ledger）| 全表都在 |
| P12.3 | Export 不含他人 PII（同 workspace 別 user）| 只自己 |
| P12.4 | POST `/users/me:delete` 啟動 | User.deletedAt = now；30 天 grace |
| P12.5 | Grace 期內登入 | OK + 顯示 "復原" banner |
| P12.6 | Grace 期內復原 | deletedAt 清除；正常使用 |
| P12.7 | Day 30 cron | cascade 刪 owned；audit.actorName = `[deleted-user-xxx]` |
| P12.8 | Day 30 後查公開頁該 user 留下的 comment | 顯示「[已刪除用戶]」|
| P12.9 | Day 30 後 billing audit 仍有 | hash 化 actorId 保留 |
| P12.10 | Consent 改後立即生效 | marketing email opt-out 後不再收 |

---

## 13. 公開頁 SEO / Sitemap（H-5）

| # | 情境 | 預期 |
|---|---|---|
| P13.1 | `/v/{slug}` og:title / og:image / og:description 正確 | HTML head 完整 |
| P13.2 | Twitter card type=summary_large_image | 正確 |
| P13.3 | JSON-LD VideoObject | schema.org/VideoObject 結構 |
| P13.4 | Unpublish 後 robots noindex + 410 | HTTP 410 + meta noindex |
| P13.5 | sitemap.xml 含 PUBLIC visibility | 在 |
| P13.6 | sitemap.xml 不含 UNLISTED | 不在 |
| P13.7 | Reverse-proxy SSR | meta 不漏資料 |
| P13.8 | crawler bot UA | 不被 rate limit 擋 |

---

## 14. Mobile Touch / Swipe（H-6）

| # | 情境 | 預期 |
|---|---|---|
| P14.1 | 08 panel 卡片長按 | 進入多選 mode |
| P14.2 | 08 panel 卡片 swipe right | 重生選單 |
| P14.3 | 08 panel 卡片 swipe left | 刪除 confirm |
| P14.4 | 29 notification 左滑 | 標已讀 |
| P14.5 | 29 notification 右滑 | 刪除 |
| P14.6 | 13 narrative 編輯虛擬鍵盤彈出 | autoscroll keep focus visible |
| P14.7 | iOS Safari 100vh bug | `--vh` 補丁正確 |
| P14.8 | 橫向螢幕 phone | 不被 redirect 桌面；維持 mobile mode |
| P14.9 | iPad 直 portrait | 桌面版（V2 既有規則）|
| P14.10 | 桌面版用 Chrome devtools touch emulate | hover 不會卡住 |

---

## 15. i18n 動態切換（H-7）

| # | 情境 | 預期 |
|---|---|---|
| P15.1 | 表單填一半切 EN | form value 保留，label 翻譯切換 |
| P15.2 | SSE 進行中切語言 | 進度文字下次 event 翻；不重連 |
| P15.3 | PWA 通知本地化 | service worker 用 user.language |
| P15.4 | 缺 EN key | fallback 顯示 zh 內容；不顯 `[!MISSING]` |
| P15.5 | 長 EN 字串撐爆 button | truncate ellipsis 或自動 break |
| P15.6 | 切 EN 後刷新 | localStorage 保存；維持 EN |
| P15.7 | character 名「林夜」不被翻 | content 鎖簡中（D-6）|
| P15.8 | Onboarding 中切語言 | 保持當前 step；reload 文字 |

---

## 16. 公開分享頁未登入互動（H-8）

| # | 情境 | 預期 |
|---|---|---|
| P16.1 | 未登入 like → 登入 → 回原頁 | like 真生效；URL preserve 意圖 |
| P16.2 | 未登入 clone → 跳登入 → 完成 → 真 clone | 在新 user 自家 workspace 出現 |
| P16.3 | 未登入 comment → 登入 → 文字保留 | text not lost |
| P16.4 | Clone 但 user 沒任何 workspace | onboarding 建第一個 |
| P16.5 | Clone 但 user 所有 workspace 都 seat 滿 | 顯示「升級或建新 workspace」|
| P16.6 | Share 密碼錯 3 次 | rate limit 1 min |
| P16.7 | 第 4 次正確（rate limit 期間）| 仍 429，待 lockout 解除 |
| P16.8 | 密碼大小寫敏感？ | 設計：case-sensitive |
| P16.9 | 密碼含 Unicode | 支援 |

---

## 17. 效能極限（H-9）

| # | 情境 | 預期 |
|---|---|---|
| P17.1 | 1 episode 100 panel 載入 | < 2s LCP（virtualized list）|
| P17.2 | 1 episode 100 panel 拖曳排序 | 60 FPS 不掉幀 |
| P17.3 | 1 episode 100 panel 多選 50 個 | UI 不卡 |
| P17.4 | project 1000 character ref | @chip autocomplete < 100ms |
| P17.5 | @chip 一段 50 個 | render 正常 |
| P17.6 | Audit log 10 萬條 cursor pagination | 翻頁 < 200ms |
| P17.7 | Public share 1 萬 comment | 載入 < 1s；展開 nested 5 層 < 200ms |
| P17.8 | Discover 5000 work infinite scroll | 不重複 / 不漏 |

---

## 18. Onboarding 斷點恢復（H-10）

| # | 情境 | 預期 |
|---|---|---|
| P18.1 | Step 1 關瀏覽器 → 開回來 | 從 step 1 繼續 |
| P18.2 | Step 3 跨 device | server-side state 同步 |
| P18.3 | Step 3 跳過 → 進 home | 不再強引導 |
| P18.4 | 後端 onboarding state 與前端不一致 | 以後端為準；前端 reload |
| P18.5 | Step 4 啟 sample run 中斷 | resume 後該 run 仍在 |
| P18.6 | Complete 後再走 onboarding URL | redirect home（不重跑）|

---

## 19. Visual Regression Snapshot 頁面清單（H-11）

每頁兩斷點（mobile 375 / desktop 1440）+ 兩主題（dark default / studio dark），共 ~140 snapshot。

| 頁面 | 斷點 | 主題 |
|---|---|---|
| 01 landing | mobile / desktop | dark |
| 02 home | mobile / desktop | dark |
| 05 pricing | mobile / desktop | dark |
| 06 script-input | mobile / desktop | dark |
| 07 pre-generation | mobile / desktop | dark |
| 13 narrative | mobile / desktop | dark |
| 08 storyboard | mobile / desktop | dark |
| 23 voice | mobile / desktop | dark |
| 24 render | mobile / desktop | dark |
| 25 final | mobile / desktop | dark |
| 15 character | mobile / desktop | dark |
| 16 location | mobile / desktop | dark |
| 17 prop | mobile / desktop | dark |
| 18 admin | desktop only | studio-dark |
| 19 auth | mobile / desktop | dark |
| 20 workspace | mobile / desktop | studio-dark |
| 26 onboarding | mobile / desktop | dark |
| 28 settings | mobile / desktop | dark |
| 29 notifications | mobile / desktop | dark |
| 30 history | mobile / desktop | dark |
| 31 public-share | mobile / desktop | dark |
| 32 discover | mobile / desktop | dark |
| 33 errors | desktop only（4 種 error）| dark |
| 36 workspace billing | desktop only | studio-dark |
| 37 workspace models/audit | desktop only | studio-dark |
| 38 edit-requests | desktop only | studio-dark |
| 11 mobile-home | mobile only | dark |
| 12 mobile-review | mobile only | dark |
| 22 command-palette | mobile / desktop | dark |
| 27 empty-states | dev only | dark |

跑頻率：nightly。PR 時跑 `--update-snapshots=missing` 不阻擋 merge。

---

## 20. Webhook 順序顛倒 / 重送（H-12）

| # | 情境 | 預期 |
|---|---|---|
| P20.1 | Stripe `subscription.updated` 早於 `created` | buffer 等 created 或 lookup Stripe API |
| P20.2 | `invoice.payment_failed` 後緊跟 `invoice.paid` | 最終狀態 paid |
| P20.3 | 同 event.id 重送 100 次 | idempotent |
| P20.4 | Provider VOD callback replay 同 taskId | dedupe |
| P20.5 | Provider 在我們處理中重送（網路抖）| lock + dedup |
| P20.6 | 5/12 上午 c5532de 教訓：webhook 順序測 | 從歷史 case 抓 |

---

## 21. 螢幕閱讀器 manual test（M cross-cutting M-1）

> M 只有 axe-core 自動測；要補真 SR 半自動。

### 21.1 必跑流程

| 頁面 | SR | 流程 |
|---|---|---|
| 19 auth | VoiceOver iOS | 用 SR 完成 magic-link 登入 |
| 26 onboarding | NVDA Windows | 走完 5 step |
| 13 narrative | VoiceOver macOS | 編輯敘事 + 加 @chip |
| 38 edit-requests | JAWS Windows | 批准一條申請 |
| 31 public-share | TalkBack Android | 看影片 + like + comment |

### 21.2 跑頻

- Phase 5 每 component PR：作者自跑 1 流程
- Phase 9 soft launch 前：找盲人測試員（appen.com / fable.tech）做 1 週

---

## 22. 離線 / 弱網（M-2）

| # | 情境 | 預期 |
|---|---|---|
| P22.1 | 3G throttle 下載 mp4 中斷續傳 | Range header 支援 |
| P22.2 | offline 時 autosave | 排隊 IndexedDB；上線後補送 |
| P22.3 | Service Worker 快取 | hash-based naming；新版本主動更新 |
| P22.4 | API 5xx 時 query | exponential backoff retry |

---

## 23. Batch operation partial success（M-3）

| # | 情境 | 預期 |
|---|---|---|
| P23.1 | 3 panel 批次重生，1 fail | UI 顯「2 成 / 1 失敗」；失敗那個退點 + 可單獨 retry |
| P23.2 | 批次內部 partial 不 rollback | 已成功的不被退 |
| P23.3 | 批次顯示每個的狀態 | 不是整批 OK / FAIL |

---

## 24. 跨 Episode 角色 link（M-4）

| # | 情境 | 預期 |
|---|---|---|
| P24.1 | EP1 改林夜 v3；EP2 panel 用 v2 | v2 panel 不被動改 |
| P24.2 | linked import 雙向同步 vs fork 區分 | 走 `isLinked` flag |
| P24.3 | 改名後 @chip 全集自動更新 | chip 解析走 char ID 不是字串 |

---

## 25. Provider fallback chain（M-5）

| # | 情境 | 預期 |
|---|---|---|
| P25.1 | ARK fail → AtlasCloud fail → fal 成功 | 點數只扣 fal 成功的 |
| P25.2 | fallback 過程 user cancel | 停在當前 attempt；退點 |
| P25.3 | UI 透明顯示走哪家 | 「ARK 失敗 → AtlasCloud 失敗 → fal 成功」 |

---

## 26. CI Gate 強化

```yaml
e2e-critical:
  - playwright test --grep "@critical"  # P1/P2/P3/P4/P5/P6/P7/P8
  
e2e-rbac-matrix:
  - playwright test cross-cutting/rbac-matrix.spec.ts  # 240 + 120 = 360 cell

e2e-leak:
  - playwright test cross-cutting/cross-workspace-leak.spec.ts

contract:
  - dredd K-openapi.yaml http://localhost:3000

ledger-reconcile:
  - playwright test cross-cutting/credit-ledger-reconcile.spec.ts
```

PR gate：以上全綠才 merge。

---

**完成 N + O + P 三份補丁文件。剩餘 launch 前小修見 README 附錄。**
