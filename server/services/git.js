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

async function clone(url, token, dest) {
  await run(['clone', urlWithToken(url, token), dest]);
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

module.exports = { clone, pull, resetHard };
