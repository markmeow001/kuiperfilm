# C · RBAC 權限矩陣

> **目標：** 把 Org / Workspace / Project 三層 × 4 Role × 30+ Action 列成 table，避免實作時各處散落 if-else。
>
> **狀態：** v1 · 2026-05-29
> **依賴：** A-schema-migration.md, B-api-endpoints.md

---

## 0. 三層架構回顧

```
Org（組織，最高層）
  ├── Workspace A
  │     ├── Project 1
  │     ├── Project 2
  │     └── Members
  └── Workspace B
        └── Project 3
```

- **User** 一定屬於 1+ Org
- 在 Org 內可以被指派為**多個 Workspace** 的 member（同 user 在不同 workspace 可能不同 role）
- Project 隸屬於 Workspace，permission inherit from workspace（除非 explicit override）

---

## 1. Role 階層

### Org 層（最大）

| Role | 描述 |
|---|---|
| **Org Owner** | 創建者 + 唯一可以刪 org 的 role。一般只有 1 個（可轉讓）。 |
| **Org Admin** | 可管理所有 workspace + 開計費 + 加 member |

### Workspace 層（D-1 拍板 2026-05-30：4 role → 7 role 對齊 K UserRole）

| Role | 描述 |
|---|---|
| **Owner** | workspace 創建者，可刪 workspace、唯一可指派 / 轉移所有權 |
| **Admin** | 可邀請 / 移除 member、改 billing、改設定（不可刪 workspace）|
| **Editor** | 可創建/編輯所有 project（含他人創建的）|
| **Commenter** | 可看 + 留言 + react；不能改任何 panel/character/script |
| **Viewer** | 唯讀，可看可下載但不能改 |
| **Billing** | 只看帳單、升降級、退款；其他全部 403。給財務 / 行政專用 |
| **Guest** | 公開 share 已登入訪客（可 like / clone / comment），**不算 workspace seat** |

### Project 層（一般繼承 Workspace role，但可 override）

| Override | 用途 |
|---|---|
| **Editor 升 Project Owner** | 例：某 editor 是某 project 主導，可決定 publish |
| **Viewer 升 Project Editor** | 例：合作對外 reviewer 只能編輯某個 project |
| **Editor 降 Project Viewer** | 例：被 lock down 的 project |

### 特殊

| Role | 描述 |
|---|---|
| **Anonymous** | 未登入訪客 — 只能看 public showcase / 公開分享 / 廣場 |
| **System Admin** | KuiperAI 內部 admin（mockup 18），跨 org 可看所有資料 |

---

## 2. Action 清單（按資源分類）

### Org 層 Action

| Action | Code |
|---|---|
| 創建 workspace | `org.workspace.create` |
| 刪除 workspace | `org.workspace.delete` |
| 管理 org settings | `org.settings.write` |
| 看 org billing | `org.billing.read` |
| 改 org billing | `org.billing.write` |
| 邀請 org member | `org.member.invite` |
| 移除 org member | `org.member.remove` |
| 改 org member role | `org.member.role.write` |

### Workspace 層 Action

| Action | Code |
|---|---|
| 看 workspace 內容 | `workspace.read` |
| 改 workspace settings | `workspace.settings.write` |
| 刪 workspace | `workspace.delete` |
| 邀請 workspace member | `workspace.member.invite` |
| 移除 workspace member | `workspace.member.remove` |
| 改 workspace member role | `workspace.member.role.write` |
| 看 workspace billing | `workspace.billing.read` |
| 改 workspace billing / 升級 | `workspace.billing.write` |
| 看 audit log | `workspace.audit.read` |

### Project 層 Action

| Action | Code |
|---|---|
| 看 project | `project.read` |
| 創建 project | `project.create` |
| 改 project metadata | `project.write` |
| 刪 project | `project.delete` |
| 編輯 project 內容（劇本/分鏡） | `project.content.write` |
| 觸發生成任務 | `project.run.create` |
| 取消 / 重試任務 | `project.run.write` |
| 看 project 歷史版本 | `project.version.read` |
| 回滾 / 收藏版本 | `project.version.write` |
| 編輯劇集設定（character/location/prop） | `project.element.write` |
| 跨專案匯入 element | `project.element.import` |
| 編輯配音 | `project.voice.write` |
| 發布到 showcase | `project.publish` |
| 取消發布 | `project.unpublish` |
| 下載成片 | `project.download` |
| 一鍵發抖音/小紅書/IG/YT | `project.publish.external` |

### 公開分享層 Action

| Action | Code |
|---|---|
| 看 public share | `share.read` |
| 點讚 | `share.like` |
| 留言 | `share.comment.create` |
| 刪自己的留言 | `share.comment.delete.own` |
| 刪他人的留言（moderator） | `share.comment.delete.any` |
| Follow 創作者 | `creator.follow` |
| Clone 公開作品 | `share.clone` |

### Notification 層

| Action | Code |
|---|---|
| 看自己的 notification | `notification.read.own` |
| 改 notification prefs | `notification.prefs.write` |

### System Admin 層

| Action | Code |
|---|---|
| 看所有 org / workspace / user | `system.read.all` |
| Impersonate user（debug） | `system.impersonate` |
| 看 platform KPI | `system.kpi.read` |
| 改 provider 配額 | `system.provider.write` |
| 強制刪除違規內容 | `system.content.delete` |

---

## 3. 主矩陣（Workspace × Project Action）

### Workspace 操作（7-role 完整矩陣）

> **D-1 拍板補表：** Commenter / Billing / Guest 三 row 補齊。Guest 是「公開 share 已登入訪客」不算 seat，跨 workspace 也可能是這狀態。Commenter 只能改自己的留言。Billing 對非 billing endpoint 全部 403。

