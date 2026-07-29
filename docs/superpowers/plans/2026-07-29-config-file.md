# 配置文件方案 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全部配置统一走 config.json（首次启动自动生成，默认端口 8080），移除环境变量支持与 auth.json。

**Architecture:** 新增 services/config.js 统一加载/合并/校验配置；contentStore、auth、index.js 全部惰性从 config 读取；测试用 `config.init(临时路径)` 隔离。

**Tech Stack:** Node.js ≥ 18（CommonJS）、Express 5、node:test + supertest。

**Spec:** `docs/superpowers/specs/2026-07-29-config-file-design.md`

## Global Constraints

- Node ≥ 18，CommonJS；express 5.x；不新增 npm 依赖
- **移除全部环境变量支持**：PORT、CONTENT_DIR、AUTH_FILE、AUTH_SECRET、TRUST_PROXY 一律删除，唯一配置来源是 config.json
- 内置默认值：`port=8080`、`contentDir='./content'`、`trustProxy=false`、`authSecret=''`、`users=[]`
- config.json 不存在时自动生成（随机 12 位 admin 密码并 console.log 一次；存在旧 auth.json 时导入其用户）
- contentDir 相对路径相对 config.json 所在目录解析
- username 限 `[A-Za-z0-9._-]`，password 非空字符串；port 为 1-65535 整数；校验失败抛错
- 无有效用户拒绝启动（强制登录不变）
- 测试通过 `config.init(临时配置文件路径)` 隔离，禁止用环境变量
- npm test = `node --test test/`；commit message 结尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

```
server/
├── services/config.js     # Task 1 新建
├── services/contentStore.js # Task 2 改（CONTENT_DIR → config.resolveContentDir() 惰性）
├── services/auth.js       # Task 2 改（loadUsers 读 config；删 AUTH_FILE/env）
├── index.js               # Task 2 改（config.init、端口、trustProxy、hasUsers）
test/
├── config.test.js         # Task 1 新建
├── auth.test.js           # Task 2 适配
├── api.test.js            # Task 2 适配
├── health.test.js         # Task 2 适配
├── dompurify.test.js      # Task 2 适配
auth.json.example          # Task 2 删除
.gitignore                 # Task 2 改（auth.json → config.json）
README.md                  # Task 3
```

---

### Task 1: config 服务

**Files:**
- Create: `server/services/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Produces（Task 2 依赖）:
  - `init(configPath?): object`（不存在则生成；合并默认值并校验；返回配置）
  - `get(): object`（未初始化抛错）
  - `resolveContentDir(): string`（绝对路径）
  - `hasUsers(): boolean`
  - `DEFAULTS`

- [ ] **Step 1: 写失败测试** `test/config.test.js`

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir } = require('./helpers');
const config = require('../server/services/config');

function initTemp(content) {
  const dir = makeTempDir('kw-config-');
  const p = path.join(dir, 'config.json');
  if (content !== undefined) fs.writeFileSync(p, JSON.stringify(content));
  return p;
}

test('get 未初始化抛错', () => {
  const fresh = freshConfig();
  assert.throws(() => fresh.get(), /未初始化/);
});

test('文件不存在时自动生成：含随机 admin 密码与默认值', () => {
  const fresh = freshConfig();
  const p = initTemp(undefined); // 不写文件
  const cfg = fresh.init(p);
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.contentDir, './content');
  assert.equal(cfg.trustProxy, false);
  assert.equal(cfg.users.length, 1);
  assert.equal(cfg.users[0].username, 'admin');
  assert.ok(cfg.users[0].password.length >= 12);
  // 两次生成密码不同
  const cfg2 = fresh.init(initTemp(undefined));
  assert.notEqual(cfg.users[0].password, cfg2.users[0].password);
});

test('生成时导入旧 auth.json 用户', () => {
  const fresh = freshConfig();
  const dir = makeTempDir('kw-config-');
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify([{ username: 'old', password: 'pw' }]));
  const cfg = fresh.init(path.join(dir, 'config.json'));
  assert.deepEqual(cfg.users, [{ username: 'old', password: 'pw' }]);
});

test('用户配置逐字段覆盖默认值', () => {
  const fresh = freshConfig();
  const cfg = fresh.init(initTemp({ port: 9000, users: [{ username: 'a', password: 'b' }] }));
  assert.equal(cfg.port, 9000);
  assert.equal(cfg.contentDir, './content');
  assert.equal(cfg.users.length, 1);
});

test('校验失败抛错', () => {
  const fresh = freshConfig();
  assert.throws(() => fresh.init(initTemp({ port: 99999 })), /port/);
  assert.throws(() => fresh.init(initTemp({ users: 'x' })), /users/);
  assert.throws(() => fresh.init(initTemp({ users: [{ username: 'bad name', password: 'x' }] })), /用户/);
  assert.throws(() => fresh.init(initTemp({ users: [{ username: 'a', password: '' }] })), /用户/);
  const dir = makeTempDir('kw-config-');
  const bad = path.join(dir, 'config.json');
  fs.writeFileSync(bad, '{not json');
  assert.throws(() => fresh.init(bad), /解析失败/);
});

test('resolveContentDir 相对 config.json 所在目录解析', () => {
  const fresh = freshConfig();
  const dir = makeTempDir('kw-config-');
  const p = path.join(dir, 'config.json');
  fs.writeFileSync(p, JSON.stringify({ contentDir: './data', users: [{ username: 'a', password: 'b' }] }));
  fresh.init(p);
  assert.equal(fresh.resolveContentDir(), path.join(dir, 'data'));
  assert.equal(fresh.hasUsers(), true);
});

test('users 为空时 hasUsers 为 false', () => {
  const fresh = freshConfig();
  fresh.init(initTemp({ users: [] }));
  assert.equal(fresh.hasUsers(), false);
});

// 每个用例使用独立模块实例（init 是单例）
function freshConfig() {
  delete require.cache[require.resolve('../server/services/config')];
  return require('../server/services/config');
}
```

