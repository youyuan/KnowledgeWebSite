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

test('未登录调用登出返回 401', async () => {
  const res = await request(app).post('/api/logout');
  assert.equal(res.status, 401);
  assert.ok(!res.headers['set-cookie']);
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
  // 用真实 HMAC 构造过期令牌，确保走到过期分支而非签名比对被拒
  const crypto = require('crypto');
  const expiredPayload = `admin|${Date.now() - 1000}`;
  const expiredSig = crypto.createHmac('sha256', 'test-secret').update(expiredPayload).digest('hex');
  assert.equal(auth.verifyToken(`${expiredPayload}|${expiredSig}`), null);
  // NaN 过期时间纵深防御：签名合法但 expiry 非有限数字同样拒绝
  const nanPayload = 'admin|abc';
  const nanSig = crypto.createHmac('sha256', 'test-secret').update(nanPayload).digest('hex');
  assert.equal(auth.verifyToken(`${nanPayload}|${nanSig}`), null);
  assert.equal(auth.verifyToken('garbage'), null);
});

test('verifyToken 拒绝不存在用户与错误格式', () => {
  const { token } = auth.sign('ghost');
  assert.equal(auth.verifyToken(token), null);
});

test('登录频率限制：每 IP 每分钟 10 次，第 11 次返回 429', async () => {
  // 重建 routes/auth 模块以获得全新的节流计数（同文件前面的测试共享同一 IP）
  delete require.cache[require.resolve('../server/routes/auth')];
  const freshApp = createApp();
  for (let i = 0; i < 10; i++) {
    const res = await request(freshApp).post('/api/login').send({ username: 'admin', password: 'wrong' });
    assert.equal(res.status, 401, `第 ${i + 1} 次应为 401`);
  }
  const res = await request(freshApp).post('/api/login').send({ username: 'admin', password: 'wrong' });
  assert.equal(res.status, 429);
  assert.deepEqual(res.body, { error: '尝试过于频繁，请稍后再试' });
});
