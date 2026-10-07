'use strict';
// Keeps the mouse pointer on one monitor (the door screen). Electron cannot do this by itself, so a tiny helper runs next to the app:
//   macOS   — a JavaScript-for-Automation script that puts the pointer back whenever it leaves the monitor
//   Windows — a PowerShell script that clips the pointer to the monitor (ClipCursor)
// Safety: the helper stops by itself when the app stops talking to it (no heartbeat for 5 seconds), so a crashed app can never leave
// the pointer trapped. Linux has no safe way to do this; there only the other monitors are blacked out (done by the app).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let child = null, beat = null, hbFile = '';

function macScript(r, hb) {
  return `
ObjC.import('Cocoa');
const x0 = ${r.x}, y0 = ${r.y}, x1 = ${r.x + r.width - 1}, y1 = ${r.y + r.height - 1};
const hb = ${JSON.stringify(hb)};
$.CGSetLocalEventsSuppressionInterval(0);
let n = 0;
for (;;) {
  if (n++ % 25 === 0) { // about once a second: still being told to run?
    const s = $.NSString.stringWithContentsOfFileEncodingError(hb, $.NSUTF8StringEncoding, $());
    if (!s || Date.now() - Number(ObjC.unwrap(s)) > 5000) break;
  }
  const p = $.CGEventGetLocation($.CGEventCreate($())); // (JXA frees these itself: releasing them by hand crashes)
  const nx = Math.min(Math.max(p.x, x0), x1), ny = Math.min(Math.max(p.y, y0), y1);
  if (nx !== p.x || ny !== p.y) $.CGWarpMouseCursorPosition($.CGPointMake(nx, ny));
  $.NSThread.sleepForTimeInterval(0.04);
}
`;
}

function winScript(r, hb) {
  const esc = hb.replace(/'/g, "''");
  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][Dpi]::SetProcessDPIAware()
$rect = New-Object System.Drawing.Rectangle(${r.x}, ${r.y}, ${r.width}, ${r.height})
$hb = '${esc}'
try {
  while ($true) {
    if (-not (Test-Path $hb)) { break }
    $t = [double](Get-Content $hb -Raw)
    $now = [double]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    if (($now - $t) -gt 5000) { break }
    [System.Windows.Forms.Cursor]::Clip = $rect
    Start-Sleep -Milliseconds 500
  }
} finally { [System.Windows.Forms.Cursor]::Clip = [System.Drawing.Rectangle]::Empty }
`;
}

// rect = the monitor in physical pixels (Windows) / points (macOS), top-left origin
function start(rect) {
  stop();
  if (process.platform !== 'darwin' && process.platform !== 'win32') return false;
  hbFile = path.join(os.tmpdir(), `saga-mouselock-${process.pid}.hb`);
  const write = () => { try { fs.writeFileSync(hbFile, String(Date.now())); } catch {} };
  write();
  beat = setInterval(write, 1000);
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  child = process.platform === 'darwin'
    ? spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macScript(r, hbFile)], { stdio: 'ignore' })
    : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', winScript(r, hbFile)], { stdio: 'ignore', windowsHide: true });
  child.on('exit', () => { child = null; });
  child.on('error', () => { child = null; });
  return true;
}

function stop() {
  if (beat) { clearInterval(beat); beat = null; }
  try { if (hbFile) fs.unlinkSync(hbFile); } catch {} // no heartbeat file = the helper ends itself within a second
  if (child) { try { child.kill(); } catch {} child = null; }
}

module.exports = { start, stop, macScript, winScript, running: () => !!child };
