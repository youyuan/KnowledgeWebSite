# KnowledgeWebSite — 知识库浏览器

把 Markdown / HTML 资料放入 `content/` 目录，即可在浏览器中浏览、预览、编辑，支持全文搜索。

## 启动

```bash
npm install && npm start
```

打开 http://localhost （默认 80 端口，可用 `PORT` 环境变量修改，内容目录可用 `CONTENT_DIR` 修改）。注意 80 为特权端口，Linux 下需要 root 或 `sudo setcap 'cap_net_bind_service=+ep' $(which node)` 授权。

## 前置要求

- Node.js ≥ 18
- ripgrep（可选；缺失时搜索自动降级为内置遍历）

## 登录配置

网站强制登录。首次启动前，复制配置样例并修改用户名密码：

```bash
cp auth.json.example auth.json
```

`auth.json` 为用户名/明文密码数组，可配置多个用户；用户名限字母、数字、`.`、`_`、`-`。
修改 `auth.json` 保存后即生效，无需重启。未配置有效用户时服务拒绝启动。
签名密钥自动生成于 `.auth-secret`（可用 `AUTH_SECRET` 环境变量覆盖），登录态 7 天有效。
登录接口有频率限制：每 IP 每分钟最多 10 次尝试，超出返回 429。
经反向代理（Nginx 等）终结 TLS 部署时，设置 `TRUST_PROXY=1` 环境变量，使 HTTPS 请求的登录 Cookie 正确附加 `Secure` 属性。

## 使用

- **放入资料**：把资料文件夹（如 GitHub 仓库、文档包）复制到 `content/` 下，每个子文件夹就是一个资料库，刷新页面即可看到
- **浏览**：左侧目录树，`.md` 渲染、`.html` iframe 预览，其他文件不预览
- **编辑**：Markdown「编辑」/ HTML「源码」进入编辑，保存写回目录（保存受 5MB JSON 上限约束，超过请直接编辑文件）
- **文件管理**：网页端不提供文件管理操作，资料直接放入 `content/`（在文件系统中增删即可）
- **搜索**：顶栏搜索当前资料库的 `.md`/`.html` 内容

## 测试

```bash
npm test
```

## 设计文档

- `docs/superpowers/specs/2026-07-28-local-directory-mode-design.md`（当前架构）
- `docs/superpowers/specs/2026-07-27-github-repo-browser-design.md`（历史：在线 clone 模式）
