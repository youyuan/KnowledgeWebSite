# 登录功能 — 设计文档

日期：2026-07-29
状态：已批准

## 1. 目标

为知识库浏览器添加登录功能：无注册，后台通过配置文件管理用户名密码。

**已确认的决策：**

- 配置文件中密码**明文存储**
- **强制登录**：无有效用户配置时拒绝启动
- 零新增 npm 依赖（Node 内置 crypto 签名 Cookie）

## 2. 配置与账号

- 项目根目录 `auth.json`（gitignore），格式：`[{"username": "admin", "password": "明文密码"}]`
- username 字符集限制 `[A-Za-z0-9._-]`（需写入 Cookie）
- 提供 `auth.json.example` 示例
- 启动时加载并校验：文件不存在、解析失败或用户数为 0 → 打印错误并拒绝启动（`process.exit(1)`)
- 密钥：`AUTH_SECRET` 环境变量优先；否则首次启动自动生成随机密钥写入 `.auth-secret`（gitignore，权限 600），重启不失效

## 3. 登录机制

- 登录成功签发签名 Cookie：`auth=<username>|<expiryMs>|<hmac-sha256-hex>`，HMAC 内容 `<username>|<expiryMs>`
- Cookie 属性：`HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`（7 天）；HTTPS 请求追加 `Secure`
- 密码比对用 `crypto.timingSafeEqual` 防时序攻击
- 无服务端会话状态，重启不掉登录

## 4. 保护范围

中间件在静态托管与 API 路由之前拦截一切请求，例外：

- `GET /login.html`、`POST /api/login`、`/vendor/` 前缀

行为：

- API 请求（`/api/` 前缀）未登录 → `401 {error: '未登录'}`
- 页面请求未登录 → 302 跳 `/login.html?next=<原地址>`
- Cookie 签名篡改、过期 → 视同未登录

## 5. 接口与页面

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | `{username, password}` → 200 `{ok, username}` + Set-Cookie；失败 401（统一「用户名或密码错误」） |
| POST | `/api/logout` | 清除 Cookie（Max-Age=0） |
| GET | `/api/me` | `{username}`（保护内，前端显示用） |

- `public/login.html`：居中登录卡片，错误提示，成功跳回 `?next=` 或 `/`
- 主页面 header 右侧：当前用户名 +「退出」按钮（调 `/api/logout` 后跳登录页）
- 前端 `api()` 遇到 401 → 跳 `/login.html?next=<当前页>`

## 6. 测试

- `test/auth.test.js`：登录成功/失败、未登录 API 401、页面 302、登出、签名篡改拒绝、过期拒绝、无用户配置拒绝启动（loadUsers 抛错）
- 既有测试（api/health/dompurify）改造：`AUTH_FILE` 指向临时 fixture（含一个测试用户），用 `request.agent(app)` 在 before 中登录后带 Cookie 请求

## 7. 其他

- `.gitignore` 增加 `auth.json`、`.auth-secret`
- README 增加登录配置说明
