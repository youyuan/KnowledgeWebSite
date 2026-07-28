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

test('urlWithToken 仅对 https URL 注入编码后的 token', () => {
  assert.equal(git.urlWithToken('https://github.com/o/r', 'tok en'), 'https://tok%20en@github.com/o/r');
  assert.equal(git.urlWithToken('git@github.com:o/r.git', 'tok'), 'git@github.com:o/r.git');
  assert.equal(git.urlWithToken('/local/path', 'tok'), '/local/path');
  assert.equal(git.urlWithToken('https://github.com/o/r'), 'https://github.com/o/r');
});

test('redactToken 替换原始与 URL 编码后的 token', () => {
  const s = "fatal: unable to access 'https://tok%20en@example.com/o/r/': auth failed for tok en";
  const out = git.redactToken(s, 'tok en');
  assert.ok(!out.includes('tok%20en') && !out.includes('tok en'), `脱敏失败: ${out}`);
  assert.ok(out.includes('***'));
  // 无 token 或空文本时原样返回
  assert.equal(git.redactToken(s, undefined), s);
  assert.equal(git.redactToken(undefined, 'tok'), undefined);
});

test('setRemoteUrl 恢复无 token 的 remote（.git/config 不含 token）', async () => {
  const src = makeSourceRepo({ 'a.md': 'v1\n' });
  const dest = path.join(makeTempDir('kw-dst-'), 'clone');
  await git.clone(src, undefined, dest);
  const configPath = path.join(dest, '.git', 'config');
  // 模拟带 token clone 后 remote 含 token，再恢复原始 URL
  await git.setRemoteUrl(dest, 'https://secret-token@example.com/o/r.git');
  assert.ok(fs.readFileSync(configPath, 'utf8').includes('secret-token'));
  await git.setRemoteUrl(dest, 'https://example.com/o/r.git');
  assert.ok(!fs.readFileSync(configPath, 'utf8').includes('secret-token'));
});
