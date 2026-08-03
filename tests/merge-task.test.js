// The library-wide task in MergePerformerTagsToScenes: that the click never
// reaches the server, that the review pass writes nothing, that a scene wanted by
// two performers is planned and written once with both their tags, and that the
// apply pass counts, isolates failures and stops when asked.
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
const TAGS = { 10: 'Blonde', 11: 'Tattoo' };
const tag = (id, sortName) => ({ id: id, name: TAGS[id], sort_name: sortName || null, ignore_auto_tag: false });
const PERFORMERS = [
  { id: '1', name: 'Ann', tags: [tag('10')] },
  { id: '2', name: 'Bea', tags: [tag('11')] },
  { id: '3', name: 'Cat', tags: [] },
];
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
    h.check('the review pass writes nothing', sceneUpdates(env.calls).length === 0);
    h.check('Proceed and Cancel are the review buttons',
      d().visible('Proceed') && d().visible('Cancel') && !d().visible('Stop') && !d().visible('Close'));
    h.check('Proceed is enabled once a plan exists', d().button('Proceed').disabled === false);
    h.check('the review lists what it would write, tag by tag',
      d().lines.some((l) => l.indexOf('Performer "Ann" (1) - Scene "S102" (102) - 1 tag(s): "Blonde" (10)') !== -1),
      d().lines.join(' | '));
    h.check('the review totals are reported',
      d().progress.indexOf('3 scene(s) to update') !== -1 &&
      d().progress.indexOf('3 tag assignment(s) to add') !== -1, d().progress);

    d().button('Proceed').click();
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
      h.check('each written scene is logged with the performers it came from',
        d().lines.some((l) => l.indexOf('[MERGE] Scene "S102" (102) - 1 tag(s) added - from Performer "Ann" (1)') === 0),
        d().lines.join(' | '));
      h.check('the totals are reported',
        d().progress.indexOf('3 scene(s) updated') !== -1 &&
        d().progress.indexOf('3 tag assignment(s) added') !== -1, d().progress);
      h.check('the run ends with Close and Rescan, not Proceed',
        d().visible('Close') && d().visible('Rescan') && !d().visible('Proceed'));
      // The plan predates the writes, so a finished run is not a settled library.
      h.check('and the closing line points at Rescan',
        d().lines.some((l) => l.indexOf('[INFO] Finished.') === 0 &&
          l.indexOf('Press Rescan to review what is left.') !== -1),
        d().lines.join(' | '));
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
    d().button('Proceed').click();
    return h.flush(200).then(() => {
      h.check('the run does not re-trigger auto-merge on its own writes',
        sceneUpdates(env.calls).length === 3, 'got ' + sceneUpdates(env.calls).length);
    });
  })

  // One failing scene must not cancel the performers after it.
  .then(() => open({ failScene: (req) => req.variables.input.id === '102' }))
    .then(({ env, d }) => {
      d().button('Proceed').click();
      return h.flush(200).then(() => {
        h.check('a failed scene is reported',
          d().lines.some((l) => l.indexOf('[ERROR]') === 0 && l.indexOf('(102) update failed') !== -1),
          d().lines.join(' | '));
        h.check('and the other scenes still run',
          sceneUpdates(env.calls).some((c) => c.variables.input.id === '103') &&
          sceneUpdates(env.calls).some((c) => c.variables.input.id === '104'));
        h.check('a scene that failed is not counted as merged',
          !d().lines.some((l) => l.indexOf('[MERGE] Scene "S102"') === 0), d().lines.join(' | '));
        h.check('the error count is reported', d().progress.indexOf('error(s)') !== -1, d().progress);
      });
    })

  // A scene featuring two performers is missing tags from both. It must be planned
  // and written ONCE with the union: two writes built from the same scan-time tag
  // list would have the second one drop what the first added.
  .then(() => {
    const shared = { id: '200', title: 'Shared', organized: false, tags: [] };
    return open({
      performers: [
        { id: '1', name: 'Ann', tags: [tag('10')] },
        { id: '2', name: 'Bea', tags: [tag('11')] },
      ],
      scenes: { 1: [shared], 2: [shared] },
    }).then(({ env, d }) => {
      h.check('a scene wanted by two performers is planned once',
        d().progress.indexOf('1 scene(s) to update') !== -1 &&
        d().progress.indexOf('2 tag assignment(s) to add') !== -1, d().progress);
      d().button('Proceed').click();
      return h.flush(200).then(() => {
        const writes = sceneUpdates(env.calls);
        h.check('and written once', writes.length === 1, 'wrote ' + writes.length);
        h.check('with both performers tags, neither dropping the other',
          writes[0].variables.input.tag_ids.indexOf('10') !== -1 &&
          writes[0].variables.input.tag_ids.indexOf('11') !== -1,
          JSON.stringify(writes[0].variables.input.tag_ids));
        h.check('and attributed to both performers',
          d().lines.some((l) => l.indexOf('from Performer "Ann" (1), "Bea" (2)') !== -1),
          d().lines.join(' | '));
      });
    });
  })

  // Stop is checked between performers, so what has been written stays written.
  // Pressed from the responder on the fifth write, which makes the moment it lands
  // deterministic rather than a function of how many ticks a flush happens to take.
  .then(() => {
    const many = [];
    for (let i = 1; i <= 40; i++) many.push({ id: String(i), name: 'P' + i, tags: [tag('10')] });
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
      d().button('Proceed').click();
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

  // ── The closing tag recap ────────────────────────────────────────────────
  //
  // Ordered the way Stash orders tags - COALESCE(sort_name, name) compared
  // case-insensitively and numerically - so the line reads against the tag list in
  // the UI. Zed leads on its sort_name, and Volume 2 precedes Volume 10.
  .then(() => {
    const T = { 20: 'Zed', 21: 'volume 10', 22: 'Volume 2' };
    const mk = (id, sortName) =>
      ({ id: id, name: T[id], sort_name: sortName || null, ignore_auto_tag: false });
    const performers = [
      { id: '1', name: 'Ann', tags: [mk('20', 'aaa'), mk('21'), mk('22')] },
    ];
    const scenes = {
      1: [{ id: '400', title: 'One', organized: false, tags: [] },
          { id: '401', title: 'Two', organized: false, tags: [{ id: '21' }, { id: '22' }] }],
    };
    return open({ performers: performers, scenes: scenes }).then(({ d }) => {
      const planned = d().lines[d().lines.length - 1];
      // Zed lands on both scenes; the other two only on the one missing them.
      h.check('the review ends with every tag it would add, per scene',
        planned === '[INFO] 3 tag(s) to add: "Zed" (20) x2, "Volume 2" (22) x1, "volume 10" (21) x1',
        planned);
      d().button('Proceed').click();
      return h.flush(200).then(() => {
        const applied = d().lines[d().lines.length - 1];
        h.check('and the apply ends with what was actually written',
          applied === '[INFO] 3 tag(s) added: "Zed" (20) x2, "Volume 2" (22) x1, "volume 10" (21) x1',
          applied);
      });
    });
  })

  // A failed scene must drop out of the applied recap without touching the planned one.
  .then(() => open({ failScene: (req) => req.variables.input.id === '104' }))
    .then(({ d }) => {
      d().button('Proceed').click();
      return h.flush(200).then(() => {
        const applied = d().lines[d().lines.length - 1];
        h.check('a failed scene is not counted in the recap',
          applied === '[INFO] 2 tag(s) added: "Blonde" (10) x1, "Tattoo" (11) x1', applied);
      });
    })

  // A library with nothing left to merge must say so rather than offering a Proceed
  // that would write nothing, and Rescan has to be able to find that state.
  .then(() => open({
    performers: [{ id: '1', name: 'Ann', tags: [tag('10')] }],
    scenes: { 1: [{ id: '300', title: 'Done', organized: false, tags: [{ id: '10' }] }] },
  })).then(({ env, d }) => {
    h.check('an empty plan disables Proceed', d().button('Proceed').disabled === true);
    h.check('an empty plan says so',
      d().lines.some((l) => l.indexOf('Nothing to merge') !== -1), d().lines.join(' | '));
    h.check('and writes nothing', sceneUpdates(env.calls).length === 0);
  })

  .then(() => open()).then(({ env, d }) => {
    d().button('Proceed').click();
    return h.flush(200).then(() => {
      const before = env.calls.length;
      d().button('Rescan').click();
      return h.flush(200).then(() => {
        h.check('Rescan re-reviews without closing the dialog',
          env.calls.length > before &&
          env.calls.slice(before).some((c) => /CPT2S_TaskPerformers/.test(c.query || '')) &&
          d().open);
        h.check('Rescan returns the dialog to the review state',
          d().visible('Proceed') && !d().visible('Close'));
        h.check('Rescan keeps the earlier log',
          d().lines.some((l) => l.indexOf('--- Rescan ---') !== -1), d().lines.join(' | '));
        // The fake server does not apply what it is told, so the second pass finds
        // the same three scenes - the point is that it finds three and not six.
        h.check('Rescan starts the plan over rather than adding to it',
          d().progress.indexOf('Review complete. 3 scene(s) to update') === 0, d().progress);
        h.check('and does not claim to be hiding lines it no longer has',
          d().progress.indexOf('showing the last') === -1, d().progress);
      });
    });
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
