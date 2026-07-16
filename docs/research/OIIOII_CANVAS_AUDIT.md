# OiiOii UI／UX 與 Canvas 黑箱分析

日期：2026-07-16  
目標頁面：`https://www.oiioii.ai/space/a2af65e6-29b7-4a3d-acd5-185d12f4f394`

## 1. 分析目的

這份文件不是複製 OiiOii 的品牌或程式碼，而是從公開頁面、公開下載到瀏覽器的前端資源與可觀察行為中，抽取適合 Kuiper 的產品設計原則、互動模型與畫布能力。

分析結果分成三個證據等級：

- **A — 已直接確認**：公開 HTML、CSS、前端模組或可見畫面中存在。
- **B — 高可信推斷**：多個事件、狀態、元件與資料欄位互相印證，但尚未登入實際操作。
- **C — 待互動驗證**：只有功能入口、翻譯鍵或事件名稱，仍須在已登入畫布中操作。

伺服器端原始碼、私有 Prompt、模型路由、資料庫及付費權限不在分析範圍內。

## 2. 核心結論

OiiOii 的優勢不只是黑底加粉紅色，而是把複雜創作流程收斂成四層：

1. **全域工作區**：專案、資產、技能和帳號。
2. **無限畫布**：承載素材、生成結果、故事板和關係。
3. **情境工具**：只在選中某種節點時出現。
4. **節點 AI 對話**：AI 對話直接引用目前節點和相鄰內容。

Kuiper 已具備相當多底層功能。主要差距不在「能不能生成」，而是：

- 操作是否能在使用者當下的位置完成。
- 畫布狀態是否清楚可見。
- 工具是否依素材類型漸進顯示。
- AI 是否理解選中的節點與連線上下文。
- 生成、編輯和匯出是否形成一條連續工作流。

## 3. UI 視覺系統

### 3.1 已確認色彩

| 用途 | OiiOii 公開 token | Kuiper 建議 |
|---|---:|---:|
| 全站背景 | `#000000` | `#050506` |
| 基礎表面 | `#0d0d0d` | `#111113` |
| 一般面板 | `#111111` / `#1a1a1a` | `#111113` / `#1a1a1e` |
| 強調面板 | `#262626` | `#222228` |
| 一般邊框 | `rgba(255,255,255,.06)` | `rgba(255,255,255,.07)` |
| 強調邊框 | `rgba(255,255,255,.10)` | `rgba(255,255,255,.13)` |
| 品牌主色 | `#ff1eb4` | `#ff2eaf` |
| 品牌文字 | `#ff6cc2` | `#ff8ad8` |
| 畫布格線 | `rgba(255,255,255,.28)` | 建議降低至 `.12–.18` |

OiiOii 同時為不同 AI agent 配置專屬色彩：

- 編劇：紫色
- 角色設計：黃色
- 場景設計：橘紅
- 分鏡：藍色
- 聲音：綠色
- 美術／藝術指導：粉紅

這些顏色用於「角色識別」而不是全站導航。Kuiper 可以沿用這個原則，但不應讓每個工具都擁有一套獨立品牌色。

### 3.2 版面邏輯

**A — 已確認**

- 左側使用窄版垂直導航。
- 頂部只放語言、點數、登入／帳號等全域功能。
- 首頁內容以橫向媒體卡片和分區捲動呈現。
- 面板大多沒有厚重陰影，以表面亮度和細邊框區分。
- 主要 CTA 使用高飽和粉紅；一般操作維持灰階。
- 彈窗採大圓角、高密度內容和固定底部 CTA。

### 3.3 UX 原則

1. **媒體優先**  
   圖片與影片是第一層資訊，文字只用來定位內容。

2. **單一主色**  
   主色只表達目前位置、主要動作與品牌，不用於所有按鈕。

3. **情境工具取代常駐工具**  
   未選取素材時保持安靜；選取後才出現工具列和屬性。

4. **漸進揭露**  
   初始畫面只提供「建立／上傳／輸入想法」，進階模型、比例和參數於需要時展開。

5. **狀態靠近結果**  
   排隊、生成、失敗、重試和下載狀態直接出現在節點或素材卡上。

6. **全域 AI＋局部 AI**  
   全域對話負責規劃，節點 mini chat 負責修改當前素材。

### 3.4 登入後畫布的視覺語言

**A — 已直接確認**

