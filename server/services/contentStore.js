const fs = require('fs');
const path = require('path');

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, '..', '..', 'content');

const ID_RE = /^[A-Za-z0-9._-]+$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function listRepos() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  return fs.readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && ID_RE.test(e.name))
    .map(e => ({ id: e.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function repoDir(id) {
  if (!ID_RE.test(id)) throw new HttpError(400, `非法资料库 id: ${id}`);
  return path.join(CONTENT_DIR, id);
}

function getRepo(id) {
  const dir = repoDir(id);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new HttpError(404, `资料库不存在: ${id}`);
  }
  return { id };
}

function createRepo(id) {
  const dir = repoDir(id);
  if (fs.existsSync(dir)) throw new HttpError(409, `资料库已存在: ${id}`);
  fs.mkdirSync(dir, { recursive: true });
  return { id };
}

function safeResolve(id, relPath) {
  const base = repoDir(id);
  const resolved = path.resolve(base, relPath || '');
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new HttpError(400, `非法路径: ${relPath}`);
  }
  const rel = path.relative(base, resolved);
  if (rel === '.git' || rel.startsWith('.git' + path.sep)) {
    throw new HttpError(400, `非法路径: ${relPath}`);
  }
  return resolved;
}

module.exports = { HttpError, listRepos, getRepo, createRepo, repoDir, safeResolve, CONTENT_DIR };
