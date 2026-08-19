// The per-type modes: the setting that holds them, the parser that forgives what is
// typed into it, and the seven selectors that let one run differ from the settings.
//
// This is what 4.0.0 replaced nine booleans with. The old shape could only say "every
// enabled type does the same thing", and the four combinations of its two auto flags
// covered three meanings - the fourth had to be documented as a no-op and warned about
// on the settings page. A tri-state per type cannot express it at all.
'use strict';
const h = require('./npt-harness');

const SCENES = [
  { id: '10', title: 'Ten', organized: false, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] },
];
const PERFORMERS = [{ id: '77', name: 'Jane', tags: [{ id: '3' }] }];
const LIB = {
  findScenes: { node: 'scenes', list: SCENES },
  findPerformers: { node: 'performers', list: PERFORMERS },
};

const RUN_KEY = '__GTTx__.nptRunModes';

function open(opts) {
  opts = opts || {};
  const env = h.makeEnv({
    quiet: true,
    respond: h.makeResponder({
      entities: opts.entities || LIB,
      settings: { a1AutoModes: opts.modes === undefined ? h.autoModes({ scenes: 'prune' }) : opts.modes },
      installed: opts.installed,
    }),
    localStorage: opts.localStorage,
  });
  h.run(env.ctx);
  h.startTask(env.ctx, opts.task || h.TASK_RUN);
  return h.flush().then(() => env);
}

// The selectors, in the order the dialog draws them - which is the processing order
// the plugin scans in, not the alphabetical one the old settings page imposed.
const selects = (env) => env.body.descendants().filter((n) => h.hasClass(n, 'npt-mode'));
const selected = (env) => selects(env).map((s) => s.value).join(',');
const rowName = (sel) => sel.parentNode.childNodes[0].textContent;
const selectFor = (env, plural) => selects(env).filter((s) => rowName(s) === plural)[0] || null;

function setSelect(env, plural, value) {
  const sel = selectFor(env, plural);
  sel.value = value;
  h.fire(sel, 'change');
}

const d = (env) => h.dialog(env.body);
const removals = (env) => d(env).lines.filter((l) => l.indexOf('[REMOVE]') === 0);
const additions = (env) => d(env).lines.filter((l) => l.indexOf('[ADD]') === 0);

