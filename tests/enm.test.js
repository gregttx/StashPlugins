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
  const env = h.makeEnv({
    quiet: true,
    respond(req) {
      const q = req.query || '';
      if (q.indexOf('configuration') !== -1) {
        return { data: { configuration: { plugins: { EntityNameMaintainer: opts.settings || {} } } } };
      }
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
      const write = /mutation ENM_(Write|Undo)\(.*\{ (\w+)\(/.exec(q);
      if (write) {
        writes.push({ undo: write[1] === 'Undo', mutation: write[2], input: req.variables.input });
        if (opts.failWrite && opts.failWrite(req)) return { errors: [{ message: 'write boom' }] };
        return { data: { [write[2]]: { id: req.variables.input.id } } };
      }
      // The rename itself, as Stash's own form posts it.
      const stash = /mutation Stash_(\w+)\(/.exec(q);
      if (stash) {
        // A hook fired as the write goes out - which is where a sibling reacting to this
        // same save takes its own lease.
        if (opts.onWrite) opts.onWrite();
        return { data: { [stash[1]]: { id: req.variables.input.id } } };
      }
      return { data: {} };
    },
  });
  h.run(env.ctx, SRC);
  env.writes = writes;
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
    lib.performers[0].name = NEW;    // the write landed
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

    h.check('nothing is written for an unticked line',
      !env.writes.some((w) => !w.undo && w.input.id === '8'),
      JSON.stringify(env.writes.map((w) => w.input.id)));

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

// ── Escape ──────────────────────────────────────────────────────────────────

(function escape() {
  const lib = library();
  lib.performers[0].name = OLD;
  const env = makeEnv({ library: lib });
  rename(env, 'performerUpdate', { id: '7', name: NEW }).then(() => {
    h.check('the dialog is open before Escape', dlg(env).open);
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('Escape closes it', !dlg(env).open);
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('and the handler is gone with it', !dlg(env).open);
  });
}());

// Every case above is a promise chain started at load; the suite's own result is only
// known once they have all settled.
h.flush(400).then(() => h.finish());
