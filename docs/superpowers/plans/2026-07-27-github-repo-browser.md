# GitHub 仓库知识库浏览器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个可添加 GitHub 仓库并在线浏览/编辑其中 HTML 与 Markdown 文件的网站，`npm install && npm start` 一条命令启动。

**Architecture:** 单一 Express 进程同时提供 REST API 与静态前端（无构建 vanilla JS SPA）；仓库通过 `git clone` 落地到 `data/repos/<owner>__<repo>/`，搜索优先调 `rg`、缺失时降级为 Node 遍历。

**Tech Stack:** Node.js ≥ 18（CommonJS）、Express 4、marked + highlight.js（本地 vendor）、node:test + supertest。

**Spec:** `docs/superpowers/specs/2026-07-27-github-repo-browser-design.md`

## Global Constraints

- Node ≥ 18，CommonJS（package.json 不设 `"type": "module"`）
- 运行时依赖仅 `express`、`marked`、`@highlightjs/cdn-assets`；dev 依赖仅 `supertest`
- 端口默认 3000，`PORT` 环境变量覆盖
- 数据目录默认 `data/`，`DATA_DIR` 环境变量覆盖（测试用它隔离临时目录）
- 所有文件路径参数必须经过 `safeResolve` 校验，拒绝 `..` 逃逸
- 仓库 id 格式 `owner__repo`，匹配 `/^[A-Za-z0-9._-]+__[A-Za-z0-9._-]+$/`
- `npm start` = `node server/index.js`；`npm test` = `node --test test/`
- commit message 结尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

```
KnowledgeWebSite/
├── package.json            # Task 1
├── .gitignore              # Task 1
├── server/
│   ├── index.js            # Task 1 骨架，Task 4/5/6 逐步挂载路由
│   ├── routes/repos.js     # Task 4
│   ├── routes/files.js     # Task 5
│   ├── routes/search.js    # Task 6
│   └── services/
│       ├── repoStore.js    # Task 2
│       ├── git.js          # Task 3
│       └── search.js       # Task 6
├── test/
│   ├── helpers.js          # Task 2（临时 git 仓库工具）
│   ├── repoStore.test.js   # Task 2
│   ├── git.test.js         # Task 3
│   └── api.test.js         # Task 4/5/6 逐步追加
├── public/
│   ├── index.html          # Task 7
│   ├── app.js              # Task 7
│   └── style.css           # Task 7
└── README.md               # Task 8
```

---

### Task 1: 项目脚手架与 Express 入口

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `server/index.js`
- Test: `test/health.test.js`

**Interfaces:**
- Produces: `createApp(): Express`（后续所有任务挂载路由的对象）；`GET /api/health` → `{ok: true}`

- [ ] **Step 1: 写失败测试** `test/health.test.js`

```js
const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../server/index');

test('GET /api/health 返回 ok', async () => {
  const res = await request(createApp()).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
```

- [ ] **Step 2: 初始化 package.json、安装依赖、确认测试失败**

```bash
npm init -y
npm pkg set name="knowledge-website" private=true main="server/index.js" \
  scripts.start="node server/index.js" scripts.test="node --test test/"
npm install express marked @highlightjs/cdn-assets
npm install --save-dev supertest
node --test test/
```

预期：FAIL（`Cannot find module '../server/index'`）

- [ ] **Step 3: 实现入口** `server/index.js`

```js
const path = require('path');
const express = require('express');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/vendor/marked', express.static(path.join(__dirname, '..', 'node_modules', 'marked', 'lib')));
  app.use('/vendor/highlight', express.static(path.join(__dirname, '..', 'node_modules', '@highlightjs', 'cdn-assets')));

  // 统一错误处理：err.status 缺省 500
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`知识库浏览器已启动: http://localhost:${port}`));
}

module.exports = { createApp };
```

- [ ] **Step 4: 写 .gitignore 并跑测试**

```
node_modules/
data/
```

```bash
node --test test/
```

预期：PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore server/index.js test/health.test.js
git commit -m "feat: Express 入口与脚手架

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: repoStore 服务（仓库清单与路径安全）

**Files:**
- Create: `server/services/repoStore.js`
- Create: `test/helpers.js`
- Test: `test/repoStore.test.js`

**Interfaces:**
- Produces（Task 4/5/6 依赖）:
  - `class HttpError extends Error`，含 `status` 字段
  - `listRepos(): Repo[]`，`Repo = {id, url, status: 'cloning'|'ready'|'error', error, addedAt, lastPullAt?}`
  - `getRepo(id): Repo`（不存在抛 404）
  - `addRepo(entry): Repo`（id 重复抛 409）
  - `updateRepo(id, patch): Repo`
  - `removeRepo(id): void`（不存在抛 404）
  - `repoDir(id): string`（id 不合法抛 400）
  - `safeResolve(id, relPath): string`（逃逸抛 400）
  - `repoIdFromUrl(url): string`

- [ ] **Step 1: 写测试工具** `test/helpers.js`

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

// 创建包含指定文件的本地 git 仓库（main 分支，一个 commit），返回路径
function makeSourceRepo(files) {
  const dir = makeTempDir('kw-src-');
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git(['add', '.'], dir);
  git(['commit', '-m', 'init'], dir);
  return dir;
}

module.exports = { makeTempDir, makeSourceRepo, git };
```

