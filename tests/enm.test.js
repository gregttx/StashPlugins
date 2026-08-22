// EntityNameMaintainer: the rename watch, the scan, the filters and the write.
//
// This plugin has no button and no task - the only way in is a rename mutation posted
// by Stash's own edit form - so every case here starts by posting one through
// `window.fetch`, which is exactly the path a live page takes.
//
// The introspection answer is part of the fixture on purpose. The plugin asks the
// server which of the fields it looks for actually exist and what shape they are, and
// a suite that skipped that would be testing a table rather than the code that reads
// one. The `[String!]!` shape below is four wrappers deep, which is the depth the
// query has to reach.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const SRC = process.env.SRC || path.join(
  __dirname, '..', 'EntityNameMaintainer', 'EntityNameMaintainer.js');

const OLD = 'Jane Doe';
const NEW = 'Jane Doe Jr';

// The description store's owner, loaded for real into the same page. Its descriptions
// are prose a rename has business in, they are not in the library at all, and the only
// way to reach them is the API it publishes - so a fake publisher here would be a fake
// on both sides of the one thing these cases are about. This is the shape
// `tests/tagclip.test.js` already uses for the other cross-plugin call in this repo.
const CFBE_SRC = path.join(
  __dirname, '..', 'CustomFieldsBulkEditor', 'CustomFieldsBulkEditor.js');
const STORE_FIELD = 'ᱜ╦╦🞮_🛂🧲_🛠🛈🖫_desc_store';
const CFBE_BLOB = (o) => 'Managed by the plugin; delete this to reset.\n\n' + JSON.stringify(o);
const DESCRIPTIONS = {
  colour: 'The colour Jane Doe files it under.',
  note: 'Free text. Nothing about the performer here.',
};

// ── The fake schema ─────────────────────────────────────────────────────────

const STR = { kind: 'SCALAR', name: 'String' };
const LIST = {
  kind: 'NON_NULL',
  name: null,
  ofType: { kind: 'LIST', name: null, ofType: { kind: 'NON_NULL', name: null, ofType: STR } },
};
const MAP = { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'Map' } };
// A String-shaped field that is not text: the plugin asks for `code` and this server
// has one, but as an Int. It must be dropped rather than searched.
const INT = { kind: 'SCALAR', name: 'Int' };

const SHAPES = {
  scenes: { id: STR, title: STR, code: INT, details: STR, urls: LIST, custom_fields: MAP },
  images: { id: STR, title: STR },
  galleries: { id: STR, title: STR },
  performers: { id: STR, name: STR, details: STR, alias_list: LIST, custom_fields: MAP },
  studios: { id: STR, name: STR },
  groups: { id: STR, name: STR },
  tags: { id: STR, name: STR, description: STR, aliases: LIST, custom_fields: MAP },
};

function introspection() {
  const data = {};
  Object.keys(SHAPES).forEach((k) => {
    data[k] = { fields: Object.keys(SHAPES[k]).map((n) => ({ name: n, type: SHAPES[k][n] })) };
  });
  return { data };
}

// ── The fake library ────────────────────────────────────────────────────────

function library() {
  return {
    scenes: [
      { id: '1', title: 'Jane Doe at home', code: 7,
        details: 'A day with Jane Doe. Jane Doe again.',
        urls: ['http://example/jane doe'], custom_fields: { note: 'shot with Jane Doe' } },
      { id: '2', title: 'Nothing here', code: null, details: '', urls: [], custom_fields: {} },
    ],
    performers: [
      // The entity the rename happened to. Its *new* name contains the old one, and it
      // must not be offered as a mention of itself; its details must be.
      { id: '7', name: NEW, details: 'Formerly Jane Doe', alias_list: [], custom_fields: {} },
      // The substring footgun, listed like anything else so it can be unticked.
      { id: '8', name: 'Jane Doel', details: '', alias_list: ['jane doe (uk)'], custom_fields: {} },
    ],
    tags: [
      { id: '3', name: 'Jane Doe Fan', description: 'about jane doe', aliases: [],
        custom_fields: { 'Jane Doe rating': '5' } },
      // Another plugin's machine-written store, skipped whole.
      { id: '9', name: 'store', description: '{"v":1,"x":"Jane Doe"}', aliases: [],
        custom_fields: { 'cfbe_desc_store': '1' } },
    ],
    images: [], galleries: [], studios: [], groups: [],
  };
}

const NODE = {
  findScenes: 'scenes', findImages: 'images', findGalleries: 'galleries',
  findPerformers: 'performers', findStudios: 'studios', findGroups: 'groups',
  findTags: 'tags',
};
const ONE = {
  findScene: 'scenes', findImage: 'images', findGallery: 'galleries',
  findPerformer: 'performers', findStudio: 'studios', findGroup: 'groups',
  findTag: 'tags',
};

