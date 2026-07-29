# 登录功能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为知识库浏览器添加配置文件驱动的强制登录（签名 Cookie，零新依赖）。

**Architecture:** `auth.json` 明文用户配置 → services/auth.js（验密、签发/校验 HMAC 令牌）→ 中间件拦截全部请求（仅登录页/登录接口/vendor 例外）→ 前端登录页 + 401 跳转 + 退出按钮。

**Tech Stack:** Node.js ≥ 18（CommonJS）、Express 5、node:test + supertest。

**Spec:** `docs/superpowers/specs/2026-07-29-login-auth-design.md`

## Global Constraints

- Node ≥ 18，CommonJS；express 5.x；**不新增任何 npm 依赖**
- 用户配置：`AUTH_FILE` 环境变量覆盖，默认项目根 `auth.json`（明文密码，gitignore）
- username 字符集 `[A-Za-z0-9._-]`；密码比对用 `crypto.timingSafeEqual`
- Cookie：`auth=<username>|<expiryMs>|<hmac-hex>`，`HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`，HTTPS 加 `Secure`
- 密钥：`AUTH_SECRET` 环境变量优先；否则读/建项目根 `.auth-secret`（0600，gitignore）
- 无有效用户配置时 `loadUsers()` 抛错，启动入口拒绝启动
- 未登录：API（/api/ 前缀）→ 401 JSON；页面 → 302 `/login.html?next=...`；例外仅 `/login.html`、`POST /api/login`、`/vendor/` 前缀
- npm test = `node --test test/`；commit message 结尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

```
server/
├── index.js               # Task 1 修改（挂载 auth 路由 + requireAuth + /api/me + 启动校验）
├── services/auth.js       # Task 1 新建
├── middleware/auth.js     # Task 1 新建（requireAuth）
├── routes/auth.js         # Task 1 新建（/api/login、/api/logout）
public/
├── login.html             # Task 2 新建
├── index.html             # Task 2 修改（header 加用户区）
├── app.js                 # Task 2 修改（401 跳转 + 退出按钮）
test/
├── auth.test.js           # Task 1 新建
├── api.test.js            # Task 2 改造（agent 登录）
├── health.test.js         # Task 2 改造
├── dompurify.test.js      # Task 2 改造
auth.json.example          # Task 3
.gitignore, README.md      # Task 3
```

---

### Task 1: auth 服务、中间件与登录接口

