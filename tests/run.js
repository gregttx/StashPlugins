// Runs every *.test.js in this directory and reports an aggregate result.
//
// Each suite is its own process: the plugin installs global state (it wraps
// window.fetch and registers timers), so suites must not share a realm.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const suites = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

if (!suites.length) {
  console.error('no test suites found in ' + __dirname);
  process.exit(1);
}

const failed = [];
for (const suite of suites) {
  const result = spawnSync(process.execPath, [path.join(__dirname, suite)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) failed.push(suite);
}

console.log('\n' + '='.repeat(60));
if (failed.length) {
  console.log('FAILED: ' + failed.join(', '));
  process.exit(1);
}
console.log('All ' + suites.length + ' suite(s) passed.');
