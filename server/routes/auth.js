const express = require('express');
const auth = require('../services/auth');

// login：挂在 requireAuth 之前（豁免登录）；logout：挂在 requireAuth 之后（需登录）
const login = express.Router();
const logout = express.Router();

// 登录爆破防护：每 IP 每 60 秒最多 10 次尝试，登录成功清零
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 10;
const attempts = new Map(); // ip -> { count, resetAt }

login.post('/login', (req, res) => {
  const now = Date.now();
  let rec = attempts.get(req.ip);
  if (!rec || now >= rec.resetAt) rec = { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (rec.count >= RATE_MAX) {
    attempts.set(req.ip, rec);
    return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
  }
  rec.count += 1;
  attempts.set(req.ip, rec);

  const { username, password } = req.body || {};
  if (!auth.verify(username, password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  attempts.delete(req.ip);
  const { token, maxAgeSec } = auth.sign(username);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `auth=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`);
  res.json({ ok: true, username });
});

logout.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

module.exports = { login, logout };
