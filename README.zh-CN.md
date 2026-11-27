<div align="center">

<h1>Inkade</h1>

<p><strong>本地优先、纯 MIT 协议的 AI 时代个人知识库与 Agent 协作中枢</strong></p>

<p>
  <a href="./README.md">English</a>
  &nbsp;·&nbsp;
  <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
  &nbsp;·&nbsp;
  <a href="./docs/DEPLOYMENT.md">部署运维手册</a>
  &nbsp;·&nbsp;
  <a href="./docs/INTEGRATION-GUIDE.md">宿主集成指南</a>
  &nbsp;·&nbsp;
  <a href="./SECURITY.md">安全策略</a>
</p>

<p>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img alt="TypeScript Strict" src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg" />
  <img alt="MCP Streamable HTTP" src="https://img.shields.io/badge/MCP-Streamable%20HTTP-10b981.svg" />
  <img alt="双引擎: 大纲 + Markdown" src="https://img.shields.io/badge/%E5%8F%8C%E5%BC%95%E6%93%8E-%E5%A4%A7%E7%BA%B2%20%2B%20Markdown-171717.svg" />
  <img alt="SQLite WAL + FTS5" src="https://img.shields.io/badge/Storage-SQLite%20WAL%20%2B%20FTS5-0f766e.svg" />
</p>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/showcase/hero-article-sandbox-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="./docs/assets/showcase/hero-article-sandbox-light.png" />
  <img alt="Inkade 长文阅读器：双源隔离交互沙盒与页边批注审阅流" src="./docs/assets/showcase/hero-article-sandbox-light.png" width="100%" />
</picture>

</div>

---

## 为什么构建 Inkade？

当下的 AI 编程与研究工作流长期割裂在两个世界中：

- **ADE / IDE 内置便签**：离编码会话很近，但知识被锁死在单一客户端内部，缺少网页剪藏、长文调研排版、跨天任务管理与长期知识图谱沉淀。
- **传统笔记与知识库**（Notion、Obsidian、Logseq、Outline、Memos）：要么采用非完全宽松开源协议（如 AGPL / BSL / 闭源），要么仅靠外挂胶水对接 AI，缺乏节点级会话绑定、SQL 级硬授权边界与安全的交互式沙盒渲染能力。

**Inkade** 采用 **100% 宽松开源协议（MIT）** 与全栈严格 TypeScript 架构，提供三位一体方案：
1. **双引擎内容模型**：**稳定 `nodeId` 每日大纲树** + **干净 Markdown 长文与网页剪藏工作台**，彻底杜绝人类编辑与 Agent 写入互相覆盖、破坏引用或行号漂移。
2. **服务端 SQL 级硬边界（Scoped Access）**：`Space` 目录继承、标签白名单、文档类型约束与默认禁止硬删保护，在 REST API、原生 **Streamable HTTP `/mcp`**、FTS5 检索、SSE 实时流及 Yjs WebSocket 间统一生效。
3. **双源隔离交互式沙盒（Dual-Origin Artifacts）**：Agent 生成的交互式图表、算力模拟器与仪表盘运行于无 Cookie 隔离域名（`*.sandbox`），同时通过安全消息桥同步宿主 Light/Dark 设计令牌。

---

## 核心特性与实景预览

### 1. 双源隔离交互式沙盒（Interactive Artifacts）与页边批注（Marginalia）
Agent 可直接在长文内嵌入可拖拽/交互的 HTML 模拟器与实时仪表盘；画布运行于强隔离、零 Cookie 访问的双源 iframe 中，绑定数据源可追溯（`sources`），并与页面右侧批注审阅流（Marginalia）双向联动，一键将审阅意见防抖唤醒给在线 Agent 会话。

<details>
<summary>展开查看 Dark 深色模式双源沙盒实景截图</summary>
<br />
<img alt="Inkade Dark 模式双源沙盒与页边批注" src="./docs/assets/showcase/hero-article-sandbox-dark.png" width="100%" />
</details>

---

### 2. 每日大纲（Daily Outliner）与实时 ADE 会话总线
基于 `fractional-indexing` 与稳定节点 ID 组织每日工作流。任意想法条目可直接一键派发给 **Claude Code**、**Codex**、**OpenCode**、**Cursor**、**Windsurf**、**Cline** 等外部 Agent（开放 slug 设计，不绑定单一商业宿主），行内实时呈现 `Running` / `Done` 状态胶囊，并把 Agent 总结结构化写回子节点。

<img alt="Inkade 每日大纲与实时 Agent 线程绑定" src="./docs/assets/showcase/daily-outline-threads.png" width="100%" />

---

### 3. 全局任务中心（Tasks Kanban）
统一汇聚大纲待办节点（`outline_nodes`）与长文/剪藏中的 Markdown `- [ ]` 待办行（`document_tasks`），按 `Anytime`、`Today`、`Tomorrow`、`This Week`、`Upcoming` 五栏直观组织，支持自然语言排期、优先级标记（`P1`–`P3`）、耗时估算、来源文档一键跳转与 Agent 状态透传。