**Files:**
- Create: `server/services/auth.js`
- Create: `server/middleware/auth.js`
- Create: `server/routes/auth.js`
- Modify: `server/index.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Produces（后续任务依赖）:
  - `loadUsers(): Array<{username, password}>`（无配置/空/解析失败抛 Error）
  - `verify(username, password): boolean`
  - `sign(username): {token, maxAgeSec}`，token = `<username>|<expiryMs>|<hmacHex>`
  - `verifyToken(token): string|null`（签名错/过期/格式错 → null）
  - `parseCookies(header): object`
  - `requireAuth` 中间件；`req.user` 为登录用户名

**注意：** 本任务完成后既有测试（api/health/dompurify）会因未登录 401/302 而失败——预期内，Task 2 改造它们。本任务只跑 `node --test test/auth.test.js`。

- [ ] **Step 1: 写失败测试** `test/auth.test.js`

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir } = require('./helpers');

const tmp = makeTempDir('kw-auth-');
process.env.AUTH_FILE = path.join(tmp, 'auth.json');
fs.writeFileSync(process.env.AUTH_FILE, JSON.stringify([{ username: 'admin', password: 's3cret' }]));
process.env.AUTH_SECRET = 'test-secret';

const request = require('supertest');
const auth = require('../server/services/auth');
const { createApp } = require('../server/index');

const app = createApp();

async function login(agent) {
  return agent.post('/api/login').send({ username: 'admin', password: 's3cret' });
}

test('loadUsers 无配置时抛错', () => {
  const saved = process.env.AUTH_FILE;
  process.env.AUTH_FILE = path.join(tmp, 'nonexistent.json');
  delete require.cache[require.resolve('../server/services/auth')];
  assert.throws(() => require('../server/services/auth').loadUsers(), /auth\.json|用户/);
  process.env.AUTH_FILE = saved;
  delete require.cache[require.resolve('../server/services/auth')];
});

test('登录成功签发 Cookie，/api/me 返回用户名', async () => {
  const agent = request.agent(app);
  const res = await login(agent);
  assert.equal(res.status, 200);
  assert.match(res.headers['set-cookie'][0], /auth=.+HttpOnly/);
  const me = await agent.get('/api/me');
  assert.deepEqual(me.body, { username: 'admin' });
});

test('密码错误 401 且不签发 Cookie', async () => {
  const res = await request(app).post('/api/login').send({ username: 'admin', password: 'wrong' });
  assert.equal(res.status, 401);
  assert.ok(!res.headers['set-cookie']);
});

test('未登录访问 API 返回 401', async () => {
  const res = await request(app).get('/api/repos');
  assert.equal(res.status, 401);
});

test('未登录访问页面 302 跳登录页并带 next', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^\/login\.html\?next=/);
});

test('登录页与 vendor 不拦截', async () => {
  assert.notEqual((await request(app).get('/login.html')).status, 302);
  assert.equal((await request(app).get('/vendor/marked/marked.umd.js')).status, 200);
});

test('登出后 Cookie 失效', async () => {
  const agent = request.agent(app);
  await login(agent);
  await agent.post('/api/logout');
  assert.equal((await agent.get('/api/repos')).status, 401);
});

test('签名篡改与过期令牌被拒绝', () => {
  const { token } = auth.sign('admin');
  assert.equal(auth.verifyToken(token), 'admin');
  assert.equal(auth.verifyToken(token.slice(0, -2) + '00'), null);
  const expired = `admin|${Date.now() - 1000}|${'0'.repeat(64)}`;
  assert.equal(auth.verifyToken(expired), null);
  assert.equal(auth.verifyToken('garbage'), null);
});

test('verifyToken 拒绝不存在用户与错误格式', () => {
  const { token } = auth.sign('ghost');
  assert.equal(auth.verifyToken(token), null);
});
```

注：最后一个测试要求 verifyToken 同时校验用户仍存在于配置中。

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/auth.test.js
```

预期：FAIL（模块不存在）

- [ ] **Step 3: 实现** `server/services/auth.js`

```js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_FILE = process.env.AUTH_FILE || path.join(__dirname, '..', '..', 'auth.json');
const SECRET_FILE = path.join(__dirname, '..', '..', '.auth-secret');
const MAX_AGE_SEC = 7 * 24 * 3600; // 7 天
const USERNAME_RE = /^[A-Za-z0-9._-]+$/;

function loadUsers() {
  let users;
  try {
    users = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    throw new Error(`无法读取用户配置 ${AUTH_FILE}，请参照 auth.json.example 创建`);
  }
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error(`${AUTH_FILE} 中没有配置任何用户`);
  }
  for (const u of users) {
    if (!u || !USERNAME_RE.test(u.username || '') || typeof u.password !== 'string' || !u.password) {
      throw new Error(`用户配置非法（username 限字母数字._-，password 为非空明文）: ${JSON.stringify(u && u.username)}`);
    }
  }
  return users;
}

function verify(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return false;
  const user = loadUsers().find(u => u.username === username);
  if (!user) return false;
  const a = Buffer.from(user.password);
  const b = Buffer.from(password);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
}

function hmac(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

function sign(username) {
  const expiry = Date.now() + MAX_AGE_SEC * 1000;
  const payload = `${username}|${expiry}`;
  return { token: `${payload}|${hmac(payload)}`, maxAgeSec: MAX_AGE_SEC };
}

function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('|');
  if (parts.length !== 3) return null;
  const [username, expiry, sig] = parts;
  const payload = `${username}|${expiry}`;
  const expect = Buffer.from(hmac(payload));
  const actual = Buffer.from(sig);
  if (expect.length !== actual.length || !crypto.timingSafeEqual(expect, actual)) return null;
  if (Number(expiry) < Date.now()) return null;
  if (!loadUsers().some(u => u.username === username)) return null;
  return username;
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

module.exports = { loadUsers, verify, sign, verifyToken, parseCookies, MAX_AGE_SEC };
```

- [ ] **Step 4: 实现** `server/middleware/auth.js`

```js
const auth = require('../services/auth');

// 例外：登录页、登录接口、vendor 静态资源
function isExempt(req) {
  return req.path === '/login.html'
    || (req.path === '/api/login' && req.method === 'POST')
    || req.path.startsWith('/vendor/');
}

function requireAuth(req, res, next) {
  if (isExempt(req)) return next();
  const username = auth.verifyToken(auth.parseCookies(req.headers.cookie).auth);
  if (!username) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: '未登录' });
    return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
  }
  req.user = username;
  next();
}

