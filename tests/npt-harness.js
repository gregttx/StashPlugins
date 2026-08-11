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
const TASK_PRUNE = 'Prune Parent Tags from Entities...';
const TASK_ROLLUP = 'Roll Up Parent Tags onto Entities...';

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
    // Only the form the plugin uses: a reference node that is a direct child, or
    // null meaning append. Real insertBefore throws on anything else, and so does
    // this, rather than quietly appending and hiding a placement bug.
    insertBefore(child, ref) {
      if (ref == null) return this.appendChild(child);
      const i = this.childNodes.indexOf(ref);
      if (i === -1) throw new Error('insertBefore: reference node is not a child');
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.splice(i, 0, child);
      this._text = null;
      return child;
    },
    get nextSibling() {
      if (!this.parentNode) return null;
      const sibs = this.parentNode.childNodes;
      return sibs[sibs.indexOf(this) + 1] || null;
    },
    get previousSibling() {
      if (!this.parentNode) return null;
      const sibs = this.parentNode.childNodes;
      return sibs[sibs.indexOf(this) - 1] || null;
    },
    // Real attributes, not just the handful promoted to properties above. Added for
    // the tab-strip anchor, which identifies the right strip by `data-rb-event-key`
    // ending in `-edit-panel` - Gallery renders two tablists and only one is the
    // entity's own, so a class match alone picks the wrong one half the time.
    attrs: {},
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    // `currentTarget` and `target` are the node itself, as a real browser sets them on
    // a dispatched click - a handler reading the button back off its own event (the
    // scene button's caption flashing does) would otherwise crash here and nowhere else.
    click() {
      const self = this;
      (this.handlers.click || []).forEach((fn) => fn({
        preventDefault() {}, stopPropagation() {}, currentTarget: self, target: self,
      }));
    },
    select() {},
    // Recorded rather than performed: there is no viewport here, but a test can
    // still assert that the plugin asked for a row to be brought into view.
    scrollIntoView(opts) { this.scrolledIntoView = opts || true; },
    get parentElement() { return this.parentNode; },
    // Enough of a selector engine for what the plugins actually ask a node for: a
    // bare tag name ('h3'), and a tag-plus-class compound ('button.delete') for the
    // details-edit container's Delete button. The dot split covers both: an empty
    // tag before the dot ('.foo') skips the tag check entirely.
    querySelector(sel) {
      const s = String(sel);
      const dot = s.indexOf('.');
      const tag = dot === -1 ? s : s.slice(0, dot);
      const cls = dot === -1 ? null : s.slice(dot + 1);
      return this.descendants().filter((n) => {
        if (tag && n.tagName !== tag.toUpperCase()) return false;
        if (cls && !hasClass(n, cls)) return false;
        return true;
      })[0] || null;
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
  // Intervals are recorded rather than started - a suite must not be at the mercy
  // of a 1s timer - but recording them lets a test drive a tick on demand.
  const intervals = [];
  const ctx = {
    console: opts.quiet ? { log() {}, info() {}, warn() {}, error() {} } : console,
    setTimeout, clearTimeout, clearInterval,
    setInterval: (fn) => intervals.push(fn),
    Promise, JSON, Date, Object, Error, String, Math, RegExp, Array, Boolean, Number,
    MutationObserver: function () { this.observe = function () {}; },
  };
  ctx.window = ctx;
  // The plugins hang their shared object off one reserved global, `window.__GTTx__`,
  // with the bare `StashPluginCoop` kept as an alias. Seeded here so a test can replace
  // the coop object wholesale (writing both names) before the plugin has created it.
  ctx.__GTTx__ = {};
  ctx.globalThis = ctx;
  ctx.navigator = opts.clipboard ? { clipboard: opts.clipboard } : {};
  ctx.window.navigator = ctx.navigator;
  ctx.location = { pathname: opts.pathname || '/settings?tab=tasks' };
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
    // A leading '.' is a class selector, matched the way `hasClass` does everywhere
    // else in these suites; anything else is a tag name. That is the whole of what
    // the three plugins ever ask `document` for.
    querySelector: (sel) => {
      const s = String(sel);
      const hits = s.charAt(0) === '.'
        ? body.descendants().filter((n) => hasClass(n, s.slice(1)))
        : body.descendants().filter((n) => n.tagName === s.toUpperCase());
      return hits[0] || null;
    },
    querySelectorAll: (sel) => {
      // Only the last segment of a descendant selector is honoured - there is no
      // ancestor matching here. `#performer-page .details-edit`, the one such selector
      // any plugin in this repo passes, is answered by its `.details-edit` half; the
      // page-id part is proved against a real DOM in `placement.test.js` instead.
      const s = String(sel).trim().split(/\s+/).pop();
      if (s.charAt(0) === '.') return body.descendants().filter((n) => hasClass(n, s.slice(1)));
      if (s.charAt(0) === '#') return body.descendants().filter((n) => n.id === s.slice(1));
      return body.descendants().filter((n) => n.tagName === s.toUpperCase());
    },
    // Real attributes, not just the handful promoted to properties above. Added for
    // the tab-strip anchor, which identifies the right strip by `data-rb-event-key`
    // ending in `-edit-panel` - Gallery renders two tablists and only one is the
    // entity's own, so a class match alone picks the wrong one half the time.
    attrs: {},
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    handlers: {},
    execCommand: () => (opts.execCommand !== false),
  };
  ctx.window.document = ctx.document;

  // Minimal `getComputedStyle`, added when both button plugins started branching on
  // the container's computed `display`: `.edit-buttons` is `display: block` on a live
  // Stash, where `row-gap` is inert, while `.details-edit` is a flex row where it
  // works, and one call site has to serve both. A test pins whatever it needs on the
  // node as `_computed`; everything else reports the defaults a real browser gives a
  // plain block element with no margins, which is also what an untouched fixture
  // should look like.
  ctx.window.getComputedStyle = (el) => Object.assign(
    { display: 'block', columnGap: 'normal', rowGap: 'normal',
      marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px' },
    (el && el._computed) || {});

  ctx.fetch = function (url, o) {
    const req = JSON.parse(o.body);
    calls.push({ query: req.query, variables: req.variables });
    const payload = opts.respond(req, calls);
    // A responder returning `HANG` models a request that is still in flight - the only
    // way to tell "this code path waited for the answer" from "it did not need to".
    if (payload === HANG) return new Promise(() => {});
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(JSON.stringify(payload))),
      text: () => Promise.resolve(JSON.stringify(payload)),
      clone() { return this; },
    });
  };
  ctx.window.fetch = ctx.fetch;

  return { ctx, calls, body, intervals, tick: () => intervals.forEach((fn) => fn()) };
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
    // The standing explanation of the log's own notation - what the id in brackets
    // is - as opposed to `note`, which carries whatever this run had to warn about.
    legend: (nodes.filter((n) => hasClass(n, p + '-legend'))[0] || {}).textContent || '',
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
    // The recap's tooltips: aliases and descriptions for the tags a run touched,
    // fetched by id once the plan is known rather than carried on the hierarchy.
    // What Stash says is installed, which the dialog compares against the version
    // compiled into the script. Absent unless a case asks for it, so every other
    // case exercises the unknown path - which must not warn or block.
    if (/PluginVersion/.test(q)) {
      if (opts.failVersion) return { errors: [{ message: 'no such field' }] };
      return { data: { plugins: opts.installed
        ? [{ id: opts.installed.id, version: opts.installed.version }] : [] } };
    }
    if (q.indexOf('NPTTagDetail') !== -1) {
      if (opts.failTagDetail) return { errors: [{ message: 'too expensive' }] };
      const want = req.variables.ids;
      return { data: { findTags: { tags: (opts.tagDetail || []).filter((t) => want.indexOf(t.id) !== -1) } } };
    }
    if (q.indexOf('NPTTags') !== -1) {
      return { data: { findTags: { tags: opts.tags || TAGS } } };
    }
    // Auto mode fetches exactly the entities a mutation touched, by id, rather than
    // paging - so it answers from the same `entities` table but filtered, and
    // carries no `count`.
    const auto = /query NPTAuto_(\w+)\(/.exec(q);
    if (auto) {
      const name = auto[1];
      if (opts.failFind === name) return { errors: [{ message: 'boom' }] };
      const spec = entities[name] || { node: 'scenes', list: [] };
      const want = (req.variables.ids || []).map(String);
      const out = {};
      out[spec.node] = spec.list.filter((e) => want.indexOf(String(e.id)) !== -1);
      const data = {};
      data[name] = out;
      return { data: data };
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

// Posts an entity update the way Stash's own UI would, so the plugin's fetch
// wrapper sees a mutation it might react to. `field` is the mutation name
// (sceneUpdate, bulkSceneUpdate, ...); a bulk one takes `ids`, a single one `id`.
function entityUpdate(ctx, field, input) {
  return ctx.window.fetch('/graphql', {
    body: JSON.stringify({
      query: 'mutation Stash_' + field + '($input: X!) { ' + field + '(input: $input) { id } }',
      variables: { input: input },
    }),
  });
}

// Fire any listener the plugin registered. `click()` is a special case of this and
// stays, because it is what most of the suites reach for; this covers the rest -
// mouseenter/mouseleave/focus/blur - without a real event system.
function fire(node, type, ev) {
  ((node && node.handlers && node.handlers[type]) || []).forEach((fn) => {
    fn(Object.assign({ preventDefault() {}, stopPropagation() {} }, ev || {}));
  });
}

const HANG = { __hang: true };

module.exports = {
  SRC, PLUGIN_ID, TASK_PRUNE, TASK_ROLLUP, TAGS, HANG,
  makeEnv, run, startTask, flush, dialog, hasClass, makeElement, fire,
  check, finish, makeResponder, bulkCalls, entityUpdate,
  results: () => failures,
};
