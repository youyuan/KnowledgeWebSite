const { execFile } = require('child_process');

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function urlWithToken(url, token) {
  if (token && url.startsWith('https://')) {
    return url.replace('https://', `https://${encodeURIComponent(token)}@`);
  }
  return url;
}

// clone 用的 URL 可能嵌入 token，任何对外暴露的文本（如 git stderr）都需先脱敏
function redactToken(text, token) {
  if (typeof text !== 'string' || !token) return text;
  let out = text;
  for (const v of [encodeURIComponent(token), token]) {
    if (v) out = out.split(v).join('***');
  }
  return out;
}

async function clone(url, token, dest) {
  await run(['clone', urlWithToken(url, token), dest]);
}

// clone 成功后恢复为无 token 的原始 URL，避免明文 token 持久化在 .git/config
async function setRemoteUrl(dir, url) {
  await run(['remote', 'set-url', 'origin', url], { cwd: dir });
}

async function pull(dir) {
  const { stdout, stderr } = await run(['pull', '--ff-only'], { cwd: dir });
  return (stdout + stderr).trim();
}

async function resetHard(dir) {
  const { stdout } = await run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
  const branch = stdout.trim();
  await run(['reset', '--hard', `origin/${branch}`], { cwd: dir });
}

module.exports = { clone, pull, resetHard, setRemoteUrl, urlWithToken, redactToken };
