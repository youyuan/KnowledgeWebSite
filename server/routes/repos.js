const express = require('express');
const store = require('../services/contentStore');

const router = express.Router();

router.get('/', (req, res) => res.json(store.listRepos()));

router.post('/', (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string') throw new store.HttpError(400, '缺少 name');
    res.status(201).json(store.createRepo(name.trim()));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
