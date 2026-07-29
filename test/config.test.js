const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir } = require('./helpers');
const config = require('../server/services/config');

function initTemp(content) {
  const dir = makeTempDir('kw-config-');
  const p = path.join(dir, 'config.json');
  if (content !== undefined) fs.writeFileSync(p, JSON.stringify(content));
  return p;
}

test('get 未初始化抛错', () => {
  const fresh = freshConfig();
  assert.throws(() => fresh.get(), /未初始化/);
});

test('文件不存在时自动生成：含随机 admin 密码与默认值', () => {
  const fresh = freshConfig();
  const p = initTemp(undefined); // 不写文件
  const cfg = fresh.init(p);
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.contentDir, './content');
  assert.equal(cfg.trustProxy, false);
  assert.equal(cfg.users.length, 1);
  assert.equal(cfg.users[0].username, 'admin');
  assert.ok(cfg.users[0].password.length >= 12);
  // 两次生成密码不同
  const cfg2 = fresh.init(initTemp(undefined));
  assert.notEqual(cfg.users[0].password, cfg2.users[0].password);
});

test('生成时导入旧 auth.json 用户', () => {
  const fresh = freshConfig();
  const dir = makeTempDir('kw-config-');
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify([{ username: 'old', password: 'pw' }]));
  const cfg = fresh.init(path.join(dir, 'config.json'));
  assert.deepEqual(cfg.users, [{ username: 'old', password: 'pw' }]);
});

test('用户配置逐字段覆盖默认值', () => {
  const fresh = freshConfig();
  const cfg = fresh.init(initTemp({ port: 9000, users: [{ username: 'a', password: 'b' }] }));
  assert.equal(cfg.port, 9000);
  assert.equal(cfg.contentDir, './content');
  assert.equal(cfg.users.length, 1);
});

test('校验失败抛错', () => {
  const fresh = freshConfig();
  assert.throws(() => fresh.init(initTemp({ port: 99999 })), /port/);
  assert.throws(() => fresh.init(initTemp({ users: 'x' })), /users/);
  assert.throws(() => fresh.init(initTemp({ users: [{ username: 'bad name', password: 'x' }] })), /用户/);
  assert.throws(() => fresh.init(initTemp({ users: [{ username: 'a', password: '' }] })), /用户/);
  const dir = makeTempDir('kw-config-');
  const bad = path.join(dir, 'config.json');
  fs.writeFileSync(bad, '{not json');
  assert.throws(() => fresh.init(bad), /解析失败/);
});

test('resolveContentDir 相对 config.json 所在目录解析', () => {
  const fresh = freshConfig();
  const dir = makeTempDir('kw-config-');
  const p = path.join(dir, 'config.json');
  fs.writeFileSync(p, JSON.stringify({ contentDir: './data', users: [{ username: 'a', password: 'b' }] }));
  fresh.init(p);
  assert.equal(fresh.resolveContentDir(), path.join(dir, 'data'));
  assert.equal(fresh.hasUsers(), true);
});

test('users 为空时 hasUsers 为 false', () => {
  const fresh = freshConfig();
  fresh.init(initTemp({ users: [] }));
  assert.equal(fresh.hasUsers(), false);
});

// 每个用例使用独立模块实例（init 是单例）
function freshConfig() {
  delete require.cache[require.resolve('../server/services/config')];
  return require('../server/services/config');
}