- [ ] **Step 2: 写失败测试** `test/repoStore.test.js`

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempDir } = require('./helpers');

process.env.DATA_DIR = makeTempDir('kw-data-');
const store = require('../server/services/repoStore');

test('添加并列出仓库', () => {
  store.addRepo({ id: 'octo__hello', url: 'https://github.com/octo/hello', status: 'ready', error: null, addedAt: new Date().toISOString() });
  const repos = store.listRepos();
  assert.equal(repos.length, 1);
  assert.equal(repos[0].id, 'octo__hello');
});

test('重复添加抛 409', () => {
  assert.throws(
    () => store.addRepo({ id: 'octo__hello', url: 'x', status: 'ready' }),
    err => err.status === 409
  );
});

test('从 GitHub URL 解析 id', () => {
  assert.equal(store.repoIdFromUrl('https://github.com/octo/hello'), 'octo__hello');
  assert.equal(store.repoIdFromUrl('https://github.com/octo/hello.git'), 'octo__hello');
  assert.equal(store.repoIdFromUrl('git@github.com:octo/hello.git'), 'octo__hello');
});

test('本地路径解析为 local__<basename>', () => {
  assert.equal(store.repoIdFromUrl('/tmp/my-repo'), 'local__my-repo');
});

test('safeResolve 拒绝路径逃逸', () => {
  assert.throws(
    () => store.safeResolve('octo__hello', '../../../etc/passwd'),
    err => err.status === 400
  );
});

test('safeResolve 允许仓库内路径', () => {
  const p = store.safeResolve('octo__hello', 'docs/a.md');
  assert.ok(p.includes('octo__hello'));
});

test('非法仓库 id 被拒绝', () => {
  assert.throws(() => store.repoDir('../evil'), err => err.status === 400);
});

test('getRepo 不存在抛 404', () => {
  assert.throws(() => store.getRepo('no__such'), err => err.status === 404);
});
```

注意：`process.env.DATA_DIR` 必须在 `require` repoStore 之前设置（模块加载时读取一次）。

- [ ] **Step 3: 跑测试确认失败**

```bash
node --test test/repoStore.test.js
```

预期：FAIL（`Cannot find module '../server/services/repoStore'`）

- [ ] **Step 4: 实现** `server/services/repoStore.js`

```js
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const REPOS_DIR = path.join(DATA_DIR, 'repos');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const ID_RE = /^[A-Za-z0-9._-]+__[A-Za-z0-9._-]+$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function ensureDirs() {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '[]');
}

function listRepos() {
  ensureDirs();
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveAll(repos) {
  ensureDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(repos, null, 2));
}

function getRepo(id) {
  const repo = listRepos().find(r => r.id === id);
  if (!repo) throw new HttpError(404, `仓库不存在: ${id}`);
  return repo;
}

function addRepo(entry) {
  const repos = listRepos();
  if (repos.some(r => r.id === entry.id)) throw new HttpError(409, `仓库已存在: ${entry.id}`);
  repos.push(entry);
  saveAll(repos);
  return entry;
}

function updateRepo(id, patch) {
  const repos = listRepos();
  const repo = repos.find(r => r.id === id);
  if (!repo) throw new HttpError(404, `仓库不存在: ${id}`);
  Object.assign(repo, patch);
  saveAll(repos);
  return repo;
}

function removeRepo(id) {
  const repos = listRepos();
  const next = repos.filter(r => r.id !== id);
  if (next.length === repos.length) throw new HttpError(404, `仓库不存在: ${id}`);
  saveAll(next);
}

function repoDir(id) {
  if (!ID_RE.test(id)) throw new HttpError(400, `非法仓库 id: ${id}`);
  return path.join(REPOS_DIR, id);
}

function safeResolve(id, relPath) {
  const base = repoDir(id);
  const resolved = path.resolve(base, relPath || '');
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new HttpError(400, `非法路径: ${relPath}`);
  }
  return resolved;
}

