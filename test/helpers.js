const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

// 创建包含指定文件的本地 git 仓库（main 分支，一个 commit），返回路径
function makeSourceRepo(files) {
  const dir = makeTempDir('kw-src-');
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git(['add', '.'], dir);
  git(['commit', '-m', 'init'], dir);
  return dir;
}

module.exports = { makeTempDir, makeSourceRepo, git };
