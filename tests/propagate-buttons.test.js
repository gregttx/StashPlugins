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
      data[m[1]] = opts.entity !== undefined ? opts.entity : SCENE;
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
      const list = opts.sourceFilter !== undefined ? opts.sourceFilter : [];
      const data = {};
      data[msl[1]] = { count: list.length };
      data[msl[1]][node] = list;
      return { data };
    }
    if (/mutation PTP_bulk/.test(q)) {
      if (opts.failWrite) return { errors: [{ message: 'write boom' }] };
      return { data: { ok: [] } };
    }
    return { data: {} };
  };
}

const FIND_TO_NODE = { findScenes: 'scenes', findGroups: 'groups', findGalleries: 'galleries', findImages: 'images' };

function editButtonsContainer(env) {
  const c = h.makeElement('div');
  c.className = 'edit-buttons';
  env.body.appendChild(c);
  return c;
}

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
  env.ctx.PluginApi = { patch: { before: (n, fn) => { patches[n] = fn; } } };
  env.ctx.window.PluginApi = env.ctx.PluginApi;
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
    // 0.9.2 moved wrapped-row spacing to the container's own `row-gap`, which sits
    // between flex lines rather than inflating either one - see `ensureRowGap`.
    h.check('the container gets row-gap instead, so Stash\'s own buttons never stretch to match ours',
      container.style && container.style.rowGap === '.25rem', container.style);
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
    // Group's edit-form state carries no Delete at all (§5b/§5d) - the button lands
    // after Save by simply landing last, the same fallback `insertBeforeDelete`
    // already used on the source side for a Delete-less page.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    const save = h.makeElement('button');
    save.textContent = 'Save';
    container.appendChild(save);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    const order = container.childNodes;
    h.check('with no Delete in the container, the button lands after Save at the end',
      !!btn && order.indexOf(btn) === order.indexOf(save) + 1 && order.indexOf(btn) === order.length - 1,
      order.map((n) => n.textContent).join(','));
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
    // The scene has a performer, and that performer's only tag is already on the
    // scene - nothing left to *add*. The button still shows: existence gating only
    // asks "is there a performer here", never "would a click actually change
    // anything" - the latter is Improvement #4, deferred by explicit preference for
    // a button that is sometimes unneeded over one that is missing when needed.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      entity: Object.assign({}, SCENE, { tags: [{ id: '1' }] }),
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('a source with nothing new to add still shows the button', manualButtons(env).length === 1);
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
    const btn = manualButtons(env)[0];
    btn.click();
    await h.flush(80);
    h.check('nothing to add issues no mutation', writes(env.calls).length === 0);
    h.check('and reports no changes', btn.textContent === 'No changes', btn.textContent);
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
  const sourceButtons = (env) => (env.body.descendants() || [])
    .filter((n) => h.hasClass(n, 'ptp2re-manual-src-btn'));

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
    // existence gate is `checkSourceButtonExistence`, which asks `resolveSourceTargets`
    // whether any *target* exists (scenes, here) - never whether the source entity
    // itself carries the tags being pushed. So a studio with zero tags of its own
    // still shows "Copy Tags to all Scenes" as long as it has scenes to push into;
    // the button reporting "No changes" on click is the correct outcome for that
    // click, not a reason to hide it up front - the same Improvement #4 boundary the
    // target-side existence gate draws. This test names the scenario explicitly
    // rather than relying on the studio-button test above never happening to set
    // `entity`/studio tags at all.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b2TagsStudioToScenes: true },
      pathname: '/studios/9',
      entity: Object.assign({}, SCENE, { studio: { id: '9', name: 'Studio', tags: [] } }),
      sourceFilter: [{ id: '10' }], // the studio has scenes, even though it has no tags
    });
    detailsEditContainer(env, true);
    env.tick();
    await h.flush(60);
    h.check('a studio with no tags of its own still shows the button, gated on its scenes existing',
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
    h.check('the container gets row-gap instead, for when a wrapped row is needed (Studio, two paths)',
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
