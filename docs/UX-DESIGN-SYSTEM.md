# Inkade v1.0 UI 交互模型与设计系统规范（UX & Design System）

> 本文档锁定 Inkade 首版（v1.0）的产品体验标杆、空间布局、键盘交互力学、阅读与编排流程，以及基于 **`cosscom/ui`（`@base-ui/react` + Tailwind v4）** 的视觉系统。目标是做出第一天就能作为高频主力工具使用的完整应用，而非粗糙 MVP。

---

## 1. 设计目标与产品取舍

| 关注维度 | 核心交互模式 | 主动克制的复杂性 |
| :--- | :--- | :--- |
| **每日大纲与会话派发** | 零摩擦每日大纲首页、条目旁直接挂 `AdeThreadChip` 一键派发对话，大纲节点稳定可绑定 | 数据开放互通，不锁定在单一宿主内，兼顾结构化长文与网页剪藏 |
| **Workflowy / Logseq / Tana** | 零延迟全键盘大纲力学（回车新建、Tab 缩进、Alt+↑/↓ 换位、Bullet Zoom-in 聚焦 + 面包屑）、昨日未完成任务一键结转 | 重度 Supertag/Schema 数据库配置负担、纯本地文本块解析导致的锚点漂移 |
| **Bear / Craft / Readwise Reader** | 调研报告默认杂志级沉浸阅读态、右侧滚动同步 TOC、宽表横向滚动、划词追问 Agent / 摘录回大纲、Agent 修改后自动弹 Diff 审阅条 | 用重型可视化积木块存储长文，导致 Agent 读写 Markdown 失真与 Token 浪费 |
| **Obsidian** | `[[双链]]` 自动补全、悬停 `PreviewCard` 预览、反向链接列表（Backlinks）、全库完整 Markdown + 附件一键 ZIP 导出 | 复杂的手动第三方文件同步配置 |
| **Linear / Raycast** | 全局 `⌘K` 命令与检索面板、100% 乐观更新、极简灰阶衬托高信息密度、严格的语义色克制 | 将轻量灵感笔记强行变成重型工单表单 |

---

## 2. 空间信息架构与响应式布局

### 2.1 桌面端（`>= 1024px`）：克制的三段式自适应骨架

1. **左栏：全局导航与空间树（可折叠，默认 `248px`）**
   - 顶部固定触发区：`⌘K` 搜索/命令入口、今日大纲（`Daily · Today`）快捷入口；
   - 四大主工作区：
     - **Daily（每日大纲）**：按日历时间线组织，永远一键直达今天；
     - **Inbox（收件箱）**：展示未整理的网页剪藏与手机/全局快记角标计数；
     - **Library（知识库）**：Space 树形目录（支持拖拽移动与右键归档）；
     - **Threads（会话总览）**：全平台按状态分栏的 ADE 会话控制台；
   - 底部管理区：Scoped Tokens & MCP 接入、Project Scope Rules、Settings（含一键 Markdown ZIP 导出）。
2. **中栏：主工作区（弹性自适应，无多余外框）**
   - `Daily`：沉浸居中的每日大纲画布（最大行宽 `760px`），顶部显示日期切换、未完成结转提示条与面包屑（Zoom-in 时出现）；
   - `Library`：默认进入文章沉浸阅读态（`70ch` 正文区），右侧可选展开 **同步 TOC**；按 `E` 或点击顶部切换进入编辑态；
   - `Threads`：按 `Waiting Input`（置顶提醒）→ `Running` → `Queued` → `Completed / Failed` 分组的高信噪比状态看板。
3. **右栏：上下文 Inspector（默认按需展开，`340px`，可折叠）**
   - 随当前焦点自动切换上下文标签：
     - **Bound Threads**：当前文档/选中节点绑定的所有 ADE 会话摘要、操作按钮（跳回 ADE / 归档 / 复制提示）；
     - **Backlinks**：引用当前文档的所有文章与每日大纲节点（精确显示源段落摘要与跳转）；
     - **Revisions**：版本时间线，点击任意版本直接高亮展示与当前版本的行级 Diff 与一键恢复按钮。

### 2.2 移动端响应式 PWA（`< 768px`）

- 左侧导航转为 Base UI `Drawer`；底部常驻轻量 Tab 栏（`Today` / `Inbox` / `Library` / `Threads`）+ 醒目的悬浮 **`+ 快记`** 触发器；
- 点击 `+ 快记` 在 `0.2s` 内弹出底部 `Drawer`：支持输入想法/链接，默认追加到今日大纲末尾或存入 `Inbox`，支持一键勾选「同时派发给 ADE（或留待电脑处理）」；
- 手机端阅读长文报告自动隐藏所有工具栏与侧边栏（Tap 顶部唤出），TOC 改为右下角悬浮触发的底部 `Drawer`。

---

## 3. 核心工作流与交互力学

### 3.1 `Daily` 每日大纲编辑器（`OutlineTreeEditor`）

每个节点都有稳定的数据库 `nodeId`，绝不以整篇文本覆盖保存。必须支持以下零妥协的交互力学：