function repoIdFromUrl(url) {
  const m = url.match(/github\.com[/:]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
  if (m) return `${m[1]}__${m[2]}`;
  const base = path.basename(url.replace(/\/+$/, '')).replace(/\.git$/, '');
  if (/^[A-Za-z0-9._-]+$/.test(base)) return `local__${base}`;
  throw new HttpError(400, `无法从 URL 解析仓库标识: ${url}`);
}

module.exports = {
  HttpError, listRepos, getRepo, addRepo, updateRepo, removeRepo,
  repoDir, safeResolve, repoIdFromUrl, REPOS_DIR,
};
```

- [ ] **Step 5: 跑测试确认通过**

```bash
node --test test/
```

预期：全部 PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/repoStore.js test/helpers.js test/repoStore.test.js
git commit -m "feat: repoStore 仓库清单与路径安全校验

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: git 服务（clone / pull / resetHard）

**Files:**
- Create: `server/services/git.js`
- Test: `test/git.test.js`

**Interfaces:**
- Produces（Task 4 依赖）:
  - `clone(url, token, dest): Promise<void>`
  - `pull(dir): Promise<string>`（返回 git 输出）
  - `resetHard(dir): Promise<void>`
  - 失败时 reject 的 Error 带 `stderr` 字段

- [ ] **Step 1: 写失败测试** `test/git.test.js`

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, makeSourceRepo, git: gitCmd } = require('./helpers');
const git = require('../server/services/git');

test('clone 本地仓库', async () => {
  const src = makeSourceRepo({ 'README.md': '# hi\n' });
  const dest = path.join(makeTempDir('kw-dst-'), 'clone');
  await git.clone(src, undefined, dest);
  assert.equal(fs.readFileSync(path.join(dest, 'README.md'), 'utf8'), '# hi\n');
});

test('pull 获取新提交', async () => {
  const src = makeSourceRepo({ 'a.md': 'v1\n' });
  const dest = path.join(makeTempDir('kw-dst-'), 'clone');
  await git.clone(src, undefined, dest);
  fs.writeFileSync(path.join(src, 'a.md'), 'v2\n');
  gitCmd(['add', '.'], src);
  gitCmd(['commit', '-m', 'update'], src);
  await git.pull(dest);
  assert.equal(fs.readFileSync(path.join(dest, 'a.md'), 'utf8'), 'v2\n');
});

test('resetHard 放弃本地修改', async () => {
  const src = makeSourceRepo({ 'a.md': 'v1\n' });
  const dest = path.join(makeTempDir('kw-dst-'), 'clone');
  await git.clone(src, undefined, dest);
  fs.writeFileSync(path.join(dest, 'a.md'), '本地改动\n');
  await git.resetHard(dest);
  assert.equal(fs.readFileSync(path.join(dest, 'a.md'), 'utf8'), 'v1\n');
});

test('clone 失败时 Error 带 stderr', async () => {
  const dest = path.join(makeTempDir('kw-dst-'), 'clone');
  await assert.rejects(
    git.clone('/nonexistent/repo', undefined, dest),
    err => typeof err.stderr === 'string' && err.stderr.length > 0
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/git.test.js
```

预期：FAIL（模块不存在）

- [ ] **Step 3: 实现** `server/services/git.js`

```js
const { execFile } = require('child_process');

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function urlWithToken(url, token) {
  if (token && url.startsWith('https://')) {
    return url.replace('https://', `https://${encodeURIComponent(token)}@`);
  }
  return url;
}

async function clone(url, token, dest) {
  await run(['clone', urlWithToken(url, token), dest]);
}

async function pull(dir) {
  const { stdout, stderr } = await run(['pull', '--ff-only'], { cwd: dir });
  return (stdout + stderr).trim();
}

async function resetHard(dir) {
  const { stdout } = await run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
  const branch = stdout.trim();
  await run(['reset', '--hard', `origin/${branch}`], { cwd: dir });
}

