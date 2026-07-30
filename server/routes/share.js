const express = require('express');
const fs = require('fs');
const path = require('path');

const store = require('../services/contentStore');
const shareStore = require('../services/shareStore');

// api：需登录（挂在 requireAuth 之后的 /api/repos 下）
const api = express.Router();
// pages：免登录（挂在 requireAuth 之前的 /share 下）
const pages = express.Router();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 无效/过期 token 一律返回此页（不区分，防探测）
function notFoundPage(res) {
  res.status(404).type('html').send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>链接已过期或不存在</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #333; }
    .msg { text-align: center; }
    .msg h1 { font-size: 20px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="msg"><h1>链接已过期或不存在</h1></div>
</body>
</html>
`);
}

// markdown 分享渲染页：内嵌脚本从 /share/<token>/content 取文本，vendor 渲染，相对资源改写到 res 端点
function renderPage(share) {
  const token = share.token;
  const docName = share.path.split('/').pop();
  const expiryText = share.expiresAt
    ? `有效期至 ${new Date(share.expiresAt).toLocaleString('zh-CN')}`
    : '永久有效';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(docName)} - 文档分享</title>
  <link rel="stylesheet" href="/vendor/github-markdown-css/github-markdown-light.css">
  <link rel="stylesheet" href="/vendor/highlight/styles/github.min.css">
  <style>
    body { margin: 0; background: #f4f6f7; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .page { max-width: 960px; margin: 0 auto; padding: 24px 24px 48px; }
    .share-header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
      padding: 12px 20px; background: #fff; border: 1px solid #e3e8eb; border-radius: 10px; margin-bottom: 20px; }
    .share-header .doc { font-size: 16px; font-weight: 600; word-break: break-all; }
    .share-header .meta { font-size: 12.5px; color: #8a97a0; }
    .share-header .badge { margin-left: auto; font-size: 12px; color: #0e7c86; background: #e6f4f5;
      border-radius: 12px; padding: 3px 10px; white-space: nowrap; }
    .markdown-body { background: #fff; border: 1px solid #e3e8eb; border-radius: 10px; padding: 32px 40px; }
    .markdown-body pre { overflow-x: auto; }
    .share-footer { text-align: center; color: #a7b2ba; font-size: 12px; margin-top: 24px; }
    .error { color: #b23a48; }
    @media (max-width: 640px) { .markdown-body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="share-header">
      <span class="doc">${escapeHtml(docName)}</span>
      <span class="meta">${escapeHtml(share.path)}</span>
      <span class="badge">${escapeHtml(expiryText)}</span>
    </div>
    <article class="markdown-body" id="content">加载中…</article>
    <div class="share-footer">由知识库浏览器分享</div>
  </div>
  <script src="/vendor/marked/marked.umd.js"></script>
  <script src="/vendor/dompurify/purify.min.js"></script>
  <script src="/vendor/highlight/highlight.min.js"></script>
  <script>
    /* global marked, hljs, DOMPurify */
    const TOKEN = ${JSON.stringify(token)};
    const DOC_PATH = ${JSON.stringify(share.path)};
    const content = document.getElementById('content');
    document.title = DOC_PATH + ' - 知识库浏览器';

    // 保留 GFM 任务列表的复选框（DOMPurify 默认会剥掉 input）
    const SANITIZE_OPTIONS = { ADD_TAGS: ['input'], ADD_ATTR: ['type', 'checked', 'disabled'] };

    const resUrl = rel => '/share/' + TOKEN + '/res/' + rel.split('/').map(encodeURIComponent).join('/');

    // 相对路径的图片/链接改写到 res 端点（以 md 文件所在目录为基准解析 ..），与 GitHub 行为一致
    function resolveMedia(container) {
      const baseDir = DOC_PATH.split('/').slice(0, -1).join('/');
      const resolveRel = url => {
        if (!url || /^(https?:)?\\/\\//.test(url) || url.startsWith('data:') || url.startsWith('#') || url.startsWith('/')) return null;
        const out = [];
        for (const p of (baseDir ? baseDir + '/' + url : url).split('/')) {
          if (p === '' || p === '.') continue;
          else if (p === '..') out.pop();
          else out.push(p);
        }
        return out.join('/');
      };
      container.querySelectorAll('img').forEach(img => {
        const resolved = resolveRel(img.getAttribute('src'));
        if (resolved) img.src = resUrl(resolved);
      });
      container.querySelectorAll('a').forEach(a => {
        const resolved = resolveRel(a.getAttribute('href'));
        if (resolved) {
          a.href = resUrl(resolved);
          a.target = '_blank';
        }
      });
    }

    fetch('/share/' + TOKEN + '/content')
      .then(async res => {
        if (!res.ok) throw new Error('链接已过期或不存在');
        return (await res.json()).content;
      })
      .then(md => {
        content.innerHTML = DOMPurify.sanitize(marked.parse(md), SANITIZE_OPTIONS);
        content.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
        resolveMedia(content);
      })
      .catch(() => {
        content.innerHTML = '';
        content.className = 'error';
        content.textContent = '链接已过期或不存在';
      });
  </script>
</body>
</html>
`;
}

// 在 <head> 后注入 <base>，使 html 分享的相对资源走 res 端点；无 <head> 时尝试 <html>，再退化为前置
function injectBase(html, token) {
  const base = `<base href="/share/${token}/res/">`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + base + html.slice(head.index + head[0].length);
  const htmlTag = /<html[^>]*>/i.exec(html);
  if (htmlTag) return html.slice(0, htmlTag.index + htmlTag[0].length) + base + html.slice(htmlTag.index + htmlTag[0].length);
  return base + html;
}

// days: 1–365 整数，或 null / "forever" 表示永久；返回 null（永久）、天数、或 undefined（非法）
function parseDays(days) {
  if (days === null || days === 'forever') return null;
  if (Number.isInteger(days) && days >= 1 && days <= 365) return days;
  return undefined;
}

api.post('/:id/share', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    const body = req.body || {};
    if (!body.path || typeof body.path !== 'string') throw new store.HttpError(400, '缺少 path');
    const days = parseDays(body.days);
    if (days === undefined) throw new store.HttpError(400, 'days 必须为 1-365 的整数，或 null/"forever"');
    const full = store.safeResolve(req.params.id, body.path); // 非法路径 400（含 .git 拒绝）
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new store.HttpError(404, '文件不存在');
    const record = shareStore.create(req.params.id, body.path, days);
    res.json({ url: `/share/${record.token}`, token: record.token, expiresAt: record.expiresAt });
  } catch (err) {
    next(err);
  }
});