module.exports = { requireAuth };
```

- [ ] **Step 5: 实现** `server/routes/auth.js`

```js
const express = require('express');
const auth = require('../services/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!auth.verify(username, password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const { token, maxAgeSec } = auth.sign(username);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `auth=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`);
  res.json({ ok: true, username });
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 6: 修改 `server/index.js`**

在 `app.get('/api/health', ...)` 之前插入（json 中间件之后）：

```js
  app.use('/api', require('./routes/auth'));
  app.use(require('./middleware/auth').requireAuth);
```

在 requireAuth 之后、现有路由区任意处加：

```js
  app.get('/api/me', (req, res) => res.json({ username: req.user }));
```

在 `if (require.main === module)` 块内 listen 之前加启动校验：

```js
  require('./services/auth').loadUsers(); // 无有效用户配置时抛错拒绝启动
```

- [ ] **Step 7: 跑测试**

```bash
node --test test/auth.test.js
```

预期：全部 PASS（api/health/dompurify 测试此时失败属预期，Task 2 修复）

- [ ] **Step 8: Commit**

```bash
git add server/services/auth.js server/middleware/auth.js server/routes/auth.js server/index.js test/auth.test.js
git commit -m "feat: 登录服务、鉴权中间件与登录/登出接口

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 登录页与前端接入、既有测试改造

**Files:**
- Create: `public/login.html`
- Modify: `public/index.html`（header 右侧加用户区）
- Modify: `public/app.js`（401 跳转 + 加载用户 + 退出）
- Modify: `test/api.test.js`、`test/health.test.js`、`test/dompurify.test.js`（agent 登录）

**Interfaces:**
- Consumes: Task 1 全部接口

- [ ] **Step 1: 创建 `public/login.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>登录 - 知识库浏览器</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           background: #f4f6f7; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.08);
            padding: 32px; width: 320px; }
    h1 { font-size: 20px; margin: 0 0 24px; text-align: center; }
    input { width: 100%; box-sizing: border-box; padding: 10px 12px; margin-bottom: 14px;
            border: 1px solid #d5dde1; border-radius: 8px; font-size: 14px; }
    button { width: 100%; padding: 10px; border: none; border-radius: 8px; background: #0e7c86;
             color: #fff; font-size: 15px; cursor: pointer; }
    button:hover { background: #11616b; }
    .error { color: #b23a48; font-size: 13px; min-height: 18px; margin-bottom: 8px; text-align: center; }
  </style>
</head>
<body>
  <form class="card" id="login-form">
    <h1>知识库浏览器</h1>
    <div class="error" id="error"></div>
    <input id="username" autocomplete="username" placeholder="用户名" required autofocus>
    <input id="password" type="password" autocomplete="current-password" placeholder="密码" required>
    <button type="submit">登 录</button>
  </form>
  <script>
    const next = new URLSearchParams(location.search).get('next') || '/';
    document.getElementById('login-form').onsubmit = async e => {
      e.preventDefault();
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value.trim(),
          password: document.getElementById('password').value,
        }),
      });
      if (res.ok) {
        location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
      } else {
        const data = await res.json().catch(() => ({}));
        document.getElementById('error').textContent = data.error || '登录失败';
      }
    };
  </script>
</body>
</html>
```

注：`next` 校验仅允许站内相对路径，防开放重定向。

- [ ] **Step 2: 修改 `public/index.html`**——header 内 search input 之后加：

```html
    <span id="user-info"></span>
    <button id="btn-logout">退出</button>
```

- [ ] **Step 3: 修改 `public/app.js`**

`api()` 函数的 `if (!res.ok)` 处改为先处理 401：

```js
  if (res.status === 401) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new Error('未登录');
  }
```

文件末尾 `loadRepos();` 之前加：

```js
async function loadUser() {
  try {
    const { username } = await api('/api/me');
    $('#user-info').textContent = username;
  } catch { /* 未登录时 api() 已跳转 */ }
}

