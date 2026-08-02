// Planning: what Prune and Roll Up decide to change, and what the filters protect.
//
// Every case drives a whole run through the plugin - settings query, tag query,
// entity paging, dialog - and reads the answer off the dialog's own log, because
// that log is the thing the user actually reviews before pressing Proceed.
'use strict';
const h = require('./npt-harness');

const scenes = (list) => ({ findScenes: { node: 'scenes', list: list } });

// Runs one task to the end of phase 1 and hands back the dialog and the calls.
function scan(opts, task) {
  const env = h.makeEnv({ quiet: true, respond: h.makeResponder(opts) });
  h.run(env.ctx);
  h.startTask(env.ctx, task || h.TASK_PRUNE);
  return h.flush().then(() => ({
    d: h.dialog(env.body), calls: env.calls, ctx: env.ctx, body: env.body,
  }));
}

const removals = (d) => d.lines.filter((l) => l.indexOf('[REMOVE]') === 0);
const additions = (d) => d.lines.filter((l) => l.indexOf('[ADD]') === 0);

Promise.resolve()

  // ── Prune ────────────────────────────────────────────────────────────────
  .then(() => scan({
    entities: scenes([{ id: '10', title: 'Chain', organized: false, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] }]),
  })).then(({ d }) => {
    // 1 -> 2 -> 3 all present: only the leaf survives, in one pass, both parents go.
    const r = removals(d);
    h.check('prune removes every implied ancestor of a chain', r.length === 2, r.join(' | '));
    h.check('prune keeps the most specific tag', !r.some((l) => l.indexOf('Platinum') !== -1), r.join(' | '));
    h.check('prune names entity and tag with ids', r[0].indexOf('Scene "Chain (10)"') !== -1, r[0]);
  })

  .then(() => scan({
    entities: scenes([{ id: '11', title: 'Intermediate', organized: false, tags: [{ id: '1' }, { id: '2' }] }]),
  })).then(({ d }) => {
    const r = removals(d);
    // 2 is an intermediate tag with a child (3) that is NOT present, so it stays.
    h.check('prune keeps an intermediate tag whose children are absent',
      r.length === 1 && r[0].indexOf('Hair Colour') !== -1, r.join(' | '));
  })

  .then(() => scan({
    entities: scenes([{ id: '12', title: 'Diamond', organized: false, tags: [{ id: '3' }, { id: '6' }, { id: '2' }] }]),
  })).then(({ d }) => {
    const r = removals(d);
    // Platinum has two parents; both are implied and both go.
    h.check('prune follows every branch of a diamond', r.length === 2, r.join(' | '));
  })

  .then(() => scan({
    entities: scenes([{ id: '13', title: 'Unrelated', organized: false, tags: [{ id: '2' }, { id: '5' }] }]),
  })).then(({ d }) => {
    h.check('prune leaves unrelated tags alone', removals(d).length === 0);
    h.check('an empty plan disables Proceed', d.button('Proceed').disabled === true);
    h.check('an empty plan says so', d.lines.some((l) => l.indexOf('Nothing to change') !== -1),
      d.lines.join(' | '));
  })

  // ── Roll Up ──────────────────────────────────────────────────────────────
  .then(() => scan({
    entities: scenes([{ id: '20', title: 'Leaf', organized: false, tags: [{ id: '3' }] }]),
  }, h.TASK_ROLLUP)).then(({ d }) => {
    const a = additions(d);
    h.check('roll up adds every ancestor recursively', a.length === 3, a.join(' | '));
    h.check('roll up does not re-add what is present', !a.some((l) => l.indexOf('Platinum') !== -1), a.join(' | '));
  })

  // ── Entity-level filters ─────────────────────────────────────────────────
  .then(() => scan({
    settings: { enableScenes: true, excludeOrganized: true },
    entities: scenes([
      { id: '30', title: 'Organized', organized: true, tags: [{ id: '1' }, { id: '2' }] },
      { id: '31', title: 'Loose', organized: false, tags: [{ id: '1' }, { id: '2' }] },
    ]),
  })).then(({ d }) => {
    const r = removals(d);
    h.check('organized entities are skipped', r.length === 1 && r[0].indexOf('Loose') !== -1, r.join(' | '));
  })

  .then(() => scan({
    settings: { enableScenes: true, excludeEntityWithTagName: 'Rare' },
    entities: scenes([
      { id: '32', title: 'Protected', organized: false, tags: [{ id: '1' }, { id: '2' }, { id: '6' }] },
      { id: '33', title: 'Open', organized: false, tags: [{ id: '1' }, { id: '2' }] },
    ]),
  })).then(({ d }) => {
    const r = removals(d);
    h.check('entities carrying the exclusion tag are skipped',
      r.length === 1 && r[0].indexOf('Open') !== -1, r.join(' | '));
  })

  .then(() => scan({
    settings: { enableScenes: true, excludeEntityWithTagName: 'rare' },
    entities: scenes([{ id: '34', title: 'Any', organized: false, tags: [{ id: '1' }, { id: '2' }] }]),
  })).then(({ d, calls }) => {
    // Case-sensitive: "rare" does not match "Rare", and running unfiltered would
    // touch the entities the user asked to protect - so the run stops instead.
    h.check('an unmatched exclusion tag name aborts the scan',
      d.lines.some((l) => l.indexOf('[ERROR]') === 0 && l.indexOf('No tag is named "rare"') !== -1),
      d.lines.join(' | '));
    h.check('nothing is scanned once the exclusion tag is missing',
      !calls.some((c) => /query NPT_findScenes/.test(c.query || '')));
  })

  // ── Tag-level filters ────────────────────────────────────────────────────
  .then(() => scan({
    settings: { enableScenes: true, excludeRemoveTagNameContains: 'Hair' },
    entities: scenes([{ id: '40', title: 'Chain', organized: false, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] }]),
  })).then(({ d }) => {
    const r = removals(d);
    h.check('a protected name is not removed',
      r.length === 1 && r[0].indexOf('Blonde') !== -1, r.join(' | '));
  })

  .then(() => scan({
    settings: { enableScenes: true, excludeAddTagNameContains: 'Hair' },
    entities: scenes([{ id: '41', title: 'Leaf', organized: false, tags: [{ id: '3' }] }]),
  }, h.TASK_ROLLUP)).then(({ d }) => {
    const a = additions(d);
    // Skipping Hair Colour must not stop the climb - but it has no parents, so the
    // check that matters is that Blonde and Rare still arrive.
    h.check('a blocked tag is skipped, not treated as a wall',
      a.length === 2 && !a.some((l) => l.indexOf('Hair Colour') !== -1), a.join(' | '));
  })

  .then(() => scan({
    settings: { enableScenes: true, excludeTagWithIgnoreAutoTag: true },
    tags: h.TAGS.map((t) => (t.id === '1' ? Object.assign({}, t, { ignore_auto_tag: true }) : t)),
    entities: scenes([{ id: '42', title: 'Chain', organized: false, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] }]),
  })).then(({ d }) => {
    const r = removals(d);
    h.check('ignore_auto_tag protects in both directions',
      r.length === 1 && r[0].indexOf('Blonde') !== -1, r.join(' | '));
  })

  .then(() => scan({
    settings: { enableScenes: true, excludeRemoveTagWithCustomFieldName: 'keep' },
    tags: h.TAGS.map((t) => Object.assign({}, t, { custom_fields: t.id === '1' ? { keep: false } : {} })),
    entities: scenes([{ id: '43', title: 'Chain', organized: false, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] }]),
  })).then(({ d, calls }) => {
    const r = removals(d);
    // Presence alone excludes: the value is false and the tag is still protected.
    h.check('a custom field protects regardless of its value',
      r.length === 1 && r[0].indexOf('Blonde') !== -1, r.join(' | '));
    h.check('custom_fields is only queried when a custom-field filter is set',
      calls.some((c) => /NPTTags/.test(c.query || '') && c.query.indexOf('custom_fields') !== -1));
  })

  .then(() => scan({
    settings: { enableScenes: true, excludeRemoveTagWithCustomFieldName: 'constructor' },
    tags: h.TAGS.map((t) => Object.assign({}, t, { custom_fields: {} })),
    entities: scenes([{ id: '44', title: 'Chain', organized: false, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] }]),
  })).then(({ d }) => {
    // hasOwnProperty, not `in`: an inherited key must not protect every tag.
    h.check('a prototype key does not protect every tag', removals(d).length === 2);
  })

  .then(() => scan({
    settings: { enableScenes: true },
    entities: scenes([{ id: '45', title: 'Chain', organized: false, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] }]),
  })).then(({ d, calls }) => {
    h.check('custom_fields is left out when no custom-field filter is set',
      calls.some((c) => /NPTTags/.test(c.query || '')) &&
      !calls.some((c) => /NPTTags/.test(c.query || '') && c.query.indexOf('custom_fields') !== -1));
    h.check('baseline still prunes', removals(d).length === 2);
  })

  // ── Markers ──────────────────────────────────────────────────────────────
  .then(() => scan({
    settings: { enableMarkers: true },
    entities: {
      findSceneMarkers: {
        node: 'scene_markers',
        list: [{ id: '50', title: 'Intro', primary_tag: { id: '3', name: 'Platinum' }, tags: [{ id: '1' }, { id: '2' }] }],
      },
    },
  })).then(({ d }) => {
    const r = removals(d);
    h.check('a marker primary tag implies removals from the tag list', r.length === 2, r.join(' | '));
    h.check('the primary tag itself is never removed',
      !r.some((l) => l.indexOf('Platinum') !== -1), r.join(' | '));
  })

  .then(() => scan({
    settings: { enableMarkers: true },
    entities: {
      findSceneMarkers: {
        node: 'scene_markers',
        list: [{ id: '51', title: '', primary_tag: { id: '3', name: 'Platinum' }, tags: [] }],
      },
    },
  }, h.TASK_ROLLUP)).then(({ d }) => {
    const a = additions(d);
    h.check('roll up puts a marker primary tag ancestors in the tag list', a.length === 3, a.join(' | '));
    h.check('an untitled marker is named by its primary tag',
      a[0].indexOf('"Platinum (51)"') !== -1, a[0]);
  })

  // ── Cycles ───────────────────────────────────────────────────────────────
  .then(() => scan({
    settings: { enableScenes: true },
    tags: [
      { id: '1', name: 'A', ignore_auto_tag: false, parents: [{ id: '2' }] },
      { id: '2', name: 'B', ignore_auto_tag: false, parents: [{ id: '1' }] },
      { id: '3', name: 'C', ignore_auto_tag: false, parents: [{ id: '2' }] },
    ],
    entities: scenes([{ id: '60', title: 'Cyclic', organized: false, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] }]),
  })).then(({ d }) => {
    // Terminating at all is the point - and under the plain rule every tag in the
    // cycle implies every other, so deleting them would empty the entity.
    h.check('a cycle is reported', d.lines.some((l) => l.indexOf('[ERROR]') === 0 && l.indexOf('Cycle') !== -1),
      d.lines.join(' | '));
    h.check('tags in a cycle are not removed', removals(d).length === 0, removals(d).join(' | '));
  })

  // ── Types and ordering ───────────────────────────────────────────────────
  .then(() => scan({
    settings: {
      enableScenes: true, enablePerformers: true, enableImages: true, enableStudios: true,
      enableGroups: true, enableGalleries: true, enableMarkers: true,
    },
    entities: {
      findScenes: { node: 'scenes', list: [] },
      findImages: { node: 'images', list: [] },
      findPerformers: { node: 'performers', list: [] },
      findStudios: { node: 'studios', list: [] },
      findGroups: { node: 'groups', list: [] },
      findGalleries: { node: 'galleries', list: [] },
      findSceneMarkers: { node: 'scene_markers', list: [] },
    },
  })).then(({ calls }) => {
    const order = calls
      .map((c) => (/query NPT_(\w+)\(/.exec(c.query || '') || [])[1])
      .filter(Boolean);
    h.check('every enabled type is scanned', order.length === 7, order.join(', '));
    h.check('performers are scanned before scenes and images',
      order.indexOf('findPerformers') === 0 &&
      order.indexOf('findPerformers') < order.indexOf('findScenes') &&
      order.indexOf('findScenes') < order.indexOf('findImages'), order.join(', '));
    h.check('markers are scanned last', order[order.length - 1] === 'findSceneMarkers', order.join(', '));
  })

  .then(() => scan({ settings: { enableScenes: false } })).then(({ d, calls }) => {
    h.check('no enabled types is reported rather than silently doing nothing',
      d.lines.some((l) => l.indexOf('No entity types are enabled') !== -1), d.lines.join(' | '));
    h.check('no enabled types queries nothing beyond settings',
      !calls.some((c) => /NPTTags|query NPT_find/.test(c.query || '')));
  })

  // ── Query shape ──────────────────────────────────────────────────────────
  .then(() => scan({
    settings: { enableScenes: true, enablePerformers: true },
    entities: {
      findScenes: { node: 'scenes', list: [] },
      findPerformers: { node: 'performers', list: [] },
    },
  })).then(({ calls }) => {
    const perf = calls.filter((c) => /query NPT_findPerformers/.test(c.query || ''))[0];
    const scene = calls.filter((c) => /query NPT_findScenes/.test(c.query || ''))[0];
    h.check('organized is only requested from types that have it',
      scene.query.indexOf('organized') !== -1 && perf.query.indexOf('organized') === -1);
    h.check('tags are fetched unpaged, entities are paged',
      calls.some((c) => /NPTTags/.test(c.query || '') && c.query.indexOf('per_page: -1') !== -1) &&
      scene.variables.per === 1000 && scene.variables.page === 1);
  })

  .then(() => scan({
    settings: { enableScenes: true }, rejectSort: true,
    entities: scenes([{ id: '70', title: 'Chain', organized: false, tags: [{ id: '1' }, { id: '2' }] }]),
  })).then(({ d, calls }) => {
    const sorted = calls.filter((c) => /query NPT_findScenes/.test(c.query || '') && c.query.indexOf('sort:') !== -1);
    const unsorted = calls.filter((c) => /query NPT_findScenes/.test(c.query || '') && c.query.indexOf('sort:') === -1);
    h.check('a rejected sort falls back to unsorted paging rather than dropping the type',
      sorted.length === 1 && unsorted.length >= 1 && removals(d).length === 1, d.lines.join(' | '));
  })

  .then(() => scan({
    settings: { enableScenes: true, enablePerformers: true },
    failFind: 'findScenes',
    entities: {
      findScenes: { node: 'scenes', list: [] },
      findPerformers: { node: 'performers', list: [{ id: '80', name: 'Jane', tags: [{ id: '1' }, { id: '2' }] }] },
    },
  })).then(({ d }) => {
    h.check('a failing type is reported as an error',
      d.lines.some((l) => l.indexOf('[ERROR]') === 0 && l.indexOf('findScenes failed') !== -1), d.lines.join(' | '));
    h.check('a failing type does not stop the others', removals(d).length === 1, removals(d).join(' | '));
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
