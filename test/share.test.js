const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { makeTempDir } = require('./helpers');

const tmp = makeTempDir('kw-test-share-');
const contentRoot = makeTempDir('kw-content-share-');
const configPath = path.join(tmp, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  contentDir: contentRoot,
  authSecret: 'test-secret',
  users: [{ username: 'tester', password: 'pw' }],
}));
require('../server/services/config').init(configPath);

// fixture：lib1 库
const lib = path.join(contentRoot, 'lib1');
fs.mkdirSync(path.join(lib, 'docs', 'img'), { recursive: true });
fs.mkdirSync(path.join(lib, 'other'), { recursive: true });
fs.writeFileSync(path.join(lib, 'docs', 'guide.md'), '# 指南\n\n![图](img/pic.png)\n');
fs.writeFileSync(path.join(lib, 'docs', 'img', 'pic.png'), Buffer.from([1, 2, 3, 4, 5]));
fs.writeFileSync(path.join(lib, 'index.html'),
  '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<title>t</title>\n</head>\n<body>hi</body>\n</html>\n');
fs.writeFileSync(path.join(lib, 'other', 'secret.md'), 'secret');
fs.mkdirSync(path.join(lib, 'docs', '.git'), { recursive: true });
fs.writeFileSync(path.join(lib, 'docs', '.git', 'config'), '[core] bare = false');

const request = require('supertest');
const { createApp } = require('../server/index');
const shareStore = require('../server/services/shareStore');

const app = createApp();
const DAY_MS = 24 * 60 * 60 * 1000;

async function login(agent) {
  return agent.post('/api/login').send({ username: 'tester', password: 'pw' });
}

async function createShare(body) {
  const agent = request.agent(app);
  await login(agent);
  return agent.post('/api/repos/lib1/share').send(body);
}

test('创建分享：7 天，返回 url/token/expiresAt', async () => {
  const before = Date.now();
  const res = await createShare({ path: 'docs/guide.md', days: 7 });
  assert.equal(res.status, 200);
  assert.match(res.body.url, /^\/share\/[0-9a-f]{32}$/);
  assert.equal(res.body.token, res.body.url.slice('/share/'.length));
  assert.ok(res.body.expiresAt >= before + 7 * DAY_MS);
  assert.ok(res.body.expiresAt <= Date.now() + 7 * DAY_MS);
});

test('创建分享：30 天', async () => {
  const before = Date.now();
  const res = await createShare({ path: 'docs/guide.md', days: 30 });
  assert.equal(res.status, 200);
  assert.ok(res.body.expiresAt >= before + 30 * DAY_MS);
  assert.ok(res.body.expiresAt <= Date.now() + 30 * DAY_MS);
});

test('创建分享：自定义天数（45）', async () => {
  const before = Date.now();
  const res = await createShare({ path: 'docs/guide.md', days: 45 });
  assert.equal(res.status, 200);
  assert.ok(res.body.expiresAt >= before + 45 * DAY_MS);
  assert.ok(res.body.expiresAt <= Date.now() + 45 * DAY_MS);
});

test('创建分享：永久（null 与 "forever"）expiresAt 为 null', async () => {
  const r1 = await createShare({ path: 'docs/guide.md', days: null });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.expiresAt, null);
  const r2 = await createShare({ path: 'docs/guide.md', days: 'forever' });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.expiresAt, null);
});

test('创建分享：days 非法返回 400', async () => {
  for (const days of [0, 366, -1, 1.5, 'abc', undefined]) {
    const res = await createShare({ path: 'docs/guide.md', days });
    assert.equal(res.status, 400, `days=${days} 应为 400`);
  }
});

test('创建分享：缺 path 400，path 非法 400，文件不存在 404', async () => {
  assert.equal((await createShare({ days: 7 })).status, 400);
  assert.equal((await createShare({ path: '../x.md', days: 7 })).status, 400);
  assert.equal((await createShare({ path: 'docs/nope.md', days: 7 })).status, 404);
});

test('创建分享：未登录返回 401', async () => {
  const res = await request(app).post('/api/repos/lib1/share').send({ path: 'docs/guide.md', days: 7 });
  assert.equal(res.status, 401);
});

