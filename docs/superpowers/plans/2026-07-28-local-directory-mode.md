# 本地目录模式改造 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将知识库浏览器从「在线 clone GitHub 仓库」改造为「用户手动放资料到 content/ 目录」模式，并新增网页文件管理。

**Architecture:** 数据根目录改为 `content/`（CONTENT_DIR 可覆盖），每个子文件夹是一个资料库；删除全部 git/clone 代码，repoStore 简化为 contentStore；现有 tree/file/raw/search 路由保留并新增文件管理端点；前端去掉克隆管理 UI，改为资料库列表 + 文件操作工具条。

**Tech Stack:** Node.js ≥ 18（CommonJS）、Express 5、node:test + supertest。

**Spec:** `docs/superpowers/specs/2026-07-28-local-directory-mode-design.md`

## Global Constraints

- Node ≥ 18，CommonJS；express 5.x
- 数据根目录 `content/`（`CONTENT_DIR` 环境变量覆盖，测试在 require 前设置）
- 资料库 id 白名单 `/^[A-Za-z0-9._-]+$/`（单段，不再有 `owner__repo` 双段）
- 所有 path 经 `safeResolve` 防 `..` 逃逸；`.git` 路径读写统一拒绝
- DELETE 不允许删除资料库根目录（path 为空或解析为根 → 400）
- upload 路由独享 `express.raw({ type: () => true, limit: '50mb' })`，不引入 multer
- 不新增任何 npm 依赖
- npm test = `node --test test/`；commit message 结尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

```
server/
├── index.js               # 不变
├── services/
│   ├── contentStore.js    # Task 1 新建（替换 repoStore.js）
│   ├── repoStore.js       # Task 1 删除
│   ├── git.js             # Task 1 删除
│   └── search.js          # 不变
├── routes/
│   ├── repos.js           # Task 2 重写（list + create）
│   ├── files.js           # Task 2 新增管理端点 + 引用改 contentStore
│   └── search.js          # Task 2 引用改 contentStore
public/
├── index.html             # Task 3 改造
├── app.js                 # Task 3 重写
└── style.css              # Task 3 微调
test/
├── helpers.js             # Task 1 精简（只留 makeTempDir）
├── contentStore.test.js   # Task 1 新建（替换 repoStore.test.js）
├── repoStore.test.js      # Task 1 删除
├── git.test.js            # Task 1 删除
├── api.test.js            # Task 2 重写
├── health.test.js         # 不变
└── dompurify.test.js      # 不变
README.md, .gitignore      # Task 4
```

---

### Task 1: contentStore 服务（替换 repoStore，删除 git 代码）

**Files:**
- Create: `server/services/contentStore.js`
- Delete: `server/services/repoStore.js`、`server/services/git.js`、`test/git.test.js`、`test/repoStore.test.js`
- Modify: `test/helpers.js`（精简为只导出 makeTempDir）
- Test: `test/contentStore.test.js`

**Interfaces:**
- Produces（Task 2/3 依赖）:
  - `class HttpError extends Error`，含 `status`
  - `listRepos(): Array<{id: string}>`（content/ 下合法名称的子目录，按 id 排序；忽略文件与非法名目录）
  - `getRepo(id): {id}`（id 非法 400；目录不存在或非目录 404）
  - `createRepo(id): {id}`（id 非法 400；已存在 409）
  - `repoDir(id): string`（id 非法 400）
  - `safeResolve(id, relPath): string`（逃逸 400；`.git` 及 `.git/` 前缀 400；不检查存在性）
  - `CONTENT_DIR`

