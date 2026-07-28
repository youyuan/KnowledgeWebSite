const path = require('path');
const express = require('express');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/repos', require('./routes/repos'));
  app.use('/api/repos', require('./routes/files'));
  app.use('/api/repos', require('./routes/search'));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/vendor/marked', express.static(path.join(__dirname, '..', 'node_modules', 'marked', 'lib')));
  app.use('/vendor/highlight', express.static(path.join(__dirname, '..', 'node_modules', '@highlightjs', 'cdn-assets')));
  app.use('/vendor/dompurify', express.static(path.join(__dirname, '..', 'node_modules', 'dompurify', 'dist')));

  // 统一错误处理：err.status 缺省 500
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`知识库浏览器已启动: http://localhost:${port}`));
}

module.exports = { createApp };