- **全键盘编辑**：
  - `Enter`：在同级下方新建节点（若当前节点有子级且已展开，则新建为第一个子级）；
  - `Tab` / `Shift+Tab`：缩进为上一个兄弟节点的子级 / 提升到父级之后（更新 `parentNodeId` + `orderKey`）；
  - `Alt + ↑` / `Alt + ↓`：在同级内上下移动节点顺序（携带整棵子树）；
  - `Cmd/Ctrl + Enter`：在「普通条目 / 待办复选框 / 已完成」之间轮转；
  - `Cmd/Ctrl + .`：折叠/展开当前节点子树；
  - `Cmd/Ctrl + ↑` / `Cmd/Ctrl + ↓`：全树/当前聚焦子树一键折叠或展开；
  - `Backspace`（空节点）：先取消缩进，若已是顶层空节点且无绑定会话则删除并回退焦点至上一节点末尾；若挂有 `AdeThreadBinding` 则二次确认防止误删关联记录。
- **中文 IME 输入法安全**：所有快捷键监听必须检查 `event.isComposing || event.keyCode === 229`，绝不在中文拼音组词敲 `Enter` 选词或 `Backspace` 时误触发新建/缩进/删行！
- **Bullet Zoom-in 聚焦**：点击任意节点的圆点符号，将主画布聚焦到该子树，顶部自动显示逐级面包屑（`2026-11-24 > 项目调研 > 并发锁方案`）。
- **昨日未完成结转**：打开今日空白或尚未处理的每日大纲时，若前序最近一天存在未勾选的 Todo 节点，顶部出现克制的轻量横幅：`昨日有 N 条未完成待办 [全部转入今日] [选择转入] [忽略]`，点击即批量复制到今日大纲且不破坏原节点绑定历史。
- **Slash `/` 与 `[[` 触发器**：
  - 输入 `/` 唤出命令浮层：转为待办（`todo`）、派发给 ADE（`dispatch`）、插入代码块（`code`）、引用/插入文档链接（`link`）、**将该节点/子树升格为独立文章**（`promote`）；
  - 输入 `[[` 唤出跨 Space 文档实时联想补全，选择后插入 `[[标题]]` 并同步维护 `document_links`。
- **行内 `AdeThreadChip` 状态胶囊**：
  - 节点行尾按需渲染紧凑胶囊（如 `[Codex · Running · 2m]` / `[Claude Code · Waiting Input]` / `[Codex · Done]`）；
  - 悬停触发 `cosscom/ui` `PreviewCard` 展示最近一条 `lastSummary`、关联 ADE 信息与源工作区；
  - 点击胶囊展开动作菜单或直接跳转 Deep Link（在嵌入宿主内则通知宿主切换到对应 Thread）。
- **节点升格为文章**：选中一个主干及其若干子节点，一键执行「升格为独立文章」，系统在目标 Space（默认 `Research` 或 `Projects`）新建 `article` 并保留原位置的一句带 `[[新文章]]` 链接的大纲记录。
- **批量拖拽与多选**：基于 `@atlaskit/pragmatic-drag-and-drop` 支持跨层级精准放置指示线（同级前 / 同级后 / 作为子级），并支持 `Shift+Click` / `Cmd+Click` 多选后批量缩进、移动、归档或删除。

### 3.2 `Library` 长文调研阅读与编辑（`ArticleReader` & `ArticleEditor`）

- **默认阅读态，按需编辑**：Agent 产出的调研报告与剪藏文章默认以**只读沉浸阅读器**打开，避免误触光标打断阅读心流。按 `E` 或点击右上角 `Edit` 进入编辑模式。
- **出版级长文排版**：
  - 正文容器 `.inkade-prose` 锁定 `max-w-[70ch]`、正文字号 `16px`、行高 `1.75`，段落与标题间距克制清晰；
  - 代码块接入 `shiki`（自动随亮/暗主题切换）+ 一键复制 + 语言标签；
  - Mermaid 代码块实时渲染矢量图，点击支持全屏缩放灯箱；
  - 宽表格自动外包水平滚动容器与细腻表头背景，不撑破正文版心。
- **Agent 修订审阅流**：当 `document.unreadAgentUpdate === true` 时，文档顶部固定显示轻量提示条：`Agent 已将本文更新至 vN [查看本次变更 Diff] [标为已阅]`，展开内联 `Unified/Split` 行级 Diff 后确认即清除未读标记。
- **划词互动浮层（`Toolbar`）**：阅读文章时选中任意段落文本，上方弹出轻量 `cosscom/ui` `Toolbar`：
  - **追问 Agent**：携带该段落 `selectionAnchorJson` 派发至 ADE，并将新生成的 `AdeThreadBinding` 标为高亮挂在右侧；
  - **摘录至今日大纲**：一键在今日 `Daily` 末尾追加引用块并附上 `[[源文章#锚点]]`；
  - **复制引用链接**。
- **Tiptap + 源码双模编辑**：编辑态头部提供 `SegmentedControl` 在 `富文本 (Tiptap)` 与 `Markdown 源码` 间零损切换；支持粘贴自动解析、行内 `AdeThreadChip` 与 `[[双链]]` 补全；右上角实时展示保存状态与版本号，冲突时明确提示 Diff 对比而非静默覆盖。

