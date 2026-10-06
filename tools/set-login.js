#!/usr/bin/env node
'use strict';
// Writes access.js: the login of the main account (username + scrypt hash of the password).
// Interactive: asks for the username and (hidden) the password twice. Nothing is printed or stored in plain text.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT = path.join(__dirname, '..', 'access.js');
const hashPassword = (pw) => { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`; };

let piped = null; // when input comes from a pipe (automation), read all lines at once
function pipedLines() {
  if (piped) return piped;
  try { piped = fs.readFileSync(0, 'utf8').split(/\r?\n/); } catch { piped = []; }
  return piped;
}
function ask(prompt, hidden) {
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) { const v = pipedLines().shift() || ''; process.stdout.write('\n'); return Promise.resolve(v); }
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let text = '';
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

(async () => {
  console.log('Inloggegevens instellen (alleen een hash van het wachtwoord wordt bewaard).\n');
  const username = (await ask('Gebruikersnaam: ', false)).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) { console.error('Gebruikersnaam: 3 tot 32 tekens — letters, cijfers, punt, streepje of underscore.'); process.exit(1); }
  const pw = await ask('Wachtwoord (minstens 12 tekens): ', true);
  if (pw.length < 12) { console.error('Te kort: kies minstens 12 tekens.'); process.exit(1); }
  const again = await ask('Nog een keer: ', true);
  if (again !== pw) { console.error('De twee wachtwoorden zijn niet hetzelfde.'); process.exit(1); }
  const src = fs.readFileSync(OUT, 'utf8').replace(/module\.exports = \{[^}]*\};/, `module.exports = { username: ${JSON.stringify(username)}, hash: ${JSON.stringify(hashPassword(pw))} };`);
  fs.writeFileSync(OUT, src);
  console.log('\nKlaar. De inloggegevens staan in access.js.');
  console.log('Herstart de server (of bouw de app opnieuw) om ze te gebruiken. Bewaar het wachtwoord veilig: er is geen "wachtwoord vergeten".');
})();