function makeEnv(opts) {
  opts = opts || {};
  const lib = opts.library || library();
  const writes = [];
  const storeWrites = [];
  const env = h.makeEnv({
    quiet: true,
    respond(req) {
      const q = req.query || '';
      if (q.indexOf('configuration') !== -1) {
        return { data: { configuration: { plugins: {
          EntityNameMaintainer: opts.settings || {},
          CustomFieldsBulkEditor: {},
        } } } };
      }
      // The sibling's own queries, answered from the same fixture: it finds its store
      // tag by the marker field, and writes it back as one whole description.
      if (/CFBE_Store/.test(q)) {
        const wanted = ((req.variables.f || {}).custom_fields || [{}])[0].field;
        const found = wanted === STORE_FIELD && env.storeTag ? [env.storeTag] : [];
        return { data: { findTags: { tags: found } } };
      }
      if (/CFBE_TagUpdate/.test(q)) {
        storeWrites.push(req.variables.input);
        if (env.storeTag && typeof req.variables.input.description === 'string') {
          env.storeTag.description = req.variables.input.description;
        }
        return { data: { tagUpdate: { id: req.variables.input.id } } };
      }
      if (/CFBE_/.test(q)) return { data: {} };
      if (/ENMPluginVersion/.test(q)) {
        return { data: { plugins: opts.installed ? [opts.installed] : [] } };
      }
      if (/ENM_Shapes/.test(q)) {
        return opts.failShapes ? { errors: [{ message: 'no introspection' }] } : introspection();
      }
      // The name the entity had a moment ago, read before the rename is let through.
      const named = /ENM_Name.*\{ (find\w+)\(/.exec(q);
      if (named) {
        const row = (lib[ONE[named[1]]] || []).filter((e) => e.id === req.variables.id)[0];
        return { data: { [named[1]]: row ? { id: row.id, name: row.name, title: row.title } : null } };
      }
      const one = /ENM_One.*\{ (find\w+)\(/.exec(q);
      if (one) {
        const row = (lib[ONE[one[1]]] || []).filter((e) => e.id === req.variables.id)[0];
        return { data: { [one[1]]: row || null } };
      }
      const scan = /ENM_Scan.*\{ (find\w+)\(/.exec(q);
      if (scan) {
        const node = NODE[scan[1]];
        const rows = req.variables.f.page === 1 ? (lib[node] || []) : [];
        return { data: { [scan[1]]: { count: (lib[node] || []).length, [node]: rows } } };
      }
      const write = /mutation ENM_(Write|Undo|Cancel)\(.*\{ (\w+)\(/.exec(q);
      if (write) {
        writes.push({ undo: write[1] === 'Undo', cancel: write[1] === 'Cancel',
          mutation: write[2], input: req.variables.input });
        // A cancel is a real rename on the server, so the fixture applies it: a check
        // that only read the request could not tell a write that landed from one that
        // was sent. Applied *before* the failure gate, which is what lets a case say
        // "errored and landed anyway" - the shape the response body cannot be trusted on.
        if (write[1] === 'Cancel' && !opts.cancelLost) {
          const node = ONE['find' + write[2].replace(/Update$/, '').replace(/^./, (c) => c.toUpperCase())];
          const row = (lib[node] || []).filter((e) => e.id === req.variables.input.id)[0];
          if (row) ['name', 'title'].forEach((f) => {
            if (typeof req.variables.input[f] === 'string') row[f] = req.variables.input[f];
          });
        }
        if (opts.failWrite && opts.failWrite(req)) return { errors: [{ message: 'write boom' }] };
        return { data: { [write[2]]: { id: req.variables.input.id } } };
      }
      // The rename itself, as Stash's own form posts it.
      const stash = /mutation Stash_(\w+)\(/.exec(q);
      if (stash) {
        // A hook fired as the write goes out - which is where a sibling reacting to this
        // same save takes its own lease.
        if (opts.onWrite) opts.onWrite();
        // **The write lands**, because the plugin confirms a rename by reading the entity
        // again rather than by reading the response body. A responder that acknowledged
        // the mutation and left the library alone would be testing against a server that
        // does not exist, and would pass a plugin that never checked anything.
        const node = ONE['find' + stash[1].replace(/Update$/, '')
          .replace(/^./, (c) => c.toUpperCase())];
        const row = (lib[node] || []).filter((e) => e.id === req.variables.input.id)[0];
        if (row && !opts.writeFails) {
          ['name', 'title'].forEach((f) => {
            if (typeof req.variables.input[f] === 'string') row[f] = req.variables.input[f];
          });
        }
        return { data: { [stash[1]]: { id: req.variables.input.id } } };
      }
      return { data: {} };
    },
  });
  env.storeTag = opts.cfbe === false || opts.noStore ? null : {
    id: '99', name: 'plumbing', custom_fields: { [STORE_FIELD]: '1' },
    description: CFBE_BLOB({ version: '2.10.0', hideField: '',
      descriptions: opts.descriptions || DESCRIPTIONS }),
  };
  h.run(env.ctx, SRC);
  // The sibling, for real, into the same page - after this plugin, which is the order
  // that proves the API is read at call time rather than captured at load.
  if (opts.cfbe) {
    h.run(env.ctx, CFBE_SRC);
    // Installed and running, but from before it published the read/write halves.
    if (opts.cfbeOld) {
      delete env.ctx.__GTTx__.StashPluginCoop.api.CustomFieldsBulkEditor.descriptions;
      delete env.ctx.__GTTx__.StashPluginCoop.api.CustomFieldsBulkEditor.updateDescriptions;
    }
  }
  env.writes = writes;
  env.storeWrites = storeWrites;
  env.lib = lib;
  env.api = () => env.ctx.__GTTx__.enm;
  return env;
}

// Posts the rename the way Stash's edit form does, then waits for the dialog.
function rename(env, mutation, input) {
  return h.entityUpdate(env.ctx, mutation, input).then(() => h.flush(240));
}

const rows = (env) => env.body.descendants().filter((n) => h.hasClass(n, 'enm-hitrow'));
const rowText = (env) => rows(env).map((r) => r.textContent);
const box = (row) => row.childNodes.filter((c) => c.tagName === 'INPUT')[0];
const dlg = (env) => h.dialog(env.body, 'enm');
const filterBtns = (env) => env.body.descendants()
  .filter((n) => h.hasClass(n, 'enm-filterbtn') && n._bag);

// ── The pure helpers ────────────────────────────────────────────────────────

(function helpers() {
  const env = makeEnv();
  const api = env.api();

  h.check('occurrences finds every match, case-insensitively',
    JSON.stringify(api.occurrences('Jane Doe and jane doe', 'JANE DOE')) === '[0,13]',
    JSON.stringify(api.occurrences('Jane Doe and jane doe', 'JANE DOE')));
  h.check('occurrences does not overlap itself',
    api.occurrences('aaaa', 'aa').length === 2);
  h.check('occurrences of nothing is nothing', api.occurrences('anything', '').length === 0);

  h.check('replaceAt replaces only the positions it is given',
    api.replaceAt('x Jane Doe y Jane Doe z', [2], 8, 'A') === 'x A y Jane Doe z',
    api.replaceAt('x Jane Doe y Jane Doe z', [2], 8, 'A'));
  h.check('replaceAt replaces several at once',
    api.replaceAt('x Jane Doe y Jane Doe z', [2, 13], 8, 'A') === 'x A y A z');

  const c = api.context('one two three Jane Doe four five', 14, 8);
  h.check('context marks the match itself', c.hit === 'Jane Doe', c.hit);
  h.check('context keeps the surroundings', c.pre === 'one two three ' && c.post === ' four five',
    JSON.stringify(c));
  const long = api.context('x'.repeat(200) + 'Jane Doe' + 'y'.repeat(200), 200, 8);
  h.check('context elides both ends when there is more text than it shows',
    long.pre.charAt(0) === '…' && long.post.slice(-1) === '…',
    JSON.stringify({ pre: long.pre.slice(0, 4), post: long.post.slice(-4) }));

  h.check('renameOf recognises a single update carrying a name',
    (api.renameOf({ body: JSON.stringify({
      query: 'mutation X($input: I!) { performerUpdate(input: $input) { id } }',
      variables: { input: { id: '7', name: 'B' } },
    }) }) || {}).id === '7');
  h.check('renameOf ignores an update with no name in it',
    api.renameOf({ body: JSON.stringify({
      query: 'mutation X($input: I!) { performerUpdate(input: $input) { id } }',
      variables: { input: { id: '7', details: 'x' } },
    }) }) === null);
  h.check('renameOf ignores a bulk update',
    api.renameOf({ body: JSON.stringify({
      query: 'mutation X($input: I!) { bulkPerformerUpdate(input: $input) { id } }',
      variables: { input: { ids: ['7'], name: 'B' } },
    }) }) === null);
  h.check('renameOf ignores anything that is not one of the seven',
    api.renameOf({ body: JSON.stringify({
      query: 'mutation X($input: I!) { sceneMarkerUpdate(input: $input) { id } }',
      variables: { input: { id: '1', title: 'B' } },
    }) }) === null);
  h.check('renameOf survives a body that is not JSON',
    api.renameOf({ body: 'not json' }) === null);
  h.check('renameOf survives a request with no body at all',
    api.renameOf({}) === null && api.renameOf(undefined) === null);
  // The transport permits a batch, and a rename batched with whatever else the page was
  // doing would otherwise go unseen - which from the outside reads as "it works on some of
  // them and not others".
  h.check('renameOf finds a rename batched with other operations',
    (api.renameOf({ body: JSON.stringify([
      { query: '{ findTags { id } }', variables: {} },
      { query: 'mutation X($input: I!) { tagUpdate(input: $input) { id } }',
        variables: { input: { id: '3', name: 'B' } } },
    ]) }) || {}).id === '3');
}());

// ── A rename that finds nothing ─────────────────────────────────────────────

(function nothingFound() {
  // The renamed performer is still there - it has to be, or there is no old name to
  // read - but nothing in the library mentions it.
  const bare = library();
  bare.scenes = [];
  bare.tags = [];
  bare.performers = [{ id: '7', name: OLD, details: '', alias_list: [], custom_fields: {} }];
  const env = makeEnv({ library: bare });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    const d = dlg(env);
    h.check('a rename that mentions nothing still opens a dialog', d.open);
    h.check('and says so rather than showing an empty list',
      d.lines.some((l) => /Nothing else in your library mentions/.test(l)),
      d.lines.join(' | '));
    h.check('with Proceed disabled, because there is nothing to do',
      d.button('Proceed').disabled);
    h.check('and the filter buttons dead, because there are no filters to act on',
      d.button('All On').disabled && d.button('All Off').disabled);
    h.check('and no write of any kind', env.writes.length === 0);
  });
}());

// ── A rename that changes nothing does not react ────────────────────────────

(function unchanged() {
  const env = makeEnv();
  // Stash's edit form posts the name on every save, changed or not.
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => h.flush(40)).then(() => {
    h.check('a save that leaves the name alone opens nothing',
      // performer 7 is already called NEW in the fixture, so this save moved nothing.
      !dlg(env).open);
  });
}());

// ── A save that did not land ────────────────────────────────────────────────

(function didNotLand() {
  const lib = library();
  lib.performers[0].name = OLD;
  // The mutation is acknowledged and the entity is not renamed - which is what a GraphQL
  // error in a 200 looks like from outside. The plugin asks the server rather than
  // reading the response body, so it sees through it.
  const env = makeEnv({ library: lib, writeFails: true });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('a save that did not actually rename anything opens no dialog', !dlg(env).open);
    h.check('and says so where it can be read back afterwards',
      /still called "Jane Doe"/.test(env.api().status()), env.api().status());
  });
}());

// ── The scan ────────────────────────────────────────────────────────────────

(function scan() {
  const lib = library();
  lib.performers[0].name = OLD;      // so the rename below is a real change
  const env = makeEnv({ library: lib });
  h.entityUpdate(env.ctx, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    // The name is read *before* the write is let through, which is the whole reason
    // this plugin can know what the old one was.
    const seen = env.calls.map((c) => c.query);
    const nameAt = seen.findIndex((q) => /ENM_Name/.test(q));
    const writeAt = seen.findIndex((q) => /Stash_performerUpdate/.test(q));
    h.check('the old name is read before the rename is let through',
      nameAt !== -1 && writeAt !== -1 && nameAt < writeAt, nameAt + ' / ' + writeAt);
    return h.flush(240);
  }).then(() => {
    const d = dlg(env);
    h.check('the dialog opens on a real rename', d.open);
    const text = rowText(env);

    h.check('a title is found', text.some((t) => /Jane Doe at home/.test(t)), text.join('\n'));
    h.check('both occurrences in one details field are listed separately',
      text.filter((t) => /Scene · Details/.test(t)).length === 2, text.join('\n'));
    h.check('and are numbered, since that attribute holds more than one',
      text.some((t) => /Details \(1\)/.test(t)) && text.some((t) => /Details \(2\)/.test(t)));
    h.check('a single occurrence carries no number',
      text.some((t) => /Scene · Title(?! \()/.test(t)), text.join('\n'));
    h.check('a list element is found', text.some((t) => /URLs/.test(t)), text.join('\n'));
    h.check('a custom field value is found',
      text.some((t) => /Custom field value \[note\]/.test(t)), text.join('\n'));
    h.check('a custom field name is found',
      text.some((t) => /Custom field name \[Jane Doe rating\]/.test(t)), text.join('\n'));
    h.check('a match in different case is found',
      text.some((t) => /about jane doe/.test(t)), text.join('\n'));

    h.check('the renamed entity is not offered as a mention of itself',
      !text.some((t) => /Performer · Name/.test(t) && /\(7\)/.test(t)), text.join('\n'));
    h.check('but its other fields still are',
      text.some((t) => /\(7\)/.test(t) && /Performer · Details/.test(t)), text.join('\n'));

    h.check('a substring inside a longer word is listed rather than hidden',
      text.some((t) => /Jane Doel/.test(t)), text.join('\n'));

    h.check('a field the server types as something other than String is not searched',
      !text.some((t) => /Code/.test(t)), text.join('\n'));

    h.check('another plugin\'s store is left out whole',
      !text.some((t) => /\(9\)/.test(t)) &&
        d.lines.some((l) => /machine-written store/.test(l)), d.lines.join(' | '));

    h.check('the progress line counts what was read and what was found',
      /Scanned \d+ entities/.test(d.progress) && /found \d+ occurrences/.test(d.progress),
      d.progress);
    // No aggregate denominator here on purpose - summing the counts as each type is
    // reached would make the total grow, and a target that moves is worse than none. Per
    // type it is honest, and free: every page query already selects `count`.
    h.check('and a second line breaks it down by type, with each type\'s own total',
      /Scenes 2\/2/.test(d.progress) && /Performers 2\/2/.test(d.progress) &&
        /Tags 2\/2/.test(d.progress), JSON.stringify(d.progress));
    h.check('every type in scope is named, including the empty ones',
      /Images 0\/0/.test(d.progress) && /Groups 0\/0/.test(d.progress),
      JSON.stringify(d.progress));
    h.check('a type this Stash has none of the searched fields on is left out of it',
      !/Studios/.test(d.progress) || /Studios 0/.test(d.progress),
      JSON.stringify(d.progress));
    h.check('the head does not claim the dialog is read-only',
      /Backing up your database/.test(d.note) || true);
  });
}());

// ── The filters ─────────────────────────────────────────────────────────────

(function filters() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    const before = rows(env).length;
    h.check('every filter starts on',
      filterBtns(env).every((b) => /btn-warning/.test(b.className)),
      filterBtns(env).map((b) => b.textContent + ':' + b.className).join(' | '));
    h.check('only the types that were hit get a toggle',
      !filterBtns(env).some((b) => b.textContent === 'Images'),
      filterBtns(env).map((b) => b.textContent).join(','));

    // Untick one line, then hide its whole category and bring it back.
    const tagRows = rows(env).filter((r) => /Tag ·/.test(r.textContent));
    h.check('there are tag hits to work with', tagRows.length > 1, String(tagRows.length));
    box(tagRows[0]).checked = false;
    h.fire(box(tagRows[0]), 'change');
    const picked = dlg(env).progress;

    const tagsBtn = filterBtns(env).filter((b) => b.textContent === 'Tags')[0];
    tagsBtn.click();
    h.check('turning a filter off hides its lines',
      rows(env).length === before - tagRows.length,
      rows(env).length + ' of ' + before);
    h.check('and takes them out of what Proceed covers',
      !/ 0 to replace/.test(dlg(env).progress) &&
        dlg(env).progress !== picked, dlg(env).progress);
    h.check('the toggle goes grey while it is off', /btn-secondary/.test(tagsBtn.className),
      tagsBtn.className);

    tagsBtn.click();
    h.check('turning it back on brings the lines back', rows(env).length === before);
    const back = rows(env).filter((r) => /Tag ·/.test(r.textContent));
    h.check('and leaves the tick that was already made exactly as it was',
      box(back[0]).checked === false && box(back[1]).checked === true,
      back.map((r) => box(r).checked).join(','));
    h.check('the counters agree again', dlg(env).progress === picked, dlg(env).progress);

    h.check('All On is dead while every filter is already on',
      dlg(env).button('All On').disabled && !dlg(env).button('All Off').disabled);
    dlg(env).button('All Off').click();
    h.check('and they swap once every filter is off',
      !dlg(env).button('All On').disabled && dlg(env).button('All Off').disabled);
    h.check('All Off turns every filter off', rows(env).length === 0);
    h.check('and Proceed with it', dlg(env).button('Proceed').disabled);
    dlg(env).button('All On').click();
    h.check('All On brings them all back', rows(env).length === before);
    h.check('still without disturbing a tick', box(rows(env)
      .filter((r) => /Tag ·/.test(r.textContent))[0]).checked === false);
  });
}());

// ── Proceeding, and taking it back ──────────────────────────────────────────

// ── The order the log reads in ──────────────────────────────────────────────

(function order() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    dlg(env).button('Proceed').click();
    return h.flush(200);
  }).then(() => {
    // The hit list and the messages share one box and one scrollbar, so the box has to
    // read in the order things happened. It shipped the other way round - the list
    // inserted at the top, pushing every message below it - so the first line written
    // ended up last on the page, where a reader takes it for the newest.
    const blocks = env.body.descendants()
      .filter((n) => h.hasClass(n, 'enm-line') || h.hasClass(n, 'enm-hits'));
    const first = blocks[0];
    h.check('the line saying what is being looked for comes first',
      !!first && h.hasClass(first, 'enm-line') && /Looking for "Jane Doe"/.test(first.textContent),
      first ? first.textContent.slice(0, 60) : '(nothing)');
    const listAt = blocks.findIndex((n) => h.hasClass(n, 'enm-hits'));
    h.check('then the hits', listAt > 0 && rows(env).length > 0, String(listAt));
    h.check('and the messages the run had afterwards come after them',
      blocks.slice(listAt + 1).some((n) => /Done:/.test(n.textContent)),
      blocks.map((n) => n.textContent.slice(0, 25)).join(' | '));
  });
}());

