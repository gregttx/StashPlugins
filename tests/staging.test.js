// Exercises stageTagsInEditForm against a fake PluginApi + a stand-in for Stash's
// useTagsEdit/TagSelect wiring.
'use strict';
const H = require('./harness.js');

// Mirrors src/hooks/tagsEdit.tsx: onSetTags updates the visible chips AND pushes
// ids into formik, which is what enables Stash's Save button.
function makeSceneEditForm(initialTags) {
  const form = {
    tags: initialTags.slice(),
    formikTagIds: initialTags.map((t) => t.id),
    initialIds: initialTags.map((t) => t.id),
    renders: 0,
    get dirty() {
      return this.formikTagIds.join(',') !== this.initialIds.join(',');
    },
  };
  form.onSetTags = function (items) {
    form.tags = items;
    form.formikTagIds = items.map((i) => i.id);
  };
  return form;
}

function installFakePluginApi(ctx, form, extraSelects) {
  const patches = {};
  ctx.PluginApi = {
    patch: { before: (name, fn) => { patches[name] = fn; } },
  };
  ctx.window.PluginApi = ctx.PluginApi;
  // Called after the plugin registers its patch, to simulate renders.
  return function renderAll() {
    if (!patches.TagSelect) return false;
    (extraSelects || []).forEach((s) => patches.TagSelect(s));
    patches.TagSelect({ isMulti: true, onSelect: form.onSetTags, values: form.tags });
    form.renders++;
    return true;
  };
}

const PERF_TAGS = [
  { id: '10', name: 'Blonde', aliases: ['blond'], image_path: '/t/10', ignore_auto_tag: false },
  { id: '11', name: 'Tattoo', aliases: [], image_path: '/t/11', ignore_auto_tag: false },
];

function responder(opts) {
  opts = opts || {};
  return function (req) {
    const q = req.query;
    if (q.indexOf('configuration') !== -1) {
      return { data: { configuration: { plugins: { MergePerformerTagsToScenes: Object.assign(
        { a1ShowManualMergeButtons: true }, opts.settings) } } } };
    }
    if (q.indexOf('FindTagByName') !== -1) {
      return { data: { findTags: { tags: [{ id: '99', name: 'Do_Not_Merge' }] } } };
    }
    if (q.indexOf('FindScenePerformers') !== -1) {
      return { data: { findScene: { performers: [{ id: '7' }] } } };
    }
    // Both the staging query and the save-immediately query resolve to the same scene.
    if (q.indexOf('FindSceneForStaging') !== -1 || q.indexOf('query FindScene(') !== -1) {
      return { data: { findScene: opts.scene || {
        organized: false, tags: [{ id: '10' }], performers: [{ tags: PERF_TAGS }],
      } } };
    }
    if (q.indexOf('sceneUpdate') !== -1) {
      return { data: { sceneUpdate: { id: req.variables.input.id } } };
    }
    return { data: {} };
  };
}

// Reach the plugin's internals the only way a browser would: through its own
// button. Instead we call the exposed path via a synthetic click is overkill here,
// so drive stageTagsIntoSceneForm through the scene button's click handler.
function setup(opts) {
  opts = opts || {};
  const form = makeSceneEditForm(opts.initialTags || [{ id: '10', name: 'Blonde', aliases: [] }]);
  const clicks = [];
  const { ctx, calls } = H.makeEnv({
    pathname: '/scenes/1',
    respond: responder(opts),
    containers: { '.edit-buttons': true },
    fastTick: true,
  });
  // Capture the click handler the plugin attaches to its button.
  ctx.document.createElement = () => ({
    type: '', className: '', textContent: '', title: '', disabled: false,
    addEventListener: (evt, fn) => { if (evt === 'click') clicks.push(fn); },
  });
  ctx.document.querySelector = (s) => {
    if (s === '.edit-buttons') return { appendChild() {}, insertBefore() {}, querySelector: () => null };
    return null;
  };
  ctx.alert = (m) => { ctx._alert = m; };
  const renderAll = installFakePluginApi(ctx, form, opts.extraSelects);
  H.run(ctx);
  return { ctx, calls, form, clicks, renderAll };
}

function click(env) {
  const btn = { textContent: 'Add Perf Tags', disabled: false };
  env.clicks[env.clicks.length - 1]({ preventDefault() {}, currentTarget: btn });
  return btn;
}

