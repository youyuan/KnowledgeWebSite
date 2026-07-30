# 文档分享功能 — 设计文档

日期：2026-07-30
状态：已批准

## 1. 目标

单个文档页面的免登录分享链接，有效期默认 7 天，可选 30 天、永久、自定义天数（1–365）。分享页引用的相对路径资源（图片等）也可通过链接访问。

**已确认的决策：**

- 分享链接免登录，128 位随机 token 不可猜测
- 包含相对资源访问（限制在文档所在目录内）
- 存储用项目根 `shares.json`（gitignore，0600），访问时判过期，惰性清理

## 2. 接口契约（多 Agent 并行开发的约定）

### 2.1 创建分享（需登录）

`POST /api/repos/:id/share`
- body：`{path: "docs/a.md", days: 7}`；`days` 为 1–365 整数，或 `null`/`"forever"` 表示永久
- 200 → `{url: "/share/<token>", token, expiresAt: <ms 时间戳 | null>}`
- 400：缺 path、path 非法、文件不存在（404）、days 非法

### 2.2 免登录访问

| 路径 | 行为 |
|---|---|
| `GET /share/<token>` | md → 返回分享渲染页 HTML（GitHub 样式）；html/htm → 返回原始 HTML 并注入 `<base href="/share/<token>/res/">`（注入在 `<head>` 后），脚本可运行 |
| `GET /share/<token>/content` | 返回分享文件的文本内容（供渲染页 fetch），`{path, content}` |
| `GET /share/<token>/res/<相对路径>` | 相对资源；解析后必须位于**文档所在目录**内（含子目录），`.git` 拒绝，逃逸 400 |
| 无效/过期 token | 全部返回 404 提示页「链接已过期或不存在」（HTML，状态 404） |

### 2.3 鉴权中间件

`/share/` 前缀加入豁免清单（其余全站仍强制登录）。

## 3. 存储

`shares.json`（项目根，0600）：`[{token, repo, path, createdAt, expiresAt}]`，`expiresAt` 为 null 表示永久。每次读取时过滤过期项并写回（惰性清理）。路径：项目根；**注意** 与 contentDir 无关。

## 4. 前端

- 工具栏新增「分享」按钮（renderMarkdown 与 renderHtmlPreview 都有）
- 点击弹出浮层：单选 7 天（默认选中）/ 30 天 / 永久 / 自定义（数字输入框 1–365）→「生成链接」→ 显示完整 URL（location.origin + url）与「复制」按钮（navigator.clipboard，失败降级 prompt 显示）
- 分享渲染页 `public/share-view.html`：从 `/share/<token>/content` 取文本，复用 marked + DOMPurify + hljs + github-markdown-css 渲染；图片/链接相对路径改写到 `/share/<token>/res/...`；fetch 404 时显示过期提示

## 5. 安全

- token：`crypto.randomBytes(16).toString('hex')`（128 位）
- res 端点：safeResolve 到文档所在目录前缀内 + `.git` 拒绝 + 不存在 404
- 创建分享必须登录（401）；过期 token 视同不存在（404，不区分，防探测）
- shares.json 不存在时视为空列表

## 6. 测试

- 创建分享：7 天/30 天/永久/自定义天数、非法 days 400、缺 path 400、未登录 401
- 免登录访问：md 渲染页 200、html 注入 base、content 端点、res 资源 200、res 越权 400、无效 token 404
- 过期：构造 expiresAt 已过期的记录 → 404；惰性清理后 shares.json 不含该记录
