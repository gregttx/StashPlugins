// The path setting: one string holding all thirteen paths, the parser that forgives
// what is typed into it, the dialog that edits it, and the settings row it replaces.
//
// This is what 3.0.0 replaced fifteen booleans with - thirteen path toggles spread
// over four alphabetical blocks, plus two "common tags only" modifiers whose pairing
// with a path could only be inferred from the wording of their names. Two of the
// thirteen are tri-state, which a Stash plugin setting cannot be.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const NAME = 'PropagateTagsAndPerformers';
const SRC = process.env.SRC || path.join(__dirname, '..', NAME, NAME + '.js');
const PREFIX = 'ptp2re';
const TASK_PATHS = 'Path Settings...';

// Deliberately raw: this suite is the one that means the setting itself, so nothing
// here goes through the harness's legacy-key translation. `legacy` is how a case asks
// for the pre-3.0.0 shape.
function responder(opts) {
  return function (req) {
    const q = req.query || '';
    if (/PluginVersion/.test(q)) {
      return { data: { plugins: opts.installed ? [opts.installed] : [] } };
    }
    if (q.indexOf('configuration') !== -1) {
      const plugins = {};
      plugins[NAME] = opts.settings || {};
      if (opts.sibling) plugins.MergePerformerTagsToScenes = opts.sibling;
      return { data: { configuration: { plugins } } };
    }
    if (/configurePlugin/.test(q)) return { data: { configurePlugin: true } };
    return { data: {} };
  };
}

function boot(opts) {
  opts = opts || {};
  const env = h.makeEnv({ quiet: true, respond: responder(opts) });
  h.run(env.ctx, SRC);
  return env;
}

function open(opts) {
  const env = boot(opts);
  return h.startTask(env.ctx, TASK_PATHS, NAME)
    .then(() => h.flush())
    .then(() => env);
}

const api = (env) => env.ctx.window.__ptp2re;
const d = (env) => h.dialog(env.ctx.document.body, PREFIX);
const selects = (env) =>
  env.ctx.document.body.descendants().filter((n) => h.hasClass(n, PREFIX + '-mode'));
const rowName = (sel) => sel.previousSibling.textContent;
const selectFor = (env, label) => selects(env).filter((s) => rowName(s) === label)[0] || null;
const saved = (env) => env.calls.filter((c) => /configurePlugin/.test(c.query || ''));

function setSelect(env, label, value) {
  const sel = selectFor(env, label);
  sel.value = value;
  h.fire(sel, 'change');
}

// The parser and the formatter are read straight off the plugin's own exports here:
// every other suite reads them through a run, and the point of these cases is the
// string, not what a run does with it.
const A = api(boot({}));

