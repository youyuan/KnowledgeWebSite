# KnowledgeWebSite — 知识库浏览器

把 Markdown / HTML 资料放入 `content/` 目录，即可在浏览器中浏览、预览、编辑，支持全文搜索。

## 启动

```bash
./kws start     # 后台启动
./kws restart   # 重启
./kws stop      # 停止
./kws status    # 查看状态
```

打开 http://localhost:8080 （默认 8080 端口，在 `config.json` 中修改）。日志在 `kws.log`（首次启动日志中会打印初始 admin 密码）。也可用 `npm start` 前台运行。

## 配置

全部配置在项目根目录的 `config.json` 中（**首次启动自动生成**，并在控制台打印一次初始 admin 密码；如存在旧 `auth.json` 会自动导入其用户）：

```json
{
  "port": 8080,
  "contentDir": "./content",
  "trustProxy": false,
  "authSecret": "",
  "users": [
    { "username": "admin", "password": "随机生成的初始密码" }
  ]
}
```

| 字段 | 默认值 | 说明 |
|:-----|:-------|:-----|
| `port` | `8080` | 监听端口，修改后重启生效 |
| `contentDir` | `./content` | 资料根目录（相对 config.json 所在目录），每个子文件夹是一个资料库，重启生效 |
| `trustProxy` | `false` | 经反向代理终结 TLS 时设为 `true`，登录 Cookie 才能正确附加 `Secure` |
| `authSecret` | 自动生成于 `.auth-secret` | 登录签名密钥；多实例部署时各实例填同一值 |
| `users` | 首次生成 | 用户名/明文密码数组，可多个；username 限字母、数字、`.`、`_`、`-`；保存即生效 |

`config.json` 无需写全字段，未写的字段自动使用默认值。配置中没有有效用户时服务拒绝启动。

## 前置要求

- Node.js ≥ 18
- ripgrep（可选；缺失时搜索自动降级为内置遍历）

## 登录

网站强制登录。用户即 `config.json` 中的 `users` 数组（见「配置」），保存即生效，无需重启。
签名密钥自动生成于 `.auth-secret`（也可在 `config.json` 的 `authSecret` 字段显式指定），登录态 7 天有效。
登录接口有频率限制：每 IP 每分钟最多 10 次尝试，超出返回 429。

## 使用

- **放入资料**：把资料文件夹（如 GitHub 仓库、文档包）复制到 `content/` 下，每个子文件夹就是一个资料库，刷新页面即可看到
- **浏览**：左侧目录树，`.md` 渲染、`.html` iframe 预览，其他文件不预览
- **编辑**：Markdown「编辑」/ HTML「源码」进入编辑，保存写回目录（保存受 5MB JSON 上限约束，超过请直接编辑文件）
- **文件管理**：网页端不提供文件管理操作，资料直接放入 `content/`（在文件系统中增删即可）
- **搜索**：顶栏搜索当前资料库的 `.md`/`.html` 内容
- **分享**：工具栏「分享」按钮生成免登录链接，有效期可选 7 天（默认）/30 天/永久/自定义天数；链接只公开该页面及其引用的相对资源，过期自动失效（分享记录存于 `shares.json`）

## 测试

```bash
npm test
```

## 设计文档

- `docs/superpowers/specs/2026-07-29-config-file-design.md`（配置体系）
- `docs/superpowers/specs/2026-07-28-local-directory-mode-design.md`（当前架构）
- `docs/superpowers/specs/2026-07-27-github-repo-browser-design.md`（历史：在线 clone 模式）