// 校验 token 有效且文件仍存在；失败已响应 404 提示页，返回 null
function resolveShare(req, res) {
  const share = shareStore.find(req.params.token);
  if (!share) { notFoundPage(res); return null; }
  let full;
  try {
    full = store.safeResolve(share.repo, share.path);
  } catch {
    notFoundPage(res);
    return null;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { notFoundPage(res); return null; }
  return { share, full };
}

pages.get('/:token', (req, res) => {
  const ctx = resolveShare(req, res);
  if (!ctx) return;
  const ext = path.extname(ctx.full).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return res.type('html').send(renderPage(ctx.share));
  if (ext === '.html' || ext === '.htm') {
    return res.type('html').send(injectBase(fs.readFileSync(ctx.full, 'utf8'), ctx.share.token));
  }
  notFoundPage(res); // 其他扩展名 404
});

pages.get('/:token/content', (req, res) => {
  const ctx = resolveShare(req, res);
  if (!ctx) return;
  res.json({ path: ctx.share.path, content: fs.readFileSync(ctx.full, 'utf8') });
});

// 相对资源：解析后必须位于文档所在目录（含子目录）内
pages.get('/:token/res/*rel', (req, res) => {
  const ctx = resolveShare(req, res);
  if (!ctx) return;
  const rel = req.params.rel.join('/');
  const base = path.dirname(ctx.full);
  const resolved = path.resolve(base, rel);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return res.status(400).json({ error: `非法路径: ${rel}` });
  }
  const r = path.relative(base, resolved);
  if (r === '.git' || r.startsWith('.git' + path.sep)) {
    return res.status(400).json({ error: `非法路径: ${rel}` });
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return notFoundPage(res);
  res.sendFile(resolved, { dotfiles: 'allow' });
});

module.exports = { api, pages };