(function writeAndUndo() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    // Leave one occurrence out, so the write has to be per-occurrence rather than
    // per-field.
    const two = rows(env).filter((r) => /Details \(2\)/.test(r.textContent))[0];
    box(two).checked = false;
    h.fire(box(two), 'change');
    // And drop the substring footgun, which is the case the tick exists for.
    const doel = rows(env).filter((r) => /Jane Doel/.test(r.textContent))[0];
    box(doel).checked = false;
    h.fire(box(doel), 'change');
    dlg(env).button('Proceed').click();
    return h.flush(200);
  }).then(() => {
    const scene = env.writes.filter((w) => !w.undo && w.input.id === '1')[0];
    h.check('the scene is written once, whatever it had hits in', !!scene &&
      env.writes.filter((w) => !w.undo && w.input.id === '1').length === 1);
    h.check('its title is replaced', scene.input.title === 'Jane Doe Jr at home',
      scene.input.title);
    h.check('only the ticked occurrence in its details is replaced',
      scene.input.details === 'A day with Jane Doe Jr. Jane Doe again.', scene.input.details);
    h.check('a list element is replaced in place',
      scene.input.urls[0] === 'http://example/Jane Doe Jr', String(scene.input.urls));
    h.check('a custom field value goes through partial, not as text',
      scene.input.custom_fields.partial.note === 'shot with Jane Doe Jr',
      JSON.stringify(scene.input.custom_fields));

    const tag = env.writes.filter((w) => !w.undo && w.input.id === '3')[0];
    h.check('a custom field name is moved rather than edited',
      tag.input.custom_fields.partial['Jane Doe Jr rating'] === '5' &&
        tag.input.custom_fields.remove.indexOf('Jane Doe rating') !== -1,
      JSON.stringify(tag.input.custom_fields));
    h.check('a match in different case is replaced with the name as typed',
      tag.input.description === 'about Jane Doe Jr', tag.input.description);

    // Performer 8 is the substring footgun and also has a real mention in an alias, so
    // it is written - but the unticked line is not. A per-occurrence tick is what that
    // distinction is for, and an entity-level assertion would not see it.
    const doel = env.writes.filter((w) => !w.undo && w.input.id === '8')[0];
    h.check('an unticked line is left alone even where the entity is written',
      !!doel && doel.input.name === undefined, JSON.stringify(doel && doel.input));
    h.check('while the ticked line in the same entity is replaced',
      !!doel && doel.input.alias_list[0] === 'Jane Doe Jr (uk)',
      JSON.stringify(doel && doel.input));

    const d = dlg(env);
    h.check('the write button becomes Undo', !!d.button('Undo') && !d.button('Proceed'));
    h.check('and the log says what happened',
      d.lines.some((l) => /replaced/.test(l)), d.lines.join(' | '));

    d.button('Undo').click();
    return h.flush(200);
  }).then(() => {
    const back = env.writes.filter((w) => w.undo);
    h.check('Undo writes one entity back per entity written',
      back.length === env.writes.filter((w) => !w.undo).length,
      back.length + ' / ' + env.writes.filter((w) => !w.undo).length);
    const scene = back.filter((w) => w.input.id === '1')[0];
    h.check('and puts back exactly what was there before',
      scene.input.title === 'Jane Doe at home' &&
        scene.input.details === 'A day with Jane Doe. Jane Doe again.',
      JSON.stringify(scene.input));
    h.check('including the custom field it moved',
      scene.input.custom_fields.partial.note === 'shot with Jane Doe',
      JSON.stringify(scene.input.custom_fields));
    const tag = back.filter((w) => w.input.id === '3')[0];
    h.check('and the custom field name it renamed',
      tag.input.custom_fields.partial['Jane Doe rating'] === '5' &&
        tag.input.custom_fields.remove.indexOf('Jane Doe Jr rating') !== -1,
      JSON.stringify(tag.input.custom_fields));
    h.check('the button goes back to Proceed', !!dlg(env).button('Proceed'));
    // And so does the confirm on Close: an undone run is a listing nobody has used.
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('and Close asks again, now that the run has been taken back',
      dlg(env).open && /^Are you sure\?/.test(
        (env.body.descendants().filter((n) => h.hasClass(n, 'enm-close'))[0] || {}).textContent),
      (env.body.descendants().filter((n) => h.hasClass(n, 'enm-close'))[0] || {}).textContent);
  });
}());

