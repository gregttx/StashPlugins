// PropagateTagsAndPerformers phase 1: the walk over the library that decides what a
// run would change. Nothing here writes, and the suite asserts that too - a planner
// that issued a mutation would have broken the whole two-phase design.
//
// The fake library is small and deliberately awkward: a scene with two performers
// that both carry a tag it already has, a group whose scenes disagree, a marker whose
// primary tag is the only place a tag appears, and a studio shared by two targets.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const NAME = 'PropagateTagsAndPerformers';
const SRC = process.env.SRC || path.join(__dirname, '..', NAME, NAME + '.js');
const PREFIX = 'ptp2re';
const TASK = 'Propagate Tags and Performers to All Related Entities';

// Hair Colour (1) / Blonde (2) / Outdoor (3) / Interview (4) / Locked (5) / Skip (6)
const TAGS = [
  { id: '1', name: 'Hair Colour', sort_name: null, ignore_auto_tag: false },
  { id: '2', name: 'Blonde', sort_name: null, ignore_auto_tag: false },
  { id: '3', name: 'Outdoor', sort_name: null, ignore_auto_tag: false },
  { id: '4', name: 'Interview', sort_name: null, ignore_auto_tag: false },
  { id: '5', name: 'Locked', sort_name: null, ignore_auto_tag: true },
  { id: '6', name: 'Skip', sort_name: null, ignore_auto_tag: false },
  { id: '7', name: 'Volume 10', sort_name: null, ignore_auto_tag: false },
  { id: '8', name: 'Volume 2', sort_name: null, ignore_auto_tag: false },
  { id: '9', name: 'Zed', sort_name: 'Aaa', ignore_auto_tag: false },
];

