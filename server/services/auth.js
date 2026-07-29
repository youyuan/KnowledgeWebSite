const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_FILE = process.env.AUTH_FILE || path.join(__dirname, '..', '..', 'auth.json');
const SECRET_FILE = path.join(__dirname, '..', '..', '.auth-secret');
const MAX_AGE_SEC = 7 * 24 * 3600; // 7 天
const USERNAME_RE = /^[A-Za-z0-9._-]+$/;

function loadUsers() {
  let users;
  try {
    users = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    throw new Error(`无法读取用户配置 ${AUTH_FILE}，请参照 auth.json.example 创建`);
  }
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error(`${AUTH_FILE} 中没有配置任何用户`);
  }
  for (const u of users) {
    if (!u || !USERNAME_RE.test(u.username || '') || typeof u.password !== 'string' || !u.password) {
      throw new Error(`用户配置非法（username 限字母数字._-，password 为非空明文）: ${JSON.stringify(u && u.username)}`);
    }
  }
  return users;
}

function verify(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return false;
  const user = loadUsers().find(u => u.username === username);
  if (!user) return false;
  const a = Buffer.from(user.password);
  const b = Buffer.from(password);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
}

function hmac(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

function sign(username) {
  const expiry = Date.now() + MAX_AGE_SEC * 1000;
  const payload = `${username}|${expiry}`;
  return { token: `${payload}|${hmac(payload)}`, maxAgeSec: MAX_AGE_SEC };
}

function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('|');
  if (parts.length !== 3) return null;
  const [username, expiry, sig] = parts;
  const payload = `${username}|${expiry}`;
  const expect = Buffer.from(hmac(payload));
  const actual = Buffer.from(sig);
  if (expect.length !== actual.length || !crypto.timingSafeEqual(expect, actual)) return null;
  if (Number(expiry) < Date.now()) return null;
  if (!loadUsers().some(u => u.username === username)) return null;
  return username;
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

module.exports = { loadUsers, verify, sign, verifyToken, parseCookies, MAX_AGE_SEC };
