const path = require('path');
const express = require('express');

function createApp() {
  const app = express();
  if (require('./services/config').get().trustProxy) app.set('trust proxy', 1);
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
  const config = require('./services/config');
  config.init(); // config.json 不存在时自动生成
  if (!config.hasUsers()) {
    console.error('config.json 中没有配置任何用户，拒绝启动');
    process.exit(1);
  }
  const port = config.get().port;
  createApp().listen(port, () => console.log(`知识库浏览器已启动: http://localhost:${port}`));
}

module.exports = { createApp };
