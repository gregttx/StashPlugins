// The base PropagateTagsAndPerformers is built on, ported from its two siblings:
// the cooperation registry, the task interception, the review dialog and the
// settings-page injection.
//
// At 0.1.0 there is no library scan yet, so the dialog reviews the *configuration*
// rather than the library - which paths run and in what order, which filters are in
// force, whether another plugin is writing, whether this script is the installed
// one. That is the surface this suite covers, plus the two things a run must not do
// before there is anything to run: reach the server, or enable Proceed.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const NAME = 'PropagateTagsAndPerformers';
const SRC = process.env.SRC || path.join(__dirname, '..', NAME, NAME + '.js');
const PREFIX = 'ptp2re';
const TASK = 'Propagate Tags and Performers to All Related Entities...';

// Answers the three queries the dialog makes at 0.1.0: the settings, the installed
// version, and nothing else. `installed` absent means Stash reported no version,
// which is the unknown path every case but one exercises.
function responder(opts) {
  opts = opts || {};
  return function (req) {
    const q = req.query || '';
    if (/PluginVersion/.test(q)) {
      if (opts.failVersion) return { errors: [{ message: 'no such field' }] };
      return { data: { plugins: opts.installed ? [{ id: NAME, version: opts.installed }] : [] } };
    }
    if (q.indexOf('configuration') !== -1) {
      const plugins = {};
      plugins[NAME] = opts.raw ? (opts.settings || {}) : h.propagateSettings(opts.settings);
      if (opts.otherPlugins) Object.assign(plugins, opts.otherPlugins);
      return { data: { configuration: { plugins } } };
    }
    return { data: {} };
  };
}

function boot(opts) {
  opts = opts || {};
  const env = h.makeEnv({ quiet: true, respond: responder(opts), clipboard: opts.clipboard });
  h.run(env.ctx, SRC);
  return env;
}

function open(opts) {
  const env = boot(opts);
  return h.startTask(env.ctx, TASK, NAME)
    .then(() => h.flush())
    .then(() => ({ env, d: h.dialog(env.ctx.document.body, PREFIX) }));
}

const mutations = (calls) => calls.filter((c) => /\bmutation\b/.test(c.query || ''));

