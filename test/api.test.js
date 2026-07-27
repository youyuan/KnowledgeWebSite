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