### 3.3 全局 `⌘K` 命令面板与 Scoped Token 后台

- **`⌘K` 命令面板**：基于 `cosscom/ui` `Command`，统一承接全文 FTS5 检索（直接高亮命中文档与大纲片段，受前端已登录态或服务端 Scope 保护）、快速跳往今日/某天大纲、跳往 Space、切换暗色模式与快速新建文章/Token。
- **Scoped Token 可视化权限面板**：
  - 支持多选勾选 Space 树（直观预览「开启继承子空间后实际覆盖的目录树」）；
  - 单选权限级别（`read` / `append` / `write` / `admin`）+ 强制 `denyHardDelete` 保护开关；
  - 可选 `allowedKinds`（例如只允许 `article` + `clip`）与 `tagAllowlist`；
  - 创建后一次性明文展示 Token，同时提供**一键复制标准 Streamable HTTP `/mcp` 配置 JSON 片段**（可直接粘进 Claude Code / Codex / Cursor / OpenCode）；
  - 修改现有 Token 的 Scope 后**即时热生效**，无需重启服务或重新下发密钥。

---

## 4. `cosscom/ui` 视觉与组件架构（`packages/ui`）

### 4.1 目录分层（防止业务组件污染原语）

```text
packages/ui/src/
├── theme/
│   ├── tokens.css        # 源自 @coss/style 的 Tailwind v4 @theme inline + 亮/暗 CSS 变量 + .inkade-prose 排版规则
│   └── host-bridge.css   # 允许外部 ADE 宿主通过 CSS 变量注入自身背景/前景色
├── primitives/           # 从 cosscom/ui (@base-ui/react) 引入并持有源码的基础组件（MIT）
│   └── button, badge, card, dialog, drawer, preview-card, command, toolbar,
│       segmented-control, tabs, sidebar, popover, menu, input, select, switch,
│       toast, tooltip, skeleton, empty, scroll-area, separator...
├── patterns/             # Inkade 业务复合积木（纯 React + props，不耦合具体路由）
│   ├── AdeThreadChip.tsx # 胶囊 + PreviewCard 悬停摘要
│   ├── OutlineTreeEditor.tsx
│   ├── ArticleReader.tsx # react-markdown + shiki + mermaid + TOC + 划词 Toolbar
│   ├── ArticleEditor.tsx # Tiptap MIT + Markdown 源码双模
│   ├── DiffViewer.tsx    # 基于 @inkade/core diff 结果的审阅视图
│   ├── BacklinksPanel.tsx
│   └── ScopeTreePicker.tsx
└── index.ts
```

### 4.2 视觉色彩与字体令牌

- **表面与边框哲学（继承 `cosscom/ui`）**：
  - 90% 界面保持中性灰阶与大面积透气留白：亮色背景 `#ffffff`、侧栏 `neutral-50`，边框使用半透明 `--alpha(var(--color-black) / 8%)`；
  - 暗色模式绝不使用刺眼纯黑 `#000`，采用 `coss` 柔暖炭灰（`color-mix(in srgb, neutral-950 95%, white)`）配 `--alpha(white / 6%)` 边框，保护长时间代码与长文阅读体验。
- **语义色克制（仅用于状态与信号）**：
  - `queued` → Neutral 灰；
  - `running` → Info 蓝（附带 2 秒周期轻量脉动点）；
  - `waiting_input` → Warning 琥珀色（高可见度，提示人类决策）；
  - `completed` → Success 翠绿；
  - `failed` → Destructive 红；
  - `archived` → Muted 浅灰。
- **排版**：
  - UI 与正文：`Inter` + 系统中文无衬线字体（`PingFang SC`, `Noto Sans SC`, `system-ui`）；
  - 代码、ID、Token 前缀与快捷键提示：`Geist Mono` + `ui-monospace`（配合 `coss` 的 `Kbd` 组件渲染快捷键，如 `⌘ K`）。

### 4.3 体验完整度硬要求（非 MVP 底线）

1. **全操作乐观更新**：大纲打字、勾选、缩进、拖拽、Pin 置顶 0ms 本地反映，失败时自动回滚并弹出可重试 `Toast`。
2. **安全可逆的删除体验**：文档与节点软删除立即触发带 **5 秒「撤销 (Undo)」按钮** 的 `Toast`；所有删除前若节点下挂有活跃 `AdeThreadBinding` 必须二次提示。
3. **连接与离线反馈**：SSE 断开自动指数退避重连，并在顶部出现极细微的非侵入式重连提示条；重连成功后自动利用 `Last-Event-ID` 同步错过的增量状态。
4. **结构化加载与空状态**：禁止全屏粗暴 spinner，使用匹配真实排版的 `Skeleton` 与指导明确操作路径的 `Empty` 状态卡片。
5. **键盘与无障碍**：基于 Base UI 原生 ARIA 与焦点管理，所有模态框、浮层、下拉菜单、侧滑抽屉均支持键盘闭环操作。
