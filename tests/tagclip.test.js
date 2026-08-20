// TagBundleClipboard: the clipboard store, the two buttons, and the paste dialog.
//
// The plugin issues no mutation at all - that is its central design property - so the
// last check in this file is a blanket one asserting exactly that, and it is the one
// most worth keeping if any others are ever pared back.
//
// What this cannot cover: whether Stash's own markup still looks like these fixtures.
// `.edit-buttons`, `.details-edit` and the `-edit-panel` tab key are reproduced from
// notes, so every check here proves the plugin does the right thing with what it is
// given, never that Stash still gives it that.
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('./npt-harness');

const NPT_SRC = path.join(__dirname, '..', 'NormalizeParentTags', 'NormalizeParentTags.js');
const SRC = process.env.SRC || path.join(
  __dirname, '..', 'TagBundleClipboard', 'TagBundleClipboard.js');

const PLUGIN_ID = 'TagBundleClipboard';
const KEY = '__GTTx__.tagClipboard';

// A real enough `localStorage`: a string store that can be pre-loaded with anything,
// including something that is not ours and not even JSON.
function makeStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    data,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

function bundlesIn(store) {
  try { return JSON.parse(store.getItem(KEY)) || []; } catch (e) { return null; }
}

// Scene 42 carries Blonde (7) and Tattoo (9); Scene 43 carries Rare (11).
const SCENES = {
  42: { id: '42', title: 'Cool Shoot', files: [{ basename: 'cool.mp4' }],
    tags: [{ id: '7', name: 'Blonde' }, { id: '9', name: 'Tattoo' }] },
  43: { id: '43', title: 'Other Shoot', files: [{ basename: 'other.mp4' }], tags: [] },
};

const PERFORMERS = {
  100: { id: '100', name: 'Jane', tags: [{ id: '7', name: 'Blonde' }] },
};

// A three-deep chain, Hair > Blonde > Platinum, plus one tag standing on its own.
// Three levels rather than two on purpose: Prune and Roll Up are defined over *all*
// descendants and ancestors, and a two-level fixture would pass against a plugin that
// only ever looked one edge away.
//
// `sort_name` on the deepest one is what Stash sorts by when it is set, so the group
// ordering below is not just alphabetical on `name`.
const TAGS = [
  { id: '1', name: 'Hair', sort_name: null, aliases: ['Coiffure'],
    description: 'Everything about hair', parents: [] },
  { id: '7', name: 'Blonde', sort_name: null, aliases: [], description: null,
    parents: [{ id: '1' }] },
  { id: '12', name: 'Platinum', sort_name: 'aaa platinum', aliases: [], description: null,
    parents: [{ id: '7' }] },
  { id: '9', name: 'Tattoo', sort_name: null, aliases: [], description: null, parents: [] },
];

