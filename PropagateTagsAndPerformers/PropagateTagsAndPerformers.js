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
  // major digit is what says "ready to use", and this one has no planner and no
  // buttons yet. Each implementation step is a feature, so it takes the minor digit
  // (0.1.0, 0.2.0, ...); fixes within a step take the patch.
  var PLUGIN_VERSION = '0.1.0';

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

  // "Performers of a Gallery onto its Scenes", for the log and the dialog head.
  function pathLabel(path) {
    var kind = path.kind === 'performers' ? 'Performers' : 'Tags';
    return kind + ': ' + path.source + ' → ' + TARGETS[path.target].plural;
  }

  function enabledPaths(s) {
    return PATHS.filter(function (p) { return !!s[p.setting]; });
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

  // ── A run ─────────────────────────────────────────────────────────────────

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
    var parts = [];
    // Keyed by target rather than by path: several paths write onto a scene, and a
    // progress line counting the same scenes once per path would read as a library
    // several times its real size.
    for (var k in TARGETS) {
      if (!hasOwn(TARGETS, k)) continue;
      if (!hasOwn(this.scanned, k) && !hasOwn(this.total, k)) continue;
      parts.push(TARGETS[k].plural + ' ' + (this.scanned[k] || 0) + ' / ' + (this.total[k] || 0));
    }

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

  // Phase 1's walk over the library, filling `this.plan`. Implemented at step 3;
  // until then the dialog reviews the *configuration* - which paths run, in what
  // order, under which filters, against which sibling plugins - and finds nothing to
  // do, so Proceed stays disabled and nothing can be written by accident.
  Run.prototype.scan = function () {
    this.log('WARN', 'The library scan is not implemented in ' + PLUGIN_VERSION + '. ' +
      'Everything above describes what a run would do; nothing has been read or written.');
    return Promise.resolve();
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

  Run.prototype.finishScan = function () {
    this.flush();
    if (this.cancelled) return;
    if (!this.plan.length) {
      this.log('INFO', 'Nothing to change.');
    } else {
      this.log('INFO', 'Review complete: ' + this.plan.length + ' entity change(s) planned. ' +
        'Nothing has been written. Press Proceed to apply.');
    }
    this.setState('ready');
    this.flush();
  };

  // ── Phase 2: apply ────────────────────────────────────────────────────────

  // Implemented at step 4. The guard is not a placeholder: `setState` already
  // disables Proceed on an empty plan, and this is the second half of that - a
  // keyboard activation or a stale reference must not reach a write.
  Run.prototype.proceed = function () {
    if (this.state !== 'ready' || !this.plan.length) return;
  };

  // ── Undo ──────────────────────────────────────────────────────────────────

  // Implemented at step 4, alongside the apply it reverses.
  Run.prototype.undo = function () {
    if (!this.undoable.length) return;
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

  // Only the shape of the DOM API that the fake DOM in the tests also implements -
  // no querySelector by class, no getElementsByClassName - so the suites drive the
  // same code path a browser does.
  function findByClass(root, name, depth) {
    if (!root || depth > 6) return null;
    var kids = root.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (hasClass(kids[i], name)) return kids[i];
      var found = findByClass(kids[i], name, (depth || 0) + 1);
      if (found) return found;
    }
    return null;
  }

  // Under the description, which is inside the group header and therefore outside
  // the <Collapse> - so it shows whether or not the group is expanded. The fallbacks
  // are for a Stash that renders no sub-heading (an empty description) or no header
  // row at all.
  function readmeLinkSlot(group) {
    var sub = findByClass(group, 'sub-heading', 0);
    if (sub && sub.parentNode) return { parent: sub.parentNode, before: sub.nextSibling };
    var header = findByClass(group, 'setting', 0);
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
    var sub = findByClass(group, 'sub-heading', 0);
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
      var sub = findByClass(row, 'sub-heading', 0);
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
    var sub = findByClass(row, 'sub-heading', 0);
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
    var sub = findByClass(group, 'sub-heading', 0);
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
      // mutation, so this is scoped to our plugin_id; auto mode caches settings and
      // will need the invalidation this hook is here for.
      if (/\bconfigurePlugin\b/.test(q) && v.plugin_id === PLUGIN_ID) {
        settingsTick();
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
    injectStyle: injectStyle,
  };
}());