- **黑階不是單一純黑**：畫布使用近黑背景；浮動控制、輸入器和選單以不同明度的黑灰表面分層。
- **點陣格線保持低對比**：只協助定位，不與素材競爭；縮放後仍能感覺畫布尺度。
- **品牌粉紅只落在關鍵位置**：Logo、建立按鈕、送出按鈕和少量狀態標籤；其餘控制維持白灰色。
- **工作流範本使用分類色**：角色、場景、道具、商品廣告各自有色彩，但色彩被限制在卡片區域，不污染全域導航。
- **浮動元件使用膠囊形狀**：左上專案列、右上帳戶列、底部 composer、縮放控制皆像漂浮在畫布上的獨立島嶼。
- **容器圓角大、內部控制圓角小**：形成清楚的父子層次，而不是所有元件使用相同圓角。
- **邊框比陰影重要**：以一像素低對比描邊和表面明度界定元件；陰影只負責將大型浮動層從畫布稍微抬起。
- **文字層級克制**：專案名稱使用粗體高對比；操作名稱中等對比；提示與快捷鍵降低亮度。
- **圖示採線性、單色、小尺寸**：只有主要建立與送出動作使用實心色彩。
- **安全區充足**：畫布中央沒有固定 UI；主要元件貼近四周，底部 composer 保留左右呼吸空間。

### 3.5 可轉化成 Kuiper token 的方向

以下不是複製 OiiOii token，而是依其視覺策略轉化成 Kuiper 自有系統：

| 類別 | Kuiper 原則 |
|---|---|
| Canvas | `#050506`，比純黑稍有層次 |
| Raised surface | `#111113` |
| Overlay surface | `#1A1A1E` |
| Primary | Kuiper magenta `#FF2EAF` |
| AI accent | 紫色 `#806CFF`，只用於 AI 生成時刻 |
| Editorial accent | 金色 `#CDA447`，只用於定稿／高價值輸出 |
| Border | 白色 7%／13% 兩級 |
| Radius | input 8、card 12、modal 16、hero 24、pill 9999 |
| Spacing | 4px 基準，主要畫布 gutter 24px |
| Elevation | 優先表面明度與邊框，避免發光玻璃效果 |
| Motion | hover 120ms、狀態 200ms、面板 320ms |

Kuiper 應保留自己的「影像製作／導演」性格：比 OiiOii 少一點玩具感，多一點剪接台與攝影器材的精密感。粉紅負責品牌與主動作，金色負責定稿與交付，紫色只負責 AI 執行狀態。

### 3.6 元件構圖規則

```text
左上：專案身份與專案級操作
右上：發佈、點數、帳戶
右側：建立／選取工具
右下：縮放、小地圖、面板
底部中央：AI composer
底部上方：可滑動的任務範本
中央：永遠優先保留給素材與節點
```

Kuiper 改版時應把這種「周邊控制、中央創作」視為版面規則，而不是只換一套黑粉配色。

## 4. Canvas 技術與資料模型

### 4.1 畫布引擎

**A — 已確認**

- 前端包含完整 `tldraw` 畫布能力及客製 shape。
- 支援自訂節點、端點、edge、group、frame 和時間軸。
- 具有工作區文件管理、快照重播及持久化管理器。
- 有獨立的節點資料、edge 資料和 layout 儲存流程。
- 效能指標會記錄：
  - shape 總數
  - 實際渲染 shape 數
  - canvas node 數
  - edge 數
  - 選取數
  - zoom
  - 拖曳、縮放、平移和多選耗時

### 4.2 已確認節點／內容類型

- 圖片
- 影片
- 音訊
- 劇本
- 角色
- 場景
- 道具
- 分鏡
- 群組
- 故事板／時間軸內容
- AI 對話引用節點

### 4.3 節點引用模型

**A — 已確認**

AI 訊息可以包含：

- 資產引用
- inline asset tag
- node reference
- workflow tag
- Skill
- 圖片、影片、音訊參考

這代表 AI 不只是收到純文字 Prompt，而是能收到「目前正在討論哪個節點」的結構化上下文。

Kuiper 若要達到同級 UX，應建立統一的：

```ts
interface CanvasContextReference {
  nodeId: string
  assetId?: string
  nodeType: CanvasNodeType
  relation?: 'selected' | 'upstream' | 'downstream' | 'inline'
  snapshot?: {
    title: string
    prompt?: string
    mediaKey?: string
  }
}
```

AI route 不應自行重新掃描整張畫布，而應由前端明確提交有限、可追蹤的上下文。

## 5. 畫布互動能力

### 5.1 基礎導航與選取

**A — 已確認**