function responder(opts) {
  opts = opts || {};
  return function (req) {
    const q = req.query || '';
    if (q.indexOf('configuration') !== -1) {
      // Every plugin's settings arrive in this one response, which is how the sibling's
      // exclusion filters reach this plugin without a second query.
      const plugins = { TagBundleClipboard: opts.settings || {} };
      if (opts.npt || opts.nptSettings) plugins.NormalizeParentTags = opts.nptSettings || {};
      return { data: { configuration: { plugins } } };
    }
    if (/TBCPluginVersion/.test(q)) {
      return { data: { plugins: opts.installed ? [{ id: PLUGIN_ID, version: opts.installed }] : [] } };
    }
    // Both plugins ask for the whole tag table, under their own operation names. The
    // sibling loaded into this page is the real one, so its query is answered from the
    // same fixture - a plan it returns is its own code's answer, not a restatement of
    // this plugin's expectations.
    if (/TBCTagGraph/.test(q)) {
      if (opts.failGraph) return { errors: [{ message: 'no hierarchy for you' }] };
      return { data: { findTags: { tags: opts.tags || TAGS } } };
    }
    if (/NPTTags/.test(q)) {
      if (opts.failNptGraph) return { errors: [{ message: 'no hierarchy for you either' }] };
      return { data: { findTags: { tags: opts.tags || TAGS } } };
    }
    if (/TBCEntityTags/.test(q)) {
      if (opts.failTags) return { errors: [{ message: 'boom' }] };
      const id = String(req.variables.id);
      if (/findScene\(/.test(q)) return { data: { findScene: SCENES[id] || null } };
      if (/findPerformer\(/.test(q)) return { data: { findPerformer: PERFORMERS[id] || null } };
      return { data: {} };
    }
    return { data: {} };
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

// The detail-view navbar: a `.details-edit` carrying a Delete button. Performer and
// Group render this; it is where ⮺ Tags goes.
function detailNavbar(body) {
  const nav = h.makeElement('div');
  nav.className = 'details-edit';
  const del = h.makeElement('button');
  del.className = 'btn btn-danger delete';
  del.textContent = 'Delete';
  nav.appendChild(del);
  body.appendChild(nav);
  return nav;
}

// The edit form's action row, deliberately untidy: Delete is a class-less `<a>` with
// padded label text, which is what the Scene edit row actually renders. A tidier
// fixture would pass against a plugin that only looked for `button.delete`.
function editRow(body) {
  const row = h.makeElement('div');
  row.className = 'edit-buttons';
  const save = h.makeElement('button');
  save.className = 'btn btn-primary';
  save.textContent = 'Save';
  const del = h.makeElement('a');
  del.className = 'btn btn-danger';
  del.textContent = '  Delete  ';
  row.appendChild(save);
  row.appendChild(del);
  body.appendChild(row);
  return row;
}

function start(opts) {
  opts = opts || {};
  const env = h.makeEnv({
    quiet: true,
    pathname: opts.pathname || '/scenes/42',
    respond: opts.respond || responder(opts),
    clipboard: opts.clipboard,
  });
  env.store = makeStorage(opts.storage);
  env.ctx.localStorage = env.store;
  env.ctx.alert = () => {};
  env.patches = {};
  // `noPluginApi` is what a Stash too old to expose component patching looks like -
  // the branch that hides 📋Tags... rather than offering a click that cannot work.
  if (!opts.noPluginApi) {
    env.ctx.PluginApi = {
      patch: { before: (name, fn) => { env.patches[name] = fn; } },
    };
    env.ctx.window.PluginApi = env.ctx.PluginApi;
  }
  h.run(env.ctx, SRC);
  // What `NormalizeParentTags` present in this page looks like: the `respecters` entry
  // it registers unconditionally at load. Set after the plugin has run, because that is
  // when the shared object exists - and it is read at call time, so it lands in time.
  // The sibling, for real, into the same page. Prune and Roll Up are its operations
  // and this plugin no longer computes them, so a fake would be testing a fake: what
  // these checks are actually about is whether the two agree, and only the real one
  // can answer that. It registers its own `respecters` entry and its own `api` on the
  // way past, which is exactly what the plugin under test looks for.
  //
  // `nptSettings` without `npt` is the sibling installed and configured but not
  // running on this page - the case its settings linger in the config and nothing
  // reacts to a save.
  if (opts.npt) {
    h.run(env.ctx, NPT_SRC);
    // Installed and running, but from before it published a planner.
    if (opts.nptOld) delete env.ctx.__GTTx__.StashPluginCoop.api.NormalizeParentTags;
  }
  // A render of the entity's TagSelect, which is how the plugin learns what the form
  // is holding. `values` is what the box shows *now*, hand-edits included.
  env.renderTagSelect = (values) => {
    const selected = [];
    const props = {
      isMulti: true,
      values: values || [],
      onSelect: (next) => { selected.push(next); },
    };
    if (env.patches.TagSelect) env.patches.TagSelect(props);
    return { props, selected };
  };
  return env;
}

const btn = (body, label) => body.descendants()
  .filter((n) => n.tagName === 'BUTTON' && n.textContent === label)[0] || null;

// ── The store ───────────────────────────────────────────────────────────────

(async function () {
  {
    const env = start({ settings: { a1MaxBundles: 2 } });
    detailNavbar(env.body);
    await h.flush();
    env.tick();
    await h.flush();

    const copy = btn(env.body, '⮺ Tags');
    h.check('⮺ Tags lands on the detail navbar', !!copy);

    copy.click();
    await h.flush();
    let list = bundlesIn(env.store);
    h.check('a copy puts one bundle on the clipboard', list && list.length === 1,
      JSON.stringify(list));
    h.check('the bundle names the entity the way every label here does',
      list[0].label === 'Scene "Cool Shoot" (42)', list[0].label);
    h.check('it carries the tags with their names, so the picker needs no query',
      JSON.stringify(list[0].tags) ===
        JSON.stringify([{ id: '7', name: 'Blonde' }, { id: '9', name: 'Tattoo' }]),
      JSON.stringify(list[0].tags));
    h.check('and a version, because this outlives an upgrade and cannot be migrated',
      list[0].v === 1);
    h.check('the button reports the count', copy.textContent === 'Copied 2 tags',
      copy.textContent);

    // Three copies against a limit of two: the oldest goes.
    copy.click();
    await h.flush();
    copy.click();
    await h.flush();
    list = bundlesIn(env.store);
    h.check('the clipboard discards the oldest bundle when it is full',
      list.length === 2, h.plural(list.length, 'bundle'));
    h.check('and the two it kept are the two most recent',
      list[0].at <= list[1].at);
  }

  {
    // The limit is read from the settings, so an unset box means the documented 5
    // rather than "no limit" or "one".
    const env = start({ settings: {} });
    detailNavbar(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    const copy = btn(env.body, '⮺ Tags');
    for (let i = 0; i < 7; i++) { copy.click(); await h.flush(); }
    h.check('an unset bundle limit falls back to five, not to one or to no limit',
      bundlesIn(env.store).length === 5, h.plural(bundlesIn(env.store).length, 'bundle'));
  }

  {
    // Someone else's key, or a half-written one. A picker that threw here would be
    // unopenable until the user cleared their browser storage by hand.
    const env = start({ storage: { [KEY]: 'not json at all' } });
    detailNavbar(env.body);
    editRow(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    env.renderTagSelect([]);
    btn(env.body, '📋Tags...').click();
    await h.flush();
    const d = h.dialog(env.body, 'tbc');
    h.check('a clipboard that does not parse reads as empty rather than throwing',
      d.open && /clipboard is empty/.test(env.body.descendants()
        .map((n) => n.textContent).join(' ')));
  }

  {
    // A well-formed array holding something that is not one of ours.
    const env = start({ storage: { [KEY]: JSON.stringify([{ hello: 'world' }, { v: 99 }]) } });
    detailNavbar(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    btn(env.body, '⮺ Tags').click();
    await h.flush();
    const list = bundlesIn(env.store);
    h.check('entries that are not bundles are dropped rather than kept alongside ours',
      list.length === 1 && list[0].v === 1, JSON.stringify(list));
  }

  {
    const env = start({ pathname: '/scenes/43' });
    detailNavbar(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    const copy = btn(env.body, '⮺ Tags');
    copy.click();
    await h.flush();
    h.check('copying an entity with no tags stores nothing and says so',
      copy.textContent === 'No tags' && bundlesIn(env.store).length === 0,
      copy.textContent);
  }

  // ── Where the buttons go ──────────────────────────────────────────────────

  {
    const env = start({ pathname: '/settings?tab=plugins' });
    detailNavbar(env.body);
    editRow(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    h.check('neither button appears off one of the six entity pages',
      !btn(env.body, '⮺ Tags') && !btn(env.body, '📋Tags...'));
  }

  {
    const env = start({ pathname: '/performers/100' });
    detailNavbar(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    const copy = btn(env.body, '⮺ Tags');
    copy.click();
    await h.flush();
    h.check('the six types are reached by route, not just Scene',
      bundlesIn(env.store)[0].label === 'Performer "Jane" (100)',
      bundlesIn(env.store)[0].label);
  }

  {
    // The tab-strip fallback: Scene and Gallery render no detail action row at all, so
    // the plugin makes a row of its own under the strip. The strip is identified by its
    // Edit tab's key rather than by `.nav-tabs`, because Gallery renders two strips and
    // only the entity's own carries a `*-edit-panel` key.
    const env = start();
    // The decoy comes first, exactly as Gallery renders it: a second `.nav-tabs` for
    // the image list, with bare keys and no `-edit-panel` among them. A plugin matching
    // on the class alone puts its row under this one.
    const decoyWrap = h.makeElement('div');
    const decoy = h.makeElement('div');
    decoy.className = 'nav nav-tabs';
    const decoyTab = h.makeElement('a');
    decoyTab.setAttribute('data-rb-event-key', 'images');
    decoyTab.textContent = 'Edit';   // Scene renders a second element reading "Edit" too
    decoy.appendChild(decoyTab);
    decoyWrap.appendChild(decoy);
    env.body.appendChild(decoyWrap);

    const wrap = h.makeElement('div');
    const strip = h.makeElement('div');
    strip.className = 'mr-auto nav nav-tabs';
    const tab = h.makeElement('a');
    tab.setAttribute('data-rb-event-key', 'scene-edit-panel');
    tab.textContent = 'Edit';
    strip.appendChild(tab);
    wrap.appendChild(strip);
    env.body.appendChild(wrap);
    await h.flush();
    env.tick();
    await h.flush();
    const copy = btn(env.body, '⮺ Tags');
    h.check('with no navbar, ⮺ Tags goes in our own row under the tab strip',
      !!copy && h.hasClass(copy.parentNode, 'tbc-src-row'));
    h.check('and that row sits after the strip rather than inside it',
      !!copy && copy.parentNode.parentNode === wrap &&
        wrap.childNodes.indexOf(copy.parentNode) === wrap.childNodes.indexOf(strip) + 1);
  }

  {
    const env = start();
    const row = editRow(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    const paste = btn(env.body, '📋Tags...');
    const labels = row.childNodes.map((n) => n.textContent.trim());
    h.check('📋Tags... lands between Save and Delete, not after Delete',
      JSON.stringify(labels) === JSON.stringify(['Save', '📋Tags...', 'Delete']),
      JSON.stringify(labels));
    h.check('and it carries the owner the ordering protocol reads',
      paste._coopOwner === PLUGIN_ID);
    h.check('the ordering priority is registered at load',
      env.ctx.__GTTx__.StashPluginCoop.order[PLUGIN_ID] === 5,
      JSON.stringify(env.ctx.__GTTx__.StashPluginCoop.order));
    // Three of the five shared mechanisms are deliberately not used, and each absence
    // is a rule: a lease announces a write, `respecters` claims a stand-down and
    // `declares` claims a relationship path. This plugin has none of the three.
    const coop = env.ctx.__GTTx__.StashPluginCoop;
    h.check('it registers no lease, no respecter and no declaration',
      (coop.leases || []).length === 0 && !coop.respecters[PLUGIN_ID] &&
        !coop.declares[PLUGIN_ID]);
    // A fourth absence, pinned as a *pair*. `ownSettingGroup` falls back to
    // the group headed with the plugin name, and the three siblings guard that fallback
    // with `hasOwnTaskButton` so it cannot decorate Settings - Tasks, which heads its own
    // group with the same name and whose task button is destroyed by being decorated.
    // This plugin needs no guard *because* it declares no `tasks:`. Either both stay
    // absent or both arrive; a plugin that grew a task and kept the unguarded fallback
    // would break in a way nothing else here checks.
    const yml = fs.readFileSync(
      path.join(__dirname, '..', 'TagBundleClipboard', 'TagBundleClipboard.yml'), 'utf8');
    h.check('it declares no tasks, which is why the heading fallback needs no task guard',
      !/^tasks:/m.test(yml) && !/hasOwnTaskButton\s*\(/.test(fs.readFileSync(SRC, 'utf8')));
  }

  {
    const env = start();
    const row = editRow(env.body);
    // A higher-priority sibling already in the row is skipped over rather than
    // displaced, so this plugin's button lands on its far side from the anchor.
    const sib = h.makeElement('button');
    sib.className = 'btn btn-warning';
    sib.textContent = 'Add Perf Tags';
    sib._coopOwner = 'MergePerformerTagsToScenes';
    env.ctx.__GTTx__.StashPluginCoop.order.MergePerformerTagsToScenes = 20;
    row.insertBefore(sib, row.childNodes[1]);
    await h.flush();
    env.tick();
    await h.flush();
    const labels = row.childNodes.map((n) => n.textContent.trim());
    h.check('a higher-priority sibling keeps its place next to the anchor',
      JSON.stringify(labels) ===
        JSON.stringify(['Save', '📋Tags...', 'Add Perf Tags', 'Delete']),
      JSON.stringify(labels));
  }

  {
    const env = start({ noPluginApi: true });
    detailNavbar(env.body);
    editRow(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    h.check('a Stash with no component patching gets ⮺ Tags and no 📋Tags...',
      !!btn(env.body, '⮺ Tags') && !btn(env.body, '📋Tags...'));
  }

  // ── The paste dialog ──────────────────────────────────────────────────────

  // One clipboard, built by copying Scene 42 (Blonde, Tattoo) and then Performer 100
  // (Blonde), so the picker has two bundles and the newer one overlaps the older.
  const CLIP = JSON.stringify([
    { v: 1, at: 1000, type: 'scene', id: '42', label: 'Scene "Cool Shoot" (42)',
      tags: [{ id: '7', name: 'Blonde' }, { id: '9', name: 'Tattoo' }] },
    { v: 1, at: 2000, type: 'performer', id: '100', label: 'Performer "Jane" (100)',
      tags: [{ id: '7', name: 'Blonde' }] },
  ]);

  function openDialog(env, values) {
    editRow(env.body);
    return h.flush().then(() => {
      env.tick();
      return h.flush();
    }).then(() => {
      const sel = env.renderTagSelect(values);
      btn(env.body, '📋Tags...').click();
      return h.flush().then(() => sel);
    });
  }

  {
    const env = start({ storage: { [KEY]: CLIP }, pathname: '/scenes/43' });
    await openDialog(env, []);
    const names = env.body.descendants()
      .filter((n) => h.hasClass(n, 'tbc-bundle-name')).map((n) => n.textContent);
    h.check('the picker lists the bundles newest first',
      JSON.stringify(names) ===
        JSON.stringify(['Performer "Jane" (100)', 'Scene "Cool Shoot" (42)']),
      JSON.stringify(names));
    const d = h.dialog(env.body, 'tbc');
    h.check('the head says nothing is written, rather than warning about backups',
      /Nothing is written to your library/.test(d.note) && !/back/i.test(d.note), d.note);
  }

  {
    // Scene 43's form is holding Blonde already. The bundle's other tag is addable;
    // Blonde is listed, greyed and unselectable - the "selected out" the feature asks
    // for, read off the *form* rather than the server so a hand-edit counts.
    const env = start({ storage: { [KEY]: CLIP }, pathname: '/scenes/43' });
    const sel = await openDialog(env, [{ id: '7', name: 'Blonde' }]);
    // Select the older, two-tag bundle.
    env.body.descendants().filter((n) => h.hasClass(n, 'tbc-bundle'))[1].click();
    await h.flush();

    const rows = env.body.descendants().filter((n) => h.hasClass(n, 'tbc-tagrow'));
    const boxes = rows.map((r) => r.descendants().filter((n) => n.tagName === 'INPUT')[0]);
    h.check('both of the bundle tags are listed', rows.length === 2,
      h.plural(rows.length, 'row'));
    // The order is the point as much as the states: what you can still change comes
    // first, so Tattoo is above Blonde even though the bundle lists Blonde first.
    h.check('what is still selectable sorts above what was decided for you',
      /Tattoo/.test(rows[0].textContent) && /Blonde/.test(rows[1].textContent),
      rows.map((r) => r.textContent).join(' | '));
    h.check('the one it does not hold is selectable and ticked',
      boxes[0].disabled === false && boxes[0].checked === true);
    // Ticked, not clear: the tag *is* on the entity, and a clear box beside "already
    // on this Scene" said the opposite of what the row was reporting. The grey is
    // what says the tick is not the user's to change.
    h.check('the one the form already holds is disabled and ticked grey',
      boxes[1].disabled === true && boxes[1].checked === true &&
        h.hasClass(rows[1], 'tbc-tag-have'), rows[1].className);
    h.check('and says so beside the name',
      /already on this Scene/.test(rows[1].textContent), rows[1].textContent);

    const add = btn(env.body, 'Add 1 tag');
    h.check('the Add caption counts only what would actually be added', !!add);

    add.click();
    await h.flush();
    h.check('Add hands the control the union, not a replacement',
      sel.selected.length === 1 &&
        JSON.stringify(sel.selected[0].map((t) => t.id)) === JSON.stringify(['7', '9']),
      JSON.stringify(sel.selected));
    h.check('the staged item carries the keys the control renders a chip from',
      sel.selected[0][1].name === 'Tattoo' &&
        Array.isArray(sel.selected[0][1].aliases) &&
        sel.selected[0][1].image_path === null,
      JSON.stringify(sel.selected[0][1]));
    h.check('the log names what was added',
      h.dialog(env.body, 'tbc').lines.some((l) => /added 1 tag.*Tattoo/.test(l)),
      h.dialog(env.body, 'tbc').lines.join(' | '));

    // The second press is the one that matters: the diff is against the form, and the
    // form now holds what the first press put there.
    const again = btn(env.body, 'Add');
    h.check('a second Add is a no-op, because the diff is against the form',
      !!again && again.disabled === true);
    h.check('and it issued no further call to the control', sel.selected.length === 1);
  }

  {
    // The diff is read at the moment of the press, not when the dialog rendered - which
    // is what makes "against the form" mean anything. The user opens the picker, then
    // adds one of the bundle's tags to the box by hand before pressing Add.
    const env = start({ storage: { [KEY]: CLIP }, pathname: '/scenes/43' });
    const sel = await openDialog(env, []);
    env.body.descendants().filter((n) => h.hasClass(n, 'tbc-bundle'))[1].click();
    await h.flush();
    const add = btn(env.body, 'Add 2 tags');
    // A hand-edit in the box, with the dialog already drawn and no re-render.
    sel.props.values.push({ id: '7', name: 'Blonde' });
    add.click();
    await h.flush();
    h.check('a tag added to the box by hand after the dialog drew is not staged again',
      sel.selected.length === 1 &&
        JSON.stringify(sel.selected[0].map((t) => t.id)) === JSON.stringify(['7', '9']),
      JSON.stringify(sel.selected));
  }

  {
    // Nothing addable at all: every tag in the bundle is already on the form.
    const env = start({ storage: { [KEY]: CLIP }, pathname: '/scenes/43' });
    await openDialog(env, [{ id: '7', name: 'Blonde' }, { id: '9', name: 'Tattoo' }]);
    env.body.descendants().filter((n) => h.hasClass(n, 'tbc-bundle'))[1].click();
    await h.flush();
    const add = btn(env.body, 'Add');
    h.check('a bundle the form already fully holds leaves Add disabled',
      !!add && add.disabled === true);
  }

  {
    // Unticking is what the checkboxes are for.
    const env = start({ storage: { [KEY]: CLIP }, pathname: '/scenes/43' });
    const sel = await openDialog(env, []);
    env.body.descendants().filter((n) => h.hasClass(n, 'tbc-bundle'))[1].click();
    await h.flush();
    const boxes = env.body.descendants().filter((n) => h.hasClass(n, 'tbc-tagrow'))
      .map((r) => r.descendants().filter((n) => n.tagName === 'INPUT')[0]);
    boxes[0].checked = false;
    h.fire(boxes[0], 'change');
    h.check('unticking a tag drops it from the count', !!btn(env.body, 'Add 1 tag'));
    btn(env.body, 'Add 1 tag').click();
    await h.flush();
    h.check('and from what is handed to the control',
      JSON.stringify(sel.selected[0].map((t) => t.id)) === JSON.stringify(['9']),
      JSON.stringify(sel.selected));
  }

  {
    const env = start({ storage: { [KEY]: CLIP }, pathname: '/scenes/43' });
    await openDialog(env, []);
    const drop = env.body.descendants().filter((n) => h.hasClass(n, 'tbc-bundle-drop'))[0];
    drop.click();
    await h.flush();
    const left = bundlesIn(env.store);
    h.check('the ✕ removes that bundle from the clipboard, not from the view alone',
      left.length === 1 && left[0].at === 1000, JSON.stringify(left.map((b) => b.at)));
  }

  {
    // A dialog opened with no captured control is a different fact from an empty
    // entity, and conflating them would hide a placement failure behind a no-op.
    const env = start({ storage: { [KEY]: CLIP } });
    editRow(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    btn(env.body, '📋Tags...').click();     // no renderTagSelect
    await h.flush();
    // The Add button is found by prefix, not by its exact caption: a plugin that read a
    // missing control as an empty entity would label it "Add 1 tag", and looking for
    // the literal "Add" would crash the suite instead of failing this check.
    const add = env.body.descendants().filter((n) => n.tagName === 'BUTTON' &&
      n.textContent.indexOf('Add') === 0)[0];
    h.check('with no tag box found the dialog says so rather than offering an Add',
      /tag box on this page has not been found/.test(
        env.body.descendants().map((n) => n.textContent).join(' ')) &&
      !!add && add.textContent === 'Add' && add.disabled === true,
      add ? add.textContent + ' disabled=' + add.disabled : 'no Add button');
    // And the counters say the same thing rather than reporting a confident zero,
    // which would read as an answer instead of as the absence of one.
    h.check('and the counters do not claim the entity has no tags',
      /no tag box on this page to compare against/.test(h.dialog(env.body, 'tbc').progress),
      h.dialog(env.body, 'tbc').progress);
  }

  {
    const env = start({ storage: { [KEY]: CLIP } });
    await openDialog(env, []);
    h.check('the dialog is open', h.dialog(env.body, 'tbc').open);
    h.fire(env.document, 'keydown', { key: 'Escape' });
    await h.flush();
    h.check('Escape closes it, through the footer Close button',
      !h.dialog(env.body, 'tbc').open);
    h.fire(env.document, 'keydown', { key: 'Escape' });
    h.check('and the closed dialog no longer answers the key',
      (env.document.handlers.keydown || []).length === 0,
      h.plural((env.document.handlers.keydown || []).length, 'listener'));
  }

  {
    const copied = [];
    const env = start({
      storage: { [KEY]: CLIP },
      clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } },
    });
    await openDialog(env, []);
    env.body.descendants().filter((n) => h.hasClass(n, 'tbc-bundle'))[1].click();
    await h.flush();
    btn(env.body, 'Add 2 tags').click();
    await h.flush();
    btn(env.body, 'Copy log').click();
    await h.flush();
    h.check('Copy log hands over the session as text',
      copied.length === 1 && /added 2 tags/.test(copied[0]), JSON.stringify(copied));
  }

  {
    // The stale-script banner, in the dialog head. Unknown is never a mismatch, which
    // every other case above exercises by installing no version at all.
    const env = start({ storage: { [KEY]: CLIP }, installed: '9.9.9' });
    await openDialog(env, []);
    h.check('a dialog opened by a stale script says so in its head',
      /9\.9\.9 is installed/.test(h.dialog(env.body, 'tbc').stale),
      h.dialog(env.body, 'tbc').stale);
  }

  // ── Redundant parents: hover text, Prune, Roll Up ─────────────────────────

  // One bundle carrying the whole chain, so it is auto-selected on open.
  const CHAIN = JSON.stringify([
    { v: 1, at: 3000, type: 'scene', id: '42', label: 'Scene "Hairy" (42)',
      tags: [{ id: '1', name: 'Hair' }, { id: '7', name: 'Blonde' },
        { id: '12', name: 'Platinum' }] },
  ]);

  const rowsOf = (env) => env.body.descendants().filter((n) => h.hasClass(n, 'tbc-tagrow'));
  const boxesOf = (env) => rowsOf(env)
    .map((r) => r.descendants().filter((n) => n.tagName === 'INPUT')[0]);
  const stateOf = (row) => ['add', 'off', 'have', 'pruned', 'rolled']
    .filter((s) => h.hasClass(row, 'tbc-tag-' + s))[0] || null;
  const modeSel = (env) => env.body.descendants()
    .filter((n) => h.hasClass(n, 'tbc-mode'))[0] || null;

  function setMode(env, mode) {
    const sel = modeSel(env);
    sel.value = mode;
    h.fire(sel, 'change');
    return h.flush();
  }

  {
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true });
    await openDialog(env, []);
    await h.flush();
    const rows = rowsOf(env);
    // The hover text is a plain `title`, and it is the one place the aliases, the
    // description and the *children* edge reach the user - none of which is in the
    // bundle, all of which comes from the one hierarchy query.
    const hair = rows.filter((r) => /Hair/.test(r.textContent))[0];
    h.check('a tag hover names its aliases, parents, children and description',
      /Also: Coiffure/.test(hair.title) && /Children: Blonde/.test(hair.title) &&
        /Everything about hair/.test(hair.title), JSON.stringify(hair.title));
    const platinum = rows.filter((r) => /Platinum/.test(r.textContent))[0];
    h.check('and the parent edge it does have', /Parents: Blonde/.test(platinum.title),
      JSON.stringify(platinum.title));
    // The columns have no clipping of their own, so a tag name with no space in it
    // printed over the next column until the name span was given both halves of the
    // fix. No layout engine here, so this is what can be checked: the class is on the
    // element, and the rule that releases the flex floor *and* allows a mid-word break
    // is in the sheet. Neither half works alone.
    const css = fs.readFileSync(SRC, 'utf8');
    h.check('a tag name can break mid-word rather than overrun its column',
      h.hasClass(hair.descendants().filter((n) => h.hasClass(n, 'tbc-tagname'))[0] ||
        { className: '' }, 'tbc-tagname') &&
      /\.tbc-tagname[^{]*\{[^}]*min-width:0[^}]*overflow-wrap:anywhere/.test(css) &&
      /\.tbc-tagrow>\*\{min-width:0/.test(css),
      hair.className);
    // sort_name is what Stash sorts by where it is set, so Platinum leads its group
    // despite being last alphabetically by name.
    h.check('a group sorts by sort_name where there is one, like Stash does',
      JSON.stringify(rows.map((r) => stateOf(r))) ===
        JSON.stringify(['add', 'add', 'add']) &&
        /Platinum/.test(rows[0].textContent), rows.map((r) => r.textContent).join(' | '));
  }

  {
    // Prune: the entity will carry Platinum, so both of its ancestors are redundant.
    // Two levels up as well as one - Hair is nobody's *parent* here, it is Platinum's
    // grandparent, and a one-edge check would leave it addable.
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true });
    const sel = await openDialog(env, []);
    await h.flush();
    await setMode(env, 'prune');
    const rows = rowsOf(env);
    h.check('Prune drops every ancestor of a tag that is going on, at any depth',
      JSON.stringify(rows.map((r) => stateOf(r))) ===
        JSON.stringify(['add', 'pruned', 'pruned']),
      rows.map((r) => r.textContent + ':' + stateOf(r)).join(' | '));
    h.check('a pruned box is clear and cannot be ticked back',
      boxesOf(env)[1].checked === false && boxesOf(env)[1].disabled === true);
    btn(env.body, 'Add 1 tag').click();
    await h.flush();
    h.check('and only the survivor reaches the control',
      JSON.stringify(sel.selected[0].map((t) => t.id)) === JSON.stringify(['12']),
      JSON.stringify(sel.selected));
  }

  {
    // Prune reaches *past* a level the bundle does not carry. Hair and Platinum with
    // no Blonde between them: one edge down from Hair finds only Blonde, which is not
    // going on, so a one-edge check leaves Hair addable and the fully-populated chain
    // above cannot tell the difference - it prunes the same three rows either way.
    const GAP = JSON.stringify([
      { v: 1, at: 3000, type: 'scene', id: '42', label: 'Scene "Gap" (42)',
        tags: [{ id: '1', name: 'Hair' }, { id: '12', name: 'Platinum' }] },
    ]);
    const env = start({ storage: { [KEY]: GAP }, pathname: '/scenes/43', npt: true });
    await openDialog(env, []);
    await h.flush();
    await setMode(env, 'prune');
    const rows = rowsOf(env);
    h.check('Prune reaches past a level the bundle does not contain',
      JSON.stringify(rows.map((r) => stateOf(r))) === JSON.stringify(['add', 'pruned']),
      rows.map((r) => r.textContent + ':' + stateOf(r)).join(' | '));
  }

  {
    // Prune depends on the *current* selection, which is the half a static plan would
    // get wrong: untick the tag that was making the others redundant and they come
    // back as ordinary, tickable rows.
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true });
    await openDialog(env, []);
    await h.flush();
    await setMode(env, 'prune');
    const platinum = boxesOf(env)[0];
    platinum.checked = false;
    h.fire(platinum, 'change');
    await h.flush();
    const rows = rowsOf(env);
    // Blonde is addable again (its only descendant is no longer going on), Platinum
    // is the box the user cleared, and Hair is still redundant - Blonde is below it.
    h.check('unticking the deepest tag un-prunes what it was making redundant',
      JSON.stringify(rows.map((r) => stateOf(r))) === JSON.stringify(['add', 'off', 'pruned']),
      rows.map((r) => r.textContent + ':' + stateOf(r)).join(' | '));
  }

  {
    // Roll Up is the inverse, and it reaches tags the bundle never carried: a bundle
    // of one deep tag brings both levels above it.
    const DEEP = JSON.stringify([
      { v: 1, at: 3000, type: 'scene', id: '42', label: 'Scene "Deep" (42)',
        tags: [{ id: '12', name: 'Platinum' }] },
    ]);
    const env = start({ storage: { [KEY]: DEEP }, pathname: '/scenes/43', npt: true });
    const sel = await openDialog(env, []);
    await h.flush();
    await setMode(env, 'rollup');
    const rows = rowsOf(env);
    h.check('Roll Up lists the ancestors the bundle does not contain',
      rows.length === 3 && JSON.stringify(rows.map((r) => stateOf(r))) ===
        JSON.stringify(['add', 'rolled', 'rolled']),
      rows.map((r) => r.textContent + ':' + stateOf(r)).join(' | '));
    h.check('a rolled-up box is ticked and fixed, not merely suggested',
      boxesOf(env)[1].checked === true && boxesOf(env)[1].disabled === true);
    btn(env.body, 'Add 3 tags').click();
    await h.flush();
    h.check('and all three reach the control',
      JSON.stringify(sel.selected[0].map((t) => t.id).sort()) ===
        JSON.stringify(['1', '12', '7']), JSON.stringify(sel.selected));
  }

  {
    // The user's tie-break: a rolled-up tag the entity already carries reads as
    // already-there, which is the truer of the two - Roll Up has nothing to add.
    const DEEP = JSON.stringify([
      { v: 1, at: 3000, type: 'scene', id: '42', label: 'Scene "Deep" (42)',
        tags: [{ id: '12', name: 'Platinum' }] },
    ]);
    const env = start({ storage: { [KEY]: DEEP }, pathname: '/scenes/43', npt: true });
    await openDialog(env, [{ id: '1', name: 'Hair' }]);
    await h.flush();
    await setMode(env, 'rollup');
    const rows = rowsOf(env);
    // By prefix: a row's textContent runs the tag name straight into its state mark.
    const byName = {};
    ['Hair', 'Blonde', 'Platinum'].forEach((n) => {
      const row = rows.filter((r) => r.textContent.indexOf(n) === 0)[0];
      byName[n] = row ? stateOf(row) : null;
    });
    h.check('already-on-target beats rolled-up, and the rest still rolls up',
      byName.Hair === 'have' && byName.Blonde === 'rolled' && byName.Platinum === 'add',
      JSON.stringify(byName));
  }

  {
    // No hierarchy, no redundancy modes: holding them at "leave as they are" is the
    // honest answer, where applying either against an empty graph would silently mean
    // "nothing is redundant" and look like the mode had run.
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43', failGraph: true, npt: true });
    await openDialog(env, []);
    await h.flush();
    h.check('a hierarchy that cannot be read disables the modes and says so',
      modeSel(env).disabled === true &&
        h.dialog(env.body, 'tbc').lines.some((l) => /tag hierarchy could not be read/.test(l)),
      h.dialog(env.body, 'tbc').lines.join(' | '));
  }

  // ── The modes belong to NormalizeParentTags, and answer to its exclusions ──

  const graphQuery = (env) =>
    (env.calls.filter((c) => /TBCTagGraph/.test(c.query || ''))[0] || {}).query || '';

  {
    // No sibling on the page, no Prune and no Roll Up: they are that plugin's
    // operations, and offering them where it is absent would mean this dialog acting
    // on a hierarchy under rules nobody had set.
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43' });
    await openDialog(env, []);
    await h.flush();
    h.check('with NormalizeParentTags absent the mode select is hidden',
      h.hasClass(modeSel(env), 'tbc-hidden'), modeSel(env).className);
    h.check('and the log says why rather than leaving a gap',
      h.dialog(env.body, 'tbc').lines.some((l) => /not running on this page/.test(l)),
      h.dialog(env.body, 'tbc').lines.join(' | '));
    // Even driven directly, the mode cannot take effect - the gate is in `classify`,
    // not only on the control.
    await setMode(env, 'prune');
    h.check('and a mode set anyway changes nothing',
      JSON.stringify(rowsOf(env).map((r) => stateOf(r))) ===
        JSON.stringify(['add', 'add', 'add']),
      rowsOf(env).map((r) => r.textContent + ':' + stateOf(r)).join(' | '));
  }

  {
    // Its "never remove" name filter, with its own separator setting, protects a tag
    // from Prune: this dialog declining to add a parent reaches the same end state as
    // that plugin removing one, so it is the remove side that governs.
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true,
      nptSettings: { c3ExcludeRemoveTagNameContains: 'Hai, Nope', c4TagNameSeparator: ',' } });
    await openDialog(env, []);
    await h.flush();
    await setMode(env, 'prune');
    const rows = rowsOf(env);
    const hair = rows.filter((r) => r.textContent.indexOf('Hair') === 0)[0];
    h.check('a tag the sibling never removes is not pruned',
      stateOf(hair) === 'add', rows.map((r) => r.textContent + ':' + stateOf(r)).join(' | '));
    h.check('and its hover says which plugin spared it and why',
      /never removes this tag \(name filter\)/.test(hair.title), JSON.stringify(hair.title));
    // Blonde is not protected, so the mode is still doing its job around it.
    const blonde = rows.filter((r) => r.textContent.indexOf('Blonde') === 0)[0];
    h.check('while an unprotected tag is still pruned', stateOf(blonde) === 'pruned',
      blonde.textContent);
  }

  {
    // The other side of the mapping: Roll Up adds, so it answers to "never add".
    const DEEP = JSON.stringify([
      { v: 1, at: 3000, type: 'scene', id: '42', label: 'Scene "Deep" (42)',
        tags: [{ id: '12', name: 'Platinum' }] },
    ]);
    const env = start({ storage: { [KEY]: DEEP }, pathname: '/scenes/43', npt: true,
      nptSettings: { c2ExcludeAddTagNameContains: 'Hair' } });
    await openDialog(env, []);
    await h.flush();
    await setMode(env, 'rollup');
    const rows = rowsOf(env);
    h.check('a tag the sibling never adds is not rolled up, and is not listed either',
      rows.length === 2 && !rows.some((r) => r.textContent.indexOf('Hair') === 0),
      rows.map((r) => r.textContent + ':' + stateOf(r)).join(' | '));
  }

  {
    // `ignore_auto_tag` only excludes while the sibling's own toggle is on, which is
    // what makes this a mirror of its rules rather than a rule of ours.
    const marked = TAGS.map((t) => (t.id === '1' ? Object.assign({}, t, { ignore_auto_tag: true }) : t));
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true,
      tags: marked, nptSettings: { c1ExcludeTagWithIgnoreAutoTag: true } });
    await openDialog(env, []);
    await h.flush();
    await setMode(env, 'prune');
    const hair = rowsOf(env).filter((r) => r.textContent.indexOf('Hair') === 0)[0];
    h.check('Ignore auto tag excludes a tag when the sibling asks it to',
      stateOf(hair) === 'add' && /Ignore auto tag/.test(hair.title), JSON.stringify(hair.title));
  }

  {
    // The custom-field filter, excluding on presence alone. The check that matters is
    // not that this passes - it is *where* it passes from: this plugin's own query
    // asks for neither `custom_fields` nor `ignore_auto_tag`, so nothing in this file
    // could evaluate either filter. The sibling fetched what it needed, on its own
    // query, and applied its own rules.
    const marked = TAGS.map((t) => (t.id === '1' ? Object.assign({}, t, { custom_fields: { keep: 'yes' } }) : t));
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true,
      tags: marked, nptSettings: { c6ExcludeRemoveTagWithCustomFieldName: 'keep' } });
    await openDialog(env, []);
    await h.flush();
    await setMode(env, 'prune');
    const hair = rowsOf(env).filter((r) => r.textContent.indexOf('Hair') === 0)[0];
    h.check('a tag carrying that field is spared, on presence alone',
      stateOf(hair) === 'add' && /custom field "keep"/.test(hair.title),
      JSON.stringify(hair.title));
    h.check('and this plugin asked for no field a tag exclusion is read from',
      !/custom_fields/.test(graphQuery(env)) && !/ignore_auto_tag/.test(graphQuery(env)),
      graphQuery(env));
  }

  // ── Undo ──────────────────────────────────────────────────────────────────

  {
    const env = start({ storage: { [KEY]: CLIP }, pathname: '/scenes/43' });
    const sel = await openDialog(env, [{ id: '11', name: 'Rare' }]);
    await h.flush();
    env.body.descendants().filter((n) => h.hasClass(n, 'tbc-bundle'))[1].click();
    await h.flush();
    h.check('Undo is dead until there is a paste to take back',
      btn(env.body, 'Undo').disabled === true);
    btn(env.body, 'Add 2 tags').click();
    await h.flush();
    h.check('and live once there is', btn(env.body, 'Undo').disabled === false);
    btn(env.body, 'Undo').click();
    await h.flush();
    // The control is handed the *earlier list*, not a removal instruction: this plugin
    // issues no mutation, so an undo is the same one call an Add is.
    h.check('Undo hands the control back exactly what the box held before',
      sel.selected.length === 2 &&
        JSON.stringify(sel.selected[1].map((t) => t.id)) === JSON.stringify(['11']),
      JSON.stringify(sel.selected));
    h.check('the tags are offered again afterwards', !!btn(env.body, 'Add 2 tags'));
    h.check('and Undo goes dead again with nothing left to take back',
      btn(env.body, 'Undo').disabled === true);
  }

  // ── What the captions gave up, and what the colour says ───────────────────

  {
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/42' });
    detailNavbar(env.body);
    await openDialog(env, []);
    // Both captions are a pictogram and a noun, which says what the button is about
    // only to someone who already knows. The words they dropped lead the title.
    h.check('the copy button spells its caption out on the first line of its title',
      btn(env.body, '⮺ Tags').title.indexOf('Copy Tags\n\n') === 0,
      JSON.stringify(btn(env.body, '⮺ Tags').title));
    h.check('and the paste button the same, without the caption’s dots',
      btn(env.body, '📋Tags...').title.indexOf('Paste Tags\n\n') === 0,
      JSON.stringify(btn(env.body, '📋Tags...').title));
    // Amber is this repo's "a plugin wrote this": Add changes the form behind the
    // dialog, and it is the same colour as the button that opened it.
    h.check('Add wears the same amber as the button that opened the dialog',
      h.hasClass(btn(env.body, 'Add 3 tags'), 'btn-warning') &&
        h.hasClass(btn(env.body, '📋Tags...'), 'btn-warning'),
      btn(env.body, 'Add 3 tags').className);
    h.check('while the copy button, which only reads, stays teal',
      h.hasClass(btn(env.body, '⮺ Tags'), 'btn-info'),
      btn(env.body, '⮺ Tags').className);
  }

  {
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true });
    await openDialog(env, []);
    await h.flush();
    h.check('the mode select is plain while it is leaving things alone',
      !h.hasClass(modeSel(env), 'tbc-mode-on'), modeSel(env).className);
    await setMode(env, 'prune');
    h.check('and goes amber once it is deciding what the press adds or drops',
      h.hasClass(modeSel(env), 'tbc-mode-on'), modeSel(env).className);
    await setMode(env, 'asis');
    h.check('and back again', !h.hasClass(modeSel(env), 'tbc-mode-on'),
      modeSel(env).className);
  }

  // ── Where the rules live now ──────────────────────────────────────────────

  {
    // Two questions this plugin used to have to answer - what happens when the
    // sibling's exclusions change in another tab, and what happens when it gains a
    // rule this file has never heard of - and one answer to both: it is not this
    // plugin's business. It reads none of those settings, so there is nothing here to
    // go stale and nothing to fail to recognise. The hierarchy it does read is for the
    // hover text, and is fetched once.
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/42', npt: true,
      nptSettings: { c7ExcludeSomethingNewer: 'x', c2ExcludeAddTagNameContains: 'Hair' } });
    detailNavbar(env.body);
    await openDialog(env, []);
    await h.flush();
    btn(env.body, 'Close').click();
    btn(env.body, '📋Tags...').click();
    await h.flush();
    const queries = env.calls.filter((c) => /TBCTagGraph/.test(c.query || ''));
    h.check('the hierarchy is fetched once and never invalidated',
      queries.length === 1, queries.map((c) => c.query).join(' | '));
    const lines = h.dialog(env.body, 'tbc').lines.join(' | ');
    h.check('and no settings key of the sibling’s is named in the log',
      !/c7ExcludeSomethingNewer/.test(lines) && !/c2ExcludeAddTagNameContains/.test(lines),
      lines);
  }

  {
    // Installed, running, and older than the release that publishes a planner. The
    // modes are not offered rather than computed here, and the line names the version
    // to upgrade to - this dialog cannot work them out on its own any more.
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43',
      npt: true, nptOld: true });
    await openDialog(env, []);
    await h.flush();
    const lines = h.dialog(env.body, 'tbc').lines.join(' | ');
    h.check('a sibling too old to be asked hides the modes and names the version',
      /older than 3\.2\.0/.test(lines) && h.hasClass(modeSel(env), 'tbc-hidden'), lines);
  }

  // ── The sibling's automatic modes act on the save this dialog defers to ───

  const autoOpts = (extra) => Object.assign(
    { storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true }, extra);

  {
    const env = start(autoOpts({
      nptSettings: { a1AutoModes: 'SCENES=PRUNE' } }));
    await openDialog(env, []);
    await h.flush();
    const lines = h.dialog(env.body, 'tbc').lines.join(' | ');
    // Not about which tags are protected: Stash's Save is what that plugin reacts to,
    // and it will undo the paste in the same breath. Asked of it rather than read off
    // its settings, so the day it partitions those differently this still holds.
    h.check('an automatic mode on this type is called out against the Save this dialog defers to',
      /set to prune Scenes automatically/.test(lines) &&
        /when you press Save/.test(lines), lines);
    // And the dropdown goes with it: choosing here would be choosing between two
    // operations it is about to overrule anyway.
    h.check('and the redundancy choice is withdrawn, since it is already being made',
      h.hasClass(modeSel(env), 'tbc-hidden'), modeSel(env).className);
    // Withdrawn in `classify` as well as on the control, the same as the gate for a
    // sibling that is not there at all: a hidden select is a statement about the UI,
    // not about what a press does.
    await setMode(env, 'prune');
    h.check('and a mode set anyway is still not applied',
      JSON.stringify(rowsOf(env).map((r) => stateOf(r))) ===
        JSON.stringify(['add', 'add', 'add']),
      rowsOf(env).map((r) => r.textContent + ':' + stateOf(r)).join(' | '));
  }

  {
    const env = start(autoOpts({
      nptSettings: { a1AutoModes: 'SCENES=ROLLUP' } }));
    await openDialog(env, []);
    await h.flush();
    h.check('and Auto Roll Up says what it will add instead',
      /add every ancestor of the tags added here/
        .test(h.dialog(env.body, 'tbc').lines.join(' | ')),
      h.dialog(env.body, 'tbc').lines.join(' | '));
  }

  {
    // The type it is being pasted onto is the whole question. Scenes off there means
    // the mode does not fire on this save, so there is nothing to warn about.
    const env = start(autoOpts({
      nptSettings: { a1AutoModes: 'IMAGES=PRUNE, SCENES=OFF' } }));
    await openDialog(env, []);
    await h.flush();
    h.check('a mode set for a type this is not says nothing',
      !/automatically/.test(h.dialog(env.body, 'tbc').lines.join(' | ')),
      h.dialog(env.body, 'tbc').lines.join(' | '));
  }

  {
    // The settings that plugin had up to 3.2.0, migrated on the way in. Nothing here
    // knows that happened, which is the point of asking it rather than reading them:
    // this file has never mentioned a setting key of its sibling's.
    const env = start(autoOpts({ nptSettings: {
      a8AutoPruneOnUpdate: true, a5EnableScenes: true } }));
    await openDialog(env, []);
    await h.flush();
    h.check('a pre-4.0.0 sibling answers from its migrated settings',
      /set to prune Scenes automatically/.test(h.dialog(env.body, 'tbc').lines.join(' | ')),
      h.dialog(env.body, 'tbc').lines.join(' | '));
  }

  {
    // Settings in the config but nothing running on the page. This used to warn from
    // those settings, with a sentence about not being able to tell a disabled plugin
    // from one too old to register. It says nothing now, and that is the same rule as
    // everywhere else here: the question is answered by asking that plugin, and a
    // plugin that is not there cannot be asked. Nothing in this tab's save will reach
    // it either.
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43',
      nptSettings: { a1AutoModes: 'SCENES=PRUNE' } });
    await openDialog(env, []);
    await h.flush();
    const lines = h.dialog(env.body, 'tbc').lines.join(' | ');
    h.check('a sibling that is not on the page prompts no claim about what it will do',
      !/automatically/.test(lines) && /not running on this page/.test(lines), lines);
  }

  // ── A settings change reaching a dialog that is already open ──────────────

  {
    // The planner is a snapshot, bound once so `plan` can be synchronous. Coming back
    // to the tab is what re-binds it - and changing those settings means going to
    // Stash's settings page, which cannot be done in this tab without leaving the
    // entity page, so a second tab is the only way it happens at all.
    const opts = { storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true,
      nptSettings: {} };
    const env = start(opts);
    await openDialog(env, []);
    await setMode(env, 'prune');
    h.check('Prune plans against the sibling’s settings as they were on open',
      JSON.stringify(rowsOf(env).map((r) => stateOf(r))) ===
        JSON.stringify(['add', 'pruned', 'pruned']),
      rowsOf(env).map((r) => r.textContent + ':' + stateOf(r)).join(' | '));

    // Changed elsewhere, and the sibling's own settings cache has to expire before it
    // will see them either - the clock is what makes this a test of the refresh rather
    // than of two caches.
    opts.nptSettings = { c3ExcludeRemoveTagNameContains: 'Hair' };
    const realNow = Date.now;
    try {
      Date.now = () => realNow.call(Date) + 60000;
      // The event fires on the way out as well as on the way back. Going away is not
      // when to re-read anything, and a re-plan there would redraw the list behind a
      // tab the user is leaving.
      env.ctx.document.hidden = true;
      h.fire(env.ctx.document, 'visibilitychange');
      await h.flush();
      h.check('the tab being hidden is not a reason to re-plan',
        stateOf(rowsOf(env).filter((r) => r.textContent.indexOf('Hair') === 0)[0]) === 'pruned',
        rowsOf(env).map((r) => r.textContent + ':' + stateOf(r)).join(' | '));
      env.ctx.document.hidden = false;
      h.fire(env.ctx.document, 'visibilitychange');
      await h.flush();
    } finally {
      Date.now = realNow;
    }
    const rows = rowsOf(env);
    const hair = rows.filter((r) => r.textContent.indexOf('Hair') === 0)[0];
    h.check('coming back to the tab re-plans against the new ones',
      stateOf(hair) === 'add' && /never removes this tag \(name filter\)/.test(hair.title),
      rows.map((r) => r.textContent + ':' + stateOf(r)).join(' | '));
    h.check('and the log says why the list moved under the user',
      h.dialog(env.body, 'tbc').lines.some((l) => /settings changed/.test(l)),
      h.dialog(env.body, 'tbc').lines.join(' | '));
  }

  {
    // A refresh that changes nothing must not redraw: it would reset the scroll of a
    // long list every time the user glanced at another tab and came back.
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true });
    await openDialog(env, []);
    await h.flush();
    const before = h.dialog(env.body, 'tbc').lines.length;
    h.fire(env.ctx.document, 'visibilitychange');
    await h.flush();
    h.check('a refresh with nothing to report says nothing',
      h.dialog(env.body, 'tbc').lines.length === before,
      h.dialog(env.body, 'tbc').lines.join(' | '));
  }

  {
    // An automatic mode switched on while the dialog sits open: the dropdown has to go
    // with it, and the line naming what will happen on Save is worth repeating because
    // the answer is new.
    const opts = { storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true,
      nptSettings: { a1AutoModes: 'SCENES=OFF' } };
    const env = start(opts);
    await openDialog(env, []);
    await h.flush();
    h.check('the redundancy choice is offered while nothing is automatic',
      !h.hasClass(modeSel(env), 'tbc-hidden'), modeSel(env).className);

    opts.nptSettings = { a1AutoModes: 'SCENES=PRUNE' };
    const realNow = Date.now;
    try {
      Date.now = () => realNow.call(Date) + 60000;
      h.fire(env.ctx.document, 'visibilitychange');
      await h.flush();
    } finally {
      Date.now = realNow;
    }
    h.check('and withdrawn the moment that plugin starts doing it on every save',
      h.hasClass(modeSel(env), 'tbc-hidden'), modeSel(env).className);
    h.check('with the reason logged, not left to be inferred from a missing control',
      h.dialog(env.body, 'tbc').lines.some((l) => /set to prune Scenes automatically/.test(l)),
      h.dialog(env.body, 'tbc').lines.join(' | '));
  }

  {
    // The listener goes with the dialog. One left behind would answer for a closed run
    // and re-plan against a `_bundle` nobody is looking at.
    const env = start({ storage: { [KEY]: CHAIN }, pathname: '/scenes/43', npt: true });
    await openDialog(env, []);
    await h.flush();
    h.check('an open dialog listens for the tab coming back',
      (env.ctx.document.handlers.visibilitychange || []).length === 1,
      String((env.ctx.document.handlers.visibilitychange || []).length));
    btn(env.body, 'Close').click();
    h.check('and takes the listener with it when it closes',
      (env.ctx.document.handlers.visibilitychange || []).length === 0,
      String((env.ctx.document.handlers.visibilitychange || []).length));
  }

  // ── The property the whole design rests on ────────────────────────────────

  {
    const env = start({ storage: { [KEY]: CLIP }, pathname: '/scenes/43' });
    detailNavbar(env.body);
    const sel = await openDialog(env, []);
    env.body.descendants().filter((n) => h.hasClass(n, 'tbc-bundle'))[1].click();
    await h.flush();
    btn(env.body, 'Add 2 tags').click();
    await h.flush();
    btn(env.body, '⮺ Tags').click();
    await h.flush();
    h.check('the tags reached the form', sel.selected.length === 1);
    const mutations = env.calls.filter((c) => /\bmutation\b/.test(c.query || ''));
    h.check('and not one mutation was issued, by any path in the plugin',
      mutations.length === 0, mutations.map((c) => c.query).join(' | '));
  }

  h.finish();
}());