**注意：** 本任务删除 repoStore.js 后 routes/*.js 暂时引用失效，api.test.js 会在 Task 2 重写——本任务只跑 `node --test test/contentStore.test.js test/health.test.js test/dompurify.test.js`，允许 api.test.js 报错（它在 Task 2 被替换）。commit 时不包含 api.test.js 的修改。

- [ ] **Step 1: 精简** `test/helpers.js` 为：

```js
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

module.exports = { makeTempDir };
```

- [ ] **Step 2: 写失败测试** `test/contentStore.test.js`

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir } = require('./helpers');

process.env.CONTENT_DIR = makeTempDir('kw-content-');
const store = require('../server/services/contentStore');

const dir = name => path.join(process.env.CONTENT_DIR, name);

test('初始为空列表', () => {
  assert.deepEqual(store.listRepos(), []);
});

test('createRepo 创建资料库并可列出', () => {
  store.createRepo('my-docs');
  assert.ok(fs.statSync(dir('my-docs')).isDirectory());
  assert.deepEqual(store.listRepos(), [{ id: 'my-docs' }]);
});

test('createRepo 重名 409', () => {
  assert.throws(() => store.createRepo('my-docs'), err => err.status === 409);
});

test('createRepo 非法名 400', () => {
  assert.throws(() => store.createRepo('bad name'), err => err.status === 400);
  assert.throws(() => store.createRepo('../evil'), err => err.status === 400);
});

test('getRepo 不存在 404', () => {
  assert.throws(() => store.getRepo('no-such'), err => err.status === 404);
});

test('listRepos 忽略文件与非法名目录，按名称排序', () => {
  fs.writeFileSync(dir('a-file.txt'), 'x');
  fs.mkdirSync(dir('bad name'));
  store.createRepo('alpha');
  assert.deepEqual(store.listRepos(), [{ id: 'alpha' }, { id: 'my-docs' }]);
});

test('safeResolve 允许库内路径', () => {
  const p = store.safeResolve('my-docs', 'docs/a.md');
  assert.ok(p.endsWith(path.join('docs', 'a.md')));
});

test('safeResolve 拒绝逃逸与 .git', () => {
  assert.throws(() => store.safeResolve('my-docs', '../../../etc/passwd'), err => err.status === 400);
  assert.throws(() => store.safeResolve('my-docs', '.git/config'), err => err.status === 400);
  assert.throws(() => store.safeResolve('my-docs', 'docs/../.git/config'), err => err.status === 400);
  assert.throws(() => store.safeResolve('../evil', 'a.md'), err => err.status === 400);
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
node --test test/contentStore.test.js
```

预期：FAIL（模块不存在）

- [ ] **Step 4: 实现** `server/services/contentStore.js`

```js
const fs = require('fs');
const path = require('path');

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, '..', '..', 'content');

const ID_RE = /^[A-Za-z0-9._-]+$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function listRepos() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  return fs.readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && ID_RE.test(e.name))
    .map(e => ({ id: e.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function repoDir(id) {
  if (!ID_RE.test(id)) throw new HttpError(400, `非法资料库 id: ${id}`);
  return path.join(CONTENT_DIR, id);
}

function getRepo(id) {
  const dir = repoDir(id);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new HttpError(404, `资料库不存在: ${id}`);
  }
  return { id };
}

function createRepo(id) {
  const dir = repoDir(id);
  if (fs.existsSync(dir)) throw new HttpError(409, `资料库已存在: ${id}`);
  fs.mkdirSync(dir, { recursive: true });
  return { id };
}

function safeResolve(id, relPath) {
  const base = repoDir(id);
  const resolved = path.resolve(base, relPath || '');
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new HttpError(400, `非法路径: ${relPath}`);
  }
  const rel = path.relative(base, resolved);
  if (rel === '.git' || rel.startsWith('.git' + path.sep)) {
    throw new HttpError(400, `非法路径: ${relPath}`);
  }
  return resolved;
}

module.exports = { HttpError, listRepos, getRepo, createRepo, repoDir, safeResolve, CONTENT_DIR };
```

- [ ] **Step 5: 删除旧文件并跑测试**

```bash
git rm -q server/services/repoStore.js server/services/git.js test/git.test.js test/repoStore.test.js
node --test test/contentStore.test.js test/health.test.js test/dompurify.test.js
```

预期：全部 PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/contentStore.js test/helpers.js test/contentStore.test.js
git commit -m "refactor: contentStore 替换 repoStore，删除 git/clone 代码

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 路由改造与文件管理 API

**Files:**
- Modify: `server/routes/repos.js`（整体重写）
- Modify: `server/routes/files.js`（引用改 contentStore + 新增 4 个端点）
- Modify: `server/routes/search.js`（引用改 contentStore）
- Modify: `test/api.test.js`（整体重写）

**Interfaces:**
- Consumes: Task 1 的 contentStore 全部接口
- Produces: 见下方端点清单

- [ ] **Step 1: 重写 `server/routes/repos.js`**

```js
const express = require('express');
const store = require('../services/contentStore');

const router = express.Router();

router.get('/', (req, res) => res.json(store.listRepos()));

router.post('/', (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string') throw new store.HttpError(400, '缺少 name');
    res.status(201).json(store.createRepo(name.trim()));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 2: 修改 `server/routes/files.js`**

把 `require('../services/repoStore')` 改为 `require('../services/contentStore')`，并在文件末尾（`module.exports` 之前）追加：

```js
// 新建空文件
router.post('/:id/file', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    const full = store.safeResolve(req.params.id, req.query.path);
    if (fs.existsSync(full)) throw new store.HttpError(409, '文件已存在');
    fs.writeFileSync(full, '', 'utf8');
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === 'ENOENT') err = new store.HttpError(404, '父目录不存在');
    next(err);
  }
});

// 新建文件夹（递归）
router.post('/:id/mkdir', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    fs.mkdirSync(store.safeResolve(req.params.id, req.query.path), { recursive: true });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 删除文件或文件夹（不允许删资料库根目录）
router.delete('/:id/file', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    const full = store.safeResolve(req.params.id, req.query.path);
    if (full === store.repoDir(req.params.id)) {
      throw new store.HttpError(400, '不允许删除资料库根目录');
    }
    fs.rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 上传文件（原始二进制 body）
router.post('/:id/upload', express.raw({ type: () => true, limit: '50mb' }), (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    fs.writeFileSync(store.safeResolve(req.params.id, req.query.path), req.body);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

注意：现有 `GET /:id/file` 处理器中 `store.getRepo` 未被调用（tree 有调用），为保持行为一致，在 GET file、PUT file、GET raw 三个处理器开头各加一行 `store.getRepo(req.params.id);`（使不存在的资料库返回 404 而非 500）。

- [ ] **Step 3: 修改 `server/routes/search.js`**：`require('../services/repoStore')` 改为 `require('../services/contentStore')`。

- [ ] **Step 4: 重写 `test/api.test.js`**

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir } = require('./helpers');

process.env.CONTENT_DIR = makeTempDir('kw-content-');
const request = require('supertest');
const { createApp } = require('../server/index');

const app = createApp();
const dir = (...parts) => path.join(process.env.CONTENT_DIR, ...parts);

before(() => {
  // 直接写文件构造资料库 lib1
  fs.mkdirSync(dir('lib1', 'docs'), { recursive: true });
  fs.writeFileSync(dir('lib1', 'README.md'), '# 你好\n关键词在此\n');
  fs.writeFileSync(dir('lib1', 'docs', 'guide.md'), '指南 包含关键词\n');
  fs.writeFileSync(dir('lib1', 'index.html'), '<html><body>hi</body></html>\n');
  fs.writeFileSync(dir('lib1', 'script.js'), 'console.log(1)\n');
});

test('GET /api/repos 列出资料库', async () => {
  const res = await request(app).get('/api/repos');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ id: 'lib1' }]);
});

test('POST /api/repos 新建资料库', async () => {
  const res = await request(app).post('/api/repos').send({ name: 'lib2' });
  assert.equal(res.status, 201);
  assert.ok(fs.statSync(dir('lib2')).isDirectory());
});

test('POST /api/repos 重名 409 / 非法名 400 / 缺 name 400', async () => {
  assert.equal((await request(app).post('/api/repos').send({ name: 'lib2' })).status, 409);
  assert.equal((await request(app).post('/api/repos').send({ name: 'bad name' })).status, 400);
  assert.equal((await request(app).post('/api/repos').send({})).status, 400);
});

test('GET tree 返回目录结构并标注扩展名', async () => {
  const res = await request(app).get('/api/repos/lib1/tree');
  assert.equal(res.status, 200);
  const names = res.body.children.map(c => c.name);
  assert.ok(names.includes('README.md'));
  const docs = res.body.children.find(c => c.name === 'docs');
  assert.equal(docs.children[0].ext, '.md');
});

test('GET file 读取内容；404/400/415 行为', async () => {
  const ok = await request(app).get('/api/repos/lib1/file').query({ path: 'README.md' });
  assert.equal(ok.status, 200);
  assert.match(ok.body.content, /你好/);
  assert.equal((await request(app).get('/api/repos/lib1/file').query({ path: 'no.md' })).status, 404);
  assert.equal((await request(app).get('/api/repos/lib1/file').query({ path: '../../../etc/passwd' })).status, 400);
  assert.equal((await request(app).get('/api/repos/lib1/file').query({ path: '.git/config' })).status, 400);
  assert.equal((await request(app).get('/api/repos/no-such/file').query({ path: 'a.md' })).status, 404);
});

test('PUT file 保存后读取到新内容', async () => {
  await request(app).put('/api/repos/lib1/file').query({ path: 'README.md' }).send({ content: '# 已修改\n' });
  const res = await request(app).get('/api/repos/lib1/file').query({ path: 'README.md' });
  assert.equal(res.body.content, '# 已修改\n');
});

test('GET raw 返回原始 HTML', async () => {
  const res = await request(app).get('/api/repos/lib1/raw').query({ path: 'index.html' });
  assert.equal(res.status, 200);
  assert.match(res.text, /<html>/);
});

test('POST file 新建空文件；409/404 行为', async () => {
  assert.equal((await request(app).post('/api/repos/lib1/file').query({ path: 'new.md' })).status, 201);
  assert.equal(fs.readFileSync(dir('lib1', 'new.md'), 'utf8'), '');
  assert.equal((await request(app).post('/api/repos/lib1/file').query({ path: 'new.md' })).status, 409);
  assert.equal((await request(app).post('/api/repos/lib1/file').query({ path: 'no-dir/x.md' })).status, 404);
});

test('POST mkdir 递归创建文件夹', async () => {
  assert.equal((await request(app).post('/api/repos/lib1/mkdir').query({ path: 'a/b/c' })).status, 201);
  assert.ok(fs.statSync(dir('lib1', 'a', 'b', 'c')).isDirectory());
});

test('POST upload 上传二进制内容', async () => {
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
  const res = await request(app)
    .post('/api/repos/lib1/upload')
    .query({ path: 'a/b/pic.bin' })
    .set('Content-Type', 'application/octet-stream')
    .send(payload);
  assert.equal(res.status, 201);
  assert.deepEqual(fs.readFileSync(dir('lib1', 'a', 'b', 'pic.bin')), payload);
});

test('DELETE file 删除文件与文件夹；根目录 400', async () => {
  assert.equal((await request(app).delete('/api/repos/lib1/file').query({ path: 'new.md' })).status, 200);
  assert.ok(!fs.existsSync(dir('lib1', 'new.md')));
  assert.equal((await request(app).delete('/api/repos/lib1/file').query({ path: 'a' })).status, 200);
  assert.ok(!fs.existsSync(dir('lib1', 'a')));
  assert.equal((await request(app).delete('/api/repos/lib1/file').query({ path: '' })).status, 400);
  assert.ok(fs.statSync(dir('lib1')).isDirectory());
});

test('搜索命中并返回行号；js 文件不在范围；缺 q 400；库不存在 404', async () => {
  const res = await request(app).get('/api/repos/lib1/search').query({ q: '关键词' });
  assert.equal(res.status, 200);
  const hit = res.body.results.find(r => r.path.endsWith('guide.md'));
  assert.ok(hit);
  assert.equal(hit.line, 1);
  const js = await request(app).get('/api/repos/lib1/search').query({ q: 'console.log' });
  assert.equal(js.body.results.length, 0);
  assert.equal((await request(app).get('/api/repos/lib1/search')).status, 400);
  assert.equal((await request(app).get('/api/repos/no-such/search').query({ q: 'x' })).status, 404);
});
```

- [ ] **Step 5: 跑全部测试**

```bash
node --test test/
```

预期：全部 PASS（含 health、dompurify、contentStore）

- [ ] **Step 6: Commit**

```bash
git add server/routes/ test/api.test.js
git commit -m "feat: 本地目录模式路由与文件管理 API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 前端改造

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`（整体重写）
- Modify: `public/style.css`

**Interfaces:**
- Consumes: Task 2 全部 API
- Produces: 浏览器可用的新 UI

- [ ] **Step 1: 改造 `public/index.html`**——将 `<aside>` 内的 `<section>...</section>` 整段替换为：

```html
    <section>
      <h2>资料库 <button id="btn-new-repo" title="新建资料库">＋</button></h2>
      <ul id="repo-list"></ul>
    </section>
    <div id="tree-toolbar" hidden>
      <button id="btn-new-file">新建文件</button>
      <button id="btn-new-dir">新建文件夹</button>
      <button id="btn-upload">上传</button>
      <button id="btn-delete">删除</button>
      <input id="upload-input" type="file" hidden>
    </div>
```

其余部分（header、main、三个 script 标签）不变。

- [ ] **Step 2: 重写 `public/app.js`**

```js
/* global marked, hljs, DOMPurify */
const state = { repos: [], current: null, selected: null };
// selected: { path, type: 'file'|'dir' }，新建/上传/删除操作的目标；选中资料库时重置为根目录

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
    label.onclick = () => selectRepo(repo.id);
    li.append(label);
    ul.append(li);
  }
}