- 平移
- 滾輪／快捷鍵縮放
- 100% 檢視
- 縮放至全部內容
- 縮放至選取項目
- 單選、多選、全選、取消選取
- 框選
- 畫布格線
- 吸附模式
- 貼上到游標位置
- 邊緣自動捲動
- 減少動態效果
- 鍵盤無障礙移動與選取

### 5.2 排列與圖層

**A — 已確認**

- 左／中／右對齊
- 上／中／下對齊
- 水平／垂直平均分佈
- 水平／垂直堆疊
- 自動緊密排列
- 群組／解散群組
- 移到最上層／最下層
- 上移一層／下移一層
- 鎖定／解除鎖定
- 全部解除鎖定
- 水平／垂直翻轉
- 順／逆時針旋轉
- 拉伸
- frame 自動適應內容
- flatten 成圖片

### 5.3 剪貼簿與輸出

**A — 已確認**

- 剪下、複製、貼上、複製節點
- 複製為 PNG
- 複製為 SVG
- 匯出選取項目為 PNG／SVG
- 匯出全部為 PNG／SVG
- 下載原始素材
- 單張圖片下載
- 單支影片及 HD 影片下載
- 批次影片 ZIP／HD ZIP

### 5.4 節點連線

**A — 已確認**

- edge 建立與刪除
- source／target endpoint
- edge layout 與 routing
- edge 自動避讓
- edge 儲存及批次 upsert
- 相鄰節點上下文
- edge visibility 隨群組展開／收合改變

**B — 高可信推斷**

連線不只是視覺關係，也可能成為生成參考與 Agent 上下文來源。這與 Kuiper 現有 typed port 模型方向一致。

## 6. 畫布內圖片編輯

### 6.1 已確認工具

- 裁切
- 擴圖／outpaint
- 局部重繪／inpaint
- 移除選取區域
- 方框選取
- 筆刷選取
- 區域辨識
- 補光／relight
- 多視角生成
- 角色多視角
- Face ID 多視角
- 道具多視角
- 超解析
- 去背／matting
- 全景圖
- 圖片替換
- 標註後生成
- 參考圖綁定

### 6.2 局部重繪流程

公開模組顯示至少有兩種局部重繪選取方式：

1. **Box mode**：框出矩形區域。
2. **Brush mode**：以筆刷建立遮罩。

提交流程包含：

```text
選取圖片
→ 建立／修正遮罩
→ 上傳原圖與 mask
→ 建立 placeholder 節點
→ 提交 edit pipeline
→ 生成狀態顯示在 placeholder
→ 成功後替換或保留為新節點
```

這與 Kuiper 已完成的 Live Composite 遮罩筆刷有高度重用價值。建議把現有 mask stroke／raster 能力抽成共用套件，再建立圖片節點內的 Inpaint 面板。

### 6.3 補光流程

**A — 已確認**

Relight 會產生一張透明的光線提示圖，紀錄：

- 方位角
- 仰角
- 色溫
- 光線提示圖
- 原始圖片

這不是單純濾鏡，而是將使用者畫的光線方向轉換成模型輸入。

## 7. 影片與故事板能力

### 7.1 影片節點

- 圖生影片
- 文字生影片
- 首／尾幀擷取
- 任意目前幀擷取
- 裁切預覽
- 一般／HD 下載
- 重新生成
- 影片參考
- 不同模型切換

### 7.2 故事板

**A — 已確認**

- 分鏡圖片生成
- 分鏡影片生成
- 故事板卡片
- 分鏡偏好設定
- 分鏡網格圖選項
- 單個分鏡重做
- 刪除、還原、拆分、插入
- 影片裁切
- 批次生成圖片與影片
- 上一鏡尾幀作為下一鏡首幀的連續性約束

### 7.3 音樂與時間軸

**A — 已確認**

- Music Editor card
- 分鏡插入 MV
- 重做、拆分、還原
- timeline container
- timeline snap context
- 音訊作為畫布資源

實際時間軸編輯深度仍屬 **C — 待登入驗證**。

## 8. AI Agent UX

### 8.1 Agent 類型

公開資源包含：

- Script Writer
- Character Designer
- Scene Designer
- Storyboard Designer
- Art Director
- Sound Designer／Director
- IP Designer

### 8.2 對話形態

**A — 已確認**

- 全域 Agent 對話
- 節點 mini chat
- 多對話分頁
- 新建、重新命名、刪除、切換、收合對話
- Prompt mode 與 Agent mode
- 對話引用角色、場景、道具、劇本、故事板、圖片和影片
- Skill 可附加到訊息

### 8.3 對 Kuiper 的意義

Kuiper 不需要一開始就建立七個獨立 Agent。較小且完整的版本是：

