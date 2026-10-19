'use strict';
// Turns VOORWAARDEN.md and PRIVACY.md (the one source of the texts) into the pages the server shows at /voorwaarden and /privacy.
// Run:  node scripts/legal.js        A test checks that the pages are up to date.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/\[([^\]]+)\]\(PRIVACY\.md\)/g, '<a href="/privacy">$1</a>').replace(/\[([^\]]+)\]\(VOORWAARDEN\.md\)/g, '<a href="/voorwaarden">$1</a>');
function render(md) {
  const out = []; const lines = md.split('\n'); let list = null, table = null, para = [];
  const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } if (list) { out.push('<ul>' + list.map((x) => '<li>' + inline(x) + '</li>').join('') + '</ul>'); list = null; } if (table) { out.push('<table>' + table.map((r, i) => '<tr>' + r.map((c) => (i === 0 ? '<th>' : '<td>') + inline(c.trim()) + (i === 0 ? '</th>' : '</td>')).join('') + '</tr>').join('') + '</table>'); table = null; } };
  for (const l of lines) {
    if (/^#\s/.test(l)) { flush(); out.push('<h1>' + inline(l.slice(2)) + '</h1>'); }
    else if (/^##\s/.test(l)) { flush(); out.push('<h2>' + inline(l.slice(3)) + '</h2>'); }
    else if (/^\* /.test(l)) { if (para.length || table) flush(); (list = list || []).push(l.slice(2)); }
    else if (/^\|/.test(l)) { if (/^\|[-| ]+\|$/.test(l)) continue; if (para.length || list) flush(); (table = table || []).push(l.replace(/^\||\|$/g, '').split('|')); }
    else if (/^>\s?/.test(l)) { flush(); para.push(l.replace(/^>\s?/, '').replace(/\s+$/, '')); }
    else if (!l.trim()) flush();
    else para.push(l);
  }
  flush();
  return out.join('\n');
}
const PAGE = (title, body) => `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
:root { --bg:#fff; --fg:#1d1d1f; --mut:#6e6e73; --line:#d2d2d7; }
@media (prefers-color-scheme: dark) { :root { --bg:#000; --fg:#f5f5f7; --mut:#a1a1a6; --line:#3a3a3c; } }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
main { max-width:760px; margin:0 auto; padding:32px 16px 64px; }
h1 { font-size:28px; } h2 { font-size:19px; margin-top:28px; } i { color:var(--mut); }
table { border-collapse:collapse; width:100%; font-size:14px; } th, td { border:1px solid var(--line); padding:6px 8px; text-align:left; vertical-align:top; }
a { color:inherit; }
</style></head><body><main>
${body}
<p><a href="/voorwaarden">Voorwaarden</a> · <a href="/privacy">Privacyverklaring</a></p>
</main></body></html>
`;
function build() {
  const files = { 'voorwaarden.html': ['VOORWAARDEN.md', 'Gebruiksvoorwaarden'], 'privacy.html': ['PRIVACY.md', 'Privacyverklaring'] };
  const res = {};
  for (const [out, [md, title]] of Object.entries(files)) res[out] = PAGE(title + ' – Saga Techbox Deur', render(fs.readFileSync(path.join(ROOT, md), 'utf8')));
  return res;
}
if (require.main === module) for (const [name, html] of Object.entries(build())) fs.writeFileSync(path.join(ROOT, 'public', name), html);
module.exports = { build, render };
