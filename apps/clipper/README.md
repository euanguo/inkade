# `@inkade/clipper` — Inkade Flagship Web Clipper

Inkade 旗舰级跨浏览器剪藏扩展（Chrome / Edge / Firefox MV3），**100% 宽松开源许可（MIT / Apache-2.0 / BSD / ISC / CC0-1.0）**。

详细架构参见：
- [`docs/CLIPPER-ARCHITECTURE.md`](../../docs/CLIPPER-ARCHITECTURE.md)

## 核心能力

- **双引擎网页解析**：`defuddle/full`（含 26 站点 Extractor 与 Shadow DOM 拍平）+ 洁净室自研 8 大中文/视频 `SiteAdapter`（微信公众号、知乎及信息流单条、小红书、即刻、豆瓣、V2EX、小宇宙播客、YouTube/Bilibili 带时间戳字幕）+ GFM Turndown。
- **声明式模板与过滤器**：URL / RegEx / Glob / Schema.org 触发器、`{{selector}}` / `{{schema}}` / `{{meta}}` 变量、24 个管道过滤器、`if/for` 控制流、Inkade Typed Properties 映射、Daily 自动追加与跨设备云端同步。
- **全形态采集与阅读体验**：
  - 整页正文（Browser DOM 登录态 / Server URL Fetch）
  - 键盘可调区域框选（`Alt+Shift+S`，支持 `←/→/↑/↓/Enter/Esc`）
  - 内置安全沉浸式 Reader View（`Alt+Shift+R`）
  - 右键链接静默剪藏、右键单图保存、右键选区剪藏
- **双向 W3C 划词高亮**：Shadow DOM 隔离划词工具条 + 重访网页无侵入式 Range 矩形叠加层高亮回显（4 色、批注、编辑、跳转定位）。
- **高可靠图片镜像与离线防丢**：先秒存后并发异步上传附件、DNR 注入合法 Referer 破除防盗链、409 `expectedVersion` 乐观锁防止覆盖用户编辑、持久离线重试队列。
- **Agent 原生联动工作台**：Chrome Side Panel / Firefox Sidebar 伴随面板、Hybrid RAG 知识库语义回忆、一键入今日 Daily 大纲、一键派发 `AdeThreadBinding` 至外部 Agent、可选 BYOK AI Interpreter。

## 开发与构建命令

在仓库根目录或 `apps/clipper` 下执行：

```bash
# 打包 Chrome/Edge 与 Firefox 双端 MV3 产物（dist/chrome, dist/firefox, dist）
bun run --filter @inkade/clipper build

# 运行产物校验（Manifest 合法性、IIFE Classic Script 语法检测、资源完整性、体积检查）
bun run --filter @inkade/clipper verify

# 类型检查与单元测试
bun run --filter @inkade/clipper typecheck
bun test apps/clipper
```

## 本地安装调试

### Chrome / Edge / Arc
1. 运行 `bun run --filter @inkade/clipper build`
2. 打开 `chrome://extensions`（或 `edge://extensions`），开启 **开发者模式（Developer mode）**
3. 点击 **加载已解压的扩展程序（Load unpacked）**，选择 `apps/clipper/dist/chrome`（或 `apps/clipper/dist`）

### Firefox
1. 运行 `bun run --filter @inkade/clipper build`
2. 打开 `about:debugging#/runtime/this-firefox`
3. 点击 **临时载入附加组件（Load Temporary Add-on）**，选择 `apps/clipper/dist/firefox/manifest.json`
