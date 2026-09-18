#!/usr/bin/env node
/**
 * @commercetools-frontend/application-config hardcodes the dev-server origin
 * (`developmentAppUrl = http://localhost:3001`, "TODO: make it configurable") and
 * prefixes every asset URL in the dev HTML with it — so a dev server fronted by a
 * public (ngrok) origin serves a page whose bundles still point at localhost.
 *
 * This script rewrites the shipped dist bundles so the origin honors an opt-in
 * MC_DEV_APP_URL env var; without the var the stock behavior is unchanged.
 * Idempotent: run it on every start (`npm run start:patch`). It aborts loudly if
 * the expected source line is missing (i.e. an appkit upgrade changed the code —
 * re-check whether the patch is still needed at all).
 *
 * Run from the app dir (mc or mc-view); patches that app's node_modules.
 */
const fs = require('fs');
const path = require('path');

const HARDCODED =
  'developmentAppUrl = `http://localhost:${developmentPort}`';
const PATCHED =
  'developmentAppUrl = process.env.MC_DEV_APP_URL || `http://localhost:${developmentPort}`';

const distDir = path.join(
  process.cwd(),
  'node_modules',
  '@commercetools-frontend',
  'application-config',
  'dist'
);

const bundlePattern =
  /^commercetools-frontend-application-config\.(esm|cjs\.dev|cjs\.prod)\.js$/;
const files = fs.readdirSync(distDir).filter((f) => bundlePattern.test(f));
if (files.length === 0) {
  console.error(`patch-mc-dev-app-url: no bundles found in ${distDir}`);
  process.exit(1);
}

let patched = 0;
let already = 0;
for (const name of files) {
  const file = path.join(distDir, name);
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(PATCHED)) {
    already += 1;
    continue;
  }
  if (!src.includes(HARDCODED)) {
    console.error(
      `patch-mc-dev-app-url: expected line not found in ${name} — appkit version changed? Aborting unpatched.`
    );
    process.exit(1);
  }
  fs.writeFileSync(file, src.replace(HARDCODED, PATCHED));
  patched += 1;
}
console.log(
  `patch-mc-dev-app-url: ${patched} bundle(s) patched, ${already} already patched (MC_DEV_APP_URL override active).`
);
