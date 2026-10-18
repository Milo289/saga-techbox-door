'use strict';
// The checks of the door server, without a screen: used by the test page in the browser (/check) and by the runner on the machine itself.
// Everything a check changes it puts back; the test account it makes is removed again.
(() => {
  // ---------- small helpers (also used by the automatic tests) ----------
  const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '', out = []; for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = A.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); } for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return new Uint8Array(out); };
  function sha1(bytes) {
    const rotl = (n, s) => (n << s) | (n >>> (32 - s));
    const len = bytes.length, words = [];
    for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
    words[(((len + 8) >> 6) + 1) * 16 - 1] = len * 8;
    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    for (let i = 0; i < words.length; i += 16) {
      const w = new Array(80);
      for (let t = 0; t < 80; t++) w[t] = t < 16 ? (words[i + t] | 0) : rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let t = 0; t < 80; t++) {
        const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
        const k = t < 20 ? 0x5A827999 : t < 40 ? 0x6ED9EBA1 : t < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
        const tmp = (rotl(a, 5) + f + e + k + w[t]) | 0; e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    const out = new Uint8Array(20); [h0, h1, h2, h3, h4].forEach((v, i) => { out[i * 4] = v >>> 24; out[i * 4 + 1] = (v >>> 16) & 255; out[i * 4 + 2] = (v >>> 8) & 255; out[i * 4 + 3] = v & 255; });
    return out;
  }
  function hmacSha1(key, msg) {
    if (key.length > 64) key = sha1(key);
    const k = new Uint8Array(64); k.set(key);
    const ipad = new Uint8Array(64 + msg.length), opad = new Uint8Array(84);
    for (let i = 0; i < 64; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
    ipad.set(msg, 64); opad.set(sha1(ipad), 64);
    return sha1(opad);
  }
  function totp(secret, now = Date.now()) {
    const counter = Math.floor(now / 30000), msg = new Uint8Array(8);
    let c = counter; for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
    const h = hmacSha1(b32(secret), msg), o = h[19] & 15;
    const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(n % 1000000).padStart(6, '0');
  }

  const Skip = class extends Error {}, Warn = class extends Error {};
  const skip = (m) => { throw new Skip(m); }, warn = (m) => { throw new Warn(m); };
  const must = (cond, msg) => { if (!cond) throw new Error(msg); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = () => Math.random().toString(36).slice(2, 10);

  // env: { fetch(path, init), hostname, port, origin, userAgent, creds(), mailtest, onResult(r), browser? }
  function createRunner(env) {
    let TOKEN = '', ME = null, STATE = null, VERSION = '';
    const results = [];
    async function req(method, path, body, token = TOKEN) {
      const res = await env.fetch(path, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
      return { status: res.status, json, text, headers: res.headers };
    }
    const get = (p, t) => req('GET', p, undefined, t), post = (p, b, t) => req('POST', p, b === undefined ? {} : b, t);
    const can = (p) => !!(ME && ME.perms && ME.perms.includes(p));
    const isRoot = () => !!(ME && (ME.noPw || (env.testMode && can('system'))));
    async function t(group, title, name, fn) {
      const r = { id: results.length, group, groupTitle: title, name, state: 'run', detail: '' };
      results.push(r); env.onResult(r);
      try { const out = await fn(); r.state = 'ok'; r.detail = typeof out === 'string' ? out : ''; }
      catch (e) { r.state = e instanceof Skip ? 'skip' : e instanceof Warn ? 'warn' : 'bad'; r.detail = e && e.message ? e.message : String(e); }
      env.onResult(r);
    }
  async function runAll() {
    const G = {
      basis: 'Basis', name: 'Naam en https', sec: 'Inloggen en beveiliging', two: 'Tweestapsverificatie en tijdelijke rechten', set: 'Instellingen', rules: 'Eigen knoppen, antwoorden en meldingen', ext: 'Agenda, filter en mail', sys: 'Systeem, back-ups en overzetten', ui: 'Het vernieuwde paneel',
    };
    const info = (await get('/api/auth-info')).json || {};
    VERSION = info.version || '';
    await t('basis', G.basis, 'Alle pagina’s laden', async () => {
      const pages = ['/', '/admin', '/visit', '/start', '/help', '/check'], bad = [];
      for (const p of pages) { const r = await get(p); if (r.status !== 200 || !/html/.test(r.headers.get('content-type') || '')) bad.push(`${p} → ${r.status}`); }
      must(!bad.length, bad.join(', ')); return pages.length + ' pagina’s';
    });
    await t('basis', G.basis, 'Versie is 3.4 of nieuwer', async () => { must(/^3\.(4|[5-9])|^[4-9]\./.test(info.version || ''), 'versie: ' + (info.version || 'onbekend')); return 'versie ' + info.version; });
    await t('basis', G.basis, 'Strenge beveiligingskoppen (geen scripts zonder vingerafdruk)', async () => {
      const r = await get('/admin'), csp = r.headers.get('content-security-policy') || '';
      const script = (csp.split(';').find((x) => x.trim().startsWith('script-src')) || '');
      must(script && !script.includes('unsafe-inline') && !script.includes('unsafe-eval'), 'script-src: ' + (script || 'ontbreekt'));
      must(/sha256-/.test(script), 'geen vingerafdrukken in de policy');
      must(r.headers.get('x-content-type-options') === 'nosniff', 'nosniff ontbreekt');
      must(/SAMEORIGIN|DENY/i.test(r.headers.get('x-frame-options') || ''), 'X-Frame-Options ontbreekt');
    });
    await t('basis', G.basis, 'Geheime instellingen zijn niet publiek', async () => {
      const r = await get('/api/state'); must(r.status === 200 && r.json, 'status ' + r.status);
      const txt = JSON.stringify(r.json); must(!/notifyRules|autoReplies|ntfyTopic|webhookUrl|"pass"/.test(txt), 'er staan private instellingen in de publieke gegevens');
      must((await get('/api/admin-state', '')).status === 401, 'het paneel is zonder inlog te lezen');
    });
    STATE = (await get('/api/state')).json || {};
    await t('basis', G.basis, 'Eigen knoppen staan in de publieke gegevens', async () => { must(STATE.settings && Array.isArray(STATE.settings.customButtons), 'customButtons ontbreekt (is de server beta.3 of nieuwer?)'); });

    // names and https
    await t('name', G.name, 'De naam saga-deur.local is te vinden', async () => {
      if (!env.browser) skip('alleen in de browser (een apparaat in het netwerk moet de naam proberen)');
      if (env.hostname.endsWith('.local')) return 'deze pagina is al via een naam geopend';
      const before = ((await get('/api/mdns')).json) || {};
      try { await env.browser.reach(`http://saga-deur.local:${env.port || 80}/healthz`); return 'bereikbaar'; }
      catch {
        await sleep(500); const after = ((await get('/api/mdns')).json) || {};
        if (!after.enabled) warn('de naam werkt niet vanaf dit apparaat; de server maakt de naam niet zelf bekend (DOOR_MDNS staat uit). Het IP-adres werkt wel.');
        if (!after.running) warn('de naam werkt niet; het onderdeel dat de naam bekendmaakt draait niet' + (after.error ? ' (' + after.error + ')' : '') + '. Het IP-adres werkt wel.');
        if ((after.queries || 0) > (before.queries || 0)) warn(`de server heeft de vraag naar de naam gehoord en beantwoord, maar dit apparaat kreeg het antwoord niet (${after.answered} antwoorden). Dat ligt aan het netwerk of de router. Het IP-adres werkt wel.`);
        warn(`de vraag naar de naam kwam niet aan bij de server (er zijn ${after.queries || 0} vragen gehoord). Het netwerk geeft deze soort berichten (mDNS) niet door tussen dit apparaat en de server; vaak een wifi-router met "client isolation" of "multicast" uit. Het IP-adres werkt wel.`);
      }
    });

    // log in
    let loginOk = false;
    await t('sec', G.sec, 'Inloggen', async () => {
      const cr = env.creds(), u = cr.user.trim().toLowerCase(), p = cr.pass;
      let r = await post('/api/login', { username: u, password: p, remember: false }, '');
      if (r.json && r.json.needs2fa) { must((cr.code || '').trim(), 'dit account heeft een tweestapscode nodig: vul die hierboven in'); r = await post('/api/login/2fa', { mfa: r.json.mfa, code: cr.code.trim() }, ''); }
      must(r.status === 200 && r.json && r.json.token, (r.json && r.json.error) || 'inloggen mislukt (' + r.status + ')');
      TOKEN = r.json.token; ME = (await get('/api/me')).json; must(ME, 'kan eigen gegevens niet lezen'); loginOk = true;
      return `ingelogd als ${ME.name}${isRoot() ? ' (hoofdaccount)' : ''}`;
    });
    if (!loginOk) return summary();
    const adm = (await get('/api/admin-state')).json || {};
    await t('sec', G.sec, 'Beveiligingsscore', async () => { if (!can('settings')) skip('dit account mag de score niet zien'); must(adm.security && typeof adm.security.score === 'number' && Array.isArray(adm.security.items), 'geen score in de gegevens'); return `score ${adm.security.score} van 100`; });
    await t('sec', G.sec, 'Logboek met ketting klopt', async () => { if (!can('audit')) skip('geen recht voor het logboek'); const r = await get('/api/audit/verify'); must(r.status === 200 && r.json.ok === true, 'het logboek klopt niet: ' + r.text.slice(0, 120)); return `${r.json.lines} regels`; });
    await t('sec', G.sec, 'Logboek exporteren (csv en json)', async () => { if (!can('audit')) skip('geen recht voor het logboek'); const c = await get('/api/audit/export?format=csv'), j = await get('/api/audit/export?format=json'); must(c.status === 200 && /Tijd,Soort/.test(c.text), 'csv: ' + c.status); must(j.status === 200 && Array.isArray(JSON.parse(j.text)), 'json: ' + j.status); });
    await t('sec', G.sec, 'Geblokkeerde adressen en aanvalsinstellingen', async () => { if (!can('settings')) skip('geen recht'); const r = await get('/api/security/bans'); must(r.status === 200 && Array.isArray(r.json.bans) && r.json.attack, 'vorm klopt niet'); });
    await t('sec', G.sec, 'Eigen apparaten en sessies', async () => { const r = await get('/api/my/sessions'); must(r.status === 200 && r.json.sessions.some((s) => s.current), 'de eigen sessie staat er niet bij'); return r.json.sessions.length + ' sessie(s)'; });
    await t('sec', G.sec, 'Passkeys: lijst en inlogvraag', async () => {
      const l = await get('/api/passkeys'); must(l.status === 200 && Array.isArray(l.json.passkeys), 'lijst: ' + l.status);
      const c = await get('/api/login/passkey', ''); must(c.status === 200 && 'available' in c.json, 'inlogvraag: ' + c.status);
      const o = await post('/api/passkeys/options'); const ip = /^\d+\.\d+\.\d+\.\d+$|^localhost$/.test(env.hostname);
      if (ip) must(o.status === 400 && /IP-adres/.test(o.text), 'met een IP-adres hoort een uitleg te komen, kreeg ' + o.status);
      else must(o.status === 200 ? !!o.json.challenge : o.status === 400, 'opties: ' + o.status);
      return ip ? 'werkt niet met een IP-adres, dat meldt de server netjes' : 'beschikbaar';
    });
    await t('sec', G.sec, 'Beveiligde verbinding (https) en certificaat', async () => {
      if (!can('settings')) skip('geen recht');
      const s = await get('/api/https'); must(s.status === 200, 'status ' + s.status);
      if (!s.json.enabled) skip('https staat uit: dat is een keuze, geen fout. Zet het aan bij Beveiliging om het te testen.');
      must(s.json.running, 'https is aangezet maar draait niet'); must(s.json.fingerprint, 'geen vingerafdruk');
      const ca = await get('/ca.crt'), mc = await get('/ca.mobileconfig');
      must(ca.status === 200 && /BEGIN CERTIFICATE/.test(ca.text), 'ca.crt: ' + ca.status); must(mc.status === 200 && /PayloadContent/.test(mc.text), 'ca.mobileconfig: ' + mc.status);
      if (!env.browser) return 'draait; vingerafdruk ' + s.json.fingerprint.slice(0, 11) + '… (of de browser het certificaat vertrouwt, test je in de browser)';
      try { await env.browser.reach(`https://${env.hostname}:${s.json.port}/healthz`); return 'bereikbaar en vertrouwd; vingerafdruk ' + s.json.fingerprint.slice(0, 11) + '…'; }
      catch { warn('https draait, maar deze browser vertrouwt het certificaat nog niet (installeer het certificaat). Vingerafdruk ' + s.json.fingerprint.slice(0, 11) + '…'); }
    });

    // two-step + temporary rights with a throw-away account (main account only)
    const userId = { id: '' };
    await t('two', G.two, 'Tweestapsverificatie van begin tot eind (met een tijdelijk testaccount)', async () => {
      if (!isRoot()) skip('log in als hoofdaccount (milo) voor deze test');
      const name = 'zztest' + rand(), pw = 'Zz-' + rand() + '-' + rand();
      const c = await post('/api/users/save', { username: name, name: 'Testaccount', role: 'kijker', password: pw }); must(c.status === 200 && c.json.user, 'testaccount maken: ' + c.text.slice(0, 120));
      userId.id = c.json.user.id;
      let l = await post('/api/login', { username: name, password: pw }, ''); must(l.json && l.json.token, 'inloggen testaccount: ' + l.status);
      const tk = l.json.token;
      const st = await post('/api/2fa/setup', {}, tk); must(st.status === 200 && st.json.secret && /^otpauth:/.test(st.json.uri), 'instellen: ' + st.status);
      const code = totp(st.json.secret);
      const en = await post('/api/2fa/enable', { code }, tk); must(en.status === 200 && en.json.recovery && en.json.recovery.length === 8, 'aanzetten: ' + en.text.slice(0, 120));
      l = await post('/api/login', { username: name, password: pw }, ''); must(l.json && l.json.needs2fa, 'na het aanzetten moet inloggen om een code vragen');
      const wrong = await post('/api/login/2fa', { mfa: l.json.mfa, code: '000000' }, ''); must(wrong.status === 401, 'een foute code hoort geweigerd te worden (' + wrong.status + ')');
      l = await post('/api/login', { username: name, password: pw }, '');
      const replay = await post('/api/login/2fa', { mfa: l.json.mfa, code }, ''); must(replay.status === 401, 'dezelfde code mag maar één keer werken (' + replay.status + ')');
      l = await post('/api/login', { username: name, password: pw }, '');
      const rec = await post('/api/login/2fa', { mfa: l.json.mfa, code: en.json.recovery[0] }, ''); must(rec.status === 200 && rec.json.token, 'een herstelcode hoort te werken (' + rec.status + ')');
      l = await post('/api/login', { username: name, password: pw }, '');
      const again = await post('/api/login/2fa', { mfa: l.json.mfa, code: en.json.recovery[0] }, ''); must(again.status === 401, 'een herstelcode mag maar één keer werken (' + again.status + ')');
      return 'aanzetten, foute code, dezelfde code twee keer, herstelcode: allemaal goed';
    });
    await t('two', G.two, 'Tijdelijke extra rechten', async () => {
      if (!userId.id) skip('hangt af van de test hierboven (hoofdaccount nodig)');
      const s = await post('/api/users/save', { id: userId.id, username: (await get('/api/admin-state')).json.users.find((u) => u.id === userId.id).username, name: 'Testaccount', role: 'kijker', perms: ['view'], grants: [{ perm: 'inbox', minutes: 5 }] }); must(s.status === 200, 'opslaan: ' + s.text.slice(0, 120));
      const u = (await get('/api/admin-state')).json.users.find((x) => x.id === userId.id); must(u && u.grants && u.grants.some((g) => g.perm === 'inbox' && g.until > Date.now()), 'het tijdelijke recht staat er niet bij');
      return 'recht “bezoekers” voor 5 minuten gegeven en teruggevonden';
    });
    if (userId.id) await t('two', G.two, 'Testaccount weer verwijderd', async () => { const r = await post('/api/users/remove', { id: userId.id }); must(r.status === 200, 'verwijderen: ' + r.status); must(!(await get('/api/admin-state')).json.users.some((u) => u.id === userId.id), 'het testaccount staat er nog'); });

    // settings
    let schema = null;
    await t('set', G.set, 'Beschrijving van alle instellingen', async () => {
      const r = await get('/api/settings-schema'); must(r.status === 200 && Array.isArray(r.json.groups), 'status ' + r.status);
      schema = r.json.groups; if (!schema.length) skip('dit account mag de instellingen niet zien');
      const ids = schema.map((g) => g.id); const miss = ['deur', 'hours', 'visitors', 'buttons', 'replies', 'mail', 'screen', 'colors'].filter((i) => !ids.includes(i)); must(!miss.length, 'mist: ' + miss.join(', '));
      return `${schema.length} groepen, ${schema.reduce((n, g) => n + g.fields.length, 0)} instellingen`;
    });
    const fld = (key) => (schema || []).flatMap((g) => g.fields).find((f) => f.key === key);
    const save = (values) => post('/api/settings-schema/save', { values });
    const settingsNow = async () => (await get('/api/admin-state')).json.settings;
    await t('set', G.set, 'Een instelling opslaan, teruglezen en terugzetten', async () => {
      if (!schema || !schema.length) skip('geen recht'); const old = fld('note').value;
      try { const s = await save({ note: 'Testbericht ' + rand() }); must(s.status === 200, 'opslaan: ' + s.text.slice(0, 120)); must((await settingsNow()).note.startsWith('Testbericht'), 'de waarde is niet bewaard'); }
      finally { await save({ note: old }); }
      must((await settingsNow()).note === old, 'terugzetten mislukt');
    });
    await t('set', G.set, 'Ongeldige waarden worden geweigerd', async () => {
      if (!schema || !schema.length) skip('geen recht');
      for (const bad of [{ 'hours.from': '25:99' }, { accent: 'rood' }, { 'bestaat.niet': 1 }]) { const r = await save(bad); must(r.status === 400, JSON.stringify(bad) + ' kreeg ' + r.status); }
    });
    await t('set', G.set, 'Openingstijden: pauze, vrije dag en andere tijden per dag', async () => {
      if (!schema || !schema.length) skip('geen recht'); const keep = { b: fld('hours.breaks').value, h: fld('hours.holidays').value, d: fld('hours.perDay.3').value };
      try {
        const s = await save({ 'hours.breaks': [{ from: '12:00', to: '12:30', label: 'Test' }], 'hours.holidays': [{ date: '2099-12-25', label: 'Test' }], 'hours.perDay.3': { from: '09:00', to: '12:00' } }); must(s.status === 200, 'opslaan: ' + s.text.slice(0, 120));
        const h = (await settingsNow()).hours; must(h.breaks[0] && h.breaks[0].label === 'Test', 'pauze niet bewaard'); must(h.holidays[0] && h.holidays[0].date === '2099-12-25', 'vrije dag niet bewaard'); must(h.perDay['3'] && h.perDay['3'].from === '09:00', 'tijden per dag niet bewaard');
      } finally { await save({ 'hours.breaks': keep.b, 'hours.holidays': keep.h, 'hours.perDay.3': keep.d }); }
      const h2 = (await settingsNow()).hours; must(JSON.stringify(h2.breaks) === JSON.stringify(keep.b) && JSON.stringify(h2.holidays) === JSON.stringify(keep.h), 'terugzetten mislukt');
    });
    await t('set', G.set, 'Het mailwachtwoord komt nooit leesbaar terug', async () => { if (!schema || !schema.length) skip('geen recht'); const v = fld('mail.pass'); must(v && (v.value === '' || /^•+$/.test(v.value)), 'het wachtwoord staat leesbaar in de beschrijving'); });

    // rules: buttons, auto replies, notifications (all muted while testing)
    await t('rules', G.rules, 'Eigen knop, slim antwoord en meldingsregel samen', async () => {
      if (!schema || !schema.length) skip('geen recht');
      const keep = { c: fld('customButtons').value, a: fld('autoReplies').value, n: fld('notifyRules').value };
      let reqId = '';
      try {
        const s = await save({ customButtons: [{ label: 'Testknop', ask: false, askLabel: '', reply: '' }], autoReplies: [{ status: 'any', type: 'reason', from: '', to: '', text: 'Testantwoord' }], notifyRules: [{ type: 'any', person: '', mute: true, ntfy: false, mail: false, webhook: false, quietFrom: '', quietTo: '' }] });
        must(s.status === 200, 'opslaan: ' + s.text.slice(0, 120));
        const pub = (await get('/api/state')).json; const btn = (pub.settings.customButtons || []).find((b) => b.label === 'Testknop'); must(btn, 'de knop staat niet in de publieke gegevens');
        await sleep(1300);
        const v = await post('/api/visit', { button: btn.id }, ''); must(v.status === 200, 'tikken op de knop: ' + v.text.slice(0, 120)); reqId = v.json.id;
        must(v.json.reply === 'Testantwoord', 'het slimme antwoord klopt niet: ' + JSON.stringify(v.json.reply));
        must((await get('/api/admin-state')).json.requests.some((r) => r.id === reqId && r.reason === 'Testknop'), 'het verzoek staat niet bij de bezoekers');
      } finally {
        if (reqId) await post('/api/requests/delete', { id: reqId });
        await save({ customButtons: keep.c, autoReplies: keep.a, notifyRules: keep.n });
      }
      const after = await settingsNow(); must(JSON.stringify(after.customButtons) === JSON.stringify(keep.c), 'knoppen niet teruggezet');
      return 'knop → bezoeker → antwoord; er is geen melding verstuurd en alles is opgeruimd';
    });
    await t('rules', G.rules, 'Scheldwoorden worden herkend', async () => {
      if (!schema || !schema.length) skip('geen recht'); const keep = { c: fld('customButtons').value, n: fld('notifyRules').value }; let reqId = '';
      try {
        await save({ customButtons: [{ label: 'Filtertest', ask: true, askLabel: 'tekst', reply: '' }], notifyRules: [{ type: 'any', person: '', mute: true, ntfy: false, mail: false, webhook: false, quietFrom: '', quietTo: '' }] });
        const btn = ((await get('/api/state')).json.settings.customButtons || []).find((b) => b.label === 'Filtertest'); must(btn, 'knop ontbreekt'); await sleep(1300);
        const v = await post('/api/visit', { button: btn.id, message: 'Wat een kanker test' }, '');
        if (v.status === 400) return 'het bericht wordt geweigerd (moderatie staat op “niet versturen”)';
        must(v.status === 200, 'status ' + v.status); reqId = v.json.id;
        const r = (await get('/api/admin-state')).json.requests.find((x) => x.id === reqId); must(r && /\*\*\*/.test(r.message) && !/kanker/i.test(r.message), 'het woord is niet verborgen: ' + (r && r.message));
        must(r.flagged && r.flagged.length, 'het bericht is niet gemarkeerd'); return 'verborgen en gemarkeerd';
      } finally { if (reqId) await post('/api/requests/delete', { id: reqId }); await save({ customButtons: keep.c, notifyRules: keep.n }); }
    });

    // the real save buttons in the panel, pressed the way a person presses them (the panel opens invisibly inside this page)
    const P = env.browser && env.browser.panel;
    const openPanel = () => { if (!P) skip('alleen in de browser'); return P.open(TOKEN); };
    const closePanel = () => { if (P) P.close(); };
    const goTab = (d, label) => P.goTab(d, label, must, sleep);
    const cardNamed = (d, title) => P.cardNamed(d, title);
    const type = (input, value) => P.type(input, value);
    const textInput = (card) => P.textInput(card);
    const uiNeed = () => { if (!P) skip('alleen in de browser (de knoppen moeten echt worden ingedrukt)'); if (!schema || !schema.length) skip('geen recht voor de instellingen'); };
    const G2 = 'Opslaanknoppen in het paneel (de echte knoppen)';
    await t('save', G2, 'Instellingen → grote knop “Instellingen opslaan”', async () => {
      uiNeed(); const old = fld('name').value, want = 'Opslaantest ' + rand();
      try {
        const d = await openPanel(); await goTab(d, 'Instellingen');
        const card = cardNamed(d, 'Deur'); must(card, 'de kaart “Deur” staat er niet'); type(textInput(card), want); await sleep(300);
        const btn = d.querySelector('#view .save button.white'); must(btn, 'de knop onderaan staat er niet'); btn.click(); await sleep(2200);
        const now = (await settingsNow()).name; must(now === want, `de naam is niet bewaard (staat nu op “${now}”)`);
      } finally { await save({ name: old }); }
      return 'bewaard en weer teruggezet';
    });
    await t('save', G2, 'Instellingen → de balk “Alles opslaan”', async () => {
      uiNeed(); const old = fld('name').value, want = 'Balktest ' + rand();
      try {
        const d = await openPanel(); await goTab(d, 'Instellingen');
        const card = cardNamed(d, 'Deur'); type(textInput(card), want); await sleep(400);
        const bar = d.getElementById('saveBar'); must(!bar.classList.contains('hidden'), 'de balk met “Alles opslaan” verscheen niet na een wijziging');
        d.getElementById('saveAll').click(); await sleep(2500);
        const now = (await settingsNow()).name; must(now === want, `de naam is niet bewaard via de balk (staat nu op “${now}”)`);
        must(d.getElementById('saveBar').classList.contains('hidden'), 'de balk bleef staan na het opslaan');
      } finally { await save({ name: old }); }
      return 'bewaard, balk verdween weer';
    });
    await t('save', G2, 'Instellingen → kaart “Bezoekersformulier” (eigen knop)', async () => {
      uiNeed(); const old = fld('form.thanksText') ? fld('form.thanksText').value : ((await get('/api/form-schema')).json.groups.flatMap((g) => g.fields).find((f) => f.key === 'form.thanksText') || {}).value || '';
      const want = 'Dank test ' + rand();
      try {
        const d = await openPanel(); await goTab(d, 'Instellingen');
        const card = cardNamed(d, 'Bezoekersformulier'); must(card, 'de kaart staat er niet');
        const texts = [...card.querySelectorAll('input')].filter((i) => (!i.type || i.type === 'text')); type(texts[texts.length - 1], want); await sleep(300);
        const btn = [...card.querySelectorAll('button')].find((b) => /opslaan/i.test(b.textContent)); must(btn, 'de knop staat er niet'); btn.click(); await sleep(2200);
        const now = ((await get('/api/form-schema')).json.groups.flatMap((g) => g.fields).find((f) => f.key === 'form.thanksText') || {}).value; must(now === want, `niet bewaard (staat nu op “${now}”)`);
      } finally { await post('/api/form-settings', { values: { 'form.thanksText': old } }); }
      return 'bewaard en weer teruggezet';
    });
    await t('save', G2, 'Systeem → kaart “Toegang” (eigen knop)', async () => {
      if (!P) skip('alleen in de browser'); if (!isRoot()) skip('alleen het hoofdaccount (milo)');
      const before = (await get('/api/system')).json.system, want = before.sessionDays === 30 ? 31 : 30;
      try {
        const d = await openPanel(); await goTab(d, 'Systeem');
        const card = cardNamed(d, 'Toegang'); must(card, 'de kaart staat er niet'); const n = [...card.querySelectorAll('input[type=number]')][0]; must(n, 'het getal staat er niet'); type(n, String(want)); await sleep(300);
        const btn = [...card.querySelectorAll('h2 button')].find((b) => /opslaan/i.test(b.textContent)); must(btn, 'de knop staat er niet'); btn.click(); await sleep(2200);
        const now = (await get('/api/system')).json.system.sessionDays; must(now === want, `niet bewaard (staat nu op ${now})`);
      } finally { await save({ 'system.sessionDays': before.sessionDays }); }
      return 'bewaard en weer teruggezet';
    });
    await t('save', G2, 'Alle instellingen → grote knop en balk', async () => {
      uiNeed(); const old = fld('note').value;
      try {
        const d = await openPanel(); await goTab(d, 'Alle instellingen');
        const label = d.querySelector('[data-key="note"]'); must(label, 'het veld “Bericht op de deur” staat er niet'); const input = label.nextElementSibling.querySelector('input');
        const w1 = 'Knoptest ' + rand(); type(input, w1); await sleep(300);
        const btn = d.querySelector('#view .save button.white'); must(btn, 'de knop onderaan staat er niet'); btn.click(); await sleep(2500);
        must((await settingsNow()).note === w1, 'niet bewaard met de knop onderaan');
        await sleep(500); const label2 = d.querySelector('[data-key="note"]'); const input2 = label2.nextElementSibling.querySelector('input');
        const w2 = 'Balktest ' + rand(); type(input2, w2); await sleep(400);
        must(!d.getElementById('saveBar').classList.contains('hidden'), 'de balk verscheen niet'); d.getElementById('saveAll').click(); await sleep(2500);
        must((await settingsNow()).note === w2, 'niet bewaard met de balk');
      } finally { await save({ note: old }); closePanel(); }
      return 'beide manieren bewaren, daarna teruggezet';
    });
    await t('save', G2, 'Energie: maandag kopiëren naar dinsdag t/m vrijdag en opslaan met de balk (de tijd om de computer uit te zetten)', async () => {
      uiNeed(); if (!can('power')) skip('geen recht voor energie');
      const before = (await get('/api/admin-state')).json.power; if (!before) skip('energiebeheer is hier niet beschikbaar');
      try {
        const d = await openPanel(); await goTab(d, 'Instellingen');
        const card = cardNamed(d, 'Energie'); must(card, 'de kaart Energie staat er niet');
        const monday = card.querySelectorAll('table.week tbody tr')[0], off = monday.querySelectorAll('input[type=time]')[2]; must(off, 'het veld “Computer uit” voor maandag staat er niet');
        type(off, '17:41'); await sleep(300);
        const copy = [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Maandag kopiëren')); must(copy, 'de knop om maandag te kopiëren staat er niet'); copy.click(); await sleep(1000);
        must(!d.getElementById('saveBar').classList.contains('hidden'), 'na het kopiëren verscheen de balk “Alles opslaan” niet (de wijziging kan zo verloren gaan)');
        d.getElementById('saveAll').click(); await sleep(3200);
        const now = (await get('/api/admin-state')).json.power;
        for (const k of ['1', '2', '3', '4', '5']) must(now.days[k].off === '17:41', `dag ${k} staat op “${now.days[k].off}” in plaats van 17:41 (niet bewaard)`);
      } finally { await post('/api/power/settings', { enabled: before.enabled, how: before.how, warnMinutes: before.warnMinutes, skipIfBusy: before.skipIfBusy, pauseUntil: before.pauseUntil, watts: before.watts, days: before.days, wol: before.wol }); }
      return 'maandag t/m vrijdag bewaard en weer teruggezet';
    });
    await t('save', G2, 'Back-up terugzetten met het echte bestandsveld (en het scherm laat daarna de teruggezette waarden zien)', async () => {
      uiNeed(); if (!can('export')) skip('geen recht voor back-ups');
      if (isRoot()) await post('/api/system/backups/create', {}); // a safety copy first
      const file = (await get('/api/export')).text, saved = JSON.parse(file).settings.name, old = fld('name').value;
      try {
        await save({ name: 'Tijdelijk ' + rand() });
        const d = await openPanel(); d.defaultView.confirm = () => true; await goTab(d, 'Instellingen'); await sleep(500);
        const input = [...d.querySelectorAll('input[type=file]')].find((i) => (i.accept || '').includes('json')); must(input, 'het veld om een back-up te kiezen staat er niet');
        const pick = async () => { const dt = new d.defaultView.DataTransfer(); dt.items.add(new d.defaultView.File([file], 'back-up.json', { type: 'application/json' })); input.files = dt.files; input.dispatchEvent(new d.defaultView.Event('change', { bubbles: true })); await sleep(3000); };
        await pick();
        must((await settingsNow()).name === saved, 'de back-up is niet teruggezet (naam staat op “' + (await settingsNow()).name + '”)');
        const shown = cardNamed(d, 'Deur'); must(shown && textInput(shown).value === saved, 'het scherm liet na het terugzetten nog de oude waarden zien');
        await save({ name: 'Tijdelijk ' + rand() }); await sleep(500); await pick(); // the same file a second time
        must((await settingsNow()).name === saved, 'dezelfde back-up opnieuw kiezen werkt niet');
      } finally { await save({ name: old }); }
      return 'terugzetten, scherm ververst, dezelfde back-up nog een keer';
    });
    closePanel();

    // calendar, mail
    await t('ext', G.ext, 'Agendalink (ICS)', async () => {
      if (!can('settings')) skip('geen recht'); const was = (await get('/api/calendar')).json; must(was && 'enabled' in was, 'status onbekend');
      let path = was.path;
      try { if (!was.enabled) path = (await post('/api/calendar/token')).json.path; must(path, 'geen link gemaakt'); const ics = await get(path, ''); must(ics.status === 200 && /BEGIN:VCALENDAR/.test(ics.text), 'het agendabestand klopt niet (' + ics.status + ')'); must((await get('/calendar.ics?token=fout', '')).status === 404, 'een foute link hoort 404 te geven'); }
      finally { if (!was.enabled) await post('/api/calendar/token', { off: true }); }
      return was.enabled ? 'je bestaande link werkt' : 'link gemaakt, getest en weer uitgezet';
    });
    await t('ext', G.ext, 'Testmail versturen (weekoverzicht)', async () => {
      if (!env.mailtest) skip('niet aangevinkt'); if (!can('mail')) skip('geen recht');
      const r = await post('/api/mail/weekly-test'); must(r.status === 200, (r.json && r.json.error) || 'status ' + r.status); return 'verstuurd: kijk in je inbox';
    });

    // system
    await t('sys', G.sys, 'Back-up maken en terugvinden', async () => {
      if (!isRoot()) skip('alleen het hoofdaccount (milo)'); const c = await post('/api/system/backups/create'); must(c.status === 200 && c.json.name, 'maken: ' + c.status);
      const l = (await get('/api/system')).json; must(l.backups.some((b) => b.name === c.json.name), 'de back-up staat niet in de lijst'); return c.json.name;
    });
    await t('sys', G.sys, 'Gegevens overzetten: bestand maken', async () => {
      if (!isRoot()) skip('alleen het hoofdaccount (milo)'); const r = await get('/api/transfer/export'); must(r.status === 200, 'status ' + r.status);
      const d = JSON.parse(r.text); must(d.version === 2 && d.transfer === true, 'verkeerd bestand'); must(d.sessions === undefined && d.rootLock === undefined, 'er staan sessies of een slotcode in het bestand'); must(Array.isArray(d.users), 'accounts ontbreken'); return `${Math.round(r.text.length / 1024)} kB, ${d.users.length} account(s)`;
    });
    await t('sys', G.sys, 'Gegevens overzetten: foute invoer wordt veilig geweigerd', async () => {
      if (!isRoot()) skip('alleen het hoofdaccount (milo)'); const a = await post('/api/transfer/pull', { url: '' }); must(a.status === 400, 'leeg adres: ' + a.status);
      const b = await post('/api/transfer/import', { hallo: 1 }); must(b.status === 400, 'ander soort bestand: ' + b.status);
      must((await get('/api/state')).status === 200, 'de server doet het niet meer');
    });
    await t('sys', G.sys, 'Gewone back-up (oude vorm) wordt geleverd', async () => { if (!can('export')) skip('geen recht'); const r = await get('/api/export'); must(r.status === 200 && JSON.parse(r.text).version === 2, 'status ' + r.status); });

    // new panel
    await t('ui', G.ui, 'Pagina “Alle instellingen”, zoeker en menu zitten in het paneel', async () => {
      const html = (await get('/admin')).text; const miss = ['Alle instellingen', 'openFinder', 'settings-schema', "'switch'"].filter((x) => !html.includes(x)); must(!miss.length, 'mist in de pagina: ' + miss.join(', ') + ' (is de server beta.8 of nieuwer?)');
      must(html.includes('min-width: 1000px'), 'het zijmenu ontbreekt');
    });
    await t('ui', G.ui, 'Hulppagina bevat de nieuwe uitleg', async () => { const h = (await get('/help')).text; must(/Snel iets vinden/.test(h) && /Beveiliging instellen/.test(h), 'uitleg ontbreekt'); });
    return summary();
    }

    function summary() {
      const n = (s) => results.filter((r) => r.state === s).length, bad = results.filter((r) => r.state === 'bad');
      const lines = results.filter((r) => r.state === 'bad' || r.state === 'warn').map((r) => `- [${r.state === 'bad' ? 'MISLUKT' : 'LET OP'}] ${r.groupTitle} → ${r.name}: ${r.detail}`);
      const text = [
        `Ik heb de testpagina (${env.origin}/check) van Saga Techbox gedraaid.`,
        `Serverversie: ${VERSION || 'onbekend'}${STATE && STATE.build ? ' (bouwnummer ' + STATE.build + ')' : ''}`,
        `Ingelogd als: ${ME ? ME.name + (isRoot() ? ' (hoofdaccount)' : '') : 'niet ingelogd'}. Browser: ${env.userAgent}`, '',
        bad.length ? 'Deze onderdelen werken niet goed:' : 'Alles werkt, maar hier moet je naar kijken:', ...lines, '',
        'Zoek uit waarom dit niet werkt, los het op, test het en breng een nieuwe developer beta uit (pre-release, geen gewone versie). Zeg daarna kort wat je gedaan hebt en wat ik zelf moet proberen.',
      ].join('\n');
      return { ok: n('ok'), bad: bad.length, warn: n('warn'), skip: n('skip'), text, results };
    }
    return { run: runAll, results };
  }
  const api = { createRunner, totp, sha1, hmacSha1, b32 };
  if (typeof module !== 'undefined') module.exports = api; else window.SagaCheckCore = api;
})();