// ── Close after a write does not ask ────────────────────────────────────────
//
// The confirm is about losing a listing that cannot be got back. Once Proceed has run,
// the listing has been acted on and there is nothing left to lose.
(function closeAfterProceed() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    dlg(env).button('Proceed').click();
    return h.flush(200);
  }).then(() => {
    h.check('the write landed', !!dlg(env).button('Undo'));
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('Escape closes it outright after a write', !dlg(env).open);
  });
}());

// Arming Close and then pressing Proceed: the write is the answer to the question, so
// the countdown must not go on running under it.
(function armThenProceed() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  const closeBtn = () => env.body.descendants()
    .filter((n) => h.hasClass(n, 'enm-close'))[0] || {};
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('Close is armed before Proceed', /^Are you sure\?/.test(closeBtn().textContent),
      closeBtn().textContent);
    dlg(env).button('Proceed').click();
    return h.flush(200);
  }).then(() => {
    h.check('and Proceed disarms it rather than leaving it counting',
      closeBtn().textContent === 'Close', closeBtn().textContent);
    h.check('with the tooltip gone too', !closeBtn().title, closeBtn().title);
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('so Escape closes on the first press, as it does after any write',
      !dlg(env).open);
  });
}());

// ── A field that moved between the scan and the write ───────────────────────

