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
  const env = h.makeEnv({
    quiet: true, respond: responder(opts), localStorage: opts.localStorage,
    clipboard: { writeText: (t) => { env.copied = t; return Promise.resolve(); } } });
  h.run(env.ctx, SRC);
  return env;
}

function open(opts) {
  const env = boot(opts);
  return h.startTask(env.ctx, TASK_PATHS, NAME)
    .then(() => h.flush())
    .then(() => env);
}

const api = (env) => env.ctx.window.__GTTx__.ptp2re;
const d = (env) => h.dialog(env.ctx.document.body, PREFIX);
// One button per path since 3.2.0, carrying its own state as its caption. A select
// cost two clicks for every change - one to open, one to pick - and thirteen of them
// is twenty-six to set a library up.
const toggles = (env) =>
  env.ctx.document.body.descendants().filter((n) => h.hasClass(n, PREFIX + '-toggle'));
const rowName = (btn) => btn.previousSibling.textContent;
const toggleFor = (env, label) => toggles(env).filter((b) => rowName(b) === label)[0] || null;
// The default exclusion field name is seeded into `config.yml` on a fresh install -
// Stash has no `default:` for a plugin setting, so a default that is meant to be
// visible has to be written in. It carries an operation name of its own so that it is
// not read as a settings *change*, here or by the plugin's own fetch wrapper.
const saved = (env) => env.calls.filter((c) => /configurePlugin/.test(c.query || '') &&
  !/PTPSeedSettings/.test(c.query || ''));
const hasKey = (c, k) => Object.prototype.hasOwnProperty.call(c.variables.input, k);
const seeded = (env) => env.calls.filter((c) => /PTPSeedSettings/.test(c.query || ''));

