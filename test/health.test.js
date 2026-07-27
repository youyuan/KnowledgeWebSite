const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../server/index');

test('GET /api/health 返回 ok', async () => {
  const res = await request(createApp()).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