<img alt="Inkade 多时间跨度任务看板" src="./docs/assets/showcase/tasks-kanban.png" width="100%" />

---

### 4. WebGL 知识图谱（双向链接 · 大纲镜像 · 语义关联）
基于 Sigma WebGL 画布集中呈现显式 `[[Wikilink]]` 引用、跨大纲 `Outline Mirror` 绿色镜像连线以及 `@orama/orama` 语义相似连线，支持按 Space、文档类型与标签秒级筛选与力导向重排。

<img alt="Inkade WebGL 知识图谱" src="./docs/assets/showcase/knowledge-graph.png" width="100%" />

---

### 5. 16:9 演示模式与演者备注抽屉（Presentation Mode）
任意带 `---` 分页符的 Markdown 调研文档均可一键进入 16:9 演示舞台，完整支持 GFM 表格、Shiki 代码高亮、Mermaid 流程图与独立演者提示抽屉（`<!-- notes: ... -->` 在导出 `.docx` 时自动隔离，不外泄内部提词）。

<img alt="Inkade 16:9 演示模式与演者备注" src="./docs/assets/showcase/presentation-mode.png" width="100%" />

---

### 6. 一键连接 AI 与权限围栏控制台（`/connect`）
可视化签发按空间树、标签与文档类型受限的 Scoped Token（默认锁定 `denyHardDelete: true`），自动生成 **Claude Code**、**Codex**、**Cursor**、**OpenCode**、**Windsurf** 与 **Cline** 的 MCP 接入配置与只读诊断命令（`inkade doctor`），实时观测在线 Bridge 会话。

<img alt="Inkade AI 连接与 Scoped MCP 权限控制台" src="./docs/assets/showcase/connect-mcp-scopes.png" width="100%" />

---

## 与同类开源知识库对比

| 维度 | **Inkade** | Outline / AFFiNE / Memos | Obsidian（本地仓库） |
| :--- | :--- | :--- | :--- |
| **开源协议** | **100% MIT / 宽松依赖** | BSL-1.1 / AGPL / 混合协议 | 闭源应用 |
| **内容引擎** | **稳定大纲树 + 纯净 Markdown 双引擎** | 单一 Block JSON 或纯 Markdown | 本地 Markdown 文件 |
| **MCP 支持** | **原生内置 Streamable HTTP `/mcp`** | 依赖社区胶水桥接 | 社区插件 |
| **权限隔离** | **服务端 SQL 级下推（Space / 标签 / 类型）** | 通常仅工作区级或依赖 Prompt | 全盘本地文件系统暴露 |
| **交互式沙盒** | **双源无 Cookie 域名 + 主题令牌同步** | 无或同域弱隔离 | 受限本地脚本 |
| **Agent 会话同步** | **行内 `AdeThreadBinding` + 防抖主动唤醒** | 非原生能力 | 非原生能力 |

---

## 系统架构与单仓结构

Inkade 严格遵循依赖单一流向，将纯领域规则与基础设施解耦在干净的 Bun TypeScript Monorepo 中：

```text
packages/core          零 IO 领域契约（Zod v4）、TokenScope SQL 谓词下推、AST 与 Diff 纯算法
packages/i18n          100% 键对称的 zh-CN / en-US 双语词典，由 ESLint 与自动化脚本守护
packages/clipper-core  浏览器扩展与服务端共用的网页正文提取与 Liquid 模板核心
packages/db            Drizzle SQLite (WAL + FTS5) 10 窄接口仓储 Port + 单一来源迁移脚本
packages/sdk           分包清晰的 SDK（./、./offline、./sync、./tools、./embed、./react）
packages/ade-kit       宿主中立的工程→空间路由、线程状态同步与上下文裁剪工具
packages/cli           配套 CLI（inkade doctor / mcp-bridge / watch / nudge / hook）
packages/ui            cosscom/ui（Base UI + Tailwind v4）、Tiptap 编辑器、大纲、Shiki、Mermaid
packages/views         路由无关业务视图（通过 InkadeViewsProvider 注入任意 React 宿主）

apps/server            单进程 Hono HTTP 服务（/api/v1/* + /mcp + SSE + Yjs WS + Sandbox）
apps/web               React 19 + Vite 工作台与响应式移动端 PWA
apps/clipper           Manifest V3 浏览器网页剪藏扩展（Chrome / Firefox）
apps/desktop           Tauri v2 桌面外壳与全局快记悬浮窗
```

---

## 快速上手

### 方式一：本地开发启动（Bun）

