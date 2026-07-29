const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir } = require('./helpers');

process.env.CONTENT_DIR = makeTempDir('kw-content-');
const tmp = makeTempDir('kw-auth-');
process.env.AUTH_FILE = path.join(tmp, 'auth.json');
fs.writeFileSync(process.env.AUTH_FILE, JSON.stringify([{ username: 'tester', password: 'pw' }]));
process.env.AUTH_SECRET = 'test-secret';
const request = require('supertest');
const { createApp } = require('../server/index');

let agent;
const req = {
  get: (...a) => agent.get(...a),
  post: (...a) => agent.post(...a),
  put: (...a) => agent.put(...a),
  delete: (...a) => agent.delete(...a),
};
const dir = (...parts) => path.join(process.env.CONTENT_DIR, ...parts);

before(async () => {
  agent = request.agent(createApp());
  await agent.post('/api/login').send({ username: 'tester', password: 'pw' });
  // 直接写文件构造资料库 lib1
  fs.mkdirSync(dir('lib1', 'docs'), { recursive: true });
  fs.writeFileSync(dir('lib1', 'README.md'), '# 你好\n关键词在此\n');
  fs.writeFileSync(dir('lib1', 'docs', 'guide.md'), '指南 包含关键词\n');
  fs.writeFileSync(dir('lib1', 'index.html'), '<html><body>hi</body></html>\n');
  fs.writeFileSync(dir('lib1', 'script.js'), 'console.log(1)\n');
});

test('GET /api/repos 列出资料库', async () => {
  const res = await req.get('/api/repos');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ id: 'lib1' }]);
});

test('POST /api/repos 新建资料库', async () => {
  const res = await req.post('/api/repos').send({ name: 'lib2' });
  assert.equal(res.status, 201);
  assert.ok(fs.statSync(dir('lib2')).isDirectory());
});

test('POST /api/repos 重名 409 / 非法名 400 / 缺 name 400', async () => {
  assert.equal((await req.post('/api/repos').send({ name: 'lib2' })).status, 409);
  assert.equal((await req.post('/api/repos').send({ name: 'bad name' })).status, 400);
  assert.equal((await req.post('/api/repos').send({})).status, 400);
});

test('GET tree 返回目录结构并标注扩展名', async () => {
  const res = await req.get('/api/repos/lib1/tree');
  assert.equal(res.status, 200);
  const names = res.body.children.map(c => c.name);
  assert.ok(names.includes('README.md'));
  const docs = res.body.children.find(c => c.name === 'docs');
  assert.equal(docs.children[0].ext, '.md');
});

test('GET file 读取内容；404/400/415 行为', async () => {
  const ok = await req.get('/api/repos/lib1/file').query({ path: 'README.md' });
  assert.equal(ok.status, 200);
  assert.match(ok.body.content, /你好/);
  assert.equal((await req.get('/api/repos/lib1/file').query({ path: 'no.md' })).status, 404);
  assert.equal((await req.get('/api/repos/lib1/file').query({ path: '../../../etc/passwd' })).status, 400);
  assert.equal((await req.get('/api/repos/lib1/file').query({ path: '.git/config' })).status, 400);
  assert.equal((await req.get('/api/repos/lib1/file').query({ path: 'docs' })).status, 400);
  assert.equal((await req.get('/api/repos/no-such/file').query({ path: 'a.md' })).status, 404);
});

test('PUT file 保存后读取到新内容', async () => {
  await req.put('/api/repos/lib1/file').query({ path: 'README.md' }).send({ content: '# 已修改\n' });
  const res = await req.get('/api/repos/lib1/file').query({ path: 'README.md' });
  assert.equal(res.body.content, '# 已修改\n');
});

test('GET raw 返回原始 HTML', async () => {
  const res = await req.get('/api/repos/lib1/raw').query({ path: 'index.html' });
  assert.equal(res.status, 200);
  assert.match(res.text, /<html>/);
});

