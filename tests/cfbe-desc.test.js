// The description store in ᝯㄝₓ Custom Fields Bulk Editor: the second task, the tag
// that holds every custom field's description, and the dropdown filter that hides a
// marked entity from Stash's add/select lists.
//
// The first dialog is covered by cfbe.test.js and cfbe-task.test.js; this suite is
// about what the store adds - a tag found by a marker rather than by its name, a blob
// in that tag's own description, a version gate over it, and a fetch wrapper this
// plugin did not have until 0.8.0.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const SRC = process.env.SRC || path.join(
  __dirname, '..', 'CustomFieldsBulkEditor', 'CustomFieldsBulkEditor.js');

const PLUGIN_NAME = 'ᝯㄝₓ Custom Fields Bulk Editor';
const TASK = 'Manage Custom Field Descriptions...';
const BULK_TASK = 'Edit Custom Fields Across the Whole Library...';
const STORE_FIELD = 'ᱜ╦╦🞮_🛂🧲_🛠🛈🖫_desc_store';
const LEGACY_STORE_FIELD = 'cfbe_desc_store';
const HIDE = 'ᱜ╦╦🞮_exclude_from_add_list';
const LEGACY_HIDE_FIELD = 'Exclude_from_add_list';
const STORE_TAG_NAME = 'ᱜ╦╦🞮 🗃️🔌 🛂🧲 🛠🛈🖫 ❌∙';
// Read from the source rather than pinned: the blob carries whatever version wrote it,
// and a bump is not a thing this suite should have to be edited for.
const VERSION = /PLUGIN_VERSION = '([^']+)'/.exec(
  require('fs').readFileSync(SRC, 'utf8'))[1];

// A store tag as the plugin writes one: a sentence, then the blob. The sentence is
// there to be ignored by the parser, which is the point of testing with one.
const blob = (o) => 'Managed by the plugin; delete this to reset.\n\n' + JSON.stringify(o);

const LIBRARY = {
  scenes: [{ id: '1', title: 'S1', custom_fields: { colour: 'blue', rating_source: 'me' } },
           { id: '2', title: 'S2', custom_fields: {} }],
  images: [],
  galleries: [],
  performers: [{ id: '1', name: 'P1', custom_fields: { colour: 'red' } }],
  groups: [],
  studios: [],
  tags: [{ id: '1', name: 'T1', custom_fields: { colour: 'green' } }],
};

// The same library with the store tag in it, which is the case that has to disappear
// from every listing.
function withStore(store, extraTags) {
  const lib = JSON.parse(JSON.stringify(LIBRARY));
  if (store) lib.tags.push(store);
  (extraTags || []).forEach((t) => lib.tags.push(t));
  return lib;
}

const STORE_TAG = {
  id: '9', name: 'plumbing', custom_fields: { [STORE_FIELD]: '1' },
  description: blob({ version: '0.8.0', hideField: HIDE,
    descriptions: { colour: 'The colour it is filed under.', gone: 'A field nothing carries.' } }),
};

function mountTasksPage(body, label) {
  const group = h.makeElement('div');
  group.className = 'setting-group';
  const head = h.makeElement('div');
  head.className = 'setting';
  const h3 = h.makeElement('h3');
  h3.textContent = PLUGIN_NAME;
  head.appendChild(h3);
  group.appendChild(head);
  const btn = h.makeElement('button');
  btn.className = 'btn btn-secondary';
  btn.textContent = label;
  group.appendChild(btn);
  body.appendChild(group);
  return btn;
}

