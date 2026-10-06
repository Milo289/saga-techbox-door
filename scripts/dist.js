// Runs electron-builder. On macOS the two chip types are built one after the other,
// because building both .pkg files at the same time makes them overwrite each other's temp file.
const { spawnSync } = require('child_process');
const runs = process.platform === 'darwin'
  ? [['--mac', '--arm64'], ['--mac', '--x64']]
  : [[]];
for (const extra of runs) {
  const r = spawnSync('npx', ['electron-builder', ...extra, '--publish', 'never'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status || 1);
}
