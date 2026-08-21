// FindEntitiesByTextContent: the task button, the search loop and the result buffer.
//
// The way in is Stash's own Plugin Tasks button, so the cases below build the group Stash
// renders - a `.setting-group` headed with the plugin name, holding a button captioned
// with the task - and click it, which is what proves `ownTaskName` as well as the dialog.
//
// The introspection answer is part of the fixture on purpose: the plugin asks the server
// which of the fields it looks for exist and what shape each is, so a suite that skipped
// it would be testing a table rather than the code that reads one. `[String!]!` is built
// at its full four wrappers, which is the depth the query has to reach.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const SRC = process.env.SRC || path.join(
  __dirname, '..', 'FindEntitiesByTextContent', 'FindEntitiesByTextContent.js');

const TASK = 'Find Entities by Text Content...';
const PLUGIN_NAME = 'ᝯㄝₓ Find Entities by Text Content';
const BUFFER = 200;          // must match RESULT_BUFFER in the plugin

// ── The fake schema ─────────────────────────────────────────────────────────

const STR = { kind: 'SCALAR', name: 'String' };
const LIST = {
  kind: 'NON_NULL',
  name: null,
  ofType: { kind: 'LIST', name: null, ofType: { kind: 'NON_NULL', name: null, ofType: STR } },
};
const MAP = { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'Map' } };
const INT = { kind: 'SCALAR', name: 'Int' };

const SHAPES = {
  scenes: { id: STR, title: STR, code: INT, details: STR, urls: LIST, custom_fields: MAP },
  images: { id: STR, title: STR },
  galleries: { id: STR, title: STR },
  performers: { id: STR, name: STR, details: STR, alias_list: LIST, custom_fields: MAP },
  studios: { id: STR, name: STR },
  // A type the running server has none of this plugin's text fields on, so the scan has
  // to skip it and say so rather than sending a selection set with nothing in it.
  groups: { id: STR },
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
      { id: '1', title: 'Beach day', code: 7, details: 'Filmed on the beach. Beach again.',
        urls: ['http://example/beach'], custom_fields: { location: 'beach hut', rating: 5 } },
      { id: '2', title: 'Nothing here', code: null, details: '', urls: [], custom_fields: {} },
    ],
    performers: [
      { id: '7', name: 'Sandy', details: 'Likes the BEACH', alias_list: [], custom_fields: {} },
    ],
    tags: [
      { id: '3', name: 'Outdoors', description: 'sea and sand', aliases: ['beachy'],
        custom_fields: { 'beach kit': 'towel' } },
    ],
    images: [], galleries: [], studios: [], groups: [],
  };
}

const NODE = {
  findScenes: 'scenes', findImages: 'images', findGalleries: 'galleries',
  findPerformers: 'performers', findStudios: 'studios', findGroups: 'groups',
  findTags: 'tags',
};

// The group Stash renders for a plugin task: a `.setting-group`, an `<h3>` with the
// plugin's name and version, and a button per task.
function taskGroup(env, name) {
  const group = env.ctx.document.createElement('div');
  group.className = 'setting-group';
  const head = env.ctx.document.createElement('h3');
  head.textContent = name;
  group.appendChild(head);
  const btn = env.ctx.document.createElement('button');
  btn.textContent = TASK;
  group.appendChild(btn);
  env.body.appendChild(group);
  return btn;
}

