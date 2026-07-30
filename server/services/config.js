const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

const DEFAULTS = {
  port: 8080,
  contentDir: './content',
  trustProxy: false,
  authSecret: '',
  users: [],
};

const USERNAME_RE = /^[A-Za-z0-9._-]+$/;

let config = null;
let configDir = null;
let loadedPath = null;

function randomPassword() {
  // base64url 字母表无 +/=，保证定长 12 位
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

function generate(configPath) {
  // 旧 auth.json 存在时导入其用户，避免升级后锁死
  let users;
  const legacy = path.join(path.dirname(configPath), 'auth.json');
  try {
    const legacyUsers = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    if (Array.isArray(legacyUsers) && legacyUsers.length) users = legacyUsers;
  } catch { /* 无旧配置 */ }
  if (!users) {
    const password = randomPassword();
    users = [{ username: 'admin', password }];
    console.log(`初始管理员账号: admin / ${password}（请登录后到 config.json 修改）`);
  }
  fs.writeFileSync(configPath, JSON.stringify({ ...DEFAULTS, users }, null, 2) + '\n', { mode: 0o600 });
  console.log(`已生成默认配置文件: ${configPath}`);
}

function validate(cfg) {
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    throw new Error('config.json: port 必须为 1-65535 的整数');
  }
  if (!Array.isArray(cfg.users)) throw new Error('config.json: users 必须为数组');
  for (const u of cfg.users) {
    if (!u || !USERNAME_RE.test(u.username || '') || typeof u.password !== 'string' || !u.password) {
      throw new Error(`config.json: 用户配置非法（username 限字母数字._-，password 非空）: ${JSON.stringify(u && u.username)}`);
    }
  }
}

function init(configPath = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) generate(configPath);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`配置文件解析失败: ${configPath}: ${err.message}`);
  }
  const merged = { ...DEFAULTS, ...raw };
  validate(merged);
  config = merged;
  configDir = path.dirname(configPath);
  loadedPath = configPath;
  return config;
}

function get() {
  if (!config) throw new Error('配置未初始化，请先调用 init()');
  return config;
}

function resolveContentDir() {
  const dir = get().contentDir;
  return path.isAbsolute(dir) ? dir : path.resolve(configDir, dir);
}

// config.json 所在目录（shares.json 等派生存放于此，测试用临时 config 时自动隔离）
function getConfigDir() {
  if (!config) throw new Error('配置未初始化，请先调用 init()');
  return configDir;
}

function hasUsers() {
  return get().users.length > 0;
}

// 用户配置热生效：每次调用重新读取配置文件（文件损坏/被删时回退到 init 时的缓存）
function getUsers() {
  if (!config) throw new Error('配置未初始化，请先调用 init()');
  try {
    const raw = JSON.parse(fs.readFileSync(loadedPath, 'utf8'));
    return Array.isArray(raw.users) ? raw.users : [];
  } catch {
    return config.users;
  }
}

module.exports = { init, get, getUsers, resolveContentDir, getConfigDir, hasUsers, DEFAULTS };