1. 一個 Canvas Assistant。
2. 根據選中節點決定工具和 system context。
3. 使用明確的 Canvas tool calls 修改節點。
4. 每次修改保留可復原 transaction。

## 9. 非同步任務 UX

**A — 已確認**

圖片節點至少呈現以下狀態：

- queued
- queue estimate
- generating
- uploading
- failed
- sensitive content
- timeout
- retry
- regenerate
- upgrade／skip queue 提示

畫布另有：

- async task progress operation
- reconnect 提示
- manual refresh required
- placeholder node
- stalled upload

Kuiper 現在已有 Task spine，但應把任務狀態直接整合到節點外框、edge 流動和節點 action 中，避免使用者需要到其他面板查看。

## 10. 公開可觀察資料流

已確認的部分端點／資料：

- `/media/generate_image_asset/submit`
- `/media/generate_video_asset/submit`
- `/media/video_generate/submit`
- `/media/batch_gen/history?workspaceId=`
- `/media/batch_gen/export?workspaceId=`
- `/api/upload`

常見識別欄位：

- `workspaceId`
- `assetId`
- `shapeId`
- `nodeId`
- `storyboardId`
- `conversationId`
- `taskId`
- `edgeId`
- `mcpMethodName`
- `modelVersion`

資料流推斷：

```text
畫布 shape
→ canvas node metadata
→ asset record
→ async task
→ generation result
→ node update
→ edge／group／storyboard 同步
```

## 11. Kuiper 現況對照

| 能力 | OiiOii | Kuiper 現況 | 建議 |
|---|---|---|---|
| 無限畫布 | tldraw custom shapes | React Flow | 保留 React Flow，不需更換引擎 |
| 節點與連線 | 完整 | 已完成 typed node／edge | 加強情境操作與 edge 語意 |
| 畫布持久化 | 完整 | 已完成 DB 持久化 | 加版本／復原 transaction |
| 群組 | 完整 | 已完成一般群組、分鏡組 | 補對齊、分佈、鎖定及收合 |
| 自動排列 | 完整 | 已有 optimize layout | 增加排列選單與可預測策略 |
| 圖片／影片生成 | 完整 | 已接 Playground Task spine | 狀態顯示直接整合到節點 |
| 劇本拆分分鏡 | 完整 | 已完成 5000 字拆分 | 加批次檢視、段落修正與重新排序 |
| 3D 導演台 | 未發現同等 3D blocking | Kuiper 已完成 | 這是 Kuiper 的差異化優勢 |
| Previz | 部分故事板影片 | Kuiper 已有機位／人物路徑預演 | 保留並提升 UX |
| 畫布內裁切 | 有 | 尚未完整 | P1 |
| Inpaint／Outpaint | 有 | 尚未整合到 Canvas | P1，重用 Live Composite mask |
| Relight | 有 | 尚未有 | P2 |
| 多視角 | 有 | 部分透過 Prompt | P2，做結構化操作 |
| 節點 mini chat | 有 | 尚未有 | P2 |
| 多 Agent | 有 | 尚未有 | 先做單一 Canvas Assistant |
| 影片時間軸 | 有 | 有鏡頭序列、Composition | 先整合，不做完整 NLE |
| 實拍遮罩合成 | 未見同等完整工具 | Kuiper 已完成 | Kuiper 差異化優勢 |

## 12. Kuiper 建議實作順序

### Phase A — 畫布操作成熟度

目標：不新增 AI 模型，先讓現有能力變得易用。

- 統一選取外框與狀態色。
- 右鍵情境選單。
- 多選浮動工具列。
- 對齊、分佈、群組、解散、鎖定、圖層。
- Zoom to fit／selection。
- Undo／redo transaction。
- 節點快速新增與連線後新增。
- 生成狀態直接呈現在節點和 edge。

### Phase B — 畫布內圖片編輯

- Crop。
- Brush／Box mask。
- Inpaint remove／replace。
- Outpaint。
- 將結果作為新節點或覆蓋版本。
- 重用 Live Composite：
  - normalized strokes
  - mask raster
  - brush controls
  - undo／redo

### Phase C — Canvas Assistant

- 右側全域 Assistant。
- 選中節點後顯示 mini composer。
- 明確提交 selected／upstream／downstream references。
- Tool calls：
  - create node
  - update prompt
  - connect nodes
  - generate
  - group
  - arrange
  - create storyboard
- 每次 AI 修改產生可復原 transaction。

### Phase D — 導演與合成整合

