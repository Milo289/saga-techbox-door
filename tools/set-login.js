#!/usr/bin/env node
'use strict';
// Writes access.js: the main account that ships with the program (username + hash of the START password + seal).
//   npm run login            ask for a username and start password (hidden), write access.js
//   npm run login -- --default   write the standard one: see DEFAULT_USER / DEFAULT_PASSWORD below
// People who install the program log in with this start password once and must choose their own at once.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { seal } = require('../seal.js');

const DEFAULT_USER = 'admin';
const DEFAULT_PASSWORD = 'Saga-Techbox-Start-2026';
const OUT = path.join(__dirname, '..', 'access.js');
const hashPassword = (pw) => { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`; };

let piped = null;
function pipedLines() { if (piped) return piped; try { piped = fs.readFileSync(0, 'utf8').split(/\r?\n/); } catch { piped = []; } return piped; }
function ask(prompt, hidden) {
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) { const v = pipedLines().shift() || ''; process.stdout.write('\n'); return Promise.resolve(v); }
  return new Promise((resolve) => {
    const stdin = process.stdin; let text = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n' || c === '\u0004') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', on); process.stdout.write('\n'); return resolve(text); }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') { if (text) { text = text.slice(0, -1); if (!hidden) process.stdout.write('\b \b'); } continue; }
        text += c; if (!hidden) process.stdout.write(c);
      }
    };
    stdin.on('data', on);
  });
}
function write(username, password) {
  const hash = hashPassword(password);
  fs.writeFileSync(OUT, `'use strict';
// The main account of this program: a username and a hash of the START password, sealed against changes.
// The program does not start without this file. Anyone who installs it logs in once with the start password
// and is then required to choose a password of their own (stored separately, in the data folder).
// Written by:  npm run login
module.exports = ${JSON.stringify({ username, hash, check: seal(username, hash) }, null, 2)};
`);
}

(async () => {
  if (process.argv.includes('--default')) { write(DEFAULT_USER, DEFAULT_PASSWORD); console.log(`access.js geschreven met de standaard inlog (${DEFAULT_USER}).`); return; }
  console.log('Hoofdaccount instellen — gebruikersnaam en STARTwachtwoord (alleen een hash wordt bewaard).\n');
  const username = (await ask('Gebruikersnaam: ', false)).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) { console.error('Gebruikersnaam: 3 tot 32 tekens — letters, cijfers, punt, streepje of underscore.'); process.exit(1); }
  const pw = await ask('Startwachtwoord (minstens 12 tekens): ', true);
  if (pw.length < 12) { console.error('Te kort: kies minstens 12 tekens.'); process.exit(1); }
  const again = await ask('Nog een keer: ', true);
  if (again !== pw) { console.error('De twee wachtwoorden zijn niet hetzelfde.'); process.exit(1); }
  write(username, pw);
  console.log('\nKlaar. De inloggegevens staan in access.js.');
})();
