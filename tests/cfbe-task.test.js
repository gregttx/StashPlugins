// The library-wide task in GTTx Custom Fields Bulk Editor: the button Stash renders
// in Settings - Tasks - Plugin Tasks, the click that never reaches the server, and the
// one dialog holding seven entity types at once.
//
// The selection dialog is covered by cfbe.test.js; this suite is about what changes
// when the run has no type of its own - every entity carrying the spec it came from,
// the write grouped per type, and the id-plus-type keying that a single-type run never
// needed because its ids could not collide.
//
// Runs on npt-harness.js, like every other dialog suite here.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const SRC = process.env.SRC || path.join(
  __dirname, '..', 'CustomFieldsBulkEditor', 'CustomFieldsBulkEditor.js');

const PLUGIN_NAME = 'GTTx Custom Fields Bulk Editor';
const TASK = 'Edit Custom Fields Across the Whole Library...';

// One library, two custom fields, and ids that repeat across types on purpose: scene 1
// and tag 1 are different entities, and every place that treats an id as a key has to
// know it.
const LIBRARY = {
  scenes: [{ id: '1', title: 'S1', custom_fields: { colour: 'blue' } },
           { id: '2', title: 'S2', custom_fields: {} }],
  images: [],
  galleries: [],
  performers: [{ id: '1', name: 'P1', custom_fields: { colour: 'red' } }],
  groups: [],
  studios: [{ id: '1', name: 'St1', custom_fields: {} }],
  tags: [{ id: '1', name: 'T1', custom_fields: { colour: 'green' } }],
};

// Stash's own Plugin Tasks panel: one SettingGroup per plugin, headed with the bare
// plugin name, one button per declared task. The second group declares a task by the
// same name, which is the case the heading check exists for.
function mountTasksPage(body, opts) {
  opts = opts || {};
  const mk = (heading, label) => {
    const group = h.makeElement('div');
    group.className = 'setting-group';
    const head = h.makeElement('div');
    head.className = 'setting';
    const h3 = h.makeElement('h3');
    h3.textContent = heading;
    head.appendChild(h3);
    group.appendChild(head);
    const row = h.makeElement('div');
    row.className = 'setting';
    const btn = h.makeElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = label;
    row.appendChild(btn);
    group.appendChild(row);
    body.appendChild(group);
    return { btn, group };
  };
  const ours = mk(opts.heading || PLUGIN_NAME, TASK);
  const theirs = mk('Some Other Plugin', TASK);
  return { ours: ours.btn, theirs: theirs.btn, ourGroup: ours.group };
}

