// Exercises logMergesToConsole: the one-line-per-tag info log, its exact format, and
// that it only reports merges that actually happened.
'use strict';
const H = require('./harness.js');

const PREFIX = '[MergePerformerTagsToScenes]';

// Replaces the harness's real console so the info lines can be inspected. warn/error
// are swallowed: the suites that care about those assert on them themselves.
function captureConsole(ctx) {
  const info = [];
  ctx.console = { info: (m) => info.push(m), log() {}, warn() {}, error() {} };
  return info;
}

function stashSceneSave(ctx, id) {
  return ctx.fetch('/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'mutation SceneUpdate($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }',
      variables: { input: { id: String(id), title: 'x' } },
    }),
  });
}

function stashPerformerSave(ctx, id) {
  return ctx.fetch('/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'mutation PerformerUpdate($input: PerformerUpdateInput!) { performerUpdate(input: $input) { id } }',
      variables: { input: { id: String(id) } },
    }),
  });
}

const tag = (id, name) => ({ id, name, ignore_auto_tag: false, custom_fields: {} });

(async function () {
  console.log('\nmerge logging (logMergesToConsole)');

  // ── off by default: no log lines, and no extra fields requested ─────────────
  {
    const { ctx, calls } = H.makeEnv({
      respond: H.responder({
        scene: { organized: false, title: 'My Scene', tags: [{ id: '10' }],
                 performers: [{ tags: [tag('10', 'Blonde'), tag('11', 'Tattoo')] }] },
      }),
    });
    const info = captureConsole(ctx);
    H.run(ctx);
    await H.flush();
    await stashSceneSave(ctx, 1);
    await H.flush(80);
    H.check('setting off logs nothing', info.length === 0, info.join(' | '));
    const q = calls.filter((c) => c.query.indexOf('query FindScene(') !== -1)[0];
    H.check('setting off does not request the scene title or file name',
      q && q.query.indexOf('title') === -1 && q.query.indexOf('basename') === -1, q && q.query);
    H.check('setting off does not request tag names',
      q && q.query.indexOf('name') === -1, q && q.query);
  }

  // ── scene save: one "saved" line per tag actually added ─────────────────────
  {
    const { ctx } = H.makeEnv({
      respond: H.responder({
        settings: { logMergesToConsole: true },
        // Tag 10 is already on the scene, so only 11 is merged — and only 11 logged.
        scene: { organized: false, title: 'My Scene', tags: [{ id: '10' }],
                 performers: [{ tags: [tag('10', 'Blonde'), tag('11', 'Tattoo')] }] },
      }),
    });
    const info = captureConsole(ctx);
    H.run(ctx);
    await H.flush();
    await stashSceneSave(ctx, 1);
    await H.flush(80);
    H.check('one line for the one tag merged', info.length === 1, info.join(' | '));
    H.check('line matches the documented format',
      info[0] === PREFIX + ' Tag "Tattoo (11)" saved to Scene "My Scene (1)"', info[0]);
    H.check('the tag the scene already had is not logged',
      info.join(' ').indexOf('Blonde') === -1, info.join(' | '));
  }

  // ── nothing merged: nothing logged ─────────────────────────────────────────
  {
    const { ctx } = H.makeEnv({
      respond: H.responder({
        settings: { logMergesToConsole: true },
        scene: { organized: false, title: 'My Scene', tags: [{ id: '10' }, { id: '11' }],
                 performers: [{ tags: [tag('10', 'Blonde'), tag('11', 'Tattoo')] }] },
      }),
    });
    const info = captureConsole(ctx);
    H.run(ctx);
    await H.flush();
    await stashSceneSave(ctx, 1);
    await H.flush(80);
    H.check('a scene that already has every tag logs nothing', info.length === 0, info.join(' | '));
  }

  // ── performer save: per-scene lines, title falls back to the file name ──────
  {
    const { ctx } = H.makeEnv({
      pathname: '/performers/7',
      respond: H.responder({
        settings: { logMergesToConsole: true },
        performer: { tags: [tag('10', 'Blonde'), tag('11', 'Tattoo')] },
        scenes: [
          { id: '1', organized: false, tags: [], title: 'Scene One' },
          // No title, as untitled Stash scenes have: the file name stands in.
          { id: '2', organized: false, tags: [{ id: '10' }], title: '',
            files: [{ basename: 'clip2.mp4' }] },
        ],
      }),
    });
    const info = captureConsole(ctx);
    H.run(ctx);
    await H.flush();
    await stashPerformerSave(ctx, 7);
    await H.flush(120);
    H.check('three lines: both tags for scene 1, the missing one for scene 2',
      info.length === 3, info.join(' | '));
    H.check('scene 1 logs both tags against its title',
      info.indexOf(PREFIX + ' Tag "Blonde (10)" saved to Scene "Scene One (1)"') !== -1 &&
      info.indexOf(PREFIX + ' Tag "Tattoo (11)" saved to Scene "Scene One (1)"') !== -1,
      info.join(' | '));
    H.check('an untitled scene is named by its file',
      info.indexOf(PREFIX + ' Tag "Tattoo (11)" saved to Scene "clip2.mp4 (2)"') !== -1,
      info.join(' | '));
    H.check('the tag scene 2 already had is not logged against it',
      info.join(' ').indexOf('Tag "Blonde (10)" saved to Scene "clip2.mp4') === -1,
      info.join(' | '));
  }

  // ── a scene whose update fails must not be logged as merged ────────────────
  {
    const { ctx } = H.makeEnv({
      pathname: '/performers/7',
      respond: H.responder({
        settings: { logMergesToConsole: true },
        failSceneIds: ['1'],
        performer: { tags: [tag('10', 'Blonde')] },
        scenes: [{ id: '1', organized: false, tags: [], title: 'Fails' },
                 { id: '2', organized: false, tags: [], title: 'Works' }],
      }),
    });
    const info = captureConsole(ctx);
    H.run(ctx);
    await H.flush();
    await stashPerformerSave(ctx, 7);
    await H.flush(120);
    H.check('the failing scene is not logged',
      info.join(' ').indexOf('Fails') === -1, info.join(' | '));
    H.check('the scene that did save still is',
      info.length === 1 && info[0].indexOf('Scene "Works (2)"') !== -1, info.join(' | '));
  }

  // ── staging reports "staged", not "saved" ──────────────────────────────────
  {
    const form = { tags: [{ id: '10', name: 'Blonde', aliases: [] }] };
    form.onSetTags = (items) => { form.tags = items; };
    const clicks = [];
    const { ctx } = H.makeEnv({
      pathname: '/scenes/1',
      fastTick: true,
      containers: { '.edit-buttons': true },
      respond: (req) => {
        const q = req.query;
        if (q.indexOf('configuration') !== -1) {
          return { data: { configuration: { plugins: { MergePerformerTagsToScenes: {
            showManualMergeButtons: true, logMergesToConsole: true } } } } };
        }
        if (q.indexOf('FindScenePerformers') !== -1) {
          return { data: { findScene: { performers: [{ id: '7' }] } } };
        }
        if (q.indexOf('FindSceneForStaging') !== -1) {
          return { data: { findScene: { organized: false, title: 'Staged Scene',
            tags: [{ id: '10' }],
            performers: [{ tags: [
              { id: '10', name: 'Blonde', aliases: [], image_path: '/t/10', ignore_auto_tag: false },
              { id: '11', name: 'Tattoo', aliases: [], image_path: '/t/11', ignore_auto_tag: false },
            ] }] } } };
        }
        return { data: {} };
      },
    });
    ctx.document.createElement = () => ({
      type: '', className: '', textContent: '', title: '', disabled: false,
      addEventListener: (evt, fn) => { if (evt === 'click') clicks.push(fn); },
    });
    ctx.document.querySelector = (s) =>
      s === '.edit-buttons' ? { appendChild() {}, insertBefore() {}, querySelector: () => null } : null;
    ctx.alert = () => {};
    const patches = {};
    ctx.PluginApi = { patch: { before: (n, fn) => { patches[n] = fn; } } };
    ctx.window.PluginApi = ctx.PluginApi;
    const info = captureConsole(ctx);
    H.run(ctx);
    await H.flush();
    patches.TagSelect({ isMulti: true, onSelect: form.onSetTags, values: form.tags });
    await H.flush();
    clicks[clicks.length - 1]({
      preventDefault() {}, currentTarget: { textContent: 'Add Perf Tags', disabled: false } });
    await H.flush(60);
    H.check('staging logs one line for the staged tag', info.length === 1, info.join(' | '));
    H.check('and calls the action "staged"',
      info[0] === PREFIX + ' Tag "Tattoo (11)" staged to Scene "Staged Scene (1)"', info[0]);
  }

  H.finish();
})();
