'use strict';
// Every setting of the door server, described as data: groups of fields with a type, a label and the current value.
// The apps draw their settings screens from this, so they show exactly what the web panel shows and a new option needs no new app.
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const DAYS = [[1, 'maandag'], [2, 'dinsdag'], [3, 'woensdag'], [4, 'donderdag'], [5, 'vrijdag'], [6, 'zaterdag'], [0, 'zondag']];
const TYPES = [['any', 'Alles'], ['bell', 'Aanbellen'], ['reason', 'Een reden'], ['message', 'Een vraagje'], ['appointment', 'Een afspraak'], ['callback', 'Terugbellen']];
const o = (list) => list.map(([v, l]) => [String(v), l]);

function build(ctx) {
  const { settings: s, system: sys, can, UI_TEXTS, BELL_TONES, REPLY_TONES, PASS_MASK } = ctx;
  const groups = [];
  const add = (id, title, perm, help, fields) => { if (can(perm)) groups.push({ id, title, help: help || '', fields: fields.map((f) => ({ ...f, perm })) }); };
  const F = (key, label, type, extra = {}) => ({ key, label, type, ...extra, value: extra.value !== undefined ? extra.value : getPath(s, key) });
  const T = (key, label, max = 120, extra = {}) => F(key, label, 'text', { max, ...extra });
  const B = (key, label) => F(key, label, 'toggle', { value: !!getPath(s, key) });
  const N = (key, label, min, max, extra = {}) => F(key, label, 'number', { min, max, ...extra });
  const C = (key, label, options, extra = {}) => F(key, label, 'choice', { options: o(options), value: String(getPath(s, key)), ...extra });
  const TM = (key, label) => F(key, label, 'time', { required: true });

  add('deur', 'Deur', 'settings', 'De naam en de teksten die bij elke status op het deurscherm staan.', [
    T('name', 'Naam', 60), T('subtitle', 'Ondertitel', 80),
    ...['open', 'closed', 'busy'].flatMap((m) => [T(`texts.${m}.label`, `Tekst bij ${{ open: 'Open', closed: 'Gesloten', busy: 'Bezet' }[m]}`, 24), T(`texts.${m}.message`, `Bericht bij ${{ open: 'Open', closed: 'Gesloten', busy: 'Bezet' }[m]}`, 120)]),
    T('note', 'Bericht op de deur', 140),
  ]);
  const hours = s.hours || {};
  add('hours', 'Openingstijden', 'settings', 'Als dit aan staat, opent en sluit de deur vanzelf. De status met de hand wijzigen kan altijd.', [
    B('hours.enabled', 'Vanzelf openen en sluiten'),
    F('hours.days', 'Dagen', 'multi', { options: o(DAYS), value: (hours.days || []).map(String) }),
    TM('hours.from', 'Open vanaf'), TM('hours.to', 'Open tot'),
    ...DAYS.map(([d, l]) => F(`hours.perDay.${d}`, `Andere tijden op ${l}`, 'dayhours', { value: (hours.perDay || {})[d] || null })),
    F('hours.breaks', 'Pauzes (elke dag)', 'records', { columns: [{ key: 'from', label: 'Van', type: 'time' }, { key: 'to', label: 'Tot', type: 'time' }, { key: 'label', label: 'Naam', type: 'text', max: 40 }], value: hours.breaks || [], blank: { from: '12:00', to: '13:00', label: '' }, addLabel: 'Pauze toevoegen' }),
    F('hours.holidays', 'Vrije dagen en vakanties', 'records', { columns: [{ key: 'date', label: 'Datum', type: 'date' }, { key: 'label', label: 'Naam', type: 'text', max: 60 }], value: hours.holidays || [], blank: { date: '', label: '' }, addLabel: 'Vrije dag toevoegen' }),
  ]);
  add('weergave', 'Weergave van het deurscherm', 'settings', 'Hoe het deurscherm eruitziet en zich gedraagt. De standaardwaarden geven het gewone scherm.', [
    C('look.mode', 'Weergavemodus', [['standard', 'Standaard'], ['status', 'Alleen de status (groot)'], ['clock', 'Grote klok met status'], ['agenda', 'Status met planning'], ['strip', 'Smalle balk (breed, laag scherm)'], ['minimal', 'Alleen kleur en woord']]),
    C('look.font', 'Lettertype', [['system', 'Systeem'], ['rounded', 'Afgerond'], ['serif', 'Met schreef'], ['mono', 'Vaste breedte'], ['readable', 'Goed leesbaar']]),
    N('look.textScale', 'Tekstgrootte (%)', 70, 160), C('look.weight', 'Letterdikte', [['light', 'Dun'], ['normal', 'Normaal'], ['bold', 'Vet']]),
    C('look.clock', 'Klok', [['digital', 'Digitaal'], ['analog', 'Wijzerplaat'], ['none', 'Geen klok']]), B('look.seconds', 'Seconden tonen'), C('look.date', 'Datum', [['none', 'Geen'], ['short', 'Kort'], ['long', 'Lang']]),
    C('look.transition', 'Animatie bij een nieuwe status', [['none', 'Geen'], ['fade', 'Vervagen'], ['slide', 'Schuiven'], ['zoom', 'Inzoomen']]),
    C('look.cards', 'Stijl van knoppen', [['soft', 'Zacht'], ['flat', 'Plat'], ['outline', 'Omlijnd'], ['glass', 'Glas']]), C('look.corners', 'Hoeken', [['sharp', 'Scherp'], ['soft', 'Een beetje rond'], ['round', 'Rond']]),
    C('look.background', 'Achtergrond', [['glow', 'Gloed (standaard)'], ['plain', 'Effen'], ['gradient', 'Kleurverloop'], ['dots', 'Stippen'], ['aurora', 'Langzaam bewegend']]),
    C('look.border', 'Gekleurde rand', [['off', 'Geen'], ['thin', 'Dun'], ['thick', 'Dik'], ['pulse', 'Kloppend']]), B('look.countdown', 'Voortgangsbalk tot de status verandert'),
    C('look.icons', 'Symbolen op knoppen', [['symbols', 'Tonen'], ['none', 'Niet tonen']]), N('look.agenda', 'Aantal geplande momenten tonen', 0, 5),
    B('look.ticker.enabled', 'Lopende tekst onderaan'), T('look.ticker.text', 'Tekst van de lopende regel', 200), T('look.footer', 'Vaste regel onderaan', 120),
    B('look.idle.enabled', 'Schermbeveiliging als niemand het scherm aanraakt'), N('look.idle.minutes', 'Schermbeveiliging na (minuten)', 1, 240),
    B('look.shift', 'Beeld af en toe een paar pixels verschuiven (tegen inbranden)'), B('look.contrast', 'Hoog contrast'), B('look.motion', 'Bewegingen en animaties'),
    C('look.buttons.place', 'Plaats van de eigen knoppen', [['below', 'Onder, bij de gewone knoppen'], ['top', 'Boven in beeld'], ['side', 'Zijkant (rechts)'], ['floating', 'Zwevend rechtsonder'], ['hidden', 'Niet tonen']]),
    C('look.buttons.size', 'Grootte van de knoppen', [['small', 'Klein'], ['normal', 'Normaal'], ['large', 'Groot']]), N('look.buttons.columns', 'Kolommen met knoppen (0 = vanzelf)', 0, 4),
    B('look.slides.enabled', 'Wisselende berichten'), N('look.slides.seconds', 'Seconden per bericht', 3, 120), F('look.slides.items', 'Berichten (één per regel)', 'lines', { max: 140, value: ((s.look || {}).slides || {}).items || [] }),
    B('look.event.enabled', 'Aftellen naar een gebeurtenis'), T('look.event.label', 'Naam van de gebeurtenis', 60), F('look.event.date', 'Datum van de gebeurtenis', 'date'),
    B('look.greeting', 'Groet (goedemorgen …)'), B('look.waiting', 'Toon hoeveel bezoekers er wachten'), C('look.sentClose', 'Na het aanbellen of versturen', [['button', 'Met een knop Sluiten'], ['auto', 'Zonder knop: sluit vanzelf']]), N('look.sentSeconds', 'Sluit vanzelf na (seconden)', 3, 120), B('look.updated', 'Toon wanneer het scherm voor het laatst bijgewerkt is'), C('look.bellFlash', 'Bij aanbellen', [['none', 'Geen flits'], ['flash', 'Scherm flitst'], ['pulse', 'Rand knippert']]),
    B('look.awake', 'Scherm aan houden'), B('look.speak', 'Status hardop zeggen bij een wijziging'), T('look.reloadAt', 'Elke dag verversen om (UU:MM, leeg = nooit)', 5),
    C('look.dot', 'Statuspunt', [['dot', 'Punt'], ['bar', 'Balk'], ['none', 'Geen']]), C('look.align', 'Uitlijning', [['left', 'Links'], ['center', 'Midden'], ['right', 'Rechts']]),
    B('look.glow', 'Gloed rond het statuspunt'), N('look.margin', 'Marge rond het beeld (%)', 0, 12), B('look.mirror', 'Spiegelen'),
  ]);
  add('visitors', 'Bezoekers', 'settings', 'Wat bezoekers op het deurscherm kunnen doen.', [
    B('visitors.doorbell', 'Deurbel'), B('visitors.bellWhenBlocked', 'Ook laten bellen bij Gesloten of Bezet'), B('visitors.reasons', 'Redenen'), B('visitors.appointments', 'Tijd booken'), B('visitors.messages', 'Vraagje'), B('visitors.callback', 'Terugbellen'), B('visitors.accounts', 'Account maken (met een pincode die vanzelf wordt gemaakt)'), C('visitors.pinLength', 'Lengte van de pincode', [[4, '4 cijfers'], [6, '6 cijfers'], [8, '8 cijfers']], { numeric: true }),
    F('reasons', 'Redenen (één per regel)', 'lines', { max: 80 }), F('topics', 'Vraag-onderwerpen (één per regel)', 'lines', { max: 60 }), F('quickReplies', 'Snelle antwoorden (één per regel)', 'lines', { max: 200 }),
    N('slotMinutes', 'Lengte van een afspraak (minuten)', 10, 240),
  ]);
  add('buttons', 'Eigen knoppen', 'settings', 'Extra knoppen op het deurscherm: één tik, eventueel met een korte tekst en een eigen antwoord.', [
    F('customButtons', 'Knoppen', 'records', { columns: [
      { key: 'icon', label: 'Symbool (emoji)', type: 'text', max: 4 }, { key: 'label', label: 'Naam van de knop', type: 'text', max: 40 },
      { key: 'kind', label: 'Soort', type: 'choice', options: o([['form', 'Vraag aan mij (formulier)'], ['info', 'Informatie'], ['link', 'Webadres (QR)'], ['phone', 'Telefoonnummer (QR)'], ['wifi', 'Wifi (QR)']]) },
      { key: 'when', label: 'Wanneer te zien', type: 'choice', options: o([['always', 'Altijd'], ['open', 'Alleen bij Open'], ['closed', 'Alleen bij Gesloten'], ['busy', 'Alleen bij Bezet']]) }, { key: 'color', label: 'Kleur', type: 'color' },
      { key: 'ask', label: 'Vraag om tekst', type: 'toggle' }, { key: 'askLabel', label: 'Wat vraag je?', type: 'text', max: 60 }, { key: 'reply', label: 'Antwoord op de deur', type: 'text', max: 140 },
      { key: 'text', label: 'Tekst of uitleg', type: 'text', max: 600 }, { key: 'url', label: 'Webadres', type: 'text', max: 300 }, { key: 'phone', label: 'Telefoonnummer', type: 'text', max: 30 },
      { key: 'ssid', label: 'Wifi-naam', type: 'text', max: 60 }, { key: 'wifiPass', label: 'Wifi-wachtwoord', type: 'text', max: 80 }, { key: 'wifiType', label: 'Wifi-beveiliging', type: 'choice', options: o([['WPA', 'Met wachtwoord'], ['nopass', 'Zonder wachtwoord']]) },
    ], value: s.customButtons || [], blank: { icon: '', label: '', kind: 'form', when: 'always', color: '', ask: false, askLabel: '', reply: '', text: '', url: '', phone: '', ssid: '', wifiPass: '', wifiType: 'WPA' }, addLabel: 'Knop toevoegen' }),
    F('noteSchedule', 'Bericht op de deur per datum', 'records', { columns: [{ key: 'from', label: 'Van', type: 'date' }, { key: 'to', label: 'Tot en met', type: 'date' }, { key: 'text', label: 'Bericht', type: 'text', max: 140 }], value: s.noteSchedule || [], blank: { from: '', to: '', text: '' }, addLabel: 'Bericht toevoegen' }),
  ]);
  add('replies', 'Automatisch antwoorden', 'settings', 'Een antwoord dat meteen op de deur verschijnt bij de bezoeker.', [
    N('autoReplyMinutes', 'Antwoord als je niet reageert, na (minuten, 0 = uit)', 0, 120), T('autoReplyText', 'Tekst van dat antwoord', 140), T('closedReply', 'Antwoord als je gesloten bent', 140),
    F('autoReplies', 'Slimme antwoorden (de eerste die past, geldt)', 'records', { columns: [{ key: 'status', label: 'Status', type: 'choice', options: o([['any', 'Elke status'], ['open', 'Open'], ['closed', 'Gesloten'], ['busy', 'Bezet']]) }, { key: 'type', label: 'Soort', type: 'choice', options: o(TYPES) }, { key: 'from', label: 'Van', type: 'time' }, { key: 'to', label: 'Tot', type: 'time' }, { key: 'text', label: 'Antwoord', type: 'text', max: 140 }], value: s.autoReplies || [], blank: { status: 'closed', type: 'any', from: '', to: '', text: '' }, addLabel: 'Antwoord toevoegen' }),
  ]);
  add('away', 'Afwezig', 'settings', 'Zet de deur tot een datum op Gesloten, met je eigen bericht.', [B('away.enabled', 'Ik ben afwezig'), F('away.until', 'Tot en met', 'date'), T('away.message', 'Bericht', 140)]);
  add('startup', 'Opstarten', 'settings', 'Wat de deur laat zien als de server opnieuw start.', [C('startup.status', 'Status bij opstarten', [['hours', 'Volg de openingstijden'], ['open', 'Open'], ['closed', 'Gesloten'], ['busy', 'Bezet']]), T('startup.message', 'Bericht', 140)]);
  add('moderation', 'Moderatie', 'settings', 'Houd het netjes: ongepaste woorden filteren en nieuwe profielen eerst goedkeuren.', [
    B('moderation.filter', 'Ongepaste woorden herkennen'), B('moderation.defaultList', 'De ingebouwde lijst gebruiken'), T('moderation.words', 'Eigen woorden (gescheiden door komma’s)', 3000),
    C('moderation.action', 'Wat gebeurt er?', [['mask', 'Het woord verbergen en het bericht markeren'], ['flag', 'Alleen het bericht markeren'], ['block', 'Het bericht niet versturen']]),
    N('moderation.maxPerHour', 'Berichten per uur per telefoon', 1, 500), B('moderation.profileApproval', 'Nieuwe profielen eerst goedkeuren'),
  ]);
  add('notify', 'Meldingen', 'mail', 'Meldingen op je telefoon (ntfy) of via een webhook.', [T('ntfyServer', 'ntfy-server', 120), T('ntfyTopic', 'ntfy-onderwerp (een geheime naam)', 80), T('webhookUrl', 'Webhook (Slack, Discord, Home Assistant)', 300),
    B('quiet.enabled', 'Rustige uren: geen meldingen naar telefoon of mail'), TM('quiet.from', 'Rustig vanaf'), TM('quiet.to', 'Rustig tot')]);
  add('share', 'Delen', 'settings', 'De status laten zien op een website.', [B('publicStatus.enabled', 'Status openbaar tonen (/status.json, /badge.svg en /widget)')]);
  add('notifyRules', 'Meldingen per soort en persoon', 'settings', 'De eerste regel die past, geldt. Zonder regels krijg je van alles een melding.', [
    F('notifyRules', 'Regels', 'records', { columns: [{ key: 'type', label: 'Soort', type: 'choice', options: o(TYPES) }, { key: 'person', label: 'Naam of nummer (leeg = iedereen)', type: 'text', max: 60 }, { key: 'mute', label: 'Geen melding', type: 'toggle' }, { key: 'ntfy', label: 'Telefoon', type: 'toggle' }, { key: 'mail', label: 'Mail', type: 'toggle' }, { key: 'webhook', label: 'Webhook', type: 'toggle' }, { key: 'quietFrom', label: 'Niet van', type: 'time' }, { key: 'quietTo', label: 'Tot', type: 'time' }], value: s.notifyRules || [], blank: { type: 'bell', person: '', mute: false, ntfy: true, mail: true, webhook: true, quietFrom: '', quietTo: '' }, addLabel: 'Regel toevoegen' }),
  ]);
  const m = s.mail || {};
  add('mail', 'E-mail', 'mail', 'Bevestiging en antwoord naar bezoekers, en een mail naar jou per verzoek.', [
    B('mail.enabled', 'E-mail gebruiken'), T('mail.host', 'Mailserver (bijv. smtp.gmail.com)', 120), N('mail.port', 'Poort', 1, 65535), T('mail.user', 'Gebruikersnaam', 120), F('mail.pass', 'Wachtwoord (app-wachtwoord)', 'password', { value: m.pass ? PASS_MASK : '' }),
    T('mail.from', 'Afzender', 120), T('mail.adminTo', 'Mail aan mij naar', 120), B('mail.confirm', 'Bezoekers een bevestiging sturen'), B('mail.reply', 'Antwoorden ook mailen'), B('mail.notifyAdmin', 'Mij mailen bij elk verzoek'),
    B('mail.digest', 'Elke dag een samenvatting'), TM('mail.digestAt', 'Samenvatting om'), B('mail.weekly', 'Elke week een overzicht'), C('mail.weeklyDay', 'Overzicht op', DAYS),
  ]);
  add('screen', 'Scherm', 'settings', 'Hoe het deurscherm eruitziet.', [
    C('language', 'Taal van het deurscherm en de bezoekerspagina', [['nl', 'Nederlands'], ['en', 'English']]), C('theme', 'Thema', [['dark', 'Donker'], ['light', 'Licht']]), C('layout.orientation', 'Indeling', [['auto', 'Automatisch'], ['portrait', 'Verticaal'], ['landscape', 'Horizontaal']]),
    C('layout.rotate', 'Draaien', [[0, 'Niet'], [90, '90° met de klok mee'], [180, '180°'], [270, '90° tegen de klok in']], { numeric: true }), B('layout.hour12', 'Tijd met AM/PM'), B('layout.keyboard', 'Aanraaktoetsenbord'),
    B('dim.enabled', 'In de nacht dimmen'), TM('dim.from', 'Dimmen vanaf'), TM('dim.to', 'Dimmen tot'), C('dim.level', 'Helderheid in de nacht', [[0.1, '10%'], [0.2, '20%'], [0.3, '30%'], [0.5, '50%'], [0.7, '70%']], { numeric: true }),
    B('themeSchedule.enabled', 'Licht overdag, donker ’s nachts'), TM('themeSchedule.lightFrom', 'Licht vanaf'), TM('themeSchedule.darkFrom', 'Donker vanaf'),
    B('qr.enabled', 'QR-code voor de bezoekerspagina'), T('qr.url', 'Adres in de QR-code (leeg = automatisch)', 300), B('downloads.enabled', 'Downloadpagina voor de apps'), B('weather.enabled', 'Weer tonen'), T('weather.city', 'Plaats voor het weer', 80),
  ]);
  add('sound', 'Geluid', 'settings', 'De tonen van de deurbel en van een antwoord.', [
    C('sound.bell', 'Geluid van de bel', BELL_TONES.map((t) => [t, { classic: 'Klassiek', soft: 'Zacht', double: 'Dubbel', chime: 'Klokje', digital: 'Digitaal', custom: 'Eigen geluid' }[t] || t]).filter(([t]) => t !== 'custom' || (s.sound && s.sound.custom))),
    C('sound.reply', 'Geluid van een antwoord', REPLY_TONES.map((t) => [t, { soft: 'Zacht', classic: 'Klassiek', chime: 'Klokje', none: 'Geen' }[t] || t])),
  ]);
  const col = (key, label) => F(key, label, 'color');
  add('colors', 'Kleuren', 'settings', 'Leeg laten betekent de standaardkleur.', [col('accent', 'Accentkleur (paneel en apps)'), ...['open', 'closed', 'busy'].map((k) => col(`colors.${k}`, `Kleur ${{ open: 'Open', closed: 'Gesloten', busy: 'Bezet' }[k]}`)), ...['open', 'closed', 'busy'].map((k) => col(`colorsLight.${k}`, `Kleur ${{ open: 'Open', closed: 'Gesloten', busy: 'Bezet' }[k]} (licht thema)`))]);
  add('watch', 'Waarschuwingen', 'settings', 'Een melding als er iets stukgaat.', [N('watch.screenMinutes', 'Deurscherm weg, na (minuten, 0 = uit)', 0, 1440)]);
  const byGroup = {};
  for (const [k, [g, label, dflt]] of Object.entries(UI_TEXTS)) (byGroup[g] = byGroup[g] || []).push(F(`ui.${k}`, label, 'text', { max: 120, placeholder: dflt, value: (s.ui || {})[k] || '' }));
  for (const [g, fields] of Object.entries(byGroup)) add(`ui-${g}`, `Teksten: ${g}`, 'settings', 'Leeg laten betekent de standaardtekst.', fields);

  // system settings: only the main account
  const S = (key, label, type, extra = {}) => ({ key: `system.${key}`, label, type, ...extra, value: extra.value !== undefined ? extra.value : getPath(sys, key) });
  add('system', 'Systeem', 'system', 'Alleen het hoofdaccount ziet dit.', [
    S('maintenance', 'Onderhoudsmodus (alleen het hoofdaccount kan inloggen)', 'toggle', { value: !!sys.maintenance }), S('maintenanceMessage', 'Bericht bij onderhoud', 'text', { max: 200 }),
    S('require2fa', 'Tweestapsverificatie verplicht voor', 'choice', { options: o([['off', 'niemand'], ['root', 'het hoofdaccount'], ['privileged', 'iedereen met veel rechten']]), value: String(sys.require2fa) }),
    S('sessionDays', 'Ingelogd blijven (dagen)', 'number', { min: 1, max: 365 }), S('rememberDays', '“Onthoud mij” (dagen)', 'number', { min: 1, max: 730 }), S('maxAttempts', 'Foute inlogpogingen voor een blokkade', 'number', { min: 3, max: 200 }), S('blockMinutes', 'Blokkade duurt (minuten)', 'number', { min: 1, max: 1440 }),
    S('rateLimit', 'Aanvalsbeveiliging', 'toggle', { value: sys.rateLimit !== false }), S('attack.burst', 'Piek per adres (verzoeken)', 'number', { min: 20, max: 5000 }), S('attack.perSec', 'Gemiddeld per seconde', 'number', { min: 2, max: 500 }), S('attack.strikes', 'Waarschuwingen voor een blokkade', 'number', { min: 10, max: 1000 }), S('attack.banMinutes', 'Blokkade door aanvalsbeveiliging (minuten)', 'number', { min: 1, max: 1440 }), S('attack.maxSse', 'Live-verbindingen per adres', 'number', { min: 1, max: 100 }),
    S('allowedIps', 'Alleen deze adressen mogen inloggen (één per regel, leeg = iedereen)', 'lines', { max: 50, value: sys.allowedIps || [] }),
    S('autoBackup', 'Elke nacht een back-up', 'toggle', { value: sys.autoBackup !== false }), S('backupKeep', 'Aantal back-ups bewaren', 'number', { min: 1, max: 90 }), S('backupPassword', 'Wachtwoord voor back-ups', 'password', { value: sys.backupPassword ? PASS_MASK : '' }), S('backupCopyDir', 'Tweede kopie in map', 'text', { max: 300 }),
    S('retentionDays', 'Bezoekersverzoeken bewaren (dagen, 0 = altijd)', 'number', { min: 0, max: 3650 }),
  ]);
  return groups;
}

