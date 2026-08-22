// SceneVariants: the Variants tab.
//
// The plugin makes no mutation, so there is nothing to assert about writes. What is
// worth pinning is the shape of the answer: which scenes it decides are variants, what
// order it puts them in, what it calls each one, and the four cases where it correctly
// lists nothing — three of which are ordinary answers and one of which is a failure.
//
// **This suite drives the real patch callbacks.** The plugin no longer touches the DOM
// on a scene page at all: it hands Stash's `ScenePage.Tabs` and `ScenePage.TabContent`
// extension points a React element each, so a suite that inspected `document` would be
// inspecting nothing. The fake React below is the smallest thing that can render a
// function component with `useState` and `useEffect` and re-render it when state moves —
// which is exactly the machinery the pane is built on and nothing more.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const SRC = process.env.SRC || path.join(__dirname, '..', 'SceneVariants', 'SceneVariants.js');

// ── A React small enough to read ────────────────────────────────────────────
//
// Elements are `{ type, props, children }`. A component is rendered by calling it with
// its props while a hook slot list is current; `setState` re-runs the same component
// against the same slots and runs whatever effects changed. There is no reconciliation
// and no tree diffing, because nothing here depends on either — the pane renders one
// flat list and its only state transition is "the query landed".
function makeReact() {
  const Fragment = { fragment: true };
  const React = {
    Fragment,
    // **Children live in `props.children`, and a single child is not wrapped in an
    // array.** This fake used to hang them off a `children` property of its own, which
    // read fine in the checks and is not where React puts them — and the plugin now reads
    // `container.props.children` to splice its tab in ahead of Edit. That is the third
    // time a divergence between this fake and React would have mattered, so it is
    // faithful here even though it makes the readers below do a little more work.
    createElement(type, props, ...children) {
      const p = Object.assign({}, props || {});
      if (children.length === 1) p.children = children[0];
      else if (children.length > 1) p.children = children;
      return { type, props: p, _el: true };
    },
    // The plugin checks this before appending to anything, so the fake has to answer it.
    // `_el` stands in for React's `$$typeof` symbol: the point is only that an element is
    // distinguishable from a plain object, which is the distinction that was missed.
    isValidElement: (v) => !!(v && typeof v === 'object' && v._el === true),
    Children: {
      // Flattens, drops what React drops, and assigns a key to everything - which is the
      // reason the plugin uses it rather than the raw value, so a fake that skipped the
      // keys would not be testing the thing that matters.
      toArray(children) {
        const out = [];
        const walk = (kid) => {
          if (Array.isArray(kid)) return kid.forEach(walk);
          if (kid === null || kid === undefined || typeof kid === 'boolean') return;
          out.push(React.isValidElement(kid) && kid.props.key === undefined
            ? Object.assign({}, kid, { key: '.' + out.length }) : kid);
        };
        walk(children);
        return out;
      },
    },
  };

  // One mounted component instance: its hook slots, its pending effects, and the last
  // element it produced.
  let current = null;
  React.useState = (initial) => {
    const inst = current;
    const i = inst.slot++;
    if (!(i in inst.slots)) inst.slots[i] = initial;
    return [inst.slots[i], (v) => { inst.slots[i] = v; inst.render(); }];
  };
  React.useEffect = (fn, deps) => {
    const inst = current;
    const i = inst.slot++;
    const prev = inst.effects[i];
    const changed = !prev || !deps || deps.length !== prev.deps.length ||
      deps.some((d, n) => d !== prev.deps[n]);
    if (!changed) return;
    if (prev && prev.cleanup) prev.cleanup();
    inst.effects[i] = { deps, cleanup: null, fn };
    inst.pending.push(i);
  };

  // Mounts a component and returns a handle whose `.el` is always its latest output.
  React.mount = (Component, props) => {
    const inst = {
      slots: {}, effects: {}, slot: 0, pending: [], el: null,
      render() {
        inst.slot = 0;
        inst.pending = [];
        const prev = current;
        current = inst;
        try { inst.el = Component(props); } finally { current = prev; }
        inst.pending.forEach((i) => { inst.effects[i].cleanup = inst.effects[i].fn() || null; });
      },
      unmount() {
        Object.keys(inst.effects).forEach((i) => {
          if (inst.effects[i].cleanup) inst.effects[i].cleanup();
        });
      },
    };
    inst.render();
    return inst;
  };
  return React;
}

// react-bootstrap, as far as this plugin uses it: four component identities it puts in
// a `type`. Objects rather than functions so a test can name them by reference.
const Bootstrap = {
  Nav: { Item: { name: 'Nav.Item' }, Link: { name: 'Nav.Link' } },
  Tab: { Pane: { name: 'Tab.Pane' } },
};

// ── Reading an element tree back ────────────────────────────────────────────