async function selectRepo(id) {
  state.current = id;
  state.selected = { path: '', type: 'dir' };
  $('#search-input').disabled = false;
  $('#tree-toolbar').hidden = false;
  renderRepos();
  try {
    await refreshTree();
  } catch (err) {
    alert(err.message);
  }
  $('#main').innerHTML = '<p class="placeholder">选择左侧文件开始浏览</p>';
}

async function refreshTree() {
  const tree = await api(`/api/repos/${state.current}/tree`);
  renderTree(tree, $('#tree'));
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
      summary.onclick = () => { state.selected = { path: child.path, type: 'dir' }; };
      details.append(summary);
      renderTree(child, details);
      li.append(details);
    } else {
      const supported = ['.md', '.markdown', '.html', '.htm'].includes(child.ext);
      const a = document.createElement('a');
      a.textContent = child.name;
      a.className = supported ? 'file' : 'file unsupported';
      a.onclick = () => {
        state.selected = { path: child.path, type: 'file' };
        if (supported) openFile(child.path);
      };
      if (!supported) a.title = '不支持预览，可选中后删除';
      li.append(a);
    }
    ul.append(li);
  }
  container.append(ul);
}

// 新建/上传的目标目录：选中目录则用它，选中文件则用其父目录
function targetDir() {
  const sel = state.selected;
  if (!sel || sel.type === 'dir') return (sel && sel.path) || '';
  return sel.path.split('/').slice(0, -1).join('/');
}

