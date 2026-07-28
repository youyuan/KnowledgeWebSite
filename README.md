# KnowledgeWebSite — 知识库浏览器

把 Markdown / HTML 资料放入 `content/` 目录，即可在浏览器中浏览、预览、编辑，支持全文搜索与网页文件管理。

## 启动

```bash
npm install && npm start
```

打开 http://localhost:3000 （端口可用 `PORT` 环境变量修改，内容目录可用 `CONTENT_DIR` 修改）。

## 前置要求

- Node.js ≥ 18
- ripgrep（可选；缺失时搜索自动降级为内置遍历）

## 使用

- **放入资料**：把资料文件夹（如 GitHub 仓库、文档包）复制到 `content/` 下，每个子文件夹就是一个资料库，刷新页面即可看到
- **浏览**：左侧目录树，`.md` 渲染、`.html` iframe 预览，其他文件不预览
- **编辑**：Markdown「编辑」/ HTML「源码」进入编辑，保存写回目录（保存受 5MB JSON 上限约束，超过请直接编辑文件）
- **文件管理**：选中资料库后可新建文件/文件夹、上传、删除
- **搜索**：顶栏搜索当前资料库的 `.md`/`.html` 内容

## 测试

```bash
npm test
```

## 设计文档

- `docs/superpowers/specs/2026-07-28-local-directory-mode-design.md`（当前架构）
- `docs/superpowers/specs/2026-07-27-github-repo-browser-design.md`（历史：在线 clone 模式）
