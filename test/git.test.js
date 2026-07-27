const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, makeSourceRepo, git: gitCmd } = require('./helpers');
const git = require('../server/services/git');

test('clone 本地仓库', async () => {
  const src = makeSourceRepo({ 'README.md': '# hi\n' });
  const dest = path.join(makeTempDir('kw-dst-'), 'clone');
  await git.clone(src, undefined, dest);
  assert.equal(fs.readFileSync(path.join(dest, 'README.md'), 'utf8'), '# hi\n');
});

test('pull 获取新提交', async () => {
  const src = makeSourceRepo({ 'a.md': 'v1\n' });
  const dest = path.join(makeTempDir('kw-dst-'), 'clone');
  await git.clone(src, undefined, dest);
  fs.writeFileSync(path.join(src, 'a.md'), 'v2\n');
  gitCmd(['add', '.'], src);
  gitCmd(['commit', '-m', 'update'], src);
  await git.pull(dest);
  assert.equal(fs.readFileSync(path.join(dest, 'a.md'), 'utf8'), 'v2\n');
});

test('resetHard 放弃本地修改', async () => {
  const src = makeSourceRepo({ 'a.md': 'v1\n' });
  const dest = path.join(makeTempDir('kw-dst-'), 'clone');
  await git.clone(src, undefined, dest);
  fs.writeFileSync(path.join(dest, 'a.md'), '本地改动\n');
  await git.resetHard(dest);
  assert.equal(fs.readFileSync(path.join(dest, 'a.md'), 'utf8'), 'v1\n');
});

test('clone 失败时 Error 带 stderr', async () => {
  const dest = path.join(makeTempDir('kw-dst-'), 'clone');
  await assert.rejects(
    git.clone('/nonexistent/repo', undefined, dest),
    err => typeof err.stderr === 'string' && err.stderr.length > 0
  );
});
