# KnowledgeWebSite — GitHub 仓库知识库浏览器

添加 GitHub 仓库，即可在浏览器中浏览、预览、编辑其中的 Markdown 与 HTML 文件，支持全文搜索。

## 启动

```bash
npm install && npm start
```

打开 http://localhost:3000 （端口可用 `PORT` 环境变量修改）。

## 前置要求

- Node.js ≥ 18
- git
- ripgrep（可选；缺失时搜索自动降级为内置遍历）

## 使用

- **添加仓库**：输入 `https://github.com/owner/repo`（私有仓库附 token），后台异步克隆
- **浏览**：左侧目录树，`.md` 渲染、`.html` iframe 预览，其他文件灰显
- **编辑**：Markdown「编辑」/ HTML「源码」进入编辑，保存写回本地克隆目录
- **搜索**：顶栏搜索当前仓库的 `.md`/`.html` 内容
- **更新**：「更新」按钮 `git pull`；本地改动冲突时可强制重置（丢失本地修改）

## 测试

```bash
npm test
```

## 设计文档

`docs/superpowers/specs/2026-07-27-github-repo-browser-design.md`
