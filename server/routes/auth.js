const express = require('express');
const auth = require('../services/auth');

// login：挂在 requireAuth 之前（豁免登录）；logout：挂在 requireAuth 之后（需登录）
const login = express.Router();
const logout = express.Router();

login.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!auth.verify(username, password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
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