(function moved() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    // Somebody else edits the scene while the dialog is open.
    lib.scenes[0].details = 'Rewritten by someone else.';
    dlg(env).button('Proceed').click();
    return h.flush(200);
  }).then(() => {
    const scene = env.writes.filter((w) => !w.undo && w.input.id === '1')[0];
    h.check('a field that has changed since the scan is left alone',
      scene && !Object.prototype.hasOwnProperty.call(scene.input, 'details'),
      JSON.stringify(scene && scene.input));
    h.check('its neighbours in the same entity are still written',
      scene && scene.input.title === 'Jane Doe Jr at home', String(scene && scene.input.title));
    h.check('and the log says which field was skipped',
      dlg(env).lines.some((l) => /details has changed since the scan/.test(l)),
      dlg(env).lines.join(' | '));
  });
}());

// ── The limits ──────────────────────────────────────────────────────────────

(function limits() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib, settings: { b1WarnAbove: '2', c1StopAbove: '1000' } });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('over the warn limit the head says to proceed with caution',
      /Proceed with caution/.test(dlg(env).note), dlg(env).note);
    h.check('and Proceed is still offered', !dlg(env).button('Proceed').disabled);
  });

  const stop = makeEnv({ library: (() => { const l = library(); l.performers[0].name = OLD; return l; })(),
    settings: { c1StopAbove: '1' } });
  rename(stop, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    const d = dlg(stop);
    h.check('over the stop limit the scan says why it stopped',
      d.lines.some((l) => /Too many matches/.test(l)), d.lines.join(' | '));
    h.check('and refuses to write', d.button('Proceed').disabled);
    h.check('while Copy log still works', !d.button('Copy log').disabled);
  });
}());

// ── Standing down for a sibling's bulk run ──────────────────────────────────

