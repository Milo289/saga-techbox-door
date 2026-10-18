'use strict';
// The test page in the browser: draws the answers of the checks (check-core.js) and can do what only a browser can:
// try the name on the network, trust the certificate, and press the real buttons of the panel.
(() => {
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function paint(r) {
    let el = document.getElementById('r-' + r.id);
    if (!el) { el = document.createElement('div'); el.id = 'r-' + r.id; header(r.group, r.groupTitle); document.getElementById('g-' + r.group).appendChild(el); }
    el.className = 'item ' + r.state; el.replaceChildren();
    const mark = document.createElement('div'); mark.className = 'mark'; mark.textContent = { ok: '✓', bad: '✗', warn: '!', skip: '–', run: '…' }[r.state];
    const body = document.createElement('div'), name = document.createElement('div'); name.textContent = r.name; body.append(name);
    if (r.detail) { const d = document.createElement('div'); d.className = 'detail'; d.textContent = r.detail; body.append(d); }
    el.append(mark, body);
  }
  const groups = new Set();
  function header(group, title) { if (groups.has(group)) return; groups.add(group); const h = document.createElement('h2'); h.style.marginTop = '14px'; h.textContent = title; const box = document.createElement('div'); box.id = 'g-' + group; $('list').append(h, box); }

  // the real panel, opened invisibly inside this page, so its buttons can be pressed like a person does
  const panel = { fr: null, saved: {},
    async open(token) {
      if (panel.fr) return panel.fr.contentDocument;
      for (const k of ['doorToken', 'doorTab', 'doorWizard', 'doorSimple']) { try { panel.saved[k] = localStorage.getItem(k); } catch {} }
      try { localStorage.setItem('doorToken', token); localStorage.setItem('doorTab', 'now'); localStorage.setItem('doorWizard', 'done'); localStorage.setItem('doorSimple', '0'); } catch { throw new Error('de browser laat geen opgeslagen gegevens toe (privévenster?)'); }
      const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;left:-3000px;top:0;width:1300px;height:1000px;border:0'; fr.src = '/admin'; document.body.append(fr); panel.fr = fr;
      await new Promise((res, rej) => { fr.onload = res; setTimeout(() => rej(new Error('het paneel laadde niet')), 15000); });
      for (let i = 0; i < 60; i++) { const d = fr.contentDocument; if (d && d.querySelector('#view') && d.querySelector('#view').children.length && !d.getElementById('shell').classList.contains('hidden')) return d; await sleep(250); }
      throw new Error('het paneel liet na het laden niets zien (ingelogd?)');
    },
    close() { if (panel.fr) { panel.fr.remove(); panel.fr = null; } for (const [k, v] of Object.entries(panel.saved)) { try { if (v === null || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} } panel.saved = {}; },
    async goTab(d, label, must, sl) { const b = [...d.querySelectorAll('nav button')].find((x) => x.textContent.trim().startsWith(label)); must(b, `het tabblad “${label}” staat niet in het paneel`); b.click(); await sl(1500); },
    cardNamed: (d, title) => [...d.querySelectorAll('#view>.card')].find((c) => c.querySelector('h2') && c.querySelector('h2').textContent.includes(title)),
    type(input, value) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); },
    textInput: (card) => [...card.querySelectorAll('input')].find((i) => (!i.type || i.type === 'text') && !i.disabled),
  };

  const env = {
    fetch: (path, init) => fetch(path, init),
    hostname: location.hostname, port: location.port, origin: location.origin, userAgent: navigator.userAgent,
    creds: () => ({ user: $('u').value, pass: $('p').value, code: $('c').value }),
    get mailtest() { return $('mailtest').checked; },
    onResult: paint,
    browser: { reach: (url) => fetch(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(6000) }), panel },
  };

  function show(s) {
    $('sum').textContent = `${s.ok} gelukt · ${s.bad} mislukt · ${s.warn} aandachtspunt${s.warn === 1 ? '' : 'en'} · ${s.skip} overgeslagen`;
    $('sum').style.color = s.bad ? 'var(--bad)' : 'var(--ok)';
    if (!s.bad && !s.warn) { $('promptCard').style.display = 'none'; return; }
    $('prompt').value = s.text; $('promptCard').style.display = '';
  }

  $('go').addEventListener('click', async () => {
    $('go').disabled = true; $('msg').textContent = ''; $('outCard').style.display = ''; $('list').replaceChildren(); $('sum').textContent = 'Bezig…'; $('sum').style.color = ''; $('promptCard').style.display = 'none'; groups.clear();
    try { const runner = window.SagaCheckCore.createRunner(env); const s = await runner.run(); panel.close(); show(s); }
    catch (e) { panel.close(); $('msg').textContent = 'De test stopte: ' + e.message; }
    $('go').disabled = false;
  });
  $('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('prompt').value); } catch { $('prompt').select(); document.execCommand('copy'); } $('copy').textContent = 'Gekopieerd ✓'; setTimeout(() => { $('copy').textContent = 'Kopieer'; }, 2000); });
})();
