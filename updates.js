'use strict';
// Server updates: look for a newer release on GitHub, download the server bundle, check it, unpack it next to the data
// and let boot.js start the new code after a restart. Nothing here runs by itself: an administrator presses the button.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

const REPO = 'Milo289/saga-techbox-door';
const BUNDLE = 'Saga-Techbox-Server.tgz';
// Releases are signed by the maker. Only a file whose signature matches this key is installed (a replaced file on GitHub fails the check).
const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA/GPRjK/jHVklC6sjgkeBo2NJugF1qmkfsL9nUrg0mXo=
-----END PUBLIC KEY-----`;
function signatureOk(data, sigB64, publicKey = RELEASE_PUBLIC_KEY) {
  try { return crypto.verify(null, Buffer.isBuffer(data) ? data : Buffer.from(String(data)), crypto.createPublicKey(publicKey), Buffer.from(String(sigB64).trim(), 'base64')); } catch { return false; }
}

// "3.4.0-beta.16" -> comparable parts. A beta of a version is older than the final version (3.4.0-beta.9 < 3.4.0).
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || '').trim());
  if (!m) return null;
  return { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.').map((x) => (/^\d+$/.test(x) ? +x : x)) : null };
}
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  if (!x.pre && !y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p < q ? -1 : 1;
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

// Picks the newest release the channel allows: 'stable' ignores pre-releases, 'beta' takes everything.
function pickRelease(releases, channel, current) {
  const ok = (Array.isArray(releases) ? releases : []).filter((r) => r && !r.draft && parseVersion(r.tag_name) && (channel === 'beta' || !r.prerelease));
  ok.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  const best = ok[0];
  if (!best) return { newer: false };
  const bundle = (best.assets || []).find((a) => a.name === BUNDLE), sum = (best.assets || []).find((a) => a.name === BUNDLE + '.sha256'), sig = (best.assets || []).find((a) => a.name === BUNDLE + '.sha256.sig');
  return { newer: compareVersions(best.tag_name, current) > 0, version: best.tag_name.replace(/^v/, ''), prerelease: !!best.prerelease, notes: String(best.body || '').slice(0, 1500), bundle, sum, sig, hasBundle: !!(bundle && sum && sig) };
}

function get(url, { token, accept, maxBytes = 200 * 1024 * 1024, redirects = 4, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { 'User-Agent': 'saga-techbox-door', Accept: accept || 'application/vnd.github+json' };
    if (token && u.hostname === 'api.github.com') headers.Authorization = 'Bearer ' + token; // the token never goes along to another host
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); return resolve(get(new URL(res.headers.location, url).toString(), { token, accept, maxBytes, redirects: redirects - 1, timeoutMs })); }
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { req.destroy(new Error('Het bestand is te groot')); } else chunks.push(c); });
      res.on('end', () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve(Buffer.concat(chunks)) : reject(Object.assign(new Error('GitHub antwoordt ' + res.statusCode), { status: res.statusCode }))));
    });
    req.on('timeout', () => req.destroy(new Error('GitHub reageert niet')));
    req.on('error', reject);
  });
}

function friendly(e) {
  if (e && e.status === 404) return 'GitHub vindt de uitgaven niet. De opslagplaats is privé: vul een toegangscode in (alleen lezen).';
  if (e && (e.status === 401 || e.status === 403)) return 'GitHub weigert de toegangscode of het aantal vragen is op. Controleer de code of probeer later opnieuw.';
  if (e && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET/.test(String(e.code || e.message))) return 'Geen verbinding met GitHub. Controleer het internet van de server.';
  return (e && e.message) || 'Onbekende fout';
}

const run = (cmd, args, cwd) => new Promise((resolve, reject) => execFile(cmd, args, { cwd, maxBuffer: 20 * 1024 * 1024, timeout: 120000 }, (err, out, errOut) => (err ? reject(new Error((errOut || err.message).toString().trim().slice(0, 300))) : resolve(String(out)))));

// every name in the archive must stay inside the target folder and must not be a link or device
function safeNames(listing) {
  const names = String(listing).split('\n').map((s) => s.trim()).filter(Boolean);
  if (!names.length) return false;
  return names.every((n) => !path.isAbsolute(n) && !/(^|[\\/])\.\.([\\/]|$)/.test(n) && !/^[A-Za-z]:/.test(n));
}

function create({ dataDir, appDir, currentVersion, getToken, getChannel, log = () => {}, backup = () => {}, fetchJson, fetchFile, publicKey = RELEASE_PUBLIC_KEY }) {
  const root = path.join(dataDir, 'app');
  const jsonGet = fetchJson || (async (url) => JSON.parse((await get(url, { token: getToken() })).toString('utf8')));
  const fileGet = fetchFile || ((url) => get(url, { token: getToken(), accept: 'application/octet-stream' }));
  let last = null, busy = false;

  async function check() {
    try {
      const releases = await jsonGet(`https://api.github.com/repos/${REPO}/releases?per_page=30`);
      const r = pickRelease(releases, getChannel(), currentVersion);
      last = { at: Date.now(), ok: true, current: currentVersion, ...r, bundle: undefined, sum: undefined, _r: r };
      return pub();
    } catch (e) { last = { at: Date.now(), ok: false, current: currentVersion, error: friendly(e) }; return pub(); }
  }
  const pub = () => { if (!last) return { checked: false, current: currentVersion }; const { _r, ...rest } = last; return { checked: true, ...rest }; };

  async function apply() {
    if (busy) throw Object.assign(new Error('Er wordt al bijgewerkt'), { code: 400 });
    busy = true;
    try {
      if (!last || !last.ok) await check();
      if (!last.ok) throw new Error(last.error);
      const r = last._r;
      if (!r.newer) throw new Error('Je hebt al de nieuwste versie');
      if (!r.hasBundle) throw new Error('Bij deze uitgave zit geen ondertekend serverbestand. Haal de nieuwe schijf of app van GitHub.');
      const [data, sumText, sigText] = await Promise.all([fileGet(r.bundle.url), fileGet(r.sum.url), fileGet(r.sig.url)]);
      if (!signatureOk(sumText, sigText, publicKey)) throw new Error('De ondertekening van deze uitgave klopt niet. Er is niets veranderd. Is de uitgave op GitHub aangepast? Neem contact op met de maker.');
      const want = String(sumText).trim().split(/\s+/)[0].toLowerCase();
      const got = crypto.createHash('sha256').update(data).digest('hex');
      if (!/^[0-9a-f]{64}$/.test(want) || want !== got) throw new Error('De controlesom klopt niet: het bestand is beschadigd. Er is niets veranderd.');
      fs.mkdirSync(root, { recursive: true });
      const dir = path.join(root, r.version), tmp = path.join(root, '.new-' + process.pid), file = tmp + '.tgz';
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      fs.writeFileSync(file, data);
      try {
        // relative names and a working folder: a Windows path like C:\x would be read by GNU tar as a computer name
        const rel = path.basename(file), relTmp = path.basename(tmp);
        if (!safeNames(await run('tar', ['-tzf', rel], root))) throw new Error('Het bestand bevat onveilige namen. Er is niets veranderd.');
        await run('tar', ['-xzf', rel, '-C', relTmp], root);
        for (const need of ['server.js', 'package.json', 'public']) if (!fs.existsSync(path.join(tmp, need))) throw new Error('Het serverbestand is onvolledig (' + need + ' ontbreekt). Er is niets veranderd.');
        const pj = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
        if (compareVersions(pj.version, r.version.replace(/-.*/, '')) < 0) throw new Error('Het serverbestand hoort niet bij deze versie. Er is niets veranderd.');
        fs.rmSync(dir, { recursive: true, force: true });
        fs.renameSync(tmp, dir);
      } finally { fs.rmSync(file, { force: true }); fs.rmSync(tmp, { recursive: true, force: true }); }
      try { backup(); } catch {}
      // boot.js reads this file; a new start that does not stay up is undone by boot.js by itself
      const cur = { version: r.version, dir: path.basename(dir), at: new Date().toISOString(), previous: readCurrent(dataDir) };
      fs.writeFileSync(path.join(root, 'current.json.tmp'), JSON.stringify(cur));
      fs.renameSync(path.join(root, 'current.json.tmp'), path.join(root, 'current.json'));
      fs.rmSync(path.join(root, 'tries.json'), { force: true });
      log(`Server bijgewerkt naar ${r.version} (herstart volgt)`);
      prune(root, [dir, cur.previous && cur.previous.dir && path.join(root, cur.previous.dir)]);
      return { ok: true, version: r.version };
    } catch (e) { throw Object.assign(new Error(friendly(e)), { code: 400 }); } finally { busy = false; }
  }
  // back to the version before the last update (or to the version of the disk when there was none)
  function rollback() {
    const cur = readCurrent(dataDir);
    if (!cur) throw Object.assign(new Error('Er is geen update om terug te draaien'), { code: 400 });
    const prev = cur.previous;
    if (prev && prev.dir && fs.existsSync(path.join(root, path.basename(String(prev.dir)), 'server.js'))) {
      fs.writeFileSync(path.join(root, 'current.json.tmp'), JSON.stringify({ version: prev.version, dir: path.basename(String(prev.dir)), at: new Date().toISOString(), previous: null, rolledBack: true }));
      fs.renameSync(path.join(root, 'current.json.tmp'), path.join(root, 'current.json'));
    } else fs.renameSync(path.join(root, 'current.json'), path.join(root, 'teruggedraaid.json'));
    fs.rmSync(path.join(root, 'tries.json'), { force: true });
    log(`Server teruggedraaid naar ${prev && prev.version ? prev.version : 'de versie van de schijf'} (herstart volgt)`);
    return { ok: true, version: prev && prev.version ? prev.version : '' };
  }
  const canRollback = () => !!readCurrent(dataDir);
  return { check, apply, rollback, canRollback, status: pub };
}

