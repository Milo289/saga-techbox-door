'use strict';
// Starts a real copy of the server on a free port with its own empty data folder.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// patch: gives the start account extra rights in a throw-away copy of the server, so the settings routes can be tested
async function startServer({ patch = false, dir, env = {} } = {}) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'door-test-'));
  let root = ROOT;
  if (patch) {
    root = path.join(dir, 'app');
    fs.mkdirSync(root, { recursive: true });
    for (const f of ['server.js', 'seal.js', 'access.js', 'package.json']) fs.copyFileSync(path.join(ROOT, f), path.join(root, f));
    fs.cpSync(path.join(ROOT, 'public'), path.join(root, 'public'), { recursive: true });
    const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const out = src.replace("START_PERMS = ['view', 'status', 'inbox', 'users']", "START_PERMS = ['view', 'status', 'inbox', 'users', 'settings', 'people', 'audit', 'mail', 'export', 'api']");
    if (out === src) throw new Error('the test patch no longer matches server.js');
    fs.writeFileSync(path.join(root, 'server.js'), out);
  }
  const port = 20000 + Math.floor(Math.random() * 30000);
  const dataDir = path.join(dir, 'data');
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, HOST: '127.0.0.1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const srv = {
    port, dir, dataDir, child, url: `http://127.0.0.1:${port}`, log: () => log,
    async stop() { if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } },
  };
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${srv.url}/healthz`)).ok) return srv; } catch {}
    await sleep(100);
  }
  await srv.stop();
  throw new Error('server did not start:\n' + log);
}

async function call(srv, method, p, body, token, headers = {}) {
  const res = await fetch(srv.url + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function login(srv, username = 'admin', password = 'admin-start-123') {
  const r = await call(srv, 'POST', '/api/login', { username, password });
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${r.text}`);
  return r.json.token;
}

module.exports = { startServer, call, login, sleep, ROOT };
