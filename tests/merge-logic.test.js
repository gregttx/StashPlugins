'use strict';
const H = require('./harness.js');

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

(async function () {
  // ── #2: exclusion tag lookup must request every page ────────────────────────
  {
    console.log('\n#2 exclusion tag lookup pagination');
    const { ctx, calls } = H.makeEnv({ respond: H.responder() });
    H.run(ctx);
    await H.flush();
    await stashSceneSave(ctx, 1);
    await H.flush();
    const lookup = calls.find((c) => c.query.indexOf('FindTagByName') !== -1);
    H.check('FindTagByName sends per_page: -1',
      lookup && lookup.variables.filter && lookup.variables.filter.per_page === -1,
      lookup ? JSON.stringify(lookup.variables) : 'no lookup issued');
  }

  // ── #1 + #3: our own mutations must not re-enter the interceptor ────────────
  {
    console.log('\n#1/#3 re-entrancy guard');
    const { ctx, calls } = H.makeEnv({
      respond: H.responder({ scene: { organized: false, tags: [], performers: [
        { tags: [{ id: '10', ignore_auto_tag: false, custom_fields: {} }] }] } }),
    });
    H.run(ctx);
    await H.flush();
    const before = H.sceneUpdates(calls).length;
    await stashSceneSave(ctx, 1);
    await H.flush(80);
    const ours = H.sceneUpdates(calls).length - before - 1; // minus the simulated user save
    H.check('one merge mutation, no recursive re-merge', ours === 1, 'plugin issued ' + ours);
  }

  // ── #4: a failed mutation must not trigger a merge ──────────────────────────
  {
    console.log('\n#4 failed mutation gating');
    const { ctx, calls } = H.makeEnv({ respond: H.responder({ failSceneIds: ['1'] }) });
    H.run(ctx);
    await H.flush();
    const before = calls.length;
    // Simulate Stash's save failing (GraphQL errors, HTTP 200).
    await ctx.fetch('/graphql', { method: 'POST', body: JSON.stringify({
      query: 'mutation SceneUpdate($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }',
      variables: { input: { id: '1' } } }) });
    await H.flush(60);
    const after = calls.slice(before + 1).filter((c) => c.query.indexOf('FindScene(') !== -1);
    H.check('no merge attempted after a failed save', after.length === 0,
      after.length + ' merge queries issued');
  }

  // ── #5: one failing scene must not abort the rest of the performer loop ─────
  {
    console.log('\n#5 per-scene failure isolation');
    const { ctx, calls } = H.makeEnv({
      pathname: '/performers/7',
      respond: H.responder({
        failSceneIds: ['1'],
        scenes: [{ id: '1', organized: false, tags: [] }, { id: '2', organized: false, tags: [] },
                 { id: '3', organized: false, tags: [] }],
      }),
    });
    H.run(ctx);
    await H.flush();
    const before = calls.length;
    await stashPerformerSave(ctx, 7);
    await H.flush(120);
    const updated = H.sceneUpdates(calls.slice(before)).map((c) => c.variables.input.id).sort();
    H.check('scenes 2 and 3 still updated after scene 1 fails',
      updated.join(',') === '1,2,3', 'updated: ' + updated.join(','));
  }

  // ── #6: prototype keys must not be treated as present custom fields ─────────
  {
    console.log('\n#6 custom_fields prototype pollution');
    const { ctx, calls } = H.makeEnv({
      respond: H.responder({ scene: { organized: false, tags: [], performers: [
        { tags: [{ id: '10', ignore_auto_tag: false, custom_fields: {} },
                 { id: '11', ignore_auto_tag: false, custom_fields: {} }] }] } }),
    });
    H.run(ctx); // settings set c2ExcludeTagWithCustomFieldName: 'constructor'
    await H.flush();
    const before = calls.length;
    await stashSceneSave(ctx, 1);
    await H.flush(80);
    const upd = H.sceneUpdates(calls.slice(before + 1))[0];
    H.check('tags with no own "constructor" field are still merged',
      upd && upd.variables.input.tag_ids.length === 2,
      upd ? JSON.stringify(upd.variables.input.tag_ids) : 'no update issued (all tags excluded)');
  }

  // ── #6b: a real own custom field still excludes ─────────────────────────────
  {
    console.log('\n#6b custom field exclusion still works');
    const { ctx, calls } = H.makeEnv({
      respond: H.responder({
        settings: { c2ExcludeTagWithCustomFieldName: 'skip' },
        scene: { organized: false, tags: [], performers: [
          { tags: [{ id: '10', ignore_auto_tag: false, custom_fields: { skip: true } },
                   { id: '11', ignore_auto_tag: false, custom_fields: {} }] }] },
      }),
    });
    H.run(ctx);
    await H.flush();
    const before = calls.length;
    await stashSceneSave(ctx, 1);
    await H.flush(80);
    const upd = H.sceneUpdates(calls.slice(before + 1))[0];
    H.check('tag with skip:true excluded, other merged',
      upd && upd.variables.input.tag_ids.join(',') === '11',
      upd ? JSON.stringify(upd.variables.input.tag_ids) : 'no update issued');
  }

  // ── #11: the settings query is rate limited across navigation ──────────────
  {
    console.log('\n#11 loadSettings throttling');
    const { ctx, calls } = H.makeEnv({ respond: H.responder() });
    // Capture the click listener the plugin installs, so clicks can be simulated.
    let clickHandler = null;
    ctx.document.addEventListener = (evt, fn) => { if (evt === 'click') clickHandler = fn; };
    H.run(ctx);
    await H.flush();

    const configQueries = () =>
      calls.filter((c) => c.query && c.query.indexOf('configuration') !== -1).length;
    const atStart = configQueries();
    H.check('settings are loaded once at startup', atStart === 1, 'queries: ' + atStart);

    // Twenty link clicks in quick succession, as browsing a scene list would produce.
    const link = { closest: () => ({ tagName: 'A' }) };
    for (let i = 0; i < 20; i++) clickHandler({ target: link });
    await new Promise((r) => setTimeout(r, 500));
    await H.flush(40);

    const afterClicks = configQueries() - atStart;
    H.check('20 rapid navigations collapse into at most one settings query',
      afterClicks <= 1, 'queries fired: ' + afterClicks);

    // Past the rate limit, a further navigation is allowed through again.
    await new Promise((r) => setTimeout(r, 2100));
    const before = configQueries();
    clickHandler({ target: link });
    await new Promise((r) => setTimeout(r, 500));
    await H.flush(40);
    H.check('a navigation after the window still refreshes settings',
      configQueries() - before === 1, 'queries fired: ' + (configQueries() - before));
  }

  // ── #10: a long run of skipped scenes must not grow the stack ──────────────
  {
    console.log('\n#10 skip path is iterative, not recursive');
    // Comfortably past the ~12.5k frames a `return next()` per skip could manage.
    const COUNT = 20000;
    const scenes = [];
    for (let i = 1; i <= COUNT; i++) {
      // Every scene already carries both performer tags, so every one is skipped —
      // exactly what a second run over a performer looks like. Except the last, which
      // is missing one: reaching it proves the whole list was traversed.
      scenes.push(i === COUNT
        ? { id: String(i), organized: false, tags: [{ id: '10' }] }
        : { id: String(i), organized: false, tags: [{ id: '10' }, { id: '11' }] });
    }
    const { ctx, calls } = H.makeEnv({
      pathname: '/performers/7',
      respond: H.responder({ scenes }),
    });
    const errors = [];
    ctx.console = {
      log: console.log,
      warn() {},
      error(...a) { errors.push(a.map((x) => (x && x.message) || String(x)).join(' ')); },
    };
    H.run(ctx);
    await H.flush();
    const before = calls.length;
    await stashPerformerSave(ctx, 7);
    await H.flush(80);

    const overflow = errors.filter((e) => /call stack|RangeError/i.test(e));
    H.check(COUNT + ' consecutive skips do not overflow the stack',
      overflow.length === 0, overflow[0]);
    const updated = H.sceneUpdates(calls.slice(before)).map((c) => c.variables.input.id);
    H.check('the loop reaches the last scene and updates only it',
      updated.length === 1 && updated[0] === String(COUNT),
      'updated: ' + (updated.join(',') || 'nothing'));
  }

  // ── #6c: presence alone excludes, whatever the value ───────────────────────
  {
    console.log('\n#6c custom field presence excludes regardless of value');
    // Every falsy JSON value that a value-based rule would previously have merged.
    const falsy = [false, null, 0, ''];
    const tags = falsy.map((v, i) => (
      { id: String(20 + i), ignore_auto_tag: false, custom_fields: { skip: v } }));
    tags.push({ id: '30', ignore_auto_tag: false, custom_fields: { other: 'x' } });
    const { ctx, calls } = H.makeEnv({
      respond: H.responder({
        settings: { c2ExcludeTagWithCustomFieldName: 'skip' },
        scene: { organized: false, tags: [], performers: [{ tags: tags }] },
      }),
    });
    H.run(ctx);
    await H.flush();
    const before = calls.length;
    await stashSceneSave(ctx, 1);
    await H.flush(80);
    const upd = H.sceneUpdates(calls.slice(before + 1))[0];
    H.check('skip: false / null / 0 / "" all excluded, unrelated field merged',
      upd && upd.variables.input.tag_ids.join(',') === '30',
      upd ? JSON.stringify(upd.variables.input.tag_ids) : 'no update issued');
  }

  // ── #9: the exclusion tag itself must never be merged in ────────────────────
  {
    console.log('\n#9 exclusion tag is not propagated');
    const { ctx, calls } = H.makeEnv({
      respond: H.responder({ scene: { organized: false, tags: [], performers: [
        { tags: [{ id: '99', ignore_auto_tag: false, custom_fields: {} },   // the exclusion tag
                 { id: '11', ignore_auto_tag: false, custom_fields: {} }] }] } }),
    });
    H.run(ctx);
    await H.flush();
    const before = calls.length;
    await stashSceneSave(ctx, 1);
    await H.flush(80);
    const upd = H.sceneUpdates(calls.slice(before + 1))[0];
    H.check('exclusion tag 99 not copied onto the scene',
      upd && upd.variables.input.tag_ids.indexOf('99') === -1,
      upd ? JSON.stringify(upd.variables.input.tag_ids) : 'no update issued');
  }

  // ── #7: a cached hit must expire so a deleted tag is noticed ────────────────
  {
    console.log('\n#7 exclusion tag cache TTL');
    let tags = [{ id: '99', name: 'Do_Not_Merge' }];
    const { ctx, calls } = H.makeEnv({ respond: (req, c) => H.responder({ tags })(req, c) });
    H.run(ctx);
    await H.flush();
    await stashSceneSave(ctx, 1);
    await H.flush(60);
    const first = calls.filter((c) => c.query.indexOf('FindTagByName') !== -1).length;
    await stashSceneSave(ctx, 1);
    await H.flush(60);
    const second = calls.filter((c) => c.query.indexOf('FindTagByName') !== -1).length;
    H.check('hit is cached within the TTL', second === first, first + ' then ' + second);
  }

  // ── #12: a configured exclusion tag that matches nothing stops the merge ────
  //
  // Until 1.16.3 this warned to the console and merged unfiltered, which is the same
  // silent failure the error path already refused, reached by a typo instead of by a
  // network fault: the user believes those scenes are protected, every one of them is
  // written to, and nothing here removes a tag afterwards.
  // `PropagateTagsAndPerformers` has always stopped on this; the two were opposite.
  {
    console.log('\n#12 a missing exclusion tag stops the merge');
    const { ctx, calls } = H.makeEnv({
      respond: H.responder({
        tags: [],   // the configured name matches nothing
        scene: { organized: false, tags: [], performers: [
          { tags: [{ id: '10', ignore_auto_tag: false, custom_fields: {} }] }] },
      }),
    });
    H.run(ctx);
    await H.flush();
    const before = H.sceneUpdates(calls).length;
    await stashSceneSave(ctx, 1);
    await H.flush(80);
    const ours = H.sceneUpdates(calls).length - before - 1; // minus the simulated user save
    H.check('no merge is written while the exclusion tag is missing', ours === 0,
      'plugin issued ' + ours);
  }

  H.finish();
})();