注意：`freshConfig` 需要在首次使用前定义（JS 函数声明提升，放文件末尾即可）。

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/config.test.js
```

预期：FAIL（模块不存在）

- [ ] **Step 3: 实现** `server/services/config.js`

```js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

const DEFAULTS = {
  port: 8080,
  contentDir: './content',
  trustProxy: false,
  authSecret: '',
  users: [],
};

const USERNAME_RE = /^[A-Za-z0-9._-]+$/;

let config = null;
let configDir = null;

function randomPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

function generate(configPath) {
  // 旧 auth.json 存在时导入其用户，避免升级后锁死
  let users;
  const legacy = path.join(path.dirname(configPath), 'auth.json');
  try {
    const legacyUsers = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    if (Array.isArray(legacyUsers) && legacyUsers.length) users = legacyUsers;
  } catch { /* 无旧配置 */ }
  if (!users) {
    const password = randomPassword();
    users = [{ username: 'admin', password }];
    console.log(`初始管理员账号: admin / ${password}（请登录后到 config.json 修改）`);
  }
  fs.writeFileSync(configPath, JSON.stringify({ ...DEFAULTS, users }, null, 2) + '\n');
  console.log(`已生成默认配置文件: ${configPath}`);
}

function validate(cfg) {
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    throw new Error('config.json: port 必须为 1-65535 的整数');
  }
  if (!Array.isArray(cfg.users)) throw new Error('config.json: users 必须为数组');
  for (const u of cfg.users) {
    if (!u || !USERNAME_RE.test(u.username || '') || typeof u.password !== 'string' || !u.password) {
      throw new Error(`config.json: 用户配置非法（username 限字母数字._-，password 非空）: ${JSON.stringify(u && u.username)}`);
    }
  }
}

function init(configPath = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) generate(configPath);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`配置文件解析失败: ${configPath}: ${err.message}`);
  }
  const merged = { ...DEFAULTS, ...raw };
  validate(merged);
  config = merged;
  configDir = path.dirname(configPath);
  return config;
}

function get() {
  if (!config) throw new Error('配置未初始化，请先调用 init()');
  return config;
}

function resolveContentDir() {
  const dir = get().contentDir;
  return path.isAbsolute(dir) ? dir : path.resolve(configDir, dir);
}

function hasUsers() {
  return get().users.length > 0;
}

module.exports = { init, get, resolveContentDir, hasUsers, DEFAULTS };
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/config.test.js
```

预期：全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/config.js test/config.test.js
git commit -m "feat: config.json 配置服务（自动生成/默认值合并/校验）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 消费方改造与全部测试适配

**Files:**
- Modify: `server/services/contentStore.js`、`server/services/auth.js`、`server/index.js`
- Delete: `auth.json.example`
- Modify: `.gitignore`（`auth.json` 行改为 `config.json`；保留 `.auth-secret`）
- Modify: `test/auth.test.js`、`test/api.test.js`、`test/health.test.js`、`test/dompurify.test.js`

**Interfaces:**
- Consumes: Task 1 的 config.init/get/resolveContentDir/hasUsers

- [ ] **Step 1: 修改 `server/services/contentStore.js`**

删除 `const CONTENT_DIR = process.env.CONTENT_DIR || ...`，改为惰性：

```js
const config = require('./config');

