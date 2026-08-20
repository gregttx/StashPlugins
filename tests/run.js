// Runs every *.test.js in this directory and reports an aggregate result.
//
// Each suite is its own process: the plugin installs global state (it wraps
// window.fetch and registers timers), so suites must not share a realm.
//
// Separate processes are also exactly what parallelises safely, and the tree is now
// bound by its longest suite rather than by their sum. Two consequences the shape below
// exists for: output is *buffered* per suite and released in suite order, so a parallel
// run reads exactly like a sequential one and a failure is still findable; and the pool
// is bounded by the CPU count, because these suites are CPU-bound (a `vm` context each,
// no I/O to overlap) and oversubscribing would only slow the longest one down.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const suites = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

if (!suites.length) {
  console.error('no test suites found in ' + __dirname);
  process.exit(1);
}

function run(suite) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, suite)], { env: process.env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

const results = new Array(suites.length);
let next = 0;        // the next suite to hand to a worker
let printed = 0;     // the next suite whose output is still owed to the reader

function flush() {
  while (printed < suites.length && results[printed]) {
    process.stdout.write(results[printed].out);
    printed++;
  }
}

function worker() {
  if (next >= suites.length) return Promise.resolve();
  const i = next++;
  return run(suites[i]).then((r) => { results[i] = r; flush(); return worker(); });
}

const width = Math.max(1, Math.min(suites.length, os.cpus().length));
Promise.all(Array.from({ length: width }, worker)).then(() => {
  const failed = suites.filter((s, i) => results[i].code !== 0);
  console.log('\n' + '='.repeat(60));
  if (failed.length) {
    console.log('FAILED: ' + failed.join(', '));
    process.exit(1);
  }
  console.log('All ' + suites.length + (suites.length === 1 ? ' suite' : ' suites') + ' passed.');
});