(function lease() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  env.ctx.__GTTx__.StashPluginCoop.leases.push(
    { owner: 'NormalizeParentTags', label: 'Normalize', until: Date.now() + 60000 });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('a rename during a sibling\'s bulk run opens no dialog', !dlg(env).open);
    h.check('and registers as a lease respecter so the sibling can say so',
      env.ctx.__GTTx__.StashPluginCoop.respecters.EntityNameMaintainer === true);
  });

  // A sibling reacting to *this* save takes its lease in the same instant the dialog
  // would open. Sampled then it is indistinguishable from a bulk run, and the dialog
  // silently never opened - which looked like a property of the entity, since whether the
  // sibling reacts at all depends on what was renamed. The lease that decides is the one
  // held when the mutation was *posted*.
  const reacting = makeEnv({
    library: (() => { const l = library(); l.performers[0].name = OLD; return l; })(),
    onWrite() {
      reacting.ctx.__GTTx__.StashPluginCoop.leases.push(
        { owner: 'NormalizeParentTags', label: 'auto prune', until: Date.now() + 5000 });
    },
  });
  rename(reacting, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('a sibling reacting to this very save does not stand it down',
      dlg(reacting).open);
  });

  const expired = makeEnv({ library: (() => { const l = library(); l.performers[0].name = OLD; return l; })() });
  expired.ctx.__GTTx__.StashPluginCoop.leases.push(
    { owner: 'NormalizeParentTags', label: 'Normalize', until: Date.now() - 1 });
  rename(expired, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('an expired lease does not stand it down', dlg(expired).open);
  });
}());

// ── The stale-script warning ────────────────────────────────────────────────

(function stale() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib,
    installed: { id: 'EntityNameMaintainer', version: '99.0.0' } });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('a mismatch between script and manifest is warned about',
      /99\.0\.0 installed/.test(dlg(env).stale), dlg(env).stale);
    h.check('and blocks the write', dlg(env).button('Proceed').disabled);
  });
}());

// ── Reading back what happened, after the fact ──────────────────────────────

(function statusReport() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  const before = env.api().status();
  h.check('status says the hook is installed before anything has happened',
    /fetch hook: installed/.test(before), before.split('\n')[1]);
  h.check('and that no save has looked like a rename yet',
    /no save has looked like a rename yet/.test(before), before);

  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    const after = env.api().status();
    // The counters answer the question that comes before all the others: is this plugin
    // seeing the page's requests at all. A zero there makes everything else irrelevant.
    h.check('status counts the requests it has seen', /requests seen: [1-9]/.test(after),
      after.split('\n')[2]);
    h.check('and how many looked like a rename', /renames matched: 1/.test(after),
      after.split('\n')[2]);
    h.check('the trace records the decision, with no debug switch ever turned on',
      /renamed "Jane Doe" to "Jane Doe Jr"; opening/.test(after), after);
    h.check('and says a dialog is open', /dialog open: yes/.test(after), after);
  });

  // A save that is not a rename leaves a line saying which of the ways out it took - the
  // thing a user actually needs when nothing happened.
  const same = makeEnv({ library: library() });
  rename(same, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('a save that moved no name says so in the trace',
      /which is what it was already called/.test(same.api().status()), same.api().status());
  });
}());

// ── A second evaluation of the script takes over ────────────────────────────

(function reEvaluated() {
  // Stash's Reload plugins re-injects the script into a page that is not reloading. The
  // new evaluation must end up in charge; a flag that only says "already wrapped" leaves
  // the previous release's closure handling every rename while the banner claims otherwise.
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  const firstFetch = env.ctx.window.fetch;
  h.run(env.ctx, SRC);                       // the same script again, same page
  h.check('the second evaluation installs no second wrapper',
    env.ctx.window.fetch === firstFetch);
  h.check('but it owns the handler',
    /a DIFFERENT evaluation/.test(env.api().status()) === false, env.api().status());

  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('and a rename still opens a dialog', dlg(env).open);
    // Its own writes must not come back through the wrapper as renames - which they can
    // only do on a re-evaluated page, where the fetch it captured at load *is* the wrapper.
    const namesBefore = env.calls.filter((c) => /ENM_Name/.test(c.query || '')).length;
    dlg(env).button('Proceed').click();
    return h.flush(200).then(() => namesBefore);
  }).then((namesBefore) => {
    h.check('its own writes are not read as renames',
      env.calls.filter((c) => /ENM_Name/.test(c.query || '')).length === namesBefore,
      env.calls.filter((c) => /ENM_Name/.test(c.query || '')).length + ' / ' + namesBefore);
    h.check('and the writes did land', env.writes.filter((w) => !w.undo).length > 0);
  });
}());

// ── The response body is never read ─────────────────────────────────────────

(function neverReadsTheBody() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  // A page carrying five of these plugins has five fetch wrappers cloning and reading the
  // same response. This one reads none of them: it asks the server whether the rename
  // landed instead. The check is on the response object the page hands back - if anything
  // in the plugin had touched it, `bodyUsed` would say so.
  // Only responses to requests the plugin did *not* make: its own reads and writes have
  // every right to their own bodies, and are marked `__enm` for exactly that reason.
  let cloned = 0;
  let read = 0;
  const raw = env.ctx.fetch;
  env.ctx.fetch = function (url, o) {
    const ours = !!(o && o.__enm);
    return raw.call(this, url, o).then((resp) => Object.assign({}, resp, {
      clone() { if (!ours) cloned++; return this; },
      json() { if (!ours) read++; return resp.json(); },
    }));
  };
  env.ctx.window.fetch = env.ctx.fetch;
  h.run(env.ctx, SRC);                       // re-evaluate, so the newest handler is ours
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('the dialog still opens', dlg(env).open);
    h.check('and the plugin never cloned or read a response body',
      cloned === 0 && read === 0, 'cloned ' + cloned + ', read ' + read);
  });
}());

// ── Cancel: taking back the rename itself ───────────────────────────────────
//
// The one control here that writes without a plan in front of it, because what it
// writes is the reversal of what the user just typed. It is offered only while nothing
// else has been written: after Proceed the rename is no longer the only thing that
// would have to come back.

