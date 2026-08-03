// Harness for NormalizeParentTags.js.
//
// The sibling's harness (harness.js) fakes just enough browser to install a plugin
// that only ever injects a button. This one has to survive a plugin that builds a
// whole dialog, so the fake DOM is real enough to append, remove, walk and read
// back: element nodes with children, className, textContent and click handlers.
//
// Runs are driven the way the plugin's own layer-2 backstop would be driven - by
// posting a runPluginTask mutation through window.fetch - so no click plumbing is
// needed to start one. Everything else the test does is answer GraphQL.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.env.SRC || path.join(
  __dirname, '..', 'NormalizeParentTags', 'NormalizeParentTags.js');

const PLUGIN_ID = 'NormalizeParentTags';
const TASK_PRUNE = 'Prune Parent Tags from Entities';
const TASK_ROLLUP = 'Roll Up Parent Tags onto Entities';

function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    className: '',
    id: '',
    type: '',
    value: '',
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0,
    childNodes: [],
    parentNode: null,
    handlers: {},
    get firstChild() { return this.childNodes[0] || null; },
    get textContent() {
      if (this._text != null) return this._text;
      return this.childNodes.map((c) => c.textContent).join('');
    },
    set textContent(v) { this._text = String(v); this.childNodes = []; },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      this._text = null;
      return child;
    },
    removeChild(child) {
      const i = this.childNodes.indexOf(child);
      if (i !== -1) this.childNodes.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    click() { (this.handlers.click || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {} })); },
    select() {},
    // Recorded rather than performed: there is no viewport here, but a test can
    // still assert that the plugin asked for a row to be brought into view.
    scrollIntoView(opts) { this.scrolledIntoView = opts || true; },
    get parentElement() { return this.parentNode; },
    // Enough of a selector engine for the two selectors the plugin uses: a tag
    // name ('h3') downwards, and 'button' upwards.
    querySelector(sel) {
      return this.descendants().filter((n) => n.tagName === String(sel).toUpperCase())[0] || null;
    },
    closest(sel) {
      const want = String(sel).toUpperCase();
      let n = this;
      while (n) {
        if (n.tagName === want) return n;
        n = n.parentNode;
      }
      return null;
    },
    // Depth-first walk of the subtree, used by the tests to find buttons and lines.
    descendants() {
      const out = [];
      const walk = (n) => n.childNodes.forEach((c) => { out.push(c); walk(c); });
      walk(this);
      return out;
    },
  };
}

function hasClass(node, name) {
  return (' ' + (node.className || '') + ' ').indexOf(' ' + name + ' ') !== -1;
}

function makeEnv(opts) {
  const calls = [];
  const ctx = {
    console: opts.quiet ? { log() {}, info() {}, warn() {}, error() {} } : console,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    Promise, JSON, Date, Object, Error, String, Math, RegExp, Array, Boolean, Number,
    MutationObserver: function () { this.observe = function () {}; },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.navigator = opts.clipboard ? { clipboard: opts.clipboard } : {};
  ctx.window.navigator = ctx.navigator;
  ctx.location = { pathname: '/settings?tab=tasks' };
  ctx.window.location = ctx.location;
  ctx.window.addEventListener = () => {};

  const body = makeElement('body');
  const head = makeElement('head');
  ctx.document = {
    body, head,
    documentElement: makeElement('html'),
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => head.descendants().concat(body.descendants())
      .filter((n) => n.id === id)[0] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    handlers: {},
    execCommand: () => (opts.execCommand !== false),
  };
  ctx.window.document = ctx.document;

  ctx.fetch = function (url, o) {
    const req = JSON.parse(o.body);
    calls.push({ query: req.query, variables: req.variables });
    const payload = opts.respond(req, calls);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(JSON.stringify(payload))),
      text: () => Promise.resolve(JSON.stringify(payload)),
      clone() { return this; },
    });
  };
  ctx.window.fetch = ctx.fetch;

  return { ctx, calls, body };
}

// `src` defaults to NormalizeParentTags; the merge-task suite passes the sibling's
// path so that one fake DOM serves both plugins rather than being copied.
function run(ctx, src) {
  const file = src || SRC;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
}

// Starts a task run the way the plugin's fetch backstop expects.
function startTask(ctx, taskName, pluginId) {
  return ctx.window.fetch('/graphql', {
    body: JSON.stringify({
      query: 'mutation RunPluginTask($plugin_id: ID!, $task_name: String) { runPluginTask(plugin_id: $plugin_id, task_name: $task_name) }',
      variables: { plugin_id: pluginId || PLUGIN_ID, task_name: taskName },
    }),
  });
}

