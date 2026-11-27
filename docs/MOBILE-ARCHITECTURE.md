# Inkade Mobile 架构设计（薄原生外壳 + 内嵌 Web 工作区）

> 当前分支（`feat/mobile-thin-shell-webview`）采用 **Thin Native Shell + Embedded `@inkade/web`** 架构；完整原生对照版本保留于 `feat/mobile-expo-rn` 分支。

---

## 1. 为什么采用「薄原生外壳 + 内嵌 `@inkade/web`」？

- **单一 UI 真相源**：`apps/web` 已具备完整 V4.0 Linear-Calm 扁平专注能力（390px 移动端抽屉与底部 5 槽居中快记 Dock、平面无阴影与单色默认预设、Today 写作画布与 Inbox 分拣控制站分离、长文阅读与 Track Changes、KaTeX/Mermaid）。移动端主工作区直接内嵌服务端 `@inkade/web`，**零 UI 双线维护成本**。
- **保留全部原生能力**：系统级能力（iOS Keychain / Android Keystore 安全凭证、秒开原生极速快记、Android `ACTION_SEND` 系统分享与 `inkade://` 深链、断网 SQLite 写队列与自动补发、`OfflineStatusBar`、原生震动反馈与断网兜底）继续由 Expo / React Native 承担；原生层视觉严格对齐 V4.0 规范（`surface="light"` + `accent="mono"` 开箱默认、`6px/8px` 紧致圆角、无嵌套卡片与平面阴影、按 Web `theme_sync` 实时同步 `surface`/`accent` 与深浅模式）。

---

## 2. 原生层 vs WebView 职责边界

| 模块 | 运行层 | 说明 |
| :--- | :--- | :--- |
| 连接向导与凭证存储 | 原生（`app/connect.tsx`, `storage/credentials.ts`） | 校验 `/api/v1/health` 与 `whoamiScope`，Scoped Token 存入 Keychain / Keystore |
| 主工作区（Daily / Inbox / Library / Tasks / Threads / Docs / Settings） | 内嵌 WebView（`app/web.tsx` -> `@inkade/web`） | 启动前通过 `buildWebShellBootstrapScript` 注入 Bearer Token 与语言，免二次登录；同步顶部状态栏深浅主题 |
| 极速快记与系统分享 | 原生（`app/capture.tsx` + `with-android-share-intent.js`） | 点击 Web 内 `+ Quick Capture`、系统分享文本或 `inkade://capture` 直接弹出原生快记页，断网自动写入 SQLite 队列 |
| 离线状态栏与后台补发 | 原生（`OfflineStatusBar.tsx`, `api/client.ts`, `sqlite-offline-backend.ts`） | 监测网络切换与回前台事件，单飞重放离线队列并通知 WebView `inkade:mobile-shell-refresh` |
| 外壳设置与安全清理 | 原生（`app/shell.tsx`, `HoldConfirmButton.tsx`） | 从 Web 侧栏进入「移动外壳与连接」，切换服务器、查看队列与长按 `1.5s` 清空缓存 |

---

## 3. 通信契约（`packages/core/src/mobile-bridge.ts` & `apps/web/src/lib/mobile-shell.ts`）

- **Native → Web（前置注入 + 事件）**：
  - `window.__INKADE_MOBILE_SHELL__` + `localStorage["inkade:auth-token"]`（仅 `token` 模式）+ `html[data-mobile-shell="native"]`；
  - `inkade:mobile-shell-refresh`：原生快记或离线队列同步完成后无刷失效 TanStack Query；
  - `inkade:mobile-shell-navigate`：原生深链（如 `inkade://doc/<id>`）直接客户端路由跳转。
- **Web → Native（`parseMobileShellWebMessage` Zod 校验）**：
  - `ready`、`theme_sync`、`open_native_capture`、`open_shell_settings`、`sign_out`、`open_external_url`、`haptic`。

---

## 4. 安全与双端适配

- **导航同源白名单（`classifyWebViewNavigation`）**：仅同源 `http:`/`https:` 页面在壳内加载；外部链接与 `bb://` / `paseo://` / `cindy://` 通过系统 `Linking.openURL` 跳出；`javascript:` / `data:` / `file:` 协议一律拦截。
- **键盘与安全区**：WebView 外层按 `insets.top` 与 `insets.bottom` 留白并随 `theme_sync` 同步系统状态栏；Android `softwareKeyboardLayoutMode: "resize"` 下软键盘弹出时底部自动贴合键盘顶缘，无重复双底栏。
