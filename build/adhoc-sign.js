'use strict';
// macOS: sign the app "ad hoc" (no paid certificate). Apple-silicon Macs refuse to start completely unsigned apps
// ("is damaged"); an ad-hoc signature makes it a normal app that is allowed with right-click → Open the first time.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
