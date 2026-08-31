'use strict';

const rateLimit = require('express-rate-limit');

function makeLimiter(windowMs, max, message) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
  });
}

const limiter = makeLimiter(60 * 1000, 300, 'Too many requests — please try again later.');
const writeOpsLimiter = makeLimiter(60 * 1000, 40, 'Too many requests — please try again later.');
const applyLimiter = makeLimiter(10 * 60 * 1000, 3, 'Too many applications — please wait before trying again.');
const bookingLimiter = makeLimiter(60 * 1000, 20, 'Too many booking requests — please wait before trying again.');
const authLimiter = makeLimiter(60 * 1000, 20, 'Too many auth requests — please wait before trying again.');

module.exports = { limiter, writeOpsLimiter, applyLimiter, bookingLimiter, authLimiter };