function readCurrent(dataDir) { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'app', 'current.json'), 'utf8')); } catch { return null; } }
function prune(root, keep) {
  try { for (const n of fs.readdirSync(root)) { const p = path.join(root, n); if (fs.statSync(p).isDirectory() && !keep.includes(p)) fs.rmSync(p, { recursive: true, force: true }); } } catch {}
}

// Is the data folder kept after a restart? A live system without a data disk forgets everything (and every update).
function persistence(dataDir, readMounts = () => fs.readFileSync('/proc/mounts', 'utf8'), liveMarker = '/run/live/medium', platform = process.platform) {
  try {
    if (platform !== 'linux' || !fs.existsSync(liveMarker)) return { live: false, persistent: true };
    const mounts = readMounts().split('\n').map((l) => l.split(' ')[1]).filter(Boolean);
    const here = path.posix.resolve(dataDir.replace(/\\/g, '/'));
    const own = mounts.some((m) => m !== '/' && (here === m || here.startsWith(m + '/')) && !['/run', '/tmp', '/dev', '/sys', '/proc'].some((x) => m === x || m.startsWith(x + '/')));
    return { live: true, persistent: own };
  } catch { return { live: false, persistent: true }; }
}

module.exports = { signatureOk, RELEASE_PUBLIC_KEY, create, parseVersion, compareVersions, pickRelease, safeNames, persistence, readCurrent, BUNDLE, REPO };
