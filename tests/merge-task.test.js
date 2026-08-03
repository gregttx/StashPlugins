// The library-wide task in MergePerformerTagsToScenes: that the click never
// reaches the server, that nothing is written until Start, and that the walk over
// every performer merges, counts, isolates failures and stops when asked.
//
// It runs on the NormalizeParentTags harness rather than harness.js, because that
// is the one with a DOM real enough to build a dialog and read it back. Only the
// source path and the plugin id differ.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const SRC = process.env.SRC || path.join(
  __dirname, '..', 'MergePerformerTagsToScenes', 'MergePerformerTagsToScenes.js');
const PLUGIN_ID = 'MergePerformerTagsToScenes';
const TASK = 'Merge Performer Tags into All Their Scenes';

// Two performers with one tag each, appearing in two scenes apiece. Scene 1 already
// carries Blonde, so only three of the four scene/performer pairs need writing.
const PERFORMERS = [
  { id: '1', name: 'Ann', tags: [{ id: '10' }] },
  { id: '2', name: 'Bea', tags: [{ id: '11' }] },
  { id: '3', name: 'Cat', tags: [] },
];
const TAGS = { 10: 'Blonde', 11: 'Tattoo' };
const SCENES = {
  1: [{ id: '101', title: 'S101', organized: false, tags: [{ id: '10' }] },
      { id: '102', title: 'S102', organized: false, tags: [] }],
  2: [{ id: '103', title: 'S103', organized: false, tags: [] },
      { id: '104', title: 'S104', organized: false, tags: [] }],
  3: [],
};

function makeResponder(opts) {
  opts = opts || {};
  const settings = Object.assign({ d1LogMergesToConsole: false }, opts.settings);
  return function (req) {
    const q = req.query || '';
    if (q.indexOf('configuration') !== -1) {
      return { data: { configuration: { plugins: { [PLUGIN_ID]: settings } } } };
    }
    if (/CPT2S_TaskPerformers|findPerformers/.test(q)) {
      const per = req.variables.per;
      const page = req.variables.page;
      const list = (opts.performers || PERFORMERS).slice((page - 1) * per, page * per);
      return { data: { findPerformers: { count: (opts.performers || PERFORMERS).length, performers: list } } };
    }
    if (/findPerformer\b/.test(q)) {
      const p = (opts.performers || PERFORMERS).filter((x) => x.id === req.variables.id)[0];
      const tags = (p ? p.tags : []).map((t) => ({ id: t.id, name: TAGS[t.id] || 'tag' + t.id }));
      return { data: { findPerformer: { tags } } };
    }
    if (/findScenes/.test(q)) {
      const pid = req.variables.scene_filter.performers.value[0];
      return { data: { findScenes: { scenes: (opts.scenes || SCENES)[pid] || [] } } };
    }
    if (/findTags/.test(q)) return { data: { findTags: { tags: [] } } };
    if (/sceneUpdate/.test(q)) {
      if (opts.failScene && opts.failScene(req)) return { errors: [{ message: 'nope' }] };
      return { data: { sceneUpdate: { id: req.variables.input.id } } };
    }
    return { data: {} };
  };
}

function open(opts) {
  const env = h.makeEnv({ quiet: true, respond: makeResponder(opts || {}) });
  h.run(env.ctx, SRC);
  h.startTask(env.ctx, TASK, PLUGIN_ID);
  return h.flush(150).then(() => ({ env, d: () => h.dialog(env.body, 'cpt2s') }));
}

const sceneUpdates = (calls) => calls.filter((c) => /sceneUpdate/.test(c.query || ''));
const merges = (d) => d().lines.filter((l) => l.indexOf('[MERGE]') === 0);

