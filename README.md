# LineClip

LINE Bot - 傳送 URL 自動抓取網頁、AI 分類/標籤/摘要，儲存到 Notion。

## 功能

- 在 LINE 聊天中傳送 URL，自動儲存到 Notion
- Playwright 抓取網頁 + Readability 萃取文章 + Turndown 轉 Markdown
- Claude AI 自動分類、標籤、摘要（可在設定中開關）
- 萃取文章圖片連結，一併存入 Notion
- Cloudflare Tunnel 自動更新 LINE Webhook URL
- 內建 Web 控制面板：啟動/停止服務、即時 log、AI 設定管理

## 前置需求

- Node.js 18+
- Playwright 瀏覽器
- Cloudflared

```bash
# 安裝 Playwright 瀏覽器
npx playwright install chromium

# 安裝 Cloudflared（Ubuntu/Debian）
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

---

## 申請 Token / API Key

### 1. LINE Messaging API

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 建立 **Provider**（如果還沒有）
3. 建立 **Messaging API Channel**
4. 在 **Basic settings** 取得：
   - `Channel secret` → `.env` 的 `LINE_CHANNEL_SECRET`
5. 在 **Messaging API** 頁面：
   - 點 **Issue** 產生 Channel access token (long-lived) → `.env` 的 `LINE_CHANNEL_ACCESS_TOKEN`
   - **Use webhook** 開啟（控制面板會自動設定 Webhook URL）

> **容易出錯的地方：**
> - Channel secret 和 Channel access token 是不同的值，不要搞混
> - 確認建立的是 **Messaging API** Channel，不是 LINE Login Channel
> - **Use webhook** 必須手動開啟，預設是關閉的
> - 不需要手動填 Webhook URL，控制面板啟動 Tunnel 後會自動更新

### 2. Anthropic API (Claude AI)

1. 前往 [Anthropic Console](https://console.anthropic.com/)
2. 建立帳號並設定付款方式
3. **API Keys** → **Create Key**
4. 複製 → `.env` 的 `ANTHROPIC_API_KEY`

> **容易出錯的地方：**
> - API key 格式為 `sk-ant-api03-...`，確認完整複製（很長）
> - 帳號需要有餘額，免費額度用完會收到 401 錯誤

### 3. Notion API

1. 前往 [Notion Integrations](https://www.notion.so/my-integrations)
2. 點 **New integration**
   - 名稱隨意（如 `LineClip`）
   - 選擇你的 workspace
   - Capabilities 勾選 **Read content**、**Insert content**、**Update content**
3. 複製 **Internal Integration Secret** → `.env` 的 `NOTION_API_KEY`

4. **建立 Notion Database**，需要以下欄位（名稱和類型必須完全一致）：

   | 欄位名稱  | 類型         |
   |----------|-------------|
   | Title    | Title (標題) |
   | URL      | URL         |
   | Summary  | Rich text   |
   | Tags     | Multi-select|
   | Category | Select      |
   | Source   | Select      |
   | Saved At | Date        |

5. **連結 Integration 到 Database**：
   - 打開 Database 頁面 → 右上角 `...` → **Connections** → 選你的 Integration → **Connect**

6. **取得 Database ID**：
   - 打開 Database，看瀏覽器網址列：
     ```
     https://www.notion.so/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=yyyyyyyy
                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                            這段就是 Database ID
     ```
   - 填入 `.env` 的 `NOTION_DATABASE_ID`

> **容易出錯的地方：**
> - **`NOTION_DATABASE_ID` 不要包含 `?v=...`**，只要前面 32 字元
> - Database 沒有連結 Integration → API 會回 404
> - 欄位名稱**大小寫必須一致**：`Title` 不是 `title`，`Saved At` 不是 `saved_at`
> - **`Source` 欄位類型必須是 Select**，不是 Rich text（這是最常見的錯誤）
> - 建議先手動在 Database 新增一筆測試資料，確認欄位都正確

### 4. GitHub Token（選配）

如果想同時存到 GitHub：

1. [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. **Generate new token (classic)** → 勾選 `repo`
3. 填入 `.env` 的 `GITHUB_TOKEN`、`GITHUB_OWNER`、`GITHUB_REPO`
4. `.env` 的 `DEFAULT_STORAGE` 改為 `github`

---

## 安裝

```bash
git clone https://github.com/shih-ch/lineclip.git
cd lineclip
npm install
npx playwright install chromium
```

## 設定

```bash
cp .env.example .env
# 編輯 .env 填入你的 token
```

`.env` 範本：

```env
LINE_CHANNEL_SECRET='your_channel_secret'
LINE_CHANNEL_ACCESS_TOKEN='your_channel_access_token'
ANTHROPIC_API_KEY='sk-ant-api03-...'
NOTION_API_KEY='ntn_...'
NOTION_DATABASE_ID='32字元的database_id_不要帶問號後面的'
DEFAULT_STORAGE=notion