const flush = (n) => {
  let p = Promise.resolve();
  for (let i = 0; i < (n || 60); i++) p = p.then(() => new Promise((r) => setTimeout(r, 0)));
  return p;
};

// The dialog, as the tests want to see it: log lines, buttons by label, progress.
// `prefix` selects which plugin's dialog to read: NormalizeParentTags uses npt-,
// the merge task in the sibling uses cpt2s-. Same markup, same class suffixes.
function dialog(body, prefix) {
  const p = prefix || 'npt';
  const nodes = body.descendants();
  const buttons = nodes.filter((n) => n.tagName === 'BUTTON');
  return {
    open: nodes.some((n) => hasClass(n, p + '-modal')),
    lines: nodes.filter((n) => hasClass(n, p + '-line')).map((n) => n.textContent),
    progress: (nodes.filter((n) => hasClass(n, p + '-progress'))[0] || {}).textContent || '',
    note: (nodes.filter((n) => hasClass(n, p + '-note'))[0] || {}).textContent || '',
    button(label) {
      return buttons.filter((b) => b.textContent === label)[0] || null;
    },
    visible(label) {
      const b = this.button(label);
      return !!b && !hasClass(b, p + '-hidden');
    },
  };
}

let failures = 0;
let passes = 0;
function check(name, cond, extra) {
  if (cond) { passes++; console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (extra ? '\n        ' + extra : '')); }
}

function finish() {
  console.log(failures === 0
    ? '\n' + passes + ' check(s) passed.'
    : '\n' + failures + ' of ' + (failures + passes) + ' check(s) FAILED.');
  process.exit(failures === 0 ? 0 : 1);
}

// ── A fake library ──────────────────────────────────────────────────────────
//
// Tag graph: Hair Colour (1) -> Blonde (2) -> Platinum (3); Body (4) -> Tattoo (5).
// Tag 6 is a second parent of Platinum, so the closure has a diamond in it.
const TAGS = [
  { id: '1', name: 'Hair Colour', ignore_auto_tag: false, parents: [] },
  { id: '2', name: 'Blonde', ignore_auto_tag: false, parents: [{ id: '1' }] },
  { id: '3', name: 'Platinum', ignore_auto_tag: false, parents: [{ id: '2' }, { id: '6' }] },
  { id: '4', name: 'Body', ignore_auto_tag: false, parents: [] },
  { id: '5', name: 'Tattoo', ignore_auto_tag: false, parents: [{ id: '4' }] },
  { id: '6', name: 'Rare', ignore_auto_tag: false, parents: [] },
];

function makeResponder(opts) {
  opts = opts || {};
  const settings = Object.assign({ a5EnableScenes: true }, opts.settings);
  const entities = opts.entities || {};
  return function (req) {
    const q = req.query || '';
    if (q.indexOf('configuration') !== -1) {
      const plugins = { NormalizeParentTags: settings };
      if (opts.siblingSettings) plugins.MergePerformerTagsToScenes = opts.siblingSettings;
      return { data: { configuration: { plugins } } };
    }
    if (q.indexOf('NPTTags') !== -1) {
      return { data: { findTags: { tags: opts.tags || TAGS } } };
    }
    const find = /query NPT_(\w+)\(/.exec(q);
    if (find) {
      const name = find[1];
      if (opts.failFind === name) return { errors: [{ message: 'boom' }] };
      if (opts.rejectSort && q.indexOf('sort:') !== -1) {
        return { errors: [{ message: 'invalid sort' }] };
      }
      const spec = entities[name] || { node: 'scenes', list: [] };
      const out = { count: spec.list.length };
      out[spec.node] = req.variables.page === 1 ? spec.list : [];
      const data = {};
      data[name] = out;
      return { data: data };
    }
    const bulk = /mutation NPT_(\w+)\(/.exec(q);
    if (bulk) {
      if (opts.failBulk && opts.failBulk(req)) return { errors: [{ message: 'bulk boom' }] };
      const data = {};
      data[bulk[1]] = req.variables.input.ids.map((id) => ({ id }));
      return { data: data };
    }
    return { data: {} };
  };
}

const bulkCalls = (calls) => calls.filter((c) => /mutation NPT_bulk/.test(c.query || ''));

module.exports = {
  SRC, PLUGIN_ID, TASK_PRUNE, TASK_ROLLUP, TAGS,
  makeEnv, run, startTask, flush, dialog, hasClass, makeElement,
  check, finish, makeResponder, bulkCalls,
  results: () => failures,
};