Promise.resolve()

  // ── What the dialog starts from ───────────────────────────────────────────

  .then(() => open({ modes: 'SCENES=PRUNE, PERFORMERS=ROLLUP, IMAGES=PRUNE' })).then((env) => {
    h.check('one selector per entity type, in processing order',
      selects(env).map(rowName).join(',') ===
        'Performers,Studios,Groups,Galleries,Scenes,Images,Scene Markers',
      selects(env).map(rowName).join(','));
    // Images are the exception and the only one: the settings page has called them
    // the largest and slowest type since 1.0.0, and a library-wide image pass is a
    // decision per run rather than one inherited from what happens on a single save.
    h.check('the selection starts from the automatic modes, with Images off',
      selected(env) === 'rollup,off,off,off,prune,off,off', selected(env));
    h.check('and the types it covers are the ones not set to Off',
      removals(env).length === 2 && additions(env).length === 3 &&
      !d(env).lines.some((l) => /Image/.test(l)), d(env).lines.join(' | '));
  })

  .then(() => open({ modes: '' })).then((env) => {
    h.check('every type Off plans nothing and says so',
      d(env).lines.some((l) => l.indexOf('Every entity type is set to Off') !== -1),
      d(env).lines.join(' | '));
    h.check('and Proceed is not offered', d(env).button('Proceed').disabled === true);
  })

  // ── The parser ────────────────────────────────────────────────────────────
  //
  // The field is one line of text the user may edit, so anything shaped like a pair
  // is picked out wherever it sits. Each case below is read back through the run it
  // produces, which is the only thing that actually depends on the answer.

  .then(() => open({ modes: 'scene = prune' })).then((env) => {
    h.check('the singular of a type, lower case, with spaces around the =',
      selected(env) === 'off,off,off,off,prune,off,off', selected(env));
  })

  .then(() => open({ modes: 'nonsense; performers=roll up | fruit=bananas' })).then((env) => {
    h.check('a two-word Roll Up, arbitrary separators, and unknown words ignored',
      selected(env) === 'rollup,off,off,off,off,off,off', selected(env));
  })

  .then(() => open({ modes: 'SCENES=PRUNE, SCENES=ROLLUP' })).then((env) => {
    // Edited by appending far more often than by rewriting, so the last word is the
    // newest intent.
    h.check('a type named twice takes its last mention',
      selected(env) === 'off,off,off,off,rollup,off,off', selected(env));
  })

  // ── Changing the selection ────────────────────────────────────────────────

  .then(() => open({}).then((env) => {
    h.check('Proceed is armed by the first pass', d(env).button('Proceed').disabled === false);
    setSelect(env, 'Scenes', 'off');
    // What is on screen was planned for the previous selection, so pressing Proceed
    // would write something other than what the dialog now says it covers.
    h.check('changing a selector disables Proceed', d(env).button('Proceed').disabled === true);
    h.check('and offers Rescan, which is what settles the two',
      d(env).visible('Rescan'), 'hidden');
    h.check('saying so in the log', d(env).lines.some((l) => /Selection changed/.test(l)),
      d(env).lines.join(' | '));

    d(env).button('Rescan').click();
    return h.flush().then(() => {
      h.check('a rescan plans against the new selection',
        d(env).lines.some((l) => l.indexOf('--- Rescan ---') !== -1) &&
        removals(env).length === 2, d(env).lines.join(' | '));
      h.check('and does not re-seed the selectors from the settings',
        selected(env) === 'off,off,off,off,off,off,off', selected(env));
      h.check('with Proceed disabled again, since there is nothing to do',
        d(env).button('Proceed').disabled === true);
    });
  }))

  // One run, both directions - the thing nine booleans could not express.
  .then(() => open({ modes: 'SCENES=PRUNE, PERFORMERS=ROLLUP' })).then((env) => {
    h.check('one run prunes one type and rolls up another',
      removals(env).some((l) => l.indexOf('Scene "Ten" (10)') !== -1) &&
      additions(env).some((l) => l.indexOf('Performer "Jane" (77)') !== -1),
      d(env).lines.join(' | '));
    // The recap used to take its verb from the run's single mode, which a mixed run
    // has no equivalent of. Two lines, and an empty one prints nothing.
    const recap = d(env).lines.filter((l) => /tags to (remove|add):/.test(l));
    h.check('and the tag recap reports each direction in its own words',
      recap.length === 2 && /to remove:/.test(recap[0]) && /to add:/.test(recap[1]),
      recap.join(' | '));
    return env;
  }).then((env) => {
    d(env).button('Proceed').click();
    return h.flush().then(() => {
      const bulks = h.bulkCalls(env.calls);
      h.check('both directions are written',
        bulks.length === 2 &&
        bulks.some((c) => c.variables.input.tag_ids.mode === 'REMOVE') &&
        bulks.some((c) => c.variables.input.tag_ids.mode === 'ADD'),
        JSON.stringify(bulks.map((c) => c.variables.input.tag_ids.mode)));
      h.check('and the applied recap says removed and added',
        d(env).lines.some((l) => /tags removed:/.test(l)) &&
        d(env).lines.some((l) => /tags added:/.test(l)), d(env).lines.join(' | '));
    });
  })

  // ── Keeping the selection ─────────────────────────────────────────────────

  .then(() => open({})).then((env) => {
    const box = env.body.descendants().filter((n) => h.hasClass(n, 'npt-persist-box'))[0];
    h.check('the keep-this-selection box is off until it is ticked', box.checked === false);
    h.check('and nothing is stored while it is', env.storage.getItem(RUN_KEY) === null,
      String(env.storage.getItem(RUN_KEY)));

    box.checked = true;
    h.fire(box, 'change');
    h.check('ticking it stores what is selected now',
      JSON.parse(env.storage.getItem(RUN_KEY) || '{}').modes.scenes === 'prune',
      String(env.storage.getItem(RUN_KEY)));

    setSelect(env, 'Images', 'rollup');
    h.check('and a later change is stored too',
      JSON.parse(env.storage.getItem(RUN_KEY) || '{}').modes.images === 'rollup',
      String(env.storage.getItem(RUN_KEY)));

    box.checked = false;
    h.fire(box, 'change');
    h.check('unticking it forgets the selection', env.storage.getItem(RUN_KEY) === null,
      String(env.storage.getItem(RUN_KEY)));
  })

  .then(() => open({
    modes: 'SCENES=ROLLUP',
    localStorage: h.storedModes({ scenes: 'prune', images: 'prune' }),
  })).then((env) => {
    h.check('a kept selection is what the next dialog opens with, settings and all',
      selected(env) === 'off,off,off,off,prune,prune,off', selected(env));
    const box = env.body.descendants().filter((n) => h.hasClass(n, 'npt-persist-box'))[0];
    h.check('and the box is ticked, so it can be turned back off', box.checked === true);
  })

  .then(() => open({
    localStorage: { [RUN_KEY]: '{"persist":true,"modes":{"scenes":"nonsense","sofa":"prune"}}' },
  })).then((env) => {
    // Re-parsed on the way out: a hand-edited or truncated value can only read as Off.
    h.check('a stored value that is not a selection reads as Off, never as a mode',
      selected(env) === 'off,off,off,off,off,off,off', selected(env));
  })

  .then(() => open({ localStorage: { [RUN_KEY]: 'not json at all' } })).then((env) => {
    h.check('and unparseable storage falls back to the settings rather than throwing',
      selected(env) === 'off,off,off,off,prune,off,off', selected(env));
  })

  // ── The settings dialog ───────────────────────────────────────────────────

  .then(() => open({ modes: 'SCENES=PRUNE, IMAGES=ROLLUP', task: h.TASK_MODES }))
  .then((env) => {
    h.check('the settings task opens with what the setting says',
      selected(env) === 'off,off,off,off,prune,rollup,off', selected(env));
    const preview = env.body.descendants().filter((n) => h.hasClass(n, 'npt-modestring'))[0];
    h.check('and shows the string it would write',
      preview.textContent === h.autoModes({ scenes: 'prune', images: 'rollup' }),
      preview.textContent);
    // The run dialog's panel sits in the padded head; this one is the whole body, so
    // it brings its own side padding rather than touching the modal border. (4.1.1)
    const panel = env.body.descendants().filter((n) => h.hasClass(n, 'npt-modes'))[0];
    h.check('the selectors and the preview sit in a padded body',
      h.hasClass(panel.parentElement, 'npt-modesbody') &&
      preview.parentElement === panel.parentElement,
      panel.parentElement && panel.parentElement.className);
    // It configures silent writes rather than making any, so it says that instead of
    // the backup instruction the writing dialogs carry.
    const warn = env.body.descendants().filter((n) => h.hasClass(n, 'npt-warn'))[0];
    h.check('the head warns about what an automatic mode does, not about backups',
      /no dialog, no review and no undo/.test(warn.textContent) &&
      !/[Bb]ack(ing)? up your database/.test(warn.textContent), warn.textContent);

    setSelect(env, 'Scenes', 'rollup');
    h.check('the preview follows the selectors',
      preview.textContent === h.autoModes({ scenes: 'rollup', images: 'rollup' }),
      preview.textContent);
    h.check('and nothing is saved until Save is pressed',
      !env.calls.some((c) => /configurePlugin/.test(c.query || '')),
      env.calls.map((c) => c.query).join(' | '));

    d(env).button('Save').click();
    return h.flush().then(() => {
      const saved = env.calls.filter((c) => /configurePlugin/.test(c.query || ''));
      h.check('Save writes the seven pairs, in canonical form',
        saved.length === 1 &&
        saved[0].variables.input.a1AutoModes ===
          h.autoModes({ scenes: 'rollup', images: 'rollup' }),
        JSON.stringify(saved.map((c) => c.variables.input)));
      h.check('under our own plugin id', saved[0].variables.plugin_id === 'NormalizeParentTags');
      h.check('and the dialog closes', !d(env).open);
    });
  })

  .then(() => open({ modes: 'SCENES=PRUNE', task: h.TASK_MODES })).then((env) => {
    setSelect(env, 'Scenes', 'off');
    d(env).button('Cancel').click();
    return h.flush().then(() => {
      h.check('Cancel writes nothing and closes',
        !d(env).open && !env.calls.some((c) => /configurePlugin/.test(c.query || '')),
        env.calls.map((c) => c.query).join(' | '));
    });
  })

  // A stale script is worse here than anywhere else in this plugin. Save does not add
  // to the setting, it rewrites the whole string from the types and modes *this*
  // script knows - so an eighth type, or a third mode, added by the installed version
  // would be dropped without appearing anywhere. Hence: Save off, not just a warning.
  .then(() => open({
    modes: 'SCENES=PRUNE', task: h.TASK_MODES,
    installed: { id: 'NormalizeParentTags', version: '9.9.9' },
  })).then((env) => {
    h.check('the settings dialog calls out a stale script',
      d(env).stale.indexOf('9.9.9 is installed') !== -1 &&
      /Ctrl\+Shift\+R/.test(d(env).stale), d(env).stale);
    h.check('says why Save is held back rather than only how to fix it',
      /dropping anything the installed one has added/.test(d(env).stale), d(env).stale);
    h.check('and holds it back', d(env).button('Save').disabled === true);
    d(env).button('Save').click();
    return h.flush().then(() => {
      h.check('so pressing it writes nothing',
        !env.calls.some((c) => /configurePlugin/.test(c.query || '')),
        env.calls.map((c) => c.query).join(' | '));
      h.check('while the selectors stay live, so the string can still be read off',
        selects(env).every((sel) => !sel.disabled), selected(env));
    });
  })

  // The version Stash reports matching is the boring case, and the one every other
  // case in this suite runs: it must leave Save alone.
  .then(() => open({
    modes: 'SCENES=PRUNE', task: h.TASK_MODES,
    installed: { id: 'SomeOtherPlugin', version: '9.9.9' },
  })).then((env) => {
    h.check('another plugin being out of date is not our warning',
      !d(env).stale && d(env).button('Save').disabled === false, d(env).stale);
  })

  .then(() => open({ task: h.TASK_MODES })).then((env) => {
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

  .then(() => h.finish(), (e) => { console.error(e); process.exit(1); });