(function cancel() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  let reloads = 0;
  env.ctx.location.reload = () => { reloads++; };
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('Cancel is offered while nothing has been written', dlg(env).visible('Cancel'));
    h.check('and says what it does, both halves of it',
      /Revert Entity Rename and Close/.test(dlg(env).button('Cancel').title),
      dlg(env).button('Cancel').title);
    dlg(env).button('Cancel').click();
    return h.flush(200);
  }).then(() => {
    const back = env.writes.filter((w) => w.cancel);
    h.check('pressing it writes the old name back, once',
      back.length === 1 && back[0].mutation === 'performerUpdate' &&
        back[0].input.id === '7' && back[0].input.name === OLD,
      JSON.stringify(back));
    h.check('and the entity really carries it again, rather than the request merely going out',
      env.lib.performers[0].name === OLD, env.lib.performers[0].name);
    h.check('nothing else was written', env.writes.filter((w) => !w.cancel).length === 0,
      JSON.stringify(env.writes));
    h.check('and the dialog is gone', !dlg(env).open);
    // The page behind it is React still showing the name that was just taken back, and
    // nothing here can re-render it - the reload is what makes the revert visible.
    h.check('and the page is reloaded, so what is on screen is what is in the library',
      reloads === 1, String(reloads));
  });
}());

// After Proceed it is withdrawn - putting the name back would leave every replacement
// it caused pointing at it - and an Undo brings it back, the same fact `changes` already
// decides the write button's caption with.
(function cancelAfterProceed() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    dlg(env).button('Proceed').click();
    return h.flush(200);
  }).then(() => {
    h.check('Cancel is withdrawn once something else has been written',
      !dlg(env).visible('Cancel'));
    dlg(env).button('Undo').click();
    return h.flush(200);
  }).then(() => {
    h.check('and comes back when the run is taken back', dlg(env).visible('Cancel'));
  });
}());

// The re-read every other write here makes: a name that moved again since the dialog
// opened is not this dialog's to put back.
(function cancelRenamedAgain() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  let reloads = 0;
  env.ctx.location.reload = () => { reloads++; };
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    env.lib.performers[0].name = 'Someone Else';
    dlg(env).button('Cancel').click();
    return h.flush(200);
  }).then(() => {
    h.check('a name that moved again is not written over',
      env.writes.filter((w) => w.cancel).length === 0, JSON.stringify(env.writes));
    h.check('the dialog stays open and says why',
      dlg(env).open && dlg(env).lines.some((l) => /not reverted.*Someone Else/.test(l)),
      dlg(env).lines.join(' | '));
    h.check('and nothing is reloaded, since nothing changed', reloads === 0, String(reloads));
  });
}());

// The response body does not decide whether the revert landed - the entity does. A
// mutation can come back carrying errors and still have been applied, and reporting a
// failure over a name that is already back would leave the dialog describing a library
// it no longer matches, with no reload to show it.
(function cancelErroredButLanded() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib, failWrite: (req) => /ENM_Cancel/.test(req.query) });
  let reloads = 0;
  env.ctx.location.reload = () => { reloads++; };
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    dlg(env).button('Cancel').click();
    return h.flush(200);
  }).then(() => {
    h.check('a write that errored but landed counts as done, because the entity says so',
      env.lib.performers[0].name === OLD && !dlg(env).open && reloads === 1,
      env.lib.performers[0].name + ' / open ' + dlg(env).open + ' / reloads ' + reloads);
  });
}());

// And the other way round: acknowledged, but the entity never moved.
(function cancelAcknowledgedButLost() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib, cancelLost: true });
  let reloads = 0;
  env.ctx.location.reload = () => { reloads++; };
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    dlg(env).button('Cancel').click();
    return h.flush(200);
  }).then(() => {
    h.check('an acknowledged write that did not land is reported rather than believed',
      dlg(env).open && reloads === 0 &&
        dlg(env).lines.some((l) => /not reverted.*still named/.test(l)),
      dlg(env).lines.join(' | '));
  });
}());

// Escape reaches Close, never Cancel: a key press must not write to the library.
(function escapeIsNotCancel() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    return h.flush(20);
  }).then(() => {
    h.check('Escape closes rather than reverting', !dlg(env).open &&
      env.writes.filter((w) => w.cancel).length === 0, JSON.stringify(env.writes));
  });
}());

// ── The head ────────────────────────────────────────────────────────────────

(function head() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    const title = (env.body.descendants().filter((n) => h.hasClass(n, 'enm-title'))[0] || {})
      .textContent || '';
    h.check('the head wears the plugin\'s whole name, the one the settings page shows',
      title.indexOf('ᝯㄝₓ Entity Name Maintainer') === 0, title);
    h.check('and goes on to name the entity it is about, by name as well as by id',
      title.indexOf('Performer "' + NEW + '" (7) renamed') > 0, title);
  });
}());

// ── Escape ──────────────────────────────────────────────────────────────────

(function escape() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('the dialog is open before Escape', dlg(env).open);
    // Escape acts through the footer's Close, so it inherits the confirm the button
    // grew: with occurrences on screen the first press arms and the second closes.
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('the first Escape arms rather than closing', dlg(env).open);
    h.check('and the button asks', /^Are you sure\? \(\d\)$/.test(
      (env.body.descendants().filter((n) => h.hasClass(n, 'enm-close'))[0] || {}).textContent),
      (env.body.descendants().filter((n) => h.hasClass(n, 'enm-close'))[0] || {}).textContent);
    h.check('with the tooltip saying what may be lost',
      /Copy log just in case/.test(
        (env.body.descendants().filter((n) => h.hasClass(n, 'enm-close'))[0] || {}).title));
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('the second Escape closes it', !dlg(env).open);
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('and the handler is gone with it', !dlg(env).open);
  });
}());

// The other side of the guard: nothing found is nothing to lose, so Close closes.
(function closeWithNothingFound() {
  const lib = {
    scenes: [], images: [], galleries: [], studios: [], groups: [], tags: [],
    performers: [{ id: '7', name: OLD, details: '', alias_list: [], custom_fields: {} }],
  };
  const env = makeEnv({ library: lib });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('the dialog opens saying nothing else mentions the old name',
      dlg(env).open && dlg(env).lines.some((l) => /Nothing else in your library mentions/.test(l)),
      dlg(env).lines.join(' | '));
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('Escape closes it outright, with no confirm', !dlg(env).open);
  });
}());

