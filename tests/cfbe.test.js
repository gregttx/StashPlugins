// GTTx Custom Fields Bulk Editor: the menu item it injects into a list view's "..."
// dropdown, and the dialog that item opens.
//
// Two halves, and the first is the one that cannot be checked any other way. The
// plugin's only foothold in Stash's markup is a dropdown that exists for as long as
// it is open, and it turns a *selection* back into ids by reading the DOM - so the
// fixtures here are Stash's list markup as far as it is known, and the checks are
// mostly about restraint: which checkboxes are not a selection, which routes are not
// a list, and which dropdown is not the one to inject into.
//
// Runs on npt-harness.js, whose DOM is real enough for a dialog.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const SRC = process.env.SRC || path.join(
  __dirname, '..', 'CustomFieldsBulkEditor', 'CustomFieldsBulkEditor.js');

// ── Fixtures ────────────────────────────────────────────────────────────────

// The "..." dropdown as react-bootstrap mounts it while open: a toggle carrying the
// id Stash gives it, and the menu beside it holding the selection operations.
function mountMenu(body, opts) {
  opts = opts || {};
  const wrap = h.makeElement('div');
  wrap.className = 'dropdown';
  const toggle = h.makeElement('button');
  if (!opts.noId) toggle.id = 'more-menu';
  toggle.className = 'dropdown-toggle';
  const menu = h.makeElement('div');
  menu.className = 'dropdown-menu';
  if (!opts.noSignals) {
    ['Select All', 'Select None'].forEach((label) => {
      const item = h.makeElement('a');
      item.className = 'dropdown-item';
      item.textContent = label;
      menu.appendChild(item);
    });
  }
  wrap.appendChild(toggle);
  wrap.appendChild(menu);
  body.appendChild(wrap);
  return menu;
}

// A grid card: its checkbox, and the two links it renders to itself (the image and
// the title), which is why "one *distinct* id" is the rule rather than "one link".
function mountCard(body, type, id, selected) {
  const card = h.makeElement('div');
  card.className = 'grid-card';
  const box = h.makeElement('input');
  box.type = 'checkbox';
  box.checked = !!selected;
  card.appendChild(box);
  ['image', 'title'].forEach((what) => {
    const a = h.makeElement('a');
    a.setAttribute('href', '/' + type + '/' + id);
    a.textContent = what;
    card.appendChild(a);
  });
  body.appendChild(card);
  return card;
}

// A table view, whose header checkbox selects everything: its nearest ancestor
// carrying any entity link at all is the table, which links to every row.
function mountTable(body, type, ids) {
  const table = h.makeElement('table');
  const head = h.makeElement('thead');
  const headRow = h.makeElement('tr');
  const headCell = h.makeElement('th');
  const all = h.makeElement('input');
  all.type = 'checkbox';
  all.checked = true;
  headCell.appendChild(all);
  headRow.appendChild(headCell);
  head.appendChild(headRow);
  table.appendChild(head);
  ids.forEach((id) => {
    const row = h.makeElement('tr');
    const cell = h.makeElement('td');
    const box = h.makeElement('input');
    box.type = 'checkbox';
    box.checked = false;
    cell.appendChild(box);
    const a = h.makeElement('a');
    a.setAttribute('href', '/' + type + '/' + id);
    cell.appendChild(a);
    row.appendChild(cell);
    table.appendChild(row);
  });
  body.appendChild(table);
  return table;
}

// One plugin's block in Settings → Plugins, as SettingsPluginsPanel builds it: a
// `.setting-group` box whose header carries the heading and the description, with the
// version appended to the heading - which is the detail a bare-name match misses.
function mountSettingGroup(body, heading, description) {
  const group = h.makeElement('div');
  group.className = 'setting-group';
  const header = h.makeElement('div');
  header.className = 'setting';
  const box = h.makeElement('div');
  const h3 = h.makeElement('h3');
  h3.textContent = heading;
  const sub = h.makeElement('div');
  sub.className = 'sub-heading';
  sub.textContent = description;
  box.appendChild(h3);
  box.appendChild(sub);
  header.appendChild(box);
  group.appendChild(header);
  body.appendChild(group);
  return group;
}

// One setting row inside that group, as Stash builds it: the `plugin-<id>-<key>` id on
// the switch itself, an h3 for the name and a `.sub-heading` for the description.
function mountSettingRow(group, key, description) {
  const row = h.makeElement('div');
  row.className = 'setting';
  const h3 = h.makeElement('h3');
  h3.textContent = key;
  const sub = h.makeElement('div');
  sub.className = 'sub-heading';
  sub.textContent = description;
  const input = h.makeElement('input');
  input.id = 'plugin-CustomFieldsBulkEditor-' + key;
  row.appendChild(h3);
  row.appendChild(sub);
  row.appendChild(input);
  group.appendChild(row);
  return { row, h3, sub, input };
}

// ── The fake library ────────────────────────────────────────────────────────

const SCENES = {
  1: { id: '1', title: 'S1', custom_fields: { colour: 'blue', rating: '5' } },
  2: { id: '2', title: 'S2', custom_fields: { colour: 'red' } },
  3: { id: '3', title: 'S3', custom_fields: {} },
};

function responder(opts) {
  opts = opts || {};
  const entities = opts.entities || SCENES;
  return (req) => {
    const q = req.query || '';
    if (/CFBEPluginVersion/.test(q)) {
      return { data: { plugins: opts.installed ? [{ id: 'CustomFieldsBulkEditor', version: opts.installed }] : [] } };
    }
    // The settings map is *kept*, because a rename of the hide-from-add-lists field
    // writes it and an Undo has to find the written value there rather than the one
    // the dialog opened with.
    if (/configuration/.test(q)) {
      return { data: { configuration: { plugins:
        { CustomFieldsBulkEditor: opts.settings || {} } } } };
    }
    if (/CFBE_SetSetting/.test(q)) {
      opts.settings = req.variables.input;
      return { data: { configurePlugin: req.variables.input } };
    }
    // The description store tag, which carries the hide field to hide itself and is
    // never in a dialog's scope - so its own mark has to be moved for it.
    if (/CFBE_Store/.test(q)) {
      return { data: { findTags: { tags: opts.storeTag
        ? [JSON.parse(JSON.stringify(opts.storeTag))] : [] } } };
    }
    if (/CFBE_Read/.test(q)) {
      if (opts.failRead) return { errors: [{ message: 'read boom' }] };
      const data = {};
      const re = /r(\d+): find\w+\(id: "(\d+)"\)/g;
      let m;
      while ((m = re.exec(q)) !== null) {
        data['r' + m[1]] = entities[m[2]] ? JSON.parse(JSON.stringify(entities[m[2]])) : null;
      }
      return { data };
    }
    const mut = /mutation CFBE_(\w+)\(/.exec(q);
    if (mut) {
      if (opts.failWrite) return { errors: [{ message: 'write boom' }] };
      // Leaves a write in flight, which is the only way to read the dialog *during*
      // one rather than after it.
      if (opts.hangAfter != null && opts.hangAfter-- <= 0) return h.HANG;
      const data = {};
      data[mut[1]] = req.variables.input.ids
        ? req.variables.input.ids.map((id) => ({ id }))
        : { id: req.variables.input.id };
      return { data };
    }
    return { data: {} };
  };
}

function start(opts) {
  opts = opts || {};
  const copied = [];
  const env = h.makeEnv({
    quiet: true,
    pathname: opts.pathname || '/scenes',
    respond: responder(opts),
    clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } },
  });
  env.copied = copied;
  h.run(env.ctx, SRC);
  return env;
}

const byClass = (body, cls) => body.descendants().filter((n) => h.hasClass(n, cls));
const one = (body, cls) => byClass(body, cls)[0] || null;
const menuItems = (body) => byClass(body, 'cfbe-menu-item');
const writes = (calls) => calls.filter((c) => /mutation CFBE_/.test(c.query || '') &&
  !/CFBE_SeedSettings/.test(c.query || ''));   // the settings seed is not a library write
// The listing is a stack of pill rows since 0.2.0, so a "line" is a row's own text.
// Since 0.5.0 the log keeps every listing it has drawn, one `.cfbe-block` each, so
// "the list" is the last of them - the one describing the library as of now.
const lastBlock = (body) => byClass(body, 'cfbe-block').pop() || null;
const rows = (body) => {
  const b = lastBlock(body);
  return b ? b.descendants().filter((n) => h.hasClass(n, 'cfbe-entry')) : [];
};
const lines = (body) => rows(body).map((n) => n.textContent);
// Scoped to the listing, since 0.6.0 put copy pills into the summary lines too - the
// pills a check about a *row* is asking about are the ones in the block it drew.
const pills = (body, kind) => {
  const b = lastBlock(body);
  return b ? b.descendants().filter((n) => h.hasClass(n, 'cfbe-pill-' + kind)) : [];
};
// The [INFO]/[WARN]/[ERROR] lines, now in the log beside the listings rather than in
// a strip of their own.
const notes = (body) => byClass(body, 'cfbe-line').map((n) => n.textContent);
// The copy pills inside one of those lines, by its index in `notes`.
const msgPills = (body, i) => {
  const line = byClass(body, 'cfbe-line')[i];
  return line ? line.descendants().filter((n) => h.hasClass(n, 'cfbe-pill-cf')) : [];
};
// Guarded rather than assumed, like the settings toggle below: against a build
// missing one of these buttons a check has to report a failure, not throw and take
// every later check in the chain with it.
const shown = (body, cls) => {
  const n = one(body, cls);
  return !!n && !h.hasClass(n, 'cfbe-hidden');
};
const press = (body, cls) => { const n = one(body, cls); if (n) n.click(); };
const EQ = '🟰';