async function openFile(relPath) {
  const ext = relPath.split('.').pop().toLowerCase();
  try {
    if (ext === 'html' || ext === 'htm') return renderHtmlPreview(relPath);
    const { content } = await api(`/api/repos/${state.current}/file?path=${encodeURIComponent(relPath)}`);
    renderMarkdown(content, relPath);
  } catch (err) {
    alert(err.message);
  }
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
  article.innerHTML = DOMPurify.sanitize(marked.parse(content));
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
  const saveBtn = button('保存', () => {
    api(`/api/repos/${state.current}/file?path=${encodeURIComponent(relPath)}`, {
      method: 'PUT', body: { content: ta.value },
    })
      .then(() => openFile(relPath))
      .catch(err => alert(err.message));
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

// 资料库与文件管理
$('#btn-new-repo').onclick = async () => {
  const name = prompt('资料库名称（字母、数字、-、_、.）：');
  if (!name || !name.trim()) return;
  try {
    await api('/api/repos', { method: 'POST', body: { name: name.trim() } });
    await loadRepos();
  } catch (err) {
    alert(err.message);
  }
};

$('#btn-new-file').onclick = async () => {
  const name = prompt('新建文件路径（相对当前目录）：');
  if (!name || !name.trim()) return;
  const rel = [targetDir(), name.trim()].filter(Boolean).join('/');
  try {
    await api(`/api/repos/${state.current}/file?path=${encodeURIComponent(rel)}`, { method: 'POST' });
    await refreshTree();
  } catch (err) {
    alert(err.message);
  }
};

$('#btn-new-dir').onclick = async () => {
  const name = prompt('新建文件夹路径（相对当前目录）：');
  if (!name || !name.trim()) return;
  const rel = [targetDir(), name.trim()].filter(Boolean).join('/');
  try {
    await api(`/api/repos/${state.current}/mkdir?path=${encodeURIComponent(rel)}`, { method: 'POST' });
    await refreshTree();
  } catch (err) {
    alert(err.message);
  }
};

$('#btn-upload').onclick = () => $('#upload-input').click();

$('#upload-input').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const rel = [targetDir(), file.name].filter(Boolean).join('/');
  try {
    const res = await fetch(`/api/repos/${state.current}/upload?path=${encodeURIComponent(rel)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `上传失败 (${res.status})`);
    await refreshTree();
  } catch (err) {
    alert(err.message);
  }
};

$('#btn-delete').onclick = async () => {
  const sel = state.selected;
  if (!sel || !sel.path) {
    alert('请先在目录树中选择要删除的文件或文件夹');
    return;
  }
  if (!confirm(`删除 ${sel.path}？此操作不可恢复。`)) return;
  try {
    await api(`/api/repos/${state.current}/file?path=${encodeURIComponent(sel.path)}`, { method: 'DELETE' });
    state.selected = { path: '', type: 'dir' };
    $('#main').innerHTML = '<p class="placeholder">选择左侧文件开始浏览</p>';
    await refreshTree();
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
```

- [ ] **Step 3: 修改 `public/style.css`**

删除 `#add-form` 两条规则，追加：

```css
h2 button { float: right; }
#tree-toolbar { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
#tree-toolbar button { font-size: 12px; padding: 3px 8px; }
#tree summary { cursor: pointer; }
#tree summary:hover, #tree a.file:hover { text-decoration: underline; }
```

- [ ] **Step 4: 冒烟验证**

```bash
node --test test/
CONTENT_DIR=$(mktemp -d) PORT=3120 node server/index.js &
```

用 curl 验证：GET / 200 含 `btn-new-repo`；POST /api/repos `{name:"demo"}` 201；向 $CONTENT_DIR/demo 写入一个 md 文件后 GET tree 含该文件；GET /vendor/dompurify/purify.min.js 200。最后 kill 服务。

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "feat: 前端改造为本地目录模式（资料库列表+文件管理）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: README、.gitignore 与最终验证

**Files:**
- Modify: `README.md`（整体重写）
- Modify: `.gitignore`

- [ ] **Step 1: 重写 `README.md`**

````markdown
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
- **编辑**：Markdown「编辑」/ HTML「源码」进入编辑，保存写回目录
- **文件管理**：选中资料库后可新建文件/文件夹、上传、删除
- **搜索**：顶栏搜索当前资料库的 `.md`/`.html` 内容

## 测试

```bash
npm test
```

## 设计文档

- `docs/superpowers/specs/2026-07-28-local-directory-mode-design.md`（当前架构）
- `docs/superpowers/specs/2026-07-27-github-repo-browser-design.md`（历史：在线 clone 模式）
````

- [ ] **Step 2: 修改 `.gitignore`**：把 `data/` 替换为 `content/`（data/ 已不再使用；若磁盘上存在旧 data/ 目录，删除之）。

- [ ] **Step 3: 最终验证**

```bash
node --test test/
PORT=3121 node server/index.js & sleep 1
curl -s http://localhost:3121/api/health   # {"ok":true}
curl -s http://localhost:3121/api/repos    # []（content/ 自动创建）
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: 本地目录模式 README 与 gitignore

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
