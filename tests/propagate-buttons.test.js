// PropagateTagsAndPerformers' manual buttons and staging (D8, step 8).
//
// One button per enabled path whose target is the page being viewed, reusing the
// auto-mode machinery (AutoRun, autoContext) to plan one named entity rather than a
// second planner. A click either saves immediately (a2SaveImmediately) or - the
// default - stages into whichever form control (TagSelect / PerformerSelect) this
// plugin captured via PluginApi.patch.before, diffed against the form so a second
// click without saving reports nothing added.
//
// Placement (`.edit-buttons`) is unverified against a live Stash beyond the scene
// page - see PropagateTagsAndPerformers/CLAUDE.md §5b - so this suite is about the
// driver around that assumption, not proof the assumption holds.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const NAME = 'PropagateTagsAndPerformers';
const SRC = process.env.SRC || path.join(__dirname, '..', NAME, NAME + '.js');

const TAGS = [
  { id: '1', name: 'Blonde', sort_name: null, ignore_auto_tag: false },
  { id: '2', name: 'Outdoor', sort_name: null, ignore_auto_tag: false },
];

// A scene with one performer carrying "Blonde", which the scene does not have yet.
// Also carries a field for every other path's walk (studio, scene_markers, groups,
// scenes, galleries, sub_groups, containing_groups) - not because any one test reads
// all of them, but because `responder` hands this same object back for *any* `PTP_one_`
// query regardless of target, and the existence probe (checkButtonExistence /
// checkSourceButtonExistence) now runs before a button is even offered. A field this
// object lacks reads as "that relationship does not exist" and hides the button, which
// would silently turn every test not specifically about existence gating into one.
const SCENE = {
  id: '10', title: 'S', files: [], tags: [], organized: false,
  performers: [{ id: '100', name: 'Jane', tags: [{ id: '1' }] }],
  studio: { id: '200', name: 'Studio', tags: [{ id: '1' }] },
  scene_markers: [{ id: '300', title: 'M', primary_tag: { id: '1' }, tags: [] }],
  groups: [{ group: { id: '400', name: 'G', tags: [{ id: '1' }] } }],
  galleries: [{ id: '500', title: 'Gal', tags: [{ id: '1' }], performers: [{ id: '100', name: 'Jane' }] }],
  scenes: [{
    id: '10', title: 'S', files: [], tags: [{ id: '1' }],
    performers: [{ id: '100', name: 'Jane' }],
    scene_markers: [{ id: '300', title: 'M', primary_tag: { id: '1' }, tags: [] }],
    groups: [{ group: { id: '400', name: 'G', tags: [{ id: '1' }] } }],
  }],
  sub_groups: [{ group: { id: '600', name: 'Sub', tags: [{ id: '1' }] } }],
  containing_groups: [{ group: { id: '700', name: 'CG', tags: [{ id: '1' }] } }],
};

