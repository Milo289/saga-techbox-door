'use strict';
// Looks for a newer version on the GitHub releases page and downloads the right installer for this computer.
// No Electron in here, so it can be tested on its own. Nothing is installed without the person saying so.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const DEFAULT_API = 'https://api.github.com/repos/Milo289/saga-techbox-door/releases/latest';
const API = process.env.DOOR_UPDATE_API || DEFAULT_API; // the override is only for tests
const OFFICIAL = API === DEFAULT_API;

const parse = (v) => { const m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1).map(Number) : null; };
function isNewer(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// which file of a release is the one for this computer
function pickAsset(assets, { platform, arch, appImage }) {
  const arm = arch === 'arm64';
  const want = platform === 'darwin' ? new RegExp(`mac-${arm ? 'arm64' : 'x64'}\\.pkg$`)
    : platform === 'win32' ? /windows-setup\.exe$/
      : appImage ? new RegExp(`linux-${arm ? 'arm64' : 'x86_64'}\\.AppImage$`)
        : new RegExp(`linux-${arm ? 'arm64' : 'amd64'}\\.deb$`);
  return (assets || []).find((a) => want.test(String(a.name))) || null;
}

// only GitHub itself may hand us a file to download
function trusted(url) {
  if (!OFFICIAL) return true;
  try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === 'api.github.com' || u.hostname === 'github.com' || u.hostname.endsWith('.githubusercontent.com')); } catch { return false; }
}

const baseHeaders = (token) => ({ 'User-Agent': 'saga-techbox-deur', ...(token ? { Authorization: `Bearer ${token}` } : {}) });

// the release carries a list of checksums (SHA256SUMS.txt); a downloaded installer must match it before anything is opened
function sumsOf(assets, token) {
  const a = (assets || []).find((x) => x.name === 'SHA256SUMS.txt');
  return a ? { url: token ? a.url : a.browser_download_url } : null;
}
function sha256File(file) {
  return new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });
}
// text of SHA256SUMS.txt ("<hash>  <name>" per line) → does this file match its line?
async function verifyFile(file, name, sumsText) {
  const line = String(sumsText).split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p.length >= 2 && p[p.length - 1].replace(/^\*/, '') === name);
  if (!line) return false;
  return (await sha256File(file)).toLowerCase() === line[0].toLowerCase();
}

async function check(current, token, env) {
  let res;
  try { res = await fetch(API, { headers: { Accept: 'application/vnd.github+json', ...baseHeaders(token) }, signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Geen verbinding met GitHub — probeer het later opnieuw'); }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new Error(token ? 'GitHub weigert de toegangssleutel (of er is nog geen versie gepubliceerd)' : 'De versies staan in een privé-opslagplaats: vul onder “Privé-opslagplaats?” een toegangssleutel in');
  }
  if (!res.ok) throw new Error(`GitHub gaf een fout (${res.status})`);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/, '');
  if (!isNewer(version, current)) return { upToDate: true, version: current };
  const asset = pickAsset(rel.assets, env);
  return {
    upToDate: false, version, notes: String(rel.body || '').slice(0, 800), page: String(rel.html_url || ''),
    asset: asset && /^[\w.\-]+$/.test(asset.name) ? { name: asset.name, size: Number(asset.size) || 0, url: token ? asset.url : asset.browser_download_url, sums: sumsOf(rel.assets, token) } : null,
  };
}

async function download(asset, token, destDir, onProgress) {
  if (!asset || !trusted(asset.url)) throw new Error('Dit downloadadres wordt niet vertrouwd');
  fs.mkdirSync(destDir, { recursive: true });
  const file = path.join(destDir, path.basename(asset.name)); // never outside the folder
  const part = `${file}.part`;
  let res;
  try { res = await fetch(asset.url, { headers: { Accept: 'application/octet-stream', ...baseHeaders(token) }, redirect: 'follow' }); }
  catch { throw new Error('Geen verbinding met GitHub — probeer het later opnieuw'); }
  if (!res.ok || !res.body) throw new Error(`Downloaden mislukte (${res.status})`);
  const total = asset.size || Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(part, { mode: 0o600 });
  let got = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (onProgress && total) onProgress(Math.min(100, Math.round((got / total) * 100)));
    }
    await new Promise((resolve, reject) => { out.end((e) => (e ? reject(e) : resolve())); });
  } catch (e) {
    out.destroy(); try { fs.unlinkSync(part); } catch {}
    throw new Error('Downloaden werd onderbroken — probeer het opnieuw');
  }
  if (asset.size && got !== asset.size) { try { fs.unlinkSync(part); } catch {} throw new Error('De download is niet compleet — probeer het opnieuw'); }
  // integrity: the installer must match the checksum list of the release (the official address always requires it)
  if (asset.sums || OFFICIAL) {
    let ok = false;
    try {
      if (asset.sums && trusted(asset.sums.url)) {
        const r = await fetch(asset.sums.url, { headers: { Accept: 'application/octet-stream', ...baseHeaders(token) }, redirect: 'follow' });
        if (r.ok) ok = await verifyFile(part, asset.name, await r.text());
      }
    } catch { ok = false; }
    if (!ok) { try { fs.unlinkSync(part); } catch {} throw new Error('De download klopt niet met de controlesom van de release en is niet gebruikt. Probeer het later opnieuw.'); }
  }
  fs.renameSync(part, file);
  return file;
}

module.exports = { check, download, pickAsset, isNewer, trusted, verifyFile };