// Presses until the caption is the wanted one, giving up after a full cycle rather
// than spinning: a button that cannot reach a state is the failure worth reporting.
function setMode(env, label, caption) {
  const btn = toggleFor(env, label);
  for (let i = 0; i < 4 && btn.textContent !== caption; i++) btn.click();
  return btn;
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
      env.ctx.window.__GTTx__.ptp2re.settingsFrom({}, { c1ExcludeTagWithIgnoreAutoTag: true });
      return h.flush().then(() => {
        h.check('and it is written once, not once per settings load',
          saved(env).length === 1, String(saved(env).length));
      });
    });
  })

  // ── The dialog ────────────────────────────────────────────────────────────

  .then(() => open({ settings: { b1Paths: 'tags:studio>scene=ON, tags:scene>group=COMMON' } }))
  .then((env) => {
    h.check('one button per path, thirteen of them', toggles(env).length === 13,
      String(toggles(env).length));
    // pathLabel, the same string the log and every dialog head use. A second naming of
    // a path is a second thing to keep in step.
    h.check('named the way the log names a path',
      rowName(toggles(env)[0]) ===
        api(env).pathLabel(api(env).pathById(api(env).PATH_COLUMNS[0][0])),
      toggles(env).map(rowName).join(' | '));
    // Three columns, and the layout decides both which paths are in each and where a
    // blank row separates two groups within one. Deliberately not grouped under an
    // "Into <plural>" heading: the labels already name the target, and a heading
    // emitted at a target's first path would collect every later path of that target
    // under whichever heading happened to precede it.
    const cols = env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-paths-col'));
    const named = (c) => c.childNodes.filter((r) => h.hasClass(r, PREFIX + '-path-row'))
      .map((r) => rowName(r.childNodes[1]));
    h.check('laid out in three columns, the moded pair in the last',
      cols.length === 3 && named(cols[0]).length === 6 &&
      named(cols[1]).length === 5 && named(cols[2]).length === 2,
      cols.map((c) => named(c).length).join('/'));
    // A `null` in a column is a blank row separating two groups of paths that are read
    // as one - here the two performer-assignment paths from the tag paths above them.
    h.check('and a gap where the layout asks for one, spanning both tracks',
      cols[1].childNodes.filter((n) => h.hasClass(n, PREFIX + '-path-gap')).length === 1 &&
      cols[1].childNodes.indexOf(
        cols[1].childNodes.filter((n) => h.hasClass(n, PREFIX + '-path-gap'))[0]) ===
        api(env).PATH_COLUMNS[1].indexOf(null),
      cols.map((c) => c.childNodes.map((n) => n.className).join(' ')).join(' | '));
    // `PATH_COLUMNS`, not `PATHS`: the layout is the user's grouping and the table is
    // still the order a run walks. `propagate-paths` is what pins the two against each
    // other, so this only has to prove the dialog reads the layout.
    h.check('laid out exactly as PATH_COLUMNS says',
      cols.map((c) => named(c).join(',')).join('|') ===
        api(env).PATH_COLUMNS.map((col) => col.filter(Boolean)
          .map((id) => api(env).pathLabel(api(env).pathById(id))).join(',')).join('|'),
      cols.map((c) => named(c).join(',')).join(' | '));
    const last = cols[cols.length - 1] || { childNodes: [] };
    h.check('and the moded pair is what the third column holds',
      named(last).join(',') ===
        'Tags: Scenes \u2192 Groups,Tags: Sub-groups \u2192 Groups',
      named(last).join(','));
    // Their captions run from "Off" to "Common tags only", so the column would resize
    // on every press without a floor under the button.
    h.check('and only those two carry the width floor',
      toggles(env).filter((b) => h.hasClass(b, PREFIX + '-toggle-wide')).map(rowName).join(',') ===
        'Tags: Scenes \u2192 Groups,Tags: Sub-groups \u2192 Groups',
      toggles(env).filter((b) => h.hasClass(b, PREFIX + '-toggle-wide')).map(rowName).join(','));
    h.check('and nothing groups them by target, which would break that order',
      !env.ctx.document.body.descendants().some((n) => /Into /.test(n.textContent || '') &&
        h.hasClass(n, PREFIX + '-path-name')),
      toggles(env).map(rowName).join(','));
    h.check('the dialog opens with what the setting says, on the buttons themselves',
      toggleFor(env, 'Tags: Studio → Scenes').textContent === 'On' &&
      toggleFor(env, 'Tags: Scenes → Groups').textContent === 'Common tags only' &&
      toggleFor(env, 'Tags: Groups → Scenes').textContent === 'Off',
      toggles(env).map((b) => b.textContent).join(','));
    // One click is the whole point: a select cost two for every change.
    h.check('one press turns a path on',
      (() => { const b = toggleFor(env, 'Tags: Groups → Scenes'); b.click();
        return b.textContent === 'On'; })(),
      toggleFor(env, 'Tags: Groups → Scenes').textContent);
    // Only the two aggregations into a Group have a third state, and there is no
    // tri-state button in HTML - so theirs cycles, and says so in its title.
    // Presses until the caption comes back round, so it reports the cycle and leaves
    // the button where it found it - a helper with a side effect would be re-run by
    // the failure message and report something the check never saw.
    const cycle = (label) => {
      const b = toggleFor(env, label);
      const first = b.textContent, seen = [first];
      for (let i = 0; i < 4; i++) {
        b.click();
        if (b.textContent === first) break;
        seen.push(b.textContent);
      }
      return seen;
    };
    const three = cycle('Tags: Scenes → Groups'), two = cycle('Tags: Studio → Scenes');
    h.check('only the two common-capable paths cycle through three states',
      three.length === 3 && three.indexOf('All tags') !== -1 &&
      three.indexOf('Common tags only') !== -1 && two.length === 2,
      three.join(' → ') + ' / ' + two.join(' → '));
    h.check('and the third state is named in the title, which is where the open list was',
      toggleFor(env, 'Tags: Sub-groups → Groups').title ===
        'Click to cycle: Off → All tags → Common tags only',
      toggleFor(env, 'Tags: Sub-groups → Groups').title);
    // Thirteen presses to turn a library on is what the bulk row saves. "All On /
    // Common Tags Only" is not a fourteenth state: a path that cannot take a mode
    // takes the nearest one it can, which is plain On.
    const bulk = (caption) => env.ctx.document.body.descendants()
      .filter((n) => n.tagName === 'BUTTON' && n.textContent === caption)[0];
    h.check('three bulk buttons, in the footer rather than over the columns',
      ['All Off', 'All On / All Tags', 'All On / Common Tags Only'].every(bulk) &&
      h.hasClass(bulk('All Off').parentNode.parentNode, PREFIX + '-foot'),
      env.ctx.document.body.descendants()
        .filter((n) => h.hasClass(n.parentNode || {}, PREFIX + '-paths-bulk'))
        .map((n) => n.textContent).join(' | '));
    h.check('and each says what it does, since a caption cannot',
      ['All Off', 'All On / All Tags', 'All On / Common Tags Only']
        .every((c) => /\S/.test(bulk(c).title || '')) &&
      /every one of their sources/.test(bulk('All On / Common Tags Only').title),
      bulk('All On / Common Tags Only').title);
    // Built from the path table, so a row re-routed there cannot leave a tooltip
    // describing what it used to do.
    h.check('every path name says what its path does, and the reverses say so',
      toggles(env).every((b) => /^Adds the (tags|performers) of each /
        .test(b.previousSibling.title || '')) &&
      /Runs opposite to Tags: Groups \u2192 Scenes/
        .test(toggleFor(env, 'Tags: Scenes \u2192 Groups').previousSibling.title) &&
      /Common tags only adds a tag when every one of them carries it/
        .test(toggleFor(env, 'Tags: Scenes \u2192 Groups').previousSibling.title),
      toggleFor(env, 'Tags: Scenes \u2192 Groups').previousSibling.title);
    h.check('a two-hop path says which way it gets there',
      /reached through its scenes/
        .test(toggleFor(env, 'Tags: Performers \u2192 Groups').previousSibling.title),
      toggleFor(env, 'Tags: Performers \u2192 Groups').previousSibling.title);
    h.check('All Off turns every path off in one press',
      (() => { bulk('All Off').click();
        return toggles(env).every((b) => b.textContent === 'Off'); })(),
      toggles(env).map((b) => b.textContent).join(','));
    h.check('All On / All Tags turns every path on, none of them common',
      (() => { bulk('All On / All Tags').click();
        return toggles(env).every((b) => b.textContent === 'On' || b.textContent === 'All tags') &&
          !toggles(env).some((b) => b.textContent === 'Common tags only'); })(),
      toggles(env).map((b) => b.textContent).join(','));
    h.check('All On / Common Tags Only asks for common only where common exists',
      (() => { bulk('All On / Common Tags Only').click();
        return toggles(env).filter((b) => b.textContent === 'Common tags only').length === 2 &&
          toggles(env).filter((b) => b.textContent === 'On').length === 11; })(),
      toggles(env).map((b) => b.textContent).join(','));
    bulk('All Off').click();
    setMode(env, 'Tags: Studio → Scenes', 'On');
    setMode(env, 'Tags: Scenes → Groups', 'Common tags only');
    h.check('a path that is on wears the amber every writing control here wears',
      h.hasClass(setMode(env, 'Tags: Studio → Scenes', 'On'), 'btn-warning') &&
      h.hasClass(setMode(env, 'Tags: Groups → Scenes', 'Off'), 'btn-secondary'),
      toggleFor(env, 'Tags: Studio → Scenes').className);

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

    setMode(env, 'Tags: Groups → Scenes', 'On');
    setMode(env, 'Tags: Studio → Scenes', 'Off');
    d(env).button('Save').click();
    return h.flush().then(() => {
      h.check('Save writes the enabled paths, in canonical form',
        saved(env).length === 1 &&
        saved(env)[0].variables.input.b1Paths === 'tags:scene>group=COMMON, tags:group>scene=ON',
        JSON.stringify(saved(env).map((c) => c.variables.input)));
      h.check('and the dialog closes', !d(env).open);
    });
  })

  // ── The two views ─────────────────────────────────────────────────────────
  //
  // The list is a column of names; the diagram is the graph those names describe. The
  // thing worth pinning is that they are one dialog and not two: the same thirteen
  // buttons move between the views, so a mode set in one is set in the other and
  // there is no second state to fall behind.

  .then(() => open({ settings: { b1Paths: '' } }))
  .then((env) => {
    const slots = () => env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-dia-slot'));
    const inSlots = () => slots().filter((s) => s.childNodes.length).length;
    const modal = () => env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-modal'))[0];
    const shown = (cls) => {
      const n = env.ctx.document.body.descendants().filter((x) => h.hasClass(x, cls))[0];
      return !!n && !h.hasClass(n, PREFIX + '-hidden');
    };

    h.check('the diagram is drawn with one box per entity type and one arrow per path',
      env.ctx.document.body.descendants()
        .filter((n) => h.hasClass(n, PREFIX + '-dia-box')).length === 8 &&
      slots().length === 13,
      env.ctx.document.body.descendants()
        .filter((n) => h.hasClass(n, PREFIX + '-dia-box')).length + ' boxes, ' +
      slots().length + ' arrows');

    // Tags in every box, performers in the three types that have them - which is also
    // where the two performer paths run between.
    const chips = (kind) => env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-dia-' + kind));
    h.check('each box says what it holds', chips('tags').length === 8 &&
      chips('performers').length === 3,
      chips('tags').length + ' tags, ' + chips('performers').length + ' performers');

    // Stash's own secondary button, worn by the box rather than repainted here, so a
    // themed instance themes the diagram with it.
    const boxes = () => env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-dia-box'));
    h.check('a box is one of Stash’s own buttons, not a colour of ours',
      boxes().every((b) => h.hasClass(b, 'btn') && h.hasClass(b, 'btn-secondary')),
      boxes()[0].className);

    // The arrangement is the user's, so the canvas is the size of what is on it and
    // starts at the padding - which is what lets `margin:0 auto` centre it.
    const canvasEl = env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-dia-canvas'))[0];
    const lefts = boxes().map((b) => parseFloat(b.style.left));
    const tops = boxes().map((b) => parseFloat(b.style.top));
    h.check('the picture is centred: it starts at the padding, on a canvas its own size',
      Math.min.apply(null, lefts) === 20 && Math.min.apply(null, tops) === 20 &&
      parseFloat(canvasEl.style.width) >=
        Math.max.apply(null, lefts) + 160 + 20 - 0.01,
      canvasEl.style.width + ' for ' + Math.min.apply(null, lefts) + '..' +
        Math.max.apply(null, lefts));

    // The one thing the diagram says that the list cannot: which entities this
    // configuration is currently writing into.
    const box = (label) => boxes().filter((b) => b.textContent === label)[0];
    const state = (label) => ['live', 'gives', 'idle']
      .filter((k) => h.hasClass(box(label), PREFIX + '-dia-' + k)).join('+') || 'none';
    const scene = () => box('Scene');
    h.check('no path on, so every box is doing neither',
      boxes().every((b) => h.hasClass(b, PREFIX + '-dia-idle')),
      boxes().map((b) => b.className).join(' | '));
    setMode(env, 'Tags: Studio → Scenes', 'On');
    h.check('switching a path on ambers the box it writes into and teals the one it reads',
      state('Scene') === 'live' && state('Studio') === 'gives' &&
      state('Group') === 'idle' && state('Marker') === 'idle',
      ['Scene', 'Studio', 'Group', 'Marker'].map((l) => l + ':' + state(l)).join(' '));
    // Scene is now read as well as written, which is most of them once a few paths are
    // on. Being written into is the half a user is deciding about, so it wins.
    setMode(env, 'Tags: Scenes → Groups', 'All tags');
    h.check('and a box doing both stays amber',
      state('Scene') === 'live' && state('Group') === 'live' &&
      state('Studio') === 'gives',
      ['Scene', 'Group', 'Studio'].map((l) => l + ':' + state(l)).join(' '));
    setMode(env, 'Tags: Studio → Scenes', 'Off');
    setMode(env, 'Tags: Scenes → Groups', 'Off');
    h.check('and switching them off again takes every box back',
      boxes().every((b) => h.hasClass(b, PREFIX + '-dia-idle')), scene().className);

    h.check('the footer offers the other view, in teal - it writes nothing',
      !!d(env).button('Visual view') &&
      h.hasClass(d(env).button('Visual view'), 'btn-info'),
      (d(env).button('Visual view') || {}).className);

    h.check('and the list is what it opens on',
      shown(PREFIX + '-paths') && !shown(PREFIX + '-dia') && inSlots() === 0,
      h.hasClass(modal(), PREFIX + '-narrow') ? 'narrow' : 'wide');

    d(env).button('Visual view').click();
    h.check('pressing it moves every toggle onto its arrow',
      inSlots() === 13 && toggles(env).length === 13,
      inSlots() + ' placed of ' + toggles(env).length);
    h.check('and shows the diagram in a modal wide enough for it',
      shown(PREFIX + '-dia') && !shown(PREFIX + '-paths') &&
      !h.hasClass(modal(), PREFIX + '-narrow'), modal().className);

    // Thirteen toggles on the page and thirteen of them in slots is the same thirteen:
    // a second set built for the diagram would show as twenty-six.
    h.check('every toggle in the diagram is one of the list’s own, not a copy',
      toggles(env).filter((b) => h.hasClass(b.parentNode, PREFIX + '-dia-slot')).length === 13,
      String(toggles(env).length) + ' toggles in all');

    d(env).button('List view').click();
    h.check('and going back puts them into their rows, beside their names',
      inSlots() === 0 && toggles(env).length === 13 &&
      rowName(toggleFor(env, 'Tags: Studio → Scenes')) === 'Tags: Studio → Scenes' &&
      h.hasClass(modal(), PREFIX + '-narrow'),
      toggles(env).map(rowName).join(' | '));

    // Set in one view, saved from the other. This is the whole reason the buttons
    // move rather than being built twice.
    setMode(env, 'Tags: Studio → Scenes', 'On');
    d(env).button('Visual view').click();
    // The choice is one browser's, not the library's, so it goes to localStorage
    // rather than into the setting this dialog exists to write.
    h.check('and the view it was left in is remembered',
      env.storage.items['__GTTx__.ptp2rePathsView'] === 'visual' &&
      saved(env).length === 0,
      JSON.stringify(env.storage.items));
    d(env).button('Save').click();
    return h.flush().then(() => {
      h.check('a mode set in the list is what the diagram saves',
        saved(env).length === 1 &&
        saved(env)[0].variables.input.b1Paths === 'tags:studio>scene=ON',
        JSON.stringify(saved(env).map((c) => c.variables.input)));
    });
  })

  .then(() => open({ localStorage: { '__GTTx__.ptp2rePathsView': 'visual' } }))
  .then((env) => {
    const inSlots = () => env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-dia-slot') && n.childNodes.length).length;
    h.check('a later open comes back to the diagram',
      inSlots() === 13 && !!d(env).button('List view'),
      inSlots() + ' toggles on arrows');
  })

  // Anything else is the list, so a truncated or hand-edited value cannot leave the
  // dialog in a state nothing here writes.
  .then(() => open({ localStorage: { '__GTTx__.ptp2rePathsView': 'diagram' } }))
  .then((env) => {
    const inSlots = () => env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-dia-slot') && n.childNodes.length).length;
    h.check('and a value it does not recognise opens the list',
      inSlots() === 0 && !!d(env).button('Visual view'),
      inSlots() + ' toggles on arrows');
  })

  // ── Rearranging the diagram ───────────────────────────────────────────────
  //
  // Off unless `__GTTx__.StashPluginCoop.layoutEdit` is set, which is what keeps a
  // stray drag out of the dialog everyone else opens to set thirteen toggles. What
  // a drag produces is a layout in localStorage, merged into the shipped tables by
  // id - so a release that adds a box keeps its own placement for it rather than
  // the whole arrangement being thrown away.

  .then(() => open({}))
  .then((env) => {
    const canvas = () => env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-dia-canvas'))[0];
    h.check('the diagram is not draggable until the flag is set',
      !h.hasClass(canvas(), PREFIX + '-dia-editing') &&
      !canvas().childNodes.some((n) => (n.handlers.pointerdown || []).length) &&
      !d(env).button('Copy layout'),
      canvas().className);
  })

  .then(() => {
    const env = boot({});
    env.ctx.__GTTx__.StashPluginCoop.layoutEdit = true;
    return h.startTask(env.ctx, TASK_PATHS, NAME).then(() => h.flush()).then(() => env);
  })
  .then((env) => {
    const byClass = (c) => env.ctx.document.body.descendants().filter((n) => h.hasClass(n, c));
    const canvas = byClass(PREFIX + '-dia-canvas')[0];
    const box = (i) => byClass(PREFIX + '-dia-box')[i];
    const at = (n) => n.style.left + ',' + n.style.top;
    // A real drag, through the handlers the plugin registered: down, two moves, up.
    const drag = (node, dx, dy) => {
      const ev = (x, y) => ({ clientX: x, clientY: y, button: 0, pointerId: 1,
        preventDefault() {} });
      node.handlers.pointerdown[0](ev(0, 0));
      (node.handlers.pointermove || []).forEach((f) => f(ev(dx, dy)));
      (node.handlers.pointerup || []).forEach((f) => f(ev(dx, dy)));
    };

    h.check('with the flag set, the canvas says so and every box takes a pointer',
      h.hasClass(canvas, PREFIX + '-dia-editing') &&
      byClass(PREFIX + '-dia-box').every((n) => (n.handlers.pointerdown || []).length === 1),
      canvas.className);

    const before = at(box(0));
    const arrow = byClass(PREFIX + '-dia-slot')[4];   // tags:studio>scene, one of the box's own
    const arrowBefore = at(arrow);
    drag(box(0), 40, 25);
    // The picture is centred when the dialog is built, so a box's coordinate is not
    // the one in the table - it is that one, shifted so the whole arrangement starts
    // at the padding. What a drag does to it is the same either way.
    h.check('dragging a box moves it, snapped to the grid',
      at(box(0)) === '60px,45px' && before === '20px,20px',
      before + ' -> ' + at(box(0)));
    // The arrows are drawn from the boxes, so moving one re-routes everything it
    // touches - which is the whole reason a drag redraws rather than nudging a node.
    h.check('and re-routes the arrows that start or end there',
      at(arrow) !== arrowBefore, arrowBefore + ' -> ' + at(arrow));

    h.check('the arrangement is kept in this browser, not in the setting',
      !!env.storage.items['__GTTx__.ptp2reDiagramLayout'] &&
      JSON.parse(env.storage.items['__GTTx__.ptp2reDiagramLayout']).nodes.studio.x === 60 &&
      saved(env).length === 0,
      env.storage.items['__GTTx__.ptp2reDiagramLayout']);

    // The curve is defined to pass through its toggle, so one drag sets both and the
    // button lands where it was released rather than near it.
    const slot = byClass(PREFIX + '-dia-slot')[3];   // tags:performer>scene
    const slotBefore = at(slot);
    drag(slot, -30, 20);
    const moved = at(slot).split(',').map((v) => parseFloat(v));
    const was = slotBefore.split(',').map((v) => parseFloat(v));
    const snap = (v) => Math.round(v / 5) * 5;
    h.check('dragging a toggle takes its arrow with it, landing where it was dropped',
      Math.abs(moved[0] - snap(was[0] - 30)) < 0.01 &&
      Math.abs(moved[1] - snap(was[1] + 20)) < 0.01,
      slotBefore + ' -> ' + at(slot));

    d(env).button('Copy layout').click();
    return h.flush().then(() => {
      h.check('Copy layout hands back both tables, as the source spells them',
        /\{ id: 'studio', label: 'Studio', x: 60, y: 45 \}/.test(env.copied) &&
        /var DIAGRAM_CURVE = \{/.test(env.copied) &&
        /'tags:image>gallery': \{ along: [-0-9.]+, off: [-0-9]+ \}/.test(env.copied),
        env.copied);

      d(env).button('Reset layout').click();
      h.check('Reset puts the shipped layout back, centred again, and forgets the stored one',
        at(byClass(PREFIX + '-dia-box')[0]) === '20px,20px' &&
        !env.storage.items['__GTTx__.ptp2reDiagramLayout'],
        at(byClass(PREFIX + '-dia-box')[0]));
    });
  })

  // A layout is merged by id and one entry at a time: a box it has never heard of
  // keeps the place this release gives it, and a name that has gone is ignored.
  .then(() => open({ localStorage: { '__GTTx__.ptp2reDiagramLayout': JSON.stringify({
    nodes: { scene: { x: 700, y: 400 }, atlantis: { x: 0, y: 0 } } }) } }))
  .then((env) => {
    const boxes = env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-dia-box'));
    const at = (label) => boxes.filter((b) => b.textContent === label)
      .map((b) => ({ x: parseFloat(b.style.left), y: parseFloat(b.style.top) }))[0];
    // Read as a distance rather than as two coordinates: centring moves the whole
    // picture, so what the stored entry decides is where Scene sits *relative to*
    // a box the layout says nothing about.
    const A = api(env).DIAGRAM_NODES.filter((n) => n.id === 'group')[0];
    h.check('a stored layout is drawn, and an id it names that no longer exists is ignored',
      boxes.length === 8 &&
      Math.round(at('Scene').x - at('Group').x) === 700 - A.x &&
      Math.round(at('Scene').y - at('Group').y) === 400 - A.y,
      boxes.map((b) => b.textContent + ' ' + b.style.left + ',' + b.style.top).join(' '));
  })

  .then(() => open({ localStorage: { '__GTTx__.ptp2reDiagramLayout': 'not json at all' } }))
  .then((env) => {
    const boxes = env.ctx.document.body.descendants()
      .filter((n) => h.hasClass(n, PREFIX + '-dia-box'));
    h.check('and a value it cannot read draws the shipped layout rather than nothing',
      boxes.length === 8 && boxes[0].style.left === '20px',
      boxes.map((b) => b.style.left).join(' '));
  })

  // ── A path other enabled paths already carry end to end ───────────────────
  //
  // Studio → Groups and Groups → Scenes together put a studio's tags on its groups
  // and then on those groups' scenes, so Studio → Scenes is happening whether or not
  // anyone switched it on. A dialog showing it as Off says something untrue about the
  // library, and showing it as On would claim a setting nobody made - so it is On in
  // the resting colours with the amber as letters.
  .then(() => open({
    settings: { b1Paths: 'tags:studio>group=ON, tags:group>scene=ON' },
  })).then((env) => {
    const auto = toggleFor(env, 'Tags: Studio → Scenes');
    h.check('a path two enabled paths already carry reads On without being on',
      auto.textContent === 'On' && h.hasClass(auto, PREFIX + '-toggle-auto') &&
      h.hasClass(auto, 'btn-secondary') && !h.hasClass(auto, 'btn-warning'),
      auto.textContent + ' ' + auto.className);
    h.check('and it names the paths doing the work',
      /already happening: Tags: Studio → Groups, then Tags: Groups → Scenes/.test(auto.title),
      auto.title);
    h.check('a path with only one link of its chain enabled is plainly off',
      toggleFor(env, 'Tags: Performers → Groups').textContent === 'Off' &&
      !h.hasClass(toggleFor(env, 'Tags: Performers → Groups'), PREFIX + '-toggle-auto'),
      toggleFor(env, 'Tags: Performers → Groups').className);
    // The chain is composed in pipeline order, so completing one repaints a button
    // nobody pressed - the whole panel is repainted on every press for that reason.
    setMode(env, 'Tags: Performers → Scenes', 'On');
    setMode(env, 'Tags: Scenes → Groups', 'All tags');
    h.check('completing a chain lights up the path it covers',
      h.hasClass(toggleFor(env, 'Tags: Performers → Groups'), PREFIX + '-toggle-auto'),
      toggleFor(env, 'Tags: Performers → Groups').className);
    // A link carrying only the tags all its sources share carries some of the
    // payload, and calling the path covered would overstate what the user would get.
    setMode(env, 'Tags: Scenes → Groups', 'Common tags only');
    h.check('a common-only link does not cover anything',
      !h.hasClass(toggleFor(env, 'Tags: Performers → Groups'), PREFIX + '-toggle-auto'),
      toggleFor(env, 'Tags: Performers → Groups').className);
    // Switching it on for real is still a different thing, and Save still stores it.
    // One press rather than `setMode`, which presses until the caption matches: a
    // covered button already *says* On, which is the point of it and also the reason
    // the caption alone no longer identifies the state - the colours do.
    toggleFor(env, 'Tags: Studio → Scenes').click();
    h.check('and switching a covered path on is a normal On',
      h.hasClass(toggleFor(env, 'Tags: Studio → Scenes'), 'btn-warning') &&
      !h.hasClass(toggleFor(env, 'Tags: Studio → Scenes'), PREFIX + '-toggle-auto'),
      toggleFor(env, 'Tags: Studio → Scenes').className);
    d(env).button('Save').click();
    return h.flush().then(() => {
      h.check('a covered path is written only when it was actually switched on',
        saved(env)[0].variables.input.b1Paths ===
          'tags:performer>scene=ON, tags:studio>scene=ON, tags:scene>group=COMMON, ' +
          'tags:studio>group=ON, tags:group>scene=ON',
        JSON.stringify(saved(env).map((c) => c.variables.input.b1Paths)));
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
    setMode(env, 'Tags: Groups → Scenes', 'On');
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
    setMode(env, 'Tags: Studio → Scenes', 'Off');
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
    // Four paths, two of them the marker pair - which the layout puts the other way
    // round from the order a run walks them, so the check below is about the layout
    // rather than about any order that happens to agree with it.
    const env = boot({ settings: { b1Paths: 'tags:marker>scene=ON, tags:marker>group=ON, tags:scene>group=COMMON, tags:studio>scene=ON' } });
    const doc = env.ctx.document;
    const group = h.makeElement('div');
    group.className = 'setting-group';
    const row = h.makeElement('div');
    row.className = 'setting';
    row.id = 'plugin-' + NAME + '-b1Paths';
    const left = h.makeElement('div');
    const value = h.makeElement('div');
    value.className = 'value';
    value.textContent = 'tags:marker>scene=ON, tags:marker>group=ON, tags:scene>group=COMMON, tags:studio>scene=ON';
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
      // Three columns filled top to bottom, in `PATH_COLUMNS` order - the same order
      // and grouping the dialog uses, so a path sits in the same place wherever it is
      // shown. The two entries carrying a mode land last by being the last column
      // there, which is what keeps the other two narrow: each column is sized to its
      // own content. The row count is what makes `grid-auto-flow: column` three
      // columns rather than one.
      const list = line && line.childNodes
        .filter((n) => h.hasClass(n, PREFIX + '-pathstring-list'))[0];
      h.check('laid out in three columns, in the order the dialog lays them out',
        !!list && list.style.gridTemplateRows === 'repeat(2, auto)' &&
        list.childNodes.map((n) => n.textContent.replace(/ *\(.*/, '')).join(',') ===
          ['Tags: Markers → Groups', 'Tags: Markers → Scenes',
           'Tags: Studio → Scenes', 'Tags: Scenes → Groups'].join(','),
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

  // ── The exclusion field's default, and its description ───────────────────
  .then(() => {
    const env = boot({});
    return h.flush().then(() => {
      h.check('a fresh install is given the default exclusion field name',
        seeded(env).length === 1 &&
        seeded(env)[0].variables.input.f4ExcludeTagWithCustomFieldName ===
          'ᱜ╦╦🞮_Do_Not_Propagate_Tag',
        JSON.stringify(seeded(env).map((c) => c.variables.input)));
      env.tick();
      return h.flush().then(() => {
        h.check('once per page, however many settings loads there are',
          seeded(env).length === 1, String(seeded(env).length));
      });
    });
  })

  .then(() => {
    const env = boot({ settings: { f4ExcludeTagWithCustomFieldName: 'Mine' } });
    return h.flush().then(() => {
      h.check('a name the user has set is left alone', seeded(env).length === 0,
        JSON.stringify(seeded(env).map((c) => c.variables.input)));
    });
  })

  .then(() => {
    // Cleared means "give me the standard name back", which is the opposite of
    // CustomFieldsBulkEditor's hide field - there is no off state here for an empty
    // string to mean.
    const env = boot({ settings: { f4ExcludeTagWithCustomFieldName: '' } });
    return h.flush().then(() => {
      h.check('and a cleared one gets the default back',
        seeded(env).length === 1 &&
        seeded(env)[0].variables.input.f4ExcludeTagWithCustomFieldName ===
          'ᱜ╦╦🞮_Do_Not_Propagate_Tag',
        JSON.stringify(seeded(env).map((c) => c.variables.input)));
    });
  })

  .then(() => {
    const env = boot({ settings: { a1ShowManualButtons: true } });
    return h.flush().then(() => {
      h.check('the seed carries the whole stored map, since configurePlugin replaces it',
        seeded(env)[0].variables.input.a1ShowManualButtons === true,
        JSON.stringify(seeded(env)[0].variables.input));
    });
  })

  .then(() => {
    // A value adopted from the sibling is the user having answered this already, in the
    // other plugin. Seeding over it would undo the adoption on the load that made it.
    const env = boot({ sibling: { c2ExcludeTagWithCustomFieldName: 'Theirs' } });
    return h.flush().then(() => {
      h.check('an imported name is neither overwritten nor seeded over',
        seeded(env).length === 0 &&
        saved(env).some((c) => c.variables.input.f4ExcludeTagWithCustomFieldName === 'Theirs'),
        JSON.stringify(saved(env).map((c) => c.variables.input)));
    });
  })

  .then(() => {
    // And an empty value in the sibling is not an import, so the default still lands.
    const env = boot({ sibling: { c2ExcludeTagWithCustomFieldName: '' } });
    return h.flush().then(() => {
      h.check('an empty value in the sibling is not an import',
        seeded(env).length === 1 &&
        !saved(env).some((c) => hasKey(c, 'f4ExcludeTagWithCustomFieldName')),
        JSON.stringify(saved(env).map((c) => c.variables.input)));
    });
  })

  // The description goes through CustomFieldsBulkEditor's own API, never beside it.
  .then(() => {
    const env = boot({});
    const asked = [];
    env.ctx.window.StashPluginCoop.api = env.ctx.window.StashPluginCoop.api || {};
    env.ctx.window.StashPluginCoop.api.CustomFieldsBulkEditor = {
      version: '9.9.9',
      describeField: (name, text) => { asked.push([name, text]); return Promise.resolve('added'); },
    };
    env.tick();
    return h.flush().then(() => {
      h.check('the default field is described through the sibling that owns the store',
        asked.length === 1 && asked[0][0] === 'ᱜ╦╦🞮_Do_Not_Propagate_Tag' &&
        /Never propagate a tag marked via this Custom Field/.test(asked[0][1]) &&
        /ᝯㄝₓ Propagate Tags and Performers to Related Entities/.test(asked[0][1]),
        JSON.stringify(asked));
    });
  })

  .then(() => {
    const env = boot({ sibling: { c2ExcludeTagWithCustomFieldName: 'Theirs' } });
    const asked = [];
    env.ctx.window.StashPluginCoop.api = env.ctx.window.StashPluginCoop.api || {};
    env.ctx.window.StashPluginCoop.api.CustomFieldsBulkEditor = {
      version: '9.9.9',
      describeField: (name) => { asked.push(name); return Promise.resolve('added'); },
    };
    env.tick();
    return h.flush().then(() => {
      h.check('an imported name is not described either - it is not our field',
        asked.length === 0, JSON.stringify(asked));
    });
  })

  .then(() => {
    // Absent sibling, or one too old to answer: silence. A tag exclusion filter works
    // perfectly well with no sentence explaining it.
    const env = boot({});
    env.ctx.window.StashPluginCoop.api = { CustomFieldsBulkEditor: { version: '0.1.0' } };
    env.tick();
    return h.flush().then(() => {
      h.check('a sibling with no describeField is passed over without error',
        !!env.ctx.document.body, 'no throw');
    });
  })

  .then(() => h.finish(), (e) => { console.error(e); process.exit(1); });
