// Propagate Tags and Performers to Related Entities
//
// Requires Stash 0.31.0 or newer: tag custom_fields (the custom-field exclusion
// filter) and PluginApi component patching (staging into an edit form) both depend
// on it.
//
// Copies tags and performers along Stash's own entity relationships - a scene's
// performers' tags onto the scene, a gallery's images' performers onto the gallery,
// a group's scenes' tags onto the group. It is always a *copy*: nothing is ever
// removed from the source, and the only code here that removes anything at all is
// the task dialog's Undo, taking back what that same dialog wrote.
//
// The design notes, and the reasoning behind the parts that look arbitrary, are in
// CLAUDE.md next to this file.
(function () {
  'use strict';

  var PLUGIN_ID   = 'PropagateTagsAndPerformers';
  var PLUGIN_NAME = 'ᝯㄝₓ Propagate Tags and Performers to Related Entities';
  // The name the dialog wears. `PLUGIN_NAME` is the manifest's, and it has to stay
  // byte-identical to the `.yml` because `ownSettingGroup` finds this plugin's block
  // on the settings page by matching that heading - but as the first third of a
  // dialog title that also names a task, a path and an entity, it is the least
  // informative third and the longest. Two names, one of them free to be short.
  var PLUGIN_SHORT_NAME = 'ᝯㄝₓ Propagate Tags & Performers';

  // The two siblings this plugin reads settings from by name. NormalizeParentTags is
  // `checkHierarchySibling`'s, below; MergePerformerTagsToScenes is the exclusion
  // filters' - see `importSiblingExclusions`. The *overlap* with the second is still
  // detected generically, through `coop().declares` rather than by name, because it
  // is the kind of collision a future relationship-copying plugin could have too; a
  // settings shape is not, and there is nothing generic to key an import on.
  var NPT_ID   = 'NormalizeParentTags';
  var NPT_NAME = 'ᝯㄝₓ Normalize Parent Tags';
  var MPTTS_ID   = 'MergePerformerTagsToScenes';
  var MPTTS_NAME = 'ᝯㄝₓ Merge Performer Tags To Scenes';

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and goes current the moment plugins are reloaded, while the browser can
  // still be running a script it cached before the edit - so a heading reading one
  // version over the previous one's behaviour is the normal look of a stale script,
  // not a contradiction.
  // This constant travels inside the file. Bump it with the manifest and the yml;
  // the `version` suite fails if the three disagree.
  var PLUGIN_VERSION = '3.13.0';

  // Printed before anything else runs, so a script that loads and then throws is
  // told apart from one that never loaded at all: banner plus error means the new
  // code is running and broken, no banner means the browser is still on the old one.
  // Through whatever the console offers rather than console.info directly: this is
  // the first statement in the file, so a console without it would take the whole
  // plugin down before anything loaded.
  function ptp2re(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  ptp2re('[ptp2re] PropagateTagsAndPerformers.js ' + PLUGIN_VERSION + ' loaded. This is the ' +
    'running script\'s own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/StashPlugins/blob/main/PropagateTagsAndPerformers/README.md';
  var README_LINK_ID = 'ptp2re-readme-link';
  var DESC_TOGGLE_ID = 'ptp2re-desc-toggle';
  var STYLE_ID       = 'ptp2re-style';

  // Every button this plugin puts on a page, and every task button Stash renders for
  // it, in amber. Stash's own row actions are `btn-secondary`, so a button of ours
  // sitting among them was indistinguishable from one of its own - and these are not
  // the same kind of thing: Stash's write what is in the form in front of you, ours
  // reach out and rewrite other entities. Amber says "this one is mine and it writes"
  // without claiming the primary role `btn-primary` would.
  //
  // A Bootstrap variant class rather than a colour of our own, so the hover, focus
  // and active states come from Stash's theme and stay in step with it. Its
  // `btn-warning` renders white text, unlike stock Bootstrap's dark - checked live,
  // 2026-08-11 - so nothing here overrides the foreground. `btn-dark` is worth
  // knowing about and not worth using: Stash themes it identically to
  // `btn-secondary`, so it would read as no change at all.
  var PLUGIN_BTN_VARIANT = 'btn-warning';
  // Teal for a control that only reads, or that writes nothing but a setting of ours:
  // the Path Settings task and the button that replaces its row on the settings page.
  // What that setting says is already amber on the line above the button.
  var READONLY_BTN_VARIANT = 'btn-info';

  // Declared in the manifest so Stash lists it under Settings - Tasks - Plugin
  // Tasks, but run in the browser: this plugin has no exec, so a queued job could
  // only fail.
  var TASK_PROPAGATE_ALL = 'Propagate All...';
  // The editor for the one setting the path block is now. It writes a setting rather
  // than the library, and it is **not** a task: Stash's task list is for things that
  // act on the library, and this one only changes which paths are enabled. It opens
  // from the run dialog's own footer and from the button that takes over the Paths
  // settings row - both places a user is already looking at what it edits.
  var TASK_PATHS = 'Path Settings...';
  var TASKS = [TASK_PROPAGATE_ALL];

  var PAGE_SIZE      = 500;    // targets per page while walking the library
  var CHUNK_SIZE     = 100;    // target ids per bulk mutation
  var LOG_RENDER_CAP = 1000;   // log lines kept in the DOM; all of them stay in memory
  var LOG_FLUSH_MS   = 100;
  var PROGRESS_TIP =
    'Each segment is one pass: the entity type it walks, then the pipeline stage it ' +
    'runs in, then how many of that pass\u2019s entities have been read out of how ' +
    'many it found. Stages run in order and a later one sees what an earlier one ' +
    'added \u2014 markers put tags on a scene in stage 2, and stage 4 carries that ' +
    'scene\u2019s tags on to its groups \u2014 so one type can appear more than once ' +
    'with a different stage each time. A segment appears only once its pass has ' +
    'started.';
  // The busy cursor under the last log line. The counters say how far a pass has
  // got; this says it is still going, which is the question a sweep that spends
  // seconds on one page of images leaves unanswered.
  var SPIN_FRAMES    = ['▙', '▛', '▜', '▟'];
  var SPIN_MS        = 125;   // one four-frame cycle at 2Hz
  var LEASE_TTL_MS   = 300000;
  var UNDO_ARM_MS    = 4000;   // how long Undo stays armed for its second click

  // Auto mode. The lease it takes is measured in the seconds one reaction lasts, not
  // the minutes a library-wide task does, so it gets its own much shorter TTL - a
  // crashed tab must not stand a sibling down for five minutes over one scene save.
  var AUTO_LEASE_TTL_MS    = 30000;
  var AUTO_SETTINGS_TTL_MS = 10000;  // settings are re-read at most this often
  var AUTO_COOLDOWN_MS     = 8000;   // per-entity: how long after our own write we ignore it
  var AUTO_COOLDOWN_MAX    = 2000;   // entries kept before the expired ones are swept

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  // "3 changes", "1 change" - the count is always known where it is printed, so the
  // "(s)" these dialogs used to write everywhere was never carrying information. An
  // irregular plural passes its own; everything else takes an "s". Keep this function
  // byte-identical across the plugins, like the CSS.
  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function oneLine(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').replace(/^ | $/g, '');
  }

  // ── Targets ───────────────────────────────────────────────────────────────
  //
  // The four entities anything is ever written to. Everything a write needs hangs
  // off this table so a path only has to name its target - `bulk` for the task,
  // `single` for auto mode to watch, `route` for the manual buttons to recognise a
  // page, `fields` for the log to name the entity.
  //
  // `organized` records which of them actually have the flag - in Stash 0.31 that
  // is scenes, galleries and images, but not groups. Flipping one entry here is all
  // it takes if a later Stash adds it.
  //
  // The display name is `title` everywhere but groups, and `title` is *optional* on
  // all three, so each carries its own fallback: a scene falls back to its file, a
  // gallery to its file and then its folder (a gallery is a zip or a folder, and a
  // folder gallery has no file at all), an image to `visual_files` - `Image.files`
  // is deprecated in favour of a union, so the concrete types have to be named.
  var TARGETS = {
    scene: {
      key: 'scene', label: 'Scene', plural: 'Scenes',
      find: 'findScenes', one: 'findScene', node: 'scenes', filterArg: 'scene_filter',
      bulk: 'bulkSceneUpdate', bulkInput: 'BulkSceneUpdateInput', single: 'sceneUpdate',
      organized: true, pageSize: 500,
      route: /^\/scenes\/(\d+)(?:\/|$)/,
      fields: 'id title files { basename }',
    },
    gallery: {
      key: 'gallery', label: 'Gallery', plural: 'Galleries',
      find: 'findGalleries', one: 'findGallery', node: 'galleries', filterArg: 'gallery_filter',
      bulk: 'bulkGalleryUpdate', bulkInput: 'BulkGalleryUpdateInput', single: 'galleryUpdate',
      organized: true, pageSize: 500,
      route: /^\/galleries\/(\d+)(?:\/|$)/,
      fields: 'id title files { basename } folder { basename }',
    },
    image: {
      key: 'image', label: 'Image', plural: 'Images',
      find: 'findImages', one: 'findImage', node: 'images', filterArg: 'image_filter',
      bulk: 'bulkImageUpdate', bulkInput: 'BulkImageUpdateInput', single: 'imageUpdate',
      organized: true, pageSize: 500,
      route: /^\/images\/(\d+)(?:\/|$)/,
      fields: 'id title visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }',
    },
    group: {
      key: 'group', label: 'Group', plural: 'Groups',
      find: 'findGroups', one: 'findGroup', node: 'groups', filterArg: 'group_filter',
      bulk: 'bulkGroupUpdate', bulkInput: 'BulkGroupUpdateInput', single: 'groupUpdate',
      organized: false, pageSize: 1000,
      route: /^\/groups\/(\d+)(?:\/|$)/,
      fields: 'id name',
    },
  };

  // ── Paths ─────────────────────────────────────────────────────────────────
  //
  // The thirteen things this plugin can do, and the spine of everything below: the
  // task, the auto modes, the manual buttons and the cross-plugin declaration all
  // read this one table rather than each carrying their own list.
  //
  // **Array order is the pipeline order and is semantics, not presentation.** Paths
  // cascade - running markers into scenes before scenes into groups means the group
  // transitively inherits marker tags, and the reverse order does not - so the order
  // is fixed here, stated in the dialog, and must never be derived from the settings
  // object's key order, which is not guaranteed.
  //
  // Six stages, and the reason for each boundary:
  //
  //   1  performer assignments first, because the tag paths *read* performers. A
  //      scene that gains a performer in stage 1 has that performer's tags copied in
  //      stage 2; the other order leaves them for the next run.
  //   2  tags onto scenes.
  //   3  tags onto galleries.
  //   4  tags onto groups - after scenes have settled, since three of the four
  //      group paths read scenes (two of them through scenes to reach performers
  //      and markers, which groups do not have of their own).
  //   5  sub-groups into their containing group, after those groups have gathered.
  //   6  the two reverses last, so they distribute what stages 1-5 gathered rather
  //      than a stale set.
  //
  // Fields:
  //   id        stable identifier, published to other plugins via the coop registry,
  //             and the token the `b1Paths` setting names this path by
  //   kind      what is copied: 'tags' or 'performers'
  //   target    a TARGETS key - the entity written to
  //   sourceType  what the walk lands on. Where it is itself a TARGETS key, an
  //             earlier stage may have *planned* additions to it that this stage
  //             must see - see `plannedFor` and the cascade note in CLAUDE.md.
  //   walk      field names from the target down to whatever carries the payload.
  //             Steps may be objects or arrays (`studio` is one, `performers` is
  //             many) and the walk handles both rather than annotating which.
  //   markerTags  the leaf is a SceneMarker, whose primary_tag counts as one of its
  //             tags and lives in its own required field
  //   reverse   set instead of `walk` where Stash has no field for the traversal.
  //             `backRef` is the field on the *source* that names the target -
  //             `Image.galleries`, since `Gallery.images` does not exist. Such a
  //             path's `sourceType` must be a target type, because the sweep that
  //             gathers it is a paged query over that entity; see `sweepPass`.
  //   common    the path offers "common tags only" as a third mode
  //   pair      the id of the path that reverses this one, where one exists
  //   hops      1, or 2 where the payload is reached through an intermediate entity
  var PATHS = [
    // Stage 1 - performer assignments, before anything reads performers.
    { id: 'performers:image>gallery', kind: 'performers', stage: 1, hops: 1,
      target: 'gallery', sourceType: 'image',
      source: 'Images', button: 'Add all Perfs from all Images',
      reverse: { backRef: 'galleries' } },
    { id: 'performers:gallery>scene', kind: 'performers', stage: 1, hops: 1,
      target: 'scene', sourceType: 'gallery',
      source: 'Galleries', button: 'Add all Perfs from all Galleries',
      walk: ['galleries'] },

    // Stage 2 - tags onto scenes.
    { id: 'tags:marker>scene', kind: 'tags', stage: 2, hops: 1,
      target: 'scene', sourceType: 'marker',
      source: 'Markers', button: 'Add all Tags from all Markers',
      walk: ['scene_markers'], markerTags: true },
    { id: 'tags:performer>scene', kind: 'tags', stage: 2, hops: 1,
      target: 'scene', sourceType: 'performer',
      source: 'Performers', button: 'Add all Tags from all Performers',
      walk: ['performers'] },
    { id: 'tags:studio>scene', kind: 'tags', stage: 2, hops: 1,
      target: 'scene', sourceType: 'studio',
      source: 'Studio', button: 'Add Tags from Studio',
      walk: ['studio'] },

    // Stage 3 - tags onto galleries.
    { id: 'tags:image>gallery', kind: 'tags', stage: 3, hops: 1,
      target: 'gallery', sourceType: 'image',
      source: 'Images', button: 'Add all Tags from all Images',
      pair: 'tags:gallery>image',
      reverse: { backRef: 'galleries' } },

    // Stage 4 - tags onto groups. A Group has no performers and no markers of its
    // own, so those two are two-hop traversals through its scenes.
    { id: 'tags:scene>group', kind: 'tags', stage: 4, hops: 1,
      target: 'group', sourceType: 'scene',
      source: 'Scenes', button: 'Add {mode} Tags from all Scenes',
      common: true, pair: 'tags:group>scene',
      walk: ['scenes'] },
    { id: 'tags:studio>group', kind: 'tags', stage: 4, hops: 1,
      target: 'group', sourceType: 'studio',
      source: 'Studio', button: 'Add Tags from Studio',
      walk: ['studio'] },
    { id: 'tags:performer>group', kind: 'tags', stage: 4, hops: 2,
      target: 'group', sourceType: 'performer',
      source: 'Performers', button: 'Add all Tags from all Performers',
      walk: ['scenes', 'performers'] },
    { id: 'tags:marker>group', kind: 'tags', stage: 4, hops: 2,
      target: 'group', sourceType: 'marker',
      source: 'Markers', button: 'Add all Tags from all Markers',
      walk: ['scenes', 'scene_markers'], markerTags: true },

    // Stage 5 - sub-groups roll up into their containing group. Group.sub_groups is
    // a list of GroupDescription, not of Group, hence the `group` step.
    { id: 'tags:subgroup>group', kind: 'tags', stage: 5, hops: 1,
      target: 'group', sourceType: 'group',
      source: 'Sub-groups', button: 'Add {mode} Tags from all Sub-groups',
      common: true, walk: ['sub_groups', 'group'] },

    // Stage 6 - the reverses, distributing what the stages above gathered. Both
    // close a cycle with a path already in the table, which is why the per-entity
    // cooldown above exists; see CLAUDE.md.
    { id: 'tags:group>scene', kind: 'tags', stage: 6, hops: 1,
      target: 'scene', sourceType: 'group',
      source: 'Groups', button: 'Add all Tags from all Groups',
      pair: 'tags:scene>group',
      walk: ['groups', 'group'] },
    { id: 'tags:gallery>image', kind: 'tags', stage: 6, hops: 1,
      target: 'image', sourceType: 'gallery',
      source: 'Galleries', button: 'Add all Tags from all Galleries',
      pair: 'tags:image>gallery',
      walk: ['galleries'] },
  ];

  // How a source entity is named in the log, keyed by a path's `sourceType`.
  //
  // "from Performers" told the user which *path* was responsible; it did not tell them
  // which performer, which is the thing they have to open to understand or undo a copy
  // by hand. So each source carries the fields its own label needs.
  //
  // The four that are also targets reuse the target's field list rather than repeating
  // it: two lists describing one entity are two lists that can drift, and the fallback
  // chain reads whichever of them is present.
  // `one` is the by-id query field, needed by the source-side button probe to read a
  // source's own payload. The four that reuse a `TARGETS` entry get it from there;
  // these three carry their own, since nothing else in the plugin ever fetches a
  // Performer, a Studio or a SceneMarker by id on its own.
  var SOURCES = {
    performer: { label: 'Performer', fields: 'id name', one: 'findPerformer' },
    studio: { label: 'Studio', fields: 'id name', one: 'findStudio' },
    // A marker's title is optional and usually blank. `sourceLabel` falls back to the
    // primary tag, which is what Stash itself shows on the scene's marker list, and
    // which every marker path already selects.
    marker: { label: 'Marker', fields: 'id title', one: 'findSceneMarker' },
    scene: TARGETS.scene,
    gallery: TARGETS.gallery,
    image: TARGETS.image,
    group: TARGETS.group,
  };

  // What a path reads off whatever its walk lands on.
  //
  // A marker keeps its primary tag in a required field of its own rather than in
  // `tags`, and it counts - a marker whose primary tag is "Blonde" carries that tag
  // as much as one that lists it.
  //
  // Performers carry `name` because nothing else in the run knows it: tags are named
  // from the hierarchy query every run makes anyway, and fetching every performer in
  // the library to name the handful a plan mentions would be a query for a log line.
  function leafSelection(path) {
    if (path.kind === 'performers') return 'performers { id name }';
    return path.markerTags ? 'primary_tag { id } tags { id }' : 'tags { id }';
  }

  // The GraphQL selection that gathers a path's sources, built from `walk` rather
  // than stored beside it: two fields describing one traversal are two fields that
  // can disagree. Empty for a reverse path, which is a query of its own.
  //
  // The source entity's own `id` comes back with the payload, and it is not
  // decoration: where the source is itself one of our targets, an earlier stage may
  // have *planned* additions to it that this stage has to see, and the id is how
  // those are looked up. See the cascade note on `plannedFor`. Its name comes back for
  // a smaller reason - the log line naming what was responsible - and rides along with
  // the traversal rather than costing a query of its own.
  function pathSelection(path) {
    if (!path.walk) return '';
    var src = SOURCES[path.sourceType];
    var sel = (src ? src.fields : 'id') + ' ' + leafSelection(path);
    for (var i = path.walk.length - 1; i >= 0; i--) sel = path.walk[i] + ' { ' + sel + ' }';
    return sel;
  }

  // What the target already has, which is what a copy is diffed against.
  function targetSelection(path) {
    return path.kind === 'performers' ? 'performers { id }' : 'tags { id }';
  }

  // The BulkUpdateIds field the write goes into.
  function bulkField(path) {
    return path.kind === 'performers' ? 'performer_ids' : 'tag_ids';
  }

  function pathById(id) {
    for (var i = 0; i < PATHS.length; i++) if (PATHS[i].id === id) return PATHS[i];
    return null;
  }

  // "Performers of a Gallery onto its Scenes", for the log and the dialog head.
  function pathLabel(path) {
    var kind = path.kind === 'performers' ? 'Performers' : 'Tags';
    return kind + ': ' + path.source + ' → ' + TARGETS[path.target].plural;
  }

  // What a path's name says when hovered, built from the table rather than written
  // out thirteen times: a row renamed or re-routed there cannot leave a tooltip
  // describing what it used to do. The two sentences after the first are the two
  // things `pathLabel` cannot fit - what the third mode means, and that a path has a
  // reverse in the table which, run together, drives both sides to one set.
  function pathTip(path) {
    var t = TARGETS[path.target].label;
    var what = path.kind === 'performers' ? 'performers' : 'tags';
    var tip = 'Adds the ' + what + ' of each ' + t + '\u2019s ' + path.source.toLowerCase() +
      (path.hops === 2 ? ', reached through its scenes,' : '') + ' onto the ' + t + '.';
    if (path.common) {
      tip += ' Common tags only adds a tag when every one of them carries it.';
    }
    if (path.pair && pathById(path.pair)) {
      tip += ' Runs opposite to ' + pathLabel(pathById(path.pair)) +
        '; with both on, the two converge on one set of tags.';
    }
    return tip;
  }

  // How the paths are laid out wherever they are shown together - the dialog's three
  // columns, and the settings row's listing. It is the user's own grouping, not
  // pipeline order: performer-carrying paths, then the two-way image/studio ones,
  // then the two aggregations into a Group that carry a mode.
  //
  // **Presentation only.** `PATHS` is still the order a run walks, the order
  // `formatPaths` writes and the order the dialog's head says matters; this decides
  // nothing but where a row sits. A path missing from here or named twice would be a
  // path with no control, so `propagate-paths` pins the two lists against each other.
  //
  // A `null` is a gap: a blank row in the column, separating two groups of paths that
  // are read as one. It exists only where the dialog draws rows, so `displayPaths`
  // drops it - the settings row lists the paths that are on, where a gap between two
  // groups that may both be absent would be a blank line with nothing either side.
  var PATH_COLUMNS = [
    ['tags:studio>group', 'tags:group>scene', 'tags:image>gallery', 'tags:gallery>image',
     'tags:marker>group', 'tags:marker>scene'],
    ['tags:studio>scene', 'tags:performer>group', 'tags:performer>scene', null,
     'performers:image>gallery', 'performers:gallery>scene'],
    ['tags:scene>group', 'tags:subgroup>group'],
  ];

  function displayPaths() {
    var out = [];
    PATH_COLUMNS.forEach(function (col) {
      col.forEach(function (id) { var p = id && pathById(id); if (p) out.push(p); });
    });
    return out;
  }

  // ── The same thirteen paths, as a diagram ─────────────────────────────────
  //
  // The list is a column of names; this is the graph those names describe - one box
  // per entity type, the tags and (where the type has them) the performers inside
  // it, and one arrow per path leaving what it reads and entering what it writes.
  //
  // **Hand-placed boxes, everything else derived.** An arrow runs between the two
  // chips it joins, clipped to the boxes, and its toggle sits on that curve. So a
  // fourteenth path draws itself from `PATHS` alone, and only a
  // new *entity type* would need a coordinate - which is why `propagate-paths` pins
  // the node table against the paths in both directions, the way it already pins
  // `PATH_COLUMNS`.
  //
  // Left to right: the types that only ever give (Studio, Performer, Marker, and the
  // Image/Gallery pair), then Scene, then Group and its sub-groups. That is roughly
  // pipeline order, because the stages walk towards Group.
  //
  // The node id is the path id's own source segment, which is what makes `subgroup`
  // a box of its own: the schema says Group, the path says sub-group, and a diagram
  // that drew `tags:subgroup>group` as an arrow from Group to itself would be true
  // and useless.
  // The canvas is the size of what is on it plus `pad` all round - there is no fixed
  // width here, because the arrangement is the user's and a fixed one would be either
  // too small for theirs or full of empty space. A toggle is a point in the geometry,
  // so `btnW`/`btnH` is the nominal button allowed around it when the extent is
  // measured; it is deliberately wider than any real caption, since a shade too much
  // padding beats a button clipped at the edge.
  var DIA = { boxW: 160, boxH: 56, chipY: 30, chipH: 20, pad: 20, btnW: 160, btnH: 30 };
  var DIAGRAM_NODES = [
    { id: 'studio', label: 'Studio', x: 20, y: 20 },
    { id: 'performer', label: 'Performer', x: 95, y: 95 },
    { id: 'marker', label: 'Marker', x: 225, y: 160 },
    { id: 'image', label: 'Image', x: 560, y: 395, perf: true },
    { id: 'gallery', label: 'Gallery', x: 560, y: 270, perf: true },
    { id: 'scene', label: 'Scene', x: 320, y: 270, perf: true },
    { id: 'group', label: 'Group', x: 760, y: 20 },
    { id: 'subgroup', label: 'Sub-group', x: 755, y: 155 },
  ];

  // Where a path's toggle sits, and with it the curve its arrow takes: `along` the
  // straight line between the two chips as a fraction of it, and `off` at right angles
  // to that line in pixels. The arrow is a quadratic bent so that its own halfway
  // point is exactly there, which is what makes one dragged point set both - see
  // `curveFrom`.
  //
  // The one thing here the geometry cannot work out for itself. Three arrows run
  // between Image and Gallery and would otherwise be drawn on top of each other; the
  // Scene/Group pair is close enough that a straight pair collides as well; and
  // Group's left edge, where the three long arrows from Studio, Performer and Marker
  // all arrive, is no place to park a button - one there reads as theirs.
  //
  // **A reverse pair takes the same `off`, not opposite ones.** The perpendicular is
  // taken from each arrow's own direction, which is already reversed, so equal offsets
  // put the two curves on opposite sides of the line - and opposite offsets put them
  // on the same side, which is what the first draft of this did.
  //
  // Anything a layout stored in the browser says replaces the entry here; see
  // `storedLayout`.
  var DIAGRAM_CURVE = {
    'tags:marker>scene': { along: 0.452, off: -2 },
    'tags:performer>scene': { along: 0.313, off: 28 },
    'tags:studio>scene': { along: 0.354, off: 86 },
    'tags:image>gallery': { along: 0.507, off: -34 },
    'tags:scene>group': { along: 0.476, off: 32 },
    'tags:studio>group': { along: 0.362, off: 0 },
    'tags:performer>group': { along: 0.436, off: -1 },
    'tags:subgroup>group': { along: 0.49, off: 29 },
    'tags:group>scene': { along: 0.634, off: 42 },
    'tags:gallery>image': { along: 0.512, off: -34 },
    'performers:image>gallery': { along: 0.5, off: 42 },
  };

  // Where a chip sits inside its box. Both are anchors, not just labels: an arrow
  // carrying performers leaves the Performers chip, so which of the two a path moves
  // is legible from where its arrow starts before any colour is read.
  function diaChip(node, kind) {
    var perf = kind === 'performers' && node.perf;
    return {
      kind: perf ? 'performers' : 'tags',
      label: perf ? 'Performers' : 'Tags',
      x: node.x + (perf ? 62 : 10),
      y: node.y + DIA.chipY,
      w: perf ? 88 : 46,
      h: DIA.chipH,
    };
  }

  // Where the ray from `p` towards `q` leaves `p`'s box. `p` is a chip centre, so it
  // is inside the box by construction and the near side is whichever of the two
  // slabs it reaches first.
  function diaExit(p, q, box) {
    var dx = q.x - p.x, dy = q.y - p.y, ts = [];
    if (dx > 0) ts.push((box.x + box.w - p.x) / dx);
    else if (dx < 0) ts.push((box.x - p.x) / dx);
    if (dy > 0) ts.push((box.y + box.h - p.y) / dy);
    else if (dy < 0) ts.push((box.y - p.y) / dy);
    var t = ts.length ? Math.min.apply(Math, ts) : 0;
    return { x: p.x + dx * t, y: p.y + dy * t };
  }

  // The chord's own axes: along it, and at right angles to it. Everything about a
  // curve is stored in these rather than in canvas pixels, so moving a box carries
  // its arrows' shapes with it instead of leaving them behind.
  function diaAxes(s, e) {
    var dx = e.x - s.x, dy = e.y - s.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { len: len, ux: dx / len, uy: dy / len, nx: -dy / len, ny: dx / len };
  }

  // The toggle's point, and the control point of an arrow passing through it. A
  // quadratic is at `(s + 2c + e) / 4` halfway along, so `c = 2p - (s + e) / 2` puts
  // that halfway point exactly on `p` - which is why a dragged button lands where it
  // was released rather than near it.
  function curveFrom(s, e, curve) {
    var a = diaAxes(s, e), along = curve ? curve.along : 0.5, off = curve ? curve.off : 0;
    var p = {
      x: s.x + a.ux * a.len * along + a.nx * off,
      y: s.y + a.uy * a.len * along + a.ny * off,
    };
    return { p: p, c: { x: 2 * p.x - (s.x + e.x) / 2, y: 2 * p.y - (s.y + e.y) / 2 } };
  }

  // And back: a point on the canvas as a curve. What a drag produces.
  function curveTo(s, e, x, y) {
    var a = diaAxes(s, e), px = x - s.x, py = y - s.y;
    return {
      along: (px * a.ux + py * a.uy) / a.len,
      off: px * a.nx + py * a.ny,
    };
  }

  // The whole picture as numbers, with no DOM in sight - which is what lets the
  // layout be checked, and drawn into a file, without a browser.
  //
  // `layout` is an arrangement to draw instead of the tables above: the dialog's own
  // while a drag is in flight, whatever the browser has stored otherwise. Merged by
  // id and one entry at a time, so a box this release has added and the stored layout
  // has never heard of keeps its place here rather than the whole layout being
  // discarded.
  function diagramGeometry(layout) {
    var moved = (layout && layout.nodes) || {};
    var curves = (layout && layout.curves) || {};
    var boxes = {}, nodes = [];
    DIAGRAM_NODES.forEach(function (n) {
      var at = moved[n.id] || {};
      var x = typeof at.x === 'number' ? at.x : n.x;
      var y = typeof at.y === 'number' ? at.y : n.y;
      var box = { id: n.id, label: n.label, x: x, y: y, w: DIA.boxW, h: DIA.boxH,
        perf: !!n.perf, chips: [] };
      box.chips.push(diaChip(box, 'tags'));
      if (n.perf) box.chips.push(diaChip(box, 'performers'));
      boxes[n.id] = box;
      nodes.push(box);
    });
    var edges = PATHS.map(function (p) {
      var m = /^[a-z]+:([a-z_]+)>([a-z]+)$/.exec(p.id);
      var a = boxes[m[1]], b = boxes[m[2]];
      if (!a || !b) return null;
      var ca = diaChip(a, p.kind), cb = diaChip(b, p.kind);
      var pa = { x: ca.x + ca.w / 2, y: ca.y + ca.h / 2 };
      var pb = { x: cb.x + cb.w / 2, y: cb.y + cb.h / 2 };
      var s = diaExit(pa, pb, a), e = diaExit(pb, pa, b);
      var bent = curveFrom(s, e, curves[p.id] || DIAGRAM_CURVE[p.id]);
      return {
        id: p.id, kind: p.kind, hops: p.hops, from: a.id, to: b.id,
        x1: s.x, y1: s.y, x2: e.x, y2: e.y,
        cx: bent.c.x, cy: bent.c.y, bx: bent.p.x, by: bent.p.y,
      };
    }).filter(Boolean);
    // What the picture actually occupies. `minX`/`minY` are how `centreLayout` knows
    // what to subtract; the canvas takes the far side plus the same padding.
    var b = { minX: Infinity, minY: Infinity, maxX: 0, maxY: 0 };
    function span(x1, y1, x2, y2) {
      b.minX = Math.min(b.minX, x1); b.minY = Math.min(b.minY, y1);
      b.maxX = Math.max(b.maxX, x2); b.maxY = Math.max(b.maxY, y2);
    }
    nodes.forEach(function (n) { span(n.x, n.y, n.x + n.w, n.y + n.h); });
    edges.forEach(function (e) {
      span(e.bx - DIA.btnW / 2, e.by - DIA.btnH / 2,
        e.bx + DIA.btnW / 2, e.by + DIA.btnH / 2);
    });
    return {
      w: b.maxX + DIA.pad, h: b.maxY + DIA.pad,
      minX: b.minX, minY: b.minY, nodes: nodes, edges: edges,
    };
  }

  // Which paths another path's tags already reach without it being switched on.
  // `tags:studio>group` and `tags:group>scene` together put a studio's tags on its
  // groups and then on those groups' scenes, so `tags:studio>scene` is happening
  // whether or not anybody enabled it - and a dialog that shows it as Off is telling
  // the user something that is not true of their library.
  //
  // Composed **in pipeline order**, which is what makes the answer honest about one
  // run rather than about eventually: a chain is only recorded when each link comes
  // after the one feeding it, exactly as `plannedFor`'s cascade works. A chain that
  // runs the other way round does land, one run later, and this deliberately does not
  // claim it.
  //
  // Only `on` links count, never `common`: a link that copies just the tags all its
  // sources share carries some of the payload, and claiming a path is covered would
  // overstate what a user would get.
  //
  // Returns `{ kind: { sourceType: { target: [pathId, ...] } } }` - the witness chain
  // rather than a flag, so the button can name the paths doing the work.
  function pathChains(modes) {
    var reach = {};
    PATHS.forEach(function (p) {
      if ((modes && modes[p.id]) !== PATH_ON) return;
      var r = reach[p.kind] || (reach[p.kind] = {});
      var grown = [], src;
      for (src in r) {
        if (hasOwn(r, src) && r[src][p.sourceType]) {
          grown.push([src, r[src][p.sourceType].concat([p.id])]);
        }
      }
      (r[p.sourceType] || (r[p.sourceType] = {}))[p.target] = [p.id];
      grown.forEach(function (g) { r[g[0]][p.target] = g[1]; });
    });
    return reach;
  }

  // The chain covering a path that is itself off, or null. A chain of one is the path
  // itself and can only turn up for a path that is on, which this never asks about.
  function coveredBy(chains, path) {
    var byKind = chains[path.kind] || {};
    var chain = (byKind[path.sourceType] || {})[path.target];
    return chain && chain.length > 1 ? chain : null;
  }

  function enabledPaths(s) {
    return PATHS.filter(function (p) { return pathOn(s, p); });
  }

  // A manual button's caption: "Copy [all|common] [Tags|Perfs] [to|from] all
  // <plural>". Only the two paths carrying a "common tags only" toggle (`e1`'s
  // `tags:scene>group`, `e6`'s `tags:subgroup>group`) have a `{mode}` token to fill in
  // - every other path's `button` is already the final string, same as it always was.
  // Reads whichever mode is currently configured, so the two buttons whose meaning
  // depends on it never show a caption the setting has moved past.
  function buttonLabel(path, s) {
    if (!path.common) return path.button;
    return path.button.replace('{mode}', pathCommon(s, path) ? 'common' : 'all');
  }

  // Whether a target-side click has a form to stage into. Both the caption, the tooltip
  // and the click itself read this one expression, so a button cannot promise a review
  // this Stash - or this setting - is not going to give.
  function savesImmediately(s) {
    return !!(s && s.a2SaveImmediately) || !_selectPatchesInstalled;
  }

  // "..." marks a button that asks before it acts: the click opens the review dialog
  // rather than writing. A staging button gets none - it puts the additions in the form
  // in front of you and Stash's own Save is the next step.
  function withEllipsis(label, opensDialog) {
    return opensDialog ? label + '...' : label;
  }

  // Two plugins' buttons for one path have to match on text for the dedup below to see
  // them as the same button, and each side appends "..." on its own conditions - a
  // sibling staging where we save writes the same button with a different caption.
  // Comparing without it keeps the dedup answering the question it is actually asking.
  function sameButtonLabel(a, b) {
    return stripEllipsis(a) === stripEllipsis(b);
  }

  // The "..." is a promise a *caption* makes - "this click asks before it acts". Inside
  // a sentence it is only trailing punctuation in the middle of one, so a scoped run's
  // title takes the caption back off before naming the entity after it.
  function stripEllipsis(label) {
    return String(label).replace(/\.+$/, '');
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  //
  // The manifest keys carry ordering prefixes because `settings:` is a YAML map:
  // the declaration order is gone by the time Stash has parsed it, and the settings
  // page renders the keys sorted alphabetically. The blocks are
  //
  //   a1-a4  what starts a run: the buttons, the staging flag directly under them,
  //          then the two automatic modes
  //   b1-b5  paths into Scenes
  //   c1-c2  paths into Galleries
  //   d1     paths into Images
  //   e1-e7  paths into Groups, each "common tags only" mode directly under the
  //          path it modifies
  //   f1-f4  the exclusion filters
  //   g1     logging, last - it changes no behaviour
  //
  // The suffixes are kept recognisable against the two sibling plugins
  // (`ExcludeTagWithIgnoreAutoTag` is the same words in all three); only the letter
  // differs, because this plugin has five blocks of paths that they do not.
  //
  // A key is also the **storage key** Stash saves the value under, so renaming one
  // silently resets it for every install and strands the old value in the config.
  // New settings get a prefix in the block they belong to; if there is no gap left,
  // renumber that whole block in one go rather than bolting on a `b5a`.
  //
  // Stash has no default value for a plugin setting and renders an unset BOOLEAN as
  // unchecked, so every path toggle is off on a fresh install and a run with none
  // enabled must say so rather than silently doing nothing. That is the right
  // default here: these writes are library-wide and opting in per path is how the
  // user says which relationships they have actually thought about.
  var DEFAULTS = {
    a1ShowManualButtons: false,
    // Inverted on purpose, the one setting here that is. The behaviour we want by
    // default is staging, so it has to be what "off" selects - otherwise the box
    // would read off while acting on, and the first click on it would send true
    // rather than false. Any new boolean whose desired default is "on" needs the
    // same treatment; a *destructive* default needs the opposite.
    a2SaveImmediately: false,
    a3AutoOnTargetUpdate: false,
    a4AutoOnSourceUpdate: false,

    // The thirteen path toggles and the two "common tags only" modifiers, as one
    // line. See the block below for why they are a string rather than fifteen rows.
    b1Paths: '',

    f1ExcludeTargetWithTagName: '',
    f2ExcludeTargetOrganized: false,
    f3ExcludeTagWithIgnoreAutoTag: false,
    // **The one string setting here that has a default, and it is not empty.** Stash
    // renders whatever is in `config.yml` and has no `default:` for a plugin setting, so
    // a default has to be written in - see `seedExclusionField`. The name wears the
    // plugins' own prefix for the reason every other name they put in a namespace the
    // user shares does: a custom field lives in one flat map that anything can write to,
    // and `Do_Not_Propagate_Tag` is a name anybody could have picked.
    f4ExcludeTagWithCustomFieldName: 'ᱜ╦╦🞮_Do_Not_Propagate_Tag',

    g1LogToConsole: false,
  };

  // ── The path setting string ───────────────────────────────────────────────
  //
  // One STRING setting holds all thirteen paths: `tags:performer>scene=ON,
  // tags:scene>group=COMMON`. It replaced thirteen "Tags - ... to ..." booleans plus
  // the two "common tags only" modifiers that qualified two of them - fifteen rows,
  // five alphabetical blocks deep, in which the pair a modifier belonged to could
  // only be inferred from the wording of its name.
  //
  // A path is off, on, or - for the two that carry `common` - on for the tags every
  // source shares. That is three states for two of them, and a Stash plugin setting
  // is BOOLEAN, NUMBER or STRING with no tri-state and no repeated group, which is
  // the same wall `NormalizeParentTags` hit with its seven per-type modes. The answer
  // is the same too: one line, and the "Path Settings..." task is the editor for it.
  // The field stays there to be *read* at a glance and edited by hand when someone
  // wants to, not to be the only way in.
  //
  // **The token is the path id**, the string `coop().declares` already publishes and
  // this plugin's own tables are keyed by - not a second vocabulary invented for the
  // setting. A path renamed here would be a path renamed there, which is exactly the
  // coupling wanted: they name the same thing.
  //
  // Parsing is forgiving and formatting is strict. Anything shaped like
  // `<path id>=<mode>` is picked out wherever it sits, in any order, in any case,
  // with any separators between the pairs; everything else is ignored, and a path
  // nobody mentioned is off. What is written back is the enabled paths only, in
  // `PATHS` order - unlike the sibling's seven pairs, thirteen `=OFF` entries would
  // be a line nobody could read for the two that matter, and an absent path already
  // means off.
  var PATH_OFF = 'off', PATH_ON = 'on', PATH_COMMON = 'common';
  var PATH_TOKEN = { on: 'ON', common: 'COMMON' };
  // The same modes as words, for the selectors and the settings row. `All` rather
  // than `On` wherever a path has a second enabled mode to be told apart from.
  var PATH_LABEL = { off: 'Off', on: 'On', common: 'Common only' };
  var PATH_LABEL_COMMON = { off: 'Off', on: 'All tags', common: 'Common tags only' };

  function pathLabels(path) { return path.common ? PATH_LABEL_COMMON : PATH_LABEL; }

  // The order the dialog's button cycles through, which is also the order they are
  // listed in its title. Off first, so a press from the resting state turns a path on.
  function pathStates(path) {
    return path.common ? [PATH_OFF, PATH_ON, PATH_COMMON] : [PATH_OFF, PATH_ON];
  }

  // ALL is accepted as a synonym of ON because that is the word the two mode-carrying
  // paths' own selector shows, and someone typing the line by hand reads it there.
  // COMMON on a path that has no common mode is just "on": the path is enabled, and
  // the qualifier it does not have is dropped rather than the pair being ignored.
  var PATH_PAIR = /([A-Za-z]+:[A-Za-z]+>[A-Za-z]+)\s*=\s*(OFF|ON|ALL|COMMON)/gi;

  function parsePaths(raw) {
    var modes = {};
    PATHS.forEach(function (p) { modes[p.id] = PATH_OFF; });
    var text = String(raw == null ? '' : raw), m;
    PATH_PAIR.lastIndex = 0;
    while ((m = PATH_PAIR.exec(text)) !== null) {
      var p = pathById(m[1].toLowerCase());
      if (!p) continue;
      var word = m[2].toUpperCase();
      // A path named twice takes its last mention: the string is edited by appending
      // far more often than by rewriting, so the last word is the newest intent.
      modes[p.id] = word === 'OFF' ? PATH_OFF
        : (word === 'COMMON' && p.common ? PATH_COMMON : PATH_ON);
    }
    return modes;
  }

  // How many `<something>=<something>` pairs the string holds that this script did
  // *not* recognise. Neither a path id nor a mode contains an `=`, so the count of
  // `=` is how many pairs were meant, and anything left over is a pair this copy
  // cannot read - a hand edit, or a path id a newer release knows and this one does
  // not. It is what stands between "rewrite this in canonical form" and "delete the
  // half I did not understand".
  // Counting what was *applied*, not what the regex matched: a well-shaped id this
  // release does not have - `tags:everything>everywhere=ON`, the exact case a newer
  // sibling release produces - matches the pattern and is then dropped by `pathById`.
  // Counting matches called that fully understood and deleted it on the next tick.
  function unrecognisedPairs(raw) {
    var text = String(raw == null ? '' : raw), applied = 0, m;
    PATH_PAIR.lastIndex = 0;
    while ((m = PATH_PAIR.exec(text)) !== null) {
      if (pathById(m[1].toLowerCase())) applied++;
    }
    return (text.split('=').length - 1) - applied;
  }

  function formatPaths(modes) {
    return PATHS.filter(function (p) {
      return modes && modes[p.id] && modes[p.id] !== PATH_OFF;
    }).map(function (p) {
      return p.id + '=' + PATH_TOKEN[modes[p.id]];
    }).join(', ');
  }

  // What one path is set to, off `settings.paths`. Everything in the plugin that used
  // to read `s[path.setting]` or `s[path.mode]` asks these three instead, so a
  // repartitioning of the setting - a fourth mode, a mode per target - costs one
  // function rather than a search for every boolean read.
  function pathMode(s, path) {
    var modes = (s && s.paths) || {};
    return modes[path.id] || PATH_OFF;
  }

  function pathOn(s, path) { return pathMode(s, path) !== PATH_OFF; }

  function pathCommon(s, path) { return pathMode(s, path) === PATH_COMMON; }

  // The setting in words rather than in tokens, for the settings row: `Tags:
  // Performers → Scenes (Common tags only)`, one entry per enabled path and every one
  // of them amber - a path that is on is one this plugin writes along. Nothing is
  // listed for a path that is off; thirteen greyed-out entries would bury the two
  // that are not.
  //
  // **Three columns, filled top to bottom, in `PATH_COLUMNS` order** - the same
  // order and the same grouping the dialog lays out, so a path is in the same place
  // wherever it is shown. Thirteen stacked lines was a column of text taller than
  // every other row on the settings page put together, and the grouping is what keeps
  // three columns cheap: the two entries carrying a mode are half as long again as
  // the rest and share the last column, so the other two stay narrow.
  //
  // Not pipeline order, and that is deliberate on both sides now: what a run walks is
  // `PATHS`, which is what `formatPaths` writes and what the dialog's head describes.
  // This lists which paths are on.
  //
  // Elements rather than `textContent`, so the list can be a list.
  function renderPathString(box, modes, raw) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var text = String(raw == null ? '' : raw).replace(/^\s+|\s+$/g, '');
    var on = displayPaths().filter(function (p) { return modes && modes[p.id] !== PATH_OFF; });
    // The three columns live on a list inside the row rather than on the row itself,
    // so the warning below can sit beside them rather than in a cell of the grid.
    var list = el('div', 'ptp2re-pathstring-list');
    // "Nothing enabled" and "I could not read what is stored" look identical from the
    // paths alone and are not the same thing at all: the first is a choice, the second
    // is a value still sitting in the config that this script is declining to touch.
    // Saying the first over the second is what would make the loss look deliberate.
    if (!on.length && !text) {
      box.appendChild(el('div', null, 'No paths enabled - nothing is copied anywhere.'));
      return;
    }
    // A partly-read value gets both: the paths that *are* in force, and a line saying
    // the rest is not. Without it the row is a short list with nothing to explain why.
    // `!on.length` is the other half of the same question: a stored value that yields
    // no paths at all is unread whether or not it contains anything pair-shaped, and
    // a string with no `=` in it counts no unrecognised pairs by construction.
    if (text && (unrecognisedPairs(raw) > 0 || !on.length)) {
      box.appendChild(el('div', 'ptp2re-pathstring-warn', '\u26a0 Part of the stored ' +
        'value is not something this script understands, so it is left exactly as it ' +
        'is - and whatever it could not read is not in force. Open Path Settings to ' +
        'set the paths again, or check whether the script running here is older than ' +
        'the plugin installed.'));
    }
    if (!on.length) return;
    box.appendChild(list);
    // The row count is what turns `grid-auto-flow: column` into three columns; the
    // stylesheet cannot know how many entries there are. Fewer than three enabled
    // means one row and one column each, which is the right shape for a short list.
    list.style.gridTemplateRows = 'repeat(' + Math.ceil(on.length / 3) + ', auto)';
    on.forEach(function (p) {
      var line = el('div', 'ptp2re-pathstring-on');
      // The label is a span rather than the div's own text: a mode is appended after
      // it, and text plus an element in one node is the shape that loses the text.
      line.appendChild(el('span', null, pathLabel(p)));
      if (p.common) {
        line.appendChild(el('span', 'ptp2re-pathstring-mode',
          '  (' + pathLabels(p)[modes[p.id]] + ')'));
      }
      list.appendChild(line);
    });
  }

  // ── Migrating the fifteen booleans this setting replaced ──────────────────
  //
  // Each path used to have a boolean of its own, and two of them a second
  // boolean for "common tags only". The mapping is exact, which is the whole reason
  // the replacement can be silent: an enabled path becomes ON, or COMMON where its
  // modifier was also set.
  //
  // Renaming a key orphans what the user had; this is the one thing that stops the
  // replacement from being a reset. It runs once per page, only when the new setting
  // is empty and at least one old key is set, and it writes the result back so the
  // settings page shows it.
  var LEGACY_PATH = {
    'tags:performer>scene': 'b1TagsPerformersToScenes',
    'tags:studio>scene': 'b2TagsStudioToScenes',
    'tags:marker>scene': 'b3TagsMarkersToScenes',
    'tags:group>scene': 'b4TagsGroupsToScenes',
    'performers:gallery>scene': 'b5PerformersGalleriesToScenes',
    'tags:image>gallery': 'c1TagsImagesToGalleries',
    'performers:image>gallery': 'c2PerformersImagesToGalleries',
    'tags:gallery>image': 'd1TagsGalleriesToImages',
    'tags:scene>group': 'e1TagsScenesToGroups',
    'tags:studio>group': 'e3TagsStudioToGroups',
    'tags:performer>group': 'e4TagsPerformersToGroups',
    'tags:marker>group': 'e5TagsMarkersToGroups',
    'tags:subgroup>group': 'e6TagsSubGroupsToGroups',
  };
  var LEGACY_COMMON = {
    'tags:scene>group': 'e2TagsScenesToGroupsCommonOnly',
    'tags:subgroup>group': 'e7TagsSubGroupsToGroupsCommonOnly',
  };

  function hasLegacyPaths(raw) {
    for (var id in LEGACY_PATH) {
      if (hasOwn(LEGACY_PATH, id) && raw[LEGACY_PATH[id]]) return true;
    }
    return false;
  }

  function legacyPaths(raw) {
    var modes = {};
    PATHS.forEach(function (p) {
      var on = !!raw[LEGACY_PATH[p.id]];
      modes[p.id] = !on ? PATH_OFF
        : (p.common && raw[LEGACY_COMMON[p.id]] ? PATH_COMMON : PATH_ON);
    });
    return modes;
  }

  // ── Writing one of our own settings ───────────────────────────────────────
  //
  // **`configurePlugin` REPLACES `plugins.<id>`; it does not merge into it.** Stash's
  // `ConfigureUI` merges explicitly (`utils.MergeMaps`) and `ConfigurePlugin` does
  // not, so the difference is deliberate on both sides and there is nothing to fix
  // upstream. A mutation naming only the keys it changes therefore **deletes every
  // other setting this plugin has**.
  //
  // That is not a hypothetical: it is what took a user's thirteen enabled paths, their
  // manual-button toggle and their console toggle, twice - once when the path
  // migration wrote `b1Paths` on its own, and again when the exclusion import
  // wrote two keys and left a config holding exactly those two. `CustomFieldsBulkEditor`
  // had already found this and says so beside `followHideRename`; the knowledge stayed
  // in one plugin while two others copied the broken shape.
  //
  // So: read the stored map, apply the patch to a copy, send the whole thing. The read
  // is per write rather than off the settings cache, for the same reason that plugin
  // re-reads - a value another tab changed is a value we would otherwise write back
  // over - and these writes are rare enough that one query is nothing.
  function writeOwnSettings(patch) {
    return gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
      var input = {}, k;
      for (k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
      for (k in patch) if (hasOwn(patch, k)) input[k] = patch[k];
      return gqlRequest(
        'mutation PTPSaveSettings($plugin_id: ID!, $input: Map!) {' +
        '  configurePlugin(plugin_id: $plugin_id, input: $input)' +
        '}',
        { plugin_id: PLUGIN_ID, input: input }
      );
    });
  }

  var _savingPaths = false;

  // Stash's own settings page sends the same mutation, and the fetch hook already
  // notices it and drops the settings cache - so a save made here reaches the
  // automatic modes and the manual buttons exactly as one made by hand does.
  function savePaths(text) {
    _savingPaths = true;
    return writeOwnSettings({ b1Paths: text }).then(function (r) {
      _savingPaths = false;
      invalidateAutoSettings();
      return r;
    }, function (e) {
      _savingPaths = false;
      throw e;
    });
  }

  var _migrated = false;

  function migrateLegacyPaths(text) {
    if (_migrated) return;
    _migrated = true;
    ptp2re('[ptp2re] migrating the legacy per-path settings to "' + text + '".');
    savePaths(text).then(null, function (e) {
      ptp2re('[ptp2re] the migrated path setting could not be saved (' +
        (e && e.message ? e.message : e) + '). It is being used for this page all the ' +
        'same; set it by hand from the Path Settings task if this keeps happening.');
    });
  }

  // ── Cross-plugin cooperation ──────────────────────────────────────────────
  //
  // See "Cross-plugin cooperation: the bulk-edit lease" in the repo-root CLAUDE.md.
  // A lease asks reactive plugins in this tab to stand down while we write. It is
  // advisory and always expires, so a crash cannot disable anyone permanently.
  //
  // This plugin is on both sides of the protocol, like both of its siblings and for
  // the same reason: the roles are per *run*, not per plugin. The library-wide task
  // is bulk; the two automatic modes are reactive.

  // The one global this repo reserves: `window.__GTTx__`, holding every object these
  // plugins share. `StashPluginCoop` on its own was a name any third-party plugin
  // could have picked, and a collision would hand someone else's object our leases;
  // nesting it under an owner prefix makes that a non-question.
  //
  // `window.StashPluginCoop` stays as an alias to the very same object, and an existing
  // one is adopted rather than replaced. A user who updates one of these plugins and
  // not the others has two releases of the protocol in one tab, and both halves have to
  // keep seeing one set of leases - the alias costs a line, a missed lease costs a bulk
  // run. Keep this function byte-identical across the three plugins, like the CSS.
  function coopObject() {
    var ns = window.__GTTx__;
    if (!ns || typeof ns !== 'object') ns = window.__GTTx__ = {};
    var c = ns.StashPluginCoop || window.StashPluginCoop;
    if (!c || typeof c !== 'object') c = {};
    ns.StashPluginCoop = c;
    if (window.StashPluginCoop !== c) window.StashPluginCoop = c;
    return c;
  }

  // ── The shared DOM bus ────────────────────────────────────────────────────
  //
  // One MutationObserver on Stash's root for every plugin in this repo, rather than one
  // each. The four that need one watch the same subtree for the same reason - a control
  // has to land before the user reads the panel it is in - and with all of them installed
  // that was four registrations firing on every DOM burst, which on a Scene page with
  // video playing is continuous. It is the one place the "five copies of one design" rule
  // compounds rather than merely repeats, which is why this is shared rather than copied.
  //
  // Whichever plugin loads first creates the observer; the rest subscribe to it. Each
  // keeps its own debounce, because what a burst costs each of them differs.
  //
  // Advisory in exactly the way the lease is: a plugin too old to know about the bus makes
  // its own observer and still works, and one subscriber throwing does not silence the
  // rest. `subscribe` is idempotent and safe to call again - which is what the load-event
  // retry does when there was no root to observe at script bottom - and answers whether
  // anything is being observed yet, so a caller with a polling fallback can tell.
  //
  // Byte-identical in every plugin that has one, like `coopObject` above and for the same
  // reason; `tests/style.test.js` fails on a drifted copy.
  function domBus() {
    var ns = window.__GTTx__;
    if (!ns || typeof ns !== 'object') ns = window.__GTTx__ = {};
    var bus = ns.domBus;
    if (bus && typeof bus.subscribe === 'function') return bus;
    bus = ns.domBus = { subs: [], observing: false };
    bus.notify = function () {
      for (var i = 0; i < bus.subs.length; i++) {
        try { bus.subs[i](); } catch (e) { /* one subscriber must not silence the rest */ }
      }
    };
    bus.subscribe = function (fn) {
      if (bus.subs.indexOf(fn) === -1) bus.subs.push(fn);
      if (bus.observing || typeof MutationObserver !== 'function') return bus.observing;
      var root = document.getElementById('root') || document.body || document.documentElement;
      if (!root) return false;
      try {
        new MutationObserver(bus.notify).observe(root, { childList: true, subtree: true });
        bus.observing = true;
      } catch (e) {
        bus.observing = false;
      }
      return bus.observing;
    };
    return bus;
  }

  function coop() {
    var c = coopObject();
    if (!c.leases) c.leases = [];
    if (!c.respecters) c.respecters = {};
    if (!c.declares) c.declares = {};
    if (!c.order) c.order = {};
    return c;
  }

  // ── Button gating diagnostics ────────────────────────────────────────────
  //
  // Off unless `__GTTx__.StashPluginCoop.debugButtons = true`, which is typed into the browser
  // console: no setting, no reload, no file edit, and the flag is read at call time so
  // it takes effect on the next tick. On the shared object rather than a global of our
  // own because both plugins that draw buttons into these rows answer to it, and "why
  // is this button missing" is rarely a question about only one of them.
  //
  // Two shapes, and the difference is what each is for:
  //
  //   `gateLog` fires every time. Its callers are the probe resolutions, which happen
  //   once per entity and again after every save that invalidates them - seeing the
  //   same answer twice there is the *point*, since it says the re-check ran.
  //
  //   `gateLogOnce` is deduplicated per channel, for the tick-driven states.
  //   `manualButtonsTick` runs every second and on every DOM mutation burst, so an
  //   undeduplicated line there would emit forever on a page nobody is touching. What
  //   is worth seeing is the moment an outcome changes. Turning the flag off clears the
  //   channels, so switching it back on restates the current position rather than
  //   staying silent until something moves.
  var _gateLast = {};
  function gateLog(line) {
    if (!coop().debugButtons) return;
    console.info('[ptp2re gate] ' + line);
  }
  function gateLogOnce(channel, line) {
    if (!coop().debugButtons) { _gateLast = {}; return; }
    if (_gateLast[channel] === line) return;
    _gateLast[channel] = line;
    console.info('[ptp2re gate] ' + line);
  }

  function acquireLease(label, ttl) {
    var c = coop();
    var ms = ttl || LEASE_TTL_MS;
    var lease = { owner: PLUGIN_ID, label: label, until: Date.now() + ms };
    c.leases.push(lease);
    return {
      renew: function () { lease.until = Date.now() + ms; },
      release: function () {
        var i = c.leases.indexOf(lease);
        if (i !== -1) c.leases.splice(i, 1);
      },
    };
  }

  // Registered at load, unconditionally rather than only while an auto mode is
  // enabled: the flag says this copy honours the protocol, which is true whatever
  // the settings happen to be. It is what lets another plugin's bulk run tell "will
  // stand down" apart from "too old to know about leases".
  coop().respecters[PLUGIN_ID] = true;

  // A fixed, agreed priority for the deterministic-ordering protocol below
  // (`insertOrdered`) - not a capability like `respecters`, but a number both sides
  // have to pick once and keep consistent, the same way the two plugins pin their
  // overlapping CSS byte-identical. Lower sits further from Save/Delete;
  // MergePerformerTagsToScenes registers 20, so this plugin's own buttons land to its
  // left rather than racing it for the position next to the anchor. Gaps of 10 leave
  // room for a third plugin to slot in without renumbering either existing value.
  coop().order[PLUGIN_ID] = 10;

  // The N-way declaration registry (D3 of the design plan): unlike `respecters`,
  // which is a fixed capability, this is refreshed on every settings load - task or
  // auto mode alike, see `Run.prototype.begin` and `autoSettings` - because a path
  // whose setting is off is not one this plugin is actually covering, and another
  // plugin scanning `coop().declares` for overlap needs to see that as soon as this
  // plugin's own settings do, not only while its dialog happens to be open.
  function publishDeclares(settings) {
    coop().declares[PLUGIN_ID] = enabledPaths(settings).map(function (p) { return p.id; });
  }

  var _standDownAnnounced = false;
  function autoSuppressed() {
    var c = coop();
    var now = Date.now();
    // Expired leases are dropped rather than honoured: a tab that crashed mid-run
    // must not disable auto mode until the next page reload.
    for (var i = c.leases.length - 1; i >= 0; i--) {
      if (!c.leases[i] || !(c.leases[i].until > now)) c.leases.splice(i, 1);
    }
    if (!c.leases.length) { _standDownAnnounced = false; return false; }
    if (!_standDownAnnounced) {
      _standDownAnnounced = true;
      console.info('[ptp2re] auto mode is standing down while ' + c.leases[0].owner +
        ' applies bulk changes (' + c.leases[0].label + ')');
    }
    return true;
  }

  // Depth of write work in flight. A counter rather than a boolean because flows
  // overlap - a task apply racing an auto reaction, two auto reactions from one
  // bulk edit - and the first to finish must not re-open interception while the
  // others are still writing. Strictly internal: suppressing *other* plugins is
  // what the lease is for.
  var _writeDepth = 0;

  function guarded(fn) {
    _writeDepth++;
    var p;
    try {
      p = fn();
    } catch (e) {
      _writeDepth--;
      throw e;
    }
    return p.then(
      function (v) { _writeDepth--; return v; },
      function (e) { _writeDepth--; throw e; }
    );
  }

  // ── GraphQL ───────────────────────────────────────────────────────────────

  function gqlRequest(query, variables) {
    return fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, variables: variables }),
    })
      .then(function (resp) { return resp.json(); })
      .then(function (json) {
        if (json.errors) throw new Error(json.errors.map(function (e) { return e.message; }).join('; '));
        return json.data;
      });
  }

  // `configuration { plugins }` cannot be scoped to one plugin, so every other
  // plugin's settings arrive in the same response - which is what the sibling checks
  // read, for free.

  // ── Adopting MergePerformerTagsToScenes' exclusion filters ────────────────
  //
  // The four exclusion settings here are the same four that plugin has, worded for a
  // wider set of entities - `ExcludeTagWithIgnoreAutoTag` is the same words in both,
  // and the repo's own settings convention is that only the letter differs. Somebody
  // running both has already answered these four questions once, and answering them
  // again in the same words is the kind of setup step that gets half done.
  //
  // So each one this plugin has **never been set to anything** takes the sibling's
  // value, once, and is written back so the settings page shows it as ours.
  //
  // **"Never set" is the key's presence in the stored config, not its value.** A
  // BOOLEAN the user has turned on and off again is `false`, which is also its
  // default - comparing values would re-adopt it on every page load, and a setting
  // that comes back after you switch it off is worse than one you have to set twice.
  // `configurePlugin` stores what it is sent, so the key exists from the first time
  // the user touches the row. This is the one thing here that would be wrong if Stash
  // ever stripped default-valued keys from a plugin's config map.
  //
  // **Written back rather than used in memory.** An import nobody can see is a
  // settings page saying "no exclusions" over runs that exclude; writing it makes the
  // value ours, editable, and - because the key now exists - never adopted again.
  //
  // A name lookup, unlike the `declares` overlap check beside it, because there is
  // nothing generic to key this on: two plugins having the same *settings shape* is
  // not a capability either of them publishes.
  var SIBLING_EXCLUSIONS = {
    f1ExcludeTargetWithTagName: 'b1ExcludeSceneWithTagName',
    f2ExcludeTargetOrganized: 'b2ExcludeSceneOrganized',
    f3ExcludeTagWithIgnoreAutoTag: 'c1ExcludeTagWithIgnoreAutoTag',
    f4ExcludeTagWithCustomFieldName: 'c2ExcludeTagWithCustomFieldName',
  };

  var _importedExclusions = false;

  // Fills `s` in place and returns what should be written back, or null.
  function importSiblingExclusions(s, raw, sibling) {
    if (!sibling) return null;
    var input = null;
    for (var key in SIBLING_EXCLUSIONS) {
      if (!hasOwn(SIBLING_EXCLUSIONS, key)) continue;
      if (hasOwn(raw, key)) continue;                       // ours, already answered
      var theirs = sibling[SIBLING_EXCLUSIONS[key]];
      var value = typeof DEFAULTS[key] === 'boolean'
        ? !!theirs : String(theirs == null ? '' : theirs);
      // Nothing to adopt is not an import: writing their default into our config
      // would set the key and so spend the one chance this has to run. **An empty
      // string is nothing to adopt whatever our own default is** - which stopped being
      // the same test the moment `f4` gained a non-empty one, and would otherwise have
      // adopted a sibling's unset filter as a deliberate "off".
      if (value === DEFAULTS[key] || value === '') continue;
      s[key] = value;
      if (!input) input = {};
      input[key] = value;
    }
    return input;
  }

  function saveImportedExclusions(input) {
    if (_importedExclusions) return;
    _importedExclusions = true;
    var names = [];
    for (var k in input) if (hasOwn(input, k)) names.push(k);
    ptp2re('[ptp2re] adopting ' + plural(names.length, 'exclusion setting') + ' from ' +
      MPTTS_NAME + ' (' + names.join(', ') + '): this plugin had never been set to ' +
      'anything for ' + (names.length === 1 ? 'it' : 'them') + '. Change them here from now on.');
    writeOwnSettings(input).then(function () { invalidateAutoSettings(); }, function (e) {
      ptp2re('[ptp2re] the adopted exclusion settings could not be saved (' +
        (e && e.message ? e.message : e) + '). They are in force for this page all the ' +
        'same; set them by hand if this keeps happening.');
    });
  }

  // ── The exclusion field's own default, and its documentation ──────────────
  //
  // Stash has no `default:` for a plugin setting - the panel renders whatever is in
  // `config.yml`, which is nothing until the user types in a box - so a default that is
  // meant to be *visible* has to be written in. `CustomFieldsBulkEditor` learnt this the
  // same way and `seedDefaults` is the same shape; the difference is that this plugin has
  // exactly one setting with a non-empty default, so this seeds that one rather than
  // every string it has.
  //
  // Three rules, and the middle one is the user's:
  //
  //  - **Absent, or cleared, gets the default.** `settingsFrom` falls back to it in
  //    memory and this writes it back so the box agrees. Clearing that box is therefore
  //    how you get the standard name back rather than how you switch the filter off -
  //    the opposite of `CustomFieldsBulkEditor`'s hide field, where an empty box *is*
  //    the off switch. A path either excludes marked tags or it does not, so there was
  //    never an off state here for an empty string to mean.
  //  - **A value adopted from `MergePerformerTagsToScenes` is not overwritten, and is
  //    not documented either.** The import is the user having answered this question
  //    already, in the other plugin; seeding a name over it would undo the adoption on
  //    the very load that made it, and describing *our* default field when the
  //    configured field is theirs would document a field nothing here reads.
  //  - **The description is written through `CustomFieldsBulkEditor`, never beside it.**
  //    That plugin owns the store - its JSON shape, the sentence in front of it, the
  //    version gate, the marker tag - and a copy of any of that here is the thing
  //    `coop().api` exists to stop. Absent sibling, older sibling, no store yet: all
  //    three are silence, because a tag exclusion filter works perfectly well with no
  //    sentence explaining it.
  var F4_DEFAULT = DEFAULTS.f4ExcludeTagWithCustomFieldName;
  var F4_DESCRIPTION = 'Never propagate a tag marked via this Custom Field. Used by the ' +
    PLUGIN_NAME + ' plugin.';
  var CFBE_ID = 'CustomFieldsBulkEditor';

  var _seededField = false;

  function seedExclusionField(raw, adopted, s) {
    if (_seededField) return;
    _seededField = true;
    var mine = String(raw.f4ExcludeTagWithCustomFieldName || '');
    var imported = !!(adopted && hasOwn(adopted, 'f4ExcludeTagWithCustomFieldName'));
    if (!imported && !mine) {
      // The whole map goes back, not the one key: `configurePlugin` replaces
      // `plugins.<id>` rather than merging into it. See the repo-root CLAUDE.md.
      //
      // **Built from `raw` rather than through `writeOwnSettings`**, which re-reads the
      // map first. That re-read is the right thing for a write the user asked for
      // minutes after the page loaded; this one is inside the read that produced `raw`,
      // so re-reading would be asking the same question twice in the same tick.
      //
      // **An operation name of its own**, `PTPSeedSettings`, which is what the fetch
      // wrapper below tells it apart by: an ordinary settings save has to drop every
      // cache this plugin holds, and this one must not, because what it writes is the
      // value `settingsFrom` has already returned. Without that, a fresh install pays
      // for a wasted read of the whole tag library on its first page. A name we choose
      // is a better discriminator than anything inferred from the body, and
      // `CustomFieldsBulkEditor`'s `CFBE_SeedSettings` is the same idea.
      var input = {};
      for (var k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
      input.f4ExcludeTagWithCustomFieldName = F4_DEFAULT;
      gqlRequest(
        'mutation PTPSeedSettings($plugin_id: ID!, $input: Map!) {' +
        '  configurePlugin(plugin_id: $plugin_id, input: $input)' +
        '}',
        { plugin_id: PLUGIN_ID, input: input }
      ).then(null, function (e) {
        _seededField = false;
        ptp2re('[ptp2re] the default exclusion custom field name could not be saved (' +
          (e && e.message ? e.message : e) + '). It is in force for this page all the same.');
      });
    }
    if (!imported && s.f4ExcludeTagWithCustomFieldName === F4_DEFAULT) describeExclusionField();
  }

  // Feature-detected, never version-checked: the number on the entry is for a log line,
  // and what decides whether to call is whether the function is there. The answer is a
  // word - added, kept, queued - and none of them is worth interrupting anyone over, so
  // it goes to the console under the plugin's own prefix and nowhere else.
  function describeExclusionField() {
    var api = coop().api && coop().api[CFBE_ID];
    if (!api || typeof api.describeField !== 'function') return;
    api.describeField(F4_DEFAULT, F4_DESCRIPTION).then(function (outcome) {
      if (outcome === 'added') {
        ptp2re('[ptp2re] described the custom field "' + F4_DEFAULT + '" in ' + CFBE_ID +
          '\u2019s description store.');
      } else if (outcome === 'queued') {
        ptp2re('[ptp2re] a description for "' + F4_DEFAULT + '" is waiting for ' + CFBE_ID +
          '\u2019s description store - open "Manage Custom Field Descriptions..." and ' +
          'press Apply to file it.');
      }
    }, function () { /* a sentence is not worth an error */ });
  }

  // One raw settings map, filled in from the defaults, migrated if this install
  // predates the path string, given the sibling's exclusion filters where it has
  // never had its own, with the parsed modes hung off the result so nothing
  // downstream parses it twice.
  function settingsFrom(raw, sibling) {
    var s = {};
    for (var k in DEFAULTS) {
      if (!hasOwn(DEFAULTS, k)) continue;
      // A cleared string setting falls back to its default, which is a no-op for every
      // key here but `f4` - the others default to empty, so there is nothing to fall
      // back to. It is what makes "clear the box to get the standard field name back"
      // true, and it is deliberately *not* the rule `CustomFieldsBulkEditor` reads its
      // own settings by: there, an emptied box switches a filter off, and here there is
      // no off to switch to - a path either excludes marked tags or it does not.
      s[k] = typeof DEFAULTS[k] === 'boolean' ? !!raw[k] : (String(raw[k] || '') || DEFAULTS[k]);
    }
    if (!String(s.b1Paths).replace(/^\s+|\s+$/g, '') && hasLegacyPaths(raw)) {
      s.b1Paths = formatPaths(legacyPaths(raw));
      migrateLegacyPaths(s.b1Paths);
    }
    s.paths = parsePaths(s.b1Paths);
    var adopted = importSiblingExclusions(s, raw, sibling);
    if (adopted) saveImportedExclusions(adopted);
    seedExclusionField(raw, adopted, s);
    return s;
  }

  function loadSettings() {
    return gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var all = (data.configuration || {}).plugins || {};
      return { settings: settingsFrom(all[PLUGIN_ID] || {}, all[MPTTS_ID]), all: all };
    });
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  var CSS =
    // Kept literally identical to NormalizeParentTags' CSS and
    // MergePerformerTagsToScenes' TASK_CSS wherever the three dialogs overlap, down
    // to the hex values. They are separate strings because the plugins share no
    // module, not because they are meant to look different - and two of them did
    // drift, from #202b33 to #30404d, because nothing compared them. `style` pins
    // the overlap now, across all three. #202b33 is Blueprint's dark-gray2, the step
    // Stash's own page uses; every dim grey in these dialogs was chosen against it -
    // the log's #a7b6c2 and #7d8f9c - and they separate better on it than on the
    // lighter #30404d.
    '.ptp2re-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.ptp2re-modal{background:#202b33;color:#f5f8fa;border:1px solid #394b59;border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    // A plugin-local modifier beside the pinned shared `.modal` rule, the pattern
    // `CustomFieldsBulkEditor`'s `.cfbe-tall` set: the shared width is sized for log
    // lines naming an entity, an id and two values, and the path dialog holds two
    // columns of short labels instead. Widening past what they need only pushes each
    // select further from the label it belongs to.
    '.ptp2re-modal.ptp2re-narrow{width:min(58rem,94vw);}' +
    '.ptp2re-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.ptp2re-title{font-size:1.1rem;font-weight:600;}' +
    '.ptp2re-warn{color:#ffb648;margin-top:.35rem;}' +
    '.ptp2re-note{color:#a7b6c2;margin-top:.35rem;}' +
    '.ptp2re-legend{color:#7d8f9c;margin-top:.35rem;font-size:.8rem;}' +
    '.ptp2re-progress{padding:.5rem 1rem;border-bottom:1px solid #394b59;color:#a7b6c2;' +
    'white-space:pre-wrap;}' +
    '.ptp2re-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;' +
    'font-size:.8rem;line-height:1.35;min-height:14rem;}' +
    '.ptp2re-line{white-space:pre-wrap;word-break:break-word;}' +
    '.ptp2re-spin{color:#a7b6c2;}' +
    // An entity named in the log is a link to it. The same blue the siblings' result
    // lines use, underlined only on hover so a log full of them does not read as a
    // page of underlines.
    '.ptp2re-elink{color:#7cc4ff;text-decoration:none;}' +
    '.ptp2re-elink:hover{text-decoration:underline;}' +
    // A tag or performer named in the log opens a card on hover. The shared `.tipbox`
    // rule cannot do this job: it is absolutely positioned inside its trigger, and the
    // log is an `overflow:auto` box that would clip it against its own top edge. This
    // one is `position:fixed` and placed from the pointer, so it is never clipped -
    // and it holds an image, which a `title` cannot.
    '.ptp2re-card{position:fixed;display:none;z-index:1600;width:20rem;max-width:90vw;' +
    'padding:.5rem .65rem;background:#202b33;color:#d6dee4;border:1px solid #425a6b;' +
    'border-radius:3px;font-size:.8rem;line-height:1.45;white-space:pre-wrap;' +
    'pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.55);font-family:inherit;}' +
    '.ptp2re-card-open{display:block;}' +
    '.ptp2re-card img{display:block;width:100%;max-height:14rem;object-fit:contain;' +
    'margin-bottom:.4rem;border-radius:3px;background:#111a20;}' +
    '.ptp2re-card-name{font-weight:600;color:#f5f8fa;}' +
    '.ptp2re-hover{cursor:help;}' +
    // The path toggles: the whole body of the settings dialog, in three columns of
    // label-and-button. Each column is a grid of its own rather than the whole panel
    // being one six-column grid, because a shared grid sizes every label column to
    // the widest label in any of them - and the rows are `display:contents` so each
    // row's two cells are its own column's.
    //
    // `max-content` on both, not `1fr auto`: a flexing label column stretches to the
    // panel and leaves the select stranded at the far side of the modal, which is
    // exactly what the first version of this did.
    '.ptp2re-paths{display:flex;flex-wrap:wrap;gap:0 2rem;margin:.5rem 0;}' +
    // The three bulk buttons, at the far end of the footer from Save and Cancel.
    // `margin-left:auto` in a flex row is what puts them there, so the shared `.foot`
    // rule is untouched; the inner `margin-right` is the same rule's spacing, which
    // would otherwise hang off the last button past the modal's padding.
    '.ptp2re-paths-bulk{display:flex;flex-wrap:wrap;gap:.4rem;margin-left:auto;}' +
    '.ptp2re-paths-bulk button{margin-right:0;}' +
    '.ptp2re-paths-col{display:grid;grid-template-columns:max-content max-content;' +
    'gap:.3rem .6rem;align-items:center;align-content:start;}' +
    '.ptp2re-path-row{display:contents;}' +
    // A `null` in a column: a blank row separating two groups of paths. It spans both
    // of the column's tracks, since a row here is two cells and half a gap would sit
    // under the labels only.
    '.ptp2re-path-gap{grid-column:1/-1;height:.6rem;}' +
    '.ptp2re-path-name{color:#d6dee4;font-size:.9rem;}' +
    // The per-path toggle. Everything visual comes from Bootstrap's own `btn btn-sm`
    // plus the variant the paint swaps, so this rule only has to stop thirteen buttons
    // of five different caption widths from looking ragged: the grid column is already
    // `max-content`, and stretching each button across it lines their edges up.
    '.ptp2re-toggle{justify-self:stretch;white-space:nowrap;}' +
    // The two paths that can be `common` are the only ones whose caption changes
    // width with its state, and a `max-content` column resizes under the pointer when
    // one does. A floor wide enough for the longest of the three captions holds them
    // still. A floor rather than a fixed width: it can only stop the button shrinking,
    // so a theme whose font is wider than this grows the button instead of clipping it.
    '.ptp2re-toggle-wide{min-width:9.5rem;}' +
    // A path nothing switched on that other enabled paths already carry end to end:
    // the resting background, and the amber as letters. `!important` because it is
    // overriding `btn-secondary`'s own colour, which is what the button still is.
    '.ptp2re-toggle-auto{color:#ffb648 !important;}' +
    '.ptp2re-pathsbody{padding:.5rem 1rem;overflow:auto;}' +
    // ── The diagram view ────────────────────────────────────────────────────
    //
    // Everything on the canvas is absolutely placed from `diagramGeometry`, in the
    // canvas' own pixels: the boxes, the chips inside them and the slots the toggles
    // sit in. So this rule set carries no positions of its own - only what the pieces
    // look like - and a coordinate can never be half here and half there.
    //
    // The canvas does not reflow. It is a graph, not a column, and there is nothing
    // for it to wrap into; `.ptp2re-pathsbody` already scrolls, which is what a window
    // too narrow for it gets.
    '.ptp2re-dia{margin:.5rem 0;}' +
    '.ptp2re-dia-legend{color:#7d8f9c;font-size:.8rem;margin:0 0 .6rem;}' +
    // Centred: the canvas is exactly as big as the picture on it, so `auto` margins
    // put it in the middle of a dialog wider than that. Not while arranging - the
    // canvas grows as a box is dragged towards its edge, and a centred canvas that
    // grows moves everything on it by half of the growth, under the pointer.
    '.ptp2re-dia-canvas{position:relative;margin:0 auto;}' +
    '.ptp2re-dia-canvas.ptp2re-dia-editing{margin:0;}' +
    // A box is styled as one of Stash's own secondary buttons, by wearing the same
    // two classes rather than by naming colours here: the theme is the user's, and
    // `btn-secondary` is what every neutral control in these dialogs already is. Only
    // what a button does that a box must not is overridden.
    '.ptp2re-dia-box{position:absolute;box-sizing:border-box;padding:0;' +
    'text-align:left;cursor:default;pointer-events:none;}' +
    // What the box is doing: amber written into, teal read out of, black neither. The
    // repo's two colours - the one that means "this plugin writes" and the one that
    // means it only reads - used for exactly what they mean elsewhere. `!important`
    // because all three override `btn-secondary`'s own border, which is what the box
    // still is.
    '.ptp2re-dia-live{border-color:#ffb648 !important;}' +
    '.ptp2re-dia-gives{border-color:#17a2b8 !important;}' +
    '.ptp2re-dia-idle{border-color:#000 !important;}' +
    '.ptp2re-dia-name{padding:.25rem .55rem;font-weight:600;font-size:.9rem;}' +
    // The two chips are the arrows' anchors as well as the box's contents, so they
    // carry the arrow colours: what a line moves is readable at both ends of it.
    '.ptp2re-dia-chip{position:absolute;box-sizing:border-box;pointer-events:none;' +
    'border:1px solid;' +
    'border-radius:10px;background:#202b33;font-size:.75rem;line-height:18px;' +
    'text-align:center;}' +
    '.ptp2re-dia-tags{color:#84d68a;border-color:#84d68a;}' +
    '.ptp2re-dia-performers{color:#7cc4ff;border-color:#7cc4ff;}' +
    // The point the geometry returns is the middle of the button, not its corner:
    // where a toggle sits on its curve is a fact about the curve, and its width is a
    // fact about its caption.
    '.ptp2re-dia-slot{position:absolute;transform:translate(-50%,-50%);' +
    'white-space:nowrap;}' +
    '.ptp2re-dia-slot button{margin:0;}' +
    // Arranging mode, on only while the console flag is set. `touch-action:none` is
    // what stops a drag on a touch screen scrolling the dialog instead of moving a
    // box; `pointer-events:none` on the button is what lets the slot under it take
    // the drag, and is why nothing has to swallow the click a drag would otherwise
    // end in. A chip is part of the box behind it for the same reason.
    '.ptp2re-dia-editing .ptp2re-dia-box,.ptp2re-dia-editing .ptp2re-dia-slot' +
    '{cursor:move;touch-action:none;pointer-events:auto;}' +
    '.ptp2re-dia-editing .ptp2re-dia-box{border-style:dashed;}' +
    '.ptp2re-dia-editing .ptp2re-dia-slot>button{pointer-events:none;}' +
    '.ptp2re-dia-edit{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;' +
    'margin:0 0 .6rem;}' +
    '.ptp2re-dia-edit button{margin-right:0;}' +
    '.ptp2re-dia-edithint{color:#ffb648;font-size:.8rem;margin-right:.4rem;}' +
    // The enabled paths as the settings row shows them. Prose rather than the
    // sibling's monospace: what is rendered here is `pathLabel`, the same sentence
    // the log uses, not the tokens the setting stores.
    //
    // Three columns, filled top to bottom - `grid-auto-flow: column` over a row count
    // `renderPathString` sets, since the stylesheet cannot know how many paths are on.
    // `max-content` columns and `justify-content: start` so the block is only as wide
    // as the entries in it: with equal columns the longest entry would set all three.
    '.ptp2re-pathstring{font-size:.85rem;color:#a7b6c2;margin:.25rem 0 .5rem;}' +
    '.ptp2re-pathstring-list{display:grid;grid-auto-flow:column;' +
    'grid-auto-columns:max-content;justify-content:start;gap:.1rem 1.5rem;}' +
    // Amber for the same reason the selectors are: a path that is on is one this
    // plugin writes along. The mode in brackets stays grey - it qualifies the line
    // rather than being a second thing that is on.
    '.ptp2re-pathstring-on{color:#ffb648;}' +
    '.ptp2re-pathstring-mode{color:#a7b6c2;font-size:.8rem;}' +
    // The row's own "I could not read this" line. The stale banner's red, because it
    // is the same kind of message: something is configured and not in force.
    '.ptp2re-pathstring-warn{color:#ff7373;}' +
    '.ptp2re-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
    // The log's own line kinds, which the siblings do not share: this plugin adds
    // both tags and performers, so ADD alone would not say which.
    '.ptp2re-ERROR{color:#ff7373;} .ptp2re-WARN{color:#ffb648;} .ptp2re-TAG{color:#84d68a;}' +
    '.ptp2re-PERF{color:#7cc4ff;} .ptp2re-INFO{color:#a7b6c2;}' +
    '.ptp2re-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.ptp2re-foot button{margin-right:.5rem;}' +
    '.ptp2re-hidden{display:none;}' +
    // Our own source-button row, under the tab strip on the pages that render no
    // detail action row (Scene, Gallery, and Image if it is the same). This is the one
    // container in the plugin Stash puts nothing into, so there is no neighbour to
    // measure a gap off and none of `applyButtonSpacing`'s branches apply - the row
    // spaces its own children instead, which is the `column-gap` case that helper
    // already knows to keep its hands off. `.5rem` top separates it from the tabs it
    // sits under; `flex-wrap` because Scene can offer several at once.
    '.ptp2re-src-row{display:flex;flex-wrap:wrap;column-gap:.5rem;row-gap:.25rem;' +
    'margin:.5rem 0;}' +
    // Stash's own .sub-heading is white-space: normal, so the newlines in this
    // plugin's description would collapse into one paragraph. Scoped to the group we
    // marked, never to .sub-heading at large: another plugin's description is not
    // ours to reflow, and it may well have been written for the collapse.
    // pre-wrap is the fallback for a description we have not split yet - a blank
    // line renders as a blank line. Once split, the paragraphs are divs and the gap
    // is this margin instead: roughly a third of a line, not a whole one.
    '.ptp2re-own-group .sub-heading{white-space:pre-wrap;}' +
    '.ptp2re-own-group .sub-heading .ptp2re-p{margin:0 0 .35em;}' +
    '.ptp2re-own-group .sub-heading .ptp2re-p:last-child{margin-bottom:0;}' +
    // A per-setting description shows its first paragraph and hides the rest in a
    // tooltip. The mark is the only thing saying there is one - a hover that opens
    // with no invitation is a hover nobody makes.
    //
    // Built rather than borrowed: a native `title` is the browser's, and its font
    // size, its position and its delay cannot be reached from CSS. It opens
    // *below-right* of the pointer, which is exactly where the arrow sits, so the
    // first line arrives half covered. This one opens above the row in a readable
    // size, and - the part `title` could never do - on keyboard focus as well.
    //
    // These rules are shared with both sibling plugins and `tests/style.test.js`
    // compares them with the prefix stripped: keep them byte-identical, or change
    // all three together.
    '.ptp2re-tipped{position:relative;}' +
    '.ptp2re-tip{margin-left:.35rem;cursor:pointer;opacity:.65;font-style:normal;' +
    'font-size:1.05em;}' +
    '.ptp2re-tip:hover,.ptp2re-tip:focus{opacity:1;outline:none;}' +
    // pointer-events:none is load-bearing, not tidiness. Opened from the setting's
    // name the box lands over the h3, so a box that took the pointer would fire
    // mouseleave on the name, close, hand the pointer back to the name, and reopen -
    // a flicker loop for as long as it is hovered.
    '.ptp2re-tipbox{display:none;position:absolute;left:0;bottom:calc(100% + .35rem);' +
    'z-index:1500;width:max-content;max-width:100%;padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.ptp2re-tipped.ptp2re-tip-open .ptp2re-tipbox{display:block;}' +
    // The group description sits in the group header, outside the <Collapse>, so it
    // is on screen at whatever size whether the group is expanded or not. Hiding all
    // but the first paragraph is the only thing that shortens it.
    '.ptp2re-desc-collapsed .ptp2re-p:not(:first-child){display:none;}' +
    '.ptp2re-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
    // ── Colour-coded toggles ────────────────────────────────────────────────
    //
    // Amber for the switches that make this plugin write on its own - once one of
    // these is on, saving an entity in Stash rewrites others with no dialog and no
    // undo - and teal for the one that only talks to the console. Every other
    // setting keeps Stash's blue: this marks the two that are not like the rest,
    // and marking everything would mark nothing.
    //
    // Keyed on the ids SettingsPluginsPanel.tsx builds from the plugin id and the
    // setting key, the same anchor `settingElement` uses, rather than on position
    // or heading text.
    //
    // Two shapes because the switch is Stash's to render: `::before` is the track
    // of a react-bootstrap Form.Switch, which is what it renders today, and
    // `accent-color` covers a plain checkbox if that ever changes. Whichever is not
    // in use costs nothing.
    '#plugin-PropagateTagsAndPerformers-a2SaveImmediately,' +
    '#plugin-PropagateTagsAndPerformers-a3AutoOnTargetUpdate,' +
    '#plugin-PropagateTagsAndPerformers-a4AutoOnSourceUpdate{accent-color:#ffc107;}' +
    '#plugin-PropagateTagsAndPerformers-a2SaveImmediately:checked~.custom-control-label::before,' +
    '#plugin-PropagateTagsAndPerformers-a3AutoOnTargetUpdate:checked~.custom-control-label::before,' +
    '#plugin-PropagateTagsAndPerformers-a4AutoOnSourceUpdate:checked~.custom-control-label::before' +
    '{background-color:#ffc107;border-color:#ffc107;}' +
    '#plugin-PropagateTagsAndPerformers-g1LogToConsole{accent-color:#17a2b8;}' +
    '#plugin-PropagateTagsAndPerformers-g1LogToConsole:checked~.custom-control-label::before' +
    '{background-color:#17a2b8;border-color:#17a2b8;}';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.body || document.documentElement).appendChild(style);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(label, className) {
    var b = el('button', 'btn btn-secondary btn-sm' + (className ? ' ' + className : ''), label);
    b.type = 'button';
    return b;
  }

  // ── Is this script the one Stash has installed? ───────────────────────────
  //
  // "Reload plugins" re-reads the plugin folder on the server; it cannot replace a
  // script this page already fetched and executed. So the manifest can say one
  // version while the browser is still running the one before it, and every surface
  // Stash renders - the
  // version beside the plugin name included - shows the new number, because they all
  // come from the manifest over GraphQL. Comparing the two is the only way the
  // script can notice it is the stale one.
  //
  // Resolves to null wherever the answer is unknown: a Stash too old for the field,
  // a plugin it cannot see, a failed request. Unknown is not a mismatch, and a run
  // must never be blocked because one more query failed.
  //
  // It catches only what a version bump makes visible. Editing the file without
  // bumping it leaves both numbers equal and this check blind - which is the
  // practical reason the repo bumps a digit on every change.
  function installedVersion() {
    return gqlRequest('query PTP2REPluginVersion { plugins { id version } }', null)
      .then(function (data) {
        var list = (data && data.plugins) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id) === PLUGIN_ID) return list[i].version || null;
        }
        return null;
      }, function () { return null; });
  }

  // The two quiet outcomes are settled here, on the console next to the load banner:
  // a matching version is the boring case and the dialog's log is about the library,
  // not about itself.
  function checkInstalledVersion(onMismatch) {
    return installedVersion().then(function (installed) {
      if (!installed) {
        ptp2re('[ptp2re] version check: Stash reported no installed version; running ' +
          PLUGIN_VERSION + '.');
        return;
      }
      if (installed === PLUGIN_VERSION) {
        ptp2re('[ptp2re] version check: running ' + PLUGIN_VERSION + ', which is what is installed.');
        return;
      }
      onMismatch(installed);
    });
  }

  // ── Describing the configuration ──────────────────────────────────────────

  // The exclusion filters in force, named in the dialog before anything is planned.
  // A run whose filters are not what the user thinks they are is a run whose plan
  // cannot be read.
  function describeFilters(s) {
    var out = [];
    var tag = (s.f1ExcludeTargetWithTagName || '').trim();
    if (tag) out.push('entities tagged "' + tag + '" are skipped');
    if (s.f2ExcludeTargetOrganized) out.push('entities marked Organized are skipped');
    if (s.f3ExcludeTagWithIgnoreAutoTag) out.push('tags set to Ignore auto tag are never copied');
    var field = (s.f4ExcludeTagWithCustomFieldName || '').trim();
    if (field) out.push('tags carrying the custom field "' + field + '" are never copied');
    return out;
  }

  // Both halves of a reversible pair enabled at once. Under the task this is
  // harmless - each direction is applied once, in a fixed order - but the *result*
  // is that every member of the pair converges on the same set, and a user who
  // enabled each half because it looked reasonable alone will not expect that. So it
  // is said out loud rather than prevented.
  function pairedBoth(enabled) {
    var on = {};
    enabled.forEach(function (p) { on[p.id] = true; });
    var seen = {}, out = [];
    enabled.forEach(function (p) {
      if (!p.pair || !on[p.pair] || seen[p.pair]) return;
      seen[p.id] = true;
      out.push(p);
    });
    return out;
  }

  // ── Tags: the one query every run makes ───────────────────────────────────
  //
  // Tags are named from here rather than from the entity queries: a run's log names
  // tens of tags out of a walk that reads tens of thousands of entities, and
  // carrying `name` on every tag of every source would be a payload nothing reads.
  // The same query answers the two tag-level filters.
  //
  // `custom_fields` is requested only when that filter is configured - it is a free
  // JSON map per tag and dead weight otherwise.
  function tagQuery(s) {
    var fields = 'id name sort_name ignore_auto_tag';
    if ((s.f4ExcludeTagWithCustomFieldName || '').trim()) fields += ' custom_fields';
    return 'query PTPTags { findTags(filter: { per_page: -1 }) { tags { ' + fields + ' } } }';
  }

  function buildTagMap(tags) {
    var byId = {};
    tags.forEach(function (t) { byId[String(t.id)] = t; });
    return byId;
  }

  // ── Naming things in the log ──────────────────────────────────────────────

  function firstBasename(files) {
    for (var i = 0; files && i < files.length; i++) {
      if (files[i] && files[i].basename) return files[i].basename;
    }
    return null;
  }

  // `title` is optional on scenes, galleries and images, so each falls back to
  // whichever of the file fields its query asked for. Read off what is present
  // rather than switched on the target type: a per-type branch here is what let
  // galleries and images log as "untitled" in the sibling for three releases, the
  // fallback having been written for scenes and never extended.
  function displayName(ent) {
    return ent.title || ent.name ||
      firstBasename(ent.files) || firstBasename(ent.visual_files) ||
      (ent.folder && ent.folder.basename) || null;
  }

  function entityLabel(target, ent) {
    return TARGETS[target].label + ' "' + (displayName(ent) || 'untitled') + '" (' + ent.id + ')';
  }

  // Where an entity of each type lives in Stash's UI. `TARGETS[].route` is a regex for
  // reading an id *out* of a path and cannot be run backwards, so this is a table of its
  // own. A Marker is deliberately absent: it has no page to open, which is the same fact
  // that gives it no source button.
  var ROUTES = {
    scene: '/scenes/', gallery: '/galleries/', image: '/images/', group: '/groups/',
    performer: '/performers/', studio: '/studios/', tag: '/tags/',
  };

  function entityHref(type, id) {
    return ROUTES[type] ? ROUTES[type] + id : null;
  }

  // The entity a copy came *from*, for the log line. Same shape as a target's label so
  // the two read as one sentence, and same fallback chain, since four of the seven
  // source types are targets.
  function sourceLabel(tagMap, src, path) {
    var s = SOURCES[path.sourceType];
    var name = displayName(src);
    // Stash shows a titleless marker by its primary tag, which is the name the user
    // will recognise on the scene. Only the marker paths select it.
    if (!name && src.primary_tag && src.primary_tag.id != null) {
      name = tagName(tagMap, src.primary_tag.id);
    }
    return (s ? s.label : 'Source') + ' "' + (name || 'untitled') + '" (' + src.id + ')';
  }

  // What a scoped run's title calls the entity the click was made on. `entityLabel`'s
  // shape, keyed off whichever table knows the type - three source types are not
  // targets, and the four that are share one entry, so `SOURCES` first covers all
  // seven without a branch.
  //
  // A query for a title, and it earns it: the dialog used to say "Group 57", which
  // names the one thing about that group the user cannot recognise and would have to
  // navigate away to look up. It is the same by-id lookup the source probe already
  // makes, and it is asked while a dialog opens on a scan that will make dozens.
  //
  // Falls back to the bare label and id on a failure, rather than rejecting: a dialog
  // that cannot name its scope should still open. It is a title.
  function scopeLabel(type, id) {
    var d = SOURCES[type] || TARGETS[type];
    if (!d) return Promise.resolve(type + ' ' + id);
    return gqlRequest('query PTP_scopename($id: ID!) { ' + d.one + '(id: $id) { ' + d.fields + ' } }',
      { id: String(id) }
    ).then(function (data) {
      var ent = data && data[d.one];
      return d.label + ' "' + ((ent && displayName(ent)) || 'untitled') + '" (' + id + ')';
    }, function () {
      return d.label + ' ' + id;
    });
  }

  // How many entities beyond the named one carried the same thing. The count is over
  // the sources of the path that supplied it first, not over every path: a tag on a
  // scene from both its studio and a performer is one addition, attributed to whichever
  // path reached it, and counting across paths would mean holding attribution for
  // additions that were never made.
  function fromLabel(label, sources) {
    return label + (sources > 1 ? ', +' + (sources - 1) + ' more' : '');
  }

  function tagName(tagMap, id) {
    var t = tagMap[String(id)];
    return t ? t.name : null;
  }

  function tagLabel(tagMap, id) {
    return 'Tag "' + (tagName(tagMap, id) || 'unknown') + '" (' + id + ')';
  }

  function performerLabel(names, id) {
    return 'Performer "' + (names[String(id)] || 'unknown') + '" (' + id + ')';
  }

  // Stash orders tags by COALESCE(sort_name, name) under NATURAL_CI, so the recap
  // reads straight against the tag list in the UI: sort_name wins where it is set
  // (it is nullable and exists only to override the name for sorting, so a blank one
  // is no override), compared case-insensitively with numeric runs as numbers -
  // hence "Volume 2" before "Volume 10". The id is the final tie-break, because two
  // tags in different parts of the hierarchy may share a name.
  var _collator = null;
  function collator() {
    if (_collator) return _collator;
    try {
      _collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'accent' });
    } catch (e) {
      // Without Intl this degrades to a case-insensitive compare rather than
      // throwing: a recap in the wrong order beats no recap.
      _collator = { compare: function (a, b) {
        var x = String(a).toLowerCase(), y = String(b).toLowerCase();
        return x < y ? -1 : (x > y ? 1 : 0);
      } };
    }
    return _collator;
  }

  function sortKey(tagMap, id) {
    var t = tagMap[String(id)];
    if (!t) return String(id);
    return (t.sort_name && String(t.sort_name).trim()) || t.name || String(id);
  }

  function numericId(a, b) {
    var x = parseInt(a, 10), y = parseInt(b, 10);
    if (!isNaN(x) && !isNaN(y) && x !== y) return x - y;
    return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);
  }

  // ── Tag tooltips on the recap ─────────────────────────────────────────────
  //
  // The recap names a tag; this says what the tag *is*, which is what tells two tags
  // with the same name apart without leaving the dialog. Same shape and same caps as
  // `MergePerformerTagsToScenes`' `taskTagTooltip` and `NormalizeParentTags`'
  // `tagTooltip` - separate because the plugins share no module; keep them readable
  // against each other.
  var TIP_ALIASES = 8;        // aliases named before the rest become a count
  var TIP_ALIAS_CHARS = 120;  // and the width that can cut the list shorter still
  var TIP_DESC_CHARS = 240;   // how much of a description the excerpt carries

  // Cut on the last space before the limit so a word is never sliced in half - unless
  // the only space is near the start, where honouring it would throw most of the
  // excerpt away.
  function excerpt(text, max) {
    var s = oneLine(text);
    if (s.length <= max) return s;
    var cut = s.slice(0, max);
    var space = cut.lastIndexOf(' ');
    if (space > max * 0.6) cut = cut.slice(0, space);
    return cut.replace(/[\s,;:.\-]+$/, '') + '…';
  }

  function aliasList(t) {
    return (((t && t.aliases) || []).map(oneLine)).filter(function (a) { return !!a; });
  }

  // Whether the tag has anything to say the recap does not already show. The span
  // already reads `"Tattoo" (11) x18`, so a tooltip repeating the name and id would
  // open on a hover only to restate the line under it - and since nothing marks which
  // tags have one, every hover that does open had better say something new.
  function tagHasDetail(t) {
    return !!(aliasList(t).length || oneLine(t && t.description));
  }

  function tagTooltip(t, id) {
    var lines = [oneLine((t && t.name) || 'unknown'), 'Stash tag id ' + id];
    var aliases = aliasList(t);
    if (aliases.length) {
      var shown = [], used = 0;
      for (var i = 0; i < aliases.length; i++) {
        if (shown.length && (shown.length >= TIP_ALIASES || used + aliases[i].length > TIP_ALIAS_CHARS)) break;
        shown.push(shown.length ? aliases[i] : excerpt(aliases[i], TIP_ALIAS_CHARS));
        used += aliases[i].length + 2;
      }
      // The tail is counted rather than dropped: a shortened list that does not say
      // it is shortened reads as a complete one.
      var rest = aliases.length - shown.length;
      lines.push('Aliases: ' + shown.join(', ') + (rest > 0 ? ', and ' + rest + ' more' : ''));
    }
    var desc = oneLine(t && t.description);
    if (desc) lines.push('Description: ' + excerpt(desc, TIP_DESC_CHARS));
    return lines.join('\n');
  }

  function partsText(parts) {
    return parts.map(function (p) { return p.text; }).join('');
  }

  // ── The exclusion filters ─────────────────────────────────────────────────
  //
  // Two levels, and they answer different questions. Entity-level skips a whole
  // target; tag-level refuses one tag wherever it would land.
  //
  // Note what tag-level filters cannot do: a *performer* has no "ignore auto tag"
  // and no custom fields on the relationship, so the two performer paths are
  // governed by the entity-level filters alone. The settings say "tags" for that
  // reason.
  function makeFilters(s, tagMap, excludeTagId) {
    var wantCustom = (s.f4ExcludeTagWithCustomFieldName || '').trim();
    var ignoreAuto = !!s.f3ExcludeTagWithIgnoreAutoTag;
    return {
      excludeTagId: excludeTagId,
      // Why a tag was refused, or null. A reason rather than a boolean so the log
      // can say which filter did it - and so nothing has to re-implement the rules
      // to explain them.
      tagBlocked: function (id) {
        if (excludeTagId && String(id) === String(excludeTagId)) {
          // Copying the "skip this entity" tag onto things would permanently exclude
          // whatever received it, and nothing here ever removes a tag.
          return 'it is the exclusion tag';
        }
        var t = tagMap[String(id)];
        if (!t) return null;
        if (ignoreAuto && t.ignore_auto_tag) return 'Ignore auto tag is set';
        if (wantCustom && t.custom_fields && hasOwn(t.custom_fields, wantCustom)) {
          return 'it carries the custom field "' + wantCustom + '"';
        }
        return null;
      },
      // Whole target skipped, or null.
      entityBlocked: function (target, ent) {
        if (s.f2ExcludeTargetOrganized && TARGETS[target].organized && ent.organized) {
          return 'it is marked Organized';
        }
        if (excludeTagId) {
          var tags = ent.tags || [];
          for (var i = 0; i < tags.length; i++) {
            if (String(tags[i].id) === String(excludeTagId)) return 'it carries the exclusion tag';
          }
        }
        return null;
      },
    };
  }

  // The id of the "skip entities carrying this" tag, or null when none is configured.
  //
  // Throws when the name is set and no such tag exists, and both callers - the task's
  // scan and an auto-mode reaction - let it stop them. Running unfiltered would copy
  // onto the very entities the user asked to protect, and nothing here ever removes
  // anything, so refusing is the safe direction. The sibling does the same.
  function resolveExclusionTagId(settings, tagMap) {
    var wanted = (settings.f1ExcludeTargetWithTagName || '').trim();
    if (!wanted) return null;
    for (var id in tagMap) {
      // Resolved against the tag list already in hand: exact and case-sensitive, with
      // none of the SQL LIKE wildcard trouble a name query brings (Stash compiles
      // EQUALS to LIKE, where _ and % are wildcards).
      if (hasOwn(tagMap, id) && tagMap[id].name === wanted) return id;
    }
    throw new Error('The exclusion tag "' + wanted + '" does not exist. Nothing was ' +
      'planned: running without it would write to the entities it is there to protect. ' +
      'Create the tag, or clear that setting.');
  }

  // ── Planning ──────────────────────────────────────────────────────────────
  //
  // Passes, in pipeline order: paths are grouped by stage and then by target, so
  // every path writing onto scenes in stage 2 is planned from **one** query rather
  // than three. Grouping across stages would be cheaper still and is wrong - the
  // stage boundary is what makes the cascade work.
  function buildPasses(paths) {
    var out = [], index = {};
    paths.forEach(function (p) {
      var key = p.stage + ':' + p.target;
      if (!index[key]) {
        index[key] = { key: key, stage: p.stage, target: p.target, paths: [],
                       scanned: 0, total: 0, started: false, sweep: null, gathered: null };
        out.push(index[key]);
      }
      index[key].paths.push(p);
      // A pass containing a reverse path has to gather that path's sources before it
      // can read a single target, so the sweep is recorded on the pass rather than
      // discovered halfway through it. Every reverse path in one pass sweeps the same
      // entity type - they are one query, not one each.
      if (p.reverse && !index[key].sweep) {
        index[key].sweep = { type: p.sourceType, scanned: 0, total: 0, started: false };
      }
    });
    return out;
  }

  function reversePaths(pass) {
    return pass.paths.filter(function (p) { return p.reverse; });
  }

  // The sweep query: one page of *sources*, carrying what each contributes and the
  // back-reference that says which targets it belongs to.
  //
  // This exists because `Gallery` has no `images` field. The obvious alternative -
  // `findImages` filtered to one gallery, per gallery - is the shape the design
  // sketched, and it is worse in the two ways that matter here: it costs a request per
  // gallery, and `per_page: -1` on a gallery holding twenty thousand images returns
  // twenty thousand images in one response. Sweeping every image once pages uniformly,
  // never builds an unbounded response, and costs requests in proportion to the
  // library rather than to the number of galleries.
  function sweepQuery(pass) {
    var paths = reversePaths(pass);
    var t = TARGETS[paths[0].sourceType];
    var parts = [SOURCES[paths[0].sourceType].fields];
    paths.forEach(function (p) { parts.push(leafSelection(p)); });
    // How a source names its targets. The same field for every reverse path in a
    // pass, since they all sweep one entity type into one target type.
    parts.push(paths[0].reverse.backRef + ' { id }');
    // Named apart from the target query over the same entity - `findImages` is both
    // the sweep here and the target pass of stage 6 - so a log, a network tab or a
    // test can tell which of the two is running.
    return 'query PTP_sweep_' + t.find + '($page: Int!, $per_page: Int!) {' +
      ' ' + t.find + '(filter: { page: $page, per_page: $per_page, sort: "id", direction: ASC }) {' +
      ' count ' + t.node + ' { ' + parts.join(' ') + ' } } }';
  }

  // One query per page of targets, carrying the target's own state and every
  // enabled path's traversal at once. Repeating a field is legal GraphQL and the
  // server merges the selections, so two paths sharing a walk prefix cost nothing.
  // What a pass reads off one target, independent of how the targets were found.
  // Extracted so the library walk and auto mode's single-entity fetch cannot come to
  // disagree about it: a field missing from one of two copies is a path that silently
  // plans nothing, and the diff it feeds is what decides "already has this".
  function targetParts(pass) {
    var t = TARGETS[pass.target];
    var parts = [t.fields];
    // Always requested, not only when the exclusion-tag filter is on: it is also
    // what a tag copy is diffed against, and the branch that omitted it would have
    // to be right about both uses.
    parts.push('tags { id }');
    if (t.organized) parts.push('organized');
    if (pass.paths.some(function (p) { return p.kind === 'performers'; })) {
      parts.push('performers { id }');
    }
    // A reverse path contributes nothing here - its sources are gathered separately
    // - so it drops out rather than splicing an empty string into the selection.
    pass.paths.forEach(function (p) {
      var sel = pathSelection(p);
      if (sel) parts.push(sel);
    });
    return parts;
  }

  function passQuery(pass) {
    var t = TARGETS[pass.target];
    var parts = targetParts(pass);
    return 'query PTP_' + t.find + '($page: Int!, $per_page: Int!) {' +
      ' ' + t.find + '(filter: { page: $page, per_page: $per_page, sort: "id", direction: ASC }) {' +
      ' count ' + t.node + ' { ' + parts.join(' ') + ' } } }';
  }

  // One named target, for auto mode. The task walks the library and never needs this;
  // a reaction knows exactly which entity was saved and must not page past everything
  // else to reach it.
  function oneQuery(pass) {
    var t = TARGETS[pass.target];
    return 'query PTP_one_' + t.one + '($id: ID!) {' +
      ' ' + t.one + '(id: $id) { ' + targetParts(pass).join(' ') + ' } }';
  }

  // A reverse path's sources for **one** target, filtered server-side.
  //
  // This is the per-target query step 5 rejected for the task, and it is right here for
  // the opposite reason. There it meant a request per gallery across the whole library,
  // to gather what one sweep gathers in one pass. Here there is exactly one gallery -
  // the one that was just saved - and sweeping every image in the library to find its
  // images would be absurd. The hazard step 5 actually named was the *unbounded
  // response* of `per_page: -1`, and this pages like everything else, so it is not
  // reintroduced.
  //
  // `reverse.backRef` names the field on the source that points at the target
  // (`Image.galleries`), and Stash's filter for the same relation carries the same
  // name, so one entry in the table serves both. That is a convenience of Stash's
  // naming, not a rule it promises - a relation whose filter is named differently
  // would need its own field here.
  function reverseQuery(path) {
    var t = TARGETS[path.sourceType];
    return 'query PTP_rev_' + t.find + '($id: ID!, $page: Int!, $per_page: Int!) {' +
      ' ' + t.find + '(' + t.filterArg + ': { ' + path.reverse.backRef +
      ': { value: [$id], modifier: INCLUDES } },' +
      ' filter: { page: $page, per_page: $per_page, sort: "id", direction: ASC }) {' +
      ' count ' + t.node + ' { ' + SOURCES[path.sourceType].fields + ' ' +
      leafSelection(path) + ' } } }';
  }

  // Follows a path's walk from one target, returning the source entities it lands
  // on. A step may be a single object (`studio`) or a list (`performers`); handling
  // both here is why the table does not have to annotate which is which.
  function walkSources(entity, path) {
    var nodes = [entity];
    for (var i = 0; i < path.walk.length; i++) {
      var next = [];
      for (var j = 0; j < nodes.length; j++) {
        var v = nodes[j] ? nodes[j][path.walk[i]] : null;
        if (v == null) continue;
        if (Array.isArray(v)) {
          for (var k = 0; k < v.length; k++) if (v[k] != null) next.push(v[k]);
        } else {
          next.push(v);
        }
      }
      nodes = next;
    }
    return nodes;
  }

  // What one source entity contributes. Ids as strings throughout: Stash's ids are
  // `ID!`, which serialises as a string, but a hand-built fixture or a future schema
  // change could hand back a number, and a Set keyed on both would hold duplicates.
  function payloadOf(src, path) {
    var out = [];
    if (path.kind === 'performers') {
      (src.performers || []).forEach(function (p) { if (p && p.id != null) out.push(String(p.id)); });
      return out;
    }
    if (path.markerTags && src.primary_tag && src.primary_tag.id != null) {
      out.push(String(src.primary_tag.id));
    }
    (src.tags || []).forEach(function (t) { if (t && t.id != null) out.push(String(t.id)); });
    return out;
  }

  // ── Applying ──────────────────────────────────────────────────────────────
  //
  // Entities needing the same addition are written together: the same studio tag
  // turns up on thousands of scenes, so grouping by delta turns tens of thousands of
  // mutations into a few hundred. Grouping is per target and per kind, since each
  // pair has its own mutation and its own BulkUpdateIds field anyway.
  //
  // Every write is an **ADD delta**, never a rewritten list. Two reasons, and the
  // second is the one that matters: a delta is what the server applies against the
  // entity as it is *now*, so a tag someone added from another tab between the scan
  // and the apply is not silently reverted - which a full list built from phase-1
  // data would do.
  function buildBatches(plan) {
    var groups = {}, order = [];
    plan.forEach(function (entry) {
      if (!entry.add.length) return;
      var ids = entry.add.slice().sort();
      var key = entry.target + '|' + entry.kind + '|' + ids.join(',');
      if (!hasOwn(groups, key)) {
        groups[key] = { target: entry.target, kind: entry.kind, ids: ids, entries: [] };
        order.push(key);
      }
      groups[key].entries.push(entry);
    });

    var batches = [];
    order.forEach(function (key) {
      var g = groups[key];
      for (var i = 0; i < g.entries.length; i += CHUNK_SIZE) {
        batches.push({
          target: g.target, kind: g.kind, ids: g.ids,
          entries: g.entries.slice(i, i + CHUNK_SIZE),
        });
      }
    });
    return batches;
  }

  function bulkMutation(target) {
    var t = TARGETS[target];
    return 'mutation PTP_' + t.bulk + '($input: ' + t.bulkInput + '!) {' +
      ' ' + t.bulk + '(input: $input) { id } }';
  }

  function batchInput(batch, mode) {
    var input = { ids: batch.entries.map(function (e) { return e.id; }) };
    input[batch.kind === 'performers' ? 'performer_ids' : 'tag_ids'] =
      { ids: batch.ids, mode: mode };
    return input;
  }

  function batchCount(batches) {
    var n = 0;
    batches.forEach(function (b) { n += b.entries.length; });
    return n;
  }

  var _active = null;
  // The path editor gets a slot of its own rather than sharing `_active`, because it
  // is now opened from *inside* the run dialog's footer: a run holding `_active` must
  // not stop the editor opening over it, and the editor closing must not clear the run.
  var _paths = null;

  // `scope` is what a manual button's dialog adds: `{ pathId, target, ids }` for a
  // target-side button (this one entity) or `{ pathId, sourceId }` for a source-side
  // one (whatever that source reaches, resolved once the settings are in). Absent for
  // the library-wide task, which is every enabled path over everything.
  function startRun(taskName, scope) {
    // The path editor writes a setting and has no plan, so it is a different object
    // rather than a second mode threaded through the run - and it opens over one.
    if (taskName === TASK_PATHS) {
      if (_paths) { _paths.focus(); return; }
      _paths = new PathsDialog(taskName);
      _paths.build();
      return;
    }
    if (_active) { _active.focus(); return; }
    _active = new Run(taskName, scope);
    _active.begin();
  }

  function Run(taskName, scope) {
    this.taskName = taskName;
    // Held on the run rather than passed to begin(), because Rescan calls begin()
    // again and a rescan of a scoped run has to stay scoped.
    this.scope = scope || null;
    this.reset();
    this.build();
  }

  Run.prototype.reset = function () {
    this.plan = [];
    // The same entries, keyed by target/kind/id. Two views of one list: `plan` is
    // the order things were found in and what the apply walks, `planIndex` is how a
    // later stage asks what an earlier one already decided.
    this.planIndex = {};
    this.passes = [];
    this.tagMap = {};
    this.performerNames = {};
    // Set by checkVersion when the running script is not the installed one. Per
    // pass, because a rescan re-checks - the user may have reloaded plugins since.
    this.stale = false;
    // Counts the passes, so anything still in flight when Rescan is pressed can be
    // dropped rather than landing in the middle of the next pass's log.
    this.pass = (this.pass || 0) + 1;
    this.scanned = {};
    this.total = {};
    this.errors = 0;
    this.applied = 0;
    this.failed = 0;
    // Accumulated from the writes the server accepted, never from the plan, so the
    // closing recap cannot summarise a failed batch or a Stop as though it landed.
    this.appliedCounts = emptyCounts();
    this.undoneCounts = emptyCounts();
    // What this dialog has written and can still take back: the batches the server
    // accepted, newest last. Session-scoped like `lines` rather than pass-scoped -
    // rescan() saves it across this call - because a rescan is how a run converges,
    // and losing the ability to undo at that point would be the moment the button
    // was most wanted.
    this.undoable = [];
    this.undone = 0;
    this.undoFailed = 0;
    this.undoTotal = 0;
    // Entities the server has accepted a write for, `{ target: { id: true } }`, so the
    // dialog can drop them from Apollo's cache when it finishes. Cleared per pass:
    // what an earlier pass evicted is already gone.
    this.wrote = {};
    this.cancelled = false;
    this.stopped = false;
    this.lines = [];
    this.pending = [];
    // `lines` is the export buffer and survives a Rescan, because Copy log is meant
    // to hand over the whole session. The rendered log survives a Rescan too, so
    // `lines.length` is also what the progress line counts; a separate pass-scoped
    // counter existed only while a rescan emptied the view under it.
    this.state = 'scanning';
  };

  Run.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'ptp2re-backdrop');
    this.modal = el('div', 'ptp2re-modal');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'ptp2re-head');
    // A plain block, so a title too long for one line wraps rather than being clipped
    // - which a scoped run's does, naming a plugin, a path and an entity. Nothing to
    // set: it is the default, and the only reason it holds is that no rule in `CSS`
    // makes this a flex child or sets `white-space`.
    head.appendChild(el('div', 'ptp2re-title', PLUGIN_SHORT_NAME + ' - ' + this.taskName));
    // The stale-script warning gets a box of its own, in the same red the settings
    // banner uses, rather than a sentence appended to `noteEl` among the run's other
    // warnings. Every other note here is about the library or another plugin; this one
    // is about the dialog itself running code the user has already replaced, and it is
    // the only one that disables Proceed. It reads as a different kind of thing because
    // it is one.
    this.staleEl = el('div', 'ptp2re-stale ptp2re-hidden', '');
    head.appendChild(this.staleEl);
    // The Undo button reverses this dialog's own writes while it is open. That is
    // not a restore and must never be allowed to read as one, so the backup
    // instruction leads and the limits are stated beside it rather than left to be
    // discovered.
    head.appendChild(el('div', 'ptp2re-warn',
      'Backing up your database before proceeding is recommended. This only ever adds tags and performers, but ' +
      'Undo only reverses what this dialog wrote, while it stays open, and cannot account ' +
      'for changes made elsewhere in the meantime.'));
    // Every name in this log carries a number in brackets and it is always a Stash
    // id, never a count - the counts are written as `x250` or spelled out. Nothing
    // else in the dialog says so, and an id read as "250 of these" is the kind of
    // misreading that gets a library-wide write approved for the wrong reason.
    head.appendChild(el('div', 'ptp2re-legend',
      'Reading the log: the number in brackets after a name is that entity\'s, tag\'s or ' +
      'performer\'s id - Scene "My Scene" (123) is the scene with id 123. Counts are ' +
      'written as x250, never in brackets.'));
    this.noteEl = el('div', 'ptp2re-note', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.progressEl = el('div', 'ptp2re-progress', 'Starting...');
    // The counters name a *pass*, and a pass is "<entity type> <stage>", so the same
    // type appears more than once in one line and the bare number is the only thing
    // telling two of them apart. Nothing on the page says what it is, hence the title.
    this.progressEl.title = PROGRESS_TIP;
    this.modal.appendChild(this.progressEl);

    this.logEl = el('div', 'ptp2re-log');
    this.modal.appendChild(this.logEl);

    var foot = el('div', 'ptp2re-foot');
    // Amber: the two buttons that write. See "one colour for a plugin wrote this".
    this.proceedBtn = button('Proceed', 'ptp2re-proceed');
    this.cancelBtn  = button('Cancel', 'ptp2re-cancel');
    this.stopBtn    = button('Stop', 'ptp2re-stop ptp2re-hidden');
    this.copyBtn    = button('Copy log', 'ptp2re-copy');
    this.undoBtn    = button('Undo', 'ptp2re-undo ptp2re-hidden');
    [this.proceedBtn, this.undoBtn].forEach(function (b) {
      b.className = b.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    });
    this.rescanBtn  = button('Rescan', 'ptp2re-rescan ptp2re-hidden');
    this.closeBtn   = button('Close', 'ptp2re-close ptp2re-hidden');
    // Teal: it edits a setting of ours and never the library. It is here rather than in
    // Settings - Tasks because this dialog is where a user finds out that a path they
    // wanted is off - the head lists what is enabled, and the plan is empty without it -
    // so the editor belongs a press away from that, not a page away.
    this.pathsBtn   = button(TASK_PATHS, 'ptp2re-paths-open');
    this.pathsBtn.className = this.pathsBtn.className.replace('btn-secondary', READONLY_BTN_VARIANT);
    this.pathsBtn.title = 'Choose which of the thirteen paths run. Saving there changes ' +
      'nothing already planned above - press Rescan to plan with the paths you have just set.';
    this.proceedBtn.disabled = true;
    this.undoBtn.title = 'Reverse every change this dialog has written, as an add/remove delta. ' +
      'Only what this dialog wrote, and only while it stays open.';
    this.rescanBtn.title = 'Review again and replace the plan with whatever is left to copy. ' +
      'The log is kept, and so is what Undo can still reverse.';

    this.proceedBtn.addEventListener('click', function () { self.proceed(); });
    this.cancelBtn.addEventListener('click', function () { self.cancel(); });
    this.stopBtn.addEventListener('click', function () { self.stop(); });
    this.copyBtn.addEventListener('click', function () { self.copy(); });
    this.undoBtn.addEventListener('click', function () { self.undo(); });
    this.rescanBtn.addEventListener('click', function () { self.rescan(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });
    this.pathsBtn.addEventListener('click', function () { startRun(TASK_PATHS); });

    [this.proceedBtn, this.cancelBtn, this.stopBtn, this.copyBtn, this.undoBtn,
      this.rescanBtn, this.closeBtn, this.pathsBtn].forEach(function (b) { foot.appendChild(b); });
    this.modal.appendChild(foot);

    wireEscape(this);
    document.body.appendChild(this.backdrop);
  };

  Run.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  // Empty hides it. `begin()` clears it on every pass for the same reason it clears
  // the note: a rescan after a reload must not go on claiming the script is stale.
  Run.prototype.showStale = function (msg) {
    this.staleEl.textContent = msg || '';
    this.show(this.staleEl, !!msg);
  };

  Run.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*ptp2re-hidden/g, '') + (visible ? '' : ' ptp2re-hidden');
  };

  Run.prototype.setState = function (state) {
    this.state = state;
    var scanning = state === 'scanning', ready = state === 'ready';
    var applying = state === 'applying', done = state === 'done';
    // Undoing is a write like applying, so it offers Stop and nothing else: Rescan
    // would plan against a library being changed underneath it, and Close would
    // abandon the reversal halfway with no way back to it.
    var undoing = state === 'undoing';
    this.show(this.proceedBtn, scanning || ready);
    this.show(this.cancelBtn, scanning || ready);
    this.show(this.stopBtn, applying || undoing);
    // Offered in ready as well as done: a rescan leaves the dialog holding a fresh
    // plan over a library an earlier pass already changed, and that is exactly when
    // the user is deciding between applying more and taking back what is there.
    this.show(this.undoBtn, (ready || done) && this.undoable.length > 0);
    this.show(this.rescanBtn, done);
    this.show(this.closeBtn, done);
    // Hidden mid-write for the same reason Close is: the paths it edits are the ones
    // the batches in flight were planned from.
    this.show(this.pathsBtn, !applying && !undoing);
    // Undo is deliberately not gated on `stale`: it reverses writes this dialog has
    // already made, and stranding the user with changes they cannot take back would
    // be a worse outcome than the mismatch it is protecting them from.
    this.proceedBtn.disabled = !ready || !this.plan.length || this.stale;
    this.spin(scanning || applying || undoing);
  };

  // A cursor cycling under the last log line for as long as work is in flight, and
  // gone the moment it is not. It is a sibling of the lines rather than part of one,
  // so it survives a flush that appends under it - `flush` moves it back to the end -
  // and it carries no `-line` class, since it is not a log line and must not be read
  // back as one. `state` is the single source of truth for whether it runs: every
  // path in and out of a write goes through setState.
  Run.prototype.spin = function (on) {
    if (!on) {
      if (this.spinTimer) clearInterval(this.spinTimer);
      this.spinTimer = null;
      if (this.spinEl && this.spinEl.parentNode) this.spinEl.parentNode.removeChild(this.spinEl);
      this.spinEl = null;
      return;
    }
    if (!this.spinEl) {
      this.spinEl = el('div', 'ptp2re-spin', SPIN_FRAMES[0]);
      var self = this, i = 0;
      this.spinTimer = setInterval(function () {
        self.spinEl.textContent = SPIN_FRAMES[++i % SPIN_FRAMES.length];
      }, SPIN_MS);
    }
    this.logEl.appendChild(this.spinEl);
  };

  // A run-level warning: into the log, where Copy log will carry it, and into the
  // dialog head, where it stays visible after the log has scrolled past it. Appends
  // rather than assigns, so a second warning cannot silently replace the first;
  // begin() blanks the head on every pass, so a rescan re-derives both.
  Run.prototype.note = function (msg) {
    this.log('WARN', msg);
    this.noteEl.textContent = this.noteEl.textContent
      ? this.noteEl.textContent + ' ' + msg : msg;
  };

  // `parts` is optional and only the tag recap passes it: that line is rendered as
  // spans so each tag can carry its own tooltip. `lines` keeps the plain string
  // either way - Copy log hands over text, and a tooltip is not text.
  Run.prototype.log = function (kind, message, parts) {
    var line = '[' + kind + '] ' + message;
    this.lines.push(line);
    this.pending.push({ kind: kind, line: line, parts: parts || null });
    this.scheduleFlush();
  };

  Run.prototype.scheduleFlush = function () {
    var self = this;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(function () {
      self.flushTimer = null;
      self.flush();
    }, LOG_FLUSH_MS);
  };

  // Only the tail is rendered: a first run on a large library can plan six figures
  // of changes, and one node per change is a page that stops responding. The full
  // log stays in `lines`, which is what Copy log exports.
  Run.prototype.flush = function () {
    if (!this.pending.length) return;
    var pending = this.pending;
    this.pending = [];
    // Out of the way while the lines land, so the cursor is neither counted against
    // the render cap nor left in the middle of the log.
    if (this.spinEl && this.spinEl.parentNode) this.logEl.removeChild(this.spinEl);
    pending.forEach(function (p) {
      var node = el('div', 'ptp2re-line ptp2re-' + p.kind, p.parts ? null : p.line);
      // The line looks exactly like every other one: the spans exist to hang a title
      // on and carry no styling of their own, the same call the sibling settled on
      // after an underline and a help cursor read as decoration on a log that has
      // none anywhere else.
      if (p.parts) {
        node.appendChild(el('span', null, '[' + p.kind + '] '));
        p.parts.forEach(function (seg) {
          var span;
          if (seg.href) {
            span = el('a', 'ptp2re-elink', seg.text);
            span.href = seg.href;
            span.target = '_blank';
            span.rel = 'noopener noreferrer';
          } else {
            span = el('span', seg.card ? 'ptp2re-hover' : null, seg.text);
          }
          if (seg.title) span.title = seg.title;
          if (seg.card) this.hoverCard(span, seg.card.kind, seg.card.id);
          node.appendChild(span);
        }, this);
      }
      this.logEl.appendChild(node);
    }, this);
    while (this.logEl.childNodes && this.logEl.childNodes.length > LOG_RENDER_CAP) {
      this.logEl.removeChild(this.logEl.firstChild);
    }
    if (this.spinEl) this.logEl.appendChild(this.spinEl);
    if (typeof this.logEl.scrollHeight === 'number') this.logEl.scrollTop = this.logEl.scrollHeight;
    this.renderProgress();
  };

  // ── The hover card ────────────────────────────────────────────────────────
  //
  // A log line names an entity, a tag and a performer, and the two that are not the
  // entity are the ones a user cannot recognise from a name alone - which tag out of
  // three with similar names, which of two performers. A `title` answers that for a
  // tag and cannot for a performer, because the thing that identifies a performer is
  // their picture.
  //
  // One card for the whole dialog, filled on hover, rather than a box per line: a plan
  // can run to six figures of lines, and a hidden card on each of them would be the
  // same page-that-stops-responding the render cap exists to prevent.
  //
  // `position:fixed` and placed from the anchor's rect, because the log scrolls: a box
  // positioned inside a line is clipped by the log's own overflow, which is exactly the
  // top of the log where the pointer usually is.
  Run.prototype.cardEl = function () {
    if (!this._card) {
      this._card = el('div', 'ptp2re-card');
      (this.modal || document.body).appendChild(this._card);
    }
    return this._card;
  };

  Run.prototype.hideCard = function () {
    if (!this._card) return;
    this._card.className = 'ptp2re-card';
  };

  Run.prototype.hoverCard = function (node, kind, id) {
    var self = this;
    var open = function () {
      // A stale answer arriving after the pointer has moved on must not reopen the card.
      self._cardFor = kind + ':' + id;
      self.showCard(node, kind, id);
    };
    var shut = function () { self._cardFor = null; self.hideCard(); };
    node.addEventListener('mouseenter', open);
    node.addEventListener('mouseleave', shut);
    // Reachable without a mouse. The spans are not focusable by default and giving a log
    // line a tab stop per tag would make the log untabbable, so only the link half of a
    // line takes focus; this is here for a browser that focuses on other grounds.
    node.addEventListener('focus', open);
    node.addEventListener('blur', shut);
  };

  Run.prototype.showCard = function (node, kind, id) {
    var self = this, key = kind + ':' + id;
    this.cardDetail(kind, id).then(function (detail) {
      if (self._cardFor !== key) return;
      self.paintCard(kind, id, detail);
      self.placeCard(node);
    });
  };

  // Failure resolves to null rather than rejecting, and a null card simply does not
  // open: this buys a hover, not a write, and an [ERROR] line in a log the user is
  // reading for what changed would be the worse outcome. Cached per dialog, so hovering
  // the same tag down a hundred lines is one query.
  Run.prototype.cardDetail = function (kind, id) {
    var cache = this._cardCache || (this._cardCache = {});
    var key = kind + ':' + id;
    if (cache[key]) return cache[key];
    var q = kind === 'performer'
      ? gqlRequest('query PTPPerformerCard($id: ID!) { findPerformer(id: $id) ' +
        '{ id name disambiguation gender birthdate country alias_list favorite ' +
        'rating100 scene_count image_path } }', { id: id })
        .then(function (d) { return (d && d.findPerformer) || null; })
      : gqlRequest('query PTPTagCard($id: ID!) { findTag(id: $id) ' +
        '{ id name description aliases } }', { id: id })
        .then(function (d) { return (d && d.findTag) || null; });
    cache[key] = q.then(null, function () { return null; });
    return cache[key];
  };

  Run.prototype.paintCard = function (kind, id, detail) {
    var card = this.cardEl();
    card.textContent = '';
    if (!detail) return;
    if (kind === 'performer' && detail.image_path) {
      var img = el('img');
      img.src = detail.image_path;
      img.alt = '';
      card.appendChild(img);
    }
    card.appendChild(el('div', 'ptp2re-card-name',
      (detail.name || 'unknown') + (detail.disambiguation ? ' (' + detail.disambiguation + ')' : '')));
    var rows = [];
    if (kind === 'performer') {
      rows.push(['Gender', detail.gender]);
      rows.push(['Born', detail.birthdate]);
      rows.push(['Country', detail.country]);
      rows.push(['Scenes', detail.scene_count]);
      rows.push(['Rating', detail.rating100 == null ? null : Math.round(detail.rating100 / 20) + '/5']);
      rows.push(['Favourite', detail.favorite ? 'yes' : null]);
      rows.push(['Aliases', (detail.alias_list || []).join(', ')]);
    } else {
      rows.push(['Aliases', (detail.aliases || []).join(', ')]);
      rows.push(['Description', oneLine(detail.description)]);
    }
    rows.push(['id', id]);
    rows.forEach(function (r) {
      if (r[1] == null || r[1] === '') return;
      card.appendChild(el('div', null, r[0] + ': ' + r[1]));
    });
    card.className = 'ptp2re-card ptp2re-card-open';
  };

  // Beside the pointer's anchor, flipped and clamped rather than allowed off screen.
  // Read at open time: the log scrolls, so the rect is only true of this instant - which
  // is fine, because the card is closed the moment the pointer leaves.
  Run.prototype.placeCard = function (node) {
    var card = this._card;
    if (!card || !node.getBoundingClientRect || !card.getBoundingClientRect) return;
    var a = node.getBoundingClientRect();
    var c = card.getBoundingClientRect();
    var vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    var top = a.bottom + 6;
    if (top + c.height > vh - 8) top = Math.max(8, a.top - c.height - 6);
    var left = Math.min(Math.max(8, a.left), Math.max(8, vw - c.width - 8));
    card.style.top = top + 'px';
    card.style.left = left + 'px';
  };

  Run.prototype.renderProgress = function () {
    // One figure per *pass*, not per target: several stages can walk scenes, and
    // adding those together would report a library several times its real size.
    // Only passes that have started are shown, so the line grows as the run does
    // rather than opening with a wall of zeroes.
    // A pass with a sweep reports it as a segment of its own, because it is the part
    // that takes the time: reading every image in the library to find each gallery's
    // is otherwise a silent minute before the target count starts moving at all.
    var parts = [];
    (this.passes || []).forEach(function (p) {
      if (p.sweep && p.sweep.started) {
        parts.push(TARGETS[p.sweep.type].plural + ' ' + p.stage + ': ' +
          p.sweep.scanned + ' / ' + p.sweep.total);
      }
      if (p.started) {
        parts.push(TARGETS[p.target].plural + ' ' + p.stage + ': ' + p.scanned + ' / ' + p.total);
      }
    });

    var summary;
    if (this.state === 'scanning') {
      summary = 'Scanning. ' + plural(this.plan.length, 'change') + ' found';
    } else if (this.state === 'ready') {
      summary = 'Review complete. ' + plural(this.plan.length, 'entity change') +
        ' planned, ' + plural(this.lines.length, 'log line');
    } else if (this.state === 'applying') {
      summary = 'Applying. ' + this.applied + ' of ' + this.plan.length + ' entities updated';
    } else if (this.state === 'undoing') {
      summary = 'Undoing. ' + this.undone + ' of ' + plural(this.undoTotal, 'change') + ' reversed';
    } else {
      summary = 'Finished. ' + plural(this.applied, 'entity change') + ' applied' +
        (this.failed ? ', ' + this.failed + ' failed' : '') +
        (this.undone ? ', ' + this.undone + ' reversed by Undo' : '');
    }
    if (this.errors) summary += ', ' + plural(this.errors, 'error');
    if (this.lines.length > LOG_RENDER_CAP) {
      summary += ' - showing the last ' + LOG_RENDER_CAP + ' of ' + this.lines.length + ' lines';
    }
    this.progressEl.textContent = parts.length ? summary + '\n' + parts.join('   ') : summary;
  };

  // ── Phase 1: review ───────────────────────────────────────────────────────

  Run.prototype.begin = function () {
    var self = this;
    this.setState('scanning');
    // Every pass re-derives the note from freshly loaded settings, so it has to
    // start empty: a warning that told the user to change something and rescan must
    // not still be up after they have done exactly that.
    this.noteEl.textContent = '';
    this.showStale('');
    this.renderProgress();
    this.log('INFO', PLUGIN_SHORT_NAME + ' - ' + this.taskName + ' - reviewing, nothing will be ' +
      'written yet.');

    // Someone else's lease, held right now. Ours is taken in proceed(), so nothing
    // here can be looking at its own. It is advisory and this is a manual action, so
    // it does not block - but two plugins rewriting the same entities at once is
    // worth saying out loud.
    if (coop().leases.length) {
      this.note('Another plugin is applying bulk changes right now (' +
        coop().leases[0].owner + ' - ' + coop().leases[0].label + '). Running both at once ' +
        'means each may undo part of the other; let it finish first.');
    }

    // Not chained ahead of the scan: it is one small query against a pass that reads
    // the whole library, and holding the scan up for it would buy nothing. It lands
    // long before Proceed is reachable, and setState is re-applied when it does.
    this.checkVersion();

    loadSettings().then(function (loaded) {
      self.settings = loaded.settings;

      // A scoped run reviews the one path its button names, and re-reads the setting
      // rather than trusting the tick that drew the button: a path can be switched off
      // between the two.
      var paths = self.scope ? scopedPaths(self.scope, self.settings) : enabledPaths(self.settings);
      // Published whether or not there is anything to scan: another plugin's own
      // overlap check must see "nothing enabled" as promptly as it sees anything
      // else, and the early return below must not skip it.
      publishDeclares(self.settings);
      if (!paths.length) {
        self.log('WARN', self.scope
          ? 'That path is no longer enabled. Turn it back on with ' + TASK_PATHS +
            ', then press the button again.'
          : 'No paths are enabled. Turn on at least one with ' + TASK_PATHS +
            ', then run the task again.');
        self.finishScan();
        return;
      }

      // Stated because it is not a presentation choice: the paths cascade, so the
      // order decides what a single run reaches. A user who expects marker tags to
      // arrive on a group in one pass needs to see that markers run before groups.
      // A scoped run has exactly one path and no order to explain, so it names the
      // path instead.
      self.log('INFO', self.scope
        ? 'Reviewing one path: ' + pathLabel(paths[0]) + '.'
        : 'Enabled, in the order they run: ' +
          paths.map(function (p) { return pathLabel(p); }).join('; ') + '.');

      // One note however many pairs are on, because only the names differ between
      // them: a second copy of the same three sentences is a paragraph the user has
      // already read, and with both pairs enabled it put ~300 identical characters
      // on screen twice.
      var both = pairedBoth(paths);
      if (both.length) {
        self.note('Both directions of ' +
          (both.length === 1 ? 'a reversible pair are' : both.length + ' reversible pairs are') +
          ' enabled (' + both.map(function (p) {
            return pathLabel(p) + ' and ' + pathLabel(pathById(p.pair));
          }).join(', ') + '). Applied together they drive every member to the same set of ' +
          'tags. That is what running both directions means, not a fault - but disable one, ' +
          'or turn on "common tags only", if it is not what you want.');
      }

      self.checkDeclaredOverlap(paths);
      self.checkHierarchySibling(loaded.all[NPT_ID]);

      var filters = describeFilters(self.settings);
      self.log('INFO', filters.length
        ? 'Exclusion filters in force: ' + filters.join('; ') + '.'
        : 'No exclusion filters are configured; nothing is skipped.');

      return self.scope ? self.scanScoped(paths) : self.scan(paths);
    }).then(function () {
      self.finishScan();
    }, function (e) {
      self.log('ERROR', 'Review failed: ' + (e && e.message ? e.message : String(e)));
      self.errors++;
      self.finishScan();
    });
  };

  // ── Phase 1: the walk over the library ────────────────────────────────────

  // The plan is keyed by **the entity being written, and what is being written to
  // it** - never by the path that asked. A scene wanting tags from its performers,
  // its studio and its markers is one entry carrying the union, because the write is
  // one delta on one entity. Several entries for one entity is the shape that
  // silently loses data, and it is the one thing here that must not be rearranged.
  function planKey(target, kind, id) { return target + ':' + kind + ':' + id; }

  Run.prototype.planEntry = function (target, kind, ent) {
    var key = planKey(target, kind, ent.id);
    var entry = this.planIndex[key];
    if (!entry) {
      entry = this.planIndex[key] = {
        target: target, kind: kind, id: String(ent.id),
        label: entityLabel(target, ent), add: [], has: {}, from: {},
      };
      this.plan.push(entry);
    }
    return entry;
  };

  // What an earlier stage has already decided to put on this entity. This is what
  // makes the cascade work inside one run: stage 2 plans marker tags onto a scene,
  // stage 4 copies that scene's tags onto its group, and without this the group would
  // gain them only on the *next* run - silently, since nothing errors.
  //
  // It reads the plan rather than a second structure, so there is one answer to "what
  // will this entity end up with" and no way for the two to disagree.
  Run.prototype.plannedFor = function (target, kind, id) {
    var entry = this.planIndex[planKey(target, kind, id)];
    return entry ? entry.add : null;
  };

  // The tag hierarchy and the filters, which every pass reads and neither kind of run
  // can start without. Held apart from `scan` so the scoped run below reaches it
  // without reaching the library walk it sits in front of.
  Run.prototype.prepare = function () {
    var self = this;
    return gqlRequest(tagQuery(this.settings), null).then(function (data) {
      self.tagMap = buildTagMap(((data.findTags || {}).tags) || []);

      var excludeTagId = resolveExclusionTagId(self.settings, self.tagMap);
      if (excludeTagId) {
        self.log('INFO', 'Exclusion tag resolved: ' + tagLabel(self.tagMap, excludeTagId) + '.');
      }
      self.filters = makeFilters(self.settings, self.tagMap, excludeTagId);
    });
  };

  Run.prototype.scan = function (paths) {
    var self = this;
    this.passes = buildPasses(paths);
    return this.prepare().then(function () {
      // Passes run one after another rather than in parallel, because a later stage
      // reads what an earlier one planned.
      var chain = Promise.resolve();
      self.passes.forEach(function (pass) {
        chain = chain.then(function () {
          if (self.cancelled) return null;
          return self.scanPass(pass);
        });
      });
      return chain;
    });
  };

  // Which path a scoped run reviews, or nothing if its setting has since been turned
  // off. One path, never "everything enabled into this entity": the button names one
  // source, and widening it in `runManual` would do more than the button promised.
  function scopedPaths(scope, s) {
    var p = pathById(scope.pathId);
    return p && pathOn(s, p) ? [p] : [];
  }

  // The entities a scoped run plans over: the one the target-side button is sitting on,
  // or - for a source-side button - whatever that source reaches, resolved through the
  // very lookup the click used to perform.
  Run.prototype.scopeIds = function (path) {
    if (this.scope.ids) {
      return Promise.resolve(this.scope.ids.map(function (id) { return String(id); }));
    }
    return resolveSourceTargets(path, [String(this.scope.sourceId)]);
  };

  // A manual button's review. Same planner as everything else - `planPass` is the one
  // auto mode uses, borrowed back below - so what this dialog lists is by construction
  // what the click used to write without asking. The only difference from `scan` is
  // where the entities come from: named, rather than paged out of the library.
  Run.prototype.scanScoped = function (paths) {
    var self = this;
    var path = paths[0];
    return this.prepare().then(function () {
      return self.scopeIds(path);
    }).then(function (ids) {
      self.passes = buildPasses(paths);
      var t = TARGETS[path.target];
      self.log('INFO', ids.length === 1
        ? 'Reviewing one ' + t.label.toLowerCase() + '.'
        : 'Reviewing ' + ids.length + ' ' + t.plural.toLowerCase() + ' this ' +
          path.source.toLowerCase() + ' reaches.');
      if (!ids.length) return null;
      var chain = Promise.resolve();
      self.passes.forEach(function (pass) {
        chain = chain.then(function () {
          if (self.cancelled) return null;
          // Set here rather than counted per entity: `planPass` fetches them one at a
          // time and the progress line wants the whole scope, not the last id read.
          pass.started = true;
          pass.total = ids.length;
          return self.planPass(pass, ids).then(function () {
            pass.scanned = ids.length;
            self.flush();
          });
        });
      });
      return chain;
    });
  };

  // Gathers a reverse path's sources for the whole library before a single target is
  // read, keyed by the targets each source names.
  //
  // It runs at the start of its own pass, not once for the run, and that is the point:
  // it reads the plan exactly where a walk would, so the cascade means the same thing
  // both ways. Sweeping once and sharing it between the two reverse paths would halve
  // the requests and put the correctness argument in a comment - it would hold only
  // while nothing between the two stages plans onto images, which is true today and is
  // not a property the table promises.
  Run.prototype.sweepPass = function (pass) {
    var self = this;
    var paths = reversePaths(pass);
    var t = TARGETS[pass.sweep.type];
    var query = sweepQuery(pass);
    var backRef = paths[0].reverse.backRef;

    pass.gathered = {};
    paths.forEach(function (p) { pass.gathered[p.id] = {}; });
    pass.sweep.started = true;
    this.log('INFO', 'Stage ' + pass.stage + ': no field leads from a ' +
      TARGETS[pass.target].label + ' to its ' + t.plural + ', so every ' +
      t.label.toLowerCase() + ' in the library is read once to gather them. On a large ' +
      'library this is the slowest part of the run.');

    function page(n) {
      if (self.cancelled) return Promise.resolve();
      return gqlRequest(query, { page: n, per_page: t.pageSize || PAGE_SIZE })
        .then(function (data) {
          var res = data[t.find] || {};
          var list = res[t.node] || [];
          pass.sweep.total = res.count || pass.sweep.total;
          pass.sweep.scanned += list.length;
          list.forEach(function (src) {
            // One source can name several targets - an image in two galleries counts
            // for both - so it is added once per target rather than once.
            (src[backRef] || []).forEach(function (ref) {
              if (!ref || ref.id == null) return;
              var key = String(ref.id);
              paths.forEach(function (p) {
                var index = pass.gathered[p.id];
                if (!hasOwn(index, key)) index[key] = emptyAggregate();
                self.addSource(index[key], src, p);
              });
            });
          });
          self.flush();
          if (!list.length || pass.sweep.scanned >= pass.sweep.total) return null;
          return page(n + 1);
        }, function (e) {
          // Same rule as a target page: logged, and the pass carries on with what it
          // has. The plan is then short rather than wrong - every target it does reach
          // is planned from every source that was read.
          self.log('ERROR', t.plural + ' sweep page ' + n + ' failed: ' +
            (e && e.message ? e.message : String(e)));
          self.errors++;
          return null;
        });
    }
    return page(1).then(function () {
      var gathered = 0, index = pass.gathered[paths[0].id];
      for (var k in index) if (hasOwn(index, k)) gathered++;
      self.log('INFO', 'Stage ' + pass.stage + ': read ' + pass.sweep.scanned + ' ' +
        t.plural.toLowerCase() + ', covering ' + gathered + ' ' +
        TARGETS[pass.target].plural.toLowerCase() + '.');
    });
  };

  Run.prototype.scanPass = function (pass) {
    var self = this;
    var t = TARGETS[pass.target];
    var query = passQuery(pass);
    this.log('INFO', 'Stage ' + pass.stage + ': ' + t.plural + ' ← ' +
      pass.paths.map(function (p) { return p.source; }).join(', ') + '.');

    function page(n) {
      // Marked started here rather than at the top of the pass, so a sweep does not
      // sit next to a target count of 0 / 0 for as long as it runs.
      pass.started = true;
      if (self.cancelled) return Promise.resolve();
      return gqlRequest(query, { page: n, per_page: t.pageSize || PAGE_SIZE })
        .then(function (data) {
          var res = data[t.find] || {};
          var list = res[t.node] || [];
          pass.total = res.count || pass.total;
          pass.scanned += list.length;
          list.forEach(function (ent) { self.planTarget(pass, ent); });
          self.flush();
          // A page shorter than asked for is the last one. Trusting `count` alone
          // would loop forever against a server that reports it differently.
          if (!list.length || pass.scanned >= pass.total) return null;
          return page(n + 1);
        }, function (e) {
          // A failed page is logged and the pass moves on: one bad page must not
          // cancel a library-wide review, and the plan is honest about being partial.
          self.log('ERROR', t.plural + ' page ' + n + ' failed: ' +
            (e && e.message ? e.message : String(e)));
          self.errors++;
          return null;
        });
    }
    // The sweep first, and the targets only once it has finished: a target read before
    // its sources were gathered would be planned from an empty set and never revisited.
    if (!pass.sweep) return page(1);
    return this.sweepPass(pass).then(function () {
      if (self.cancelled) return null;
      return page(1);
    });
  };

  // What a set of sources contributes to one target, along one path. Held apart from
  // where the sources came from, because they arrive two ways: a walk lands on them
  // one target at a time, and a sweep accumulates them across a whole library scan.
  // One aggregation for both, or the two would be free to disagree about the cascade,
  // about counting and about which source gets named.
  //
  //   n       how many sources were seen, which "common tags only" counts against
  //   counts  how many of them carry each id
  //   order   the ids, in the order they were first seen
  //   first   the label of the earliest source carrying each id
  function emptyAggregate() { return { n: 0, counts: {}, order: [], first: {} }; }

  Run.prototype.addSource = function (agg, src, path) {
    var self = this;
    agg.n++;
    // Performer names ride along with the traversal, so the log can name one without a
    // query of its own. Recorded from every source seen, not only from the ones that
    // end up in the plan: the cost is a string per performer and the alternative is a
    // name missing from exactly the line that needed it.
    if (path.kind === 'performers') {
      (src.performers || []).forEach(function (p) {
        if (p && p.id != null && p.name) self.performerNames[String(p.id)] = p.name;
      });
    }
    var ids = payloadOf(src, path);
    // The cascade: where the source is one of our own targets, whatever an earlier
    // stage planned for it counts as already there.
    if (hasOwn(TARGETS, path.sourceType) && src.id != null) {
      var planned = this.plannedFor(path.sourceType, path.kind, String(src.id));
      if (planned) ids = ids.concat(planned);
    }
    var seen = {};
    ids.forEach(function (id) {
      if (seen[id]) return;             // one source counts once, however it lists it
      seen[id] = true;
      if (!hasOwn(agg.counts, id)) {
        agg.counts[id] = 0;
        agg.order.push(id);
        agg.first[id] = sourceLabel(self.tagMap, src, path);
      }
      agg.counts[id]++;
    });
  };

  Run.prototype.aggregate = function (sources, path) {
    var agg = emptyAggregate(), self = this;
    sources.forEach(function (src) { self.addSource(agg, src, path); });
    return agg;
  };

  Run.prototype.planTarget = function (pass, ent) {
    var self = this;
    var blocked = this.filters.entityBlocked(pass.target, ent);
    if (blocked) return;

    pass.paths.forEach(function (path) {
      // A reverse path's sources were gathered by the sweep, keyed by target; a walk
      // finds them from the target in hand.
      var agg = path.reverse
        ? (pass.gathered && pass.gathered[path.id] || {})[String(ent.id)]
        : self.aggregate(walkSources(ent, path), path);
      // A hook the manual-button probe uses: whether this path found any sources at
      // all, independent of whether there is anything left to add below. No-op for the
      // task and for a normal auto-mode reaction, neither of which sets it - only
      // `probeButtons` does. Its partner `recordAddable` fires below, once per id this
      // path would actually contribute.
      if (self.recordExistence) self.recordExistence(path.id, !!(agg && agg.n));
      // Nothing to aggregate. Under either mode this is "add nothing" - the
      // intersection of no sets is not everything here, it is emptiness, because a
      // group with no scenes has no scenes agreeing on anything.
      if (!agg || !agg.n) return;
      var counts = agg.counts, first = agg.first;

      // Union, or only what every source carries. One source makes the two the same
      // answer, which is the behaviour the setting's description promises.
      var common = pathCommon(self.settings, path);
      var wanted = agg.order.filter(function (id) {
        return common ? counts[id] === agg.n : true;
      });
      if (!wanted.length) return;

      var existing = {};
      (path.kind === 'performers' ? (ent.performers || []) : (ent.tags || []))
        .forEach(function (x) { if (x && x.id != null) existing[String(x.id)] = true; });

      var entry = null;
      wanted.forEach(function (id) {
        if (existing[id]) return;
        if (path.kind === 'tags') {
          var why = self.filters.tagBlocked(id);
          if (why) return;
        }
        // Eligibility, for the manual-button probe: this id survived the target's own
        // list and the tag filter, so *this path alone* would add it. Deliberately
        // ahead of the `entry.has` dedup below - that answers "did anyone already ask
        // for this id in this plan", which is the right question for the plan and the
        // wrong one for a button. Two paths that would each add the same tag are two
        // buttons that would each do something, and only the first would be counted
        // from the far side of the dedup.
        if (self.recordAddable) self.recordAddable(path.id);
        // The entry is created lazily, so a target with nothing to add never enters
        // the plan and never appears in the count Proceed is enabled on.
        if (!entry) entry = self.planEntry(pass.target, path.kind, ent);
        if (entry.has[id]) return;      // another path already asked for it
        entry.has[id] = true;
        entry.add.push(id);
        // Held on the entry, not recomputed: phase 2 and Undo log the same attribution
        // for the same addition, and by then the sources are long out of scope.
        entry.from[id] = fromLabel(first[id], counts[id]);
        var parts = self.changeParts(entry, path.kind, id);
        self.log(path.kind === 'performers' ? 'PERF' : 'TAG', partsText(parts), parts);
      });
    });
  };

  // The N-way counterpart to `checkHierarchySibling` below: this one needs no name
  // of its own, because any plugin - present or future - that declares one of our
  // enabled path ids in `coop().declares` is doing that exact same relationship
  // copy. That is redundant work and doubled log lines, never wrong data, since
  // every plugin that could collide here only ever adds. `MergePerformerTagsToScenes`
  // is the first such plugin, declaring `'tags:performer>scene'` unconditionally at
  // its own load; nothing here names it, so a second one needs no edit here either.
  Run.prototype.checkDeclaredOverlap = function (paths) {
    var declares = coop().declares, byOther = {};
    paths.forEach(function (p) {
      for (var id in declares) {
        if (!hasOwn(declares, id) || id === PLUGIN_ID) continue;
        if ((declares[id] || []).indexOf(p.id) === -1) continue;
        if (!byOther[id]) byOther[id] = [];
        byOther[id].push(pathLabel(p));
      }
    });
    var self = this;
    Object.keys(byOther).forEach(function (id) {
      self.log('INFO', id + ' also performs: ' + byOther[id].join('; ') + '. Running both is ' +
        'redundant work and doubled log lines, never wrong data - both only ever add.');
    });
  };

  // NormalizeParentTags' automatic modes, as its settings actually spell them.
  // Today that is one string carrying a mode per entity type ("SCENES=PRUNE,
  // IMAGES=ROLLUP"), so both directions can be on at once for different types; the
  // pair of booleans it replaced covered every type it was enabled for, where both at
  // once was that plugin's own documented no-op.
  //
  // Read by name rather than through its `coop().api`, like the rest of this check:
  // the API answers for one entity type at a time and needs the plugin to be running
  // in this page, and what this warning is about is a setting that may be set while
  // the plugin is disabled. It renamed every key it had at once, which is why the old
  // pair is still read - an install that has not been touched since then still
  // carries them, and this check has to keep working against it.
  function nptAutoModes(ps) {
    var modes = String((ps && ps.a1AutoModes) || '');
    if (modes) {
      return {
        prune: /=\s*prune\b/i.test(modes),
        rollup: /=\s*roll[\s_-]*up\b/i.test(modes),
      };
    }
    var prune = !!(ps && ps.a8AutoPruneOnUpdate), rollup = !!(ps && ps.a9AutoRollUpOnUpdate);
    if (prune === rollup) return { prune: false, rollup: false };
    return { prune: prune, rollup: rollup };
  }

  // The mirror of `MergePerformerTagsToScenes`' own check against the same sibling.
  // Unlike the overlap above, this is not "the same path" - it is prune/roll-up
  // along the tag *hierarchy* colliding with an addition along an entity
  // *relationship*, which applies equally to any of this plugin's eleven tag paths
  // regardless of which one added the tag. That is why it stays a name-based check
  // reading NormalizeParentTags' own settings, rather than folding into `declares`:
  // there is no path id on either side for a generic scan to match.
  Run.prototype.checkHierarchySibling = function (ps) {
    if (!ps) return;
    var auto = nptAutoModes(ps);
    if (!auto.prune && !auto.rollup) return;

    // Both, where its settings set one type to prune and another to roll up - a state
    // the pair of booleans it used to keep could not express, and which this once read
    // as "no mode is running".
    var mode = auto.prune && auto.rollup
      ? 'automatic Prune and Roll Up'
      : (auto.prune ? 'automatic Prune' : 'automatic Roll Up');
    var effect = auto.prune && auto.rollup
      ? 'it will rewrite the tags this run adds - removing the ones a more specific tag on ' +
        'the same entity implies, or adding every ancestor, depending on the entity type'
      : (auto.prune
        ? 'it will remove the tags this run adds, wherever a more specific tag on the same ' +
          'entity already implies them'
        : 'it will add every ancestor of the tags this run adds');

    if (coop().respecters[NPT_ID]) {
      this.log('INFO', NPT_NAME + ' has ' + mode + ' enabled; it will stand down while this ' +
        'task writes.');
      return;
    }
    // Not registered means one of two things and there is no way to tell them apart
    // from here: the plugin is disabled in Stash (so its settings linger in the
    // config but nothing is running), or the installed copy predates the lease
    // protocol. Say both rather than assert the alarming one.
    this.note(NPT_NAME + ' has ' + mode + ' enabled in its settings but has not registered as ' +
      'honouring bulk-edit leases - either it is disabled in Stash, or the installed copy is ' +
      'older than the protocol. If it is running, ' + effect + '. Turn it off for the duration, ' +
      'or check the result afterwards.');
  };

  Run.prototype.checkVersion = function () {
    var self = this;
    // The plan below would be computed by code that is not what is installed, so
    // Proceed is held back until the page is reloaded. This is the one warning in
    // this dialog that blocks, and the reason is that every other warning is about
    // the library or another plugin, where the user knows more than the dialog does -
    // here the dialog knows something the user cannot see.
    return checkInstalledVersion(function (installed) {
      self.stale = true;
      var msg = '\u26a0 This page is running ' + PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION +
        ', but ' + installed + ' is installed. Reload the page (F5) and run the task again; ' +
        'if this warning comes back, hard-refresh with Ctrl+Shift+R (\u2318+Shift+R on a Mac). ' +
        'Proceed stays disabled until the script matches, since the plan would be computed by ' +
        'the older code.';
      // Into the log as well as the box: Copy log is how a user reports this, and a
      // warning that only exists as chrome is one they cannot paste.
      self.log('WARN', msg);
      self.showStale(msg);
      self.setState(self.state);
    });
  };

  function emptyCounts() { return { tags: {}, performers: {} }; }

  function countsFromPlan(plan) {
    var out = emptyCounts();
    plan.forEach(function (entry) {
      entry.add.forEach(function (id) {
        out[entry.kind][id] = (hasOwn(out[entry.kind], id) ? out[entry.kind][id] : 0) + 1;
      });
    });
    return out;
  }

  // Every distinct tag and performer the run moves, and how many entities each lands
  // on. The per-entity lines answer "what happens to this scene"; this answers "which
  // tags does this run touch, and how widely" - which is the question actually asked
  // before trusting a library-wide write, and the one a six-figure log cannot be read
  // for.
  //
  // Counted per **entity**, not per path: a scene is written once whichever of its
  // paths asked for the tag.
  //
  // Phase 2 passes counts accumulated from the **writes the server accepted**, not
  // from the plan, so a failed batch or a Stop is never summarised as though it had
  // landed. The two lines differing is meaningful rather than a fault.
  //
  // The tag half hovers. `tagMap` carries names and sort names for every tag in the
  // library, because the filters need them; aliases and descriptions are fetched here
  // instead, for the handful of ids a recap actually mentions. A description can run
  // to paragraphs, and putting that text on `tagQuery` would carry it for the whole
  // library to name tens of tags. The performer half stays plain text: performers have
  // no equivalent detail on the traversal, and fetching it would be a query for a
  // tooltip.
  Run.prototype.recap = function (source, verb) {
    var self = this;
    var ids = {};
    ['tags', 'performers'].forEach(function (kind) {
      var counts = source[kind] || {};
      var list = [];
      for (var id in counts) if (hasOwn(counts, id)) list.push(id);
      ids[kind] = list;
    });
    if (!ids.tags.length) { this.recapLines(source, verb, ids, null); return Promise.resolve(); }
    // A rescan empties the log while this is in flight, and a recap of the pass before
    // it would land in the middle of the new one. The pass token is what makes the
    // wait safe.
    var pass = this.pass;
    return this.loadTagDetail(ids.tags).then(function (detail) {
      if (self.pass !== pass) return;
      self.recapLines(source, verb, ids, detail);
      self.flush();
    });
  };

  // Aliases and descriptions for the tags a recap names, or null if they could not be
  // had. Failure is silent by design: this buys a tooltip, not a write, and an [ERROR]
  // line in a log the user is reading for what was changed would be the worse outcome.
  Run.prototype.loadTagDetail = function (tagIds) {
    return gqlRequest(
      'query PTPTagDetail($ids: [ID!]) { findTags(ids: $ids) ' +
      '{ tags { id name aliases description } } }', { ids: tagIds }
    ).then(function (data) {
      var out = {};
      (((data.findTags || {}).tags) || []).forEach(function (t) { out[String(t.id)] = t; });
      return out;
    }, function () { return null; });
  };

  Run.prototype.recapLines = function (source, verb, ids, detail) {
    var self = this;
    ['tags', 'performers'].forEach(function (kind) {
      var counts = source[kind] || {};
      var list = ids[kind];
      if (!list.length) return;
      if (kind === 'tags') {
        list.sort(function (a, b) {
          var c = collator().compare(sortKey(self.tagMap, a), sortKey(self.tagMap, b));
          return c !== 0 ? c : numericId(a, b);
        });
      } else {
        list.sort(function (a, b) {
          var c = collator().compare(self.performerNames[a] || a, self.performerNames[b] || b);
          return c !== 0 ? c : numericId(a, b);
        });
      }
      var label = kind === 'tags' ? 'tag' : 'performer';
      var parts = [{ text: plural(list.length, label) + ' ' + verb + ': ' }];
      list.forEach(function (id, i) {
        var name = kind === 'tags' ? tagLabel(self.tagMap, id) : performerLabel(self.performerNames, id);
        var d = kind === 'tags' && detail && hasOwn(detail, String(id)) ? detail[String(id)] : null;
        parts.push({
          // The count is written x250 and never in brackets - the head legend says
          // so, and a count in brackets on this line would make it false.
          text: name.replace(/^(Tag|Performer) /, '') + ' x' + counts[id],
          title: d && tagHasDetail(d) ? tagTooltip(d, id) : null,
        });
        if (i < list.length - 1) parts.push({ text: ', ' });
      });
      self.log('INFO', partsText(parts), parts);
    });
  };

  Run.prototype.finishScan = function () {
    this.flush();
    if (this.cancelled) return;
    if (!this.plan.length) {
      this.log('INFO', 'Nothing to change.');
    } else {
      var adds = 0;
      this.plan.forEach(function (e) { adds += e.add.length; });
      this.log('INFO', 'Review complete: ' + plural(adds, 'addition') + ' across ' + plural(this.plan.length, 'entity change') +
        ' in ' + plural(buildBatches(this.plan).length, 'request') + '. Nothing has been ' +
        'written. Press Proceed to apply.');
      this.recap(countsFromPlan(this.plan), 'to add');
    }
    this.setState('ready');
    this.flush();
  };

  // ── Phase 2: apply ────────────────────────────────────────────────────────

  // The name each line reports. Batches group entities by an identical addition, but
  // each entity carries its own attribution - the same tag is rarely wanted for the
  // same reason twice - so the line is built per entry, not per batch.
  //
  // As `parts` rather than one string: the entity is a link to its own page and the tag
  // or performer opens a hover card, and both are things a user reads a plan to decide
  // about. `partsText` is what goes into `lines`, so Copy log is unchanged - a link and
  // a card are not text.
  Run.prototype.changeParts = function (entry, kind, id, prefix) {
    var parts = [];
    if (prefix) parts.push({ text: prefix });
    parts.push({ text: entry.label, href: entityHref(entry.target, entry.id) });
    parts.push({ text: ' - ' });
    parts.push(kind === 'performers'
      ? { text: performerLabel(this.performerNames, id), card: { kind: 'performer', id: id } }
      : { text: tagLabel(this.tagMap, id), card: { kind: 'tag', id: id } });
    if (entry.from[id]) parts.push({ text: ' - from ' + entry.from[id] });
    return parts;
  };

  // Called from both directions - an undo moves an entity as surely as an apply does,
  // so a cache entry left over from either is equally stale.
  Run.prototype.noteWritten = function (batch) {
    if (!this.wrote[batch.target]) this.wrote[batch.target] = {};
    var into = this.wrote[batch.target];
    batch.entries.forEach(function (entry) { into[String(entry.id)] = true; });
  };

  Run.prototype.batchFailed = function (batch, verb, e) {
    var ids = batch.entries.map(function (x) { return x.id; });
    // Sampled rather than listed: a failed chunk of a hundred should not put a
    // hundred ids on one log line.
    this.log('ERROR', TARGETS[batch.target].plural + ' - ' + verb + ' ' +
      TARGETS[batch.target].bulk + ' failed for ' + ids.length + ' entities (ids ' +
      ids.slice(0, 5).join(', ') + (ids.length > 5 ? ', ...' : '') + '): ' +
      (e && e.message ? e.message : String(e)));
    this.errors++;
  };

  Run.prototype.applyBatch = function (batch) {
    var self = this;
    return gqlRequest(bulkMutation(batch.target), { input: batchInput(batch, 'ADD') })
      .then(function () {
        // Recorded only once the server has taken it, so Undo can never try to
        // reverse a write that never landed.
        self.undoable.push(batch);
        self.noteWritten(batch);
        batch.entries.forEach(function (entry) {
          batch.ids.forEach(function (id) {
            var line = self.changeParts(entry, batch.kind, id);
            self.log(batch.kind === 'performers' ? 'PERF' : 'TAG', partsText(line), line);
            var c = self.appliedCounts[batch.kind];
            c[id] = (hasOwn(c, id) ? c[id] : 0) + 1;
          });
          self.applied++;
        });
      }, function (e) {
        // The whole batch failed, so none of its entities changed and none of them
        // are logged as changed.
        self.batchFailed(batch, 'apply', e);
        self.failed += batch.entries.length;
      });
  };

  // Apply and Undo drive their batches identically, and the reasoning is the same for
  // both - which is why it is written once here rather than twice.
  //
  // The lease is renewed per batch rather than taken once for the whole run, because a
  // library-wide pass can outlast any sane fixed expiry, and it is released in every
  // outcome - success, failure, Stop - so a reactive plugin is never left standing
  // down. The expiry is the backstop for the one outcome neither can catch: the tab
  // going away mid-run.
  //
  // guarded() is the other half of that, pointed inwards: every batch here is a
  // bulk*Update, which is exactly what this plugin's own auto mode watches for, so
  // without it a run with an auto mode enabled would re-plan each batch it had just
  // written - and an Undo would have its reversal put straight back. The lease cannot
  // do that job: it is advisory, and we honour our own leases no more than anyone
  // else's.
  Run.prototype.runBatches = function (batches, leaseLabel, step, verb, finish) {
    var self = this;
    var lease = acquireLease(leaseLabel);
    var i = 0;

    function nextBatch() {
      if (self.stopped || i >= batches.length) return Promise.resolve();
      lease.renew();
      return step(batches[i++]).then(function () {
        self.renderProgress();
        return nextBatch();
      });
    }

    guarded(nextBatch).then(function () {
      lease.release();
      finish.call(self);
    }, function (e) {
      lease.release();
      self.log('ERROR', verb + ' aborted: ' + (e && e.message ? e.message : e));
      self.errors++;
      finish.call(self);
    });
  };

  Run.prototype.proceed = function () {
    // `setState` already disables Proceed on an empty plan and on a stale script;
    // this is the second half of that, because a keyboard activation or a stale
    // reference must not reach a write.
    if (this.state !== 'ready' || !this.plan.length || this.stale) return;
    var self = this;
    this.setState('applying');
    this.applied = 0;
    this.failed = 0;
    this.appliedCounts = emptyCounts();
    this.stopped = false;
    this.log('INFO', 'Applying ' + plural(this.plan.length, 'entity change') + ' - ' +
      new Date().toISOString());

    this.runBatches(buildBatches(this.plan), this.taskName,
      function (b) { return self.applyBatch(b); },
      'Apply', Run.prototype.finishApply);
  };

  Run.prototype.finishApply = function () {
    this.log('INFO', 'Finished. ' + plural(this.applied, 'entity change') + ' applied' +
      (this.failed ? ', ' + this.failed + ' failed' : '') +
      (this.stopped ? ' (stopped early; changes already applied stay applied)' : '') +
      // A finished run is not the same thing as a settled library: the plan was
      // computed before the first write, so anything that changed during phase 2 -
      // another tab, a scan, a sibling plugin - is invisible to it. Rescanning until
      // the plan comes back empty is how a run converges.
      '. Press Rescan to review what is left.');
    this.recap(this.appliedCounts, 'added');
    this.setState('done');
    this.flush();
    // Evicted here rather than per batch: the dialog covers the page, so nothing
    // behind it is being read until it closes, and one eviction at the end beats one
    // per hundred entities. Eviction only, never `location.reload()` - that would tear
    // this dialog down at the moment the user wants to read or copy its log.
    evictWritten(this.wrote);
    this.wrote = {};
  };

  // ── Undo ──────────────────────────────────────────────────────────────────
  //
  // Reverses what this dialog has written, newest batch first, by replaying each
  // accepted mutation with REMOVE in place of ADD. What it is *not* is a restore: it
  // reaches this dialog's own writes and nothing else, it cannot see a change made in
  // between, and it dies with the tab. The head of the dialog says so and the backup
  // instruction stays exactly where it is.
  //
  // A delta rather than a rewritten list, for the same reason the apply is one: it
  // takes back precisely the assignments this run added and touches nothing else,
  // which is what lets it run over a library that has moved on - and equally what
  // stops it being a substitute for a backup.
  //
  // **This is the only code in the plugin that removes anything.** §1's "copy, never
  // move" is written around this exception rather than despite it.
  Run.prototype.undoBatch = function (batch) {
    var self = this;
    return gqlRequest(bulkMutation(batch.target), { input: batchInput(batch, 'REMOVE') })
      .then(function () {
        // Dropped from the record as it is reversed, so a Stop halfway leaves behind
        // exactly the batches that are still applied.
        var at = self.undoable.indexOf(batch);
        if (at !== -1) self.undoable.splice(at, 1);
        self.noteWritten(batch);
        batch.entries.forEach(function (entry) {
          batch.ids.forEach(function (id) {
            var back = self.changeParts(entry, batch.kind, id, 'Undo - ');
            self.log(batch.kind === 'performers' ? 'PERF' : 'TAG', partsText(back), back);
            var c = self.undoneCounts[batch.kind];
            c[id] = (hasOwn(c, id) ? c[id] : 0) + 1;
          });
          self.undone++;
        });
      }, function (e) {
        self.batchFailed(batch, 'undo', e);
        self.undoFailed += batch.entries.length;
      });
  };

  Run.prototype.undo = function () {
    // Offered in `ready` as well as `done`, because a rescan leaves the dialog
    // holding a fresh plan over a library an earlier pass already changed - which is
    // exactly when the user is choosing between applying more and taking back what is
    // there. Never while the dialog is itself mid-write.
    if ((this.state !== 'ready' && this.state !== 'done') || !this.undoable.length) return;
    var self = this;

    // One click here starts a library-wide write, in the state where the user is most
    // likely to be clicking around - Copy log, Rescan and Close are its neighbours -
    // so it arms and asks. The count is what makes the prompt worth reading: it
    // states the scope rather than asking a generic "are you sure".
    if (!this.undoArmed) {
      this.undoArmed = true;
      this.undoBtn.textContent = 'Undo ' + plural(batchCount(this.undoable), 'change') + '?';
      this.undoTimer = setTimeout(function () { self.disarmUndo(); }, UNDO_ARM_MS);
      return;
    }
    this.disarmUndo();

    this.setState('undoing');
    this.stopped = false;
    this.undone = 0;
    this.undoFailed = 0;
    this.undoneCounts = emptyCounts();
    this.undoTotal = batchCount(this.undoable);
    this.log('INFO', 'Undoing ' + plural(this.undoTotal, 'entity change') + ' - ' +
      new Date().toISOString());

    // Newest first, because that is the order that composes: a rescan-and-apply cycle
    // can write to one entity twice, and taking the second write back before the
    // first is the only sequence that lands where the run started. An undo is a bulk
    // write like any other, so it announces itself the same way - see runBatches, and
    // note that guarded() matters more sharply here: an undo writes the inverse delta,
    // so an auto mode reacting to it would put back exactly what the user just asked
    // to have taken away.
    this.runBatches(this.undoable.slice().reverse(), this.taskName + ' (undo)',
      function (b) { return self.undoBatch(b); },
      'Undo', Run.prototype.finishUndo);
  };

  Run.prototype.finishUndo = function () {
    this.log('INFO', 'Undo finished. ' + plural(this.undone, 'entity change') + ' reversed' +
      (this.undoFailed ? ', ' + this.undoFailed + ' could not be' : '') +
      (this.stopped ? ' (stopped early; what was reversed stays reversed)' : '') +
      (this.undoable.length
        ? '. ' + plural(batchCount(this.undoable), 'change') + ' are still applied.'
        : '. Everything this dialog wrote has been taken back.'));
    this.recap(this.undoneCounts, 'removed again');
    // Always finishes in `done`, even when it started from `ready`: a plan reviewed
    // against the library as it was no longer describes it, so Rescan is the honest
    // next step rather than a Proceed left armed over ground that has moved.
    this.setState('done');
    this.flush();
    // Same reasoning as finishApply: an undo moved these entities too.
    evictWritten(this.wrote);
    this.wrote = {};
  };

  Run.prototype.disarmUndo = function () {
    if (this.undoTimer) { clearTimeout(this.undoTimer); this.undoTimer = null; }
    this.undoArmed = false;
    if (this.undoBtn) this.undoBtn.textContent = 'Undo';
  };

  // ── The footer ────────────────────────────────────────────────────────────

  Run.prototype.stop = function () {
    if (this.state !== 'applying' && this.state !== 'undoing') return;
    this.stopped = true;
    this.log('WARN', 'Stopping after the current request...');
  };

  Run.prototype.cancel = function () {
    this.cancelled = true;
    this.log('INFO', 'Cancelled. Nothing was written.');
    this.close();
  };

  // Rescan exists because the whole plan is computed before the first write, so
  // anything that changes the library during phase 2 is invisible to the plan being
  // applied. Rescanning until the plan comes back empty is how a run converges.
  //
  // The rendered log is kept rather than emptied: the "--- Rescan ---" marker
  // separates the passes, and a log that stays until the dialog closes is the whole
  // session on screen - the same thing Copy log has always handed over.
  Run.prototype.rescan = function () {
    this.disarmUndo();
    var lines = this.lines.slice();
    // Carried across the reset for the same reason `lines` is: both are the record
    // of what this dialog has already done, and a rescan starts a pass rather than a
    // session. Converging on an empty plan must not cost the ability to undo the
    // passes that got there.
    var undoable = this.undoable;
    this.reset();
    this.lines = lines;
    this.undoable = undoable;
    this.log('INFO', '--- Rescan ---');
    this.begin();
  };

  // Two buttons copy to the system clipboard - the log here, and the diagram's layout
  // in the paths dialog - so the awkward half is in one place. `done(ok)` is whatever
  // the caller wants to say about it on the button.
  function copyToClipboard(text, done) {
    var nav = window.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      nav.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });
      return;
    }
    done(fallback());

    // Stash is commonly served over plain HTTP on a LAN, where the async clipboard
    // API is not available at all.
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        if (ta.select) ta.select();
        var ok = document.execCommand ? document.execCommand('copy') : false;
        document.body.removeChild(ta);
        return ok;
      } catch (e) {
        return false;
      }
    }
  }

  // Says what happened on the button that was pressed, and puts its caption back.
  function copyFeedback(btn, label) {
    return function (ok) {
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { btn.textContent = label; }, 2000);
    };
  }

  Run.prototype.copy = function () {
    copyToClipboard(this.lines.join('\n'), copyFeedback(this.copyBtn, 'Copy log'));
  };

  // ── Escape ────────────────────────────────────────────────────────────────
  //
  // Escape acts through whichever of Cancel/Close the footer is actually showing,
  // never by calling `close()` itself. The footer is the dialog's own statement of
  // what it will let you do right now, so routing the key through it means the key
  // can never reach a button that is hidden or disabled - and in particular does
  // nothing mid-write, where both are hidden and Stop is the only way out. A key
  // that quietly abandoned a run in flight would be worse than one that does nothing.
  function escapeButton(run) {
    var order = [run.closeBtn, run.cancelBtn];
    for (var i = 0; i < order.length; i++) {
      var b = order[i];
      if (b && !b.disabled && !hasClass(b, 'ptp2re-hidden')) return b;
    }
    return null;
  }

  // On `document`, not on the modal: the modal is not focusable, so a click into the
  // log would otherwise put the key out of reach. Removed in `close()` - a dialog that
  // has gone away must not still be answering for the page.
  function wireEscape(run) {
    run._onEscape = function (ev) {
      if (!ev || (ev.key !== 'Escape' && ev.keyCode !== 27)) return;
      // Two dialogs can be on the page at once - the path editor opens over the run -
      // and both listen on `document`, so without this the key would close both. The
      // editor is always the one on top while it is open.
      if (_paths && _paths !== run) return;
      var b = escapeButton(run);
      if (!b) return;
      if (ev.preventDefault) ev.preventDefault();
      b.click();
    };
    document.addEventListener('keydown', run._onEscape);
  }

  function unwireEscape(run) {
    if (run._onEscape && document.removeEventListener) {
      document.removeEventListener('keydown', run._onEscape);
    }
    run._onEscape = null;
  }

  Run.prototype.close = function () {
    unwireEscape(this);
    this.disarmUndo();
    this.spin(false);
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    if (_active === this) _active = null;
    // Whatever this dialog wrote may have made a manual button on the page behind it
    // eligible or not, and the buttons were unreachable while it was open, so this is
    // the first moment a re-probe is worth anything. On a page with no manual buttons
    // the tick returns before it queries anything.
    invalidateButtonProbes();
  };

  // ── The path settings dialog ──────────────────────────────────────────────
  //
  // The editor for the one setting this plugin's `b` block now holds. It exists
  // because a tri-state is not something Stash's settings page can render - a plugin
  // setting is BOOLEAN, NUMBER or STRING and nothing else - and because thirteen
  // paths spread over five alphabetical blocks were a list nobody could see the shape
  // of. Here they are in pipeline order, grouped by what they write into, which is
  // how the task's own log is ordered too.
  //
  // It writes a setting, not the library, so it carries no backup instruction: there
  // is nothing here for an Undo to reverse. What it does carry is what a path being
  // on actually means - the task covers it, the buttons appear for it, and the
  // automatic modes, if they are on, write along it with no dialog at all.
  // Which of the two views the dialog opens on, kept across close and reopen. In
  // localStorage rather than in the plugin settings, for the same reason
  // `NormalizeParentTags` keeps its run selection there: it is one browser's
  // convenience, not a configuration every tab and every user of that Stash shares -
  // and unlike every setting this plugin has, it changes nothing about what a run
  // does. Anything but the one word this writes reads as the list, so a hand-edited
  // or truncated value can only ever fall back.
  var VIEW_KEY = '__GTTx__.ptp2rePathsView';

  function viewStore() {
    try {
      return window.localStorage || null;
    } catch (e) {
      return null;                         // storage disabled: it opens on the list
    }
  }

  function storedVisual() {
    try {
      var store = viewStore();
      return !!store && store.getItem(VIEW_KEY) === 'visual';
    } catch (e) {
      return false;
    }
  }

  // Separately guarded from the read: a private window can hand out a store that
  // reads fine and throws on the first write, which would otherwise take the click
  // that switched the view down with it.
  function rememberView(visual) {
    try {
      var store = viewStore();
      if (store) store.setItem(VIEW_KEY, visual ? 'visual' : 'list');
    } catch (e) {
      // Full, or refused. The view still switched; it just will not be remembered.
    }
  }

  // ── Dragging, and the layout a drag produces ──────────────────────────────
  //
  // `dragXY` knows nothing about this plugin and is meant to be copied into the next
  // one that needs it, like `plural` and `coopObject`: give it an element and a
  // callback, and it reports how far the pointer has moved from where it went down.
  //
  // Pointer events rather than mouse ones - a pen and a touch work, and
  // `setPointerCapture` keeps the moves coming when the pointer leaves the element,
  // which a drag by definition does. `onMove` is called with the offset from the
  // start, never with an absolute position: the caller knows what it was dragging
  // from and this does not.
  function dragXY(node, onMove, onDrop) {
    node.addEventListener('pointerdown', function (ev) {
      if (ev.button) return;                       // a right or middle click is not a drag
      if (ev.preventDefault) ev.preventDefault();
      var x0 = ev.clientX, y0 = ev.clientY, moved = false;
      if (node.setPointerCapture && ev.pointerId != null) {
        try { node.setPointerCapture(ev.pointerId); } catch (e) { /* not captured */ }
      }
      function move(e) {
        moved = true;
        onMove(e.clientX - x0, e.clientY - y0);
      }
      function up() {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', up);
        if (moved && onDrop) onDrop();
      }
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
    });
  }

  // A rearranged diagram, kept per browser like the view choice and for the same
  // reason - it is one person's picture of their own library, not a configuration
  // every tab shares. `{ nodes: { <id>: {x, y} }, curves: { <pathId>: {along, off} } }`,
  // merged into the shipped tables by id, so a release that adds a box or a path
  // keeps its own placement for it rather than the whole layout being thrown away.
  var LAYOUT_KEY = '__GTTx__.ptp2reDiagramLayout';

  function storedLayout() {
    try {
      var store = viewStore();
      if (!store) return null;
      var v = JSON.parse(store.getItem(LAYOUT_KEY) || 'null');
      return v && typeof v === 'object' ? v : null;
    } catch (e) {
      return null;                         // absent, disabled, or not JSON at all
    }
  }

  function saveLayout(layout) {
    try {
      var store = viewStore();
      if (!store) return;
      if (layout) store.setItem(LAYOUT_KEY, JSON.stringify(layout));
      else store.removeItem(LAYOUT_KEY);
    } catch (e) {
      // Full, or refused. The drag still happened; it is this page's picture only.
    }
  }

  // Whether the diagram can be rearranged, read at the moment the dialog is built.
  // A console flag on the shared object rather than a setting or a permanent button,
  // for the reasons `debugButtons` is one: it is aimed at whoever is deliberately
  // authoring a layout, its natural lifetime is that session, and a stray drag on a
  // dialog everyone else opens to set thirteen toggles would be a bug, not a feature.
  function layoutEditing() {
    return !!coop().layoutEdit;
  }

  function PathsDialog(taskName) {
    this.taskName = taskName;
    this.modes = {};
    PATHS.forEach(function (p) { this.modes[p.id] = PATH_OFF; }, this);
    this.saving = false;
    this.stale = false;
  }

  // ── One button per path, and it *is* the control ──────────────────────────
  //
  // A `<select>` costs two clicks to change anything: one to open the list, one to
  // pick. Thirteen of them is twenty-six clicks to set up a library, for a control
  // whose options are two thirds of the time just Off and On. A button that carries
  // the current state and takes the next one on click is one click.
  //
  // **There is no tri-state button in HTML**, so the two paths that offer "common tags
  // only" get a *cycling* button - Off → All tags → Common tags only → Off - which is
  // never worse than the select it replaces (that cost two clicks for every change)
  // and is one click for the common case of turning a path on. The alternative, a
  // segmented group of three, is one click to *any* state and self-documenting, and
  // was not taken: it is a second widget shape in a column of thirteen, three times
  // the markup for two rows, and it widens the column for every other row with it.
  // The cycle is named in the button's title instead, which is what a select's open
  // list was doing for discoverability.
  //
  // A checkbox's `indeterminate` is the other thing that gets called tri-state and is
  // not one: a user cannot set it, only script can, and its third state means "unknown"
  // rather than a third choice.
  //
  // Bootstrap variants rather than colours of our own, so hover, focus and active come
  // from Stash's theme - and the amber is the repo's "this plugin writes" colour, which
  // is what a path being on means. Off is `btn-secondary`, both on-states are amber;
  // which of the two an amber button is in is what its caption says.
  //
  // In three columns filled top to bottom. The first two hold the eleven two-state
  // paths in pipeline order - which the head states is semantics here, not
  // presentation - and the third holds the two paths that can be `common`, together.
  // They are the only buttons whose caption changes width as it changes state, and a
  // column that resizes under the pointer is what pulled them out of the sequence;
  // `.ptp2re-toggle-wide` then holds them at the width of their longest caption so
  // even their own column stops moving. Pipeline order still reads down each column,
  // which is what the order is for. The label is `pathLabel`, the same string the
  // log and the dialog heads use, so there is no second naming of a path anywhere.
  //
  // Deliberately *not* grouped under an "Into <plural>" heading, which is what this
  // shipped with and got wrong: pipeline order visits a target, leaves it and comes
  // back, so a heading emitted at a target's first path collects later paths into
  // whichever heading happened to precede them. The label already names the target,
  // and the order is what the grouping would have had to break.
  PathsDialog.prototype.panel = function () {
    var self = this;
    var wrap = el('div', 'ptp2re-paths');
    var cols = PATH_COLUMNS.map(function () { return el('div', 'ptp2re-paths-col'); });
    cols.forEach(function (c) { wrap.appendChild(c); });
    this.toggles = {};
    // Where a button goes home to when the diagram gives it back. A row is
    // `display:contents`, so re-appending puts the button back in its own grid cell.
    this.rows = {};
    PATH_COLUMNS.forEach(function (ids, i) {
      ids.forEach(function (id) {
        if (!id) { cols[i].appendChild(el('div', 'ptp2re-path-gap')); return; }
        var p = pathById(id);
        if (!p) return;
        var row = el('div', 'ptp2re-path-row');
        var name = el('span', 'ptp2re-path-name', pathLabel(p));
        name.title = pathTip(p);
        row.appendChild(name);
        var labels = pathLabels(p), states = pathStates(p);
        var cycle = 'Click to cycle: ' +
          states.map(function (m) { return labels[m]; }).join(' \u2192 ');
        var btn = el('button', null);
        btn.type = 'button';
        // The third appearance a button here has, and the only one no click produces:
        // a path that is off while other enabled paths already carry its tags end to
        // end. It reads On because that is what the library does, and it wears the
        // amber as *letters on the resting background* rather than as a filled button,
        // because nothing was switched on - turning it on would add a direct copy,
        // which is a different thing from what is already happening.
        function paint() {
          var mode = self.modes[p.id] || PATH_OFF;
          var chain = mode === PATH_OFF ? coveredBy(self.chains || {}, p) : null;
          btn.textContent = chain ? PATH_LABEL[PATH_ON] : labels[mode];
          btn.className = 'btn btn-sm ptp2re-toggle' +
            (p.common ? ' ptp2re-toggle-wide' : '') +
            (chain ? ' ptp2re-toggle-auto' : '') +
            ' ' + (mode === PATH_OFF ? 'btn-secondary' : PLUGIN_BTN_VARIANT);
          btn.title = chain
            ? 'Off, and already happening: ' + chain.map(function (cid) {
                return pathLabel(pathById(cid));
              }).join(', then ') + ' carries the same tags the whole way. ' + cycle
            : cycle;
        }
        paint();
        btn.addEventListener('click', function (e) {
          if (e && e.preventDefault) e.preventDefault();
          var at = states.indexOf(self.modes[p.id] || PATH_OFF);
          self.modes[p.id] = states[(at + 1) % states.length];
          // Every button, not this one: switching a path on can be the link that
          // completes a chain covering some other path, and leaving that one showing
          // Off would be the same lie as never computing it.
          self.repaint();
        });
        row.appendChild(btn);
        cols[i].appendChild(row);
        self.rows[p.id] = row;
        self.toggles[p.id] = { el: btn, paint: paint };
      });
    });
    return wrap;
  };

  // What each box is doing under the current configuration, in its outline: amber
  // where something is being written into it, teal where something is being read out
  // of it, black where neither. Painted from `repaint` rather than at build, so it
  // follows a toggle the moment it is pressed - which is what makes the diagram answer
  // "what is this configuration actually doing" at a glance, the one question a column
  // of thirteen names cannot answer at all.
  //
  // **Amber wins where a box does both**, which Scene and Gallery both do the moment
  // more than a couple of paths are on. Being written into is the consequential half -
  // it is the repo's colour for "this plugin writes", and it is what a user is deciding
  // about when they look at this dialog.
  //
  // The giving side is keyed on the path id's own source segment, the same string the
  // node table uses, so `tags:subgroup>group` lights Sub-group rather than Group.
  PathsDialog.prototype.paintDiagram = function () {
    var self = this, live = {}, gives = {};
    PATHS.forEach(function (p) {
      if ((self.modes[p.id] || PATH_OFF) === PATH_OFF) return;
      live[p.target] = true;
      gives[/^[a-z]+:([a-z_]+)>/.exec(p.id)[1]] = true;
    });
    DIAGRAM_NODES.forEach(function (n) {
      if (!self.diaBoxes[n.id]) return;
      var state = live[n.id] ? ' ptp2re-dia-live'
        : gives[n.id] ? ' ptp2re-dia-gives' : ' ptp2re-dia-idle';
      self.diaBoxes[n.id].className = DIA_BOX_CLASS + state;
    });
  };

  // One pass over the modes, then every button. The chains are computed once here
  // rather than per button, which is also what keeps them consistent: thirteen
  // buttons each deriving their own answer is thirteen chances to derive it from a
  // half-updated map.
  PathsDialog.prototype.repaint = function () {
    var self = this;
    this.chains = pathChains(this.modes);
    PATHS.forEach(function (p) { self.toggles[p.id].paint(); });
    if (this.diaBoxes) this.paintDiagram();
  };

  // ── The diagram view ──────────────────────────────────────────────────────
  //
  // The same thirteen toggles, on the graph rather than in a column. `diagramGeometry`
  // has already decided where everything goes; this turns those numbers into nodes -
  // one absolutely-positioned div per box and per chip, one SVG curve per path, and
  // one slot per path for the button to sit in - and keeps a reference to each, so a
  // drag can move them without rebuilding anything. A rebuild would be simpler and
  // cannot be used: it would destroy the element the pointer is captured on.
  //
  // **The buttons are the list's own, moved here and back.** A second set would be a
  // second thing to paint, to enable and to keep in step with the modes, for a dialog
  // that only ever shows one view at a time.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var DIA_COLOUR = { tags: '#84d68a', performers: '#7cc4ff' };
  // What a drag rounds to. Small enough not to fight the pointer, large enough that
  // two boxes nudged into line actually line up.
  var DIA_SNAP = 5;
  // A box borrows Stash's own secondary button, the same two classes the dialog's
  // Cancel and Copy layout wear, so the diagram is themed by whatever the user's
  // Stash is themed by rather than by four hex values here.
  var DIA_BOX_CLASS = 'btn btn-secondary ptp2re-dia-box';

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) if (hasOwn(attrs, k)) node.setAttribute(k, attrs[k]);
    return node;
  }

  function diaPlace(node, box) {
    node.style.left = box.x + 'px';
    node.style.top = box.y + 'px';
    node.style.width = box.w + 'px';
    node.style.height = box.h + 'px';
  }

  function diaSnap(v) {
    return Math.round(v / DIA_SNAP) * DIA_SNAP;
  }

  PathsDialog.prototype.diagram = function () {
    var self = this;
    var editing = layoutEditing();
    this.layout = storedLayout() || {};
    if (!this.layout.nodes) this.layout.nodes = {};
    if (!this.layout.curves) this.layout.curves = {};

    this.centreLayout();

    var wrap = el('div', 'ptp2re-dia');
    wrap.appendChild(el('div', 'ptp2re-dia-legend',
      'One box per entity type, with what it holds inside it, and one arrow per path ' +
      'from what that path reads to what it writes. Green carries tags, blue carries ' +
      'performers, and a dashed arrow reaches its source through the target’s ' +
      'scenes - a Group has no performers or markers of its own. Every button is the ' +
      'same toggle the list view shows, on the arrow it belongs to.'));
    if (editing) wrap.appendChild(this.editBar());

    var canvas = this.canvas = el('div', 'ptp2re-dia-canvas' +
      (editing ? ' ptp2re-dia-editing' : ''));

    // One arrowhead per kind. A single marker filled with `context-stroke` would take
    // the line's own colour, and it is newer than the oldest browser someone might be
    // running Stash in - two markers cost four lines and cannot be too new.
    var svg = this.svg = svgEl('svg', {});
    var defs = svgEl('defs');
    ['tags', 'performers'].forEach(function (kind) {
      var marker = svgEl('marker', { id: 'ptp2re-head-' + kind, viewBox: '0 0 8 8',
        refX: 8, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto' });
      marker.appendChild(svgEl('path', { d: 'M0,0 L8,4 L0,8 z', fill: DIA_COLOUR[kind] }));
      defs.appendChild(marker);
    });
    svg.appendChild(defs);
    canvas.appendChild(svg);

    this.diaBoxes = {};
    this.diaChips = {};
    this.diaLines = {};
    this.slots = {};

    diagramGeometry(this.layout).nodes.forEach(function (n) {
      var box = el('div', DIA_BOX_CLASS);
      box.appendChild(el('div', 'ptp2re-dia-name', n.label));
      canvas.appendChild(box);
      self.diaBoxes[n.id] = box;
      // Chips are positioned on the canvas rather than inside the box, because they
      // are also the arrows' anchors: one coordinate system for both is one place for
      // them to disagree.
      self.diaChips[n.id] = n.chips.map(function (c) {
        var chip = el('div', 'ptp2re-dia-chip ptp2re-dia-' + c.kind, c.label);
        canvas.appendChild(chip);
        return chip;
      });
      if (editing) self.dragNode(box, n.id);
    });

    PATHS.forEach(function (p) {
      var line = svgEl('path', { fill: 'none', stroke: DIA_COLOUR[p.kind],
        'stroke-width': '2', 'marker-end': 'url(#ptp2re-head-' + p.kind + ')' });
      // Two hops: the payload is on something the target does not have, and is reached
      // through its scenes. The list view says so in the name's tooltip; here the line
      // itself can.
      if (p.hops === 2) line.setAttribute('stroke-dasharray', '6 4');
      // An SVG <title> is the only tooltip a line can carry, and it is the same
      // sentence the list view's name carries.
      var tip = svgEl('title');
      tip.textContent = pathLabel(p) + '. ' + pathTip(p);
      line.appendChild(tip);
      svg.appendChild(line);
      self.diaLines[p.id] = line;

      var slot = el('div', 'ptp2re-dia-slot');
      canvas.appendChild(slot);
      self.slots[p.id] = slot;
      if (editing) self.dragCurve(slot, p.id);
    });

    wrap.appendChild(canvas);
    this.redrawDiagram();
    return wrap;
  };

  // The picture, moved so it starts at the padding - which, with a canvas sized to
  // its contents and `margin:0 auto`, is what centres it in a dialog wider than it is.
  //
  // **Once, when the dialog is built, and never during a drag.** Recentring on every
  // redraw would mean dragging the leftmost box further left moved everything else
  // right by the same amount, so the box would sit under the pointer without ever
  // appearing to move. The picture settles the next time the dialog is opened, which
  // is also when the arrangement stops changing.
  //
  // It writes into `this.layout` rather than into the tables, and does not save: an
  // arrangement nobody has dragged is not one to store, and the next drop stores the
  // centred coordinates anyway.
  PathsDialog.prototype.centreLayout = function () {
    var self = this;
    var g = diagramGeometry(this.layout);
    var dx = DIA.pad - g.minX, dy = DIA.pad - g.minY;
    if (!dx && !dy) return;
    DIAGRAM_NODES.forEach(function (n) {
      var at = self.layout.nodes[n.id] || n;
      self.layout.nodes[n.id] = { x: at.x + dx, y: at.y + dy };
    });
  };

  // Every coordinate the diagram has, applied. Called once at build and again on
  // every pointer move, which is why it writes into existing nodes rather than
  // making new ones.
  PathsDialog.prototype.redrawDiagram = function () {
    var self = this;
    var g = diagramGeometry(this.layout);
    this.geo = { nodes: {}, edges: {} };
    this.canvas.style.width = g.w + 'px';
    this.canvas.style.height = g.h + 'px';
    this.svg.setAttribute('width', g.w);
    this.svg.setAttribute('height', g.h);
    this.svg.setAttribute('viewBox', '0 0 ' + g.w + ' ' + g.h);
    g.nodes.forEach(function (n) {
      self.geo.nodes[n.id] = n;
      diaPlace(self.diaBoxes[n.id], n);
      n.chips.forEach(function (c, i) { diaPlace(self.diaChips[n.id][i], c); });
    });
    g.edges.forEach(function (e) {
      self.geo.edges[e.id] = e;
      self.diaLines[e.id].setAttribute('d',
        'M' + e.x1 + ',' + e.y1 + ' Q' + e.cx + ',' + e.cy + ' ' + e.x2 + ',' + e.y2);
      self.slots[e.id].style.left = e.bx + 'px';
      self.slots[e.id].style.top = e.by + 'px';
    });
  };

  // A box, moved. The position at the start of the drag is read on the first move,
  // before anything has been applied - `dragXY` reports an offset and deliberately
  // does not know where the thing it is dragging was.
  PathsDialog.prototype.dragNode = function (node, id) {
    var self = this, from = null;
    dragXY(node, function (dx, dy) {
      if (!from) from = { x: self.geo.nodes[id].x, y: self.geo.nodes[id].y };
      self.layout.nodes[id] = { x: diaSnap(from.x + dx), y: diaSnap(from.y + dy) };
      self.redrawDiagram();
    }, function () {
      from = null;
      saveLayout(self.layout);
    });
  };

  // A toggle, moved - and its arrow with it, since the curve is defined to pass
  // through the toggle. Stored in the chord's own axes rather than in canvas pixels,
  // so moving either box afterwards carries the shape along instead of leaving it
  // behind.
  PathsDialog.prototype.dragCurve = function (node, id) {
    var self = this, from = null;
    dragXY(node, function (dx, dy) {
      var e = self.geo.edges[id];
      if (!from) from = { x: e.bx, y: e.by };
      self.layout.curves[id] = curveTo({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 },
        diaSnap(from.x + dx), diaSnap(from.y + dy));
      self.redrawDiagram();
    }, function () {
      from = null;
      saveLayout(self.layout);
    });
  };

  // The bar that only exists while `__GTTx__.StashPluginCoop.layoutEdit` is set. Copy
  // hands back the two tables as the source spells them, which is how a layout worth
  // keeping stops being one browser's and becomes everyone's; Reset drops the stored
  // one and goes back to those tables.
  PathsDialog.prototype.editBar = function () {
    var self = this;
    var bar = el('div', 'ptp2re-dia-edit');
    bar.appendChild(el('span', 'ptp2re-dia-edithint',
      'Layout editing is on: drag a box or a toggle. Changes are kept in this browser ' +
      'as you make them.'));
    var copy = button('Copy layout', 'ptp2re-dia-copy');
    copy.addEventListener('click', function () {
      copyToClipboard(self.layoutText(), copyFeedback(copy, 'Copy layout'));
    });
    var reset = button('Reset layout', 'ptp2re-dia-reset');
    reset.addEventListener('click', function () {
      self.layout = { nodes: {}, curves: {} };
      saveLayout(null);
      // Re-centred here as well as at build: nothing is being dragged, so there is no
      // pointer for a shift to surprise, and a Reset that left the picture hard against
      // one edge would look like a second thing had gone wrong.
      self.centreLayout();
      self.redrawDiagram();
    });
    bar.appendChild(copy);
    bar.appendChild(reset);
    return bar;
  };

  // The layout as the source would spell it. Whole tables rather than the differences:
  // what is pasted back replaces what is there, and a patch nobody can apply without
  // reading both is worse than eight lines of coordinates.
  PathsDialog.prototype.layoutText = function () {
    var self = this;
    var out = ['  var DIAGRAM_NODES = ['];
    DIAGRAM_NODES.forEach(function (n) {
      var at = self.layout.nodes[n.id] || n;
      out.push("    { id: '" + n.id + "', label: '" + n.label + "', x: " + at.x +
        ', y: ' + at.y + (n.perf ? ', perf: true' : '') + ' },');
    });
    out.push('  ];', '  var DIAGRAM_CURVE = {');
    PATHS.forEach(function (p) {
      var c = self.layout.curves[p.id] || DIAGRAM_CURVE[p.id];
      // A path with no entry is a straight line with its toggle halfway along, which
      // is what an absent entry already means - printing it would be thirteen lines
      // saying nothing.
      if (!c) return;
      out.push("    '" + p.id + "': { along: " + Math.round(c.along * 1000) / 1000 +
        ', off: ' + Math.round(c.off) + ' },');
    });
    out.push('  };');
    return out.join('\n');
  };

  // Which view is showing. The modal drops `narrow` for the diagram: the list is three
  // columns of short labels and reads worse the wider it gets, and the diagram is
  // 1100px of canvas that has nowhere to reflow to.
  PathsDialog.prototype.showView = function (visual) {
    var self = this;
    this.visual = !!visual;
    PATHS.forEach(function (p) {
      var home = self.visual ? self.slots[p.id] : self.rows[p.id];
      if (home) home.appendChild(self.toggles[p.id].el);
    });
    this.listPanel.className = 'ptp2re-paths' + (this.visual ? ' ptp2re-hidden' : '');
    this.diaPanel.className = 'ptp2re-dia' + (this.visual ? '' : ' ptp2re-hidden');
    this.modal.className = 'ptp2re-modal' + (this.visual ? '' : ' ptp2re-narrow');
    this.viewBtn.textContent = this.visual ? 'List view' : 'Visual view';
    this.viewBtn.title = this.visual
      ? 'Show the paths as a list of names, which is narrower and easier to read down.'
      : 'Show the paths as a diagram: a box per entity type and an arrow per path.';
    rememberView(this.visual);
  };

  // The three bulk buttons, in the footer opposite Save. Thirteen presses to turn everything on
  // is what they save, and they are the only place `common` can be asked for across
  // the board: a path that cannot take a mode takes the nearest one it can, which for
  // both "All On" buttons is plain On. So "All On / Common Tags" is not a fourteenth
  // state - it is "on everywhere, and common wherever common exists".
  PathsDialog.prototype.bulkRow = function () {
    var self = this;
    var row = el('div', 'ptp2re-paths-bulk');
    this.bulkBtns = [
      [PATH_OFF, 'All Off',
        'Switch every path off. Nothing is stored until you press Save.'],
      [PATH_ON, 'All On / All Tags',
        'Switch every path on, each copying every tag its sources carry.'],
      [PATH_COMMON, 'All On / Common Tags Only',
        'Switch every path on, and set the two that offer it to add a tag only when ' +
        'every one of their sources carries it. The other eleven have no such mode ' +
        'and are simply on.'],
    ].map(function (pair) {
      var b = el('button', 'btn btn-sm ' +
        (pair[0] === PATH_OFF ? 'btn-secondary' : PLUGIN_BTN_VARIANT), pair[1]);
      b.type = 'button';
      b.title = pair[2];
      b.addEventListener('click', function (e) {
        if (e && e.preventDefault) e.preventDefault();
        self.setAll(pair[0]);
      });
      row.appendChild(b);
      return b;
    });
    return row;
  };

  PathsDialog.prototype.setAll = function (mode) {
    var self = this;
    PATHS.forEach(function (p) {
      self.modes[p.id] = pathStates(p).indexOf(mode) >= 0 ? mode : PATH_ON;
    });
    this.repaint();
  };

  // Sets the modes without going through a click: this is the dialog telling the
  // buttons what it found, which is not the user pressing them.
  PathsDialog.prototype.set = function (modes) {
    var self = this;
    PATHS.forEach(function (p) {
      self.modes[p.id] = (modes && modes[p.id]) || PATH_OFF;
    });
    this.repaint();
  };

  PathsDialog.prototype.enable = function (on) {
    var self = this;
    PATHS.forEach(function (p) { self.toggles[p.id].el.disabled = !on; });
    (this.bulkBtns || []).forEach(function (b) { b.disabled = !on; });
  };

  PathsDialog.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'ptp2re-backdrop');
    this.modal = el('div', 'ptp2re-modal ptp2re-narrow');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'ptp2re-head');
    head.appendChild(el('div', 'ptp2re-title', PLUGIN_SHORT_NAME + ' - ' + this.taskName));
    head.appendChild(el('div', 'ptp2re-warn',
      'A path switched on here is one the task covers, one a manual button appears ' +
      'for, and - if either automatic mode is on - one that is written along whenever ' +
      'Stash saves an entity, with no dialog and no undo. Off is what a path does ' +
      'until you say otherwise.'));
    head.appendChild(el('div', 'ptp2re-legend',
      'Every path only ever adds; nothing is removed from the source or the target. ' +
      'The order below is the order a run walks them in, and it matters: what an ' +
      'earlier path adds is what a later one reads. The exclusion filters in the ' +
      'plugin settings apply to all of them.'));
    this.noteEl = el('div', 'ptp2re-note', 'Reading the current setting...');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    var body = el('div', 'ptp2re-pathsbody');
    // Both views are built up front and one is hidden. The diagram is a hundred-odd
    // nodes of static geometry - cheaper to build once than to keep a flag saying
    // whether it has been built, and building it on the first switch would leave the
    // buttons homeless until then.
    this.listPanel = this.panel();
    this.diaPanel = this.diagram();
    body.appendChild(this.listPanel);
    body.appendChild(this.diaPanel);
    this.modal.appendChild(body);

    var foot = el('div', 'ptp2re-foot');
    // Amber: this is the button that writes. See "one colour for a plugin wrote this".
    this.saveBtn   = button('Save', 'ptp2re-proceed');
    this.saveBtn.className = this.saveBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.cancelBtn = button('Cancel', 'ptp2re-cancel');
    // Teal: it changes nothing but which of the two views is on screen. See "one
    // colour for a plugin wrote this".
    this.viewBtn = button('Visual view', 'ptp2re-view');
    this.viewBtn.className = this.viewBtn.className.replace('btn-secondary', 'btn-info');
    this.saveBtn.disabled = true;
    this.saveBtn.addEventListener('click', function () { self.save(); });
    this.cancelBtn.addEventListener('click', function () { self.close(); });
    this.viewBtn.addEventListener('click', function () { self.showView(!self.visual); });
    [this.saveBtn, this.cancelBtn, this.viewBtn].forEach(function (b) { foot.appendChild(b); });
    // The bulk buttons sit at the other end of the footer, pushed there by the row's
    // own `margin-left:auto` rather than by anything in the shared `.foot` rule, which
    // is pinned byte-identical across the plugins. They belong in a footer and not
    // above the columns: they set the same thing Save then stores, and a row of
    // buttons over the panel read as a second header.
    foot.appendChild(this.bulkRow());
    // After the footer, so the bulk buttons are disabled with the rest until the
    // settings land: `enable` reaches every control the dialog owns.
    this.enable(false);
    this.modal.appendChild(foot);
    // Last, because it moves the toggles into whichever view is showing and reads the
    // footer's own button back.
    this.showView(storedVisual());

    wireEscape(this);
    document.body.appendChild(this.backdrop);
    this.checkVersion();

    loadSettings().then(function (loaded) {
      if (_paths !== self) return;
      self.set(loaded.settings.paths);
      self.enable(true);
      self.saveBtn.disabled = self.stale;
      // Save rewrites the whole setting from these selectors, so a value this script
      // could not read is about to be replaced by what it managed to make of it. That
      // is a fair thing to do on a press, and not one to do without saying so.
      var raw = String(loaded.settings.b1Paths || '').replace(/^\s+|\s+$/g, '');
      self.noteEl.textContent = raw && unrecognisedPairs(raw) > 0
        ? '\u26a0 Part of the stored setting is not something this script understands ' +
          '("' + raw + '"). It is shown below as far as it could be read, and it is left ' +
          'alone until you press Save - which replaces the whole of it with what is ' +
          'selected here.'
        : '';
    }, function (e) {
      if (_paths !== self) return;
      self.noteEl.textContent = 'The current setting could not be read (' +
        (e && e.message ? e.message : e) + '). Saving from here would replace it with ' +
        'whatever is selected above, so Save stays disabled - close this and try again.';
    });
  };

  // The same question the run dialog asks, and it blocks for a sharper reason. Save
  // does not add to this setting, it rewrites the whole string from the paths *this*
  // script knows - so a newer installed version that had grown a fourteenth path, or
  // a third mode, would have it silently dropped by a stale tab. The run dialog at
  // least shows the plan it would write; here the loss is invisible.
  PathsDialog.prototype.checkVersion = function () {
    var self = this;
    return checkInstalledVersion(function (installed) {
      if (_paths !== self) return;
      self.stale = true;
      self.saveBtn.disabled = true;
      self.noteEl.parentNode.insertBefore(el('div', 'ptp2re-stale',
        '⚠ This page is running ' + PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION +
        ', but ' + installed + ' is installed. Reload the page (F5); if this warning ' +
        'comes back, hard-refresh with Ctrl+Shift+R (⌘+Shift+R on a Mac). Save stays ' +
        'disabled until the script matches: it would rewrite the whole setting from the ' +
        'paths this older script knows, dropping anything the installed one has added.'),
        self.noteEl);
    });
  };

  PathsDialog.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  PathsDialog.prototype.save = function () {
    if (this.saving || this.saveBtn.disabled) return;
    var self = this;
    this.saving = true;
    this.saveBtn.disabled = true;
    this.enable(false);
    this.noteEl.textContent = 'Saving...';
    savePaths(formatPaths(this.modes)).then(function () {
      if (_paths !== self) return;
      // A run dialog underneath is holding a plan built from the paths that were set a
      // moment ago. Saying so beats letting the user read a plan that no longer matches
      // the configuration the head above it lists.
      if (_active && _active.log) {
        _active.log('INFO', 'The paths were changed while this dialog was open. The plan ' +
          'above was built from the previous setting - press Rescan to plan again.');
        _active.flush();
      }
      self.close();
    }, function (e) {
      self.saving = false;
      if (_paths !== self) return;
      self.saveBtn.disabled = false;
      self.enable(true);
      self.noteEl.textContent = 'The setting could not be saved: ' +
        (e && e.message ? e.message : e);
    });
  };

  PathsDialog.prototype.close = function () {
    unwireEscape(this);
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    if (_paths === this) _paths = null;
    // Whatever was saved changes which manual buttons belong on the page behind this.
    invalidateButtonProbes();
  };


  // ── Auto mode ─────────────────────────────────────────────────────────────
  //
  // A reaction to a save Stash made, with no dialog and no undo. It shares the task's
  // planner rather than carrying a second one - see `AutoRun` below - so what a
  // reaction decides to add is by construction what the task would have decided.
  //
  // Three things separate it from the task, and each has a reason:
  //
  //   * it is scoped to the entities that were saved, so it fetches them by id rather
  //     than paging the library;
  //   * it holds a lease measured in seconds rather than minutes, because that is how
  //     long one reaction lasts and a crashed tab must not stand a sibling down for
  //     five minutes over one scene save;
  //   * it refuses to touch an entity it has itself written to in the last
  //     AUTO_COOLDOWN_MS - the cooldown, below.

  // Settings, cached. Every mutation Stash makes reaches the fetch wrapper, and
  // `configuration { plugins }` cannot be scoped to one plugin, so reading them per
  // mutation would put a full settings query behind every save in the UI.
  var _autoSettings = null, _autoSettingsAt = 0, _autoSettingsWait = null;

  function autoSettings() {
    var now = Date.now();
    if (_autoSettings && now - _autoSettingsAt < AUTO_SETTINGS_TTL_MS) {
      return Promise.resolve(_autoSettings);
    }
    // One in-flight load is shared: a bulk edit of forty scenes arrives as one
    // mutation, but two saves in quick succession must not become two settings loads.
    if (!_autoSettingsWait) {
      _autoSettingsWait = loadSettings().then(function (r) {
        _autoSettings = r.settings;
        _autoSettingsAt = Date.now();
        _autoSettingsWait = null;
        publishDeclares(_autoSettings);
        return _autoSettings;
      }, function (e) {
        _autoSettingsWait = null;
        throw e;
      });
    }
    // Stale while it revalidates. Awaiting a lapsed TTL means one tick in ten blocks on
    // a full `configuration { plugins }` query before it can even look at the DOM, and
    // the button ticks run every second - so on any given navigation there is a real
    // chance the tick that would have drawn the button is the one paying for the
    // reload. `MergePerformerTagsToScenes` never has this problem because it reads a
    // plain settings object synchronously and refreshes it on its own timer, off the
    // path that draws the button; this is the same shape without a second copy of the
    // settings. The staleness window is the one the TTL already opened - every caller
    // was always working from settings up to ten seconds old - and our own save calls
    // `invalidateAutoSettings`, which clears the value rather than ageing it, so a
    // setting the user just changed is never served stale.
    if (_autoSettings) {
      _autoSettingsWait.then(null, function () {}); // the refresh is nobody's to await
      return Promise.resolve(_autoSettings);
    }
    return _autoSettingsWait;
  }

  // Our own settings being saved invalidates the cache rather than waiting out the
  // TTL, so switching a mode off takes effect on the next save and not ten seconds
  // later.
  // The button probes go with them: a path's own toggle changes `pathIdsKey` and
  // re-arms on its own, but a "common tags only" toggle changes what a path would add
  // without changing either the entity or the path set, so nothing else would notice.
  // Same for a filter setting. `invalidateButtonProbes` is a hoisted declaration
  // further down, beside the slots it clears.
  function invalidateAutoSettings() {
    _autoSettings = null; _autoSettingsAt = 0; _probeCtx = null;
    invalidateButtonProbes();
  }

  // ── The per-entity cooldown ───────────────────────────────────────────────
  //
  // `guarded()` suppresses our own writes *within* one reaction. This suppresses the
  // reaction *after* that one: two of the thirteen paths are exact reverses of another
  // (scenes ⇄ their group, images ⇄ their gallery), so with both halves of a pair on,
  // a write to a group is a group save, which propagates back to every scene in it,
  // which are scene saves. Union reaches a fixed point, so it terminates - but not
  // before a burst of writes across a whole group, and every one of them is a real
  // mutation against the user's library.
  //
  // Keyed per entity rather than globally, because the answer to "have I just written
  // this?" is per entity: a save of scene 7 must not be ignored because scene 9 was
  // written a second ago.
  var _written = {}, _writtenCount = 0;

  function coolKey(target, id) { return target + ':' + id; }

  function markWritten(target, id) {
    if (!hasOwn(_written, coolKey(target, id))) _writtenCount++;
    _written[coolKey(target, id)] = Date.now();
    // Swept on insert rather than on a timer: a tab left open on a large library must
    // not accumulate an entry per entity written, and a timer would keep the tab awake
    // to tidy a map nobody is reading.
    if (_writtenCount > AUTO_COOLDOWN_MAX) sweepWritten();
  }

  function sweepWritten() {
    var now = Date.now(), kept = {}, n = 0;
    for (var k in _written) {
      if (hasOwn(_written, k) && now - _written[k] < AUTO_COOLDOWN_MS) { kept[k] = _written[k]; n++; }
    }
    _written = kept;
    _writtenCount = n;
  }

  function cooledDown(target, id) {
    var at = _written[coolKey(target, id)];
    return at != null && Date.now() - at < AUTO_COOLDOWN_MS;
  }

  // ── Did the save actually land? ───────────────────────────────────────────
  //
  // `fetch` resolves for an HTTP 500 and for a GraphQL error returned with HTTP 200,
  // so "the request came back" is not "the edit was saved". Reacting to a save Stash
  // rejected would copy tags onto an entity on the strength of an edit that never
  // happened.
  //
  // The clone is safe because this handler is attached before Apollo's, so the body is
  // still unread; a clone that fails falls back to assuming success rather than
  // dropping the reaction.
  function mutationSucceeded(p) {
    return p.then(function (resp) {
      if (!resp || typeof resp.clone !== 'function') return true;
      if (resp.ok === false) return false;
      var copy;
      try { copy = resp.clone(); } catch (e) { return true; }
      return copy.json().then(function (j) { return !(j && j.errors && j.errors.length); },
                              function () { return true; });
    }, function () { return false; });
  }

  // ── The source side: from a saved source to the targets that read it ───────
  //
  // The target side answers "this scene was saved, refresh it from its sources". This
  // answers the other question: "this performer was saved, which scenes named it and
  // now need refreshing" - the fan-out `AutoRun.reverseSources` cannot help with,
  // because that gathers a *known* target's sources, not a source's targets.
  //
  // Once the affected target ids are known, this rejoins the target-side machinery -
  // `runAutoTargets` below is shared by both - so a source reaction plans and writes
  // exactly as a target reaction would. The only new thing here is finding those ids,
  // and it is per path because Stash's schema gives each relationship its own shape:
  //
  //   - most paths have a plain field back to whatever refers to their source -
  //     `Image.galleries`, `Gallery.scenes`, `Scene.groups`, `Group.scenes`,
  //     `Group.containing_groups`, `SceneMarker.scene` - and cost one query per saved
  //     entity, no filter guessing involved. `kind: 'field'`.
  //   - three do not: a Performer and a Studio carry no back-reference to the Scenes
  //     or Groups that use them, and a Gallery has no `images` field for the same
  //     reason the sweep exists. Those go through a filter on the *target's* own
  //     filter type - `scene_filter: { performers: { value: [$id], modifier: INCLUDES
  //     } }` - the same shape `reverseQuery` already trusts Stash to have, and no more
  //     verified than the rest of it. `kind: 'filter'`.
  //
  // `tags:performer>group` and `tags:marker>group` are two hops (performer/marker to
  // scene to group) but need no second round trip: the query for the first hop simply
  // selects the second hop's field too (`groups { group { id } }` alongside the scene
  // match, or nested under `scene` for a marker's single scene), so `pick` reads the
  // final ids straight out of the one response.
  function notNull(v) { return v != null; }

  var SOURCE_REVERSE = {
    'performers:image>gallery': { kind: 'field', one: 'findImage', sel: 'galleries { id }',
      pick: function (e) { return (e.galleries || []).map(function (g) { return g.id; }); } },
    'tags:image>gallery': { kind: 'field', one: 'findImage', sel: 'galleries { id }',
      pick: function (e) { return (e.galleries || []).map(function (g) { return g.id; }); } },
    'performers:gallery>scene': { kind: 'field', one: 'findGallery', sel: 'scenes { id }',
      pick: function (e) { return (e.scenes || []).map(function (s) { return s.id; }); } },
    'tags:group>scene': { kind: 'field', one: 'findGroup', sel: 'scenes { id }',
      pick: function (e) { return (e.scenes || []).map(function (s) { return s.id; }); } },
    'tags:marker>scene': { kind: 'field', one: 'findSceneMarker', sel: 'scene { id }',
      pick: function (e) { return e.scene && e.scene.id != null ? [e.scene.id] : []; } },
    'tags:scene>group': { kind: 'field', one: 'findScene', sel: 'groups { group { id } }',
      pick: function (e) {
        return (e.groups || []).map(function (g) { return g.group && g.group.id; }).filter(notNull);
      } },
    'tags:subgroup>group': { kind: 'field', one: 'findGroup', sel: 'containing_groups { group { id } }',
      pick: function (e) {
        return (e.containing_groups || []).map(function (g) { return g.group && g.group.id; }).filter(notNull);
      } },
    'tags:marker>group': { kind: 'field', one: 'findSceneMarker', sel: 'scene { groups { group { id } } }',
      pick: function (e) {
        var groups = (e.scene && e.scene.groups) || [];
        return groups.map(function (g) { return g.group && g.group.id; }).filter(notNull);
      } },
    'tags:performer>scene': { kind: 'filter', on: 'scene', field: 'performers', modifier: 'INCLUDES',
      pick: function (n) { return [n.id]; } },
    'tags:studio>scene': { kind: 'filter', on: 'scene', field: 'studios', modifier: 'INCLUDES',
      pick: function (n) { return [n.id]; } },
    'tags:studio>group': { kind: 'filter', on: 'group', field: 'studios', modifier: 'INCLUDES',
      pick: function (n) { return [n.id]; } },
    'tags:performer>group': { kind: 'filter', on: 'scene', field: 'performers', modifier: 'INCLUDES',
      sel: 'groups { group { id } }',
      pick: function (n) {
        return (n.groups || []).map(function (g) { return g.group && g.group.id; }).filter(notNull);
      } },
    'tags:gallery>image': { kind: 'filter', on: 'image', field: 'galleries', modifier: 'INCLUDES',
      pick: function (n) { return [n.id]; } },
  };

  // A `field`-kind lookup: one source entity by id, drilling straight to the
  // back-reference. Named apart from the task's own single-entity query
  // (`PTP_one_`) so a log or a test can tell a reaction's target refresh from its
  // source fan-out.
  function sourceFieldQuery(entry) {
    return 'query PTP_sfield_' + entry.one + '($id: ID!) {' +
      ' ' + entry.one + '(id: $id) { ' + entry.sel + ' } }';
  }

  function resolveFieldReverse(entry, id) {
    return gqlRequest(sourceFieldQuery(entry), { id: String(id) }).then(function (data) {
      var ent = data[entry.one];
      return ent ? entry.pick(ent) : [];
    });
  }

  // A `filter`-kind lookup: paged, like every other query here - a performer with a
  // six-figure scene count is exactly the case an unbounded response would break on.
  function sourceFilterQuery(entry) {
    var t = TARGETS[entry.on];
    var sel = 'id' + (entry.sel ? ' ' + entry.sel : '');
    return 'query PTP_sfilter_' + t.find + '_' + entry.field +
      '($id: ID!, $page: Int!, $per_page: Int!) {' +
      ' ' + t.find + '(' + t.filterArg + ': { ' + entry.field +
      ': { value: [$id], modifier: ' + entry.modifier + ' } },' +
      ' filter: { page: $page, per_page: $per_page, sort: "id", direction: ASC }) {' +
      ' count ' + t.node + ' { ' + sel + ' } } }';
  }

  // `anyIsEnough` is the button existence probe, which asks only whether the list comes
  // back empty. It stops at the first page that has yielded *something*, never at an
  // empty one - so the answer is identical to a full walk for both entry shapes,
  // including a two-hop pick where page 1 can legitimately produce nothing while page 2
  // does. What it saves is the common case: a studio with five thousand scenes paged
  // through in full to decide whether to draw one button.
  function resolveFilterReverse(entry, id, anyIsEnough) {
    var t = TARGETS[entry.on];
    var out = [], fetched = 0;
    function page(n) {
      return gqlRequest(sourceFilterQuery(entry), { id: String(id), page: n, per_page: t.pageSize })
        .then(function (data) {
          var res = data[t.find] || {};
          var list = res[t.node] || [];
          fetched += list.length;
          list.forEach(function (node) { out = out.concat(entry.pick(node)); });
          if (anyIsEnough && out.length) return out;
          if (list.length && fetched < (res.count || 0)) return page(n + 1);
          return out;
        });
    }
    return page(1);
  }

  // Every id a saved source (one path, one or more ids - a bulk save) puts in play,
  // deduplicated. Sequential per id, like `AutoRun.reverseSources`, rather than one
  // combined query: it is what every other reverse lookup in this plugin already
  // does, and a bulk save of sources is the uncommon case, not the one worth a second
  // query shape for.
  function resolveSourceTargets(path, ids, anyIsEnough) {
    var entry = SOURCE_REVERSE[path.id];
    if (!entry) return Promise.resolve([]);
    var out = {};
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        var got = entry.kind === 'filter' ? resolveFilterReverse(entry, id, anyIsEnough) : resolveFieldReverse(entry, id);
        return got.then(function (tids) {
          tids.forEach(function (tid) { if (tid != null) out[String(tid)] = true; });
        });
      });
    });
    return chain.then(function () { return Object.keys(out); });
  }

  // Every entity type that appears as a `PATHS` `sourceType`. Four of the seven are
  // also `TARGETS` and reuse its mutation names; the other three - Performer, Studio,
  // SceneMarker - are only ever a source in this plugin and are named here instead.
  var SOURCE_ENTITIES = {
    performer: { single: 'performerUpdate', bulk: 'bulkPerformerUpdate' },
    studio: { single: 'studioUpdate', bulk: 'bulkStudioUpdate' },
    marker: { single: 'sceneMarkerUpdate', bulk: 'bulkSceneMarkerUpdate' },
  };

  function mutationNamesFor(sourceType) {
    return hasOwn(TARGETS, sourceType) ? TARGETS[sourceType] : SOURCE_ENTITIES[sourceType];
  }

  // Same shape as `targetOfMutation`, over the wider set of types this plugin ever
  // reads from rather than only the four it ever writes to.
  function sourceOfMutation(q) {
    var seen = {};
    for (var i = 0; i < PATHS.length; i++) {
      var st = PATHS[i].sourceType;
      if (hasOwn(seen, st)) continue;
      seen[st] = true;
      var names = mutationNamesFor(st);
      if (!names) continue;
      if (new RegExp('\\b' + names.single + '\\b').test(q)) return { sourceType: st, bulk: false };
      if (new RegExp('\\b' + names.bulk + '\\b').test(q)) return { sourceType: st, bulk: true };
    }
    return null;
  }

  // ── The headless run ──────────────────────────────────────────────────────
  //
  // Everything that decides *what* to add is `Run`'s, borrowed rather than copied: the
  // walk, the aggregation, the union/intersection fold, the filters, the attribution,
  // the cascade through `plannedFor`. A second planner is the thing this must not
  // become - it would be free to drift from the one the review dialog shows, and the
  // user's only evidence about auto mode is that the task agrees with it.
  //
  // What differs is the driver: no dialog, no Proceed, entities named rather than
  // paged, and the log going to the console.
  function AutoRun(settings, tagMap, filters) {
    this.settings = settings;
    this.tagMap = tagMap;
    this.filters = filters;
    this.performerNames = {};
    this.plan = [];
    this.planIndex = {};
    this.cancelled = false;
    this.written = 0;
  }

  // `changeParts` comes along with `planTarget`, which builds every plan line through
  // it. Nothing here renders the parts - `AutoRun.log` takes the text and drops the
  // rest - but the line has to be built the same way in both, or the console line a
  // reaction prints would say something different from the one the dialog shows.
  ['planEntry', 'plannedFor', 'addSource', 'aggregate', 'planTarget',
    'changeParts'].forEach(function (m) {
    AutoRun.prototype[m] = Run.prototype[m];
  });

  AutoRun.prototype.log = function (kind, message) {
    if (kind === 'INFO') return;             // the dialog's progress narration; no dialog here
    if (this.settings.g1LogToConsole) console.info('[' + PLUGIN_NAME + '] ' + message);
  };

  // Gathers a reverse path's sources for one target. Paged, like every other query in
  // the plugin - a gallery holding twenty thousand images is exactly the case
  // `per_page: -1` would break on.
  AutoRun.prototype.reverseSources = function (path, id) {
    var self = this, out = [], t = TARGETS[path.sourceType];
    function page(n) {
      return gqlRequest(reverseQuery(path), { id: String(id), page: n, per_page: t.pageSize })
        .then(function (data) {
          var res = data[t.find] || {};
          var list = res[t.node] || [];
          out = out.concat(list);
          if (list.length && out.length < (res.count || 0)) return page(n + 1);
          return out;
        });
    }
    return page(1);
  };

  // Plans a fixed set of targets, one pass at a time. Passes run in order for the same
  // reason the task's do: a later stage reads what an earlier one planned.
  AutoRun.prototype.planEntities = function (target, paths, ids) {
    var self = this;
    var passes = buildPasses(paths);
    var chain = Promise.resolve();
    passes.forEach(function (pass) {
      chain = chain.then(function () { return self.planPass(pass, ids); });
    });
    return chain;
  };

  AutoRun.prototype.planPass = function (pass, ids) {
    var self = this;
    var t = TARGETS[pass.target];
    var revs = reversePaths(pass);
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        return gqlRequest(oneQuery(pass), { id: String(id) }).then(function (data) {
          var ent = data[t.one];
          if (!ent) return null;             // deleted between the save and the reaction
          if (!revs.length) { self.planTarget(pass, ent); return null; }
          // A reverse path's sources have to be in hand before the target is planned,
          // and they are per target here rather than per library, so they are gathered
          // into the same `gathered` shape `planTarget` reads from the sweep.
          pass.gathered = {};
          var sub = Promise.resolve();
          revs.forEach(function (p) {
            sub = sub.then(function () {
              return self.reverseSources(p, ent.id).then(function (sources) {
                var agg = self.aggregate(sources, p);
                pass.gathered[p.id] = {};
                pass.gathered[p.id][String(ent.id)] = agg;
              });
            });
          });
          return sub.then(function () { self.planTarget(pass, ent); });
        });
      });
    });
    return chain;
  };

  // Borrowed back the other way, for the same reason `AutoRun` borrows the planner:
  // a manual button's dialog plans a named set of entities, which is exactly what a
  // reaction does. Assigned after the definitions above rather than in `AutoRun`'s own
  // borrow list, which runs before them.
  ['reverseSources', 'planPass'].forEach(function (m) {
    Run.prototype[m] = AutoRun.prototype[m];
  });

  // Writes the plan. One lease for the whole reaction, renewed per batch, released
  // whatever happens - an error here must not latch a sibling into standing down.
  //
  // Apollo eviction happens here rather than in a caller, because every headless write
  // this plugin makes goes through this one function - the two manual buttons and both
  // auto modes. It shipped in `runManualSource` alone, so an auto reaction rewrote the
  // page the user was looking at and left it showing what it read before the save;
  // `MergePerformerTagsToScenes` refreshes after every one of its own auto merges.
  // Evicting from the caller means remembering to, once per write path.
  AutoRun.prototype.apply = function (label) {
    var self = this;
    var batches = buildBatches(this.plan);
    if (!batches.length) return Promise.resolve(0);
    var lease = acquireLease(label, AUTO_LEASE_TTL_MS);
    // Only what the server accepted, so a failed batch does not drop a cache entry
    // that still matches the library.
    var wrote = {};
    var chain = Promise.resolve();
    batches.forEach(function (batch) {
      chain = chain.then(function () {
        lease.renew();
        return gqlRequest(bulkMutation(batch.target), { input: batchInput(batch, 'ADD') })
          .then(function () {
            if (!wrote[batch.target]) wrote[batch.target] = {};
            batch.entries.forEach(function (entry) {
              wrote[batch.target][String(entry.id)] = true;
              // Marked only once the server has taken it: an entity we failed to write
              // has not been written, and must not be shielded from the next save.
              markWritten(batch.target, entry.id);
              self.written++;
              batch.ids.forEach(function (id) {
                self.log(batch.kind === 'performers' ? 'PERF' : 'TAG',
                  entry.label + ' - ' +
                  (batch.kind === 'performers'
                    ? performerLabel(self.performerNames, id)
                    : tagLabel(self.tagMap, id)) +
                  ' - from ' + (entry.from[id] || 'a related entity'));
              });
            });
          }, function (e) {
            // One failed batch does not cancel the rest, and says so where the user
            // will look: there is no dialog to carry an [ERROR] line.
            console.error('[ptp2re] auto mode: a batch of ' +
              plural(batch.entries.length, batch.target) + ' failed:', e);
          });
      });
    });
    return chain.then(function () {
      lease.release();
      evictWritten(wrote);
      return self.written;
    }, function (e) {
      lease.release();
      evictWritten(wrote);
      throw e;
    });
  };

  // The tag hierarchy and the filters, per reaction. Not cached with the settings: the
  // exclusion tag can be created or renamed at any time, and a stale answer here would
  // either write to protected entities or refuse to write at all.
  function autoContext(settings) {
    return gqlRequest(tagQuery(settings), null).then(function (data) {
      var tagMap = buildTagMap(((data.findTags || {}).tags) || []);
      return { tagMap: tagMap, filters: makeFilters(settings, tagMap, resolveExclusionTagId(settings, tagMap)) };
    });
  }

  // The same context, cached, *for the button existence probe only*. Safe here and
  // nowhere else, for exactly the reason the comment above gives: a probe decides whether
  // to *show* a button, never what to write, so a stale answer costs at most one button
  // shown or hidden. Dropped by `invalidateAutoSettings`, so changing a filter setting
  // re-probes at once rather than waiting the TTL out.
  //
  // The TTL is its own, and long. Measured on a live library: `tagQuery` took **766 ms**
  // of the 1230 ms a Scene Edit button took to appear, and it is the single largest cost
  // in the whole path. Caching it on the settings TTL, ten seconds, is not enough: that
  // is shorter than the gap between two visits to an edit tab, so in practice it was paid
  // again every time and the delay stayed exactly where it was. What the value has to be
  // sized against is not how fresh the answer needs to be for a *write* (this answer is
  // never used for one) but how long a button may go on being shown or hidden after the
  // tag library changed underneath it.
  var PROBE_CTX_TTL_MS = 300000; // 5 minutes
  var _probeCtx = null; // { at, promise }
  function probeContext(s) {
    var now = Date.now();
    if (_probeCtx && now - _probeCtx.at < PROBE_CTX_TTL_MS) return _probeCtx.promise;
    var p = autoContext(s);
    _probeCtx = { at: now, promise: p };
    // A failed probe must not be cached, or one hiccup mis-draws the buttons for the
    // whole TTL - which now matters a great deal more than it did at ten seconds.
    p.then(null, function () { if (_probeCtx && _probeCtx.promise === p) _probeCtx = null; });
    return p;
  }

  // Plans and writes into a fixed set of targets - shared by both auto modes, so a
  // source reaction and a target reaction end up going through the identical write
  // path once the target ids are known. `label` is the only thing that tells them
  // apart in a log.
  function runAutoTargets(target, ids, s, label) {
    var paths = enabledPaths(s).filter(function (p) { return p.target === target; });
    if (!paths.length) return Promise.resolve(0);
    var fresh = ids.map(String).filter(function (id) { return !cooledDown(target, id); });
    if (!fresh.length) return Promise.resolve(0);
    // `guarded()` around the whole reaction, reads included. Its job is the write:
    // a `bulkSceneUpdate` of ours is exactly what the branches below watch for, so
    // without it every reaction would react to itself. The cooldown would stop the
    // recursion at one round, but it is the backstop for the *next* save, not the
    // guard for this one - relying on it would make every reaction cost a second
    // pointless pass.
    return guarded(function () {
      return autoContext(s).then(function (ctx) {
        var run = new AutoRun(s, ctx.tagMap, ctx.filters);
        return run.planEntities(target, paths, fresh).then(function () {
          return run.apply(label);
        });
      });
    }).then(function (n) {
      // The reaction has changed what a button would add, and it ran after the save
      // that triggered it - so the wrapper's own invalidation has already been spent
      // on a library this write then moved again.
      if (n) invalidateButtonProbes();
      return n;
    });
  }

  // A save of one or more entities of one type: copy into them whatever the enabled
  // paths say belongs there.
  function reactToTargets(target, ids) {
    return autoSettings().then(function (s) {
      if (!s.a3AutoOnTargetUpdate) return 0;
      return runAutoTargets(target, ids, s, 'auto: into ' + TARGETS[target].plural.toLowerCase());
    }).catch(function (e) {
      // Never rethrown into Stash's own fetch chain: the user's save succeeded, and a
      // failed reaction to it must not look like a failed save.
      console.error('[ptp2re] auto mode (' + target + '):', e);
      return 0;
    });
  }

  // The reverse: one or more *sources* were saved. Every enabled path reading that
  // source type is resolved to the target ids it names, grouped by target type - a
  // studio names both scenes and groups - and each group is written through
  // `runAutoTargets`, exactly as if those targets had been saved themselves. That is
  // deliberate: once the ids are known, a source reaction is a target reaction, and
  // carrying a second write path here would be the second planner `AutoRun` was
  // built to avoid.
  function reactToSources(sourceType, ids) {
    return autoSettings().then(function (s) {
      if (!s.a4AutoOnSourceUpdate) return 0;
      var paths = enabledPaths(s).filter(function (p) { return p.sourceType === sourceType; });
      if (!paths.length) return 0;
      var byTarget = {};
      var chain = Promise.resolve();
      paths.forEach(function (p) {
        chain = chain.then(function () {
          return resolveSourceTargets(p, ids).then(function (tids) {
            if (!byTarget[p.target]) byTarget[p.target] = {};
            tids.forEach(function (tid) { byTarget[p.target][tid] = true; });
          });
        });
      });
      return chain.then(function () {
        var total = Promise.resolve(0);
        Object.keys(byTarget).forEach(function (target) {
          var tids = Object.keys(byTarget[target]);
          if (!tids.length) return;
          total = total.then(function (sum) {
            return runAutoTargets(target, tids, s, 'auto: from a ' + sourceType + ' save')
              .then(function (n) { return sum + n; });
          });
        });
        return total;
      });
    }).catch(function (e) {
      console.error('[ptp2re] auto mode (source: ' + sourceType + '):', e);
      return 0;
    });
  }

  // Which target a mutation names, and the ids it names. Single and bulk are separate
  // regexes on purpose: /\bsceneUpdate\b/ does not match `bulkSceneUpdate` - the
  // capital S breaks the word boundary - and the two read their ids from different
  // places.
  function targetOfMutation(q) {
    for (var k in TARGETS) {
      if (!hasOwn(TARGETS, k)) continue;
      var t = TARGETS[k];
      if (new RegExp('\\b' + t.single + '\\b').test(q)) return { target: k, bulk: false };
      if (new RegExp('\\b' + t.bulk + '\\b').test(q)) return { target: k, bulk: true };
    }
    return null;
  }

  function hasClass(node, name) {
    return (' ' + String((node && node.className) || '') + ' ').indexOf(' ' + name + ' ') !== -1;
  }

  // SettingsPluginsPanel.tsx gives every plugin setting an id built from the plugin
  // id and the setting key - `plugin-PropagateTagsAndPerformers-a1ShowManualButtons`.
  // That is ours by construction: no version suffix, no localisation, nothing
  // formatted for display. Both siblings shipped this broken by matching heading
  // text instead, twice, so the ids are the anchor and the heading is only a
  // fallback.
  function settingElement(key) {
    return document.getElementById('plugin-' + PLUGIN_ID + '-' + key);
  }

  // Walks up from any one of our settings to the group box that contains it. Trying
  // every key rather than two named ones means removing or renaming a setting cannot
  // quietly break the anchor.
  function ownSettingGroup() {
    var node = null, d;
    for (var key in DEFAULTS) {
      if (!hasOwn(DEFAULTS, key)) continue;
      node = settingElement(key);
      if (node) break;
    }
    for (d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return node;
    }
    // Fallback: the group headed with our own name. Trying every key already survives
    // one rename, but not a release that renames them all - and the first casualty of
    // that is the stale-script banner, which is the one thing on this page that such a
    // release needed to show. NormalizeParentTags renamed all nine of its keys at once
    // and its own banner went silent in every tab that had not been reloaded.
    //
    // Settings - Tasks heads *its* group with the same name, and that group is not
    // this one: it holds the task buttons and no settings, so decorating it would put
    // a README link and a split description on a page that never had either - and the
    // link lands inside the task button, replacing the label `ownTaskName` matches on.
    // The heading identifies us; the buttons say which page.
    var heading = ownSettingGroupHeading();
    for (node = heading, d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return hasOwnTaskButton(node) ? null : node;
    }
    return heading && !hasOwnTaskButton(heading.parentElement)
      ? heading.parentElement : null;
  }

  function ownSettingGroupHeading() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('h3') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (headingIsOurs(nodes[i].textContent)) return nodes[i];
    }
    return null;
  }

  // A plain recursive walk rather than `querySelectorAll('button')`: this runs against
  // a group that may be anywhere in the page's own markup, and matching on the task
  // captions is the only thing that identifies the Tasks page from inside it.
  function hasOwnTaskButton(node) {
    if (!node) return false;
    if (node.tagName === 'BUTTON' &&
        TASKS.indexOf(String(node.textContent || '').replace(/^\s+|\s+$/g, '')) !== -1) {
      return true;
    }
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (hasOwnTaskButton(kids[i])) return true;
    }
    return false;
  }

  // The `.setting` row a given setting lives in. `settingElement` returns the input
  // itself - Stash puts the id on the Form.Switch, not on the row. ' setting ' is
  // matched with its spaces so that "setting-group" is not mistaken for it.
  function settingRow(key) {
    var node = settingElement(key);
    for (var d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting')) return node;
    }
    return null;
  }

  // The two pages that show a group headed with our name do not head it the same
  // way. Settings - Tasks passes the plugin name straight through
  // (`heading: o.name`), but Settings - Plugins appends the version:
  //
  //   heading: `${plugin.name} ${plugin.version ? `(${plugin.version})` : undefined}`
  //
  // so the h3 there reads "... (<version>)" - and, because that template interpolates
  // the literal when there is no version at all, sometimes "... undefined".
  //
  // Strip the suffix and compare exactly, rather than testing a prefix: a plugin
  // whose name merely starts with ours must not be mistaken for us.
  function headingIsOurs(text) {
    var t = String(text == null ? '' : text).trim();
    if (t === PLUGIN_NAME) return true;
    t = t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '').trim();
    return t === PLUGIN_NAME;
  }

  // The first descendant carrying a class, in document order. This was a hand-rolled
  // depth-capped walk until the test harness grew a class selector; the walk existed
  // only because the fake DOM could not answer `.foo`, not because a browser cannot.
  // `querySelector` is the same search with the same ordering, and the depth cap it
  // drops was arbitrary rather than load-bearing.
  function byClass(root, name) {
    if (!root || typeof root.querySelector !== 'function') return null;
    try { return root.querySelector('.' + name) || null; } catch (e) { return null; }
  }

  // Under the description, which is inside the group header and therefore outside
  // the <Collapse> - so it shows whether or not the group is expanded. The fallbacks
  // are for a Stash that renders no sub-heading (an empty description) or no header
  // row at all.
  function readmeLinkSlot(group) {
    var sub = byClass(group, 'sub-heading');
    if (sub && sub.parentNode) return { parent: sub.parentNode, before: sub.nextSibling };
    var header = byClass(group, 'setting');
    var box = header && header.childNodes && header.childNodes[0];
    if (box) return { parent: box, before: null };
    return { parent: group, before: null };
  }

  // Paragraph spacing needs elements. Under `white-space: pre-wrap` a blank line is
  // always one whole line-height and nothing can target it, so the description's
  // paragraphs are rebuilt as divs and the gap becomes a margin - about a third of a
  // line, rather than a whole empty one.
  //
  // Stash renders the description as a single text node; React puts that text node
  // back on every re-render of this panel, so this runs on every tick and re-splits
  // when it has to. It is idempotent: once the children are ours, there is no text
  // node left to split.
  function splitDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'ptp2re-p')) return;   // already ours
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;                      // nothing to split
    var paras = text.split(/\n{2,}/);
    sub.textContent = '';
    paras.forEach(function (para) {
      var t = oneLine(para);
      if (t) sub.appendChild(el('div', 'ptp2re-p', t));
    });
  }

  // ── Settings verbosity: a summary on the page, the rest on hover ──────────
  //
  // Twenty-four settings is a wall of prose to read past to reach the next checkbox.
  // A description written as "summary\n\ndetail" shows only its first paragraph,
  // with the rest moved into a tooltip.
  //
  // Stash's own Setting renders `<h3 title={tooltip}>` (Inputs.tsx), but
  // SettingsPluginsPanel never passes a tooltip for a plugin setting, and
  // `PluginSetting` has no field to declare one - name, display_name, description,
  // type is the whole type. So the slot exists, is always empty for us, and is
  // filled from here.
  //
  // The split rides on the blank line the description format already supports rather
  // than a delimiter of our own. If this script never runs - a stale browser cache,
  // a .js that was never copied into the plugin folder - Stash renders the whole
  // description exactly as it did before, instead of showing a raw marker.
  //
  // The reasoning in full is in §6 of NormalizeParentTags' CLAUDE.md; this is the
  // third copy of one design, and `tests/style.test.js` pins the CSS across all
  // three.
  var TIP_MARK = 'ⓘ';                       // circled Latin small letter i

  function setTipOpen(sub, on) {
    var cls = String(sub.className || '').replace(/\s*ptp2re-tip-open\b/, '');
    sub.className = (on ? cls + ' ptp2re-tip-open' : cls).replace(/^\s+/, '');
  }

  // A class toggled from JS rather than a `:hover ~` selector, because the triggers
  // do not sit in one predictable place: the mark is inside the .sub-heading and the
  // name is an <h3> somewhere above it, and a sibling combinator would depend on
  // exactly how Stash nests the pair.
  //
  // The row is passed rather than the .sub-heading, and the current one looked up
  // per event: an <h3> is Stash's element and survives the re-renders that replace
  // everything we put in the row, so a captured reference would go stale. The flag
  // is what stops a second pair of listeners landing on it each time we rebuild.
  function tipTrigger(node, row) {
    if (!node || node._ptpTipWired) return;
    node._ptpTipWired = true;
    var toggle = function (on) {
      var sub = byClass(row, 'sub-heading');
      if (sub) setTipOpen(sub, on);
    };
    node.addEventListener('mouseenter', function () { toggle(true); });
    node.addEventListener('mouseleave', function () { toggle(false); });
    node.addEventListener('focus', function () { toggle(true); });
    node.addEventListener('blur', function () { toggle(false); });
  }

  function tipSetting(key) {
    var row = settingRow(key);
    if (!row) return;
    var sub = byClass(row, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'ptp2re-sum')) return;   // already ours
    var text = sub.textContent || '';
    var cut = text.indexOf('\n\n');
    if (cut === -1) return;                                       // nothing to hide
    var summary = oneLine(text.slice(0, cut));
    // Kept as paragraphs: a description with three paragraphs run together reads
    // worse than the wall this is replacing.
    var detail = text.slice(cut + 2).split(/\n{2,}/).map(oneLine)
      .filter(function (p) { return !!p; }).join('\n\n');
    if (!summary || !detail) return;
    sub.textContent = '';
    if (!hasClass(sub, 'ptp2re-tipped')) {
      sub.className = ((sub.className || '') + ' ptp2re-tipped').replace(/^\s+/, '');
    }
    var sum = el('span', 'ptp2re-sum', summary);
    sub.appendChild(sum);
    // tabIndex, so the box can be reached and read without a mouse. The box is a
    // sibling of the mark rather than a child: as a child it would sit inside an
    // inline span and inherit its clipping and stacking.
    var mark = el('span', 'ptp2re-tip', TIP_MARK);
    mark.tabIndex = 0;
    sub.appendChild(mark);
    sub.appendChild(el('span', 'ptp2re-tipbox', detail));
    tipTrigger(mark, row);
    // The visible summary opens it too. The mark is a small target for something
    // every row now hides half its text behind, and the box opens *above* the
    // .sub-heading, so it covers the name rather than the sentence being read.
    tipTrigger(sum, row);
    // The setting's *name* opens the same box, rather than carrying a plain `title`
    // that would show the same words in the small browser tooltip this replaces.
    // Stash's own `<h3 title>` slot is left empty.
    var h3 = row.querySelector ? row.querySelector('h3') : null;
    if (h3) tipTrigger(h3, row);
  }

  function tipSettings() {
    for (var k in DEFAULTS) {
      if (hasOwn(DEFAULTS, k)) tipSetting(k);
    }
  }

  // The group description is in the group *header*, which is outside the <Collapse>
  // - so it stays on screen at full height whether the group is expanded or not, and
  // per-plugin collapse does not shorten it. Hiding all but the first paragraph is
  // the only thing that does.
  //
  // A <button>, never a <span>: SettingGroup's onDivClick walks up from the event
  // target and returns early for `a` and `button`, so anything else folds the whole
  // group on click. A button is also the keyboard-reachable choice, which matters
  // more here than for the tooltips - this is the half of the description that has
  // nowhere else to be read. stopPropagation is belt and braces for a Stash that
  // changes that early return.
  function descCollapsed(sub) { return hasClass(sub, 'ptp2re-desc-collapsed'); }

  function setDescCollapsed(sub, on) {
    var cls = String(sub.className || '').replace(/\s*ptp2re-desc-collapsed\b/, '');
    sub.className = (on ? cls + ' ptp2re-desc-collapsed' : cls).replace(/^\s+/, '');
  }

  function collapseDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    var paras = 0;
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], 'ptp2re-p')) paras++;
    if (paras < 2) return;                        // one paragraph hides nothing
    if (document.getElementById(DESC_TOGGLE_ID)) return;
    // A re-render drops the button and the class together, so the description
    // returns to collapsed rather than to a half-state with no way out of it.
    setDescCollapsed(sub, true);
    var btn = el('button', 'ptp2re-desc-toggle', 'Show more');
    btn.id = DESC_TOGGLE_ID;
    btn.type = 'button';
    btn.addEventListener('click', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      var open = descCollapsed(sub);
      setDescCollapsed(sub, !open);
      btn.textContent = open ? 'Show less' : 'Show more';
    });
    sub.appendChild(btn);
  }

  // Re-added rather than tracked: React re-renders this panel whenever a setting
  // changes and drops anything we put in it, so the tick puts it back. Keyed on the
  // id, so a re-render that kept it does not produce a second one.
  //
  // Clicking the link does not fold the group: SettingGroup's onDivClick walks up
  // from the event target and returns early for `a` and `button`.
  // ── The stale-script banner ───────────────────────────────────────────────
  //
  // Stash serves plugin JS with caching on, so a browser holding the old file goes
  // on running it after an update and nothing on screen says so. The settings
  // heading is where the two numbers meet: Stash builds it as `${name} (${version})`
  // from the **manifest**, read fresh from the server, while `PLUGIN_VERSION` is what
  // this script actually is. A disagreement means the page is running code the
  // manifest has already replaced.
  //
  // No query for it - the number is on the page already, and this tick runs once a
  // second. `installedVersion` asks the server the same question, which is right for
  // a dialog that opens once and wrong for a timer.
  //
  // It catches only what a version bump makes visible; editing the file without
  // bumping leaves both numbers equal, which is the practical reason this repo bumps
  // the patch digit on every change.
  var STALE_ID = 'ptp2re-stale-notice';

  // The group's own h3, not a search of the page: the header row comes before the
  // setting rows, each of which has an h3 too, and the group is already ours. That
  // also keeps this working here, where the group is found by setting id rather than
  // by the heading text.
  function installedFromHeading(group) {
    var h3 = group && group.querySelector ? group.querySelector('h3') : null;
    var t = h3 ? String(h3.textContent == null ? '' : h3.textContent).trim() : '';
    var m = /\(([^()]+)\)$/.exec(t);
    return m ? m[1].replace(/^\s+|\s+$/g, '') : null;
  }

  // Above the description rather than under it: it is the first thing in the group
  // worth reading, and it leaves the README link's slot alone. Both sit in the group
  // header, outside Stash's <Collapse>, so a collapsed group still shows the banner.
  function staleSlot(group) {
    var sub = byClass(group, 'sub-heading');
    if (sub && sub.parentNode) return { parent: sub.parentNode, before: sub };
    return { parent: group, before: group.firstChild };
  }

  function ensureStaleNotice(group) {
    var installed = installedFromHeading(group);
    var node = document.getElementById(STALE_ID);
    // No parenthesised version on the heading means Settings → Tasks, which heads its
    // group with the bare name - not a mismatch, and nothing to say.
    if (!installed || installed === PLUGIN_VERSION) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    var slot = staleSlot(group);
    if (node && node.parentNode === slot.parent) return;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    var box = el('div', 'ptp2re-stale', '⚠ This page is still running ' +
      PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. ' +
      'Press Ctrl+Shift+R (⌘+Shift+R on a Mac) to reload it: your browser has cached ' +
      'the older script, and everything this plugin does until then is that older code.');
    box.id = STALE_ID;
    slot.parent.insertBefore(box, slot.before);
  }

  function ensureReadmeLink() {
    var group = ownSettingGroup();
    if (!group) return;
    // All of these run on every tick, not just when the link is missing: React
    // re-renders this panel on any settings change, and the class is the only thing
    // making the description's paragraph breaks visible.
    injectStyle();
    if (!hasClass(group, 'ptp2re-own-group')) {
      group.className = ((group.className || '') + ' ptp2re-own-group').replace(/^\s+/, '');
    }
    splitDescription(group);
    collapseDescription(group);   // after the split: it counts the .ptp2re-p divs
    tipSettings();
    ensureStaleNotice(group);     // before the early return: the link outlives it
    if (document.getElementById(README_LINK_ID)) return;
    var link = el('a', 'ptp2re-readme', 'PropagateTagsAndPerformers/README.md');
    link.id = README_LINK_ID;
    link.href = README_URL;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = 'Open this plugin\'s documentation';
    link.style = 'display:inline-block;margin-top:.35rem;font-size:.8rem;';
    var slot = readmeLinkSlot(group);
    slot.parent.insertBefore(link, slot.before);
  }

  // ── Plugin Task buttons ───────────────────────────────────────────────────
  //
  // Settings - Tasks - Plugin Tasks renders every task of every plugin with the same
  // `btn-secondary`, so nothing on that page says which buttons rewrite the library.
  // Repainting ours in the same amber as their page buttons is the whole change.
  //
  // `ownTaskName` decides what is ours - the same function the click interception
  // keys on, which checks the label *and* the enclosing group's heading, so another
  // plugin declaring a task by the same name is not repainted.
  //
  // Swapping Bootstrap's variant class rather than writing a colour: `btn-warning`
  // brings Stash's hover, focus and active states with it, which a background-color
  // of ours would have to restate and then keep in step with the theme.
  //
  // `btn-warning` is deliberately not in the strip list - it is what we add, and the
  // guard above returns before any of this once it is there.
  var BTN_VARIANTS = /\bbtn-(secondary|primary|success|info|light|dark|link)\b/g;

  function paintButton(btn, variant) {
    if (hasClass(btn, variant)) return;                        // already ours
    var cls = String(btn.className || '').replace(BTN_VARIANTS, '');
    btn.className = cls.replace(/\s+/g, ' ').replace(/^ | $/g, '') + ' ' + variant;
  }

  // Re-applied every tick rather than once: React re-renders this panel and hands
  // back a button with Stash's own classes, and `paintButton` is a no-op on one that
  // still carries ours.
  function paintTaskButtons() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('button') : [];
    for (var i = 0; i < nodes.length; i++) {
      var name = ownTaskName(nodes[i]);
      // Amber for the one that rewrites the library, teal for the one that only edits
      // a setting of ours - what that setting says is already amber on its own row.
      if (name) {
        paintButton(nodes[i], name === TASK_PROPAGATE_ALL
          ? PLUGIN_BTN_VARIANT : READONLY_BTN_VARIANT);
      }
    }
  }

  // ── The path setting's own row ────────────────────────────────────────────
  //
  // Stash renders a STRING setting as a value span and an Edit button that opens its
  // own one-line text modal. For thirteen `<path id>=<mode>` pairs that modal is a
  // place to make a typo in, so the row is taken over: the value is replaced by the
  // enabled paths in words, and Edit by a button opening the dialog that owns them.
  //
  // Four things worth knowing, all of them learnt in `NormalizeParentTags`:
  //
  //  - **Stash's own nodes are hidden, never removed.** React owns them and puts them
  //    back on the next re-render; removing one leaves the setting with no editor at
  //    all if this script ever stops running.
  //  - **Both are re-applied per tick**, because a re-render hands back Stash's own
  //    elements - the same reason `paintTaskButtons` repaints every tick.
  //  - **The value comes from the settings cache, not from the row.** The dialog saves
  //    with `configurePlugin` straight from `fetch`, which Stash's React state never
  //    hears about, so its own span would still show the old string. The cache is
  //    dropped by our fetch hook the moment that mutation lands, and the same hook
  //    calls this tick.
  //  - **The button is teal like its twin in Settings - Tasks.** Amber is for a control
  //    that rewrites the library; this one edits a setting, and what that setting says
  //    is already in amber underneath it.
  //
  // The canonical rewrite is here rather than in the dialog because a config file can
  // hold anything and Stash's own modal is still reachable if ours never builds. It
  // runs from the settings rather than from the row, and only once per distinct
  // string, so a save that fails cannot become a loop.
  var FIELD_LINE_ID = 'ptp2re-paths-line';
  var FIELD_BTN_ID  = 'ptp2re-paths-button';
  var _normalizedFrom = null;

  // The first button in a subtree that is not one of ours. Stash's row has exactly
  // one; ours carries `_ptp2reOwn`, so a second tick finds theirs rather than ours.
  function foreignButton(node) {
    if (!node) return null;
    if (node.tagName === 'BUTTON') return node._ptp2reOwn ? null : node;
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var found = foreignButton(kids[i]);
      if (found) return found;
    }
    return null;
  }

  function hide(node) {
    if (node && node.style) node.style.display = 'none';
  }

  function pathFieldTick() {
    var row = settingRow('b1Paths');
    if (!row) return;

    var line = document.getElementById(FIELD_LINE_ID);
    if (!line) {
      line = el('div', 'ptp2re-pathstring');
      line.id = FIELD_LINE_ID;
    }
    // Beside Stash's own value rather than inside it: React owns that subtree and
    // reconciles it on every re-render, and a node of ours in the middle of one is
    // the kind of thing that survives until it does not.
    // The row itself where Stash renders no value span, never its first child - which
    // on the second tick is the line we appended on the first, and appending a node
    // into itself is a HierarchyRequestError in a browser and a silent unlink here.
    var slot = byClass(row, 'value');
    var host = slot ? slot.parentNode : row;
    if (line.parentNode !== host) {
      if (slot) host.insertBefore(line, slot.nextSibling);
      else host.appendChild(line);
    }
    hide(slot);

    var btn = document.getElementById(FIELD_BTN_ID);
    if (!btn) {
      btn = el('button', 'btn btn-sm ' + READONLY_BTN_VARIANT, TASK_PATHS);
      btn.id = FIELD_BTN_ID;
      btn.type = 'button';
      btn._ptp2reOwn = true;
      btn.addEventListener('click', function (e) {
        if (e.preventDefault) e.preventDefault();
        startRun(TASK_PATHS);
      });
    }
    var edit = foreignButton(row);
    var btnHost = edit ? edit.parentNode : row;
    if (btn.parentNode !== btnHost) btnHost.appendChild(btn);
    hide(edit);

    if (!_autoSettings) {
      // Drawn when the answer lands rather than on the next tick: the re-entry is
      // bounded by the cache it just filled, and a second of an empty line where the
      // value used to be is exactly the flicker this replacement must not have.
      if (!_autoSettingsWait) {
        autoSettings().then(function () { pathFieldTick(); }, function () {});
      }
      return;
    }

    var modes = _autoSettings.paths, canon = formatPaths(modes);
    // Redrawn only when the value moves: this runs every second, and rebuilding the
    // list under the user's pointer for an unchanged value is churn.
    var raw = String(_autoSettings.b1Paths || '');
    if (line._ptp2reText !== canon + '\u0000' + raw) {
      line._ptp2reText = canon + '\u0000' + raw;
      renderPathString(line, modes, raw);
    }
    if (_savingPaths || !raw.replace(/^\s+|\s+$/g, '')) return;
    if (raw === canon || raw === _normalizedFrom) return;
    // **Never write nothing over something, and never write away a pair this script
    // could not read.** The rewrite is a convenience for a hand-typed value; a value
    // it does not fully understand is one where "canonical form" means "the half I
    // recognised", and writing that deletes the rest with no way back. A newer
    // release's path id is exactly that case, and so is a typo - the difference is
    // invisible from here, and only one of the two is safe to act on.
    if (!canon || unrecognisedPairs(raw) > 0) {
      _normalizedFrom = raw;
      ptp2re('[ptp2re] the stored path setting is not one this script fully understands ' +
        '("' + raw + '"), so it is left exactly as it is. Nothing is copied along a path ' +
        'it could not read; open Path Settings to set them again, or check whether the ' +
        'script running here is older than the plugin installed.');
      return;
    }
    _normalizedFrom = raw;
    savePaths(canon).then(null, function () {});
  }

  function settingsTick() {
    ensureReadmeLink();
    paintTaskButtons();
    pathFieldTick();
  }

  // No MutationObserver here, unlike a button injection: this is decoration in a
  // settings panel, not something that has to land before the user can click it, and
  // a second of delay after a re-render costs nothing. The timer plus the navigation
  // hooks are enough, and they cannot fight a React re-render.
  if (window.addEventListener) {
    window.addEventListener('load', settingsTick);
    window.addEventListener('popstate', function () { setTimeout(settingsTick, 300); });
  }
  document.addEventListener('click', function () {
    setTimeout(settingsTick, 0);
    setTimeout(settingsTick, 300);
  }, true);
  setInterval(settingsTick, 1000);
  settingsTick();

  // ── Manual buttons: one per enabled path, on the target's edit page ────────
  //
  // D8 of the design plan. One button per enabled path whose target is the page
  // being viewed - `Tags: Performers → Scenes` shows "Add Perf Tags" on a scene's
  // Edit tab, and a scene with five enabled paths shows five small buttons rather
  // than one that tries to name all of them. `path.button` is already the label;
  // nothing here invents a second copy of it.
  //
  // Placement could not be settled from notes alone (see D8's own caveat) and needs
  // exercising in a real Stash: `.edit-buttons` is the one container name this repo
  // has actually confirmed, on the scene page (MergePerformerTagsToScenes' own
  // "Add Perf Tags" button uses it), and this reuses it unverified for the other
  // three pages, on the working assumption that Stash builds every entity's edit
  // panel from the same button-row component. If a page does not in fact have one,
  // this plugin's buttons simply do not appear there - the same failure mode as a
  // missing route.
  //
  // Reuses the auto mode machinery wholesale rather than a third planner: `AutoRun`
  // already plans a *named* set of ids without paging the library, which is exactly
  // what one entity is. The only thing a click adds is where the result goes -
  // `run.apply()` unchanged for "save immediately", or pushed into a captured form
  // control for staging.

  // Which of the four target pages is showing, from the route alone - reusing each
  // TARGETS entry's own `route` regex rather than a second copy of the four patterns.
  function currentRouteTarget() {
    for (var key in TARGETS) {
      if (!hasOwn(TARGETS, key)) continue;
      var m = TARGETS[key].route.exec(location.pathname);
      if (m) return { target: key, id: m[1] };
    }
    return null;
  }

  // ── Staging: capturing TagSelect and PerformerSelect ────────────────────────
  //
  // Same trick as MergePerformerTagsToScenes' own TagSelect capture, generalised to
  // a second component and keyed by the route's (target, id) rather than a scene id,
  // since this plugin's targets are four pages, not one.
  var _tagCaptures = [], _perfCaptures = [];
  var SELECT_CAPTURE_LIMIT = 10;

  function captureSelect(list, props) {
    if (!props || !props.isMulti || typeof props.onSelect !== 'function') return;
    var rt = currentRouteTarget();
    list.push({ props: props, target: rt && rt.target, id: rt && rt.id, values: props.values || [] });
    if (list.length > SELECT_CAPTURE_LIMIT) list.shift();
  }

  // Patches have to be registered before the components they target first render,
  // so this runs at script load; the load-event retry only covers Stash setting
  // window.PluginApi later than usual.
  // Whether staging is possible at all on this Stash. Read by `runManual`, which saves
  // rather than staging when it is false.
  var _selectPatchesInstalled = false;

  function installSelectPatches() {
    var api = window.PluginApi;
    if (!api || !api.patch || typeof api.patch.before !== 'function') return false;
    try {
      api.patch.before('TagSelect', function (props) { captureSelect(_tagCaptures, props); return [props]; });
      api.patch.before('PerformerSelect', function (props) { captureSelect(_perfCaptures, props); return [props]; });
      _selectPatchesInstalled = true;
      return true;
    } catch (e) {
      console.warn('[ptp2re] could not patch TagSelect/PerformerSelect:', e);
      return false;
    }
  }

  // Said once, and again if the user turns "save immediately" off and back on. Without
  // it the only symptom is a button that saves when the setting says it should stage,
  // which reads as the setting not working.
  var _warnedNoStaging = false;
  function warnNoStagingOnce(s) {
    if (s.a2SaveImmediately || _selectPatchesInstalled) { _warnedNoStaging = false; return; }
    if (_warnedNoStaging) return;
    _warnedNoStaging = true;
    console.warn('[ptp2re] staging is unavailable - this Stash does not expose PluginApi ' +
      'component patching, so the manual buttons will copy and save directly.');
  }

  function idsOf(items) {
    return (items || []).map(function (t) { return String(t.id); }).sort().join(',');
  }

  // TagSelect and PerformerSelect are used all over Stash, so pick the capture
  // belonging to this page: newest first, preferring one whose contents match what
  // the control is expected to hold. Matching on expectedIds rather than the
  // server's values is what makes a second click see the already-staged list; the
  // server's tags would keep re-selecting the stale pre-staging capture and report
  // the same count every time. If nothing matches (hand-edited box) the newest
  // capture is the right answer anyway.
  function findControl(list, target, id, expectedIds) {
    var wanted = expectedIds ? expectedIds.slice().sort().join(',') : null;
    var newest = null;
    for (var i = list.length - 1; i >= 0; i--) {
      var c = list[i];
      if (c.target !== target || c.id !== id) continue;
      if (!newest) newest = c;
      if (wanted !== null && idsOf(c.values) === wanted) return c;
    }
    return newest;
  }

  // What each control is expected to be holding, one per kind since a page can
  // stage tags and performers in the same click (a scene has both).
  var _stagedTags = { target: null, id: null, ids: null };
  var _stagedPerfs = { target: null, id: null, ids: null };

  // Pushes one plan entry's additions into its control, diffed against the form
  // rather than the server so a hand-added or hand-removed item survives and a
  // second click without saving reports nothing added. Throws if the control was
  // never captured, which reads to the user as "open the Edit tab first".
  function stageEntry(list, staged, setStaged, target, id, addIds, makeItem) {
    var expected = (staged.target === target && staged.id === id) ? staged.ids : null;
    var control = findControl(list, target, id, expected);
    if (!control) throw new Error('could not find the form control - open the Edit tab first');
    var current = control.values || [];
    var have = {};
    current.forEach(function (t) { have[String(t.id)] = true; });
    var added = addIds.filter(function (aid) { return !have[aid]; }).map(makeItem);
    if (!added.length) return 0;
    var next = current.concat(added);
    control.props.onSelect(next);
    control.values = next;
    setStaged({ target: target, id: id, ids: next.map(function (t) { return String(t.id); }) });
    return added.length;
  }

  // Every plan entry for this one entity, staged into whichever control its kind
  // uses. Names come from what `AutoRun` already gathered while planning - the tag
  // hierarchy's `tagMap` and the performer names carried on any performers-kind
  // path's payload - so staging costs no query of its own.
  function applyPlanToForm(target, id, plan, tagMap, performerNames) {
    var total = 0;
    plan.forEach(function (entry) {
      if (entry.target !== target || entry.id !== id || !entry.add.length) return;
      if (entry.kind === 'tags') {
        total += stageEntry(_tagCaptures, _stagedTags, function (v) { _stagedTags = v; },
          target, id, entry.add, function (tid) {
            return { id: tid, name: tagName(tagMap, tid) || ('tag ' + tid), aliases: [], image_path: null };
          });
      } else {
        total += stageEntry(_perfCaptures, _stagedPerfs, function (v) { _stagedPerfs = v; },
          target, id, entry.add, function (pid) {
            return { id: pid, name: (performerNames && performerNames[pid]) || ('performer ' + pid) };
          });
      }
    });
    return total;
  }

  // ── The click: stage one entity, or open the review dialog on it ────────────
  //
  // **Just the path whose button was clicked**, never every enabled path into this
  // target. That is what the button says it does - `manualButtonTitle` names one path,
  // the caption names one source, and the setting description promises "one button per
  // path". `runManualSource` had this right from the start and carries the same note;
  // this side did not, so on a scene with both the performer and studio paths enabled,
  // "Add all Tags from all Performers" also copied the studio's tags. It also made
  // this plugin's button silently wider than `MergePerformerTagsToScenes`' identically
  // labelled one, which copies performer tags and nothing else.
  //
  // **Nothing here writes.** The "save immediately" branch used to call
  // `run.apply()` on the spot, which was the one thing in this plugin a user could
  // trigger with no plan in front of them - the task has a dialog, the auto modes are
  // opted into per path, and this had neither. It now opens the same dialog the task
  // does, scoped to the one entity and the one path (`Run`'s `scope`), so every write
  // this plugin makes on purpose is either reviewed or staged.
  function runManual(path, target, id, label) {
    return autoSettings().then(function (s) {
      // Re-read rather than trusted: a path can be switched off between the tick that
      // drew the button and the click on it.
      if (!pathOn(s, path)) throw new Error('that path is no longer enabled');
      // Staging needs PluginApi's component patching. Where that is missing the click
      // reviews instead, because the user never opted into a blind write - they opted
      // into the button, and this is the closest thing their Stash can support. The
      // sibling has made the same trade since it grew staging; without it the click
      // ends in an alert about a form control on a Stash that was never going to have
      // one.
      warnNoStagingOnce(s);
      if (savesImmediately(s)) {
        // Nothing to stage into, so the review moves into the dialog: it plans this one
        // entity along this one path, lists every change, and writes nothing until
        // Proceed - with Copy log, Rescan and Undo where the task has them. This is
        // what the "..." on the caption promises.
        return scopeLabel(target, id).then(function (what) {
          startRun(stripEllipsis(label) + ' - for ' + what,
            { pathId: path.id, target: target, ids: [String(id)] });
          return { mode: 'dialog', count: 0 };
        });
      }
      // `guarded()` around the staging path for the same reason auto mode needs it -
      // it is only the writing branch that matters, and the dialog guards its own.
      return guarded(function () {
        return autoContext(s).then(function (ctx) {
          var run = new AutoRun(s, ctx.tagMap, ctx.filters);
          return run.planEntities(target, [path], [String(id)]).then(function () {
            var count = applyPlanToForm(target, String(id), run.plan, run.tagMap, run.performerNames);
            return { mode: 'staged', count: count };
          });
        });
      });
    });
  }

  // ── The buttons themselves ───────────────────────────────────────────────────

  var MANUAL_BTN_CLASS = 'ptp2re-manual-btn';
  var FLASH_MS = 1500;

  function manualButtonId(path) {
    return 'ptp2re-mbtn-' + path.id.replace(/[^a-zA-Z0-9]+/g, '-');
  }

  function clearManualButtons() {
    (document.querySelectorAll('.' + MANUAL_BTN_CLASS) || []).forEach(function (b) {
      if (b.parentNode) b.parentNode.removeChild(b);
    });
  }

  function manualButtonTitle(path, immediate) {
    return pathLabel(path) + (immediate
      ? ' - opens a dialog listing every change first; nothing is written until you press Proceed.'
      : ' - stages into the form for review; you still press Save.');
  }

  function buildManualButton(path, label, target, id, immediate) {
    // Deliberately not the shared `button()` helper: that carries `btn-sm`, sized for
    // the dialog's own footer. Stash's own Save/Delete and MergePerformerTagsToScenes'
    // on-page buttons all carry plain `btn btn-secondary` with no size modifier, so a
    // `btn-sm` button beside them reads smaller in both height and font-size - not the
    // row-dependent stretch below, a flat difference present on every row.
    // No vertical margin here on purpose - see `ensureRowSpacing` below for why a
    // wrapped row's spacing comes from the container, not this button's own margin box.
    // No horizontal one either: `applyButtonSpacing` copies the
    // row's own margins inline, and a Bootstrap `mx-*` class is `!important`, so a
    // spacing class here would outrank them. It adds `mx-1` back itself when there is
    // nothing to copy.
    var btn = el('button', 'btn ' + PLUGIN_BTN_VARIANT + ' ' + MANUAL_BTN_CLASS, label);
    btn.type = 'button';
    btn.id = manualButtonId(path);
    btn._coopOwner = PLUGIN_ID; // read by `insertOrdered`'s cross-plugin priority scan
    btn._ptp2reEntityId = id;
    // The resolved label, held apart from `textContent` because the click handler
    // below overwrites that with "Working..."/"Added N" while a click is in flight -
    // comparing live `textContent` against a freshly resolved label would catch the
    // button mid-flash and rebuild it, cutting the flash short.
    btn._ptp2reLabel = label;
    btn.title = manualButtonTitle(path, immediate);
    // The container is a flex row, and its default `align-items: stretch` makes any
    // child sitting beside a taller sibling stretch to match it. A button that wraps
    // to its own row, with nothing tall beside it, keeps its natural height instead -
    // the same button rendering two different heights purely by which row it landed
    // on. `align-self` opts every one of ours out of that per-row inheritance, so they
    // are consistently sized regardless of what else is sharing the row.
    btn.style = 'align-self:flex-start;';
    btn.addEventListener('click', function (event) {
      if (event && event.preventDefault) event.preventDefault();
      var orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Working...';
      runManual(path, target, id, label).then(function (result) {
        btn.disabled = false;
        // The dialog is now the feedback, and it is on top of this button - a flash
        // underneath it would be a caption nobody can see, restored two seconds into a
        // review that may take minutes.
        if (result.mode === 'dialog') { btn.textContent = orig; return; }
        btn.textContent = result.count ? ('Added ' + result.count) : 'No changes';
        // Only the staging branch reaches here, and it changes nothing on
        // the server - so the caption is restored and nothing is re-probed. A dialog's
        // writes invalidate from `Run.close`, where the eligibility they changed is
        // finally settled.
        setTimeout(function () { btn.textContent = orig; }, FLASH_MS);
      }, function (err) {
        btn.disabled = false;
        btn.textContent = orig;
        console.error('[ptp2re]', err);
        alert('Error: ' + (err && err.message ? err.message : err));
      });
    });
    return btn;
  }

  // Where the buttons go. `.edit-buttons` is Scene's own row, confirmed live - both
  // MergePerformerTagsToScenes' own scene button and this plugin's use it. Every
  // other page checked so far (Group, confirmed live; Performer, per
  // MergePerformerTagsToScenes' own container-finding code) renders its edit form
  // inside `.details-edit` instead, a container Stash swaps between two states: a
  // detail-view navbar carrying a Delete button, and the edit form itself carrying
  // Cancel/Save in its place. We want the edit-form instance, so - the opposite
  // filter from MergePerformerTagsToScenes' performer button, which wants the
  // *other* one - skip any `.details-edit` that carries a Delete button.
  function findManualButtonContainer() {
    var c = document.querySelector('.edit-buttons');
    if (c) return c;
    var candidates = document.querySelectorAll('.details-edit');
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i].querySelector('button.delete')) return candidates[i];
    }
    return null;
  }

  // Deterministic ordering between plugins sharing this row (repo-root CLAUDE.md,
  // "Cross-plugin cooperation: deterministic button ordering"). Both this plugin's
  // and MergePerformerTagsToScenes' `insertBeforeImportantAction` used to always
  // insert immediately before their anchor, so with both enabled, whichever plugin's
  // async eligibility check happened to resolve last ended up closest to it - a race
  // decided by network timing, not a rule, and it could flip on every reload.
  // `coop().order` fixes a priority per plugin id; a button already sitting there
  // and owned by a higher-priority plugin is skipped over rather than displaced, so
  // this plugin's own button always lands on the low-priority side of it regardless
  // of which plugin inserted first. `anchor` may be null (neither Delete nor Save
  // found - see `insertBeforeImportantAction` below), in which case there is
  // nothing to order against.
  function insertOrdered(container, button, anchor) {
    if (!anchor) { container.appendChild(button); return; }
    var order = coop().order;
    var myPriority = order[PLUGIN_ID] || 0;
    var ref = anchor;
    var scan = anchor.previousSibling;
    while (scan) {
      var ownerPriority = scan._coopOwner ? (order[scan._coopOwner] || 0) : null;
      if (ownerPriority === null || ownerPriority <= myPriority) break;
      ref = scan;
      scan = scan.previousSibling;
    }
    container.insertBefore(button, ref);
  }

  // A plain recursive walk over `childNodes`/`tagName`, matching on the action's own
  // text - the same technique `foreignButtonAlreadyShows` already relies on for
  // dedup, and deliberately not `querySelectorAll`, which the shared test harness's
  // fake DOM nodes do not implement (only `querySelector`). Text is the only
  // reliable way to find Save, which carries no distinguishing class, and the only
  // reliable way to find Delete either, on the rows where it carries no `.delete`.
  //
  // Matches `<a>` as well as `<button>`, and trims before comparing. Stash styles
  // some row actions as links rather than buttons, and neither the tag nor the
  // surrounding whitespace is something this plugin should have to be right about:
  // the cost of accepting both is nil, and the cost of guessing wrong is a button
  // silently landing in the wrong place, which is exactly the bug the text search fixes.
  function findActionByLabel(root, label) {
    var kids = root.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if ((k.tagName === 'BUTTON' || k.tagName === 'A') &&
          (k.textContent || '').trim() === label) return k;
      var found = findActionByLabel(k, label);
      if (found) return found;
    }
    return null;
  }

  // Shared by both the target and source sides. The design
  // rule, stated plainly: a new button is inserted before whichever of the row's
  // buttons is "important" - one that must stay the last thing in the row, because
  // moving it would be a bigger surprise than where our own button lands - and
  // appended after everything otherwise. Delete and Save are the two buttons this
  // plugin has ever found itself sharing a row with that qualify; a page whose
  // trailing button is neither (a plain secondary action, or nothing at all) gets a
  // plain append, which is also what happens if this plugin is ever wrong about
  // what counts as important on some future page - a safe default in either
  // direction, since it never displaces a button this code did not recognise.
  //
  // Three searches, in order: Delete by its `.delete` class, Delete by its text,
  // then Save by its text. Any of them may be nested inside a wrapper element, so
  // the walk-up to the container's own direct child happens after the search, not
  // baked into any of them.
  //
  // The middle search is the whole fix. This looked for Delete *only* by `.delete`,
  // on the strength of a note in the
  // repo CLAUDE.md that said Stash gives Delete that class "throughout". It does
  // not. It carries it on the detail-view navbar - which is where the claim was
  // actually confirmed, and where `findDetailContainer` and `findManualButtonContainer`
  // both still rely on it to tell a navbar from an edit form - but the Scene edit
  // row renders Delete as `btn btn-danger` with no `.delete` at all. On that row the
  // class search found nothing, the Save fallback caught it, and every button landed
  // *before* Save instead of between Save and Delete.
  //
  // That one over-generalisation is worth naming, because it cost four rounds of
  // anchor churn that all moved the anchor between Save and Delete
  // without ever fixing the reason Delete could not be found:
  //   - collapsing to Delete-only, since "between Save and Delete" was what live
  //     feedback asked for and Delete alone produces that whenever both exist;
  //   - then restoring the Save fallback, because Group's edit form has no Delete
  //     and a plain append had put a button *after* Save.
  // Both were reasoning about which anchor to prefer. Neither noticed the class
  // search was failing on the very row being tested. A class confirmed on one page
  // is evidence about that page.
  function insertBeforeImportantAction(container, button) {
    var node = container.querySelector('button.delete')
            || findActionByLabel(container, 'Delete')
            || findActionByLabel(container, 'Save');
    while (node && node.parentNode !== container) node = node.parentNode;
    insertOrdered(container, button, node);
    // After insertion, not in the builder: the margins are copied off a sibling, so
    // they cannot be known until the button has a container to be a sibling in.
    applyButtonSpacing(container, button);
  }

  // Spacing a wrapped row against the one above it with `my-1` on the button itself
  // was live-tested as a regression: `.edit-buttons`/`.details-edit` are
  // flex rows with the default `align-items: stretch`, and a flex line's own height
  // is the tallest *margin box* sharing it - so a button's own vertical margin
  // inflates the line Stash's Save/Delete sit on too, and stretch then grows them to
  // match. The button opts itself out of stretching via `align-self` above, but that
  // does not shrink the line back down - Stash's buttons visibly grew taller and,
  // where the container re-renders often enough, visibly jittered as they did.
  // `row-gap` is a property of the container, not any one item, and inserts space
  // *between* flex lines without feeding into either line's own cross-size
  // calculation - so it gets the same wrapped-row spacing with no stretch to leak
  // into a line that already had everything it needs.
  // `row-gap` only ever worked on half the pages, and the measurement that proved it
  // is worth keeping. On a live Stash `.edit-buttons` computes to
  // **`display: block`** - not a flex row at all - so `row-gap` there is inert and
  // wrapped rows sat flush against each other, while Group's `.details-edit`, which
  // *is* flex, spaced correctly from the identical call. Same code, same value,
  // opposite result, decided entirely by the container.
  //
  // So the container is asked which it is, and gets the mechanism that works there:
  // `row-gap` where it is honoured, and a bottom margin on our own buttons where it
  // is not. The margin is safe in a block container for exactly the reason it is
  // unsafe in a flex one - that regression was a flex line taking its
  // cross-size from the tallest *margin box* on it and stretching Stash's own buttons
  // to match. A block container has no flex line; an inline-block's margin box feeds
  // the line box, which is the spacing we are after.
  var ROW_GAP = '.25rem';
  // The horizontal fallback, applied by `applyButtonSpacing` and *only* on the branch
  // that has nothing to measure. It is deliberately not on the button at build time:
  // Bootstrap's spacing utilities carry `!important`, so a class here outranks the
  // inline margins copied off the row and the measurement never reaches the page.
  var SPACING_CLASS = 'mx-1';

  function computedStyleOf(node) {
    var w = (typeof window !== 'undefined') ? window : null;
    if (!w || typeof w.getComputedStyle !== 'function' || !node) return null;
    try { return w.getComputedStyle(node) || null; } catch (e) { return null; }
  }

  function ensureRowSpacing(container) {
    if (!container) return;
    // A real element's `.style` is always a live CSSStyleDeclaration, never absent -
    // this guard only ever fires in the test harness, whose fake elements have no
    // `.style` until something sets one.
    if (!container.style) container.style = {};
    var cs = computedStyleOf(container);
    var display = (cs && cs.display) || '';
    // Unknown display (no `getComputedStyle` at all) keeps the flex treatment: it is
    // the one that cannot make a row *worse*, since an inert `row-gap` is exactly
    // what shipped for three versions.
    var flexish = !display || display.indexOf('flex') !== -1 || display.indexOf('grid') !== -1;
    container._ptp2reBlockRow = !flexish;
    container.style.rowGap = flexish ? ROW_GAP : '';
  }

  // The horizontal half, and the reason it is measured rather than chosen. Stash's
  // own buttons in `.edit-buttons` compute to `margin: 0 10px 0 0` - a *right* margin
  // only, and 10px is not a step in the spacing scale either plugin's utility classes
  // can name (at this Stash's 14px root, `mx-1` is 3.5px and `mx-2` is 7px). Our own
  // `mx-1` therefore produced a different gap on every boundary: 13.5px after Save,
  // 7px between two of ours, 3.5px before Delete.
  //
  // Rather than guess a fourth value, copy the row's own: find a button Stash put
  // there - one with no `_coopOwner`, so neither plugin's buttons can be mistaken for
  // Stash's - and take its computed margins. Every boundary in the row then matches,
  // and it self-calibrates to a container whose convention has never been measured
  // from here. Falling back to the utility class when there is nothing to copy is the
  // safe direction: it is what shipped.
  // The donor does not have to be a `<button>`. Stash styles some row actions as links
  // - the same fact the anchor search absorbs, Delete being an `<a>` on the Scene edit
  // row - so a row whose actions are all links would have no donor at all and would
  // fall back to the utility class. What identifies a donor is the `btn` class plus the
  // absence of `_coopOwner`: styled like a row action, and not put there by a plugin
  // that reads this registry.
  function stashButtonMargins(container) {
    var kids = container.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k._coopOwner || !hasClass(k, 'btn')) continue;
      var cs = computedStyleOf(k);
      if (!cs) return null;
      // A *positive* test, not "not 0px": a style engine with no stylesheet loaded
      // reports the empty string rather than `0px`, which the inequality read as a
      // margin worth copying and then applied as `margin-left:;` - nothing at all,
      // with the class fallback already skipped. Caught by jsdom in the placement
      // suite, where no Bootstrap is loaded; a live Stash always computes to a length.
      if (nonZeroLength(cs.marginLeft) || nonZeroLength(cs.marginRight)) {
        return { left: cs.marginLeft || '0px', right: cs.marginRight || '0px' };
      }
    }
    return null;
  }

  function nonZeroLength(value) {
    return !!value && value !== 'normal' && parseFloat(value) > 0;
  }

  function pxOf(value) {
    var n = parseFloat(value);
    return n > 0 ? n : 0;
  }

  // The index of our button among the container's children, read once from a single
  // `childNodes` snapshot: a real `NodeList` is live, and this repo's own test harness
  // models one that is rebuilt on every read, which was once a bug here.
  function childIndex(kids, button) {
    for (var i = 0; i < kids.length; i++) { if (kids[i] === button) return i; }
    return -1;
  }

  // The element whose margin actually borders ours. A row's DOM siblings are not all
  // row actions: React wraps some of them (a file input beside its button, a dropdown
  // beside its toggle), and a wrapper carries no margin of its own while the action
  // inside it does. Reading the wrapper therefore reports "contributes nothing" for a
  // neighbour that plainly contributes a gap - which is what doubled the space before
  // our first button on Group's two pages and nowhere else. This fixes
  // Group's *edit* row; its detail row needs `neighbourGap` to walk past the
  // element entirely.
  //
  // `fromEnd` picks which end of a wrapper faces us: the last action inside the element
  // before ours, the first inside the element after. An element that is itself an action
  // is returned as-is; one holding no action anywhere inside returns null, which is the
  // signal `neighbourGap` walks on rather than trusting the element's own margin.
  function borderingAction(node, fromEnd) {
    if (!node) return null;
    if (hasClass(node, 'btn')) return node;
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[fromEnd ? kids.length - 1 - i : i];
      if (!k || !k.tagName) continue;
      var found = borderingAction(k, fromEnd);
      if (found) return found;
    }
    return null;
  }

  // What already separates our button from the nearest *action* on one side, walking
  // outward from it rather than stopping at the first DOM sibling. It resolves
  // *through* a wrapper to the action inside it, and also walks *past* an element
  // holding no action at all, because the two are the same mistake one step apart:
  // **a zero read off something this code cannot identify as an action is not evidence
  // of a zero gap.** Group's detail row is the case - the element before our first
  // button holds nothing we recognise, so its (absent) margin was being taken for the
  // whole gap and the real one doubled on top of it.
  //
  // Returns one of three answers, and the caller treats them differently:
  //   { gap: n }      an action was found, n px away - top our margin up to the step.
  //   { gap: null }   elements are there but nothing recognisable - add nothing. We
  //                   have no idea what space they occupy, and a wrong guess here is
  //                   what doubles a gap.
  //   null            nothing at all on this side - fall back to Stash's own margin.
  //
  // Skipped elements contribute both their margins to the total and are assumed to have
  // no width of their own; a zero-width slot is what an unrecognised element in a button
  // row usually is, and width is the one thing here that cannot be read without
  // consulting a layout that has not settled yet.
  function neighbourGap(container, button, forward) {
    var kids = container.childNodes || [];
    var idx = childIndex(kids, button);
    if (idx === -1) return null;
    var near = forward ? 'marginLeft' : 'marginRight';
    var far = forward ? 'marginRight' : 'marginLeft';
    var step = forward ? 1 : -1;
    var total = 0, seen = false;
    for (var i = idx + step; i >= 0 && i < kids.length; i += step) {
      var k = kids[i];
      if (!k || !k.tagName) continue;
      seen = true;
      var cs = computedStyleOf(k);
      total += pxOf(cs && cs[near]);
      var action = borderingAction(k, !forward);
      if (action) {
        // A wrapper with a margin *and* an inset button is rare, but summing the two is
        // closer to the truth than picking one, and both are usually zero.
        if (action !== k) total += pxOf((computedStyleOf(action) || {})[near]);
        return { gap: total };
      }
      total += pxOf(cs && cs[far]);
    }
    return seen ? { gap: null } : null;
  }

  function sideMargin(info, step, own) {
    if (!info) return pxOf(own);
    if (info.gap === null) return 0;
    return Math.max(0, step - info.gap);
  }

  // The gap between two inline siblings is the first's right margin plus the
  // second's left margin, so what our button needs on a given side depends on what its
  // neighbour already contributes - not on what one donor button happens to carry.
  // Copying the donor's margins wholesale gave every button of ours
  // `margin-left: 0`, which is correct on a row where every button carries a right
  // margin - Scene's `.edit-buttons`, where it is also what keeps a wrapped second row
  // flush with the first - and wrong on a row where they do not. Stash's own detail
  // navbars are inconsistently spaced: `Auto tag...` and `Merge` touch each other on
  // Performer, and landing after one of the marginless ones left our button touching it
  // too, which is what live use reported.
  //
  // Measuring that contribution with `getBoundingClientRect` instead of deriving it
  // was tried, on the reasoning that a gap is a distance and a margin is only one of
  // the things that can produce one. It is out again, because a distance is
  // also a fact about one instant: the row it was measured in is not the row the user
  // ends up looking at. It went wrong in both directions at once, live - our button
  // landed *touching* Delete on every `.details-edit` page (a gap measured at insertion
  // time that the row had closed by the time it settled) while Group, the page the
  // measurement existed for, did not change at all (the element before ours had no
  // width, so there was nothing to measure and it fell back to the margin anyway).
  //
  // That second half is the actual diagnosis, and it is structural rather than a matter
  // of timing: **the DOM sibling beside our button is not always the action the user
  // sees**. `neighbourGap` resolves through a wrapper to the action inside it and past
  // an element that holds no action at all, so the margin read is the one that actually
  // borders us. No layout is consulted; the answer is the same whenever it is asked.
  function fillNeighbourGaps(container, button, m) {
    var step = Math.max(pxOf(m.left), pxOf(m.right));
    // Nothing on a side means our button is at that end of the row, where Stash's own
    // convention is the whole answer: `margin: 0 10px 0 0`, so no left margin to push it
    // off the edge its first button sits on, and a right margin to trail the last.
    return [
      'margin-left:' + sideMargin(neighbourGap(container, button, false), step, m.left) + 'px',
      'margin-right:' + sideMargin(neighbourGap(container, button, true), step, m.right) + 'px'
    ];
  }

  // Rebuilt as one `cssText` assignment rather than property-by-property, matching how
  // the button builders already set `align-self` - and so the whole inline style stays
  // one readable string in the DOM inspector while chasing a placement bug.
  //
  // This is what makes the measurement above actually reach the page, and the reason
  // it would not otherwise is worth stating: **Bootstrap's spacing utilities are
  // `!important`**. `mx-1` on our own button therefore beats the inline `margin-left` /
  // `margin-right` set from the row's own convention - so every horizontal gap
  // stays exactly what it was, while `margin-bottom` (which no class sets) takes
  // effect and visibly fixes the wrapped-row spacing. A fix that
  // works in one axis and not the other, from one `cssText` assignment, is the shape of
  // a specificity problem rather than a wrong value.
  //
  // So the class is no longer on the button at build time; it is added back here, and
  // only on the branch that still needs it. Three cases, in order:
  //   1. The container spaces its own children with `column-gap` - our button gets it
  //      too, so any margin of ours is *added* to Stash's spacing rather than matching
  //      it. Nothing to apply.
  //   2. A donor exists - take the row's own spacing step from it and fill whatever
  //      each neighbour is not already contributing (`fillNeighbourGaps`), leaving the
  //      class off so the inline margins are not outranked.
  //   3. Neither - restore `mx-1`, which is what shipped before any of this.
  function applyButtonSpacing(container, button) {
    var parts = ['align-self:flex-start'];
    var cs = computedStyleOf(container);
    if (!cs || !nonZeroLength(cs.columnGap)) {
      var m = stashButtonMargins(container);
      if (m) parts = parts.concat(fillNeighbourGaps(container, button, m));
      else if (!hasClass(button, SPACING_CLASS)) button.className += ' ' + SPACING_CLASS;
    }
    if (container._ptp2reBlockRow) parts.push('margin-bottom:' + ROW_GAP);
    button.style = parts.join(';') + ';';
  }

  // Whether some *other* loaded plugin declares this same path - the `declares`
  // registry from step 7, read here for the first time by anything other than the
  // task dialog's log line.
  function otherPluginDeclaresPath(pathId) {
    var declares = coop().declares;
    for (var id in declares) {
      if (!hasOwn(declares, id) || id === PLUGIN_ID) continue;
      if ((declares[id] || []).indexOf(pathId) !== -1) return true;
    }
    return false;
  }

  // Whether a button for that path is already sitting in the container, placed by
  // someone else. `declares` alone is not enough to act on: it says another plugin
  // *can* cover this path, not that its button is showing right now - that plugin's
  // own manual-button setting could just as easily be off, in which case deferring
  // to it would leave neither button on the page. Matching on the exact label text
  // is the ground truth instead, and it needs no knowledge of the other plugin's
  // class names or settings: `path.button` is the same string a user would
  // recognise as "this one" regardless of which plugin put it there, which is what
  // makes two plugins doing the identical path call it the same thing worth relying
  // on. A match on any button of *ours* does not count, so this never mistakes one
  // we added on an earlier tick for someone else's.
  //
  // **"Ours" has to mean both classes.** This helper is shared verbatim by
  // `manualButtonsTick` and `manualSourceButtonsTick`, and it once excluded only
  // `MANUAL_BTN_CLASS` - the target side's. On the source side our own button
  // therefore matched its own label, which made the plugin conclude a foreign button
  // was showing and drop the path. That shrank `paths`, which changed `pathIdsKey`,
  // which re-armed the existence probe, which cleared every source button while it
  // was pending - and with the button gone the next tick saw no match, restored the
  // path, and started the whole cycle again. The visible result was a source button
  // blinking once a second, live-reported on a detail page. It bites only where
  // another plugin declares the same path (`tags:performer>scene`, the one
  // `MergePerformerTagsToScenes` declares) *and* that plugin is not currently showing
  // its own button - if it were, the match would be genuine and the path would stay
  // dropped, which is why this survived every test and the target side never showed it.
  function foreignButtonAlreadyShows(container, label) {
    var kids = Array.prototype.slice.call(container.childNodes || []);
    for (var i = 0; i < kids.length; i++) {
      if (hasClass(kids[i], MANUAL_BTN_CLASS) || hasClass(kids[i], MANUAL_SRC_BTN_CLASS)) continue;
      if (sameButtonLabel(kids[i].textContent, label)) return true;
    }
    return false;
  }

  // Whether each of `paths` would actually add anything to this one entity.
  //
  // This is eligibility gating rather than existence gating, and the reason it can be
  // is that the answer was already being computed and thrown away.
  // `planEntities` fetches the target through `oneQuery`, whose `targetParts` carries
  // the target's own `tags`/`performers` *and* every path's full walk down to its
  // payload leaf - so `planTarget` runs the entire diff (aggregate, the common-tags
  // fold, the already-has check, the tag filter) before deciding whether to create a
  // plan entry. `recordExistence` tapped that pass at `agg.n`, the weakest question
  // available in it. `recordAddable` taps the strongest, at no extra request.
  //
  // Both hooks are still read. `has` is what the source side and the failure path
  // fall back to, and keeping them apart is what lets a probe answer "the relationship
  // is there but has nothing left to give" separately from "there is no relationship" -
  // the two are one hidden button either way, but only one of them is a bug when it is
  // wrong.
  function probeButtons(target, paths, id, s) {
    return probeContext(s).then(function (ctx) {
      var run = new AutoRun(s, ctx.tagMap, ctx.filters);
      var has = {}, adds = {};
      run.recordExistence = function (pathId, exists) { has[pathId] = exists; };
      run.recordAddable = function (pathId) { adds[pathId] = (adds[pathId] || 0) + 1; };
      return run.planEntities(target, paths, [String(id)])
        .then(function () { return { has: has, adds: adds }; });
    });
  }

  function pathIdsKey(paths) {
    return paths.map(function (p) { return p.id; }).sort().join(',');
  }

  // Single-slot, like MergePerformerTagsToScenes' own `sceneCheck`/`performerCheck`:
  // one page is in view at a time, so there is nothing to key a map on beyond what
  // would immediately be invalidated by navigating away. Keyed on the path *set*, not
  // just the entity, because toggling a path's setting while the page is open changes
  // what needs probing without changing either the target or the id.
  var _existenceCheck = null; // { target, id, pathsKey, status: 'pending'|'ready', adds }

  // Arms the probe if what it holds does not answer the question being asked, and
  // reports whether an answer is ready. Split out of `manualButtonsTick` so
  // it can be called *before* the container is found: measured on a live Scene Edit tab,
  // the three sequential passes took ~900 ms of wall clock, and they were starting the
  // moment the row appeared - which is the moment the user clicked Edit, and also the
  // moment Stash fires its own five `*ForSelect` queries for the form's dropdowns, each
  // of which measured 810-1096 ms. So the probe was queueing behind the busiest instant
  // of the page load, and every millisecond of it sat between the click and the button.
  // Run from the route instead and it is spent while the user is still reading the
  // detail view, with the answer already cached by the time the row exists.
  function armExistenceCheck(rt, paths, s) {
    var wantKey = pathIdsKey(paths);
    if (!_existenceCheck || _existenceCheck.target !== rt.target ||
        _existenceCheck.id !== rt.id || _existenceCheck.pathsKey !== wantKey) {
      var check = _existenceCheck = {
        target: rt.target, id: rt.id, pathsKey: wantKey, status: 'pending', adds: null, has: null,
      };
      gateLog('probing ' + TARGETS[rt.target].label + ' ' + rt.id + ' for ' +
        plural(paths.length, 'path') + ' - the outcomes below are this probe\'s');
      probeButtons(rt.target, paths, rt.id, s).then(function (r) {
        if (_existenceCheck !== check) return;
        check.adds = r.adds; check.has = r.has; check.status = 'ready';
        manualButtonsTick();
      }, function (e) {
        // A failed probe must not silently hide every button on the page - the
        // recorded preference is a button that is sometimes unneeded over one that
        // is missing when it was needed, and a network hiccup is exactly that trade.
        // `adds: null` is read downstream as "show everything".
        console.error('[ptp2re] button probe failed:', e);
        if (_existenceCheck !== check) return;
        check.status = 'ready'; check.adds = null; check.has = null;
        manualButtonsTick();
      });
    }
    return _existenceCheck.status === 'ready';
  }

  // Reconciles the container's buttons against the currently enabled paths for this
  // page, adding what is missing and dropping what no longer belongs - a stale
  // button left over from the previous entity, or every button at once when the
  // setting is off or the page is not one of the four.
  function manualButtonsTick() {
    autoSettings().then(function (s) {
      var rt = s.a1ShowManualButtons ? currentRouteTarget() : null;
      if (!rt) {
        gateLogOnce('t:route', s.a1ShowManualButtons
          ? 'no target buttons: this route is not one of the four target pages'
          : 'no target buttons: Show Manual Buttons is off');
        clearManualButtons(); return;
      }
      var wanted = enabledPaths(s).filter(function (p) { return p.target === rt.target; });
      if (!wanted.length) {
        gateLogOnce('t:route', 'no target buttons on ' + TARGETS[rt.target].label + ' ' + rt.id +
          ': no enabled path writes into a ' + TARGETS[rt.target].label.toLowerCase());
        clearManualButtons(); return;
      }
      gateLogOnce('t:route', TARGETS[rt.target].label + ' ' + rt.id + ' - ' +
        plural(wanted.length, 'enabled path') + ' into this page: ' + wanted.map(function (p) { return p.id; }).join(', '));
      var container = findManualButtonContainer();
      if (!container) {
        // No row yet - on a Scene that means the Edit tab is not open. Probe anyway:
        // see `armExistenceCheck`. The dedup filter below needs a container to read, so
        // this arms on the unfiltered set; dedup only drops a path when another plugin
        // is *showing* a button for it, so in every other case the key is the one the
        // filtered call would have produced and the answer is already there when the
        // row appears.
        gateLogOnce('t:container', 'no button row yet on ' + TARGETS[rt.target].label + ' ' + rt.id +
          ' - probing anyway; this usually means the Edit tab is not open');
        armExistenceCheck(rt, wanted, s);
        clearManualButtons();
        return;
      }
      gateLogOnce('t:container', 'button row found on ' + TARGETS[rt.target].label + ' ' + rt.id);
      ensureRowSpacing(container);
      // A path another plugin also declares, whose button is already visible right
      // here, is dropped from what we want before either loop below ever sees it -
      // so the removal loop tears an earlier one of ours down the moment a sibling
      // plugin's appears, and the add loop never puts a second one up beside it.
      var paths = wanted.filter(function (p) {
        var dropped = otherPluginDeclaresPath(p.id) && foreignButtonAlreadyShows(container, buttonLabel(p, s));
        if (dropped) gateLogOnce('t:dedup:' + p.id, p.id + ' - hidden: another plugin is already ' +
          'showing "' + buttonLabel(p, s) + '" in this row');
        return !dropped;
      });
      // Read once per tick and used for the caption, the tooltip and (through
      // `runManual`) the click, so the "..." cannot say one thing and the click do
      // another.
      var immediate = savesImmediately(s);
      if (!paths.length) { clearManualButtons(); return; }
      // Eligibility gating: a button whose path would add
      // nothing to this entity stays off rather than sitting there to report "No
      // changes" on every click. That covers an absent relationship (no performers, no
      // studio, no markers), as plain existence gating did, and also a
      // relationship whose sources carry nothing, one whose payload the target already
      // has in full, an empty "common tags only" intersection, and a payload the
      // exclusion filter refuses. An entity blocked outright by `f1`/`f2` hides every
      // button here, which it already did - `planTarget` returns before either hook.
      //
      // The probe is async, so a button that was showing a moment ago can disappear for
      // one tick while a fresh one is checked; there is no synchronous way to know
      // without the query.
      //
      // What this reads is the server. In staging mode a click diffs against the
      // *form*, so an unsaved edit is invisible to the gate until Save - see
      // `invalidateButtonProbes`, which is what makes Save enough.
      if (!armExistenceCheck(rt, paths, s)) { clearManualButtons(); return; }
      // Reported here rather than from the probe's callback, and that is the whole
      // point: a probe runs once per entity, so a cached answer produced no line at
      // all - which is exactly the state someone is in when they switch the debug flag
      // on while already looking at the page whose buttons they are asking about.
      // `gateLogOnce` keys on the path and carries the entity in the text, so a repeat
      // of the same answer is silent and a change (or a navigation) speaks.
      var adds = _existenceCheck.adds, seen = _existenceCheck.has;
      paths.forEach(function (p) {
        gateLogOnce('t:out:' + p.id, TARGETS[rt.target].label + ' ' + rt.id + ' - ' + p.id + ' - ' +
          // `has` and `adds` are both kept precisely so this can tell the two reasons
          // for hiding apart: "there is no studio here" and "the studio's tags are
          // already all on this scene" look identical from the button.
          (!adds ? 'SHOWN: the probe failed, so every button is shown rather than hidden'
            : adds[p.id] > 0 ? 'SHOWN: ' + adds[p.id] + ' to add'
            : seen && seen[p.id] === false ? 'hidden: no ' + p.source.toLowerCase() + ' on this entity'
            : seen && seen[p.id] ? 'hidden: source found, but nothing it carries is missing here'
            // Neither hook fired: `planTarget` returned before both of them, which it
            // does for an entity the f1/f2 entity-level filters exclude outright.
            : 'hidden: entity excluded by a filter'));
      });
      if (adds) {
        paths = paths.filter(function (p) { return adds[p.id] > 0; });
      }
      // A button whose path is no longer enabled - or no longer wanted because its
      // source turned out to be empty - is removed outright. A button for a
      // *different* entity (the container reused across a navigation) is not handled
      // here - the loop below already replaces it, since `existing` would fail the
      // entity-id check and get torn down before its replacement is appended. Two
      // removal paths for the same case would be one more place to keep in sync.
      //
      // `childNodes` is a live NodeList in a real browser, not an Array - it has no
      // `.slice()`, only `.length` and index access. `Array.prototype.slice.call`
      // copies it into a real array first, both so `.forEach` exists at all and so
      // removing a node mid-loop cannot skip the next one the way mutating a live
      // collection while iterating it would.
      Array.prototype.slice.call(container.childNodes || []).forEach(function (node) {
        if (!hasClass(node, MANUAL_BTN_CLASS)) return;
        var stillWanted = paths.some(function (p) { return manualButtonId(p) === node.id; });
        if (!stillWanted && node.parentNode) node.parentNode.removeChild(node);
      });
      paths.forEach(function (p) {
        var label = withEllipsis(buttonLabel(p, s), immediate);
        var existing = document.getElementById(manualButtonId(p));
        if (existing && existing._ptp2reEntityId === rt.id && existing._ptp2reLabel === label) return;
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        insertBeforeImportantAction(container, buildManualButton(p, label, rt.target, rt.id, immediate));
      });
    });
  }

  // ── The source-side buttons: push outward instead of pulling in ─────────────
  //
  // Everything above puts a button on the *target's* page - "copy my performers'
  // tags in". This is the other direction: a button on the *source's* own page -
  // "push my tags out to every scene/group/etc. I reach" - matching MergePerformerTagsToScenes'
  // own performer-page button rather than the selection-menu alternative discussed
  // and deferred (see CLAUDE.md). Eleven of the thirteen paths qualify: the two
  // marker paths are deliberately absent, because a SceneMarker has no detail page of
  // its own to put a button on - it lives inside a scene's Markers tab.
  //
  // There is no staging equivalent here. Staging pushes into *one* captured form
  // control; a source button can fan out to dozens of targets at once, and there is
  // no single form to stage into. Every source button saves immediately, regardless
  // of `a2SaveImmediately` - that setting is about which of the *target* buttons'
  // two behaviours to use, and does not apply to a button that only ever has one.

  var SOURCE_ROUTES = {
    // Performer and Studio are only ever a source in this plugin - never one of
    // `TARGETS` - so they need their own route regexes here.
    performer: /^\/performers\/(\d+)(?:\/|$)/,
    studio: /^\/studios\/(\d+)(?:\/|$)/,
    // The other four are also targets, and a source button lives on the very same
    // route as a target button - just in the detail-view DOM state rather than the
    // edit-form one. Reusing `TARGETS[key].route` rather than a second copy of the
    // four patterns.
    scene: TARGETS.scene.route,
    gallery: TARGETS.gallery.route,
    image: TARGETS.image.route,
    group: TARGETS.group.route,
  };

  function currentSourceRouteTarget() {
    for (var key in SOURCE_ROUTES) {
      if (!hasOwn(SOURCE_ROUTES, key)) continue;
      var m = SOURCE_ROUTES[key].exec(location.pathname);
      if (m) return { sourceType: key, id: m[1] };
    }
    return null;
  }

  // Whether a mutation's ids name the entity currently on screen. Both route matchers,
  // because the same URL is a target page and a source page at once - `/scenes/7` shows
  // target buttons on its Edit tab and a source button on its detail view, and a
  // `sceneUpdate` is the save that changes what either would do.
  //
  // Matching on the id alone, rather than on the id *and* the entity type the mutation
  // names, is deliberate: the two route matchers agree on the type for every page this
  // plugin draws a button on, so adding the type would only be a second way to say the
  // same thing. The cost of a false positive is one re-probe.
  function viewingOneOf(ids) {
    var rt = currentRouteTarget(), src = currentSourceRouteTarget();
    if (!rt && !src) return false;
    for (var i = 0; i < ids.length; i++) {
      var id = String(ids[i]);
      if (rt && rt.id === id) return true;
      if (src && src.id === id) return true;
    }
    return false;
  }

  // The source-side counterpart to each path's target-side `button` label. Keyed
  // separately, rather than derived from `path.button`, because the two read in
  // opposite directions ("from all Performers" versus "to all Scenes") and a table
  // that tried to flip one string into the other would be harder to audit than two
  // short tables. A path missing here gets no source button - both marker paths, on
  // purpose (see above).
  var SOURCE_BUTTON_LABELS = {
    'tags:performer>scene': 'Add Tags to all Scenes',
    'tags:performer>group': 'Add Tags to all Groups',
    'tags:studio>scene': 'Add Tags to all Scenes',
    'tags:studio>group': 'Add Tags to all Groups',
    'tags:scene>group': 'Add {mode} Tags to all Groups from their Scenes',
    'performers:gallery>scene': 'Add Perfs to all Scenes',
    'tags:gallery>image': 'Add Tags to all Images',
    'performers:image>gallery': 'Add Perfs to all Galleries',
    'tags:image>gallery': 'Add Tags to all Galleries',
    'tags:group>scene': 'Add Tags to all Scenes',
    'tags:subgroup>group': 'Add {mode} Tags to all Containing Groups from their Sub-groups',
  };

  function sourceButtonLabel(path, s) {
    var template = SOURCE_BUTTON_LABELS[path.id];
    if (!path.common) return template;
    return template.replace('{mode}', pathCommon(s, path) ? 'common' : 'all');
  }

  // The other half of the swap `findManualButtonContainer` already reads: the
  // detail-view navbar carrying a Delete button, rather than the edit form a target
  // button wants. This is where a source button belongs, on the page *about* the
  // source entity rather than inside its edit form.
  // MergePerformerTagsToScenes' own performer button already depends on exactly this
  // container. Confirmed live only for Group (via the edit-container fallback's own
  // rejected half) and, through that plugin's precedent, for Performer; Studio,
  // Scene, Gallery and Image are the same guess, unverified - see CLAUDE.md.
  function findDetailContainer() {
    var candidates = document.querySelectorAll('.details-edit');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].querySelector('button.delete')) return candidates[i];
    }
    return null;
  }

  // ── The tab strip: where a source button goes on a page with no navbar ──────
  //
  // `findDetailContainer` wants a `.details-edit` carrying a Delete button, and live
  // use confirmed that **only Performer and Group render one**. Scene and Gallery show
  // a tab strip instead - Details / File Info / Chapters / Edit - and no action row at
  // all, so five of the eleven source buttons had nowhere to go and had never once
  // appeared. Image is untested and handled by the same rule either way.
  //
  // Read off a live Stash rather than guessed, which is §6's rule and the one four
  // releases of placement churn were spent learning:
  //
  //   <div class="scene-tabs order-xl-first order-last">      <- grandparent, flex
  //     <div>                                                  <- parent, block, 1 child
  //       <div class="mr-auto nav nav-tabs" role="tablist">    <- the strip, flex
  //         <div class="nav-item"><a data-rb-event-key="scene-details-panel" …>
  //         … <a data-rb-event-key="scene-edit-panel">Edit</a>
  //
  // **The strip is found by its Edit tab's key, not by its class.** Gallery renders
  // *two* `.nav-tabs` strips - its own panels, and an Images/Add strip for the image
  // list - and only the entity's own carries a `*-edit-panel` key. A class match alone
  // picks the wrong one on that page. Scene also renders a second element whose text is
  // exactly "Edit" (a `button.btn-link` in the details panel), so matching on the label
  // the way `findActionByLabel` does would be ambiguous too. The key is the one signal
  // that is unambiguous on both pages, and it names what it is.
  //
  // The walk is hand-rolled rather than `querySelectorAll('[data-rb-event-key$=…]')`
  // for the reason `findActionByLabel` is: the shared test harness's fake DOM answers
  // class selectors and nothing more.
  function hasEditPanelTab(node) {
    if (!node) return false;
    var key = node.getAttribute && node.getAttribute('data-rb-event-key');
    if (typeof key === 'string' && key.length > 11 && key.slice(-11) === '-edit-panel') return true;
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) if (hasEditPanelTab(kids[i])) return true;
    return false;
  }

  function findTabStrip() {
    var lists = document.querySelectorAll('.nav-tabs') || [];
    for (var i = 0; i < lists.length; i++) if (hasEditPanelTab(lists[i])) return lists[i];
    return null;
  }

  // Which entity type a tab shows, from its `data-rb-event-key`. The keys are
  // `<page>-<what>-panel` (`scene-details-panel`, `scene-edit-panel`), so the middle
  // segment is the answer. Gallery's image-list strip uses bare keys (`images`, `add`)
  // with neither prefix nor suffix, hence the no-hyphen fallback.
  //
  // **Exact match on that segment, not a substring test on the whole key** - and this
  // is defence rather than a fix for anything observed. A substring test cannot be told
  // apart from this one by any fixture: the case it looks like it protects against is a
  // Group page whose keys all start `group-`, and there a substring matcher matches
  // *every* tab, so one of them is always selected and it answers "shown" exactly as
  // falling open does. What the exact match actually buys is the future key that merely
  // *contains* a target's name without being that target's tab - `scene-grouping-panel`
  // and the like - which would engage the gate and let it hide a button. Hiding is the
  // bad direction here (see `targetTabSelected`), so the stricter test is the cheap side
  // to be wrong on. A mutant using `indexOf` passes the whole suite; do not read that as
  // the check being redundant, and do not read it as the check being proven either.
  function tabShows(node) {
    var key = node && node.getAttribute && node.getAttribute('data-rb-event-key');
    if (typeof key !== 'string' || !key) return '';
    var mid = key.indexOf('-') === -1 ? key : key.split('-').slice(1).join('-');
    return mid.replace(/-panel$/, '').toLowerCase();
  }

  function eachTab(fn) {
    var lists = document.querySelectorAll('.nav-tabs') || [];
    for (var i = 0; i < lists.length; i++) {
      var kids = [];
      (function walk(n) {
        if (!n) return;
        if (n.getAttribute && n.getAttribute('data-rb-event-key')) kids.push(n);
        var c = n.childNodes || [];
        for (var j = 0; j < c.length; j++) walk(c[j]);
      }(lists[i]));
      for (var k = 0; k < kids.length; k++) fn(kids[k]);
    }
  }

  // Whether the tab showing this path's *targets* is the one currently open.
  //
  // Live feedback: "Add Tags to all Groups from their Scenes" is only meaningful while
  // you are looking at the scene's groups, and the tab strip it is anchored under is
  // present on every tab - so without this it sits over the Details panel, over File
  // Info, and just above the target-side buttons on Edit.
  //
  // **Fails open, and that direction is deliberate.** Three of the keys here have been
  // read off a live Stash and the rest have not; a page whose target tab this cannot
  // identify shows the button on every tab, which is what this did before it read the
  // key at all. Hiding on a failed match would make an unrecognised key look identical
  // to the bug above - the recorded preference is a button sometimes unneeded over one
  // missing when it was needed, and a naming guess is precisely where to apply it.
  // `null` means "no such tab on this page", which the caller reads as "show".
  function targetTabSelected(path) {
    var want = path.target, found = null;
    eachTab(function (tab) {
      var shows = tabShows(tab);
      if (shows !== want && shows !== want + 's') return;
      if (found === null) found = false;
      if (String(tab.getAttribute('aria-selected')) === 'true') found = true;
    });
    return found;
  }

  var SRC_ROW_CLASS = 'ptp2re-src-row';

  // A row of our own, immediately after the strip inside the strip's own block-level
  // parent. This is the one container in the plugin that Stash puts nothing into, so
  // it is also the one with no anchor to find and nothing to order against - a button
  // here appends, which is what `insertBeforeImportantAction` already does when it
  // recognises no action, so that call needs no branch for this case.
  //
  // Not *inside* the strip: it is `role="tablist"`, whose children are meant to be
  // tabs, and it is the flex row the tabs are laid out in. A button in there would be
  // wrong to a screen reader and would sit on the tab line rather than under it.
  function ensureTabStripRow() {
    var strip = findTabStrip();
    if (!strip || !strip.parentNode) return null;
    var existing = byClass(strip.parentNode, SRC_ROW_CLASS);
    if (existing) return existing;
    var row = el('div', SRC_ROW_CLASS);
    strip.parentNode.insertBefore(row, strip.nextSibling);
    return row;
  }

  // The navbar where there is one, our own row under the tab strip where there is not.
  // Order matters: Performer and Group render a navbar *and* no tab strip, so the first
  // branch is the only one they ever reach, and their placement is unchanged.
  function findSourceButtonContainer() {
    return findDetailContainer() || ensureTabStripRow();
  }

  var MANUAL_SRC_BTN_CLASS = 'ptp2re-manual-src-btn';

  function manualSourceButtonId(path) {
    return 'ptp2re-msbtn-' + path.id.replace(/[^a-zA-Z0-9]+/g, '-');
  }

  function clearManualSourceButtons() {
    (document.querySelectorAll('.' + MANUAL_SRC_BTN_CLASS) || []).forEach(function (b) {
      if (b.parentNode) b.parentNode.removeChild(b);
    });
  }

  // Whether each of `paths` finds any target at all from this one source entity -
  // the source-side equivalent of `checkButtonExistence`, but simpler: there is no
  // walk to aggregate, only `resolveSourceTargets`' own id list, the same lookup a
  // click performs. A performer in no scenes yields an empty list either way, so the
  // button and the click can never disagree about what counts as "nothing here".
  // In parallel, unlike every other reverse lookup here: this is one entity's worth of
  // work per path with nothing to accumulate between them, and a probe is what the user
  // is waiting on before a button appears. The sequential shape elsewhere is about not
  // firing a query per entity across a whole library; a handful of paths on one page is
  // not that.
  // The source's own payload, in one by-id query covering every candidate path. A page
  // can offer paths of both kinds - an Image is the source of `performers:image>gallery`
  // and `tags:image>gallery` at once - so the selection is the union of their leaves,
  // deduplicated, and `payloadOf` then reads each path's own ids back out of the one
  // response exactly as the walk does.
  function sourcePayloadQuery(sourceType, paths) {
    var one = SOURCES[sourceType].one, seen = {}, parts = [];
    paths.forEach(function (p) {
      var sel = leafSelection(p);
      if (seen[sel]) return;
      seen[sel] = true;
      parts.push(sel);
    });
    return 'query PTP_spayload_' + one + '($id: ID!) {' +
      ' ' + one + '(id: $id) { ' + parts.join(' ') + ' } }';
  }

  // Whether each of `paths` would put anything on the page's targets from this one
  // source entity. Two halves, and the split is the whole design:
  //
  //   - **a target exists** - `resolveSourceTargets`, the same lookup a click performs,
  //     so button and click can never disagree about what counts as nothing.
  //   - **the source carries a payload** worth copying - its own tags or performers,
  //     minus anything the tag filter refuses. Without that, a performer with
  //     scenes but no tags shows a button that could only ever report "No changes".
  //     This is what `MergePerformerTagsToScenes`' performer button has always gated on
  //     (`hasTags && hasScenes`), and matching it was the point.
  //
  // What is deliberately *not* asked here, unlike the target side: whether the targets
  // already have it. That means reading every scene a studio touches - unbounded, and
  // the one check on this page that could be. A source button can still report "No
  // changes" for that reason, and that is the ceiling, not a bug.
  //
  // In parallel, unlike every other reverse lookup here: this is one entity's worth of
  // work per path with nothing to accumulate between them, and a probe is what the user
  // is waiting on before a button appears. The sequential shape elsewhere is about not
  // firing a query per entity across a whole library; a handful of paths on one page is
  // not that. The payload query joins the same `Promise.all`, so it costs no wall clock
  // beyond the slowest lookup already running.
  // The two halves write into maps of their own and are folded at the end, never into
  // one shared map: they resolve in either order, and a late `true` from the target
  // lookup landing on the same key a payload miss had already set to `false` would
  // show a button whose source has nothing in it.
  function checkSourceButtonExistence(paths, id, s) {
    var reaches = {}, carries = {};
    var targets = paths.map(function (p) {
      return resolveSourceTargets(p, [String(id)], true).then(function (ids) { reaches[p.id] = ids.length > 0; });
    });
    var payload = probeContext(s).then(function (ctx) {
      return gqlRequest(sourcePayloadQuery(paths[0].sourceType, paths), { id: String(id) })
        .then(function (data) {
          var src = data[SOURCES[paths[0].sourceType].one];
          paths.forEach(function (p) {
            carries[p.id] = !!src && payloadOf(src, p).some(function (pid) {
              // A performers-kind payload has no tag filter to answer to: `f3`/`f4`
              // refuse a tag, and there is no performer equivalent (§4a).
              return p.kind === 'performers' || !ctx.filters.tagBlocked(pid);
            });
          });
        });
    });
    return Promise.all(targets.concat([payload])).then(function () {
      var has = {};
      paths.forEach(function (p) { has[p.id] = !!reaches[p.id] && !!carries[p.id]; });
      // The two halves are handed back beside the verdict, not folded away, so the tick
      // can state a *reason* off a cached answer: "this performer is in no scenes" and
      // "this performer has no tags" are one absent button and two entirely different
      // things to go and fix.
      return { has: has, reaches: reaches, carries: carries };
    });
  }

  // The one thing a source button's caption cannot say, and the thing users get wrong:
  // it does not copy *this* entity's payload outward. It finds the targets this entity
  // reaches and then rebuilds each of them from **all** of their own sources - every
  // performer of that scene, every scene of that group. This entity is how the targets
  // were found, not the whole of what is copied.
  //
  // For the two "common tags only" paths that is the difference between something and
  // nothing, which is why they say it in the label as well (`SOURCE_BUTTON_LABELS`).
  // For the other nine the extra sources only ever *add* on top of what you expected,
  // so the tooltip carries it alone.
  function manualSourceButtonTitle(path, s) {
    var target = TARGETS[path.target].label.toLowerCase();
    var common = pathCommon(s, path);
    return pathLabel(path) + ' - updates every ' + target + ' this ' +
      SOURCES[path.sourceType].label.toLowerCase() + ' belongs to. Each ' + target +
      ' is rebuilt from ALL of its ' + path.source.toLowerCase() + ', not only this one' +
      (common
        ? ', and only tags that every one of them carries are copied - so this can add nothing.'
        : '.') +
      ' Opens a dialog listing every change first; nothing is written until you press ' +
      'Proceed. There is no staging here - the write fans out to many entities at once, ' +
      'and there is no single form to stage it into.';
  }

  // Drops what we just wrote out of Apollo's cache, so the panel listing those entities
  // redraws with the new tags instead of the ones it read before the click. The tag
  // *counts* on a Scene's Groups tab are the visible case: they are rendered from the
  // cached Group objects, and nothing else would refresh them short of a navigation.
  //
  // Eviction only, never `location.reload()` - which is where this differs from
  // `MergePerformerTagsToScenes`' `refreshSceneData`, whose fallback is a reload. That
  // is tolerable after its performer button, which navigates the user away anyway; here
  // it would tear the page down mid-"Added 3" and lose the flash the click just earned.
  // Where Apollo is absent the panel stays stale until the user navigates, which is the
  // same trade the sibling's task makes for its own dialog.
  //
  // `TARGETS[].label` doubles as the GraphQL typename ('Scene', 'Gallery', 'Image',
  // 'Group'), which is what Apollo keys normalised objects on.
  function evictTargets(target, ids) {
    var client = window.__APOLLO_CLIENT__;
    if (!client || !client.cache || !client.cache.evict) return;
    try {
      ids.forEach(function (id) {
        client.cache.evict({ id: TARGETS[target].label + ':' + String(id) });
      });
      if (client.cache.gc) client.cache.gc();
    } catch (e) {
      console.error('[ptp2re] cache eviction failed:', e);
    }
  }

  // `{ target: { id: true } }`, as `AutoRun.apply` accumulates it. Nothing written
  // means nothing to evict - refetching a panel this run did not change is the one
  // cost eviction has.
  function evictWritten(wrote) {
    for (var target in wrote) {
      if (!hasOwn(wrote, target)) continue;
      var ids = Object.keys(wrote[target]);
      if (ids.length) evictTargets(target, ids);
    }
  }

  // The click. Just this one path onto whatever the source reaches - not
  // `runAutoTargets`' "replan everything enabled for this target", which would pull in
  // *other* sources' paths too and do more than the button that was clicked promised.
  //
  // It writes nothing itself: it opens the review dialog scoped to this
  // path and this source, and the dialog resolves the targets, lists every change and
  // waits for Proceed. This was the widest unreviewed write in the plugin - one click
  // on a studio's page rewriting every scene it owns - and it is now the one with the
  // most to read before it happens. The lookup, the planner and the writes are the
  // same code as before; only what drives them moved.
  function runManualSource(path, id, label) {
    return scopeLabel(path.sourceType, id).then(function (what) {
      startRun(stripEllipsis(label) + ' - from ' + what,
        { pathId: path.id, sourceId: String(id) });
      return { mode: 'dialog', count: 0 };
    });
  }

  function buildManualSourceButton(path, label, id, s) {
    // No margin of either axis here - same reasoning as the target-side button above,
    // and `applyButtonSpacing` handles both. Studio can show two of these at once and
    // wraps just as readily.
    var btn = el('button', 'btn ' + PLUGIN_BTN_VARIANT + ' ' + MANUAL_SRC_BTN_CLASS, label);
    btn.type = 'button';
    btn.id = manualSourceButtonId(path);
    btn._coopOwner = PLUGIN_ID; // read by `insertOrdered`'s cross-plugin priority scan
    btn._ptp2reEntityId = id;
    btn._ptp2reLabel = label;
    btn.style = 'align-self:flex-start;';
    btn.title = manualSourceButtonTitle(path, s);
    btn.addEventListener('click', function (event) {
      if (event && event.preventDefault) event.preventDefault();
      var orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Working...';
      runManualSource(path, id, label).then(function () {
        btn.disabled = false;
        // Always the dialog on this side - there is no staging here - so the caption
        // goes straight back rather than flashing a count under a modal that covers it.
        // The re-probe is `Run.close`'s now, once whatever was approved has been written.
        btn.textContent = orig;
      }, function (err) {
        btn.disabled = false;
        btn.textContent = orig;
        console.error('[ptp2re]', err);
        alert('Error: ' + (err && err.message ? err.message : err));
      });
    });
    return btn;
  }

  var _existenceCheckSrc = null; // same shape as `_existenceCheck`, keyed on sourceType instead of target

  // Both probe slots are keyed on the entity and the path set, neither of which a save
  // changes - so without this a button decided before an edit keeps that answer until
  // the user navigates away and back. Dropping them re-arms on the next tick, and the
  // ticks are called here rather than waited for so the button moves with the save
  // rather than up to a second after it.
  //
  // Three callers, and the reasoning differs at each:
  //
  //   - the `fetch` wrapper, on a save of the entity in view. **Unconditional on the
  //     auto-mode settings**: these caches decide whether a button appears, and a scene
  //     that just gained a performer has to gain its button whether or not auto mode is
  //     also configured to react. `MergePerformerTagsToScenes` learned this one first
  //     and its CLAUDE.md §3 says the same thing about not tidying it into the auto
  //     conditions.
  //   - `runAutoTargets`, because an auto reaction writes *after* the save that
  //     triggered it. Invalidating only at the mutation would re-probe against the
  //     library as it was a moment before our own reaction changed it.
  //   - a manual button click, on the flash timer rather than at once, so "Added 3" is
  //     not torn off the button mid-caption by the tick that removes it.
  //
  // The library-wide task writes thousands of mutations and reaches none of this: they
  // all run inside `guarded()`, which returns from the wrapper before any of it.
  function invalidateButtonProbes() {
    _existenceCheck = null;
    _existenceCheckSrc = null;
    manualButtonsTick();
    manualSourceButtonsTick();
  }

  function manualSourceButtonsTick() {
    autoSettings().then(function (s) {
      var rt = s.a1ShowManualButtons ? currentSourceRouteTarget() : null;
      if (!rt) {
        gateLogOnce('s:route', s.a1ShowManualButtons
          ? 'no source buttons: this route is not one of the six source pages'
          : 'no source buttons: Show Manual Buttons is off');
        clearManualSourceButtons(); return;
      }
      // The enabled-path filter is split off from the dedup one and runs *first*, so a
      // page with nothing to place never reports having nowhere to place it. Only the
      // dedup half needs the container, which is why the two were one filter before -
      // and why a Scene with its Edit tab open used to complain about a missing detail
      // navbar whether or not any path even reads from a Scene.
      var candidates = PATHS.filter(function (p) {
        return p.sourceType === rt.sourceType && pathOn(s, p) && hasOwn(SOURCE_BUTTON_LABELS, p.id);
      });
      if (!candidates.length) {
        gateLogOnce('s:paths', 'no source buttons on ' + SOURCES[rt.sourceType].label + ' ' + rt.id +
          ': no enabled path reads from a ' + SOURCES[rt.sourceType].label.toLowerCase() +
          ' (both marker paths have no detail page and never qualify)');
        clearManualSourceButtons(); return;
      }
      gateLogOnce('s:paths', SOURCES[rt.sourceType].label + ' ' + rt.id + ' - ' +
        plural(candidates.length, 'candidate path') + ': ' + candidates.map(function (p) { return p.id; }).join(', '));
      var container = findSourceButtonContainer();
      if (!container) {
        gateLogOnce('s:container', 'nowhere to put a source button on ' + SOURCES[rt.sourceType].label +
          ' ' + rt.id + ' - no detail action row and no tab strip');
        clearManualSourceButtons(); return;
      }
      gateLogOnce('s:container', 'source button row on ' + SOURCES[rt.sourceType].label + ' ' + rt.id +
        ': ' + (hasClass(container, SRC_ROW_CLASS) ? 'our own, under the tab strip' : "Stash's detail action row"));
      ensureRowSpacing(container);
      var paths = candidates.filter(function (p) {
        var dropped = otherPluginDeclaresPath(p.id) && foreignButtonAlreadyShows(container, sourceButtonLabel(p, s));
        if (dropped) gateLogOnce('s:dedup:' + p.id, p.id + ' - hidden: another plugin is already ' +
          'showing "' + sourceButtonLabel(p, s) + '" in this row');
        return !dropped;
      }).filter(function (p) {
        var sel = targetTabSelected(p);
        gateLogOnce('s:tab:' + p.id, p.id + ' - ' + (sel === null
          ? 'no ' + TARGETS[p.target].plural + ' tab found on this page, so the tab does not gate it'
          : sel ? 'the ' + TARGETS[p.target].plural + ' tab is open'
          : 'hidden: the ' + TARGETS[p.target].plural + ' tab is not the one open'));
        return sel !== false;
      });
      if (!paths.length) { clearManualSourceButtons(); return; }
      var wantKey = pathIdsKey(paths);
      if (!_existenceCheckSrc || _existenceCheckSrc.sourceType !== rt.sourceType ||
          _existenceCheckSrc.id !== rt.id || _existenceCheckSrc.pathsKey !== wantKey) {
        var check = _existenceCheckSrc = { sourceType: rt.sourceType, id: rt.id, pathsKey: wantKey, status: 'pending', has: null };
        gateLog('probing ' + SOURCES[rt.sourceType].label + ' ' + rt.id + ' for ' +
          plural(paths.length, 'path') + ' - the outcomes below are this probe\'s');
        checkSourceButtonExistence(paths, rt.id, s).then(function (r) {
          if (_existenceCheckSrc !== check) return;
          check.has = r.has; check.reaches = r.reaches; check.carries = r.carries;
          check.status = 'ready'; manualSourceButtonsTick();
        }, function (e) {
          console.error('[ptp2re] source button probe failed:', e);
          if (_existenceCheckSrc === check) { check.status = 'ready'; check.has = null; manualSourceButtonsTick(); }
        });
      }
      if (_existenceCheckSrc.status !== 'ready') { clearManualSourceButtons(); return; }
      // From the tick rather than the probe, for the reason the target side is: a cached
      // answer runs no probe, which is precisely the state someone is in when they turn
      // the debug flag on while already on the page they are asking about.
      var srcHas = _existenceCheckSrc.has;
      var srcReaches = _existenceCheckSrc.reaches || {};
      paths.forEach(function (p) {
        gateLogOnce('s:out:' + p.id, SOURCES[rt.sourceType].label + ' ' + rt.id + ' - ' + p.id + ' - ' +
          (!srcHas ? 'SHOWN: the probe failed, so every button is shown rather than hidden'
            : srcHas[p.id] ? 'SHOWN: reaches at least one ' + TARGETS[p.target].label.toLowerCase() +
                ' and carries something to copy'
            : !srcReaches[p.id] ? 'hidden: reaches no ' + TARGETS[p.target].label.toLowerCase()
            : 'hidden: carries no ' + (p.kind === 'performers' ? 'performers' : 'tags') +
              ' to copy (or the tag filter refuses all of them)'));
      });
      if (srcHas) {
        paths = paths.filter(function (p) { return srcHas[p.id]; });
      }
      Array.prototype.slice.call(container.childNodes || []).forEach(function (node) {
        if (!hasClass(node, MANUAL_SRC_BTN_CLASS)) return;
        var stillWanted = paths.some(function (p) { return manualSourceButtonId(p) === node.id; });
        if (!stillWanted && node.parentNode) node.parentNode.removeChild(node);
      });
      paths.forEach(function (p) {
        // Always "..." here: a source button has no staging branch to be without one.
        var label = withEllipsis(sourceButtonLabel(p, s), true);
        var existing = document.getElementById(manualSourceButtonId(p));
        if (existing && existing._ptp2reEntityId === rt.id && existing._ptp2reLabel === label) return;
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        insertBeforeImportantAction(container, buildManualSourceButton(p, label, rt.id, s));
      });
    });
  }

  // A MutationObserver, unlike the settings page's decoration-only tick: a button
  // has to land before the user can click it, and React re-renders the edit panel
  // constantly enough (every keystroke in the form) that polling alone would leave
  // it flickering in and out. Coalesced into one tick per burst.
  var _entityTickScheduled = false;
  function scheduleEntityTick() {
    if (_entityTickScheduled) return;
    _entityTickScheduled = true;
    setTimeout(function () { _entityTickScheduled = false; manualButtonsTick(); manualSourceButtonsTick(); }, 100);
  }

  // The shared bus rather than an observer of our own - see `domBus`. `subscribe` is
  // idempotent, so this is safe from both the script bottom and `load`, and where there
  // is nothing to observe yet the interval below still drives the tick.
  function startEntityObserver() {
    domBus().subscribe(scheduleEntityTick);
  }

  function bothButtonTicks() { manualButtonsTick(); manualSourceButtonsTick(); }

  if (!installSelectPatches()) {
    window.addEventListener('load', function () { installSelectPatches(); });
  }
  if (window.addEventListener) {
    window.addEventListener('load', function () { bothButtonTicks(); startEntityObserver(); });
    window.addEventListener('popstate', function () { setTimeout(bothButtonTicks, 300); });
  }
  document.addEventListener('click', function () { setTimeout(bothButtonTicks, 300); }, true);
  setInterval(bothButtonTicks, 1000);
  // At script bottom as well as on `load`, guarded so the two cannot register twice:
  // a script evaluated after `load` has already fired would otherwise be left with the
  // one-second poll alone, which its own comment says is not enough.
  startEntityObserver();
  bothButtonTicks();

  // Warm the probe's tag context now rather than making the first button wait for it.
  // It is the same answer for every page and it is the expensive one (see
  // `PROBE_CTX_TTL_MS`), so paying for it while Stash is still rendering costs the user
  // nothing, where paying for it on their first click costs three quarters of a second.
  // Gated on the buttons being on at all: a user who has never enabled one should not be
  // asked for the tag library on every page load. Failure is ignored - this is a warm-up,
  // and the probe that actually needs the context will report its own.
  autoSettings().then(function (s) {
    if (s.a1ShowManualButtons) probeContext(s).then(null, function () {});
  }, function () {});

  // ── Task interception ─────────────────────────────────────────────────────
  //
  // Layer 1: capture-phase click. React attaches its handlers to the root container,
  // which is a descendant of document, so a capture listener here runs first and
  // stopPropagation keeps PluginTasks' onPluginTaskClicked - and its misleading
  // "added job to queue" toast - from ever running.
  //
  // The button is only ours if it carries one of our task names AND sits inside a
  // SettingGroup headed with the plugin name; another plugin is free to declare a
  // task with the same name. When the group cannot be identified the click is left
  // alone on purpose: layer 2 still blocks it, keyed on the plugin id the mutation
  // itself carries, which is the authoritative check.
  function ownTaskName(btn) {
    var label = (btn.textContent || '').trim();
    if (TASKS.indexOf(label) === -1) return null;
    // Answer from the button's *own* SettingGroup and stop there. Testing every
    // ancestor for an h3 - which is what this used to do - climbs past the group
    // on a miss and into the panel holding every plugin's group, where
    // `querySelector('h3')` answers with whichever plugin is listed first. A plugin
    // declaring a task by the same name as ours was therefore hijacked whenever we
    // happened to be above it, which is the one thing the heading check exists to
    // stop. Found by the tasks-page check in `tests/placement.test.js`.
    //
    // A group's first h3 is its heading: PluginTasks renders it in the header, above
    // the per-task `Setting` rows that each carry an h3 of their own - which is also
    // why the walk cannot simply stop at the nearest ancestor containing any h3.
    //
    // The any-ancestor walk survives as a fallback for a Stash that does not put
    // `setting-group` on that box. It carries the bug above, and that is deliberate:
    // it is the behaviour every release before this one shipped, so it can be no worse
    // than what it replaces.
    var node = btn;
    var fallback = null;
    for (var depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      var heading = node.querySelector ? node.querySelector('h3') : null;
      var ours = !!heading && headingIsOurs(heading.textContent);
      if (hasClass(node, 'setting-group')) return ours ? label : null;
      if (ours) fallback = label;
    }
    return fallback;
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    var btn = target && target.closest ? target.closest('button') : null;
    if (!btn) return;
    var taskName = ownTaskName(btn);
    if (!taskName) return;
    event.preventDefault();
    event.stopPropagation();
    startRun(taskName);
  }, true);

  // Layer 2: backstop for a click layer 1 did not recognise. The mutation is
  // answered from here with a synthesized success rather than being forwarded, so
  // the server never tries to exec a plugin that has nothing to exec.
  function fakeOk(payload) {
    var body = JSON.stringify(payload);
    if (typeof Response === 'function') {
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return {
      ok: true, status: 200,
      json: function () { return Promise.resolve(JSON.parse(body)); },
      text: function () { return Promise.resolve(body); },
      clone: function () { return fakeOk(payload); },
    };
  }

  var _fetch = window.fetch;
  window.fetch = function (url, opts) {
    // The task backstop stays first and ahead of the _writeDepth check below: the
    // mutation has to be *answered* rather than forwarded, and a task click is a
    // user action whether or not a write happens to be in flight.
    if (typeof url === 'string' && url.indexOf('/graphql') !== -1 && opts && opts.body) {
      try {
        var parsed = JSON.parse(opts.body);
        var vars = parsed.variables || {};
        if (/\brunPluginTask\b/.test(parsed.query || '') && vars.plugin_id === PLUGIN_ID) {
          startRun(vars.task_name || TASK_PROPAGATE_ALL);
          return Promise.resolve(fakeOk({ data: { runPluginTask: PLUGIN_ID + '-handled-in-browser' } }));
        }
      } catch (e) {
        // Not JSON, or no variables - nothing to match on; fall through.
      }
    }

    var p = _fetch.apply(this, arguments);
    if (_writeDepth > 0 || typeof url !== 'string' || url.indexOf('/graphql') === -1 ||
        !opts || !opts.body) {
      return p;
    }

    try {
      var req = JSON.parse(opts.body);
      var q = req.query || '';
      var v = req.variables || {};

      // Our own settings being saved. Auto mode caches them for AUTO_SETTINGS_TTL_MS,
      // so without this, changing an exclusion filter and immediately saving an entity
      // would be governed by the old settings for up to ten seconds. Two details:
      // re-read only once the mutation has landed, or the old values come straight
      // back and are cached for another ten seconds - and `pathFieldTick` would then
      // canonicalise the stale `b1Paths` back over the save; and scope it to our own
      // plugin_id, since the settings page saves each plugin in its own mutation.
      if (/\bconfigurePlugin\b/.test(q) && v.plugin_id === PLUGIN_ID &&
          !/PTPSeedSettings/.test(q)) {
        mutationSucceeded(p).then(function (ok) {
          if (!ok) return;
          invalidateAutoSettings();
          settingsTick();
        });
      }

      // A save of whatever is on screen re-arms the button probes, whichever entity
      // type it names and whatever the auto-mode settings say. Deliberately its own
      // branch, ahead of and independent of both reaction branches below: those are
      // gated on `a3`/`a4` and on `autoSuppressed()`, and a button appearing after a
      // save is not something a user should have to enable auto mode to get. See
      // `invalidateButtonProbes`.
      var savedIds = (v.input && (v.input.ids || (v.input.id != null ? [v.input.id] : []))) || [];
      if (savedIds.length && (targetOfMutation(q) || sourceOfMutation(q)) && viewingOneOf(savedIds)) {
        mutationSucceeded(p).then(function (ok) { if (ok) invalidateButtonProbes(); });
      }

      // A save of one of our four target types. The suppression check sits after the
      // match rather than before it, so the one-time "standing down" line is only
      // emitted for a mutation that would actually have been reacted to.
      var hit = targetOfMutation(q);
      if (hit && !autoSuppressed()) {
        var ids = hit.bulk
          ? (v.input && v.input.ids) || []
          : (v.input && v.input.id != null ? [v.input.id] : []);
        if (ids.length) {
          mutationSucceeded(p).then(function (ok) {
            if (ok) reactToTargets(hit.target, ids);
          });
        }
      }

      // A save of anything this plugin ever reads *from* - independent of the check
      // above, since a save can be both: a Scene is a target of its own paths and a
      // source of `tags:scene>group`.
      var srcHit = sourceOfMutation(q);
      if (srcHit && !autoSuppressed()) {
        var sids = srcHit.bulk
          ? (v.input && v.input.ids) || []
          : (v.input && v.input.id != null ? [v.input.id] : []);
        if (sids.length) {
          mutationSucceeded(p).then(function (ok) {
            if (ok) reactToSources(srcHit.sourceType, sids);
          });
        }
      }
    } catch (e) {
      // Not JSON, or no variables - nothing to match on.
    }
    return p;
  };

  // Exposed for the test suites, which need to read the tables and drive the dialog
  // without a running Stash. Nothing in the plugin reads this back. Under `__GTTx__`
  // rather than on `window` directly, because that is the only global this repo takes
  // - a test-only surface is no more entitled to a name of its own than a shared one.
  coopObject();   // whichever plugin loaded first, this is what created `__GTTx__`
  window.__GTTx__.ptp2re = {
    PLUGIN_ID: PLUGIN_ID,
    PLUGIN_NAME: PLUGIN_NAME,
    PLUGIN_VERSION: PLUGIN_VERSION,
    README_URL: README_URL,
    TASKS: TASKS,
    TARGETS: TARGETS,
    SOURCES: SOURCES,
    PATHS: PATHS,
    PATH_COLUMNS: PATH_COLUMNS,
    DIAGRAM_NODES: DIAGRAM_NODES,
    diagramGeometry: diagramGeometry,
    DEFAULTS: DEFAULTS,
    pathSelection: pathSelection,
    targetSelection: targetSelection,
    bulkField: bulkField,
    pathById: pathById,
    pathLabel: pathLabel,
    enabledPaths: enabledPaths,
    parsePaths: parsePaths,
    formatPaths: formatPaths,
    pathMode: pathMode,
    settingsFrom: settingsFrom,
    describeFilters: describeFilters,
    pairedBoth: pairedBoth,
    buildPasses: buildPasses,
    buildBatches: buildBatches,
    bulkMutation: bulkMutation,
    passQuery: passQuery,
    sweepQuery: sweepQuery,
    walkSources: walkSources,
    payloadOf: payloadOf,
    entityLabel: entityLabel,
    sourceLabel: sourceLabel,
    fromLabel: fromLabel,
    injectStyle: injectStyle,
    oneQuery: oneQuery,
    reverseQuery: reverseQuery,
    targetParts: targetParts,
    resolveExclusionTagId: resolveExclusionTagId,
    targetOfMutation: targetOfMutation,
    sourceOfMutation: sourceOfMutation,
    SOURCE_REVERSE: SOURCE_REVERSE,
    sourceFieldQuery: sourceFieldQuery,
    sourceFilterQuery: sourceFilterQuery,
    AUTO_COOLDOWN_MS: AUTO_COOLDOWN_MS,
    currentRouteTarget: currentRouteTarget,
    currentSourceRouteTarget: currentSourceRouteTarget,
    manualButtonId: manualButtonId,
    MANUAL_BTN_CLASS: MANUAL_BTN_CLASS,
  };
}());
