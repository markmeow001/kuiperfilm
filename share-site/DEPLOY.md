# 部署指引 — Cloudflare Pages

> 把 `share-site/` 部署到一個 stakeholder 可訪問的 URL。

## 方案 A · Cloudflare Pages（推薦，10 分鐘）

你已有 Cloudflare 帳號（kuiperfilmailab.com / joshvision.com 都託管在那）。

### 步驟

1. **登入 Cloudflare Dashboard**
   - https://dash.cloudflare.com

2. **創建新 Pages 專案**
   - 左側 Sidebar → `Workers & Pages`
   - 點 `Create application` → `Pages` tab → `Upload assets`

3. **上傳 share-site/**
   - Project name: `kuiper-redesign` （或任何名字）
   - 拖整個 `/Users/joshhung/KuiperAI/share-site/` 資料夾進去
   - 或先 zip 起來再上傳：
     ```bash
     cd /Users/joshhung/KuiperAI/
     zip -r share-site.zip share-site/
     ```

4. **取得 URL**
   - Cloudflare 自動給你 `https://kuiper-redesign.pages.dev`
   - 立刻可訪問

5.（可選）**綁自訂網域**
   - 例：`redesign.kuiperfilmailab.com` 或 `preview.kuiperai.com`
   - Pages 專案 → `Custom domains` → Add domain
   - DNS 會自動 propagate

## 方案 B · Vercel（如果你比較熟）

```bash
cd /Users/joshhung/KuiperAI/share-site/
npx vercel
# 跟隨提示，第一次要登入
```

Vercel 會自動偵測為 static site 並部署。

## 方案 C · GitHub Pages（如果想 commit 進 repo）

1. 在 KuiperAI repo 開分支 `gh-pages`
2. 把 `share-site/` 內容放到 root
3. Settings → Pages → Source = `gh-pages` branch
4. URL: `https://markmeow001.github.io/kuiperfilm/`

## 方案 D · 本機測試

如果只想本機 demo：

```bash
cd /Users/joshhung/KuiperAI/share-site/
python3 -m http.server 8080
# 開 http://localhost:8080
```

或：

```bash
npx serve /Users/joshhung/KuiperAI/share-site
```

## 訪問控制（保密）

如果不想完全 public：

### Cloudflare Pages Access

- Cloudflare Zero Trust → Access → Applications
- 加 Self-hosted application
- URL: `kuiper-redesign.pages.dev`
- Policy: 限 email allow list（投資人 / 合夥人 email）
- 訪問時 user 要 email 驗證才能進

### 加 basic auth（簡單）

Cloudflare Workers 寫一個 middleware：

```js
// _middleware.js
export async function onRequest({ request, next }) {
  const auth = request.headers.get('Authorization');
  const expected = 'Basic ' + btoa('investor:kuiperai2026');
  if (auth !== expected) {
    return new Response('Auth required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="KuiperAI"' }
    });
  }
  return next();
}
```

放 `share-site/_middleware.js`，Cloudflare Pages 自動執行。

## 維護建議

- mockup 改了 → 重新上傳 `share-site/preview/`
- IMPL_PREP 改了 → 重新上傳 `share-site/docs/`
- 或：把 `share-site/` 連到 GitHub 自動部署（每次 commit 自動 deploy）

## 推薦 URL 結構

| URL | 內容 |
|---|---|
| `redesign.kuiperfilmailab.com` | landing |
| `redesign.kuiperfilmailab.com/preview/` | 33 mockup hub |
| `redesign.kuiperfilmailab.com/preview/13-narrative-editor.html` | 任一 mockup |
| `redesign.kuiperfilmailab.com/docs/` | 7 份 IMPL_PREP |
| `redesign.kuiperfilmailab.com/docs/#A-schema-migration` | 任一份文件 |

## 跟 stakeholder 分享 template

```
Hi [Name],

正在做 KuiperAI 公開上線重設計，整套規劃在這：
https://redesign.kuiperfilmailab.com

包含：
- 33 個 UI mockup（中英文雙語）
- 7 份實作前規劃文件（schema/API/RBAC/pricing/第三方/觀測/法律）

預估 10,000 用戶月度淨毛利 ~84%，對標 Krea/Higgsfield 區間。

想聽你的回饋。
```
