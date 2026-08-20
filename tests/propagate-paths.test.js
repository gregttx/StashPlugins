// The path table is the spine of PropagateTagsAndPerformers: the task, both
// automatic modes, the manual buttons and the cross-plugin declaration all read it
// rather than each carrying their own list. It is also the thing most able to drift,
// because half of it lives in a yml Stash parses and half in a JS array nothing
// parses but the plugin.
//
// So this suite loads the plugin for real and compares the two halves, plus the
// invariants the table's *order* carries - which is semantics here, not
// presentation, since the paths cascade.
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('./npt-harness');

const NAME = 'PropagateTagsAndPerformers';
const SRC = process.env.SRC || path.join(__dirname, '..', NAME, NAME + '.js');
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

// The keys under `settings:`, which is where the block ends - every later top-level
// key would be at column 0, and every setting's own fields are indented four.
function declaredSettings(text) {
  const block = text.slice(text.indexOf('\nsettings:'));
  const out = [];
  block.split('\n').forEach((line) => {
    const m = /^ {2}(\w+):\s*$/.exec(line);
    if (m) out.push(m[1]);
  });
  return out;
}

const env = h.makeEnv({ quiet: true, respond: () => ({ data: {} }) });
env.ctx.console = { info() {}, log() {}, warn() {}, error() {} };
h.run(env.ctx, SRC);

const api = env.ctx.__GTTx__.ptp2re;
h.check('the plugin exposes its tables', !!api && !!api.PATHS && !!api.TARGETS && !!api.DEFAULTS,
  api ? Object.keys(api).join(' ') : 'nothing exposed');

const { PATHS, PATH_COLUMNS, TARGETS, DEFAULTS, pathById } = api;
const yml = declaredSettings(read(NAME, NAME + '.yml'));
const defaults = Object.keys(DEFAULTS);

// ── The two halves of the settings ────────────────────────────────────────
//
// A key in the manifest and missing from DEFAULTS reads as empty forever -
// configurable in the UI and inert in the run. NormalizeParentTags shipped exactly
// that once, for one setting, for one test run.

h.check('every manifest setting has a default',
  yml.every((k) => defaults.indexOf(k) !== -1),
  yml.filter((k) => defaults.indexOf(k) === -1).join(' ') || 'all present');

h.check('every default is declared in the manifest',
  defaults.every((k) => yml.indexOf(k) !== -1),
  defaults.filter((k) => yml.indexOf(k) === -1).join(' ') || 'all present');

// The manifest block is a YAML map, so its order is gone by the time Stash has
// parsed it and the settings page sorts the keys alphabetically. Keeping the file in
// that order too is not what Stash reads - it is so the file and the page it
// produces cannot read differently, which is a trap for the next edit.
h.check('the manifest lists its settings in the order the page will show them',
  yml.join(',') === yml.slice().sort().join(','),
  yml.join(' '));

// ── The paths ─────────────────────────────────────────────────────────────

h.check('thirteen paths', PATHS.length === 13, String(PATHS.length));

const tagPaths = PATHS.filter((p) => p.kind === 'tags');
const perfPaths = PATHS.filter((p) => p.kind === 'performers');
h.check('eleven of them copy tags, two copy performers',
  tagPaths.length === 11 && perfPaths.length === 2,
  tagPaths.length + ' tags / ' + perfPaths.length + ' performers');

const ids = PATHS.map((p) => p.id);
h.check('path ids are unique', new Set(ids).size === ids.length, ids.join(' '));

