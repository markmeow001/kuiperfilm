---
name: "source-command-add-api"
description: "加入新的 AI provider 或外部 API"
---

# source-command-add-api

Use this skill when the user asks to run the migrated source command `add-api`.

## Command Template

加新 API 的標準流程,**任何一步偷懶都會在 guard 階段被擋下**:

## 1. 規格確認
- 用 context7 MCP 查官方最新文件,把 endpoint、auth、rate limit、錯誤格式抄一份到 `docs/integrations/<provider>.md`
- 確認這個 API 屬於哪一類:LLM / 圖像 / 影片 / 語音 / 儲存 / 其他

## 2. 走 capability catalog
**不准 hardcode model capabilities**(`scripts/guards/no-hardcoded-model-capabilities.mjs` 會擋):
- 在 capability catalog 註冊新 provider / model 與其能力(text / vision / image-gen / etc.)
- 在 pricing catalog 加成本資訊
- 跑 `npm run check:capability-catalog && npm run check:pricing-catalog`

## 3. 走 ai-runtime
**不准在 worker handler 直接 `import OpenAI from 'openai'`**(`scripts/guards/no-api-direct-llm-call.mjs` 會擋):
- 文字類 LLM → 透過 `src/lib/ai-runtime/`
- 媒體類 → 透過 `src/lib/media/` 對應 provider 抽象
- 配置 → 透過 config center,不直連 process.env(除了 `src/lib/env/` 內部)

## 4. 必要的測試
- Provider unit test:覆蓋成功 / 各種錯誤碼 / timeout / retry
- Integration test:API route → worker → ai-runtime → provider → 回寫 DB
- 在 fixture / mock 層加入 fake provider,**禁止呼叫 production endpoint 跑測試**

## 5. i18n
如果有對應的 prompt:`lib/prompts/.../*.zh.txt` 跟 `*.en.txt` 雙版本必須同時加。

## 6. 驗證
```bash
npm run check:config-center-guards
npm run test:guards
npm run test:regression
```

## 7. 文件
更新 master plan 對應 Phase,新增的檔案寫進清單。
