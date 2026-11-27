# Inkade 长期整体架构设计（Architecture Blueprint）

> 目标：打造一个**纯 MIT / 宽松开源协议、全栈 TypeScript、面向多 ADE 生态（Claude Code / Codex / Cursor / OpenCode / MCP Agents）的跨平台个人与通用知识中枢**——同时承载「每日大纲与会话派发」与「Agent 长文调研报告沉浸式文章阅读」两大核心体验，并支持从个人零配置单机自托管平滑演进到多租户云托管。

---

## 1. 产品定位与不可妥协的架构原则

### 1.1 我们解决什么断层？

当前 AI 编程与研究工作流存在两个割裂世界：
1. **IDE / ADE 内置笔记**：离会话极近、context switch 极低，但数据锁死在单一工具内部，缺少网页剪藏入口，也缺少结构化长文调研知识库。
2. **传统多端笔记与知识库**：要么协议受限（AGPL/BSL/闭源），要么只暴露被动 MCP 工具，缺少常驻大纲工作台、条目级「一键转会话」以及会话状态双向同步。

**Inkade 的定位**：数据与权限中立的笔记底座 + 一等公民的 ADE 会话总线 + 宿主中立的开放集成协议。

### 1.2 五条架构铁律

1. **纯宽松开源栈（MIT / Apache-2.0 / BSD / ISC / CC0-1.0）**：核心代码与所有传递依赖禁止引入 AGPL/GPL/BSL，并由自动化 `bun run check:licenses` 门禁守护。
2. **双引擎内容模型，杜绝人写与 Agent 写互毁**：
   - `outline`（每日大纲）：基于稳定 `nodeId` 与 `fractional-indexing` 的节点树，按节点增量操作，绝不整篇覆盖，保证绑定在任意条目上的 ADE 会话永不断链；
   - `article` / `clip`（调研报告 & 网页剪藏）：以干净 Markdown + Heading 锚点为核心，基于 `remark` AST 偏移量做章节级 Patch，并自动生成完整版本历史与行级 Diff。
3. **服务端硬执行 Scoped 权限**：按 `Space`（支持子空间继承）、`Tag`（文档级操作严格校验）、`DocumentKind` 与权限级别（`read | append | write | admin` + 默认 `denyHardDelete`）在服务端强校验，REST、`/mcp`、FTS5 搜索与 SSE 订阅共用同一套授权核心。
4. **全栈 TypeScript 单仓单一真相源**：`packages/core` 定义全部领域契约（`types/` 模块化拆包）、名义 Branded IDs（`ids.ts`）、36 变体判别联合 `InkadeEvent`（`events.ts`）、单一来源 `INKADE_TOOL_DEFINITIONS`（`tool-definitions.ts`）、统一阅读排版常量与外观纯逻辑（`preferences.ts`）、7 套路由查询 Zod Schema（`route-search.ts`）、Zod Schema-First 校验（`z.input` / `z.output`）、Markdown/Diff/排序纯算法与权限判定逻辑，后端、Web、移动端、剪藏扩展及外部 ADE 插件共享同一套强类型协议。
5. **渐进式多端与协同**：一套 `cosscom/ui` Web 应用覆盖桌面浏览器 + 响应式手机 PWA + 宿主内嵌面板，结合 Scope 过滤 SSE 与 Yjs + IndexedDB 实现无缝多端协同，并通过 Tauri v2 桌面端与 MV3 Clipper 扩展覆盖完整工作流。

---

## 2. 系统总体分层与依赖方向

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  Surfaces (apps/)                    │  Open Host & External Adapters   │
│  • apps/web     (Web + Embed + PWA)  │  • Mode A: Pure /mcp + SSE       │
│  • apps/desktop (Tauri v2, Phase 2)  │  • Mode B: Layer 3 iframe/WebView│
│  • apps/clipper (MIT Clipper, Ph 2)  │  • Mode C: Layer 2 @inkade/views │
│                                      │  • Mode D: Layer 1 @inkade/sdk/react│
└──────────────────┬───────────────────┴──────────────────┬───────────────┘
                   │                                      │
                   ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Shared Client & Orchestration Layer (packages/)                        │
