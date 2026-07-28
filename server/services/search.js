const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAX_RESULTS = 200;
const EXTS = new Set(['.md', '.markdown', '.html', '.htm']);

function rgSearch(dir, query) {
  return new Promise((resolve, reject) => {
    const args = [
      '--line-number', '--no-heading', '--fixed-strings',
      '-g', '*.md', '-g', '*.markdown', '-g', '*.html', '-g', '*.htm',
      '--', query, '.',
    ];
    execFile('rg', args, { cwd: dir, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        if (err.code === 'ENOENT') return reject(err); // rg 未安装
        if (err.code === 1) return resolve([]);        // 无匹配
        return reject(err);
      }
      resolve(parseRg(stdout));
    });
  });
}

function parseRg(stdout) {
  return stdout.trim().split('\n').filter(Boolean)
    .map(line => {
      const m = line.match(/^\.\/?([^:]+):(\d+):(.*)$/);
      return m && { path: m[1], line: Number(m[2]), text: m[3].trim() };
    })
    .filter(Boolean)
    .slice(0, MAX_RESULTS);
}

function nodeSearch(dir, query) {
  const results = [];
  walk(dir);
  return results;

  function walk(current) {
    if (results.length >= MAX_RESULTS) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (results.length >= MAX_RESULTS) return;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (EXTS.has(path.extname(entry.name).toLowerCase())) {
        let lines;
        try {
          lines = fs.readFileSync(full, 'utf8').split('\n');
        } catch {
          continue; // 跳过无法按 UTF-8 读取的文件
        }
        lines.forEach((text, i) => {
          if (results.length < MAX_RESULTS && text.includes(query)) {
            results.push({ path: path.relative(dir, full), line: i + 1, text: text.trim() });
          }
        });
      }
    }
  }
}

async function search(dir, query) {
  try {
    return await rgSearch(dir, query);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('未找到 rg，搜索降级为 Node 遍历');
      return nodeSearch(dir, query);
    }
    throw err;
  }
}

module.exports = { search };