// The id is `kind:source>target` and it is published to other plugins through the
// cooperation registry, so it is the one field here that is read from outside this
// file. Checking it against `kind` and `target` makes the two halves hold each other
// up: a path silently pointed at the wrong entity is otherwise a plausible-looking
// row that writes onto something the user never asked about.
h.check('every path id states its own kind and target',
  PATHS.every((p) => {
    const m = /^([a-z]+):([a-z_]+)>([a-z]+)$/.exec(p.id);
    return m && m[1] === p.kind && m[3] === p.target;
  }),
  PATHS.filter((p) => {
    const m = /^([a-z]+):([a-z_]+)>([a-z]+)$/.exec(p.id);
    return !m || m[1] !== p.kind || m[3] !== p.target;
  }).map((p) => p.id + ' is ' + p.kind + ' onto ' + p.target).join(', ') || 'all consistent');

// Both are user-facing: `source` names the other end in the log and the dialog,
// `button` is the caption on the target's edit page. A path with neither is one the
// user cannot tell apart from its neighbours.
h.check('every path names its source and its button',
  PATHS.every((p) => !!p.source && !!p.button),
  PATHS.filter((p) => !p.source || !p.button).map((p) => p.id).join(' ') || 'all named');

// `sourceType` is what the walk lands on, and it decides one thing: whether an
// earlier stage's *planned* additions to that entity count as already there. Getting
// it wrong is silent - the cascade simply does not happen, and the tags arrive on the
// next run instead.
h.check('every path names what its walk lands on',
  PATHS.every((p) => !!p.sourceType),
  PATHS.filter((p) => !p.sourceType).map((p) => p.id).join(' ') || 'all named');

// The id's own source segment says the same thing, with one deliberate exception: a
// sub-group *is* a Group, so the path is named for the relationship while the type is
// named for the schema.
h.check('the source type agrees with the path id',
  PATHS.every((p) => {
    const named = /^[a-z]+:([a-z_]+)>/.exec(p.id)[1];
    return named === p.sourceType || (named === 'subgroup' && p.sourceType === 'group');
  }),
  PATHS.filter((p) => {
    const named = /^[a-z]+:([a-z_]+)>/.exec(p.id)[1];
    return named !== p.sourceType && !(named === 'subgroup' && p.sourceType === 'group');
  }).map((p) => p.id + ' from ' + p.sourceType).join(', ') || 'all agree');

// The paths whose source is itself something we write to - the only ones where the
// cascade can apply at all. Performers, studios and markers are never targets, so a
// plan can never have anything pending for them.
h.check('the cascade applies to exactly the paths whose source is a target',
  PATHS.filter((p) => Object.prototype.hasOwnProperty.call(TARGETS, p.sourceType))
    .map((p) => p.id).sort().join(' ') ===
    ['performers:gallery>scene', 'performers:image>gallery', 'tags:gallery>image',
      'tags:group>scene', 'tags:image>gallery', 'tags:scene>group',
      'tags:subgroup>group'].sort().join(' '),
  PATHS.filter((p) => Object.prototype.hasOwnProperty.call(TARGETS, p.sourceType))
    .map((p) => p.id).join(' '));

// Since 3.0.0 a path names no setting of its own: all thirteen live in the one
// `b1Paths` string, keyed by the path id. So the invariant that used to say "every
// path names a manifest key that exists" is now the narrower - and stronger - one
// that the id is what the string is written and read by. `propagate-modes` covers
// the round trip; this is the table half of it.
h.check('the one setting holding every path exists',
  Object.prototype.hasOwnProperty.call(DEFAULTS, 'b1Paths'),
  Object.keys(DEFAULTS).filter((k) => /^b/.test(k)).join(' '));

h.check('no path carries a setting key of its own any more',
  PATHS.every((p) => !p.setting && !p.mode),
  PATHS.filter((p) => p.setting || p.mode).map((p) => p.id).join(' ') || 'none do');

// Exactly the two the user asked for: the two multi-source aggregations whose
// target is a Group. Every other path is union and has no choice to make.
h.check('only the two aggregations into a Group offer common-tags-only',
  PATHS.filter((p) => p.common).map((p) => p.id).sort().join(' ') ===
    'tags:scene>group tags:subgroup>group',
  PATHS.filter((p) => p.common).map((p) => p.id).join(' '));

