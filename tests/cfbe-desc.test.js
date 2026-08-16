// The description store in GTTx Custom Fields Bulk Editor: the second task, the tag
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

const PLUGIN_NAME = 'GTTx Custom Fields Bulk Editor';
const TASK = 'Manage Custom Field Descriptions...';
const BULK_TASK = 'Edit Custom Fields Across the Whole Library...';
const STORE_FIELD = 'cfbe_desc_store';
const HIDE = 'Exclude_from_add_list';

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
      const tags = (lib.tags || []).filter((t) => (t.custom_fields || {})[STORE_FIELD] != null);
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
const writes = (calls) => calls.filter((c) => /mutation CFBE_/.test(c.query || ''));
const tagWrites = (calls) => calls.filter((c) => /CFBE_Tag(Create|Update)/.test(c.query || ''));
// The blob out of whatever the last tag write sent, parsed the way the plugin parses it.
function sentStore(calls) {
  const last = tagWrites(calls).pop();
  if (!last) return null;
  const d = String(last.variables.input.description || '');
  return JSON.parse(d.slice(d.indexOf('{'), d.lastIndexOf('}') + 1));
}
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
      notes(env.body).some((l) => /Seeded a description for "Exclude_from_add_list"/.test(l)),
      notes(env.body).join(' | '));
    h.check('the footer is the siblings\' order',
      foot(env.body).join(' ') === 'Apply Cancel Copy log Rescan',
      foot(env.body).join(' '));
    return env;
  })

  // ── Picking a field, and writing one ──────────────────────────────────────
  .then((env) => {
    pick(env.body, 'colour').click();
    h.check('picking a field shows what carries it', /3 entities carry it/
      .test((one(env.body, 'cfbe-detail-head') || {}).textContent || ''),
    (one(env.body, 'cfbe-detail-head') || {}).textContent);
    h.check('with a line per entity, each linking to its own type',
      byClass(one(env.body, 'cfbe-users'), 'cfbe-pill-ent').map((p) => p.href).join(' ') ===
        '/scenes/1 /performers/1 /tags/1',
      byClass(one(env.body, 'cfbe-users'), 'cfbe-pill-ent').map((p) => p.href).join(' '));
    h.check('and the box holds the description it already has',
      one(env.body, 'cfbe-text').value === 'The colour it is filed under.',
      one(env.body, 'cfbe-text').value);

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
      h.check('and stamps the running version', sent.version === '0.8.0', sent.version);
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
        foot(env.body).join(' ') === 'Copy log Undo Rescan Close', foot(env.body).join(' '));
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
      h.check('under the name in the setting',
        call.variables.input.name === 'ᱜ╦╦🞮 🗃️🔌 🛂🧲 🛠🛈🖫 ❌∙', call.variables.input.name);
      h.check('the description opens with a sentence, not with the blob',
        /^[^{]{20,}/.test(call.variables.input.description),
        String(call.variables.input.description).slice(0, 40));
      h.check('and the blob in it parses', !!sentStore(env.calls));
      return env;
    });
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
    return press(env, 'cfbe-prune').then(() => press(env, 'cfbe-apply')).then(() => {
      const sent = sentStore(env.calls);
      h.check('Prune drops the descriptions nothing carries',
        !Object.prototype.hasOwnProperty.call(sent.descriptions, 'gone'),
        JSON.stringify(sent.descriptions));
      h.check('and keeps the ones something does',
        sent.descriptions.colour === 'The colour it is filed under.');
      return env;
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

  // ── The store tag stays out of the bulk dialog too ───────────────────────
  .then(() => openDesc({ task: BULK_TASK }))
  .then((env) => {
    const listed = byClass(env.body, 'cfbe-entry').map((n) => n.textContent).join(' | ');
    h.check('the bulk listing leaves the store tag out', !/plumbing/.test(listed), listed);
    h.check('and says where its custom fields went instead',
      notes(env.body).some((l) => /left out of this listing/.test(l)),
      notes(env.body).join(' | '));
    h.check('a field name in the listing carries its description as a tooltip',
      byClass(env.body, 'cfbe-pill-cf').some((p) =>
        /^The colour it is filed under\./.test(p.title || '')),
      byClass(env.body, 'cfbe-pill-cf').map((p) => p.title).join(' | '));
    h.check('and a value pill is not given one',
      !byClass(env.body, 'cfbe-pill-cf').some((p) =>
        p.textContent === 'blue' && /colour it is filed/.test(p.title || '')));
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
  .then(() => h.finish())
  .catch((e) => { console.error(e); process.exit(1); });
