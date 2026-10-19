'use strict';
// Starter of the server on a Linux disk: starts the newest code. That is the version that was updated from the panel
// (kept in <data>/app) when it is newer than the code that came with the disk, otherwise the code next to this file.
// A new version that does not stay up (three starts in a row) is dropped and the code from the disk is used again.
const fs = require('fs');
const path = require('path');

const here = __dirname;
const dataDir = process.env.DATA_DIR || path.join(here, 'data');
const root = path.join(dataDir, 'app');
const { compareVersions } = require('./updates.js');

function pick() {
  try {
    const cur = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8'));
    const dir = path.join(root, path.basename(String(cur.dir || '')));
    if (!fs.existsSync(path.join(dir, 'server.js'))) return null;
    const ver = (f) => { const pj = require(path.join(f, 'package.json')); return pj.sagaVersion || pj.version; };
    const own = ver(here), theirs = ver(dir);
    if (compareVersions(theirs, own) <= 0) return null; // the disk itself is newer (a new ISO): its code wins
    const triesFile = path.join(root, 'tries.json');
    let t = {}; try { t = JSON.parse(fs.readFileSync(triesFile, 'utf8')); } catch {}
    const n = t.dir === cur.dir ? (t.n || 0) : 0;
    if (n >= 3) { try { fs.renameSync(path.join(root, 'current.json'), path.join(root, 'mislukt.json')); fs.rmSync(triesFile, { force: true }); } catch {} console.error('De bijgewerkte versie startte drie keer niet; de versie van de schijf wordt gebruikt.'); return null; }
    fs.writeFileSync(triesFile, JSON.stringify({ dir: cur.dir, n: n + 1 }));
    return dir;
  } catch { return null; }
}

const dir = pick();
if (dir) { console.log('Bijgewerkte versie gestart uit ' + dir); process.chdir(dir); } else process.chdir(here);
const srv = require(path.join(dir || here, 'server.js'));
if (srv && srv.ready && srv.ready.catch) srv.ready.catch(() => process.exit(1));
if (dir) setTimeout(() => { try { fs.rmSync(path.join(root, 'tries.json'), { force: true }); } catch {} }, 60000).unref();