function contentDir() {
  return config.resolveContentDir();
}
```

`listRepos` 与 `repoDir` 中的 `CONTENT_DIR` 全部替换为 `contentDir()`。

- [ ] **Step 2: 修改 `server/services/auth.js`**

- 删除 `AUTH_FILE` 常量与文件读取；`loadUsers()` 改为：

```js
function loadUsers() {
  const users = config.get().users;
  if (!users.length) throw new Error('config.json 中没有配置任何用户');
  // username/password 校验已在 config.validate 完成
  return users;
}
```

（顶部加 `const config = require('./config');`；`USERNAME_RE` 等如不再使用则删除）
- `getSecret()`：`if (config.get().authSecret) return config.get().authSecret;`，其后沿用 .auth-secret 文件机制；删除 `process.env.AUTH_SECRET` 分支

- [ ] **Step 3: 修改 `server/index.js`**

- `createApp()` 内：`if (require('./services/config').get().trustProxy) app.set('trust proxy', 1);`（替换 `process.env.TRUST_PROXY` 行）
- `require.main` 块改为：

```js
if (require.main === module) {
  const config = require('./services/config');
  config.init(); // config.json 不存在时自动生成
  if (!config.hasUsers()) {
    console.error('config.json 中没有配置任何用户，拒绝启动');
    process.exit(1);
  }
  const port = config.get().port;
  createApp().listen(port, () => console.log(`知识库浏览器已启动: http://localhost:${port}`));
}
```

- [ ] **Step 4: 删除样例、改 .gitignore**

```bash
git rm -q auth.json.example
```
.gitignore 中 `auth.json` 行改为 `config.json`（`.auth-secret` 保留）。

- [ ] **Step 5: 适配四个测试文件**

统一模式（每个文件顶部、require server 模块之前）：

```js
const tmp = makeTempDir('kw-test-');
fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
  contentDir: makeTempDir('kw-content-'),
  users: [{ username: 'tester', password: 'pw' }],
}));
require('../server/services/config').init(path.join(tmp, 'config.json'));
```

具体：
- `test/health.test.js`、`test/api.test.js`、`test/dompurify.test.js`：删除 `process.env.AUTH_FILE`/`AUTH_SECRET`/`CONTENT_DIR` 三行，替换为上述 config init（api.test.js 原来的 `process.env.CONTENT_DIR = makeTempDir(...)` 逻辑并入 config 的 contentDir 字段，文件后续用 `config.get().contentDir` 或保留原变量指向该临时目录）
- `test/auth.test.js`：同样用 config init 提供 `admin/s3cret` 用户；删除 AUTH_SECRET env（测试签名所需密钥——config 的 authSecret 字段写 `'test-secret'`）；`loadUsers 无配置时抛错` 用例改为：`config` 用 users 为空的临时配置重新 init 后断言 `loadUsers()` 抛错；节流测试的 require cache 清理逻辑如涉及 config 需一并保留 init
- 注意：config 是单例，测试文件间在同一进程互不影响（node --test 每个文件独立进程）

- [ ] **Step 6: 跑全部测试**

```bash
node --test test/
```

预期：全部 PASS

- [ ] **Step 7: 冒烟验证**

```bash
rm -f /tmp/kw-smoke/config.json; mkdir -p /tmp/kw-smoke
# 在项目根临时移走 config.json（如有），用副本目录验证首次生成
node server/index.js & sleep 1   # 应打印生成的 admin 密码
curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/   # 302
kill %1
```

验证 config.json 已生成且含 users；恢复现场。

- [ ] **Step 8: Commit**

```bash
git add server/ test/ .gitignore
git commit -m "refactor: 全部配置统一到 config.json，移除环境变量与 auth.json

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: README 与最终验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 「配置」节整体替换为：**

````markdown
## 配置

全部配置在项目根目录的 `config.json` 中（首次启动自动生成，并打印一次初始 admin 密码）：

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
登录接口有频率限制：每 IP 每分钟最多 10 次尝试，超出返回 429。
````

同时更新「启动」节（端口 8080、不再有特权端口说明）与「登录配置」节（删除 auth.json 相关内容，指向「配置」节）。

- [ ] **Step 2: 最终验证**

```bash
node --test test/
node server/index.js & sleep 1   # 项目根 config.json 存在时正常启动
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:$(node -e "console.log(require('./config.json').port||8080)")/
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: config.json 配置说明

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