h.check('every path writes to a known target',
  PATHS.every((p) => Object.prototype.hasOwnProperty.call(TARGETS, p.target)),
  PATHS.filter((p) => !Object.prototype.hasOwnProperty.call(TARGETS, p.target))
    .map((p) => p.id).join(' ') || 'all known');

h.check('every target is written to by at least one path',
  Object.keys(TARGETS).every((t) => PATHS.some((p) => p.target === t)),
  Object.keys(TARGETS).filter((t) => !PATHS.some((p) => p.target === t)).join(' ') || 'all used');

// Group has no `performers` field in Stash's schema at all, in either direction, so
// a performer path onto one cannot be built - not "was not built". The table saying
// otherwise would be a query that fails at runtime.
h.check('no performer path writes onto a Group',
  !PATHS.some((p) => p.kind === 'performers' && p.target === 'group'),
  PATHS.filter((p) => p.kind === 'performers').map((p) => p.id).join(' '));

// Every path is reached one way or the other, never both and never neither: a walk
// down fields of the target, or - where Stash has no field for it, as with a
// Gallery's images - a reverse find query.
h.check('every path is reached by a walk or by a reverse query, never both',
  PATHS.every((p) => !!p.walk !== !!p.reverse),
  PATHS.filter((p) => !!p.walk === !!p.reverse).map((p) => p.id).join(' ') || 'all singly reached');

// Gallery has no `images` field - only image_count and image(index) - so both paths
// out of a gallery's images are gathered by sweeping images instead.
h.check('the two reverse queries are exactly the paths out of a gallery images',
  PATHS.filter((p) => p.reverse).map((p) => p.id).sort().join(' ') ===
    'performers:image>gallery tags:image>gallery',
  PATHS.filter((p) => p.reverse).map((p) => p.id).join(' '));

// The sweep is a paged query over the source entity, so a reverse path's sourceType
// has to be a target type - that is where its find, node and page size come from. A
// reverse path from something else would have nothing to page.
h.check('a reverse path sweeps an entity the plugin can page',
  PATHS.filter((p) => p.reverse)
    .every((p) => Object.prototype.hasOwnProperty.call(TARGETS, p.sourceType)),
  PATHS.filter((p) => p.reverse && !Object.prototype.hasOwnProperty.call(TARGETS, p.sourceType))
    .map((p) => p.id).join(' '));

// `backRef` is the field on the *source* naming its targets - Image.galleries. It is
// the whole descriptor: everything else about the sweep comes from the source's own
// TARGETS entry, so there is no second copy of `findImages` to fall out of step.
h.check('and names the field that points back at the target',
  PATHS.filter((p) => p.reverse).every((p) => p.reverse.backRef === 'galleries'),
  PATHS.filter((p) => p.reverse).map((p) => p.id + '=' + JSON.stringify(p.reverse)).join(' '));

h.check('a reverse pass sweeps its sources before reading a target',
  (() => {
    const pass = api.buildPasses([api.pathById('tags:image>gallery')])[0];
    return !!pass.sweep && pass.sweep.type === 'image';
  })(),
  JSON.stringify(api.buildPasses([api.pathById('tags:image>gallery')])[0].sweep));

h.check('and a pass of walks needs no sweep at all',
  api.buildPasses([api.pathById('tags:performer>scene')])[0].sweep === null);