function responder(opts) {
  opts = opts || {};
  const lib = opts.library || {};
  return function (req) {
    const q = req.query || '';
    if (/PluginVersion/.test(q)) return { data: { plugins: [] } };
    if (q.indexOf('configuration') !== -1) {
      const plugins = {};
      plugins[NAME] = opts.settings || {};
      return { data: { configuration: { plugins } } };
    }
    // The recap's tooltips: aliases and descriptions for the tags a run moves, asked
    // for by id after the walk rather than carried on `PTPTags` for the whole library.
    // Checked before `PTPTags`, since that regex would match this query's name too.
    if (/PTPTagDetail/.test(q)) {
      if (opts.failTagDetail) return { errors: [{ message: 'too expensive' }] };
      return { data: { findTags: { tags: opts.tagDetail || [] } } };
    }
    if (/PTPTags/.test(q)) {
      if (opts.failTags) return { errors: [{ message: 'tags boom' }] };
      return { data: { findTags: { tags: opts.tags || TAGS } } };
    }
    const find = /query PTP_(\w+)\(/.exec(q);
    if (find) {
      const name = find[1];
      if (opts.failFind === name) return { errors: [{ message: 'find boom' }] };
      const spec = lib[name] || { node: 'scenes', list: [] };
      const out = { count: spec.list.length };
      // One page: every fixture here is small, and paging is exercised by the
      // dedicated case below rather than by every other one.
      out[spec.node] = req.variables.page === 1 ? spec.list : [];
      const data = {};
      data[name] = out;
      return { data: data };
    }
    return { data: {} };
  };
}

function run(opts) {
  const env = h.makeEnv({ quiet: true, respond: responder(opts) });
  h.run(env.ctx, SRC);
  return h.startTask(env.ctx, TASK, NAME).then(() => h.flush(120)).then(() => ({
    env, d: h.dialog(env.ctx.document.body, PREFIX),
  }));
}

const mutations = (calls) => calls.filter((c) => /\bmutation\b/.test(c.query || ''));
const tagLines = (d) => d.lines.filter((l) => /^\[TAG\]/.test(l));
const perfLines = (d) => d.lines.filter((l) => /^\[PERF\]/.test(l));
// The hoverable segments of the tag recap: only the tags with something to say beyond
// the caption carry a title, and nothing else about the line changes.
const recapSpans = (env, verb) => {
  const line = env.ctx.document.body.descendants().filter((n) =>
    h.hasClass(n, 'ptp2re-line') && n.textContent.indexOf('tag(s) ' + verb + ':') !== -1)[0];
  return line ? line.descendants() : [];
};
const recapTips = (env, verb) => recapSpans(env, verb).filter((n) => n.title)
  .map((n) => ({ text: n.textContent, title: n.title }));

Promise.resolve()

  // ── The basic gather ──────────────────────────────────────────────────────
  .then(() => run({
    settings: { b1TagsPerformersToScenes: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [{ id: '1' }], organized: false,
          performers: [{ id: '100', name: 'Jane', tags: [{ id: '1' }, { id: '2' }] },
                       { id: '101', name: 'Ada', tags: [{ id: '3' }] }] },
      ] },
    },
  })).then(({ env, d }) => {
    const lines = tagLines(d);
    h.check('a scene gains the tags its performers carry', lines.length === 2,
      lines.join('\n'));
    // Tag 1 is already on the scene and must not be planned again: the diff is
    // against what the target has, not against what the sources carry.
    h.check('and not the one it already has',
      lines.every((l) => !/Tag "Hair Colour"/.test(l)), lines.join('\n'));
    // Naming the path ("from Performers") did not say *which* performer, which is the
    // thing the user has to open to understand or reverse a copy by hand.
    h.check('the lines name the entity, the tag, and the entity responsible',
      /Scene "One" \(10\) - Tag "Blonde" \(2\) - from Performer "Jane" \(100\)$/m
        .test(lines.join('\n')),
      lines.join('\n'));
    h.check('planning writes nothing', mutations(env.calls).length === 0);
    h.check('and Proceed is enabled once there is a plan',
      d.button('Proceed').disabled === false);
  })

  .then(() => run({
    settings: { b1TagsPerformersToScenes: true },
    library: {
      findScenes: { node: 'scenes', list: [
        // Two performers both carrying the same tag. The plan is keyed by the entity
        // being written, so this is one entry with one addition, not two.
        { id: '10', title: 'One', tags: [], organized: false,
          performers: [{ id: '100', name: 'Jane', tags: [{ id: '2' }] },
                       { id: '101', name: 'Ada', tags: [{ id: '2' }] },
                       { id: '102', name: 'Ida', tags: [{ id: '2' }] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('a tag three sources agree on is planned once', tagLines(d).length === 1,
      tagLines(d).join('\n'));
    // One name and a count, not three names: a scene with forty performers would
    // otherwise put forty of them on one log line, and the first is enough to start
    // from. In walk order, so it is the same name every run.
    h.check('and names one of them, counting the rest',
      / - from Performer "Jane" \(100\), \+2 more$/.test(tagLines(d)[0] || ''),
      tagLines(d).join('\n'));
  })

  .then(() => run({
    // Two different paths wanting the *same* tag on the same scene. The plan is keyed
    // by the entity being written and what is being written to it, never by the path
    // that asked - so this is one addition on one entry. Several entries for one
    // entity is the shape that silently loses data when the writes go out.
    settings: { b1TagsPerformersToScenes: true, b2TagsStudioToScenes: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false,
          performers: [{ id: '100', tags: [{ id: '2' }] }],
          studio: { id: '200', tags: [{ id: '2' }] } },
      ] },
    },
  })).then(({ d }) => {
    h.check('two paths wanting the same tag plan it once', tagLines(d).length === 1,
      tagLines(d).join('\n'));
    h.check('and the recap counts the entity once, not the paths',
      d.lines.some((l) => /1 tag\(s\) to add: "Blonde" \(2\) x1/.test(l)),
      d.lines.filter((l) => /to add/.test(l)).join('\n'));
  })

  .then(() => run({
    settings: { b1TagsPerformersToScenes: true, b2TagsStudioToScenes: true,
                b3TagsMarkersToScenes: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false,
          performers: [{ id: '100', name: 'Jane', tags: [{ id: '2' }] }],
          studio: { id: '200', name: 'Acme', tags: [{ id: '3' }] },
          // No title, which is the usual state of a marker.
          scene_markers: [{ id: '300', title: null, primary_tag: { id: '4' }, tags: [] }] },
      ] },
    },
  })).then(({ env, d }) => {
    h.check('three paths onto one scene are gathered together', tagLines(d).length === 3,
      tagLines(d).join('\n'));
    // A marker's primary tag is a required field of its own, and it counts: a marker
    // whose primary tag is the only place a tag appears still carries it. It also
    // names the marker, since Stash shows a titleless one the same way.
    h.check('a marker primary tag is copied like any other',
      /Tag "Interview" \(4\) - from Marker "Interview" \(300\)/.test(tagLines(d).join('\n')),
      tagLines(d).join('\n'));
    // A studio is a single object, not a list. The walk handles both rather than the
    // table annotating which, which is exactly the case that would break it.
    h.check('a single-object step is walked like a list',
      /Tag "Outdoor" \(3\) - from Studio "Acme" \(200\)/.test(tagLines(d).join('\n')),
      tagLines(d).join('\n'));
    // Three paths, one stage, one target - so one query, not three. Repeating a field
    // is legal GraphQL and the server merges the selections.
    const finds = env.calls.filter((c) => /query PTP_findScenes/.test(c.query || ''));
    h.check('and cost one query per page, not one per path', finds.length === 1,
      'got ' + finds.length);
  })

  // ── Two hops ──────────────────────────────────────────────────────────────
  .then(() => run({
    settings: { e4TagsPerformersToGroups: true },
    library: {
      findGroups: { node: 'groups', list: [
        // A group has no performers of its own, so this reaches them through its
        // scenes - two levels of walk in one query.
        { id: '20', name: 'Series', tags: [],
          scenes: [{ id: '10', performers: [{ id: '100', tags: [{ id: '2' }] }] },
                   { id: '11', performers: [{ id: '101', tags: [{ id: '3' }] }] }] },
      ] },
    },
  })).then(({ env, d }) => {
    h.check('a two-hop path reaches through the intermediate entity',
      tagLines(d).length === 2, tagLines(d).join('\n'));
    h.check('and still costs one query',
      env.calls.filter((c) => /query PTP_findGroups/.test(c.query || '')).length === 1);
  })

  // ── Union and common-tags-only ────────────────────────────────────────────
  .then(() => run({
    settings: { e1TagsScenesToGroups: true },
    library: {
      findGroups: { node: 'groups', list: [
        { id: '20', name: 'Series', tags: [],
          scenes: [{ id: '10', tags: [{ id: '2' }, { id: '3' }] },
                   { id: '11', tags: [{ id: '3' }] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('by default a group gains every tag any scene carries',
      tagLines(d).length === 2, tagLines(d).join('\n'));
  })

  .then(() => run({
    settings: { e1TagsScenesToGroups: true, e2TagsScenesToGroupsCommonOnly: true },
    library: {
      findGroups: { node: 'groups', list: [
        { id: '20', name: 'Series', tags: [],
          scenes: [{ id: '10', tags: [{ id: '2' }, { id: '3' }] },
                   { id: '11', tags: [{ id: '3' }] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('common tags only keeps what every scene carries',
      tagLines(d).length === 1 && /Tag "Outdoor" \(3\)/.test(tagLines(d)[0]),
      tagLines(d).join('\n'));
  })

  .then(() => run({
    settings: { e1TagsScenesToGroups: true, e2TagsScenesToGroupsCommonOnly: true },
    library: {
      findGroups: { node: 'groups', list: [
        // One scene: the intersection is that scene's tags, which is what the
        // setting's description promises and the edge a fold can get wrong.
        { id: '20', name: 'Series', tags: [], scenes: [{ id: '10', tags: [{ id: '2' }] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('one source makes union and intersection the same answer',
      tagLines(d).length === 1, tagLines(d).join('\n'));
  })

  .then(() => run({
    settings: { e1TagsScenesToGroups: true, e2TagsScenesToGroupsCommonOnly: true },
    library: {
      findGroups: { node: 'groups', list: [
        // No sources. The intersection of nothing is emptiness here, not everything:
        // a group with no scenes has no scenes agreeing on anything.
        { id: '20', name: 'Series', tags: [], scenes: [] },
      ] },
    },
  })).then(({ d }) => {
    h.check('no sources adds nothing under either mode', tagLines(d).length === 0,
      tagLines(d).join('\n'));
  })

  .then(() => run({
    settings: { e1TagsScenesToGroups: true, e2TagsScenesToGroupsCommonOnly: true },
    library: {
      findGroups: { node: 'groups', list: [
        // A scene listing the same tag twice must not count as two scenes agreeing.
        { id: '20', name: 'Series', tags: [],
          scenes: [{ id: '10', tags: [{ id: '2' }, { id: '2' }] },
                   { id: '11', tags: [{ id: '3' }] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('one source carrying a tag twice still counts once',
      tagLines(d).length === 0, tagLines(d).join('\n'));
  })

  // ── The cascade ───────────────────────────────────────────────────────────
  .then(() => run({
    // Stage 2 puts a marker tag on a scene; stage 4 copies that scene's tags onto its
    // group. Without the plan-aware gather the group would gain it only on the *next*
    // run - silently, since nothing errors.
    settings: { b3TagsMarkersToScenes: true, e1TagsScenesToGroups: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false,
          scene_markers: [{ id: '300', primary_tag: { id: '4' }, tags: [] }] },
      ] },
      findGroups: { node: 'groups', list: [
        { id: '20', name: 'Series', tags: [], scenes: [{ id: '10', title: 'One', tags: [] }] },
      ] },
    },
  })).then(({ d }) => {
    const lines = tagLines(d).join('\n');
    // Attributed to the scene it came through, not to the marker two steps back. That
    // is the honest answer to "why does this group carry Interview": because scene One
    // will, and that is the entity to look at.
    h.check('a tag planned onto a scene reaches its group in the same run',
      /Group "Series" \(20\) - Tag "Interview" \(4\) - from Scene "One" \(10\)/.test(lines),
      lines);
  })

  .then(() => run({
    // The same library with the stages the other way round would not cascade. Here
    // only the group path is on, so the scene has nothing pending and the group gains
    // nothing - which is what makes the check above about the cascade rather than
    // about the group path working at all.
    settings: { e1TagsScenesToGroups: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false,
          scene_markers: [{ id: '300', primary_tag: { id: '4' }, tags: [] }] },
      ] },
      findGroups: { node: 'groups', list: [
        { id: '20', name: 'Series', tags: [], scenes: [{ id: '10', tags: [] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('and gains nothing when the earlier stage is not enabled',
      tagLines(d).length === 0, tagLines(d).join('\n'));
  })

  // ── Performers ────────────────────────────────────────────────────────────
  .then(() => run({
    settings: { b5PerformersGalleriesToScenes: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false, performers: [{ id: '100' }],
          galleries: [{ id: '30', performers: [{ id: '100', name: 'Jane' },
                                               { id: '101', name: 'Ada' }] }] },
      ] },
    },
  })).then(({ d }) => {
    const lines = perfLines(d);
    h.check('a scene gains the performers of its galleries', lines.length === 1,
      lines.join('\n'));
    // The name rides along with the traversal rather than costing a query of its own.
    h.check('and the performer is named from the traversal',
      /Performer "Ada" \(101\)/.test(lines[0]), lines[0]);
    h.check('a performer already on the scene is not planned again',
      !/Jane/.test(lines.join('\n')), lines.join('\n'));
  })

  // ── The exclusion filters ─────────────────────────────────────────────────
  .then(() => run({
    settings: { b1TagsPerformersToScenes: true, f2ExcludeTargetOrganized: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: true,
          performers: [{ id: '100', tags: [{ id: '2' }] }] },
        { id: '11', title: 'Two', tags: [], organized: false,
          performers: [{ id: '100', tags: [{ id: '2' }] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('an Organized entity is skipped whole',
      tagLines(d).length === 1 && /Scene "Two"/.test(tagLines(d)[0]), tagLines(d).join('\n'));
  })

  .then(() => run({
    settings: { b1TagsPerformersToScenes: true, f1ExcludeTargetWithTagName: 'Skip' },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [{ id: '6' }], organized: false,
          performers: [{ id: '100', tags: [{ id: '2' }] }] },
        { id: '11', title: 'Two', tags: [], organized: false,
          performers: [{ id: '100', tags: [{ id: '2' }, { id: '6' }] }] },
      ] },
    },
  })).then(({ d }) => {
    const lines = tagLines(d).join('\n');
    h.check('an entity carrying the exclusion tag is skipped',
      !/Scene "One"/.test(lines), lines);
    // Copying the "skip this entity" tag onto things would permanently exclude
    // whatever received it, and nothing here ever removes a tag.
    h.check('and the exclusion tag itself is never copied onto anything',
      !/Tag "Skip"/.test(lines) && /Scene "Two"/.test(lines), lines);
  })

  .then(() => run({
    settings: { b1TagsPerformersToScenes: true, f1ExcludeTargetWithTagName: 'Nope' },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false,
          performers: [{ id: '100', tags: [{ id: '2' }] }] },
      ] },
    },
  })).then(({ d }) => {
    // Running unfiltered would write to the very entities the filter is there to
    // protect, and nothing here removes anything afterwards. Stopping is the safe
    // direction.
    h.check('an exclusion tag that does not exist stops the run',
      d.lines.some((l) => /^\[ERROR\].*does not exist/.test(l)), d.lines.join('\n'));
    h.check('and nothing is planned', tagLines(d).length === 0);
    h.check('and Proceed stays disabled', d.button('Proceed').disabled === true);
  })

  .then(() => run({
    settings: { b1TagsPerformersToScenes: true, f3ExcludeTagWithIgnoreAutoTag: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false,
          performers: [{ id: '100', tags: [{ id: '2' }, { id: '5' }] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('a tag set to Ignore auto tag is never copied',
      tagLines(d).length === 1 && !/Locked/.test(tagLines(d)[0]), tagLines(d).join('\n'));
  })

  .then(() => run({
    settings: { b1TagsPerformersToScenes: true, f4ExcludeTagWithCustomFieldName: 'hold' },
    tags: TAGS.map((t) => (t.id === '2' ? Object.assign({}, t, { custom_fields: { hold: false } }) : t)),
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false,
          performers: [{ id: '100', tags: [{ id: '2' }, { id: '3' }] }] },
      ] },
    },
  })).then(({ env, d }) => {
    // Presence only: the value is JSON, so a literal `false` is still a value, and a
    // value-based rule would be surprising to configure.
    h.check('a custom field excludes a tag whatever its value',
      tagLines(d).length === 1 && !/Blonde/.test(tagLines(d)[0]), tagLines(d).join('\n'));
    h.check('and custom_fields is only requested when that filter is set',
      env.calls.some((c) => /PTPTags/.test(c.query || '') && /custom_fields/.test(c.query)));
  })

  .then(() => run({
    settings: { b1TagsPerformersToScenes: true },
    library: { findScenes: { node: 'scenes', list: [] } },
  })).then(({ env }) => {
    // A free JSON map per tag is dead weight on every run that does not filter on it.
    h.check('custom_fields is left out when nothing filters on it',
      env.calls.some((c) => /PTPTags/.test(c.query || '')) &&
      env.calls.every((c) => !/PTPTags/.test(c.query || '') || !/custom_fields/.test(c.query)));
  })

  // ── Ordering and errors ───────────────────────────────────────────────────
  .then(() => run({
    settings: { b4TagsGroupsToScenes: true, b3TagsMarkersToScenes: true },
    library: {
      findScenes: { node: 'scenes', list: [] },
      findGroups: { node: 'groups', list: [] },
    },
  })).then(({ env }) => {
    // Both paths write onto scenes but sit in stages 2 and 6, so they are two passes
    // in that order - not one merged query. Merging across stages is cheaper and
    // wrong: the stage boundary is what makes the cascade work.
    const scenes = env.calls.filter((c) => /query PTP_findScenes/.test(c.query || ''));
    h.check('paths onto one target in different stages are separate passes',
      scenes.length === 2, 'got ' + scenes.length);
    // Guarded indexes on purpose: a merged-pass regression leaves one query here, and
    // a suite that throws on `scenes[1]` reports nothing at all rather than the two
    // checks that would have named the fault.
    const first = (scenes[0] || {}).query || '';
    const second = (scenes[1] || {}).query || '';
    h.check('and the earlier stage runs first',
      /scene_markers/.test(first) && /groups \{ group/.test(second),
      scenes.map((c) => c.query.slice(0, 120)).join('\n        '));
  })

  .then(() => run({
    settings: { b1TagsPerformersToScenes: true, e1TagsScenesToGroups: true },
    failFind: 'findScenes',
    library: { findGroups: { node: 'groups', list: [
      { id: '20', name: 'Series', tags: [], scenes: [{ id: '10', tags: [{ id: '2' }] }] },
    ] } },
  })).then(({ d }) => {
    // One failed page must not cancel a library-wide review, and the plan is honest
    // about being partial rather than quietly short.
    h.check('a failed page is logged as an error',
      d.lines.some((l) => /^\[ERROR\].*page 1 failed/.test(l)), d.lines.join('\n'));
    h.check('and the run carries on to the next pass', tagLines(d).length === 1,
      tagLines(d).join('\n'));
  })

  .then(() => run({
    settings: { b1TagsPerformersToScenes: true },
    failTags: true,
    library: { findScenes: { node: 'scenes', list: [] } },
  })).then(({ d }) => {
    // The tag query answers the filters and names everything in the log. Without it
    // there is no run, and it must fail loudly rather than plan unfiltered.
    h.check('a failed tag query stops the review',
      d.lines.some((l) => /^\[ERROR\] Review failed/.test(l)), d.lines.join('\n'));
    h.check('and Proceed stays disabled', d.button('Proceed').disabled === true);
  })

  // ── Naming ────────────────────────────────────────────────────────────────
  .then(() => run({
    settings: { d1TagsGalleriesToImages: true },
    library: {
      findImages: { node: 'images', list: [
        // title is optional on an image, so the label falls back to visual_files -
        // which is a union, and the reason the query names the concrete types.
        { id: '40', title: null, tags: [],
          visual_files: [{ basename: 'IMG_0001.jpg' }],
          galleries: [{ id: '30', tags: [{ id: '2' }] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('an untitled image is named by its file',
      /Image "IMG_0001\.jpg" \(40\)/.test(tagLines(d)[0] || ''), tagLines(d).join('\n'));
  })

  .then(() => run({
    settings: { c1TagsImagesToGalleries: true, b5PerformersGalleriesToScenes: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: null, tags: [], organized: false, performers: [],
          files: [{ basename: 'scene.mp4' }],
          galleries: [{ id: '30', performers: [{ id: '101', name: 'Ada' }] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('an untitled scene is named by its file',
      /Scene "scene\.mp4" \(10\)/.test(perfLines(d)[0] || ''), perfLines(d).join('\n'));
  })

  // ── The recap ─────────────────────────────────────────────────────────────
  .then(() => run({
    settings: { b1TagsPerformersToScenes: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false,
          performers: [{ id: '100', tags: [{ id: '7' }, { id: '8' }, { id: '9' }] }] },
        { id: '11', title: 'Two', tags: [], organized: false,
          performers: [{ id: '100', tags: [{ id: '8' }] }] },
      ] },
    },
  })).then(({ d }) => {
    const line = d.lines.filter((l) => /tag\(s\) to add/.test(l))[0] || '';
    h.check('the review closes with a recap of every tag it would add',
      /3 tag\(s\) to add/.test(line), line);
    // Counted per entity, not per path: a scene is written once whichever of its
    // paths asked for the tag.
    h.check('with a per-entity count for each', /"Volume 2" \(8\) x2/.test(line), line);
    // Stash orders by COALESCE(sort_name, name) under NATURAL_CI, so the line reads
    // straight against the tag list in the UI: sort_name wins, and numeric runs sort
    // as numbers - "Volume 2" before "Volume 10".
    h.check('ordered the way Stash orders tags',
      line.indexOf('"Zed"') < line.indexOf('"Volume 2"') &&
      line.indexOf('"Volume 2"') < line.indexOf('"Volume 10"'), line);
    // The head legend promises that brackets are ids and counts are written x250.
    // A count in brackets here would make the legend false.
    h.check('and the count outside the brackets, as the legend promises',
      !/\(\d+\) \(\d+\)/.test(line) && /x\d+/.test(line), line);
  })

  // ── The recap's tags hover ────────────────────────────────────────────────
  //
  // The recap is the one place this dialog enumerates tags, so it is where a tag can
  // say what it *is* - which is what tells two tags sharing a name apart without
  // leaving the dialog. `tagMap` already carries names for the whole library because
  // the filters need them; aliases and a description are paragraphs, and carrying
  // those for every tag to name the handful a recap mentions is the trade this query
  // exists to avoid.
  .then(() => run({
    settings: { b1TagsPerformersToScenes: true },
    tagDetail: [
      { id: '2', name: 'Blonde', aliases: ['Blond', 'Blonde Hair'],
        description: 'Light hair,\n  natural or dyed.' },
      { id: '3', name: 'Outdoor', aliases: [], description: null },
    ],
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false,
          performers: [{ id: '100', name: 'Jane', tags: [{ id: '2' }, { id: '3' }] }] },
      ] },
    },
  })).then(({ env, d }) => {
    const detail = env.calls.filter((c) => /PTPTagDetail/.test(c.query || ''));
    h.check('the detail query is scoped to the tags the recap names',
      detail.length === 1 && detail[0].variables.ids.slice().sort().join() === '2,3',
      JSON.stringify(detail.map((c) => c.variables)));
    // Read defensively: a build that never issues the query must fail this rather
    // than throw and take the rest of the suite with it.
    const detailQuery = (detail[0] || {}).query || '';
    h.check('and asks for the two fields the library-wide tag query does not',
      /aliases/.test(detailQuery) && /description/.test(detailQuery), detailQuery);
    h.check('while the library-wide tag query still asks for neither',
      !env.calls.some((c) => /PTPTags\b/.test(c.query || '') &&
        (/aliases/.test(c.query) || /description/.test(c.query))));

    const tips = recapTips(env, 'to add');
    h.check('the tag with aliases and a description hovers to them',
      tips.length === 1 && tips[0].text.indexOf('"Blonde" (2)') === 0 &&
      tips[0].title === 'Blonde\nStash tag id 2\nAliases: Blond, Blonde Hair\n' +
        'Description: Light hair, natural or dyed.', JSON.stringify(tips));
    // Nothing marks which tags hover, so a hover that opens has to say something the
    // line does not already.
    h.check('a tag with neither is left plain',
      !tips.some((t) => t.text.indexOf('Outdoor') !== -1), JSON.stringify(tips));
    // The spans exist to hang a title on; styling them read as decoration in a log
    // that has none elsewhere, so the recap has to look like every other line.
    h.check('and the tags are not styled, only titled',
      recapSpans(env, 'to add').every((n) => !n.className),
      recapSpans(env, 'to add').map((n) => n.className).join('|'));
    h.check('and the line itself is unchanged as text, which is what Copy log hands over',
      d.lines.some((l) => l === '[INFO] 2 tag(s) to add: "Blonde" (2) x1, "Outdoor" (3) x1'),
      d.lines.join(' | '));
  })

  // A tooltip is worth a query, not a run: the recap must read the same when the
  // query fails, and must not spend an [ERROR] line on it.
  .then(() => run({
    settings: { b1TagsPerformersToScenes: true },
    failTagDetail: true,
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false,
          performers: [{ id: '100', name: 'Jane', tags: [{ id: '2' }] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('a failed detail query still leaves the recap readable',
      d.lines.some((l) => l === '[INFO] 1 tag(s) to add: "Blonde" (2) x1'), d.lines.join(' | '));
    h.check('and says nothing about it',
      !d.lines.some((l) => l.indexOf('[ERROR]') === 0), d.lines.join(' | '));
  })

  .then(() => run({
    settings: { b5PerformersGalleriesToScenes: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false, performers: [],
          galleries: [{ id: '30', performers: [{ id: '101', name: 'Ada' }] }] },
      ] },
    },
  })).then(({ d }) => {
    h.check('performers get their own recap line',
      d.lines.some((l) => /1 performer\(s\) to add: "Ada" \(101\) x1/.test(l)),
      d.lines.join('\n'));
  })

  .then(() => run({
    settings: { b1TagsPerformersToScenes: true },
    library: { findScenes: { node: 'scenes', list: [
      { id: '10', title: 'One', tags: [{ id: '2' }], organized: false,
        performers: [{ id: '100', tags: [{ id: '2' }] }] },
    ] } },
  })).then(({ d }) => {
    h.check('a settled library plans nothing and says so',
      tagLines(d).length === 0 && d.lines.some((l) => /Nothing to change/.test(l)),
      d.lines.join('\n'));
    h.check('and offers no recap', !d.lines.some((l) => /to add:/.test(l)));
  })

  .then(() => h.finish(), (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
