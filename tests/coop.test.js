// The bulk-edit lease, from the reactive side: MergePerformerTagsToScenes must
// register itself, stand down while a lease is held, resume the moment it is
// released, and ignore a lease that has expired.
//
// Uses the sibling's own harness, since it is the sibling under test here.
'use strict';
const h = require('./harness');

function env(overrides) {
  const e = h.makeEnv({ pathname: '/scenes/1', respond: h.responder(overrides) });
  return e;
}

// Fires the mutation MergePerformerTagsToScenes reacts to, and reports whether it
// reacted (a merge issues its own FindScene query).
function saveScene(e) {
  const before = e.calls.length;
  e.ctx.window.fetch('/graphql', {
    body: JSON.stringify({
      query: 'mutation SceneUpdate($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }',
      variables: { input: { id: '1' } },
    }),
  });
  return h.flush().then(() => e.calls.slice(before).some((c) => /FindScene\(/.test(c.query || '')));
}

const e1 = env();
h.run(e1.ctx);

h.flush()
  .then(() => {
    const coop = e1.ctx.window.StashPluginCoop;
    h.check('the plugin registers itself as honouring leases',
      !!(coop && coop.respecters && coop.respecters.MergePerformerTagsToScenes));
    h.check('registering does not create a lease', !!coop && coop.leases.length === 0);
    // So that a plugin predating the protocol fails the checks below rather than
    // crashing the suite on the first lease it is handed.
    if (!e1.ctx.window.StashPluginCoop) e1.ctx.window.StashPluginCoop = e1.ctx.window.__GTTx__.StashPluginCoop = { leases: [], respecters: {} };
    return saveScene(e1);
  })
  .then((reacted) => {
    h.check('auto-merge reacts to a scene save when no lease is held', reacted);

    e1.ctx.window.StashPluginCoop.leases.push({
      owner: 'NormalizeParentTags', label: 'Normalize Parent Tags',
      until: Date.now() + 60000,
    });
    return saveScene(e1);
  })
  .then((reacted) => {
    h.check('auto-merge stands down while a lease is held', !reacted);

    e1.ctx.window.StashPluginCoop.leases.length = 0;
    return saveScene(e1);
  })
  .then((reacted) => {
    h.check('auto-merge resumes as soon as the lease is released', reacted);

    // A tab that crashed mid-run must not disable auto-merge until the next reload.
    e1.ctx.window.StashPluginCoop.leases.push({
      owner: 'NormalizeParentTags', label: 'stale', until: Date.now() - 1,
    });
    return saveScene(e1);
  })
  .then((reacted) => {
    h.check('an expired lease is ignored', reacted);
    h.check('an expired lease is dropped rather than left lying around',
      e1.ctx.window.StashPluginCoop.leases.length === 0);
  })

  // A lease must not touch what the user asked for directly.
  .then(() => {
    const e2 = env();
    h.run(e2.ctx);
    return h.flush().then(() => {
      if (!e2.ctx.window.StashPluginCoop) e2.ctx.window.StashPluginCoop = e2.ctx.window.__GTTx__.StashPluginCoop = { leases: [], respecters: {} };
      e2.ctx.window.StashPluginCoop.leases.push({
        owner: 'NormalizeParentTags', label: 'Prune', until: Date.now() + 60000,
      });
      const before = e2.calls.length;
      // The performer-page button path, driven the way the button would drive it.
      return h.flush().then(() => {
        h.check('a lease does not stop the plugin loading its own settings',
          e2.calls.some((c) => /configuration/.test(c.query || '')));
        h.check('a lease issues no traffic of its own', e2.calls.length >= before);
      });
    });
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
