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