function responder(opts) {
  opts = opts || {};
  const lib = opts.library || LIBRARY;
  return (req) => {
    const q = req.query || '';
    if (/CFBEPluginVersion/.test(q)) return { data: { plugins: [] } };
    if (/CFBE_ReadAll/.test(q)) {
      const type = /find(\w+)\(filter/.exec(q);
      const key = type ? type[1].toLowerCase() : null;
      if (opts.failType && key === opts.failType) return { errors: [{ message: 'read boom' }] };
      const data = {};
      data['find' + type[1]] = { [key]: JSON.parse(JSON.stringify(lib[key] || [])) };
      return { data };
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

const byClass = (body, cls) => body.descendants().filter((n) => h.hasClass(n, cls));
const one = (body, cls) => byClass(body, cls)[0] || null;
const lines = (body) => byClass(body, 'cfbe-entry').map((n) => n.textContent);
const writes = (calls) => calls.filter((c) => /mutation CFBE_/.test(c.query || ''));
const reads = (calls) => calls.filter((c) => /CFBE_ReadAll/.test(c.query || ''));

// Clicking the task button is a `document` click in capture phase, which is where the
// plugin listens: React's own handler is on a descendant of document and never runs.
function clickTask(env, btn) {
  let defaulted = false;
  let stopped = false;
  h.fire(env.ctx.document, 'click', {
    target: btn,
    preventDefault() { defaulted = true; },
    stopPropagation() { stopped = true; },
  });
  return h.flush().then(() => ({ defaulted, stopped }));
}

function openTask(opts) {
  const env = start(opts);
  const btns = mountTasksPage(env.body, opts);
  env.tick();
  return clickTask(env, btns.ours).then((ev) => {
    env.btns = btns;
    env.ev = ev;
    return env;
  });
}

// ── The button and the click ────────────────────────────────────────────────

openTask()
  .then((env) => {
    h.check('the task button opens the dialog', !!one(env.body, 'cfbe-modal'));
    h.check('the click is stopped before Stash can queue a job',
      env.ev.defaulted && env.ev.stopped);
    h.check('and nothing resembling a task run is sent to the server',
      !env.calls.some((c) => /runPluginTask/.test(c.query || '')),
      env.calls.map((c) => (c.query || '').slice(0, 30)).join(' | '));

    h.check('the head says the scope is the library, not a selection',
      /Whole library/.test((one(env.body, 'cfbe-title') || {}).textContent || ''),
      (one(env.body, 'cfbe-title') || {}).textContent);

    // One query per type, not one per entity and not one filtered query per page.
    h.check('every supported type is read, one query each', reads(env.calls).length === 7,
      String(reads(env.calls).length));
    h.check('and each asks for all of it in one round trip',
      reads(env.calls).every((c) => /per_page:\s*-1/.test(c.query || '')));
    h.check('the query and its result field are both the plural segment',
      /findGalleries\(filter[^)]*\)\s*{\s*galleries\s*{/.test(
        reads(env.calls).map((c) => c.query).join(' ')),
      reads(env.calls).map((c) => (c.query || '').slice(0, 60)).join(' | '));

    // Four entities carry a field between them, from three different types.
    const got = lines(env.body);
    h.check('the listing holds every type that has a field', got.length === 3, got.join(' | '));
    h.check('and each line names its own type, not the run\'s',
      /^Scene /.test(got[0]) && /^Performer /.test(got[1]) && /^Tag /.test(got[2]),
      got.join(' | '));
    h.check('an entity pill links to the right type for its own row',
      byClass(env.body, 'cfbe-pill-ent').map((a) => a.href).join(' ') ===
        '/scenes/1 /performers/1 /tags/1',
      byClass(env.body, 'cfbe-pill-ent').map((a) => a.href).join(' '));
    h.check('the counters count entities rather than one type',
      /5 entities read, 3 with custom fields/.test(
        (one(env.body, 'cfbe-progress') || {}).textContent || ''),
      (one(env.body, 'cfbe-progress') || {}).textContent);
    h.check('nothing is written by opening it', writes(env.calls).length === 0);
    return env;
  })

  // The write. Five types take a bulk mutation and two do not, so a run spanning both
  // has to group by type before it can chunk - an id alone does not say what to call.
  .then((env) => {
    one(env.body, 'cfbe-field-name').value = 'season';
    one(env.body, 'cfbe-field-value').value = '3';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => env);
  })
  .then((env) => {
    const w = writes(env.calls);
    const named = w.map((c) => /mutation CFBE_(\w+)/.exec(c.query)[1]);
    h.check('scenes go out as one bulk mutation',
      named.filter((n) => n === 'bulkSceneUpdate').length === 1, named.join(' | '));
    h.check('performers as their own',
      named.filter((n) => n === 'bulkPerformerUpdate').length === 1, named.join(' | '));
    h.check('and the two types with no bulk input go one entity at a time',
      named.filter((n) => n === 'studioUpdate').length === 1 &&
      named.filter((n) => n === 'tagUpdate').length === 1, named.join(' | '));
    h.check('no type is written with another type\'s mutation',
      w.every((c) => {
        const m = /mutation CFBE_(\w+)/.exec(c.query)[1];
        const ids = c.variables.input.ids || [c.variables.input.id];
        return /Scene/.test(m) ? ids.join() === '1,2' : ids.length === 1;
      }), JSON.stringify(w.map((c) => c.variables.input)));
    h.check('the change lines name each type', lines(env.body).length === 5 &&
      lines(env.body).some((l) => /^Added Tag /.test(l)),
      lines(env.body).join(' | '));
    return env;
  })

  // Undo groups by type as well as by previous value, for the same reason.
  .then((env) => {
    const before = writes(env.calls).length;
    one(env.body, 'cfbe-undo').click();
    one(env.body, 'cfbe-undo').click();
    return h.flush().then(() => {
      const undoWrites = writes(env.calls).slice(before);
      h.check('the undo reverses every type it wrote',
        undoWrites.length >= 4, String(undoWrites.length));
      h.check('and never sends one type\'s ids to another type\'s mutation',
        undoWrites.every((c) => {
          const m = /mutation CFBE_(\w+)/.exec(c.query)[1];
          const ids = c.variables.input.ids || [c.variables.input.id];
          return /Scene/.test(m) ? ids.every((id) => id === '1' || id === '2') : ids.length === 1;
        }), JSON.stringify(undoWrites.map((c) => c.variables.input)));
    });
  })

  // "Filtered list only" keys on type *and* id. Scene 1, performer 1 and tag 1 are
  // three entities sharing one id, so a filter leaving only the tag showing must not
  // carry the other two into the write with it.
  .then(() => openTask())
  .then((env) => {
    const valueFilter = one(env.body, 'cfbe-filter-value');
    valueFilter.value = 'green';
    h.fire(valueFilter, 'input');
    h.check('the filter leaves one line, from one type', lines(env.body).length === 1 &&
      /^Tag /.test(lines(env.body)[0]), lines(env.body).join(' | '));
    one(env.body, 'cfbe-scope').value = 'filtered';
    h.fire(one(env.body, 'cfbe-scope'), 'change');
    one(env.body, 'cfbe-field-name').value = 'season';
    one(env.body, 'cfbe-field-value').value = '3';
    h.fire(one(env.body, 'cfbe-field-name'), 'input');
    one(env.body, 'cfbe-apply').click();
    return h.flush().then(() => {
      const w = writes(env.calls);
      h.check('only the filtered type is written', w.length === 1 &&
        /tagUpdate/.test(w[0].query), w.map((c) => (c.query || '').slice(0, 40)).join(' | '));
      h.check('and the entity sharing its id in another type is untouched',
        !w.some((c) => /Scene|Performer/.test(c.query)),
        w.map((c) => (c.query || '').slice(0, 40)).join(' | '));
    });
  })

  // One type refusing its read must not take the other six with it, and must say so.
  .then(() => openTask({ failType: 'tags' }))
  .then((env) => {
    h.check('a type that fails to read is reported',
      byClass(env.body, 'cfbe-ERROR').some((n) => /Reading tags failed/.test(n.textContent)),
      byClass(env.body, 'cfbe-ERROR').map((n) => n.textContent).join(' | '));
    h.check('and the rest of the library still lists',
      lines(env.body).length === 2 && !lines(env.body).some((l) => /^Tag /.test(l)),
      lines(env.body).join(' | '));
  })

  // The button itself: ours amber, somebody else's identically labelled one left
  // alone, and a click on theirs ignored entirely.
  .then(() => {
    const env = start();
    const btns = mountTasksPage(env.body);
    env.tick();
    h.check('our task button is repainted amber',
      h.hasClass(btns.ours, 'btn-warning'), btns.ours.className);
    h.check('and no longer carries Stash\'s grey',
      !h.hasClass(btns.ours, 'btn-secondary'), btns.ours.className);
    h.check('it keeps the btn class it needs to look like a button',
      h.hasClass(btns.ours, 'btn'), btns.ours.className);
    h.check('a same-named task in another plugin\'s group is left alone',
      btns.theirs.className === 'btn btn-secondary', btns.theirs.className);
    const painted = btns.ours.className;
    env.tick();
    h.check('a second tick leaves the painted button untouched',
      btns.ours.className === painted, painted + ' -> ' + btns.ours.className);

    // The settings-page decoration must not reach this group. Both panels head their
    // group with the plugin name, so `ownSettingGroup` finds this one too - and the
    // README link it wanted to add lands in the heading box, which is the text
    // `ownTaskName` reads. One tick and the task button would stop being ours.
    h.check('the Tasks page group is left undecorated',
      !h.hasClass(btns.ourGroup, 'cfbe-own-group') &&
        !btns.ourGroup.descendants().some((n) => h.hasClass(n, 'cfbe-readme')),
      btns.ourGroup.className);
    h.check('and its heading still says only the plugin name',
      btns.ourGroup.querySelector('h3').textContent === PLUGIN_NAME,
      btns.ourGroup.querySelector('h3').textContent);
    return clickTask(env, btns.theirs).then((ev) => {
      h.check('and clicking it opens nothing of ours', !one(env.body, 'cfbe-modal'));
      h.check('nor is the click interfered with', !ev.defaulted && !ev.stopped);
    });
  })

  .then(() => h.finish(), (e) => { console.error(e); process.exit(1); });