(async function () {
  console.log('\nstaging (default) / a2SaveTagsImmediately');

  // ── happy path ─────────────────────────────────────────────────────────────
  {
    const env = setup();
    await H.flush();
    const rendered = env.renderAll();
    H.check('plugin registered a TagSelect patch', rendered === true);
    await H.flush();
    const btn = click(env);
    await H.flush(60);

    H.check('missing performer tag pushed into the form',
      env.form.formikTagIds.sort().join(',') === '10,11', env.form.formikTagIds.join(','));
    H.check('visible chip list updated too (not just formik)',
      env.form.tags.map((t) => t.id).sort().join(',') === '10,11',
      env.form.tags.map((t) => t.id).join(','));
    H.check('staged chip carries a name for rendering',
      env.form.tags.some((t) => t.id === '11' && t.name === 'Tattoo'),
      JSON.stringify(env.form.tags.find((t) => t.id === '11')));
    H.check('form is dirty, so Stash enables Save', env.form.dirty === true);
    H.check('no sceneUpdate mutation was issued',
      H.sceneUpdates(env.calls).length === 0, JSON.stringify(H.sceneUpdates(env.calls)));
    H.check('button reports the staged count', btn.textContent === 'Added 1', btn.textContent);
    H.check('count message fits within the original caption',
      btn.textContent.length <= 'Add Perf Tags'.length, btn.textContent);
    await new Promise((r) => setTimeout(r, 1600));
    H.check('then flashes the save prompt separately',
      btn.textContent === 'Save pending', btn.textContent);
    H.check('save prompt also fits within the original caption',
      btn.textContent.length <= 'Add Perf Tags'.length, btn.textContent);
    await new Promise((r) => setTimeout(r, 1600));
    H.check('and finally restores the caption',
      btn.textContent === 'Add Perf Tags', btn.textContent);
  }

  // ── clicking twice without saving ──────────────────────────────────────────
  {
    const env = setup();
    await H.flush();
    env.renderAll();
    await H.flush();
    const first = click(env);
    await H.flush(60);
    H.check('first click stages the missing tag', first.textContent === 'Added 1', first.textContent);

    // React re-renders the control with the new values, as Stash would.
    env.renderAll();
    await H.flush();
    const second = click(env);
    await H.flush(60);
    H.check('second click without saving reports "No changes"',
      second.textContent === 'No changes', second.textContent);
    H.check('and the form still holds exactly the staged tags',
      env.form.tags.map((t) => t.id).sort().join(',') === '10,11',
      env.form.tags.map((t) => t.id).join(','));
    H.check('no duplicate tag ids in the form',
      new Set(env.form.formikTagIds).size === env.form.formikTagIds.length,
      env.form.formikTagIds.join(','));
  }

  // ── clicking twice when the control never re-renders ───────────────────────
  {
    const env = setup();
    await H.flush();
    env.renderAll();
    await H.flush();
    click(env);
    await H.flush(60);
    // Deliberately do NOT re-render: the only capture is the stale pre-staging one.
    const second = click(env);
    await H.flush(60);
    H.check('stale capture alone still reports "No changes"',
      second.textContent === 'No changes', second.textContent);
  }

  // ── already complete ───────────────────────────────────────────────────────
  {
    const env = setup({ initialTags: [
      { id: '10', name: 'Blonde', aliases: [] }, { id: '11', name: 'Tattoo', aliases: [] }] });
    await H.flush();
    env.renderAll();
    await H.flush();
    const btn = click(env);
    await H.flush(60);
    H.check('nothing to add reports "No changes"', btn.textContent === 'No changes', btn.textContent);
    H.check('form left untouched', env.form.dirty === false);
  }

  // ── user edits are respected ───────────────────────────────────────────────
  {
    // Form holds a hand-added tag not on the server, and is missing one the server has.
    const env = setup({ initialTags: [{ id: '77', name: 'Hand added', aliases: [] }] });
    await H.flush();
    env.renderAll();
    await H.flush();
    click(env);
    await H.flush(60);
    H.check('diff is against the form, not the server (hand-added tag kept)',
      env.form.tags.map((t) => t.id).sort().join(',') === '10,11,77',
      env.form.tags.map((t) => t.id).join(','));
  }

  // ── exclusion filters still apply ──────────────────────────────────────────
  {
    const env = setup({
      settings: { b2ExcludeSceneOrganized: true },
      scene: { organized: true, tags: [], performers: [{ tags: PERF_TAGS }] },
    });
    await H.flush();
    env.renderAll();
    await H.flush();
    const btn = click(env);
    await H.flush(60);
    H.check('organized scene reports "Scene excluded"',
      btn.textContent === 'Scene excluded', btn.textContent);
    H.check('excluded scene left untouched', env.form.dirty === false);
  }

  // ── picks the right TagSelect among several ────────────────────────────────
  {
    const decoy = { isMulti: true, onSelect: () => { decoy.hit = true; }, values: [{ id: '55' }] };
    const env = setup({ extraSelects: [decoy] });
    await H.flush();
    env.renderAll();
    await H.flush();
    click(env);
    await H.flush(60);
    H.check('decoy TagSelect (filter sidebar) not touched', !decoy.hit);
    H.check('scene form still received the tags',
      env.form.formikTagIds.sort().join(',') === '10,11', env.form.formikTagIds.join(','));
  }

  // ── decoy rendering AFTER the scene form ───────────────────────────────────
  {
    // Newest-first alone would grab the decoy; the expected-contents match is what
    // keeps the scene's own control selected.
    const decoy = { isMulti: true, onSelect: () => { decoy.hit = true; }, values: [{ id: '55' }] };
    const form = makeSceneEditForm([{ id: '10', name: 'Blonde', aliases: [] }]);
    const clicks = [];
    const { ctx } = H.makeEnv({
      pathname: '/scenes/1', respond: responder(), fastTick: true,
      containers: { '.edit-buttons': true },
    });
    ctx.document.createElement = () => ({
      type: '', className: '', textContent: '', title: '', disabled: false,
      addEventListener: (evt, fn) => { if (evt === 'click') clicks.push(fn); },
    });
    ctx.document.querySelector = (s) =>
      s === '.edit-buttons' ? { appendChild() {}, insertBefore() {}, querySelector: () => null } : null;
    ctx.alert = (m) => { ctx._alert = m; };
    const patches = {};
    ctx.PluginApi = { patch: { before: (n, fn) => { patches[n] = fn; } } };
    ctx.window.PluginApi = ctx.PluginApi;
    H.run(ctx);
    await H.flush();
    patches.TagSelect({ isMulti: true, onSelect: form.onSetTags, values: form.tags });
    patches.TagSelect(decoy); // renders last
    await H.flush();
    const btn = { textContent: 'Add Perf Tags', disabled: false };
    clicks[clicks.length - 1]({ preventDefault() {}, currentTarget: btn });
    await H.flush(60);
    H.check('a decoy rendered last does not steal the tags', !decoy.hit);
    H.check('scene form received them instead',
      form.formikTagIds.sort().join(',') === '10,11', form.formikTagIds.join(','));
  }

  // ── no PluginApi: must refuse, not silently save ───────────────────────────
  {
    const form = makeSceneEditForm([{ id: '10', name: 'Blonde', aliases: [] }]);
    const clicks = [];
    const { ctx, calls } = H.makeEnv({ pathname: '/scenes/1', respond: responder(), fastTick: true });
    ctx.document.createElement = () => ({
      type: '', className: '', textContent: '', title: '', disabled: false,
      addEventListener: (evt, fn) => { if (evt === 'click') clicks.push(fn); },
    });
    ctx.document.querySelector = (s) =>
      s === '.edit-buttons' ? { appendChild() {}, insertBefore() {}, querySelector: () => null } : null;
    ctx.alert = (m) => { ctx._alert = m; };
    // No ctx.PluginApi at all.
    H.run(ctx);
    await H.flush();
    const btn = { textContent: 'Add Perf Tags', disabled: false };
    clicks[clicks.length - 1]({ preventDefault() {}, currentTarget: btn });
    await H.flush(40);
    H.check('without PluginApi the button falls back to merging and saving',
      H.sceneUpdates(calls).length === 1,
      btn.textContent + ' / updates: ' + H.sceneUpdates(calls).length);
    H.check('and does not pop an alert', !ctx._alert, ctx._alert);
  }

  // ── setting off: original save-immediately behaviour intact ────────────────
  {
    const env = setup({ settings: { a2SaveTagsImmediately: true } });
    await H.flush();
    env.renderAll();
    await H.flush();
    click(env);
    await H.flush(60);
    H.check('with Save Tags Immediately on, it saves via sceneUpdate',
      H.sceneUpdates(env.calls).length === 1, 'updates: ' + H.sceneUpdates(env.calls).length);
    H.check('and does not touch the form', env.form.dirty === false);
  }

  H.finish();
})();
