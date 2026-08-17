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
const path = require('path');
const h = require('./npt-harness');

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

function responder(opts) {
  opts = opts || {};
  return function (req) {
    const q = req.query || '';
    if (q.indexOf('configuration') !== -1) {
      return { data: { configuration: { plugins: { TagBundleClipboard: opts.settings || {} } } } };
    }
    if (/TBCPluginVersion/.test(q)) {
      return { data: { plugins: opts.installed ? [{ id: PLUGIN_ID, version: opts.installed }] : [] } };
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
// Group render this; it is where Copy Tags goes.
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
  // the branch that hides Paste Tags rather than offering a click that cannot work.
  if (!opts.noPluginApi) {
    env.ctx.PluginApi = {
      patch: { before: (name, fn) => { env.patches[name] = fn; } },
    };
    env.ctx.window.PluginApi = env.ctx.PluginApi;
  }
  h.run(env.ctx, SRC);
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

    const copy = btn(env.body, 'Copy Tags');
    h.check('Copy Tags lands on the detail navbar', !!copy);

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
    const copy = btn(env.body, 'Copy Tags');
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
    btn(env.body, 'Paste Tags...').click();
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
    btn(env.body, 'Copy Tags').click();
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
    const copy = btn(env.body, 'Copy Tags');
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
      !btn(env.body, 'Copy Tags') && !btn(env.body, 'Paste Tags...'));
  }

  {
    const env = start({ pathname: '/performers/100' });
    detailNavbar(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    const copy = btn(env.body, 'Copy Tags');
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
    const copy = btn(env.body, 'Copy Tags');
    h.check('with no navbar, Copy Tags goes in our own row under the tab strip',
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
    const paste = btn(env.body, 'Paste Tags...');
    const labels = row.childNodes.map((n) => n.textContent.trim());
    h.check('Paste Tags lands between Save and Delete, not after Delete',
      JSON.stringify(labels) === JSON.stringify(['Save', 'Paste Tags...', 'Delete']),
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
        JSON.stringify(['Save', 'Paste Tags...', 'Add Perf Tags', 'Delete']),
      JSON.stringify(labels));
  }

  {
    const env = start({ noPluginApi: true });
    detailNavbar(env.body);
    editRow(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    h.check('a Stash with no component patching gets Copy Tags and no Paste Tags',
      !!btn(env.body, 'Copy Tags') && !btn(env.body, 'Paste Tags...'));
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
      btn(env.body, 'Paste Tags...').click();
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
    h.check('the one the form already holds is disabled and unticked',
      boxes[0].disabled === true && boxes[0].checked === false);
    h.check('and says so beside the name',
      /already on this Scene/.test(rows[0].textContent), rows[0].textContent);
    h.check('the one it does not hold is selectable and ticked',
      boxes[1].disabled === false && boxes[1].checked === true);

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
    btn(env.body, 'Paste Tags...').click();     // no renderTagSelect
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

  // ── The property the whole design rests on ────────────────────────────────

  {
    const env = start({ storage: { [KEY]: CLIP }, pathname: '/scenes/43' });
    detailNavbar(env.body);
    const sel = await openDialog(env, []);
    env.body.descendants().filter((n) => h.hasClass(n, 'tbc-bundle'))[1].click();
    await h.flush();
    btn(env.body, 'Add 2 tags').click();
    await h.flush();
    btn(env.body, 'Copy Tags').click();
    await h.flush();
    h.check('the tags reached the form', sel.selected.length === 1);
    const mutations = env.calls.filter((c) => /\bmutation\b/.test(c.query || ''));
    h.check('and not one mutation was issued, by any path in the plugin',
      mutations.length === 0, mutations.map((c) => c.query).join(' | '));
  }

  h.finish();
}());
