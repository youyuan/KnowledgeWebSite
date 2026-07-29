const path = require('path');
const express = require('express');

function createApp() {
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  app.use(express.json({ limit: '5mb' }));

  app.use('/api', require('./routes/auth').login);
  app.use(require('./middleware/auth').requireAuth);
  app.use('/api', require('./routes/auth').logout);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/me', (req, res) => res.json({ username: req.user }));

  app.use('/api/repos', require('./routes/repos'));
  app.use('/api/repos', require('./routes/files'));
  app.use('/api/repos', require('./routes/search'));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/vendor/marked', express.static(path.join(__dirname, '..', 'node_modules', 'marked', 'lib')));
  app.use('/vendor/highlight', express.static(path.join(__dirname, '..', 'node_modules', '@highlightjs', 'cdn-assets')));
  app.use('/vendor/dompurify', express.static(path.join(__dirname, '..', 'node_modules', 'dompurify', 'dist')));
  app.use('/vendor/github-markdown-css', express.static(path.join(__dirname, '..', 'node_modules', 'github-markdown-css')));

  // 统一错误处理：err.status 缺省 500
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 80;
  require('./services/auth').loadUsers(); // 无有效用户配置时抛错拒绝启动
  createApp().listen(port, () => console.log(`知识库浏览器已启动: http://localhost:${port}`));
}

module.exports = { createApp };
