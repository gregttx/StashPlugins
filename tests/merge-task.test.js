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
const TASK = 'Merge Performer Tags into All Their Scenes...';

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
      // And so do the superseding sibling's, which the settings-page notice compares
      // this plugin's four exclusion filters against.
      if (opts.supersederSettings) plugins.PropagateTagsAndPerformers = opts.supersederSettings;
      return { data: { configuration: { plugins } } };
    }
    if (/CPT2S_TaskPerformers|findPerformers/.test(q)) {
      const per = req.variables.per;
      const page = req.variables.page;
      const list = (opts.performers || PERFORMERS).slice((page - 1) * per, page * per);
      return { data: { findPerformers: { count: (opts.performers || PERFORMERS).length, performers: list } } };
    }
    // The performer button's gate: one query asking both halves at once, which is why
    // it cannot share the `findPerformer` branch below.
    if (/CheckPerformerScenes/.test(q)) {
      const p = (opts.performers || PERFORMERS).filter((x) => x.id === req.variables.id)[0];
      return { data: {
        findPerformer: { tags: (p ? p.tags : []).map((t) => ({ id: t.id })) },
        findScenes: { count: ((opts.scenes || SCENES)[req.variables.id] || []).length },
      } };
    }
    // 1.18.1: the one by-id read a scoped click makes purely to name the entity in the
    // dialog's title. Ahead of the generic `findPerformer`/`findScene` branches below,
    // which it would otherwise fall into and be answered in the wrong shape.
    if (/CPT2S_ScopeName/.test(q)) {
      if (opts.failScopeName) return { errors: [{ message: 'scope name boom' }] };
      const id = String(req.variables.id);
      if (/findPerformer/.test(q)) {
        const p = (opts.performers || PERFORMERS).filter((x) => x.id === id)[0];
        return { data: { findPerformer: p ? { id: p.id, name: p.name } : null } };
      }
      return { data: { findScene: { id: id, title: 'S' + id, files: [] } } };
    }
    // The performer-scoped review: the same shape the library walk gets per page, for
    // one performer.
    if (/CPT2S_TaskPerformer\(/.test(q)) {
      const p = (opts.performers || PERFORMERS).filter((x) => x.id === req.variables.id)[0];
      return { data: { findPerformer: p ? { id: p.id, name: p.name, tags: p.tags } : null } };
    }
    // The scene button's gate and the scene-scoped review. Both read one scene; the
    // review also needs the performers named, so the log can say where a tag came from.
    if (/FindSceneMergeable|CPT2S_TaskScene\(/.test(q)) {
      const scene = opts.oneScene || {
        id: '102', title: 'S102', files: [], organized: false, tags: [],
        performers: [{ id: '1', name: 'Ann', tags: [tag('10')] }],
      };
      return { data: { findScene: scene } };
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
    // What Stash says is installed, which the dialog compares against the version
    // compiled into the script. Absent unless a case asks for it, so every other case
    // exercises the unknown path - which must not warn or block.
    if (/PluginVersion/.test(q)) {
      if (opts.failVersion) return { errors: [{ message: 'no such field' }] };
      return { data: { plugins: opts.installed
        ? [{ id: opts.installed.id, version: opts.installed.version }] : [] } };
    }
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

// Same shape, but seeding `coop().declares` with another plugin's entry rather
// than a respecter flag - simulating a second relationship-copying plugin having
// already loaded and published what it does.
// The settings-page group, as SettingsPluginsPanel builds it, with the Enable/Disable
// button Stash puts in the header. `label` is what that button says.
function settingsGroup(ctx, opts) {
  const label = opts.label;
  const group = h.makeElement('div');
  group.className = 'setting-group collapsible';
  const header = h.makeElement('div');
  header.className = 'setting';
  const headBox = h.makeElement('div');
  const heading = h.makeElement('h3');
  heading.textContent = 'ᝯㄝₓ Merge Performer Tags To Scenes' +
    (opts.version ? ' (' + opts.version + ')' : '');
  const sub = h.makeElement('div');
  sub.className = 'sub-heading';
  sub.textContent = 'Copies each performer tags onto their scenes.';
  if (!opts.noHeading) headBox.appendChild(heading);
  headBox.appendChild(sub);
  header.appendChild(headBox);
  const actions = h.makeElement('div');
  // Stash's own unlabelled link for the manifest's `url:`, which is what the notice
  // anchors on - a plugin without one falls back to the button beside it.
  const urlLink = h.makeElement('a');
  urlLink.href = 'https://example.invalid/readme';
  const disable = h.makeElement('button');
  disable.textContent = label;
  if (!opts.noLink) actions.appendChild(urlLink);
  actions.appendChild(disable);
  header.appendChild(actions);
  group.appendChild(header);
  const input = h.makeElement('input');
  input.id = 'plugin-MergePerformerTagsToScenes-a1ShowManualMergeButtons';
  group.appendChild(input);
  ctx.document.body.appendChild(group);
  return { group, actions, disable, urlLink, heading };
}

function openWithDeclares(opts, declares) {
  const env = h.makeEnv({ quiet: true, respond: makeResponder(opts || {}) });
  h.run(env.ctx, SRC);
  if (declares) Object.assign(env.ctx.window.StashPluginCoop.declares, declares);
  return h.flush(20).then(() => {
    h.startTask(env.ctx, TASK, PLUGIN_ID);
    return h.flush(150).then(() => ({ env, d: () => h.dialog(env.body, 'cpt2s') }));
  });
}

// A page with one of the manual buttons on it, rather than the settings page the task
// is clicked from. The buttons need a container Stash would have rendered: the
// performer detail navbar (a `.details-edit` carrying Delete) or the scene edit row.
function buttonEnv(opts, pathname) {
  const env = h.makeEnv({ quiet: true, respond: makeResponder(opts || {}), pathname: pathname });
  env.ctx.alert = (m) => { env.ctx._alert = m; };
  h.run(env.ctx, SRC);
  if (/performers/.test(pathname)) {
    const nav = h.makeElement('div');
    nav.className = 'details-edit';
    const del = h.makeElement('button');
    del.className = 'delete';
    nav.appendChild(del);
    env.body.appendChild(nav);
  }
  return env;
}

const ourButton = (env, cls) => env.body.descendants().filter((n) => h.hasClass(n, cls))[0] || null;

// The forward merge writes one scene at a time; the undo goes out as a bulk delta.
// The two names do not overlap as substrings - bulkSceneUpdate capitalises the S -
// so a plain match on each is enough to tell them apart.
const sceneUpdates = (calls) => calls.filter((c) => /sceneUpdate/.test(c.query || ''));
const bulkSceneUpdates = (calls) => calls.filter((c) => /bulkSceneUpdate/.test(c.query || ''));
const merges = (d) => d().lines.filter((l) => l.indexOf('[MERGE]') === 0);
// The hoverable segments of a recap line: only the tags with something to say beyond
// the caption carry a title, and nothing else about the line changes.
const recapLine = (env, verb) => env.body.descendants().filter((n) => h.hasClass(n, 'cpt2s-line') &&
  n.textContent.indexOf(' ' + verb + ':') !== -1)[0] || null;
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
    // Amber for the same reason every other control that writes is. (3.4.0)
    h.check('and it is amber, like Undo beside it',
      h.hasClass(d().button('Proceed'), 'btn-warning') &&
      h.hasClass(d().button('Undo'), 'btn-warning'),
      d().button('Proceed').className);
    // Every name in those lines carries a bracketed id, and the closing recap puts
    // one beside a count. The head is where that notation gets explained.
    h.check('the head explains the ids in the log',
      d().legend.indexOf('id') !== -1 && d().legend.indexOf('x250') !== -1, d().legend);
    h.check('the review lists what it would write, tag by tag',
      d().lines.some((l) => l.indexOf('Performer "Ann" (1) - Scene "S102" (102) - 1 tag: "Blonde" (10)') !== -1),
      d().lines.join(' | '));
    h.check('the review totals are reported',
      d().progress.indexOf('3 scenes to update') !== -1 &&
      d().progress.indexOf('3 tag assignments to add') !== -1, d().progress);

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
        d().lines.some((l) => l.indexOf('[MERGE] Scene "S102" (102) - 1 tag added - from Performer "Ann" (1)') === 0),
        d().lines.join(' | '));
      h.check('the totals are reported',
        d().progress.indexOf('3 scenes updated') !== -1 &&
        d().progress.indexOf('3 tag assignments added') !== -1, d().progress);
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
        h.check('the error count is reported', d().progress.indexOf('1 error') !== -1, d().progress);
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
        d().progress.indexOf('1 scene to update') !== -1 &&
        d().progress.indexOf('2 tag assignments to add') !== -1, d().progress);
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
        d().progress.indexOf(written + ' scenes updated') !== -1, d().progress);
      h.check('Stop leaves the dialog closable', d().visible('Close') && !d().visible('Stop'));
    });
  })

  // ── Running the installed script ─────────────────────────────────────────
  //
  // Reload plugins swaps the manifest, not the script this page already executed, so
  // the dialog can be planning a library-wide merge with code the user replaced ten
  // minutes ago. The manifest version is the only thing it can compare itself with.
  .then(() => open({ installed: { id: PLUGIN_ID, version: '9.9.9' } })).then(({ d }) => {
    h.check('a version mismatch is named in the dialog head',
      d().note.indexOf('9.9.9 is installed') !== -1 &&
      d().note.indexOf('Ctrl+Shift+R') !== -1, d().note);
    // Its own red box, not a sentence appended to the run's notes: every other warning
    // here is about the library or another plugin, and this one is about the dialog
    // running code the user has already replaced. The log carries the same sentence,
    // because Copy log is how a user reports it.
    h.check('in the stale box rather than among the run notes',
      d().stale.indexOf('9.9.9 is installed') !== -1, d().stale);
    h.check('and in the log, so Copy log carries it',
      d().lines.some((l) => l.indexOf('9.9.9 is installed') !== -1), d().stale);
    // The one blocking warning in this dialog: every other one is about the library
    // or another plugin, where the user knows more than the dialog does.
    h.check('Proceed is held back even with a plan',
      d().button('Proceed').disabled === true && merges(d).length > 0, d().progress);
  })

  // The version the script carries, read from the plugin rather than hard-coded, so
  // a bump does not have to be made in a fourth place.
  .then(() => {
    const version = /var PLUGIN_VERSION\s*=\s*'([^']+)'/
      .exec(require('fs').readFileSync(SRC, 'utf8'))[1];
    return open({ installed: { id: PLUGIN_ID, version: version } }).then(({ d }) => {
      h.check('a matching version says nothing in the dialog', d().note === '', d().note);
      h.check('and leaves Proceed alone', d().button('Proceed').disabled === false);
    });
  })

  // Unknown is not a mismatch: an old Stash without the field, a plugin it cannot
  // see, a failed request - none of them may block a run.
  .then(() => open({ failVersion: true })).then(({ d }) => {
    h.check('a failed version query does not warn', d().note === '', d().note);
    h.check('and does not block', d().button('Proceed').disabled === false);
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
        planned === '[INFO] 3 tags to add: "Zed" (20) x2, "Volume 2" (22) x1, "volume 10" (21) x1',
        planned);
      d().button('Proceed').click();
      return h.flush(200).then(() => {
        const applied = d().lines[d().lines.length - 1];
        h.check('and the apply ends with what was actually written',
          applied === '[INFO] 3 tags added: "Zed" (20) x2, "Volume 2" (22) x1, "volume 10" (21) x1',
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
        '[INFO] 2 tags to add: "Blonde" (10) x1, "Tattoo" (11) x2',
      d().lines[d().lines.length - 1]);
  })

  // A tooltip is worth a query, not a run: the recap must read the same when the
  // query fails, and must not spend an [ERROR] line on it.
  .then(() => open({ failTagDetail: true })).then(({ d }) => {
    const planned = d().lines[d().lines.length - 1];
    h.check('a failed detail query still leaves the recap',
      planned === '[INFO] 2 tags to add: "Blonde" (10) x1, "Tattoo" (11) x2', planned);
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
          applied === '[INFO] 2 tags added: "Blonde" (10) x1, "Tattoo" (11) x1', applied);
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
        // The marker alone only proves the new pass logged one. What the log has to
        // do now is keep everything above it, until the dialog closes.
        h.check('and the lines the earlier pass wrote are still on screen',
          d().lines.some((l) => /^\[INFO\] Applying /.test(l)) &&
          d().lines.some((l) => /^\[MERGE\] /.test(l)), d().lines.join(' | '));
        h.check('and Rescan says what it keeps',
          /The log is kept/.test(d().button('Rescan').title || ''),
          d().button('Rescan').title);
        // The fake server does not apply what it is told, so the second pass finds
        // the same three scenes - the point is that it finds three and not six.
        h.check('Rescan starts the plan over rather than adding to it',
          d().progress.indexOf('Review complete. 3 scenes to update') === 0, d().progress);
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
          bulkSceneUpdates(env.calls).length === 0 && d().visible('Undo 3 scenes?'),
          'armed caption wrong');

        d().button('Undo 3 scenes?').click();
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
        d().button('Undo 3 scenes?').click();
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
            d().visible('Undo 2 scenes?'), 'armed caption wrong');
          d().button('Undo 2 scenes?').click();
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
          d().button('Undo 3 scenes?').click();
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

  .then(() => openAfterSettings({
    siblingSettings: { a1AutoModes: 'SCENES=PRUNE, IMAGES=OFF' },
  }, true))
  .then(({ d }) => {
    h.check('a registered sibling with an automatic Prune is reported, not warned about',
      d().lines.some((l) => l.indexOf('Normalize Parent Tags has automatic Prune ' +
        'enabled; it will stand down while this task writes.') !== -1),
      d().lines.join(' | '));
    h.check('and nothing lands in the dialog head', d().note === '', d().note);
  })

  .then(() => openAfterSettings({
    siblingSettings: { a1AutoModes: 'SCENES=PRUNE, IMAGES=OFF' },
  }, false))
  .then(({ d }) => {
    h.check('an unregistered sibling with an automatic Prune warns in the head',
      d().note.indexOf('automatic Prune') !== -1, d().note);
    h.check('the warning names what Prune would do to the merge',
      d().note.indexOf('remove the parent tags this merge adds') !== -1, d().note);
    h.check('and does not disable Proceed', d().button('Proceed').disabled === false);
  })

  .then(() => openAfterSettings({
    siblingSettings: { a1AutoModes: 'PERFORMERS=ROLLUP' },
  }, false))
  .then(({ d }) => {
    h.check('Roll Up is named and described in its own terms',
      d().note.indexOf('automatic Roll Up') !== -1 &&
      d().note.indexOf('add every ancestor of the tags this merge adds') !== -1, d().note);
  })

  // Its 4.0.0 made both directions at once a legitimate configuration - one type
  // pruned, another rolled up - where its pre-4.0.0 booleans could only mean the
  // no-op below. Both collide with a merge, so both are named.
  .then(() => openAfterSettings({
    siblingSettings: { a1AutoModes: 'SCENES=PRUNE, PERFORMERS=ROLLUP' },
  }, false))
  .then(({ d }) => {
    h.check('a mode each way warns about both',
      d().note.indexOf('automatic Prune and Roll Up') !== -1 &&
      d().note.indexOf('depending on the entity type') !== -1, d().note);
  })

  .then(() => openAfterSettings({
    siblingSettings: { a1AutoModes: 'SCENES=OFF, IMAGES=OFF' },
  }, false))
  .then(({ d }) => {
    h.check('every type OFF is not mentioned',
      d().note === '' && !d().lines.some((l) => l.indexOf('Normalize Parent Tags') !== -1),
      d().note + ' | ' + d().lines.join(' | '));
  })

  // The settings that plugin had up to 3.2.0. An install nobody has touched since
  // still carries them, and this check has to keep working against it - including
  // that release's own no-op, where both booleans on ran neither.
  .then(() => openAfterSettings({
    siblingSettings: { a5EnableScenes: true, a8AutoPruneOnUpdate: true },
  }, false))
  .then(({ d }) => {
    h.check('a pre-4.0.0 sibling is still read',
      d().note.indexOf('automatic Prune') !== -1, d().note);
  })

  .then(() => openAfterSettings({
    siblingSettings: { a8AutoPruneOnUpdate: true, a9AutoRollUpOnUpdate: true },
  }, false))
  .then(({ d }) => {
    h.check('and its both-on no-op still warns about neither', d().note === '', d().note);
    h.check('nor says anything in the log',
      !d().lines.some((l) => l.indexOf('Normalize Parent Tags') !== -1),
      d().lines.join(' | '));
  })

  .then(() => openAfterSettings({}, false))
  .then(({ d }) => {
    h.check('a sibling that is not installed is not mentioned',
      d().note === '' && !d().lines.some((l) => l.indexOf('Normalize Parent Tags') !== -1),
      d().note);
  })

  // ── Declared-path overlap (the N-way registry) ────────────────────────────
  //
  // Unlike the sibling check above, this one is generic: any plugin naming our one
  // path in `coop().declares` is doing the exact same thing, which is redundant
  // work rather than the sibling's opposite-direction collision.

  .then(() => {
    const env = h.makeEnv({ quiet: true, respond: makeResponder({}) });
    h.run(env.ctx, SRC);
    h.check('the plugin declares its one path at load, unconditionally',
      (env.ctx.window.StashPluginCoop.declares.MergePerformerTagsToScenes || []).join() ===
      'tags:performer>scene');
  })

  .then(() => openWithDeclares({}, { PropagateTagsAndPerformers: ['tags:performer>scene'] }))
  .then(({ d }) => {
    h.check('another plugin declaring the same path is noted in the log',
      d().lines.some((l) => l.indexOf('PropagateTagsAndPerformers also merges performer ' +
        'tags onto scenes') !== -1), d().lines.join(' | '));
    h.check('and it is informational, not a head warning', d().note === '', d().note);
  })

  .then(() => openWithDeclares({}, { PropagateTagsAndPerformers: ['tags:studio>scene'] }))
  .then(({ d }) => {
    h.check('a different path from the same plugin is not mentioned',
      !d().lines.some((l) => l.indexOf('PropagateTagsAndPerformers') !== -1), d().lines.join(' | '));
  })

  .then(() => openWithDeclares({}, {}))
  .then(({ d }) => {
    h.check('with nothing else declaring the path, nothing is said about it',
      !d().lines.some((l) => l.indexOf('also merges performer tags') !== -1), d().lines.join(' | '));
  })

  // ── "PropagateTagsAndPerformers has taken this over" ─────────────────────
  //
  // The claim the notice makes is about the user's own install, so both halves are
  // read rather than assumed: the path enabled *there* (`declares`, republished on
  // every settings load, so an installed-but-switched-off path supersedes nothing),
  // and this plugin's four exclusion filters actually present on that side.

  .then(() => {
    const mine = { b1ExcludeSceneWithTagName: 'skipme', b2ExcludeSceneOrganized: true };
    const env = h.makeEnv({ quiet: true, respond: makeResponder({
      settings: mine,
      supersederSettings: { f1ExcludeTargetWithTagName: 'skipme', f2ExcludeTargetOrganized: true },
    }) });
    h.run(env.ctx, SRC);
    env.ctx.window.StashPluginCoop.declares.PropagateTagsAndPerformers =
      ['tags:performer>scene', 'tags:studio>group'];
    const { heading } = settingsGroup(env.ctx, { label: 'Disable', version: '9.9.9' });
    env.tick();
    return h.flush(20).then(() => {
      env.tick();
      const note = env.ctx.document.getElementById('cpt2s-superseded-notice');
      h.check('a superseding sibling is named on the settings page', !!note,
        note && note.textContent);
      h.check('and the settings it carried over are called safe to leave behind',
        !!note && /Settings migrated\. Uninstall safe/.test(note.textContent),
        note && note.textContent);
      h.check('on the title line, inside the heading and after the name', !!note &&
        note.parentNode === heading &&
        heading.childNodes[heading.childNodes.length - 1] === note,
        note && String(heading.childNodes.indexOf(note)));
      // The trap this arrangement sets: both readers of that h3 are exact - the
      // group's own heading fallback compares the whole string, and the stale banner
      // matches a parenthesised version anchored at its end.
      const stale = env.ctx.document.getElementById('cpt2s-stale-notice');
      h.check('and the stale banner still reads the version off that heading',
        !!stale && /9\.9\.9/.test(stale.textContent), stale && stale.textContent);
      h.check('named short enough for that line, with the full name on hover', !!note &&
        note.textContent.indexOf('Propagate Tags and Performers... is present') !== -1 &&
        note.title === 'ᝯㄝₓ Propagate Tags and Performers to Related Entities',
        note && note.textContent + ' | ' + note.title);

      // The path can be switched off over there while this page is open, and this
      // tick is what notices - a notice that outlived its reason would be a claim
      // that uninstalling is safe when it is not.
      env.ctx.window.StashPluginCoop.declares.PropagateTagsAndPerformers = ['tags:studio>group'];
      env.tick();
      h.check('the path switched off over there takes the notice away',
        !env.ctx.document.getElementById('cpt2s-superseded-notice'));
    });
  })

  .then(() => {
    // Its import only fires for a key it has never been set to, so two plugins
    // configured differently by hand is a real state - and the opposite claim.
    const env = h.makeEnv({ quiet: true, respond: makeResponder({
      settings: { b1ExcludeSceneWithTagName: 'skipme' },
      supersederSettings: { f1ExcludeTargetWithTagName: 'somethingelse' },
    }) });
    h.run(env.ctx, SRC);
    env.ctx.window.StashPluginCoop.declares.PropagateTagsAndPerformers = ['tags:performer>scene'];
    // No heading and no `url:` on this one, so the button is the last anchor left.
    const { actions, disable } = settingsGroup(env.ctx,
      { label: 'Disable', noLink: true, noHeading: true });
    env.tick();
    return h.flush(20).then(() => {
      env.tick();
      const note = env.ctx.document.getElementById('cpt2s-superseded-notice');
      h.check('with no heading and no link icon, the button is the anchor', !!note &&
        note.parentNode === actions &&
        actions.childNodes.indexOf(note) === actions.childNodes.indexOf(disable) - 1,
        note && String(actions.childNodes.indexOf(note)));
      h.check('exclusion filters that did not carry over say so instead', !!note &&
        /do not match these/.test(note.textContent) &&
        !/Uninstall safe/.test(note.textContent), note && note.textContent);
    });
  })

  .then(() => {
    // Nothing declared at all: the plugin is not installed, or is disabled in Stash.
    const env = h.makeEnv({ quiet: true, respond: makeResponder({}) });
    h.run(env.ctx, SRC);
    const { actions } = settingsGroup(env.ctx, { label: 'Disable' });
    env.tick();
    return h.flush(20).then(() => {
      env.tick();
      h.check('with nothing superseding this plugin, the header is left alone',
        !env.ctx.document.getElementById('cpt2s-superseded-notice') &&
        actions.childNodes.length === 2, String(actions.childNodes.length));
    });
  })

  // ── The README link on the settings page ─────────────────────────────────
  //
  // Same feature as the sibling's, anchored the same way: Stash's own link for
  // `url:` is an unlabelled chain icon that is easy to miss, and a description
  // cannot carry an <a> because Stash passes it to React as a child. The DOM here
  // mirrors what SettingsPluginsPanel/Inputs.tsx build - group box, header row, the
  // heading and description in one div, settings inside a Collapse.
  .then(() => {
    const env = h.makeEnv({ quiet: true, respond: makeResponder({}) });
    h.run(env.ctx, SRC);

    const group = h.makeElement('div');
    group.className = 'setting-group collapsible';
    const header = h.makeElement('div');
    header.className = 'setting';
    const headBox = h.makeElement('div');
    const heading = h.makeElement('h3');
    heading.textContent = 'ᝯㄝₓ Merge Performer Tags To Scenes (1.9.3)';
    const sub = h.makeElement('div');
    sub.className = 'sub-heading';
    sub.textContent = 'Copies each performer tags onto their scenes.\n\n' +
      'BACK UP YOUR DATABASE BEFORE THE FIRST RUN - Stash has no undo.';
    headBox.appendChild(heading);
    headBox.appendChild(sub);
    header.appendChild(headBox);
    group.appendChild(header);
    const collapsed = h.makeElement('div');
    collapsed.className = 'collapse';
    // A row the way Inputs.tsx builds one: an <h3> for the name and a .sub-heading
    // for the description, with the id on the input rather than the row.
    const row = h.makeElement('div');
    row.className = 'setting';
    const rowH = h.makeElement('h3');
    rowH.textContent = 'Show Manual Merge Buttons';
    row.appendChild(rowH);
    const rowSub = h.makeElement('div');
    rowSub.className = 'sub-heading';
    rowSub.textContent = 'Show the two merge buttons.\n\nThey only appear when there is ' +
      'related content to merge from.';
    row.appendChild(rowSub);
    const input = h.makeElement('input');
    input.id = 'plugin-MergePerformerTagsToScenes-a1ShowManualMergeButtons';
    row.appendChild(input);
    collapsed.appendChild(row);
    group.appendChild(collapsed);
    env.ctx.document.body.appendChild(group);

    env.tick();
    return h.flush(20).then(() => {
      const link = env.ctx.document.getElementById('cpt2s-readme-link');
      h.check('a labelled README link is injected', !!link);
      h.check('the group is marked so the description can keep its line breaks',
        h.hasClass(group, 'cpt2s-own-group'), group.className);
      const css = (env.ctx.document.getElementById('cpt2s-task-style') || {}).textContent || '';
      const subRules = css.split('}').filter((r) => r.indexOf('sub-heading') !== -1);
      h.check('and the stylesheet says how, every rule scoped to that class',
        subRules.length > 0 && subRules.every((r) => r.indexOf('.cpt2s-own-group ') === 0),
        subRules.join(' | '));
      h.check('with pre-wrap for an unsplit description and a margin for a split one',
        subRules.some((r) => r.indexOf('white-space:pre-wrap') !== -1) &&
        subRules.some((r) => /\.cpt2s-p\{margin:0 0 \.35em;/.test(r)), subRules.join(' | '));

      // Elements, because a blank line under pre-wrap is always a whole line-height.
      h.check('the description is rebuilt as paragraph elements',
        sub.childNodes.filter((n) => h.hasClass(n, 'cpt2s-p')).length === 2,
        String(sub.childNodes.length) + ' children');

      // The heading says 1.9.3 and the script is whatever it is: a cached script the
      // manifest has already replaced, which is the state this banner exists for.
      const stale = env.ctx.document.getElementById('cpt2s-stale-notice');
      h.check('a stale script is called out in the settings group', !!stale,
        stale && stale.textContent);
      h.check('naming the installed version and the key that fixes it', !!stale &&
        /1\.9\.3/.test(stale.textContent) && /Ctrl\+Shift\+R/.test(stale.textContent),
        stale && stale.textContent);
      h.check('above the description, in the header that survives the collapse',
        !!stale && stale.parentNode === headBox &&
        headBox.childNodes.indexOf(stale) < headBox.childNodes.indexOf(sub),
        stale && String(headBox.childNodes.indexOf(stale)));
      // ── 1.11.0: the description collapses, the settings hover ────────────
      //
      // Same feature as NormalizeParentTags 1.7.5, and `style.test.js` compares the
      // CSS of the two with the prefix stripped, so the rules cannot drift.
      const toggle = env.ctx.document.getElementById('cpt2s-desc-toggle');
      h.check('a multi-paragraph description gets a Show more toggle', !!toggle);
      h.check('and starts collapsed', h.hasClass(sub, 'cpt2s-desc-collapsed'), sub.className);
      // A <span> here would fold the whole group on click: SettingGroup's onDivClick
      // returns early only for `a` and `button`.
      h.check('the toggle is a button, so clicking it cannot fold the group',
        !!toggle && String(toggle.tagName).toLowerCase() === 'button', toggle && toggle.tagName);
      if (toggle) toggle.click();
      h.check('clicking it expands the description', !h.hasClass(sub, 'cpt2s-desc-collapsed'));
      h.check('and the caption flips',
        !!toggle && toggle.textContent === 'Show less', toggle && toggle.textContent);

      const kids = rowSub.childNodes;
      const summary = kids.filter((n) => h.hasClass(n, 'cpt2s-sum'))[0];
      const mark = kids.filter((n) => h.hasClass(n, 'cpt2s-tip'))[0];
      const box = kids.filter((n) => h.hasClass(n, 'cpt2s-tipbox'))[0];
      h.check('a two-paragraph setting description keeps only its first paragraph',
        !!summary && summary.textContent === 'Show the two merge buttons.',
        summary && summary.textContent);
      // Built, not borrowed: a native `title` opens below-right of the pointer, in a
      // size CSS cannot reach, under the arrow that summoned it.
      h.check('the detail is an element, so it can be positioned and sized',
        !!box && box.textContent ===
          'They only appear when there is related content to merge from.',
        box && box.textContent);
      h.check('the mark carries no native title that would double up with it',
        !!mark && !mark.title, mark && mark.title);
      h.check('and is focusable, so the box is reachable without a mouse',
        !!mark && mark.tabIndex === 0, mark && String(mark.tabIndex));
      // One row, one tooltip: all three triggers open the same box.
      [['the mark', mark], ['the summary', summary], ['the name', rowH]].forEach(([what, node]) => {
        h.fire(node, 'mouseenter');
        h.check('hovering ' + what + ' opens the box',
          h.hasClass(rowSub, 'cpt2s-tip-open'), rowSub.className);
        h.fire(node, 'mouseleave');
        h.check('and leaving ' + what + ' closes it', !h.hasClass(rowSub, 'cpt2s-tip-open'));
      });
      h.check('the setting name has no native title of its own', !rowH.title, rowH.title);
      h.check('and the box never takes the pointer, so it cannot flicker',
        /\.cpt2s-tipbox\{[^}]*pointer-events:none/.test(css));

      h.check('with the file name as its text',
        !!link && link.textContent === 'MergePerformerTagsToScenes/README.md',
        link && link.textContent);
      h.check('and a pinned https URL, opened in a new tab',
        !!link && /^https:\/\/github\.com\/.*\/MergePerformerTagsToScenes\/README\.md$/.test(link.href) &&
        link.target === '_blank', link && link.href);
      h.check('it sits directly under the description',
        !!link && link.parentNode === headBox &&
        headBox.childNodes.indexOf(link) === headBox.childNodes.indexOf(sub) + 1);

      env.tick();
      env.tick();
      return h.flush(20).then(() => {
        const links = env.ctx.document.body.descendants()
          .filter((n) => n.id === 'cpt2s-readme-link');
        h.check('ticking again does not add a second one', links.length === 1, String(links.length));
      });
    });
  })

  // Fallback for a Stash that sets no setting ids - and, more to the point, for a
  // release that renames the two keys this looks for. NormalizeParentTags 4.0.0
  // renamed all nine of its keys and its own 3.2.0 banner went silent in every tab
  // that had not been reloaded, which is the one release that needed it shown.
  .then(() => {
    function headingOnly(text) {
      const env = h.makeEnv({ quiet: true, respond: makeResponder({}) });
      h.run(env.ctx, SRC);
      const group = h.makeElement('div');
      group.className = 'setting-group';
      const heading = h.makeElement('h3');
      heading.textContent = text;
      group.appendChild(heading);
      env.ctx.document.body.appendChild(group);
      env.tick();
      return !!env.ctx.document.getElementById('cpt2s-readme-link');
    }
    h.check('heading fallback: our group is found with no setting id on the page',
      headingOnly('\u176f\u311d\u2093 Merge Performer Tags To Scenes (1.9.3)'));
    h.check('heading fallback: the bare name too',
      headingOnly('\u176f\u311d\u2093 Merge Performer Tags To Scenes'));
    h.check('heading fallback: and the "undefined" Stash renders with no version',
      headingOnly('\u176f\u311d\u2093 Merge Performer Tags To Scenes undefined'));
    h.check('heading fallback: a near-namesake plugin is not',
      !headingOnly('\u176f\u311d\u2093 Merge Performer Tags To Scenes Extra'));
  })

  // Settings - Tasks heads its own group with the same name, and that group is not
  // this one. Decorating it puts the README link inside the task button, replacing
  // the label `ownTaskName` matches on - so the click would queue a real Stash job.
  .then(() => {
    const env = h.makeEnv({ quiet: true, respond: makeResponder({}) });
    h.run(env.ctx, SRC);
    const group = h.makeElement('div');
    group.className = 'setting-group';
    const heading = h.makeElement('h3');
    heading.textContent = '\u176f\u311d\u2093 Merge Performer Tags To Scenes';
    group.appendChild(heading);
    const row = h.makeElement('div');
    row.className = 'setting';
    const btn = h.makeElement('button');
    btn.textContent = 'Merge Performer Tags into All Their Scenes...';
    row.appendChild(btn);
    group.appendChild(row);
    env.ctx.document.body.appendChild(group);
    env.tick();
    return h.flush(20).then(() => {
      h.check('heading fallback: the tasks page group is left to its buttons',
        !env.ctx.document.getElementById('cpt2s-readme-link') &&
        !h.hasClass(group, 'cpt2s-own-group'), group.className);
      h.check('and the task button on it keeps the label that identifies it',
        btn.textContent === 'Merge Performer Tags into All Their Scenes...' &&
        h.hasClass(btn, 'btn-warning'), btn.textContent + ' / ' + btn.className);
    });
  })

  // Not ours to write into, and not a settings page at all.
  .then(() => {
    const env = h.makeEnv({ quiet: true, respond: makeResponder({}) });
    h.run(env.ctx, SRC);
    const stranger = h.makeElement('div');
    stranger.className = 'setting-group';
    const row = h.makeElement('div');
    row.className = 'setting';
    const input = h.makeElement('input');
    input.id = 'plugin-NormalizeParentTags-a8AutoPruneOnUpdate';
    row.appendChild(input);
    stranger.appendChild(row);
    env.ctx.document.body.appendChild(stranger);
    env.tick();
    return h.flush(20).then(() => {
      h.check('no link in the sibling group',
        !env.ctx.document.getElementById('cpt2s-readme-link'));
    });
  })

  // ── The manual buttons open the same dialog, scoped (1.18.0) ───────────────
  //
  // Both buttons used to write with nothing in front of the user: the performer one
  // merged into every scene it could reach, and the scene one merged that scene
  // whenever staging was unavailable. They now open this dialog over one performer or
  // one scene, through `reviewPerformer` / `planScene` - the very functions the
  // library walk uses, so the plan a button shows is the plan the task would show.
  .then(() => {
    const env = buttonEnv({ settings: { a1ShowManualMergeButtons: true } }, '/performers/1');
    // Two ticks: the first arms the eligibility probe, the second draws the button
    // from its answer - the same two beats a live page goes through.
    return h.flush(40).then(() => {
      env.tick();
      return h.flush(60);
    }).then(() => {
      env.tick();
      return h.flush(60);
    }).then(() => {
      const btn = ourButton(env, 'cpt2s-merge-to-scenes-btn');
      h.check('the performer button says it opens a dialog',
        !!btn && btn.textContent === 'Add Tags to all Scenes...', btn && btn.textContent);
      btn.click();
      return h.flush(150).then(() => {
        const d = h.dialog(env.body, 'cpt2s');
        h.check('clicking it opens the review dialog', d.open);
        // 1.18.1: the caption with its "..." taken back off - it promises a dialog on a
        // button and is punctuation in the middle of a sentence here - and the scope
        // named rather than numbered.
        h.check('scoped to that performer, named rather than numbered',
          (env.body.descendants().filter((n) => h.hasClass(n, 'cpt2s-title'))[0] || {}).textContent ===
          'ᝯㄝₓ Merge Performer Tags To Scenes - Add Tags to all Scenes - from Performer "Ann" (1)',
          (env.body.descendants().filter((n) => h.hasClass(n, 'cpt2s-title'))[0] || {}).textContent);
        h.check('and writes nothing before Proceed', sceneUpdates(env.calls).length === 0,
          h.plural(sceneUpdates(env.calls).length, 'write'));
        h.check('the plan lists the one scene that needs the tag',
          d.lines.filter((l) => l.indexOf('[MERGE]') === 0).length === 1,
          d.lines.join(' | '));
        h.check('and no other performer is walked',
          env.calls.filter((c) => /CPT2S_TaskPerformers/.test(c.query || '')).length === 0);
        d.button('Proceed').click();
        return h.flush(150);
      });
    }).then(() => {
      const w = sceneUpdates(env.calls);
      h.check('Proceed writes the reviewed scene, and only it',
        w.length === 1 && w[0].variables.input.id === '102',
        w.map((c) => c.variables.input.id).join(','));
    });
  })

  // The scene button, with staging unavailable (no PluginApi at all here, which is
  // the case that used to merge and save on the spot).
  .then(() => {
    const env = buttonEnv({ settings: { a1ShowManualMergeButtons: true } }, '/scenes/102');
    const row = h.makeElement('div');
    row.className = 'edit-buttons';
    env.body.appendChild(row);
    return h.flush(40).then(() => {
      env.tick();
      return h.flush(60);
    }).then(() => {
      env.tick();
      return h.flush(60);
    }).then(() => {
      const btn = ourButton(env, 'cpt2s-merge-from-perfs-btn');
      h.check('the scene button carries the dots where staging is unavailable',
        !!btn && btn.textContent === 'Add all Tags from all Performers...', btn && btn.textContent);
      btn.click();
      return h.flush(150).then(() => {
        const d = h.dialog(env.body, 'cpt2s');
        h.check('the scene click opens the dialog rather than merging', d.open &&
          sceneUpdates(env.calls).length === 0, h.plural(sceneUpdates(env.calls).length, 'write'));
        h.check('the plan names the performer the tag comes from',
          d.lines.some((l) => /^\[MERGE\] Performer .*Ann/.test(l)), d.lines.join(' | '));
        // The other half of `scopeLabel` - a scene is named through `sceneLogLabel`,
        // so a title and a log line cannot disagree about how one is written.
        h.check('and the title names the scene, not just its id',
          (env.body.descendants().filter((n) => h.hasClass(n, 'cpt2s-title'))[0] || {}).textContent ===
          'ᝯㄝₓ Merge Performer Tags To Scenes - Add all Tags from all Performers - for Scene "S102" (102)',
          (env.body.descendants().filter((n) => h.hasClass(n, 'cpt2s-title'))[0] || {}).textContent);
        d.button('Proceed').click();
        return h.flush(150);
      });
    }).then(() => {
      const w = sceneUpdates(env.calls);
      h.check('and Proceed merges that one scene', w.length === 1 &&
        w[0].variables.input.id === '102', w.map((c) => c.variables.input.id).join(','));
    });
  })

  // Escape acts through whichever of Cancel/Close the footer is showing rather than
  // closing the dialog itself, so it can never reach a button that is not on offer.
  .then(() => open())
  .then(({ env, d }) => {
    h.check('the task dialog is up before Escape', d().open);
    h.check('an open dialog listens on the document',
      (env.ctx.document.handlers.keydown || []).length === 1,
      String((env.ctx.document.handlers.keydown || []).length));
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('Escape cancels the run', !d().open);
    h.check('and the key handler goes with it',
      (env.ctx.document.handlers.keydown || []).length === 0,
      String((env.ctx.document.handlers.keydown || []).length));
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