module.exports = { clone, pull, resetHard };
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/
```

预期：全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/git.js test/git.test.js
git commit -m "feat: git clone/pull/resetHard 服务

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 仓库管理路由（添加/列表/pull/reset/删除）

**Files:**
- Create: `server/routes/repos.js`
- Modify: `server/index.js`（挂载路由）
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: Task 2 的 repoStore 全部接口；Task 3 的 `clone/pull/resetHard`
- Produces: `POST /api/repos` → 202 `{id, url, status:'cloning', ...}`；`GET /api/repos` → Repo[]；`POST /api/repos/:id/pull` → `{ok, output}`；`POST /api/repos/:id/reset` → `{ok:true}`；`DELETE /api/repos/:id` → `{ok:true}`

- [ ] **Step 1: 写失败测试** `test/api.test.js`

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { makeTempDir, makeSourceRepo } = require('./helpers');

process.env.DATA_DIR = makeTempDir('kw-data-');
const request = require('supertest');
const { createApp } = require('../server/index');
const store = require('../server/services/repoStore');

const app = createApp();

async function waitReady(id, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const repo = store.listRepos().find(r => r.id === id);
    if (repo && repo.status !== 'cloning') return repo;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('等待 clone 超时');
}

let srcDir;
before(() => {
  srcDir = makeSourceRepo({
    'README.md': '# 你好\n关键词在此\n',
    'docs/guide.md': '指南 包含关键词\n',
    'index.html': '<html><body>hi</body></html>\n',
    'script.js': 'console.log(1)\n',
  });
});

test('POST /api/repos 添加仓库并异步克隆成功', async () => {
  const res = await request(app).post('/api/repos').send({ url: srcDir });
  assert.equal(res.status, 202);
  assert.equal(res.body.status, 'cloning');
  const repo = await waitReady(res.body.id);
  assert.equal(repo.status, 'ready');
});

test('POST /api/repos 缺少 url 返回 400', async () => {
  const res = await request(app).post('/api/repos').send({});
  assert.equal(res.status, 400);
});

test('POST /api/repos 重复添加返回 409', async () => {
  const res = await request(app).post('/api/repos').send({ url: srcDir });
  assert.equal(res.status, 409);
});

test('POST /api/repos 克隆失败状态为 error', async () => {
  const res = await request(app).post('/api/repos').send({ url: '/nonexistent/bad-repo' });
  assert.equal(res.status, 202);
  const repo = await waitReady(res.body.id);
  assert.equal(repo.status, 'error');
  assert.ok(repo.error);
  // 清理
  await request(app).delete(`/api/repos/${repo.id}`);
});

test('GET /api/repos 返回仓库列表', async () => {
  const res = await request(app).get('/api/repos');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
});

test('pull 更新成功', async () => {
  const id = store.listRepos()[0].id;
  const res = await request(app).post(`/api/repos/${id}/pull`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('reset 接口可用', async () => {
  const id = store.listRepos()[0].id;
  const res = await request(app).post(`/api/repos/${id}/reset`);
  assert.equal(res.status, 200);
});

test('删除仓库移除目录与配置', async () => {
  const id = store.listRepos()[0].id;
  const dir = store.repoDir(id);
  const res = await request(app).delete(`/api/repos/${id}`);
  assert.equal(res.status, 200);
  assert.ok(!fs.existsSync(dir));
  assert.equal(store.listRepos().length, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/api.test.js
```

预期：FAIL（POST /api/repos 返回 404）

- [ ] **Step 3: 实现** `server/routes/repos.js`

```js
const express = require('express');
const fs = require('fs');
const store = require('../services/repoStore');
const git = require('../services/git');

const router = express.Router();

function wrapGitError(err) {
  if (!err.status) {
    err.status = 500;
    err.message = err.stderr || err.message;
  }
  return err;
}

router.get('/', (req, res) => res.json(store.listRepos()));

router.post('/', (req, res, next) => {
  try {
    const { url, token } = req.body || {};
    if (!url || typeof url !== 'string') throw new store.HttpError(400, '缺少 url');
    const id = store.repoIdFromUrl(url);
    const repo = store.addRepo({
      id, url, status: 'cloning', error: null, addedAt: new Date().toISOString(),
    });
    // 异步 clone，完成后更新状态
    git.clone(url, token, store.repoDir(id))
      .then(() => store.updateRepo(id, { status: 'ready', error: null }))
      .catch(err => {
        store.updateRepo(id, { status: 'error', error: err.stderr || err.message });
        fs.rm(store.repoDir(id), { recursive: true, force: true }, () => {});
      });
    res.status(202).json(repo);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/pull', async (req, res, next) => {
  try {
    const repo = store.getRepo(req.params.id);
    const output = await git.pull(store.repoDir(repo.id));
    store.updateRepo(repo.id, { lastPullAt: new Date().toISOString() });
    res.json({ ok: true, output });
  } catch (err) {
    next(wrapGitError(err));
  }
});

router.post('/:id/reset', async (req, res, next) => {
  try {
    const repo = store.getRepo(req.params.id);
    await git.resetHard(store.repoDir(repo.id));
    res.json({ ok: true });
  } catch (err) {
    next(wrapGitError(err));
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const repo = store.getRepo(req.params.id);
    store.removeRepo(repo.id);
    fs.rmSync(store.repoDir(repo.id), { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: 挂载路由**，修改 `server/index.js`，在 `app.get('/api/health', ...)` 之后加入：

```js
  app.use('/api/repos', require('./routes/repos'));
```

- [ ] **Step 5: 跑测试确认通过**

```bash
node --test test/
```

预期：全部 PASS

- [ ] **Step 6: Commit**

```bash
git add server/routes/repos.js server/index.js test/api.test.js
git commit -m "feat: 仓库管理 API（添加/列表/pull/reset/删除）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 文件路由（目录树/读/写/raw）

**Files:**
- Create: `server/routes/files.js`
- Modify: `server/index.js`（挂载路由）
- Modify: `test/api.test.js`（追加测试）

**Interfaces:**
- Consumes: repoStore 的 `getRepo/repoDir/safeResolve/HttpError`
- Produces: `GET /api/repos/:id/tree` → `{name, type:'dir', children:[{name, path, type, ext?|children?}]}`；`GET /api/repos/:id/file?path=` → `{path, content}`；`PUT /api/repos/:id/file?path=` body `{content}`；`GET /api/repos/:id/raw?path=` → 原始文件

