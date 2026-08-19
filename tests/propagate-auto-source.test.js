// PropagateTagsAndPerformers' automatic mode, source side: reacting when something a
// path *reads from* is saved, rather than something it writes to.
//
// The write path itself - the planner, the cooldown, the lease, restraint around a
// failed save - is `runAutoTargets`, shared with the target side and already covered
// by propagate-auto.test.js. What is new here, and what this suite is about, is
// finding the affected target ids in the first place: thirteen paths, each its own
// shape of reverse lookup (`SOURCE_REVERSE`), and the mutation matcher that widens
// past the four target types to everything this plugin ever reads from.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const NAME = 'PropagateTagsAndPerformers';
const SRC = process.env.SRC || path.join(__dirname, '..', NAME, NAME + '.js');

const TAGS = [
  { id: '1', name: 'Blonde', sort_name: null, ignore_auto_tag: false },
  { id: '2', name: 'Outdoor', sort_name: null, ignore_auto_tag: false },
];

function responder(opts) {
  opts = opts || {};
  return function (req, calls) {
    const q = req.query || '';
    if (/PluginVersion/.test(q)) return { data: { plugins: [] } };
    if (q.indexOf('configuration') !== -1) {
      const plugins = {};
      plugins[NAME] = opts.raw ? (opts.settings || {}) : h.propagateSettings(opts.settings);
      return { data: { configuration: { plugins } } };
    }
    if (/PTPTags/.test(q)) return { data: { findTags: { tags: opts.tags || TAGS } } };
    // A `field`-kind reverse lookup: one source entity by id.
    let m = /query PTP_sfield_(\w+)\(/.exec(q);
    if (m) {
      const ent = (opts.sourceFields || {})[req.variables.id];
      const data = {};
      data[m[1]] = ent === undefined ? null : ent;
      return { data };
    }
    // A `filter`-kind reverse lookup: paged, server-side filtered.
    m = /query PTP_sfilter_(\w+)_(\w+)\(/.exec(q);
    if (m) {
      const spec = (opts.sourceFilters || {})[m[1] + '_' + m[2]] || { node: 'scenes', list: [] };
      const data = {};
      data[m[1]] = { count: (spec.list || []).length };
      data[m[1]][spec.node] = spec.list || [];
      return { data };
    }
    // The single-entity fetch a target reaction uses to refresh what it plans.
    m = /query PTP_one_(\w+)\(/.exec(q);
    if (m) {
      const ent = (opts.entities || {})[req.variables.id];
      const data = {};
      data[m[1]] = ent === undefined ? null : ent;
      return { data };
    }
    if (/mutation PTP_bulk/.test(q)) {
      if (opts.failWrite) return { errors: [{ message: 'write boom' }] };
      return { data: { ok: [] } };
    }
    if (/mutation Stash_/.test(q)) {
      return opts.saveFailed ? { errors: [{ message: 'save rejected' }] } : { data: { ok: { id: '1' } } };
    }
    return { data: {} };
  };
}

function start(opts) {
  const env = h.makeEnv({ respond: responder(opts), quiet: true });
  h.run(env.ctx, SRC);
  return env;
}

const sfieldCalls = (calls, one) =>
  calls.filter((c) => new RegExp('query PTP_sfield_' + (one || '\\w+') + '\\(').test(c.query || ''));
const sfilterCalls = (calls) => calls.filter((c) => /query PTP_sfilter_/.test(c.query || ''));
const oneCalls = (calls, one) =>
  calls.filter((c) => new RegExp('query PTP_one_' + (one || '\\w+') + '\\(').test(c.query || ''));
const writes = (calls) => calls.filter((c) => /mutation PTP_bulk/.test(c.query || ''));

(async () => {
  // ── `field`-kind, single hop: a saved Group names the Scenes it holds ──────
  {
    const env = start({
      settings: { a4AutoOnSourceUpdate: true, b4TagsGroupsToScenes: true },
      sourceFields: { 30: { scenes: [{ id: '10' }] } },
      entities: {
        10: {
          id: '10', title: 'S', files: [], tags: [], organized: false,
          groups: [{ group: { id: '30', name: 'Grp', tags: [{ id: '1' }] } }],
        },
      },
    });
    await h.entityUpdate(env.ctx, 'groupUpdate', { id: '30' });
    await h.flush(120);
    h.check('a group save looks up the scenes it holds', sfieldCalls(env.calls, 'findGroup').length === 1);
    h.check('the saved group is the one looked up',
      sfieldCalls(env.calls, 'findGroup')[0].variables.id === '30');
    h.check('the scene it names is refreshed', oneCalls(env.calls, 'findScene').length === 1);
    const w = writes(env.calls);
    h.check('the scene gains the group\'s tag',
      w.length === 1 && w[0].variables.input.ids.join() === '10' &&
      w[0].variables.input.tag_ids.ids.join() === '1');
  }

  // ── `field`-kind, two hops in one query: a saved Marker's scene's groups ───
  {
    const env = start({
      settings: { a4AutoOnSourceUpdate: true, e5TagsMarkersToGroups: true },
      sourceFields: { 77: { scene: { groups: [{ group: { id: '40' } }] } } },
      entities: {
        40: {
          id: '40', name: 'Grp', tags: [],
          scenes: [{ scene_markers: [{ id: '77', title: null, primary_tag: { id: '1' }, tags: [] }] }],
        },
      },
    });
    await h.entityUpdate(env.ctx, 'sceneMarkerUpdate', { id: '77' });
    await h.flush(120);
    h.check('a marker save looks up its scene\'s groups in one query',
      sfieldCalls(env.calls, 'findSceneMarker').length === 1);
    h.check('the group it names is refreshed', oneCalls(env.calls, 'findGroup').length === 1);
    const w = writes(env.calls);
    h.check('the group gains the marker\'s primary tag, through its scene',
      w.length === 1 && w[0].variables.input.tag_ids.ids.join() === '1');
  }

  // ── `filter`-kind, single hop: a saved Performer names Scenes by filter ────
  {
    const SCENE = {
      id: '10', title: 'S', files: [], tags: [], organized: false,
      performers: [{ id: '100', name: 'Jane', tags: [{ id: '1' }] }],
    };
    const env = start({
      settings: { a4AutoOnSourceUpdate: true, b1TagsPerformersToScenes: true },
      sourceFilters: { findScenes_performers: { node: 'scenes', list: [{ id: '10' }] } },
      entities: { 10: SCENE },
    });
    await h.entityUpdate(env.ctx, 'performerUpdate', { id: '100' });
    await h.flush(120);
    h.check('a performer save filters scenes server-side', sfilterCalls(env.calls).length === 1);
    h.check('filtered by the performer that was saved',
      sfilterCalls(env.calls)[0].variables.id === '100');
    h.check('the matched scene is refreshed', oneCalls(env.calls, 'findScene').length === 1);
    const w = writes(env.calls);
    h.check('the scene gains the performer\'s tag',
      w.length === 1 && w[0].variables.input.tag_ids.ids.join() === '1');
  }

  // ── `filter`-kind, two hops via a richer selection: Performer → Groups ─────
  {
    const env = start({
      settings: { a4AutoOnSourceUpdate: true, e4TagsPerformersToGroups: true },
      sourceFilters: {
        findScenes_performers: { node: 'scenes', list: [{ id: '10', groups: [{ group: { id: '40' } }] }] },
      },
      entities: {
        40: { id: '40', name: 'Grp', tags: [], scenes: [{ performers: [{ id: '100', name: 'Jane', tags: [{ id: '1' }] }] }] },
      },
    });
    await h.entityUpdate(env.ctx, 'performerUpdate', { id: '100' });
    await h.flush(120);
    h.check('the group named by the filtered scene is refreshed', oneCalls(env.calls, 'findGroup').length === 1);
    const w = writes(env.calls);
    h.check('the group gains the performer\'s tag, through the scenes that hold it',
      w.length === 1 && w[0].variables.input.tag_ids.ids.join() === '1');
  }

  // ── Restraint ───────────────────────────────────────────────────────────────
  {
    const env = start({ settings: { b1TagsPerformersToScenes: true } }); // a4 off
    await h.entityUpdate(env.ctx, 'performerUpdate', { id: '100' });
    await h.flush(60);
    h.check('with the source mode off, a save is not looked up', sfilterCalls(env.calls).length === 0);
  }
  {
    // No enabled path reads from a Studio.
    const env = start({ settings: { a4AutoOnSourceUpdate: true, b1TagsPerformersToScenes: true } });
    await h.entityUpdate(env.ctx, 'studioUpdate', { id: '5' });
    await h.flush(60);
    h.check('with no path reading that source type, a save is not looked up',
      sfieldCalls(env.calls).length === 0 && sfilterCalls(env.calls).length === 0);
  }
  {
    const env = start({
      settings: { a4AutoOnSourceUpdate: true, b1TagsPerformersToScenes: true },
      saveFailed: true,
    });
    await h.entityUpdate(env.ctx, 'performerUpdate', { id: '100' });
    await h.flush(60);
    h.check('a save Stash rejected is not looked up', sfilterCalls(env.calls).length === 0);
  }
  {
    const env = start({ settings: { a4AutoOnSourceUpdate: true, b1TagsPerformersToScenes: true } });
    env.ctx.window.StashPluginCoop = env.ctx.window.__GTTx__.StashPluginCoop = {
      leases: [{ owner: 'SomeoneElse', label: 'bulk thing', until: Date.now() + 60000 }],
      respecters: {},
    };
    await h.entityUpdate(env.ctx, 'performerUpdate', { id: '100' });
    await h.flush(60);
    h.check('it stands down while another plugin holds a lease', sfilterCalls(env.calls).length === 0);
  }

  // ── A bulk save dedupes across sources ──────────────────────────────────────
  {
    const env = start({
      settings: { a4AutoOnSourceUpdate: true, b1TagsPerformersToScenes: true },
      sourceFilters: { findScenes_performers: { node: 'scenes', list: [{ id: '10' }] } },
      entities: {
        10: {
          id: '10', title: 'S', files: [], tags: [], organized: false,
          performers: [{ id: '100', name: 'Jane', tags: [{ id: '1' }] }],
        },
      },
    });
    await h.entityUpdate(env.ctx, 'bulkPerformerUpdate', { ids: ['100', '101'] });
    await h.flush(150);
    h.check('two performers naming the same scene refresh it once',
      oneCalls(env.calls, 'findScene').length === 1);
    h.check('and write to it once', writes(env.calls).length === 1);
  }

  // ── One save can be both a target and a source at once ─────────────────────
  {
    const env = start({
      settings: {
        a3AutoOnTargetUpdate: true, a4AutoOnSourceUpdate: true,
        b1TagsPerformersToScenes: true, e1TagsScenesToGroups: true,
      },
      entities: {
        10: {
          id: '10', title: 'S', files: [], tags: [], organized: false,
          performers: [{ id: '100', name: 'Jane', tags: [{ id: '1' }] }],
        },
      },
      sourceFields: { 10: null }, // scene deleted before the group lookup - no write, just proof it ran
    });
    await h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' });
    await h.flush(150);
    h.check('the target-side refresh of the saved scene itself still runs',
      oneCalls(env.calls, 'findScene').length === 1);
    h.check('and the source-side fan-out to what reads the scene also runs',
      sfieldCalls(env.calls, 'findScene').length === 1);
  }

  // ── The mutation matcher ─────────────────────────────────────────────────────
  {
    const env = start({ settings: { a4AutoOnSourceUpdate: true } });
    const s = env.ctx.window.__ptp2re.sourceOfMutation;
    h.check('a performer save is recognised as a source',
      s('mutation X { performerUpdate(input: $i) { id } }').sourceType === 'performer');
    h.check('a bulk performer save is recognised as bulk',
      s('mutation X { bulkPerformerUpdate(input: $i) { id } }').bulk === true);
    h.check('a studio save is recognised as a source',
      s('mutation X { studioUpdate(input: $i) { id } }').sourceType === 'studio');
    h.check('a scene marker save is recognised as a source',
      s('mutation X { sceneMarkerUpdate(input: $i) { id } }').sourceType === 'marker');
    h.check('a scene save is also recognised as a source, not only a target',
      s('mutation X { sceneUpdate(input: $i) { id } }').sourceType === 'scene');
    h.check('a mutation on an entity nothing here reads from matches nothing',
      s('mutation X { tagUpdate(input: $i) { id } }') === null);
  }

  // ── Every path has a reverse lookup ───────────────────────────────────────
  {
    const env = start({ settings: { a4AutoOnSourceUpdate: true } });
    const api = env.ctx.window.__ptp2re;
    h.check('every path in PATHS has a SOURCE_REVERSE entry',
      api.PATHS.every((p) => !!api.SOURCE_REVERSE[p.id]));
  }

  h.finish();
})();