| Action | Owner | Admin | Editor | Commenter | Viewer | Billing | Guest |
|---|---|---|---|---|---|---|---|
| workspace.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| workspace.settings.write | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| workspace.delete | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| workspace.member.invite | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| workspace.member.remove（his/herself） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | n/a |
| workspace.member.remove（other） | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| workspace.member.role.write | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| workspace.member.role.write（升 Owner） | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| workspace.billing.read | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| workspace.billing.write | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| workspace.audit.read | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| workspace.api-key.read | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| workspace.api-key.write | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| workspace.integration.write | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| workspace.edit-request.create | n/a | n/a | n/a | ✓ | ✓ | ✗ | ✗ |
| workspace.edit-request.approve | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| workspace.edit-request.revoke | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Project 操作（7-role 完整矩陣）

| Action | Owner | Admin | Editor | Commenter | Viewer | Billing | Guest |
|---|---|---|---|---|---|---|---|
| project.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 限公開 share |
| project.create | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| project.write（自己創的） | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| project.write（他人的） | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| project.delete（自己創的） | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| project.delete（他人的） | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| project.content.write | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| project.run.create | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| project.run.write（取消） | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| project.version.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| project.version.write（回滾） | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| project.element.write | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| project.element.import | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| project.voice.write | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| project.publish | ✓ | ✓ | ✓（限自己創的） | ✗ | ✗ | ✗ | ✗ |
| project.unpublish | ✓ | ✓ | ✓（限自己創的） | ✗ | ✗ | ✗ | ✗ |
| project.download | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| project.publish.external | ✓ | ✓ | ✓（限自己創的） | ✗ | ✗ | ✗ | ✗ |
| project.comment.create | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| project.comment.delete.own | ✓ | ✓ | ✓ | ✓ | n/a | n/a | n/a |
| project.comment.delete.any | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

### 公開層（Anonymous + Signed-in）

| Action | Anonymous | Signed-in（任何 role） |
|---|---|---|
| share.read | ✓ | ✓ |
| share.like | ✗（轉登入） | ✓ |
| share.comment.create | ✗（轉登入） | ✓ |
| share.comment.delete.own | — | ✓ |
| share.comment.delete.any | — | ✗（除非該 share 的 project owner） |
| creator.follow | ✗（轉登入） | ✓ |
| share.clone | ✗（轉登入） | ✓ |

### System Admin（mockup 18）

| Action | System Admin |
|---|---|
| system.read.all | ✓ |
| system.impersonate | ✓（記錄 audit） |
| system.kpi.read | ✓ |
| system.provider.write | ✓ |
| system.content.delete | ✓（記錄 audit） |
| workspace.* | ✓（all workspaces） |
| project.* | ✓（all projects） |

---

## 4. 特殊規則

### 4.1 Free plan 限制（不只 role，加 plan 層 guard）

| Action | Free | Creator | Studio | Team |
|---|---|---|---|---|
| project.create | 最多 3 | 最多 10 | 無限 | 無限 |
| project.run.create | daily quota 100 pt | 1,500/月 | 5,000/月 | 15,000/月 |
| 並發任務 | 1 | 2 | 5 | 10 |
| 可選 provider | 1 | 3 | 5 | 5 |
| project.publish.external | ✗ | ✗ | ✓ | ✓ |
| share.clone（你被別人 clone） | ✓（顯示 watermark） | ✓ | ✓ | ✓ |
| API access | ✗ | ✗ | ✗ | ✓ |
| SSO | ✗ | ✗ | ✗ | ✓ |

### 4.2 Owner 不可降級自己

User 不能改自己的 role 變成更低 — 只能由其他 admin/owner 改。**特例：** workspace 只剩 1 個 Owner 時不能改 role（必須先指派新 Owner）。

### 4.3 Cross-workspace import 規則

`project.element.import` 需要：
- 來源 element 的 owner workspace 有 sharing toggle 開（Free plan **不能開**）
- 目標 workspace 的 user 有 `project.content.write`
- linked mode 需要兩邊都同意（雙向確認）

### 4.4 Public share 的 special

PublicShare 的 owner 是 project owner — 即使 project 被刪，PublicShare 留 90 天（給 already-shared link 看 graceful "已刪除" 頁面）然後 hard delete。

---

## 5. 實作建議

### 5.1 Service 層 guard

```typescript
// src/lib/rbac/can.ts
export function can(
  user: User,
  action: Action,
  resource: { workspaceId?: string; projectId?: string; shareId?: string }
): boolean {
  // 1. System admin = always yes
  if (user.isSystemAdmin) return true;

  // 2. Lookup role
  const role = getRoleFor(user, resource);

  // 3. Check matrix
  return matrix[action][role] ?? false;
}

// 用法：
if (!can(user, 'project.publish', { projectId })) {
  throw new ForbiddenError();
}
```

### 5.2 API middleware

每個 endpoint 用 decorator 標 required action：

```typescript
@RequiresAction('project.publish')
@RequiresPlan(['studio', 'team'])  // plan 層 guard
async function publishProject(...) { ... }
```

### 5.3 Frontend 用同套 matrix

```typescript
// src/lib/rbac/useCan.ts
const { canPublish } = useCan(['project.publish'], { projectId });

return canPublish ? <PublishButton /> : null;
```

---

## 6. 統計

| 維度 | 數字 |
|---|---|
| Action 總數 | ~30 個 |
| Role 種類 | 4（workspace） + 2（org） + 1 system + anonymous = **8** |
| Plan 種類 | 4 |
| Special rule | 4 條 |
| Matrix cell 總數 | ~30 × 8 ≈ **240** |
| 工程預估 | RBAC service 層 1.5d + middleware 0.5d + frontend hook 0.5d + test 1d = **3.5d** |

---

**下一份：** D-pricing-reverse-math.md
