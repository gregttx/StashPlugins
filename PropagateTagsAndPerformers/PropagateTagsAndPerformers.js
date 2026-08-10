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
  var PLUGIN_NAME = 'Propagate Tags and Performers to Related Entities';

  // NormalizeParentTags is the one sibling this plugin reads settings from by name
  // - see `checkHierarchySibling` below. MergePerformerTagsToScenes needs no such
  // constant: the overlap with it is detected generically, through `coop().declares`
  // rather than a name lookup, because it is the same kind of collision a future
  // relationship-copying plugin could have too (see the repo-root CLAUDE.md).
  var NPT_ID   = 'NormalizeParentTags';
  var NPT_NAME = 'Normalize Parent Tags';

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and goes current the moment plugins are reloaded, while the browser can
  // still be running a script it cached before the edit - so a heading reading 0.2.0
  // over 0.1.0 behaviour is the normal look of a stale script, not a contradiction.
  // This constant travels inside the file. Bump it with the manifest and the yml;
  // the `version` suite fails if the three disagree.
  //
  // Below 1.0.0 deliberately, and it stays there until the plugin is finished: the
  // major digit is what says "ready to use", and this one has no planner and no
  // buttons yet. Each implementation step is a feature, so it takes the minor digit
  // (0.1.0, 0.2.0, ...); fixes within a step take the patch.
  var PLUGIN_VERSION = '0.12.10';

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
    'running script own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/StashPlugins/blob/main/PropagateTagsAndPerformers/README.md';
  var README_LINK_ID = 'ptp2re-readme-link';
  var DESC_TOGGLE_ID = 'ptp2re-desc-toggle';
  var STYLE_ID       = 'ptp2re-style';

  // Declared in the manifest so Stash lists it under Settings - Tasks - Plugin
  // Tasks, but run in the browser: this plugin has no exec, so a queued job could
  // only fail.
  var TASK_PROPAGATE_ALL = 'Propagate Tags and Performers to All Related Entities';
  var TASKS = [TASK_PROPAGATE_ALL];

  var PAGE_SIZE      = 500;    // targets per page while walking the library
  var CHUNK_SIZE     = 100;    // target ids per bulk mutation
  var LOG_RENDER_CAP = 1000;   // log lines kept in the DOM; all of them stay in memory
  var LOG_FLUSH_MS   = 100;
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
  //   id        stable identifier, published to other plugins via the coop registry
  //   kind      what is copied: 'tags' or 'performers'
  //   setting   its manifest key; the setting is the single source of truth for the
  //             task, the auto modes and whether the button appears
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
  //   mode      manifest key of the "common tags only" toggle, where the path has one
  //   pair      the id of the path that reverses this one, where one exists
  //   hops      1, or 2 where the payload is reached through an intermediate entity
  var PATHS = [
    // Stage 1 - performer assignments, before anything reads performers.
    { id: 'performers:image>gallery', kind: 'performers', stage: 1, hops: 1,
      setting: 'c2PerformersImagesToGalleries', target: 'gallery', sourceType: 'image',
      source: 'Images', button: 'Copy all Perfs from all Images',
      reverse: { backRef: 'galleries' } },
    { id: 'performers:gallery>scene', kind: 'performers', stage: 1, hops: 1,
      setting: 'b5PerformersGalleriesToScenes', target: 'scene', sourceType: 'gallery',
      source: 'Galleries', button: 'Copy all Perfs from all Galleries',
      walk: ['galleries'] },

    // Stage 2 - tags onto scenes.
    { id: 'tags:marker>scene', kind: 'tags', stage: 2, hops: 1,
      setting: 'b3TagsMarkersToScenes', target: 'scene', sourceType: 'marker',
      source: 'Markers', button: 'Copy all Tags from all Markers',
      walk: ['scene_markers'], markerTags: true },
    { id: 'tags:performer>scene', kind: 'tags', stage: 2, hops: 1,
      setting: 'b1TagsPerformersToScenes', target: 'scene', sourceType: 'performer',
      source: 'Performers', button: 'Copy all Tags from all Performers',
      walk: ['performers'] },
    { id: 'tags:studio>scene', kind: 'tags', stage: 2, hops: 1,
      setting: 'b2TagsStudioToScenes', target: 'scene', sourceType: 'studio',
      source: 'Studio', button: 'Copy Tags from Studio',
      walk: ['studio'] },

    // Stage 3 - tags onto galleries.
    { id: 'tags:image>gallery', kind: 'tags', stage: 3, hops: 1,
      setting: 'c1TagsImagesToGalleries', target: 'gallery', sourceType: 'image',
      source: 'Images', button: 'Copy all Tags from all Images',
      pair: 'tags:gallery>image',
      reverse: { backRef: 'galleries' } },

    // Stage 4 - tags onto groups. A Group has no performers and no markers of its
    // own, so those two are two-hop traversals through its scenes.
    { id: 'tags:scene>group', kind: 'tags', stage: 4, hops: 1,
      setting: 'e1TagsScenesToGroups', target: 'group', sourceType: 'scene',
      source: 'Scenes', button: 'Copy {mode} Tags from all Scenes',
      mode: 'e2TagsScenesToGroupsCommonOnly', pair: 'tags:group>scene',
      walk: ['scenes'] },
    { id: 'tags:studio>group', kind: 'tags', stage: 4, hops: 1,
      setting: 'e3TagsStudioToGroups', target: 'group', sourceType: 'studio',
      source: 'Studio', button: 'Copy Tags from Studio',
      walk: ['studio'] },
    { id: 'tags:performer>group', kind: 'tags', stage: 4, hops: 2,
      setting: 'e4TagsPerformersToGroups', target: 'group', sourceType: 'performer',
      source: 'Performers', button: 'Copy all Tags from all Performers',
      walk: ['scenes', 'performers'] },
    { id: 'tags:marker>group', kind: 'tags', stage: 4, hops: 2,
      setting: 'e5TagsMarkersToGroups', target: 'group', sourceType: 'marker',
      source: 'Markers', button: 'Copy all Tags from all Markers',
      walk: ['scenes', 'scene_markers'], markerTags: true },

    // Stage 5 - sub-groups roll up into their containing group. Group.sub_groups is
    // a list of GroupDescription, not of Group, hence the `group` step.
    { id: 'tags:subgroup>group', kind: 'tags', stage: 5, hops: 1,
      setting: 'e6TagsSubGroupsToGroups', target: 'group', sourceType: 'group',
      source: 'Sub-groups', button: 'Copy {mode} Tags from all Sub-groups',
      mode: 'e7TagsSubGroupsToGroupsCommonOnly',
      walk: ['sub_groups', 'group'] },

    // Stage 6 - the reverses, distributing what the stages above gathered. Both
    // close a cycle with a path already in the table, which is why the per-entity
    // cooldown above exists; see CLAUDE.md.
    { id: 'tags:group>scene', kind: 'tags', stage: 6, hops: 1,
      setting: 'b4TagsGroupsToScenes', target: 'scene', sourceType: 'group',
      source: 'Groups', button: 'Copy all Tags from all Groups',
      pair: 'tags:scene>group',
      walk: ['groups', 'group'] },
    { id: 'tags:gallery>image', kind: 'tags', stage: 6, hops: 1,
      setting: 'd1TagsGalleriesToImages', target: 'image', sourceType: 'gallery',
      source: 'Galleries', button: 'Copy all Tags from all Galleries',
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
  var SOURCES = {
    performer: { label: 'Performer', fields: 'id name' },
    studio: { label: 'Studio', fields: 'id name' },
    // A marker's title is optional and usually blank. `sourceLabel` falls back to the
    // primary tag, which is what Stash itself shows on the scene's marker list, and
    // which every marker path already selects.
    marker: { label: 'Marker', fields: 'id title' },
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

  function enabledPaths(s) {
    return PATHS.filter(function (p) { return !!s[p.setting]; });
  }

  // A manual button's caption: "Copy [all|common] [Tags|Perfs] [to|from] all
  // <plural>". Only the two paths carrying a "common tags only" toggle (`e1`'s
  // `tags:scene>group`, `e6`'s `tags:subgroup>group`) have a `{mode}` token to fill in
  // - every other path's `button` is already the final string, same as it always was.
  // Reads whichever mode is currently configured, so the two buttons whose meaning
  // depends on it never show a caption the setting has moved past.
  function buttonLabel(path, s) {
    if (!path.mode) return path.button;
    return path.button.replace('{mode}', (s && s[path.mode]) ? 'common' : 'all');
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

    b1TagsPerformersToScenes: false,
    b2TagsStudioToScenes: false,
    b3TagsMarkersToScenes: false,
    b4TagsGroupsToScenes: false,
    b5PerformersGalleriesToScenes: false,

    c1TagsImagesToGalleries: false,
    c2PerformersImagesToGalleries: false,

    d1TagsGalleriesToImages: false,

    e1TagsScenesToGroups: false,
    e2TagsScenesToGroupsCommonOnly: false,
    e3TagsStudioToGroups: false,
    e4TagsPerformersToGroups: false,
    e5TagsMarkersToGroups: false,
    e6TagsSubGroupsToGroups: false,
    e7TagsSubGroupsToGroupsCommonOnly: false,

    f1ExcludeTargetWithTagName: '',
    f2ExcludeTargetOrganized: false,
    f3ExcludeTagWithIgnoreAutoTag: false,
    f4ExcludeTagWithCustomFieldName: '',

    g1LogToConsole: false,
  };

  // ── Cross-plugin cooperation ──────────────────────────────────────────────
  //
  // See "Cross-plugin cooperation: the bulk-edit lease" in the repo-root CLAUDE.md.
  // A lease asks reactive plugins in this tab to stand down while we write. It is
  // advisory and always expires, so a crash cannot disable anyone permanently.
  //
  // This plugin is on both sides of the protocol, like both of its siblings and for
  // the same reason: the roles are per *run*, not per plugin. The library-wide task
  // is bulk; the two automatic modes are reactive.
  function coop() {
    var c = window.StashPluginCoop;
    if (!c || typeof c !== 'object') c = window.StashPluginCoop = {};
    if (!c.leases) c.leases = [];
    if (!c.respecters) c.respecters = {};
    if (!c.declares) c.declares = {};
    if (!c.order) c.order = {};
    return c;
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
  function loadSettings() {
    return gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var all = (data.configuration || {}).plugins || {};
      var raw = all[PLUGIN_ID] || {};
      var s = {};
      for (var k in DEFAULTS) {
        if (!hasOwn(DEFAULTS, k)) continue;
        s[k] = typeof DEFAULTS[k] === 'boolean' ? !!raw[k] : (raw[k] || '');
      }
      return { settings: s, all: all };
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
    'width:min(56rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
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
    // The log's own line kinds, which the siblings do not share: this plugin adds
    // both tags and performers, so ADD alone would not say which.
    '.ptp2re-ERROR{color:#ff7373;} .ptp2re-WARN{color:#ffb648;} .ptp2re-TAG{color:#84d68a;}' +
    '.ptp2re-PERF{color:#7cc4ff;} .ptp2re-INFO{color:#a7b6c2;}' +
    '.ptp2re-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.ptp2re-foot button{margin-right:.5rem;}' +
    '.ptp2re-hidden{display:none;}' +
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
    'text-decoration:underline;}';

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
  // script this page already fetched and executed. So the manifest can say 0.2.0
  // while the browser is still running 0.1.0, and every surface Stash renders - the
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

  function startRun(taskName) {
    if (_active) { _active.focus(); return; }
    _active = new Run(taskName);
    _active.begin();
  }

  function Run(taskName) {
    this.taskName = taskName;
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
    this.cancelled = false;
    this.stopped = false;
    this.lines = [];
    this.pending = [];
    // `lines` is the export buffer and survives a Rescan, because Copy log is meant
    // to hand over the whole session. `viewLines` counts what has gone into the log
    // since the current pass emptied the view, which is what the progress line
    // describes: a rescan logging four lines must not report 28161 of them, nor
    // claim to be hiding the 27161 it no longer has.
    this.viewLines = 0;
    this.state = 'scanning';
  };

  Run.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'ptp2re-backdrop');
    this.modal = el('div', 'ptp2re-modal');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'ptp2re-head');
    head.appendChild(el('div', 'ptp2re-title', PLUGIN_NAME + ' - ' + this.taskName));
    // The Undo button reverses this dialog's own writes while it is open. That is
    // not a restore and must never be allowed to read as one, so the backup
    // instruction leads and the limits are stated beside it rather than left to be
    // discovered.
    head.appendChild(el('div', 'ptp2re-warn',
      'Back up your database before proceeding. This only ever adds tags and performers, but ' +
      'Undo reverses only what this dialog wrote, only while it stays open, and cannot account ' +
      'for changes made elsewhere in the meantime.'));
    // Every name in this log carries a number in brackets and it is always a Stash
    // id, never a count - the counts are written as `x250` or spelled out. Nothing
    // else in the dialog says so, and an id read as "250 of these" is the kind of
    // misreading that gets a library-wide write approved for the wrong reason.
    head.appendChild(el('div', 'ptp2re-legend',
      'Reading the log: the number in brackets after a name is that entity\'s, tag\'s or ' +
      'performer\'s Stash id - Scene "My Scene" (123) is the scene with id 123. Counts are ' +
      'written as x250, never in brackets.'));
    this.noteEl = el('div', 'ptp2re-note', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.progressEl = el('div', 'ptp2re-progress', 'Starting...');
    this.modal.appendChild(this.progressEl);

    this.logEl = el('div', 'ptp2re-log');
    this.modal.appendChild(this.logEl);

    var foot = el('div', 'ptp2re-foot');
    this.proceedBtn = button('Proceed', 'ptp2re-proceed');
    this.cancelBtn  = button('Cancel', 'ptp2re-cancel');
    this.stopBtn    = button('Stop', 'ptp2re-stop ptp2re-hidden');
    this.copyBtn    = button('Copy log', 'ptp2re-copy');
    this.undoBtn    = button('Undo', 'ptp2re-undo ptp2re-hidden');
    this.rescanBtn  = button('Rescan', 'ptp2re-rescan ptp2re-hidden');
    this.closeBtn   = button('Close', 'ptp2re-close ptp2re-hidden');
    this.proceedBtn.disabled = true;
    this.undoBtn.title = 'Reverse every change this dialog has written, as an add/remove delta. ' +
      'Only what this dialog wrote, and only while it stays open.';

    this.proceedBtn.addEventListener('click', function () { self.proceed(); });
    this.cancelBtn.addEventListener('click', function () { self.cancel(); });
    this.stopBtn.addEventListener('click', function () { self.stop(); });
    this.copyBtn.addEventListener('click', function () { self.copy(); });
    this.undoBtn.addEventListener('click', function () { self.undo(); });
    this.rescanBtn.addEventListener('click', function () { self.rescan(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });

    [this.proceedBtn, this.cancelBtn, this.stopBtn, this.copyBtn, this.undoBtn,
      this.rescanBtn, this.closeBtn].forEach(function (b) { foot.appendChild(b); });
    this.modal.appendChild(foot);

    document.body.appendChild(this.backdrop);
  };

  Run.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
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
    // Undo is deliberately not gated on `stale`: it reverses writes this dialog has
    // already made, and stranding the user with changes they cannot take back would
    // be a worse outcome than the mismatch it is protecting them from.
    this.proceedBtn.disabled = !ready || !this.plan.length || this.stale;
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

  Run.prototype.log = function (kind, message) {
    var line = '[' + kind + '] ' + message;
    this.lines.push(line);
    this.viewLines++;
    this.pending.push({ kind: kind, line: line });
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
    pending.forEach(function (p) {
      this.logEl.appendChild(el('div', 'ptp2re-line ptp2re-' + p.kind, p.line));
    }, this);
    while (this.logEl.childNodes && this.logEl.childNodes.length > LOG_RENDER_CAP) {
      this.logEl.removeChild(this.logEl.firstChild);
    }
    if (typeof this.logEl.scrollHeight === 'number') this.logEl.scrollTop = this.logEl.scrollHeight;
    this.renderProgress();
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
      summary = 'Scanning. ' + this.plan.length + ' change(s) found';
    } else if (this.state === 'ready') {
      summary = 'Review complete. ' + this.plan.length + ' entity change(s) planned, ' +
        this.viewLines + ' log line(s)';
    } else if (this.state === 'applying') {
      summary = 'Applying. ' + this.applied + ' of ' + this.plan.length + ' entities updated';
    } else if (this.state === 'undoing') {
      summary = 'Undoing. ' + this.undone + ' of ' + this.undoTotal + ' change(s) reversed';
    } else {
      summary = 'Finished. ' + this.applied + ' entity change(s) applied' +
        (this.failed ? ', ' + this.failed + ' failed' : '') +
        (this.undone ? ', ' + this.undone + ' reversed by Undo' : '');
    }
    if (this.errors) summary += ', ' + this.errors + ' error(s)';
    if (this.viewLines > LOG_RENDER_CAP) {
      summary += ' - showing the last ' + LOG_RENDER_CAP + ' of ' + this.viewLines + ' lines';
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
    this.renderProgress();
    this.log('INFO', PLUGIN_NAME + ' - ' + this.taskName + ' - reviewing, nothing will be ' +
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

      var paths = enabledPaths(self.settings);
      // Published whether or not there is anything to scan: another plugin's own
      // overlap check must see "nothing enabled" as promptly as it sees anything
      // else, and the early return below must not skip it.
      publishDeclares(self.settings);
      if (!paths.length) {
        self.log('WARN', 'No paths are enabled. Turn on at least one in Settings - Plugins - ' +
          PLUGIN_NAME + ', then run the task again.');
        self.finishScan();
        return;
      }

      // Stated because it is not a presentation choice: the paths cascade, so the
      // order decides what a single run reaches. A user who expects marker tags to
      // arrive on a group in one pass needs to see that markers run before groups.
      self.log('INFO', 'Enabled, in the order they run: ' +
        paths.map(function (p) { return pathLabel(p); }).join('; ') + '.');

      var both = pairedBoth(paths);
      both.forEach(function (p) {
        self.note('Both directions of a reversible pair are enabled (' + pathLabel(p) +
          ' and ' + pathLabel(pathById(p.pair)) + '). Applied together they drive every ' +
          'member to the same set of tags. That is what running both directions means, not ' +
          'a fault - but disable one, or turn on "common tags only", if it is not what you want.');
      });

      self.checkDeclaredOverlap(paths);
      self.checkHierarchySibling(loaded.all[NPT_ID]);

      var filters = describeFilters(self.settings);
      self.log('INFO', filters.length
        ? 'Exclusion filters in force: ' + filters.join('; ') + '.'
        : 'No exclusion filters are configured; nothing is skipped.');

      return self.scan(paths);
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

  Run.prototype.scan = function (paths) {
    var self = this;
    this.passes = buildPasses(paths);
    return gqlRequest(tagQuery(this.settings), null).then(function (data) {
      self.tagMap = buildTagMap(((data.findTags || {}).tags) || []);

      var excludeTagId = resolveExclusionTagId(self.settings, self.tagMap);
      if (excludeTagId) {
        self.log('INFO', 'Exclusion tag resolved: ' + tagLabel(self.tagMap, excludeTagId) + '.');
      }
      self.filters = makeFilters(self.settings, self.tagMap, excludeTagId);

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
      // A hook the manual-button existence probe uses: whether this path found any
      // sources at all, independent of whether there is anything left to add below.
      // No-op for the task and for a normal auto-mode reaction, neither of which sets
      // it - only `checkButtonExistence` does.
      if (self.recordExistence) self.recordExistence(path.id, !!(agg && agg.n));
      // Nothing to aggregate. Under either mode this is "add nothing" - the
      // intersection of no sets is not everything here, it is emptiness, because a
      // group with no scenes has no scenes agreeing on anything.
      if (!agg || !agg.n) return;
      var counts = agg.counts, first = agg.first;

      // Union, or only what every source carries. One source makes the two the same
      // answer, which is the behaviour the setting's description promises.
      var common = path.mode && self.settings[path.mode];
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
        // The entry is created lazily, so a target with nothing to add never enters
        // the plan and never appears in the count Proceed is enabled on.
        if (!entry) entry = self.planEntry(pass.target, path.kind, ent);
        if (entry.has[id]) return;      // another path already asked for it
        entry.has[id] = true;
        entry.add.push(id);
        // Held on the entry, not recomputed: phase 2 and Undo log the same attribution
        // for the same addition, and by then the sources are long out of scope.
        entry.from[id] = fromLabel(first[id], counts[id]);
        self.log(path.kind === 'performers' ? 'PERF' : 'TAG',
          entry.label + ' - ' +
          (path.kind === 'performers'
            ? performerLabel(self.performerNames, id)
            : tagLabel(self.tagMap, id)) +
          ' - from ' + entry.from[id]);
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

  // The mirror of `MergePerformerTagsToScenes`' own check against the same sibling.
  // Unlike the overlap above, this is not "the same path" - it is prune/roll-up
  // along the tag *hierarchy* colliding with an addition along an entity
  // *relationship*, which applies equally to any of this plugin's eleven tag paths
  // regardless of which one added the tag. That is why it stays a name-based check
  // reading NormalizeParentTags' own settings, rather than folding into `declares`:
  // there is no path id on either side for a generic scan to match.
  Run.prototype.checkHierarchySibling = function (ps) {
    if (!ps) return;
    var prune = !!ps.a8AutoPruneOnUpdate, rollup = !!ps.a9AutoRollUpOnUpdate;
    // Both at once is that plugin's own documented no-op - they are exact inverses,
    // so it runs neither - and warning about a mode that is not running would send
    // the user to turn off something already inert.
    if (prune === rollup) return;

    var mode = prune ? 'Auto Prune on Entity Updates' : 'Auto Roll Up on Entity Updates';
    var effect = prune
      ? 'it will remove the tags this run adds, wherever a more specific tag on the same ' +
        'entity already implies them'
      : 'it will add every ancestor of the tags this run adds';

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
      self.note('This page is running ' + PLUGIN_NAME + ' ' + PLUGIN_VERSION + ', but ' +
        installed + ' is installed. Reload the page (F5) and run the task again; if this ' +
        'warning comes back, hard-refresh with Ctrl+Shift+R. Proceed stays disabled until the ' +
        'script matches, since the plan would be computed by the older code.');
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
  Run.prototype.recap = function (source, verb) {
    var self = this;
    ['tags', 'performers'].forEach(function (kind) {
      var counts = source[kind] || {};
      var ids = [];
      for (var id in counts) if (hasOwn(counts, id)) ids.push(id);
      if (!ids.length) return;
      if (kind === 'tags') {
        ids.sort(function (a, b) {
          var c = collator().compare(sortKey(self.tagMap, a), sortKey(self.tagMap, b));
          return c !== 0 ? c : numericId(a, b);
        });
      } else {
        ids.sort(function (a, b) {
          var c = collator().compare(self.performerNames[a] || a, self.performerNames[b] || b);
          return c !== 0 ? c : numericId(a, b);
        });
      }
      var label = kind === 'tags' ? 'tag' : 'performer';
      self.log('INFO', ids.length + ' ' + label + '(s) ' + verb + ': ' +
        ids.map(function (id) {
          var name = kind === 'tags' ? tagLabel(self.tagMap, id) : performerLabel(self.performerNames, id);
          // The count is written x250 and never in brackets - the head legend says
          // so, and a count in brackets on this line would make it false.
          return name.replace(/^(Tag|Performer) /, '') + ' x' + counts[id];
        }).join(', '));
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
      this.log('INFO', 'Review complete: ' + adds + ' addition(s) across ' + this.plan.length +
        ' entity change(s) in ' + buildBatches(this.plan).length + ' request(s). Nothing has been ' +
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
  Run.prototype.changeLine = function (batch, entry, id, prefix) {
    return (prefix || '') + entry.label + ' - ' +
      (batch.kind === 'performers'
        ? performerLabel(this.performerNames, id)
        : tagLabel(this.tagMap, id)) +
      (entry.from[id] ? ' - from ' + entry.from[id] : '');
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
        batch.entries.forEach(function (entry) {
          batch.ids.forEach(function (id) {
            self.log(batch.kind === 'performers' ? 'PERF' : 'TAG',
              self.changeLine(batch, entry, id));
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
    this.log('INFO', 'Applying ' + this.plan.length + ' entity change(s) - ' +
      new Date().toISOString());

    this.runBatches(buildBatches(this.plan), this.taskName,
      function (b) { return self.applyBatch(b); },
      'Apply', Run.prototype.finishApply);
  };

  Run.prototype.finishApply = function () {
    this.log('INFO', 'Finished. ' + this.applied + ' entity change(s) applied' +
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
        batch.entries.forEach(function (entry) {
          batch.ids.forEach(function (id) {
            self.log(batch.kind === 'performers' ? 'PERF' : 'TAG',
              self.changeLine(batch, entry, id, 'Undo - '));
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
      this.undoBtn.textContent = 'Undo ' + batchCount(this.undoable) + ' change(s)?';
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
    this.log('INFO', 'Undoing ' + this.undoTotal + ' entity change(s) - ' +
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
    this.log('INFO', 'Undo finished. ' + this.undone + ' entity change(s) reversed' +
      (this.undoFailed ? ', ' + this.undoFailed + ' could not be' : '') +
      (this.stopped ? ' (stopped early; what was reversed stays reversed)' : '') +
      (this.undoable.length
        ? '. ' + batchCount(this.undoable) + ' change(s) are still applied.'
        : '. Everything this dialog wrote has been taken back.'));
    this.recap(this.undoneCounts, 'removed again');
    // Always finishes in `done`, even when it started from `ready`: a plan reviewed
    // against the library as it was no longer describes it, so Rescan is the honest
    // next step rather than a Proceed left armed over ground that has moved.
    this.setState('done');
    this.flush();
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
    while (this.logEl.firstChild) this.logEl.removeChild(this.logEl.firstChild);
    this.begin();
  };

  Run.prototype.copy = function () {
    var text = this.lines.join('\n');
    var self = this;
    function done(ok) {
      self.copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { self.copyBtn.textContent = 'Copy log'; }, 2000);
    }
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
  };

  Run.prototype.close = function () {
    this.disarmUndo();
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    if (_active === this) _active = null;
  };

  // ── The settings page ─────────────────────────────────────────────────────

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
    if (_autoSettingsWait) return _autoSettingsWait;
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
    return _autoSettingsWait;
  }

  // Our own settings being saved invalidates the cache rather than waiting out the
  // TTL, so switching a mode off takes effect on the next save and not ten seconds
  // later.
  function invalidateAutoSettings() { _autoSettings = null; _autoSettingsAt = 0; }

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
  //     verified than it was until 0.4.0. `kind: 'filter'`.
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

  function resolveFilterReverse(entry, id) {
    var t = TARGETS[entry.on];
    var out = [], fetched = 0;
    function page(n) {
      return gqlRequest(sourceFilterQuery(entry), { id: String(id), page: n, per_page: t.pageSize })
        .then(function (data) {
          var res = data[t.find] || {};
          var list = res[t.node] || [];
          fetched += list.length;
          list.forEach(function (node) { out = out.concat(entry.pick(node)); });
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
  function resolveSourceTargets(path, ids) {
    var entry = SOURCE_REVERSE[path.id];
    if (!entry) return Promise.resolve([]);
    var out = {};
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        var got = entry.kind === 'filter' ? resolveFilterReverse(entry, id) : resolveFieldReverse(entry, id);
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

  ['planEntry', 'plannedFor', 'addSource', 'aggregate', 'planTarget'].forEach(function (m) {
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

  // Writes the plan. One lease for the whole reaction, renewed per batch, released
  // whatever happens - an error here must not latch a sibling into standing down.
  AutoRun.prototype.apply = function (label) {
    var self = this;
    var batches = buildBatches(this.plan);
    if (!batches.length) return Promise.resolve(0);
    var lease = acquireLease(label, AUTO_LEASE_TTL_MS);
    var chain = Promise.resolve();
    batches.forEach(function (batch) {
      chain = chain.then(function () {
        lease.renew();
        return gqlRequest(bulkMutation(batch.target), { input: batchInput(batch, 'ADD') })
          .then(function () {
            batch.entries.forEach(function (entry) {
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
            console.error('[ptp2re] auto mode: a batch of ' + batch.entries.length +
              ' ' + batch.target + '(s) failed:', e);
          });
      });
    });
    return chain.then(function () {
      lease.release();
      return self.written;
    }, function (e) {
      lease.release();
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
    var node = null;
    for (var key in DEFAULTS) {
      if (!hasOwn(DEFAULTS, key)) continue;
      node = settingElement(key);
      if (node) break;
    }
    for (var d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return node;
    }
    return null;
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
  // so the h3 there reads "... (0.1.0)" - and, because that template interpolates
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

  function settingsTick() {
    ensureReadmeLink();
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
  function installSelectPatches() {
    var api = window.PluginApi;
    if (!api || !api.patch || typeof api.patch.before !== 'function') return false;
    try {
      api.patch.before('TagSelect', function (props) { captureSelect(_tagCaptures, props); return [props]; });
      api.patch.before('PerformerSelect', function (props) { captureSelect(_perfCaptures, props); return [props]; });
      return true;
    } catch (e) {
      console.warn('[ptp2re] could not patch TagSelect/PerformerSelect:', e);
      return false;
    }
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

  // ── The click: plan one entity, then save or stage it ───────────────────────
  //
  // `guarded()` around the whole thing for the same reason auto mode needs it: with
  // "save immediately" on, `run.apply()` issues the very bulk mutation the fetch
  // wrapper watches for, and without the guard a click would react to its own write.
  function runManual(target, id) {
    return autoSettings().then(function (s) {
      var paths = enabledPaths(s).filter(function (p) { return p.target === target; });
      if (!paths.length) throw new Error('no enabled paths into this page');
      return guarded(function () {
        return autoContext(s).then(function (ctx) {
          var run = new AutoRun(s, ctx.tagMap, ctx.filters);
          return run.planEntities(target, paths, [String(id)]).then(function () {
            if (s.a2SaveImmediately) {
              return run.apply('manual: ' + TARGETS[target].label + ' ' + id).then(function (n) {
                return { mode: 'saved', count: n };
              });
            }
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
      ? ' - copies and saves immediately.'
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
    // No horizontal one either, and that is 0.12.4: `applyButtonSpacing` copies the
    // row's own margins inline, and a Bootstrap `mx-*` class is `!important`, so a
    // spacing class here would outrank them. It adds `mx-1` back itself when there is
    // nothing to copy.
    var btn = el('button', 'btn btn-secondary ' + MANUAL_BTN_CLASS, label);
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
      runManual(target, id).then(function (result) {
        btn.disabled = false;
        btn.textContent = result.count ? ('Added ' + result.count) : 'No changes';
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
  // reliable way to find Save, which carries no distinguishing class, and - since
  // 0.12.1 - the only reliable way to find Delete either, on the rows where it
  // carries no `.delete`.
  //
  // Matches `<a>` as well as `<button>`, and trims before comparing. Stash styles
  // some row actions as links rather than buttons, and neither the tag nor the
  // surrounding whitespace is something this plugin should have to be right about:
  // the cost of accepting both is nil, and the cost of guessing wrong is a button
  // silently landing in the wrong place, which is exactly the bug 0.12.1 fixes.
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

  // Shared by both the target and source sides (0.11.0 unified them). The design
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
  // 0.12.1: the middle search is new, and it is the whole fix. Every version up to
  // 0.12.0 looked for Delete *only* by `.delete`, on the strength of a note in the
  // repo CLAUDE.md that said Stash gives Delete that class "throughout". It does
  // not. It carries it on the detail-view navbar - which is where the claim was
  // actually confirmed, and where `findDetailContainer` and `findManualButtonContainer`
  // both still rely on it to tell a navbar from an edit form - but the Scene edit
  // row renders Delete as `btn btn-danger` with no `.delete` at all. On that row the
  // class search found nothing, the Save fallback caught it, and every button landed
  // *before* Save instead of between Save and Delete.
  //
  // That one over-generalisation is worth naming, because it cost four versions of
  // anchor churn (0.9.0-0.12.0) that all moved the anchor between Save and Delete
  // without ever fixing the reason Delete could not be found:
  //   0.11.0 collapsed to Delete-only, since "between Save and Delete" was what live
  //          feedback asked for and Delete alone produces that whenever both exist.
  //   0.12.0 restored the Save fallback, because Group's edit form has no Delete and
  //          a plain append had put a button *after* Save.
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

  // 0.9.1 tried to space a wrapped row against the one above it with `my-1` on the
  // button itself, live-tested as a regression: `.edit-buttons`/`.details-edit` are
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
  // 0.12.3: `row-gap` only ever worked on half the pages, and the measurement that
  // proved it is worth keeping. On a live Stash `.edit-buttons` computes to
  // **`display: block`** - not a flex row at all - so `row-gap` there is inert and
  // wrapped rows sat flush against each other, while Group's `.details-edit`, which
  // *is* flex, spaced correctly from the identical call. Same code, same value,
  // opposite result, decided entirely by the container.
  //
  // So the container is asked which it is, and gets the mechanism that works there:
  // `row-gap` where it is honoured, and a bottom margin on our own buttons where it
  // is not. The margin is safe in a block container for exactly the reason 0.9.2
  // found it unsafe in a flex one - that regression was a flex line taking its
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
  // 0.12.4: the donor no longer has to be a `<button>`. Stash styles some row actions
  // as links - already established at 0.12.1, where Delete turned out to be an `<a>` on
  // the Scene edit row - so a row whose actions are all links had no donor at all and
  // fell back to the utility class. What identifies a donor is the `btn` class plus the
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
  // models one that is rebuilt on every read (0.8.1's bug).
  function childIndex(kids, button) {
    for (var i = 0; i < kids.length; i++) { if (kids[i] === button) return i; }
    return -1;
  }

  // The element whose margin actually borders ours. A row's DOM siblings are not all
  // row actions: React wraps some of them (a file input beside its button, a dropdown
  // beside its toggle), and a wrapper carries no margin of its own while the action
  // inside it does. Reading the wrapper therefore reports "contributes nothing" for a
  // neighbour that plainly contributes a gap - which is what made 0.12.5 double the
  // space before our first button on Group's two pages and nowhere else. This fixed
  // Group's *edit* row at 0.12.7; its detail row needed `neighbourGap` to walk past the
  // element entirely, one release later.
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
  // outward from it rather than stopping at the first DOM sibling. 0.12.7 resolved
  // *through* a wrapper to the action inside it; 0.12.8 also walks *past* an element
  // holding no action at all, because the two are the same mistake one step apart:
  // **a zero read off something this code cannot identify as an action is not evidence
  // of a zero gap.** Group's detail row is the case - the element before our first
  // button holds nothing we recognise, so its (absent) margin was being taken for the
  // whole gap and the real one was doubled on top of it, three releases running.
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
  // consulting a layout that has not settled yet (0.12.6).
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

  // 0.12.5. The gap between two inline siblings is the first's right margin plus the
  // second's left margin, so what our button needs on a given side depends on what its
  // neighbour already contributes - not on what one donor button happens to carry.
  // Copying the donor's margins wholesale (0.12.4) gave every button of ours
  // `margin-left: 0`, which is correct on a row where every button carries a right
  // margin - Scene's `.edit-buttons`, where it is also what keeps a wrapped second row
  // flush with the first - and wrong on a row where they do not. Stash's own detail
  // navbars are inconsistently spaced: `Auto tag...` and `Merge` touch each other on
  // Performer, and landing after one of the marginless ones left our button touching it
  // too, live-reported at 0.12.4.
  //
  // 0.12.6 tried to *measure* that contribution with `getBoundingClientRect` instead of
  // deriving it, on the reasoning that a gap is a distance and a margin is only one of
  // the things that can produce one. 0.12.7 takes it back out, because a distance is
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
  // 0.12.4 is the version that made 0.12.3's measurement actually reach the page, and
  // the reason it did not is worth stating: **Bootstrap's spacing utilities are
  // `!important`**. `mx-1` on our own button therefore beat the inline `margin-left` /
  // `margin-right` 0.12.3 set from the row's own convention - so every horizontal gap
  // stayed exactly what it had been, while `margin-bottom` (which no class sets) took
  // effect and visibly fixed the wrapped-row spacing in the same release. A fix that
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
  // 0.12.2: "ours" has to mean both classes. This helper is shared verbatim by
  // `manualButtonsTick` and `manualSourceButtonsTick`, but it only ever excluded
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
      if (kids[i].textContent === label) return true;
    }
    return false;
  }

  // Whether each of `paths` actually finds a source on this one entity - independent
  // of whether there is anything left to *add*, which is what a click's diff decides.
  // A scene can have performers whose tags are already all copied in and still show
  // "No changes" on click - that is deferred (see the button-existence note below);
  // this only answers "is there a performer here at all". Reuses `AutoRun`'s own
  // fetch and walk via `Run.prototype.planTarget`'s `recordExistence` hook, rather
  // than a second query shape, so a button's visibility can never disagree with what
  // a click into the same entity would see.
  function checkButtonExistence(target, paths, id, s) {
    return autoContext(s).then(function (ctx) {
      var run = new AutoRun(s, ctx.tagMap, ctx.filters);
      var has = {};
      run.recordExistence = function (pathId, exists) { has[pathId] = exists; };
      return run.planEntities(target, paths, [String(id)]).then(function () { return has; });
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
  var _existenceCheck = null; // { target, id, pathsKey, status: 'pending'|'ready', has }

  // Reconciles the container's buttons against the currently enabled paths for this
  // page, adding what is missing and dropping what no longer belongs - a stale
  // button left over from the previous entity, or every button at once when the
  // setting is off or the page is not one of the four.
  function manualButtonsTick() {
    autoSettings().then(function (s) {
      var rt = s.a1ShowManualButtons ? currentRouteTarget() : null;
      if (!rt) { clearManualButtons(); return; }
      var container = findManualButtonContainer();
      if (!container) { clearManualButtons(); return; }
      ensureRowSpacing(container);
      // A path another plugin also declares, whose button is already visible right
      // here, is dropped from what we want before either loop below ever sees it -
      // so the removal loop tears an earlier one of ours down the moment a sibling
      // plugin's appears, and the add loop never puts a second one up beside it.
      var paths = enabledPaths(s).filter(function (p) { return p.target === rt.target; })
        .filter(function (p) {
          return !(otherPluginDeclaresPath(p.id) && foreignButtonAlreadyShows(container, buttonLabel(p, s)));
        });
      if (!paths.length) { clearManualButtons(); return; }
      // Existence gating: a button whose path finds nothing on this entity - no
      // performers, no studio, no markers, no groups - stays off rather than sitting
      // there only to report "No changes" on every click. This is deliberately
      // narrower than Improvement #4's deferred "would this actually add anything":
      // a scene with performers whose tags are already all present still shows its
      // button, only an *absent* relationship hides one - matching what
      // MergePerformerTagsToScenes' own two buttons already do. The probe is async,
      // so a button that was showing a moment ago can disappear for one tick while a
      // fresh one is checked; there is no synchronous way to know without the query.
      var wantKey = pathIdsKey(paths);
      if (!_existenceCheck || _existenceCheck.target !== rt.target ||
          _existenceCheck.id !== rt.id || _existenceCheck.pathsKey !== wantKey) {
        var check = _existenceCheck = { target: rt.target, id: rt.id, pathsKey: wantKey, status: 'pending', has: null };
        checkButtonExistence(rt.target, paths, rt.id, s).then(function (has) {
          if (_existenceCheck === check) { check.has = has; check.status = 'ready'; manualButtonsTick(); }
        }, function (e) {
          // A failed probe must not silently hide every button on the page - the
          // recorded preference is a button that is sometimes unneeded over one that
          // is missing when it was needed, and a network hiccup is exactly that
          // trade. `has: null` below is read as "show everything".
          console.error('[ptp2re] button existence check failed:', e);
          if (_existenceCheck === check) { check.status = 'ready'; check.has = null; manualButtonsTick(); }
        });
      }
      if (_existenceCheck.status !== 'ready') { clearManualButtons(); return; }
      if (_existenceCheck.has) {
        paths = paths.filter(function (p) { return _existenceCheck.has[p.id]; });
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
        var label = buttonLabel(p, s);
        var existing = document.getElementById(manualButtonId(p));
        if (existing && existing._ptp2reEntityId === rt.id && existing._ptp2reLabel === label) return;
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        insertBeforeImportantAction(container, buildManualButton(p, label, rt.target, rt.id, !!s.a2SaveImmediately));
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

  // The source-side counterpart to each path's target-side `button` label. Keyed
  // separately, rather than derived from `path.button`, because the two read in
  // opposite directions ("from all Performers" versus "to all Scenes") and a table
  // that tried to flip one string into the other would be harder to audit than two
  // short tables. A path missing here gets no source button - both marker paths, on
  // purpose (see above).
  var SOURCE_BUTTON_LABELS = {
    'tags:performer>scene': 'Copy Tags to all Scenes',
    'tags:performer>group': 'Copy Tags to all Groups',
    'tags:studio>scene': 'Copy Tags to all Scenes',
    'tags:studio>group': 'Copy Tags to all Groups',
    'tags:scene>group': 'Copy {mode} Tags to all Groups',
    'performers:gallery>scene': 'Copy Perfs to all Scenes',
    'tags:gallery>image': 'Copy Tags to all Images',
    'performers:image>gallery': 'Copy Perfs to all Galleries',
    'tags:image>gallery': 'Copy Tags to all Galleries',
    'tags:group>scene': 'Copy Tags to all Scenes',
    'tags:subgroup>group': 'Copy {mode} Tags to all Containing Groups',
  };

  function sourceButtonLabel(path, s) {
    var template = SOURCE_BUTTON_LABELS[path.id];
    if (!path.mode) return template;
    return template.replace('{mode}', (s && s[path.mode]) ? 'common' : 'all');
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
  function checkSourceButtonExistence(paths, id) {
    var has = {};
    var chain = Promise.resolve();
    paths.forEach(function (p) {
      chain = chain.then(function () {
        return resolveSourceTargets(p, [String(id)]).then(function (ids) { has[p.id] = ids.length > 0; });
      });
    });
    return chain.then(function () { return has; });
  }

  function manualSourceButtonTitle(path) {
    return pathLabel(path) + ' - copies and saves immediately into every ' +
      TARGETS[path.target].label.toLowerCase() + ' this reaches. There is no staging ' +
      'here: the write fans out to many entities at once, and there is no single form ' +
      'to stage it into.';
  }

  // The click: resolve which targets this source reaches, then plan and apply just
  // this one path onto them - not `runAutoTargets`' "replan everything enabled for
  // this target", which would pull in *other* sources' paths too and do more than
  // the button that was clicked promised. `guarded()` around the whole thing, same
  // reason as `runManual`: `run.apply()` issues the bulk mutation the fetch wrapper
  // watches for, and without it a click would react to its own write.
  function runManualSource(path, id) {
    return autoSettings().then(function (s) {
      return guarded(function () {
        return resolveSourceTargets(path, [String(id)]).then(function (targetIds) {
          if (!targetIds.length) return 0;
          return autoContext(s).then(function (ctx) {
            var run = new AutoRun(s, ctx.tagMap, ctx.filters);
            return run.planEntities(path.target, [path], targetIds).then(function () {
              return run.apply('manual source: ' + path.id + ' ' + id);
            });
          });
        });
      });
    }).then(function (n) { return { count: n }; });
  }

  function buildManualSourceButton(path, label, id) {
    // No margin of either axis here - same reasoning as the target-side button above,
    // and `applyButtonSpacing` handles both. Studio can show two of these at once and
    // wraps just as readily.
    var btn = el('button', 'btn btn-secondary ' + MANUAL_SRC_BTN_CLASS, label);
    btn.type = 'button';
    btn.id = manualSourceButtonId(path);
    btn._coopOwner = PLUGIN_ID; // read by `insertOrdered`'s cross-plugin priority scan
    btn._ptp2reEntityId = id;
    btn._ptp2reLabel = label;
    btn.style = 'align-self:flex-start;';
    btn.title = manualSourceButtonTitle(path);
    btn.addEventListener('click', function (event) {
      if (event && event.preventDefault) event.preventDefault();
      var orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Working...';
      runManualSource(path, id).then(function (result) {
        btn.disabled = false;
        btn.textContent = result.count ? ('Added ' + result.count) : 'No changes';
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

  var _existenceCheckSrc = null; // same shape as `_existenceCheck`, keyed on sourceType instead of target

  function manualSourceButtonsTick() {
    autoSettings().then(function (s) {
      var rt = s.a1ShowManualButtons ? currentSourceRouteTarget() : null;
      if (!rt) { clearManualSourceButtons(); return; }
      var container = findDetailContainer();
      if (!container) { clearManualSourceButtons(); return; }
      ensureRowSpacing(container);
      var paths = PATHS.filter(function (p) {
        return p.sourceType === rt.sourceType && !!s[p.setting] && hasOwn(SOURCE_BUTTON_LABELS, p.id);
      }).filter(function (p) {
        return !(otherPluginDeclaresPath(p.id) && foreignButtonAlreadyShows(container, sourceButtonLabel(p, s)));
      });
      if (!paths.length) { clearManualSourceButtons(); return; }
      var wantKey = pathIdsKey(paths);
      if (!_existenceCheckSrc || _existenceCheckSrc.sourceType !== rt.sourceType ||
          _existenceCheckSrc.id !== rt.id || _existenceCheckSrc.pathsKey !== wantKey) {
        var check = _existenceCheckSrc = { sourceType: rt.sourceType, id: rt.id, pathsKey: wantKey, status: 'pending', has: null };
        checkSourceButtonExistence(paths, rt.id).then(function (has) {
          if (_existenceCheckSrc === check) { check.has = has; check.status = 'ready'; manualSourceButtonsTick(); }
        }, function (e) {
          console.error('[ptp2re] source button existence check failed:', e);
          if (_existenceCheckSrc === check) { check.status = 'ready'; check.has = null; manualSourceButtonsTick(); }
        });
      }
      if (_existenceCheckSrc.status !== 'ready') { clearManualSourceButtons(); return; }
      if (_existenceCheckSrc.has) {
        paths = paths.filter(function (p) { return _existenceCheckSrc.has[p.id]; });
      }
      Array.prototype.slice.call(container.childNodes || []).forEach(function (node) {
        if (!hasClass(node, MANUAL_SRC_BTN_CLASS)) return;
        var stillWanted = paths.some(function (p) { return manualSourceButtonId(p) === node.id; });
        if (!stillWanted && node.parentNode) node.parentNode.removeChild(node);
      });
      paths.forEach(function (p) {
        var label = sourceButtonLabel(p, s);
        var existing = document.getElementById(manualSourceButtonId(p));
        if (existing && existing._ptp2reEntityId === rt.id && existing._ptp2reLabel === label) return;
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        insertBeforeImportantAction(container, buildManualSourceButton(p, label, rt.id));
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

  function startEntityObserver() {
    var target = document.getElementById('root') || document.body || document.documentElement;
    if (!target) return false;
    try {
      new MutationObserver(scheduleEntityTick).observe(target, { childList: true, subtree: true });
      return true;
    } catch (e) {
      console.warn('[ptp2re] could not observe the DOM; falling back to polling:', e);
      return true; // the interval below still drives the tick
    }
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
  bothButtonTicks();

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
    var node = btn;
    for (var depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      var heading = node.querySelector ? node.querySelector('h3') : null;
      if (heading && headingIsOurs(heading.textContent)) return label;
    }
    return null;
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

      // Our own settings being saved. The settings page saves each plugin in its own
      // mutation, so this is scoped to our plugin_id.
      if (/\bconfigurePlugin\b/.test(q) && v.plugin_id === PLUGIN_ID) {
        invalidateAutoSettings();
        settingsTick();
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
  // without a running Stash. Nothing in the plugin reads this back.
  window.__ptp2re = {
    PLUGIN_ID: PLUGIN_ID,
    PLUGIN_NAME: PLUGIN_NAME,
    PLUGIN_VERSION: PLUGIN_VERSION,
    README_URL: README_URL,
    TASKS: TASKS,
    TARGETS: TARGETS,
    SOURCES: SOURCES,
    PATHS: PATHS,
    DEFAULTS: DEFAULTS,
    pathSelection: pathSelection,
    targetSelection: targetSelection,
    bulkField: bulkField,
    pathById: pathById,
    pathLabel: pathLabel,
    enabledPaths: enabledPaths,
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
