# 知识库浏览器改造：本地目录模式 — 设计文档

日期：2026-07-28
状态：已批准
前作：docs/superpowers/specs/2026-07-27-github-repo-browser-design.md

## 1. 背景与目标

将现有「GitHub 仓库知识库浏览器」改造为本地目录模式：

- 去掉在线 clone：网站不再负责拉取仓库，用户手动把资料（GitHub 仓库、文档包等）放入网站指定目录
- 左侧目录树：第一层是各资料库（指定目录下的子文件夹），点开是其内部的 HTML/Markdown 文档，点击打开、可编辑
- 保留搜索；新增网页文件管理（新建资料库/文件/文件夹、上传、删除）

**已确认的决策：**

- 指定目录为项目下 `content/`，每个子文件夹 = 一个资料库
- 保留搜索；新增网页文件管理；删除全部 clone 相关代码
- 方案：就地改造（复用现有 tree/file/raw/search 路由与安全机制）

## 2. 架构变化

- 数据根目录：`content/`（`CONTENT_DIR` 环境变量可覆盖，测试用它隔离）；服务启动时自动创建
- 一个子文件夹 = 一个资料库；用户 `cp -r` 或自行 `git clone` 到 `content/` 即可，网站不感知 git
- 删除：`server/services/git.js`、`server/routes/repos.js` 中的 clone/pull/reset、`data/config.json`、`repoIdFromUrl` 及 git 相关测试
- `repoStore` 简化为 `contentStore`：列出子目录 + 路径安全校验（保留 `safeResolve`、id 白名单、`.git` 读写拒绝）

## 3. API 设计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/repos` | 列出 content/ 下的子目录（资料库列表，按名称排序） |
| POST | `/api/repos` | `{name}` 新建资料库（创建空目录；重名 409，名称非法 400） |
| GET | `/api/repos/:id/tree` | 目录树（不变） |
| GET | `/api/repos/:id/file?path=` | 读取文件（不变：400/404/415） |
| PUT | `/api/repos/:id/file?path=` | 保存文件（不变） |
| GET | `/api/repos/:id/raw?path=` | 原始文件（不变） |
| GET | `/api/repos/:id/search?q=` | 搜索（不变） |
| POST | `/api/repos/:id/file?path=` | 新建空文件（已存在 409，父目录不存在 404） |
| POST | `/api/repos/:id/mkdir?path=` | 新建文件夹（递归创建） |
| DELETE | `/api/repos/:id/file?path=` | 删除文件或文件夹（递归；前端二次确认）；`path` 为空或解析结果为资料库根目录时返回 400（不允许删整个资料库） |
| POST | `/api/repos/:id/upload?path=` | 上传文件，`path` 为目标文件路径；body 为原始二进制（`express.raw` 仅挂在此路由，上限 50mb），不引入 multer |

安全约束（全部沿用现有实现）：

- 资料库 id 白名单 `/^[A-Za-z0-9._-]+$/`（不再有 `owner__repo` 双段要求）
- 所有 path 经 `safeResolve` 防 `..` 逃逸；`.git` 路径读写统一拒绝
- 资料库存在性校验：id 对应目录不存在 → 404

## 4. 前端变化

- 左侧顶部：资料库列表 +「新建资料库」按钮（prompt 输入名称）；去掉 URL/token 表单、更新/删除按钮、克隆状态轮询
- 选中资料库后显示工具条：「新建文件 / 新建文件夹 / 上传 / 删除」
  - 新建文件/文件夹：prompt 输入相对路径（基于当前选中目录，未选中则为根）
  - 上传：`<input type="file">` 选文件，以二进制 body POST 到 `/upload?path=` 选中目录下同名路径
  - 删除：confirm 二次确认，删除当前选中项，删除后刷新树
- Markdown 渲染（DOMPurify 消毒）、HTML iframe 预览、编辑器、搜索——全部不变

## 5. 测试

- 现有 tree/file/raw/search 测试改为直接往临时 `CONTENT_DIR` 写文件（不再创建 git 源仓库），clone/git 相关测试文件删除
- 新增测试：新建资料库（含重名 409、非法名 400）、新建文件（409/404）、mkdir、上传（含二进制内容校验）、删除（文件与文件夹）、路径逃逸与 `.git` 拒绝回归
- 前端无自动化测试，curl 冒烟验证

## 6. 依赖与启动

- 依赖不变（express、marked、@highlightjs/cdn-assets、dompurify；dev: supertest）
- 启动：`npm install && npm start`；`content/` 自动创建
- 前置要求降为：Node ≥ 18（git、ripgrep 均为可选，rg 缺失时搜索自动降级）