// The sweep reads the source's own fields (its name for the log), what it contributes,
// and the back-reference. Anything missing here is a source that cannot be attributed
// or a target that cannot be found.
h.check('the sweep query carries the payload and the back-reference',
  (() => {
    const q = api.sweepQuery(api.buildPasses([api.pathById('tags:image>gallery')])[0]);
    return /query PTP_sweep_findImages\(/.test(q) && /tags \{ id \}/.test(q) &&
      /galleries \{ id \}/.test(q) && /visual_files/.test(q);
  })(),
  api.sweepQuery(api.buildPasses([api.pathById('tags:image>gallery')])[0]));

// `findImages` is both the sweep of stage 3 and the target query of stage 6. Naming
// them alike would make a log, a network tab and a test unable to tell which ran.
h.check('and is named apart from the target query over the same entity',
  api.sweepQuery(api.buildPasses([api.pathById('tags:image>gallery')])[0])
    .indexOf('query PTP_sweep_') === 0 &&
  api.passQuery(api.buildPasses([api.pathById('tags:gallery>image')])[0])
    .indexOf('query PTP_findImages') === 0);

// A reverse path contributes no selection to the target query - its sources come from
// the sweep - so it must not splice an empty string into it either.
h.check('a reverse path leaves no gap in the target query',
  !/\s{2,}/.test(api.passQuery(api.buildPasses([api.pathById('tags:image>gallery')])[0])),
  api.passQuery(api.buildPasses([api.pathById('tags:image>gallery')])[0]));

// ── Pairs ─────────────────────────────────────────────────────────────────
//
// Two paths are the exact reverse of another, and both close a cycle. The dialog
// warns when both halves of one are enabled, and auto mode needs the per-entity
// cooldown because of them - so a pair that is only declared from one side is a
// warning that fires half the time.

const paired = PATHS.filter((p) => p.pair);
h.check('four paths declare a pair', paired.length === 4,
  paired.map((p) => p.id).join(' '));

h.check('every pair is declared from both sides',
  paired.every((p) => {
    const other = api.pathById(p.pair);
    return other && other.pair === p.id;
  }),
  paired.map((p) => p.id + ' -> ' + p.pair).join(', '));

h.check('a path never pairs with itself', !PATHS.some((p) => p.pair === p.id),
  paired.map((p) => p.id).join(' '));

// ── The display layout is a permutation of the table, never a second table ──

// `PATH_COLUMNS` decides where a row sits in the dialog and in the settings row's
// listing, and nothing else. A path missing from it has no control at all, and one
// named twice would get two - neither of which any other check here would notice.
// A `null` entry is a blank row in a column, not a path.
const laid = PATH_COLUMNS.reduce((acc, col) => acc.concat(col), []).filter(Boolean);
h.check('every path is laid out exactly once',
  laid.length === PATHS.length && laid.slice().sort().join(',') === ids.slice().sort().join(','),
  laid.join(' '));

h.check('and the two paths carrying a mode share the last column',
  PATH_COLUMNS[PATH_COLUMNS.length - 1].every((id) => id && pathById(id).common) &&
  laid.filter((id) => pathById(id).common).length === 2,
  PATH_COLUMNS[PATH_COLUMNS.length - 1].join(' '));

// ── The diagram is the same table, drawn ──────────────────────────────────
//
// The second view of these thirteen paths: a box per entity type and an arrow per
// path. Only the boxes are hand-placed - an arrow's ends are the chips it joins,
// clipped to those boxes - so what can go wrong is a path with nowhere to start, a
// box nothing reaches, or a coordinate edit that quietly parks two toggles on top of
// each other. None of those is visible from the plugin's own tests of the table, and
// none is visible in a browser either until somebody opens the dialog.

const { DIAGRAM_NODES, diagramGeometry } = api;
const geo = diagramGeometry();
const nodeIds = DIAGRAM_NODES.map((n) => n.id);

h.check('the diagram draws every path', geo.edges.length === PATHS.length,
  geo.edges.length + ' arrows for ' + PATHS.length + ' paths');

// The node id is the path id's own source segment, which is what gives `subgroup` a
// box of its own: an arrow from Group to itself would be true and useless.
const ends = PATHS.reduce((acc, p) => acc.concat(
  [/^[a-z]+:([a-z_]+)>/.exec(p.id)[1], p.target]), []);
h.check('every end of every path has a box',
  ends.every((id) => nodeIds.indexOf(id) !== -1),
  ends.filter((id) => nodeIds.indexOf(id) === -1).join(' ') || 'all placed');

h.check('and every box is on a path',
  nodeIds.every((id) => ends.indexOf(id) !== -1),
  nodeIds.filter((id) => ends.indexOf(id) === -1).join(' ') || 'all reached');

// A performers arrow leaves the Performers chip and enters one. A box without that
// chip would have it drawn from Tags instead - an arrow saying it moves tags, with a
// button that moves performers.
const perfNodes = DIAGRAM_NODES.filter((n) => n.perf).map((n) => n.id);
h.check('a box at either end of a performers path holds performers',
  PATHS.filter((p) => p.kind === 'performers').every((p) =>
    perfNodes.indexOf(/^[a-z]+:([a-z_]+)>/.exec(p.id)[1]) !== -1 &&
    perfNodes.indexOf(p.target) !== -1),
  perfNodes.join(' '));

h.check('and nothing else claims to',
  perfNodes.length === 3 && perfNodes.join(' ') === 'image gallery scene',
  perfNodes.join(' '));

// Generous boxes: the widest caption a toggle can wear is "Common tags only", held at
// 9.5rem by `.ptp2re-toggle-wide`, and only the two paths carrying a mode ever wear
// it. Rounding up means the check fails before the overlap is visible rather than
// after.
const btn = (e) => {
  const w = pathById(e.id).common ? 160 : 64, hh = 30;
  return { id: e.id, x: e.bx - w / 2, y: e.by - hh / 2, w, h: hh };
};
const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const btns = geo.edges.map(btn);
const clashes = [];
btns.forEach((a, i) => {
  btns.slice(i + 1).forEach((b) => { if (overlaps(a, b)) clashes.push(a.id + ' / ' + b.id); });
  geo.nodes.forEach((n) => { if (overlaps(a, n)) clashes.push(a.id + ' on ' + n.id); });
});
h.check('no two toggles collide, and none lands on a box',
  clashes.length === 0, clashes.join(', ') || 'all clear');

h.check('and every one of them is on the canvas',
  btns.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= geo.w && b.y + b.h <= geo.h),
  btns.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > geo.w || b.y + b.h > geo.h)
    .map((b) => b.id).join(' ') || 'all inside');

