// Minimal browser-ish harness for exercising MergePerformerTagsToScenes.js in Node.
//
// The plugin is an ES5 IIFE with no exports, so there is nothing to require. Instead
// it is evaluated inside a vm context holding just enough of a browser — window,
// document, fetch, sessionStorage, MutationObserver — for it to install itself, and
// the tests drive it the way a browser would: by resolving GraphQL requests and by
// invoking the handlers it attaches.
//
// Set SRC to point the suites at a different copy of the plugin (the tests use it to
// check that a fix actually fails against the pre-fix version).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.env.SRC || path.join(
  __dirname, '..', 'MergePerformerTagsToScenes', 'MergePerformerTagsToScenes.js');

function makeResponse(payload, ok) {
  const body = JSON.stringify(payload);
  return {
    ok: ok !== false,
    clone() { return makeResponse(payload, ok); },
    json() { return Promise.resolve(JSON.parse(body)); },
  };
}

function makeEnv(opts) {
  const calls = [];
  const el = () => ({
    appendChild() {}, addEventListener() {}, removeChild() {},
    parentNode: { removeChild() {} }, textContent: '', className: '', title: '',
    type: '', disabled: false,
  });
  const ctx = {
    console,
    setTimeout, clearTimeout, clearInterval,
    // Ticks are inert by default; fastTick speeds the 1s tick up so tests that need
    // the plugin's polling loop (button injection) don't wait on real time.
    setInterval: opts.fastTick ? ((fn, ms) => setInterval(fn, ms >= 10000 ? 100000 : 15)) : (() => 0),
    Promise, JSON, Date, Object, Error, String, Math, RegExp,
    MutationObserver: function () { this.observe = function () {}; },
    sessionStorage: {
      _d: {},
      getItem(k) { return k in this._d ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
    document: {
      getElementById: () => el(),
      querySelector: (s) => (opts.containers && opts.containers[s] ? el() : null),
      querySelectorAll: () => [],
      createElement: () => el(),
      addEventListener() {},
      body: el(),
      documentElement: el(),
    },
  };
  ctx.window = ctx;
  // The plugins hang their shared object off one reserved global, `window.__GTTx__`,
  // with the bare `StashPluginCoop` kept as an alias. Seeded here so a test can replace
  // the coop object wholesale (writing both names) before the plugin has created it.
  ctx.__GTTx__ = {};
  ctx.globalThis = ctx;
  ctx.location = { pathname: opts.pathname || '/scenes/1', reload() { calls.push({ reload: true }); } };
  ctx.window.location = ctx.location;
  ctx.window.addEventListener = () => {};
  ctx.__APOLLO_CLIENT__ = { cache: { evict() {}, gc() {} } };

  ctx.fetch = function (url, o) {
    const req = JSON.parse(o.body);
    calls.push({ query: req.query, variables: req.variables });
    return Promise.resolve(makeResponse(opts.respond(req, calls), true));
  };
  ctx.window.fetch = ctx.fetch;
  return { ctx, calls };
}

function run(ctx) {
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: SRC });
}

const flush = (n) => {
  let p = Promise.resolve();
  for (let i = 0; i < (n || 40); i++) p = p.then(() => new Promise((r) => setTimeout(r, 0)));
  return p;
};

let failures = 0;
let passes = 0;
function check(name, cond, extra) {
  if (cond) { passes++; console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (extra ? '\n        ' + extra : '')); }
}

// Prints the tally and exits non-zero on any failure, so a runner can just watch
// the exit code.
function finish() {
  console.log(failures === 0
    ? '\n' + passes + ' check(s) passed.'
    : '\n' + failures + ' of ' + (failures + passes) + ' check(s) FAILED.');
  process.exit(failures === 0 ? 0 : 1);
}

const SETTINGS = {
  a1ShowManualMergeButtons: true,
  a3AutoMergeOnSceneUpdate: true,
  a4AutoMergeOnPerformerUpdate: true,
  b1ExcludeSceneWithTagName: 'Do_Not_Merge',
  c2ExcludeTagWithCustomFieldName: 'constructor',
};

// Default responder: performer 7 has tags 10,11; scene 1 has tag 10 and performer 7.
function responder(overrides) {
  return function (req, calls) {
    const q = req.query;
    if (q.indexOf('configuration') !== -1) {
      return { data: { configuration: { plugins: { MergePerformerTagsToScenes: Object.assign({}, SETTINGS, overrides && overrides.settings) } } } };
    }
    if (q.indexOf('FindTagByName') !== -1) {
      return { data: { findTags: { tags: (overrides && overrides.tags) || [{ id: '99', name: 'Do_Not_Merge' }] } } };
    }
    if (q.indexOf('FindScene(') !== -1) {
      return { data: { findScene: (overrides && overrides.scene) || {
        organized: false, tags: [{ id: '10' }],
        performers: [{ tags: [{ id: '10', ignore_auto_tag: false, custom_fields: {} },
                              { id: '11', ignore_auto_tag: false, custom_fields: {} }] }],
      } } };
    }
    // The scene button's gate, since 1.16.0: the same selection a merge reads, so it
    // resolves to the same scene `FindScene(` above does rather than a shape of its own.
    if (q.indexOf('FindSceneMergeable') !== -1) {
      return { data: { findScene: (overrides && overrides.scene) || {
        organized: false, tags: [{ id: '10' }],
        performers: [{ tags: [{ id: '10', ignore_auto_tag: false, custom_fields: {} },
                              { id: '11', ignore_auto_tag: false, custom_fields: {} }] }],
      } } };
    }
    if (q.indexOf('FindPerformer(') !== -1) {
      return { data: { findPerformer: (overrides && overrides.performer) || {
        tags: [{ id: '10', ignore_auto_tag: false, custom_fields: {} },
               { id: '11', ignore_auto_tag: false, custom_fields: {} }],
      } } };
    }
    if (q.indexOf('FindPerformerScenes') !== -1) {
      return { data: { findScenes: { scenes: (overrides && overrides.scenes) || [
        { id: '1', organized: false, tags: [] }, { id: '2', organized: false, tags: [] },
      ] } } };
    }
    if (q.indexOf('CheckPerformerScenes') !== -1) return { data: { findScenes: { count: 3 } } };
    if (q.indexOf('sceneUpdate') !== -1) {
      if (overrides && overrides.failSceneIds && overrides.failSceneIds.indexOf(req.variables.input.id) !== -1) {
        return { errors: [{ message: 'boom for scene ' + req.variables.input.id }] };
      }
      return { data: { sceneUpdate: { id: req.variables.input.id } } };
    }
    return { data: {} };
  };
}

const sceneUpdates = (calls) => calls.filter((c) => c.query && /\bsceneUpdate\b/.test(c.query) && c.query.indexOf('mutation') === 0);

module.exports = {
  SRC, makeEnv, run, flush, check, finish, responder, sceneUpdates,
  results: () => failures,
};
