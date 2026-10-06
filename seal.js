'use strict';
// Seal for access.js: the main account lives in that file and the program refuses to start without a valid one
// (like a protected system file). The seal catches deletion, corruption and casual edits.
const crypto = require('crypto');
const KEY = 'saga-techbox-deur/access/v1/3f9a1c07e2b84d5a9c61';
const seal = (username, hash) => crypto.createHmac('sha256', KEY).update(`${username}\n${hash}`).digest('hex');
function verifyAccess(a) {
  if (!a || typeof a.username !== 'string' || typeof a.hash !== 'string' || typeof a.check !== 'string' || !a.username || !a.hash) return false;
  const want = Buffer.from(seal(a.username, a.hash), 'hex'), got = Buffer.from(a.check, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
module.exports = { seal, verifyAccess };