// The clip is what makes an arrow start at the box and not in the middle of it. A
// zero-length one would mean two boxes overlapping, which no other check would see.
const onEdge = (x, y, n) =>
  Math.abs(x - n.x) < 0.01 || Math.abs(x - (n.x + n.w)) < 0.01 ||
  Math.abs(y - n.y) < 0.01 || Math.abs(y - (n.y + n.h)) < 0.01;
const box = (id) => geo.nodes.filter((n) => n.id === id)[0];
h.check('every arrow starts and ends on the border of its own box',
  geo.edges.every((e) =>
    onEdge(e.x1, e.y1, box(e.from)) && onEdge(e.x2, e.y2, box(e.to))),
  geo.edges.filter((e) => !(onEdge(e.x1, e.y1, box(e.from)) && onEdge(e.x2, e.y2, box(e.to))))
    .map((e) => e.id).join(' ') || 'all clipped');

// A reverse pair drawn with opposite bows lands on the same side of the line, not
// opposite sides - the perpendicular is taken from each arrow's own direction, which
// is already reversed. This is the mistake, and it is invisible: the two curves are
// simply drawn on top of each other.
const bowed = PATHS.filter((p) => p.pair && pathById(p.pair));
h.check('a reverse pair bows to opposite sides of its line',
  bowed.every((p) => {
    const a = geo.edges.filter((e) => e.id === p.id)[0];
    const b = geo.edges.filter((e) => e.id === p.pair)[0];
    // Their chords are the same line reversed, so the two mid-to-button offsets
    // point opposite ways when the curves are on opposite sides.
    const oa = { x: a.bx - (a.x1 + a.x2) / 2, y: a.by - (a.y1 + a.y2) / 2 };
    const ob = { x: b.bx - (b.x1 + b.x2) / 2, y: b.by - (b.y1 + b.y2) / 2 };
    return oa.x * ob.x + oa.y * ob.y < 0;
  }),
  bowed.map((p) => p.id + ' / ' + p.pair).join(', '));

