'use strict';

const express = require('express');
const ollamaService = require('../services/ollamaService');
const { asyncWrap } = require('../util');

const router = express.Router();

// GET /api/ollama/status
router.get('/status', asyncWrap(async (_req, res) => {
  const status = await ollamaService.checkStatus();
  res.json({ ...status, url: config_url() });
}));

// GET /api/ollama/models
router.get('/models', asyncWrap(async (_req, res) => {
  const models = await ollamaService.listModels();
  res.json({ count: models.length, models });
}));

function config_url() {
  return require('../config').ollama.url;
}

module.exports = router;