function responder(opts) {
  opts = opts || {};
  return function (req) {
    const q = req.query || '';
    if (q.indexOf('configuration') !== -1) {
      // `hangSettings` is a mutable flag rather than a fixed option: the interesting
      // case is a load that stops answering *after* one has already succeeded.
      if (opts.hangSettings && opts.hangSettings.on) return h.HANG;
      const plugins = {};
      plugins[NAME] = opts.settings || {};
      return { data: { configuration: { plugins } } };
    }
    if (/PTPTags/.test(q)) {
      if (opts.failTags) return { errors: [{ message: 'tag query boom' }] };
      return { data: { findTags: { tags: opts.tags || TAGS } } };
    }
    const m = /query PTP_one_(\w+)\(/.exec(q);
    if (m) {
      const data = {};
      // A function when a test needs the answer to depend on *which* id was asked for.
      // The flat form serves the same object for every id, which is fine everywhere a
      // test names one entity and misleading where it names several - the Apollo
      // eviction check below is the one that cares.
      data[m[1]] = typeof opts.entity === 'function'
        ? opts.entity(String((req.variables || {}).id))
        : (opts.entity !== undefined ? opts.entity : SCENE);
      return { data };
    }
    // 0.13.0: the source button's payload half - the source's *own* tags/performers,
    // asked for by id in one query covering every path on the page. Defaults to
    // carrying one tag, since almost every source-side check is about something else
    // and a source with nothing to give now hides its button. `sourcePayload: {}` is
    // how a test says "this source is empty".
    const msp = /query PTP_spayload_(\w+)\(/.exec(q);
    if (msp) {
      const data = {};
      data[msp[1]] = opts.sourcePayload !== undefined ? opts.sourcePayload : { tags: [{ id: '1' }] };
      return { data };
    }
    // A source button's `field`-kind lookup: one entity by id, drilling to the
    // back-reference (`resolveFieldReverse`).
    const msf = /query PTP_sfield_(\w+)\(/.exec(q);
    if (msf) {
      const data = {};
      data[msf[1]] = opts.sourceField !== undefined ? opts.sourceField : null;
      return { data };
    }
    // A source button's `filter`-kind lookup: paged, like every other query here
    // (`resolveFilterReverse`). `FIND_TO_NODE` mirrors the same `find` -> `node`
    // mapping `TARGETS` carries, so a test can hand back a plain list of targets.
    const msl = /query PTP_sfilter_(\w+)_(\w+)\(/.exec(q);
    if (msl) {
      const node = FIND_TO_NODE[msl[1]] || msl[1].toLowerCase();
      const all = opts.sourceFilter !== undefined ? opts.sourceFilter : [];
      // Only page 1 carries anything. With `sourceFilterCount` set above the list's
      // own length this is a source whose targets span more pages than the probe
      // should ever ask for.
      const page = (req.variables || {}).page || 1;
      const list = opts.sourceFilterPages ? (opts.sourceFilterPages[page - 1] || []) : (page > 1 ? [] : all);
      const data = {};
      data[msl[1]] = { count: opts.sourceFilterCount !== undefined ? opts.sourceFilterCount : all.length };
      data[msl[1]][node] = list;
      return { data };
    }
    if (/mutation PTP_bulk/.test(q)) {
      if (opts.failWrite) return { errors: [{ message: 'write boom' }] };
      return { data: { ok: [] } };
    }
    // Stash's *own* save, posted by `entityUpdate`. Separate from `failWrite` above,
    // which is this plugin's write: the probe invalidation hangs off the user's save
    // succeeding, so a test needs to be able to reject that one specifically.
    if (opts.failSave && /^mutation Stash_/.test(q)) {
      return { errors: [{ message: 'save boom' }] };
    }
    return { data: {} };
  };
}

const FIND_TO_NODE = { findScenes: 'scenes', findGroups: 'groups', findGalleries: 'galleries', findImages: 'images' };

// The plugin reads `Date.now()` at call time off its own global, so a subclass swapped
// in afterwards shifts its clock without touching this file's.
const AUTO_SETTINGS_TTL_MS = 10000;
function advanceClock(env, ms) {
  const D = env.ctx.Date;
  env.ctx.Date = class extends D { static now() { return D.now() + ms; } };
}

const tagQueries = (calls) => calls.filter((c) => /PTPTags/.test(c.query || ''));
const entityQueries = (calls) => calls.filter((c) => /query PTP_one_/.test(c.query || ''));
const sourceLookups = (calls) => calls.filter((c) => /PTP_sfilter_/.test(c.query || ''));
const settingsQueries = (calls) => calls.filter((c) => (c.query || '').indexOf('configuration') !== -1);

function editButtonsContainer(env) {
  const c = h.makeElement('div');
  c.className = 'edit-buttons';
  env.body.appendChild(c);
  return c;
}

// One of Stash's own actions in a button row: `btn` plus a variant, which is what the
// plugin's margin donor scan looks for (0.12.4 - it used to require `<button>`, and
// Stash styles some row actions as links). `computed` is what `getComputedStyle`
// reports for it, so a fixture can state the row's own spacing convention.
function stashAction(harness, label, computed, tag) {
  const node = harness.makeElement(tag || 'button');
  node.className = 'btn btn-secondary';
  node.textContent = label;
  node._computed = computed;
  return node;
}

// The tab strip Scene and Gallery render in place of a detail action row, reproduced
// from a live Stash (2026-08-12):
//
//   <div class="scene-tabs …"><div><div class="mr-auto nav nav-tabs" role="tablist">
//     <div class="nav-item"><a data-rb-event-key="scene-details-panel">Details</a></div>
//     … <a data-rb-event-key="scene-edit-panel">Edit</a>
//
// `keys` names the tabs; the plugin picks a strip by whether one of them ends
// `-edit-panel`, so a fixture can build the *other* kind (Gallery's Images/Add strip)
// by passing keys that do not.
function tabStrip(env, keys, selected) {
  const outer = h.makeElement('div');
  outer.className = 'gallery-tabs';
  const parent = h.makeElement('div');           // the block-level wrapper our row goes into
  const strip = h.makeElement('div');
  strip.className = 'mr-auto nav nav-tabs';
  strip.setAttribute('role', 'tablist');
  keys.forEach((k) => {
    const item = h.makeElement('div');
    item.className = 'nav-item';
    const a = h.makeElement('a');
    a.className = 'nav-link';
    a.setAttribute('data-rb-event-key', k);
    a.setAttribute('aria-selected', String(k === (selected || keys[0])));
    a.textContent = k.replace(/^.*-(\w+)-panel$/, '$1');
    item.appendChild(a);
    strip.appendChild(item);
  });
  parent.appendChild(strip);
  outer.appendChild(parent);
  env.body.appendChild(outer);
  return { strip: strip, parent: parent };
}

const srcRow = (env) => (env.body.descendants() || [])
  .filter((n) => h.hasClass(n, 'ptp2re-src-row'));

// Group's (and, per MergePerformerTagsToScenes' own code, Performer's) edit form,
// found live: `.details-edit`, the same container Stash swaps between a detail-view
// navbar (carries a Delete button) and the edit form itself (does not). `withDelete`
// builds the navbar shape so a test can prove it is skipped.
function detailsEditContainer(env, withDelete) {
  const c = h.makeElement('div');
  c.className = 'details-edit col-xl-9 mt-3';
  if (withDelete) {
    const del = h.makeElement('button');
    del.className = 'delete';
    c.appendChild(del);
  }
  env.body.appendChild(c);
  return c;
}

function start(opts) {
  opts = opts || {};
  const patches = {};
  const env = h.makeEnv({
    quiet: true, respond: responder(opts), pathname: opts.pathname || '/scenes/10',
  });
  // `noPluginApi` is a Stash with no component patching at all - the case staging
  // cannot work on, and the reason the buttons fall back to saving there.
  if (!opts.noPluginApi) {
    env.ctx.PluginApi = { patch: { before: (n, fn) => { patches[n] = fn; } } };
    env.ctx.window.PluginApi = env.ctx.PluginApi;
  }
  env.ctx.alert = (m) => { env.ctx._alert = m; };
  h.run(env.ctx, SRC);
  return { env, patches };
}

// Simulates Stash rendering the control on the open edit form - a capture is
// recorded the moment the plugin's before-patch runs, exactly as it would from a
// real render. `onSelect` has to be a real function: the plugin's capture guard
// requires one, the same way it would refuse to capture a read-only render.
function renderControl(patches, name, values) {
  patches[name]({ isMulti: true, values: values || [], onSelect: () => {} });
}

const manualButtons = (env) => (env.body.descendants() || [])
  .filter((n) => h.hasClass(n, 'ptp2re-manual-btn'));

// Beside its target-side twin rather than down in the source-side section, because
// the dynamic-refresh checks above that section read it too.
const sourceButtons = (env) => (env.body.descendants() || [])
  .filter((n) => h.hasClass(n, 'ptp2re-manual-src-btn'));

const writes = (calls) => calls.filter((c) => /mutation PTP_bulk/.test(c.query || ''));

// A real browser's `.childNodes` is a live `NodeList` - it has `.length` and index
// access, but no `Array.prototype` methods at all, `.slice()` included. The shared
// harness's `childNodes` is a genuine array (other suites rely on `.filter()` and
// `.indexOf()` against it), so it cannot catch code that assumes `.slice()` exists
// on a container's `childNodes`. This builds the one container that can: minimal,
// standing in only for `.edit-buttons`, with `childNodes` reconstructed on every
// read as a plain object carrying nothing from `Array.prototype` or `Object.prototype`.
function nodeListLikeContainer() {
  var kids = [];
  var container = {
    className: 'edit-buttons',
    appendChild: function (node) { kids.push(node); node.parentNode = container; return node; },
    removeChild: function (node) {
      var i = kids.indexOf(node);
      if (i !== -1) kids.splice(i, 1);
      node.parentNode = null;
      return node;
    },
    // `insertBeforeDelete` calls this to find the anchor - minimal, since this
    // fixture only ever needs to match 'button.delete' among its flat, direct kids.
    querySelector: function (sel) {
      if (sel !== 'button.delete') throw new Error('unsupported selector: ' + sel);
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].tagName === 'BUTTON' && h.hasClass(kids[i], 'delete')) return kids[i];
      }
      return null;
    },
  };
  Object.defineProperty(container, 'childNodes', {
    get: function () {
      var nodeList = Object.create(null);
      for (var i = 0; i < kids.length; i++) nodeList[i] = kids[i];
      nodeList.length = kids.length;
      return nodeList;
    },
  });
  return container;
}

(async () => {
  // ── Real-DOM childNodes (regression) ─────────────────────────────────────────
  //
  // Caught live: `manualButtonsTick` called `.slice()` directly on `container.
  // childNodes`, which throws in any real browser (`TypeError: ...slice is not a
  // function`) because `childNodes` is a `NodeList`, not an `Array`. The shared
  // harness's own container never exposed this, since its `childNodes` already is
  // a real array - hence `nodeListLikeContainer` above.
  {
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = nodeListLikeContainer();
    const orig = env.ctx.document.querySelector;
    env.ctx.document.querySelector = (sel) => (sel === '.edit-buttons' ? container : orig(sel));

    // Not `env.tick()`: the script's own load-time call to `manualButtonsTick()` is
    // already pending (queued before the container override above could apply to
    // it), and a second invocation would double-add - `document.getElementById`
    // cannot see into this container, since it was never attached to `env.body`, so
    // neither invocation would recognise the other's button as already there. One
    // pending call is enough to prove the fix.
    let caught = null;
    const onRejection = (err) => { caught = err; };
    process.on('unhandledRejection', onRejection);
    await h.flush(80);
    process.removeListener('unhandledRejection', onRejection);

    h.check('reconciling buttons does not assume childNodes is a real Array',
      caught === null, caught && caught.stack);
    h.check('and a button lands in the NodeList-like container anyway',
      container.childNodes.length === 1, container.childNodes.length);
  }

  // ── The button appears, labelled from the path table ────────────────────────
  {
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const btns = manualButtons(env);
    h.check('one button for the one enabled path into scenes', btns.length === 1,
      btns.map((b) => b.textContent).join(','));
    h.check('labelled from the path table, not a second copy of the string',
      btns[0].textContent === 'Copy all Tags from all Performers', btns[0].textContent);
    // `.edit-buttons` defaults to flex `align-items: stretch`, so a button sharing a
    // row with a taller sibling (Stash's own Save/Delete, or a non-`btn-sm` button
    // from another plugin) stretches to match it while one that wraps alone does
    // not - the same button rendering two different heights purely by which row it
    // landed on. `align-self` opts every one of ours out of that.
    h.check('opts out of the container\'s flex stretch, so its height never depends on its row',
      /align-self\s*:\s*flex-start/.test(btns[0].style || ''), btns[0].style);
    // 0.9.1 tried `my-1` on the button itself for wrapped-row spacing and it was a
    // regression, live-tested: the button's own vertical margin inflated the flex
    // line it shares with Stash's Save/Delete, and stretch grew *those* buttons
    // taller to match. No vertical margin on the button itself, ever.
    h.check('carries no vertical margin of its own - that would inflate the shared row',
      !/\bmy-\d\b/.test(btns[0].className || ''), btns[0].className);
    // 0.9.2 moved wrapped-row spacing to the container's own `row-gap`. 0.12.3 found
    // that only ever worked on half the pages: `.edit-buttons` computes to
    // `display: block` on a live Stash, where `row-gap` is inert - which is why its
    // wrapped rows sat flush while Group's flex `.details-edit` spaced correctly from
    // the identical call. The harness reports `display: block` by default, so this
    // fixture is the measured shape, and the spacing has to arrive as a bottom margin
    // on our own button instead. Safe here for the reason it was a regression there:
    // a block container has no flex line for a margin box to inflate.
    h.check('a block container gets the spacing as a bottom margin on our own button',
      /margin-bottom\s*:\s*\.25rem/.test(btns[0].style || ''), btns[0].style);
    h.check('and no inert row-gap is left on it',
      !container.style || !container.style.rowGap, container.style);
  }
  {
    // The other half of the same branch: a flex container still gets `row-gap`, and
    // its buttons still carry no vertical margin - the 0.9.2 regression must not come
    // back on the pages that never had it.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    container._computed = { display: 'flex' };
    env.tick();
    await h.flush(60);
    const btns = manualButtons(env);
    h.check('a flex container still gets row-gap',
      container.style && container.style.rowGap === '.25rem', container.style);
    h.check('and its button carries no vertical margin that could inflate the row',
      !!btns[0] && !/margin-bottom/.test(btns[0].style || ''), btns[0] && btns[0].style);
  }
  {
    // The horizontal half, measured the same way: Stash's own buttons in
    // `.edit-buttons` compute to a right margin only, at a value no utility class
    // here can name. Ours copy whatever the row already uses, so every boundary in it
    // matches instead of our fixed `mx-1` producing a third gap.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    container.appendChild(stashAction(h, 'Save', { marginLeft: '0px', marginRight: '10px' }));
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('our button copies the margins off a button Stash put in the row',
      !!btn && /margin-left\s*:\s*0px/.test(btn.style || '') &&
      /margin-right\s*:\s*10px/.test(btn.style || ''), btn && btn.style);
    // 0.12.4, and the whole reason 0.12.3's measurement never reached a live page:
    // Bootstrap's spacing utilities carry `!important`, so an `mx-*` class on our own
    // button outranks the inline margins above and the copied value is discarded by
    // the cascade. The class has to be *absent* for the measurement to mean anything.
    h.check('and carries no utility spacing class that would outrank them',
      !/\bmx-\d\b/.test(btn.className || ''), btn.className);
  }
  {
    // A button belonging to the *other* plugin is not Stash's, and must not be the one
    // copied from - it carries `_coopOwner`, which is exactly what tells them apart.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    const foreign = stashAction(h, 'Copy all Tags from all Performers', { marginLeft: '7px', marginRight: '7px' });
    foreign._coopOwner = 'MergePerformerTagsToScenes';
    container.appendChild(foreign);
    container.appendChild(stashAction(h, 'Save', { marginLeft: '0px', marginRight: '10px' }));
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('another plugin\'s button is skipped when copying the row\'s margins',
      !!btn && /margin-right\s*:\s*10px/.test(btn.style || ''), btn && btn.style);
  }
  {
    // 0.12.5. The gap between two inline siblings is the first's right margin plus the
    // second's left margin, so copying the donor's margins wholesale - which is a right
    // margin only - lands our button flush against any neighbour that has none. Stash's
    // own detail navbars are inconsistently spaced exactly that way (`Auto tag...` and
    // `Merge` touch each other on Performer), and 0.12.4 was live-reported as touching
    // the button before it there. The row's step is taken from the donor and whatever
    // the actual neighbour is not contributing is filled in.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    container.appendChild(stashAction(h, 'Edit', { marginLeft: '0px', marginRight: '7px' }));
    container.appendChild(stashAction(h, 'Auto tag...', { marginLeft: '0px', marginRight: '0px' }));
    container.appendChild(stashAction(h, 'Delete', { marginLeft: '0px', marginRight: '7px' }));
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('a neighbour with no margin of its own gets the row\'s step from us',
      !!btn && /margin-left\s*:\s*7px/.test(btn.style || ''), btn && btn.style);
    h.check('and the far side is filled to the same step',
      !!btn && /margin-right\s*:\s*7px/.test(btn.style || ''), btn && btn.style);
  }
  {
    // The other direction, and the reason this is "fill" rather than "always add": a
    // neighbour already contributing the full step leaves nothing to add, so nothing is
    // added. This is what keeps a wrapped second row flush with the first on
    // `.edit-buttons`, where every one of Stash's buttons carries the right margin -
    // live-confirmed good at 0.12.4 and not to be regressed by the fix above.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    container.appendChild(stashAction(h, 'Save', { marginLeft: '0px', marginRight: '10px' }));
    container.appendChild(stashAction(h, 'Delete', { marginLeft: '0px', marginRight: '10px' }));
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('a neighbour already carrying the step leaves us nothing to add',
      !!btn && /margin-left\s*:\s*0px/.test(btn.style || ''), btn && btn.style);
  }
  {
    // 0.12.7, and the case the plain margin reading cannot get right: the DOM sibling
    // beside our button is not the action the user sees. React wraps some row actions
    // (a file input beside its button, a dropdown beside its toggle), and the wrapper
    // carries no margin while the button inside it does - so reading the sibling reports
    // "contributes nothing" and a full step is added on top of a gap that was already
    // there. Live, that is Group: both its detail navbar and its edit form, where the
    // space before our first button doubled at 0.12.5 and nowhere else did.
    //
    // 0.12.6 tried to settle this by measuring the gap with `getBoundingClientRect`
    // instead. That was removed: a distance is a fact about one instant, and it went
    // wrong in both directions live - our button landed touching Delete on every
    // `.details-edit` page, while Group, the page it existed for, did not change.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    const wrapper = h.makeElement('div');
    wrapper._computed = { marginLeft: '0px', marginRight: '0px' };
    wrapper.appendChild(stashAction(h, 'Edit', { marginLeft: '0px', marginRight: '7px' }));
    container.appendChild(wrapper);
    container.appendChild(stashAction(h, 'Delete', { marginLeft: '0px', marginRight: '7px' }));
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('a wrapped neighbour is read through to the action inside it',
      !!btn && /margin-left\s*:\s*0px/.test(btn.style || ''), btn && btn.style);
  }
  {
    // The wrapper's own margin counts too, and is summed with the inset action's rather
    // than one being picked over the other: both are usually zero, and summing is closer
    // to what the gap actually is when they are not.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    const wrapper = h.makeElement('div');
    wrapper._computed = { marginLeft: '0px', marginRight: '3px' };
    wrapper.appendChild(stashAction(h, 'Edit', { marginLeft: '0px', marginRight: '3px' }));
    container.appendChild(wrapper);
    container.appendChild(stashAction(h, 'Delete', { marginLeft: '0px', marginRight: '7px' }));
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('a wrapper\'s own margin is counted alongside the action inside it',
      !!btn && /margin-left\s*:\s*1px/.test(btn.style || ''), btn && btn.style);
  }
  {
    // 0.12.8, and the same mistake as 0.12.7 one step further out: an element beside our
    // button that holds no action *at all*. Reading its absent margin as the whole gap
    // added a full step on top of the space the real button behind it was already
    // making - which is Group's detail row, doubled for three releases after the wrapper
    // fix sorted its edit row out. The arithmetic pins it: at 0.12.4 our `margin-left: 0`
    // there looked right, so the gap exists without us; at 0.12.5 we added a step on top
    // of it, so whatever we were reading reported zero.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    container.appendChild(stashAction(h, 'Edit', { marginLeft: '0px', marginRight: '7px' }));
    const slot = h.makeElement('div');
    slot._computed = { marginLeft: '0px', marginRight: '0px' };
    container.appendChild(slot);
    container.appendChild(stashAction(h, 'Delete', { marginLeft: '0px', marginRight: '7px' }));
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('an element holding no action is walked past to the button behind it',
      !!btn && /margin-left\s*:\s*0px/.test(btn.style || ''), btn && btn.style);
  }
  {
    // And when the walk finds nothing recognisable on that side at all, we add nothing
    // rather than a step. An unidentifiable element could be occupying any amount of
    // space, and guessing is what doubles a gap; `margin-left: 0` at worst leaves our
    // button where Stash's own spacing puts it.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    const slot = h.makeElement('div');
    slot._computed = { marginLeft: '0px', marginRight: '0px' };
    container.appendChild(slot);
    container.appendChild(stashAction(h, 'Delete', { marginLeft: '0px', marginRight: '7px' }));
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('nothing recognisable on a side means nothing is added to it',
      !!btn && /margin-left\s*:\s*0px/.test(btn.style || ''), btn && btn.style);
  }
  {
    // Nothing *at all* on a side is a different answer again: our button is at that end
    // of the row, so the row's own convention for an end button is the whole story. Here
    // the row spaces on the left, so the trailing button takes no right margin - which is
    // what Stash's own last button in such a row carries.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    container.appendChild(stashAction(h, 'Auto tag...', { marginLeft: '7px', marginRight: '0px' }));
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('a button at the end of the row takes the row\'s own end margin',
      !!btn && /margin-right\s*:\s*0px/.test(btn.style || ''), btn && btn.style);
    h.check('and still fills the gap on the side that has a neighbour',
      !!btn && /margin-left\s*:\s*7px/.test(btn.style || ''), btn && btn.style);
  }
  {
    // Stash styles some row actions as links - established at 0.12.1, where Delete
    // turned out to be an `<a class="btn btn-danger">` on the Scene edit row. A row
    // whose spacing lives on links is still a row with a convention to copy, so the
    // donor is identified by the `btn` class rather than by its tag.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    const link = h.makeElement('a');
    link.className = 'btn btn-danger';
    link.textContent = 'Delete';
    link._computed = { marginLeft: '0px', marginRight: '10px' };
    container.appendChild(link);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('a link styled as a row action is a donor too',
      !!btn && /margin-right\s*:\s*10px/.test(btn.style || ''), btn && btn.style);
  }
  {
    // A container that spaces its own children with `column-gap` gives ours that gap
    // too, so any margin we add is *on top of* the row's spacing rather than equal to
    // it. Nothing to apply - not the copied margins, and not the fallback class.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    container._computed = { display: 'flex', columnGap: '10px' };
    container.appendChild(stashAction(h, 'Save', { marginLeft: '0px', marginRight: '10px' }));
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('a gap-spaced row gets no horizontal margin from us at all',
      !!btn && !/margin-left|margin-right/.test(btn.style || ''), btn && btn.style);
    h.check('and no utility class either',
      !!btn && !/\bmx-\d\b/.test(btn.className || ''), btn && btn.className);
  }
  {
    // Nothing to measure - no donor, no gap - falls back to the utility class, which
    // is what shipped before any of this was measured. The class is added by
    // `applyButtonSpacing`, not by the builder, so this is the only branch it exists on.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    container.appendChild(stashAction(h, 'Save', { marginLeft: '0px', marginRight: '0px' }));
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('a row with no spacing of its own falls back to the utility class',
      !!btn && /\bmx-1\b/.test(btn.className || ''), btn && btn.className);
  }

  // ── Placement: between Save and Delete (0.11.0) ───────────────────────────────
  //
  // Live-tested twice on this same row: 0.9.1 fixed a button landing after
  // Save/Delete entirely (a plain `appendChild`), anchoring on Save instead. Live
  // feedback after that shipped was that "before Save" was not actually the wanted
  // position - "between Save and Delete" was - so 0.11.0 retired the Save-anchored
  // `insertBeforeSave` and reuses `insertBeforeDelete` for the target side too:
  // Delete already sits right after Save on every page that has one, so anchoring
  // on Delete lands a button between them without this plugin ever needing to know
  // where Save is.
  function buildSaveDelete(container) {
    const save = h.makeElement('button');
    save.textContent = 'Save';
    container.appendChild(save);
    const del = h.makeElement('button');
    del.textContent = 'Delete';
    del.className = 'delete';
    container.appendChild(del);
    return { save, del };
  }
  {
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    const { save, del } = buildSaveDelete(container);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    const order = container.childNodes;
    h.check('the button lands between Save and Delete, not before Save or after Delete',
      !!btn && order.indexOf(btn) === order.indexOf(save) + 1 && order.indexOf(btn) === order.indexOf(del) - 1,
      order.map((n) => n.textContent).join(','));
  }
  {
    // Delete nested inside a wrapper element - insertBefore only accepts a direct
    // child as the reference node, so the walk-up has to find the wrapper, not
    // Delete itself, or insertBefore throws.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    const save = h.makeElement('button');
    save.textContent = 'Save';
    container.appendChild(save);
    const wrap = h.makeElement('div');
    const del = h.makeElement('button');
    del.className = 'delete';
    wrap.appendChild(del);
    container.appendChild(wrap);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('handles a Delete button nested in a wrapper element',
      !!btn && btn.previousSibling === save && btn.nextSibling === wrap,
      btn && [btn.previousSibling, btn.nextSibling].map((n) => n && n.className));
  }
  {
    // Group's edit-form state carries no Delete at all (§5b/§5d). Save is
    // "important" - Stash's own primary action for the form - and must stay the
    // last thing in the row, so `insertBeforeImportantAction` falls back to
    // finding Save (0.12.0) rather than appending after it: a plain append had
    // displaced Save from being last, exactly the case this fallback exists to
    // prevent.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    const save = h.makeElement('button');
    save.textContent = 'Save';
    container.appendChild(save);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    const order = container.childNodes;
    h.check('with no Delete in the container, the button lands before Save, not after it',
      !!btn && order.indexOf(btn) === order.indexOf(save) - 1, order.map((n) => n.textContent).join(','));
    h.check('so Save stays the last thing in the row',
      order.indexOf(save) === order.length - 1, order.map((n) => n.textContent).join(','));
  }
  {
    // The real Scene edit row, reported live against 0.12.0: Delete is present and
    // styled `btn-danger` but carries **no `.delete` class**. Up to 0.12.0 Delete was
    // searched for by that class alone - a repo CLAUDE.md note claimed Stash applies
    // it "throughout", which holds on the detail navbar where it was confirmed and
    // not here - so the search found nothing, the Save fallback caught it, and every
    // button landed before Save instead of between Save and Delete. 0.12.1 falls back
    // to a text match on Delete first.
    //
    // Whitespace around the label is deliberate: the live report did not establish
    // whether Stash renders it padded, and an exact-match search would pass a clean
    // fixture while still failing the real page.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    const save = h.makeElement('button');
    save.textContent = 'Save';
    container.appendChild(save);
    const del = h.makeElement('button');
    del.textContent = ' Delete ';
    del.className = 'btn btn-danger';   // no `.delete`
    container.appendChild(del);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    const order = container.childNodes;
    h.check('finds Delete by text when it carries no .delete class',
      !!btn && order.indexOf(btn) === order.indexOf(del) - 1, order.map((n) => n.textContent).join(','));
    h.check('and still lands after Save, not before it',
      !!btn && order.indexOf(btn) === order.indexOf(save) + 1, order.map((n) => n.textContent).join(','));
  }
  {
    // Two enabled paths into one page: both land between Save and Delete, in the
    // order they were added, rather than the second one reversing ahead of the first.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true, b2TagsStudioToScenes: true },
    });
    const container = editButtonsContainer(env);
    const { save, del } = buildSaveDelete(container);
    env.tick();
    await h.flush(60);
    const order = container.childNodes;
    const btns = manualButtons(env);
    h.check('both buttons land between Save and Delete', btns.length === 2 &&
      btns.every((b) => order.indexOf(b) > order.indexOf(save) && order.indexOf(b) < order.indexOf(del)),
      order.map((n) => n.textContent).join(','));
    h.check('in the order they were added, not reversed',
      order.indexOf(btns[0]) < order.indexOf(btns[1]), order.map((n) => n.textContent).join(','));
  }

  // ── Deterministic ordering against another plugin's button (coop().order) ────
  //
  // Before this, both plugins' insertBeforeDelete always inserted immediately
  // before the anchor, so whichever plugin's async check resolved last ended up
  // closest to Delete - a race decided by network timing, not a rule. `coop().order`
  // fixes a priority per plugin id; MergePerformerTagsToScenes registers 20 (closer
  // to the anchor) and this plugin registers 10, so a foreign button already in the
  // row is either skipped past or landed on, by priority alone, regardless of which
  // plugin got there first.
  {
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    h.check('registers its own priority in coop().order at load',
      env.ctx.window.StashPluginCoop.order[NAME] === 10, env.ctx.window.StashPluginCoop.order);
    // MergePerformerTagsToScenes registers its own priority at its own load, which
    // this single-plugin harness never runs - seeded directly, the way its
    // `declares` entry already is in the tests below.
    env.ctx.window.StashPluginCoop.order.MergePerformerTagsToScenes = 20;
    const container = editButtonsContainer(env);
    const { save, del } = buildSaveDelete(container);
    // Simulates MergePerformerTagsToScenes having already inserted its own button
    // before this plugin's tick ever runs - the case that used to lose the race
    // half the time, since our own insertion always targeted "immediately before
    // Delete" with no regard for what was already there.
    const foreign = h.makeElement('button');
    foreign.textContent = 'Copy Tags to all Scenes';
    foreign._coopOwner = 'MergePerformerTagsToScenes';
    container.insertBefore(foreign, del);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    const order = container.childNodes;
    h.check('a higher-priority foreign button already there is not displaced from Delete',
      !!btn && order.indexOf(foreign) === order.indexOf(del) - 1,
      order.map((n) => n.textContent).join(','));
    h.check('our own button lands on the far side of it instead of racing it for the anchor',
      !!btn && order.indexOf(btn) > order.indexOf(save) && order.indexOf(btn) < order.indexOf(foreign),
      order.map((n) => n.textContent).join(','));
  }
  {
    // The reverse priority: a foreign plugin registered *lower* than this one's 10
    // stays on the far side, and our button lands between it and Delete.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    env.ctx.window.StashPluginCoop.order.SomeOlderPlugin = 5;
    const container = editButtonsContainer(env);
    const { save, del } = buildSaveDelete(container);
    const foreign = h.makeElement('button');
    foreign.textContent = 'Some Older Button';
    foreign._coopOwner = 'SomeOlderPlugin';
    container.insertBefore(foreign, del);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    const order = container.childNodes;
    h.check('a lower-priority foreign button stays where it was, further from Delete',
      !!btn && order.indexOf(foreign) < order.indexOf(btn), order.map((n) => n.textContent).join(','));
    h.check('and our button sits between it and Delete',
      !!btn && order.indexOf(btn) === order.indexOf(del) - 1, order.map((n) => n.textContent).join(','));
  }

  // ── Restraint ───────────────────────────────────────────────────────────────
  {
    const { env } = start({ settings: { b1TagsPerformersToScenes: true } }); // a1 off
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('with the master toggle off, no button appears', manualButtons(env).length === 0);
  }
  {
    const { env } = start({ settings: { a1ShowManualButtons: true } }); // no path enabled
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('with no path into this page, no button appears', manualButtons(env).length === 0);
  }
  {
    // A path into galleries does not put a button on the scene page.
    const { env } = start({
      settings: { a1ShowManualButtons: true, c1TagsImagesToGalleries: true },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('a path into another target puts no button here', manualButtons(env).length === 0);
  }
  {
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/settings?tab=plugins',
    });
    env.tick();
    await h.flush(60);
    h.check('off any of the four pages, no button appears', manualButtons(env).length === 0);
  }
  {
    // No .edit-buttons container yet (edit tab not open).
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    env.tick();
    await h.flush(60);
    h.check('with no container found, no button appears', manualButtons(env).length === 0);
  }

  // ── Existence gating: a button whose source is entirely absent stays off ────
  {
    // Not "already has the tags" - genuinely no performers to read from.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      entity: Object.assign({}, SCENE, { performers: [] }),
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('no performers on the scene hides the button', manualButtons(env).length === 0);
  }
  {
    // 0.13.0 (Improvement 4) reverses what this used to assert. The scene has a
    // performer, and that performer's only tag is already on the scene - the
    // relationship exists, so the old existence gate showed a button that could only
    // ever report "No changes". Eligibility gating hides it. Free, because the probe's
    // one query already carried both the performer's tags and the scene's own.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      entity: Object.assign({}, SCENE, { tags: [{ id: '1' }] }),
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('a source with nothing new to add hides the button', manualButtons(env).length === 0);
  }
  {
    // The other half of the same distinction, and the reason eligibility is per path
    // rather than read off the finished plan: two paths that would each add the *same*
    // tag are two buttons that would each do something. `recordAddable` fires ahead of
    // `entry.has`, so the second path is not counted as contributing nothing merely
    // because the first reached the id first.
    const { env } = start({
      settings: {
        a1ShowManualButtons: true, b1TagsPerformersToScenes: true, b2TagsStudioToScenes: true,
      },
      entity: Object.assign({}, SCENE, { studio: { id: '20', name: 'S', tags: [{ id: '1' }] } }),
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('two paths offering the same missing tag both show', manualButtons(env).length === 2,
      manualButtons(env).map((b) => b.textContent).join(','));
  }
  {
    // The "common tags only" fold is part of the diff, so it is part of the gate: two
    // scenes under a group agreeing on nothing means the button would add nothing,
    // even though both scenes exist and both carry tags.
    const { env } = start({
      settings: {
        a1ShowManualButtons: true, e1TagsScenesToGroups: true, e2TagsScenesToGroupsCommonOnly: true,
      },
      pathname: '/groups/10',
      entity: {
        id: '10', name: 'G', tags: [],
        scenes: [
          { id: '1', title: 'A', tags: [{ id: '1' }] },
          { id: '2', title: 'B', tags: [{ id: '2' }] },
        ],
      },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('an empty common-tags intersection hides the button', manualButtons(env).length === 0);
  }
  {
    // Two paths on the same page, gated independently: only the one whose source
    // exists shows.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true, b2TagsStudioToScenes: true },
      entity: Object.assign({}, SCENE, { studio: null }),
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const labels = manualButtons(env).map((b) => b.textContent);
    h.check('a path whose source is absent is gated independently of its sibling',
      labels.length === 1 && labels[0] === 'Copy all Tags from all Performers', labels.join(','));
  }
  {
    // A failed existence probe (the tag query `autoContext` needs) must not silently
    // hide every button on the page - same stated preference as above.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      failTags: true,
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('a failed probe falls back to showing the button rather than hiding it',
      manualButtons(env).length === 1);
  }
  {
    // 0.12.11: the tag query the probe needs is the *whole* tag library, and it was
    // being re-asked on every navigation - the dominant cost of a target-side button
    // appearing, live-reported as about a second's lag behind
    // MergePerformerTagsToScenes' own button. `probeContext` caches it on the settings
    // TTL, for the probe only; the write paths still call `autoContext` directly.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const afterFirst = tagQueries(env.calls).length;
    env.ctx.location.pathname = '/scenes/11';
    env.tick();
    await h.flush(60);
    h.check('the first probe asks for the tag library once', afterFirst === 1, 'count: ' + afterFirst);
    h.check('a second probe within the settings TTL reuses it rather than re-asking',
      tagQueries(env.calls).length === 1, 'count: ' + tagQueries(env.calls).length);
    h.check('and the button is still there for the new entity', manualButtons(env).length === 1);
  }
  {
    // 0.12.11, the other half of the same delay: `autoSettings()` was awaited on every
    // tick, so whenever the TTL had lapsed one tick blocked on a full
    // `configuration { plugins }` query before it could even look at the DOM - and the
    // ticks that draw buttons run every second. It now serves the last-known settings
    // and revalidates behind itself, which is what `MergePerformerTagsToScenes` gets
    // for free by reading a plain object.
    //
    // The clock is shifted rather than waited out, and the settings query is made to
    // hang from that point on: a tick that still draws the *new* entity's button while
    // a reload is in flight is the only thing that distinguishes the two behaviours.
    const hangSettings = { on: false };
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      hangSettings,
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('the settings loaded once to begin with', settingsQueries(env.calls).length === 1);

    advanceClock(env, AUTO_SETTINGS_TTL_MS + 1000);
    hangSettings.on = true;
    env.ctx.location.pathname = '/scenes/11';
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('a lapsed TTL does not hold the button back while settings reload',
      !!btn && btn._ptp2reEntityId === '11', btn && btn._ptp2reEntityId);
    h.check('and the reload it kicked off is genuinely in flight',
      settingsQueries(env.calls).length === 2, 'loads: ' + settingsQueries(env.calls).length);
  }
  {
    // 0.12.13, measured rather than reasoned about: on a live library `tagQuery` took
    // 766 ms of the 1230 ms a Scene Edit button took to appear. 0.12.11 had cached it on
    // the *settings* TTL - ten seconds, which is shorter than the gap between two visits
    // to an edit tab, so it was paid again almost every time and the delay stayed put.
    // The probe's TTL is its own and long, because it is sized against how long a button
    // may be wrongly shown, not against how fresh a write needs its filters.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    advanceClock(env, AUTO_SETTINGS_TTL_MS + 1000);
    env.ctx.location.pathname = '/scenes/11';
    env.tick();
    await h.flush(60);
    h.check('the tag context outlives the settings TTL rather than being re-asked with it',
      tagQueries(env.calls).length === 1, 'count: ' + tagQueries(env.calls).length);
    h.check('with the button still drawn for the new entity', manualButtons(env).length === 1);
  }
  {
    // And it is warmed at load, so the *first* button does not wait for it either. No
    // container here at all: nothing has asked for a button yet, and the query has
    // already been made.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    await h.flush(60);
    h.check('the tag context is warmed at load, before any button is wanted',
      tagQueries(env.calls).length === 1, 'count: ' + tagQueries(env.calls).length);
  }
  {
    // Not for a user who has never turned the buttons on: they would be paying for the
    // whole tag library on every page load for a feature they do not use.
    const { env } = start({ settings: { b1TagsPerformersToScenes: true } });
    await h.flush(60);
    h.check('with the buttons switched off, nothing is warmed', tagQueries(env.calls).length === 0);
  }
  {
    // 0.12.14, and the measurement that produced it: the probe's three sequential passes
    // took ~900 ms of wall clock on a live Scene Edit tab, and they only *started* when
    // `.edit-buttons` appeared - which is the instant the user clicks Edit, and also the
    // instant Stash fires its own five `*ForSelect` queries for the form's dropdowns
    // (810-1096 ms each, measured). So the whole probe queued behind the busiest moment
    // of the page and every millisecond of it sat between the click and the button.
    // Probing from the route instead spends it while the detail view is still on screen.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    env.tick(); // no container at all: the Edit tab has not been opened
    await h.flush(60);
    h.check('the probe runs before the button row exists', entityQueries(env.calls).length > 0,
      'queries: ' + entityQueries(env.calls).length);
    h.check('and no button is drawn while there is nowhere to put one',
      manualButtons(env).length === 0);

    const spent = entityQueries(env.calls).length;
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('so opening the Edit tab draws the button off the cached answer, asking nothing new',
      manualButtons(env).length === 1 && entityQueries(env.calls).length === spent,
      'queries: ' + entityQueries(env.calls).length + ' vs ' + spent);
  }

  // ── The `.details-edit` fallback (Group, and per MPTTS also Performer) ───────
  {
    // The exact URL a live Group's edit tab was found at - a sub-route, not the
    // bare entity path, and the reason the route regex matches on a trailing "/"
    // rather than requiring end-of-string.
    const { env } = start({
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true }, pathname: '/groups/53/scenes',
    });
    const container = detailsEditContainer(env, false); // the edit-form instance
    env.tick();
    await h.flush(60);
    const btns = manualButtons(env);
    h.check('falls back to .details-edit when .edit-buttons is absent', btns.length === 1,
      btns.map((b) => b.textContent).join(','));
    h.check('and lands inside it', btns.length && btns[0].parentNode === container);
  }
  {
    // The *other* state of the same container - the detail-view navbar, carrying a
    // Delete button - must not be mistaken for the edit form.
    const { env } = start({
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true }, pathname: '/groups/53',
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    h.check('the detail-view instance (carrying Delete) is not used', manualButtons(env).length === 0);
  }
  {
    // Both instances present (a render caught mid-swap, or simply defensive against
    // it) - the one without Delete is still the one picked.
    const { env } = start({
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true }, pathname: '/groups/53',
    });
    detailsEditContainer(env, true);
    const editForm = detailsEditContainer(env, false);
    env.tick();
    await h.flush(60);
    const btns = manualButtons(env);
    h.check('with both instances present, the edit-form one is still chosen',
      btns.length === 1 && btns[0].parentNode === editForm);
  }
  {
    // .edit-buttons wins outright when both exist - Scene is the one page confirmed
    // to use it, and nothing here should prefer the fallback over the confirmed case.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const primary = editButtonsContainer(env);
    detailsEditContainer(env, false);
    env.tick();
    await h.flush(60);
    const btns = manualButtons(env);
    h.check('.edit-buttons takes priority over the .details-edit fallback',
      btns.length === 1 && btns[0].parentNode === primary);
  }

  // ── Multiple enabled paths into one page ─────────────────────────────────────
  {
    const { env } = start({
      settings: {
        a1ShowManualButtons: true,
        b1TagsPerformersToScenes: true, b2TagsStudioToScenes: true,
      },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const labels = manualButtons(env).map((b) => b.textContent).sort();
    h.check('one button per enabled path, not one that tries to name both',
      labels.join(',') === 'Copy Tags from Studio,Copy all Tags from all Performers', labels.join(','));
  }

  // ── Not duplicating another plugin's identical button ─────────────────────────
  //
  // MergePerformerTagsToScenes covers `tags:performer>scene` too. `declares` alone
  // says it *could* be showing a button here; only a matching label actually in the
  // container says it *is* - the ground truth these checks are really about.
  {
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    env.ctx.window.StashPluginCoop.declares.MergePerformerTagsToScenes = ['tags:performer>scene'];
    const foreign = h.makeElement('button');
    foreign.className = 'cpt2s-merge-from-perfs-btn';
    foreign.textContent = 'Copy all Tags from all Performers';
    container.appendChild(foreign);
    env.tick();
    await h.flush(60);
    h.check('our own button is not added alongside a foreign one for the same path',
      manualButtons(env).length === 0);
  }
  {
    // Declared but not actually shown - the other plugin's own manual-button
    // setting could just as easily be off. Suppressing ours too would leave
    // neither button on the page for something the user asked to see.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    editButtonsContainer(env);
    env.ctx.window.StashPluginCoop.declares.MergePerformerTagsToScenes = ['tags:performer>scene'];
    env.tick();
    await h.flush(60);
    h.check('declared but not shown does not suppress ours', manualButtons(env).length === 1);
  }
  {
    // A different path from the same plugin is unrelated - its foreign button must
    // not blanket-suppress a button for a path it was never declared for.
    const { env } = start({ settings: { a1ShowManualButtons: true, b2TagsStudioToScenes: true } });
    const container = editButtonsContainer(env);
    env.ctx.window.StashPluginCoop.declares.MergePerformerTagsToScenes = ['tags:performer>scene'];
    const foreign = h.makeElement('button');
    foreign.textContent = 'Copy all Tags from all Performers';
    container.appendChild(foreign);
    env.tick();
    await h.flush(60);
    h.check('a foreign button for a different path leaves this one alone',
      manualButtons(env).length === 1);
  }
  {
    // Our own button must never be mistaken for a foreign one just because it
    // carries the same label a declaring plugin also happens to use - it is
    // excluded from the foreign-button scan by its own MANUAL_BTN_CLASS.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    editButtonsContainer(env);
    env.ctx.window.StashPluginCoop.declares.MergePerformerTagsToScenes = ['tags:performer>scene'];
    env.tick();
    await h.flush(60);
    h.check('our own button renders once', manualButtons(env).length === 1);
    env.tick(); // idle tick - must not tear itself down as though it were foreign
    await h.flush(60);
    h.check('and is not removed by a later tick seeing itself', manualButtons(env).length === 1);
  }

  // ── Staging (the default) ────────────────────────────────────────────────────
  {
    const { env, patches } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('a TagSelect patch was registered', typeof patches.TagSelect === 'function');
    renderControl(patches, 'TagSelect', []);

    const btn = manualButtons(env)[0];
    btn.click();
    await h.flush(80);

    h.check('no mutation is issued while staging', writes(env.calls).length === 0);
    h.check('the button reports what it staged', /Added 1/.test(btn.textContent), btn.textContent);
  }
  {
    // A second click with nothing new to add reports "No changes" rather than
    // restaging the same tag a second time.
    const { env, patches } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    renderControl(patches, 'TagSelect', [{ id: '1', name: 'Blonde' }]); // already staged
    const btn = manualButtons(env)[0];
    btn.click();
    await h.flush(80);
    h.check('nothing left to add reports no changes', btn.textContent === 'No changes', btn.textContent);
  }
  {
    // No control captured at all - the edit tab was never rendered with one.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    btn.click();
    await h.flush(80);
    h.check('with no captured control the button recovers rather than sticking on "Working..."',
      btn.textContent === 'Copy all Tags from all Performers', btn.textContent);
    h.check('and reports the error', /open the Edit tab/.test(env.ctx._alert || ''), env.ctx._alert);
  }

  // ── Save immediately ─────────────────────────────────────────────────────────
  {
    const { env } = start({
      settings: {
        a1ShowManualButtons: true, a2SaveImmediately: true, b1TagsPerformersToScenes: true,
      },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    btn.click();
    await h.flush(80);
    const w = writes(env.calls);
    h.check('save-immediately issues a bulk mutation', w.length === 1);
    h.check('as an ADD delta onto the one entity',
      w.length && w[0].variables.input.ids.join() === '10' &&
      w[0].variables.input.tag_ids.mode === 'ADD' &&
      w[0].variables.input.tag_ids.ids.join() === '1');
    h.check('the button reports what was written', /Added 1/.test(btn.textContent), btn.textContent);
  }

  // ── A button copies its own path and nothing else (0.15.1) ──────────────────
  //
  // `runManual` planned *every* enabled path into the target regardless of which
  // button was clicked, so "Copy all Tags from all Performers" on a scene with the
  // studio path also enabled copied the studio's tags too. The caption names one
  // source, the tooltip names one path and the setting promises one button per path;
  // `runManualSource` had this right from the start. It also made this plugin's button
  // silently wider than `MergePerformerTagsToScenes`' identically labelled one.
  {
    const { env } = start({
      settings: {
        a1ShowManualButtons: true, a2SaveImmediately: true,
        b1TagsPerformersToScenes: true, b2TagsStudioToScenes: true,
      },
      entity: Object.assign({}, SCENE, {
        tags: [],
        performers: [{ id: '100', name: 'Jane', tags: [{ id: '1' }] }],
        studio: { id: '200', name: 'Studio', tags: [{ id: '2' }] },
      }),
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const btns = manualButtons(env);
    h.check('two enabled paths draw two buttons', btns.length === 2,
      btns.map((b) => b.textContent).join(' | '));
    const perf = btns.filter((b) => /from all Performers/.test(b.textContent))[0];
    perf.click();
    await h.flush(80);
    const w = writes(env.calls);
    h.check('the performer button writes only the performer tag',
      w.length === 1 && w[0].variables.input.tag_ids.ids.join() === '1',
      w.map((c) => JSON.stringify(c.variables.input.tag_ids)).join(' | '));
    h.check('and says so on the caption', /Added 1/.test(perf.textContent), perf.textContent);
  }

  // ── Staging falls back to saving where PluginApi cannot be patched ──────────
  //
  // The user never opted into review - they opted into the button - so a Stash with no
  // component patching gets the behaviour it can support, and one console warning. It
  // used to end in an alert about a form control that was never going to be captured.
  // `MergePerformerTagsToScenes` has made the same trade since it grew staging.
  {
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true }, // staging is the default
      noPluginApi: true,
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    h.check('the tooltip promises a save, not a review',
      /saves immediately/.test(btn.title || ''), btn.title);
    btn.click();
    await h.flush(80);
    h.check('the click saves instead of staging', writes(env.calls).length === 1,
      writes(env.calls).length + ' write(s)');
    h.check('and raises no alert about a form control', !env.ctx._alert, env.ctx._alert);
  }
  {
    const { env } = start({
      settings: {
        a1ShowManualButtons: true, a2SaveImmediately: true, b1TagsPerformersToScenes: true,
      },
      entity: Object.assign({}, SCENE, { tags: [{ id: '1' }] }), // already has it
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    // Since 0.13.0 there is no button to click here: in save-immediately mode the gate
    // and the click both run `planEntities` against the server, so they agree exactly
    // and "shown but adds nothing" is unreachable by construction. What used to be
    // checked through a click is now checked by the button's absence, and by there
    // being no mutation on the page at all.
    h.check('nothing to add draws no button in save-immediately mode',
      manualButtons(env).length === 0);
    h.check('and issues no mutation', writes(env.calls).length === 0);
  }

  // ── Dynamic refresh: a save on the page re-arms the probe (0.13.0) ────────────
  //
  // Both probe slots are keyed on the entity and the path set, neither of which a save
  // changes - so before 0.13.0 a button decided before an edit kept that answer until
  // the user navigated away and back. These drive the mutation through the plugin's own
  // `fetch` wrapper, exactly as Stash's Save button would.
  {
    // The scene already carries its performer's only tag, so no button. The user
    // removes that tag and saves; the responder's entity changes with it, and the
    // button has to appear without a navigation.
    const opts = {
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      entity: Object.assign({}, SCENE, { tags: [{ id: '1' }] }),
    };
    const { env } = start(opts);
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('nothing to add, so no button before the save', manualButtons(env).length === 0);
    opts.entity = Object.assign({}, SCENE, { tags: [] });   // the save removed it
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('a save of the viewed entity re-probes and the button appears',
      manualButtons(env).length === 1);
  }
  {
    // The other direction, and the one the user described: the scene gains the tag,
    // and the button that was showing goes away on Save.
    const opts = {
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
    };
    const { env } = start(opts);
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('a button before the save', manualButtons(env).length === 1);
    opts.entity = Object.assign({}, SCENE, { tags: [{ id: '1' }] });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('and it goes away when the save leaves nothing to add',
      manualButtons(env).length === 0);
  }
  {
    // Unconditional on the auto-mode settings, which are off in every case above and
    // here too. This is the rule `MergePerformerTagsToScenes`' CLAUDE.md §3 states
    // about its own equivalent branch: the cache decides whether a button appears, so
    // the save invalidates it whether or not auto mode is also configured to react.
    // Pinned by the negative - a save of a *different* entity must not re-probe.
    const opts = {
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      entity: Object.assign({}, SCENE, { tags: [{ id: '1' }] }),
    };
    const { env } = start(opts);
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const before = entityQueries(env.calls).length;
    opts.entity = Object.assign({}, SCENE, { tags: [] });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '999' });   // some other scene
    await h.flush(80);
    h.check('a save of a different entity does not re-probe',
      entityQueries(env.calls).length === before);
    h.check('and leaves the button hidden', manualButtons(env).length === 0);
  }
  {
    // A bulk save naming the viewed entity among others counts, since `input.ids` is
    // where a bulk mutation carries them.
    const opts = {
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      entity: Object.assign({}, SCENE, { tags: [{ id: '1' }] }),
    };
    const { env } = start(opts);
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    opts.entity = Object.assign({}, SCENE, { tags: [] });
    await h.entityUpdate(env.ctx, 'bulkSceneUpdate', { ids: ['7', '10', '11'] });
    await h.flush(80);
    h.check('a bulk save naming the viewed entity re-probes',
      manualButtons(env).length === 1);
  }
  {
    // The source side gets the same treatment, off the same branch: `/performers/100`
    // is a source route, so a `performerUpdate` naming 100 re-arms it. This is the case
    // `MergePerformerTagsToScenes` has always had for its own performer button.
    const opts = {
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [{ id: '10' }],
      sourcePayload: { tags: [] },      // no tags yet, so no button
    };
    const { env } = start(opts);
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    h.check('an untagged performer shows no source button', sourceButtons(env).length === 0);
    opts.sourcePayload = { tags: [{ id: '1' }] };   // the save gave it one
    await h.entityUpdate(env.ctx, 'performerUpdate', { id: '100' });
    await h.flush(80);
    h.check('and gaining a tag brings the source button back without a navigation',
      sourceButtons(env).length === 1);
  }
  {
    // A rejected save must change nothing: the edit did not land, so the answer the
    // probe already holds is still the right one. `mutationSucceeded` is what tells
    // the two apart, the same guard the auto-mode branches use.
    const opts = {
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      entity: Object.assign({}, SCENE, { tags: [{ id: '1' }] }),
      failSave: true,
    };
    const { env } = start(opts);
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const before = entityQueries(env.calls).length;
    opts.entity = Object.assign({}, SCENE, { tags: [] });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('a save Stash rejected does not re-probe',
      entityQueries(env.calls).length === before);
  }

  // ── The tab strip: a source button on a page with no action row (0.14.0) ─────
  //
  // Confirmed live 2026-08-12: Scene and Gallery render no `.details-edit` at all, so
  // five of the eleven source buttons had nowhere to anchor and had never appeared.
  {
    const { env } = start({
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true },
      pathname: '/scenes/10',
      sourceField: { groups: [{ group: { id: '400' } }] },
      sourcePayload: { tags: [{ id: '1' }] },
    });
    const { strip, parent } = tabStrip(env, ['scene-details-panel', 'scene-edit-panel']);
    env.tick();
    await h.flush(60);
    const rows = srcRow(env);
    h.check('a page with only a tab strip gets a source-button row of ours', rows.length === 1);
    h.check('placed immediately after the strip, inside its own block-level parent',
      rows.length === 1 && rows[0].parentNode === parent && strip.nextSibling === rows[0]);
    h.check('and the button lands in it', sourceButtons(env).length === 1 &&
      sourceButtons(env)[0].parentNode === rows[0]);
    h.check('never inside the tablist itself, whose children are meant to be tabs',
      !(strip.childNodes || []).some((n) => h.hasClass(n, 'ptp2re-manual-src-btn')));
  }
  {
    // Gallery renders *two* `.nav-tabs` strips - its own panels, and an Images/Add
    // strip for the image list - and a class match alone picks whichever comes first.
    // The Images/Add one is seeded first here, so a plugin choosing by class fails.
    const { env } = start({
      settings: { a1ShowManualButtons: true, d1TagsGalleriesToImages: true },
      pathname: '/galleries/10',
      sourceFilter: [{ id: '55' }],
      sourcePayload: { tags: [{ id: '1' }] },
    });
    const decoy = tabStrip(env, ['images', 'add']);
    const real = tabStrip(env, ['gallery-details-panel', 'gallery-edit-panel']);
    env.tick();
    await h.flush(60);
    h.check('the strip carrying the entity\'s own Edit tab is the one chosen',
      srcRow(env).length === 1 && srcRow(env)[0].parentNode === real.parent);
    h.check('and the Images/Add strip is left alone',
      !(decoy.parent.childNodes || []).some((n) => h.hasClass(n, 'ptp2re-src-row')));
  }
  {
    // Performer has a real navbar and no tab strip: unchanged, and the row is never
    // built. The order of the two branches is what guarantees that.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [{ id: '10' }],
      sourcePayload: { tags: [{ id: '1' }] },
    });
    const navbar = detailsEditContainer(env, true);
    tabStrip(env, ['performer-details-panel', 'performer-edit-panel']);
    env.tick();
    await h.flush(60);
    h.check('a page with a real action row still uses it, not a row of ours',
      srcRow(env).length === 0 && sourceButtons(env).length === 1 &&
      sourceButtons(env)[0].parentNode === navbar);
  }
  {
    // Neither: still nothing, and still no crash. This is the state every Scene and
    // Gallery was in before 0.14.0.
    const { env } = start({
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true },
      pathname: '/scenes/10',
      sourceField: { groups: [{ group: { id: '400' } }] },
    });
    env.tick();
    await h.flush(60);
    h.check('no action row and no tab strip draws nothing at all',
      srcRow(env).length === 0 && sourceButtons(env).length === 0);
  }

  // ── A source button shows only while its targets' tab is open (0.15.0) ───────
  //
  // Live feedback: the tab strip the row hangs under is present on every tab, so
  // "Copy Tags to all Groups from their Scenes" sat over the Details panel, over File
  // Info, and just above the target-side buttons on Edit.
  {
    const opts = {
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true },
      pathname: '/scenes/10',
      sourceField: { groups: [{ group: { id: '400' } }] },
      sourcePayload: { tags: [{ id: '1' }] },
    };
    const { env } = start(opts);
    tabStrip(env, ['scene-details-panel', 'scene-group-panel', 'scene-edit-panel'],
      'scene-group-panel');
    env.tick();
    await h.flush(60);
    h.check('shown while the Groups tab is the open one', sourceButtons(env).length === 1);
  }
  {
    const { env } = start({
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true },
      pathname: '/scenes/10',
      sourceField: { groups: [{ group: { id: '400' } }] },
      sourcePayload: { tags: [{ id: '1' }] },
    });
    tabStrip(env, ['scene-details-panel', 'scene-group-panel', 'scene-edit-panel'],
      'scene-details-panel');
    env.tick();
    await h.flush(60);
    h.check('and hidden while any other tab is', sourceButtons(env).length === 0);
  }
  {
    // A Group page, where the target type and the page type are the same word - every
    // key starts `group-`. `tags:subgroup>group` writes to *containing* groups, for
    // which this page has no tab, so the right answer is to fall open and show.
    //
    // This does **not** distinguish exact matching from a substring test, and the
    // comment on `tabShows` explains why: a substring matcher matches every tab here,
    // one of them is always selected, and it answers "shown" too. Written down because
    // an earlier version of this check claimed to catch that and did not - the mutant
    // passed the entire suite. What it does pin is the fail-open branch on the one page
    // shape most likely to trip a future matcher.
    const { env } = start({
      settings: { a1ShowManualButtons: true, e6TagsSubGroupsToGroups: true },
      pathname: '/groups/10',
      sourceField: { containing_groups: [{ group: { id: '900' } }] },
      sourcePayload: { tags: [{ id: '1' }] },
    });
    tabStrip(env, ['group-details-panel', 'group-scenes-panel', 'group-edit-panel'],
      'group-scenes-panel');
    env.tick();
    await h.flush(60);
    h.check('a page with no tab for the target falls open, even when every key names it',
      sourceButtons(env).length === 1);
  }
  {
    // Fails open: a page with no identifiable tab for the target shows the button on
    // every tab, exactly as 0.14.0 did. Hiding on an unrecognised key would look
    // identical to the bug 0.13.3 spent a release finding.
    const { env } = start({
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true },
      pathname: '/scenes/10',
      sourceField: { groups: [{ group: { id: '400' } }] },
      sourcePayload: { tags: [{ id: '1' }] },
    });
    tabStrip(env, ['scene-details-panel', 'scene-movie-panel', 'scene-edit-panel'],
      'scene-details-panel');
    env.tick();
    await h.flush(60);
    h.check('an unrecognised tab vocabulary shows the button rather than hiding it',
      sourceButtons(env).length === 1);
  }
  {
    // A page with a real action row and no strip at all: unchanged, always shown.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [{ id: '10' }],
      sourcePayload: { tags: [{ id: '1' }] },
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    h.check('a page with no tab strip is not gated by one', sourceButtons(env).length === 1);
  }

  // ── The click drops what it wrote out of Apollo, so the panel redraws ────────
  {
    const evicted = [];
    const { env } = start({
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true },
      pathname: '/scenes/10',
      sourceField: { groups: [{ group: { id: '400' } }, { group: { id: '401' } }] },
      sourcePayload: { tags: [{ id: '1' }] },
      // Both groups answer as themselves, so both are genuinely written. Serving one
      // object for both ids would have the plan hold a single entity and the check
      // below would then be asserting that an *unwritten* group is evicted - which is
      // what it did until the eviction moved to the write.
      entity: (id) => ({
        id, name: 'G' + id, tags: [], scenes: [{ id: '10', title: 'S', tags: [{ id: '1' }] }],
      }),
    });
    env.ctx.window.__APOLLO_CLIENT__ = {
      cache: { evict: (o) => evicted.push(o.id), gc: () => { evicted.push('gc'); } },
    };
    tabStrip(env, ['scene-details-panel', 'scene-group-panel', 'scene-edit-panel'],
      'scene-group-panel');
    env.tick();
    await h.flush(60);
    sourceButtons(env)[0].click();
    await h.flush(120);
    h.check('the groups it wrote are evicted by Apollo id, so their tag counts redraw',
      evicted.indexOf('Group:400') !== -1 && evicted.indexOf('Group:401') !== -1,
      evicted.join(','));
    h.check('and the cache is collected once afterwards',
      evicted[evicted.length - 1] === 'gc', evicted.join(','));
  }
  {
    // A click that wrote nothing evicts nothing - refetching a panel that did not
    // change is worse than leaving it alone.
    const evicted = [];
    const { env } = start({
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true },
      pathname: '/scenes/10',
      sourceField: { groups: [{ group: { id: '400' } }] },
      sourcePayload: { tags: [{ id: '1' }] },
      entity: { id: '400', name: 'G', tags: [{ id: '1' }], scenes: [{ id: '10', tags: [{ id: '1' }] }] },
    });
    env.ctx.window.__APOLLO_CLIENT__ = { cache: { evict: (o) => evicted.push(o.id), gc: () => {} } };
    tabStrip(env, ['scene-details-panel', 'scene-group-panel', 'scene-edit-panel'],
      'scene-group-panel');
    env.tick();
    await h.flush(60);
    sourceButtons(env)[0].click();
    await h.flush(120);
    h.check('a no-op click evicts nothing', evicted.length === 0, evicted.join(','));
  }
  {
    // The half-and-half case, which is what moving the eviction to the write bought:
    // one of the two groups already carries the tag, so only the other is written and
    // only the other is evicted. Evicting both would refetch a panel this click did
    // not change - the same waste the no-op case above refuses, one entity at a time.
    const evicted = [];
    const { env } = start({
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true },
      pathname: '/scenes/10',
      sourceField: { groups: [{ group: { id: '400' } }, { group: { id: '401' } }] },
      sourcePayload: { tags: [{ id: '1' }] },
      entity: (id) => ({
        id, name: 'G' + id,
        tags: id === '401' ? [{ id: '1' }] : [],   // 401 has it already
        scenes: [{ id: '10', title: 'S', tags: [{ id: '1' }] }],
      }),
    });
    env.ctx.window.__APOLLO_CLIENT__ = { cache: { evict: (o) => evicted.push(o.id), gc: () => {} } };
    tabStrip(env, ['scene-details-panel', 'scene-group-panel', 'scene-edit-panel'],
      'scene-group-panel');
    env.tick();
    await h.flush(60);
    sourceButtons(env)[0].click();
    await h.flush(120);
    h.check('only the group that was actually written is evicted',
      evicted.indexOf('Group:400') !== -1 && evicted.indexOf('Group:401') === -1,
      evicted.join(','));
  }
  {
    // No Apollo at all: no crash, no reload. The sibling's equivalent falls back to
    // `location.reload()`; here that would tear the page down mid-flash.
    const { env } = start({
      settings: { a1ShowManualButtons: true, e1TagsScenesToGroups: true },
      pathname: '/scenes/10',
      sourceField: { groups: [{ group: { id: '400' } }] },
      sourcePayload: { tags: [{ id: '1' }] },
      entity: { id: '400', name: 'G', tags: [], scenes: [{ id: '10', tags: [{ id: '1' }] }] },
    });
    let reloaded = false;
    env.ctx.location.reload = () => { reloaded = true; };
    tabStrip(env, ['scene-details-panel', 'scene-group-panel', 'scene-edit-panel'],
      'scene-group-panel');
    env.tick();
    await h.flush(60);
    const btn = sourceButtons(env)[0];
    btn.click();
    await h.flush(120);
    h.check('without Apollo the write still reports, and nothing reloads the page',
      /Added/.test(btn.textContent) && !reloaded, btn.textContent + ' reloaded=' + reloaded);
  }

  // ── Gating diagnostics: off by default, on from the console ──────────────────
  {
    // The switch is `StashPluginCoop.debugButtons`, typed into a live browser console -
    // no setting, no reload. Both halves matter: silence when it is off is what makes it
    // safe to leave in, and the lines when it is on are the whole point.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      entity: Object.assign({}, SCENE, { performers: [] }),   // hidden, so there is a reason to state
    });
    const said = [];
    env.ctx.console.info = (m) => said.push(String(m));
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('says nothing while the debug flag is unset', said.length === 0, said.join(' | '));

    // Switched on with the answer *already cached* - which is how anyone actually turns
    // it on: they are looking at the page whose buttons they are asking about. Reported
    // for the first release of this, because the outcome lines fired from the probe's
    // callback and a cached answer runs no probe, so the most important lines never came.
    env.ctx.window.StashPluginCoop.debugButtons = true;
    env.tick();
    await h.flush(60);
    const cached = said.filter((m) => m.indexOf('[ptp2re gate]') === 0);
    h.check('states the outcome off a cached answer, with no probe to fire',
      cached.some((m) => /tags:performer>scene/.test(m) && /hidden: no performers/.test(m)),
      cached.join(' | '));
    h.check('and asks the server for nothing to do it',
      entityQueries(env.calls).length === 1, String(entityQueries(env.calls).length));

    env.ctx.location.pathname = '/scenes/11';   // a different entity, so the probe re-arms
    env.tick();
    await h.flush(60);
    const gate = said.filter((m) => m.indexOf('[ptp2re gate]') === 0);
    h.check('and reports the gating outcome once switched on', gate.length > 0, said.join(' | '));
    h.check('naming the path and why it is hidden',
      gate.some((m) => /tags:performer>scene/.test(m) && /hidden: no performers/.test(m)),
      gate.join(' | '));

    // The tick-driven lines are deduplicated per channel, or a page nobody is touching
    // would emit the same three lines every second for as long as it is open.
    const afterFirst = said.length;
    env.tick();
    await h.flush(60);
    env.tick();
    await h.flush(60);
    h.check('two idle ticks add nothing, since the outcome has not changed',
      said.length === afterFirst, said.slice(afterFirst).join(' | '));
  }

  // ── Reconciling stale buttons ─────────────────────────────────────────────────
  {
    // A second tick with nothing changed must not duplicate the button - the
    // reconciler has to recognise its own button rather than tearing it down and
    // rebuilding it on every DOM mutation burst.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const first = manualButtons(env)[0];
    env.tick();
    await h.flush(60);
    h.check('a second tick with nothing changed does not duplicate the button',
      manualButtons(env).length === 1);
    h.check('and it is the same node, not a replacement', manualButtons(env)[0] === first);
  }
  {
    // Navigating to a different scene while the container is reused (the common SPA
    // case, one edit panel re-rendered with new props) drops the stale button rather
    // than leaving it claiming to be about the wrong entity.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const first = manualButtons(env)[0];
    h.check('the button is there for the first scene', !!first);

    env.ctx.location.pathname = '/scenes/11';
    env.tick();
    await h.flush(60);
    const now = manualButtons(env);
    h.check('exactly one button remains after navigating to a different scene', now.length === 1);
    h.check('it is a fresh button, not the one left over from scene 10',
      now[0] !== first && now[0].parentNode === container);
  }

  // ── Source-side buttons: pushing outward instead of pulling in ──────────────

  {
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [{ id: '10' }], // one scene this performer is in
    });
    detailsEditContainer(env, true); // the detail-view instance, carrying Delete
    env.tick();
    await h.flush(60);
    const btns = sourceButtons(env);
    h.check('a source button appears on the performer detail view', btns.length === 1,
      btns.map((b) => b.textContent).join(','));
    h.check('labelled for the push direction, not the target-side pull label',
      btns.length && btns[0].textContent === 'Copy Tags to all Scenes', btns[0] && btns[0].textContent);
  }
  {
    // No scenes at all for this performer - the same existence-gating philosophy as
    // the target-side buttons, applied to the push direction.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [],
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    h.check('no scenes at all hides the source button', sourceButtons(env).length === 0);
  }
  {
    // A studio-sourced path lives on `/studios/:id`, a route this plugin never had a
    // reason to recognise before source buttons existed.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b2TagsStudioToScenes: true },
      pathname: '/studios/9',
      sourceFilter: [{ id: '10' }],
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    const btns = sourceButtons(env);
    h.check('a source button appears on the studio detail view', btns.length === 1,
      btns.map((b) => b.textContent).join(','));
  }
  {
    // Live-tested and confirmed already correct, not a regression: a source button's
    // 0.13.0 reverses this one too, and it is the check that brings the source side up
    // to `MergePerformerTagsToScenes`' `hasTags && hasScenes`. The gate has two halves
    // now: `resolveSourceTargets` for "is there a target" and one by-id query for "does
    // this source carry anything". A studio with scenes but no tags of its own fails the
    // second, so the button that could only ever report "No changes" is gone.
    //
    // What the source side still does *not* ask is whether those scenes already have the
    // tags - that would mean reading every scene the studio touches, and it is the one
    // check on this page that is unbounded.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b2TagsStudioToScenes: true },
      pathname: '/studios/9',
      entity: Object.assign({}, SCENE, { studio: { id: '9', name: 'Studio', tags: [] } }),
      sourceFilter: [{ id: '10' }], // the studio has scenes, even though it has no tags
      sourcePayload: { tags: [] },   // ...and no tags, which is what now hides it
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    h.check('a studio with scenes but no tags of its own hides the button',
      sourceButtons(env).length === 0);
  }
  {
    // The mirror, so the check above cannot pass by the payload query simply never
    // being answered: the same studio with one tag shows its button.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b2TagsStudioToScenes: true },
      pathname: '/studios/9',
      entity: Object.assign({}, SCENE, { studio: { id: '9', name: 'Studio', tags: [] } }),
      sourceFilter: [{ id: '10' }],
      sourcePayload: { tags: [{ id: '1' }] },
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    h.check('and the same studio carrying one tag shows it', sourceButtons(env).length === 1);
  }
  {
    // A source whose entire payload is refused by the tag filter carries nothing, the
    // same as one with no tags at all - so the gate reads the filters rather than only
    // counting ids. Tag 1 is marked "ignore auto tag" for this one case.
    const { env } = start({
      settings: {
        a1ShowManualButtons: true, b2TagsStudioToScenes: true, f3ExcludeTagWithIgnoreAutoTag: true,
      },
      pathname: '/studios/9',
      tags: [Object.assign({}, TAGS[0], { ignore_auto_tag: true }), TAGS[1]],
      entity: Object.assign({}, SCENE, { studio: { id: '9', name: 'Studio', tags: [] } }),
      sourceFilter: [{ id: '10' }],
      sourcePayload: { tags: [{ id: '1' }] },
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    h.check('a payload the tag filter refuses in full hides the button too',
      sourceButtons(env).length === 0);
  }
  {
    // Two performer-sourced paths on one page. 0.12.11 fires their lookups with
    // `Promise.all` instead of a sequential chain - the buttons wait on the slowest
    // rather than the sum - so the thing worth pinning is that each path still gets
    // its own answer in the `has` map rather than the last one winning.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true, e4TagsPerformersToGroups: true },
      pathname: '/performers/100',
      // `tags:performer>group` is the two-hop filter lookup: the same `performers`
      // filter on findScenes, reading `groups` out of the same response.
      sourceFilter: [{ id: '10', groups: [{ group: { id: '400' } }] }],
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    const labels = sourceButtons(env).map((b) => b.textContent).sort();
    h.check('two source paths on one page are probed and gated independently',
      labels.length === 2 && labels.join('|') === 'Copy Tags to all Groups|Copy Tags to all Scenes',
      labels.join(','));
  }
  {
    // 0.12.11: the probe asks whether the list is empty, so it stops at the first page
    // that yielded something. Before, a performer or studio with more targets than one
    // page paged through every one of them to decide whether to draw a button - the
    // live symptom being that the delay scaled with how busy the entity was.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [{ id: '10' }],
      sourceFilterCount: 500, // many pages' worth, of which the probe needs one
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    h.check('the existence probe stops at the first page that found a target',
      sourceLookups(env.calls).length === 1, 'pages: ' + sourceLookups(env.calls).length);
    h.check('and still shows the button', sourceButtons(env).length === 1);
  }
  {
    // The other half of the same rule: an *empty* page is not an answer, because a
    // two-hop pick can legitimately produce nothing on page 1 and something on page 2.
    // Paging must continue exactly as it did before until something is found.
    // `tags:performer>group` reads `groups` out of the scenes the filter returns, so a
    // page full of scenes that are in no group yields nothing while the walk is very
    // much unfinished.
    const { env } = start({
      settings: { a1ShowManualButtons: true, e4TagsPerformersToGroups: true },
      pathname: '/performers/100',
      sourceFilterPages: [[{ id: '10' }], [{ id: '11', groups: [{ group: { id: '400' } }] }]],
      sourceFilterCount: 2,
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    h.check('a page that yielded nothing is not mistaken for a finished walk',
      sourceLookups(env.calls).length === 2, 'pages: ' + sourceLookups(env.calls).length);
    h.check('so the two-hop path still finds its target on the second page',
      sourceButtons(env).length === 1);
  }
  {
    // Click: resolves the one scene, plans just this one path onto it, and saves
    // immediately - there is no staging option for a button that can fan out to many
    // targets at once.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [{ id: '10' }],
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    const btn = sourceButtons(env)[0];
    if (btn) btn.click();
    await h.flush(80);
    const w = writes(env.calls);
    h.check('the source button writes directly, with no staging option to fall into', w.length === 1);
    h.check('onto the resolved scene', w.length > 0 && w[0].variables.input.ids.join() === '10');
    h.check('reports what was written', !!btn && /Added 1/.test(btn.textContent), btn && btn.textContent);
  }
  {
    // Dedup applies here too: a foreign plugin's identical-path button on the same
    // page suppresses ours, the same two-signal check as the target side.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [{ id: '10' }],
    });
    const container = detailsEditContainer(env, true);
    env.ctx.window.StashPluginCoop.declares.MergePerformerTagsToScenes = ['tags:performer>scene'];
    const foreign = h.makeElement('button');
    foreign.textContent = 'Copy Tags to all Scenes';
    container.appendChild(foreign);
    env.tick();
    await h.flush(60);
    h.check('a foreign button for the same path suppresses the source button too',
      sourceButtons(env).length === 0);
  }
  {
    // The mirror of the target side's "not removed by a later tick seeing itself",
    // which the source side never had - and 0.12.1 shipped without it because
    // `foreignButtonAlreadyShows` excluded only MANUAL_BTN_CLASS, the target class.
    //
    // No foreign button here: the path is *declared* by another plugin but that
    // plugin is showing nothing, which is the case that bites. On 0.12.1 the source
    // button matched its own label, the path was dropped, `pathIdsKey` changed, the
    // existence probe re-armed and cleared every source button while pending - then
    // the next tick saw no button, restored the path, and repeated. Live-reported as
    // a button blinking once a second on a detail page.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [{ id: '10' }],
    });
    detailsEditContainer(env, true);
    env.ctx.window.StashPluginCoop.declares.MergePerformerTagsToScenes = ['tags:performer>scene'];
    env.tick();
    await h.flush(60);
    h.check('a declared path with no foreign button still renders our source button',
      sourceButtons(env).length === 1, 'count: ' + sourceButtons(env).length);
    env.tick(); // the tick that used to see our own button and tear it down
    await h.flush(60);
    h.check('and it survives a later tick seeing itself (no blink loop)',
      sourceButtons(env).length === 1, 'count: ' + sourceButtons(env).length);
    env.tick();
    await h.flush(60);
    h.check('and a third tick leaves it alone too',
      sourceButtons(env).length === 1, 'count: ' + sourceButtons(env).length);
  }

  // ── Placement: before Delete, not appended after it ──────────────────────────
  //
  // Live-tested on Performer, Group and Studio detail pages: the source button was
  // landing after Delete instead of grouping with the other non-destructive actions,
  // the way MergePerformerTagsToScenes' own performer button already does via its
  // own `insertBeforeDelete`.
  {
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [{ id: '10' }],
    });
    const container = detailsEditContainer(env, true); // builds Delete as the first child
    const del = container.childNodes[0];
    env.tick();
    await h.flush(60);
    const btn = sourceButtons(env)[0];
    const order = container.childNodes;
    h.check('the source button lands before Delete, not appended after it', !!btn &&
      order.indexOf(btn) !== -1 && order.indexOf(btn) < order.indexOf(del),
      order.map((n) => n.textContent).join(','));
    h.check('carries no vertical margin of its own - that would inflate the shared row',
      !!btn && !/\bmy-\d\b/.test(btn.className || ''), btn && btn.className);
    // `.details-edit` is the flex one (Group Edit's wrapped rows space correctly from
    // this today), so it keeps `row-gap` - pinned explicitly rather than relying on
    // the harness default, which reports the *other* container's `display: block`.
    container._computed = { display: 'flex' };
    env.tick();
    await h.flush(60);
    h.check('a flex .details-edit gets row-gap, for when a wrapped row is needed (Studio, two paths)',
      container.style && container.style.rowGap === '.25rem', container.style);
  }
  {
    // Delete nested inside a wrapper element - the same walk-up as the target side's
    // Save handling, and the case MPTTS's own placement suite covers for its button.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [{ id: '10' }],
    });
    const container = h.makeElement('div');
    container.className = 'details-edit';
    const wrap = h.makeElement('div');
    const del = h.makeElement('button');
    del.className = 'delete';
    wrap.appendChild(del);
    container.appendChild(wrap);
    env.body.appendChild(container);
    env.tick();
    await h.flush(60);
    const btn = sourceButtons(env)[0];
    h.check('handles a Delete button nested in a wrapper element',
      !!btn && btn.nextSibling === wrap, btn && btn.nextSibling && btn.nextSibling.className);
  }
  {
    // Studio is a source for two paths at once - both land before Delete, in the
    // order they were added, rather than the second landing between the first and
    // Delete.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b2TagsStudioToScenes: true, e3TagsStudioToGroups: true },
      pathname: '/studios/9',
      sourceFilter: [{ id: '10' }],
    });
    const container = detailsEditContainer(env, true);
    const del = container.childNodes[0];
    env.tick();
    await h.flush(60);
    const btns = sourceButtons(env);
    const order = container.childNodes;
    const delIdx = order.indexOf(del);
    h.check('two source buttons on the same page, both before Delete', btns.length === 2 &&
      btns.every((b) => order.indexOf(b) < delIdx),
      order.map((n) => n.textContent).join(','));
  }
  {
    // Same coop().order contract as the target side, against Delete instead of Save:
    // a higher-priority foreign button (MergePerformerTagsToScenes' own performer
    // button, registered at 20) already in the row is not displaced from the anchor.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/performers/100',
      sourceFilter: [{ id: '10' }],
    });
    env.ctx.window.StashPluginCoop.order.MergePerformerTagsToScenes = 20;
    const container = detailsEditContainer(env, true); // builds Delete as the first child
    const del = container.childNodes[0];
    // Simulates MergePerformerTagsToScenes' own performer button already having run
    // its own insertBeforeDelete - which lands immediately to Delete's left, exactly
    // where a second plugin's insertBeforeDelete would also target.
    const foreign = h.makeElement('button');
    foreign.textContent = 'Copy Tags to all Scenes';
    foreign._coopOwner = 'MergePerformerTagsToScenes';
    container.insertBefore(foreign, del);
    env.tick();
    await h.flush(60);
    const btn = sourceButtons(env)[0];
    const order = container.childNodes;
    h.check('a higher-priority foreign button already there is not displaced from Delete',
      !!btn && order.indexOf(foreign) === order.indexOf(del) - 1,
      order.map((n) => n.textContent).join(','));
    h.check('our own source button lands on the far side of it instead of racing it for the anchor',
      !!btn && order.indexOf(btn) < order.indexOf(foreign),
      order.map((n) => n.textContent).join(','));
  }

  // ── The route matchers ────────────────────────────────────────────────────────
  {
    const { env } = start({ settings: {} });
    const rt = env.ctx.window.__ptp2re.currentRouteTarget;
    env.ctx.location.pathname = '/galleries/42';
    h.check('a gallery route is recognised', rt().target === 'gallery' && rt().id === '42');
    env.ctx.location.pathname = '/images/7/foo';
    h.check('an image route with a trailing path is still recognised',
      rt().target === 'image' && rt().id === '7');
    env.ctx.location.pathname = '/performers/1';
    h.check('a route this plugin never writes to matches nothing', rt() === null);
  }
  {
    const { env } = start({ settings: {} });
    const rt = env.ctx.window.__ptp2re.currentSourceRouteTarget;
    env.ctx.location.pathname = '/performers/1';
    h.check('a performer route is recognised as a source', rt().sourceType === 'performer' && rt().id === '1');
    env.ctx.location.pathname = '/studios/9';
    h.check('a studio route is recognised as a source', rt().sourceType === 'studio' && rt().id === '9');
    env.ctx.location.pathname = '/scenes/10';
    h.check('a scene route is recognised as a source too, the same route a target button uses',
      rt().sourceType === 'scene' && rt().id === '10');
    env.ctx.location.pathname = '/settings?tab=tasks';
    h.check('a route no source path ever reads matches nothing', rt() === null);
  }

  h.finish();
})();