// ── The menu item ───────────────────────────────────────────────────────────

const m1 = start();
const menu1 = mountMenu(m1.body);
mountCard(m1.body, 'scenes', '1', true);
mountCard(m1.body, 'scenes', '2', false);
m1.tick();
h.check('the item is added to the open "..." menu when something is selected',
  menuItems(m1.body).length === 1);
h.check('it is the last item in the menu',
  menu1.childNodes[menu1.childNodes.length - 1] === menuItems(m1.body)[0]);
h.check('it is captioned "Custom Fields..." - the dots say the click asks first',
  (menuItems(m1.body)[0] || {}).textContent === 'Custom Fields...');
h.check('it carries Stash own dropdown-item class so the menu styles it',
  h.hasClass(menuItems(m1.body)[0], 'dropdown-item'));

m1.tick();
h.check('a second tick does not add a second item', menuItems(m1.body).length === 1);

// Deselecting is not a redraw of the menu, so the item has to go on its own.
m1.body.descendants().filter((n) => n.tagName === 'INPUT').forEach((n) => { n.checked = false; });
m1.tick();
h.check('the item goes away when the selection is emptied', menuItems(m1.body).length === 0);

const m2 = start();
mountCard(m2.body, 'scenes', '1', true);
m2.tick();
h.check('no item without an open menu to put it in', menuItems(m2.body).length === 0);

// The id is the primary anchor and has not been read off a running Stash; the
// fallback matches a menu by the selection operations Stash puts in this one and
// nowhere else, so it cannot capture the sort or display-mode dropdown.
const m3 = start();
mountMenu(m3.body, { noId: true });
mountCard(m3.body, 'scenes', '1', true);
m3.tick();
h.check('a menu with no #more-menu id is still found by what is in it',
  menuItems(m3.body).length === 1);

const m4 = start();
mountMenu(m4.body, { noId: true, noSignals: true });
mountCard(m4.body, 'scenes', '1', true);
m4.tick();
h.check('a dropdown that is neither is left alone', menuItems(m4.body).length === 0);

// A table's select-all box resolves to every id on the page. Taking that as a
// selection would silently widen every write to the whole list.
const m5 = start();
mountMenu(m5.body);
mountTable(m5.body, 'scenes', ['1', '2', '3']);
m5.tick();
h.check('a select-all header checkbox is not read as a selection',
  menuItems(m5.body).length === 0);

const m6 = start({ pathname: '/scenes/markers' });
mountMenu(m6.body);
mountCard(m6.body, 'scenes', '1', true);
m6.tick();
h.check('the marker list offers nothing - SceneMarker has no custom fields at all',
  menuItems(m6.body).length === 0);

const m7 = start({ pathname: '/scenes/12' });
mountMenu(m7.body);
mountCard(m7.body, 'scenes', '1', true);
m7.tick();
h.check('a detail page is not a list view', menuItems(m7.body).length === 0);

const m8 = start({ pathname: '/performers/12/scenes' });
mountMenu(m8.body);
mountCard(m8.body, 'scenes', '1', true);
m8.tick();
h.check('a list nested under another entity is still that list',
  menuItems(m8.body).length === 1);

// Four list views whose URL does not name what they list, all reported live or found
// beside the one that was. A detail page's tabs go through `useTabKey`, which puts the
// tab key in the path, and three of those keys are not the plural of the type; a
// gallery's images tab is routed by hand and carries no segment at all. All four render
// the same `Filtered*List` with the same "..." menu, so all four have to resolve.
[['/galleries/12', 'images', "a gallery's own image list"],
 ['/galleries/12/add', 'images', "a gallery's add-images list"],
 ['/groups/12/subgroups', 'groups', 'a group\'s subgroups'],
 ['/studios/12/childstudios', 'studios', "a studio's child studios"],
 ['/performers/12/appearswith', 'performers', 'the performers one appears with'],
].forEach(([pathname, type, what]) => {
  const env = start({ pathname });
  mountMenu(env.body);
  mountCard(env.body, type, '1', true);
  env.tick();
  h.check(what + ' is a ' + type + ' list', menuItems(env.body).length === 1,
    pathname + ' -> ' + h.plural(menuItems(env.body).length, 'item'));
});

// The alias is on the whole path, not on the tail: `add` is far too common a segment
// to hand to an entity type on sight.
const m8b = start({ pathname: '/scenes/12/add' });
mountMenu(m8b.body);
mountCard(m8b.body, 'images', '1', true);
m8b.tick();
h.check('and an unrelated /add is not one of them', menuItems(m8b.body).length === 0);

// The route says which type is listed, and the link pattern says which link on a
// card is the card's own - a scene card also links to its studio and its performers.
const m9 = start({ pathname: '/scenes' });
mountMenu(m9.body);
const card9 = mountCard(m9.body, 'scenes', '7', true);
const stray = h.makeElement('a');
stray.setAttribute('href', '/studios/4');
card9.appendChild(stray);
m9.tick();
h.check('a card links to other entities too and only its own type counts',
  menuItems(m9.body).length === 1);

// A card that links to a relative of its *own* type: a tag card names its parent tag
// and a studio card its parent studio, so a bare "one distinct id" rule dropped every
// tag and studio that has a parent - two thirds of a real tag list. The row's own link
// is the one it renders twice (thumbnail and title); the parent gets one.
const m10 = start({ pathname: '/tags' });
mountMenu(m10.body);
const card10 = mountCard(m10.body, 'tags', '7', true);
const parent10 = h.makeElement('a');
parent10.setAttribute('href', '/tags/2');
card10.appendChild(parent10);
const card10b = mountCard(m10.body, 'tags', '9', true);
const parent10b = h.makeElement('a');
parent10b.setAttribute('href', '/tags/7');
card10b.appendChild(parent10b);
m10.tick();
h.check('a card linking to its parent of the same type is still selected',
  menuItems(m10.body).length === 1);
h.check('and it is the card own id that is selected, not the parent it names',
  (menuItems(m10.body)[0] || {})._cfbeKey === 'tags:7,9',
  (menuItems(m10.body)[0] || {})._cfbeKey);

// The refusal that rule exists for is unchanged, and a row whose links are genuinely
// ambiguous - no id linked more than any other - is still refused rather than guessed.
const m11 = start({ pathname: '/tags' });
mountMenu(m11.body);
const card11 = mountCard(m11.body, 'tags', '7', true);
[...card11.childNodes].forEach((n) => {
  if (n.tagName === 'A' && n.getAttribute('href') === '/tags/7') card11.removeChild(n);
});
const tie11 = h.makeElement('a');
tie11.setAttribute('href', '/tags/7');
card11.appendChild(tie11);
const tie11b = h.makeElement('a');
tie11b.setAttribute('href', '/tags/2');
card11.appendChild(tie11b);
m11.tick();
h.check('a row linking to two entities equally often is still refused',
  menuItems(m11.body).length === 0);

// And the most-linked rule is only ever applied *within a row*. A select-all header
// resolves to the whole table, and in a studio list one studio is the parent of many
// others - so it is linked more than any other id there. Counting links outside a row
// would read that as "one studio selected" off a select-all.
const m12 = start({ pathname: '/studios' });
mountMenu(m12.body);
const table12 = mountTable(m12.body, 'studios', ['1', '2', '3']);
['2', '3'].forEach(() => {
  const a = h.makeElement('a');
  a.setAttribute('href', '/studios/1');
  table12.appendChild(a);
});
m12.tick();
h.check('a select-all is not resolved by counting links across the table',
  menuItems(m12.body).length === 0);

// ── The dialog ──────────────────────────────────────────────────────────────

function openDialog(opts) {
  const env = start(opts);
  mountMenu(env.body);
  ((opts && opts.select) || ['1', '2', '3']).forEach((id) => mountCard(env.body, 'scenes', id, true));
  env.tick();
  menuItems(env.body)[0].click();
  return h.flush().then(() => env);
}

