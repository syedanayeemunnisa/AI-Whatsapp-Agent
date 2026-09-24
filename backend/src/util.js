'use strict';

/** Small helpers shared across services. */

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const asyncWrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function isValidTopic(s) {
  return typeof s === 'string' && s.trim().length >= 2 && s.trim().length <= 200;
}

module.exports = { AppError, asyncWrap, isValidTopic };