test('GET raw 支持点开头目录（.assets 等）', async () => {
  fs.mkdirSync(dir('lib1', '.assets'), { recursive: true });
  fs.writeFileSync(dir('lib1', '.assets', 'note.txt'), 'dot\n');
  const res = await req.get('/api/repos/lib1/raw').query({ path: '.assets/note.txt' });
  assert.equal(res.status, 200);
  assert.equal(res.text, 'dot\n');
});

test('POST file 新建空文件；409/404 行为', async () => {
  assert.equal((await req.post('/api/repos/lib1/file').query({ path: 'new.md' })).status, 201);
  assert.equal(fs.readFileSync(dir('lib1', 'new.md'), 'utf8'), '');
  assert.equal((await req.post('/api/repos/lib1/file').query({ path: 'new.md' })).status, 409);
  assert.equal((await req.post('/api/repos/lib1/file').query({ path: 'no-dir/x.md' })).status, 404);
});

test('POST mkdir 递归创建文件夹', async () => {
  assert.equal((await req.post('/api/repos/lib1/mkdir').query({ path: 'a/b/c' })).status, 201);
  assert.ok(fs.statSync(dir('lib1', 'a', 'b', 'c')).isDirectory());
});

test('POST upload 上传二进制内容', async () => {
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
  const res = await req
    .post('/api/repos/lib1/upload')
    .query({ path: 'a/b/pic.bin' })
    .set('Content-Type', 'application/octet-stream')
    .send(payload);
  assert.equal(res.status, 201);
  assert.deepEqual(fs.readFileSync(dir('lib1', 'a', 'b', 'pic.bin')), payload);
});

test('.git 路径在所有文件接口被拒（400）', async () => {
  assert.equal((await req.get('/api/repos/lib1/raw').query({ path: '.git/config' })).status, 400);
  assert.equal((await req.put('/api/repos/lib1/file').query({ path: '.git/config' }).send({ content: 'x' })).status, 400);
  assert.equal((await req.post('/api/repos/lib1/upload').query({ path: '.git/config' }).set('Content-Type', 'application/octet-stream').send('x')).status, 400);
  assert.equal((await req.delete('/api/repos/lib1/file').query({ path: '.git/config' })).status, 400);
});

test('POST upload 无 body / JSON body → 400；父目录不存在 → 404', async () => {
  const noBody = await req.post('/api/repos/lib1/upload').query({ path: 'empty.bin' });
  assert.equal(noBody.status, 400);
  const jsonBody = await req.post('/api/repos/lib1/upload').query({ path: 'x.bin' }).send({ a: 1 });
  assert.equal(jsonBody.status, 400);
  const noDir = await req.post('/api/repos/lib1/upload')
    .query({ path: 'no-such-dir/x.bin' })
    .set('Content-Type', 'application/octet-stream')
    .send('x');
  assert.equal(noDir.status, 404);
});

test('DELETE file 删除文件与文件夹；根目录 400', async () => {
  assert.equal((await req.delete('/api/repos/lib1/file').query({ path: 'new.md' })).status, 200);
  assert.ok(!fs.existsSync(dir('lib1', 'new.md')));
  assert.equal((await req.delete('/api/repos/lib1/file').query({ path: 'a' })).status, 200);
  assert.ok(!fs.existsSync(dir('lib1', 'a')));
  assert.equal((await req.delete('/api/repos/lib1/file').query({ path: '' })).status, 400);
  assert.ok(fs.statSync(dir('lib1')).isDirectory());
});

test('搜索命中并返回行号；js 文件不在范围；缺 q 400；库不存在 404', async () => {
  const res = await req.get('/api/repos/lib1/search').query({ q: '关键词' });
  assert.equal(res.status, 200);
  const hit = res.body.results.find(r => r.path.endsWith('guide.md'));
  assert.ok(hit);
  assert.equal(hit.line, 1);
  const js = await req.get('/api/repos/lib1/search').query({ q: 'console.log' });
  assert.equal(js.body.results.length, 0);
  assert.equal((await req.get('/api/repos/lib1/search')).status, 400);
  assert.equal((await req.get('/api/repos/no-such/search').query({ q: 'x' })).status, 404);
});
