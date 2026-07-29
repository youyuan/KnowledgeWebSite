const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('../services/contentStore');

const router = express.Router();

function buildTree(dir, base) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.name !== '.git')
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
    .map(e => {
      const full = path.join(dir, e.name);
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (e.isDirectory()) {
        return { name: e.name, path: rel, type: 'dir', children: buildTree(full, base) };
      }
      return { name: e.name, path: rel, type: 'file', ext: path.extname(e.name).toLowerCase() };
    });
}

function isBinary(buf) {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

router.get('/:id/tree', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    const dir = store.repoDir(req.params.id);
    res.json({ name: req.params.id, type: 'dir', children: buildTree(dir, dir) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/file', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    const full = store.safeResolve(req.params.id, req.query.path);
    const buf = fs.readFileSync(full);
    if (isBinary(buf)) throw new store.HttpError(415, '二进制文件不支持查看');
    res.json({ path: req.query.path, content: buf.toString('utf8') });
  } catch (err) {
    if (err.code === 'ENOENT') err = new store.HttpError(404, '文件不存在');
    if (err.code === 'EISDIR') err = new store.HttpError(400, '路径是目录');
    next(err);
  }
});

router.put('/:id/file', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    const full = store.safeResolve(req.params.id, req.query.path);
    if (typeof (req.body || {}).content !== 'string') throw new store.HttpError(400, '缺少 content');
    fs.writeFileSync(full, req.body.content, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/raw', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    const full = store.safeResolve(req.params.id, req.query.path);
    // dotfiles: 'allow'——资料库可能含 .assets 等点开头目录（.git 已被 safeResolve 拒绝）
    res.sendFile(full, { dotfiles: 'allow' });
  } catch (err) {
    next(err);
  }
});

// 新建空文件
router.post('/:id/file', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    const full = store.safeResolve(req.params.id, req.query.path);
    if (fs.existsSync(full)) throw new store.HttpError(409, '文件已存在');
    fs.writeFileSync(full, '', 'utf8');
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === 'ENOENT') err = new store.HttpError(404, '父目录不存在');
    next(err);
  }
});

// 新建文件夹（递归）
router.post('/:id/mkdir', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    fs.mkdirSync(store.safeResolve(req.params.id, req.query.path), { recursive: true });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 删除文件或文件夹（不允许删资料库根目录）
router.delete('/:id/file', (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    const full = store.safeResolve(req.params.id, req.query.path);
    if (full === store.repoDir(req.params.id)) {
      throw new store.HttpError(400, '不允许删除资料库根目录');
    }
    fs.rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 上传文件（原始二进制 body）
router.post('/:id/upload', express.raw({ type: () => true, limit: '50mb' }), (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new store.HttpError(400, '请求体必须为原始二进制');
    fs.writeFileSync(store.safeResolve(req.params.id, req.query.path), req.body);
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === 'ENOENT') err = new store.HttpError(404, '父目录不存在');
    next(err);
  }
});

module.exports = router;