function kidsOf(node) {
  const k = node && node.props ? node.props.children : null;
  if (k === null || k === undefined) return [];
  return Array.isArray(k) ? k : [k];
}
function walk(node, out) {
  if (Array.isArray(node)) { node.forEach((k) => walk(k, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  kidsOf(node).forEach((k) => walk(k, out));
  return out;
}
const nodes = (el) => walk(el, []);
const byClass = (el, cls) => nodes(el).filter((n) =>
  String((n.props || {}).className || '').split(' ').indexOf(cls) !== -1);
const textOf = (n) => kidsOf(n).map((k) =>
  (k && typeof k === 'object' ? textOf(k) : String(k))).join('');

// The legacy context object React hands a function component as its second argument.
// One shared identity so a check can look for it by reference in a rendered tree.
const REACT_LEGACY_CONTEXT = {};

// What a container component rendered before our patch is chained onto it. `_el` is the
// fake React's stand-in for `$$typeof`: the plugin refuses to append to anything that is
// not an element, so a fixture that skipped this would be testing the refusal path.
const stashRendered = (type) => ({ type, props: {}, _el: true });

// Stash's own tab strip, as `ScenePageTabs` renders it. Each tab is a `Nav.Item` around a
// `Nav.Link`, so the key that identifies one is a level in - and the conditional tabs
// render `""` when their content is absent, which is why the plugin reaches for
// `React.Children.toArray` rather than for the raw children value.
function stashStrip(React, keys) {
  const kids = keys.map((k, i) => (k === null ? '' : React.createElement(Bootstrap.Nav.Item,
    { key: 'tab' + i },
    React.createElement(Bootstrap.Nav.Link, { eventKey: k }, k.replace(/^scene-|-panel$/g, '')))));
  return React.createElement(React.Fragment, null, ...kids);
}

// The eventKeys of a rendered strip, in order.
const tabKeys = (el) => nodes(el)
  .filter((n) => n.type === Bootstrap.Nav.Link)
  .map((n) => n.props.eventKey);

// ── The fixture ─────────────────────────────────────────────────────────────

// Scene 42, one stash-id, three variants sharing it: a full-length one, a partial and an
// untagged one, deliberately returned in an order the tab has to change.
const SIBLINGS = [
  { id: '42', title: 'Cool Shoot - Clip 2', tags: [{ id: '2', name: 'Partial Length' }],
    files: [{ duration: 243, width: 1920, height: 1080 }] },
  // No preview generated for this one - a cover and nothing to play.
  { id: '77', title: 'Cool Shoot - Clip 1', tags: [{ id: '2', name: '  partial length  ' }],
    paths: { screenshot: '/scene/77/screenshot' },
    files: [{ duration: 300, width: 1280, height: 720 }] },
  { id: '9', title: 'Cool Shoot', tags: [{ id: '1', name: 'Full Length' }],
    paths: { screenshot: '/scene/9/screenshot', preview: '/scene/9/preview' },
    files: [{ duration: 2472, width: 1920, height: 1080 }] },
  // Longer than the full-length one on purpose: role has to outrank running time, or a
  // duration-only sort would pass this fixture by accident.
  { id: '55', title: 'Cool Shoot (rip)', tags: [],
    files: [{ duration: 2500, width: 3840, height: 2160 }] },
];

// The tag graph the plugin resolves the two configured names against. `Clip` is an alias
// of the partial-length tag, `Trailer` is its child and `Teaser` its grandchild - so a
// scene wearing any of the three is a partial-length variant without the settings naming
// it. `Unrelated` is there to be the tag that matches nothing.
const TAGS = [
  { id: '1', name: 'Full Length', aliases: ['FL'], parents: [] },
  { id: '2', name: 'Partial Length', aliases: ['Clip'], parents: [] },
  { id: '3', name: 'Trailer', aliases: [], parents: [{ id: '2' }] },
  { id: '4', name: 'Teaser', aliases: [], parents: [{ id: '3' }] },
  { id: '5', name: 'Unrelated', aliases: [], parents: [] },
];

// What Stash hands the patch points: a `SceneDataFragment`, which already carries
// `stash_ids`. That is the whole reason this is one query rather than two, so the
// fixture has to be that shape rather than a bare id.
function sceneProp(opts) {
  return {
    id: '42', title: 'Cool Shoot - Clip 2',
    stash_ids: opts.stashIds === undefined
      ? [{ endpoint: 'https://stashdb.org/graphql', stash_id: 'abc' }]
      : opts.stashIds,
  };
}

function responder(opts) {
  return (req) => {
    const q = req.query;
    if (q.indexOf('configuration { plugins }') !== -1) {
      return { data: { configuration: { plugins: { SceneVariants: Object.assign({
        a1FullLengthTag: 'Full Length',
        a2PartialLengthTag: 'Partial Length',
      }, opts.settings) } } } };
    }
    if (q.indexOf('SVRTags') !== -1) {
      if (opts.tagsFail) return { errors: [{ message: 'no such field' }] };
      return { data: { findTags: { tags: opts.tags || TAGS } } };
    }
    if (q.indexOf('SVRVariants') !== -1) {
      if (opts.siblingsFail) return { errors: [{ message: 'invalid modifier' }] };
      return { data: { findScenes: { scenes: opts.siblings || SIBLINGS } } };
    }
    // The custom-field half of the same question. Answered from its own list so a check
    // can tell which query found a row, and refusable on its own so the "half an answer
    // beats none" path is drivable.
    if (q.indexOf('SVRFieldMatch') !== -1) {
      if (opts.fieldFail) return { errors: [{ message: 'no such criterion' }] };
      opts.fieldAsked = (opts.fieldAsked || []).concat([req.variables]);
      return { data: { findScenes: { scenes: opts.byField || [] } } };
    }
    if (q.indexOf('SVRSceneFields') !== -1) {
      return { data: { findScene: { id: req.variables.id,
        custom_fields: opts.ownFields || {} } } };
    }
    if (q.indexOf('SVRPluginVersion') !== -1) {
      return { data: { plugins: opts.installed ? [{ id: 'SceneVariants', version: opts.installed }] : [] } };
    }
    if (q.indexOf('SVRMigrateScan') !== -1) {
      if (opts.scanFail) return { errors: [{ message: 'no such filter' }] };
      const all = opts.library || [];
      const page = req.variables.f.page, per = req.variables.f.per_page;
      opts.scanTags = req.variables.tags;
      return { data: { findScenes: { count: all.length,
        scenes: all.slice((page - 1) * per, page * per) } } };
    }
    if (q.indexOf('SVR_Write') !== -1) {
      const input = req.variables.input;
      opts.writes = (opts.writes || []).concat([input]);
      if (opts.failWrite && opts.failWrite(input)) {
        return { errors: [{ message: 'write boom' }] };
      }
      // Applied to the fixture, so a check can ask the library what it holds rather than
      // only what was sent - the same reason `enm` applies its cancel.
      const row = (opts.library || []).filter((sc) => String(sc.id) === String(input.id))[0];
      if (row) {
        if (input.stash_ids) row.stash_ids = input.stash_ids;
        const cf = input.custom_fields || {};
        row.custom_fields = Object.assign({}, row.custom_fields);
        Object.keys(cf.partial || {}).forEach((k) => { row.custom_fields[k] = cf.partial[k]; });
        (cf.remove || []).forEach((k) => { delete row.custom_fields[k]; });
      }
      return { data: { sceneUpdate: { id: input.id } } };
    }
    return { data: {} };
  };
}

// The group Stash renders for a plugin task: a `.setting-group`, an `<h3>` with the
// plugin name and version, and a button captioned with the task.
const TASK = 'Migrate Variant Stash-IDs...';
const PLUGIN_NAME = 'ᝯㄝₓ Scene Variants';

function taskGroup(env, name) {
  const group = env.ctx.document.createElement('div');
  group.className = 'setting-group';
  const head = env.ctx.document.createElement('h3');
  head.textContent = name;
  group.appendChild(head);
  const btn = env.ctx.document.createElement('button');
  btn.textContent = TASK;
  group.appendChild(btn);
  env.body.appendChild(group);
  return btn;
}

function start(opts) {
  opts = opts || {};
  const warnings = [];
  const env = h.makeEnv({
    quiet: true, pathname: '/scenes/42', respond: opts.respond || responder(opts),
  });
  env.warnings = warnings;
  env.ctx.console = { log() {}, info() {}, error() {}, warn: (m) => warnings.push(String(m)) };
  env.patches = {};
  env.React = makeReact();
  // `noPluginApi` is what a Stash older than the extension points looks like.
  if (!opts.noPluginApi) {
    env.ctx.PluginApi = {
      React: env.React,
      libraries: opts.noBootstrap ? {} : { Bootstrap },
      patch: { after: (name, fn) => { (env.patches[name] = env.patches[name] || []).push(fn); } },
    };
    env.ctx.window.PluginApi = env.ctx.PluginApi;
  }
  h.run(env.ctx, SRC);
  env.opts = opts;
  // Built on request rather than always: two checks below count everything this plugin
  // put in the document, and a group Stash rendered is not that.
  env.addTask = (name) => taskGroup(env, name ||
    (PLUGIN_NAME + ' (' + (opts.installed || '0.5.0') + ')'));

  // Stash rendering the two container components: each renders its children, and the
  // after-patches are applied to that result in turn, exactly as `PatchFunction` does —
  // `afterFn.apply(ctx, args.concat(result))`, where `args` is **what React passed the
  // component**, not just its props.
  //
  // That second argument is the whole point of this fixture. React invokes a function
  // component as `Component(props, secondArg)`, and `secondArg` is the legacy context —
  // `emptyContextObject`, `{}`, for anything with no `contextTypes`. So a patch is handed
  // `(props, {}, result)`. This suite's first version passed `(props, result)`, which is
  // the same assumption the plugin was written from, so it confirmed the bug instead of
  // catching it: live, the `{}` was rendered as a child and React threw #31, "Objects are
  // not valid as a React child (found: object with keys {})".
  env.render = (name, props, own) => {
    let result = own;
    (env.patches[name] || []).forEach((fn) => {
      result = fn.apply(null, [props, REACT_LEGACY_CONTEXT, result]);
    });
    return result;
  };
  return env;
}

// Mounts the pane the TabContent patch produced, and returns the live instance.
function mountPane(env, props) {
  const content = env.render('ScenePage.TabContent', props, stashRendered('stash-panes'));
  const pane = nodes(content).filter((n) => n.type === Bootstrap.Tab.Pane)[0];
  const inner = kidsOf(pane)[0];
  return { pane, inst: env.React.mount(inner.type, inner.props) };
}

const rows = (el) => byClass(el, 'svr-variant').filter((n) =>
  String(n.props.className).indexOf('svr-variant-') === -1);
const inRow = (row, cls) => byClass(row, cls)[0] || null;
const titles = (el) => rows(el).map((r) => textOf(inRow(r, 'svr-variant-title')));
const linkOf = (row) => (inRow(row, 'svr-variant-title') || { props: {} }).props.href;
const roleOf = (row) => {
  const span = inRow(row, 'svr-role');
  return span ? span.props.className.replace('svr-role svr-role-', '') + ':' + textOf(span) : null;
};
const thumbOf = (row) => inRow(row, 'svr-thumb');
const summary = (el) => textOf(byClass(el, 'svr-summary')[0] || { children: [] });

(async function () {
  {
    // The strip. Stash's own tabs come through untouched and ours is spliced in ahead of
    // Edit, which is the one tab that is an action rather than a view.
    const env = start();
    const own = stashStrip(env.React, ['scene-details-panel', null, 'scene-markers-panel',
      null, 'scene-video-filter-panel', 'scene-file-info-panel', 'scene-history-panel',
      'scene-edit-panel']);
    const strip = env.render('ScenePage.Tabs', { scene: sceneProp({}) }, own);
    const items = nodes(strip).filter((n) => n.type === Bootstrap.Nav.Item);
    const link = nodes(strip).filter((n) =>
      n.type === Bootstrap.Nav.Link && n.props.eventKey === 'scene-svr-variants-panel')[0];
    h.check('a Nav.Item is added to the tab strip', items.length === 7, String(items.length));
    h.check("and Stash's own tabs all survive",
      tabKeys(strip).filter((k) => k !== 'scene-svr-variants-panel').join(' ') ===
        'scene-details-panel scene-markers-panel scene-video-filter-panel ' +
        'scene-file-info-panel scene-history-panel scene-edit-panel',
      tabKeys(strip).join(' '));
    h.check('the tab goes before Edit rather than after it',
      tabKeys(strip).indexOf('scene-svr-variants-panel') ===
        tabKeys(strip).indexOf('scene-edit-panel') - 1, tabKeys(strip).join(' '));
    h.check('the tab is captioned Variants', !!link && textOf(link) === 'Variants', textOf(link));
    // Amber, so the one tab Stash did not put in the strip says so. A class rather than a
    // Bootstrap variant because a Nav.Link has none to borrow.
    h.check('and carries the class that colours it amber',
      !!link && link.props.className === 'svr-tab-link', link && link.props.className);
    // **The class only wins if the selector outranks Bootstrap's.** `.nav-tabs .nav-link`
    // is where the colour it replaces is set, so a bare `.svr-tab-link` loses the cascade
    // and the tab stays Stash's grey — a failure no suite here can see, since there is no
    // layout engine and nothing else reads this stylesheet. The repo has been bitten by
    // exactly this before, with Bootstrap's `!important` spacing utilities, so the
    // scoping is pinned rather than left to a live look.
    const sheet = env.ctx.document.head.descendants()
      .filter((n) => n.tagName === 'STYLE').map((n) => n.textContent).join('');
    // Every occurrence, not just the first: the rule names four selectors, because
    // Bootstrap sets the colour separately for the link, its hover, its focus and the
    // active tab, and one of them left unscoped is one state that reverts.
    const tabSelectors = sheet.split('.svr-tab-link').slice(0, -1);
    h.check('and every selector colouring it outranks Bootstrap\'s own',
      tabSelectors.length === 4 && tabSelectors.every((before) => /\.nav-tabs $/.test(before)),
      tabSelectors.map((b2) => b2.slice(-14)).join(' | '));
    // The key sits in the namespace Stash's own nine tab keys use, and `activeTabKey` is
    // a plain useState with no whitelist - so a key of our own is selectable like theirs.
    h.check('the tab key is in the scene page\'s own key namespace',
      link.props.eventKey === 'scene-svr-variants-panel', link.props.eventKey);
    // Placement is an *attempt*: a Stash that renames or drops its Edit tab loses the
    // position, not the tab. Appending is what this did before there was a position to
    // want, so it is also the fallback.
    const noEdit = stashStrip(env.React, ['scene-details-panel', 'scene-history-panel']);
    const fallback = env.render('ScenePage.Tabs', { scene: sceneProp({}) }, noEdit);
    h.check('with no Edit tab to find, ours is appended rather than lost',
      tabKeys(fallback).join(' ') ===
        'scene-details-panel scene-history-panel scene-svr-variants-panel',
      tabKeys(fallback).join(' '));

    // The patch takes its result off the *end* of the arguments rather than by position,
    // so React's legacy-context second argument cannot end up rendered as a child. Both
    // patches are checked, because getting this right in one and wrong in the other is
    // exactly what a positional signature invites.
    ['ScenePage.Tabs', 'ScenePage.TabContent'].forEach((name) => {
      h.check(name + " does not render React's legacy context object as a child",
        nodes(env.render(name, { scene: sceneProp({}) }, own))
          .indexOf(REACT_LEGACY_CONTEXT) === -1);
      // And if the shape ever changes again, the page survives it. Being wrong about
      // which argument is the result does not degrade to a missing tab — it takes the
      // whole scene view down with a React error, for a plugin that only reads. So a
      // call with nothing element-shaped in it adds nothing and returns what it was
      // given, which is the page exactly as it would have been without this plugin.
      const fn = env.patches[name][0];
      const passthrough = fn.apply(null, [{ scene: sceneProp({}) }, REACT_LEGACY_CONTEXT]);
      h.check(name + ' appends nothing when no argument is an element',
        passthrough === REACT_LEGACY_CONTEXT, JSON.stringify(passthrough));
    });
  }

  {
    const env = start();
    const props = { scene: sceneProp({}) };
    const own = stashRendered('stash-panes');
    const content = env.render('ScenePage.TabContent', props, own);
    const pane = nodes(content).filter((n) => n.type === Bootstrap.Tab.Pane)[0];
    h.check('a Tab.Pane is appended to the tab content', !!pane);
    h.check('under the same key the strip named',
      pane.props.eventKey === 'scene-svr-variants-panel', pane.props.eventKey);
    h.check("and Stash's own panes are kept", nodes(content).indexOf(own) !== -1);
  }

  {
    const env = start();
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    // Before the query lands the pane says so rather than rendering an empty list, which
    // would read as "no siblings" for as long as the round trip takes.
    h.check('the pane says it is looking while the query is out',
      textOf(inst.el).indexOf('Looking for variants') !== -1, textOf(inst.el));
    await h.flush();
    h.check('the viewed scene is not listed as its own variant',
      titles(inst.el).indexOf('Cool Shoot - Clip 2') === -1, titles(inst.el).join(' | '));
    // Full-length first even though the untagged rip is the longer file, then by running
    // time: the rip outranks the 5-minute partial.
    h.check('full-length first, then longest',
      JSON.stringify(titles(inst.el)) ===
        JSON.stringify(['Cool Shoot', 'Cool Shoot (rip)', 'Cool Shoot - Clip 1']),
      titles(inst.el).join(' | '));
    h.check('the first line counts them and says what matched them',
      summary(inst.el) === '3 other variants of this scene. Matched on 1 stash-id.',
      summary(inst.el));
    // The value at the head of the facts line, not trailing the title: titles vary in
    // length, so a value after one starts somewhere different on every row and the eye
    // has to hunt for it.
    const firstRow = rows(inst.el)[0];
    const facts = inRow(firstRow, 'svr-facts');
    h.check('the value and the file facts share the line under the title',
      !!facts && byClass(facts, 'svr-role').length === 1 && byClass(facts, 'svr-meta').length === 1,
      facts && textOf(facts));
    h.check('and the value comes first on it',
      !!facts && kidsOf(facts)[0] === byClass(facts, 'svr-role')[0], facts && textOf(facts));
    h.check('with the title outside that line',
      !!facts && byClass(facts, 'svr-variant-title').length === 0);
    h.check('each row links to its scene',
      rows(inst.el).map(linkOf).join(' ') === '/scenes/9 /scenes/55 /scenes/77',
      rows(inst.el).map(linkOf).join(' '));
    // The one thing in the query that is neither a guess nor a preference. The stash IDs
    // criterion accepts four modifiers and rejects the rest outright, INCLUDES among
    // them - which is the natural guess for a list criterion, is what every other list
    // filter in Stash takes, and is what shipped and failed on a live server. EQUALS
    // over a list ORs the ids, which is the "any of these" the tab needs.
    const sib = env.calls.filter((c) => c.query.indexOf('SVRVariants') !== -1)[0].query;
    h.check('the variant query asks with EQUALS, the modifier the server accepts',
      sib.indexOf('modifier: EQUALS') !== -1 && sib.indexOf('INCLUDES') === -1, sib);
    // The stash-ids come off the props Stash already handed us, so nothing looks the
    // scene up first. A second query here is the two-round-trip version coming back.
    h.check('the scene itself is never queried - its stash-ids came from the props',
      env.calls.every((c) => c.query.indexOf('findScene(') === -1),
      env.calls.map((c) => c.query.slice(0, 40)).join(' | '));
  }

  {
    const env = start();
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('a full-length variant is named and marked',
      roleOf(rows(inst.el)[0]) === 'fl:Full-length', roleOf(rows(inst.el)[0]));
    h.check('an untagged variant is listed with no role at all',
      roleOf(rows(inst.el)[1]) === null, roleOf(rows(inst.el)[1]));
    // The label is the dimension's *value*. It shipped echoing the configured tag name
    // back, which is the same string on every row of a value and, in a taxonomy of
    // Unicode-marked namespaces, unreadable in a column meant to be scanned.
    h.check('the label names the value, not the tag that carried it',
      rows(inst.el).every((r) => {
        const role = roleOf(r);
        return role === null || role.indexOf('Full Length') === -1;
      }), rows(inst.el).map(roleOf).join(' | '));
    h.check('and the tag that decided it is on the hover text',
      inRow(rows(inst.el)[0], 'svr-role').props.title === 'Tagged Full Length',
      inRow(rows(inst.el)[0], 'svr-role').props.title);
    h.check('a partial-length variant is named and marked',
      roleOf(rows(inst.el)[2]) === 'pl:Partial-length', roleOf(rows(inst.el)[2]));
  }

  {
    // The names are typed into a settings box by hand, so a comparison that respected
    // either the case or the padding would classify nothing.
    const env = start({ settings: {
      a1FullLengthTag: '  full length  ', a2PartialLengthTag: 'PARTIAL LENGTH' } });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('the tag name match ignores case and surrounding space',
      roleOf(rows(inst.el)[0]) === 'fl:Full-length' &&
        roleOf(rows(inst.el)[2]) === 'pl:Partial-length',
      rows(inst.el).map(roleOf).join(' | '));
  }

  {
    // A tag is found by any of its aliases as well as by its name. The alias is what the
    // user typed; the row still says which tag the *scene* carries, since that is the
    // question the hover text answers.
    const env = start({ settings: { a1FullLengthTag: 'FL', a2PartialLengthTag: 'clip' } });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('a tag named by one of its aliases classifies the same way',
      roleOf(rows(inst.el)[0]) === 'fl:Full-length' &&
        roleOf(rows(inst.el)[2]) === 'pl:Partial-length',
      rows(inst.el).map(roleOf).join(' | '));
    h.check('and the hover text names the tag the scene carries, not the alias typed',
      inRow(rows(inst.el)[0], 'svr-role').props.title === 'Tagged Full Length',
      inRow(rows(inst.el)[0], 'svr-role').props.title);
  }

  {
    // A descendant of a configured tag counts as that tag: a taxonomy puts the specific
    // tags under the general one, and naming the general one is how a user says "any of
    // these". Two levels down, because a one-level answer looks the same as a correct one
    // against a child.
    const env = start({ siblings: [
      { id: '9', title: 'Trailer cut', tags: [{ id: '3', name: 'Trailer' }],
        files: [{ duration: 60 }] },
      { id: '10', title: 'Teaser cut', tags: [{ id: '4', name: 'Teaser' }],
        files: [{ duration: 30 }] },
      { id: '11', title: 'Something else', tags: [{ id: '5', name: 'Unrelated' }],
        files: [{ duration: 90 }] },
    ] });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    // Unclassified sorts above partial-length, so the untagged one leads and the two
    // descendants follow it longest-first.
    h.check('a child of the configured tag classifies as that tag',
      roleOf(rows(inst.el)[1]) === 'pl:Partial-length', roleOf(rows(inst.el)[1]));
    h.check('and so does a grandchild',
      roleOf(rows(inst.el)[2]) === 'pl:Partial-length', roleOf(rows(inst.el)[2]));
    h.check('while a tag outside the subtree still classifies as nothing',
      roleOf(rows(inst.el)[0]) === null, roleOf(rows(inst.el)[0]));
    h.check('the hover text names the descendant the scene actually carries',
      inRow(rows(inst.el)[1], 'svr-role').props.title === 'Tagged Trailer',
      inRow(rows(inst.el)[1], 'svr-role').props.title);
  }

  {
    // Two settings resolving to one tag, or to two tags one of which contains the other,
    // makes every scene under the overlap a contradiction - a settings mistake reported as
    // a scene-level error, which is the wrong place to go looking. The pane says so once,
    // above the summary, and still lists the rows.
    const conflictOf = (el) => textOf(byClass(el, 'svr-conflict')[0] || { children: [] });

    let env = start();
    let inst = mountPane(env, { scene: sceneProp({}) }).inst;
    await h.flush();
    h.check('two unrelated tags produce no warning', conflictOf(inst.el) === '',
      conflictOf(inst.el));

    env = start({ settings: { a1FullLengthTag: 'Full Length', a2PartialLengthTag: 'FL' } });
    inst = mountPane(env, { scene: sceneProp({}) }).inst;
    await h.flush();
    h.check('the same tag under both settings is warned about',
      conflictOf(inst.el).indexOf('same tag (Full Length)') !== -1, conflictOf(inst.el));

    env = start({ settings: { a1FullLengthTag: 'Trailer', a2PartialLengthTag: 'Partial Length' } });
    inst = mountPane(env, { scene: sceneProp({}) }).inst;
    await h.flush();
    h.check('and so is a pair where one tag is a descendant of the other',
      conflictOf(inst.el).indexOf('related in the tag hierarchy') !== -1 &&
        conflictOf(inst.el).indexOf('Trailer') !== -1, conflictOf(inst.el));
    h.check('the rows are still listed under it', rows(inst.el).length === 3,
      String(rows(inst.el).length));
    // Descendants are what makes this asymmetric-looking case symmetric: Teaser is under
    // Trailer, so naming the two of them either way round is the same overlap.
    env = start({ settings: { a1FullLengthTag: 'Teaser', a2PartialLengthTag: 'Trailer' } });
    inst = mountPane(env, { scene: sceneProp({}) }).inst;
    await h.flush();
    h.check('either way round', conflictOf(inst.el).indexOf('related in the tag hierarchy') !== -1,
      conflictOf(inst.el));

    env = start({ settings: { a1FullLengthTag: 'Full Length', a2PartialLengthTag: '' } });
    inst = mountPane(env, { scene: sceneProp({}) }).inst;
    await h.flush();
    h.check('and one name on its own can conflict with nothing', conflictOf(inst.el) === '',
      conflictOf(inst.el));
  }

  {
    // The tag tree is the only thing that can classify a row now, so a query that fails
    // is reported however the logging setting is set - the alternative is a pane that
    // looks exactly like two tag names matching nothing.
    const env = start({ tagsFail: true });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('a failed tag query still lists the variants', rows(inst.el).length === 3,
      String(rows(inst.el).length));
    h.check('classifies none of them', rows(inst.el).every((r) => roleOf(r) === null));
    h.check('and says so on the console',
      env.warnings.some((w) => w.indexOf('tag list could not be read') !== -1),
      env.warnings.join(' | '));
  }

  {
    // The cover and the preview loop. One `<video poster>` rather than an image with a
    // video stacked over it, so the cover is there before anything is fetched and
    // `preload="none"` keeps three previews on a page from being three downloads nobody
    // asked for.
    const env = start();
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    const withPreview = rows(inst.el)[0];              // scene 9, cover and preview
    const coverOnly = rows(inst.el)[2];                // scene 77, cover, no preview
    const neither = rows(inst.el)[1];                  // scene 55, neither

    const v = thumbOf(withPreview);
    h.check('a variant with a preview gets a video', !!v && v.type === 'video', v && v.type);
    h.check('showing its cover until it is played',
      !!v && v.props.poster === '/scene/9/screenshot' && v.props.src === '/scene/9/preview',
      v && JSON.stringify({ poster: v.props.poster, src: v.props.src }));
    h.check('and fetching nothing until then',
      !!v && v.props.preload === 'none' && v.props.muted === true && v.props.loop === true,
      v && JSON.stringify({ preload: v.props.preload, muted: v.props.muted, loop: v.props.loop }));

    // A pointer crossing a row before the page has been interacted with makes the browser
    // reject `play()`, and an uncaught rejection in a mouse handler is a console error on
    // every hover. The fake element hands back a rejected promise to prove it is caught.
    let played = false, reset = false;
    const video = { play() { played = true; return Promise.reject(new Error('not allowed')); },
      pause() { throw new Error('pause leaves the last frame on screen'); },
      load() { reset = true; }, currentTime: 99 };
    v.props.onMouseEnter({ currentTarget: video });
    await h.flush(3);
    h.check('hovering plays it, and a browser refusing to is not an error', played);
    // `pause()` leaves the frame it stopped on, and rewinding only moves that to frame
    // zero of the *preview*: the poster is painted while the element has no frame at all,
    // which is the state `load()` returns it to. Both of those were live symptoms - the
    // last frame on the first hover, the first frame on every one after.
    v.props.onMouseLeave({ currentTarget: video });
    h.check('and leaving puts the cover back rather than leaving a frame up', reset);

    const img = thumbOf(coverOnly);
    h.check('a variant with no preview generated gets a plain cover',
      !!img && img.type === 'img' && img.props.src === '/scene/77/screenshot',
      img && img.type);
    h.check('and a variant with neither gets no thumbnail rather than a broken one',
      thumbOf(neither) === null);
    h.check('the cover links to the scene too',
      byClass(withPreview, 'svr-thumb-link')[0].props.href === '/scenes/9');
    // An anchor inside an anchor is invalid markup that browsers resolve by closing the
    // outer one early, so the row itself must not be one.
    h.check('and the row itself is not a second anchor around it',
      withPreview.type === 'div', withPreview.type);
  }

  {
    // The hover delta: what this variant carries that the viewed scene does not, what it
    // is missing, and which attributes disagree. The tags by name, the attributes **by
    // name only** - a title and a details block are paragraphs, and a tooltip quoting both
    // sides would be a diff view nobody asked for.
    const env = start({ siblings: [
      // The viewed scene, as the query returns it. It is the same query that lists the
      // variants, so both sides of every comparison are the same fields.
      { id: '42', title: 'Cool Shoot - Clip 2', date: '2020-01-01', rating100: 80,
        studio: { id: 's1', name: 'Acme' },
        performers: [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Bea' }],
        tags: [{ id: '2', name: 'Partial Length' }, { id: '5', name: 'Unrelated' }],
        files: [{ duration: 243 }] },
      { id: '9', title: 'Cool Shoot', date: '2020-01-01', rating100: 60,
        studio: { id: 's1', name: 'Acme' },
        // The same two performers in the other order: two scenes holding the same cast
        // are not two scenes that disagree about it.
        performers: [{ id: 'p2', name: 'Bea' }, { id: 'p1', name: 'Ada' }],
        tags: [{ id: '1', name: 'Full Length' }],
        files: [{ duration: 2472 }] },
    ] });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    const lines = String(rows(inst.el)[0].props.title || '').split('\n');
    h.check('a row names the tags the variant has and this scene does not',
      lines[0] === 'Extra 1 tag: Full Length', lines[0]);
    h.check('and the ones this scene has and it does not, sorted by name',
      lines[1] === 'Missing 2 tags: Partial Length, Unrelated', lines[1]);
    h.check('then the attributes that disagree, by name and in no particular hurry',
      lines[2] === 'Attributes that differ: Title, Rating', lines[2]);
    h.check('a list attribute in a different order is not a difference',
      lines[2].indexOf('Performers') === -1 && lines[2].indexOf('Studio') === -1, lines[2]);
    // The whole point of "name only": no value from either side appears anywhere in it.
    h.check('and no value from either side is quoted',
      ['Cool Shoot', '80', '60', 'Acme', '2020'].every((v) => lines[2].indexOf(v) === -1),
      lines[2]);
    h.check('the delta is on the row, so anywhere in it answers',
      rows(inst.el)[0].type === 'div' && byClass(rows(inst.el)[0], 'svr-variant').length === 1);
  }

  {
    // A row with nothing to report says so. An empty tooltip is indistinguishable from a
    // tooltip that was never built, and "these two are the same in everything I can see"
    // is an answer.
    const env = start({ siblings: [
      { id: '42', title: 'Same', tags: [{ id: '1', name: 'Full Length' }],
        files: [{ duration: 60 }] },
      { id: '9', title: 'Same', tags: [{ id: '1', name: 'Full Length' }],
        files: [{ duration: 60 }] },
    ] });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('an identical variant says it is identical',
      rows(inst.el)[0].props.title === 'Same tags and attributes as this scene.',
      rows(inst.el)[0].props.title);
  }

  {
    // Nothing to compare against rather than something wrong to compare against: with the
    // viewed scene missing from the answer, a row reports no difference at all.
    const env = start({ siblings: [
      { id: '9', title: 'Cool Shoot', tags: [], files: [{ duration: 60 }] },
    ] });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('a variant set that does not include the viewed scene carries no delta',
      !rows(inst.el)[0].props.title, rows(inst.el)[0].props.title);
  }

  {
    // Both tags on one scene is a contradiction rather than a tie: the two values are
    // mutually exclusive by definition, so it is reported rather than resolved by
    // whichever test ran first.
    const env = start({ siblings: [
      { id: '9', title: 'Confused', tags: [{ id: '1', name: 'Full Length' },
        { id: '2', name: 'Partial Length' }], files: [{ duration: 60 }] },
    ] });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('a scene carrying both tags is flagged rather than classified',
      roleOf(rows(inst.el)[0]) === 'bad:⚠ both', roleOf(rows(inst.el)[0]));
  }

  {
    const env = start({ settings: { a1FullLengthTag: '', a2PartialLengthTag: '' } });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('with no tag names configured the pane still lists the variants',
      titles(inst.el).length === 3, titles(inst.el).join(' | '));
    h.check('and classifies none of them', rows(inst.el).every((r) => roleOf(r) === null));
  }

  {
    // The rows are classified against the user's tag names, and those arrive over the
    // wire. A pane that rendered against the empty defaults because the settings had not
    // landed yet would be wrong for as long as the tab stayed open, since nothing
    // re-renders it afterwards.
    const env = start();
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    const settingsAt = env.calls.findIndex((c) => c.query.indexOf('configuration') !== -1);
    const siblingsAt = env.calls.findIndex((c) => c.query.indexOf('SVRVariants') !== -1);
    h.check('the settings are read before the rows are classified',
      settingsAt !== -1 && settingsAt < siblingsAt,
      'settings at ' + settingsAt + ', siblings at ' + siblingsAt);
    h.check('so the classification uses them', roleOf(rows(inst.el)[0]) === 'fl:Full-length');
  }

  {
    const env = start({ stashIds: [] });
    const { inst } = mountPane(env, { scene: sceneProp({ stashIds: [] }) });
    await h.flush();
    h.check('a scene with no stash-id lists nothing', rows(inst.el).length === 0);
    // The tab is always there, so this is the one place the reason can be given - and it
    // is the ordinary case, not an error. It reads as a fact about the library.
    h.check('and the pane says which of the reasons applies',
      summary(inst.el).indexOf('carries no stash-id') !== -1, summary(inst.el));
    h.check('and the variant query is never sent',
      env.calls.every((c) => c.query.indexOf('SVRVariants') === -1),
      env.calls.map((c) => c.query.slice(0, 30)).join(' | '));
  }

  {
    const env = start({ siblings: [] });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('a stash-id nobody shares lists nothing and says so',
      rows(inst.el).length === 0 && summary(inst.el).indexOf('No other scene shares') !== -1,
      summary(inst.el));
  }

  {
    // A filter field named differently on this Stash looks exactly like a scene with no
    // variants, and only one of those is worth reporting - so the failure is loud
    // whatever the logging setting says, and the pane names it rather than going quiet.
    const env = start({ siblingsFail: true });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('a failed variant query lists nothing', rows(inst.el).length === 0);
    h.check('and says so on the console without being asked',
      env.warnings.some((w) => w.indexOf('variant lookup failed for scene 42') !== -1),
      env.warnings.join(' | '));
    h.check('and says so in the pane too',
      summary(inst.el).indexOf('The variant query failed') !== -1, summary(inst.el));
  }

  {
    // Walking the queue changes the scene under a mounted pane. The effect is keyed on
    // the scene id, so it re-runs; a pane keyed on nothing would go on showing the
    // previous scene's variants for as long as the tab stayed open.
    const env = start();
    const content = env.render('ScenePage.TabContent', { scene: sceneProp({}) },
      stashRendered('stash-panes'));
    const inner = kidsOf(nodes(content).filter((n) => n.type === Bootstrap.Tab.Pane)[0])[0];
    const props = { scene: sceneProp({}) };
    const inst = env.React.mount(inner.type, props);
    await h.flush();
    const before = env.calls.filter((c) => c.query.indexOf('SVRVariants') !== -1).length;
    inst.render();
    await h.flush();
    h.check('re-rendering the same scene asks the server nothing further',
      env.calls.filter((c) => c.query.indexOf('SVRVariants') !== -1).length === before,
      String(env.calls.filter((c) => c.query.indexOf('SVRVariants') !== -1).length));
    props.scene = { id: '99', stash_ids: [{ endpoint: 'e', stash_id: 'xyz' }] };
    inst.render();
    await h.flush();
    h.check('but moving to another scene re-runs the lookup',
      env.calls.filter((c) => c.query.indexOf('SVRVariants') !== -1).length === before + 1);
    h.check('and the new scene is the one excluded from its own list',
      titles(inst.el).indexOf('Cool Shoot - Clip 2') !== -1, titles(inst.el).join(' | '));
  }

  {
    // No extension points, no tab - and no hand-built imitation of one either. A second
    // implementation would have to reproduce tab activation and pane switching, which is
    // exactly what patching gets for free.
    const env = start({ noPluginApi: true });
    h.check('a Stash without the extension points gets no tab and no DOM fallback',
      env.body.descendants().length === 0, String(env.body.descendants().length));
  }

  {
    const env = start({ noBootstrap: true });
    h.check('and neither does one whose PluginApi has no react-bootstrap',
      Object.keys(env.patches).length === 0, Object.keys(env.patches).join(' '));
  }

  // ── The migration task ────────────────────────────────────────────────────
  //
  // The one thing in this plugin that writes. Every check here is about the same two
  // rules: what it plans is on screen before anything moves, and what it wrote can be
  // put back while the dialog is open.

  // A library of tagged scenes for the scan to walk. Two partials carrying stash-ids, a
  // full-length one, a partial that has been through this already, a partial with no
  // stash-id at all and an untagged scene that the filter would not have returned but
  // which is classified out anyway.
  function migrationLibrary() {
    return [
      { id: '42', title: 'Clip 2', tags: [{ id: '2' }], custom_fields: {},
        stash_ids: [{ endpoint: 'https://stashdb.org/graphql', stash_id: 'abc' }] },
      { id: '77', title: 'Clip 1', tags: [{ id: '3' }], custom_fields: {},
        stash_ids: [{ endpoint: 'https://stashdb.org/graphql', stash_id: 'abc' },
          { endpoint: 'https://theporndb.net/graphql', stash_id: 'zzz' }] },
      { id: '9', title: 'Cool Shoot', tags: [{ id: '1' }], custom_fields: {},
        stash_ids: [{ endpoint: 'https://stashdb.org/graphql', stash_id: 'abc' }] },
      { id: '11', title: 'Done already', tags: [{ id: '2' }],
        custom_fields: { 'ᱜ╦╦🞮_Variant_Stash_ID': 'stashdb.org:abc' }, stash_ids: [] },
      { id: '12', title: 'Never scraped', tags: [{ id: '2' }], custom_fields: {}, stash_ids: [] },
    ];
  }

  const dlg = (env) => h.dialog(env.body, 'svr');
  const jobLines = (env) => env.body.descendants()
    .filter((n) => h.hasClass(n, 'svr-job')).map((n) => n.textContent);

  function openTask(env) {
    h.fire(env.ctx.document, 'click', { target: env.addTask() });
    return h.flush(80);
  }

  {
    const env = start({ library: migrationLibrary() });
    await openTask(env);
    h.check('the task button opens the dialog', dlg(env).open);
    h.check('whose head recommends a backup, because it writes',
      /Backing up your database before proceeding is recommended/.test(
        (env.body.descendants().filter((n) => h.hasClass(n, 'svr-warn'))[0] || {}).textContent || ''));
    // Classified by the same expanded tag ids the tab classifies rows with: Trailer (3)
    // is a child of Partial Length and Clip an alias of it, so scene 77 is planned
    // without the settings naming either.
    h.check('the scan asks for the two tags and everything under them',
      (env.opts.scanTags || []).slice().sort().join(',') === '1,2,3,4',
      (env.opts.scanTags || []).join(','));

    const lines = jobLines(env);
    h.check('a partial-length scene is planned, with its stash-ids to be removed',
      lines.some((l) => /Partial-length.*Clip 2 \[42\].*stashdb\.org:abc.*stash-ids removed/.test(l)),
      lines.join(' | '));
    h.check('a scene with two stash-ids stores both, one per line',
      lines.some((l) => /Clip 1 \[77\].*stashdb\.org:abc \+ theporndb\.net:zzz/.test(l)),
      lines.join(' | '));
    h.check('a full-length scene is planned too, and keeps its stash-ids',
      lines.some((l) => /Full-length.*Cool Shoot \[9\]/.test(l) && !/stash-ids removed/.test(l)),
      lines.join(' | '));
    h.check('a scene already migrated is not planned again',
      !lines.some((l) => /\[11\]/.test(l)), lines.join(' | '));
    h.check('nor is one that never had a stash-id',
      !lines.some((l) => /\[12\]/.test(l)), lines.join(' | '));
    h.check('the counters say what was read and what is to be done',
      /Scanned 5 of 5 tagged scenes\. 3 scenes to migrate\./.test(dlg(env).progress),
      dlg(env).progress);
    h.check('and nothing has been written', !env.opts.writes, JSON.stringify(env.opts.writes));

    dlg(env).button('Proceed').click();
    await h.flush(120);
    const writes = env.opts.writes || [];
    h.check('Proceed writes one mutation per planned scene', writes.length === 3,
      String(writes.length));
    const partial = writes.filter((w) => w.id === '42')[0];
    h.check('the partial gets the field and loses its stash-ids',
      partial.custom_fields.partial['ᱜ╦╦🞮_Variant_Stash_ID'] === 'stashdb.org:abc' &&
        JSON.stringify(partial.stash_ids) === '[]', JSON.stringify(partial));
    const full = writes.filter((w) => w.id === '9')[0];
    h.check('the full-length one gets the field and keeps them',
      full.custom_fields.partial['ᱜ╦╦🞮_Variant_Stash_ID'] === 'stashdb.org:abc' &&
        full.stash_ids === undefined, JSON.stringify(full));
    h.check('through partial, so every other custom field the scene has is left alone',
      writes.every((w) => w.custom_fields.full === undefined), JSON.stringify(writes));
    h.check('and the library really carries it',
      env.opts.library.filter((sc) => sc.id === '42')[0]
        .custom_fields['ᱜ╦╦🞮_Variant_Stash_ID'] === 'stashdb.org:abc');
    h.check('the write button becomes Undo', !!dlg(env).button('Undo') && !dlg(env).button('Proceed'));

    dlg(env).button('Undo').click();
    await h.flush(120);
    const back = (env.opts.writes || []).slice(3);
    h.check('Undo writes one back per scene written', back.length === 3, String(back.length));
    const undone = back.filter((w) => w.id === '42')[0];
    h.check('removing the field the scene never had rather than emptying it',
      JSON.stringify(undone.custom_fields.remove) === '["ᱜ╦╦🞮_Variant_Stash_ID"]',
      JSON.stringify(undone.custom_fields));
    h.check('and putting the stash-ids back on',
      undone.stash_ids.length === 1 && undone.stash_ids[0].stash_id === 'abc',
      JSON.stringify(undone.stash_ids));
    h.check('the library is back to what it held',
      !env.opts.library.filter((sc) => sc.id === '42')[0]
        .custom_fields['ᱜ╦╦🞮_Variant_Stash_ID'],
      JSON.stringify(env.opts.library[0].custom_fields));
    h.check('and Proceed is offered again', !!dlg(env).button('Proceed'));
  }

  {
    // A field somebody had already filled in by hand is put back to what it said, not
    // removed - the undo is the inverse of what was written, not a delete.
    const lib = migrationLibrary();
    lib[0].custom_fields = { 'ᱜ╦╦🞮_Variant_Stash_ID': 'something else' };
    const env = start({ library: lib });
    await openTask(env);
    dlg(env).button('Proceed').click();
    await h.flush(120);
    dlg(env).button('Undo').click();
    await h.flush(120);
    const undone = (env.opts.writes || []).filter((w) => w.id === '42').slice(-1)[0];
    h.check('an undo restores a value the field already held',
      undone.custom_fields.partial['ᱜ╦╦🞮_Variant_Stash_ID'] === 'something else',
      JSON.stringify(undone.custom_fields));
  }

  {
    // Both tag settings empty: nothing to classify, so nothing to scan. Saying so beats
    // an empty listing, which reads as "your library is fine".
    const env = start({ library: migrationLibrary(),
      settings: { a1FullLengthTag: '', a2PartialLengthTag: '' } });
    await openTask(env);
    h.check('with neither tag configured the task explains rather than listing nothing',
      dlg(env).lines.some((l) => /neither the full-length nor the partial-length tag/i.test(l)),
      dlg(env).lines.join(' | '));
    h.check('and Proceed is disabled', dlg(env).button('Proceed').disabled);
  }

  {
    // A stale script must not write: what it would write is the previous release's idea
    // of the plan, and the settings page's own banner cannot reach a dialog.
    const env = start({ library: migrationLibrary(), installed: '9.9.9' });
    await openTask(env);
    h.check('a stale script is refused the write and told why',
      dlg(env).button('Proceed').disabled && /9\.9\.9 is installed/.test(dlg(env).stale),
      dlg(env).stale);
  }

  {
    const env = start({ library: migrationLibrary(),
      failWrite: (input) => input.id === '77' });
    await openTask(env);
    dlg(env).button('Proceed').click();
    await h.flush(120);
    h.check('one scene failing is one scene, not the run',
      /2 scenes written\. 1 failure\./.test(dlg(env).progress), dlg(env).progress);
    h.check('and the failure is named in the log',
      dlg(env).lines.some((l) => /ERROR.*\[77\].*write boom/.test(l)), dlg(env).lines.join(' | '));
    h.check('Undo offers back only what was written',
      !!dlg(env).button('Undo'));
    dlg(env).button('Undo').click();
    await h.flush(120);
    h.check('which is the two that landed',
      (env.opts.writes || []).slice(3).length === 2, String((env.opts.writes || []).slice(3).length));
  }

  {
    // The lease: taken for the writes and gone afterwards, which is what a sibling
    // reactive plugin reads.
    const env = start({ library: migrationLibrary() });
    await openTask(env);
    const leases = () => env.ctx.__GTTx__.StashPluginCoop.leases;
    h.check('no lease is held while the dialog is only listing', leases().length === 0);
    dlg(env).button('Proceed').click();
    // Read before any flush: the lease is taken on the press and this fixture's three
    // writes resolve in a couple of ticks, so anything asynchronous here would be asking
    // after they had already finished.
    h.check('one is held while the writes go out',
      leases().length === 1 && leases()[0].owner === 'SceneVariants', JSON.stringify(leases()));
    await h.flush(160);
    h.check('and released when they are done', leases().length === 0, JSON.stringify(leases()));
  }

  {
    // Escape closes through the footer, and the handler goes with the dialog.
    const env = start({ library: migrationLibrary() });
    await openTask(env);
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('Escape closes the dialog', !dlg(env).open);
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('and its handler went with it', !dlg(env).open);
  }

  // ── Matching on the custom field ──────────────────────────────────────────

  {
    // A migrated partial: no stash-id at all, so the only evidence is the field. The
    // stash-id query must not be asked, and the field query must be.
    const env = start({
      ownFields: { 'ᱜ╦╦🞮_Variant_Stash_ID': 'stashdb.org:abc' },
      byField: SIBLINGS,
    });
    const { inst } = mountPane(env, { scene: sceneProp({ stashIds: [] }) });
    await h.flush();
    h.check('a scene with no stash-id is looked up by its variant stash-id field',
      env.calls.some((c) => c.query.indexOf('SVRFieldMatch') !== -1) &&
        !env.calls.some((c) => c.query.indexOf('SVRVariants(') !== -1),
      env.calls.map((c) => c.query.slice(0, 30)).join(' | '));
    h.check('and its variants are listed', titles(inst.el).length === 3,
      titles(inst.el).join(' | '));
    h.check('the summary says what matched them',
      /Matched on 1 variant stash-id\./.test(summary(inst.el)), summary(inst.el));
  }

  {
    // A scene that still has one asks both, and the two answers are one list: a scene
    // found by both queries is listed once.
    const env = start({ byField: [SIBLINGS[1], { id: '81', title: 'Only by field', tags: [],
      files: [{ duration: 100, width: 640, height: 360 }] }] });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('the field query is asked with the value the stash-id would be stored as',
      JSON.stringify(((env.opts.fieldAsked || [])[0] || {}).values) === '["stashdb.org:abc"]',
      JSON.stringify((env.opts.fieldAsked || [])[0]));
    h.check('a scene both queries found is listed once',
      titles(inst.el).filter((t) => t === 'Cool Shoot - Clip 1').length === 1,
      titles(inst.el).join(' | '));
    h.check('and one only the field query found is listed as well',
      titles(inst.el).indexOf('Only by field') !== -1, titles(inst.el).join(' | '));
  }

  {
    // Half an answer beats none: a Stash that spells the custom-field criterion
    // differently loses that half and keeps the stash-id matches.
    const env = start({ fieldFail: true });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('a custom-field criterion this server refuses does not empty the tab',
      titles(inst.el).length === 3, titles(inst.el).join(' | '));
    h.check('and it says so on the console rather than silently',
      env.warnings.some((w) => /custom-field lookup failed/.test(w)), env.warnings.join(' | '));
  }

  {
    // Neither kind of evidence: the sentence names both, because a user reading it is
    // deciding whether this scene should have been migrated.
    const env = start({ ownFields: {} });
    const { inst } = mountPane(env, { scene: sceneProp({ stashIds: [] }) });
    await h.flush();
    h.check('a scene with neither is told so, naming both',
      /no stash-id and no "ᱜ╦╦🞮_Variant_Stash_ID" custom field/.test(summary(inst.el)),
      summary(inst.el));
  }

  h.finish();
}());
