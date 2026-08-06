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

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and goes current the moment plugins are reloaded, while the browser can
  // still be running a script it cached before the edit - so a heading reading 0.2.0
  // over 0.1.0 behaviour is the normal look of a stale script, not a contradiction.
  // This constant travels inside the file. Bump it with the manifest and the yml;
  // the `version` suite fails if the three disagree.
  //
  // Below 1.0.0 deliberately, and it stays there until the plugin is finished: the
  // major digit is what says "ready to use", and this one has no task, no dialog and
  // no buttons yet. Each implementation step is a feature, so it takes the minor
  // digit (0.1.0, 0.2.0, ...); fixes within a step take the patch.
  var PLUGIN_VERSION = '0.0.1';

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

  var STYLE_ID = 'ptp2re-style';

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
      find: 'findScenes', node: 'scenes', filterArg: 'scene_filter',
      bulk: 'bulkSceneUpdate', bulkInput: 'BulkSceneUpdateInput', single: 'sceneUpdate',
      organized: true, pageSize: 500,
      route: /^\/scenes\/(\d+)(?:\/|$)/,
      fields: 'id title files { basename }',
    },
    gallery: {
      key: 'gallery', label: 'Gallery', plural: 'Galleries',
      find: 'findGalleries', node: 'galleries', filterArg: 'gallery_filter',
      bulk: 'bulkGalleryUpdate', bulkInput: 'BulkGalleryUpdateInput', single: 'galleryUpdate',
      organized: true, pageSize: 500,
      route: /^\/galleries\/(\d+)(?:\/|$)/,
      fields: 'id title files { basename } folder { basename }',
    },
    image: {
      key: 'image', label: 'Image', plural: 'Images',
      find: 'findImages', node: 'images', filterArg: 'image_filter',
      bulk: 'bulkImageUpdate', bulkInput: 'BulkImageUpdateInput', single: 'imageUpdate',
      organized: true, pageSize: 500,
      route: /^\/images\/(\d+)(?:\/|$)/,
      fields: 'id title visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }',
    },
    group: {
      key: 'group', label: 'Group', plural: 'Groups',
      find: 'findGroups', node: 'groups', filterArg: 'group_filter',
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
  //   walk      field names from the target down to whatever carries the payload.
  //             Steps may be objects or arrays (`studio` is one, `performers` is
  //             many) and the walk handles both rather than annotating which.
  //   markerTags  the leaf is a SceneMarker, whose primary_tag counts as one of its
  //             tags and lives in its own required field
  //   reverse   set instead of `walk` where Stash has no field for the traversal:
  //             Gallery has no `images`, so its images are fetched by filter
  //   mode      manifest key of the "common tags only" toggle, where the path has one
  //   pair      the id of the path that reverses this one, where one exists
  //   hops      1, or 2 where the payload is reached through an intermediate entity
  var PATHS = [
    // Stage 1 - performer assignments, before anything reads performers.
    { id: 'performers:image>gallery', kind: 'performers', stage: 1, hops: 1,
      setting: 'c2PerformersImagesToGalleries', target: 'gallery',
      source: 'Images', button: 'Add Image Perfs',
      reverse: { find: 'findImages', node: 'images', filterArg: 'image_filter',
                 filterField: 'galleries' } },
    { id: 'performers:gallery>scene', kind: 'performers', stage: 1, hops: 1,
      setting: 'b5PerformersGalleriesToScenes', target: 'scene',
      source: 'Galleries', button: 'Add Gallery Perfs',
      walk: ['galleries'] },

    // Stage 2 - tags onto scenes.
    { id: 'tags:marker>scene', kind: 'tags', stage: 2, hops: 1,
      setting: 'b3TagsMarkersToScenes', target: 'scene',
      source: 'Markers', button: 'Add Marker Tags',
      walk: ['scene_markers'], markerTags: true },
    { id: 'tags:performer>scene', kind: 'tags', stage: 2, hops: 1,
      setting: 'b1TagsPerformersToScenes', target: 'scene',
      source: 'Performers', button: 'Add Perf Tags',
      walk: ['performers'] },
    { id: 'tags:studio>scene', kind: 'tags', stage: 2, hops: 1,
      setting: 'b2TagsStudioToScenes', target: 'scene',
      source: 'Studio', button: 'Add Studio Tags',
      walk: ['studio'] },

    // Stage 3 - tags onto galleries.
    { id: 'tags:image>gallery', kind: 'tags', stage: 3, hops: 1,
      setting: 'c1TagsImagesToGalleries', target: 'gallery',
      source: 'Images', button: 'Add Image Tags',
      pair: 'tags:gallery>image',
      reverse: { find: 'findImages', node: 'images', filterArg: 'image_filter',
                 filterField: 'galleries' } },

    // Stage 4 - tags onto groups. A Group has no performers and no markers of its
    // own, so those two are two-hop traversals through its scenes.
    { id: 'tags:scene>group', kind: 'tags', stage: 4, hops: 1,
      setting: 'e1TagsScenesToGroups', target: 'group',
      source: 'Scenes', button: 'Add Scene Tags',
      mode: 'e2TagsScenesToGroupsCommonOnly', pair: 'tags:group>scene',
      walk: ['scenes'] },
    { id: 'tags:studio>group', kind: 'tags', stage: 4, hops: 1,
      setting: 'e3TagsStudioToGroups', target: 'group',
      source: 'Studio', button: 'Add Studio Tags',
      walk: ['studio'] },
    { id: 'tags:performer>group', kind: 'tags', stage: 4, hops: 2,
      setting: 'e4TagsPerformersToGroups', target: 'group',
      source: 'Performers', button: 'Add Perf Tags',
      walk: ['scenes', 'performers'] },
    { id: 'tags:marker>group', kind: 'tags', stage: 4, hops: 2,
      setting: 'e5TagsMarkersToGroups', target: 'group',
      source: 'Markers', button: 'Add Marker Tags',
      walk: ['scenes', 'scene_markers'], markerTags: true },

    // Stage 5 - sub-groups roll up into their containing group. Group.sub_groups is
    // a list of GroupDescription, not of Group, hence the `group` step.
    { id: 'tags:subgroup>group', kind: 'tags', stage: 5, hops: 1,
      setting: 'e6TagsSubGroupsToGroups', target: 'group',
      source: 'Sub-groups', button: 'Add Sub-group Tags',
      mode: 'e7TagsSubGroupsToGroupsCommonOnly',
      walk: ['sub_groups', 'group'] },

    // Stage 6 - the reverses, distributing what the stages above gathered. Both
    // close a cycle with a path already in the table, which is why the per-entity
    // cooldown above exists; see CLAUDE.md.
    { id: 'tags:group>scene', kind: 'tags', stage: 6, hops: 1,
      setting: 'b4TagsGroupsToScenes', target: 'scene',
      source: 'Groups', button: 'Add Group Tags',
      pair: 'tags:scene>group',
      walk: ['groups', 'group'] },
    { id: 'tags:gallery>image', kind: 'tags', stage: 6, hops: 1,
      setting: 'd1TagsGalleriesToImages', target: 'image',
      source: 'Galleries', button: 'Add Gallery Tags',
      pair: 'tags:image>gallery',
      walk: ['galleries'] },
  ];

  // What a path reads off whatever its walk lands on. A marker keeps its primary tag
  // in a required field of its own rather than in `tags`, and it counts - a marker
  // whose primary tag is "Blonde" carries that tag as much as one that lists it.
  function leafSelection(path) {
    if (path.kind === 'performers') return 'performers { id }';
    return path.markerTags ? 'primary_tag { id } tags { id }' : 'tags { id }';
  }

  // The GraphQL selection that gathers a path's sources, built from `walk` rather
  // than stored beside it: two fields describing one traversal are two fields that
  // can disagree. Empty for a reverse path, which is a query of its own.
  function pathSelection(path) {
    if (!path.walk) return '';
    var sel = leafSelection(path);
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

  var settings = {};
  (function () {
    for (var k in DEFAULTS) if (hasOwn(DEFAULTS, k)) settings[k] = DEFAULTS[k];
  }());

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

  // Exposed for the test suites, which need to read the tables without a running
  // Stash. Nothing in the plugin reads this back.
  window.__ptp2re = {
    PLUGIN_ID: PLUGIN_ID,
    PLUGIN_NAME: PLUGIN_NAME,
    PLUGIN_VERSION: PLUGIN_VERSION,
    README_URL: README_URL,
    TASKS: TASKS,
    TARGETS: TARGETS,
    PATHS: PATHS,
    DEFAULTS: DEFAULTS,
    pathSelection: pathSelection,
    targetSelection: targetSelection,
    bulkField: bulkField,
    pathById: pathById,
    injectStyle: injectStyle,
  };
}());
