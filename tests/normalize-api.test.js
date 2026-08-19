// The API this plugin publishes for other plugins to call, on `coop().api`.
//
// It exists because Prune and Roll Up are this plugin's operations and a second
// plugin offering them had been copying the rules - which drifts the moment a filter
// is added here. Every check below is therefore about the *contract*, not about the
// planning (normalize-plan.test.js owns that): what a caller may pass, what it gets
// back, and which of this plugin's settings the answer is allowed to depend on.
//
// `tests/tagclip.test.js` is the other half: it loads this plugin into the same page
// as the caller and drives the two together. Neither suite alone proves the pair
// works, which is why both exist.
'use strict';
const h = require('./npt-harness');

// The hierarchy: Hair Colour (1) > Blonde (2) > Platinum (3), and Rare (6) > Platinum.
function api(settings) {
  const env = h.makeEnv({ quiet: true, respond: h.makeResponder({ settings: settings }) });
  h.run(env.ctx);
  return env.ctx.window.__GTTx__.StashPluginCoop.api.NormalizeParentTags;
}

function prepare(settings, opts) {
  return api(settings).prepare(opts || { entityType: 'scene' });
}

const ids = (list) => (list || []).slice().sort().join(',');

Promise.resolve()

  .then(() => {
    const a = api({});
    h.check('the plugin publishes an api entry at load', !!a && typeof a.prepare === 'function');
    h.check('carrying a version a caller can name in a log line',
      typeof a.version === 'number' && a.version >= 1, String(a && a.version));
  })

  // ── prepare: what it resolves with ────────────────────────────────────────

  .then(() => prepare({}, { entityType: 'scene' })).then((p) => {
    // A caller has singular entity names; this plugin's own keys are plural. Two
    // vocabularies meeting is not a thing to be strict about.
    h.check('a singular entity name resolves to this plugin’s own key',
      p.entityType === 'scenes', String(p.entityType));
    h.check('and the type this plugin is set to include is reported', p.includesType === true);
    h.check('with a synchronous planner bound to the settings just read',
      typeof p.plan === 'function');
  })

  .then(() => prepare({}, { entityType: 'Scenes' }))
  .then((p) => h.check('as does the plural, and the label’s own casing',
    p.entityType === 'scenes', String(p.entityType)))

  .then(() => prepare({}, { entityType: 'sofa' })).then((p) => {
    h.check('a type this plugin has never heard of resolves rather than rejecting',
      p.entityType === null && p.includesType === false, String(p.entityType));
    h.check('and it is not one any automatic mode covers', p.autoMode === null);
  })

  // ── autoMode: a question, not a settings read ─────────────────────────────

  .then(() => prepare({ a1AutoModes: h.autoModes({}) }))
  .then((p) => h.check('a type set to OFF answers null', p.autoMode === null,
    String(p.autoMode)))

  .then(() => prepare({ a1AutoModes: h.autoModes({ scenes: 'prune' }) }))
  .then((p) => h.check('a type set to PRUNE answers "prune"',
    p.autoMode === 'prune', String(p.autoMode)))

  .then(() => prepare({ a1AutoModes: h.autoModes({ scenes: 'rollup' }) }))
  .then((p) => h.check('a type set to ROLLUP answers "rollup"', p.autoMode === 'rollup',
    String(p.autoMode)))

  // The question a caller was asking is "will anything happen to a Scene on save",
  // which since 4.0.0 is per type: another type's mode is not this type's answer.
  .then(() => prepare({ a1AutoModes: h.autoModes({ images: 'prune' }) }))
  .then((p) => h.check('a mode set for another type answers null',
    p.autoMode === null && p.includesType === false, String(p.autoMode)))

  // The 3.2.0 settings this replaced, answered identically without the caller
  // knowing they were ever migrated - which is the whole point of publishing the
  // question rather than the settings.
  .then(() => prepare({ a5EnableScenes: true, a8AutoPruneOnUpdate: true }))
  .then((p) => h.check('a pre-4.0.0 install answers from its migrated settings',
    p.autoMode === 'prune' && p.includesType === true, String(p.autoMode)))

  .then(() => prepare({ a5EnableScenes: true, a9AutoRollUpOnUpdate: true }))
  .then((p) => h.check('including the direction it had',
    p.autoMode === 'rollup', String(p.autoMode)))

  // Both at once was that release's own no-op - they are exact inverses, so it ran
  // neither - and it migrates to OFF rather than to a direction nobody chose.
  .then(() => prepare({ a5EnableScenes: true, a8AutoPruneOnUpdate: true,
    a9AutoRollUpOnUpdate: true }))
  .then((p) => h.check('and both of them at once migrates to OFF, not to one of them',
    p.autoMode === null, String(p.autoMode)))

  .then(() => prepare({ a5EnableScenes: false, a8AutoPruneOnUpdate: true }))
  .then((p) => h.check('a pre-4.0.0 type that was not included stays OFF',
    p.autoMode === null && p.includesType === false, String(p.autoMode)))

  // ── plan: prune ───────────────────────────────────────────────────────────

  .then(() => prepare({})).then((p) => {
    const r = p.plan({ mode: 'prune', tagIds: ['1', '2', '3'] });
    h.check('Prune removes every tag a lower one already implies',
      ids(r.remove) === '1,2', ids(r.remove));
    // Both point at Platinum rather than at each tag's own child: where several
    // present tags imply the same ancestor the lowest wins, and a Prune line always
    // names a tag that survives - Blonde is itself being removed.
    h.check('and names the tag that implied each, for a caller’s log',
      r.reason['1'] === '3' && r.reason['2'] === '3', JSON.stringify(r.reason));
    h.check('while `implied` carries the whole closure, present or not',
      ids(Object.keys(r.implied)) === '1,2,6', ids(Object.keys(r.implied)));
  })

  .then(() => prepare({ c3ExcludeRemoveTagNameContains: 'Hair' })).then((p) => {
    const r = p.plan({ mode: 'prune', tagIds: ['1', '2', '3'] });
    // The protection is the half a copied rule set gets wrong silently, so it is
    // returned rather than left for the caller to re-derive: which tag, and why.
    h.check('a protected tag is not removed', ids(r.remove) === '2', ids(r.remove));
    h.check('and the reason comes back with it', r.protected['1'] === 'name filter',
      JSON.stringify(r.protected));
  })

  // ── plan: roll up ─────────────────────────────────────────────────────────

  .then(() => prepare({})).then((p) => {
    const r = p.plan({ mode: 'rollup', tagIds: ['3'] });
    h.check('Roll Up adds every ancestor, at any depth and along every branch',
      ids(r.add) === '1,2,6', ids(r.add));
    h.check('and rollUp is accepted as readily as rollup',
      ids(p.plan({ mode: 'rollUp', tagIds: ['3'] }).add) === '1,2,6');
  })

  .then(() => prepare({ c2ExcludeAddTagNameContains: 'Blonde' })).then((p) => {
    const r = p.plan({ mode: 'rollup', tagIds: ['3'] });
    // A tag the filters reject is skipped on its own; its parents are still added.
    // The filters describe a tag, not a wall in the hierarchy.
    h.check('a tag protected from being added is skipped, and its own parent is not',
      ids(r.add) === '1,6', ids(r.add));
    h.check('with the reason named', r.protected['2'] === 'name filter',
      JSON.stringify(r.protected));
  })

  // ── plan: what it declines to answer ──────────────────────────────────────

  .then(() => prepare({})).then((p) => {
    h.check('a mode it does not know is null rather than a guess',
      p.plan({ mode: 'sideways', tagIds: ['3'] }) === null);
    h.check('and so is a missing request', p.plan() === null);
    const r = p.plan({ mode: 'prune', tagIds: [] });
    h.check('an empty tag list plans nothing without complaining',
      !!r && r.remove.length === 0, JSON.stringify(r));
  })

  // The per-type toggle is available to `plan` too, and off by default: a hand-picked
  // list is not an entity update, so a caller has to ask for it. Having it ready is
  // what stops the day it is wanted from being a change of signature.
  .then(() => prepare({ a1AutoModes: h.autoModes({}) })).then((p) => {
    h.check('typeFilter shuts the planner for a type this plugin does not include',
      p.plan({ mode: 'rollup', tagIds: ['3'], typeFilter: true }) === null);
    h.check('and without it the plan is returned regardless',
      ids(p.plan({ mode: 'rollup', tagIds: ['3'] }).add) === '1,2,6');
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