Promise.resolve()

  .then(() => open()).then(({ env, d }) => {
    h.check('the task click never reaches the server',
      !env.calls.some((c) => /runPluginTask/.test(c.query || '')));
    h.check('the dialog opens ready, not running',
      d().visible('Start') && d().visible('Cancel') && !d().visible('Stop') && !d().visible('Close'));
    h.check('nothing is written before Start', sceneUpdates(env.calls).length === 0);
    h.check('the dialog says what it will do',
      d().lines.some((l) => l.indexOf('Nothing is written until you press Start') !== -1),
      d().lines.join(' | '));

    d().button('Start').click();
    return h.flush(200).then(() => {
      // 4 scenes across two tagged performers, one of which already has the tag.
      h.check('every performer scene missing a tag is written',
        sceneUpdates(env.calls).length === 3, 'got ' + sceneUpdates(env.calls).length);
      h.check('a scene that already carries the tag is skipped',
        !sceneUpdates(env.calls).some((c) => c.variables.input.id === '101'),
        JSON.stringify(sceneUpdates(env.calls).map((c) => c.variables.input.id)));
      h.check('a performer with no tags costs no scene query',
        !env.calls.some((c) => /findScenes/.test(c.query || '') &&
          c.variables.scene_filter.performers.value[0] === '3'));
      h.check('each written scene is logged against its performer',
        merges(d).length === 3 &&
        merges(d).some((l) => l.indexOf('Performer "Ann" (1) - Scene "S102" (102) - 1 tag(s)') !== -1),
        merges(d).join(' | '));
      h.check('the totals are reported',
        d().progress.indexOf('3 scene(s) updated') !== -1 &&
        d().progress.indexOf('3 tag assignment(s) added') !== -1, d().progress);
      h.check('the run ends with Close, not Stop',
        d().visible('Close') && !d().visible('Stop') && !d().visible('Start'));
    });
  })

  .then(() => open()).then(({ env, d }) => {
    d().button('Cancel').click();
    return h.flush(50).then(() => {
      h.check('Cancel writes nothing', sceneUpdates(env.calls).length === 0);
      h.check('Cancel closes the dialog', !d().open);
    });
  })

  // The merge writes scenes through the same fetch wrapper that watches for user
  // edits. Without the guard around the run, every one of our own writes would
  // re-enter the merge.
  .then(() => open({ settings: { a3AutoMergeOnSceneUpdate: true } })).then(({ env, d }) => {
    d().button('Start').click();
    return h.flush(200).then(() => {
      h.check('the run does not re-trigger auto-merge on its own writes',
        sceneUpdates(env.calls).length === 3, 'got ' + sceneUpdates(env.calls).length);
    });
  })

  // One failing scene must not cancel the performers after it.
  .then(() => open({ failScene: (req) => req.variables.input.id === '102' }))
    .then(({ env, d }) => {
      d().button('Start').click();
      return h.flush(200).then(() => {
        h.check('a failed scene is reported',
          d().lines.some((l) => l.indexOf('[ERROR]') === 0 && l.indexOf('"Ann" (1)') !== -1),
          d().lines.join(' | '));
        h.check('and the other performers still run',
          sceneUpdates(env.calls).some((c) => c.variables.input.id === '103') &&
          sceneUpdates(env.calls).some((c) => c.variables.input.id === '104'));
        h.check('a scene that failed is not counted as merged',
          !merges(d).some((l) => l.indexOf('(102)') !== -1), merges(d).join(' | '));
        h.check('the error count is reported', d().progress.indexOf('error(s)') !== -1, d().progress);
      });
    })

  // Stop is checked between performers, so what has been written stays written.
  // Pressed from the responder on the fifth write, which makes the moment it lands
  // deterministic rather than a function of how many ticks a flush happens to take.
  .then(() => {
    const many = [];
    for (let i = 1; i <= 40; i++) many.push({ id: String(i), name: 'P' + i, tags: [{ id: '10' }] });
    const scenes = {};
    many.forEach((p) => { scenes[p.id] = [{ id: 'S' + p.id, title: 'T' + p.id, organized: false, tags: [] }]; });

    const inner = makeResponder({ performers: many, scenes: scenes });
    let writes = 0;
    let env;
    const respond = (req, calls) => {
      if (/sceneUpdate/.test(req.query || '') && ++writes === 5) {
        h.dialog(env.body, 'cpt2s').button('Stop').click();
      }
      return inner(req, calls);
    };
    env = h.makeEnv({ quiet: true, respond: respond });
    h.run(env.ctx, SRC);
    h.startTask(env.ctx, TASK, PLUGIN_ID);
    const d = () => h.dialog(env.body, 'cpt2s');
    return h.flush(150).then(() => {
      d().button('Start').click();
      return h.flush(400);
    }).then(() => {
      const written = sceneUpdates(env.calls).length;
      h.check('Stop halts the walk before every performer is visited',
        written >= 5 && written < 40, 'wrote ' + written);
      h.check('and what was written stays reported as written',
        d().progress.indexOf('stopped early') !== -1 &&
        d().progress.indexOf(written + ' scene(s) updated') !== -1, d().progress);
      h.check('Stop leaves the dialog closable', d().visible('Close') && !d().visible('Stop'));
    });
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
