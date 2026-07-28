const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const REPOS_DIR = path.join(DATA_DIR, 'repos');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const ID_RE = /^[A-Za-z0-9._-]+__[A-Za-z0-9._-]+$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function ensureDirs() {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '[]');
}

function listRepos() {
  ensureDirs();
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveAll(repos) {
  ensureDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(repos, null, 2));
}

function getRepo(id) {
  const repo = listRepos().find(r => r.id === id);
  if (!repo) throw new HttpError(404, `仓库不存在: ${id}`);
  return repo;
}

function addRepo(entry) {
  const repos = listRepos();
  if (repos.some(r => r.id === entry.id)) throw new HttpError(409, `仓库已存在: ${entry.id}`);
  repos.push(entry);
  saveAll(repos);
  return entry;
}

function updateRepo(id, patch) {
  const repos = listRepos();
  const repo = repos.find(r => r.id === id);
  if (!repo) throw new HttpError(404, `仓库不存在: ${id}`);
  Object.assign(repo, patch);
  saveAll(repos);
  return repo;
}

function removeRepo(id) {
  const repos = listRepos();
  const next = repos.filter(r => r.id !== id);
  if (next.length === repos.length) throw new HttpError(404, `仓库不存在: ${id}`);
  saveAll(next);
}

function repoDir(id) {
  if (!ID_RE.test(id)) throw new HttpError(400, `非法仓库 id: ${id}`);
  return path.join(REPOS_DIR, id);
}

function safeResolve(id, relPath) {
  const base = repoDir(id);
  const resolved = path.resolve(base, relPath || '');
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new HttpError(400, `非法路径: ${relPath}`);
  }
  // .git 一律拒绝读写：读取会泄露 remote URL 等配置，写入可篡改 core.hooksPath 导致 pull 时 RCE
  const rel = path.relative(base, resolved);
  if (rel === '.git' || rel.startsWith('.git' + path.sep)) {
    throw new HttpError(400, `非法路径: ${relPath}`);
  }
  return resolved;
}

function repoIdFromUrl(url) {
  const m = url.match(/github\.com[/:]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
  if (m) return `${m[1]}__${m[2]}`;
  const base = path.basename(url.replace(/\/+$/, '')).replace(/\.git$/, '');
  if (/^[A-Za-z0-9._-]+$/.test(base)) return `local__${base}`;
  throw new HttpError(400, `无法从 URL 解析仓库标识: ${url}`);
}

module.exports = {
  HttpError, listRepos, getRepo, addRepo, updateRepo, removeRepo,
  repoDir, safeResolve, repoIdFromUrl, REPOS_DIR,
};
