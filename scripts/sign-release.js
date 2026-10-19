'use strict';
// Signs files of a release with the private release key (environment RELEASE_SIGNING_KEY, a PEM text; it only lives in the GitHub secret
// and in a copy on the maker's computer). For every file it writes <file>.sig (the signature, base64).
// The matching public key is built into the server (updates.js) and the desktop app (app/updater.js).
const fs = require('fs');
const crypto = require('crypto');
const pem = process.env.RELEASE_SIGNING_KEY;
if (!pem || !/PRIVATE KEY/.test(pem)) { console.error('RELEASE_SIGNING_KEY is missing: a release is never made without a signature.'); process.exit(1); }
const key = crypto.createPrivateKey(pem);
for (const f of process.argv.slice(2)) {
  fs.writeFileSync(f + '.sig', crypto.sign(null, fs.readFileSync(f), key).toString('base64') + '\n');
  console.log('signed', f);
}
