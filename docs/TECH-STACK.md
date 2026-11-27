# Inkade 技术选型与架构决策记录（Tech Stack & ADRs）

本文档记录 Inkade 在项目启动与 v1.0 定盘阶段对每一层技术栈的深度权衡、开源库选型与最终决策，确保长期演进不偏离**纯宽松开源（MIT / Apache-2.0 / BSD / ISC / CC0-1.0）、全栈 TypeScript 同构、成熟库优先于重复造轮子、从单机平滑演进到多租户**的核心目标。

---

## 选型总览

| 分层 | 最终选型 | 开源协议 | 替代方案与未选用理由 |
| :--- | :--- | :--- | :--- |
| Monorepo & 运行时 | **Bun Workspaces (`bun@1.3.x`) + Node 24 兼容标准 ESM TypeScript** | MIT | 极速安装/测试体验与原生 SQLite 支持，且坚持 Web Standard API 确保 Node 24 / Docker 可移植 |
| 后端框架 | **Hono** | MIT | 相比 NestJS/Express 更轻、全类型安全、原生支持 Web Fetch/SSE/Streamable HTTP，未来可跑 Bun / Node / Docker / Edge |
| MCP 协议层 | **官方 `@modelcontextprotocol/sdk` + `@hono/mcp`（Streamable HTTP）** | MIT | 原生挂载在 `apps/server` 的 `/mcp`，与 REST 共用同一套 Auth + Scope 鉴权中间件，零额外桥接进程 |
| 数据库 & ORM | **Drizzle ORM + SQLite (WAL + FTS5) → PostgreSQL** | Apache-2.0 / Public Domain | 相比 Prisma 无重型二进制引擎、SQL 可控性强；单机零依赖启动，多租户阶段平滑迁 PG + `pgvector` |
| 认证 & 权限 | **Better Auth + 自建热生效 Scoped `api_tokens`** | MIT | 全栈 TS 原生适配 Drizzle；支持自托管单用户与未来多租户 OAuth/Passkey；Agent 细粒度权限完全自主可控 |
| Web 前端 | **React 19 + Vite + TanStack Router + TanStack Query + Zustand + React Hook Form + Tailwind v4** | MIT | 路由按需懒加载与查询缓存能力成熟，`zustand` 统一收敛客户端偏好存储，`react-hook-form` + `zod` 统一表单校验 |
| UI 组件体系 | **`cosscom/ui`（`@base-ui/react` + Tailwind v4 + CVA + Lucide）** | MIT / Apache-2.0 / ISC | 源码级 copy-paste 归属 `packages/ui`；基于 Base UI（MUI 团队无障碍底层），自带 `PreviewCard`、`Command`、`Toolbar`、`Drawer`、`Sidebar`、`Composer`、`Chat` 等现代组件，避开 Radix 历史包袱 |
| 富文本与大纲编辑器 | **Tiptap（MIT 核心）+ 自定义 `AdeThreadChip` 扩展 + 键盘原生大纲引擎** | MIT | 相比 Plate 更稳更可控、相比 BlockSuite 轻得多；ProseMirror 中文 IME 与自定义 NodeView 最稳，100% MIT 可控 |
| 实时与离线协同 | **Phase 1: Scope 过滤 SSE + 乐观更新；Phase 2: Yjs + IndexedDB** | MIT | 先靠原子 `outline_nodes` + `expectedVersion` 乐观锁实现丝滑多端同步；`packages/core` 预留 `SyncAdapter`，Phase 2 无痛接入 Yjs |
| 桌面端 | **Tauri v2** | MIT / Apache-2.0 | 复用 `apps/web`，安装包小（数 MB 级），提供全局快记快捷键、系统托盘与 ADE Deep Link；避免 Electron 内存包袱 |
| 移动端 | **Phase 1-2: 极致响应式 PWA + 快捷收集；Phase 3: Expo React Native** | MIT | 防止过早被 iOS/Android 商店审核与双端适配拖死；核心产品跑通后再复刻原生体验 |
| 网页剪藏与共享解析核 | **共享 `@inkade/clipper-core`（`defuddle/full` + `turndown` + `liquidjs`）+ 自研 React 19 MV3 扩展 + 共享 Tailwind v4 编译器（`scripts/tailwind-v4-compiler.ts`）** | MIT | Web 与扩展共享 `tailwindcss` + `@tailwindcss/oxide` 编译管线（严禁引入 MPL `lightningcss`），剪藏与服务端模板渲染统一收口至 `@inkade/clipper-core` 并复用 `@inkade/sdk/offline` 离线队列，严禁整仓 Fork 或引入 AGPL/MPL 依赖 |

