const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir } = require('./helpers');

const contentDir = makeTempDir('kw-content-');
const tmp = makeTempDir('kw-test-');
fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
  contentDir,
  users: [{ username: 'tester', password: 'pw' }],
}));
require('../server/services/config').init(path.join(tmp, 'config.json'));
const store = require('../server/services/contentStore');

const dir = name => path.join(contentDir, name);

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

test('纯点 id 被拒绝 400', () => {
  assert.throws(() => store.repoDir('..'), err => err.status === 400);
  assert.throws(() => store.repoDir('.'), err => err.status === 400);
  assert.throws(() => store.createRepo('..'), err => err.status === 400);
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