$('#btn-logout').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login.html';
};

loadUser();
```

- [ ] **Step 4: 改造既有测试**

三个文件都在顶部（require app 之前）加 auth fixture，并把 `request(app)` 改为登录过的 agent。

`test/health.test.js` 整体改为：

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir } = require('./helpers');

const tmp = makeTempDir('kw-auth-');
process.env.AUTH_FILE = path.join(tmp, 'auth.json');
fs.writeFileSync(process.env.AUTH_FILE, JSON.stringify([{ username: 'tester', password: 'pw' }]));
process.env.AUTH_SECRET = 'test-secret';

const request = require('supertest');
const { createApp } = require('../server/index');

let agent;
before(async () => {
  agent = request.agent(createApp());
  await agent.post('/api/login').send({ username: 'tester', password: 'pw' });
});

test('GET /api/health 返回 ok', async () => {
  const res = await agent.get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
```

`test/api.test.js`：顶部加同样的 fixture（在 `process.env.CONTENT_DIR` 设置之后、`require` app 之前），`const app = createApp()` 改为：

```js
let agent;
const req = {
  get: (...a) => agent.get(...a),
  post: (...a) => agent.post(...a),
  put: (...a) => agent.put(...a),
  delete: (...a) => agent.delete(...a),
};
```

并在 before 块开头加登录：

```js
  agent = request.agent(createApp());
  await agent.post('/api/login').send({ username: 'tester', password: 'pw' });
```

然后全文把 `request(app)` 替换为 `req`（如 `await request(app).get(...)` → `await req.get(...)`）。

`test/dompurify.test.js` 同样处理（fixture + agent + 替换）。

注意 before 变为 async。各文件的 CONTENT_DIR / vendor 断言保持不变。

- [ ] **Step 5: 跑全部测试**

```bash
node --test test/
```

预期：全部 PASS

- [ ] **Step 6: 冒烟验证**

```bash
AUTH_FILE=/tmp/smoke-auth.json PORT=3217 node server/index.js &
```
（先 `echo '[{"username":"admin","password":"pw"}]' > /tmp/smoke-auth.json`）
curl 验证：GET / → 302 login.html；POST /api/login 错误密码 → 401；正确密码 → 200 + Set-Cookie；带 Cookie GET /api/repos → 200；GET /login.html → 200。最后 kill 服务。

- [ ] **Step 7: Commit**

```bash
git add public/login.html public/index.html public/app.js test/
git commit -m "feat: 登录页、前端鉴权接入与测试改造

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 配置样例、README 与最终验证

**Files:**
- Create: `auth.json.example`
- Modify: `.gitignore`、`README.md`

- [ ] **Step 1: 创建 `auth.json.example`**

```json
[
  { "username": "admin", "password": "请修改为你的密码" }
]
```

- [ ] **Step 2: 修改 `.gitignore`**，追加：

```
auth.json
.auth-secret
```

- [ ] **Step 3: README「前置要求」后追加一节：**

```markdown
## 登录配置

网站强制登录。首次启动前，复制配置样例并修改用户名密码：

```bash
cp auth.json.example auth.json
```

`auth.json` 为用户名/明文密码数组，可配置多个用户；用户名限字母、数字、`.`、`_`、`-`。
修改 `auth.json` 后重启服务生效。未配置有效用户时服务拒绝启动。
签名密钥自动生成于 `.auth-secret`（可用 `AUTH_SECRET` 环境变量覆盖），登录态 7 天有效。
```

同时把「使用」节中「文件管理」条目更新为与当前界面一致（界面上已无网页文件管理按钮，资料直接放入 content/）。

- [ ] **Step 4: 最终验证**

```bash
node --test test/
# 无 auth.json 时拒绝启动（在项目根无 auth.json 的前提下）
node server/index.js; echo "exit=$?"   # 期望报错退出 exit=1
cp auth.json.example auth.json
PORT=3218 node server/index.js & sleep 1
curl -s -o /dev/null -w '%{http_code}' http://localhost:3218/   # 302
kill %1; rm auth.json
```

- [ ] **Step 5: Commit**

```bash
git add auth.json.example .gitignore README.md
git commit -m "docs: 登录配置样例、gitignore 与 README

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
