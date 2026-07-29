const auth = require('../services/auth');

// 例外：登录页、登录接口、vendor 静态资源
function isExempt(req) {
  return req.path === '/login.html'
    || (req.path === '/api/login' && req.method === 'POST')
    || req.path.startsWith('/vendor/');
}

function requireAuth(req, res, next) {
  if (isExempt(req)) return next();
  const username = auth.verifyToken(auth.parseCookies(req.headers.cookie).auth);
  if (!username) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: '未登录' });
    return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
  }
  req.user = username;
  next();
}

module.exports = { requireAuth };
