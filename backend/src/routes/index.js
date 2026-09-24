'use strict';

const express = require('express');
const healthRoutes = require('./health');
const ollamaRoutes = require('./ollama');
const contentRoutes = require('./content');

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/ollama', ollamaRoutes);
router.use('/content', contentRoutes);

module.exports = router;
