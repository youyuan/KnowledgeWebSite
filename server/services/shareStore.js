const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./config');

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[0-9a-f]{32}$/;

// shares.json 存于 config.json 所在目录（测试用临时 config 时自动隔离）
function storePath() {
  return path.join(config.getConfigDir(), 'shares.json');
}

function isExpired(record, now) {
  return record.expiresAt !== null && record.expiresAt <= now;
}

function save(records) {
  fs.writeFileSync(storePath(), JSON.stringify(records, null, 2) + '\n', { mode: 0o600 });
}

// 读取全部有效记录；文件不存在/损坏视为空列表；惰性清理过期项并写回
function list() {
  let records = [];
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    if (Array.isArray(raw)) records = raw;
  } catch { /* 不存在或损坏视为空 */ }
  const now = Date.now();
  const valid = records.filter(r => !isExpired(r, now));
  if (valid.length !== records.length) save(valid);
  return valid;
}

// days 为 null 表示永久
function create(repo, docPath, days) {
  const records = list();
  const now = Date.now();
  const record = {
    token: crypto.randomBytes(16).toString('hex'),
    repo,
    path: docPath,
    createdAt: now,
    expiresAt: days === null ? null : now + days * DAY_MS,
  };
  records.push(record);
  save(records);
  return record;
}

function find(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  return list().find(r => r.token === token) || null;
}

module.exports = { create, find, list, storePath };