- 導演台送出的鏡頭保留機位 metadata。
- 分鏡節點可直接打開 3D blocking。
- Live Composite 輸出可成為 Canvas video node。
- 遮罩、背景和虛擬角色合成作為 composition node 的來源。
- Previz、AI 生成影片和實拍素材共享同一鏡頭序列。

## 13. 暫不建議照搬

- 不要把每個 Agent 都做成獨立服務與人格。
- 不要一開始就做完整瀏覽器 NLE。
- 不要更換 React Flow，只為了追求和 OiiOii 相同的畫布手感。
- 不要一次加入所有圖片編輯模型。
- 不要讓所有工具一直出現在畫面上。
- 不要複製 OiiOii 的品牌字型、Logo、素材或文案。

## 14. 已登入畫布現場驗證（2026-07-16）

本節來自登入後的新空白專案，僅開啟選單與檢查可見介面，沒有建立內容、送出生成、上傳素材或消耗點數。

### 14.1 空白畫布的資訊架構

- 主畫面採黑色點陣無限畫布，幾乎不放固定側欄，將最大面積留給內容。
- 專案資訊集中在左上大型膠囊：品牌、專案名稱、分享、更多操作。
- 帳戶與商業操作集中在右上：發佈、點數、會員升級、頭像。
- 建立與選取工具固定在右側垂直工具列。
- 縮放、小地圖與面板切換集中在右下。
- AI composer 固定在畫面底部中央，成為主要輸入入口。
- 新專案以橫向技能範本帶提供起點，不先顯示大量節點類型。

這套配置的核心不是「工具少」，而是依照工作階段分層顯示：

```text
全域專案操作
→ 畫布導航
→ 建立入口
→ AI 意圖輸入
→ 選中物件後的情境操作
```

### 14.2 現場確認的建立入口

空白畫布提示使用者可雙擊或右鍵建立畫框。右鍵選單實際包含：

- 貼上
- 復原
- 多選
- 一鍵整理
- 添加畫板
- 上傳

底部技能範本帶可見：

- 新增畫板
- 故事動畫
- 角色設計
- 場景設計
- 道具設計
- 商品展示廣告
- 所有技能

兩個入口承擔不同任務：右鍵選單是低干擾的通用畫布操作；技能範本是任務導向的快速開始。

### 14.3 現場確認的 AI composer

底部 composer 的提示文案明確支援拖曳或貼上圖片，並同時提供：

- 新增／附件
- 劇本
- Skill（含自訂狀態）
- Agent
- 風格
- 資產
- 送出

這代表其輸入模型不是單純 prompt，而是：

```text
文字意圖
+ 劇本
+ 技能工作流
+ 執行 Agent
+ 視覺風格
+ 專案資產
→ 畫布生成任務
```

Kuiper 不應照搬名稱，但可採用同一個 UX 原則：把「要做什麼、用什麼參考、輸出到哪裡」收斂成單一 composer，而不是讓使用者先理解所有節點。

### 14.4 現場確認的專案選單

專案更多選單可見：

- 盒飯使用
- 專案資源
- 重命名
- 刪除項目

此選單刻意不混入畫布編輯工具，顯示其專案層與內容層的操作邊界清楚。

### 14.5 對 Kuiper 的直接 UI 決策

1. Playground 首屏保留大畫布，將永久工具列縮減為導航、建立、縮放與面板切換。
2. 將「新增節點」改成兩層：
   - 右鍵／雙擊：通用節點與上傳。
   - 底部任務帶：分鏡、角色、場景、道具、實拍合成等工作流。
3. 建立 Kuiper Composer，輸入結構至少包含：
   - 劇本／prompt
   - 工作流
   - 參考資產
   - 當前選取
   - 生成模式
4. 導演台、Playground、Live Composite 不再是彼此孤立頁面；它們應成為 composer 可選工作流與節點可開啟的專用編輯器。
5. 空白狀態只保留一個主要說明和可滑動範本，避免同時顯示所有工具。
6. 專案操作、畫布操作、AI 任務操作使用不同區域與不同層級，避免目前 Kuiper 導航與功能入口互相競爭。

## 15. 尚待互動驗證

以下項目需在已登入 OiiOii 畫布實際操作後確認：

- 節點建立選單的完整類型與預設資料。
- 拖線後是否會自動啟動生成。
- edge 是否決定參考圖優先順序。
- 群組／故事板和時間軸的同步方式。
- Undo／redo 是否涵蓋伺服器生成結果。
- AI Agent tool call 修改畫布的確認機制。
- 多人協作游標、衝突與版本策略。
- 發佈、分享、viewer／editor 權限。
- 完整 API request／response schema。