function makeEnv(opts) {
  opts = opts || {};
  const lib = opts.library || library();
  const env = h.makeEnv({
    quiet: true,
    clipboard: { writeText(t) { env.copied = t; return Promise.resolve(); } },
    localStorage: opts.localStorage,
    respond(req) {
      const q = req.query || '';
      if (q.indexOf('configuration') !== -1) {
        return { data: { configuration: { plugins: { FindEntitiesByTextContent: opts.settings || {} } } } };
      }
      if (/FETCPluginVersion/.test(q)) {
        return { data: { plugins: opts.installed ? [opts.installed] : [] } };
      }
      if (/FETC_Shapes/.test(q)) {
        return opts.failShapes ? { errors: [{ message: 'no introspection' }] } : introspection();
      }
      // The denominator, asked for once before the first page.
      if (/FETC_Counts/.test(q)) {
        if (opts.failCounts) return { errors: [{ message: 'no counts' }] };
        const out = {};
        (q.match(/(\w+): find\w+/g) || []).forEach((m) => {
          const k = m.split(':')[0];
          out[k] = { count: (lib[k] || []).length };
        });
        return { data: out };
      }
      const scan = /FETC_Scan.*\{ (find\w+)\(/.exec(q);
      if (scan) {
        if (opts.failFind === scan[1]) return { errors: [{ message: 'boom' }] };
        // A hook fired as each page is *asked for*, which is the only deterministic place
        // a test can press Pause: the search is between two round trips exactly there.
        if (opts.onPage) opts.onPage(scan[1], req.variables.f.page);
        const node = NODE[scan[1]];
        const all = lib[node] || [];
        const page = req.variables.f.page;
        const per = req.variables.f.per_page;
        return { data: { [scan[1]]: { count: all.length, [node]: all.slice((page - 1) * per, page * per) } } };
      }
      return { data: {} };
    },
  });
  h.run(env.ctx, SRC);
  env.lib = lib;
  env.api = () => env.ctx.__GTTx__.fetc;
  env.taskBtn = taskGroup(env, PLUGIN_NAME + ' (0.0.1)');
  return env;
}

const dlg = (env) => h.dialog(env.body, 'fetc');
// The head's amber line, which in this dialog carries the run's own warnings rather than
// the backup sentence a writing dialog puts there.
const warnText = (env) => (env.body.descendants()
  .filter((n) => h.hasClass(n, 'fetc-warn'))[0] || {}).textContent || '';
const run = (env) => env.api().dialog();
const results = (env) => env.body.descendants().filter((n) => h.hasClass(n, 'fetc-result'));
const typeBtn = (env, label) => env.body.descendants()
  .filter((n) => h.hasClass(n, 'fetc-filterbtn') && n.textContent === label)[0];
// The attribute row only holds names something has actually matched in.
const attrBtns = (env) => run(env).attrRow.childNodes
  .filter((n) => n._bag).map((n) => n.textContent);
const attrBtn = (env, label) => run(env).attrRow.childNodes
  .filter((n) => n._bag && n.textContent === label)[0];

// Opens the dialog the way a user does, then types and turns on the types named.
function open(env, text, types) {
  h.fire(env.ctx.document, 'click', { target: env.taskBtn });
  return h.flush(40).then(() => {
    if (text != null) {
      run(env).textInput.value = text;
      h.fire(run(env).textInput, 'input');
    }
    (types || []).forEach((t) => typeBtn(env, t).click());
    return env;
  });
}

const search = (env) => { dlg(env).button('Search').click(); return h.flush(200); };

// ── The pure halves ─────────────────────────────────────────────────────────

(function helpers() {
  const env = makeEnv();
  const api = env.api();

  h.check('occurrences finds every match, case-insensitively',
    JSON.stringify(api.occurrences('Beach and beach', 'BEACH')) === '[0,10]',
    JSON.stringify(api.occurrences('Beach and beach', 'BEACH')));
  h.check('occurrences of nothing is nothing', api.occurrences('anything', '').length === 0);

  const c = api.context('one two three beach four five', 14, 5);
  h.check('context marks the match and keeps the space either side',
    c.hit === 'beach' && c.pre === 'one two three ' && c.post === ' four five',
    JSON.stringify(c));

  const spec = { key: 'scenes', label: 'Scene' };
  const shapes = [{ name: 'title', kind: 'string' }, { name: 'details', kind: 'string' },
    { name: 'urls', kind: 'list' }, { name: 'custom_fields', kind: 'map' }];
  const hit = api.scanEntity(spec, shapes, {
    id: '1', title: 'Beach day', details: 'Filmed on the beach. Beach again.',
    urls: ['http://example/beach'], custom_fields: { location: 'beach hut', rating: 5 },
  }, 'beach');
  h.check('one entity is one result however many times it matched', !!hit && hit.id === '1');
  h.check('with every attribute it matched in, counted',
    JSON.stringify(hit.attrs.map((a) => [a.label, a.count])) === JSON.stringify([
      ['Title', 1], ['Details', 2], ['URLs', 1], ['Custom field value', 1],
    ]), JSON.stringify(hit.attrs.map((a) => [a.label, a.count])));
  // One context **per attribute**, not one for the whole result: a filter that hides
  // Title must not leave the line quoting the title it just hid.
  h.check('and the first match in each of them, with its surroundings',
    hit.attrs[0].ctx.hit === 'Beach' && hit.attrs[1].ctx.pre === 'Filmed on the ' &&
      hit.attrs[1].ctx.hit === 'beach', JSON.stringify(hit.attrs[1].ctx));
  h.check('a custom field holding something that is not a string is not searched',
    !hit.attrs.some((a) => a.label === 'Custom field name'), JSON.stringify(hit.attrs));
  h.check('an entity that matches nothing is not a result',
    api.scanEntity(spec, shapes, { id: '2', title: 'x', details: '', urls: [], custom_fields: {} },
      'beach') === null);
}());

// ── The task button ─────────────────────────────────────────────────────────

(function task() {
  const env = makeEnv();
  h.flush(4).then(() => {
    env.tick();
    h.check('the task button is painted teal, because nothing here writes',
      /btn-info/.test(env.taskBtn.className) && !/btn-warning/.test(env.taskBtn.className),
      env.taskBtn.className);
    // Another plugin declaring a task of the same name must not open ours.
    const other = taskGroup(env, 'Somebody Else (1.0.0)');
    h.fire(env.ctx.document, 'click', { target: other });
    return h.flush(20);
  }).then(() => {
    h.check('a task of the same name in another plugin\'s group opens nothing', !dlg(env).open);
    h.fire(env.ctx.document, 'click', { target: env.taskBtn });
    return h.flush(40);
  }).then(() => {
    h.check('our own task button opens the dialog', dlg(env).open);
    h.check('the head says nothing is written rather than telling anyone to back up',
      /Nothing here is written/.test(dlg(env).note) &&
        !/Backing up your database/.test(dlg(env).note), dlg(env).note);
    h.check('every entity type starts off',
      env.body.descendants().filter((n) => h.hasClass(n, 'fetc-filterbtn') && n._key)
        .every((b) => /btn-secondary/.test(b.className)));
    h.check('Search is disabled with an empty box', dlg(env).button('Search').disabled);
    h.check('All Off is dead when every type is already off, and All On is not',
      dlg(env).button('All Off').disabled && !dlg(env).button('All On').disabled);
    dlg(env).button('All On').click();
    h.check('and the two swap once every type is on',
      !dlg(env).button('All Off').disabled && dlg(env).button('All On').disabled);
  });
}());

// ── Search is refused until it has both halves ──────────────────────────────

(function refused() {
  const env = makeEnv();
  open(env, 'beach', []).then(() => {
    h.check('text with no type chosen does nothing', dlg(env).button('Search').disabled);
    h.check('and says which half is missing',
      /Turn on at least one entity type/.test(dlg(env).button('Search').title),
      dlg(env).button('Search').title);
    typeBtn(env, 'Scenes').click();
    h.check('a type turned on goes amber', /btn-warning/.test(typeBtn(env, 'Scenes').className),
      typeBtn(env, 'Scenes').className);
    h.check('and Search is offered', !dlg(env).button('Search').disabled);
    run(env).textInput.value = '   ';
    h.fire(run(env).textInput, 'input');
    h.check('a box holding only spaces is still empty', dlg(env).button('Search').disabled);
  });
}());

// ── A search ────────────────────────────────────────────────────────────────

(function searching() {
  const env = makeEnv();
  open(env, 'beach', ['Scenes', 'Performers', 'Tags', 'Groups'])
    .then(() => search(env))
    .then(() => {
      const text = results(env).map((r) => r.textContent);
      h.check('a matching scene is listed', text.some((t) => /Beach day \(1\)/.test(t)), text.join('\n'));
      h.check('with every attribute it matched in, and the counts',
        text.some((t) => /Title, Details ×2, URLs, Custom field value/.test(t)), text.join('\n'));
      h.check('a match in another case is found',
        text.some((t) => /Sandy \(7\)/.test(t)), text.join('\n'));
      h.check('a match in a list element is found',
        text.some((t) => /Outdoors \(3\)/.test(t) && /Aliases/.test(t)), text.join('\n'));
      h.check('a match in a custom field name is found',
        text.some((t) => /Outdoors \(3\)/.test(t) && /Custom field name/.test(t)), text.join('\n'));
      h.check('an entity matching nothing is not listed',
        !text.some((t) => /Nothing here/.test(t)), text.join('\n'));
      h.check('a field the server types as something other than String is not searched',
        !text.some((t) => /Code/.test(t)), text.join('\n'));

      const d = dlg(env);
      h.check('a type the server has none of these fields on is skipped and said so',
        d.lines.some((l) => /none of the text fields.*Groups/.test(l)), d.lines.join(' | '));
      h.check('the counters say what was read, out of how many, and what matched',
        /Scanned 4 of 4 entities/.test(d.progress) && /3 matches/.test(d.progress) &&
          /3 on screen/.test(d.progress), d.progress);
      h.check('the denominator covers only the types that were turned on',
        !/of 5 entities/.test(d.progress), d.progress);
      h.check('and that it finished', /finished/.test(d.progress), d.progress);
      h.check('the log says so too',
        d.lines.some((l) => /^\[INFO\] Finished: 3 entities mention "beach"/.test(l)),
        d.lines.join(' | '));
      h.check('the button goes back to Search', !!d.button('Search'));
      h.check('a type that was never turned on is never queried',
        !env.calls.some((c) => /findImages/.test(c.query || '')),
        env.calls.map((c) => (c.query || '').slice(0, 40)).join(' | '));
    });
}());

// ── The attribute filters ───────────────────────────────────────────────────

(function attributes() {
  const env = makeEnv();
  open(env, 'beach', ['Scenes', 'Performers', 'Tags'])
    .then(() => {
      h.check('there is no attribute row before anything has been found',
        h.hasClass(run(env).attrRow, 'fetc-hidden'), run(env).attrRow.className);
      return search(env);
    })
    .then(() => {
      // Only the names something matched in, which is the whole difference from the type
      // row: the types are what gets *read* and are known up front; the attributes are
      // what was *found* and cannot be.
      h.check('the row offers exactly the attributes that were hit',
        JSON.stringify(attrBtns(env).sort()) === JSON.stringify(
          ['Aliases', 'Custom field name', 'Custom field value', 'Details', 'Title', 'URLs']),
        attrBtns(env).join(', '));
      h.check('and not one for an attribute nothing matched in',
        attrBtns(env).indexOf('Synopsis') === -1, attrBtns(env).join(', '));
      h.check('every one of them starts on',
        run(env).attrRow.childNodes.filter((n) => n._bag)
          .every((b) => /btn-warning/.test(b.className)));

      const before = results(env).length;
      // The scene matched in four attributes; the performer only in Details.
      attrBtn(env, 'Details').click();
      const text = results(env).map((r) => r.textContent);
      h.check('turning an attribute off drops the entities that only matched there',
        results(env).length === before - 1 && !text.some((t) => /Sandy/.test(t)),
        text.join('\n'));
      h.check('but keeps the ones that also matched elsewhere',
        text.some((t) => /Beach day/.test(t)), text.join('\n'));
      h.check('and takes the chip off the line, so it does not claim a match it is hiding',
        text.some((t) => /Beach day/.test(t) && !/Details/.test(t)), text.join('\n'));

      attrBtn(env, 'Title').click();
      const t2 = results(env).map((r) => r.textContent);
      h.check('the line quotes the first attribute still showing, not the one hidden',
        t2.some((t) => /Beach day/.test(t) && /example/.test(t)), t2.join('\n'));

      attrBtn(env, 'Details').click();
      attrBtn(env, 'Title').click();
      h.check('turning them back on brings everything back',
        results(env).length === before, String(results(env).length));

      // Copy log honours the filters - a filter is a choice about what is being looked
      // at - while the buffer, which is not a choice, is not honoured.
      attrBtn(env, 'Details').click();
      dlg(env).button('Copy log').click();
      return h.flush(20).then(() => before);
    })
    .then(() => {
      h.check('Copy log leaves out what the attribute filters leave out',
        !/Sandy/.test(env.copied) && /Beach day/.test(env.copied), env.copied.slice(0, 200));
      h.check('and the line it does copy carries only the attributes still showing',
        !/Beach day.*Details/.test(env.copied), env.copied.slice(0, 200));

      // All On / All Off act on both rows, which is what "the filters" means to someone
      // looking at one block of buttons.
      dlg(env).button('All Off').click();
      h.check('All Off turns the attribute row off as well as the types',
        run(env).attrRow.childNodes.filter((n) => n._bag)
          .every((b) => /btn-secondary/.test(b.className)) &&
          !typeBtn(env, 'Scenes')._bag.scenes);
      h.check('and the list empties with them', results(env).length === 0);
      dlg(env).button('All On').click();
      h.check('All On brings both rows back', results(env).length > 0 &&
        run(env).attrRow.childNodes.filter((n) => n._bag)
          .every((b) => /btn-warning/.test(b.className)));

      // A fresh search knows of no attributes until it finds some.
      run(env).textInput.value = 'sandy';
      h.fire(run(env).textInput, 'input');
      dlg(env).button('Search').click();
      h.check('a new search starts with the attribute row empty again',
        attrBtns(env).length === 0 || attrBtns(env).join() === '', attrBtns(env).join(', '));
      return h.flush(200);
    })
    .then(() => {
      h.check('and fills it from what the new search found',
        JSON.stringify(attrBtns(env)) === JSON.stringify(['Name']), attrBtns(env).join(', '));
    });
}());

// ── Nothing found ───────────────────────────────────────────────────────────

(function nothing() {
  const env = makeEnv();
  open(env, 'zzzz', ['Scenes']).then(() => search(env)).then(() => {
    h.check('a search that matches nothing lists nothing', results(env).length === 0);
    h.check('and says so rather than leaving an empty box',
      dlg(env).lines.some((l) => /nothing in the 2 entities read mentions "zzzz"/.test(l)),
      dlg(env).lines.join(' | '));
  });
}());

// ── Pause, Resume and Refresh ───────────────────────────────────────────────

(function pausing() {
  // Three pages of scenes, only a few of which match - so the result buffer cannot end
  // the search before the pause does.
  const lib = library();
  lib.scenes = [];
  for (let i = 1; i <= 1200; i++) {
    lib.scenes.push({ id: String(i), title: (i % 500 === 3 ? 'beach ' : 'scene ') + i,
      code: null, details: '', urls: [], custom_fields: {} });
  }
  let pausedOnce = false;
  const env = makeEnv({ library: lib, onPage(find, page) {
    // Pressing Pause while the second page is in flight. Deterministic in a way a
    // `flush(n)` is not: the number of microtask hops a page costs is not this suite's
    // business, and a search that had already finished would leave no Pause to press.
    if (find !== 'findScenes' || page !== 2 || pausedOnce) return;
    pausedOnce = true;
    run(env).go();
  } });
  open(env, 'beach', ['Scenes']).then(() => {
    dlg(env).button('Search').click();
    h.check('the button reads Pause the moment the search starts', !!dlg(env).button('Pause'));
    h.check('and the text box is locked while it runs', run(env).textInput.disabled);
    return h.flush(80);
  }).then(() => {
    h.check('a pause stops it short of the whole library', run(env).scanned === 1000,
      String(run(env).scanned));
    h.check('the button reads Resume', !!dlg(env).button('Resume'));
    h.check('and the counters say paused', /paused/.test(dlg(env).progress), dlg(env).progress);
    h.check('the text box is editable again while paused', !run(env).textInput.disabled);
    h.check('what it found before the pause is on screen', results(env).length === 2,
      String(results(env).length));
    dlg(env).button('Resume').click();
    return h.flush(200);
  }).then(() => {
    h.check('Resume carries on from where it stopped rather than starting again',
      run(env).scanned === 1200, String(run(env).scanned));
    const pages = env.calls.filter((c) => /FETC_Scan.*findScenes/.test(c.query || '')).length;
    h.check('and reads each page exactly once', pages === 3, String(pages));
    h.check('the denominator was read once, before the first page',
      env.calls.filter((c) => /FETC_Counts/.test(c.query || '')).length === 1,
      String(env.calls.filter((c) => /FETC_Counts/.test(c.query || '')).length));
    h.check('finishing when the queue is empty', /finished/.test(dlg(env).progress),
      dlg(env).progress);
  });
}());

// ── The result buffer ───────────────────────────────────────────────────────

(function buffer() {
  const lib = library();
  lib.scenes = [];
  for (let i = 1; i <= 900; i++) {
    lib.scenes.push({ id: String(i), title: 'beach ' + i, code: null, details: '',
      urls: [], custom_fields: {} });
  }
  const env = makeEnv({ library: lib });
  open(env, 'beach', ['Scenes']).then(() => search(env)).then(() => {
    const d = dlg(env);
    h.check('a full list pauses the search itself', !!d.button('Continue'));
    h.check('the counters say why', /list full/.test(d.progress), d.progress);
    h.check('and the log says the results are still in Copy log',
      d.lines.some((l) => /Continue clears it and carries on/.test(l)), d.lines.join(' | '));
    h.check('the rows on screen are capped at the buffer exactly',
      results(env).length === BUFFER, String(results(env).length));
    const seen = run(env).results.length;
    d.button('Continue').click();
    return h.flush(300).then(() => seen);
  }).then((seen) => {
    h.check('Continue clears the screen and carries on',
      run(env).results.length > seen, run(env).results.length + ' / ' + seen);
    h.check('and keeps every result it ever found', run(env).results.length === 900,
      String(run(env).results.length));
    dlg(env).button('Copy log').click();
    return h.flush(20);
  }).then(() => {
    h.check('Copy log hands over every result, not only the ones on screen',
      (env.copied.match(/^Scene beach /gm) || []).length === 900,
      String((env.copied.match(/^Scene beach /gm) || []).length));
  });
}());

// ── Refresh ─────────────────────────────────────────────────────────────────

(function refresh() {
  const lib = library();
  lib.scenes = [];
  for (let i = 1; i <= 1200; i++) {
    lib.scenes.push({ id: String(i), title: (i % 500 === 3 ? 'beach ' : 'scene ') + i,
      code: null, details: '', urls: [], custom_fields: {} });
  }
  let pausedOnce = false;
  const env = makeEnv({ library: lib, onPage(find, page) {
    if (find !== 'findScenes' || page !== 2 || pausedOnce) return;
    pausedOnce = true;
    run(env).go();
  } });
  open(env, 'beach', ['Scenes']).then(() => {
    // Idle: the button beside it already says Search and would do the same thing.
    h.check('Refresh is not offered while the other button says Search',
      !dlg(env).visible('Refresh'));
    dlg(env).button('Search').click();
    return h.flush(80);
  }).then(() => {
    h.check('Refresh appears once the other button has become Resume',
      dlg(env).visible('Refresh') && !!dlg(env).button('Resume'));
    // A needle that is rare enough to finish rather than fill the list, so the state
    // after it is `done` and Refresh can be checked for going away again.
    run(env).textInput.value = 'beach 503';
    h.fire(run(env).textInput, 'input');
    dlg(env).button('Refresh').click();
    return h.flush(400);
  }).then(() => {
    const firstPages = env.calls
      .filter((c) => /FETC_Scan.*findScenes/.test(c.query || '') && c.variables.f.page === 1);
    h.check('Refresh starts the search over rather than carrying it on',
      firstPages.length === 2, String(firstPages.length));
    h.check('and reads the whole library this time', run(env).scanned === 1200,
      String(run(env).scanned));
    h.check('with the box as it now reads', run(env).needle === 'beach 503', run(env).needle);
    h.check('and says so in the log',
      dlg(env).lines.some((l) => /Searching again from the beginning/.test(l)),
      dlg(env).lines.join(' | '));
    h.check('and is gone again once the search is over',
      !dlg(env).visible('Refresh'), dlg(env).button('Refresh').className);
  });
}());

// ── What the dialog remembers ───────────────────────────────────────────────

(function remembering() {
  const env = makeEnv();
  open(env, 'beach', ['Scenes', 'Tags']).then(() => {
    h.check('nothing is remembered until it is asked for',
      !(env.storage.items['__GTTx__.fetcSearch'] || '').indexOf('"types":{"scenes"') > -1);
    run(env).persistBox.checked = true;
    h.fire(run(env).persistBox, 'change');
    const kept = JSON.parse(env.storage.items['__GTTx__.fetcSearch']);
    h.check('ticking Remember filters keeps the chosen types',
      kept.persist === true && kept.types.scenes && kept.types.tags && !kept.types.images,
      JSON.stringify(kept));

    run(env).historyInput.value = '3';
    h.fire(run(env).historyInput, 'change');
    return search(env);
  }).then(() => {
    const kept = JSON.parse(env.storage.items['__GTTx__.fetcSearch']);
    h.check('a search joins the history once the history keeps anything',
      kept.history.length === 1 && kept.history[0] === 'beach', JSON.stringify(kept.history));
    h.check('and is offered in the pulldown',
      run(env).recentEl.childNodes.some((o) => o.value === 'beach'),
      run(env).recentEl.childNodes.map((o) => o.value).join(','));

    // Newest first, no duplicates, and never more than the number asked for.
    ['sand', 'sea', 'sun', 'beach'].forEach((t) => run(env).remember(t));
    const now = JSON.parse(env.storage.items['__GTTx__.fetcSearch']).history;
    h.check('the history is newest first, capped, and holds no duplicate',
      JSON.stringify(now) === JSON.stringify(['beach', 'sun', 'sea']), JSON.stringify(now));

    run(env).historyInput.value = '0';
    h.fire(run(env).historyInput, 'change');
    const cleared = JSON.parse(env.storage.items['__GTTx__.fetcSearch']);
    h.check('setting the number to zero is what clears the list',
      cleared.history.length === 0 && cleared.historyMax === 0, JSON.stringify(cleared));
    h.check('and takes the pulldown off the page',
      h.hasClass(run(env).recentEl, 'fetc-hidden'), run(env).recentEl.className);
  });
}());

// A dialog opened with something already kept starts from it.
(function remembered() {
  const env = makeEnv({ localStorage: {
    '__GTTx__.fetcSearch': JSON.stringify({
      persist: true, types: { tags: true }, historyMax: 2, history: ['beach', 'sand'],
    }),
  } });
  open(env, null, []).then(() => {
    h.check('the remembered types come back on',
      /btn-warning/.test(typeBtn(env, 'Tags').className) &&
        /btn-secondary/.test(typeBtn(env, 'Scenes').className));
    h.check('the Remember filters box comes back ticked', run(env).persistBox.checked === true);
    h.check('and the remembered searches are in the pulldown',
      run(env).recentEl.childNodes.filter((o) => o.value).map((o) => o.value).join(',') ===
        'beach,sand',
      run(env).recentEl.childNodes.map((o) => o.value).join(','));
    // Choosing one fills the box, which is the whole point of keeping them.
    run(env).recentEl.value = 'sand';
    h.fire(run(env).recentEl, 'change');
    h.check('choosing one fills the search box', run(env).textInput.value === 'sand');
  });
}());

// ── The order the log reads in ──────────────────────────────────────────────

(function order() {
  const env = makeEnv();
  open(env, 'beach', ['Scenes', 'Groups']).then(() => search(env)).then(() => {
    // The listing and the messages share one box and one scrollbar, so the box has to
    // read in the order things happened. It shipped the other way round - the list
    // inserted at the top, pushing every message below it - so the first line written
    // ended up last on the page, where a reader takes it for the newest.
    const rows = env.body.descendants()
      .filter((n) => h.hasClass(n, 'fetc-line') || h.hasClass(n, 'fetc-results'));
    const first = rows[0];
    h.check('the line saying what is being looked for comes first',
      h.hasClass(first, 'fetc-line') && /Looking for "beach"/.test(first.textContent),
      first ? first.textContent.slice(0, 60) : '(nothing)');
    const listAt = rows.findIndex((n) => h.hasClass(n, 'fetc-results'));
    h.check('then the results',
      listAt > 0 && results(env).length > 0, String(listAt));
    h.check('and the messages the run had afterwards come after them',
      rows.slice(listAt + 1).some((n) => /Finished:/.test(n.textContent)),
      rows.map((n) => n.textContent.slice(0, 25)).join(' | '));
  });
}());

// ── A query that fails ──────────────────────────────────────────────────────

(function failing() {
  const env = makeEnv({ failFind: 'findScenes' });
  open(env, 'beach', ['Scenes']).then(() => search(env)).then(() => {
    h.check('a failed page is reported rather than swallowed',
      dlg(env).lines.some((l) => /The search failed/.test(l)), dlg(env).lines.join(' | '));
    h.check('and the dialog goes back to offering a search', !!dlg(env).button('Search'));
  });
}());

// ── A sibling's bulk run ────────────────────────────────────────────────────

(function lease() {
  const env = makeEnv();
  env.ctx.__GTTx__.StashPluginCoop.leases.push(
    { owner: 'NormalizeParentTags', label: 'Normalize', until: Date.now() + 60000 });
  open(env, 'beach', ['Scenes']).then(() => {
    h.check('a sibling\'s bulk run is noted in the head',
      /may be a moment behind/.test(warnText(env)), warnText(env));
    h.check('but the search is still offered - this plugin has nothing to stand down',
      !dlg(env).button('Search').disabled);
    h.check('and it registers on neither side of the lease protocol',
      !env.ctx.__GTTx__.StashPluginCoop.respecters.FindEntitiesByTextContent &&
        !env.ctx.__GTTx__.StashPluginCoop.declares.FindEntitiesByTextContent &&
        !env.ctx.__GTTx__.StashPluginCoop.order.FindEntitiesByTextContent);
    return search(env);
  }).then(() => {
    h.check('nor does it ever take one of its own',
      env.ctx.__GTTx__.StashPluginCoop.leases.length === 1);
    h.check('and it posts no mutation of any kind',
      !env.calls.some((c) => /mutation/.test(c.query || '')),
      env.calls.filter((c) => /mutation/.test(c.query || ''))
        .map((c) => (c.query || '').slice(0, 40)).join(' | '));
  });
}());

// ── The stale-script warning ────────────────────────────────────────────────

(function stale() {
  const env = makeEnv({ installed: { id: 'FindEntitiesByTextContent', version: '99.0.0' } });
  open(env, 'beach', ['Scenes']).then(() => {
    h.check('a mismatch between script and manifest is warned about',
      /99\.0\.0 installed/.test(dlg(env).stale), dlg(env).stale);
    h.check('and does not block a read', !dlg(env).button('Search').disabled);
  });
}());

// ── Escape ──────────────────────────────────────────────────────────────────

(function escape() {
  const env = makeEnv();
  open(env, 'beach', ['Scenes']).then(() => {
    h.check('the dialog is open before Escape', dlg(env).open);
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('Escape closes it', !dlg(env).open);
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('and the handler is gone with it', !dlg(env).open);
  });
}());

// Every case above is a promise chain started at load; the suite's own result is only
// known once they have all settled.
h.flush(1200).then(() => h.finish());
