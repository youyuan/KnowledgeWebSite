# GitHub 仓库知识库浏览器 — 设计文档

日期：2026-07-27
状态：已批准

## 1. 背景与目标

开发一个网站：添加 GitHub 仓库后即可在线浏览其中的 HTML 和 Markdown 文件，一条命令即可启动服务。

**已确认的决策：**

- 数据获取：服务器 `git clone` 到本地目录，可手动 pull 更新
- 技术栈：Node.js（Express）
- 使用场景：个人 / 内网使用，无登录鉴权
- 功能范围：核心浏览（仓库管理、目录树、HTML 预览、Markdown 渲染、pull 更新）+ 在线编辑 + 全文搜索
- 架构方案：Express + 无构建 vanilla JS 单页应用

## 2. 架构总览

```
┌─────────────────────────────────────────────┐
│  浏览器 SPA (public/, 无构建 vanilla JS)      │
│  仓库列表 │ 目录树 │ Markdown渲染 │ iframe预览 │
│  编辑器 │ 搜索框                              │
└──────────────┬──────────────────────────────┘
               │ REST API (JSON)
┌──────────────▼──────────────────────────────┐
│  Express 服务 (server/)                      │
│  routes → services → git/fs/ripgrep         │
└──────────────┬──────────────────────────────┘
               │
     data/repos/<owner>__<repo>/   (git 克隆)
     data/config.json              (仓库清单)
```

- 单一 Node 进程，同时服务静态前端和 API
- 启动命令：`npm install && npm start`（`npm start` 即 `node server/index.js`）
- 端口默认 3000，可用 `PORT` 环境变量覆盖
- 前置要求：Node ≥ 18、git；可选 ripgrep（无则搜索降级为 Node 遍历）

## 3. 项目结构

```
KnowledgeWebSite/
├── package.json          # 运行时依赖仅 express
├── server/
│   ├── index.js          # 入口：express app、静态托管、错误中间件
│   ├── routes/repos.js   # 仓库管理 API
│   ├── routes/files.js   # 文件树/读写 API
│   ├── routes/search.js  # 搜索 API
│   └── services/
│       ├── repoStore.js  # config.json 读写、路径安全校验
│       ├── git.js        # clone/pull（子进程调 git）
│       └── search.js     # rg 优先，Node 遍历兜底
├── public/
│   ├── index.html
│   ├── app.js            # 路由/状态/渲染
│   ├── style.css
│   └── vendor/           # marked、highlight.js 本地化（内网无外网可用）
├── test/                 # node:test + supertest 集成测试
└── data/                 # 运行时生成（.gitignore）
    ├── config.json
    └── repos/
```

## 4. API 设计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/repos` | 仓库列表（名称、URL、克隆时间、状态） |
| POST | `/api/repos` | 添加仓库 `{url, token?}` → 异步 clone |
| POST | `/api/repos/:id/pull` | git pull 更新 |
| DELETE | `/api/repos/:id` | 删除仓库及本地目录 |
| GET | `/api/repos/:id/tree` | 目录树（标注 `.md`/`.html`/其他） |
| GET | `/api/repos/:id/file?path=...` | 读取文件内容（UTF-8） |
| PUT | `/api/repos/:id/file?path=...` | 保存文件内容（在线编辑） |
| GET | `/api/repos/:id/raw?path=...` | 原始文件（供 HTML iframe 内相对资源使用） |
| GET | `/api/repos/:id/search?q=...` | 在仓库内搜索，返回文件 + 行号 + 片段 |

**安全约束：**

- 所有 `path` 参数经 `path.resolve` 后必须仍位于该仓库目录内，拒绝 `..` 逃逸
- 仓库 id 为 `owner__repo` 形式，校验字符白名单（字母、数字、`-`、`_`、`.`）
- 私有仓库：token 拼入 clone URL（`https://<token>@github.com/...`），仅用于 clone，config.json 中保存原始 URL 不保存 token

## 5. 前端交互

- **左栏**：仓库列表（添加/删除/更新按钮）+ 选中仓库的目录树
- **主区**：按文件类型切换三种视图
  - `.md` → marked 渲染 + highlight.js 代码高亮；「编辑」按钮切换到 textarea，保存调 PUT
  - `.html` → `<iframe sandbox="allow-same-origin">`，`src` 指向 `/api/repos/:id/raw?path=`（不用 srcdoc，保证 HTML 内相对路径的 css/js/img 可用）；「源码」按钮查看/编辑
  - 其他文件 → 灰显，仅提示不支持
- **顶栏**：搜索框，结果显示文件路径 + 匹配行，点击跳转到对应文件

## 6. 错误处理

- clone 失败（URL 错误、网络、认证失败）→ 仓库状态标记 `error`，前端展示错误信息，可删除重试
- pull 冲突（本地编辑过）→ 返回 git 错误原文，前端提示；提供「强制重置」按钮（`git reset --hard origin/<branch>`，需二次确认）
- 文件读写：路径非法 → 400；不存在 → 404；非 UTF-8（二进制）→ 415
- 搜索：`rg` 不存在时自动降级为 Node 遍历 `.md/.html`，日志提示一次

## 7. 测试

用 Node 内置 `node:test` + `supertest` 对 API 做集成测试：

- 用本地临时 git 仓库（`git init` + commit 几个 md/html 文件）模拟 clone 源，避免依赖网络
- 覆盖：添加/列表/删除仓库、目录树、文件读写、路径逃逸防护（`../../../etc/passwd` → 400）、搜索命中
- 前端手动验证为主（个人项目不写 UI 自动化测试）

## 8. 依赖与启动

- 运行时依赖仅 `express`；`marked`、`highlight.js` 下载到 `public/vendor/` 本地引入
- 启动：`npm install && npm start`，浏览器打开 `http://localhost:3000`
