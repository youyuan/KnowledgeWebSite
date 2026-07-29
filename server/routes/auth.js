const express = require('express');
const auth = require('../services/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!auth.verify(username, password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const { token, maxAgeSec } = auth.sign(username);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `auth=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`);
  res.json({ ok: true, username });
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

module.exports = router;