│  • packages/clipper-core (defuddle + turndown + liquidjs shared core)   │
│  • packages/views   (Zustand inkade:preferences:v1 + ./views/* lazy subpaths + react-virtual)│
│  • packages/ui      (cosscom/ui Base UI + Form/RHF + Tiptap + lazy Shiki + Outliner) │
│  • packages/i18n    (i18next + react-i18next, zh-CN & en-US catalogs)   │
│  • packages/ade-kit (Project→Space routing, Thread state sync, prompts) │
│  • packages/sdk     (6 subpaths: ./, ./offline, ./sync, ./tools,        │
│                     ./embed, ./react; domain resources/*.ts; pure SSE)  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ HTTP / SSE / Streamable HTTP MCP
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  apps/server (Hono 分层架构：Transport -> Auth/Cache -> Services -> Ports)│
│  • 12 域 REST (/api/v1/*) + /mcp     • pino 结构化日志 + X-Request-Id   │
│  • Better Auth + TokenScopeCache     • YjsSyncHub (y-protocols + 防抖落盘)│
│  • WorkspaceSpacesCache + SQL Pushdown• DocumentSummary + Service 事务编排│
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  packages/db (Drizzle ORM + 10 窄接口 Ports) + packages/core             │
│  • Single-source Migrations: drizzle/0000_init.sql + 0001_fts5.sql      │
│  • Storage: SQLite (WAL + FTS5) [v1.0] ─▶ PostgreSQL + pgvector [SaaS]  │
│  • Blobs:   Local FS [v1.0]            ─▶ S3 / Cloudflare R2   [SaaS]   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.1 服务端四层架构（杜绝 REST 与 `/mcp` 逻辑分叉）

1. **Transport 层**：
   - REST `/api/v1/*`（按业务域拆分为 `routes/v1/*.ts` 12 个域模块，由 `routes/api-v1.ts` 总装；Hono + `@hono/zod-validator`）；
   - 原生 Streamable HTTP `/mcp`（`@modelcontextprotocol/sdk`）；
   - SSE `/api/v1/events`（支持断线 `Last-Event-ID` 补推）；
   - WebSocket `/api/v1/sync/:docId`（基于 `y-protocols/sync` 与 `y-protocols/awareness`，支持 500ms 防抖 / 3s maxWait 持久化、最后一连接退出及停机同步 flush、房间清理时销毁 `ydoc`/`awareness`）；
   - 结构化日志采用 `pino` + `X-Request-Id` 请求相关性追踪中间件；
   - 所有 Transport 仅负责参数反序列化与响应映射，严禁直接导入 `drizzle-orm`、`InkadeSqliteDb` 或内联业务/权限判断。
2. **Principal & Hot-Reload Scoped Auth 中间件**：
   - 支持 Better Auth 浏览器会话（映射为 `ADMIN_USER_SCOPE`）与 `Bearer ink_...` Scoped Token；
   - 通过有界短 TTL `TokenScopeCache` + `TokenRuleRepo` 与 `WorkspaceSpacesCache` 加速热路径鉴权，并在空间变更、Token 权限修改/吊销或 SSE 事件触发时**同步失效**，确保权限修改下一条请求立即热生效。
3. **领域 Service 层（含 SQL Scope 下推与事务编排）**：
   - 包含核心业务 Service 及独立拆分的 `BootstrapService`、`AuditService`（提供 `runSuppressed` 捕获抑制）、`AuditRollbackService`；
   - 跨实体原子编排（大纲批量变更、未完成任务顺延、大纲修订回滚、标题重命名 `syncBacklinks` 联动重写）在 Service 层通过 `TransactionRunner.runInTx()` 事务原子执行，与单一数据源 `DocumentRepo` / `OutlineRepo` / `RevisionLinkRepo` 协同完成：`Scope 硬校验 → 乐观锁 expectedVersion 检查 → 数据写入 → document_revisions 快照 → document_links 双链图更新 → search_fts FTS5 同步 → SSE 广播`；
   - 列表检索（`GET /api/v1/documents`、`searchFts`、`WorkspaceService`）将空间子孙展开、`allowedKinds`、`tagAllowlist` 与真 `LIMIT/OFFSET` 直接下推至 SQL，并默认返回剔除 `contentMarkdown` / `contentJson` / `contentText` 的轻量 `DocumentSummary`。
4. **Repository 层 (`@inkade/db`)**：
   - 将原单体仓储彻底拆分为 `TransactionRunner` 与 10 个细粒度窄接口（`WorkspaceRepo`、`SpaceRepo`、`DocumentRepo`、`OutlineRepo`、`RevisionLinkRepo`、`ThreadBindingRepo`、`TokenRuleRepo`、`AuditRepo`、`AttachmentRepo`、`SearchConfigRepo`），由 `createSqliteRepositories` 组装，JSON 列解析统一通过 `@inkade/core` Zod `parseJsonWithSchema` 校验；
   - 数据库结构由 `drizzle/0000_init.sql`..`0003_v6_phase41_tasks.sql` 单一真相源迁移文件驱动，服务端与 CLI 工具 `db:reset` / `db:migrate` 复用同一 `migrate()` 流程。

### 2.2 前端状态、表单、交互基础设施与按需分包

1. **统一客户端偏好存储（Zustand `inkade:preferences:v1`）**：
   - `packages/views/src/lib/preferences-store.ts` 基于 `zustand/middleware`（`persist` + `createJSONStorage`）与 `useShallow` 选择器 Hooks 统一托管主题、强调色、纸张模式、排印密度、阅读字体/字号/行距/栏宽、侧栏样式与任务/列表偏好；
   - `apps/web/index.html` 首屏防闪烁脚本直接读取 `inkade:preferences:v1` 预注入类名与排版 CSS 变量；跨标签 `storage` 监听、`PreferencesServerSyncBridge` 与受控 `ArticleReader` 保持多端及宿主双向同步，彻底淘汰零散 `localStorage` 多键与 `CustomEvent` 总线。
2. **声明式表单校验与浏览器 Hook 收口**：
   - `@inkade/ui` 提供与 `cosscom/ui` 原语对齐的 `<Form>` / `<FormField>` / `<FormItem>` / `<FormLabel>` / `<FormControl>` / `<FormDescription>` / `<FormMessage>` 适配层，配合 `react-hook-form` + `@hookform/resolvers/zod` 与 `@inkade/i18n` `validation.*` 双语提示统一 Web 与 Clipper 表单验证（保证 `<form>` 仍作为 `DialogPopup` / `DrawerPopup` 直接子元素以维持弹性滚动约束）；
   - 响应断点与通用浏览器监听统一经由 `packages/ui/src/lib/breakpoints.ts`（`INKADE_BREAKPOINTS` / `INKADE_MEDIA_QUERIES`）和 `usehooks-ts` 收口。
3. **强类型路由搜索与 Subpath 懒加载**：
   - `apps/web/src/router.tsx` 将 `@inkade/core/route-search` 的 Zod Schema 作为 Standard Schema 直接传入 TanStack Router `validateSearch`（经 `schema.parse` 保持严格类型推导），消除手写正则/解析胶水与中间转发页，直接通过 `lazyRouteComponent` 懒加载 `@inkade/views/views/*`（`DailyOutlineView`、`DocumentDetailView`、`DocumentListView`、`TasksView`、`ThreadsView`）及重页面模块，并由 `apps/web/vite.config.ts` 按 React 框架、TanStack、UI 原语、表单/Zod、Tiptap/Yjs、Highlight、KaTeX、Markdown AST、Mermaid 与 FullCalendar（`vendor-calendar`）精细分包（保留 Shiki 按语言动态分片）。

---

## 3. 核心领域模型与数据库 Schema（15 张业务表 + Better Auth）

所有实体从 Day 1 携带 `workspaceId`，保证单机自托管（默认单 workspace）未来可零重构扩展为多租户 SaaS。

| 表 / 实体 | 核心字段 | 设计意图 |
| :--- | :--- | :--- |
| `workspaces` | `id`, `slug`, `name`, `ownerUserId`, `createdAt`, `updatedAt` | 多租户隔离边界；单机模式下默认初始化个人 workspace |
| `spaces` | `id`, `workspaceId`, `parentId`, `slug`, `name`, `icon`, `color`, `defaultKind`, `sortOrder`, `archivedAt`, `createdAt`, `updatedAt` | 多级目录树（如 `Daily` / `Inbox` / `Research` / `Projects/inkade`），同时作为 Scoped Token 的核心授权单元 |
| `documents` | `id`, `workspaceId`, `spaceId`, `kind` (`outline` \| `article` \| `clip`), `title`, `slug`, `dailyDate` (`YYYY-MM-DD`, 部分唯一索引), `contentMarkdown`, `contentJson`, `contentText`, `excerpt`, `sourceUrl`, `sourceMetaJson`, `propertiesJson`, `version`, `pinned`, `unreadAgentUpdate`, `lastEditedByType`, `trashedAt`, `createdAt`, `updatedAt` | 统一承载每日大纲、长文调研报告与网页剪藏；`dailyDate` 确保多端同时打开今日大纲幂等不分裂；系统内部承载文档（`isSystemInternalDocument`，如 `Tasks Inbox`）默认从通用列表、搜索与 Inbox 隔离；`unreadAgentUpdate` 精准驱动静默动态与变更对比提示 |
| `outline_nodes` | `id` (稳定 ID), `documentId`, `parentNodeId`, `orderKey` (Fractional Indexing), `contentMarkdown`, `contentText`, `checked`, `collapsed`, `priority`, `scheduledDate`, `scheduledSlot`, `scheduledStartMin`, `durationMin`, `dueDate`, `recurrenceRule`, `authorType` (`human` \| `agent`), `authorId`, `sourceBindingId`, `createdAt`, `updatedAt`, `deletedAt` | 每日大纲的原子条目表；支持任意层级缩进拖拽、精确分钟排期（Schedule vs Deadline 分离）与 Agent 精准追加子结论，绝不破坏行内会话绑定 |
| `document_tasks` | `id` (`tsk_*`), `workspaceId`, `documentId`, `text`, `checked`, `priority`, `scheduledDate`, `scheduledStartMin`, `scheduledSlot`, `dueDate`, `durationMin`, `recurrenceRule`, `lineNumber`, `updatedAt` | Phase 41 跨引擎文章/剪藏任务索引表：基于 `remark` AST 从 `article`/`clip` Markdown 抽取并回写 `- [ ]` 行，保留稳定任务 ID 并支持 SQL 级 Scope 下推 |
| `calendar_subscriptions` | `id` (`csub_*`), `workspaceId`, `name`, `url`, `color`, `enabled`, `etag`, `lastModified`, `lastSyncedAt`, `lastError`, `createdAt`, `updatedAt` | Phase 41 外部 ICS 只读日历订阅源与条件同步元数据（SSRF 校验、`ETag`/`Last-Modified`） |
| `calendar_events_cache` | `id` (`cevt_*`), `subscriptionId`, `workspaceId`, `uid`, `title`, `startAt`, `endAt`, `allDay`, `timezone`, `rrule`, `exdatesJson`, `updatedAt` | Phase 41 外部 ICS VEVENT/RRULE 缓存表，为 FullCalendar 时间轴提供 DST-aware 只读外部日程叠加 |
| `document_revisions` | `id`, `documentId`, `version`, `contentMarkdown`, `changeSummary`, `actorType`, `actorId`, `batchId`, `executionMode`, `reversedByAuditId`, `createdAt` | 每次长文/Agent 修订留痕，支持行级 Diff 审阅、Quiet Autonomy 批次归组与原子回滚（migration `0002`） |
| `document_tags` | `documentId`, `tag` | 跨 Space 组织专题与次级 Scope 过滤 |
| `document_links` | `id`, `workspaceId`, `sourceDocumentId`, `sourceNodeId?`, `targetDocumentId?`, `targetSlugOrTitle`, `anchorText`, `contextSnippet`, `createdAt` | 在事务内自动提取与维护 `[[wikilink]]` 图谱，直接支撑双链悬停 `PreviewCard` 与反向链接面板 |
| `ade_thread_bindings` | `id`, `workspaceId`, `documentId`, `nodeId?`, `selectionAnchorJson?`, `adeKind` (open slug, e.g. `claude-code` \| `codex` \| `cursor` \| `any`), `externalWorkspaceId`, `externalThreadId`, `deepLink`, `title`, `status` (`queued` \| `running` \| `waiting_input` \| `completed` \| `failed` \| `archived`), `lastSummary`, `unreadResult`, `parentBindingId?`, `progress_steps_json`, `pending_approval_json`, `steering_queue_json`, `lastSyncedAt`, `createdAt` | **核心协作实体**：把任意大纲条目、文章或文章划词锚点与外部 ADE 会话双向绑定，支持实时步骤进度、结构化阻塞决策请求（`blocking_question`）与在线纠偏队列 |
| `api_tokens` | `id`, `workspaceId`, `name`, `tokenHash`, `tokenPrefix`, `scopeJson`, `expiresAt`, `revokedAt`, `lastUsedAt`, `createdAt`, `updatedAt` | 细粒度权限凭证（支持随时热修改 Scope 与 Quiet Autonomy 执行档位联动，`denyHardDelete` 服务端硬锁定） |
| `audit_logs` | `id`, `workspaceId`, `principalKind`, `tokenId`, `transport`, `action`, `resource`, `spaceId`, `documentId`, `decision`, `before_revision_id`, `after_revision_id`, `diff_preview_json`, `batch_id`, `execution_mode`, `reversed_by_audit_id`, `reversible`, `irreversible_reason`, `createdAt` | **可逆操作账本**（SQLite migration `0002`）：完整记录 Agent 与人类写入前后修订指纹、批次归组（`batchId`）与执行模式，支撑下游级联影响分析、单步与整批（`rollbackBatch`）安全回滚 |
| `project_scope_rules` | `id`, `workspaceId`, `matchType` (`git_remote` \| `repo_name` \| `path_glob`), `pattern`, `writableSpaceIdsJson`, `readonlySpaceIdsJson`, `defaultInboxSpaceId`, `defaultResearchSpaceId`, `extraInstructions`, `priority`, `createdAt`, `updatedAt` | ADE 插件进入某代码库时按优先级自动切换对应笔记作用域与 Agent 上下文提示 |
| `attachments` | `id`, `workspaceId`, `documentId?`, `mimeType`, `byteSize`, `sha256`, `storageKey`, `filename`, `createdAt` | 统一本地/S3/R2 附件管理，支持 Agent 分步上传与内容去重 |
| `search_fts` (SQLite FTS5) | `entity_key`, `workspace_id`, `entity_type`, `document_id`, `node_id`, `space_id`, `kind`, `title`, `body` | 使用 `unicode61` 分词器的全文检索虚表；查询结果返回前强过 Scope 引擎过滤 |
| Better Auth 认证表 | `users`, `sessions`, `accounts`, `verifications` | 由 Better Auth + Drizzle 管理单机与多租户账号、会话、Passkey/OAuth 扩展底座 |

---

## 4. 双引擎内容与无损协作协议

### 4.1 每日大纲（`outline`）操作原语
- 每天自动幂等生成或打开 `Daily / YYYY-MM-DD`（`kind = 'outline'`，匹配 `dailyDate`）。
- 所有修改走节点原语：`create_outline_node`、`update_outline_node`、`move_outline_node`、`append_child_node`、`toggle_node_checked`、`rollover_unchecked_nodes`、`promote_node_to_article`。
- **条目级闭环**：
  1. 用户在 Web、手机 PWA 快记或嵌入大纲写下一条节点 `nod_xxx`；
  2. 点击「派发给 Agent」→ 选择目标项目与外部 Agent → 创建 `AdeThreadBinding`；
  3. 外部会话监听状态变化，实时回写 `status`、`lastSummary` 与 `unreadResult`，所有有权限的端通过 SSE 立即刷新状态胶囊；
  4. 任务结束后，Agent 调用 `append_node_reply(parentNodeId = nod_xxx)` 写回结论，或调用 `create_document(kind: 'article')` 生成完整调研报告并把 `[[文档]]` 链接挂到该节点下。

### 4.2 长文调研与文章视图（`article` / `clip`）
- 调研 Agent 每天产出或迭代报告时：
  - 新报告：`create_document(kind: 'article', spaceId: 'Research/...', title, contentMarkdown, tags)`；
  - 增量更新：`patch_document_section(documentId, headingPath, mode: 'replace' | 'append' | 'prepend', markdown, expectedVersion)`（基于 `remark` AST 仅替换目标标题片段、乐观锁防并发覆盖、自动落库 `document_revisions` 并标记 `unreadAgentUpdate = true`）。
- 阅读体验：Web、PWA 与嵌入面板均提供**默认沉浸式文章阅读视图**（右侧/抽屉同步 TOC、宽表横向滚动、Shiki 代码高亮、Mermaid 渲染与灯箱、Agent 修订 Diff 审阅条、划词追问 Agent / 摘录回今日大纲、以及反向链接列表）。

---

## 5. Scoped 安全模型与原生 MCP 契约

### 5.1 Scope 结构（定义于 `packages/core`）

```ts
interface TokenScope {
  permission: "read" | "append" | "write" | "admin";
  spaceIds: readonly SpaceId[] | "*"; // "*" 表示全空间；数组表示 Branded SpaceId 白名单（默认继承所有子 Space）
  includeDescendants: boolean;       // 默认 true
  tagAllowlist?: readonly string[];  // 非空时文档级操作必须命中至少一个允许标签
  allowedKinds?: readonly DocumentKind[];
  denyHardDelete: boolean;           // 默认 true，Agent 删除仅允许进入回收站
}
```

### 5.2 Streamable HTTP `/mcp` 全量工具集与 Resources

- **自省与发现**：`whoami_scope`、`list_spaces`、`search_documents`、`semantic_search`（Orama BM25 + 向量混合检索）、`list_documents`、`list_tasks`、`list_context_packs`、`read_context_pack`、`get_space_schema`、`upsert_space_schema`
- **文章与剪藏读写**：`get_document`、`create_document`、`patch_document_section`、`update_document`、`trash_document`、`list_revisions`、`get_revision_diff`、`acknowledge_silent` 等（Scoped 授权内常规写入遵循 Quiet Autonomy 直接静默执行，按 `X-Inkade-Batch-Id` / 会话聚合可整批回滚，不触发前置阻断审批）
- **大纲与跨引擎任务增量操作**：`get_daily_outline`、`append_outline_node`、`update_outline_node`、`append_node_reply`、`toggle_node_checked`、`reschedule_task`、`upsert_task`（支持以 `nod_*` 大纲任务与 `tsk_*` Markdown `- [ ]` 任务作为统一目标操作，含精确分钟 `scheduledStartMin`、Schedule vs Deadline 分离与 RRULE 重复周期）
- **ADE 会话与异常决策联动**：`bind_thread`、`update_thread_binding`、`claim_thread_binding`、`get_thread_binding`、`list_bound_threads`、`request_human_decision`（仅在 Agent 面临不可逆歧义或真实需要人类拍板时主动升级至收件箱「异常与阻塞」桶）
- **附件与统计**：`create_upload_url` 等
- **收件箱四桶模型（Unified 4-Bucket Inbox）**：`exceptions`（阻塞决策 / 并发冲突 / 运行失败，唯一触发红点角标）、`digest`（静默背景变更摘要与整批撤回）、`clips`（待整理剪藏/草稿）、`snoozed`（延后处理）
- **MCP Resources**：`inkade://scope`、`inkade://daily/today`、`inkade://doc/{id}`、`inkade://pack/{slug}`（Scope 交集过滤 + `gpt-tokenizer` BPE 预算裁剪上下文包）

---

## 6. 开放 ADE 无关集成架构（Four Integration Modes）

Inkade 主仓不内置特定第三方 ADE 代码。所有外部 Agent 开发者环境（Cursor、Claude Code、Codex、Windsurf、OpenCode、Cline、Zed 及任意自定义宿主插件）均通过开放 `AdeKind`（`@inkade/core`）与统一契约接入，完整配置示例见 [`docs/INTEGRATION-GUIDE.md`](./INTEGRATION-GUIDE.md)：

| 接入模式 | 适用宿主形态 | 复用层 / 协议 | 关键能力与边界保证 |
| :--- | :--- | :--- | :--- |
| **模式 A · 纯 MCP + SSE** | Cursor / Claude Code / Codex / OpenCode / Cline 等纯客户端 | `POST /mcp` + `ProjectScopeRule` + `GET /api/v1/events` | `@inkade/core` `INKADE_TOOL_DEFINITIONS` 统一工具定义并驱动 `/mcp` 与 `@inkade/sdk/tools` `INKADE_TOOL_CATALOG`；`claim_thread_binding` 与 `get_thread_binding` 认领回写；判别联合 `InkadeEvent` 中的瞬态 `agent.tool.started` / `agent.tool.finished` 经 `isEventVisibleToScope` 权限裁剪后实时推流 |
| **模式 B · Web iframe / WebView** | 支持嵌入 Web 面板的桌面或云端 ADE | `apps/web` `?embed=1` + `embedTicket` + `inkade.embed.v1` | URL `chrome` / `hide` / `theme` / `density` / `readonly` 裁剪；`X-Forwarded-Prefix` 动态 `<base>` 与条件 SW 抑制；60s 单次消费 `embedTicket` 兑换短期会话 Token；`@inkade/sdk/embed` `createInkadeEmbedHost` 锁定 origin 完成双向导航、主题同步与线程派发委托 |
| **模式 C · 同栈 React 模块** | 希望直接以组件树嵌入业务的 React Web 宿主 | `@inkade/views` + `@inkade/ui` + `@inkade/sdk/react` | 零路由假设（通过 `InkadeNavigationAdapter` 与 `InkadeHostActions` 端口注入），完整复用 7 大核心视图（`SpaceTreeView` / `DailyOutlineView` / `DocumentDetailView` / `DocumentListView` / `TasksView` / `ThreadsView` / `InboxView`）并支持长列表虚拟化（`@tanstack/react-virtual`） |
| **模式 D · 无 DOM 原生端** | React Native、终端 TUI、后台 Daemon / CLI | `@inkade/sdk` + `./offline` + `./react` + `@inkade/ade-kit` | 由 `tsconfig.react-headless.json` 与根包纯净测试强制校验零 DOM / 零 Yjs / 零 Zod；领域命名空间客户端（`client.documents.*` 等）+ `inkadeQueries` + Typed Mutations 与离线队列直接共享 |

---

## 7. 开放生态与多端部署演进

技术选型与决策细节见 [`docs/TECH-STACK.md`](./TECH-STACK.md)，自托管与云端部署指南见 [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md)，开放宿主集成规范见 [`docs/INTEGRATION-GUIDE.md`](./INTEGRATION-GUIDE.md)。

单仓原生涵盖 `apps/server`（SQLite WAL + FTS5 + Yjs WebSocket）、`apps/web`（React 19 PWA）、`apps/clipper`（Chrome/Firefox MV3）与 `apps/desktop`（Tauri v2），同时保持清晰仓储 Port 与存储抽象以支持向 PostgreSQL + S3/R2 多租户云托管平滑扩展。
