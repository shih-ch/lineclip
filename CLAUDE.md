# SaveBot - P1 開發任務

## 目標
LINE Bot，收到 URL 後抓取網頁、轉 Markdown、Claude AI 摘要+標籤、存到 Notion（主要）或 GitHub（次要）。

## 技術棧
- Node.js + TypeScript
- Fastify（HTTP server）
- @line/bot-sdk（LINE）
- Playwright + Readability.js + Turndown（抓取）
- @anthropic-ai/sdk（AI）
- @notionhq/client（Notion，主要存儲）
- Octokit（GitHub，次要存儲）
- dotenv（環境變數）

## 環境變數（已在 .env 設定好）
- LINE_CHANNEL_SECRET
- LINE_CHANNEL_ACCESS_TOKEN
- ANTHROPIC_API_KEY
- NOTION_API_KEY
- NOTION_DATABASE_ID
- DEFAULT_STORAGE=notion
- GITHUB_TOKEN
- GITHUB_OWNER
- GITHUB_REPO

## 專案結構
src/
├── server.ts
├── webhook/
│   └── handler.ts
├── pipeline/
│   ├── scraper.ts
│   ├── extractor.ts
│   └── converter.ts
├── ai/
│   └── processor.ts
├── storage/
│   ├── index.ts
│   ├── notion.ts
│   └── github.ts
└── utils/
    ├── url.ts
    └── reply.ts

## P1 任務清單
1. 初始化 TypeScript 專案（tsconfig, package.json）
2. Fastify server + LINE webhook handler + 簽名驗證
3. URL 偵測（訊息中自動偵測 URL）
4. 網頁抓取 pipeline（Playwright + Readability + Turndown）
5. AI 處理（摘要 + 標籤 + 分類），清除 JSON code fence
6. Notion 存儲（Title, URL, Summary, Tags, Category, Source, Saved At）
7. GitHub 存儲（notes/YYYY/MM/DD-{slug}.md，含 front matter）
8. LINE 回覆確認訊息（含 Notion 頁面連結）

## 已驗證（PoC 結果）
- 完整 pipeline 耗時約 4.6 秒（遠低於 LINE reply token 30 秒限制）
- CNA 等新聞網站抓取成功率高
- Claude AI 摘要/標籤品質良好

## 注意事項
- JSON 解析前要清除 ```json 和 ``` 
- 抓取失敗要有 fallback，回覆「抓取失敗，已儲存連結」
- Notion rich text block 上限 2000 字元，長文要分割
- 主要存儲是 Notion，GitHub 為選配