- [ ] **Step 1: 追加失败测试**（在 `test/api.test.js` 的 before 块之后、删除测试之前插入，并保持最后重新添加一个干净仓库供 Task 6 使用——直接在「删除仓库」测试后追加以下测试，先重新克隆）

在 `test/api.test.js` 末尾追加：

```js
let id2;
test('准备：重新添加仓库用于文件与搜索测试', async () => {
  const res = await request(app).post('/api/repos').send({ url: srcDir });
  id2 = (await waitReady(res.body.id)).id;
  assert.ok(id2);
});

test('GET tree 返回目录结构并标注扩展名', async () => {
  const res = await request(app).get(`/api/repos/${id2}/tree`);
  assert.equal(res.status, 200);
  const names = res.body.children.map(c => c.name);
  assert.ok(names.includes('README.md'));
  assert.ok(names.includes('docs'));
  const docs = res.body.children.find(c => c.name === 'docs');
  assert.equal(docs.children[0].ext, '.md');
});

test('GET file 读取文件内容', async () => {
  const res = await request(app).get(`/api/repos/${id2}/file`).query({ path: 'README.md' });
  assert.equal(res.status, 200);
  assert.match(res.body.content, /你好/);
});

test('GET file 路径逃逸返回 400', async () => {
  const res = await request(app).get(`/api/repos/${id2}/file`).query({ path: '../../../etc/passwd' });
  assert.equal(res.status, 400);
});

test('GET file 不存在返回 404', async () => {
  const res = await request(app).get(`/api/repos/${id2}/file`).query({ path: 'no-such.md' });
  assert.equal(res.status, 404);
});

test('PUT file 保存后读取到新内容', async () => {
  await request(app).put(`/api/repos/${id2}/file`).query({ path: 'README.md' }).send({ content: '# 已修改\n' });
  const res = await request(app).get(`/api/repos/${id2}/file`).query({ path: 'README.md' });
  assert.equal(res.body.content, '# 已修改\n');
});

test('PUT file 缺少 content 返回 400', async () => {
  const res = await request(app).put(`/api/repos/${id2}/file`).query({ path: 'README.md' }).send({});
  assert.equal(res.status, 400);
});

test('GET raw 返回原始 HTML', async () => {
  const res = await request(app).get(`/api/repos/${id2}/raw`).query({ path: 'index.html' });
  assert.equal(res.status, 200);
  assert.match(res.text, /<html>/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/api.test.js
```

预期：FAIL（tree/file/raw 返回 404）

- [ ] **Step 3: 实现** `server/routes/files.js`

```js
const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('../services/repoStore');

const router = express.Router();

function buildTree(dir, base) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.name !== '.git')
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
    .map(e => {
      const full = path.join(dir, e.name);
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (e.isDirectory()) {
        return { name: e.name, path: rel, type: 'dir', children: buildTree(full, base) };
      }
      return { name: e.name, path: rel, type: 'file', ext: path.extname(e.name).toLowerCase() };
    });
}

function isBinary(buf) {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

router.get('/:id/tree', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    const dir = store.repoDir(req.params.id);
    res.json({ name: req.params.id, type: 'dir', children: buildTree(dir, dir) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/file', (req, res, next) => {
  try {
    const full = store.safeResolve(req.params.id, req.query.path);
    const buf = fs.readFileSync(full);
    if (isBinary(buf)) throw new store.HttpError(415, '二进制文件不支持查看');
    res.json({ path: req.query.path, content: buf.toString('utf8') });
  } catch (err) {
    if (err.code === 'ENOENT') err = new store.HttpError(404, '文件不存在');
    next(err);
  }
});

router.put('/:id/file', (req, res, next) => {
  try {
    const full = store.safeResolve(req.params.id, req.query.path);
    if (typeof (req.body || {}).content !== 'string') throw new store.HttpError(400, '缺少 content');
    fs.writeFileSync(full, req.body.content, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/raw', (req, res, next) => {
  try {
    const full = store.safeResolve(req.params.id, req.query.path);
    res.sendFile(full);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: 挂载路由**，修改 `server/index.js`，在 repos 路由之后加入：

```js
  app.use('/api/repos', require('./routes/files'));
```

- [ ] **Step 5: 跑测试确认通过**

```bash
node --test test/
```

预期：全部 PASS

- [ ] **Step 6: Commit**

```bash
git add server/routes/files.js server/index.js test/api.test.js
git commit -m "feat: 文件 API（目录树/读写/raw）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 搜索服务与路由

**Files:**
- Create: `server/services/search.js`
- Create: `server/routes/search.js`
- Modify: `server/index.js`（挂载路由）
- Modify: `test/api.test.js`（追加搜索测试）