Promise.resolve()

  // ── Cooperation ───────────────────────────────────────────────────────────
  .then(() => {
    const env = boot();
    const c = env.ctx.window.StashPluginCoop;
    // Registered unconditionally at load, not when an auto mode is switched on: the
    // flag says this copy honours the protocol, which is true whatever the settings
    // are. It is what lets another plugin's bulk run tell "will stand down" apart
    // from "too old to know about leases".
    h.check('it registers as a lease respecter at load',
      !!c && !!c.respecters && c.respecters[NAME] === true,
      JSON.stringify(c && c.respecters));
    h.check('it creates the shared registry without clobbering it',
      !!c && Array.isArray(c.leases) && c.leases.length === 0);
  })

  .then(() => {
    // A registry another plugin created first must survive us loading second.
    const env = h.makeEnv({ quiet: true, respond: responder() });
    env.ctx.window.StashPluginCoop = env.ctx.window.__GTTx__.StashPluginCoop = {
      leases: [{ owner: 'SomeoneElse', label: 'a task', until: Date.now() + 60000 }],
      respecters: { SomeoneElse: true },
    };
    h.run(env.ctx, SRC);
    const c = env.ctx.window.StashPluginCoop;
    h.check('an existing registry is joined, not replaced',
      c.leases.length === 1 && c.respecters.SomeoneElse === true && c.respecters[NAME] === true,
      JSON.stringify(c.respecters) + ' / ' + c.leases.length);
  })

  // ── Task interception, layer 1: the capture-phase click ───────────────────
  .then(() => {
    const env = boot();
    // Stash's Plugin Tasks page: a SettingGroup headed with the plugin name, and a
    // button per declared task inside it.
    const group = h.makeElement('div');
    const heading = h.makeElement('h3');
    heading.textContent = NAME === 'PropagateTagsAndPerformers'
      ? 'ᝯㄝₓ Propagate Tags and Performers to Related Entities' : NAME;
    group.appendChild(heading);
    const btn = h.makeElement('button');
    btn.textContent = TASK;
    group.appendChild(btn);
    env.ctx.document.body.appendChild(group);

    let stopped = false;
    (env.ctx.document.handlers.click || []).forEach((fn) => fn({
      target: btn, preventDefault() {}, stopPropagation() { stopped = true; },
    }));

    return h.flush().then(() => {
      const d = h.dialog(env.ctx.document.body, PREFIX);
      h.check('a click on our task button opens the dialog', d.open);
      // stopPropagation is what keeps PluginTasks' own handler - and its misleading
      // "added job to queue" toast - from running at all.
      h.check('and stops the event reaching React', stopped);
      h.check('and never posts runPluginTask',
        env.calls.every((c) => !/runPluginTask/.test(c.query || '')),
        env.calls.map((c) => c.query).join(' | '));
    });
  })

  .then(() => {
    const env = boot();
    // Another plugin is free to declare a task with the same name. Matching the
    // label alone would hijack it.
    const group = h.makeElement('div');
    const heading = h.makeElement('h3');
    heading.textContent = 'Some Other Plugin (2.0.0)';
    group.appendChild(heading);
    const btn = h.makeElement('button');
    btn.textContent = TASK;
    group.appendChild(btn);
    env.ctx.document.body.appendChild(group);

    let stopped = false;
    (env.ctx.document.handlers.click || []).forEach((fn) => fn({
      target: btn, preventDefault() {}, stopPropagation() { stopped = true; },
    }));

    return h.flush().then(() => {
      h.check('another plugin task with the same name is left alone',
        !h.dialog(env.ctx.document.body, PREFIX).open && !stopped);
    });
  })

  .then(() => {
    const env = boot();
    // The version suffix Settings - Plugins appends, which is why headingIsOurs
    // strips it rather than comparing the raw text.
    const group = h.makeElement('div');
    const heading = h.makeElement('h3');
    heading.textContent = 'ᝯㄝₓ Propagate Tags and Performers to Related Entities (0.1.0)';
    group.appendChild(heading);
    const btn = h.makeElement('button');
    btn.textContent = TASK;
    group.appendChild(btn);
    env.ctx.document.body.appendChild(group);
    (env.ctx.document.handlers.click || []).forEach((fn) => fn({
      target: btn, preventDefault() {}, stopPropagation() {},
    }));
    return h.flush().then(() => {
      h.check('a heading carrying the version suffix is still ours',
        h.dialog(env.ctx.document.body, PREFIX).open);
    });
  })

  // ── Task interception, layer 2: the fetch backstop ────────────────────────
  .then(() => open()).then(({ env, d }) => {
    h.check('the runPluginTask backstop opens the dialog', d.open);
    // Answered from the wrapper rather than forwarded: the server has no exec for
    // this plugin, so a forwarded mutation could only fail in the job queue.
    h.check('and answers the mutation without it reaching the server',
      env.calls.every((c) => !/runPluginTask/.test(c.query || '')),
      env.calls.map((c) => c.query).join(' | '));
  })

  .then(() => {
    const env = boot();
    // Keyed on the plugin id the mutation carries, so another plugin's task is not
    // swallowed by our backstop.
    return h.startTask(env.ctx, 'Some Task', 'SomeOtherPlugin')
      .then(() => h.flush()).then(() => {
        h.check('another plugin runPluginTask is forwarded, not answered',
          !h.dialog(env.ctx.document.body, PREFIX).open &&
          env.calls.some((c) => /runPluginTask/.test(c.query || '')));
      });
  })

  // ── The dialog head ───────────────────────────────────────────────────────
  .then(() => open()).then(({ env, d }) => {
    const nodes = env.ctx.document.body.descendants();
    const title = (nodes.filter((n) => h.hasClass(n, PREFIX + '-title'))[0] || {}).textContent || '';
    const warn = (nodes.filter((n) => h.hasClass(n, PREFIX + '-warn'))[0] || {}).textContent || '';
    // The *short* name since 0.18.1: the manifest's full one is the least informative
    // third of a title that also names a task, a path and an entity.
    h.check('the head names the plugin and the task',
      /ᝯㄝₓ Propagate Tags & Performers/.test(title) && title.indexOf(TASK) !== -1,
      title);
    // Undo reaches its own writes and only while the dialog is open. It must never
    // be allowed to read as a substitute for the backup, so the instruction leads
    // and the limits are stated beside it rather than left to be discovered.
    h.check('the head leads with the backup instruction',
      /^Backing up your database before proceeding is recommended\./.test(warn), warn);
    h.check('and states what Undo cannot reach',
      /only reverses what this dialog wrote/.test(warn) && /while it stays open/.test(warn), warn);
    h.check('the log opens by saying nothing will be written yet',
      /reviewing, nothing will be written yet/.test(d.lines.join('\n')), d.lines.join('\n'));
    // The id legend: a bracketed number is always a id and never a count.
    // Nothing else in the dialog says so, and "(250)" read as a count is how a
    // library-wide write gets approved for the wrong reason.
    h.check('the head carries the id legend',
      /number in brackets/.test(d.legend) && /x250/.test(d.legend), d.legend);
  })

  // ── No paths enabled ──────────────────────────────────────────────────────
  .then(() => open({ settings: {} })).then(({ env, d }) => {
    const text = d.lines.join('\n');
    h.check('a run with no paths enabled says so and names where to fix it',
      /No paths are enabled/.test(text) && /Path Settings/.test(text), text);
    h.check('and leaves Proceed disabled', d.button('Proceed').disabled === true);
    h.check('and writes nothing', mutations(env.calls).length === 0,
      mutations(env.calls).map((c) => c.query).join(' | '));
  })

  // ── The enabled paths, in pipeline order ──────────────────────────────────
  .then(() => open({
    // Deliberately given in the *opposite* order to the pipeline: d1 is stage 6 and
    // b3 is stage 2. A list derived from the settings object rather than from the
    // path table would come back in this order, and the order is what tells the user
    // whether one run reaches a group through its scenes' markers.
    settings: { d1TagsGalleriesToImages: true, b3TagsMarkersToScenes: true },
  })).then(({ d }) => {
    const line = d.lines.filter((l) => /Enabled, in the order they run/.test(l))[0] || '';
    h.check('the enabled paths are listed', !!line, d.lines.join('\n'));
    h.check('in pipeline order, not settings order',
      line.indexOf('Markers') !== -1 && line.indexOf('Galleries') !== -1 &&
      line.indexOf('Markers') < line.indexOf('Galleries'), line);
    h.check('each named by what it copies, from where, to where',
      /Tags: Markers → Scenes/.test(line) && /Tags: Galleries → Images/.test(line), line);
  })

  // ── Reversible pairs ──────────────────────────────────────────────────────
  .then(() => open({
    settings: { e1TagsScenesToGroups: true, b4TagsGroupsToScenes: true },
  })).then(({ d }) => {
    // Not prevented, said out loud: applied together the pair drives every member to
    // the same tag set, which is what running both directions means. A user who
    // enabled each half because it looked reasonable alone will not expect it.
    h.check('both halves of a pair warn in the dialog head',
      /reversible pair/.test(d.note), d.note);
    h.check('and the warning names both directions',
      /Tags: Scenes → Groups/.test(d.note) && /Tags: Groups → Scenes/.test(d.note), d.note);
    h.check('and offers the two ways out',
      /disable one/.test(d.note) && /common tags only/.test(d.note), d.note);
  })

  .then(() => open({
    settings: { e1TagsScenesToGroups: true, b4TagsGroupsToScenes: true },
  })).then(({ d }) => {
    // One warning, not two: the pair is one fact about the run.
    const hits = (d.note.match(/reversible pair/g) || []).length;
    h.check('a pair warns once, not once per half', hits === 1, 'got ' + hits);
  })

  .then(() => open({ settings: { e1TagsScenesToGroups: true } })).then(({ d }) => {
    h.check('one half of a pair warns about nothing', !/reversible pair/.test(d.note), d.note);
  })

  // Two pairs on is still one note. The explanation is identical for every pair and
  // only the names differ, so repeating it puts the same three sentences on screen
  // twice - which is what shipped, and what a user reading the head had to wade past.
  .then(() => open({
    settings: {
      e1TagsScenesToGroups: true, b4TagsGroupsToScenes: true,
      c1TagsImagesToGalleries: true, d1TagsGalleriesToImages: true,
    },
  })).then(({ d }) => {
    h.check('two pairs are one note, not two',
      (d.note.match(/Applied together/g) || []).length === 1, d.note);
    h.check('and it counts them and names all four directions',
      /2 reversible pairs are enabled/.test(d.note) &&
      /Tags: Images → Galleries and Tags: Galleries → Images/.test(d.note) &&
      /Tags: Scenes → Groups and Tags: Groups → Scenes/.test(d.note), d.note);
  })

  // ── Escape ────────────────────────────────────────────────────────────────
  //
  // Routed through the footer's own Cancel/Close rather than straight to `close()`,
  // so the key can never reach a button the dialog is not currently offering.
  .then(() => open()).then(({ env, d }) => {
    h.check('the dialog is up before Escape', d.open);
    h.check('an open dialog listens on the document',
      (env.ctx.document.handlers.keydown || []).length === 1,
      String((env.ctx.document.handlers.keydown || []).length));
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('Escape cancels the run',
      !h.dialog(env.ctx.document.body, PREFIX).open);
    h.check('and the key handler goes with it',
      (env.ctx.document.handlers.keydown || []).length === 0,
      String((env.ctx.document.handlers.keydown || []).length));
  })

  // ── Declared-path overlap (the N-way registry) ────────────────────────────
  //
  // Every settings load publishes this plugin's currently enabled paths into
  // `coop().declares`, so another relationship-copying plugin (today, only
  // MergePerformerTagsToScenes) can notice the overlap without either plugin
  // knowing the other by name.
  .then(() => open({ settings: { b1TagsPerformersToScenes: true, b2TagsStudioToScenes: true } }))
  .then(({ env }) => {
    h.check('it publishes its own enabled paths into the registry',
      (env.ctx.window.StashPluginCoop.declares[NAME] || []).slice().sort().join() ===
      ['tags:performer>scene', 'tags:studio>scene'].sort().join(),
      JSON.stringify(env.ctx.window.StashPluginCoop.declares[NAME]));
  })

  .then(() => open({ settings: {} })).then(({ env }) => {
    h.check('with nothing enabled, it publishes an empty list rather than skipping the registry',
      Array.isArray(env.ctx.window.StashPluginCoop.declares[NAME]) &&
      env.ctx.window.StashPluginCoop.declares[NAME].length === 0);
  })

  .then(() => {
    const env = h.makeEnv({ quiet: true, respond: responder({ settings: { b1TagsPerformersToScenes: true } }) });
    env.ctx.window.StashPluginCoop = env.ctx.window.__GTTx__.StashPluginCoop = {
      leases: [], respecters: {},
      declares: { MergePerformerTagsToScenes: ['tags:performer>scene'] },
    };
    h.run(env.ctx, SRC);
    return h.startTask(env.ctx, TASK, NAME).then(() => h.flush()).then(() => {
      const d = h.dialog(env.ctx.document.body, PREFIX);
      h.check('another plugin declaring one of our enabled paths is noted in the log',
        d.lines.some((l) => /MergePerformerTagsToScenes also performs/.test(l) &&
          /Tags: Performers → Scenes/.test(l)), d.lines.join('\n'));
      h.check('and it is informational, not a head warning - both only ever add',
        d.note === '', d.note);
    });
  })

  .then(() => {
    const env = h.makeEnv({ quiet: true, respond: responder({ settings: { b2TagsStudioToScenes: true } }) });
    env.ctx.window.StashPluginCoop = env.ctx.window.__GTTx__.StashPluginCoop = {
      leases: [], respecters: {},
      declares: { MergePerformerTagsToScenes: ['tags:performer>scene'] },
    };
    h.run(env.ctx, SRC);
    return h.startTask(env.ctx, TASK, NAME).then(() => h.flush()).then(() => {
      const d = h.dialog(env.ctx.document.body, PREFIX);
      h.check('a different enabled path is not flagged as overlapping',
        !d.lines.some((l) => /also performs/.test(l)), d.lines.join('\n'));
    });
  })

  // ── NormalizeParentTags awareness ─────────────────────────────────────────
  //
  // Not the same mechanism as the overlap above: Prune/Roll Up along the tag
  // hierarchy collides with any additive path this plugin runs, regardless of
  // which one added the tag, so this stays a name-based check reading NPT's own
  // settings rather than a `declares` match. Mirrors MergePerformerTagsToScenes'
  // own check against the same sibling.
  .then(() => open({
    settings: { b1TagsPerformersToScenes: true },
    otherPlugins: { NormalizeParentTags: { a1AutoModes: 'SCENES=PRUNE, IMAGES=OFF' } },
  })).then(({ d }) => {
    h.check('an unregistered NormalizeParentTags with an automatic Prune warns in the head',
      /automatic Prune/.test(d.note), d.note);
    h.check("the warning names what Prune would do to this run's additions",
      /remove the tags this run adds/.test(d.note), d.note);
  })

  .then(() => {
    const env = h.makeEnv({ quiet: true, respond: responder({
      settings: { b1TagsPerformersToScenes: true },
      otherPlugins: { NormalizeParentTags: { a1AutoModes: 'PERFORMERS=ROLLUP' } },
    }) });
    env.ctx.window.StashPluginCoop = env.ctx.window.__GTTx__.StashPluginCoop = {
      leases: [], respecters: { NormalizeParentTags: true }, declares: {},
    };
    h.run(env.ctx, SRC);
    return h.startTask(env.ctx, TASK, NAME).then(() => h.flush()).then(() => {
      const d = h.dialog(env.ctx.document.body, PREFIX);
      h.check('a registered NormalizeParentTags is reported, not warned about',
        d.lines.some((l) => /Normalize Parent Tags has automatic Roll Up enabled/
          .test(l)), d.lines.join('\n'));
      h.check('and nothing lands in the dialog head', d.note === '', d.note);
    });
  })

  // Since its 4.0.0 both directions at once is a legitimate configuration - one type
  // pruned, another rolled up - and both collide with anything this plugin adds.
  .then(() => open({
    settings: { b1TagsPerformersToScenes: true },
    otherPlugins: { NormalizeParentTags: { a1AutoModes: 'SCENES=PRUNE, PERFORMERS=ROLLUP' } },
  })).then(({ d }) => {
    h.check('a mode each way warns about both',
      /automatic Prune and Roll Up/.test(d.note) &&
      /depending on the entity type/.test(d.note), d.note);
  })

  // The settings it had up to 3.2.0, where both booleans on was its own documented
  // no-op - exact inverses, so it ran neither.
  .then(() => open({
    settings: { b1TagsPerformersToScenes: true },
    otherPlugins: { NormalizeParentTags: { a5EnableScenes: true, a8AutoPruneOnUpdate: true } },
  })).then(({ d }) => {
    h.check('a pre-4.0.0 sibling is still read', /automatic Prune/.test(d.note), d.note);
  })

  .then(() => open({
    settings: { b1TagsPerformersToScenes: true },
    otherPlugins: { NormalizeParentTags: { a8AutoPruneOnUpdate: true, a9AutoRollUpOnUpdate: true } },
  })).then(({ d }) => {
    h.check('and its both-on no-op warns about neither', d.note === '', d.note);
  })

  .then(() => open({ settings: { b1TagsPerformersToScenes: true } })).then(({ d }) => {
    h.check('a sibling that is not installed is not mentioned',
      d.note === '' && !d.lines.some((l) => /Normalize Parent Tags/.test(l)), d.note);
  })

  // ── The exclusion filters ─────────────────────────────────────────────────
  .then(() => open({
    settings: {
      b1TagsPerformersToScenes: true,
      f1ExcludeTargetWithTagName: 'No Auto',
      f2ExcludeTargetOrganized: true,
      f3ExcludeTagWithIgnoreAutoTag: true,
      f4ExcludeTagWithCustomFieldName: 'locked',
    },
  })).then(({ d }) => {
    const line = d.lines.filter((l) => /Exclusion filters in force/.test(l))[0] || '';
    h.check('every configured filter is named before anything is planned',
      /"No Auto"/.test(line) && /Organized/.test(line) &&
      /Ignore auto tag/.test(line) && /"locked"/.test(line), line);
  })

  .then(() => open({ settings: { b1TagsPerformersToScenes: true } })).then(({ d }) => {
    // Said explicitly rather than by omission: "nothing is skipped" is a fact about
    // the run, and a silent absence reads as a dialog that forgot to mention it.
    h.check('no filters configured is stated rather than left silent',
      d.lines.some((l) => /No exclusion filters are configured/.test(l)),
      d.lines.join('\n'));
  })

  // ── The version gate ──────────────────────────────────────────────────────
  .then(() => open({ installed: '9.9.9', settings: { b1TagsPerformersToScenes: true } }))
    .then(({ d }) => {
      h.check('a version mismatch is named in the head', /9\.9\.9/.test(d.note), d.note);
      h.check('and says how to fix it', /F5/.test(d.note) && /Ctrl\+Shift\+R/.test(d.note), d.note);
      // Its own red box, not a sentence appended to the run's notes: every other
      // warning here is about the library or another plugin, and this one is about the
      // dialog running code the user has already replaced. The log carries the same
      // sentence, because Copy log is how a user reports it.
      h.check('in the stale box rather than among the run notes', /9\.9\.9/.test(d.stale), d.stale);
      h.check('and in the log, so Copy log carries it',
        d.lines.some((l) => /9\.9\.9 is installed/.test(l)), d.stale);
      h.check('and holds Proceed back', d.button('Proceed').disabled === true);
    })

  // Read off the script rather than written down, so a version bump does not turn
  // this into a failing check that has to be edited before anyone looks at it.
  .then(() => open({ installed: boot().ctx.__GTTx__.ptp2re.PLUGIN_VERSION,
    settings: { b1TagsPerformersToScenes: true } }))
    .then(({ d }) => {
      h.check('a matching version says nothing in the dialog', d.note === '', d.note);
    })

  .then(() => open({ settings: { b1TagsPerformersToScenes: true } })).then(({ d }) => {
    // Unknown is not a mismatch. A Stash too old for the field, a plugin it cannot
    // see, a failed request - none of them is evidence of a stale script, and a run
    // must not be blocked because one more query came back empty.
    h.check('an unknown installed version is not treated as a mismatch', d.note === '', d.note);
  })

  .then(() => open({ failVersion: true, settings: { b1TagsPerformersToScenes: true } }))
    .then(({ d }) => {
      h.check('a failed version query is not treated as a mismatch', d.note === '', d.note);
    })

  // ── Someone else's lease ──────────────────────────────────────────────────
  .then(() => {
    const env = h.makeEnv({ quiet: true, respond: responder({ settings: { b1TagsPerformersToScenes: true } }) });
    env.ctx.window.StashPluginCoop = env.ctx.window.__GTTx__.StashPluginCoop = {
      leases: [{ owner: 'NormalizeParentTags', label: 'Prune Parent Tags', until: Date.now() + 60000 }],
      respecters: {},
    };
    h.run(env.ctx, SRC);
    return h.startTask(env.ctx, TASK, NAME).then(() => h.flush()).then(() => {
      const d = h.dialog(env.ctx.document.body, PREFIX);
      // Advisory, never a block: a task click is manual, and the rule across all
      // three plugins is that manual actions are not suppressed.
      h.check('a lease held by another plugin is named in the head',
        /NormalizeParentTags/.test(d.note) && /Prune Parent Tags/.test(d.note), d.note);
      h.check('and the dialog carries on rather than standing down', d.open);
    });
  })

  .then(() => {
    // An expired lease is not a lease. A tab that crashed mid-run must not warn
    // every dialog opened afterwards.
    const env = h.makeEnv({ quiet: true, respond: responder({ settings: { b1TagsPerformersToScenes: true } }) });
    env.ctx.window.StashPluginCoop = env.ctx.window.__GTTx__.StashPluginCoop = {
      leases: [{ owner: 'NormalizeParentTags', label: 'Prune', until: Date.now() - 1000 }],
      respecters: {},
    };
    h.run(env.ctx, SRC);
    return h.startTask(env.ctx, TASK, NAME).then(() => h.flush()).then(() => {
      // begin() reads coop().leases directly; the sweep happens in autoSuppressed.
      // What matters here is that an expired lease does not stop the run.
      h.check('an expired lease does not stop the dialog opening',
        h.dialog(env.ctx.document.body, PREFIX).open);
    });
  })

  // ── The review writes nothing ─────────────────────────────────────────────
  .then(() => open({
    settings: {
      b1TagsPerformersToScenes: true, b3TagsMarkersToScenes: true,
      e1TagsScenesToGroups: true, c1TagsImagesToGalleries: true,
    },
  })).then(({ env, d }) => {
    h.check('a review issues no mutation at all', mutations(env.calls).length === 0,
      mutations(env.calls).map((c) => c.query).join(' | '));
    h.check('and Proceed stays disabled on an empty plan',
      d.button('Proceed').disabled === true);
    // An empty library still costs the tag query and one page per pass, so a review
    // that read nothing at all would mean the scan never ran. The planner's own
    // behaviour is covered in propagate-plan.
    h.check('but it does read the library',
      env.calls.some((c) => /PTPTags/.test(c.query || '')),
      env.calls.map((c) => (c.query || '').slice(0, 40)).join(' | '));
  })

  // ── The footer ────────────────────────────────────────────────────────────
  .then(() => {
    let copied = null;
    return open({
      settings: { b1TagsPerformersToScenes: true },
      clipboard: { writeText: (t) => { copied = t; return Promise.resolve(); } },
    }).then(({ d }) => {
      d.button('Copy log').click();
      return h.flush(5).then(() => {
        h.check('Copy log hands over every line, not just the rendered tail',
          copied !== null && copied.split('\n').length === d.lines.length,
          (copied === null ? 'nothing copied' : copied.split('\n').length + ' vs ' + d.lines.length));
        h.check('and the copied text is the log verbatim',
          copied === d.lines.join('\n'));
      });
    });
  })

  .then(() => open({ settings: { b1TagsPerformersToScenes: true } })).then(({ env, d }) => {
    d.button('Cancel').click();
    return h.flush(5).then(() => {
      h.check('Cancel closes the dialog',
        !h.dialog(env.ctx.document.body, PREFIX).open);
      h.check('and writes nothing', mutations(env.calls).length === 0);
    });
  })

  .then(() => open({ settings: { b1TagsPerformersToScenes: true } })).then(({ d }) => {
    // The footer a review ends on. Rescan and Close belong to `done`, which nothing
    // reaches until there is an apply to finish - offering them over a plan that has
    // not been applied would invite a rescan of a library nothing has touched.
    h.check('a finished review offers Proceed, Cancel and Copy log',
      d.visible('Proceed') && d.visible('Cancel') && d.visible('Copy log'));
    h.check('and not Stop, Rescan, Close or Undo',
      !d.visible('Stop') && !d.visible('Rescan') && !d.visible('Close') && !d.visible('Undo'),
      ['Stop', 'Rescan', 'Close', 'Undo'].filter((b) => d.visible(b)).join(' '));
  })

  // ── The settings page ─────────────────────────────────────────────────────
  .then(() => {
    const env = boot();
    const group = h.makeElement('div');
    group.className = 'setting-group collapsible';
    const header = h.makeElement('div');
    header.className = 'setting';
    const headBox = h.makeElement('div');
    const heading = h.makeElement('h3');
    heading.textContent = 'ᝯㄝₓ Propagate Tags and Performers to Related Entities (0.1.0)';
    headBox.appendChild(heading);
    const sub = h.makeElement('div');
    sub.className = 'sub-heading';
    sub.textContent = 'Copies tags and performers from related entities.\n\n' +
      'Thirteen paths, each off until you enable it.\n\n' +
      'BACK UP YOUR DATABASE BEFORE THE FIRST RUN.';
    headBox.appendChild(sub);
    header.appendChild(headBox);
    group.appendChild(header);

    const collapsed = h.makeElement('div');
    const rows = {};
    const descs = {
      // Two paragraphs: a summary that stays on the page and a detail that moves.
      a4AutoOnSourceUpdate: 'Push a saved entity out to everything that reads it.\n\n' +
        'This one fans out, so it is far more expensive than the mode above.',
      // One paragraph: nothing to hide, so nothing should be built.
      f3ExcludeTagWithIgnoreAutoTag: 'Tags set to Ignore auto tag are never copied onto anything.',
    };
    Object.keys(descs).forEach((k) => {
      const row = h.makeElement('div');
      row.className = 'setting';
      const rowH = h.makeElement('h3');
      rowH.textContent = k;
      row.appendChild(rowH);
      const rowSub = h.makeElement('div');
      rowSub.className = 'sub-heading';
      rowSub.textContent = descs[k];
      row.appendChild(rowSub);
      const input = h.makeElement('input');
      input.id = 'plugin-' + NAME + '-' + k;
      row.appendChild(input);
      collapsed.appendChild(row);
      rows[k] = { row, input, h3: rowH, sub: rowSub };
    });
    group.appendChild(collapsed);
    env.ctx.document.body.appendChild(group);

    env.tick();

    const paras = sub.childNodes.filter((n) => h.hasClass(n, PREFIX + '-p'));
    h.check('the group description is split into paragraph elements', paras.length === 3,
      'got ' + paras.length);
    h.check('and collapsed behind a toggle',
      h.hasClass(sub, PREFIX + '-desc-collapsed'), sub.className);
    const toggle = sub.childNodes.filter((n) => n.id === PREFIX + '-desc-toggle')[0];
    // A <button>, never a <span>: SettingGroup's onDivClick returns early only for
    // `a` and `button`, so anything else folds the whole group on click.
    h.check('the toggle is a button', !!toggle && toggle.tagName === 'BUTTON',
      toggle ? toggle.tagName : 'missing');
    toggle.click();
    h.check('clicking it expands the description and flips the caption',
      !h.hasClass(sub, PREFIX + '-desc-collapsed') && toggle.textContent === 'Show less',
      sub.className + ' / ' + toggle.textContent);

    const link = env.ctx.document.getElementById(PREFIX + '-readme-link');
    h.check('the README link is injected under the description',
      !!link && link.tagName === 'A' && /README\.md$/.test(link.href), link ? link.href : 'missing');
    h.check('the group is marked as ours so the scoped CSS applies',
      h.hasClass(group, PREFIX + '-own-group'), group.className);

    // The heading's version is the manifest's, read fresh from the server; the script
    // is whatever the browser had cached. 0.1.0 against anything later is exactly the
    // state a cached script leaves a user in, and nothing on screen used to say so.
    const stale = env.ctx.document.getElementById(PREFIX + '-stale-notice');
    h.check('a stale script is called out in the settings group', !!stale,
      stale && stale.textContent);
    h.check('naming the installed version and the key that fixes it', !!stale &&
      /0\.1\.0/.test(stale.textContent) && /Ctrl\+Shift\+R/.test(stale.textContent),
      stale && stale.textContent);
    h.check('above the description, in the header that survives the collapse',
      !!stale && stale.parentNode === headBox &&
      headBox.childNodes.indexOf(stale) < headBox.childNodes.indexOf(sub),
      stale && String(headBox.childNodes.indexOf(stale)));

    // A second tick must not duplicate anything: React re-renders this panel on
    // every settings change and the tick puts it all back.
    env.tick();
    h.check('a second tick adds no second toggle',
      sub.childNodes.filter((n) => n.id === PREFIX + '-desc-toggle').length === 1);
    h.check('and no second README link',
      env.ctx.document.body.descendants().filter((n) => n.id === PREFIX + '-readme-link').length === 1);

    // Per setting: two paragraphs keep only the first, and the rest opens on hover.
    const two = rows.a4AutoOnSourceUpdate;
    const summary = two.sub.childNodes.filter((n) => h.hasClass(n, PREFIX + '-sum'))[0];
    const mark = two.sub.childNodes.filter((n) => h.hasClass(n, PREFIX + '-tip'))[0];
    const box = two.sub.childNodes.filter((n) => h.hasClass(n, PREFIX + '-tipbox'))[0];
    h.check('a two-paragraph setting shows only its first paragraph',
      !!summary && summary.textContent === 'Push a saved entity out to everything that reads it.',
      summary ? summary.textContent : 'missing');
    h.check('the rest moves into a built box, not a native title',
      !!box && /fans out/.test(box.textContent) && !mark.title && !two.h3.title,
      box ? box.textContent : 'missing');
    h.check('the mark is focusable, so the box is reachable without a mouse',
      mark.tabIndex === 0, String(mark.tabIndex));

    // All three triggers open the same box, wired by a JS-toggled class rather than
    // a `:hover ~` selector - the mark and the name do not sit in one predictable
    // place, and this repo has shipped broken twice on a guess about that markup.
    [['the mark', mark], ['the summary', summary], ['the setting name', two.h3]].forEach(([what, node]) => {
      h.fire(node, 'mouseenter');
      const opened = h.hasClass(two.sub, PREFIX + '-tip-open');
      h.fire(node, 'mouseleave');
      const closed = !h.hasClass(two.sub, PREFIX + '-tip-open');
      h.check('hovering ' + what + ' opens and closes the box', opened && closed,
        'opened ' + opened + ', closed ' + closed);
    });
    h.fire(mark, 'focus');
    h.check('focusing the mark opens it too', h.hasClass(two.sub, PREFIX + '-tip-open'));
    h.fire(mark, 'blur');

    const one = rows.f3ExcludeTagWithIgnoreAutoTag;
    h.check('a one-paragraph setting is left alone',
      one.sub.childNodes.length === 0 && !h.hasClass(one.sub, PREFIX + '-tipped'),
      one.sub.className + ' / ' + one.sub.childNodes.length + ' children');
  })

  // Fallback for a Stash that sets no setting ids - and, more to the point, for a
  // release that renames every key this plugin has. Trying every key already survives
  // one rename; it does not survive all of them at once, and the first casualty is
  // the stale-script banner, which is the one thing that release needed to show.
  // NormalizeParentTags 4.0.0 did exactly that and its own 3.2.0 banner went silent.
  .then(() => {
    function headingOnly(text) {
      const env = boot();
      const group = h.makeElement('div');
      group.className = 'setting-group';
      const heading = h.makeElement('h3');
      heading.textContent = text;
      group.appendChild(heading);
      env.ctx.document.body.appendChild(group);
      env.tick();
      return !!env.ctx.document.getElementById(PREFIX + '-readme-link');
    }
    h.check('heading fallback: our group is found with no setting id on the page',
      headingOnly('\u176f\u311d\u2093 Propagate Tags and Performers to Related Entities (0.1.0)'));
    h.check('heading fallback: the bare name too', headingOnly(
      '\u176f\u311d\u2093 Propagate Tags and Performers to Related Entities'));
    h.check('heading fallback: and the "undefined" Stash renders with no version',
      headingOnly('\u176f\u311d\u2093 Propagate Tags and Performers to Related Entities undefined'));
    h.check('heading fallback: a near-namesake plugin is not', !headingOnly(
      '\u176f\u311d\u2093 Propagate Tags and Performers to Related Entities Extra'));
  })

  // Settings - Tasks heads its own group with the same name, and that group is not
  // this one. Decorating it puts the README link inside the task button, replacing
  // the label `ownTaskName` matches on - so the click would queue a real Stash job.
  .then(() => {
    const env = boot();
    const group = h.makeElement('div');
    group.className = 'setting-group';
    const heading = h.makeElement('h3');
    heading.textContent = '\u176f\u311d\u2093 Propagate Tags and Performers to Related Entities';
    group.appendChild(heading);
    const row = h.makeElement('div');
    row.className = 'setting';
    const btn = h.makeElement('button');
    btn.textContent = TASK;
    row.appendChild(btn);
    group.appendChild(row);
    env.ctx.document.body.appendChild(group);
    env.tick();
    return h.flush(20).then(() => {
      h.check('heading fallback: the tasks page group is left to its buttons',
        !env.ctx.document.getElementById(PREFIX + '-readme-link') &&
        !h.hasClass(group, PREFIX + '-own-group'), group.className);
      h.check('and the task button on it keeps the label that identifies it',
        btn.textContent === TASK && h.hasClass(btn, 'btn-warning'),
        btn.textContent + ' / ' + btn.className);
    });
  })

  .then(() => {
    // A group that is not ours is not a settings page for us: the tick must touch
    // nothing, by id or by heading.
    const env = boot();
    const other = h.makeElement('div');
    other.className = 'setting-group';
    const otherH = h.makeElement('h3');
    otherH.textContent = 'Some Other Plugin (2.0.0)';
    other.appendChild(otherH);
    env.ctx.document.body.appendChild(other);
    env.tick();
    h.check('another plugin settings group is not touched',
      other.className === 'setting-group' &&
      !env.ctx.document.getElementById(PREFIX + '-readme-link'), other.className);
  })

  .then(() => h.finish(), (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
