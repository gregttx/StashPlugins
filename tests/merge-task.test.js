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
      const plugins = { [PLUGIN_ID]: settings };
      // Stash cannot scope this query to one plugin, so the sibling's settings
      // arrive in the same response - which is what checkSibling reads.
      if (opts.siblingSettings) plugins.NormalizeParentTags = opts.siblingSettings;
      return { data: { configuration: { plugins } } };
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
    // The recap's tooltips: aliases and descriptions for the tags the run moved,
    // fetched by id once the plan is known rather than during the performer walk.
    if (/CPT2STagDetail/.test(q)) {
      if (opts.failTagDetail) return { errors: [{ message: 'too expensive' }] };
      const want = req.variables.ids;
      return { data: { findTags: { tags: (opts.tagDetail || []).filter((t) => want.indexOf(t.id) !== -1) } } };
    }
    if (/findTags/.test(q)) return { data: { findTags: { tags: [] } } };
    // Undo's delta write. Matched ahead of the single-scene mutation even though the
    // two names do not actually collide, so the order cannot become load-bearing.
    if (/bulkSceneUpdate/.test(q)) {
      return { data: { bulkSceneUpdate: req.variables.input.ids.map((id) => ({ id })) } };
    }
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

// Same, but the bootstrap settings load is allowed to land before the task starts,
// because checkSibling reads what that call stored rather than reloading. `respecter`
// simulates a Normalize Parent Tags new enough to have registered itself at load.
function openAfterSettings(opts, respecter) {
  const env = h.makeEnv({ quiet: true, respond: makeResponder(opts || {}) });
  h.run(env.ctx, SRC);
  if (respecter) env.ctx.window.StashPluginCoop.respecters.NormalizeParentTags = true;
  return h.flush(20).then(() => {
    h.startTask(env.ctx, TASK, PLUGIN_ID);
    return h.flush(150).then(() => ({ env, d: () => h.dialog(env.body, 'cpt2s') }));
  });
}

// The forward merge writes one scene at a time; the undo goes out as a bulk delta.
// The two names do not overlap as substrings - bulkSceneUpdate capitalises the S -
// so a plain match on each is enough to tell them apart.
const sceneUpdates = (calls) => calls.filter((c) => /sceneUpdate/.test(c.query || ''));
const bulkSceneUpdates = (calls) => calls.filter((c) => /bulkSceneUpdate/.test(c.query || ''));
const merges = (d) => d().lines.filter((l) => l.indexOf('[MERGE]') === 0);
// The hoverable segments of a recap line: only the tags with something to say beyond
// the caption carry a title, and nothing else about the line changes.
const recapLine = (env, verb) => env.body.descendants().filter((n) => h.hasClass(n, 'cpt2s-line') &&
  n.textContent.indexOf('tag(s) ' + verb + ':') !== -1)[0] || null;
const recapSpans = (env, verb) => {
  const line = recapLine(env, verb);
  return line ? line.descendants() : [];
};
const recapTips = (env, verb) => recapSpans(env, verb).filter((n) => n.title)
  .map((n) => ({ text: n.textContent, title: n.title }));