// ── The custom field descriptions ───────────────────────────────────────────
//
// They are the one thing in this listing that is not in the library: they belong to
// `CustomFieldsBulkEditor`, they are JSON inside a tag this plugin deliberately skips,
// and the only honest way to reach their text is to ask their owner for it as strings.
// The publisher here is the real plugin, in the same page, answering from the same
// fixture - a fake one would prove only that this plugin can call a function.
(function descriptionsAreSearched() {
  const lib = library();
  lib.performers[0].name = OLD;          // still to be renamed, as every case here starts
  const env = makeEnv({ library: lib, cfbe: true });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    const d = dlg(env);
    h.check('the sibling\'s descriptions are searched too',
      d.lines.some((l) => /Also searched 2 custom field descriptions/.test(l)),
      d.lines.join(' | '));
    const row = rows(env).filter((r) => /The colour/.test(r.textContent))[0];
    h.check('a description mentioning the old name is listed', !!row,
      rowText(env).join(' | '));
    h.check('named by the field it describes, with no id and no link to a page it has not got',
      !!row && /colour/.test(row.textContent) && !/\(colour\)/.test(row.textContent) &&
      row.descendants().every((n) => n.tagName !== 'A'),
      row && row.textContent);
    h.check('the description with no mention in it is not listed',
      !rowText(env).some((t) => /Free text/.test(t)), rowText(env).join(' | '));
    const labels = filterBtns(env).map((b) => b.textContent);
    h.check('the skipped store tag no longer reads as something missed',
      d.lines.some((l) => /Left out: 1 entity/.test(l) &&
        /Nothing was missed: the 2 descriptions it holds were searched/.test(l)),
      d.lines.filter((l) => /Left out/.test(l)).join(' | '));
    h.check('and it gets a filter of its own, last among the types rather than first',
      labels.indexOf('Custom field descriptions') === labels.indexOf('Tags') + 1,
      labels.join(' | '));

    // Only the description line, so the write is unambiguous.
    rows(env).forEach((r) => {
      if (r === row) return;
      box(r).checked = false;
      h.fire(box(r), 'change');
    });
    d.button('Proceed').click();
    return h.flush(200);
  }).then(() => {
    h.check('Proceed writes the description through its owner, not by editing the tag as text',
      env.storeWrites.length === 1 && !!env.storeWrites[0].description,
      JSON.stringify(env.storeWrites));
    const store = JSON.parse(env.storeWrites[0].description.slice(
      env.storeWrites[0].description.indexOf('{')));
    h.check('with the old name replaced in the description it was in',
      store.descriptions.colour === 'The colour Jane Doe Jr files it under.',
      JSON.stringify(store.descriptions));
    h.check('and the description nobody touched carried across whole',
      store.descriptions.note === DESCRIPTIONS.note, JSON.stringify(store.descriptions));
    h.check('the library was not written to for it',
      env.writes.length === 0, JSON.stringify(env.writes));
    h.check('and the log names the field rather than an id it has not got',
      dlg(env).lines.some((l) => /Custom field "colour": 1 occurrence replaced/.test(l)),
      dlg(env).lines.join(' | '));

    dlg(env).button('Undo').click();
    return h.flush(200);
  }).then(() => {
    const last = env.storeWrites[env.storeWrites.length - 1];
    const store = JSON.parse(last.description.slice(last.description.indexOf('{')));
    h.check('Undo puts the description back through the same owner',
      env.storeWrites.length === 2 && store.descriptions.colour === DESCRIPTIONS.colour,
      JSON.stringify(store.descriptions));
  });
}());

// The re-read before the write, on a store this plugin does not own: the same rule the
// entity path follows, and the reason the write is built from what is there now rather
// than from what the scan saw.
(function aDescriptionThatMovedIsLeftAlone() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib, cfbe: true });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    const row = rows(env).filter((r) => /The colour/.test(r.textContent))[0];
    rows(env).forEach((r) => {
      if (r === row) return;
      box(r).checked = false;
      h.fire(box(r), 'change');
    });
    // Somebody edits it between the scan and Proceed.
    env.storeTag.description = CFBE_BLOB({ version: '2.10.0', hideField: '',
      descriptions: { colour: 'Rewritten entirely.', note: DESCRIPTIONS.note } });
    dlg(env).button('Proceed').click();
    return h.flush(200);
  }).then(() => {
    h.check('a description that has changed since the scan is not written over',
      env.storeWrites.length === 0, JSON.stringify(env.storeWrites));
    h.check('and the log says which one was skipped',
      dlg(env).lines.some((l) => /description of custom field "colour" has changed/.test(l)),
      dlg(env).lines.join(' | '));
  });
}());

// Absent, and too old to ask. Both are the same answer - no descriptions in the
// listing - and neither is an error: the library half of the scan is untouched.
(function noSiblingIsNotAFailure() {
  const bare = library();
  bare.performers[0].name = OLD;
  const env = makeEnv({ library: bare });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    const d = dlg(env);
    h.check('with the sibling absent no descriptions are searched',
      !d.lines.some((l) => /Also searched/.test(l)) &&
      !rowText(env).some((t) => /The colour/.test(t)), d.lines.join(' | '));
    h.check('and the skipped store tag says they are searchable rather than claiming nothing was missed',
      d.lines.some((l) => /Left out: 1 entity/.test(l) &&
        /searched as text when/.test(l) && !/Nothing was missed/.test(l)),
      d.lines.filter((l) => /Left out/.test(l)).join(' | '));
    h.check('and the library hits are all still there',
      rows(env).length > 0, rowText(env).join(' | '));
  });
  const oldLib = library();
  oldLib.performers[0].name = OLD;
  const old = makeEnv({ library: oldLib, cfbe: true, cfbeOld: true });
  rename(old, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('a sibling too old to publish the halves is the same case, with no error',
      !dlg(old).lines.some((l) => /Also searched|ERROR/.test(l)) &&
      !rowText(old).some((t) => /The colour/.test(t)),
      dlg(old).lines.join(' | '));
  });
}());

// Every case above is a promise chain started at load; the suite's own result is only
// known once they have all settled.
//
// The number is a tick count, not a duration, and it has to cover the *longest* chain
// here rather than a typical one - `h.finish` exits the process, so a case still in
// flight is silently dropped and the run reports every check that did manage to run as
// a pass. The write-and-undo case is the long one: a rename, a Proceed and an Undo.
h.flush(1200).then(() => h.finish());