前置依赖：[Bun `>= 1.3`](https://bun.sh)

```bash
git clone https://github.com/euanguo/inkade.git
cd inkade
bun install
```

双终端分别启动后端与前端开发服务器：

```bash
# 终端 1 — API、/mcp、SSE、Yjs WebSocket 与沙盒宿主（http://localhost:3456）
INKADE_LOCAL_AUTO_AUTH=true bun run dev:server

# 终端 2 — React + Vite Web 工作台（http://localhost:5173）
bun run dev:web
```

> **安全提示**：切勿在公网环境中设置 `INKADE_LOCAL_AUTO_AUTH=true`。公网部署请保持登录认证启用，并配合随机 32 字节以上的 `INKADE_AUTH_SECRET`。

可选：写入一份贴近真实研发场景的开源演示数据集（包含空间、双源沙盒长文、每日大纲 Agent 线程、看板任务与知识图谱）：

```bash
bun run scripts/seed-showcase.ts --url http://localhost:3456
```

---

### 方式二：单容器 Docker Compose 自托管（生产推荐）

```bash
cp .env.example .env
# 生成 64 位随机十六进制密钥，并填入 .env 的 INKADE_AUTH_SECRET 与 INKADE_BASE_URL：
openssl rand -hex 32

docker compose up -d --build
curl -fsS http://127.0.0.1:3456/api/v1/health
```

首次启动访问你的域名并完成**所有者（Owner）账号初始化**。首个管理员账号创建完成后，公开注册入口会自动上锁（`POST /api/auth/sign-up/*` 返回 `403 SIGNUP_DISABLED`，除非显式开启 `INKADE_ALLOW_SIGNUP=true`）。

---

### 方式三：接入任意 MCP Agent（`POST /mcp`）

前往 **Connect AI（`/connect`）** 或 **设置 → 权限令牌（Scoped Tokens）** 创建最小权限令牌，然后填入你的 Agent 配置：

```json
{
  "mcpServers": {
    "inkade": {
      "type": "http",
      "url": "http://localhost:3456/mcp",
      "headers": {
        "Authorization": "Bearer ink_your_scoped_token"
      }
    }
  }
}
```

关于四种宿主接入方式（**纯 MCP + SSE**、**Layer 3 `iframe` 嵌入**、**Layer 2 `@inkade/views`**、**Layer 1 无 DOM `@inkade/sdk/react`**），请参阅 [`docs/INTEGRATION-GUIDE.md`](./docs/INTEGRATION-GUIDE.md)。

---

## 部署架构选型与 Cloudflare 适配说明

在对外部署时，推荐重点评估以下三种运行拓扑：

- **VPS + Docker Compose + Caddy / Nginx（综合首选）**：单容器一体化承载 HTTP、`/mcp`、SSE 长连接（`/api/v1/events`）、Yjs WebSocket 实时协同（`/api/v1/sync/:docId`）、前端静态 PWA 以及本地 SQLite WAL + 附件持久化卷。反向代理注意关闭 SSE 响应缓冲即可。
- **家庭主机 / 廉价小鸡 + Cloudflare Tunnel（`cloudflared`）+ Cloudflare R2 备份（零开端口推荐）**：无需公网 IP 或开放防火墙入站端口即可通过 Cloudflare 边缘网络安全暴露 `127.0.0.1:3456`，并利用 Litestream 或 `sqlite3 .backup` 将增量快照同步至 R2。需注意 Cloudflare 免费版 Universal SSL 仅覆盖一级泛域名（如 `*.sandbox-domain.com`），不直接覆盖 `*.sandbox.example.com`。
- **纯 Cloudflare Workers + D1 + Pages（当前暂不直接支持）**：由于当前服务端依赖 `bun:sqlite` WAL/FTS5 混合查询、有状态 `Bun.serve` WebSocket Yjs 同步房间、本地持久化目录 `INKADE_DATA_DIR`、内存 `@orama/orama` 索引以及 `croner` 常驻调度，无法直接无状态部署进 Workers isolate；面向多租户无服务器演进的 PostgreSQL + S3/R2 扩展路径留有清晰仓储 Port 边界。

完整的环境变量清单、Caddy/Nginx 配置模板、Cloudflare Tunnel 避坑及线上 SQLite 备份恢复手册，请查看 **[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)**。

---

## 工程质量与合规门禁

项目全量门禁覆盖许可证扫描、国际化对称性、动效规范、架构边界 Lint、类型检查、单测与端到端冒烟验证：

```bash
bun run check:licenses    # 校验全部直接与传递依赖为 MIT / Apache-2.0 / BSD / ISC / CC0
bun run check:i18n        # 校验 zh-CN / en-US 词典 100% 键对称及插值一致
bun run check:motion      # 校验 UI 动效统一使用受控动效原语
bun run lint              # 拦截跨层直接依赖 Drizzle 与未走 i18n 的硬编码文本
bun run typecheck         # 全仓严格 TypeScript 类型检查（含 @inkade/sdk/react 无 DOM 校验）
bun run build:web         # 构建生产环境 PWA 前端资源
bun test                  # 执行全仓单元测试与集成测试
bun run verify:e2e        # 运行真实 HTTP + /mcp + SSE + PWA 端到端冒烟测试
```

---

## 开源许可

本项目基于 **[MIT License](./LICENSE)** 开源，依赖树中禁止引入任何 AGPL / GPL / BSL 组件。
