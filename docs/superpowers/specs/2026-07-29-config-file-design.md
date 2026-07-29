# 配置文件方案 — 设计文档

日期：2026-07-29
状态：已批准

## 1. 目标

全部配置（端口、用户、内容目录等）统一走 `config.json` 配置文件，移除环境变量方式，便于后期扩展。

**已确认的决策：**

- 首次启动自动生成 `config.json`（无样例文件、无独立默认配置文件）
- 删除 `auth.json` 及 `auth.json.example`，移除全部环境变量支持（PORT、CONTENT_DIR、AUTH_FILE、AUTH_SECRET、TRUST_PROXY）
- 默认端口 8080
- 首次生成时随机产生 admin 密码并在控制台打印一次
- 配置分层：代码内置默认值 < `config.json` 逐字段覆盖
- 生成 `config.json` 时若存在旧 `auth.json`，自动导入其用户（防止锁死）

## 2. 配置文件

```json
{
  "port": 8080,
  "contentDir": "./content",
  "trustProxy": false,
  "authSecret": "",
  "users": [
    { "username": "admin", "password": "<随机生成12位>" }
  ]
}
```

- 路径：项目根 `config.json`（gitignore）
- 未写字段用内置默认值补齐：`port=8080`、`contentDir="./content"`、`trustProxy=false`、`authSecret=""`、`users=[]`
- `contentDir` 相对路径相对 `config.json` 所在目录解析
- 校验：port 为 1-65535 整数；users 数组每项 username 限 `[A-Za-z0-9._-]`、password 非空字符串；校验失败抛错拒绝启动
- `authSecret` 为空时沿用现有机制（自动生成存 `.auth-secret`）

## 3. 实现

- 新增 `server/services/config.js`：
  - `init(configPath?)`：文件不存在则生成（含随机 admin 密码并打印；存在旧 auth.json 则导入其用户）；解析合并默认值并校验
  - `get()`：返回合并后配置（未初始化抛错）
  - `resolveContentDir()`：绝对化 contentDir
  - `hasUsers()`：是否存在有效用户
- `contentStore`：CONTENT_DIR 改为惰性调用 `config.resolveContentDir()`
- `auth`：`loadUsers()` 改为读 `config.get().users`（不再读 auth.json）；密钥逻辑不变
- `index.js`：`config.init()` 启动时调用；端口取 `config.get().port`；`trustProxy` 为 true 时 `app.set('trust proxy', 1)`；`hasUsers()` 为假拒绝启动
- 测试：`config.init(临时路径)` 隔离，不使用环境变量

## 4. 语义

- 用户修改：保存即生效（loadUsers 无缓存，不变）
- 端口/contentDir/trustProxy 修改：重启生效
- 强制登录不变：无有效用户拒绝启动

## 5. 测试

- `test/config.test.js`：自动生成（含随机密码、auth.json 用户导入）、默认值合并、校验失败、resolveContentDir 相对解析
- `auth.test.js` 适配（loadUsers 改读 config）
- 既有测试（api/health/dompurify）适配：`config.init` 指向临时配置（临时 contentDir + 测试用户）
- README「配置」节改写为 config.json 字段说明