**Interfaces:**
- Produces: `search(dir, query): Promise<Array<{path, line, text}>>`（rg 优先，缺失时降级 Node 遍历，上限 200 条）；`GET /api/repos/:id/search?q=` → `{query, results}`

- [ ] **Step 1: 追加失败测试**（在 `test/api.test.js` 末尾追加）

```js
test('搜索命中并返回行号', async () => {
  const res = await request(app).get(`/api/repos/${id2}/search`).query({ q: '关键词' });
  assert.equal(res.status, 200);
  const hit = res.body.results.find(r => r.path.endsWith('guide.md'));
  assert.ok(hit, '应命中 docs/guide.md');
  assert.equal(hit.line, 1);
  assert.match(hit.text, /关键词/);
});

test('搜索不匹配的 js 文件之外内容', async () => {
  const res = await request(app).get(`/api/repos/${id2}/search`).query({ q: 'console.log' });
  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 0, 'js 文件不在搜索范围');
});

test('搜索缺少 q 返回 400', async () => {
  const res = await request(app).get(`/api/repos/${id2}/search`);
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/api.test.js
```

预期：FAIL（search 返回 404）

- [ ] **Step 3: 实现** `server/services/search.js`

```js
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAX_RESULTS = 200;
const EXTS = new Set(['.md', '.markdown', '.html', '.htm']);

function rgSearch(dir, query) {
  return new Promise((resolve, reject) => {
    const args = [
      '--line-number', '--no-heading', '--fixed-strings',
      '-g', '*.md', '-g', '*.markdown', '-g', '*.html', '-g', '*.htm',
      '--', query, '.',
    ];
    execFile('rg', args, { cwd: dir, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        if (err.code === 'ENOENT') return reject(err); // rg 未安装
        if (err.code === 1) return resolve([]);        // 无匹配
        return reject(err);
      }
      resolve(parseRg(stdout));
    });
  });
}

function parseRg(stdout) {
  return stdout.trim().split('\n').filter(Boolean)
    .map(line => {
      const m = line.match(/^\.\/?([^:]+):(\d+):(.*)$/);
      return m && { path: m[1], line: Number(m[2]), text: m[3].trim() };
    })
    .filter(Boolean)
    .slice(0, MAX_RESULTS);
}

function nodeSearch(dir, query) {
  const results = [];
  walk(dir);
  return results;

  function walk(current) {
    if (results.length >= MAX_RESULTS) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (results.length >= MAX_RESULTS) return;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (EXTS.has(path.extname(entry.name).toLowerCase())) {
        let lines;
        try {
          lines = fs.readFileSync(full, 'utf8').split('\n');
        } catch {
          continue; // 跳过无法按 UTF-8 读取的文件
        }
        lines.forEach((text, i) => {
          if (results.length < MAX_RESULTS && text.includes(query)) {
            results.push({ path: path.relative(dir, full), line: i + 1, text: text.trim() });
          }
        });
      }
    }
  }
}

async function search(dir, query) {
  try {
    return await rgSearch(dir, query);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('未找到 rg，搜索降级为 Node 遍历');
      return nodeSearch(dir, query);
    }
    throw err;
  }
}

module.exports = { search };
```

- [ ] **Step 4: 实现** `server/routes/search.js`

```js
const express = require('express');
const store = require('../services/repoStore');
const { search } = require('../services/search');

const router = express.Router();

router.get('/:id/search', async (req, res, next) => {
  try {
    if (!req.query.q) throw new store.HttpError(400, '缺少 q');
    const results = await search(store.repoDir(req.params.id), req.query.q);
    res.json({ query: req.query.q, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 5: 挂载路由**，修改 `server/index.js`，在 files 路由之后加入：

```js
  app.use('/api/repos', require('./routes/search'));