Promise.resolve()

  .then(() => open()).then(({ env, d }) => {
    h.check('the task click never reaches the server',
      !env.calls.some((c) => /runPluginTask/.test(c.query || '')));
    h.check('the review pass writes nothing', sceneUpdates(env.calls).length === 0);
    h.check('Proceed and Cancel are the review buttons',
      d().visible('Proceed') && d().visible('Cancel') && !d().visible('Stop') && !d().visible('Close'));
    h.check('Proceed is enabled once a plan exists', d().button('Proceed').disabled === false);
    // Every name in those lines carries a bracketed id, and the closing recap puts
    // one beside a count. The head is where that notation gets explained.
    h.check('the head explains the ids in the log',
      d().legend.indexOf('Stash id') !== -1 && d().legend.indexOf('x250') !== -1, d().legend);
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

  // The recap is the one place the dialog enumerates tags, so it is where a tag can
  // say what it *is*. Hovering it names the aliases and description; the log lines
  // themselves stay plain text, which is what Copy log hands over.
  .then(() => open({ tagDetail: [
    { id: '10', name: 'Blonde', aliases: ['Blond', 'Blonde Hair'],
      description: 'Light hair,\n  natural or dyed.' },
    { id: '11', name: 'Tattoo', aliases: [], description: null },
  ] })).then(({ env, d }) => {
    const detail = env.calls.filter((c) => /CPT2STagDetail/.test(c.query || ''));
    h.check('the detail query is scoped to the tags the recap names',
      detail.length === 1 && detail[0].variables.ids.slice().sort().join() === '10,11',
      JSON.stringify(detail.map((c) => c.variables)));
    // Read defensively: a build that never issues the query must fail this check
    // rather than throw and take the rest of the suite down with it.
    const detailQuery = (detail[0] || {}).query || '';
    h.check('and asks for the two fields the walk does not',
      /aliases/.test(detailQuery) && /description/.test(detailQuery), detailQuery);
    // The walk reads every performer in the library; a description on that query
    // would be a paragraph per performer's tag list.
    h.check('the performer walk still asks for neither',
      !env.calls.some((c) => /TaskPerformers|findPerformers/.test(c.query || '') &&
        (/aliases/.test(c.query) || /description/.test(c.query))));

    const tips = recapTips(env, 'to add');
    h.check('the tag with aliases and a description hovers to them',
      tips.length === 1 && tips[0].text.indexOf('"Blonde" (10)') === 0 &&
      tips[0].title === 'Blonde\nStash tag id 10\nAliases: Blond, Blonde Hair\n' +
        'Description: Light hair, natural or dyed.', JSON.stringify(tips));
    // Nothing marks which tags hover, so a hover that opens has to say something the
    // line does not already.
    h.check('a tag with neither is left plain',
      !tips.some((t) => t.text.indexOf('Tattoo') !== -1), JSON.stringify(tips));
    // The spans exist to hang a title on. Styling them read as decoration in a log
    // that has none elsewhere, so the recap has to look like every other line.
    h.check('and the tags are not styled, only titled',
      recapSpans(env, 'to add').every((n) => !n.className),
      recapSpans(env, 'to add').map((n) => n.className).join('|'));
    h.check('and the line itself is unchanged as text',
      d().lines[d().lines.length - 1] ===
        '[INFO] 2 tag(s) to add: "Blonde" (10) x1, "Tattoo" (11) x2',
      d().lines[d().lines.length - 1]);
  })

  // A tooltip is worth a query, not a run: the recap must read the same when the
  // query fails, and must not spend an [ERROR] line on it.
  .then(() => open({ failTagDetail: true })).then(({ d }) => {
    const planned = d().lines[d().lines.length - 1];
    h.check('a failed detail query still leaves the recap',
      planned === '[INFO] 2 tag(s) to add: "Blonde" (10) x1, "Tattoo" (11) x2', planned);
    h.check('and says nothing about it',
      !d().lines.some((l) => l.indexOf('[ERROR]') === 0), d().lines.join(' | '));
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

  // ── The bulk-edit lease ──────────────────────────────────────────────────
  //
  // This run rewrites scenes across the whole library, which is the bulk side of
  // the protocol however it was started. Mirrors normalize-apply's coverage of the
  // sibling: nothing held during the review, one lease across the writes, released
  // whichever way the run ends.
  .then(() => {
    const seen = [];
    const inner = makeResponder();
    let env;
    env = h.makeEnv({
      quiet: true,
      respond: (req, calls) => {
        const held = ((env.ctx.window.StashPluginCoop || {}).leases || []);
        seen.push({
          write: /sceneUpdate/.test(req.query || ''),
          leases: held.length,
          owner: held.length ? held[0].owner : null,
          label: held.length ? held[0].label : null,
          until: held.length ? held[0].until : 0,
        });
        return inner(req, calls);
      },
    });
    h.run(env.ctx, SRC);
    h.startTask(env.ctx, TASK, PLUGIN_ID);
    const d = () => h.dialog(env.body, 'cpt2s');
    return h.flush(150).then(() => {
      h.check('no lease is held during the review pass',
        seen.every((s) => s.leases === 0), JSON.stringify(seen.slice(0, 3)));
      d().button('Proceed').click();
      return h.flush(200).then(() => {
        const writes = seen.filter((s) => s.write);
        h.check('a lease is held while writing',
          writes.length === 3 && writes.every((s) => s.leases === 1),
          JSON.stringify(writes));
        h.check('the lease names its owner and task, and expires',
          writes.every((s) => s.owner === PLUGIN_ID && s.label === TASK && s.until > Date.now()),
          JSON.stringify(writes[0]));
        h.check('the lease is released when the run finishes',
          (env.ctx.window.StashPluginCoop.leases || []).length === 0);
      });
    });
  })

  // Stop is the path an error-free run cannot reach, and the one most likely to
  // leave a lease latched.
  .then(() => {
    const many = [];
    for (let i = 1; i <= 40; i++) many.push({ id: String(i), name: 'P' + i, tags: [tag('10')] });
    const scenes = {};
    many.forEach((p) => { scenes[p.id] = [{ id: 'S' + p.id, title: 'T' + p.id, organized: false, tags: [] }]; });

    const inner = makeResponder({ performers: many, scenes: scenes });
    let writes = 0;
    let env;
    const respond = (req, calls) => {
      if (/sceneUpdate/.test(req.query || '') && ++writes === 3) {
        h.dialog(env.body, 'cpt2s').button('Stop').click();
      }
      return inner(req, calls);
    };
    env = h.makeEnv({ quiet: true, respond: respond });
    h.run(env.ctx, SRC);
    h.startTask(env.ctx, TASK, PLUGIN_ID);
    return h.flush(150).then(() => {
      h.dialog(env.body, 'cpt2s').button('Proceed').click();
      return h.flush(400);
    }).then(() => {
      h.check('a stopped run releases its lease too',
        (env.ctx.window.StashPluginCoop.leases || []).length === 0);
    });
  })

  // ── Undo ─────────────────────────────────────────────────────────────────
  //
  // The one place this plugin removes a tag. The apply writes each scene's whole tag
  // list because it is building one; the undo must not, or it would revert whatever
  // else changed since - so it goes out as a REMOVE delta, grouped and chunked.
  .then(() => open()).then(({ env, d }) => {
    h.check('nothing to undo before anything is written', !d().visible('Undo'));
    d().button('Proceed').click();
    return h.flush(200).then(() => {
      h.check('Undo is offered once the merge has written',
        d().visible('Undo') && sceneUpdates(env.calls).length === 3);

      d().button('Undo').click();
      return h.flush(5).then(() => {
        h.check('the first click only arms, naming the scope',
          bulkSceneUpdates(env.calls).length === 0 && d().visible('Undo 3 scene(s)?'),
          'armed caption wrong');

        d().button('Undo 3 scene(s)?').click();
        return h.flush(200).then(() => {
          const undo = bulkSceneUpdates(env.calls);
          h.check('the undo goes out as a delta, not a rewritten tag list',
            undo.length > 0 && undo.every((c) => c.variables.input.tag_ids.mode === 'REMOVE'),
            JSON.stringify(undo.map((c) => c.variables.input.tag_ids)));
          const scenes = undo.reduce((n, c) => n + c.variables.input.ids.length, 0);
          h.check('covering every scene the merge wrote', scenes === 3, 'got ' + scenes);
          // Scenes 102 and 103 got one tag each from different performers, 104 the
          // other - identical deltas group, so this is fewer requests than scenes.
          h.check('scenes sharing a delta are grouped into one request', undo.length === 2,
            'got ' + undo.length);
          h.check('the log records the reversal',
            d().lines.some((l) => l.indexOf('[MERGE] Undo - Scene ') === 0),
            d().lines.join(' | ').slice(-300));
          h.check('and the closing line says everything was taken back',
            d().lines.some((l) => l.indexOf('Everything this dialog added has been taken back') !== -1),
            d().lines.join(' | ').slice(-200));
          h.check('Undo disappears once there is nothing left to reverse', !d().visible('Undo'));
        });
      });
    });
  })

  // bulkSceneUpdate is exactly what this plugin's own auto-merge watches for, so an
  // unguarded undo would merge the tags straight back in.
  .then(() => open({ settings: { a3AutoMergeOnSceneUpdate: true } })).then(({ env, d }) => {
    d().button('Proceed').click();
    return h.flush(200).then(() => {
      const before = env.calls.filter((c) => /FindScene\(/.test(c.query || '')).length;
      d().button('Undo').click();
      return h.flush(5).then(() => {
        d().button('Undo 3 scene(s)?').click();
        return h.flush(200).then(() => {
          const after = env.calls.filter((c) => /FindScene\(/.test(c.query || '')).length;
          h.check('the undo does not re-enter its own auto-merge', after === before,
            before + ' -> ' + after);
        });
      });
    });
  })

  // A scene the server refused was never merged, so it must not be reversed either.
  .then(() => {
    const inner = makeResponder();
    let seen = 0;
    const env = h.makeEnv({
      quiet: true,
      respond: (req, calls) => {
        if (/sceneUpdate/.test(req.query || '') && !/bulkSceneUpdate/.test(req.query || '')) {
          if (++seen === 2) return { errors: [{ message: 'nope' }] };
        }
        return inner(req, calls);
      },
    });
    h.run(env.ctx, SRC);
    h.startTask(env.ctx, TASK, PLUGIN_ID);
    const d = () => h.dialog(env.body, 'cpt2s');
    return h.flush(150).then(() => {
      d().button('Proceed').click();
      return h.flush(200).then(() => {
        d().button('Undo').click();
        return h.flush(5).then(() => {
          h.check('a failed scene drops out of what Undo offers',
            d().visible('Undo 2 scene(s)?'), 'armed caption wrong');
          d().button('Undo 2 scene(s)?').click();
          return h.flush(200).then(() => {
            const scenes = bulkSceneUpdates(env.calls)
              .reduce((n, c) => n + c.variables.input.ids.length, 0);
            h.check('and the undo reverses only the scenes that landed', scenes === 2,
              'got ' + scenes);
          });
        });
      });
    });
  })

  // The lease covers the undo too: it is a bulk write like any other.
  .then(() => {
    const seen = [];
    const inner = makeResponder();
    let env;
    env = h.makeEnv({
      quiet: true,
      respond: (req, calls) => {
        const held = ((env.ctx.window.StashPluginCoop || {}).leases || []);
        seen.push({
          undo: /bulkSceneUpdate/.test(req.query || ''),
          leases: held.length,
          label: held.length ? held[0].label : null,
        });
        return inner(req, calls);
      },
    });
    h.run(env.ctx, SRC);
    h.startTask(env.ctx, TASK, PLUGIN_ID);
    const d = () => h.dialog(env.body, 'cpt2s');
    return h.flush(150).then(() => {
      d().button('Proceed').click();
      return h.flush(200).then(() => {
        d().button('Undo').click();
        return h.flush(5).then(() => {
          d().button('Undo 3 scene(s)?').click();
          return h.flush(200).then(() => {
            const during = seen.filter((s) => s.undo);
            h.check('a lease is held across the undo',
              during.length === 2 && during.every((s) => s.leases === 1), JSON.stringify(during));
            h.check('and it names itself as an undo',
              during.every((s) => s.label === TASK + ' (undo)'), JSON.stringify(during[0]));
            h.check('released when the undo finishes',
              (env.ctx.window.StashPluginCoop.leases || []).length === 0);
          });
        });
      });
    });
  })

  // Rescan starts a pass, not a session.
  .then(() => open()).then(({ d }) => {
    d().button('Proceed').click();
    return h.flush(200).then(() => {
      d().button('Rescan').click();
      return h.flush(200).then(() => {
        h.check('a rescan keeps what Undo can still reverse',
          d().visible('Undo') && d().visible('Proceed'));
      });
    });
  })

  // ── The sibling's reactive modes ──────────────────────────────────────────
  //
  // The mirror of NormalizeParentTags' own warning about our auto-merge flags.

  .then(() => openAfterSettings({ siblingSettings: { a8AutoPruneOnUpdate: true } }, true))
  .then(({ d }) => {
    h.check('a registered sibling with Auto Prune on is reported, not warned about',
      d().lines.some((l) => l.indexOf('Normalize Parent Tags has Auto Prune on Entity Updates ' +
        'enabled; it will stand down while this task writes.') !== -1),
      d().lines.join(' | '));
    h.check('and nothing lands in the dialog head', d().note === '', d().note);
  })

  .then(() => openAfterSettings({ siblingSettings: { a8AutoPruneOnUpdate: true } }, false))
  .then(({ d }) => {
    h.check('an unregistered sibling with Auto Prune on warns in the head',
      d().note.indexOf('Auto Prune on Entity Updates') !== -1, d().note);
    h.check('the warning names what Prune would do to the merge',
      d().note.indexOf('remove the parent tags this merge adds') !== -1, d().note);
    h.check('and does not disable Proceed', d().button('Proceed').disabled === false);
  })

  .then(() => openAfterSettings({ siblingSettings: { a9AutoRollUpOnUpdate: true } }, false))
  .then(({ d }) => {
    h.check('Roll Up is named and described in its own terms',
      d().note.indexOf('Auto Roll Up on Entity Updates') !== -1 &&
      d().note.indexOf('add every ancestor of the tags this merge adds') !== -1, d().note);
  })

  // Both on is that plugin's own no-op, so there is nothing to warn about.
  .then(() => openAfterSettings({
    siblingSettings: { a8AutoPruneOnUpdate: true, a9AutoRollUpOnUpdate: true },
  }, false))
  .then(({ d }) => {
    h.check('both sibling modes on warns about neither', d().note === '', d().note);
    h.check('and says nothing in the log either',
      !d().lines.some((l) => l.indexOf('Normalize Parent Tags') !== -1),
      d().lines.join(' | '));
  })

  .then(() => openAfterSettings({ siblingSettings: { a5EnableScenes: true } }, false))
  .then(({ d }) => {
    h.check('a sibling with no auto mode on is not mentioned',
      d().note === '' && !d().lines.some((l) => l.indexOf('Normalize Parent Tags') !== -1),
      d().note + ' | ' + d().lines.join(' | '));
  })

  .then(() => openAfterSettings({}, false))
  .then(({ d }) => {
    h.check('a sibling that is not installed is not mentioned',
      d().note === '' && !d().lines.some((l) => l.indexOf('Normalize Parent Tags') !== -1),
      d().note);
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