Promise.resolve()

  // ── The string ────────────────────────────────────────────────────────────

  .then(() => {
    h.check('a path nobody mentions is off',
      A.parsePaths('')['tags:performer>scene'] === 'off',
      JSON.stringify(A.parsePaths('')));
    h.check('the token is the path id, which is what declares publishes',
      A.parsePaths('tags:performer>scene=ON')['tags:performer>scene'] === 'on');
    h.check('any case, any separators, and unknown ids ignored',
      A.parsePaths('nonsense; TAGS:STUDIO>SCENE = on | fruit:apple>pear=ON')['tags:studio>scene'] === 'on' &&
      A.parsePaths('nonsense; TAGS:STUDIO>SCENE = on')['tags:performer>scene'] === 'off',
      JSON.stringify(A.parsePaths('nonsense; TAGS:STUDIO>SCENE = on | fruit:apple>pear=ON')));
    // The string is edited by appending far more often than by rewriting, so the last
    // word is the newest intent.
    h.check('a path named twice takes its last mention',
      A.parsePaths('tags:studio>scene=ON, tags:studio>scene=OFF')['tags:studio>scene'] === 'off');
    // ALL is the word that path's own selector shows, which is where someone typing
    // the line by hand reads it.
    h.check('ALL is a synonym of ON',
      A.parsePaths('tags:scene>group=ALL')['tags:scene>group'] === 'on');
    h.check('COMMON on a path that has no common mode is just on',
      A.parsePaths('tags:studio>scene=COMMON')['tags:studio>scene'] === 'on' &&
      A.parsePaths('tags:scene>group=COMMON')['tags:scene>group'] === 'common',
      JSON.stringify(A.parsePaths('tags:studio>scene=COMMON, tags:scene>group=COMMON')));
  })

  .then(() => {
    // Unlike the sibling's seven pairs, thirteen `=OFF` entries would bury the two
    // that matter - and an absent path already means off.
    h.check('only the enabled paths are written back',
      A.formatPaths(A.parsePaths('tags:studio>scene=ON')) === 'tags:studio>scene=ON',
      A.formatPaths(A.parsePaths('tags:studio>scene=ON')));
    h.check('nothing enabled is the empty string',
      A.formatPaths(A.parsePaths('')) === '', JSON.stringify(A.formatPaths(A.parsePaths(''))));
    // Pipeline order, not the order they were typed: the order is semantics here, and
    // a value read back should say so.
    h.check('and they come back in pipeline order, whatever order they were given in',
      A.formatPaths(A.parsePaths('tags:gallery>image=ON, tags:marker>scene=ON')) ===
        'tags:marker>scene=ON, tags:gallery>image=ON',
      A.formatPaths(A.parsePaths('tags:gallery>image=ON, tags:marker>scene=ON')));
    h.check('a common-only path keeps its mode through the round trip',
      A.formatPaths(A.parsePaths('tags:scene>group=COMMON')) === 'tags:scene>group=COMMON');
  })

  // ── Migration from the fifteen booleans ───────────────────────────────────

  .then(() => {
    const s = A.settingsFrom({
      b1TagsPerformersToScenes: true, e1TagsScenesToGroups: true,
      e2TagsScenesToGroupsCommonOnly: true, b2TagsStudioToScenes: false,
    });
    h.check('an enabled path becomes ON, and its common modifier COMMON',
      s.b1Paths === 'tags:performer>scene=ON, tags:scene>group=COMMON', s.b1Paths);
    h.check('a disabled one is simply absent', s.paths['tags:studio>scene'] === 'off');
  })

  .then(() => {
    const s = A.settingsFrom({
      b1Paths: 'tags:studio>scene=ON', b2TagsStudioToScenes: false,
      e1TagsScenesToGroups: true,
    });
    h.check('an install that already has the string is never migrated over',
      s.b1Paths === 'tags:studio>scene=ON' && s.paths['tags:scene>group'] === 'off', s.b1Paths);
  })

  .then(() => {
    const env = boot({ settings: { b1TagsPerformersToScenes: true } });
    return h.flush().then(() => {
      const c = saved(env);
      h.check('the migrated value is written back, so the settings page shows it',
        c.length === 1 && c[0].variables.input.b1Paths === 'tags:performer>scene=ON',
        JSON.stringify(c.map((x) => x.variables.input)));
      h.check('under our own plugin id', c.length === 1 && c[0].variables.plugin_id === NAME);
    });
  })

  .then(() => {
    const env = boot({ settings: {} });
    return h.flush().then(() => {
      h.check('a fresh install migrates nothing and writes nothing',
        saved(env).length === 0, JSON.stringify(saved(env).map((c) => c.variables)));
    });
  })

  // ── Adopting the sibling's exclusion filters ──────────────────────────────
  //
  // The same four questions, worded for a wider set of entities. Somebody running
  // both has answered them once already.

  .then(() => {
    const env = boot({
      settings: { b1Paths: 'tags:studio>scene=ON' },
      sibling: {
        b1ExcludeSceneWithTagName: 'NoTouch', b2ExcludeSceneOrganized: true,
        c1ExcludeTagWithIgnoreAutoTag: true, c2ExcludeTagWithCustomFieldName: 'NoCopy',
      },
    });
    return h.flush().then(() => {
      const input = saved(env).length === 1 ? saved(env)[0].variables.input : {};
      h.check('all four are adopted where this plugin has none of its own',
        saved(env).length === 1 && input.f1ExcludeTargetWithTagName === 'NoTouch' &&
        input.f2ExcludeTargetOrganized === true &&
        input.f3ExcludeTagWithIgnoreAutoTag === true &&
        input.f4ExcludeTagWithCustomFieldName === 'NoCopy',
        JSON.stringify(saved(env).map((c) => c.variables.input)));
      // `configurePlugin` REPLACES this plugin's config map rather than merging into
      // it, so a mutation naming only the keys it changes deletes every other setting
      // the user has. Reported live, twice over: a config left holding exactly the two
      // keys the last write named.
      h.check('and every setting the write did not name is carried through with them',
        input.b1Paths === 'tags:studio>scene=ON', JSON.stringify(input));
      h.check('under our own plugin id, not the sibling id',
        saved(env)[0].variables.plugin_id === NAME, saved(env)[0].variables.plugin_id);
    });
  })

  .then(() => {
    const env = boot({
      settings: { f1ExcludeTargetWithTagName: 'Mine', f4ExcludeTagWithCustomFieldName: '' },
      sibling: {
        b1ExcludeSceneWithTagName: 'Theirs', c2ExcludeTagWithCustomFieldName: 'AlsoTheirs',
      },
    });
    return h.flush().then(() => {
      // The key's *presence* is what says the question has been answered, not its
      // value: f4 is stored empty, which is also its default.
      h.check('a setting this plugin already carries is never overwritten',
        saved(env).length === 0, JSON.stringify(saved(env).map((c) => c.variables.input)));
    });
  })

  .then(() => {
    // The case the presence rule exists for: a BOOLEAN turned on and then off again
    // is `false`, which is also its default. Comparing values would re-adopt it on
    // every page load, and a setting that comes back after you switch it off is worse
    // than one you have to set twice.
    const env = boot({
      settings: { f2ExcludeTargetOrganized: false },
      sibling: { b2ExcludeSceneOrganized: true },
    });
    return h.flush().then(() => {
      h.check('a toggle switched off by hand stays off, however the sibling is set',
        saved(env).length === 0, JSON.stringify(saved(env).map((c) => c.variables.input)));
    });
  })

  .then(() => {
    const env = boot({
      settings: {},
      sibling: { b1ExcludeSceneWithTagName: '', b2ExcludeSceneOrganized: false },
    });
    return h.flush().then(() => {
      // Writing their default into our config would set the key and spend the one
      // chance this has to run.
      h.check('a sibling with nothing set is not an import',
        saved(env).length === 0, JSON.stringify(saved(env).map((c) => c.variables.input)));
    });
  })

  .then(() => {
    const env = boot({ settings: {} });
    return h.flush().then(() => {
      h.check('and neither is a sibling that is not installed', saved(env).length === 0,
        JSON.stringify(saved(env).map((c) => c.variables.input)));
    });
  })

  .then(() => {
    const env = boot({
      settings: {}, sibling: { c1ExcludeTagWithIgnoreAutoTag: true },
    });
    return h.flush().then(() => {
      h.check('only what the sibling actually sets is adopted',
        saved(env).length === 1 &&
        JSON.stringify(saved(env)[0].variables.input) ===
          JSON.stringify({ f3ExcludeTagWithIgnoreAutoTag: true }),
        JSON.stringify(saved(env).map((c) => c.variables.input)));
      // Our own configurePlugin drops the settings cache, so the next thing to want
      // settings reloads them - and a second load must not send the import again.
      // Driven through `settingsFrom` directly, which is the function that decides.
      env.ctx.window.__ptp2re.settingsFrom({}, { c1ExcludeTagWithIgnoreAutoTag: true });
      return h.flush().then(() => {
        h.check('and it is written once, not once per settings load',
          saved(env).length === 1, String(saved(env).length));
      });
    });
  })

  // ── The dialog ────────────────────────────────────────────────────────────

  .then(() => open({ settings: { b1Paths: 'tags:studio>scene=ON, tags:scene>group=COMMON' } }))
  .then((env) => {
    h.check('one selector per path, thirteen of them', selects(env).length === 13,
      String(selects(env).length));
    // pathLabel, the same string the log and every dialog head use. A second naming of
    // a path is a second thing to keep in step.
    h.check('named the way the log names a path',
      rowName(selects(env)[0]) === 'Performers: Images → Galleries',
      selects(env).map(rowName).join(' | '));
    h.check('in the order a run walks them',
      selects(env).map(rowName).join(',') === api(env).PATHS.map(api(env).pathLabel).join(','),
      selects(env).map(rowName).join(','));
    // Two columns, filled top to bottom, so reading down one and then the other is
    // still pipeline order. Deliberately not grouped under an "Into <plural>"
    // heading: pipeline order visits a target, leaves it and comes back, so a heading
    // at a target's first path collects later paths under whichever one preceded them.
    const cols = env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-paths-col'));
    h.check('laid out in two columns, split evenly and in order',
      cols.length === 2 && cols[0].childNodes.length === 7 && cols[1].childNodes.length === 6,
      cols.map((c) => c.childNodes.length).join('/'));
    h.check('and nothing groups them by target, which would break that order',
      !env.ctx.document.body.descendants().some((n) => /Into /.test(n.textContent || '') &&
        h.hasClass(n, PREFIX + '-path-name')),
      selects(env).map(rowName).join(','));
    h.check('the dialog opens with what the setting says',
      selectFor(env, 'Tags: Studio → Scenes').value === 'on' &&
      selectFor(env, 'Tags: Scenes → Groups').value === 'common' &&
      selectFor(env, 'Tags: Groups → Scenes').value === 'off',
      selects(env).map((s) => s.value).join(','));
    // Only the two aggregations into a Group have a third state to offer.
    h.check('only the two common-capable paths offer a third option',
      selects(env).filter((s) => s.childNodes.length === 3).map(rowName).join(',') ===
        'Tags: Scenes → Groups,Tags: Sub-groups → Groups',
      selects(env).map((s) => rowName(s) + '=' + s.childNodes.length).join(' '));
    h.check('an enabled selector is amber, like every other control that writes',
      h.hasClass(selectFor(env, 'Tags: Studio → Scenes'), PREFIX + '-mode-on') &&
      !h.hasClass(selectFor(env, 'Tags: Groups → Scenes'), PREFIX + '-mode-on'),
      selectFor(env, 'Tags: Studio → Scenes').className);

    // It configures what a run covers rather than writing anything itself, so it
    // carries no backup instruction - there is nothing here for an Undo to reverse.
    const warn = env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-warn'))[0];
    h.check('the head says what switching a path on means, not to back up first',
      /no dialog and no undo/.test(warn.textContent) &&
      !/[Bb]ack(ing)? up your database/.test(warn.textContent), warn.textContent);

    h.check('Save is amber, like every other control that writes',
      h.hasClass(d(env).button('Save'), 'btn-warning'), d(env).button('Save').className);
    h.check('and nothing is saved until Save is pressed', saved(env).length === 0);

    setSelect(env, 'Tags: Groups → Scenes', 'on');
    setSelect(env, 'Tags: Studio → Scenes', 'off');
    d(env).button('Save').click();
    return h.flush().then(() => {
      h.check('Save writes the enabled paths, in canonical form',
        saved(env).length === 1 &&
        saved(env)[0].variables.input.b1Paths === 'tags:scene>group=COMMON, tags:group>scene=ON',
        JSON.stringify(saved(env).map((c) => c.variables.input)));
      h.check('and the dialog closes', !d(env).open);
    });
  })

  // The same rule from the dialog's own Save, which is the write a user makes most
  // often: it names one key and must still send the map it did not name.
  .then(() => open({
    settings: {
      b1Paths: 'tags:studio>scene=ON', a1ShowManualButtons: true,
      f1ExcludeTargetWithTagName: 'NoTouch', g1LogToConsole: true,
    },
  })).then((env) => {
    setSelect(env, 'Tags: Groups → Scenes', 'on');
    d(env).button('Save').click();
    return h.flush().then(() => {
      const input = saved(env).length === 1 ? saved(env)[0].variables.input : {};
      h.check('Save carries every other setting through with the paths',
        input.b1Paths === 'tags:studio>scene=ON, tags:group>scene=ON' &&
        input.a1ShowManualButtons === true &&
        input.f1ExcludeTargetWithTagName === 'NoTouch' && input.g1LogToConsole === true,
        JSON.stringify(input));
    });
  })

  .then(() => open({ settings: { b1Paths: 'tags:studio>scene=ON' } })).then((env) => {
    setSelect(env, 'Tags: Studio → Scenes', 'off');
    d(env).button('Cancel').click();
    return h.flush().then(() => {
      h.check('Cancel writes nothing and closes', !d(env).open && saved(env).length === 0,
        JSON.stringify(saved(env).map((c) => c.variables)));
    });
  })

  // A stale script is worse here than anywhere else in this plugin: Save does not add
  // to the setting, it rewrites the whole string from the paths *this* script knows,
  // so a fourteenth path added by the installed version would be dropped silently.
  .then(() => open({
    settings: { b1Paths: 'tags:studio>scene=ON' },
    installed: { id: NAME, version: '9.9.9' },
  })).then((env) => {
    h.check('the dialog calls out a stale script',
      d(env).stale.indexOf('9.9.9 is installed') !== -1 && /Ctrl\+Shift\+R/.test(d(env).stale),
      d(env).stale);
    h.check('says why Save is held back, not only how to fix it',
      /dropping anything the installed one has added/.test(d(env).stale), d(env).stale);
    h.check('and holds it back', d(env).button('Save').disabled === true);
    d(env).button('Save').click();
    return h.flush().then(() => {
      h.check('so pressing it writes nothing', saved(env).length === 0);
    });
  })

  .then(() => open({
    settings: { b1Paths: 'tags:studio>scene=ON' },
    installed: { id: 'SomeOtherPlugin', version: '9.9.9' },
  })).then((env) => {
    h.check('another plugin being out of date is not our warning',
      !d(env).stale && d(env).button('Save').disabled === false, d(env).stale);
  })

  .then(() => open({ settings: {} })).then((env) => {
    // Through the footer, like every other dialog here: the key can only ever reach a
    // button the dialog is currently offering.
    env.ctx.document.handlers.keydown.forEach((fn) => fn({ key: 'Escape', preventDefault() {} }));
    return h.flush().then(() => {
      h.check('Escape closes it too', !d(env).open);
      h.check('and takes its key handler off the document with it',
        (env.ctx.document.handlers.keydown || []).length === 0,
        String((env.ctx.document.handlers.keydown || []).length));
    });
  })

  // ── The settings row it takes over ────────────────────────────────────────
  //
  // Stash renders a STRING setting as a value span and an Edit button opening a
  // one-line text modal. For thirteen `<path id>=<mode>` pairs that modal is a place
  // to make a typo in, so both are hidden - never removed, since React owns them and
  // the setting must still be editable if this script ever stops running.

  .then(() => {
    const env = boot({ settings: { b1Paths: 'tags:scene>group=COMMON, tags:studio>scene=ON' } });
    const doc = env.ctx.document;
    const group = h.makeElement('div');
    group.className = 'setting-group';
    const row = h.makeElement('div');
    row.className = 'setting';
    row.id = 'plugin-' + NAME + '-b1Paths';
    const left = h.makeElement('div');
    const value = h.makeElement('div');
    value.className = 'value';
    value.textContent = 'tags:scene>group=COMMON, tags:studio>scene=ON';
    left.appendChild(value);
    row.appendChild(left);
    const right = h.makeElement('div');
    const edit = h.makeElement('button');
    edit.textContent = 'Edit';
    right.appendChild(edit);
    row.appendChild(right);
    group.appendChild(row);
    doc.body.appendChild(group);

    env.tick();
    return h.flush().then(() => {
      env.tick();
      const line = doc.getElementById(PREFIX + '-paths-line');
      const btn = doc.getElementById(PREFIX + '-paths-button');
      h.check('the value is replaced by the enabled paths in words',
        !!line && /Tags: Studio → Scenes/.test(line.textContent) &&
        /Tags: Scenes → Groups/.test(line.textContent), line && line.textContent);
      h.check('with the mode named for the one that has a choice to make',
        !!line && /Common tags only/.test(line.textContent), line && line.textContent);
      h.check('and nothing listed for the eleven that are off',
        !!line && !/Sub-groups/.test(line.textContent), line && line.textContent);
      // Three columns filled top to bottom, with the entries carrying a mode last so
      // the two long ones share the last column - each column is sized to its own
      // content, so scattering them would widen two columns instead of one. The row
      // count is what makes `grid-auto-flow: column` three columns rather than one.
      const list = line && line.childNodes
        .filter((n) => h.hasClass(n, PREFIX + '-pathstring-list'))[0];
      h.check('laid out in three columns, with the moded entry last',
        !!list && list.style.gridTemplateRows === 'repeat(1, auto)' &&
        list.childNodes[list.childNodes.length - 1].textContent
          .indexOf('Tags: Scenes → Groups') === 0,
        list && list.style.gridTemplateRows + ' / ' +
          list.childNodes.map((n) => n.textContent).join(' | '));
      h.check('Stash own value is hidden rather than removed',
        value.style.display === 'none' && value.parentNode === left, value.style.display);
      h.check('and so is its Edit button',
        edit.style.display === 'none' && edit.parentNode === right, edit.style.display);
      h.check('ours opens the same dialog the task does, in teal',
        !!btn && btn.textContent === TASK_PATHS && h.hasClass(btn, 'btn-info'),
        btn && btn.className);

      // React re-renders this panel on every settings change and hands its own
      // elements back; a second tick must not produce a second of anything.
      env.tick();
      h.check('a second tick adds no second line or button',
        doc.body.descendants().filter((n) => n.id === PREFIX + '-paths-line').length === 1 &&
        doc.body.descendants().filter((n) => n.id === PREFIX + '-paths-button').length === 1);

      btn.click();
      return h.flush().then(() => {
        h.check('and clicking it opens the dialog', d(env).open);
      });
    });
  })

  .then(() => {
    const env = boot({ settings: { b1Paths: '' } });
    const doc = env.ctx.document;
    const row = h.makeElement('div');
    row.className = 'setting';
    row.id = 'plugin-' + NAME + '-b1Paths';
    doc.body.appendChild(row);
    env.tick();
    return h.flush().then(() => {
      env.tick();
      const line = doc.getElementById(PREFIX + '-paths-line');
      h.check('nothing enabled says so rather than showing an empty row',
        !!line && /No paths enabled/.test(line.textContent), line && line.textContent);
      // A row count left over from a longer listing would leave the sentence in a
      // column of its own with two empty ones beside it.
      h.check('and no list is drawn for it to sit in',
        !!line && !line.childNodes.some((n) => h.hasClass(n, PREFIX + '-pathstring-list')),
        line && line.childNodes.map((n) => n.className).join(','));
    });
  })

  // **A value this script cannot fully read is left exactly as it is.** The rewrite
  // below is a convenience for a hand-typed value; run over a value it only half
  // understands, "canonical form" means "the half I recognised" and writing it deletes
  // the rest with no way back. Reported live: path settings gone after an upgrade.
  .then(() => {
    const cases = {
      'a mode this release does not have': 'tags:performer>scene=YES',
      'a path id a newer release added': 'tags:performer>scene=ON, tags:new>thing=ON',
      'nothing recognisable at all': 'who knows what this is',
    };
    return Object.keys(cases).reduce((chain, what) => chain.then(() => {
      const env = boot({ settings: { b1Paths: cases[what] } });
      const doc = env.ctx.document;
      const row = h.makeElement('div');
      row.className = 'setting';
      row.id = 'plugin-' + NAME + '-b1Paths';
      doc.body.appendChild(row);
      env.tick();
      return h.flush().then(() => {
        env.tick();
        return h.flush().then(() => {
          env.tick();
          h.check(what + ' is never written over', saved(env).length === 0,
            JSON.stringify(saved(env).map((c) => c.variables.input)));
          // "Nothing enabled" and "I could not read what is stored" look identical
          // from the paths alone and are not the same thing: the second is a value
          // still sitting in the config that this script is declining to touch.
          const line = doc.getElementById(PREFIX + '-paths-line');
          h.check('and the row says so rather than "No paths enabled"',
            !!line && /not something this script understands/.test(line.textContent) &&
            !/No paths enabled/.test(line.textContent), line && line.textContent);
        });
      });
    }), Promise.resolve());
  })

  .then(() => open({ settings: { b1Paths: 'tags:performer>scene=ON, tags:new>thing=ON' } }))
  .then((env) => {
    // Save rewrites the whole setting from the selectors, so it *will* drop what it
    // could not read - which is a fair thing to do on a press and not one to do
    // without saying so.
    h.check('and the dialog says what pressing Save would replace',
      /not something this script understands/.test(d(env).note) &&
      /replaces the whole of it/.test(d(env).note), d(env).note);
  })

  .then(() => open({ settings: { b1Paths: 'tags:performer>scene=ON' } })).then((env) => {
    h.check('a value it read completely raises no such note', !d(env).note, d(env).note);
  })

  // A config file can hold anything and Stash's own modal is still reachable if ours
  // never builds, so the value is normalized from the settings - once per distinct
  // string, so a save that fails cannot become a loop.
  .then(() => {
    const env = boot({ settings: { b1Paths: 'tags:gallery>image=on , TAGS:MARKER>SCENE=ON' } });
    const doc = env.ctx.document;
    const row = h.makeElement('div');
    row.className = 'setting';
    row.id = 'plugin-' + NAME + '-b1Paths';
    doc.body.appendChild(row);
    env.tick();
    return h.flush().then(() => {
      env.tick();
      return h.flush().then(() => {
        env.tick();
        h.check('a hand-typed value is rewritten in canonical form, once',
          saved(env).length === 1 &&
          saved(env)[0].variables.input.b1Paths === 'tags:marker>scene=ON, tags:gallery>image=ON',
          JSON.stringify(saved(env).map((c) => c.variables.input)));
      });
    });
  })

  .then(() => h.finish(), (e) => { console.error(e); process.exit(1); });
