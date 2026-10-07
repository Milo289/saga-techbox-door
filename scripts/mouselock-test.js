// Windows only: proves that the helper really keeps the pointer inside a box (and lets go afterwards).
'use strict';
const { spawnSync } = require('child_process');
const m = require('../app/mouselock');

const PS = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][Dpi]::SetProcessDPIAware()
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(600, 500)
Start-Sleep -Milliseconds 300
$p = [System.Windows.Forms.Cursor]::Position
Write-Output ("{0},{1}" -f $p.X, $p.Y)
`;
const jump = () => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], { encoding: 'utf8' });
  const [x, y] = String(r.stdout).trim().split(/\s+/).pop().split(',').map(Number);
  return { x, y, raw: (r.stdout + r.stderr).trim() };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let ok = true;
  const check = (name, pass, extra) => { console.log(`${pass ? 'OK  ' : 'FAIL'} ${name} ${extra || ''}`); if (!pass) ok = false; };
  const free = jump();
  check('without the helper the pointer can go to 600,500', free.x === 600 && free.y === 500, JSON.stringify(free));
  m.start({ x: 100, y: 100, width: 200, height: 200 });
  await wait(3000);
  check('helper is running', m.running());
  const held = jump();
  check('with the helper the pointer stays inside 100..299', held.x >= 100 && held.x <= 299 && held.y >= 100 && held.y <= 299, JSON.stringify(held));
  m.stop();
  await wait(2500);
  check('helper has stopped', !m.running());
  const after = jump();
  check('after stopping the pointer is free again', after.x === 600 && after.y === 500, JSON.stringify(after));
  process.exit(ok ? 0 : 1);
})();
