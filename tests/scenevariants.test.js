// SceneVariants: the Siblings tab.
//
// The plugin makes no mutation, so there is nothing to assert about writes. What is
// worth pinning is the shape of the answer: which scenes it decides are siblings, what
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
  const flatten = (out, kid) => {
    if (Array.isArray(kid)) kid.forEach((k) => flatten(out, k));
    else if (kid !== null && kid !== undefined && kid !== false) out.push(kid);
    return out;
  };
  const React = {
    Fragment,
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.reduce(flatten, []) };
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

function walk(node, out) {
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach((k) => walk(k, out));
  return out;
}
const nodes = (el) => walk(el, []);
const byClass = (el, cls) => nodes(el).filter((n) =>
  String((n.props || {}).className || '').split(' ').indexOf(cls) !== -1);
const textOf = (n) => (n.children || []).map((k) =>
  (typeof k === 'object' ? textOf(k) : String(k))).join('');

// The legacy context object React hands a function component as its second argument.
// One shared identity so a check can look for it by reference in a rendered tree.
const REACT_LEGACY_CONTEXT = {};

// ── The fixture ─────────────────────────────────────────────────────────────

// Scene 42, one stash-id, three siblings sharing it: a full-length one, a partial and an
// untagged one, deliberately returned in an order the tab has to change.
const SIBLINGS = [
  { id: '42', title: 'Cool Shoot - Clip 2', tags: [{ id: '2', name: 'Partial Length' }],
    files: [{ duration: 243, width: 1920, height: 1080 }] },
  { id: '77', title: 'Cool Shoot - Clip 1', tags: [{ id: '2', name: '  partial length  ' }],
    files: [{ duration: 300, width: 1280, height: 720 }] },
  { id: '9', title: 'Cool Shoot', tags: [{ id: '1', name: 'Full Length' }],
    files: [{ duration: 2472, width: 1920, height: 1080 }] },
  // Longer than the full-length one on purpose: role has to outrank running time, or a
  // duration-only sort would pass this fixture by accident.
  { id: '55', title: 'Cool Shoot (rip)', tags: [],
    files: [{ duration: 2500, width: 3840, height: 2160 }] },
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
    if (q.indexOf('SVRSiblings') !== -1) {
      if (opts.siblingsFail) return { errors: [{ message: 'invalid modifier' }] };
      return { data: { findScenes: { scenes: opts.siblings || SIBLINGS } } };
    }
    return { data: {} };
  };
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
  const content = env.render('ScenePage.TabContent', props, { type: 'stash-panes', props: {}, children: [] });
  const pane = nodes(content).filter((n) => n.type === Bootstrap.Tab.Pane)[0];
  const inner = pane.children[0];
  return { pane, inst: env.React.mount(inner.type, inner.props) };
}

const rows = (el) => byClass(el, 'svr-sib');
const titles = (el) => rows(el).map((r) => textOf(r.children[0]));
const roleOf = (row) => {
  const span = (row.children || []).filter((n) =>
    String((n.props || {}).className || '').indexOf('svr-role') === 0)[0];
  return span ? span.props.className.replace('svr-role svr-role-', '') + ':' + textOf(span) : null;
};
const summary = (el) => textOf(byClass(el, 'svr-summary')[0] || { children: [] });

