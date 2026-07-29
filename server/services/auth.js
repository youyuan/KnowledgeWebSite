const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const SECRET_FILE = path.join(__dirname, '..', '..', '.auth-secret');
const MAX_AGE_SEC = 7 * 24 * 3600; // 7 天

function loadUsers() {
  const users = config.get().users;
  if (!users.length) throw new Error('config.json 中没有配置任何用户');
  // username/password 校验已在 config.validate 完成
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
  if (config.get().authSecret) return config.get().authSecret;
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
  if (!Number.isFinite(Number(expiry)) || Number(expiry) < Date.now()) return null;
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
