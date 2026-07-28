const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('../services/repoStore');

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
    const full = store.safeResolve(req.params.id, req.query.path);
    const buf = fs.readFileSync(full);
    if (isBinary(buf)) throw new store.HttpError(415, '二进制文件不支持查看');
    res.json({ path: req.query.path, content: buf.toString('utf8') });
  } catch (err) {
    if (err.code === 'ENOENT') err = new store.HttpError(404, '文件不存在');
    next(err);
  }
});

router.put('/:id/file', (req, res, next) => {
  try {
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
    const full = store.safeResolve(req.params.id, req.query.path);
    res.sendFile(full);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
