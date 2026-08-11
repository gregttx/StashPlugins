// PropagateTagsAndPerformers' automatic mode: reacting to a save Stash made.
//
// The task is deliberate and reviewable - a dialog, a plan, a Proceed button. This is
// the opposite: no dialog, no undo, and a write that lands because the user saved
// something else. So the suite is mostly about restraint. What must NOT happen is
// larger than what must: not reacting to a save that failed, not reacting to our own
// writes, not reacting to an entity we just wrote, not reacting while a sibling holds
// a lease, and not reacting at all when the mode is off.
//
// The planner itself is `Run`'s, borrowed rather than copied, so what a reaction
// decides to add is covered by propagate-plan.test.js. What is covered here is the
// driver around it.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const NAME = 'PropagateTagsAndPerformers';
const SRC = process.env.SRC || path.join(__dirname, '..', NAME, NAME + '.js');

const TAGS = [
  { id: '1', name: 'Blonde', sort_name: null, ignore_auto_tag: false },
  { id: '2', name: 'Outdoor', sort_name: null, ignore_auto_tag: false },
  { id: '3', name: 'Skip', sort_name: null, ignore_auto_tag: false },
];

// A scene with one performer carrying "Blonde", which the scene does not have.
const SCENE = {
  id: '10', title: 'One', files: [{ basename: 'one.mp4' }],
  tags: [], organized: false,
  performers: [{ id: '100', name: 'Jane', tags: [{ id: '1' }] }],
};