# 選配
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=
```

---

## 使用方式

### 控制面板（推薦）

```bash
npm run panel
```

開啟 `http://localhost:3001`：

1. 設定 Port（預設 3000），按 **Start** 啟動 Server
2. 按 Tunnel **Start** → 自動建立 Cloudflare Tunnel
3. 等待 LINE webhook 狀態變綠燈 **verified**（約 10-15 秒）
4. 在 LINE 傳任何 URL → 自動存到 Notion

#### Dashboard
- Server / Tunnel 啟動停止
- Webhook URL 顯示 + 一鍵複製
- LINE webhook 連線狀態燈號（紅/黃/綠）
- 即時 log 查看，可篩選 Errors Only

#### Settings
- **Summary 開關**（預設關閉）：決定 AI 是否產生文章摘要
- **Categories**：新增/刪除分類，AI 必須從中選一個
- **Predefined Tags**：新增/刪除標籤，AI 優先從中挑選
- **Prompt Template**：完整的 AI prompt，支援變數 `{{categories}}` `{{tags}}` `{{title}}` `{{content}}` 等

### 手動啟動（不用控制面板）

```bash
npm run build
npm start
# 另一個 terminal
cloudflared tunnel --url http://localhost:3000
# 手動到 LINE Developers Console 設定 Webhook URL
```

---

## 專案結構

```
├── panel.js              # Web 控制面板（port 3001）
├── config.json            # AI 設定檔（分類/標籤/prompt）
├── src/
│   ├── server.ts          # Fastify HTTP server
│   ├── webhook/
│   │   └── handler.ts     # LINE webhook + pipeline 調度
│   ├── pipeline/
│   │   ├── scraper.ts     # Playwright 抓取 HTML
│   │   ├── extractor.ts   # Readability 萃取 + 圖片提取
│   │   └── converter.ts   # HTML → Markdown
│   ├── ai/
│   │   └── processor.ts   # Claude AI 分類/標籤/摘要
│   ├── storage/
│   │   ├── index.ts       # 存儲路由（Notion/GitHub）
│   │   ├── notion.ts      # Notion API 存儲
│   │   └── github.ts      # GitHub API 存儲
│   └── utils/
│       ├── url.ts         # URL 偵測
│       └── reply.ts       # LINE push message
```

---

## 故障排除

| 問題 | 原因 | 解法 |
|------|------|------|
| LINE Bot 沒反應 | Tunnel 沒跑或 webhook 沒更新 | 確認面板 LINE webhook 是綠燈 |
| LINE webhook 一直紅燈 | Tunnel URL 還沒生效 | 等待自動重試（最多 5 次） |
| Notion 404 | Database 沒連結 Integration | Database → ... → Connections → 加入 |
| Notion 400 `Source is expected to be select` | Source 欄位類型錯誤 | 改為 Select 類型 |
| Notion 400 `NOTION_DATABASE_ID` | ID 帶了 `?v=...` | 只保留 `?` 前面的 32 字元 |
| AI 回 401 | API key 過期或餘額不足 | 到 Anthropic Console 檢查 |
| `EADDRINUSE` port 被佔用 | 上次沒正確關閉 | `lsof -ti :3000 \| xargs kill` |

---

## License

MIT