(async function () {
  {
    // The strip. Stash's own children come through untouched and ours is appended after
    // them, so the tab lands at the end of the strip rather than in the middle of it.
    const env = start();
    const own = { type: 'stash-tabs', props: {}, children: [] };
    const strip = env.render('ScenePage.Tabs', { scene: sceneProp({}) }, own);
    const items = nodes(strip).filter((n) => n.type === Bootstrap.Nav.Item);
    const link = nodes(strip).filter((n) => n.type === Bootstrap.Nav.Link)[0];
    h.check('a Nav.Item is appended to the tab strip', items.length === 1);
    h.check("and Stash's own children are kept, ahead of it",
      nodes(strip).indexOf(own) !== -1 && nodes(strip).indexOf(own) < nodes(strip).indexOf(items[0]));
    h.check('the tab is captioned Siblings', !!link && textOf(link) === 'Siblings', textOf(link));
    // The key sits in the namespace Stash's own nine tab keys use, and `activeTabKey` is
    // a plain useState with no whitelist - so a key of our own is selectable like theirs.
    h.check('the tab key is in the scene page\'s own key namespace',
      link.props.eventKey === 'scene-svr-siblings-panel', link.props.eventKey);
    // The patch takes its result off the *end* of the arguments rather than by position,
    // so React's legacy-context second argument cannot end up rendered as a child. Both
    // patches are checked, because getting this right in one and wrong in the other is
    // exactly what a positional signature invites.
    ['ScenePage.Tabs', 'ScenePage.TabContent'].forEach((name) => {
      h.check(name + " does not render React's legacy context object as a child",
        nodes(env.render(name, { scene: sceneProp({}) }, own))
          .indexOf(REACT_LEGACY_CONTEXT) === -1);
    });
  }

  {
    const env = start();
    const props = { scene: sceneProp({}) };
    const own = { type: 'stash-panes', props: {}, children: [] };
    const content = env.render('ScenePage.TabContent', props, own);
    const pane = nodes(content).filter((n) => n.type === Bootstrap.Tab.Pane)[0];
    h.check('a Tab.Pane is appended to the tab content', !!pane);
    h.check('under the same key the strip named',
      pane.props.eventKey === 'scene-svr-siblings-panel', pane.props.eventKey);
    h.check("and Stash's own panes are kept", nodes(content).indexOf(own) !== -1);
  }

  {
    const env = start();
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    // Before the query lands the pane says so rather than rendering an empty list, which
    // would read as "no siblings" for as long as the round trip takes.
    h.check('the pane says it is looking while the query is out',
      textOf(inst.el).indexOf('Looking for siblings') !== -1, textOf(inst.el));
    await h.flush();
    h.check('the viewed scene is not listed as its own sibling',
      titles(inst.el).indexOf('Cool Shoot - Clip 2') === -1, titles(inst.el).join(' | '));
    // Full-length first even though the untagged rip is the longer file, then by running
    // time: the rip outranks the 5-minute partial.
    h.check('full-length first, then longest',
      JSON.stringify(titles(inst.el)) ===
        JSON.stringify(['Cool Shoot', 'Cool Shoot (rip)', 'Cool Shoot - Clip 1']),
      titles(inst.el).join(' | '));
    h.check('the first line counts them and says what matched them',
      summary(inst.el) === '3 other scenes are the same work. Matched on 1 stash-id.',
      summary(inst.el));
    h.check('each row links to its scene',
      rows(inst.el).map((r) => r.children[0].props.href).join(' ') === '/scenes/9 /scenes/55 /scenes/77',
      rows(inst.el).map((r) => r.children[0].props.href).join(' '));
    // The one thing in the query that is neither a guess nor a preference. The stash IDs
    // criterion accepts four modifiers and rejects the rest outright, INCLUDES among
    // them - which is the natural guess for a list criterion, is what every other list
    // filter in Stash takes, and is what shipped and failed on a live server. EQUALS
    // over a list ORs the ids, which is the "any of these" the tab needs.
    const sib = env.calls.filter((c) => c.query.indexOf('SVRSiblings') !== -1)[0].query;
    h.check('the sibling query asks with EQUALS, the modifier the server accepts',
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
    h.check('a full-length sibling is named and marked',
      roleOf(rows(inst.el)[0]) === 'fl:Full Length', roleOf(rows(inst.el)[0]));
    h.check('an untagged sibling is listed with no role at all',
      roleOf(rows(inst.el)[1]) === null, roleOf(rows(inst.el)[1]));
    // The stored tag name is padded and lower-cased; these are typed into a settings box
    // by hand, so a comparison that respected either would classify nothing.
    h.check('the tag match ignores case and surrounding space',
      roleOf(rows(inst.el)[2]) === 'pl:Partial Length', roleOf(rows(inst.el)[2]));
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
      roleOf(rows(inst.el)[0]) === 'bad:both tags', roleOf(rows(inst.el)[0]));
  }

  {
    const env = start({ settings: { a1FullLengthTag: '', a2PartialLengthTag: '' } });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('with no tag names configured the pane still lists the siblings',
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
    const siblingsAt = env.calls.findIndex((c) => c.query.indexOf('SVRSiblings') !== -1);
    h.check('the settings are read before the rows are classified',
      settingsAt !== -1 && settingsAt < siblingsAt,
      'settings at ' + settingsAt + ', siblings at ' + siblingsAt);
    h.check('so the classification uses them', roleOf(rows(inst.el)[0]) === 'fl:Full Length');
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
    h.check('and the sibling query is never sent',
      env.calls.every((c) => c.query.indexOf('SVRSiblings') === -1),
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
    // siblings, and only one of those is worth reporting - so the failure is loud
    // whatever the logging setting says, and the pane names it rather than going quiet.
    const env = start({ siblingsFail: true });
    const { inst } = mountPane(env, { scene: sceneProp({}) });
    await h.flush();
    h.check('a failed sibling query lists nothing', rows(inst.el).length === 0);
    h.check('and says so on the console without being asked',
      env.warnings.some((w) => w.indexOf('sibling lookup failed for scene 42') !== -1),
      env.warnings.join(' | '));
    h.check('and says so in the pane too',
      summary(inst.el).indexOf('The sibling query failed') !== -1, summary(inst.el));
  }

  {
    // Walking the queue changes the scene under a mounted pane. The effect is keyed on
    // the scene id, so it re-runs; a pane keyed on nothing would go on showing the
    // previous scene's siblings for as long as the tab stayed open.
    const env = start();
    const content = env.render('ScenePage.TabContent', { scene: sceneProp({}) },
      { type: 'stash-panes', props: {}, children: [] });
    const inner = nodes(content).filter((n) => n.type === Bootstrap.Tab.Pane)[0].children[0];
    const props = { scene: sceneProp({}) };
    const inst = env.React.mount(inner.type, props);
    await h.flush();
    const before = env.calls.filter((c) => c.query.indexOf('SVRSiblings') !== -1).length;
    inst.render();
    await h.flush();
    h.check('re-rendering the same scene asks the server nothing further',
      env.calls.filter((c) => c.query.indexOf('SVRSiblings') !== -1).length === before,
      String(env.calls.filter((c) => c.query.indexOf('SVRSiblings') !== -1).length));
    props.scene = { id: '99', stash_ids: [{ endpoint: 'e', stash_id: 'xyz' }] };
    inst.render();
    await h.flush();
    h.check('but moving to another scene re-runs the lookup',
      env.calls.filter((c) => c.query.indexOf('SVRSiblings') !== -1).length === before + 1);
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

  h.finish();
}());