---

## 模块级成熟开源库选型矩阵（禁止手搓脆弱轮子）

原则：凡涉及边界安全、树排序、AST 解析、文本 Diff、路径匹配、日期计算、拖拽、语法高亮、图表渲染、快捷键调度、ZIP 归档与无障碍原语，一律采用经过实战验证且许可证合规的成熟库。

| 所属模块 | 能力需求 | 选定开源库 | 协议 | 不自己手写的原因 |
| :--- | :--- | :--- | :--- | :--- |
| `packages/core` | 运行时契约校验 | `zod` (v4) | MIT | 单一 Schema 定义类型校验、REST 入参与 MCP Tool 参数校验 |
| `packages/core` | 前缀全局唯一名义 ID（Branded IDs） | `nanoid` + Branded Types | MIT | 密码学安全随机分布、`ids.ts` 边界解析与名义类型隔离，防止跨实体 ID 误传 |
| `packages/core` | 大纲节点 `orderKey` 排序 | `fractional-indexing` | CC0-1.0 | 避免浮点精度耗尽与连续同位置插入冲突 |
| `packages/core` | Markdown AST / TOC / GFM / Slug / 章节 Patch | `unified` + `remark-parse` + `remark-stringify` + `remark-gfm` + `mdast-util-to-string` + `github-slugger` | MIT / ISC | 正则解析 Markdown 会误匹配代码块内的 `#`、`[[link]]` 与 `#tag`；AST 偏移量可保证未改动章节字节级无损 |
| `packages/core` | 自然语言任务排期、RFC 5545 重复规则与 Markdown 任务双向同步 | `chrono-node` + `rrule-temporal` + `temporal-polyfill` | MIT / Apache-2.0 | 中英文自然日期/具体时刻识别与 DST-aware 重复任务实例化，并基于 `remark` AST 原位读写文章 `- [ ]` 行 |
| `packages/core` | 修订历史行级 Diff | `diff` | BSD-3-Clause | 标准 Myers Diff + Unified Patch 计算，直接支撑审阅条与修订对比 |
| `packages/core` | `ProjectScopeRule` 路径匹配 | `picomatch` | MIT | 高性能标准 glob 语义，兼容 Windows/POSIX 路径风格 |
| `packages/core` | Notion 数据库 / CSV 列推断与结构化导入 | `papaparse` + `zod` | MIT | 严格 RFC 4180 CSV 解析与零运行期异常字段映射；自动推导 Space 属性 Schema（`number` / `date` / `checkbox` / `url` / `select` / `text`）并绑定文档 Frontmatter 属性 |
| `packages/core` | Obsidian `[[WikiLink]]` AST 识别与双向链接重写 | `micromark-extension-wiki-link` + `mdast-util-wiki-link` + `unified` + `remark-frontmatter` | MIT | 基于真实 Markdown AST 提取与重连 `[[target#anchor\|alias]]` 与 `![[asset]]` 嵌入，彻底隔离行内代码与围栏代码块，避免正则误伤代码片段 |
| `packages/db` | ORM 与 SQLite 迁移工具链 | `drizzle-orm` + `drizzle-kit` + `bun:sqlite` | Apache-2.0 / MIT | 强类型 SQL 构建 + 单一真相源 `drizzle/` 迁移（`0000_init.sql`..`0008_v6_phase46_briefings.sql`），10 窄接口 Port + WAL/FTS5 混合查询 |
| `apps/server` | HTTP 路由与参数校验 | `hono` + `@hono/zod-validator` | MIT | Web Standard Request/Response、SSE 流原生支持、按域拆分路由 |
| `apps/server` | 定时 Agent 简报调度 | `croner` | MIT | 标准 5/6 字段 Cron 解析、IANA 时区支持、防重入保护（`protect: true`）与可控停机清理（`stop()`），零 GPL 风险 |
| `apps/server` | 原生 PDF 页文本提取与精读索引 | `unpdf` | MIT | 零原生二进制依赖的服务端 PDF 逐页文本解析引擎，直连 FTS5 与 `@orama/orama` 分块向量检索，兼容 `DocumentAsset` 与伴生大纲 |
| `apps/server` | RSS / Atom / JSON Feed 抓取解析 | `feedsmith` | MIT | 统一严格解析 RSS 2.0 / Atom 1.0 / JSON Feed 1.1，配合 SSRF 防护、`ETag`/`Last-Modified` 条件请求与 `@inkade/clipper-core` 正文清洗 |
| `apps/server` | 外部 ICS 日历解析与条件缓存同步 | `ts-ics` + `rrule-temporal` + `temporal-polyfill` | MIT / Apache-2.0 | 严格类型 VEVENT/EXDATE/RRULE 解析与 DST 展开，配合 SSRF 校验及 `ETag`/`Last-Modified` 条件同步 |
| `apps/server` | 实时协同与结构化日志 | `y-protocols` (`sync` / `awareness`) + `pino` | MIT | 标准 Yjs 二进制 Wire Protocol 替代手工字节编码；`pino` 输出零敏感信息（自动脱敏）的结构化 JSON 日志与 `X-Request-Id` 追踪 |
| `apps/server` | Streamable HTTP MCP 服务端 | `@modelcontextprotocol/sdk` + `@hono/mcp` | MIT | 官方协议栈，原生兼容 MCP Tools 与 Resources |
| `apps/server` | 认证与会话 | `better-auth` | MIT | Drizzle 原生适配器，支持多租户扩展 |
| `apps/server` | 完整 Markdown 知识库打包导出 | `fflate` | MIT | 极轻量零依赖流式 ZIP 生成 |
| `packages/ui` | 无障碍 UI 原语、表单、动效与设计体系 | `cosscom/ui` (`@base-ui/react`, `tailwindcss`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`) + `react-hook-form` + `@hookform/resolvers` + `usehooks-ts` + `@number-flow/react` | MIT / Apache-2.0 / ISC | 完整焦点管理、键盘导航、半透明细腻边界与暗色令牌；`<Form>` / `<FormField>` / `<FormMessage>` 统一接入 RHF + Zod，`usehooks-ts` 与 `INKADE_MEDIA_QUERIES` 替代零散浏览器事件/媒体查询手写，`@number-flow/react` 通过 Shadow DOM 隔离动画数字避免 `0123456789` DOM 文本泄漏 |
| `packages/views` | 路由无关业务视图、日程时间轴与统一客户端偏好状态 | `zustand` (`persist`) + `@tanstack/react-virtual` + `@fullcalendar/react` (v7 MIT 插件) + `react-hook-form` + `@hookform/resolvers` + `usehooks-ts` + `date-fns` | MIT | `usePreferencesStore`（唯一持久键 `inkade:preferences:v1`）取代分散 `localStorage` 多键与 `CustomEvent` 总线；列表/表格/队列统一虚拟化；FullCalendar v7（`timegrid`/`daygrid`/`interaction`/`themes/classic`）实现 Day/Week 时间轴、Anytime 拖入、`15m` Resize 落库与只读 ICS 叠加，并独立打包至 `vendor-calendar` |
| `packages/clipper-core` | 跨扩展/服务端共享网页提取、Markdown 与模板引擎 | `defuddle/full` + `turndown` + `liquidjs` | MIT | 统一网页正文提取、GFM/KaTeX/代码块转换与沙箱化 `Liquid` Declarative Template 编译，由 `apps/clipper` 与 `apps/server` 共用，杜绝双端逻辑漂移 |
| `packages/ui` (Editor/Reader) | 富文本编辑与 Markdown 双向桥接 | `@tiptap/react` + `@tiptap/starter-kit` + `@tiptap/markdown` + `@tiptap/extension-*` | MIT | 中文 IME 稳健、NodeView 嵌入交互式 `AdeThreadChip` |
| `packages/ui` (Outliner DnD) | 大纲树跨层级拖拽排序与双向镜像节点 | `@atlaskit/pragmatic-drag-and-drop` | Apache-2.0 | 浏览器原生 Pointer/HTML5 事件封装，支持树形投影、大列表、跨文档双向 Mirror 节点与 `inkade://doc/{id}#node={nodeId}` 块深链 |
| `packages/ui` (PDF Reader) | 原生 PDF Canvas/TextLayer 精读与坐标高亮 | `pdfjs-dist` | Apache-2.0 | 浏览器端 Web Worker 离线分片懒加载（独立 `vendor-pdf` Chunk），支持选区归一化百分比坐标矩形标注与页码跳转闪烁 |
| `packages/ui` (Article/Diagram) | 文章沉浸阅读、代码高亮、图表、HTML 导出 | `react-markdown` + `rehype-slug` + `shiki` (`shiki/core`) + `mermaid` + `remark-rehype` + `rehype-stringify` | MIT | 出版级排版渲染、按需懒加载语言 grammar 的双主题 `shiki/core`（JS Regex 引擎零 WASM 依赖，取代 `lowlight`）、离线流程图；独立 HTML 导出全量走 AST 管道（彻底消灭正则解析并自动中和原始 HTML） |
| `packages/sdk` | Subpath 分包、SSE 解析与本地同步 | `eventsource-parser` + `idb` + `y-protocols` + `@tanstack/react-query` | MIT / ISC | 拆分 `.` / `./offline` / `./sync` / `./tools` / `./embed` / `./react`（根目录零 Yjs/DOM/Zod）；统一 WHATWG SSE 跨包 `\r\n` 与 `retry:` 解析、标准 IndexedDB 包装、`queryOptions` 与标准 Mutation Hooks |
| `packages/i18n` | 跨端国际化与强类型文案 | `i18next` + `react-i18next` | MIT | 零打包器宏依赖，Web / UI / Desktop / RN 统一共享 `zh-CN` / `en-US` 词典 |
| 根工程门禁 | 硬编码文案 Lint 阻断 | `eslint` + `@typescript-eslint/parser` + `eslint-plugin-i18next`（+ `scripts/check-i18n.ts`） | MIT | 强制所有 UI 文本、占位符、ARIA 标签与 Toast 走 `@inkade/i18n`，配合 `check:i18n` 校验双语键对称 |
| `apps/web` | 路由、状态缓存、懒加载分包、快捷键与 PWA | `@tanstack/react-router` (`lazyRouteComponent` + Zod Standard Schema `validateSearch`) + `@tanstack/react-query` + `@tanstack/react-virtual` + `date-fns` + `tinykeys` + `vite-plugin-pwa` | MIT | 路由查询参数直接由 `@inkade/core` Zod Schema 校验，配合 `@inkade/views/views/*` 懒加载与 Vite `manualChunks` 拆分重依赖 |

---

## 关键架构决策记录（ADRs）

### ADR-001：为什么采用纯 MIT 技术积木自研核心平台？
- **背景**：部分既有开源知识库方案采用 AGPL-3.0 / BSL 1.1 等限制性许可，或耦合特定后端模型，难以在 Day 1 原生支撑「大纲节点 + 文章视图 + Scoped MCP + ADE 会话总线」。
- **决策**：采用全栈 TypeScript + 纯宽松许可积木自建核心平台。
- **权衡**：前期基建投入更多，但长期彻底避开传递性许可风险，确保开放集成与商用友好。

### ADR-002：为什么用「`outline_nodes` 节点表 + Markdown 文章」双引擎，而不是纯 Markdown 或纯 Block JSON？
- **背景**：纯 Markdown 文件在人/Agent 编辑后行号漂移，挂在某条想法上的 ADE 会话容易断链；而纯私有 Block JSON 导致 Agent 通过 MCP 读写长文调研报告时格式丢失且消耗大量 Token。
- **决策**：`outline` 类型以带稳定 `nodeId` 的结构化树表存储；`article` / `clip` 类型以干净 Markdown 为核心并辅以基于 `remark` AST 的章节级 Patch 与 `document_revisions` 历史快照。
- **结果**：同时满足条目级会话绑定不漂移、Agent 长文调研写入无损可读。

### ADR-003：为什么选 Tiptap（MIT）而不是 Plate 或 BlockSuite？
- **背景**：需要既能渲染极简现代文章视图，又能在编辑器里嵌入交互式 `AdeThreadChip`（显示外部 Agent 运行状态与一键跳转），同时保持轻量化以适应内嵌工作台场景。
- **决策**：选用 Tiptap（MIT 核心）+ 基于 `cosscom/ui` 定制的工具栏与 Slash 命令菜单。
- **理由**：ProseMirror 底层在中文 IME 输入、选区、自定义 NodeView 和 Yjs 集成上是行业最稳基线；不依赖商业扩展，100% MIT 可控。

### ADR-004：为什么先确立乐观锁 SSE 总线，再叠加 Yjs Real-time Sync？
- **背景**：Day 1 需要零冲突的大纲原子节点变更，并确保移动端与无 DOM 宿主也能轻量同步。
- **决策**：通过 `outline_nodes` 细粒度节点变更 + 文档乐观锁 `version` + 按 Scope 过滤的 SSE 实现轻量同步，并结合 Yjs (`y-protocols` + `/api/v1/sync/:docId`) 补齐多人/多端实时协同编辑。

### ADR-005：为什么服务端与外部宿主集成共用 `packages/core` 与 `packages/ade-kit`？
- **背景**：不同 AI 编码宿主（CLI / 桌面 / Web / 编辑器扩展）的集成形态差异很大。
- **决策**：将「项目仓库 → Space 自动匹配规则」「Scope 权限判定」「大纲 ↔ 会话状态机」「给 Agent 注入的精简上下文模板」全部下沉到纯 TS 包 `packages/core` 和 `packages/ade-kit`。
- **结果**：主仓保持彻底的宿主中立与纯净边界；所有具体宿主适配器均在独立仓库维护，通过 `/mcp` + `INKADE_TOOL_CATALOG`、Layer 3 可裁剪 Web 嵌入（反代 + `embedTicket` + `inkade.embed.v1`）、Layer 2 路由无关 `@inkade/views` 或 Layer 1 零 DOM `@inkade/sdk/react` 接入。

### 决策补充 · ADE 无关三层前端复用与开放集成架构

| 层次 | 包 / 产物 | 目标宿主 | 架构约束 |
| :--- | :--- | :--- | :--- |
| **后端契约** | `@inkade/core` + `@inkade/sdk`（`./tools`）+ `/mcp` + `/api/v1/events` | 所有 MCP 客户端与宿主 | 开放 `AdeKind`（开放 slug）、`@inkade/core` `INKADE_TOOL_DEFINITIONS` 单一工具定义（驱动 `/mcp` 与 `@inkade/sdk/tools` `INKADE_TOOL_CATALOG`）、36 变体判别联合 `InkadeEvent`（含瞬态 `agent.tool.started` / `agent.tool.finished` 实时感知）与 `claim_thread_binding` / `get_thread_binding` |
| **Layer 1** | `@inkade/sdk`（`.` / `./offline` / `./react`） | React Native / TUI / Daemon 等无 DOM 宿主 | 纯 HTTP 资源客户端 + 非 DOM 离线队列 + TanStack Query v5 `queryOptions` / Typed Mutations 与 SSE 同步，通过 `tsconfig.react-headless.json` 严格禁止 DOM 类型与 Yjs/Zod 污染 |
| **Layer 2** | `@inkade/views` | 同栈 React Web 应用 / 桌面壳 | 抽离 `SpaceTreeView`、`DailyOutlineView`、`DocumentDetailView`、`DocumentListView`、`TasksView`、`ThreadsView`，通过 `InkadeViewsProvider` 注入 `InkadeNavigationAdapter` 与 `InkadeHostActions` |
| **Layer 3** | `apps/web` 嵌入模式 | iframe / WebView 宿主 | URL 裁剪参数（`embed` / `chrome` / `hide` / `theme` / `density` / `readonly` / `host` / `embedTicket`）、相对 `./` 构建产物、`X-Forwarded-Prefix` 动态 `<base>` + 条件 SW 抑制、60s 单次 `embedTicket` 与 `inkade.embed.v1` 双向 `postMessage` Bridge |

### ADR-006：为什么复用 MIT `defuddle/full` + 自研架构，而不整仓 Fork `obsidian-clipper`？
- **背景**：网页剪藏的通用清洗难点（DOM 降噪、MathML→LaTeX、主流站点提取）已由 [`defuddle`](https://github.com/kepano/defuddle) 以 MIT 协议拆出；而传统扩展栈与 Inkade 全仓的 Bun + React 19 + `@inkade/core` + `@inkade/sdk` + `@inkade/i18n` 技术栈差异较大。
- **决策**：在 `apps/clipper` 中**采用纯 MIT 自研 MV3 架构**，直接使用 `defuddle/full` + 增强型 GFM Turndown + 洁净室自研中文/视频 `SiteAdapter` + 声明式模板过滤器引擎 + Shadow DOM 页内交互，并通过 `@inkade/sdk` 直连 Inkade 服务端（详见 [`docs/CLIPPER-ARCHITECTURE.md`](./CLIPPER-ARCHITECTURE.md)）。

### ADR-007：为什么选用 `cosscom/ui`（Base UI + Tailwind v4）作为唯一设计系统底座？
- **背景**：部分组件库组合浮层存在嵌套焦点冲突与维护割裂；而知识库应用高度依赖悬停预览卡（`PreviewCard`）、命令面板（`Command`）、文本选区工具条（`Toolbar`）、移动端抽屉（`Drawer`）、侧边栏布局（`Sidebar`）与对话组件（`Composer` / `Chat`）。
- **决策**：采用 100% MIT 协议的 [`cosscom/ui`](https://github.com/cosscom/ui)（基于 `@base-ui/react` 与 Tailwind v4），将组件源码按 `primitives / patterns / theme` 分层沉淀在 `packages/ui`。
- **结果**：拥有全部组件源码所有权；半透明细腻边框与中性色系统让高密度大纲与长文阅读具备清晰克制的视觉质感，同时通过 CSS 变量兼容任意宿主亮/暗主题。

### ADR-008：为什么设立自动化许可证门禁，并强制优先复用成熟开源库？
- **背景**：依赖树深处可能潜伏 GPL/AGPL/BSL/MPL 传递依赖，手动抽查极易遗漏；同时自写 Markdown 章节切分、排序编码或 Glob 匹配往往在特殊输入上埋雷。
- **决策**：在根仓库引入 `bun run check:licenses`（[scripts/check-licenses.ts](../scripts/check-licenses.ts)），每个阶段验收强制扫描全量 `node_modules`（允许 MIT / Apache-2.0 / BSD / ISC / CC0-1.0 / 0BSD / Unlicense，阻断 AGPL / GPL / LGPL / BSL / SSPL / 未确认 MPL）。
- **实践拦截记录**：该门禁已在首版研发期实际拦截并规避了两项隐性传递协议风险：
  1. 将 `mermaid` 锁定在 `~11.17.2`（避免 `mermaid@12` 引入 `elkjs` 的 `EPL-2.0 OR GPL-3.0-or-later`）；
  2. 在 `apps/web` 的 Vite 构建中直接使用 MIT 协议的 `tailwindcss` + `@tailwindcss/oxide` 实现 Tailwind v4 集成，避免 `@tailwindcss/vite` 传递引入 `lightningcss`（MPL-2.0）。
- **结果**：在不牺牲工程质量与交付稳定性的前提下，100% 守住商用友好的底层底线。

### ADR-009：前端工程化收口：`zustand` + `usehooks-ts` + `react-hook-form` + 路由级分包
- **背景**：随着 Web 与 Clipper 扩展功能增长，分散的 `localStorage` 多键、基于 `window.CustomEvent` 的状态/排版广播、手写媒体查询监听、零散 `useState` 表单校验及全量同步路由导入逐渐产生同步漂移与首屏包体膨胀风险。
- **决策**：
  1. 使用 **MIT 协议 `zustand`**（`persist` 中间件 + `useShallow` 选择器 Hooks）在 `packages/views/src/lib/preferences-store.ts` 建立单一状态真相源（统一存储键 `inkade:preferences:v1`），彻底替代旧 `localStorage` 多键、`CustomEvent` 总线与 `apps/web/src/lib/theme.ts` 状态镜像（仅保留无状态主题涟漪动效工具）；
  2. 引入 **`usehooks-ts`** 收口 `useMediaQuery`、`useEventListener`、`useResizeObserver`、`useCopyToClipboard`、`useDebounceValue` / `useDebounceCallback`、`useLocalStorage` 与 `useIsomorphicLayoutEffect`，并配合 `@inkade/ui` 的 `INKADE_BREAKPOINTS` / `INKADE_MEDIA_QUERIES` 集中管理响应式断点；
  3. 引入 **`react-hook-form` + `@hookform/resolvers/zod`** 与 `@inkade/ui` `<Form>` 原语体系，结合 `@inkade/i18n` 的 `validation.*` 双语错误词条，在保持 `DialogPopup` / `DrawerPopup` `[&>form]` 直接子元素约束的前提下实现声明式表单校验；
  4. 在 `packages/core/src/route-search.ts` 集中定义 7 套路由查询 Zod Schema，直连 TanStack Router Standard Schema `validateSearch`；同步暴露 `@inkade/views/views/*` 等 Subpath 导出并结合 `lazyRouteComponent` 与 Vite `manualChunks`，彻底消除路由转发壳页面并实现重依赖按需分片加载。

---

## V6 企业级成熟开源依赖与许可证总表（精确版本与 Workspace 分布）

> 以下清单经 `bun run check:licenses`（1441 个依赖包零 AGPL/GPL/BSL）与工作区 `package.json`、`node_modules` 实测核验：

| 开源库 | 声明版本范围 | 许可证 | Workspace Placement | 职责与核心用途 |
| :--- | :--- | :--- | :--- | :--- |
| `@number-flow/react` | `^0.6.2` | MIT | `@inkade/ui` | 独立数字滚轮原语 `NumberTicker`，无 `0123456789` DOM 字符柱污染且严守 `prefers-reduced-motion` |
| `chrono-node` | `^2.10.3` | MIT | `@inkade/core` | 中英文自然语言任务排期（如 `tomorrow 10:00` / `下周一`）确定性日期与时刻解析 |
| `rrule-temporal` | `^2.3.0` | MIT | `@inkade/core`, `apps/server` | RFC 5545 `RRULE` 跨时区/夏令时（DST-aware）重复任务实例化 |
| `temporal-polyfill` | `^1.0.8` | MIT | `@inkade/core`, `@inkade/views`, `apps/server` | TC39 Temporal API 标准时区日历运算垫片，支撑 `rrule-temporal` 与多时区调度 |
| `@fullcalendar/react` + `@fullcalendar/core` / `daygrid` / `timegrid` / `interaction` / `list` | `^7.1.5` | MIT | `@inkade/views` | 任务 `/tasks` Schedule × Deadline 日程视图（周/日视图、拖拽改期与缩放调时长） |
| `ts-ics` | `^2.4.9` | MIT | `apps/server` | RFC 5545 外部 `.ics` 日历订阅解析与只读叠加事件投影（配合 SSRF DNS/IP 防护） |
| `remark-frontmatter` | `^5.0.0` | MIT | `@inkade/core` | Markdown AST 解析与导出时的 YAML Frontmatter 块无损提取与回写 |
| `yaml` | `^2.9.1` | ISC | `@inkade/core` | YAML Frontmatter 与 ```` ```inkade-view``` ```` 块声明式查询规约解析与序列化 |
| `@tanstack/react-table` | `^8.21.3` | MIT | `@inkade/ui`, `@inkade/views` | Space 属性表（`table` 模式）动态列绑定、排序、行内编辑与 `inkade-view` 内嵌视图表格 |
| `papaparse` | `^5.7.1` | MIT | `@inkade/ui`, `@inkade/views`, `apps/server` | RFC 4180 CSV 解析与 Notion/CSV 列类型推断导入（`select` / `number` / `date` / `checkbox` / `url`） |
| `@atlaskit/pragmatic-drag-and-drop` | `^4.0.0` | Apache-2.0 | `@inkade/ui` | 大纲跨层级拖拽、大纲节点排序、`/library` 看板（Board）列间拖放改属性 |
| `ai` | `^7.0.181` | Apache-2.0 | `apps/server` | Vercel AI SDK 统一文本/流式生成、引用问答与结构化摘要网关（含离线检索降级回退） |
| `@ai-sdk/openai` | `^4.0.123` | Apache-2.0 | `apps/server` | OpenAI 模型与 Embedding Provider 适配器 |
| `@ai-sdk/anthropic` | `^4.0.108` | Apache-2.0 | `apps/server` | Anthropic Claude Chat Provider 适配器 |
| `@ai-sdk/openai-compatible` | `^3.0.94` | Apache-2.0 | `apps/server` | Ollama / DeepSeek / OpenRouter / 自建 OpenAI-compatible 网关适配器 |
| `gpt-tokenizer` | `^4.1.2` | MIT | `@inkade/core` | `o200k_base` 精确 Token 计数与 Context Pack `maxTokens` 预算确定性裁剪 |
| `@orama/orama` | `^3.1.18` | Apache-2.0 | `apps/server` | 纯本地内存 BM25 + 向量混合检索引擎，驱动 `/ask` 跨文档引用检索与相似文档召回 |
| `fflate` | `^0.8.2` | MIT | `apps/server` | 高性能零原生依赖 ZIP 解压/打包（Obsidian Vault 导入、工作区导档与 Garden 静态站点导出） |
| `unpdf` | `^2.2.2` | MIT | `apps/server` | 服务端 PDF 全文分页抽取，供 FTS5 索引、RAG 切块与页面蒸馏 |
| `pdfjs-dist` | `^6.5.438` | Apache-2.0 | `@inkade/ui` | 浏览器端 PDF Canvas/TextLayer 渲染（独立 `vendor-pdf` Chunk），支持选区归一化高亮标注与页码锚点跳转 |
| `feedsmith` | `^3.1.0` | MIT | `apps/server` | RSS / Atom / JSON Feed 统一解析，支撑 External RSS Feeds 定期同步摄入 |
| `micromark-extension-wiki-link` + `mdast-util-wiki-link` | `^0.0.4` / `^0.1.2` | MIT | `@inkade/core` | Remark/Micromark AST 级别 `[[WikiLink]]` 与 `![[Asset]]` 提取及重命名重写 |
| `react-resizable-panels` | `^4.24.2` | MIT | `@inkade/views`, `apps/web` | 桌面端分屏对照面板（Split View）无障碍可拖拽分隔条与比例持久化 |
| `sigma` + `@react-sigma/core` + `graphology` + `graphology-layout-forceatlas2` | `^4.0.6` / `^6.0.0` / `^0.26.0` / `^0.10.1` | MIT | `apps/web` | WebGL 大规模知识图谱渲染（`/graph`，独立 `vendor-graph` Chunk）、ForceAtlas2 布局与按空间/类型过滤 |
| `feed` | `^6.0.0` | MIT | `apps/server` | Digital Garden 公开花园标准 RSS 2.0 XML（`/site/:slug/feed.xml` 与 `/api/v1/public/sites/:slug/feed.xml`）生成 |
| `croner` | `^11.0.1` | MIT | `apps/server` | 标准 Cron 表达式解析、时区感知 `nextRunAt` 计算与定时 Agent Briefing 后台调度 |

### ADR-010：V6 企业级成熟开源积木全栈选型与许可证合规
- **背景**：V6（Phase 40–47）覆盖静默自治、Schedule×Deadline 双向日程、Space 属性 Schema 与表格/看板数据库视图、混合 RAG 引用问答与 Context Pack、Obsidian/PDF/RSS 数据摄入与双向大纲镜像、多标签分屏与 WebGL 知识图谱、Digital Garden 静态/RSS 发布以及 Cron 定时简报调度等重计算与复杂交互场景。若自行实现 Cron 时区、RRULE 重复规则、ZIP/ICS/RSS/PDF 解析、Token 分词或 WebGL 图渲染，将产生大量脆弱边界 Bug 且难以维护。
- **决策**：
  1. **严格许可证白名单门禁**：全量依赖仅选用 **MIT / Apache-2.0 / BSD / ISC**（零 AGPL/GPL/BSL），通过 `bun run check:licenses` 自动扫描 `package.json` 与 `bun.lock` / `node_modules` 强校验；特别是日历选用 `@fullcalendar/react` v7 的 MIT 开源插件集，PDF 选用 Apache-2.0 `pdfjs-dist` 与 MIT `unpdf`。
  2. **AST 与标准协议优先**：Frontmatter（`remark-frontmatter` + `yaml`）、Obsidian WikiLink（`micromark-extension-wiki-link` + `mdast-util-wiki-link`）、RFC 5545 重复规则/日历（`rrule-temporal` + `temporal-polyfill` + `ts-ics`）、Feed 摄入与发布（`feedsmith` + `feed`）、Token 预算（`gpt-tokenizer`）均在对应协议域采用标准库，禁止手写正则拆分代码块、CSV 或 Cron 下次触发时间。
  3. **客户端按需分包与离线降级**：重型依赖 `pdfjs-dist` 与 `sigma`/`graphology` 隔离在 `apps/web` 路由懒加载分片（`vendor-pdf` / `vendor-graph`）中，避免拖累首屏与移动端包体积；服务端 `@orama/orama` + `ai` SDK 支持外部未配置 LLM Key 时的本地确定性摘要与引用降级，保证全离线与 E2E 测试环境下 `/ask`、Context Pack 与 Scheduled Briefings 100% 可测可用。
  4. **单点边界与审计可逆**：所有写入路径（含静默批写、`x-inkade-batch-id`、Import Hub 提交、定时简报产出）共用 `AuditBatchId` 审计账本与 `TokenScope` 服务端强制下推（SQL Scope Pushdown + SSRF DNS 校验 + Public Site Allowlist 字段白名单），从底层消除跨空间越权与不可逆自动化风险。