function responder(opts) {
  opts = opts || {};
  return function (req, calls) {
    const q = req.query || '';
    if (/PluginVersion/.test(q)) return { data: { plugins: [] } };
    if (q.indexOf('configuration') !== -1) {
      const plugins = {};
      plugins[NAME] = opts.settings || {};
      return { data: { configuration: { plugins } } };
    }
    if (/PTPTags/.test(q)) return { data: { findTags: { tags: opts.tags || TAGS } } };
    // The single-entity fetch auto mode uses instead of paging the library.
    let m = /query PTP_one_(\w+)\(/.exec(q);
    if (m) {
      const ent = (opts.entities || {})[req.variables.id];
      const data = {};
      data[m[1]] = ent === undefined ? SCENE : ent;
      return { data };
    }
    // A reverse path's sources for one target, filtered server-side.
    m = /query PTP_rev_(\w+)\(/.exec(q);
    if (m) {
      const spec = opts.reverse || { node: 'images', list: [] };
      const data = {};
      data[m[1]] = { count: (spec.list || []).length };
      data[m[1]][spec.node] = spec.list || [];
      return { data };
    }
    if (/mutation PTP_bulk/.test(q)) {
      if (opts.failWrite) return { errors: [{ message: 'write boom' }] };
      return { data: { ok: [] } };
    }
    // The save Stash itself made, which is what the plugin is reacting to.
    if (/mutation Stash_/.test(q)) {
      return opts.saveFailed ? { errors: [{ message: 'save rejected' }] } : { data: { ok: { id: '1' } } };
    }
    return { data: {} };
  };
}

const ON = { a3AutoOnTargetUpdate: true, b1TagsPerformersToScenes: true };

function start(opts) {
  const env = h.makeEnv({ respond: responder(opts), quiet: true });
  h.run(env.ctx, SRC);
  return env;
}

const oneCalls = (calls) => calls.filter((c) => /query PTP_one_/.test(c.query || ''));
const writes = (calls) => calls.filter((c) => /mutation PTP_bulk/.test(c.query || ''));

(async () => {
  // ── It reacts, and writes an ADD delta ──────────────────────────────────
  {
    const env = start({ settings: ON });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('a scene save is reacted to', oneCalls(env.calls).length === 1);
    h.check('the saved scene is the one fetched',
      (oneCalls(env.calls)[0] || {}).variables.id === '10');
    const w = writes(env.calls);
    h.check('the reaction writes', w.length === 1);
    h.check('it writes onto the saved scene',
      w.length && w[0].variables.input.ids.join() === '10');
    h.check('it adds the performer\'s tag',
      w.length && w[0].variables.input.tag_ids.ids.join() === '1');
    h.check('as an ADD delta, never a rewritten list',
      w.length && w[0].variables.input.tag_ids.mode === 'ADD');
  }

  // ── The reaction drops what it wrote out of Apollo (0.15.1) ──────────────
  //
  // Eviction shipped in the source button's click handler alone, so an auto reaction
  // rewrote the page the user was looking at and left it showing what Stash had read
  // before the save. It now happens in `AutoRun.apply`, which is the one function every
  // headless write here goes through - both buttons and both auto modes.
  // `MergePerformerTagsToScenes` refreshes after every one of its own auto merges.
  {
    const evicted = [];
    const env = start({ settings: ON });
    env.ctx.window.__APOLLO_CLIENT__ = {
      cache: { evict: (o) => evicted.push(o.id), gc: () => { evicted.push('gc'); } },
    };
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('the scene the reaction wrote is evicted by Apollo id',
      evicted.indexOf('Scene:10') !== -1, evicted.join(','));
    h.check('and the cache is collected afterwards',
      evicted[evicted.length - 1] === 'gc', evicted.join(','));
  }
  {
    // The negative, and it is the reason eviction reads the writes rather than the
    // plan: a reaction that changed nothing must not refetch a panel that is correct.
    const evicted = [];
    const env = start({
      settings: ON,
      entities: { 10: Object.assign({}, SCENE, { tags: [{ id: '1' }] }) },  // already has it
    });
    env.ctx.window.__APOLLO_CLIENT__ = {
      cache: { evict: (o) => evicted.push(o.id), gc: () => { evicted.push('gc'); } },
    };
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('a reaction that wrote nothing evicts nothing',
      evicted.length === 0, evicted.join(','));
  }

  // ── Restraint ───────────────────────────────────────────────────────────
  {
    const env = start({ settings: { b1TagsPerformersToScenes: true } });   // mode off
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(60);
    h.check('with the mode off, a save is not reacted to', oneCalls(env.calls).length === 0);
  }
  {
    const env = start({ settings: { a3AutoOnTargetUpdate: true } });       // no path enabled
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(60);
    h.check('with no path into that target, a save is not reacted to',
      oneCalls(env.calls).length === 0);
  }
  {
    // A path into galleries does not make a scene save interesting.
    const env = start({ settings: { a3AutoOnTargetUpdate: true, c1TagsImagesToGalleries: true } });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(60);
    h.check('a path into another target does not react to this one',
      oneCalls(env.calls).length === 0);
  }
  {
    const env = start({ settings: ON, saveFailed: true });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(60);
    h.check('a save Stash rejected is not reacted to', oneCalls(env.calls).length === 0);
  }
  {
    const env = start({ settings: ON, entities: { 10: null } });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(60);
    h.check('an entity deleted before the reaction writes nothing',
      writes(env.calls).length === 0);
  }

  // ── Our own writes are not saves ────────────────────────────────────────
  {
    const env = start({ settings: ON });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(120);
    // Exactly one round: the reaction's own bulkSceneUpdate must not come back
    // through the wrapper as a fresh save.
    h.check('the reaction does not react to itself', oneCalls(env.calls).length === 1);
  }

  // ── The cooldown ────────────────────────────────────────────────────────
  {
    const env = start({ settings: ON });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    const after = oneCalls(env.calls).length;
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('a second save of an entity we just wrote is ignored',
      oneCalls(env.calls).length === after);
  }
  {
    const env = start({ settings: ON, entities: { 10: SCENE, 11: Object.assign({}, SCENE, { id: '11' }) } });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '11' });
    await h.flush(80);
    h.check('the cooldown is per entity, not global', oneCalls(env.calls).length === 2);
  }
  {
    // A write that failed did not happen, so the entity is not shielded from the
    // next save - the opposite would silently skip the retry.
    const env = start({ settings: ON, failWrite: true });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('a failed write does not start a cooldown', oneCalls(env.calls).length === 2);
  }

  // ── The lease ───────────────────────────────────────────────────────────
  {
    const env = start({ settings: ON });
    env.ctx.window.StashPluginCoop = env.ctx.window.__GTTx__.StashPluginCoop = {
      leases: [{ owner: 'SomeoneElse', label: 'bulk thing', until: Date.now() + 60000 }],
      respecters: {},
    };
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(60);
    h.check('it stands down while another plugin holds a lease',
      oneCalls(env.calls).length === 0);
  }
  {
    const env = start({ settings: ON });
    env.ctx.window.StashPluginCoop = env.ctx.window.__GTTx__.StashPluginCoop = {
      leases: [{ owner: 'SomeoneElse', label: 'stale', until: Date.now() - 1 }],
      respecters: {},
    };
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('an expired lease does not stand it down', oneCalls(env.calls).length === 1);
  }
  {
    const env = start({ settings: ON });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(120);
    h.check('the reaction releases its lease',
      (env.ctx.window.StashPluginCoop.leases || []).length === 0);
  }
  {
    const env = start({ settings: ON });
    h.check('it registers as a respecter at load',
      env.ctx.window.StashPluginCoop.respecters[NAME] === true);
  }

  // ── Bulk saves ──────────────────────────────────────────────────────────
  {
    const env = start({ settings: ON, entities: { 10: SCENE, 11: Object.assign({}, SCENE, { id: '11' }) } });
    await h.entityUpdate(env.ctx, 'bulkSceneUpdate', { ids: ['10', '11'] });
    await h.flush(120);
    h.check('a bulk save reacts to every id it names', oneCalls(env.calls).length === 2);
  }

  // ── Settings are cached ─────────────────────────────────────────────────
  {
    const env = start({ settings: ON, entities: { 10: SCENE, 11: Object.assign({}, SCENE, { id: '11' }) } });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    const before = env.calls.filter((c) => (c.query || '').indexOf('configuration') !== -1).length;
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '11' });
    await h.flush(80);
    const after = env.calls.filter((c) => (c.query || '').indexOf('configuration') !== -1).length;
    h.check('a second save inside the TTL re-reads no settings', after === before);
  }

  // ── The exclusion tag ───────────────────────────────────────────────────
  //
  // The scene here carries "Outdoor" (2) rather than "Blonde" (1) deliberately. With
  // the name match broken so that *any* tag answers, the resolver returns the first
  // tag in the map - and if that happened to be the one being copied, it would be
  // filtered out as the exclusion tag and the run would write nothing anyway. The
  // check would then pass for the wrong reason, unable to tell "refused to run" from
  // "ran and found nothing".
  const OUTDOOR = Object.assign({}, SCENE, {
    performers: [{ id: '100', name: 'Jane', tags: [{ id: '2' }] }],
  });
  {
    const env = start({
      settings: Object.assign({}, ON, { f1ExcludeTargetWithTagName: 'Nonexistent' }),
      entities: { 10: OUTDOOR },
    });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('a missing exclusion tag stops the reaction writing',
      writes(env.calls).length === 0);
  }
  {
    // And the filter works when the tag does exist: a scene carrying it is skipped.
    const env = start({
      settings: Object.assign({}, ON, { f1ExcludeTargetWithTagName: 'Skip' }),
      entities: { 10: Object.assign({}, OUTDOOR, { tags: [{ id: '3' }] }) },
    });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('an entity carrying the exclusion tag is skipped', writes(env.calls).length === 0);
  }
  {
    // The control for both: same fixture, no exclusion configured, so it writes.
    const env = start({ settings: ON, entities: { 10: OUTDOOR } });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(80);
    h.check('with no exclusion configured the same scene is written',
      writes(env.calls).length === 1);
  }

  // ── A reverse path reacts without sweeping the library ──────────────────
  {
    const env = start({
      settings: { a3AutoOnTargetUpdate: true, c1TagsImagesToGalleries: true },
      entities: { 20: { id: '20', title: 'Gal', files: [], folder: null, tags: [], organized: false } },
      reverse: { node: 'images', list: [{ id: '5', title: 'img', visual_files: [], tags: [{ id: '2' }] }] },
    });
    await h.entityUpdate(env.ctx, 'galleryUpdate', { id: '20' });
    await h.flush(120);
    const rev = env.calls.filter((c) => /query PTP_rev_/.test(c.query || ''));
    h.check('a reverse path fetches its sources filtered to the one target', rev.length === 1);
    h.check('filtered by the gallery that was saved',
      rev.length && rev[0].variables.id === '20');
    h.check('and never sweeps the library',
      env.calls.every((c) => !/PTP_sweep_/.test(c.query || '')));
    const w = writes(env.calls);
    h.check('the reverse path writes what its images carry',
      w.length === 1 && w[0].variables.input.tag_ids.ids.join() === '2');
  }

  // ── The mutation matcher ────────────────────────────────────────────────
  {
    const env = start({ settings: ON });
    const t = env.ctx.window.__ptp2re.targetOfMutation;
    h.check('sceneUpdate is recognised as a single scene save',
      t('mutation X { sceneUpdate(input: $i) { id } }').target === 'scene');
    h.check('bulkSceneUpdate is recognised as a bulk save',
      t('mutation X { bulkSceneUpdate(input: $i) { id } }').bulk === true);
    // /\bsceneUpdate\b/ does not match bulkSceneUpdate - the capital S breaks the
    // word boundary - so the two branches are not redundant.
    h.check('a bulk save is not read as a single one',
      t('mutation X { bulkSceneUpdate(input: $i) { id } }').target === 'scene' &&
      t('mutation X { bulkSceneUpdate(input: $i) { id } }').bulk === true);
    h.check('an unrelated mutation matches nothing',
      t('mutation X { performerUpdate(input: $i) { id } }') === null);
    h.check('all four targets are recognised',
      ['sceneUpdate', 'galleryUpdate', 'imageUpdate', 'groupUpdate']
        .every((f) => t('mutation X { ' + f + '(input: $i) { id } }') !== null));
  }

  // ── The single-entity query ─────────────────────────────────────────────
  {
    const env = start({ settings: ON });
    const api = env.ctx.window.__ptp2re;
    const pass = api.buildPasses(api.PATHS.filter((p) => p.id === 'tags:performer>scene'))[0];
    const one = api.oneQuery(pass);
    h.check('the single-entity query asks for one entity by id', /findScene\(id: \$id\)/.test(one));
    h.check('it selects the same fields as the paged query',
      api.targetParts(pass).every((part) => one.indexOf(part) !== -1));
    h.check('it is named apart from the paged query', /query PTP_one_findScene/.test(one));
    const rev = api.reverseQuery(api.pathById('tags:image>gallery'));
    h.check('the reverse query filters by the back-reference',
      /image_filter: \{ galleries: \{ value: \[\$id\], modifier: INCLUDES \} \}/.test(rev));
    h.check('and pages, like every other query here', /\$page: Int!, \$per_page: Int!/.test(rev));
  }

  h.finish();
})();