// reads the values the app sends back; only fields that were described can be set. Returns { settings: {path: value}, system: {path: value} } or throws.
function parse(ctx, values) {
  const fields = new Map();
  for (const g of build(ctx)) for (const f of g.fields) fields.set(f.key, f);
  const out = { settings: {}, system: {} };
  const bad = (m) => Object.assign(new Error(m), { code: 400 });
  const one = (spec, v) => {
    switch (spec.type) {
      case 'toggle': return v === true || v === 'true';
      case 'number': { const n = Math.round(Number(v)); if (!Number.isFinite(n)) throw bad(`“${spec.label}” moet een getal zijn`); return Math.max(spec.min, Math.min(spec.max, n)); }
      case 'choice': { const hit = (spec.options || []).find((x) => x[0] === String(v)); if (!hit) throw bad(`Ongeldige keuze voor “${spec.label}”`); return spec.numeric ? Number(hit[0]) : hit[0]; }
      case 'time': if (v === '' || v == null) { if (spec.required) throw bad(`“${spec.label}” mag niet leeg zijn`); return ''; } if (!HM.test(String(v))) throw bad(`“${spec.label}” moet een tijd zijn (uu:mm)`); return String(v);
      case 'date': if (v === '' || v == null) return ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw bad(`“${spec.label}” moet een datum zijn`); return String(v);
      case 'color': if (v === '' || v == null) return ''; if (!/^#[0-9a-f]{6}$/i.test(String(v))) throw bad(`“${spec.label}” moet een kleur zijn`); return String(v);
      case 'password': return str(v, 300);
      default: return str(v, spec.max || 200);
    }
  };
  for (const [key, v] of Object.entries(values || {})) {
    const spec = fields.get(key);
    if (!spec) throw bad(`Onbekende instelling: ${String(key).slice(0, 60)}`);
    let val;
    if (spec.type === 'lines') { if (!Array.isArray(v)) throw bad(`“${spec.label}” moet een lijst zijn`); val = v.map((x) => str(x, spec.max || 200)).filter(Boolean).slice(0, 60); }
    else if (spec.type === 'multi') { if (!Array.isArray(v)) throw bad(`“${spec.label}” moet een lijst zijn`); val = [...new Set(v.map(String).filter((x) => spec.options.some((o2) => o2[0] === x)).map(Number))]; }
    else if (spec.type === 'dayhours') {
      if (v === null) val = null;
      else if (v && v.off === true) val = { off: true };
      else if (v && HM.test(v.from) && HM.test(v.to) && v.from < v.to) val = { from: v.from, to: v.to };
      else throw bad(`“${spec.label}” heeft ongeldige tijden`);
    } else if (spec.type === 'records') {
      if (!Array.isArray(v)) throw bad(`“${spec.label}” moet een lijst zijn`);
      val = v.slice(0, 50).map((row) => { const r = {}; for (const c of spec.columns) { let x = row && row[c.key] !== undefined ? row[c.key] : (c.type === 'toggle' ? false : ''); if (c.type === 'choice' && (x === '' || x == null)) x = c.options[0][0]; /* an older app does not know the new columns */ r[c.key] = one({ ...c, label: `${spec.label}: ${c.label}` }, x); } return r; });
    } else if (spec.type === 'password') { val = one(spec, v); if (val === ctx.PASS_MASK) continue; }
    else val = one(spec, v);
    (key.startsWith('system.') ? out.system : out.settings)[key.replace(/^system\./, '')] = val;
  }
  return out;
}

module.exports = { build, parse, getPath };