// ── Order is the pipeline ─────────────────────────────────────────────────

const stages = PATHS.map((p) => p.stage);
h.check('the table is in stage order',
  stages.every((s, i) => i === 0 || s >= stages[i - 1]), stages.join(' '));

h.check('six stages, all of them used',
  new Set(stages).size === 6 && Math.max.apply(null, stages) === 6, stages.join(' '));

// The correction that matters, and the one the design got wrong first time round:
// the tag paths *read* performers, so a scene that gains a performer must gain them
// before its performers' tags are gathered. The other order leaves those tags for
// the next run - silently, since nothing errors.
const lastPerf = PATHS.reduce((acc, p, i) => (p.kind === 'performers' ? i : acc), -1);
const firstTag = PATHS.reduce((acc, p, i) => (acc === -1 && p.kind === 'tags' ? i : acc), -1);
h.check('every performer assignment lands before the first tag path',
  lastPerf !== -1 && firstTag !== -1 && lastPerf < firstTag,
  'last performer path at ' + lastPerf + ', first tag path at ' + firstTag);

// The reverses distribute what the earlier stages gathered, so running one before
// its forward partner would spread a stale set.
h.check('both reverses run in the last stage',
  PATHS.filter((p) => p.stage === 6).map((p) => p.id).sort().join(' ') ===
    'tags:gallery>image tags:group>scene',
  PATHS.filter((p) => p.stage === 6).map((p) => p.id).join(' '));

// A group has no performers and no markers of its own, so both are reached through
// its scenes - which is what makes them cost a query per group rather than riding
// along with the target page.
h.check('the two-hop paths are the ones through a group scenes',
  PATHS.filter((p) => p.hops === 2).map((p) => p.id).sort().join(' ') ===
    'tags:marker>group tags:performer>group',
  PATHS.filter((p) => p.hops === 2).map((p) => p.id).join(' '));

h.check('a two-hop path walks two steps',
  PATHS.filter((p) => p.hops === 2).every((p) => p.walk && p.walk.length === 2),
  PATHS.filter((p) => p.hops === 2).map((p) => p.id + '=' + (p.walk || []).join('.')).join(' '));

// ── The generated selections ──────────────────────────────────────────────
//
// Built from `walk` rather than stored beside it, so the traversal is stated once.
// These four cover every shape the builder has to produce.

h.check('a one-hop tag path selects its source tags',
  api.pathSelection(api.pathById('tags:performer>scene')) ===
    'performers { id name tags { id } }',
  api.pathSelection(api.pathById('tags:performer>scene')));

h.check('a two-hop tag path nests both steps',
  api.pathSelection(api.pathById('tags:performer>group')) ===
    'scenes { performers { id name tags { id } } }',
  api.pathSelection(api.pathById('tags:performer>group')));

// Only the leaf. An intermediate step is passed through, never logged, and naming it
// would put a join on every scene under every group for a string nobody reads.
h.check('and names only the entity the copy comes from',
  api.pathSelection(api.pathById('tags:performer>group')).indexOf('scenes { performers') === 0,
  api.pathSelection(api.pathById('tags:performer>group')));