function responder(opts) {
  opts = opts || {};
  const lib = opts.library || withStore(STORE_TAG);
  return (req) => {
    const q = req.query || '';
    if (/CFBEPluginVersion/.test(q)) return { data: { plugins: [] } };
    if (/configuration/.test(q)) {
      return { data: { configuration: { plugins:
        opts.settings ? { CustomFieldsBulkEditor: opts.settings } : {} } } };
    }
    // The store read: by marker custom field, never by name.
    if (/CFBE_Store/.test(q)) {
      if (opts.storeFails) return { errors: [{ message: 'store boom' }] };
      const field = req.variables.f.custom_fields[0].field;
      const tags = (lib.tags || []).filter((t) => (t.custom_fields || {})[field] != null);
      return { data: { findTags: { tags: JSON.parse(JSON.stringify(tags)) } } };
    }
    if (/CFBE_Marked/.test(q)) {
      const type = /find(\w+)\(/.exec(q)[1];
      const key = type.toLowerCase();
      const field = /field:\s*"([^"]+)"/.exec(q)[1];
      const all = (lib[key] || []).filter((o) => (o.custom_fields || {})[field] != null);
      return { data: { ['find' + type]: { [key]: JSON.parse(JSON.stringify(all)) } } };
    }
    if (/CFBE_ReadAll/.test(q)) {
      const type = /find(\w+)\(filter/.exec(q)[1];
      const key = type.toLowerCase();
      const per = Number(/per_page:\s*(\d+)/.exec(q)[1]);
      const page = Number(/\bpage:\s*(\d+)/.exec(q)[1]);
      const all = lib[key] || [];
      return { data: { ['find' + type]: { count: all.length,
        [key]: JSON.parse(JSON.stringify(all.slice((page - 1) * per, page * per))) } } };
    }
    if (/CFBE_TagCreate/.test(q)) {
      if (opts.createFails) return { errors: [{ message: 'tag with name already exists' }] };
      return { data: { tagCreate: { id: '77', name: req.variables.input.name,
        description: req.variables.input.description } } };
    }
    if (/CFBE_TagUpdate/.test(q)) {
      return { data: { tagUpdate: { id: req.variables.input.id, name: req.variables.input.name,
        description: req.variables.input.description } } };
    }
    const mut = /mutation CFBE_(\w+)\(/.exec(q);
    if (mut) {
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
  const env = h.makeEnv({
    quiet: true,
    pathname: (opts && opts.pathname) || '/settings?tab=tasks',
    respond: responder(opts),
  });
  h.run(env.ctx, SRC);
  return env;
}

function clickTask(env, btn) {
  let defaulted = false;
  let stopped = false;
  h.fire(env.ctx.document, 'click', {
    target: btn,
    preventDefault() { defaulted = true; },
    stopPropagation() { stopped = true; },
  });
  return h.flush(400).then(() => ({ defaulted, stopped }));
}

function openDesc(opts) {
  const env = start(opts);
  const btn = mountTasksPage(env.body, (opts && opts.task) || TASK);
  env.tick();
  return clickTask(env, btn).then((ev) => { env.ev = ev; env.btn = btn; return env; });
}

const byClass = (body, cls) => body.descendants().filter((n) => h.hasClass(n, cls));
const one = (body, cls) => byClass(body, cls)[0] || null;
const names = (body) => byClass(body, 'cfbe-name').map((n) => n.textContent);
const notes = (body) => byClass(body, 'cfbe-line').map((n) => n.textContent);
const foot = (body) => (one(body, 'cfbe-foot') || { childNodes: [] }).childNodes
  .filter((b) => !h.hasClass(b, 'cfbe-hidden')).map((b) => b.textContent);
const writes = (calls) => calls.filter((c) => /mutation CFBE_/.test(c.query || '') &&
  !/CFBE_SeedSettings/.test(c.query || ''));   // the settings seed is not a library write
const tagWrites = (calls) => calls.filter((c) => /CFBE_Tag(Create|Update)/.test(c.query || ''));
// The blob out of whatever the last tag write sent, parsed the way the plugin parses it.
function sentStore(calls) {
  const last = tagWrites(calls).pop();
  if (!last) return null;
  const d = String(last.variables.input.description || '');
  return JSON.parse(d.slice(d.indexOf('{'), d.lastIndexOf('}') + 1));
}
const hasOwnShade = (o) => Object.prototype.hasOwnProperty.call(o, 'shade');
const pick = (body, label) => byClass(body, 'cfbe-name')
  .filter((b) => b.textContent.indexOf(label) !== -1)[0] || null;

function type(env, text) {
  const box = one(env.body, 'cfbe-text');
  box.value = text;
  h.fire(box, 'input', {});
  return box;
}

// A plugin loaded with a library holding one marked tag, one tag whose mark reads as
// false, and the store tag - plus a `select` that posts a named operation the way
// Stash's own select components do, and reads the answer back through the wrapper.
const SELECT_TAGS = [{ id: '1', name: 'T1', custom_fields: { colour: 'green' } },
  { id: '9', name: 'plumbing', custom_fields: { [STORE_FIELD]: '1', [HIDE]: '1' } },
  { id: '5', name: 'hidden', custom_fields: { [HIDE]: '1' } },
  { id: '6', name: 'unmarked', custom_fields: { [HIDE]: '0' } }];

function selectEnv(opts) {
  const lib = Object.assign(JSON.parse(JSON.stringify(LIBRARY)), { tags: SELECT_TAGS });
  const base = responder(Object.assign({ library: lib }, opts || {}));
  const env = h.makeEnv({
    quiet: true,
    pathname: '/scenes/1',
    respond: (req) => {
      if (/ForSelect|query FindTags\b/.test(req.query || '')) {
        return { data: { findTags: { count: SELECT_TAGS.length,
          tags: JSON.parse(JSON.stringify(SELECT_TAGS)) } } };
      }
      return base(req);
    },
  });
  h.run(env.ctx, SRC);
  env.select = (op, vars) => env.ctx.window.fetch('/graphql', {
    method: 'POST',
    body: JSON.stringify({ operationName: op, variables: vars || {},
      query: 'query ' + op + ' { findTags { count tags { id } } }' }),
  }).then((r) => r.json());
  return env;
}

function press(env, cls) {
  const b = one(env.body, cls);
  b.click();
  return h.flush(80);
}

// ── Opening, and reading the store ──────────────────────────────────────────

openDesc()
  .then((env) => {
    h.check('the second task opens its own dialog', !!one(env.body, 'cfbe-panes'));
    h.check('the click is stopped before Stash can queue a job',
      env.ev.defaulted && env.ev.stopped);
    h.check('the head names the descriptions, not a bulk edit',
      /Custom field descriptions/.test((one(env.body, 'cfbe-title') || {}).textContent || ''),
      (one(env.body, 'cfbe-title') || {}).textContent);

    // The one thing a rename must not be able to break.
    const store = env.calls.filter((c) => /CFBE_Store/.test(c.query || ''));
    h.check('the store tag is found by its marker custom field', store.length === 1 &&
      store[0].variables.f.custom_fields[0].field === STORE_FIELD &&
      store[0].variables.f.custom_fields[0].modifier === 'NOT_NULL',
    JSON.stringify(store[0] && store[0].variables));
    h.check('and never by the name in the setting',
      !store.some((c) => /plumbing|Description Store/.test(JSON.stringify(c.variables))));

    h.check('the log says which tag holds them',
      notes(env.body).some((l) => /Descriptions are kept on tag "plumbing" \(9\)/.test(l)),
      notes(env.body).join(' | '));

    // Found fields first, then a description with nothing carrying it.
    h.check('the left pane lists every custom field found',
      names(env.body).some((n) => /colour x3/.test(n)) &&
      names(env.body).some((n) => /rating_source x1/.test(n)),
      names(env.body).join(' | '));
    h.check('a description with no field left carrying it is marked orphan',
      names(env.body).some((n) => /gone \[orphan\]/.test(n)),
      names(env.body).join(' | '));
    h.check('and the orphan is last, after the fields that exist',
      names(env.body).map((n) => /orphan/.test(n)).lastIndexOf(false) <
        names(env.body).map((n) => /orphan/.test(n)).indexOf(true));

    // The store tag is the plugin's own plumbing, and it carries the marker field -
    // which would otherwise be listed back to the user as one of their custom fields.
    h.check('the store tag itself is left out of the scan',
      !names(env.body).some((n) => new RegExp(STORE_FIELD).test(n)),
      names(env.body).join(' | '));

    h.check('nothing is written by opening it', writes(env.calls).length === 0,
      writes(env.calls).map((c) => c.query.slice(0, 40)).join(' | '));
    // Apply is *on*, and the only thing pending is the description this plugin seeds
    // for its own hide-from-add-lists field - which the fixture's store does not carry.
    // Staged like anything else rather than written on open: the dialog's promise is
    // that nothing goes out until the button is pressed, and that has to hold for this
    // plugin's own housekeeping too.
    h.check('the seeded description is staged rather than written',
      !one(env.body, 'cfbe-apply').disabled &&
      notes(env.body).some((l) => /Seeded a description for "ᱜ╦╦🞮_exclude_from_add_list"/.test(l)),
      notes(env.body).join(' | '));
    h.check('the footer is the siblings\' order',
      foot(env.body).join(' ') === 'Apply Cancel Copy log Rescan',
      foot(env.body).join(' '));
    return env;
  })

  // ── Picking a field, and writing one ──────────────────────────────────────
  .then((env) => {
    pick(env.body, 'colour').click();
    // Two boxes, one typed into and one read-only, neither obvious from its contents.
    const heads = byClass(env.body, 'cfbe-detail-head').map((n) => n.textContent);
    // Three heads: the name, in a box that is also the rename control; the description
    // over the box it is typed into; and the read-only list of what carries the field.
    h.check('the first head is the name, with the field in an editable box',
      heads[0].indexOf('Name') === 0 && one(env.body, 'cfbe-namebox').value === 'colour',
      heads.join(' | ') + ' / ' + one(env.body, 'cfbe-namebox').value);
    h.check('the second says what the box under it is for',
      heads[1] === 'Description', heads.join(' | '));
    h.check('and the third is the list of entities, and what carries it',
      heads[2] === 'List of entities - 3 entities carry "colour"', heads.join(' | '));
    h.check('the name box is editable straight away, with nothing typed into the description',
      one(env.body, 'cfbe-namebox').disabled === false);
    h.check('with a line per entity, each linking to its own type',
      byClass(one(env.body, 'cfbe-users'), 'cfbe-pill-ent').map((p) => p.href).join(' ') ===
        '/scenes/1 /performers/1 /tags/1',
      byClass(one(env.body, 'cfbe-users'), 'cfbe-pill-ent').map((p) => p.href).join(' '));
    h.check('and the box holds the description it already has',
      one(env.body, 'cfbe-text').value === 'The colour it is filed under.',
      one(env.body, 'cfbe-text').value);

    // ── The room the two boxes and the log get ──────────────────────────────
    //
    // No layout in this DOM, so the heights are the test's to state: a pane 500 tall
    // and a box whose content is however many pixels the check is about.
    const box = one(env.body, 'cfbe-text');
    const panes = one(env.body, 'cfbe-panes');
    const modal = one(env.body, 'cfbe-modal');
    h.check('nothing is sized while there is no layout to size against',
      box.style.height === undefined || box.style.height === '', box.style.height);
    panes.clientHeight = 500;
    box.scrollHeight = 120;
    pick(env.body, 'colour').click();
    h.check('loading a description sizes the box to fit it',
      box.style.height === '124px', box.style.height);
    box.scrollHeight = 900;
    pick(env.body, 'colour').click();
    h.check('and a long one stops at four fifths of the pane, so the list stays visible',
      box.style.height === '400px', box.style.height);

    const bar = one(env.body, 'cfbe-divider');
    h.check('a drag handle sits between the panes and the log',
      !!bar && bar.previousSibling === panes && h.hasClass(bar.nextSibling, 'cfbe-log'),
      bar && bar.nextSibling && bar.nextSibling.className);
    modal.clientHeight = 800;
    panes.offsetHeight = 300;
    h.fire(bar, 'mousedown', { clientY: 100 });
    h.fire(env.document, 'mousemove', { clientY: 160 });
    h.check('dragging it down gives the log the room it takes off the panes',
      panes.style.flex === '0 0 360px', panes.style.flex);
    h.fire(env.document, 'mousemove', { clientY: 5000 });
    h.check('and it stops before the log and the footer are squeezed off screen',
      panes.style.flex === '0 0 600px', panes.style.flex);
    h.fire(env.document, 'mouseup', {});
    h.fire(env.document, 'mousemove', { clientY: 100 });
    h.check('letting go ends the drag rather than latching it',
      panes.style.flex === '0 0 600px', panes.style.flex);

    type(env, 'What colour it is.');
    h.check('typing enables Apply', !one(env.body, 'cfbe-apply').disabled);
    h.check('and marks the line as changed',
      /^\* colour/.test(pick(env.body, 'colour').textContent),
      pick(env.body, 'colour').textContent);

    return press(env, 'cfbe-apply').then(() => {
      h.check('Apply writes the whole store in one tagUpdate',
        tagWrites(env.calls).length === 1 &&
        /CFBE_TagUpdate/.test(tagWrites(env.calls)[0].query),
        tagWrites(env.calls).map((c) => c.query.slice(0, 30)).join(' | '));
      const sent = sentStore(env.calls);
      h.check('the blob carries the edited description',
        sent.descriptions.colour === 'What colour it is.', JSON.stringify(sent.descriptions));
      h.check('and keeps the ones nobody touched', sent.descriptions.gone === 'A field nothing carries.');
      h.check('and stamps the running version', sent.version === VERSION, sent.version);
      h.check('and remembers the field name the hide setting had',
        sent.hideField === HIDE, sent.hideField);
      h.check('the marker is topped up rather than replaced',
        tagWrites(env.calls)[0].variables.input.custom_fields.partial[STORE_FIELD] === '1',
        JSON.stringify(tagWrites(env.calls)[0].variables.input.custom_fields));
      h.check('the log lists the change with before and after',
        byClass(env.body, 'cfbe-entry').some((n) =>
          /Replaced.*colour.*The colour it is filed under.*What colour it is/.test(n.textContent)),
        byClass(env.body, 'cfbe-entry').map((n) => n.textContent).join(' | '));
      h.check('Undo is offered afterwards, with Close beside it',
        foot(env.body).join(' ') === 'Apply Copy log Undo Rescan Close', foot(env.body).join(' '));

      // The dialog is an editor, not a plan: a written Apply does not end it, and
      // needing a Rescan before typing again was the complaint that got this fixed.
      h.check('the box is still typeable after a written Apply',
        !one(env.body, 'cfbe-text').disabled);
      h.check('and Apply is disabled again only because nothing is unsaved',
        one(env.body, 'cfbe-apply').disabled);
      return env;
    });
  })

  // ── Undo ─────────────────────────────────────────────────────────────────
  .then((env) => {
    const before = tagWrites(env.calls).length;
    return press(env, 'cfbe-undo').then(() => {
      h.check('Undo arms rather than writing on the first click',
        tagWrites(env.calls).length === before &&
        /Undo\?/.test(one(env.body, 'cfbe-undo').textContent),
        one(env.body, 'cfbe-undo').textContent);
      return press(env, 'cfbe-undo');
    }).then(() => {
      const last = tagWrites(env.calls).pop();
      h.check('and the second click puts the whole description back',
        last.variables.input.description === STORE_TAG.description,
        String(last.variables.input.description).slice(0, 60));
      h.check('naming the tag it was called before', last.variables.input.name === 'plumbing');
      // Editing stays open afterwards, so a box still showing the reversed text would be
      // the next thing typed over.
      h.check('and the box shows the description it restored, not the one it reversed',
        one(env.body, 'cfbe-text').value === 'The colour it is filed under.',
        one(env.body, 'cfbe-text').value);
      return env;
    });
  })

  // ── And editing carries straight on, with no Rescan in between ────────────
  .then((env) => {
    const before = tagWrites(env.calls).length;
    type(env, 'What colour it is, exactly.');
    h.check('typing after an Undo re-enables Apply', !one(env.body, 'cfbe-apply').disabled);
    return press(env, 'cfbe-apply').then(() => {
      h.check('and that Apply writes the new edit',
        tagWrites(env.calls).length === before + 1 &&
        sentStore(env.calls).descriptions.colour === 'What colour it is, exactly.',
        JSON.stringify(sentStore(env.calls).descriptions));
      return env;
    });
  })

  // ── An empty library: the store is created, not assumed ───────────────────
  .then(() => openDesc({ library: withStore(null) }))
  .then((env) => {
    h.check('with no store, the log says Apply will create one',
      notes(env.body).some((l) => /No description store yet/.test(l)),
      notes(env.body).join(' | '));
    h.check('and a description is seeded for the hide-from-add-lists field',
      names(env.body).some((n) => new RegExp(HIDE).test(n)), names(env.body).join(' | '));
    h.check('which is enough on its own to enable Apply',
      !one(env.body, 'cfbe-apply').disabled);

    return press(env, 'cfbe-apply').then(() => {
      const call = tagWrites(env.calls)[0];
      h.check('the store is created with one tagCreate', !!call &&
        /CFBE_TagCreate/.test(call.query), (call || {}).query);
      h.check('carrying the marker so it can be found again',
        call.variables.input.custom_fields[STORE_FIELD] === '1',
        JSON.stringify(call.variables.input.custom_fields));
      h.check('and marked hidden from the add lists itself',
        call.variables.input.custom_fields[HIDE] === '1',
        JSON.stringify(call.variables.input.custom_fields));
      // Since 2.0.1: the name is unreachable from an ASCII keyboard, and the tag is
      // plumbing rather than something to file scenes under.
      h.check('with an ASCII alias, and left out of auto-tagging',
        String(call.variables.input.aliases) === 'GTTx Custom Field Description Store' &&
        call.variables.input.ignore_auto_tag === true,
        JSON.stringify(call.variables.input.aliases) + ' ' +
        call.variables.input.ignore_auto_tag);
      h.check('under the name in the setting',
        call.variables.input.name === 'ᱜ╦╦🞮 🗃️🔌 🛂🧲 🛠🛈🖫 ❌∙', call.variables.input.name);
      h.check('the description opens with a sentence, not with the blob',
        /^[^{]{20,}/.test(call.variables.input.description),
        String(call.variables.input.description).slice(0, 40));
      h.check('and the blob in it parses', !!sentStore(env.calls));
      return env;
    });
  })

  // ── The marker rename, since 2.0.1 ───────────────────────────────────────
  //
  // A store wearing the old `cfbe_desc_store` marker is found and moved onto the
  // prefixed one, without the user being told: the store is the same store.
  .then(() => openDesc({ library: withStore(Object.assign({}, STORE_TAG,
    { custom_fields: { [LEGACY_STORE_FIELD]: '1', [LEGACY_HIDE_FIELD]: '1' } }),
  [{ id: '2', name: 'T2', custom_fields: { [LEGACY_HIDE_FIELD]: '1' } }]) }))
  .then((env) => {
    const store = env.calls.filter((c) => /CFBE_Store/.test(c.query || ''));
    h.check('the current marker is asked for first, the old one only after it misses',
      store.length === 2 && store[0].variables.f.custom_fields[0].field === STORE_FIELD &&
      store[1].variables.f.custom_fields[0].field === LEGACY_STORE_FIELD,
      JSON.stringify(store.map((c) => c.variables.f.custom_fields[0].field)));
    const moved = tagWrites(env.calls).filter((c) => /CFBE_TagUpdate/.test(c.query));
    const movedTo = (f) => moved.filter((c) => c.variables.input.custom_fields.partial[f] === '1');
    h.check('and the tag is moved onto the current marker on the way past',
      movedTo(STORE_FIELD).length === 1 && movedTo(STORE_FIELD)[0].variables.input.id === '9' &&
      String(movedTo(STORE_FIELD)[0].variables.input.custom_fields.remove) === LEGACY_STORE_FIELD,
      JSON.stringify(moved.map((c) => c.variables.input)));
    // The store tag hides itself with the hide field, and nothing else can reach that
    // mark - every scan leaves the store tag out.
    h.check('its own hide mark moves with the field\'s rename',
      movedTo(HIDE).length === 1 && movedTo(HIDE)[0].variables.input.id === '9' &&
      String(movedTo(HIDE)[0].variables.input.custom_fields.remove) === LEGACY_HIDE_FIELD,
      JSON.stringify(moved.map((c) => c.variables.input)));
    h.check('and an entity the user marked is left alone', moved.length === 2 &&
      !writes(env.calls).some((c) => !/CFBE_TagUpdate/.test(c.query)),
      writes(env.calls).map((c) => c.query.slice(0, 40)).join(' | '));
    h.check('the descriptions in it are read as usual',
      names(env.body).some((n) => /colour x3/.test(n)), names(env.body).join(' | '));
    h.check('and nothing is said about it', !notes(env.body).some((l) => /marker/i.test(l)),
      notes(env.body).join(' | '));
    return env;
  })

  // ── The version gate ─────────────────────────────────────────────────────
  .then(() => openDesc({ library: withStore(Object.assign({}, STORE_TAG,
    { description: blob({ version: '9.0.0', descriptions: { colour: 'newer' } }) })) }))
  .then((env) => {
    h.check('a store written by a newer version blocks editing',
      one(env.body, 'cfbe-apply').disabled);
    h.check('and says both ways out of it',
      notes(env.body).some((l) => /9\.0\.0/.test(l) && /delete that tag's description/.test(l)),
      notes(env.body).join(' | '));
    h.check('the box cannot be typed into either', one(env.body, 'cfbe-text').disabled);
    return env;
  })

  .then(() => openDesc({ library: withStore(Object.assign({}, STORE_TAG,
    { description: 'notes I typed myself { not json' })) }))
  .then((env) => {
    h.check('a description that is not our JSON is never written over',
      one(env.body, 'cfbe-apply').disabled);
    h.check('and says how to recover it by hand',
      notes(env.body).some((l) => /does not parse/.test(l)), notes(env.body).join(' | '));
    return env;
  })

  // ── Prune ────────────────────────────────────────────────────────────────
  .then(() => openDesc())
  .then((env) => {
    h.check('Prune is offered while there is an orphan to clear',
      !one(env.body, 'cfbe-prune').disabled);
    return press(env, 'cfbe-prune').then(() => {
      h.check('Prune takes the orphan rows out of the list with the descriptions',
        !names(env.body).some((n) => /gone|orphan/.test(n)), names(env.body).join(' | '));
      h.check('and greys itself out, having nothing left to clear',
        one(env.body, 'cfbe-prune').disabled);
      return press(env, 'cfbe-apply');
    }).then(() => {
      const sent = sentStore(env.calls);
      h.check('Prune drops the descriptions nothing carries',
        !Object.prototype.hasOwnProperty.call(sent.descriptions, 'gone'),
        JSON.stringify(sent.descriptions));
      h.check('and keeps the ones something does',
        sent.descriptions.colour === 'The colour it is filed under.');
      return env;
    });
  })

  // ── Renaming the field itself, from the box in the heading ───────────────
  .then(() => openDesc({}))
  .then((env) => {
    const box = () => one(env.body, 'cfbe-namebox');
    const btn = () => one(env.body, 'cfbe-rename');
    // Typing is the instruction; `change` is the browser saying it is finished.
    const type = (to) => { box().value = to; h.fire(box(), 'input', {}); return btn(); };
    const rename = (to) => { type(to); h.fire(box(), 'change', {}); return btn(); };
    h.check('nothing is picked, so there is no name box on the page yet',
      h.hasClass(box(), 'cfbe-hidden'), box().className);
    pick(env.body, 'colour').click();
    h.check('picking a field puts its name in the box',
      !h.hasClass(box(), 'cfbe-hidden') && box().value === 'colour', box().value);
    h.check('and Undo Rename is not offered until there is one to undo',
      h.hasClass(btn(), 'cfbe-hidden'), btn().className);
    type('shade');
    h.check('nor while the new name is only being typed',
      h.hasClass(btn(), 'cfbe-hidden'), btn().className);
    rename('shade');
    h.check('it appears once the rename is staged', !h.hasClass(btn(), 'cfbe-hidden'));
    btn().click();
    h.check('and pressing it puts the library\u2019s own name back',
      box().value === 'colour' && h.hasClass(btn(), 'cfbe-hidden'),
      box().value + ' / ' + btn().className);

    // A name something else already has would merge two fields into one key.
    rename('rating_source');
    h.check('renaming onto a name that already exists is refused',
      notes(env.body).some((l) => /a custom field of that name already exists/.test(l)),
      notes(env.body).slice(-2).join(' | '));
    h.check('and nothing moved in the list',
      names(env.body).some((n) => /colour/.test(n)), names(env.body).join(' | '));

    // The hide field's name is a setting, and this dialog implements the other direction.
    pick(env.body, HIDE).click();
    rename('something_else');
    h.check('renaming the hide field from here is refused, naming the setting instead',
      notes(env.body).some((l) => /it is the field named by the "Hide from Add Lists" setting/.test(l)),
      notes(env.body).slice(-2).join(' | '));

    pick(env.body, 'colour').click();
    rename('shade');
    h.check('a rename stages rather than writing', writes(env.calls).length === 0,
      String(writes(env.calls).length));
    h.check('and says what it staged, with the carrier count',
      notes(env.body).some((l) => /Staged: rename custom field "colour" to "shade" on 3 entities/.test(l)),
      notes(env.body).slice(-1).join(''));
    h.check('the list shows the new name and not the old one, with no rescan',
      names(env.body).some((n) => /shade/.test(n)) &&
      !names(env.body).some((n) => /colour/.test(n)) &&
      env.calls.filter((c) => /CFBE_ReadAll/.test(c.query || '')).length === 7,
      names(env.body).join(' | '));
    h.check('the users pane still shows each carrier\'s value, read from the old key',
      byClass(env.body, 'cfbe-users')[0].descendants()
        .some((n) => n.textContent === 'blue'),
      byClass(env.body, 'cfbe-users')[0].textContent);
    h.check('Rescan is held back while it is staged, and says why',
      one(env.body, 'cfbe-rescan').disabled === true &&
      /press Apply first/.test(one(env.body, 'cfbe-rescan').title),
      one(env.body, 'cfbe-rescan').title);
    h.check('and Apply is offered', one(env.body, 'cfbe-apply').disabled === false);

    // Undo Rename is the way off; typing the library's own name back is the same path,
    // and the button just fills the box for you.
    rename('colour');
    h.check('renaming it back cancels the staged rename',
      notes(env.body).some((l) => /staged rename of "colour" is cancelled/.test(l)),
      notes(env.body).slice(-1).join(''));
    h.check('and Rescan comes back with it',
      one(env.body, 'cfbe-rescan').disabled === false);

    rename('shade');
    return press(env, 'cfbe-apply').then(() => {
      // Editing stays open after an Apply here, so Apply itself has to go back to
      // saying there is nothing to write - a rename left `armed` after being written
      // kept it live for the rest of the session, and every press re-sent the store.
      const before = writes(env.calls).length;
      h.check('Apply goes back to disabled once the rename has been written',
        one(env.body, 'cfbe-apply').disabled === true);
      one(env.body, 'cfbe-apply').click();
      h.check('and pressing it again writes nothing',
        writes(env.calls).length === before, String(writes(env.calls).length - before));
      const moved = writes(env.calls).filter((c) => c.variables.input.custom_fields &&
        c.variables.input.custom_fields.remove);
      h.check('Apply renames the field on every entity carrying it',
        moved.length === 3 &&
        moved.every((c) => c.variables.input.custom_fields.remove[0] === 'colour' &&
          hasOwnShade(c.variables.input.custom_fields.partial)),
        JSON.stringify(moved.map((c) => c.variables.input.custom_fields)));
      h.check('and the description goes with it, into the store',
        !!sentStore(env.calls).descriptions.shade &&
        !sentStore(env.calls).descriptions.colour,
        JSON.stringify(sentStore(env.calls).descriptions));
      return env;
    });
  })

  // Undo has to take the *list* back as well as the library: the write reverses what
  // Stash holds, and nothing else was going to reverse what this dialog shows. Reported
  // live - the pane still named the field the new way, with no description under it.
  .then((env) => {
    const undoBtn = one(env.body, 'cfbe-undo');
    h.check('Undo is offered after a rename was applied',
      !h.hasClass(undoBtn, 'cfbe-hidden'), undoBtn.className);
    undoBtn.click();                       // arms
    return press(env, 'cfbe-undo').then(() => {
      const back = writes(env.calls).filter((c) => c.variables.input.custom_fields &&
        c.variables.input.custom_fields.remove &&
        c.variables.input.custom_fields.remove[0] === 'shade');
      h.check('the field goes back to its old name on every entity', back.length === 3,
        String(back.length));
      h.check('the list names it the old way again',
        names(env.body).some((n) => /colour/.test(n)) &&
        !names(env.body).some((n) => /shade/.test(n)), names(env.body).join(' | '));
      h.check('with its description under it, not lost with the new name',
        names(env.body).some((n) => /^[•*] +colour/.test(n)) &&
        one(env.body, 'cfbe-namebox').value === 'colour',
        names(env.body).join(' | ') + ' / ' + one(env.body, 'cfbe-namebox').value);
      h.check('and the carrier count comes back with it',
        names(env.body).some((n) => /colour x3/.test(n)), names(env.body).join(' | '));
      // The rename is still staged after being taken back, so Apply is offered again -
      // and re-applying it has to move the list forward a second time, or the store
      // would file the description under the name the library has just stopped using.
      h.check('the rename is still staged, so Apply is offered again',
        one(env.body, 'cfbe-apply').disabled === false);
      return press(env, 'cfbe-apply').then(() => {
        h.check('re-applying renames the field again',
          names(env.body).some((n) => /shade x3/.test(n)) &&
          !names(env.body).some((n) => /colour/.test(n)), names(env.body).join(' | '));
        h.check('and the description is filed under the name the library now has',
          !!sentStore(env.calls).descriptions.shade && !sentStore(env.calls).descriptions.colour,
          JSON.stringify(sentStore(env.calls).descriptions));
        return env;
      });
    });
  })

  // ── A renamed hide field ─────────────────────────────────────────────────
  .then(() => openDesc({
    settings: { c1ExcludeFromAddListField: 'Hide_me' },
    library: withStore(Object.assign({}, STORE_TAG, {
      description: blob({ version: '0.8.0', hideField: HIDE,
        descriptions: { [HIDE]: 'Hides it from the add lists.' } }),
    }), [{ id: '5', name: 'T5', custom_fields: { [HIDE]: '1' } }]),
  }))
  .then((env) => {
    h.check('renaming the setting moves the description to the new name',
      names(env.body).some((n) => /Hide_me/.test(n)) &&
      !names(env.body).some((n) => new RegExp('\\* ' + HIDE).test(n)),
      names(env.body).join(' | '));
    h.check('and the entities still carrying the old name are counted, not rewritten',
      writes(env.calls).length === 0 &&
      notes(env.body).some((l) => new RegExp('1 entity still carry|1 entity still carries|entities still carry')
        .test(l) || /still carry the old field name/.test(l)),
      notes(env.body).join(' | '));
    h.check('with a Migrate button offering the rename',
      !h.hasClass(one(env.body, 'cfbe-migrate'), 'cfbe-hidden') &&
      /Migrate 1 to "Hide_me"/.test(one(env.body, 'cfbe-migrate').textContent),
      one(env.body, 'cfbe-migrate').textContent);

    return press(env, 'cfbe-migrate').then(() => press(env, 'cfbe-apply')).then(() => {
      const rename = writes(env.calls).filter((c) => /tagUpdate/.test(c.query) &&
        c.variables.input.custom_fields && c.variables.input.custom_fields.remove);
      h.check('Apply renames the field on the entity carrying it', rename.length === 1 &&
        rename[0].variables.input.custom_fields.partial.Hide_me === '1' &&
        rename[0].variables.input.custom_fields.remove[0] === HIDE,
      JSON.stringify(rename.map((c) => c.variables.input)));
      h.check('and only on the entity that has it', rename[0].variables.input.id === '5',
        String(rename[0].variables.input.id));
      return env;
    });
  })

  // ── A field only the store tag carries is not an orphan ──────────────────
  //
  // The store tag marks *itself* with the hide-from-add-lists field, and `keep` takes
  // that tag out of every scan - so the one field this plugin asks the user to use read
  // as "no entity carries this any more", and Prune offered to drop its description.
  .then(() => openDesc({
    library: withStore(Object.assign({}, STORE_TAG, {
      custom_fields: { [STORE_FIELD]: '1', [HIDE]: '1' },
      description: blob({ version: '0.8.0', hideField: HIDE,
        descriptions: { [HIDE]: 'Hides it from the add lists.',
          gone: 'A field nothing carries.' } }),
    })),
  }))
  .then((env) => {
    h.check('a field only the store tag carries is marked [store tag] x1, not [orphan]',
      names(env.body).some((n) => new RegExp(HIDE + ' \\[store tag\\] x1').test(n)) &&
      !names(env.body).some((n) => new RegExp(HIDE + ' \\[orphan\\]').test(n)),
      names(env.body).join(' | '));
    h.check('a description nothing at all carries is still an orphan',
      names(env.body).some((n) => /gone \[orphan\]/.test(n)),
      names(env.body).join(' | '));
    h.check('and the log names the tag that carries it',
      notes(env.body).some((l) => /marked \[store tag\]/.test(l) && /plumbing/.test(l)),
      notes(env.body).join(' | '));

    pick(env.body, HIDE).click();
    const head = byClass(env.body, 'cfbe-detail-head').map((n) => n.textContent).join(' | ');
    h.check('picking it names the store tag rather than calling it an orphan',
      /only the description store tag carries/.test(head) && !/orphan/.test(head), head);
    h.check('and the pane lists that tag as its one carrier',
      byClass(env.body, 'cfbe-users').concat(byClass(env.body, 'cfbe-entry'))
        .some((n) => /plumbing/.test(n.textContent)),
      byClass(env.body, 'cfbe-users').map((n) => n.textContent).join(' | '));

    return press(env, 'cfbe-prune').then(() => press(env, 'cfbe-apply')).then(() => {
      const sent = sentStore(env.calls);
      h.check('Prune drops the orphan and leaves the store tag\'s field alone',
        !Object.prototype.hasOwnProperty.call(sent.descriptions, 'gone') &&
        sent.descriptions[HIDE] === 'Hides it from the add lists.',
        JSON.stringify(sent.descriptions));
      return env;
    });
  })

  // ── The store tag stays out of the bulk dialog too ───────────────────────
  .then(() => openDesc({ task: BULK_TASK }))
  .then((env) => {
    const listed = byClass(env.body, 'cfbe-entry').map((n) => n.textContent).join(' | ');
    h.check('the bulk listing leaves the store tag out', !/plumbing/.test(listed), listed);
    h.check('and says where its custom fields went instead',
      notes(env.body).some((l) => /left out of this listing/.test(l)),
      notes(env.body).join(' | '));
    // 0.12.0: what the click does leads, since it is true of every pill; the
    // description is the longer half and only some of them have one. 0.12.1 names
    // which half of the line the click takes, and labels the description.
    h.check('a field name in the listing carries its description as a tooltip, after the click',
      byClass(env.body, 'cfbe-pill-cf').some((p) =>
        /^Click to copy Name\nDescription: The colour it is filed under\./.test(p.title || '')),
      byClass(env.body, 'cfbe-pill-cf').map((p) => p.title).join(' | '));
    h.check('a name with no description still says which half of the line it copies',
      byClass(env.body, 'cfbe-pill-cf').some((p) => p.title === 'Click to copy Name'),
      byClass(env.body, 'cfbe-pill-cf').map((p) => p.title).join(' | '));
    h.check('and a value pill is not given one, nor called a name',
      byClass(env.body, 'cfbe-pill-cf').some((p) =>
        p.textContent === 'blue' && p.title === 'Click to copy'),
      byClass(env.body, 'cfbe-pill-cf').map((p) => p.title).join(' | '));
    return env;
  })

  // ── The dropdown filter ──────────────────────────────────────────────────
  //
  // The plugin wraps `window.fetch`, so these drive it the way Stash's own select
  // component does: post the operation by name and read the answer back.
  .then(() => {
    const env = selectEnv();
    return env.select('FindTagsForSelect').then((json) => {
      const ids = json.data.findTags.tags.map((t) => t.id).join(' ');
      h.check('a marked entity is dropped from the dropdown', ids === '1 6', ids);
      h.check('and the store tag with it', ids.indexOf('9') === -1, ids);
      h.check('a value of 0 does not count as marked', ids.indexOf('6') !== -1, ids);
      h.check('the count loses exactly what the list did',
        json.data.findTags.count === 2, String(json.data.findTags.count));
      h.check('the marked list is read once, with the field from the setting',
        env.calls.filter((c) => /CFBE_Marked/.test(c.query || '')).length === 1,
        String(env.calls.filter((c) => /CFBE_Marked/.test(c.query || '')).length));
      return env.select('FindTagsForSelect');
    }).then(() => {
      h.check('and not read again for a second dropdown',
        env.calls.filter((c) => /CFBE_Marked/.test(c.query || '')).length === 1,
        String(env.calls.filter((c) => /CFBE_Marked/.test(c.query || '')).length));
      return env.select('FindTags');
    }).then((json) => {
      h.check('an ordinary list query is left alone',
        json.data.findTags.tags.map((t) => t.id).join(' ') === '1 9 5 6',
        json.data.findTags.tags.map((t) => t.id).join(' '));
      // `queryFindTagsByIDForSelect` posts the *same* operation name with `ids` - it is
      // how a select draws what is already assigned. Filtering it would take a marked
      // tag out of the form of every entity that has it, and saving would then remove it.
      return env.select('FindTagsForSelect', { ids: ['5', '9'] });
    }).then((json) => {
      h.check('and so is a by-id request under the same operation name',
        json.data.findTags.tags.map((t) => t.id).join(' ') === '1 9 5 6',
        json.data.findTags.tags.map((t) => t.id).join(' '));
      return env;
    });
  })
  .then(() => {
    const env = selectEnv({ settings: { c1ExcludeFromAddListField: '' } });
    return env.select('FindTagsForSelect').then((json) => {
      h.check('clearing the setting switches the filter off',
        json.data.findTags.tags.map((t) => t.id).join(' ') === '1 9 5 6',
        json.data.findTags.tags.map((t) => t.id).join(' '));
      h.check('and asks nothing of the server about marks',
        !env.calls.some((c) => /CFBE_Marked/.test(c.query || '')));
      return env;
    });
  })
  // ── The defaults are written into the settings, so the boxes are not blank ──
  //
  // Stash has no `default:` for a plugin setting: a STRING reads as empty until someone
  // types in it, which is indistinguishable from one deliberately cleared - and clearing
  // is how the dropdown filter is switched off.
  .then(() => openDesc({}))
  .then((env) => {
    const seed = env.calls.filter((c) => /CFBE_SeedSettings/.test(c.query || ''));
    h.check('an unconfigured plugin writes its own string defaults in once',
      seed.length === 1, String(seed.length));
    h.check('naming the store tag', seed.length &&
      seed[0].variables.input.b1DescriptionTagName === STORE_TAG_NAME,
      seed.length && seed[0].variables.input.b1DescriptionTagName);
    h.check('and the hide-from-add-lists field',
      seed.length && seed[0].variables.input.c1ExcludeFromAddListField === HIDE,
      seed.length && seed[0].variables.input.c1ExcludeFromAddListField);
    h.check('under this plugin\'s own id', seed.length && seed[0].variables.id === 'CustomFieldsBulkEditor',
      seed.length && seed[0].variables.id);
    h.check('and the booleans are left out - absent already means what false means',
      seed.length && !('a1SkipImagesInTask' in seed[0].variables.input),
      seed.length && JSON.stringify(seed[0].variables.input));
    return env;
  })
  .then(() => openDesc({ settings: { b1DescriptionTagName: 'mine', c1ExcludeFromAddListField: '' } }))
  .then((env) => {
    h.check('a setting the user has answered is never seeded over - a cleared one included',
      !env.calls.some((c) => /CFBE_SeedSettings/.test(c.query || '')),
      env.calls.filter((c) => /CFBE_SeedSettings/.test(c.query || ''))
        .map((c) => JSON.stringify(c.variables.input)).join(' '));
    return env;
  })
  // Since 2.0.1: a hide field still reading the pre-prefix default is moved onto the
  // new name, in the settings and in what the page is using this load.
  .then(() => openDesc({ settings: { c1ExcludeFromAddListField: LEGACY_HIDE_FIELD } }))
  .then((env) => {
    const seed = env.calls.filter((c) => /CFBE_SeedSettings/.test(c.query || ''));
    h.check('the old hide-field default is written back under the prefixed one',
      seed.length === 1 && seed[0].variables.input.c1ExcludeFromAddListField === HIDE,
      seed.length && JSON.stringify(seed[0].variables.input));
    h.check('and this load is already using it, rather than waiting for the seed',
      notes(env.body).some((l) => new RegExp('Seeded a description for "' + HIDE + '"').test(l)),
      notes(env.body).join(' | '));
    return env;
  })

  // ── The descriptions, on Stash's own detail pages ────────────────────────
  .then(() => {
    const env = start({ pathname: '/scenes/1' });
    // Stash's own markup, read off `Shared/DetailItem.tsx` and `Shared/CustomFields.tsx`
    // rather than imagined: the detail panel's label is a span carrying the name in
    // `title` and the name *plus a colon* as text (DetailItem appends it for a
    // `fullWidth` item, which every custom field is), and the edit panel's is a label
    // carrying the name in both. An invented fixture - a leaf whose whole text is the
    // bare name and which carries no title - is what let this ship decorating nothing.
    const panel = h.makeElement('div');
    const root = h.makeElement('div');
    root.id = 'root';
    const detailLabel = (name) => { const n = h.makeElement('span');
      n.className = 'detail-item-title'; n.textContent = name + ':'; n.title = name;
      panel.appendChild(n); return n; };
    const named = detailLabel('colour');
    const undescribed = detailLabel('rating_source');
    const editLabel = h.makeElement('label');
    editLabel.textContent = 'colour';
    editLabel.title = 'colour';
    panel.appendChild(editLabel);
    const plain = h.makeElement('span');       // no title at all: the text route
    plain.textContent = 'colour';
    panel.appendChild(plain);
    const theirs = h.makeElement('span');      // a title that says something else
    theirs.textContent = 'colour';
    theirs.title = 'Sort by this';
    panel.appendChild(theirs);
    const link = h.makeElement('a');
    link.textContent = 'colour';
    panel.appendChild(link);
    const own = h.makeElement('div');
    own.className = 'cfbe-backdrop';
    const inside = h.makeElement('span');
    inside.textContent = 'colour';
    own.appendChild(inside);
    panel.appendChild(own);
    root.appendChild(panel);
    env.body.appendChild(root);
    env.tick();
    return h.flush(60).then(() => {
      env.tick();
      const tip = 'colour\n\nDescription: The colour it is filed under.';
      h.check('a described field name on a detail page gets the description as a tooltip',
        named.title === tip, named.title);
      h.check('the colon DetailItem appends does not stop the name matching',
        named.title === tip, named.textContent + ' -> ' + named.title);
      h.check('the edit panel\'s label gets it too, so an open Custom Fields section is covered',
        editLabel.title === tip, editLabel.title);
      h.check('a leaf carrying no title of its own is still matched on its text',
        plain.title === tip, plain.title);
      h.check('a title that is not just the name is left alone',
        theirs.title === 'Sort by this', theirs.title);
      h.check('a name with no description of its own is left alone',
        undescribed.title === 'rating_source', undescribed.title);
      h.check('a link is never decorated - a tag pill is one',
        !link.title, link.title);
      h.check('and neither is anything inside this plugin\'s own dialog',
        !inside.title, inside.title);
      return env;
    });
  })

  .then(() => {
    // A list page shows no custom fields, and not walking it is most of the saving.
    const env = start({ pathname: '/scenes' });
    const root = h.makeElement('div');
    root.id = 'root';
    const n = h.makeElement('span');
    n.textContent = 'colour';
    root.appendChild(n);
    env.body.appendChild(root);
    env.tick();
    return h.flush(60).then(() => {
      env.tick();
      h.check('a list page is not walked at all', !n.title, n.title);
      h.check('and the store is not even read for one',
        !env.calls.some((c) => /CFBE_Store/.test(c.query || '')),
        env.calls.map((c) => (c.query || '').slice(0, 24)).join(' | '));
      return env;
    });
  })

  // ── What this plugin answers for another ─────────────────────────────────
  .then(() => {
    const env = start({});
    const api = () => (env.ctx.window.StashPluginCoop.api || {}).CustomFieldsBulkEditor;
    h.check('it publishes describeField on the shared object',
      !!api() && typeof api().describeField === 'function' && !!api().version,
      api() && Object.keys(api()).join(','));
    return api().describeField('brand_new', 'What it is for.').then((outcome) => {
      h.check('a field with no description is documented, in one tag write',
        outcome === 'added' && sentStore(env.calls).descriptions.brand_new === 'What it is for.',
        outcome + ' / ' + JSON.stringify(sentStore(env.calls) || {}));
      h.check('and the descriptions already there are carried across',
        sentStore(env.calls).descriptions.colour === 'The colour it is filed under.',
        JSON.stringify(sentStore(env.calls).descriptions));
      return api().describeField('colour', 'Something else entirely.');
    }).then((outcome) => {
      h.check('a field that already has one keeps it', outcome === 'kept' &&
        sentStore(env.calls).descriptions.colour === 'The colour it is filed under.',
        outcome);
      return api().describeField('', 'nothing to file this under');
    }).then((outcome) => {
      h.check('an empty name or an empty description is refused', outcome === 'rejected');
      return env;
    });
  })

  .then(() => {
    // No store tag yet: the description is queued rather than a tag being created.
    // Making an entity in somebody's library because another plugin's script ran is
    // exactly the write this dialog refuses to make even while it is open.
    const env = start({ library: withStore(null) });
    const api = () => (env.ctx.window.StashPluginCoop.api || {}).CustomFieldsBulkEditor;
    return api().describeField('brand_new', 'What it is for.').then((outcome) => {
      h.check('with no store yet the description is queued, not written',
        outcome === 'queued' && tagWrites(env.calls).length === 0, outcome);
      const btn = mountTasksPage(env.body, TASK);
      env.tick();
      return clickTask(env, btn).then(() => {
        h.check('and the descriptions dialog seeds it like any other',
          names(env.body).some((n) => /brand_new/.test(n)), names(env.body).join(' | '));
        h.check('saying where it came from',
          notes(env.body).some((l) => /Another plugin asked for/.test(l)),
          notes(env.body).join(' | '));
        h.check('still writing nothing until Apply', tagWrites(env.calls).length === 0);
        return press(env, 'cfbe-apply').then(() => {
          h.check('and Apply files it with the rest',
            sentStore(env.calls).descriptions.brand_new === 'What it is for.',
            JSON.stringify(sentStore(env.calls).descriptions));
        });
      });
    });
  })

  // ── What lights Apply on a dialog nobody has touched ─────────────────────
  //
  // Reported live: Apply was enabled the moment the dialog opened, with nothing edited.
  .then(() => openDesc({
    library: withStore(Object.assign({}, STORE_TAG, {
      // An older release wrote this store, and it already carries every description this
      // dialog would seed - so there is genuinely nothing to write.
      description: blob({ version: '0.8.0', hideField: HIDE, descriptions: {
        colour: 'The colour it is filed under.',
        [HIDE]: 'Hides it from the add lists.',
      } }),
    })),
    settings: { b1DescriptionTagName: 'plumbing' },
  }))
  .then((env) => {
    h.check('a store stamped by an older release does not light Apply on its own',
      one(env.body, 'cfbe-apply').disabled === true,
      notes(env.body).join(' | '));
    // The restamp is not lost - it rides along with the next write that has a reason.
    pick(env.body, 'colour').click();
    type(env, 'Something new.');
    h.check('and a real edit still enables it', one(env.body, 'cfbe-apply').disabled === false);
    return press(env, 'cfbe-apply').then(() => {
      h.check('which stamps the store with this release on the way past',
        sentStore(env.calls).version === VERSION, JSON.stringify(sentStore(env.calls).version));
      h.check('and Apply goes quiet again', one(env.body, 'cfbe-apply').disabled === true);
      return env;
    });
  })

  .then(() => openDesc({
    // No store tag at all, and nothing that would be seeded into one: Apply would have
    // created a tag in the library to hold an empty store.
    library: withStore(null),
    settings: { c1ExcludeFromAddListField: '' },
  }))
  .then((env) => {
    h.check('and neither does having no store tag, with nothing to put in one',
      one(env.body, 'cfbe-apply').disabled === true, notes(env.body).join(' | '));
    h.check('no tag is written for it either', tagWrites(env.calls).length === 0);
    pick(env.body, 'colour').click();
    type(env, 'Worth keeping.');
    h.check('a description is what makes a store worth creating',
      one(env.body, 'cfbe-apply').disabled === false);
    return press(env, 'cfbe-apply').then(() => {
      h.check('and Apply then creates the tag',
        env.calls.some((c) => /CFBE_TagCreate/.test(c.query || '')),
        env.calls.map((c) => (c.query || '').slice(0, 22)).join(' | '));
      return env;
    });
  })

  .then(() => h.finish())
  .catch((e) => { console.error(e); process.exit(1); });
