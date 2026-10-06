// Runs electron-builder. On macOS every installer (dmg/pkg x arm64/x64) is built in its own run,
// because .pkg builds running at the same time overwrite each other's temp file.
const { spawnSync } = require('child_process');
const runs = process.platform === 'darwin'
  ? ['arm64', 'x64'].flatMap(a => ['dmg', 'pkg'].map(t => ['--mac', t, '--' + a]))
  : [[]];
for (const extra of runs) {
  const r = spawnSync('npx', ['electron-builder', ...extra, '--publish', 'never'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status || 1);
}
