const express = require('express');
const fs = require('fs');
const store = require('../services/repoStore');
const git = require('../services/git');

const router = express.Router();

function wrapGitError(err) {
  if (!err.status) {
    err.status = 500;
    err.message = err.stderr || err.message;
  }
  return err;
}

router.get('/', (req, res) => res.json(store.listRepos()));

router.post('/', (req, res, next) => {
  try {
    const { url, token } = req.body || {};
    if (!url || typeof url !== 'string') throw new store.HttpError(400, '缺少 url');
    const id = store.repoIdFromUrl(url);
    const repo = store.addRepo({
      id, url, status: 'cloning', error: null, addedAt: new Date().toISOString(),
    });
    // 异步 clone，完成后更新状态
    git.clone(url, token, store.repoDir(id))
      .then(() => store.updateRepo(id, { status: 'ready', error: null }))
      .catch(err => {
        store.updateRepo(id, { status: 'error', error: err.stderr || err.message });
        fs.rm(store.repoDir(id), { recursive: true, force: true }, () => {});
      });
    res.status(202).json(repo);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/pull', async (req, res, next) => {
  try {
    const repo = store.getRepo(req.params.id);
    const output = await git.pull(store.repoDir(repo.id));
    store.updateRepo(repo.id, { lastPullAt: new Date().toISOString() });
    res.json({ ok: true, output });
  } catch (err) {
    next(wrapGitError(err));
  }
});

router.post('/:id/reset', async (req, res, next) => {
  try {
    const repo = store.getRepo(req.params.id);
    await git.resetHard(store.repoDir(repo.id));
    res.json({ ok: true });
  } catch (err) {
    next(wrapGitError(err));
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const repo = store.getRepo(req.params.id);
    store.removeRepo(repo.id);
    fs.rmSync(store.repoDir(repo.id), { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