async function makeShare(path, days = 7) {
  const res = await createShare({ path, days });
  assert.equal(res.status, 200);
  return res.body.token;
}

test('免登录访问 md 骨架页：200 且引用 marked', async () => {
  const token = await makeShare('docs/guide.md');
  const res = await request(app).get(`/share/${token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /\/vendor\/marked\/marked\.umd\.js/);
  assert.match(res.text, /\/vendor\/dompurify\/purify\.min\.js/);
  assert.match(res.text, /docs\/guide\.md/); // 标题栏显示文档路径
});

test('免登录访问 html 分享：200 且注入 <base>，原文保留', async () => {
  const token = await makeShare('index.html');
  const res = await request(app).get(`/share/${token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.text.includes(`<base href="/share/${token}/res/">`));
  // base 注入在 <head> 之后
  assert.ok(res.text.indexOf('<head>') < res.text.indexOf('<base '));
  assert.ok(res.text.includes('<body>hi</body>'));
  assert.ok(res.text.includes('<title>t</title>'));
});

test('免登录 content 端点返回 {path, content}', async () => {
  const token = await makeShare('docs/guide.md');
  const res = await request(app).get(`/share/${token}/content`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { path: 'docs/guide.md', content: '# 指南\n\n![图](img/pic.png)\n' });
});

test('免登录 res 端点返回相对资源', async () => {
  const token = await makeShare('docs/guide.md');
  const res = await request(app)
    .get(`/share/${token}/res/img/pic.png`)
    .buffer(true)
    .parse((r, cb) => { const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
  assert.equal(res.status, 200);
  assert.deepEqual([...res.body], [1, 2, 3, 4, 5]);
});

test('res 越权（.. 逃逸文档目录）返回 400', async () => {
  const token = await makeShare('docs/guide.md');
  // supertest/superagent 会在发送前归一化路径中的 ..，故用原始 http 客户端按原样发送
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const status = await new Promise((resolve, reject) => {
      const req = http.get({ port, path: `/share/${token}/res/../other/secret.md` }, res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
    });
    assert.equal(status, 400);
  } finally {
    server.close();
  }
});

test('res 访问 .git 内文件被拒绝（400）', async () => {
  const token = await makeShare('docs/guide.md');
  assert.equal((await request(app).get(`/share/${token}/res/.git/config`)).status, 400);
});

test('res 资源不存在返回 404', async () => {
  const token = await makeShare('docs/guide.md');
  const res = await request(app).get(`/share/${token}/res/img/nope.png`);
  assert.equal(res.status, 404);
});

test('不支持的扩展名分享页返回 404', async () => {
  const token = await makeShare('docs/img/pic.png');
  assert.equal((await request(app).get(`/share/${token}`)).status, 404);
});

test('无效 token：三个端点一律 404 提示页', async () => {
  const token = 'f'.repeat(32);
  for (const url of [`/share/${token}`, `/share/${token}/content`, `/share/${token}/res/img/pic.png`]) {
    const res = await request(app).get(url);
    assert.equal(res.status, 404, `${url} 应为 404`);
    assert.match(res.text, /链接已过期或不存在/);
  }
});

test('过期 token 返回 404，且惰性清理后 shares.json 不含该记录', async () => {
  const expiredToken = 'a'.repeat(32);
  const records = shareStore.list();
  records.push({
    token: expiredToken,
    repo: 'lib1',
    path: 'docs/guide.md',
    createdAt: Date.now() - 10 * DAY_MS,
    expiresAt: Date.now() - 1000, // 已过期
  });
  fs.writeFileSync(shareStore.storePath(), JSON.stringify(records, null, 2) + '\n', { mode: 0o600 });

  const res = await request(app).get(`/share/${expiredToken}`);
  assert.equal(res.status, 404);
  assert.match(res.text, /链接已过期或不存在/);

  const after = JSON.parse(fs.readFileSync(shareStore.storePath(), 'utf8'));
  assert.ok(!after.some(r => r.token === expiredToken), '过期记录应被惰性清理');
});

test('shares.json 文件权限为 0600', async () => {
  await makeShare('docs/guide.md');
  const mode = fs.statSync(shareStore.storePath()).mode & 0o777;
  assert.equal(mode, 0o600);
});