```

- [ ] **Step 6: 跑测试确认通过**

```bash
node --test test/
```

预期：全部 PASS（rg 有无安装均通过，因为 `script.js` 不在两条路径的搜索后缀内）

- [ ] **Step 7: Commit**

```bash
git add server/services/search.js server/routes/search.js server/index.js test/api.test.js
git commit -m "feat: 搜索 API（rg 优先，Node 遍历兜底）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 前端单页应用

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/style.css`

**Interfaces:**
- Consumes: Task 4/5/6 全部 API；vendor 路径 `/vendor/marked/marked.umd.js`、`/vendor/highlight/highlight.min.js`、`/vendor/highlight/styles/github.min.css`
- Produces: 浏览器可用的完整 SPA

前端无自动化测试（按规格手动验证）。逐文件创建：

- [ ] **Step 1: 创建** `public/index.html`

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>知识库浏览器</title>
  <link rel="stylesheet" href="/vendor/highlight/styles/github.min.css">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1>知识库浏览器</h1>
    <input id="search-input" type="search" placeholder="在当前仓库搜索…" disabled>
  </header>
  <aside>
    <section>
      <h2>仓库</h2>
      <form id="add-form">
        <input id="repo-url" placeholder="https://github.com/owner/repo" required>
        <input id="repo-token" placeholder="token（私有仓库可选）">
        <button type="submit">添加</button>
      </form>
      <ul id="repo-list"></ul>
    </section>
    <nav id="tree"></nav>
  </aside>
  <main id="main"><p class="placeholder">选择左侧文件开始浏览</p></main>
  <script src="/vendor/marked/marked.umd.js"></script>
  <script src="/vendor/highlight/highlight.min.js"></script>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 创建** `public/style.css`

```css
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  display: grid;
  grid-template: "header header" auto "aside main" 1fr / 300px 1fr;
  height: 100vh;
}
header { grid-area: header; display: flex; align-items: center; gap: 16px; padding: 0 16px; border-bottom: 1px solid #ddd; }
header h1 { font-size: 18px; margin: 12px 0; }
header input { flex: 1; max-width: 480px; padding: 6px 10px; }
aside { grid-area: aside; border-right: 1px solid #ddd; overflow-y: auto; padding: 12px; }
aside h2 { font-size: 14px; margin: 4px 0 8px; }
main { grid-area: main; overflow-y: auto; padding: 16px 24px; display: flex; flex-direction: column; }
#add-form { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
#add-form input { padding: 6px 8px; }
#repo-list { list-style: none; padding: 0; margin: 0 0 16px; }
.repo { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
.repo span { flex: 1; cursor: pointer; word-break: break-all; }
.repo.active span { font-weight: bold; }
#tree ul { list-style: none; padding-left: 14px; margin: 4px 0; }
#tree a.file { cursor: pointer; color: #0969da; }
#tree a.unsupported { color: #999; cursor: not-allowed; }
.toolbar { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid #eee; margin-bottom: 12px; }
.toolbar span { flex: 1; color: #666; font-size: 13px; word-break: break-all; }
main iframe { flex: 1; width: 100%; border: none; }
textarea.editor { flex: 1; width: 100%; font-family: ui-monospace, monospace; font-size: 14px; padding: 12px; }
.markdown-body { max-width: 860px; }
.markdown-body pre { background: #f6f8fa; padding: 12px; overflow-x: auto; }
.markdown-body img { max-width: 100%; }
.search-results { list-style: none; padding: 0; }
.search-results li { padding: 6px 0; border-bottom: 1px solid #eee; }
.search-results a { color: #0969da; cursor: pointer; margin-right: 8px; }
button { cursor: pointer; }
.placeholder { color: #999; }
```

- [ ] **Step 3: 创建** `public/app.js`

```js
/* global marked, hljs */
const state = { repos: [], current: null, currentPath: null };

const $ = sel => document.querySelector(sel);

async function api(path, options) {
  const res = await fetch(path, options && {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body && JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function button(text, onclick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = e => { e.stopPropagation(); onclick(); };
  return b;
}

async function loadRepos() {
  state.repos = await api('/api/repos');
  renderRepos();
}

function renderRepos() {
  const ul = $('#repo-list');
  ul.innerHTML = '';
  for (const repo of state.repos) {
    const li = document.createElement('li');
    li.className = 'repo' + (state.current === repo.id ? ' active' : '');
    const label = document.createElement('span');
    label.textContent = repo.id;
    if (repo.status === 'cloning') label.textContent += '（克隆中…）';
    if (repo.status === 'error') label.textContent += '（失败）';
    label.title = repo.error || repo.url;
    label.onclick = () => repo.status === 'ready' && selectRepo(repo.id);
    const pullBtn = button('更新', async () => {
      try {
        await api(`/api/repos/${repo.id}/pull`, { method: 'POST' });
        await selectRepo(repo.id);
      } catch (err) {
        if (confirm(`更新失败：${err.message}\n\n是否强制重置为远端版本？（本地修改将丢失）`)) {
          await api(`/api/repos/${repo.id}/reset`, { method: 'POST' });
          await selectRepo(repo.id);
        }
      }
    });
    const delBtn = button('删除', async () => {
      if (confirm(`删除仓库 ${repo.id}？本地目录将被移除。`)) {
        await api(`/api/repos/${repo.id}`, { method: 'DELETE' });
        if (state.current === repo.id) {
          state.current = null;
          $('#tree').innerHTML = '';
          $('#search-input').disabled = true;
        }
        await loadRepos();
      }
    });
    li.append(label, pullBtn, delBtn);
    ul.append(li);
  }
}

async function selectRepo(id) {
  state.current = id;
  state.currentPath = null;
  $('#search-input').disabled = false;
  renderRepos();
  const tree = await api(`/api/repos/${id}/tree`);
  renderTree(tree, $('#tree'));
  $('#main').innerHTML = '<p class="placeholder">选择左侧文件开始浏览</p>';
}

function renderTree(node, container) {
  container.innerHTML = '';
  const ul = document.createElement('ul');
  for (const child of node.children || []) {
    const li = document.createElement('li');
    if (child.type === 'dir') {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = child.name;
      details.append(summary);
      renderTree(child, details);
      li.append(details);
    } else {
      const supported = ['.md', '.markdown', '.html', '.htm'].includes(child.ext);
      const a = document.createElement('a');
      a.textContent = child.name;
      a.className = supported ? 'file' : 'file unsupported';
      if (supported) a.onclick = () => openFile(child.path);
      else a.title = '不支持预览的文件类型';
      li.append(a);
    }
    ul.append(li);
  }
  container.append(ul);
}

async function openFile(relPath) {
  state.currentPath = relPath;
  const ext = relPath.split('.').pop().toLowerCase();
  if (ext === 'html' || ext === 'htm') return renderHtmlPreview(relPath);
  const { content } = await api(`/api/repos/${state.current}/file?path=${encodeURIComponent(relPath)}`);
  renderMarkdown(content, relPath);
}

function toolbar(relPath, buttons) {
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  const label = document.createElement('span');
  label.textContent = `${state.current} / ${relPath}`;
  bar.append(label, ...buttons);
  return bar;
}

function renderMarkdown(content, relPath) {
  const main = $('#main');
  main.innerHTML = '';
  main.append(toolbar(relPath, [button('编辑', () => renderEditor(content, relPath))]));
  const article = document.createElement('article');
  article.className = 'markdown-body';
  article.innerHTML = marked.parse(content);
  article.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
  main.append(article);
}

function renderHtmlPreview(relPath) {
  const main = $('#main');
  main.innerHTML = '';
  main.append(toolbar(relPath, [button('源码', () => openHtmlSource(relPath))]));
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.src = `/api/repos/${state.current}/raw?path=${encodeURIComponent(relPath)}`;
  main.append(iframe);
}

async function openHtmlSource(relPath) {
  const { content } = await api(`/api/repos/${state.current}/file?path=${encodeURIComponent(relPath)}`);
  renderEditor(content, relPath);
}

function renderEditor(content, relPath) {
  const main = $('#main');
  main.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.className = 'editor';
  ta.value = content;
  const saveBtn = button('保存', async () => {
    await api(`/api/repos/${state.current}/file?path=${encodeURIComponent(relPath)}`, {
      method: 'PUT', body: { content: ta.value },
    });
    openFile(relPath);
  });
  main.append(toolbar(relPath, [saveBtn, button('取消', () => openFile(relPath))]));
  main.append(ta);
}

async function doSearch(q) {
  const { results } = await api(`/api/repos/${state.current}/search?q=${encodeURIComponent(q)}`);
  const main = $('#main');
  main.innerHTML = '';
  const list = document.createElement('ul');
  list.className = 'search-results';
  if (!results.length) list.innerHTML = '<li>无匹配结果</li>';
  for (const r of results) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.textContent = `${r.path}:${r.line}`;
    a.onclick = () => openFile(r.path);
    const snippet = document.createElement('code');
    snippet.textContent = r.text;
    li.append(a, document.createTextNode(' '), snippet);
    list.append(li);
  }
  main.append(list);
}

$('#add-form').onsubmit = async e => {
  e.preventDefault();
  try {
    await api('/api/repos', {
      method: 'POST',
      body: {
        url: $('#repo-url').value.trim(),
        token: $('#repo-token').value.trim() || undefined,
      },
    });
    $('#repo-url').value = '';
    $('#repo-token').value = '';
    await loadRepos();
  } catch (err) {
    alert(err.message);
  }
};

let searchTimer;
$('#search-input').oninput = e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) return;
  searchTimer = setTimeout(() => doSearch(q).catch(err => alert(err.message)), 300);
};

loadRepos();
setInterval(() => {
  if (state.repos.some(r => r.status === 'cloning')) loadRepos();
}, 2000);
```

- [ ] **Step 4: 手动验证**

```bash
node --test test/ && npm start &
```

打开 `http://localhost:3000`，验证：
1. 添加一个公开 GitHub 仓库（如 `https://github.com/octocat/Hello-World`），列表出现「克隆中…」→ 变为可点击
2. 点击仓库 → 目录树展示；`.md` 渲染、代码高亮正常
3. `.html` 文件 iframe 预览正常，「源码」可查看
4. 「编辑」→ 修改 →「保存」→ 内容更新
5. 搜索框输入关键词 → 结果可点击跳转
6. 「更新」按钮拉取成功；「删除」移除仓库

验证后 `kill %1` 停止服务。

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "feat: 前端单页应用（浏览/编辑/搜索）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: README 与最终验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 重写** `README.md`

````markdown
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
````

- [ ] **Step 2: 最终验证**

```bash
node --test test/
npm start & sleep 1 && curl -s http://localhost:3000/api/health && kill %1
```

预期：测试全 PASS；`{"ok":true}`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README 使用说明

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
