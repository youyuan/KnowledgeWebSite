const express = require('express');
const store = require('../services/contentStore');
const { search } = require('../services/search');

const router = express.Router();

router.get('/:id/search', async (req, res, next) => {
  try {
    store.getRepo(req.params.id);
    if (!req.query.q) throw new store.HttpError(400, '缺少 q');
    const results = await search(store.repoDir(req.params.id), req.query.q);
    res.json({ query: req.query.q, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