// The source entity's own id, at the innermost level of every walk. It is what the
// cascade is looked up by: where the source is itself one of our targets, an earlier
// stage's *planned* additions to it have to count as already there, and without the
// id there is nothing to key that on.
h.check('every walk asks for the source entity own id',
  PATHS.filter((p) => p.walk).every((p) => {
    const sel = api.pathSelection(p);
    const inner = sel.slice(sel.lastIndexOf(p.walk[p.walk.length - 1] + ' {'));
    return /\{ id /.test(inner);
  }),
  PATHS.filter((p) => p.walk && !/\{ id /.test(api.pathSelection(p))).map((p) => p.id).join(' '));

// A marker keeps its primary tag in a required field of its own rather than in
// `tags`, and it counts: a marker whose primary tag is "Blonde" carries that tag as
// much as one that lists it. Asking only for `tags` would silently drop it.
h.check('a marker path asks for the primary tag as well',
  api.pathSelection(api.pathById('tags:marker>scene')) ===
    'scene_markers { id title primary_tag { id } tags { id } }',
  api.pathSelection(api.pathById('tags:marker>scene')));

// Scene.groups is [SceneGroup!] and Group.sub_groups is [GroupDescription!], neither
// of which is a Group - both wrap one in a `group` field. Walking straight to `tags`
// would ask for a field the type does not have.
h.check('an edge through a group description unwraps it',
  api.pathSelection(api.pathById('tags:group>scene')) ===
    'groups { group { id name tags { id } } }',
  api.pathSelection(api.pathById('tags:group>scene')));

h.check('a sub-group edge unwraps it too',
  api.pathSelection(api.pathById('tags:subgroup>group')) ===
    'sub_groups { group { id name tags { id } } }',
  api.pathSelection(api.pathById('tags:subgroup>group')));

// Performers carry `name` because nothing else in a run knows it: tags are named
// from the hierarchy query every run makes anyway, and fetching every performer in
// the library to name the handful a plan mentions would be a query for a log line.
h.check('a performer path selects performer ids and names',
  api.pathSelection(api.pathById('performers:gallery>scene')) ===
    'galleries { id title files { basename } folder { basename } performers { id name } }',
  api.pathSelection(api.pathById('performers:gallery>scene')));

h.check('a reverse path has no selection to splice into the target query',
  api.pathSelection(api.pathById('tags:image>gallery')) === '',
  api.pathSelection(api.pathById('tags:image>gallery')));

// ── Naming the source ─────────────────────────────────────────────────────
//
// The log names the entity a copy came from, so every path's source needs a label and
// the fields that label reads. A sourceType with no entry would log "Source" and an
// id, which is the failure this pins.

h.check('every path source type is one this can name',
  PATHS.every((p) => api.SOURCES[p.sourceType] && api.SOURCES[p.sourceType].label),
  PATHS.filter((p) => !api.SOURCES[p.sourceType]).map((p) => p.id).join(' '));

h.check('and asks for the fields its label reads',
  Object.keys(api.SOURCES).every((k) => /(^|\s)id(\s|$)/.test(api.SOURCES[k].fields) &&
    /name|title/.test(api.SOURCES[k].fields)),
  Object.keys(api.SOURCES).map((k) => k + '=' + api.SOURCES[k].fields).join(' | '));

// Four of the seven source types are also targets. Two field lists for one entity are
// two lists that can drift, and the fallback chain reads whichever is present - so a
// gallery-as-source must ask for exactly what a gallery-as-target does.
h.check('a source that is also a target reuses the target field list',
  ['scene', 'gallery', 'image', 'group'].every((k) => api.SOURCES[k] === api.TARGETS[k]),
  ['scene', 'gallery', 'image', 'group']
    .filter((k) => api.SOURCES[k] !== api.TARGETS[k]).join(' '));

h.check('a source names the entity, not the path',
  api.sourceLabel({}, { id: '7', name: 'Jane' }, api.pathById('tags:performer>scene')) ===
    'Performer "Jane" (7)',
  api.sourceLabel({}, { id: '7', name: 'Jane' }, api.pathById('tags:performer>scene')));

// A marker's title is optional and usually blank. Stash shows it by its primary tag,
// which every marker path already selects, so the log can say the same thing.
h.check('a titleless marker is named by its primary tag',
  api.sourceLabel({ 4: { name: 'Interview' } }, { id: '300', title: null, primary_tag: { id: '4' } },
    api.pathById('tags:marker>scene')) === 'Marker "Interview" (300)',
  api.sourceLabel({ 4: { name: 'Interview' } }, { id: '300', title: null, primary_tag: { id: '4' } },
    api.pathById('tags:marker>scene')));

// A gallery with neither title nor files still has to log something. The fallback
// chain is the target one, so a source falls back the same way a target does.
h.check('a source with nothing to be named by still names its type and id',
  api.sourceLabel({}, { id: '30' }, api.pathById('performers:gallery>scene')) ===
    'Gallery "untitled" (30)',
  api.sourceLabel({}, { id: '30' }, api.pathById('performers:gallery>scene')));

h.check('one source is named alone',
  api.fromLabel('Performer "Jane" (7)', 1) === 'Performer "Jane" (7)',
  api.fromLabel('Performer "Jane" (7)', 1));

h.check('and the rest are counted rather than listed',
  api.fromLabel('Performer "Jane" (7)', 3) === 'Performer "Jane" (7), +2 more',
  api.fromLabel('Performer "Jane" (7)', 3));

// ── Writing ───────────────────────────────────────────────────────────────

h.check('a copy is diffed against what the target already has',
  api.targetSelection(api.pathById('tags:studio>scene')) === 'tags { id }' &&
  api.targetSelection(api.pathById('performers:gallery>scene')) === 'performers { id }',
  api.targetSelection(api.pathById('performers:gallery>scene')));

h.check('each kind writes into its own BulkUpdateIds field',
  api.bulkField(api.pathById('tags:studio>scene')) === 'tag_ids' &&
  api.bulkField(api.pathById('performers:image>gallery')) === 'performer_ids',
  api.bulkField(api.pathById('performers:image>gallery')));

// Every target must carry the mutation the write goes through, the single-entity
// mutation auto mode watches for, and a route the manual buttons recognise. A
// missing one is a path that plans and never lands.
h.check('every target declares its bulk and single mutations and its route',
  Object.keys(TARGETS).every((k) => {
    const t = TARGETS[k];
    return t.bulk && t.bulkInput && t.single && t.find && t.node && t.route && t.fields;
  }),
  Object.keys(TARGETS).join(' '));

// The two never collide under a \b-anchored regex because Stash capitalises the type
// inside the bulk name - "bulkSceneUpdate" does not contain "sceneUpdate". Auto mode
// watches both, so a target where they did collide would react twice to one save.
h.check('a target bulk mutation name does not contain its single one',
  Object.keys(TARGETS).every((k) => TARGETS[k].bulk.indexOf(TARGETS[k].single) === -1),
  Object.keys(TARGETS).map((k) => TARGETS[k].bulk + ' / ' + TARGETS[k].single).join(', '));

// Only scenes, galleries and images carry the flag in Stash 0.31; groups have none,
// so the Organized filter silently cannot protect them and the setting says so.
h.check('groups are the one target with no Organized flag',
  TARGETS.group.organized === false && TARGETS.scene.organized === true &&
  TARGETS.gallery.organized === true && TARGETS.image.organized === true,
  Object.keys(TARGETS).map((k) => k + '=' + TARGETS[k].organized).join(' '));

// title is optional on all three of them, so each needs its own fallback - and the
// fallback fields are useless if the query never asks for them, which is exactly
// what shipped broken in NormalizeParentTags.
h.check('every target asks for something to name it by',
  /\bfiles \{ basename \}/.test(TARGETS.scene.fields) &&
  /\bfolder \{ basename \}/.test(TARGETS.gallery.fields) &&
  /visual_files/.test(TARGETS.image.fields) &&
  /\bname\b/.test(TARGETS.group.fields),
  Object.keys(TARGETS).map((k) => k + ': ' + TARGETS[k].fields).join('\n        '));

h.finish();
