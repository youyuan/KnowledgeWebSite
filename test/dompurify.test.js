const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const request = require('supertest');
const { createApp } = require('../server/index');

const PURIFY_PATH = path.join(__dirname, '..', 'node_modules', 'dompurify', 'dist', 'purify.min.js');

test('vendor 路由提供 purify.min.js', async () => {
  assert.ok(fs.existsSync(PURIFY_PATH), 'dompurify 未安装或缺少 dist/purify.min.js');
  const res = await request(createApp()).get('/vendor/dompurify/purify.min.js');
  assert.equal(res.status, 200);
});

test('purify.min.js 在浏览器全局环境下暴露 DOMPurify.sanitize', () => {
  // 用 vm 模拟浏览器全局：DOMPurify 仅在存在 window/document/Element 时才初始化 sanitize
  const sandbox = {};
  sandbox.globalThis = sandbox;
  function Element() {}
  Object.defineProperty(Element.prototype, 'parentNode', { get() { return null; } });
  sandbox.Element = Element;
  sandbox.window = sandbox;
  sandbox.document = {
    nodeType: 9,
    implementation: { createHTMLDocument() { return this; } },
    createElement() { return {}; },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(PURIFY_PATH, 'utf8'), sandbox);
  assert.equal(typeof sandbox.DOMPurify, 'function');
  assert.equal(typeof sandbox.DOMPurify.sanitize, 'function');
  assert.equal(sandbox.DOMPurify.isSupported, true);
});
