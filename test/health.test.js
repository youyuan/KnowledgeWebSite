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