openDialog()
  .then((env) => {
    h.check('the item opens the dialog', !!one(env.body, 'cfbe-modal'));
    h.check('the head names the plugin, the type and the count',
      /GTTx Custom Fields Bulk Editor - Scenes - 3 selected/.test(
        (one(env.body, 'cfbe-title') || {}).textContent || ''),
      (one(env.body, 'cfbe-title') || {}).textContent);
    h.check('the backup instruction leads the head',
      /Backing up your database before proceeding is recommended\./.test((one(env.body, 'cfbe-warn') || {}).textContent || ''));
    h.check('the legend says a bracketed number is an id',
      /number in brackets after the entity name is its id/.test(
        (one(env.body, 'cfbe-legend') || {}).textContent || ''));
    // The legend quotes the list, so its ␀ has to be drawn the way the list draws
    // one. The mark is a span rather than a character in the legend's own string,
    // and the font comes from the rule the list's own marks are in - a second
    // declaration of the same face is a second thing to keep in step.
    const legendMark = byClass(one(env.body, 'cfbe-legend') || h.makeElement('div'), 'cfbe-nonemark');
    h.check('and its ␀ is a span of its own',
      legendMark.length === 1 && legendMark[0].textContent === '␀',
      legendMark.map((n) => n.textContent).join('|'));
    h.check('drawn by the same rule as the list’s marks, font only',
      /\.cfbe-none,\.cfbe-nonemark\{font-family:[^;}]+;\}/.test(require('fs').readFileSync(SRC, 'utf8')));

    h.check('the selection is read in one aliased by-id query, not one per entity',
      env.calls.filter((c) => /CFBE_Read/.test(c.query || '')).length === 1,
      env.calls.map((c) => (c.query || '').slice(0, 40)).join(' | '));

    const got = lines(env.body);
    h.check('every custom field of every selected entity is listed', got.length === 3, got.join(' | '));
    h.check('a line reads type, entity, field name and value',
      got[0] === 'Scene "S1" (1): colour🟰blue', got[0]);
    h.check('fields are listed in name order within an entity',
      got[1] === 'Scene "S1" (1): rating🟰5', got[1]);

    // The three pill kinds, and the three different things a click does.
    const ent = pills(env.body, 'ent')[0];
    h.check('the entity pill links to that entity detail page',
      ent && ent.href === '/scenes/1', ent && ent.href);
    h.check('and opens it in a new tab', ent && ent.target === '_blank' &&
      /noopener/.test(ent.rel || ''));
    h.check('a listing line has no action pill - nothing has happened yet',
      pills(env.body, 'act').length === 0);
    const cf = pills(env.body, 'cf');
    h.check('the field name and value are each their own copyable pill',
      cf.length === 6 && cf[0].textContent === 'colour' && cf[1].textContent === 'blue',
      cf.length + ' ' + cf.map((p) => p.textContent).join(','));
    cf[1].click();
    h.check('clicking a field pill copies its own text, not the line',
      env.copied[env.copied.length - 1] === 'blue', JSON.stringify(env.copied));
    h.check('an entity carrying no custom fields contributes no line',
      !got.some((l) => /\(3\)/.test(l)), got.join(' | '));
    h.check('the counters name the selection, the fields and what is on screen',
      /3 scenes read, 2 with custom fields, 3 fields in total, 3 lines listed/
        .test((one(env.body, 'cfbe-progress') || {}).textContent || ''),
      (one(env.body, 'cfbe-progress') || {}).textContent);

    // The one setting scopes the task; a selection is exactly what was picked, so this
    // dialog does not wait on a settings read before it opens.
    h.check('a selection run reads no settings',
      !env.calls.some((c) => /configuration/.test(c.query || '')),
      env.calls.map((c) => (c.query || '').slice(0, 30)).join(' | '));
    h.check('nothing is written by opening the dialog', writes(env.calls).length === 0);
    h.check('Apply is held back until a field name is given',
      one(env.body, 'cfbe-apply').disabled === true);

    // The two filters narrow the listing, and nothing else.
    const nameFilter = one(env.body, 'cfbe-filter-name');
    nameFilter.value = 'colo';
    h.fire(nameFilter, 'input');
    h.check('filtering by name narrows the list', lines(env.body).length === 2,
      lines(env.body).join(' | '));
    nameFilter.value = '';
    const valueFilter = one(env.body, 'cfbe-filter-value');
    valueFilter.value = 'red';
    h.fire(valueFilter, 'input');
    h.check('filtering by value narrows the list', lines(env.body).length === 1 &&
      /\(2\)/.test(lines(env.body)[0]), lines(env.body).join(' | '));
    valueFilter.value = '';
    h.fire(valueFilter, 'input');
    h.check('clearing a filter restores the whole list', lines(env.body).length === 3);
    // A re-filter restates what is in scope now rather than logging a new listing:
    // one block per keystroke would be a history of nothing.
    h.check('and filtering rewrites the listing in place, adding no second one',
      byClass(env.body, 'cfbe-block').length === 1,
      String(byClass(env.body, 'cfbe-block').length));
  })

  // "omits" on all three text filters, and the entity filter itself (0.12.0). The
  // fixture is S1 (1) carrying colour and rating, S2 (2) carrying colour, S3 (3)
  // carrying nothing - so every filter below has a different right answer.
  .then(() => openDialog())
  .then((env) => {
    const nameMode = one(env.body, 'cfbe-filter-namemode');
    const nameFilter = one(env.body, 'cfbe-filter-name');
    const entMode = one(env.body, 'cfbe-filter-entmode');
    const entFilter = one(env.body, 'cfbe-filter-ent');
    const valueMode = one(env.body, 'cfbe-filter-mode');
    const valueFilter = one(env.body, 'cfbe-filter-value');
    const scope = one(env.body, 'cfbe-scope');
    h.check('every text filter starts on the substring match it has always been',
      nameMode.value === 'contains' && entMode.value === 'contains' &&
      valueMode.value === 'contains');

    nameMode.value = 'omits';
    h.fire(nameMode, 'change');
    h.check('"omits" with an empty box filters nothing, in either direction',
      lines(env.body).length === 3 && scope.value === 'all',
      lines(env.body).length + ' ' + scope.value);
    nameFilter.value = 'colo';
    h.fire(nameFilter, 'input');
    h.check('a name the row omits is the complement of one it contains',
      lines(env.body).length === 1 && /rating/.test(lines(env.body)[0]),
      lines(env.body).join(' | '));
    nameFilter.value = '';
    h.fire(nameFilter, 'input');

    valueMode.value = 'omits';
    h.fire(valueMode, 'change');
    h.check('the value box stays usable under "omits", unlike the three truth modes',
      valueFilter.disabled === false);
    h.check('and an empty one is still not a filter, so the scope stays on All',
      scope.value === 'all', scope.value);
    valueFilter.value = 'red';
    h.fire(valueFilter, 'input');
    h.check('and it lists every row whose value does not hold the text',
      lines(env.body).length === 2 && !/red/.test(lines(env.body).join(' | ')),
      lines(env.body).join(' | '));
    valueFilter.value = '';
    h.fire(valueFilter, 'input');
    valueMode.value = 'contains';
    h.fire(valueMode, 'change');

    entFilter.value = 'S2';
    h.fire(entFilter, 'input');
    h.check('the entity filter matches the name', lines(env.body).length === 1 &&
      /\(2\)/.test(lines(env.body)[0]), lines(env.body).join(' | '));
    entFilter.value = 'S1 (1)';
    h.fire(entFilter, 'input');
    h.check('and the name and id together, as the row shows them',
      lines(env.body).length === 2 && lines(env.body).every((l) => /\(1\)/.test(l)),
      lines(env.body).join(' | '));
    entFilter.value = '(1)';
    h.fire(entFilter, 'input');
    h.check('the id on its own reaches one entity, not every row holding that digit',
      lines(env.body).length === 2, lines(env.body).join(' | '));
    entMode.value = 'omits';
    h.fire(entMode, 'change');
    h.check('and "omits" leaves exactly the rest',
      lines(env.body).length === 1 && /\(2\)/.test(lines(env.body)[0]),
      lines(env.body).join(' | '));
    h.check('a filled entity box counts as filtering, like the other two',
      scope.value === 'filtered', scope.value);
    return env;
  })

  // Copying a selection out of the list. The mark stands for nothing being there, so
  // it stands for nothing in the text - and it is dropped as an *element*, never by
  // stripping its character, since an entity name is free to contain that character
  // and this user's names are full of Unicode marks.
  //
  // The browser halves are faked: a `Selection` whose range clones to a fragment the
  // test builds. That checks this plugin's own reading of a fragment, which is the
  // half that can be wrong here.
  .then(() => openDialog())
  .then((env) => {
    const span = (cls, text) => {
      const n = h.makeElement('span');
      if (cls) n.className = cls;
      n.textContent = text;
      return n;
    };
    const entry = (kids) => {
      const d = h.makeElement('div');
      d.className = 'cfbe-entry';
      kids.forEach((k) => d.appendChild(k));
      return d;
    };
    const frag = (kids) => ({
      childNodes: kids,
      querySelectorAll: (sel) => kids.reduce((acc, k) => acc.concat(
        [k].concat(k.descendants ? k.descendants() : [])
          .filter((n) => h.hasClass(n, String(sel).replace('.', '')))), []),
    });
    const fire = (kids, text) => {
      const data = {};
      env.ctx.window.getSelection = () => ({
        toString: () => text,
        rangeCount: 1,
        getRangeAt: () => ({ cloneContents: () => frag(kids) }),
      });
      h.fire(one(env.body, 'cfbe-list'), 'copy', {
        clipboardData: { setData: (kind, v) => { data[kind] = v; } },
      });
      return data;
    };

    const line = (name) => entry([
      span(null, 'Tag '), span('cfbe-pill cfbe-pill-ent', '"' + name + '" (7)'),
      span(null, ': '), span('cfbe-none', '␀'),
    ]);
    const copied = fire([line('a'), line('b')]);
    h.check('a copied selection leaves the mark out of the text',
      copied['text/plain'] === 'Tag "a" (7): \nTag "b" (7): ', JSON.stringify(copied['text/plain']));
    h.check('one line per entry, and no break inside one',
      (copied['text/plain'] || '').split('\n').length === 2);
    h.check('and goes on the clipboard as HTML too, or a rich editor pastes the pills back',
      copied['text/html'] === 'Tag "a" (7): \nTag "b" (7): ');

    // The character is only ever removed with the element that carries it: a name
    // holding the same character keeps it.
    const own = entry([span('cfbe-pill cfbe-pill-ent', '"␀ tag" (7)'), span('cfbe-none', '␀')]);
    h.check('a name containing the mark character keeps it',
      fire([own])['text/plain'] === '"␀ tag" (7)');

    // A selection inside one line arrives as the pills themselves, with no entry
    // among them - joining those with newlines would break a line into its pills.
    h.check('a selection within one line stays one line',
      fire([span(null, 'colour'), span(null, '🟰'), span(null, 'red')])['text/plain'] ===
      'colour🟰red');

    delete env.ctx.window.getSelection;
    return env;
  })

  // A field that is set *to nothing* is a real thing to store, and it used to render
  // as a pill with nothing in it - the complaint that sent 0.2.2. It gets the same
  // mark the absent side gets, and still copies as the empty string it is.
  .then(() => openDialog({
    entities: { 1: { id: '1', title: 'S1', custom_fields: { colour: '' } } },
    select: ['1'],
  }))
  .then((env) => {
    h.check('an empty value is marked rather than left blank',
      pills(env.body, 'cf').length === 2 && !!one(env.body, 'cfbe-none'),
      String(pills(env.body, 'cf').length));
    h.check('and the mark sits inside the value pill, not instead of it',
      (one(env.body, 'cfbe-none') || {}).parentNode === pills(env.body, 'cf')[1]);
    pills(env.body, 'cf')[1].click();
    h.check('clicking it copies the empty string, never the mark',
      env.copied.length === 1 && env.copied[0] === '', JSON.stringify(env.copied));
  })

  // Finding those empty ones. The query is a *mode*, not something typed into the box,
  // since any sentinel a box could carry is also a value somebody is allowed to have -
  // and the one that reads as the obvious sentinel here is a value in this fixture.
  .then(() => openDialog({
    entities: {
      1: { id: '1', title: 'S1', custom_fields: { colour: '', rating: '␀' } },
      2: { id: '2', title: 'S2', custom_fields: { colour: 'red' } },
    },
    select: ['1', '2'],
  }))
  .then((env) => {
    const mode = one(env.body, 'cfbe-filter-mode');
    const valueFilter = one(env.body, 'cfbe-filter-value');
    h.check('the value filter defaults to the substring match it has always been',
      mode && mode.value === 'contains' && valueFilter.disabled !== true,
      mode && mode.value);
    mode.value = 'empty';
    h.fire(mode, 'change');
    h.check('"is empty" lists only the values that are the empty string',
      lines(env.body).length === 1 && /colour/.test(lines(env.body)[0]),
      lines(env.body).join(' | '));
    h.check('a value that merely looks like the mark is not one of them',
      !/rating/.test(lines(env.body).join(' | ')), lines(env.body).join(' | '));
    h.check('and the box is disabled, since the mode is the whole query',
      valueFilter.disabled === true);
    h.check('the counters follow the filtered list',
      /1 line listed/.test((one(env.body, 'cfbe-progress') || {}).textContent || ''),
      (one(env.body, 'cfbe-progress') || {}).textContent);
    valueFilter.value = '␀';
    mode.value = 'contains';
    h.fire(mode, 'change');
    h.check('back on "contains", the mark is ordinary text to search for',
      lines(env.body).length === 1 && /rating/.test(lines(env.body)[0]),
      lines(env.body).join(' | '));
    h.check('and the box is usable again', valueFilter.disabled === false);
  })

  // Truthiness (0.9.0). The same predicate the add-list filter reads, offered as two
  // modes - and the fixture is the exact edge of it: "no" and "off" are true, "FALSE"
  // and " 0 " are not, and a JSON false and a JSON 0 are not either.
  .then(() => openDialog({
    entities: {
      1: { id: '1', title: 'S1', custom_fields: { keep: 'yes', zero: '0', blank: '', word: 'no' } },
      2: { id: '2', title: 'S2', custom_fields: { keep: false, zero: 0, blank: 'FALSE', word: ' 0 ',
        list: [] } },
    },
    select: ['1', '2'],
  }))
  .then((env) => {
    const mode = one(env.body, 'cfbe-filter-mode');
    const valueFilter = one(env.body, 'cfbe-filter-value');
    mode.value = 'true';
    h.fire(mode, 'change');
    h.check('"is true" lists every value the add-list filter would call marked',
      lines(env.body).join(' | ') === lines(env.body).filter((l) => /keep|word/.test(l)).join(' | ') &&
      lines(env.body).length === 2, lines(env.body).join(' | '));
    h.check('so a word that reads as negative is still true', /no/.test(lines(env.body)[1]),
      lines(env.body)[1]);
    h.check('and the box is disabled, since the mode is the whole query',
      valueFilter.disabled === true);
    mode.value = 'nottrue';
    h.fire(mode, 'change');
    h.check('"is not true" lists exactly the rest', lines(env.body).length === 7,
      lines(env.body).join(' | '));
    // The row shows `[]`, which reads as true as text and is not true as a value. The
    // dropdown filter only ever sees the value, so the listing has to agree with it.
    h.check('including an empty array, judged as the value it is and not as its text',
      lines(env.body).some((l) => /list/.test(l)), lines(env.body).join(' | '));
    h.check('empty, "0", "FALSE", " 0 ", a JSON false and a JSON 0 among them',
      ['blank', 'zero'].every((n) => lines(env.body).filter((l) => l.indexOf(n) !== -1).length === 2),
      lines(env.body).join(' | '));
    h.check('the two modes partition the listing between them - no row is both or neither',
      lines(env.body).length + 2 === 9, String(lines(env.body).length));
    mode.value = 'true';
    h.fire(mode, 'change');
    one(env.body, 'cfbe-scope').value = 'filtered';
    one(env.body, 'cfbe-mode').value = 'overwrite';
    one(env.body, 'cfbe-field-name').value = 'note';
    one(env.body, 'cfbe-field-value').value = 'x';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => {
      const w = writes(env.calls);
      h.check('and a truth mode scopes a write like any other filter',
        w.length === 1 && JSON.stringify(w[0].variables.input.ids) === JSON.stringify(['1']),
        w.map((c) => JSON.stringify(c.variables.input.ids)).join(' '));
      return env;
    });
  })

  // Touching a filter moves "Apply to" to the filtered list (0.10.0). The scope can
  // only ever narrow to what is on screen, never widen behind the user.
  .then(() => openDialog())
  .then((env) => {
    const scope = one(env.body, 'cfbe-scope');
    const nameFilter = one(env.body, 'cfbe-filter-name');
    h.check('the scope starts at All', scope.value === 'all', scope.value);
    nameFilter.value = 'col';
    h.fire(nameFilter, 'input');
    h.check('and a filter keystroke moves it to the filtered list',
      scope.value === 'filtered', scope.value);
    nameFilter.value = '';
    h.fire(nameFilter, 'input');
    h.check('clearing the last filter puts it back to All, which then means the same set',
      scope.value === 'all', scope.value);
    const mode = one(env.body, 'cfbe-filter-mode');
    mode.value = 'empty';
    h.fire(mode, 'change');
    h.check('a mode with an empty box counts as filtering too',
      scope.value === 'filtered', scope.value);
    return env;
  })

  // Rename (0.10.0): the field name moves and every value goes with it.
  .then(() => openDialog({
    entities: {
      1: { id: '1', title: 'S1', custom_fields: { colour: 'blue', rating: '5' } },
      2: { id: '2', title: 'S2', custom_fields: { colour: 'red' } },
    },
    select: ['1', '2'],
  }))
  .then((env) => {
    const modeSel = one(env.body, 'cfbe-mode');
    const renameOpt = modeSel.childNodes.filter((o) => o.value === 'rename')[0];
    h.check('Rename is offered as a fourth operation', !!renameOpt);
    h.check('and is disabled while the scope carries more than one field name',
      renameOpt.disabled === true);
    h.check('every operation carries a tooltip of its own',
      modeSel.childNodes.every((o) => !!o.title),
      modeSel.childNodes.map((o) => o.value + ':' + !!o.title).join(' '));
    h.check('and the select carries the selected one, which is what a browser shows',
      /never overwrites/.test(modeSel.title), modeSel.title);
    modeSel.value = 'overwrite';
    h.fire(modeSel, 'change');
    h.check('changing the operation changes that tooltip', /replacing the value/.test(modeSel.title),
      modeSel.title);
    // The complaint that sent 0.12.0: "replacing whatever is there" read to a live user
    // as replacing the entity's whole set of custom fields. Both writing modes now say
    // what they leave alone, which is the half a caption cannot carry.
    h.check('and it says the entity\'s other custom fields are left alone',
      /other custom field[s]? on those entities is left untouched/.test(modeSel.title),
      modeSel.title);
    modeSel.value = 'remove';
    h.fire(modeSel, 'change');
    h.check('Remove says the same, since it is the other mode that reads as wholesale',
      /other custom fields are left untouched/.test(modeSel.title), modeSel.title);
    modeSel.value = 'overwrite';
    h.fire(modeSel, 'change');
    h.check('"Apply to" is tooltipped too', !!one(env.body, 'cfbe-scope').title);

    const nameFilter = one(env.body, 'cfbe-filter-name');
    nameFilter.value = 'colour';
    h.fire(nameFilter, 'input');
    h.check('filtering to one field name enables Rename', renameOpt.disabled === false);
    modeSel.value = 'rename';
    h.fire(modeSel, 'change');
    h.check('the value box is greyed out, since a rename does not touch values',
      one(env.body, 'cfbe-field-value').disabled === true);
    h.check('and the name box says it means the new name',
      /New Custom Field name/.test(byClass(env.body, 'cfbe-label').map((l) => l.textContent).join(' ')),
      byClass(env.body, 'cfbe-label').map((l) => l.textContent).join(' | '));
    h.check('Apply waits for that name', one(env.body, 'cfbe-apply').disabled === true);
    one(env.body, 'cfbe-field-name').value = 'shade';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    h.check('and is offered once it has one', one(env.body, 'cfbe-apply').disabled === false);
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => env);
  })
  .then((env) => {
    const w = writes(env.calls);
    const cf = w.map((c) => c.variables.input.custom_fields);
    h.check('a rename is one batch per value, each carrying that value to the new key',
      w.length === 2 && cf[0].partial.shade === 'blue' && cf[1].partial.shade === 'red',
      JSON.stringify(cf));
    h.check('and dropping the old key in the same input',
      cf.every((c) => JSON.stringify(c.remove) === JSON.stringify(['colour'])),
      JSON.stringify(cf.map((c) => c.remove)));
    h.check('the entities are split between those batches, not repeated across them',
      JSON.stringify(w.map((c) => c.variables.input.ids)) === JSON.stringify([['1'], ['2']]),
      JSON.stringify(w.map((c) => c.variables.input.ids)));
    h.check('the log calls it a rename rather than a replace',
      lines(env.body).filter((l) => /^Renamed/.test(l)).length === 2,
      lines(env.body).join(' | '));
    h.check('naming both sides of it, the name moving and the value staying',
      /colour.*blue.*shade.*blue/.test(lines(env.body)[0]), lines(env.body)[0]);
    h.check('and the summary counts it as one', /Renamed x2/.test(notes(env.body).join(' | ')),
      notes(env.body).join(' | '));
    const before = writes(env.calls).length;
    one(env.body, 'cfbe-undo').click();
    return h.flush()
      .then(() => { one(env.body, 'cfbe-undo').click(); return h.flush(); })
      .then(() => {
        const back = writes(env.calls).slice(before).map((c) => c.variables.input.custom_fields);
        h.check('Undo puts the old key back and takes the new one off, in one input',
          back.length === 2 && back.every((c) => JSON.stringify(c.remove) === JSON.stringify(['shade'])) &&
          back[0].partial.colour === 'blue' && back[1].partial.colour === 'red',
          JSON.stringify(back));
        return env;
      });
  })

  // The one case a rename must refuse: the new name is already on the entity, so the
  // write would overwrite a value rather than move one.
  .then(() => openDialog({
    entities: {
      1: { id: '1', title: 'S1', custom_fields: { colour: 'blue' } },
      2: { id: '2', title: 'S2', custom_fields: { colour: 'red', shade: 'keep me' } },
    },
    select: ['1', '2'],
  }))
  .then((env) => {
    const nameFilter = one(env.body, 'cfbe-filter-name');
    nameFilter.value = 'colour';
    h.fire(nameFilter, 'input');
    one(env.body, 'cfbe-mode').value = 'rename';
    h.fire(one(env.body, 'cfbe-mode'), 'change');
    one(env.body, 'cfbe-field-name').value = 'shade';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => {
      const w = writes(env.calls);
      h.check('an entity already carrying the new name is left out of the write',
        w.length === 1 && JSON.stringify(w[0].variables.input.ids) === JSON.stringify(['1']),
        JSON.stringify(w.map((c) => c.variables.input.ids)));
      h.check('and the skip is a WARN naming the value it would have overwritten',
        notes(env.body).some((l) => /^\[WARN\].*keep me/.test(l)), notes(env.body).join(' | '));
      return env;
    });
  })

  // Renaming the field the **Hide from Add Lists** setting names is a rename of the
  // setting too. Left behind, it names a field nothing carries any more - so every
  // entity the user had hidden quietly comes back into Stash's add lists.
  .then(() => openDialog({
    entities: {
      1: { id: '1', title: 'S1', custom_fields: { Exclude_from_add_list: '1' } },
      2: { id: '2', title: 'S2', custom_fields: { Exclude_from_add_list: 'yes' } },
    },
    select: ['1', '2'],
    storeTag: { id: '9', name: 'plumbing', description: '',
      custom_fields: { cfbe_desc_store: '1', Exclude_from_add_list: '1' } },
  }))
  .then((env) => {
    const settingWrites = () => env.calls.filter((c) => /CFBE_SetSetting/.test(c.query || ''));
    const markWrites = () => env.calls.filter((c) => /CFBE_TagUpdate/.test(c.query || ''));
    one(env.body, 'cfbe-mode').value = 'rename';
    h.fire(one(env.body, 'cfbe-mode'), 'change');
    one(env.body, 'cfbe-field-name').value = 'Hidden_here';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => {
      const set = settingWrites();
      h.check('renaming the hide-from-add-lists field moves the setting with it',
        set.length === 1 &&
        set[0].variables.input.c1ExcludeFromAddListField === 'Hidden_here' &&
        set[0].variables.id === 'CustomFieldsBulkEditor',
        JSON.stringify(set.map((c) => c.variables)));
      h.check('and says so in the log',
        notes(env.body).some((l) => /Hide from Add Lists.*"Hidden_here"/.test(l)),
        notes(env.body).join(' | '));
      // The store tag is never in a dialog's scope, so nothing else would move its mark
      // and it would stop hiding itself the moment the setting moved.
      const marks = markWrites();
      h.check('the store tag\'s own mark moves too, since the scan leaves it out',
        marks.length === 1 && marks[0].variables.input.id === '9' &&
        marks[0].variables.input.custom_fields.partial.Hidden_here === '1' &&
        JSON.stringify(marks[0].variables.input.custom_fields.remove) ===
          JSON.stringify(['Exclude_from_add_list']),
        JSON.stringify(marks.map((c) => c.variables.input)));
      one(env.body, 'cfbe-undo').click();
      return h.flush().then(() => { one(env.body, 'cfbe-undo').click(); return h.flush(); });
    }).then(() => {
      const set = settingWrites();
      h.check('and an Undo takes the setting back with the field',
        set.length === 2 &&
        set[1].variables.input.c1ExcludeFromAddListField === 'Exclude_from_add_list',
        JSON.stringify(set.map((c) => c.variables.input)));
      h.check('with the store tag\'s mark back on the old name too',
        markWrites().length === 2 &&
        markWrites()[1].variables.input.custom_fields.partial.Exclude_from_add_list === '1',
        JSON.stringify(markWrites().map((c) => c.variables.input)));
      return env;
    });
  })

  // The other side of it: a rename of any other field must leave the setting alone,
  // and so must a rename of the *default* name by a user who has set another one -
  // which a selection run cannot tell from its own copy of the settings, since it
  // opens with the defaults rather than reading them.
  .then(() => openDialog({
    entities: {
      1: { id: '1', title: 'S1', custom_fields: { Exclude_from_add_list: '1' } },
    },
    select: ['1'],
    settings: { c1ExcludeFromAddListField: 'Hide_me' },
  }))
  .then((env) => {
    one(env.body, 'cfbe-mode').value = 'rename';
    h.fire(one(env.body, 'cfbe-mode'), 'change');
    one(env.body, 'cfbe-field-name').value = 'something_else';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => {
      h.check('a field the setting does not name leaves the setting alone',
        !env.calls.some((c) => /CFBE_SetSetting/.test(c.query || '')),
        env.calls.filter((c) => /CFBE_SetSetting/.test(c.query || ''))
          .map((c) => JSON.stringify(c.variables.input)).join(' '));
      return env;
    });
  })

  // The cap the pills cost: one node per line is back, so a listing longer than the
  // DOM should hold is cut off with a line saying so - and the scope is untouched.
  .then(() => {
    const many = { custom_fields: {}, id: '1', title: 'S1' };
    for (let i = 0; i < 1200; i++) many.custom_fields['f' + (1000 + i)] = 'v';
    return openDialog({ entities: { 1: many }, select: ['1'] });
  })
  .then((env) => {
    const got = lines(env.body);
    h.check('a listing longer than the render cap stops at it', got.length === 1001,
      String(got.length));
    h.check('and the last line says how many are not shown',
      /and 200 more lines not shown/.test(got[1000]), got[1000]);
    h.check('the counters still describe the whole listing',
      /1200 fields in total, 1200 lines listed/
        .test((one(env.body, 'cfbe-progress') || {}).textContent || ''),
      (one(env.body, 'cfbe-progress') || {}).textContent);
  })

  // Add: the mode that refuses to overwrite. Scene 1 and 2 already carry `colour`,
  // so only the one without it is written.
  .then(() => openDialog())
  .then((env) => {
    one(env.body, 'cfbe-field-name').value = 'colour';
    one(env.body, 'cfbe-field-value').value = 'green';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    h.check('Apply enables as soon as the field name is not empty',
      one(env.body, 'cfbe-apply').disabled === false);
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => env);
  })
  .then((env) => {
    const w = writes(env.calls);
    h.check('Add writes once, in bulk', w.length === 1, String(w.length));
    h.check('Add skips entities that already carry the field',
      JSON.stringify((w[0] || {}).variables) === JSON.stringify(
        { input: { ids: ['3'], custom_fields: { partial: { colour: 'green' } } } }),
      JSON.stringify((w[0] || {}).variables));
    h.check('the write goes through the entity own bulk mutation',
      /bulkSceneUpdate/.test((w[0] || {}).query || ''));
    h.check('what changed is listed under what was there',
      lines(env.body)[0] === 'Added Scene "S3" (3): ␀ ⇒ colour🟰green', lines(env.body)[0]);
    // One growing scroller, in the order things happened: the listing as it was read,
    // then the [INFO] line saying what was done to it, then what changed. The old
    // `.cfbe-msgs` strip is gone, so a message has nowhere else to be.
    const log = one(env.body, 'cfbe-list');
    const kinds = (log ? log.childNodes : []).map((n) =>
      h.hasClass(n, 'cfbe-block') ? 'block' : (n.textContent || '').slice(0, 6));
    h.check('the earlier listing stays above it, in the one scroller',
      !one(env.body, 'cfbe-msgs') &&
      kinds.join(' ') === 'block [INFO] [WARN] block [INFO]', kinds.join(' | '));
    // 0.6.0: the two entities Add refused are said out loud, with the values it left
    // in place - the whole of what used to be a silent skip.
    h.check('an Add that refuses to overwrite says so, and why',
      /^\[WARN\] Skipped 2 scenes: "colour" is already set there to another value, and "Add" never overwrites\. Kept: /
        .test(notes(env.body)[1]), notes(env.body)[1]);
    h.check('and tallies the values it kept, each a copy pill',
      /Kept: blue x1, red x1\. Use "Overwrite" to replace them\.$/.test(notes(env.body)[1]) &&
      msgPills(env.body, 1).length === 2, notes(env.body)[1]);
    // ∅ rendered as an empty box live: the list font is monospace and the glyph is
    // not in it. It is the one mark on the line that is not a pill, so it has nothing
    // else to sit in - hence its own class, out of the monospace stack.
    h.check('the empty-set mark is its own element, not a pill',
      !!one(env.body, 'cfbe-none') && !h.hasClass(one(env.body, 'cfbe-none'), 'cfbe-pill'),
      (one(env.body, 'cfbe-none') || {}).className);
    // Real text, so a drag across the line highlights it like everything else; what
    // keeps it out of a copy is `selectionText` dropping the element, checked below.
    h.check('and is real text, so a selection can highlight it',
      (one(env.body, 'cfbe-none') || {}).textContent === '␀',
      JSON.stringify((one(env.body, 'cfbe-none') || {}).textContent));
    h.check('the action pill says what happened and is not a link or a copy',
      (pills(env.body, 'act')[0] || {}).textContent === 'Added' &&
      !(pills(env.body, 'act')[0] || {}).handlers.click,
      (pills(env.body, 'act')[0] || {}).textContent);
    h.check('Cancel becomes Undo and Apply becomes Close',
      h.hasClass(one(env.body, 'cfbe-cancel'), 'cfbe-hidden') &&
      h.hasClass(one(env.body, 'cfbe-apply'), 'cfbe-hidden') &&
      !h.hasClass(one(env.body, 'cfbe-undo'), 'cfbe-hidden') &&
      !h.hasClass(one(env.body, 'cfbe-close'), 'cfbe-hidden'));
    h.check('the lease is released when the write finishes',
      env.ctx.window.__GTTx__.StashPluginCoop.leases.length === 0);
  })

  // Overwrite: every entity in scope, including the ones Add refused.
  .then(() => openDialog())
  .then((env) => {
    one(env.body, 'cfbe-mode').value = 'overwrite';
    one(env.body, 'cfbe-field-name').value = 'colour';
    one(env.body, 'cfbe-field-value').value = 'green';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => env);
  })
  .then((env) => {
    const w = writes(env.calls);
    h.check('Overwrite writes every entity in scope',
      JSON.stringify(w[0].variables.input.ids) === JSON.stringify(['1', '2', '3']),
      JSON.stringify(w[0].variables.input.ids));
  })

  // Remove: only the entities that actually carry the field, as a `remove` delta.
  .then(() => openDialog())
  .then((env) => {
    one(env.body, 'cfbe-mode').value = 'remove';
    one(env.body, 'cfbe-field-name').value = 'colour';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => env);
  })
  .then((env) => {
    const w = writes(env.calls);
    h.check('Remove goes out as a remove delta on the entities that have the field',
      JSON.stringify(w[0].variables) === JSON.stringify(
        { input: { ids: ['1', '2'], custom_fields: { remove: ['colour'] } } }),
      JSON.stringify(w[0].variables));
    h.check('a removal reads as Deleted, with nothing on the right',
      lines(env.body)[0] === 'Deleted Scene "S1" (1): colour🟰blue ⇒ ␀', lines(env.body)[0]);
    h.check('and the entity with no such field to remove is accounted for',
      notes(env.body)[1] === '[INFO] Skipped 1 scenes: "colour" is not set there, ' +
        'so there is nothing to remove.', notes(env.body)[1]);
  })

  // 0.6.0: an entity already holding the asked-for value is *unchanged*, not refused,
  // so it reads as an INFO whichever mode asked for it - and Add reaching one of those
  // takes this line rather than the WARN above.
  .then(() => openDialog())
  .then((env) => {
    one(env.body, 'cfbe-field-name').value = 'colour';
    one(env.body, 'cfbe-field-value').value = 'blue';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => env);
  })
  .then((env) => {
    h.check('a value already equal to the one asked for is an INFO, not a warning',
      notes(env.body)[2] === '[INFO] Skipped 1 scenes: "colour" is already "blue" there, ' +
        'so there is nothing to write.', notes(env.body)[2]);
    h.check('and the entity holding another value is still the warning',
      /^\[WARN\] Skipped 1 scenes: "colour" is already set there to another value/
        .test(notes(env.body)[1]), notes(env.body)[1]);
  })

  // The case that used to be a bare "Nothing to change": the reason comes first now.
  .then(() => openDialog({
    entities: { 1: { id: '1', title: 'S1', custom_fields: { colour: 'blue' } } },
    select: ['1'],
  }))
  .then((env) => {
    one(env.body, 'cfbe-field-name').value = 'colour';
    one(env.body, 'cfbe-field-value').value = 'blue';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => env);
  })
  .then((env) => {
    h.check('a skip is reported even when it leaves nothing to write at all',
      /^\[INFO\] Skipped 1 scenes/.test(notes(env.body)[1]) &&
      /^\[INFO\] Nothing to change/.test(notes(env.body)[2]) &&
      writes(env.calls).length === 0, notes(env.body).join(' | '));
  })

  // "Filtered list only" is the entity set the filters leave showing, which is the
  // one thing the two selectors between them decide.
  .then(() => openDialog())
  .then((env) => {
    const valueFilter = one(env.body, 'cfbe-filter-value');
    valueFilter.value = 'red';
    h.fire(valueFilter, 'input');
    one(env.body, 'cfbe-scope').value = 'filtered';
    one(env.body, 'cfbe-mode').value = 'overwrite';
    one(env.body, 'cfbe-field-name').value = 'note';
    one(env.body, 'cfbe-field-value').value = 'x';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => env);
  })
  .then((env) => {
    const w = writes(env.calls);
    h.check('"Filtered list only" writes just the entities still on screen',
      JSON.stringify(w[0].variables.input.ids) === JSON.stringify(['2']),
      JSON.stringify(w[0].variables.input.ids));
  })

  // Undo: an inverse delta per previous value, and a removal where there was none.
  .then(() => openDialog())
  .then((env) => {
    one(env.body, 'cfbe-mode').value = 'overwrite';
    one(env.body, 'cfbe-field-name').value = 'colour';
    one(env.body, 'cfbe-field-value').value = 'green';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => env);
  })
  .then((env) => {
    const before = writes(env.calls).length;
    one(env.body, 'cfbe-undo').click();
    return h.flush().then(() => {
      h.check('the first Undo click arms rather than writing',
        writes(env.calls).length === before);
      h.check('the armed caption states the scope rather than asking generically',
        /3 changes\?/.test(one(env.body, 'cfbe-undo').textContent || ''),
        one(env.body, 'cfbe-undo').textContent);
      one(env.body, 'cfbe-undo').click();
      return h.flush();
    }).then(() => {
      const w = writes(env.calls).slice(before);
      h.check('Undo puts back each previous value, grouped by what it was',
        w.length === 3, JSON.stringify(w.map((c) => c.variables.input)));
      const payloads = w.map((c) => JSON.stringify(c.variables.input));
      h.check('the entity that had no such field has it removed again',
        payloads.some((p) => p === JSON.stringify(
          { ids: ['3'], custom_fields: { remove: ['colour'] } })), payloads.join(' | '));
      h.check('an entity that had a value gets exactly that value back',
        payloads.some((p) => p === JSON.stringify(
          { ids: ['1'], custom_fields: { partial: { colour: 'blue' } } })) &&
        payloads.some((p) => p === JSON.stringify(
          { ids: ['2'], custom_fields: { partial: { colour: 'red' } } })), payloads.join(' | '));
      // Until 0.4.0 the changes were cleared here, which hid Undo and left Close as
      // the only thing in the footer. Undo now stays offered until the dialog closes
      // - a second press re-asserts the same before-values, which is idempotent - and
      // Rescan is beside it, which is the way back to a plan.
      h.check('Undo stays offered after a reversal', shown(env.body, 'cfbe-undo'));
      h.check('and Rescan is offered with it', shown(env.body, 'cfbe-rescan'));
      // The action is read off the two sides, not off the mode, which is what makes a
      // reversed line name itself: undoing what was written onto an empty field is a
      // Deleted, and undoing an overwrite is still a Replaced.
      h.check('an undone overwrite reads as Replaced, the other way round',
        lines(env.body)[0] === 'Replaced Scene "S1" (1): colour🟰green ⇒ colour🟰blue',
        lines(env.body)[0]);
      h.check('an undone addition reads as Deleted',
        lines(env.body)[2] === 'Deleted Scene "S3" (3): colour🟰green ⇒ ␀',
        lines(env.body)[2]);
    });
  })

  // The footer sits in the order the other three plugins already had - the write
  // first, Close last - so that four dialogs the user meets in one Stash do not put
  // Apply and Proceed at opposite ends of the row. There is no Stop here, which is
  // the one gap in the sibling sequence.
  .then(() => openDialog())
  .then((env) => {
    const order = (one(env.body, 'cfbe-foot') || { childNodes: [] }).childNodes
      .map((n) => n.textContent);
    h.check('the footer reads Apply Cancel Copy log Undo Rescan Close',
      order.join(' ') === 'Apply Cancel Copy log Undo Rescan Close', order.join(' '));
  })

  // Mid-undo the footer must not flip back to Cancel/Apply: the write it is
  // performing started from this half of the dialog, and offering a second one over a
  // library the first is still moving is the state nobody should be able to reach.
  .then(() => openDialog({ hangAfter: 1 }))
  .then((env) => {
    one(env.body, 'cfbe-mode').value = 'overwrite';
    one(env.body, 'cfbe-field-name').value = 'colour';
    one(env.body, 'cfbe-field-value').value = 'green';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => {
      one(env.body, 'cfbe-undo').click();
      one(env.body, 'cfbe-undo').click();
      return h.flush();
    }).then(() => {
      h.check('an undo still in flight keeps Apply off the footer',
        h.hasClass(one(env.body, 'cfbe-apply'), 'cfbe-hidden') &&
        h.hasClass(one(env.body, 'cfbe-cancel'), 'cfbe-hidden'));
      h.check('and disables the two buttons it does show',
        one(env.body, 'cfbe-undo').disabled === true &&
        one(env.body, 'cfbe-close').disabled === true);
    });
  })

  // A lease is what stands a sibling's auto mode down while this runs. Held across
  // the write, released afterwards - checked mid-flight, since a lease that is only
  // ever observed after the fact could as well never have been taken.
  .then(() => openDialog())
  .then((env) => {
    one(env.body, 'cfbe-field-name').value = 'colour';
    one(env.body, 'cfbe-field-value').value = 'green';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    let held = 0;
    const realFetch = env.ctx.window.fetch;
    env.ctx.window.fetch = function (url, o) {
      if (/mutation CFBE_/.test(JSON.parse(o.body).query || '')) {
        held = env.ctx.window.__GTTx__.StashPluginCoop.leases.length;
      }
      return realFetch(url, o);
    };
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => {
      h.check('a lease is held while the write is in flight', held === 1, String(held));
      h.check('and released afterwards',
        env.ctx.window.__GTTx__.StashPluginCoop.leases.length === 0);
    });
  })

  // Studio and Tag have no `custom_fields` on their bulk input, so they are written
  // one at a time. Nothing else about them differs.
  .then(() => {
    const env = start({ pathname: '/studios', entities: {
      1: { id: '1', name: 'St1', custom_fields: {} },
      2: { id: '2', name: 'St2', custom_fields: {} },
    } });
    mountMenu(env.body);
    mountCard(env.body, 'studios', '1', true);
    mountCard(env.body, 'studios', '2', true);
    env.tick();
    menuItems(env.body)[0].click();
    return h.flush().then(() => {
      one(env.body, 'cfbe-field-name').value = 'note';
      one(env.body, 'cfbe-field-value').value = 'x';
      h.fire(one(env.body, 'cfbe-field-name'), 'input');
      one(env.body, 'cfbe-apply').click();
      return h.flush();
    }).then(() => {
      const w = writes(env.calls);
      h.check('a studio is written through studioUpdate, one per entity',
        w.length === 2 && w.every((c) => /studioUpdate/.test(c.query || '')),
        w.map((c) => (c.query || '').slice(0, 40)).join(' | '));
      h.check('each single update carries the same custom-fields delta',
        JSON.stringify(w[0].variables.input) ===
          JSON.stringify({ id: '1', custom_fields: { partial: { note: 'x' } } }),
        JSON.stringify(w[0].variables.input));
    });
  })

  // An entity deleted between the selection and the read is reported: the count in
  // the head came from the selection, so a silently shorter list would not add up.
  .then(() => openDialog({ select: ['1', '9'] }))
  .then((env) => {
    h.check('an entity that no longer exists is named rather than dropped',
      byClass(env.body, 'cfbe-line').some((n) => /Scene 9 no longer exists/.test(n.textContent)),
      byClass(env.body, 'cfbe-line').map((n) => n.textContent).join(' | '));
  })

  // A failed write leaves the dialog usable and says so, rather than reporting a
  // change that never landed.
  .then(() => openDialog({ failWrite: true }))
  .then((env) => {
    one(env.body, 'cfbe-field-name').value = 'colour';
    one(env.body, 'cfbe-field-value').value = 'green';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => {
      h.check('a failed write is reported',
        byClass(env.body, 'cfbe-ERROR').length === 1,
        byClass(env.body, 'cfbe-line').map((n) => n.textContent).join(' | '));
      h.check('and is not counted as applied',
        /0 entity changes written, 1 failed/.test(
          (one(env.body, 'cfbe-progress') || {}).textContent || ''),
        (one(env.body, 'cfbe-progress') || {}).textContent);
    });
  })

  // The version gate is the one warning in these dialogs that blocks: it is about
  // the dialog running code the user has already replaced, which is the one thing
  // they cannot see.
  .then(() => openDialog({ installed: '9.9.9' }))
  .then((env) => {
    one(env.body, 'cfbe-field-name').value = 'colour';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    h.check('a stale script cannot apply', one(env.body, 'cfbe-apply').disabled === true);
    h.check('and the head says why',
      /has 9\.9\.9 installed/.test((one(env.body, 'cfbe-note') || {}).textContent || ''),
      (one(env.body, 'cfbe-note') || {}).textContent);
  })

  // Escape goes through the footer rather than straight to `close()`, so it can only
  // ever do what a visible, enabled button already offers. Three states, and the
  // middle one is the reason it is written that way.
  .then(() => openDialog())
  .then((env) => {
    h.check('an open dialog listens on the document',
      (env.document.handlers.keydown || []).length === 1,
      String((env.document.handlers.keydown || []).length));
    h.fire(env.document, 'keydown', { key: 'Escape' });
    h.check('Escape closes the dialog from the listing', !one(env.body, 'cfbe-modal'));
    h.check('and takes its key handler off the document with it',
      (env.document.handlers.keydown || []).length === 0,
      String((env.document.handlers.keydown || []).length));
  })

  // Mid-write both Cancel and Close are hidden and there is nothing to press, so the
  // key must do nothing at all. A dialog that vanished here would leave a write it
  // started running with nothing on screen accounting for it.
  .then(() => openDialog({ hangAfter: 0 }))
  .then((env) => {
    one(env.body, 'cfbe-field-name').value = 'colour';
    one(env.body, 'cfbe-field-value').value = 'green';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => {
      h.check('Cancel is showing but disabled while a write is in flight',
        !h.hasClass(one(env.body, 'cfbe-cancel'), 'cfbe-hidden') &&
        one(env.body, 'cfbe-cancel').disabled === true);
      h.fire(env.document, 'keydown', { key: 'Escape' });
      h.check('so Escape does nothing at all there', !!one(env.body, 'cfbe-modal'));
    });
  })

  // And a key that is not Escape is not a way out either - the handler is on the
  // whole document, so every keystroke in either filter box reaches it.
  .then(() => openDialog())
  .then((env) => {
    h.fire(env.document, 'keydown', { key: 'a' });
    h.check('another key leaves the dialog alone', !!one(env.body, 'cfbe-modal'));
  })

  // ── The summary line, Copy log and Rescan ─────────────────────────────────
  //
  // The listing says what every entity carries, one line each; none of it says what
  // the *selection* carries. On 155,000 entities that is the only question the screen
  // cannot answer by being scrolled, which is what the summary line is for.
  .then(() => openDialog())
  .then((env) => {
    // A selection is one type by construction, so a type pulldown here would be six
    // ways to empty the list and one to leave it alone.
    h.check('a selection run offers no filter by entity type',
      !one(env.body, 'cfbe-filter-type'));
    h.check('a read ends with one INFO line naming every field found, with counts',
      notes(env.body).some((l) => l === '[INFO] Custom fields found: colour x2, rating x1.'),
      notes(env.body).join(' | '));
    // Since 0.6.0 the names in it are the same click-to-copy pill the listing gives
    // them: they are what gets typed into Field name next.
    const named = msgPills(env.body, 0);
    h.check('every name in it is a copy pill',
      named.map((p) => p.textContent).join(',') === 'colour,rating',
      named.map((p) => p.textContent).join(','));
    named[1].click();
    h.check('and clicking one copies just that name',
      env.copied[env.copied.length - 1] === 'rating', JSON.stringify(env.copied));

    press(env.body, 'cfbe-copy');
    return h.flush().then(() => {
      const copied = env.copied[env.copied.length - 1] || '';
      h.check('Copy log takes the counters, the INFO lines and the listing',
        /3 scenes read/.test(copied) && /Custom fields found/.test(copied) &&
        copied.indexOf('Scene "S1" (1): colour' + EQ + 'blue') !== -1, copied);
      // In the order the log has them, not counters-then-strip-then-list: the copy is
      // the log, and the log is chronological.
      h.check('and copies them in the order they happened',
        copied.indexOf('Scene "S1" (1): colour' + EQ + 'blue') <
          copied.indexOf('Custom fields found'), copied);
      h.check('and the caption says it worked',
        !!one(env.body, 'cfbe-copy') && one(env.body, 'cfbe-copy').textContent === 'Copied');
    });
  })

  // Counted off the changes, never off the rendered rows: the listing stops at 1000
  // lines and this is the thing that has to be right about a write bigger than that.
  .then(() => openDialog())
  .then((env) => {
    one(env.body, 'cfbe-mode').value = 'overwrite';
    one(env.body, 'cfbe-field-name').value = 'colour';
    one(env.body, 'cfbe-field-value').value = 'green';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => {
      h.check('the apply summary enumerates what happened, with counts',
        notes(env.body).some((l) => /Added x1, Replaced x2\.$/.test(l)),
        notes(env.body).join(' | '));

      const before = env.calls.filter((c) => /CFBE_Read/.test(c.query || '')).length;
      // Both boxes, because this is the one dialog of the four with two of them, and
      // which one carries the overflow depends on a `height:100%` no test here can
      // resolve. Zeroed first: a check that a scroll *happened* is worth more than one
      // that a number is still what it was.
      const list = one(env.body, 'cfbe-list');
      [list, list.parentNode].forEach((box) => { box.scrollHeight = 4200; box.scrollTop = 0; });
      press(env.body, 'cfbe-rescan');
      return h.flush().then(() => {
        h.check('a new line scrolls the list and its wrapper to the bottom',
          list.scrollTop === 4200 && list.parentNode.scrollTop === 4200,
          list.scrollTop + ' / ' + list.parentNode.scrollTop);
        h.check('Rescan reads the library again',
          env.calls.filter((c) => /CFBE_Read/.test(c.query || '')).length === before + 1);
        h.check('and offers a fresh plan rather than the change recap',
          shown(env.body, 'cfbe-apply'));
        // The one thing a rescan must not quietly do: `changes` is what Undo replays,
        // and it writes by id rather than through the entity objects just replaced.
        h.check('with the undo from before it still offered',
          shown(env.body, 'cfbe-undo'));
        h.check('and the summary restated for what was just read',
          notes(env.body).filter((l) => /Custom fields found/.test(l)).length === 2,
          notes(env.body).join(' | '));
      });
    });
  })

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // This plugin declares no settings, so the `plugin-<id>-<key>` element ids every
  // sibling anchors on do not exist and the heading is the only route in. That is the
  // anchor two plugins here shipped broken on twice, so the fixture is Stash's real
  // shape - the version suffix appended to the heading included - and the negatives
  // below matter as much as the positives.
  .then(() => {
    const env = start({ pathname: '/settings?tab=plugins' });
    const group = mountSettingGroup(env.body, 'GTTx Custom Fields Bulk Editor (0.1.0)',
      'Summary line.\n\nSecond paragraph.\n\nThird paragraph.');
    env.tick();
    const sub = group.descendants().filter((n) => h.hasClass(n, 'sub-heading'))[0];
    const paras = sub.childNodes.filter((n) => h.hasClass(n, 'cfbe-p'));

    h.check('the group is marked as ours', h.hasClass(group, 'cfbe-own-group'));
    h.check('the description is rebuilt as paragraphs', paras.length === 3,
      String(paras.length));
    h.check('the summary is the first of them',
      (paras[0] || {}).textContent === 'Summary line.', (paras[0] || {}).textContent);
    h.check('it starts collapsed', h.hasClass(sub, 'cfbe-desc-collapsed'));

    const toggle = env.body.descendants().filter((n) => n.id === 'cfbe-desc-toggle')[0];
    h.check('a Show more toggle is offered', !!toggle && toggle.textContent === 'Show more');
    // A <button>, because SettingGroup's onDivClick returns early only for `a` and
    // `button` - anything else folds the whole group on click.
    h.check('and it is a button', !!toggle && toggle.tagName === 'BUTTON');
    // Guarded rather than assumed: against a build with no toggle these have to
    // report a failure, not crash the run and take every later check with them.
    if (toggle) toggle.click();
    h.check('clicking it expands the description',
      !!toggle && !h.hasClass(sub, 'cfbe-desc-collapsed'));
    h.check('and the caption follows', !!toggle && toggle.textContent === 'Show less');
    if (toggle) toggle.click();
    h.check('clicking again collapses it', !!toggle && h.hasClass(sub, 'cfbe-desc-collapsed'));

    const link = env.body.descendants().filter((n) => n.id === 'cfbe-readme-link')[0];
    h.check('the README is linked under the description', !!link &&
      /CustomFieldsBulkEditor\/README\.md$/.test(link.href || ''), link && link.href);

    // React re-renders this panel on any change and drops what we put in it, so the
    // tick puts it back - and must not produce a second copy of anything.
    env.tick();
    env.tick();
    h.check('an idle tick adds no second toggle',
      env.body.descendants().filter((n) => n.id === 'cfbe-desc-toggle').length === 1);
    h.check('nor a second README link',
      env.body.descendants().filter((n) => n.id === 'cfbe-readme-link').length === 1);
    h.check('nor re-splits the paragraphs',
      sub.childNodes.filter((n) => h.hasClass(n, 'cfbe-p')).length === 3);
    h.check('and the settings page issues no queries at all', env.calls.length === 0,
      env.calls.map((c) => (c.query || '').slice(0, 30)).join(' | '));
  })

  // The per-setting hover box, which this plugin has had a use for only since 0.7.0
  // gave it a setting. Same design as the three siblings, same three triggers.
  .then(() => {
    const env = start({ pathname: '/settings?tab=plugins' });
    const group = mountSettingGroup(env.body, 'GTTx Custom Fields Bulk Editor (0.7.0)',
      'Summary line.\n\nSecond paragraph.');
    const two = mountSettingRow(group, 'a1SkipImagesInTask',
      'Leave Images out of the library-wide task.\n\nImages are usually the most numerous type.');
    env.tick();

    const kids = two.sub.childNodes;
    const summary = kids.filter((n) => h.hasClass(n, 'cfbe-sum'))[0];
    const mark = kids.filter((n) => h.hasClass(n, 'cfbe-tip'))[0];
    const box = kids.filter((n) => h.hasClass(n, 'cfbe-tipbox'))[0];
    h.check('a setting row keeps only its first paragraph on the page',
      !!summary && summary.textContent === 'Leave Images out of the library-wide task.',
      summary && summary.textContent);
    h.check('the rest moves into a built box rather than a native title',
      !!box && /most numerous/.test(box.textContent) && !mark.title && !two.h3.title,
      box && box.textContent);
    h.check('the mark is focusable, so the box is reachable without a mouse',
      !!mark && mark.tabIndex === 0, mark && String(mark.tabIndex));
    [['the mark', mark], ['the summary', summary], ['the setting name', two.h3]]
      .forEach(([what, node]) => {
        h.fire(node, 'mouseenter');
        const opened = h.hasClass(two.sub, 'cfbe-tip-open');
        h.fire(node, 'mouseleave');
        h.check('hovering ' + what + ' opens and closes the box',
          opened && !h.hasClass(two.sub, 'cfbe-tip-open'), 'opened ' + opened);
      });
    env.tick();
    h.check('an idle tick builds no second box',
      two.sub.childNodes.filter((n) => h.hasClass(n, 'cfbe-tipbox')).length === 1,
      String(two.sub.childNodes.length));
  })

  // A one-paragraph setting hides nothing, so nothing is built for it.
  .then(() => {
    const env = start({ pathname: '/settings?tab=plugins' });
    const group = mountSettingGroup(env.body, 'GTTx Custom Fields Bulk Editor (0.7.0)',
      'Summary line.\n\nSecond paragraph.');
    const one = mountSettingRow(group, 'a1SkipImagesInTask', 'Just the one line.');
    env.tick();
    h.check('a one-paragraph setting is left alone',
      one.sub.childNodes.length === 0 && !h.hasClass(one.sub, 'cfbe-tipped'),
      one.sub.className + ' / ' + one.sub.childNodes.length + ' children');
  })

  // Exactly, never by prefix: a plugin whose name merely starts with ours is not us.
  .then(() => {
    const env = start({ pathname: '/settings?tab=plugins' });
    const group = mountSettingGroup(env.body, 'GTTx Custom Fields Bulk Editor Extra (1.0.0)',
      'Someone else.\n\nAnd their detail.');
    env.tick();
    h.check('another plugin group is left alone', !h.hasClass(group, 'cfbe-own-group'));
    h.check('and gets no toggle of ours',
      env.body.descendants().filter((n) => n.id === 'cfbe-desc-toggle').length === 0);
  })

  // A one-paragraph description hides nothing, so a toggle would open on a click to
  // show what is already there.
  .then(() => {
    const env = start({ pathname: '/settings?tab=plugins' });
    mountSettingGroup(env.body, 'GTTx Custom Fields Bulk Editor (0.1.0)', 'Just the one line.');
    env.tick();
    h.check('a one-paragraph description gets no toggle',
      env.body.descendants().filter((n) => n.id === 'cfbe-desc-toggle').length === 0);
    h.check('but is still linked to its README',
      env.body.descendants().filter((n) => n.id === 'cfbe-readme-link').length === 1);
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
