// Normalize Parent Tags
//
// Requires Stash 0.31.0 or newer.
//
// Two library-wide tasks, declared in the manifest so Stash lists them under
// Settings - Tasks - Plugin Tasks, but handled entirely in the browser: the click
// is caught before it can queue a server-side job (this plugin has no exec, so a
// job could only fail), and a dialog runs the work over /graphql instead.
//
// The design notes, and the reasoning behind the parts that look arbitrary, are in
// CLAUDE.md next to this file.
(function () {
  'use strict';

  var PLUGIN_ID   = 'NormalizeParentTags';
  var PLUGIN_NAME = 'ᝯㄝₓ Normalize Parent Tags';
  // The name the dialogs wear. `PLUGIN_NAME` is the manifest's, and it has to stay
  // byte-identical to the `.yml` because the settings group and the task rows are
  // found by matching that heading. The same string here, because this one already
  // fits in a title - the constant exists so both heads read from one expression,
  // and so a future shortening is one edit rather than three call sites.
  var PLUGIN_SHORT_NAME = PLUGIN_NAME;
  var SIBLING_ID   = 'MergePerformerTagsToScenes';
  var SIBLING_NAME = 'ᝯㄝₓ Merge Performer Tags To Scenes';

  // The one version that proves anything. Everything the settings page shows is read
  // from the manifest over GraphQL and updates the moment plugins are reloaded, while
  // the browser can go on running a script it cached before the edit - so a heading
  // reading 1.4.4 over 1.4.0 behaviour is the normal look of a stale script, not a
  // contradiction. This constant travels inside the file, so the line below says
  // which script is actually running. Bump it with the manifest and the yml; the
  // `version` suite fails if the three disagree.
  var PLUGIN_VERSION = '4.6.0';

  // Printed before anything else runs, so a script that loads and then throws is
  // told apart from one that never loaded at all: banner plus error means the new
  // code is running and broken, no banner means the browser is still on the old one.
  // Through whatever the console offers rather than console.info directly: this is
  // the first statement in the file, so a console without it would take the whole
  // plugin down before anything loaded. The sibling's logInfo has always done this.
  function npt(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  npt('[npt] NormalizeParentTags.js ' + PLUGIN_VERSION + ' loaded. This is the running ' +
    'script own version - the settings page reads the manifest instead, which can be newer ' +
    'than the script your browser has cached.');

  // One task does both directions. Prune and Roll Up were two tasks for as long as a
  // run had one mode for the whole library; now the mode is per entity type, chosen
  // in the dialog, and "which task did you press" would only have set a default that
  // the selectors immediately override.
  var TASK_RUN   = 'Normalize Parent Tags...';
  var TASK_MODES = 'Auto Mode Settings...';
  var TASK_TREE  = 'Show Tag Hierarchy...';
  var TASKS = [TASK_RUN, TASK_MODES, TASK_TREE];

  // Stash renders every plugin task with the same `btn-secondary`, so nothing on the
  // Tasks page says which of these three rewrites the library. Amber for the two that
  // lead to writes - Normalize writes the library, Auto Mode Settings decides what is
  // written silently on every save - and teal for the one that only reads: Show Tag
  // Hierarchy opens a viewer and writes nothing, and it is the button a user should be
  // able to press without checking first.
  //
  // Bootstrap variant classes rather than colours of our own, so the hover, focus and
  // active states come from Stash's theme and stay in step with it. Its `btn-warning`
  // renders white text, unlike stock Bootstrap's dark - checked live, 2026-08-11 - so
  // nothing overrides the foreground. `btn-dark` is worth knowing about and not worth
  // using: Stash themes it identically to `btn-secondary`.
  //
  // The amber is pinned to the same string the two siblings use for their own buttons.
  var PLUGIN_BTN_VARIANT   = 'btn-warning';
  var READONLY_BTN_VARIANT = 'btn-info';

  var PAGE_SIZE      = 1000;  // entities per find query
  var CHUNK_SIZE     = 100;   // entity ids per bulk mutation
  var LOG_RENDER_CAP = 1000;  // log lines kept in the DOM; all of them stay in memory
  var LOG_FLUSH_MS   = 100;
  var LEASE_TTL_MS   = 300000;
  // The busy cursor under the last log line. The counters say how far a pass has
  // got; this says it is still going, which is the question a run that spends
  // seconds on one page of a large library leaves unanswered.
  var SPIN_FRAMES    = ['▙', '▛', '▜', '▟'];
  var SPIN_MS        = 125;   // one four-frame cycle at 2Hz
  var UNDO_ARM_MS    = 4000;  // how long Undo stays armed for its second click

  // Auto mode (see "Auto normalize on entity updates" below). The lease it takes is
  // measured in the seconds one reaction lasts, not the minutes a library-wide task
  // does, so it gets its own much shorter TTL - a crashed tab must not stand the
  // sibling down for five minutes over a single scene save.
  var AUTO_LEASE_TTL_MS  = 30000;
  var AUTO_SETTINGS_TTL_MS = 10000;  // settings are re-read at most this often
  var AUTO_GRAPH_TTL_MS    = 60000;  // and the tag hierarchy at most this often
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

  // ── Entity types ──────────────────────────────────────────────────────────
  //
  // Processing order is the array order and is deliberate: performers first, so
  // that the scene-fanning auto-merge in MergePerformerTagsToScenes (if it is
  // installed, enabled, and too old to honour our lease) happens before the scene
  // and image passes rather than after them; markers last, since they hang off
  // scenes. Never derive this order from the settings object's key order.
  //
  // `organized` records which types actually have the flag - in Stash 0.31 that is
  // scenes, images, galleries and studios. Flipping one entry here is all it takes
  // if a later Stash adds it elsewhere.
  //
  // `token` is the word this type wears in the auto-mode setting string
  // ("SCENES=PRUNE"). It is not derived from `plural` - "Scene Markers" would spell
  // itself SCENE MARKERS, and the setting is a single line the user may type by hand,
  // where a token with a space in it is a token that cannot be parsed back.
  //
  // `single` is the per-entity update mutation, watched by auto mode alongside
  // `bulk`. The two names never collide under a \b-anchored regex because Stash
  // capitalises the type inside the bulk name: "bulkSceneUpdate" does not contain
  // "sceneUpdate", and neither contains "sceneMarkerUpdate".
  var TYPES = [
    { key: 'performers', token: 'PERFORMERS', label: 'Performer', plural: 'Performers',
      find: 'findPerformers', node: 'performers',
      bulk: 'bulkPerformerUpdate', bulkInput: 'BulkPerformerUpdateInput', single: 'performerUpdate',
      organized: false, fields: 'id name' },
    { key: 'studios', token: 'STUDIOS', label: 'Studio', plural: 'Studios',
      find: 'findStudios', node: 'studios',
      bulk: 'bulkStudioUpdate', bulkInput: 'BulkStudioUpdateInput', single: 'studioUpdate',
      organized: true, fields: 'id name' },
    { key: 'groups', token: 'GROUPS', label: 'Group', plural: 'Groups',
      find: 'findGroups', node: 'groups',
      bulk: 'bulkGroupUpdate', bulkInput: 'BulkGroupUpdateInput', single: 'groupUpdate',
      organized: false, fields: 'id name' },
    { key: 'galleries', token: 'GALLERIES', label: 'Gallery', plural: 'Galleries',
      find: 'findGalleries', node: 'galleries',
      bulk: 'bulkGalleryUpdate', bulkInput: 'BulkGalleryUpdateInput', single: 'galleryUpdate',
      // A gallery is a zip (often .cbz) or a folder, and either way the title is
      // optional - so both fallbacks are needed to name one in the log.
      organized: true, fields: 'id title files { basename } folder { basename }' },
    { key: 'scenes', token: 'SCENES', label: 'Scene', plural: 'Scenes',
      find: 'findScenes', node: 'scenes',
      bulk: 'bulkSceneUpdate', bulkInput: 'BulkSceneUpdateInput', single: 'sceneUpdate',
      organized: true, fields: 'id title files { basename }' },
    { key: 'images', token: 'IMAGES', label: 'Image', plural: 'Images',
      find: 'findImages', node: 'images',
      bulk: 'bulkImageUpdate', bulkInput: 'BulkImageUpdateInput', single: 'imageUpdate',
      // Image.files is deprecated in favour of visual_files, which is a union of
      // ImageFile and VideoFile - hence the two inline fragments rather than a
      // plain basename selection. Both implement BaseFile, but naming the concrete
      // types is the form every Stash 0.31 accepts.
      organized: true, pageSize: 500,
      // Why this one type carries a warning in the UI: it is the only one whose size
      // routinely makes a whole-library pass a decision rather than a habit, which is
      // also why it starts Off in the run dialog whatever the setting says.
      note: 'Usually the largest type in a library and the slowest to scan: a ' +
        'whole-library image pass can take a long time.',
      fields: 'id title visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }' },
    { key: 'markers', token: 'MARKERS', label: 'Scene Marker', plural: 'Scene Markers',
      find: 'findSceneMarkers', node: 'scene_markers',
      bulk: 'bulkSceneMarkerUpdate', bulkInput: 'BulkSceneMarkerUpdateInput', single: 'sceneMarkerUpdate',
      organized: false, fields: 'id title primary_tag { id name }' },
  ];

  // ── Cross-plugin cooperation ──────────────────────────────────────────────
  //
  // See "Cross-plugin cooperation: the bulk-edit lease" in the repo-root CLAUDE.md.
  // A lease asks reactive plugins in this tab to stand down while we write. It is
  // advisory and always expires, so a crash cannot disable anyone permanently.

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

  function coop() {
    var c = coopObject();
    if (!c.leases) c.leases = [];
    if (!c.respecters) c.respecters = {};
    if (!c.declares) c.declares = {};
    if (!c.api) c.api = {};
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

  function siblingRespectsLeases() {
    return !!coop().respecters[SIBLING_ID];
  }

  // Registered at load, because auto mode (below) makes this plugin reactive as well
  // as bulk. It is what lets another plugin's bulk run tell "will stand down" apart
  // from "too old to know about leases" - the same signal this plugin's own dialog
  // reads off the sibling. Registering unconditionally, rather than only while an
  // auto mode is enabled, is deliberate: the flag says this copy honours the
  // protocol, which is true whatever the settings happen to be.
  coop().respecters[PLUGIN_ID] = true;

  // ── The API this plugin publishes ─────────────────────────────────────────
  //
  // Prune and Roll Up are this plugin's operations, and another plugin offering them
  // has two ways to do it: copy the rules, or call the plugin that owns them. The
  // first was tried - `TagBundleClipboard` mirrored the tag-exclusion filters
  // byte-for-byte - and it has the failure a copy always has: a filter added here is
  // silently not applied there, and the copy cannot even know it is out of date.
  //
  // So this is the second. It is deliberately small and deliberately shaped to
  // outlive its own settings:
  //
  //   - **`autoMode` is a question, not a setting.** A caller asks what will happen
  //     automatically when Stash saves an entity of a given type, and gets 'prune',
  //     'rollup' or null. That day came at 4.0.0: two global booleans scoped by seven
  //     "Include ..." toggles became one mode per type, every setting key this plugin
  //     had was renamed, and no caller changed a line. A caller reading the settings
  //     itself would have broken - while sounding confident - which was the argument
  //     for the mechanism before there was an example of it.
  //   - **Every call takes one options object**, so a field can be added without a
  //     new signature. `entityType` is taken by both calls, and `plan` takes
  //     `typeFilter` to apply the per-type toggle to the plan as well - which no
  //     caller wants today (a hand-picked list is not an entity update) and which
  //     costs nothing to have ready.
  //   - **`version` is a floor, not a handshake.** Callers should feature-detect the
  //     function they want; the number is for a log line telling a user what to
  //     upgrade.
  //
  // What it deliberately does *not* do: the entity-level exclusions (`b1`, `b2`).
  // There is no entity here - a caller passes tag ids, not something Organized can be
  // true of - and inventing an answer would be worse than leaving the question to the
  // caller, which is the one side that knows what it is looking at.
  var API_VERSION = 1;

  // Accepts this plugin's own key ('scenes'), or the singular a caller is more likely
  // to have ('scene'). Two vocabularies meeting is not a thing to be strict about.
  function apiType(name) {
    var want = String(name || '').toLowerCase();
    for (var i = 0; i < TYPES.length; i++) {
      var t = TYPES[i];
      if (t.key === want || t.label.toLowerCase() === want ||
          t.plural.toLowerCase() === want) return t;
    }
    return null;
  }

  // Resolves to a bound planner rather than answering one question, because a caller
  // drawing a list re-plans on every tick as the user changes what is selected. The
  // settings and the hierarchy are read once, here, and the returned `plan` is
  // synchronous - a checkbox that had to await a round trip would be worse than no
  // feature at all. Both reads are this plugin's own auto-mode caches, so a page with
  // auto mode running pays nothing extra.
  function apiPrepare(opts) {
    var o = opts || {};
    var type = apiType(o.entityType);
    var settings = null;
    return autoSettings().then(function (s) {
      settings = s;
      return autoGraph(s);
    }).then(function (graph) {
      var filters = makeFilters(settings, graph);
      var mode = type ? modeOf(settings, type) : MODE_OFF;
      var includes = mode !== MODE_OFF;
      var ctx = { settings: settings, graph: graph, filters: filters };
      return {
        version: API_VERSION,
        entityType: type ? type.key : null,
        includesType: includes,
        // Null where nothing happens on its own to this type - which since 4.0.0 is
        // one question rather than two, since a type carries its own mode.
        autoMode: includes ? mode : null,
        plan: function (req) {
          var r = req || {};
          if (r.typeFilter && !includes) return null;
          var mode = r.mode === 'prune' ? 'prune'
            : (r.mode === 'rollup' || r.mode === 'rollUp' ? 'rollup' : null);
          if (!mode) return null;
          var ids = (r.tagIds || []).map(String);
          var present = {};
          ids.forEach(function (id) { present[id] = true; });
          return planTagSet(ids, present, mode, ctx);
        },
      };
    });
  }

  coop().api[PLUGIN_ID] = { version: API_VERSION, prepare: apiPrepare };

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
      console.info('[npt] auto mode is standing down while ' + c.leases[0].owner +
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

  // ── Settings ──────────────────────────────────────────────────────────────
  //
  // Read once at the start of each run. `configuration { plugins }` cannot be
  // scoped to one plugin, so the sibling's settings arrive in the same response -
  // which is exactly what the "will it fight us" check below needs.
  //
  // The a1/b2/c3 prefixes are the only way to control the order Stash renders the
  // settings in: `settings:` is a YAML map, so the manifest's order is lost and
  // what the page shows is the keys sorted alphabetically. The prefixes buy the
  // grouping the user reads top to bottom - entity types in processing order,
  // then entity-level exclusions, then the tag filters in add/remove pairs. Keys
  // are never shown in the UI, but they *are* the storage key, so renaming one
  // orphans whatever the user had configured under the old name.
  var DEFAULTS = {
    a1AutoModes: '',
    b1ExcludeEntityWithTagName: '',
    b2ExcludeOrganized: false,
    c1ExcludeTagWithIgnoreAutoTag: false,
    c2ExcludeAddTagNameContains: '',
    c3ExcludeRemoveTagNameContains: '',
    c4TagNameSeparator: '',
    c5ExcludeAddTagWithCustomFieldName: '',
    c6ExcludeRemoveTagWithCustomFieldName: '',
  };

  // ── The auto-mode string ──────────────────────────────────────────────────
  //
  // One STRING setting holds all seven types: `SCENES=PRUNE, IMAGES=OFF, ...`. It
  // replaced seven "Include ..." booleans plus two global "Auto ..." booleans, which
  // could only ever say "every enabled type does the same thing". A type is now off,
  // pruned or rolled up on its own, which is three states - and a Stash plugin
  // setting is BOOLEAN, NUMBER or STRING, with no tri-state and no repeated group, so
  // seven tri-states either become fourteen checkboxes with an illegal combination in
  // every pair, or one line. It is one line, and the "Auto Mode Settings..." task is
  // the editor for it: the field is there to be *read* at a glance and edited by hand
  // when someone wants to, not to be the only way in.
  //
  // Parsing is therefore forgiving and formatting is strict. Anything shaped like
  // `<type>=<mode>` is picked out wherever it sits, in any order, in any case, with
  // any separators between the pairs and the singular of a type accepted for its
  // plural; everything else in the string is ignored, and a type nobody mentioned is
  // OFF. What is written back is always the same seven pairs in processing order,
  // joined with ', '.
  var MODE_OFF = 'off', MODE_PRUNE = 'prune', MODE_ROLLUP = 'rollup';
  var MODE_TOKEN = { off: 'OFF', prune: 'PRUNE', rollup: 'ROLLUP' };
  // The same three modes as words. One table, so the selectors, the recap lines and
  // the settings row cannot end up calling Roll Up three different things.
  var MODE_LABEL = { off: 'Off', prune: 'Prune', rollup: 'Roll Up' };

  // "SCENES", "scene", "Scenes" - all the same type. Nothing else is accepted: a
  // word this does not know is not a typo to guess at, it is a pair to ignore.
  function typeByToken(word) {
    var w = String(word || '').toUpperCase();
    for (var i = 0; i < TYPES.length; i++) {
      if (TYPES[i].token === w || TYPES[i].token === w + 'S') return TYPES[i];
    }
    return null;
  }

  // ROLLUP is what gets written; "roll up", "roll-up" and "roll_up" are accepted
  // because a user typing this by hand is being asked to remember which one it is,
  // and the answer costs one character class.
  var MODE_PAIR = /([A-Za-z]+)\s*=\s*(OFF|PRUNE|ROLL[\s_-]*UP|ROLLUP)/gi;

  function parseAutoModes(raw) {
    var modes = {};
    TYPES.forEach(function (t) { modes[t.key] = MODE_OFF; });
    var text = String(raw == null ? '' : raw), m;
    MODE_PAIR.lastIndex = 0;
    while ((m = MODE_PAIR.exec(text)) !== null) {
      var t = typeByToken(m[1]);
      if (!t) continue;
      var word = m[2].toUpperCase();
      // A type named twice takes its last mention: the string is edited by appending
      // far more often than by rewriting, so the last word is the newest intent.
      modes[t.key] = word === 'OFF' ? MODE_OFF : (word === 'PRUNE' ? MODE_PRUNE : MODE_ROLLUP);
    }
    return modes;
  }

  function formatAutoModes(modes) {
    return TYPES.map(function (t) {
      return t.token + '=' + MODE_TOKEN[(modes && modes[t.key]) || MODE_OFF];
    }).join(', ');
  }

  // The setting in words rather than in tokens: `Performers=Off, Scene Markers=Roll
  // Up`, with every type that is not Off in amber - the same thing its selector goes
  // amber for. Capitalised because this is a value being read, not typed; the stored
  // string stays what `formatAutoModes` writes, and the parser accepts either shape
  // (any case, `roll up`, the singular of a type), so what is shown here would still
  // be understood if somebody typed it back.
  //
  // Spans rather than `textContent`, so each pair can carry its own colour.
  function renderModeString(box, modes) {
    while (box.firstChild) box.removeChild(box.firstChild);
    TYPES.forEach(function (t, i) {
      var mode = (modes && modes[t.key]) || MODE_OFF;
      if (i) box.appendChild(el('span', null, ', '));
      box.appendChild(el('span', mode === MODE_OFF ? null : 'npt-modestring-on',
        t.plural + '=' + MODE_LABEL[mode]));
    });
  }

  function modeOf(settings, type) {
    var modes = (settings && settings.modes) || {};
    return modes[type.key] || MODE_OFF;
  }

  // ── Migrating the nine booleans this setting replaced ─────────────────────
  //
  // Up to 3.2.0 the same configuration was `a1EnablePerformers`...`a7EnableMarkers`
  // saying which types a run covered, and `a8AutoPruneOnUpdate`/`a9AutoRollUpOnUpdate`
  // saying what happened automatically to all of them. The mapping is exact: an
  // enabled type takes whichever single auto mode was on, and everything else is OFF.
  // Both auto modes at once was that release's documented no-op - they are inverses -
  // so it migrates to OFF rather than picking one.
  //
  // Renaming a key orphans what the user had; this is the one thing that stops the
  // rename from being a silent reset. It runs once per page, only when the new
  // setting is empty and at least one old key is set, and it writes the result back
  // so the settings page shows it.
  var LEGACY_ENABLE = {
    performers: 'a1EnablePerformers', studios: 'a2EnableStudios', groups: 'a3EnableGroups',
    galleries: 'a4EnableGalleries', scenes: 'a5EnableScenes', images: 'a6EnableImages',
    markers: 'a7EnableMarkers',
  };

  function hasLegacySettings(raw) {
    if (raw.a8AutoPruneOnUpdate || raw.a9AutoRollUpOnUpdate) return true;
    for (var k in LEGACY_ENABLE) {
      if (hasOwn(LEGACY_ENABLE, k) && raw[LEGACY_ENABLE[k]]) return true;
    }
    return false;
  }

  function legacyModes(raw) {
    var prune = !!raw.a8AutoPruneOnUpdate, rollup = !!raw.a9AutoRollUpOnUpdate;
    var mode = prune === rollup ? MODE_OFF : (prune ? MODE_PRUNE : MODE_ROLLUP);
    var modes = {};
    TYPES.forEach(function (t) {
      modes[t.key] = raw[LEGACY_ENABLE[t.key]] ? mode : MODE_OFF;
    });
    return modes;
  }

  var _savingModes = false;

  // The one mutation this plugin sends that is not about the library. Stash's own
  // settings page sends the same shape, and our fetch hook already notices it and
  // drops the settings cache - so a save made here reaches auto mode exactly as one
  // made by hand does.
  function saveAutoModes(text) {
    _savingModes = true;
    return gqlRequest(
      'mutation NPTSaveModes($plugin_id: ID!, $input: Map!) {' +
      '  configurePlugin(plugin_id: $plugin_id, input: $input)' +
      '}',
      { plugin_id: PLUGIN_ID, input: { a1AutoModes: text } }
    ).then(function (r) {
      _savingModes = false;
      invalidateAutoSettings();
      return r;
    }, function (e) {
      _savingModes = false;
      throw e;
    });
  }

  var _migrated = false;

  function migrateLegacy(text) {
    if (_migrated) return;
    _migrated = true;
    npt('[npt] migrating the pre-4.0.0 entity and auto-mode settings to "' + text + '".');
    saveAutoModes(text).then(null, function (e) {
      npt('[npt] the migrated auto-mode setting could not be saved (' +
        (e && e.message ? e.message : e) + '). It is being used for this page all the same; ' +
        'set it by hand from the Auto Mode Settings task if this keeps happening.');
    });
  }

  // Everything above, applied to one raw settings map: fill in the defaults, migrate
  // if this install predates the string, and hang the parsed modes off the result so
  // nothing downstream parses it twice.
  function settingsFrom(raw) {
    var s = {};
    for (var k in DEFAULTS) {
      if (!hasOwn(DEFAULTS, k)) continue;
      s[k] = typeof DEFAULTS[k] === 'boolean' ? !!raw[k] : (raw[k] || '');
    }
    if (!String(s.a1AutoModes).replace(/^\s+|\s+$/g, '') && hasLegacySettings(raw)) {
      s.a1AutoModes = formatAutoModes(legacyModes(raw));
      migrateLegacy(s.a1AutoModes);
    }
    s.modes = parseAutoModes(s.a1AutoModes);
    return s;
  }

  function loadSettings() {
    return gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var all = (data.configuration || {}).plugins || {};
      var raw = all[PLUGIN_ID] || {};
      return { settings: settingsFrom(raw), sibling: all[SIBLING_ID] || null };
    });
  }

  // ── Tag graph ─────────────────────────────────────────────────────────────

  // `detail` adds the two fields nothing in a run needs: aliases and description,
  // which only the viewer's tooltips read. A description is free text and can be
  // paragraphs long, so asking for it on every prune of a library with thousands of
  // tags would be paying for a payload no code path looks at - the same reasoning
  // that keeps custom_fields conditional below.
  function tagQuery(settings, detail) {
    // sort_name is what Stash sorts by when it is set; it costs one nullable string
    // per tag on a query that is already fetching the whole hierarchy.
    var fields = 'id name sort_name ignore_auto_tag parents { id }';
    if ((settings.c5ExcludeAddTagWithCustomFieldName || '').trim() ||
        (settings.c6ExcludeRemoveTagWithCustomFieldName || '').trim()) {
      fields += ' custom_fields';
    }
    if (detail) fields += ' aliases description';
    // per_page: -1 means "no paging, return everything". Right for tags (thousands
    // at most) and wrong for scenes and images, which is why they page instead.
    return 'query NPTTags { findTags(filter: { per_page: -1 }) { tags { ' + fields + ' } } }';
  }

  function buildGraph(tags) {
    var byId = {}, parents = {};
    tags.forEach(function (t) {
      byId[t.id] = t;
      parents[t.id] = (t.parents || []).map(function (p) { return p.id; });
    });

    var memo = {}, visiting = {}, cyclic = {};

    // Strict ancestors of a tag, transitively, as a set. Stash rejects hierarchy
    // loops on every tag create and update, so `visiting` should never trigger -
    // it is there because the alternative, if a loop ever arrives through a route
    // that skips validation, is an infinite loop in the user's browser.
    function ancestorsOf(id) {
      if (hasOwn(memo, id)) return memo[id];
      var out = {};
      visiting[id] = true;
      (parents[id] || []).forEach(function (pid) {
        if (visiting[pid]) { cyclic[pid] = true; cyclic[id] = true; return; }
        if (!hasOwn(byId, pid)) return; // dangling parent id: nothing to imply
        out[pid] = true;
        var up = ancestorsOf(pid);
        for (var k in up) if (hasOwn(up, k)) out[k] = true;
      });
      delete visiting[id];
      memo[id] = out;
      return out;
    }

    // Children are only needed by the hierarchy viewer, so the map is built on
    // first use rather than on every run.
    var kids = null;
    function childrenOf(id) {
      if (!kids) {
        kids = {};
        for (var cid in parents) {
          if (!hasOwn(parents, cid)) continue;
          parents[cid].forEach(function (pid) {
            if (!hasOwn(byId, pid)) return;      // dangling parent id
            (kids[pid] = kids[pid] || []).push(cid);
          });
        }
      }
      return kids[id] || [];
    }

    return {
      byId: byId,
      ancestorsOf: ancestorsOf,
      // Only parents Stash still knows about: a dangling id implies nothing and
      // must not be drawn as an edge either.
      parentsOf: function (id) {
        return (parents[id] || []).filter(function (pid) { return hasOwn(byId, pid); });
      },
      childrenOf: childrenOf,
      cyclic: cyclic,
      // Walk everything once so cycles are discovered during the scan rather than
      // whenever an affected entity happens to turn up.
      warmAll: function () { for (var id in byId) if (hasOwn(byId, id)) ancestorsOf(id); },
    };
  }

  function tagLabel(graph, id) {
    var t = graph.byId[id];
    return '"' + ((t && t.name) || 'unknown') + '" (' + id + ')';
  }

  // ── Tag tooltips ──────────────────────────────────────────────────────────
  //
  // What a name and an id cannot say: the aliases and description that tell two
  // similarly named tags apart. Two callers - the viewer's rows, where they are the
  // whole point of hovering, and the run dialog's closing recap, where the tags are
  // the only ones a user is deciding about. Neither is worth putting `description` on
  // the run's own tag query for; both fetch it where it is needed. See §5a.

  var TIP_ALIASES = 8;        // aliases named in a tooltip before the rest are a count
  var TIP_ALIAS_CHARS = 120;  // and the width that can cut the list shorter still
  var TIP_DESC_CHARS = 240;   // how much of a description the excerpt carries

  // Free text arrives with newlines and runs of spaces in it, and a tooltip line is
  // one line however the description was written.
  function oneLine(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  // Cut on the last space before the limit so a word is never sliced in half - unless
  // the only space is near the start, where honouring it would throw most of the
  // excerpt away and say less than the blunt cut would.
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

  // Whether a tag has anything to say beyond its name and id. The recap's spans
  // already carry both, so a tooltip there would open on a hover and repeat the line
  // underneath it - and since nothing marks which tags have one, every hover that
  // does open had better say something new. The viewer's rows tooltip
  // unconditionally instead, because there the full name is itself information: a
  // long one is cut off by the row.
  function tagHasDetail(t) {
    return !!(aliasList(t).length || oneLine(t && t.description));
  }

  // Both lists are capped rather than rendered whole - a tag with forty aliases or a
  // paragraph of description would otherwise put a wall of text under the pointer,
  // which is worse than the caption it replaced. The tail is counted rather than
  // dropped silently, so a truncated list still says there is more, and the tag page
  // is where to read all of it.
  function tagTooltip(t, id) {
    var lines = [oneLine((t && t.name) || 'unknown'), 'Stash tag id ' + id];

    var aliases = aliasList(t);
    if (aliases.length) {
      var shown = [], used = 0;
      for (var i = 0; i < aliases.length; i++) {
        // The first alias is always named, excerpted if it has to be: "and 3 more"
        // on its own would leave the tooltip listing nothing at all.
        if (shown.length && (shown.length >= TIP_ALIASES || used + aliases[i].length > TIP_ALIAS_CHARS)) break;
        shown.push(shown.length ? aliases[i] : excerpt(aliases[i], TIP_ALIAS_CHARS));
        used += aliases[i].length + 2;
      }
      var rest = aliases.length - shown.length;
      lines.push('Aliases: ' + shown.join(', ') + (rest > 0 ? ', and ' + rest + ' more' : ''));
    }

    var desc = oneLine(t && t.description);
    if (desc) lines.push('Description: ' + excerpt(desc, TIP_DESC_CHARS));
    return lines.join('\n');
  }

  // One query for the tags a recap names - tens of them, after a scan that read the
  // library - rather than two more fields on every tag in the hierarchy. Resolves to
  // a map, and to an empty one if the query fails: this buys a tooltip, not a run,
  // and an [ERROR] line about it in a log being read for what was written would cost
  // more than a recap that does not hover.
  function loadTagDetail(ids) {
    if (!ids.length) return Promise.resolve({});
    return gqlRequest(
      'query NPTTagDetail($ids: [ID!]) { findTags(ids: $ids) ' +
      '{ tags { id name aliases description } } }', { ids: ids }
    ).then(function (data) {
      var out = {};
      (((data.findTags || {}).tags) || []).forEach(function (t) { out[t.id] = t; });
      return out;
    }, function () { return {}; });
  }

  // ── Exclusion filters ─────────────────────────────────────────────────────

  // The name filters take a list of substrings, and a tag is excluded when its
  // name contains any one of them. Whitespace separates them by default, which
  // costs the ability to write a substring containing a space; `sep` buys it back
  // by separating on something the user's tag names never contain instead.
  //
  // Split on a *string*, never a RegExp: `.` and `|` are plausible separators and
  // would otherwise have to be escaped by the user. Each term is trimmed, so a
  // list written as "a, b" does not carry a leading space into the match, and
  // empty terms are dropped - a setting of nothing but separators must leave an
  // empty list, never a term matching every tag in the library.
  function splitTerms(value, sep) {
    var raw = String(value == null ? '' : value);
    var out = [];
    (sep ? raw.split(sep) : raw.split(/\s+/)).forEach(function (term) {
      var t = term.trim();
      if (t) out.push(t);
    });
    return out;
  }

  function nameMatchesAny(name, terms) {
    for (var i = 0; i < terms.length; i++) {
      if (name.indexOf(terms[i]) !== -1) return true;
    }
    return false;
  }

  function makeFilters(settings, graph) {
    // Trimmed, so stray padding around the separator does not become the
    // separator; trimming to nothing simply means the whitespace default, which is
    // also the only way to ask for a plain space.
    var sep         = (settings.c4TagNameSeparator || '').trim();
    var addCF       = (settings.c5ExcludeAddTagWithCustomFieldName || '').trim();
    var removeCF    = (settings.c6ExcludeRemoveTagWithCustomFieldName || '').trim();
    var addTerms    = splitTerms(settings.c2ExcludeAddTagNameContains, sep);
    var removeTerms = splitTerms(settings.c3ExcludeRemoveTagNameContains, sep);

    // Returns why the tag is blocked, or null. A reason string rather than a bare
    // boolean so the hierarchy viewer can say *which* filter is protecting a tag
    // without a second copy of these rules going out of step with this one.
    function blockReason(id, cfName, terms) {
      var t = graph.byId[id];
      if (!t) return 'unknown to Stash';         // never touch it
      if (graph.cyclic[id]) return 'in a hierarchy cycle';
      if (settings.c1ExcludeTagWithIgnoreAutoTag && t.ignore_auto_tag) return 'Ignore auto tag';
      // Presence alone excludes; the value is never inspected. hasOwnProperty
      // rather than `in`, or inherited keys like "constructor" match every tag.
      if (cfName && t.custom_fields && hasOwn(t.custom_fields, cfName)) {
        return 'custom field "' + cfName + '"';
      }
      if (terms.length && nameMatchesAny(t.name || '', terms)) return 'name filter';
      return null;
    }

    return {
      canAdd:    function (id) { return !blockReason(id, addCF, addTerms); },
      canRemove: function (id) { return !blockReason(id, removeCF, removeTerms); },
      protections: function (id) {
        return { add: blockReason(id, addCF, addTerms), remove: blockReason(id, removeCF, removeTerms) };
      },
    };
  }

  // ── Planning ──────────────────────────────────────────────────────────────

  function firstBasename(files) {
    return (files && files.length && files[0].basename) || '';
  }

  // Title is optional on scenes, galleries and images alike, so fall back the way
  // Stash's own UI does rather than logging "untitled" at the user: the file name,
  // and for a gallery that is a folder rather than a zip, the folder name. Which
  // of these fields exists is decided by the type's `fields` - a type that does
  // not ask for files simply has none here.
  function entityLabel(type, ent) {
    var name = ent.name || ent.title;
    if (!name) {
      name = firstBasename(ent.files) || firstBasename(ent.visual_files) ||
        (ent.folder && ent.folder.basename) || '';
    }
    if (!name && type.key === 'markers' && ent.primary_tag) name = ent.primary_tag.name;
    return '"' + (name || 'untitled') + '" (' + ent.id + ')';
  }

  // Ids arrive from GraphQL as strings but are also used as object keys, so compare
  // them as strings rather than trusting both sides to be the same type.
  function indexOfId(ids, id) {
    if (id == null) return -1;
    for (var i = 0; i < ids.length; i++) if (String(ids[i]) === String(id)) return i;
    return -1;
  }

  // Compare ids as numbers where both parse, so 9 sorts below 10, and fall back to a
  // string compare so the order is total whatever Stash hands us.
  function lowerId(a, b) {
    var na = parseInt(a, 10), nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na < nb;
    return String(a) < String(b);
  }

  // Is `a` the better "due to" tag than the incumbent `b`? The lowest-level tag
  // wins: if one is an ancestor of the other it is the higher of the two and
  // loses. Neither being an ancestor of the other (a diamond, or two unrelated
  // children of one parent) is a real tie, broken on lowest id - `for...in` order
  // is not guaranteed, and a log line that shuffles between runs cannot be audited.
  function betterReason(graph, a, b) {
    if (a === b) return false;
    if (hasOwn(graph.ancestorsOf(a), b)) return true;
    if (hasOwn(graph.ancestorsOf(b), a)) return false;
    return lowerId(a, b);
  }

  // Narrow the entity's full implied-tag map to just the tags being written, so a
  // six-figure plan is not carrying an ancestor map per entry.
  function reasonsFor(implied, ids) {
    var out = {};
    ids.forEach(function (tid) { if (hasOwn(implied, tid)) out[tid] = implied[tid]; });
    return out;
  }

  // What Stash orders a tag by: `COALESCE(tags.sort_name, tags.name)`. sort_name is
  // nullable and never shown in the UI - it exists purely to override the name for
  // sorting - so an empty one is no override at all.
  function tagSortKey(graph, id) {
    var t = graph.byId[id];
    if (!t) return '';
    return (t.sort_name || '').trim() || t.name || '';
  }

  // Stash applies its own NATURAL_CI collation to that key: case-insensitive, and
  // numeric runs compared as numbers, so "Volume 2" precedes "Volume 10" instead of
  // following it. Intl.Collator is the closest thing the browser has; where it is
  // missing this degrades to a case-insensitive compare rather than failing, and
  // the id tie-break at the call site keeps the order total either way.
  var collateNames = (function () {
    try {
      if (typeof Intl !== 'undefined' && Intl && Intl.Collator) {
        var c = new Intl.Collator(undefined, { numeric: true, sensitivity: 'accent' });
        return function (a, b) { return c.compare(a, b); };
      }
    } catch (e) { /* fall through to the plain compare */ }
    return function (a, b) {
      var la = String(a).toLowerCase(), lb = String(b).toLowerCase();
      return la === lb ? 0 : (la < lb ? -1 : 1);
    };
  }());

  // Counts entities per tag over a whole plan. A run only ever writes in one
  // direction, so the two lists never need keeping apart here.
  function planTagCounts(plan, dir) {
    var counts = {};
    plan.forEach(function (entry) {
      (dir === 'remove' ? entry.remove : entry.add).forEach(function (tid) {
        counts[tid] = (hasOwn(counts, tid) ? counts[tid] : 0) + 1;
      });
    });
    return counts;
  }

  // The per-entity lines answer "what happened to this entity". This answers
  // "which tags did this run touch, and how widely" - the question actually being
  // asked before trusting a Prune across a whole library, and one that a
  // six-figure log cannot be read for. Ordered the way Stash orders tags, so the
  // line can be read against the tag list in the UI without re-sorting it by eye,
  // with the id as the final tie-break - Stash uses one too, and two tags in
  // different parts of the hierarchy are allowed to share a name.
  // Returned as segments rather than a string: each tag becomes its own span so it
  // can carry the tooltip above, which is what tells two tags with the same name
  // apart without leaving the dialog. `detail` is optional - without it the line is
  // exactly what it always was, which is also what a failed detail query leaves.
  function tagSummaryParts(graph, counts, verb, detail) {
    var ids = [], id;
    for (id in counts) if (hasOwn(counts, id)) ids.push(id);
    if (!ids.length) return null;
    ids.sort(function (a, b) {
      var c = collateNames(tagSortKey(graph, a), tagSortKey(graph, b));
      if (c) return c;
      return lowerId(a, b) ? -1 : 1;
    });
    var parts = [{ text: plural(ids.length, 'tag') + ' ' + verb + ': ' }];
    ids.forEach(function (tid, i) {
      var d = detail && hasOwn(detail, tid) ? detail[tid] : null;
      parts.push({
        text: tagLabel(graph, tid) + ' x' + counts[tid],
        title: d && tagHasDetail(d) ? tagTooltip(d, tid) : null,
      });
      if (i < ids.length - 1) parts.push({ text: ', ' });
    });
    return parts;
  }

  function partsText(parts) {
    return parts.map(function (p) { return p.text; }).join('');
  }

  function summaryTagIds(counts) {
    var ids = [], id;
    for (id in counts) if (hasOwn(counts, id)) ids.push(id);
    return ids;
  }

  // One log line for one tag on one entity, in either direction.
  function changeLine(graph, type, label, tid, reason) {
    var line = type.label + ' ' + label + ' - Tag ' + tagLabel(graph, tid);
    if (reason && hasOwn(reason, tid)) line += ' - due to ' + tagLabel(graph, reason[tid]);
    return line;
  }

  // Returns { add: [], remove: [], reason: {} } - both lists may be empty. `mode`
  // is 'prune' or 'rollup'; only one direction is ever populated. `reason` maps
  // each tag being written to the present tag that implies it.
  // The planner proper, over a bare set of tag ids rather than an entity. Split out
  // of `planEntity` when the API below needed the same answer for a tag list that is
  // not on anything yet - a second copy of these rules living beside this one is the
  // exact drift the API exists to stop.
  //
  // `candidates` is the removable list, in the order the caller wants them reported;
  // `present` is everything that counts as being there. They differ for a marker,
  // whose primary tag counts as present - so it can imply the removal of its own
  // ancestors from the marker's other tags - but is never itself added or removed.
  //
  // Always returns a full record, including what it declined to touch and why: the
  // scan wants "is there anything to do", a caller drawing a list wants to explain a
  // tag it is leaving alone, and only one of those can be expressed as `null`.
  function planTagSet(candidates, present, mode, ctx) {
    // Maps an implied tag to the present tag that implies it, rather than to a
    // bare `true`: that tag is the "due to" in the log, and it is what makes a
    // planned change explainable without the reader rebuilding the hierarchy in
    // their head. Where several present tags imply the same ancestor, the lowest
    // one wins - see betterReason.
    var implied = {}, id, k;
    for (id in present) {
      if (!hasOwn(present, id)) continue;
      var anc = ctx.graph.ancestorsOf(id);
      for (k in anc) {
        if (!hasOwn(anc, k)) continue;
        if (!hasOwn(implied, k) || betterReason(ctx.graph, id, implied[k])) implied[k] = id;
      }
    }

    var out = { add: [], remove: [], protected: {}, implied: implied, reason: {} };

    if (mode === 'prune') {
      // Computed against the original tag set, never against a set being mutated as
      // the loop runs: ancestry belongs to the tag graph, not to the entity, so the
      // result does not depend on the order tags are visited.
      candidates.forEach(function (tid) {
        if (!hasOwn(implied, tid)) return;
        var why = ctx.filters.protections(tid).remove;
        if (why) { out.protected[tid] = why; return; }
        out.remove.push(tid);
      });
      // The tag named as the reason is never itself removed here: anything that
      // implied it would be a strictly lower candidate for the same ancestor, and
      // would have won. So a Prune line always points at a tag that survives.
      out.reason = reasonsFor(implied, out.remove);
      return out;
    }

    for (k in implied) {
      if (!hasOwn(implied, k)) continue;
      if (hasOwn(present, k)) continue;
      // A tag the filters reject is skipped on its own; its parents are still
      // added. The filters describe a tag, not a wall in the hierarchy.
      var w = ctx.filters.protections(k).add;
      if (w) { out.protected[k] = w; continue; }
      out.add.push(k);
    }
    out.reason = reasonsFor(implied, out.add);
    return out;
  }

  function planEntity(type, ent, mode, ctx) {
    var s = ctx.settings;
    if (s.b2ExcludeOrganized && type.organized && ent.organized) return null;

    var tagIds = (ent.tags || []).map(function (t) { return t.id; });

    var present = {};
    tagIds.forEach(function (id) { present[id] = true; });
    if (type.key === 'markers' && ent.primary_tag) present[ent.primary_tag.id] = true;

    if (ctx.excludeTagId && present[ctx.excludeTagId]) return null;

    var p = planTagSet(tagIds, present, mode, ctx);
    if (mode === 'prune') {
      return p.remove.length ? { add: [], remove: p.remove, reason: p.reason } : null;
    }
    return p.add.length ? { add: p.add, remove: [], reason: p.reason } : null;
  }

  function entityQuery(type, withSort) {
    var filter = withSort
      ? '{ page: $page, per_page: $per, sort: "id", direction: ASC }'
      : '{ page: $page, per_page: $per }';
    return 'query NPT_' + type.find + '($page: Int!, $per: Int!) {' +
      '  ' + type.find + '(filter: ' + filter + ') {' +
      '    count ' + type.node + ' { ' + type.fields + (type.organized ? ' organized' : '') +
      ' tags { id } }' +
      '  }' +
      '}';
  }

  // Pages through one entity type, appending plan entries as it goes.
  function scanType(type, mode, ctx) {
    var per = type.pageSize || PAGE_SIZE;
    var page = 1;
    var seen = 0;
    var useSort = true;

    function fetchPage() {
      return gqlRequest(entityQuery(type, useSort), { page: page, per: per })
        .catch(function (e) {
          // Sorting by id keeps paging stable, but it is an assumption about every
          // one of seven find queries. If Stash rejects it, page unsorted rather
          // than dropping the whole type.
          if (!useSort || page !== 1) throw e;
          useSort = false;
          ctx.run.log('WARN', type.plural + ' - sorting by id was rejected, paging unsorted: ' + e.message);
          return gqlRequest(entityQuery(type, false), { page: page, per: per });
        });
    }

    function nextPage() {
      if (ctx.run.cancelled) return Promise.resolve();
      return fetchPage().then(function (data) {
        var result = data[type.find] || {};
        var list = result[type.node] || [];
        ctx.run.total[type.key] = result.count || 0;
        list.forEach(function (ent) {
          var delta = planEntity(type, ent, mode, ctx);
          seen++;
          if (!delta) return;
          var label = entityLabel(type, ent);
          ctx.run.plan.push({
            type: type, id: ent.id, label: label,
            add: delta.add, remove: delta.remove, reason: delta.reason,
          });
          delta.remove.forEach(function (tid) {
            ctx.run.log('REMOVE', changeLine(ctx.graph, type, label, tid, delta.reason));
          });
          delta.add.forEach(function (tid) {
            ctx.run.log('ADD', changeLine(ctx.graph, type, label, tid, delta.reason));
          });
        });
        ctx.run.scanned[type.key] = seen;
        ctx.run.renderProgress();
        if (!list.length || seen >= (result.count || 0)) return;
        page++;
        return nextPage();
      }, function (e) {
        ctx.run.log('ERROR', type.plural + ' page ' + page + ' - ' + type.find + ' failed: ' + e.message);
        ctx.run.errors++;
      });
    }

    return nextPage();
  }

  // ── Applying ──────────────────────────────────────────────────────────────

  // Entities needing the same change are updated together: the same redundant
  // parent turns up on thousands of entities, so grouping by delta turns tens of
  // thousands of mutations into a few hundred. Grouping is per type, since each
  // type has its own mutation anyway.
  function buildBatches(plan) {
    var groups = {}, order = [];
    plan.forEach(function (entry) {
      var mode = entry.remove.length ? 'REMOVE' : 'ADD';
      var tagIds = (mode === 'REMOVE' ? entry.remove : entry.add).slice().sort();
      var key = entry.type.key + '|' + mode + '|' + tagIds.join(',');
      if (!hasOwn(groups, key)) {
        groups[key] = { type: entry.type, mode: mode, tagIds: tagIds, entries: [] };
        order.push(key);
      }
      groups[key].entries.push(entry);
    });

    var batches = [];
    order.forEach(function (key) {
      var g = groups[key];
      for (var i = 0; i < g.entries.length; i += CHUNK_SIZE) {
        batches.push({
          type: g.type, mode: g.mode, tagIds: g.tagIds,
          entries: g.entries.slice(i, i + CHUNK_SIZE),
        });
      }
    });
    return batches;
  }

  function bulkMutation(type) {
    return 'mutation NPT_' + type.bulk + '($input: ' + type.bulkInput + '!) {' +
      '  ' + type.bulk + '(input: $input) { id }' +
      '}';
  }

  function batchIds(batch) {
    return batch.entries.map(function (e) { return e.id; });
  }

  // Entities in a batch that could not be written are not counted as changed, and
  // the ids are sampled rather than listed: a failed 100-id chunk should not put a
  // hundred ids on one log line.
  function batchFailed(batch, run, verb, e) {
    var ids = batchIds(batch);
    run.log('ERROR', batch.type.plural + ' - ' + verb + ' ' + batch.type.bulk + ' failed for ' +
      ids.length + ' entities (ids ' + ids.slice(0, 5).join(', ') +
      (ids.length > 5 ? ', ...' : '') + '): ' + e.message);
    run.errors++;
  }

  function applyBatch(batch, run, graph) {
    return gqlRequest(bulkMutation(batch.type), {
      input: { ids: batchIds(batch), tag_ids: { ids: batch.tagIds, mode: batch.mode } },
    }).then(function () {
      // Recorded only once the server has taken it, so Undo can never try to
      // reverse a write that never landed.
      run.undoable.push(batch);
      batch.entries.forEach(function (entry) {
        batch.tagIds.forEach(function (tid) {
          // Entities are batched by identical delta, but each carries its own
          // reasons - the same redundant parent is rarely redundant for the same
          // cause twice - so the line is built per entry, not per batch.
          run.log(batch.mode, changeLine(graph, batch.type, entry.label, tid, entry.reason));
          var seen = run.appliedTags[batch.mode];
          seen[tid] = (hasOwn(seen, tid) ? seen[tid] : 0) + 1;
        });
        run.applied++;
      });
    }, function (e) {
      // The whole batch failed, so none of its entities changed and none are
      // logged as changed.
      batchFailed(batch, run, 'apply', e);
      run.failed += batch.entries.length;
    });
  }

  // The same mutation with ADD and REMOVE swapped. A delta, not a restore: it puts
  // back exactly the tag assignments this batch changed and touches nothing else,
  // which is what lets it run over a library that has moved on since - and equally
  // what stops it from being a substitute for a database backup.
  function undoBatch(batch, run, graph) {
    var mode = batch.mode === 'ADD' ? 'REMOVE' : 'ADD';
    return gqlRequest(bulkMutation(batch.type), {
      input: { ids: batchIds(batch), tag_ids: { ids: batch.tagIds, mode: mode } },
    }).then(function () {
      // Dropped from the record as it is reversed, so a Stop halfway leaves behind
      // exactly the batches that are still applied.
      var at = run.undoable.indexOf(batch);
      if (at !== -1) run.undoable.splice(at, 1);
      batch.entries.forEach(function (entry) {
        batch.tagIds.forEach(function (tid) {
          // No "due to" clause: the reason explained why the tag was written, and
          // this line is that write being taken back.
          run.log(mode, 'Undo - ' + changeLine(graph, batch.type, entry.label, tid, null));
          var back = run.undoneTags[mode];
          back[tid] = (hasOwn(back, tid) ? back[tid] : 0) + 1;
        });
        run.undone++;
      });
    }, function (e) {
      batchFailed(batch, run, 'undo', e);
      run.undoFailed += batch.entries.length;
    });
  }

  function undoableCount(batches) {
    var n = 0;
    batches.forEach(function (b) { n += b.entries.length; });
    return n;
  }

  // ── Dialog ────────────────────────────────────────────────────────────────

  var STYLE_ID = 'npt-style';
  var CSS =
    // Kept literally identical to MergePerformerTagsToScenes' TASK_CSS wherever the
    // two dialogs overlap, down to the hex values. They are separate strings because
    // the plugins share no module, not because they are meant to look different -
    // and they did drift, from #202b33 here against #30404d there, because nothing
    // compared them. `style` pins the overlap now. #202b33 is Blueprint's dark-gray2,
    // the step Stash's page uses; every dim grey in these dialogs was chosen against
    // it - the log's #a7b6c2 and #7d8f9c, and the tree's #3c4f5d hover and #425a6b
    // selection - and they separate better on it than on the lighter #30404d.
    '.npt-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.npt-modal{background:#202b33;color:#f5f8fa;border:1px solid #394b59;border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.npt-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.npt-title{font-size:1.1rem;font-weight:600;}' +
    '.npt-warn{color:#ffb648;margin-top:.35rem;}' +
    '.npt-note{color:#a7b6c2;margin-top:.35rem;}' +
    '.npt-legend{color:#7d8f9c;margin-top:.35rem;font-size:.8rem;}' +
    '.npt-progress{padding:.5rem 1rem;border-bottom:1px solid #394b59;color:#a7b6c2;' +
    'white-space:pre-wrap;}' +
    '.npt-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;font-size:.8rem;' +
    'line-height:1.35;min-height:14rem;}' +
    '.npt-line{white-space:pre-wrap;word-break:break-word;}' +
    '.npt-spin{color:#a7b6c2;}' +
    '.npt-ERROR{color:#ff7373;} .npt-WARN{color:#ffb648;} .npt-REMOVE{color:#7cc4ff;}' +
    '.npt-ADD{color:#84d68a;} .npt-INFO{color:#a7b6c2;}' +
    '.npt-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.npt-foot button{margin-right:.5rem;}' +
    '.npt-hidden{display:none;}' +
    '.npt-search{padding:.5rem 1rem;border-bottom:1px solid #394b59;position:relative;' +
    'display:flex;gap:.5rem;align-items:center;}' +
    '.npt-find-wrap{flex:1 1 0;display:flex;align-items:center;gap:.4rem;}' +
    '.npt-inputwrap{position:relative;display:flex;align-items:center;flex:1 1 0;}' +
    '.npt-find-input{flex:1 1 auto;background:#1f2b33;color:#f5f8fa;border:1px solid #394b59;' +
    'border-radius:3px;padding:.25rem 1.9rem .25rem .5rem;}' +
    '.npt-find-count{color:#7d8f9c;font-size:.75rem;white-space:nowrap;min-width:5rem;}' +
    '.npt-search-input{flex:1 1 auto;background:#1f2b33;color:#f5f8fa;border:1px solid #394b59;' +
    'border-radius:3px;padding:.25rem 1.9rem .25rem .5rem;}' +
    '.npt-clear{position:absolute;right:.35rem;top:50%;transform:translateY(-50%);' +
    'background:none;border:0;color:#a7b6c2;font-size:1.1rem;line-height:1;cursor:pointer;' +
    'padding:0 .35rem;}' +
    '.npt-clear:hover{color:#f5f8fa;}' +
    '.npt-split{flex:1 1 auto;display:flex;min-height:18rem;overflow:hidden;}' +
    '.npt-tree{flex:2 1 0;overflow:auto;padding:.5rem 0;font-size:.85rem;}' +
    '.npt-inspect{flex:1 1 0;overflow:auto;padding:.5rem 1rem;border-left:1px solid #394b59;' +
    'font-size:.8rem;min-width:14rem;}' +
    '.npt-row{padding:.1rem 1rem;cursor:pointer;white-space:nowrap;}' +
    '.npt-row:hover{background:#3c4f5d;}' +
    '.npt-row-sel{background:#425a6b;}' +
    '.npt-twisty{display:inline-block;width:1.1rem;color:#a7b6c2;}' +
    '.npt-tag-name{font-family:monospace;}' +
    '.npt-badge{margin-left:.5rem;font-size:.72rem;padding:0 .3rem;border-radius:3px;}' +
    '.npt-b-diamond{color:#7cc4ff;} .npt-b-repeat{color:#a7b6c2;font-style:italic;}' +
    '.npt-b-prot{color:#ffb648;} .npt-b-cycle{color:#ff7373;} .npt-b-dim{color:#7d8f9c;}' +
    '.npt-b-act{cursor:pointer;text-decoration:underline dotted;}' +
    '.npt-b-act:hover{background:#3c4f5d;}' +
    '.npt-i-link{cursor:pointer;text-decoration:underline dotted;}' +
    '.npt-i-link:hover{color:#7cc4ff;}' +
    // `display:block` because it is an `<a>` now: an inline box would drop the margin
    // under it, and the colour is inherited so the link still reads as the heading it
    // is rather than as Stash's blue.
    '.npt-i-title{display:block;font-size:1rem;font-weight:600;margin-bottom:.4rem;' +
    'font-family:monospace;color:inherit;text-decoration:none;}' +
    '.npt-i-title:hover{color:inherit;text-decoration:underline;}' +
    '.npt-i-label{color:#7cc4ff;margin-top:.6rem;}' +
    '.npt-i-body{color:#d6dee4;white-space:pre-wrap;word-break:break-word;}' +
    '.npt-i-hint{color:#7d8f9c;}' +
    // The per-type mode selectors, in the head of the run dialog and as the whole
    // body of the settings one. A grid rather than a flex row: seven labels of very
    // different lengths line their selects up only if the columns are shared.
    '.npt-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));' +
    'gap:.35rem .9rem;margin:.5rem 0;}' +
    // The select sits at the far end of its column so the seven line up, and the
    // label is right-aligned against it: a flexing label puts its text next to the
    // select it names rather than at the opposite end of the row, which is what made
    // the aligned column read as belonging to the next type along.
    '.npt-mode-row{display:flex;align-items:center;gap:.4rem;}' +
    '.npt-mode-name{color:#d6dee4;font-size:.9rem;flex:1;text-align:right;}' +
    // Byte-identical with TagBundleClipboard's .tbc-mode: a mode select in a dialog
    // is the same thing in both, so the shared-CSS suite is right to insist.
    '.npt-mode{background:#30404d;color:#f5f8fa;border:1px solid #394b59;' +
    'border-radius:3px;padding:.15rem .35rem;font-size:.85rem;max-width:100%;}' +
    // Amber wherever the selector is set to something that writes, the same rule the
    // buttons follow. A <select> has no Bootstrap variant to borrow.
    '.npt-mode-on{border-color:#ffb648;color:#ffb648;}' +
    // The run dialog's panel lives in the padded head; the settings dialog's is the
    // whole body, so it brings its own side padding rather than touching the border.
    '.npt-modesbody{padding:.5rem 1rem;}' +
    '.npt-persist{display:flex;align-items:center;gap:.4rem;color:#a7b6c2;' +
    'font-size:.85rem;margin:.35rem 0 0;}' +
    // The string the settings dialog is about to write, shown in the form the setting
    // holds it - monospace, because it is a value rather than a sentence.
    '.npt-modestring{font-family:monospace;font-size:.85rem;color:#a7b6c2;' +
    'margin:.25rem 0 .5rem;word-break:break-word;}' +
    // Amber for the same reason the selectors are: a type that is not Off is one this
    // plugin writes to by itself. Nothing else on the line is coloured - marking the
    // whole of it would mark none of it.
    '.npt-modestring-on{color:#ffb648;}' +
    '.npt-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
    // Stash's own .sub-heading is white-space: normal, so the newlines in this
    // plugin's description would collapse into one paragraph. Scoped to the group we
    // marked, never to .sub-heading at large: another plugin's description is not
    // ours to reflow, and it may well have been written for the collapse.
    // pre-wrap is the fallback for a description we have not split yet - a blank
    // line renders as a blank line. Once split, the paragraphs are divs and the gap
    // is this margin instead: roughly a third of a line, not a whole one.
    '.npt-own-group .sub-heading{white-space:pre-wrap;}' +
    '.npt-own-group .sub-heading .npt-p{margin:0 0 .35em;}' +
    '.npt-own-group .sub-heading .npt-p:last-child{margin-bottom:0;}' +
    // A per-setting description shows its first paragraph and hides the rest in a
    // tooltip. The mark is the only thing saying there is one - a hover that opens
    // with no invitation is a hover nobody makes.
    //
    // Built rather than borrowed: a native `title` is the browser's, and its font
    // size, its position and its delay cannot be reached from CSS. It opens
    // *below-right* of the pointer, which is exactly where the arrow and the
    // `cursor:help` question mark sit, so the first line arrives half covered. This
    // one opens above the row in a readable size, and - the part `title` could never
    // do - on keyboard focus as well as hover.
    //
    // Anchored on the .sub-heading rather than on the mark, so a mark that has been
    // pushed to the right by a long summary still opens a box that starts at the
    // left of the row and cannot overflow the panel.
    '.npt-tipped{position:relative;}' +
    '.npt-tip{margin-left:.35rem;cursor:pointer;opacity:.65;font-style:normal;' +
    'font-size:1.05em;}' +
    '.npt-tip:hover,.npt-tip:focus{opacity:1;outline:none;}' +
    // pointer-events:none is load-bearing, not tidiness. Opened from the setting's
    // name the box lands over the h3, so a box that took the pointer would fire
    // mouseleave on the name, close, hand the pointer back to the name, and reopen -
    // a flicker loop for as long as it is hovered.
    '.npt-tipbox{display:none;position:absolute;left:0;bottom:calc(100% + .35rem);' +
    'z-index:1500;width:max-content;max-width:100%;padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.npt-tipped.npt-tip-open .npt-tipbox{display:block;}' +
    // The group description sits in the group header, outside the <Collapse>, so it
    // is on screen at whatever size whether the group is expanded or not. Hiding all
    // but the first paragraph is the only thing that shortens it.
    '.npt-desc-collapsed .npt-p:not(:first-child){display:none;}' +
    '.npt-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
    // ── Colour-coded toggles ────────────────────────────────────────────────
    //
    // Amber for the two switches that make this plugin write on its own. They are
    // the only settings here that do - the rest choose what a task covers - and Auto
    // Prune in particular *deletes* tag assignments with no dialog, no review and no
    // undo, which is the one thing on this page worth a second glance before it is
    // ticked. Every other setting keeps Stash's blue: marking everything would mark
    // nothing.
    //
    // Keyed on the ids SettingsPluginsPanel.tsx builds from the plugin id and the
    // setting key, the same anchor `settingElement` uses, rather than on position
    // or heading text.
    //
    // Two shapes because the switch is Stash's to render: `::before` is the track
    // of a react-bootstrap Form.Switch, which is what it renders today, and
    // `accent-color` covers a plain checkbox if that ever changes. Whichever is not
    // in use costs nothing.
    //
    // This plugin has no console-logging setting, so it has no teal twin of the
    // rule the two siblings carry - only the read-only task button below is teal.
    //
    // The auto-mode setting is a text field rather than a switch, and 4.0.1 tried to
    // mark it amber with a `border-color` on the input. That was wrong on a live page:
    // the field's border *is* the line the user reads as the divider between that
    // setting row and the next, so the mark did not read as "this one writes on its
    // own", it read as a broken separator. The two switch shapes stay - they cost
    // nothing and cover a Stash that renders this as a control instead - but nothing
    // here paints a border, because no border on this page is only ours. (This setting
    // is a STRING, so Stash renders neither shape today; see `modeFieldTick`.)
    '#plugin-NormalizeParentTags-a1AutoModes{accent-color:#ffc107;}' +
    '#plugin-NormalizeParentTags-a1AutoModes:checked~.custom-control-label::before' +
    '{background-color:#ffc107;border-color:#ffc107;}' +

    // A third attempt, an inset amber bar (4.1.0), went the same way at 4.6.0: on the
    // settings row it drew a heavy rule down the left of a row whose value line was
    // already amber where it mattered, and on the teal task button a 3px sliver read
    // as a rendering artifact rather than as a state. **The value itself is the mark
    // now** - `Scenes=Prune` in amber says which types are armed and, unlike a bar,
    // says which ones. Nothing on the Tasks page repeats it; that button opens the
    // dialog that shows the same seven modes, one click away.

    // The value line stands where Stash's own rendering of the raw string was, inside
    // its row, so it takes that row's spacing rather than the dialog's.
    '#npt-modes-line{margin:.1rem 0 .25rem;}';

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

  // ── The per-type mode selectors ───────────────────────────────────────────
  //
  // The same seven selectors serve two dialogs: the run, where they say what this
  // pass does, and the settings task, where they say what happens by itself on every
  // save. One widget for both, because a user who has learnt one has learnt the other
  // and because the two must never disagree about what "Roll Up" is called.
  //
  // `modes` is mutated in place and is the caller's own object - a run's `this.modes`
  // is what the scan reads, so there is no second copy to keep in step.
  var MODE_OPTIONS = [MODE_OFF, MODE_PRUNE, MODE_ROLLUP].map(function (m) {
    return [m, MODE_LABEL[m]];
  });

  function paintMode(sel) {
    sel.className = 'npt-mode' + (sel.value !== MODE_OFF ? ' npt-mode-on' : '');
  }

  // `quiet` drops the `note` and its marker: the warning is about a whole-library
  // pass, which is the run dialog's business and not the settings dialog's - that one
  // configures what happens as a single entity is saved.
  function modesPanel(modes, onChange, quiet) {
    var wrap = el('div', 'npt-modes');
    var selects = {};
    TYPES.forEach(function (t) {
      var row = el('div', 'npt-mode-row');
      // A type carrying a `note` says so beside its name as well as in the title: a
      // tooltip nobody knows to hover for is not a warning.
      var name = el('span', 'npt-mode-name');
      name.appendChild(el('span', null, t.plural));
      if (t.note && !quiet) name.appendChild(el('span', 'npt-i-hint', ' (slow)'));
      row.appendChild(name);
      var sel = el('select', 'npt-mode');
      MODE_OPTIONS.forEach(function (o) {
        var opt = el('option', null, o[1]);
        opt.value = o[0];
        sel.appendChild(opt);
      });
      sel.value = modes[t.key] || MODE_OFF;
      paintMode(sel);
      sel.title = t.plural + ': Prune removes a tag another tag on the same ' +
        t.label.toLowerCase() + ' already implies; Roll Up adds every ancestor of the ' +
        'tags it carries.' + (t.note && !quiet ? '\n\n' + t.note : '');
      name.title = sel.title;
      sel.addEventListener('change', function () {
        modes[t.key] = sel.value;
        paintMode(sel);
        if (onChange) onChange(t, sel.value);
      });
      row.appendChild(sel);
      wrap.appendChild(row);
      selects[t.key] = sel;
    });
    return {
      el: wrap,
      selects: selects,
      // Sets the values without calling `onChange`: this is the dialog telling the
      // selectors what it found, which is not the user changing them.
      set: function (next) {
        TYPES.forEach(function (t) {
          modes[t.key] = (next && next[t.key]) || MODE_OFF;
          selects[t.key].value = modes[t.key];
          paintMode(selects[t.key]);
        });
      },
      enable: function (on) {
        TYPES.forEach(function (t) { selects[t.key].disabled = !on; });
      },
    };
  }

  function button(label, className) {
    var b = el('button', 'btn btn-secondary btn-sm' + (className ? ' ' + className : ''), label);
    b.type = 'button';
    return b;
  }

  // Copy `text`, reporting on `btn` and restoring `label` after two seconds. The log's
  // Copy button - the only one left since the viewer's two exports went - goes through
  // here. It stays parameterised on the button and the label because that costs
  // nothing and is what a second caller would need.
  //
  // Stash is commonly served over plain HTTP on a LAN, where the async clipboard API
  // is not available at all, so the textarea + execCommand path is the fallback rather
  // than a legacy branch.
  function copyToClipboard(text, btn, label, okText) {
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
    function done(ok) {
      btn.textContent = ok ? okText : 'Copy failed';
      setTimeout(function () { btn.textContent = label; }, 2000);
    }
    var nav = window.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      nav.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });
      return;
    }
    done(fallback());
  }

  // ── Is this script the one Stash has installed? ───────────────────────────
  //
  // "Reload plugins" re-reads the plugin folder on the server; it cannot replace a
  // script this page already fetched and executed. So the manifest can say 1.4.5
  // while the browser is still running 1.4.4, and every surface Stash renders - the
  // version beside the plugin name included - will show the new number, because they
  // all come from the manifest over GraphQL. Comparing the two is the only way the
  // script can notice it is the stale one.
  //
  // Resolves to null wherever the answer is unknown: a Stash too old for the field, a
  // plugin it cannot see, a failed request. Unknown is not a mismatch, and a run must
  // never be blocked because one more query failed.
  //
  // It catches only what a version bump makes visible. Editing the file without
  // bumping it leaves both numbers equal and this check blind - which is the practical
  // reason the repo bumps the patch digit on every change.
  function installedVersion() {
    return gqlRequest('query NPTPluginVersion { plugins { id version } }', null)
      .then(function (data) {
        var list = (data && data.plugins) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id) === PLUGIN_ID) return list[i].version || null;
        }
        return null;
      }, function () { return null; });
  }

  // Both dialogs ask the same question and disagree only about the answer: the run
  // dialog holds Proceed back, the viewer says so and carries on. The two quiet
  // outcomes are settled here, on the console next to the load banner - a matching
  // version is the boring case, and neither dialog should spend a line on it.
  function checkInstalledVersion(onMismatch) {
    return installedVersion().then(function (installed) {
      if (!installed) {
        npt('[npt] version check: Stash reported no installed version; running ' +
          PLUGIN_VERSION + '.');
        return;
      }
      if (installed === PLUGIN_VERSION) {
        npt('[npt] version check: running ' + PLUGIN_VERSION + ', which is what is installed.');
        return;
      }
      onMismatch(installed);
    });
  }

  // ── A run ─────────────────────────────────────────────────────────────────

  // An input with the × that empties it, in a wrapper the icon positions against.
  // Pinning the icon to the row instead only works while there is one box on it.
  function clearableInput(inputClass, clearClass, placeholder, title) {
    var wrap = el('div', 'npt-inputwrap');
    var input = el('input', inputClass);
    input.type = 'text';
    input.placeholder = placeholder;
    var clear = el('button', 'npt-clear ' + clearClass + ' npt-hidden', '\u00d7');
    clear.type = 'button';
    clear.title = title;
    wrap.appendChild(input);
    wrap.appendChild(clear);
    return { wrap: wrap, input: input, clear: clear };
  }

  var _active = null;

  function startRun(taskName) {
    if (_active) { _active.focus(); return; }
    // The viewer writes nothing and has no plan, so it is a different object
    // rather than a third mode threaded through the run.
    if (taskName === TASK_TREE) {
      _active = new TreeView(taskName);
      _active.build();
      return;
    }
    if (taskName === TASK_MODES) {
      _active = new ModesDialog(taskName);
      _active.build();
      return;
    }
    _active = new Run(taskName);
    _active.begin();
  }

  // ── What one run covers ───────────────────────────────────────────────────
  //
  // `modes` is the run's own copy, seeded from the auto-mode settings and editable in
  // the dialog. Images are the one type that does not inherit: the settings page has
  // called them "usually the largest type and the slowest to scan" since 1.0.0, and a
  // library-wide image pass is a decision worth taking per run rather than one to
  // inherit from a setting about what happens when a single image is saved.
  function defaultRunModes(settings) {
    var modes = {};
    TYPES.forEach(function (t) {
      modes[t.key] = t.key === 'images' ? MODE_OFF : modeOf(settings, t);
    });
    return modes;
  }

  // The dialog's own selection, kept across close and reopen only while the box is
  // ticked. In localStorage rather than in the plugin settings: it is one browser's
  // convenience, not a configuration every tab and every user of that Stash shares -
  // and a setting would put a second answer beside the auto modes, which is exactly
  // the confusion this release removed. Re-parsed on the way out, so a hand-edited or
  // truncated value can only ever read as OFF.
  var RUN_MODES_KEY = '__GTTx__.nptRunModes';

  function runModesStore() {
    try {
      return window.localStorage || null;
    } catch (e) {
      return null;                       // storage disabled: the box is a convenience
    }
  }

  function storedRunModes() {
    var store = runModesStore();
    if (!store) return null;
    try {
      var v = JSON.parse(store.getItem(RUN_MODES_KEY) || 'null');
      if (!v || typeof v !== 'object' || !v.persist) return null;
      return parseAutoModes(formatAutoModes(v.modes || {}));
    } catch (e) {
      return null;
    }
  }

  function saveRunModes(modes) {
    var store = runModesStore();
    if (!store) return;
    try {
      store.setItem(RUN_MODES_KEY, JSON.stringify({ persist: true, modes: modes }));
    } catch (e) { /* quota, private mode: nothing here is worth an error for */ }
  }

  function clearRunModes() {
    var store = runModesStore();
    if (!store) return;
    try { store.removeItem(RUN_MODES_KEY); } catch (e) { /* as above */ }
  }

  function Run(taskName) {
    this.taskName = taskName;
    // All off until the settings arrive. `modesReady` is deliberately not in reset():
    // a Rescan re-enters begin(), and re-seeding the selectors there would throw away
    // the choice the user made and then pressed Rescan to act on.
    this.modes = {};
    TYPES.forEach(function (t) { this.modes[t.key] = MODE_OFF; }, this);
    this.modesReady = false;
    this.reset();
    this.build();
  }

  Run.prototype.reset = function () {
    this.plan = [];
    // Set by checkVersion when the running script is not the installed one. Per pass,
    // because a rescan re-checks - the user may have reloaded plugins in between.
    this.stale = false;
    // Counts the passes, so a recap whose tooltip query is still in flight when
    // Rescan is pressed is dropped rather than landing in the next pass's log.
    this.pass = (this.pass || 0) + 1;
    this.scanned = {};
    this.total = {};
    this.errors = 0;
    this.applied = 0;
    // Split by direction, because one run now prunes some types and rolls up others:
    // a single map could only be summarised with a verb that was wrong for half of it.
    this.appliedTags = { ADD: {}, REMOVE: {} };
    this.failed = 0;
    // What this dialog has written and can still take back: the batches the server
    // accepted, newest last. Session-scoped like `lines` rather than pass-scoped -
    // rescan() saves it across this call - because a rescan is how a run converges
    // and losing the ability to undo the first pass at that point would be the
    // moment the button was most wanted.
    this.undoable = [];
    this.undone = 0;
    this.undoFailed = 0;
    this.undoneTags = { ADD: {}, REMOVE: {} };
    this.undoTotal = 0;
    this.cancelled = false;
    this.stopped = false;
    // Set when a selector moves after a plan has been made: what is on screen was
    // computed for the previous selection, so Proceed would write something other
    // than what the dialog now says it covers.
    this.selectionDirty = false;
    this.lines = [];
    this.pending = [];
    // `lines` is the export buffer and survives a Rescan, because Copy log is meant
    // to hand over the whole session - rescan() saves it across this call. It is
    // emptied here rather than kept, so a first run starts clean without the
    // constructor needing a special case. The rendered log survives a Rescan too, so
    // `lines.length` is also what the progress line counts; a separate pass-scoped
    // counter existed only while a rescan emptied the view under it.
    this.state = 'scanning';
  };

  Run.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'npt-backdrop');
    this.modal = el('div', 'npt-modal');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'npt-head');
    head.appendChild(el('div', 'npt-title', PLUGIN_SHORT_NAME + ' - ' + this.taskName));
    // The stale-script warning gets a box of its own, in the same red the settings
    // banner uses, rather than a sentence appended to `noteEl` among the run's other
    // warnings. Every other note here is about the library or another plugin; this one
    // is about the dialog itself running code the user has already replaced, and it is
    // the only one that disables Proceed. It reads as a different kind of thing because
    // it is one.
    this.staleEl = el('div', 'npt-stale npt-hidden', '');
    head.appendChild(this.staleEl);
    // The Undo button reverses this dialog's own writes while it is open. That is
    // not a restore and must never be allowed to read as one, so the backup
    // instruction keeps the position it has always had and the limits are stated
    // beside it rather than left to be discovered.
    head.appendChild(el('div', 'npt-warn',
      'Backing up your database before proceeding is recommended. Undo only reverses what this dialog wrote, ' +
      'while it stays open, and cannot account for changes made elsewhere in the meantime.'));
    // Every name in this log carries a number in brackets and it is always a Stash
    // id, never a count - the counts in the log are written as `x250` or spelled out.
    // Nothing else in the dialog says so, and an id read as "250 of these" is the
    // kind of misreading that gets a Prune approved for the wrong reason.
    head.appendChild(el('div', 'npt-legend',
      'Reading the log: the number in brackets after a name is that entity\'s or tag\'s id - ' +
      'Scene "My Scene" (123) is the scene with id 123. Counts are written as x250, never in brackets.'));
    // What this run covers, and in which direction, per type. Seeded from the
    // auto-mode settings once they load (see begin) and editable from here: the
    // settings say what happens by itself, and one run is allowed to differ.
    head.appendChild(el('div', 'npt-legend',
      'Each type is planned on its own: Prune removes a tag another tag on the same ' +
      'entity already implies, Roll Up adds every ancestor of the tags it carries, ' +
      'Off leaves the type alone. The selection starts from the automatic modes in ' +
      'the plugin settings, with Images off - change it here and press Rescan.'));
    this.modesPanel = modesPanel(this.modes, function () { self.onModeChange(); });
    head.appendChild(this.modesPanel.el);
    head.appendChild(this.buildPersist());
    this.noteEl = el('div', 'npt-note', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.progressEl = el('div', 'npt-progress', 'Starting...');
    this.modal.appendChild(this.progressEl);

    this.logEl = el('div', 'npt-log');
    this.modal.appendChild(this.logEl);

    var foot = el('div', 'npt-foot');
    // Amber: the two buttons that write. See "one colour for a plugin wrote this".
    this.proceedBtn = button('Proceed', 'npt-proceed');
    this.cancelBtn  = button('Cancel', 'npt-cancel');
    this.stopBtn    = button('Stop', 'npt-stop npt-hidden');
    this.copyBtn    = button('Copy log', 'npt-copy');
    this.undoBtn    = button('Undo', 'npt-undo npt-hidden');
    [this.proceedBtn, this.undoBtn].forEach(function (b) {
      b.className = b.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    });
    this.rescanBtn  = button('Rescan', 'npt-rescan npt-hidden');
    this.closeBtn   = button('Close', 'npt-close npt-hidden');
    this.proceedBtn.disabled = true;
    this.undoBtn.title = 'Reverse every change this dialog has written, as an add/remove delta. ' +
      'Only what this dialog wrote, and only while it stays open.';
    this.rescanBtn.title = 'Scan the library again and replace the plan with whatever is left to ' +
      'do. The log is kept, and so is what Undo can still reverse.';

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

    wireEscape(this);
    document.body.appendChild(this.backdrop);
  };

  // Ticked, the selection above survives close and reopen; cleared, the next dialog
  // starts from the settings again. Off by default, which is what a user who has
  // never seen this box gets - and the box itself is what says the dialog is capable
  // of remembering, since a preference nobody can see is one nobody can turn off.
  Run.prototype.buildPersist = function () {
    var self = this;
    var row = el('label', 'npt-persist');
    var box = el('input', 'npt-persist-box');
    box.type = 'checkbox';
    box.checked = !!storedRunModes();
    box.addEventListener('change', function () {
      if (box.checked) saveRunModes(self.modes);
      else clearRunModes();
    });
    row.appendChild(box);
    row.appendChild(el('span', null,
      'Keep this selection for the next time this dialog opens'));
    this.persistBox = box;
    return row;
  };

  // A selector moved. Two things follow: the stored selection is kept up to date if
  // the box is ticked, and a plan already on screen stops being something Proceed may
  // act on - it was computed for the previous selection, and the honest next step is
  // the Rescan this makes visible.
  Run.prototype.onModeChange = function () {
    if (this.persistBox && this.persistBox.checked) saveRunModes(this.modes);
    if ((this.state === 'ready' || this.state === 'scanning') && !this.selectionDirty) {
      this.selectionDirty = true;
      this.log('INFO', 'Selection changed. Press Rescan to plan against it - Proceed stays ' +
        'disabled until then, since the plan was made for the previous selection.');
      this.flush();
    }
    this.setState(this.state);
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
    node.className = node.className.replace(/\s*npt-hidden/g, '') + (visible ? '' : ' npt-hidden');
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
    // Offered in ready as well, but only once a selector has moved: that is the one
    // state where the plan on screen and the selection above it disagree, and Rescan
    // is what settles them.
    this.show(this.rescanBtn, done || (ready && this.selectionDirty));
    this.show(this.closeBtn, done);
    // The selection is what a write in flight is writing; changing it mid-write would
    // describe something the run is not doing.
    if (this.modesPanel) this.modesPanel.enable(!applying && !undoing);
    // Undo is deliberately not gated on `stale`: it reverses writes this dialog has
    // already made, and stranding the user with changes they cannot take back would
    // be a worse outcome than the mismatch it is protecting them from.
    this.proceedBtn.disabled = !ready || !this.plan.length || this.stale || this.selectionDirty;
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
      this.spinEl = el('div', 'npt-spin', SPIN_FRAMES[0]);
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

  Run.prototype.logTagSummary = function (counts, verb) {
    // A run that stops before the tag query - no types enabled, settings failed -
    // has no graph to name anything with, and nothing to summarise either.
    if (!this.graph) return Promise.resolve();
    var self = this;
    // A rescan empties the log while the detail query is in flight, and a recap of
    // the pass before it would land in the middle of the new one. The pass token is
    // what makes waiting for a query safe here.
    var pass = this.pass;
    return loadTagDetail(summaryTagIds(counts)).then(function (detail) {
      if (self.pass !== pass) return;
      var parts = tagSummaryParts(self.graph, counts, verb, detail);
      if (parts) self.log('INFO', partsText(parts), parts);
      self.flush();
    });
  };

  // `parts` is optional, and only the tag recap passes it: that line is rendered as
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
      var node = el('div', 'npt-line npt-' + p.kind, p.parts ? null : p.line);
      // The line looks exactly like every other one: the spans exist to hang a
      // title on, and carry no styling of their own. An underline and a help cursor
      // were tried at 1.4.0 and read as decoration on a log that has none elsewhere.
      if (p.parts) {
        node.appendChild(el('span', null, '[' + p.kind + '] '));
        p.parts.forEach(function (seg) {
          var span = el('span', null, seg.text);
          if (seg.title) span.title = seg.title;
          node.appendChild(span);
        });
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

  Run.prototype.renderProgress = function () {
    var parts = [];
    TYPES.forEach(function (t) {
      if (!hasOwn(this.scanned, t.key) && !hasOwn(this.total, t.key)) return;
      parts.push(t.plural + ' ' + (this.scanned[t.key] || 0) + ' / ' + (this.total[t.key] || 0));
    }, this);

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

  // ── Phase 1: scan ─────────────────────────────────────────────────────────

  Run.prototype.begin = function () {
    var self = this;
    this.setState('scanning');
    // Every pass re-derives the note from freshly loaded settings, so it has to
    // start empty: the warning it carries tells the user to turn the sibling's
    // auto-merge off and rescan, and leaving it up after they have done exactly
    // that says the run is still unsafe when it no longer is.
    this.noteEl.textContent = '';
    this.showStale('');
    this.renderProgress();
    this.log('INFO', PLUGIN_SHORT_NAME + ' - ' + this.taskName + ' - reviewing, nothing will be written yet.');

    // Someone else's lease, held right now. Ours is taken in proceed(), so nothing
    // here can be looking at its own. It is advisory and this is a manual action, so
    // it does not block - but two plugins rewriting the same entities at once is
    // worth saying out loud, and the sibling's library-wide task now takes one.
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
      self.checkSibling(loaded.sibling);

      // Only on the first pass: a Rescan is the user acting on a selection they just
      // made, and re-seeding it from the settings would undo the very change that
      // made them press the button.
      if (!self.modesReady) {
        self.modesReady = true;
        self.modesPanel.set(storedRunModes() || defaultRunModes(self.settings));
      }

      var types = TYPES.filter(function (t) { return self.modes[t.key] !== MODE_OFF; });
      if (!types.length) {
        self.log('WARN', 'Every entity type is set to Off, so there is nothing to plan. ' +
          'Choose Prune or Roll Up for at least one type above, then press Rescan.');
        self.finishScan();
        return;
      }
      self.log('INFO', 'Included, in processing order: ' +
        types.map(function (t) { return t.plural + ' - ' + MODE_TOKEN[self.modes[t.key]]; })
          .join(', '));

      return gqlRequest(tagQuery(self.settings), null).then(function (data) {
        var tags = ((data.findTags || {}).tags) || [];
        var graph = buildGraph(tags);
        graph.warmAll();
        self.graph = graph;

        var cyclic = Object.keys(graph.cyclic);
        if (cyclic.length) {
          // Under the plain rule every tag in a cycle implies every other one, so
          // all of them would be deleted. Skip them instead.
          self.log('ERROR', 'Cycle detected in the tag hierarchy; these tags will be neither ' +
            'added nor removed: ' + cyclic.map(function (id) { return tagLabel(graph, id); }).join(', '));
          self.errors++;
        }

        var ctx = {
          settings: self.settings, graph: graph, run: self,
          filters: makeFilters(self.settings, graph),
          excludeTagId: null,
        };

        var exclName = (self.settings.b1ExcludeEntityWithTagName || '').trim();
        if (exclName) {
          // Resolved against the tag list already in hand: exact and case-sensitive,
          // with none of the SQL LIKE wildcard trouble a name query would bring.
          for (var id in graph.byId) {
            if (hasOwn(graph.byId, id) && graph.byId[id].name === exclName) { ctx.excludeTagId = id; break; }
          }
          if (!ctx.excludeTagId) {
            // Running unfiltered would touch the very entities the user asked to
            // protect, so stop rather than guess.
            self.log('ERROR', 'No tag is named "' + exclName + '" (exact, case-sensitive), so the ' +
              '"Exclude entities carrying this tag" filter cannot be applied. Nothing was scanned. ' +
              'Fix the name in the plugin settings, or clear it, and run the task again.');
            self.errors++;
            self.finishScan();
            return;
          }
          self.log('INFO', 'Excluding entities carrying tag ' + tagLabel(graph, ctx.excludeTagId) + '.');
        }

        var chain = Promise.resolve();
        types.forEach(function (t) {
          chain = chain.then(function () {
            if (self.cancelled) return;
            self.scanned[t.key] = 0;
            self.renderProgress();
            return scanType(t, self.modes[t.key], ctx);
          });
        });
        return chain.then(function () { self.finishScan(); });
      });
    }).catch(function (e) {
      self.log('ERROR', 'Review failed: ' + (e && e.message ? e.message : e));
      self.errors++;
      self.finishScan();
    });
  };

  Run.prototype.checkSibling = function (siblingSettings) {
    if (!siblingSettings) return;
    var on = [];
    // The sibling's own manifest keys, read straight off the shared settings
    // response - so they are its wire names, prefixes and all, not the internal
    // names its source uses. They changed once, at its 1.1.1; both alternatives
    // are accepted here so this check still works against an older copy.
    if (siblingSettings.a3AutoMergeOnSceneUpdate || siblingSettings.autoMergeOnSceneUpdate) {
      on.push('Auto Merge On Scene Updates');
    }
    if (siblingSettings.a4AutoMergeOnPerformerUpdate || siblingSettings.autoMergeOnPerformerUpdate) {
      on.push('Auto Merge On Performer Updates');
    }
    if (!on.length) return;

    if (siblingRespectsLeases()) {
      this.log('INFO', SIBLING_NAME + ' has ' + on.join(' and ') +
        ' enabled; it will stand down while changes are applied.');
      return;
    }
    this.note(SIBLING_NAME + ' has ' + on.join(' and ') + ' enabled, and this copy ' +
      'is too old to stand down. It will merge performer tags back into entities this run changes. ' +
      'Turn it off for the duration, or press Rescan afterwards.');
  };

  // Called from begin(), so a rescan re-checks: the script cannot change without a
  // page reload, but the *installed* version can, if the user reloads plugins while
  // this dialog is open - which is exactly what they do after noticing the warning.
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

  Run.prototype.finishScan = function () {
    this.flush();
    if (this.cancelled) return;
    if (!this.plan.length) {
      this.log('INFO', 'Nothing to change.');
    } else {
      this.log('INFO', 'Review complete: ' + plural(this.plan.length, 'entity change') +
        ' planned across ' + plural(buildBatches(this.plan).length, 'request') +
        '. Nothing has been written. Press Proceed to apply.');
      this.logTagSummary(planTagCounts(this.plan, 'remove'), 'to remove');
      this.logTagSummary(planTagCounts(this.plan, 'add'), 'to add');
    }
    this.setState('ready');
    this.flush();
  };

  // ── Phase 2: apply ────────────────────────────────────────────────────────

  // Apply and Undo drive their batches identically, and the reasoning is the same for
  // both - which is why it is written once here rather than twice.
  //
  // The lease is renewed per batch and released in every outcome - success, failure,
  // Stop - so a reactive plugin is never left standing down. Undo passes a `(undo)`
  // label; the expiry is the backstop for the one outcome neither can catch, the tab
  // going away mid-run.
  //
  // guarded() is the other half of that, pointed inwards: every batch is a
  // bulk*Update, which is exactly what this plugin's own auto mode watches for, so
  // without it a Prune task with Auto Prune enabled would re-plan each batch it had
  // just written - and an Undo would have its reversal put straight back. The lease
  // cannot do this job: it is advisory, and we honour our own leases no more than
  // anyone else's.
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
    if (this.state !== 'ready' || !this.plan.length) return;
    var self = this;
    this.setState('applying');
    this.applied = 0;
    this.appliedTags = { ADD: {}, REMOVE: {} };
    this.failed = 0;
    this.log('INFO', 'Applying ' + plural(this.plan.length, 'entity change') + ' - ' + new Date().toISOString());

    this.runBatches(buildBatches(this.plan), this.taskName,
      function (b) { return applyBatch(b, self, self.graph); },
      'Apply', Run.prototype.finishApply);
  };

  Run.prototype.finishApply = function () {
    this.log('INFO', 'Finished. ' + plural(this.applied, 'entity change') + ' applied' +
      (this.failed ? ', ' + this.failed + ' failed' : '') +
      (this.stopped ? ' (stopped early; changes already applied stay applied)' : '') +
      '. Press Rescan to review what is left.');
    // Counted from what was written, not from the plan: a failed batch, or a Stop,
    // must not be summarised as though it had landed.
    this.logTagSummary(this.appliedTags.REMOVE, 'removed');
    this.logTagSummary(this.appliedTags.ADD, 'added');
    this.setState('done');
    this.flush();
  };

  // ── Undo ──────────────────────────────────────────────────────────────────
  //
  // Reverses what this dialog has written, newest batch first, by replaying each
  // accepted mutation with ADD and REMOVE swapped. What it is *not* is a restore:
  // it reverses this dialog's own writes and nothing else, it cannot see a change
  // made in between, and it dies with the tab. The head of the dialog says so and
  // the backup instruction stays exactly where it was.
  //
  // Newest first because that is the order that composes: a rescan-and-apply cycle
  // can write to an entity twice, and taking the second write back before the first
  // is the only sequence that lands where the run started.
  // Allowed from ready and done - anywhere the dialog is not itself mid-write. It
  // finishes in done either way: once the writes are reversed, a plan reviewed
  // against the library as it was no longer describes it, so Rescan is the honest
  // next step rather than a Proceed left armed over stale ground.
  Run.prototype.undo = function () {
    if ((this.state !== 'ready' && this.state !== 'done') || !this.undoable.length) return;
    var self = this;

    // A single click here starts a library-wide write, in the one state where the
    // user is most likely to be clicking around - Copy log, Rescan and Close are
    // its neighbours - so it arms and asks. The count is what makes the prompt worth
    // reading: it is the scope of the reversal, not a generic "are you sure".
    if (!this.undoArmed) {
      this.undoArmed = true;
      this.undoBtn.textContent = 'Undo ' + plural(undoableCount(this.undoable), 'change') + '?';
      this.undoTimer = setTimeout(function () { self.disarmUndo(); }, UNDO_ARM_MS);
      return;
    }
    this.disarmUndo();

    this.setState('undoing');
    this.stopped = false;
    this.undone = 0;
    this.undoFailed = 0;
    this.undoneTags = { ADD: {}, REMOVE: {} };
    this.undoTotal = undoableCount(this.undoable);
    this.log('INFO', 'Undoing ' + plural(this.undoTotal, 'entity change') + ' - ' + new Date().toISOString());

    // Newest batch first: a rescan-and-apply cycle can write to one entity twice, and
    // taking the second write back before the first is the only order that lands where
    // the run started. An undo is a bulk write like any other, so it announces itself
    // the same way - see runBatches, and note that guarded() matters more sharply here:
    // an undo writes the inverse delta, so an auto mode reacting to it would put back
    // exactly what the user just asked to have taken away.
    this.runBatches(this.undoable.slice().reverse(), this.taskName + ' (undo)',
      function (b) { return undoBatch(b, self, self.graph); },
      'Undo', Run.prototype.finishUndo);
  };

  Run.prototype.finishUndo = function () {
    this.log('INFO', 'Undo finished. ' + plural(this.undone, 'entity change') + ' reversed' +
      (this.undoFailed ? ', ' + this.undoFailed + ' could not be' : '') +
      (this.stopped ? ' (stopped early; what was reversed stays reversed)' : '') +
      (this.undoable.length
        ? '. ' + plural(undoableCount(this.undoable), 'change') + ' are still applied.'
        : '. Everything this dialog wrote has been taken back.'));
    // Undoing a prune puts tags back; undoing a roll-up takes its own additions off
    // again. One run can have done both, so both lines are offered and an empty one
    // prints nothing.
    this.logTagSummary(this.undoneTags.ADD, 'restored');
    this.logTagSummary(this.undoneTags.REMOVE, 'removed again');
    this.setState('done');
    this.flush();
  };

  Run.prototype.disarmUndo = function () {
    if (this.undoTimer) { clearTimeout(this.undoTimer); this.undoTimer = null; }
    this.undoArmed = false;
    if (this.undoBtn) this.undoBtn.textContent = 'Undo';
  };

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
  // anything that changes tags during phase 2 is invisible to the plan being
  // applied. Rescanning until the plan comes back empty is how a run converges.
  //
  // The rendered log is kept rather than emptied: the "--- Rescan ---" marker
  // separates the passes, and a log that stays until the dialog closes is the whole
  // session on screen - the same thing Copy log has always handed over.
  Run.prototype.rescan = function () {
    this.disarmUndo();
    var lines = this.lines.slice();
    // Carried across the reset for the same reason `lines` is: both are the record
    // of what this dialog has already done, and a rescan starts a pass rather than
    // a session. Converging on an empty plan must not cost the ability to undo the
    // passes that got there.
    var undoable = this.undoable;
    this.reset();
    this.lines = lines;
    this.undoable = undoable;
    this.log('INFO', '--- Rescan ---');
    this.begin();
  };

  Run.prototype.copy = function () {
    copyToClipboard(this.lines.join('\n'), this.copyBtn, 'Copy log', 'Copied');
  };

  // ── Escape ────────────────────────────────────────────────────────────────
  //
  // Escape acts through whichever of Cancel/Close the footer is actually showing,
  // never by calling `close()` itself. The footer is the dialog's own statement of
  // what it will let you do right now, so routing the key through it means the key
  // can never reach a button that is hidden or disabled - and in particular does
  // nothing mid-write, where both are hidden and Stop is the only way out. A key
  // that quietly abandoned a run in flight would be worse than one that does nothing.
  // The hierarchy viewer has only a Close, which this reads without a second copy.
  function escapeButton(run) {
    var order = [run.closeBtn, run.cancelBtn];
    for (var i = 0; i < order.length; i++) {
      var b = order[i];
      if (b && !b.disabled && !hasClass(b, 'npt-hidden')) return b;
    }
    return null;
  }

  // On `document`, not on the modal: the modal is not focusable, so a click into the
  // log or either of the viewer's boxes would otherwise put the key out of reach.
  // Removed in `close()` - a dialog that has gone away must not still answer for the
  // page, and the viewer and a run can be open one after the other.
  function wireEscape(run) {
    run._onEscape = function (ev) {
      if (!ev || (ev.key !== 'Escape' && ev.keyCode !== 27)) return;
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
  };

  // ── The auto-mode settings dialog ─────────────────────────────────────────
  //
  // The editor for the one setting this plugin's `a` block now holds. It exists
  // because a tri-state per type is not something Stash's settings page can render:
  // a plugin setting is BOOLEAN, NUMBER or STRING and nothing else, so seven
  // tri-states are one string - and a string is a thing to be typed wrong. The field
  // stays editable by hand and this is what saves anyone from having to use it.
  //
  // It writes a setting, not the library, so it carries no backup instruction: there
  // is nothing here for an Undo to reverse. What it does carry is the warning the two
  // "Auto ..." booleans used to - a type set to Prune or Roll Up here is rewritten
  // silently on every save, with no dialog, no review and no undo.
  function ModesDialog(taskName) {
    this.taskName = taskName;
    this.modes = {};
    TYPES.forEach(function (t) { this.modes[t.key] = MODE_OFF; }, this);
    this.saving = false;
    this.stale = false;
  }

  ModesDialog.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'npt-backdrop');
    this.modal = el('div', 'npt-modal');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'npt-head');
    head.appendChild(el('div', 'npt-title', PLUGIN_SHORT_NAME + ' - ' + this.taskName));
    head.appendChild(el('div', 'npt-warn',
      'A type set to Prune or Roll Up here is rewritten whenever Stash saves one - ' +
      'immediately, with no dialog, no review and no undo. Off is what a type does ' +
      'until you say otherwise; the tasks are unaffected either way, since the run ' +
      'dialog asks again every time.'));
    head.appendChild(el('div', 'npt-legend',
      'Prune removes a tag another tag on the same entity already implies. Roll Up ' +
      'adds every ancestor of the tags it carries. The exclusion filters in the plugin ' +
      'settings apply to both.'));
    this.noteEl = el('div', 'npt-note', 'Reading the current setting...');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    var body = el('div', 'npt-modesbody');
    this.panel = modesPanel(this.modes, null, true);
    this.panel.enable(false);
    body.appendChild(this.panel.el);
    this.modal.appendChild(body);

    var foot = el('div', 'npt-foot');
    // Amber: this is the button that writes. See "one colour for a plugin wrote this".
    this.saveBtn   = button('Save', 'npt-proceed');
    this.saveBtn.className = this.saveBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.cancelBtn = button('Cancel', 'npt-cancel');
    this.saveBtn.disabled = true;
    this.saveBtn.addEventListener('click', function () { self.save(); });
    this.cancelBtn.addEventListener('click', function () { self.close(); });
    [this.saveBtn, this.cancelBtn].forEach(function (b) { foot.appendChild(b); });
    this.modal.appendChild(foot);

    wireEscape(this);
    document.body.appendChild(this.backdrop);
    this.checkVersion();

    loadSettings().then(function (loaded) {
      if (_active !== self) return;
      self.panel.set(loaded.settings.modes);
      self.panel.enable(true);
      self.saveBtn.disabled = self.stale;
      self.noteEl.textContent = '';
    }, function (e) {
      if (_active !== self) return;
      self.noteEl.textContent = 'The current setting could not be read (' +
        (e && e.message ? e.message : e) + '). Saving from here would replace it with ' +
        'whatever is selected above, so Save stays disabled - close this and try again.';
    });
  };

  // The same question the run dialog asks, and it blocks for a sharper reason.
  // Save does not add to this setting, it rewrites the whole string from the types
  // and modes *this* script knows - so a newer installed version that had grown an
  // eighth type, or a third mode, would have it silently dropped by a stale tab. The
  // run dialog at least shows the plan it would write; here the loss is invisible.
  ModesDialog.prototype.checkVersion = function () {
    var self = this;
    return checkInstalledVersion(function (installed) {
      if (_active !== self) return;
      self.stale = true;
      self.saveBtn.disabled = true;
      // Above the note rather than after it: the note reports on reading the setting,
      // and this says the answer will not be written back whatever it says.
      self.noteEl.parentNode.insertBefore(el('div', 'npt-stale',
        '\u26a0 This page is running ' + PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION +
        ', but ' + installed + ' is installed. Reload the page (F5); if this warning ' +
        'comes back, hard-refresh with Ctrl+Shift+R (\u2318+Shift+R on a Mac). Save stays ' +
        'disabled until the script matches: it would rewrite the whole setting from the ' +
        'types and modes this older script knows, dropping anything the installed one ' +
        'has added.'), self.noteEl);
    });
  };

  ModesDialog.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  ModesDialog.prototype.save = function () {
    if (this.saving || this.saveBtn.disabled) return;
    var self = this;
    this.saving = true;
    this.saveBtn.disabled = true;
    this.panel.enable(false);
    this.noteEl.textContent = 'Saving...';
    saveAutoModes(formatAutoModes(this.modes)).then(function () {
      if (_active !== self) return;
      self.close();
    }, function (e) {
      self.saving = false;
      if (_active !== self) return;
      self.saveBtn.disabled = false;
      self.panel.enable(true);
      self.noteEl.textContent = 'The setting could not be saved: ' +
        (e && e.message ? e.message : e);
    });
  };

  ModesDialog.prototype.close = function () {
    unwireEscape(this);
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    if (_active === this) _active = null;
  };

  // ── Hierarchy viewer ──────────────────────────────────────────────────────
  //
  // A read-only third task. It answers the questions the other two raise -
  // "which tags does Prune consider redundant", "why was that one left alone",
  // "where are the diamonds" - against the same graph they run on.
  //
  // Deliberately NOT a node-link graph. A real tag DAG is a hairball past a few
  // hundred nodes, and drawing one needs a layout engine this repo has nowhere to
  // put: no build step, no bundler, no runtime dependencies. A tag DAG is also
  // *mostly* a forest, so the tree is the honest shape - and the handful of tags
  // with several parents are marked rather than hidden. It shipped with Copy as DOT
  // and Copy as Mermaid beside that, for anyone who did want a drawn graph in a tool
  // built for it; 2.2.0 removed them, because the graphs they produced were not
  // legible either.

  var TREE_ROW_CAP = 4000;   // rows rendered at once by a search; see renderSearch

  var COUNTS_LABEL = 'Load counts';
  var REFRESH_COUNTS_LABEL = 'Refresh counts';

  function TreeView(taskName) {
    this.taskName = taskName;
    this.expanded = {};       // tag id -> true
    this.selected = null;
    this.counts = null;       // tag id -> { scenes, images, galleries, performers }
    this.query = '';
  }

  TreeView.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'npt-backdrop');
    this.modal = el('div', 'npt-modal');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'npt-head');
    this.headEl = head;
    head.appendChild(el('div', 'npt-title', PLUGIN_SHORT_NAME + ' - ' + this.taskName));
    this.noteEl = el('div', 'npt-note',
      'Read-only. Nothing here writes anything. Badges reflect the exclusion filters ' +
      'currently set in the plugin settings.');
    head.appendChild(this.noteEl);
    // Rows read "Hair Colour (45)" and badges read "2 children", so a number in
    // brackets here is an id and a number outside them is a count. The inspector's
    // list headings follow the same rule - they say "Parents: 3", not "Parents (3)".
    head.appendChild(el('div', 'npt-legend',
      'Each row reads Tag name (id): the number in brackets is the tag\'s id, not a count. ' +
      'Counts sit outside the brackets, in the badges to the right.'));
    this.modal.appendChild(head);

    this.progressEl = el('div', 'npt-progress', 'Loading tags...');
    this.modal.appendChild(this.progressEl);

    // Two different gestures, deliberately side by side. Find *navigates* - it takes
    // you to a tag and shows it where it lives, in context. Filter *reduces* - it
    // throws the tree away and lists the matches flat. Conflating them would cost
    // whichever half the user wanted this time.
    var searchRow = el('div', 'npt-search');

    var findWrap = el('div', 'npt-find-wrap');
    var findBox = clearableInput('npt-find-input', 'npt-find-clear',
      'Find tag and jump to it...', 'Clear find');
    this.findEl = findBox.input;
    this.findClearBtn = findBox.clear;
    this.findClearBtn.addEventListener('click', function () {
      self.findEl.value = '';
      self.find(false);
      if (self.findEl.focus) self.findEl.focus();
    });
    this.findEl.addEventListener('input', function () { self.find(false); });
    this.findEl.addEventListener('keydown', function (ev) {
      // Enter walks to the next match, the way a find bar is expected to.
      if (ev && (ev.key === 'Enter' || ev.keyCode === 13)) {
        if (ev.preventDefault) ev.preventDefault();
        self.find(true);
      }
    });
    this.findCountEl = el('span', 'npt-find-count', '');
    findWrap.appendChild(findBox.wrap);
    findWrap.appendChild(this.findCountEl);
    searchRow.appendChild(findWrap);

    // Both icons only appear once there is something to clear, so neither reads as
    // a control that does something to the tree.
    var filterBox = clearableInput('npt-search-input', 'npt-search-clear',
      'Filter by name...', 'Clear filter');
    this.searchEl = filterBox.input;
    this.clearBtn = filterBox.clear;
    this.searchEl.addEventListener('input', function () {
      self.setQuery(self.searchEl.value || '');
    });
    this.clearBtn.addEventListener('click', function () {
      self.searchEl.value = '';
      self.setQuery('');
      if (self.searchEl.focus) self.searchEl.focus();
    });
    searchRow.appendChild(filterBox.wrap);
    this.modal.appendChild(searchRow);

    var split = el('div', 'npt-split');
    this.treeEl = el('div', 'npt-tree');
    this.inspectEl = el('div', 'npt-inspect');
    split.appendChild(this.treeEl);
    split.appendChild(this.inspectEl);
    this.modal.appendChild(split);

    var foot = el('div', 'npt-foot');
    this.expandBtn = button('Expand all', 'npt-expand');
    this.collapseBtn = button('Collapse all', 'npt-collapse');
    this.countsBtn = button(COUNTS_LABEL, 'npt-counts');
    this.countsBtn.title = 'Fetch how many scenes, images, galleries and performers ' +
      'carry each tag, and show them as a badge on every row. One query over the whole ' +
      'tag list, so it is asked for rather than loaded with the tree; counts are for the ' +
      'tag itself, not for it plus everything under it. Click again to re-fetch.';
    this.closeBtn = button('Close', 'npt-close');

    this.expandBtn.addEventListener('click', function () { self.expandAll(true); });
    this.collapseBtn.addEventListener('click', function () { self.expandAll(false); });
    this.countsBtn.addEventListener('click', function () { self.loadCounts(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });

    [this.expandBtn, this.collapseBtn, this.countsBtn, this.closeBtn]
      .forEach(function (b) { foot.appendChild(b); });
    this.modal.appendChild(foot);

    wireEscape(this);
    document.body.appendChild(this.backdrop);
    this.checkVersion();
    this.load();
  };

  // Warns and gates nothing. Nothing here writes, so there is nothing to hold back -
  // but the badges and the inspector answer "what would Prune do with this tag" out
  // of the filter rules in *this* script, so a stale tab explains the old behaviour
  // with complete confidence. That is the confusion worth heading off, and it is
  // likeliest in a tab left open from before the update rather than the one the user
  // just reloaded.
  TreeView.prototype.checkVersion = function () {
    var self = this;
    return checkInstalledVersion(function (installed) {
      var warn = el('div', 'npt-stale',
        '\u26a0 This page is running ' + PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION + ', but ' +
        installed + ' is installed. Reload the page (F5); if this warning comes back, ' +
        'hard-refresh with Ctrl+Shift+R (\u2318+Shift+R on a Mac). Everything below describes ' +
        'the rules in this older script, which may not be what the tasks would do now.');
      // Above the read-only line rather than after it: it qualifies everything that
      // line introduces.
      self.headEl.insertBefore(warn, self.noteEl);
    });
  };

  // Every control in this dialog is live from the moment it is built, but the graph
  // behind them only arrives when load() resolves - and never at all if the tag
  // query fails, in which case the dialog stays open saying so. Nothing that reads
  // the graph may assume it is there.
  TreeView.prototype.ready = function () {
    return !!this.graph;
  };

  // Jumps to a match and centres it, rather than reducing the tree to matches.
  // `next` walks to the following match; typing restarts from the first.
  TreeView.prototype.find = function (next) {
    if (!this.ready()) return;
    var raw = (this.findEl.value || '').trim();
    var q = raw.toLowerCase();
    this.show(this.findClearBtn, !!raw);
    if (!q) {
      this.findMatches = null;
      this.findQuery = '';
      this.findCountEl.textContent = '';
      return;
    }

    if (this.findQuery !== q || !this.findMatches) {
      var g = this.graph, hits = [], id;
      for (id in g.byId) {
        if (!hasOwn(g.byId, id)) continue;
        if (((g.byId[id].name) || '').toLowerCase().indexOf(q) !== -1) hits.push(id);
      }
      this.findMatches = this.sortIds(hits);
      this.findQuery = q;
      this.findIndex = 0;
    } else if (next) {
      this.findIndex = (this.findIndex + 1) % this.findMatches.length;
    }

    if (!this.findMatches.length) {
      this.findCountEl.textContent = 'no match';
      return;
    }
    this.findCountEl.textContent = (this.findIndex + 1) + ' of ' + this.findMatches.length;

    this.jumpTo(this.findMatches[this.findIndex], null);
  };

  // The one navigation primitive: open the path, select, redraw, centre. `under`
  // picks *which* occurrence of a multi-parent tag to land on - the row drawn
  // beneath that parent - so a jump can name a branch and not just a tag. Find
  // passes null, meaning "wherever it lives", which is its primary parent.
  TreeView.prototype.jumpTo = function (id, under) {
    // A filter would have replaced the tree with a flat list, and neither "show me
    // where this tag lives" nor "show me its other parent" can be answered from
    // one - there are no branches in it to land in. Being taken somewhere implies
    // the context comes back.
    if (this.query) {
      this.searchEl.value = '';
      this.setQuery('');
    }
    if (under) {
      this.revealPath(under);
      this.expanded[under] = true;   // the row we are aiming at is one of its children
    } else {
      this.revealPath(id);
    }
    this.selected = id;
    this.render();
    this.centerOn(id, under);
  };

  // Opens every ancestor between the tag and its root, following the same primary
  // parent the tree draws it under - otherwise the row exists in a branch nobody
  // can see.
  TreeView.prototype.revealPath = function (id) {
    var guard = 0;
    var parent = this.primaryParent(id);
    while (parent && guard++ < 64) {
      this.expanded[parent] = true;
      parent = this.primaryParent(parent);
    }
  };

  // `under` asks for the occurrence drawn beneath that parent; without one, or if
  // that occurrence is not on screen (its parent is in a cycle, so it is never
  // walked into), fall back to the tag's own row rather than scrolling nowhere.
  TreeView.prototype.centerOn = function (id, under) {
    var occ = under && this.occNodes && this.occNodes[id];
    var row = (occ && occ[under]) || (this.rowNodes && this.rowNodes[id]);
    if (!row) return;
    if (row.scrollIntoView) { row.scrollIntoView({ block: 'center' }); return; }
    // Older engines, and anything that does not take scrollIntoView options: put
    // the row half a viewport down by hand rather than leaving it off screen.
    if (typeof row.offsetTop === 'number' && typeof this.treeEl.clientHeight === 'number') {
      this.treeEl.scrollTop = Math.max(0, row.offsetTop - (this.treeEl.clientHeight / 2));
    }
  };

  TreeView.prototype.setQuery = function (raw) {
    if (!this.ready()) return;
    this.query = String(raw == null ? '' : raw).trim();
    this.show(this.clearBtn, !!this.query);
    this.render();
  };

  // Shared with the run dialog's buttons: strips the hidden class and re-adds it,
  // rather than assuming what else is on the element.
  TreeView.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*npt-hidden/g, '') + (visible ? '' : ' npt-hidden');
  };

  TreeView.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  TreeView.prototype.close = function () {
    unwireEscape(this);
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    if (_active === this) _active = null;
  };

  TreeView.prototype.load = function () {
    var self = this;
    loadSettings().then(function (loaded) {
      self.settings = loaded.settings;
      return gqlRequest(tagQuery(self.settings, true), null);
    }).then(function (data) {
      var tags = ((data.findTags || {}).tags) || [];
      self.graph = buildGraph(tags);
      self.graph.warmAll();
      self.filters = makeFilters(self.settings, self.graph);
      self.roots = self.computeRoots();
      // Top level open, everything below it closed: a four-level namespace scheme
      // renders in a screenful instead of thousands of rows.
      self.roots.forEach(function (id) { self.expanded[id] = true; });
      self.render();
    }, function (e) {
      self.progressEl.textContent = 'Could not load tags: ' + (e && e.message ? e.message : e);
    });
  };

  // A root is a tag Stash knows with no parent Stash still knows. Tags inside a
  // cycle have parents but can never be reached from a root, so they are surfaced
  // as roots too rather than being invisible - which is the case where a viewer
  // earns its keep.
  TreeView.prototype.computeRoots = function () {
    var g = this.graph, out = [], id;
    var reachable = {};
    for (id in g.byId) {
      if (!hasOwn(g.byId, id)) continue;
      if (!g.parentsOf(id).length) { out.push(id); reachable[id] = true; }
    }
    for (id in g.byId) {
      if (!hasOwn(g.byId, id)) continue;
      if (g.cyclic[id] && !hasOwn(reachable, id)) out.push(id);
    }
    return this.sortIds(out);
  };

  TreeView.prototype.sortIds = function (ids) {
    var g = this.graph;
    return ids.slice().sort(function (a, b) {
      var c = collateNames(tagSortKey(g, a), tagSortKey(g, b));
      if (c) return c;
      return lowerId(a, b) ? -1 : 1;
    });
  };

  // The parent a multi-parent tag is drawn under: the first in Stash's own order,
  // so the choice is stable between runs. Everywhere else it appears as a repeat.
  TreeView.prototype.primaryParent = function (id) {
    var parents = this.sortIds(this.graph.parentsOf(id));
    return parents.length ? parents[0] : null;
  };

  TreeView.prototype.expandAll = function (open) {
    if (!this.ready()) return;
    var g = this.graph, id;
    this.expanded = {};
    if (open) {
      for (id in g.byId) if (hasOwn(g.byId, id)) this.expanded[id] = true;
    } else {
      this.roots.forEach(function (rid) { this.expanded[rid] = true; }, this);
    }
    this.render();
  };

  // ── Rendering ─────────────────────────────────────────────────────────────

  TreeView.prototype.render = function () {
    if (!this.ready()) return;
    while (this.treeEl.firstChild) this.treeEl.removeChild(this.treeEl.firstChild);
    this.rowNodes = {};   // tag id -> its real row
    this.occNodes = {};   // tag id -> { parent id -> the row drawn under that parent }
    var total = 0, id;
    for (id in this.graph.byId) if (hasOwn(this.graph.byId, id)) total++;

    var shown;
    if (this.query) {
      shown = this.renderSearch();
      this.progressEl.textContent = shown + ' of ' + plural(total, 'tag') + ' match "' + this.query + '".';
    } else {
      shown = 0;
      this.roots.forEach(function (rid) { shown += this.renderNode(rid, 0, null); }, this);
      this.progressEl.textContent = plural(total, 'tag') + ', ' + plural(this.roots.length, 'root') +
        '. ' + plural(shown, 'row') + ' shown - click a tag for what Prune and Roll Up would do with it.';
    }
    this.renderInspector();
  };

  // Search is flat on purpose: a name match deep in the tree is easier to act on
  // as one row naming its parent than as a path the user has to expand into.
  TreeView.prototype.renderSearch = function () {
    var g = this.graph, hits = [], id;
    // Partial and case-insensitive: this is a find-as-you-type box, not one of the
    // exclusion filters, and nobody types a namespace marker's exact case to locate
    // a tag. The filters themselves stay case-sensitive - they decide what gets
    // written, and matching loosely there would protect or skip tags by accident.
    var q = this.query.toLowerCase();
    for (id in g.byId) {
      if (!hasOwn(g.byId, id)) continue;
      if (((g.byId[id].name) || '').toLowerCase().indexOf(q) !== -1) hits.push(id);
    }
    hits = this.sortIds(hits);
    var capped = hits.length > TREE_ROW_CAP ? hits.slice(0, TREE_ROW_CAP) : hits;
    capped.forEach(function (tid) { this.renderRow(tid, 0, this.primaryParent(tid), true); }, this);
    return capped.length;
  };

  TreeView.prototype.renderNode = function (id, depth, under) {
    var repeat = under !== null && this.primaryParent(id) !== under;
    this.renderRow(id, depth, under, repeat);
    var shown = 1;
    // A repeat is a pointer, not a second copy of the subtree; a cyclic tag is not
    // walked at all, since "children" there can lead back to where we started.
    if (repeat || this.graph.cyclic[id] || !this.expanded[id]) return shown;
    var kids = this.sortIds(this.graph.childrenOf(id));
    kids.forEach(function (kid) { shown += this.renderNode(kid, depth + 1, id); }, this);
    return shown;
  };

  TreeView.prototype.renderRow = function (id, depth, under, repeat) {
    var self = this;
    var g = this.graph;
    var t = g.byId[id] || {};
    var kids = g.childrenOf(id);
    var parents = g.parentsOf(id);

    var row = el('div', 'npt-row' + (this.selected === id ? ' npt-row-sel' : ''));
    row.style = 'padding-left:' + (depth * 1.1) + 'rem';

    var twisty = el('span', 'npt-twisty',
      (repeat || g.cyclic[id] || !kids.length) ? '  ' : (this.expanded[id] ? '▾ ' : '▸ '));
    if (kids.length && !repeat && !g.cyclic[id]) {
      twisty.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        self.expanded[id] = !self.expanded[id];
        self.render();
      });
    }
    row.appendChild(twisty);
    // The tooltip says what the head legend says, at the one place a user hovers to
    // ask: brackets are the tag's id, the same id the run logs it under. It
    // also carries the aliases and description, which is what answers "is this the
    // tag I think it is" without leaving the viewer for the tag page.
    var nameEl = el('span', 'npt-tag-name', (t.name || 'unknown') + ' (' + id + ')');
    nameEl.title = tagTooltip(t, id);
    row.appendChild(nameEl);

    var badges = [];
    if (g.cyclic[id]) badges.push({ cls: 'npt-b-cycle', text: '⚠ cycle' });
    if (repeat && under) {
      // Names where the tag really lives, and takes you there: a pointer that
      // cannot be followed is half a pointer.
      badges.push({
        cls: 'npt-b-repeat npt-b-act',
        text: '↩ shown under ' + tagLabel(g, this.primaryParent(id)),
        title: 'Jump to where this tag is drawn in full',
        act: function () { self.jumpTo(id, self.primaryParent(id)); },
      });
    }
    if (parents.length > 1) {
      // The count alone leaves the user knowing a tag hangs off three branches and
      // with no way to see the other two. Each click walks to the next parent in
      // Stash's order, from wherever this row sits, so n clicks tour all of them;
      // the tooltip names them, for jumping to one directly.
      var sorted = this.sortIds(parents);
      var here = indexOfId(sorted, under);
      var next = sorted[(here + 1) % sorted.length];
      badges.push({
        cls: 'npt-b-diamond npt-b-act',
        text: '◆ ' + parents.length + ' parents',
        title: 'Parents: ' + sorted.map(function (pid) { return tagLabel(g, pid); }).join(', ') +
          '\nJump to it under ' + tagLabel(g, next),
        act: function () { self.jumpTo(id, next); },
      });
    }
    var prot = this.filters.protections(id);
    if (prot.remove) badges.push({ cls: 'npt-b-prot', text: '⛔ never removed: ' + prot.remove });
    if (prot.add) badges.push({ cls: 'npt-b-prot', text: '⛔ never added: ' + prot.add });
    if (!kids.length) badges.push({ cls: 'npt-b-dim', text: 'leaf' });
    else badges.push({ cls: 'npt-b-dim', text: plural(kids.length, 'child', 'children') });
    if (this.counts && hasOwn(this.counts, id)) badges.push({ cls: 'npt-b-dim', text: this.counts[id] });

    badges.forEach(function (b) {
      var node = el('span', 'npt-badge ' + b.cls, b.text);
      if (b.title) node.title = b.title;
      if (b.act) {
        node.addEventListener('click', function (ev) {
          // Or the row's own handler re-renders underneath the jump, discarding
          // the row it just scrolled to.
          if (ev && ev.stopPropagation) ev.stopPropagation();
          b.act();
        });
      }
      row.appendChild(node);
    });

    row.addEventListener('click', function () {
      self.selected = id;
      self.render();
    });
    // The real row wins over a repeat whichever order they were drawn in - which
    // way round that falls out depends on where the parents sit in the tree, not
    // on their sort order. Every occurrence is addressable by its parent.
    if (!repeat || !hasOwn(this.rowNodes, id)) this.rowNodes[id] = row;
    if (under) {
      if (!hasOwn(this.occNodes, id)) this.occNodes[id] = {};
      this.occNodes[id][under] = row;
    }
    this.treeEl.appendChild(row);
  };

  // ── Inspector ─────────────────────────────────────────────────────────────

  TreeView.prototype.descendantsOf = function (id) {
    var g = this.graph, seen = {}, out = [];
    var stack = g.childrenOf(id).slice();
    while (stack.length) {
      var cur = stack.pop();
      if (hasOwn(seen, cur)) continue;   // diamonds converge; cycles would not stop
      seen[cur] = true;
      out.push(cur);
      g.childrenOf(cur).forEach(function (k) { stack.push(k); });
    }
    return this.sortIds(out);
  };

  TreeView.prototype.renderInspector = function () {
    while (this.inspectEl.firstChild) this.inspectEl.removeChild(this.inspectEl.firstChild);
    var g = this.graph;
    var id = this.selected;
    if (!id || !g.byId[id]) {
      this.inspectEl.appendChild(el('div', 'npt-i-hint', 'Select a tag.'));
      return;
    }

    var self = this;
    function line(cls, text) { self.inspectEl.appendChild(el('div', cls, text)); }
    // Every tag named here is a place to go. The Parents list is the direct answer
    // to "jump to any of the other parents" - the badge tours them one at a time,
    // this picks one out of a list that also names them.
    function list(label, ids) {
      if (!ids.length) return;
      // "Parents: 3", not "Parents (3)". Every other bracketed number in this dialog
      // is a id, and a heading that broke the rule read as the tag with id 3.
      line('npt-i-label', label + ': ' + ids.length);
      var body = el('div', 'npt-i-body');
      var capped = ids.slice(0, 24);
      capped.forEach(function (tid, i) {
        var link = el('span', 'npt-i-link', tagLabel(g, tid));
        link.title = 'Jump to this tag';
        link.addEventListener('click', function () { self.jumpTo(tid, null); });
        body.appendChild(link);
        if (i < capped.length - 1) body.appendChild(el('span', null, ', '));
      });
      if (ids.length > 24) {
        body.appendChild(el('span', null, ', and ' + (ids.length - 24) + ' more'));
      }
      self.inspectEl.appendChild(body);
    }

    // The title is a link to the tag's own page, and it opens in a new tab: this
    // viewer is a modal over whatever page you were on, holding a scan of the whole
    // hierarchy, and a navigation in this tab would throw that away to show one tag.
    // An `<a>` rather than a click handler, so middle-click and ctrl-click do what
    // they do everywhere else.
    var title = el('a', 'npt-i-title', tagLabel(g, id));
    title.href = '/tags/' + id;
    title.target = '_blank';
    title.rel = 'noreferrer';
    title.title = 'Open this tag in a new tab';
    this.inspectEl.appendChild(title);

    var anc = [], k, ancMap = g.ancestorsOf(id);
    for (k in ancMap) if (hasOwn(ancMap, k)) anc.push(k);
    anc = this.sortIds(anc);
    var desc = this.descendantsOf(id);

    list('Parents', this.sortIds(g.parentsOf(id)));
    list('All ancestors', anc);
    list('Children', this.sortIds(g.childrenOf(id)));
    list('All descendants', desc);

    line('npt-i-label', 'What the tasks would do');
    var prot = this.filters.protections(id);
    if (desc.length) {
      line('npt-i-body', prot.remove
        ? 'Prune would leave this in place - protected: ' + prot.remove + '.'
        : 'Prune removes this from any entity that also carries one of its ' +
          plural(desc.length, 'descendant') + '.');
    } else {
      line('npt-i-body', 'Prune never removes this: it has no descendants, so nothing on an ' +
        'entity can imply it.');
    }
    if (anc.length) {
      line('npt-i-body', 'Roll Up adds its ' + plural(anc.length, 'ancestor') + ' to every entity ' +
        'carrying this tag.');
    } else {
      line('npt-i-body', 'Roll Up adds nothing for this tag: it has no ancestors.');
    }
    if (prot.add) line('npt-i-body', 'Roll Up would never add this tag itself - protected: ' + prot.add + '.');
    if (g.cyclic[id]) {
      line('npt-i-body', 'This tag is in a hierarchy cycle. Both tasks refuse to touch it: under ' +
        'the plain rule every tag in a cycle implies every other, so all of them would be removed.');
    }
  };

  // ── Counts ────────────────────────────────────────────────────────────────

  // Opt-in, because these are per-tag resolver fields: one query over thousands of
  // tags is the expensive thing in this dialog, and the tree is useful without it.
  // depth: 0 is passed explicitly - the count is for the tag itself, not for it plus
  // everything under it, and relying on the server's default would leave the number
  // ambiguous.
  //
  // The button says what a click *does*, before and after: 'Load counts' while there
  // are none, 'Refresh counts' once there are. It shipped saying 'Counts loaded' -
  // a status, on the one control whose caption a user reads to find out whether it is
  // still worth pressing, and pressing it does still fetch them again.
  TreeView.prototype.loadCounts = function () {
    var self = this;
    if (!this.ready() || this._countsBusy) return;
    this._countsBusy = true;
    this.countsBtn.textContent = 'Loading...';
    gqlRequest(
      'query NPTTagCounts { findTags(filter: { per_page: -1 }) { tags { id ' +
      'scene_count(depth: 0) image_count(depth: 0) gallery_count(depth: 0) ' +
      'performer_count(depth: 0) } } }', null
    ).then(function (data) {
      var tags = ((data.findTags || {}).tags) || [];
      self.counts = {};
      tags.forEach(function (t) {
        var parts = [];
        if (t.scene_count) parts.push(t.scene_count + ' scenes');
        if (t.image_count) parts.push(t.image_count + ' images');
        if (t.gallery_count) parts.push(t.gallery_count + ' galleries');
        if (t.performer_count) parts.push(t.performer_count + ' performers');
        self.counts[t.id] = parts.length ? parts.join(' · ') : 'unused';
      });
      self.countsBtn.textContent = REFRESH_COUNTS_LABEL;
      self._countsBusy = false;
      self.render();
    }, function (e) {
      self.countsBtn.textContent = 'Counts failed';
      self._countsBusy = false;
      self.progressEl.textContent = 'Counts could not be loaded: ' + (e && e.message ? e.message : e);
      setTimeout(function () {
        self.countsBtn.textContent = self.counts ? REFRESH_COUNTS_LABEL : COUNTS_LABEL;
      }, 3000);
    });
  };

  // The graph exports (Copy as DOT / Copy as Mermaid) were removed at 2.2.0. They
  // emitted valid Graphviz and Mermaid for the selection or the whole DAG, and the
  // drawn result was unreadable at real library size - which is the same reason this
  // dialog is a tree and not a node-link graph in the first place. Reintroducing them
  // needs an answer to legibility, not another output format.

  // ── Auto normalize on entity updates ──────────────────────────────────────
  //
  // The two tasks answer "normalize my whole library, once". These two settings
  // answer "and keep it that way": every entity Stash saves is re-normalized in the
  // chosen direction, immediately, with no dialog.
  //
  // That is a deliberate departure from everything else in this plugin, where
  // nothing is written without a plan on screen and a Proceed. Auto Prune deletes
  // tag assignments silently, one save at a time, and the console lines it writes
  // are the only record - there is no Undo out here, because there is no dialog to
  // hang one on. The setting descriptions say so; do not soften them.
  //
  // Which entity types are covered, and in which direction, is the one auto-mode
  // string - so a type is off, pruned or rolled up on its own. The all-off default
  // carries over unchanged: a fresh install reacts to nothing until the user has said
  // which types they have thought about, and the task dialog starts from the same
  // answer rather than from a second list that could disagree with it.
  //
  // Three things keep this from eating a library:
  //
  // 1. Prune and Roll Up are exact inverses, and a type carries exactly one of them,
  //    so the incoherent combination the two global booleans allowed cannot be
  //    expressed any more. That is the point of the tri-state: the old pair had four
  //    combinations for three meanings, and the fourth had to be documented as a
  //    no-op and warned about on the settings page.
  // 2. guarded() stops our own writes - auto or task - from re-entering.
  // 3. A lease, so *other* reactive plugins stand down while we write. This is what
  //    keeps the sibling's auto-merge from bouncing our prune straight back.
  // 4. A per-entity cooldown, for when 3 is not honoured. A plugin older than the
  //    protocol, or a server-side `hooks:` plugin that never sees this window, can
  //    still write back the tags we removed; without the cooldown, prune and that
  //    plugin ping-pong over one entity for as long as the tab is open. After we
  //    write to an entity we ignore further updates to it for AUTO_COOLDOWN_MS,
  //    which caps the exchange at one round and leaves the other plugin's write
  //    standing - the safe direction, since it means fewer deletions, not more.
  //
  // Known gap: `scenesUpdate`/`imagesUpdate` (the array-input plural mutations) are
  // not watched, only the singular and bulk forms. Stash's own UI does not use them
  // for tag edits; if that changes, they need their own branch reading ids out of
  // an array of inputs rather than one `input.ids`.

  // fetch resolves for HTTP 500 and for GraphQL errors returned with HTTP 200, so
  // "the request came back" is not "the edit was saved". Inspect a clone - our
  // handler runs before Apollo's, so the body is still unread - and treat a clone
  // failure as success rather than skipping the reaction.
  function mutationSucceeded(p) {
    return p.then(function (resp) {
      if (!resp || !resp.ok) return false;
      var clone;
      try {
        clone = resp.clone();
      } catch (e) {
        return true;
      }
      return clone.json().then(
        function (json) { return !json || !json.errors; },
        function () { return true; }
      );
    }, function () { return false; });
  }

  var AUTO_MODES_NAME = 'Automatic mode per entity type';

  // Settings are re-read on demand and cached, rather than polled on a timer the way
  // the sibling does. The tasks were this plugin's only entry point until now, so
  // there is no main loop to hang a poll off, and an idle tab should cost nothing:
  // this way a library nobody is editing issues no queries at all.
  var _autoSettings = null, _autoSettingsAt = 0, _autoSettingsPending = null;

  function invalidateAutoSettings() {
    _autoSettings = null;
    _autoSettingsAt = 0;
  }

  function autoSettings() {
    var now = Date.now();
    if (_autoSettings && now - _autoSettingsAt < AUTO_SETTINGS_TTL_MS) {
      return Promise.resolve(_autoSettings);
    }
    // An in-flight read is reused rather than stacking a second query behind it,
    // which is what the throttle exists to stop.
    if (_autoSettingsPending) return _autoSettingsPending;
    _autoSettingsPending = loadSettings().then(function (loaded) {
      _autoSettings = loaded.settings;
      _autoSettingsAt = Date.now();
      _autoSettingsPending = null;
      return _autoSettings;
    }, function (e) {
      _autoSettingsPending = null;
      throw e;
    });
    return _autoSettingsPending;
  }

  // The hierarchy is the expensive read - every tag in the library - and it changes
  // far less often than entities do, so it is cached for longer and invalidated
  // outright whenever a tag mutation goes past (see the fetch wrapper). Without that
  // invalidation a newly created parent would not be honoured for a minute.
  var _autoGraph = null, _autoGraphAt = 0, _autoGraphPending = null;

  function invalidateAutoGraph() {
    _autoGraph = null;
    _autoGraphAt = 0;
  }

  function autoGraph(settings) {
    var now = Date.now();
    if (_autoGraph && now - _autoGraphAt < AUTO_GRAPH_TTL_MS) return Promise.resolve(_autoGraph);
    if (_autoGraphPending) return _autoGraphPending;
    _autoGraphPending = gqlRequest(tagQuery(settings), null).then(function (data) {
      var graph = buildGraph(((data.findTags || {}).tags) || []);
      graph.warmAll();
      _autoGraph = graph;
      _autoGraphAt = Date.now();
      _autoGraphPending = null;
      return graph;
    }, function (e) {
      _autoGraphPending = null;
      throw e;
    });
    return _autoGraphPending;
  }

  // Entity ids we have written to recently, as key -> timestamp. See point 4 above.
  var _autoRecent = {};

  function cooledDown(type, id) {
    var at = _autoRecent[type.key + ':' + id];
    return at != null && Date.now() - at < AUTO_COOLDOWN_MS;
  }

  function markWritten(type, ids) {
    var now = Date.now();
    ids.forEach(function (id) { _autoRecent[type.key + ':' + id] = now; });

    // Swept rather than capped: a bulk edit of a large library can put tens of
    // thousands of ids in here, and every one of them expires on its own schedule.
    var keys = Object.keys(_autoRecent);
    if (keys.length <= AUTO_COOLDOWN_MAX) return;
    keys.forEach(function (k) {
      if (now - _autoRecent[k] >= AUTO_COOLDOWN_MS) delete _autoRecent[k];
    });
  }

  // Auto mode's console lines carry the same "Name" (id) shape as the dialog's, and
  // out here there is no head to put the legend in - so it is said once, before the
  // first line the user ever sees, rather than on every line or not at all. The flag
  // is module-scoped because autoSink() returns a fresh object per reaction.
  var _autoLegendShown = false;
  function autoLegend() {
    if (_autoLegendShown) return;
    _autoLegendShown = true;
    console.info('[' + PLUGIN_ID + '] auto mode is writing. In the lines below, the number in ' +
      'brackets after a name is that entity\'s or tag\'s id.');
  }

  // Enough of a Run for applyBatch to write into. The dialog's version renders to
  // the DOM and feeds Undo; this one only has a console, which is the whole
  // difference between the two modes and the reason the setting descriptions warn
  // about it. `undoable` is collected and dropped on the floor deliberately -
  // applyBatch pushes to it, and there is no dialog here to offer it from.
  function autoSink() {
    return {
      undoable: [], appliedTags: { ADD: {}, REMOVE: {} }, applied: 0, failed: 0, errors: 0,
      log: function (kind, message) {
        autoLegend();
        var line = '[' + PLUGIN_ID + '] ' + message;
        if (kind === 'ERROR') console.error(line);
        else console.info(line);
      },
    };
  }

  // Every plural find query takes `ids: [ID!]`, markers included, so one query
  // fetches exactly the entities that were touched and planEntity runs against them
  // unchanged. No paging, no count - the caller already knows which ids it wants.
  function autoEntityQuery(type) {
    return 'query NPTAuto_' + type.find + '($ids: [ID!]) {' +
      '  ' + type.find + '(ids: $ids) {' +
      '    ' + type.node + ' { ' + type.fields + (type.organized ? ' organized' : '') +
      ' tags { id } }' +
      '  }' +
      '}';
  }

  var _autoExcludeWarned = false;

  // Resolves b1ExcludeEntityWithTagName against the graph in hand, exactly as
  // begin() does. Returns false when the name is set but matches no tag: running
  // unfiltered would touch the entities the user asked to protect, so the reaction
  // is abandoned instead. The dialog stops the whole run for this; out here there is
  // nothing to stop, so it warns once and keeps refusing quietly.
  function autoExcludeTagId(graph, settings) {
    var name = (settings.b1ExcludeEntityWithTagName || '').trim();
    if (!name) { _autoExcludeWarned = false; return null; }
    for (var id in graph.byId) {
      if (hasOwn(graph.byId, id) && graph.byId[id].name === name) {
        _autoExcludeWarned = false;
        return id;
      }
    }
    if (!_autoExcludeWarned) {
      _autoExcludeWarned = true;
      console.warn('[npt] no tag is named "' + name + '" (exact, case-sensitive), so the ' +
        '"Exclude entities carrying this tag" filter cannot be applied. Auto mode is doing ' +
        'nothing until that setting is fixed or cleared.');
    }
    return false;
  }

  function autoNormalize(type, ids) {
    var wanted = [];
    ids.forEach(function (id) {
      var sid = String(id);
      if (sid && !cooledDown(type, sid) && wanted.indexOf(sid) === -1) wanted.push(sid);
    });
    if (!wanted.length) return Promise.resolve();

    return autoSettings().then(function (s) {
      // Re-read here rather than only at the call site: settings can have been
      // refreshed between the mutation going out and this running.
      var mode = modeOf(s, type);
      if (mode === MODE_OFF) return;

      // Someone else is rewriting entities in bulk right now. Their writes look
      // exactly like user edits from in here, and normalizing each one as it lands
      // is how two plugins undo each other. Ours is taken further down, and
      // guarded() has already excluded every write we issue ourselves - so the only
      // thing that can reach this while our own lease is held is a user's save in
      // this tab, which is precisely one that should wait.
      if (autoSuppressed()) return;

      return autoGraph(s).then(function (graph) {
        var excludeTagId = autoExcludeTagId(graph, s);
        if (excludeTagId === false) return;

        var ctx = {
          settings: s, graph: graph,
          filters: makeFilters(s, graph),
          excludeTagId: excludeTagId,
        };

        return gqlRequest(autoEntityQuery(type), { ids: wanted }).then(function (data) {
          var list = (data[type.find] || {})[type.node] || [];
          var plan = [];
          list.forEach(function (ent) {
            var delta = planEntity(type, ent, mode, ctx);
            if (!delta) return;
            plan.push({
              type: type, id: ent.id, label: entityLabel(type, ent),
              add: delta.add, remove: delta.remove, reason: delta.reason,
            });
          });
          if (!plan.length) return;

          var sink = autoSink();
          var batches = buildBatches(plan);
          // Marked before the write, not after: the window has to cover the time the
          // mutation is in flight, which is exactly when another plugin reacting to
          // it will come back at us.
          markWritten(type, plan.map(function (e) { return String(e.id); }));

          var lease = acquireLease(AUTO_MODES_NAME + ' - ' + type.token + '=' +
            MODE_TOKEN[mode], AUTO_LEASE_TTL_MS);
          var i = 0;
          function nextBatch() {
            if (i >= batches.length) return Promise.resolve();
            lease.renew();
            return applyBatch(batches[i++], sink, graph).then(nextBatch);
          }
          return guarded(nextBatch).then(function () {
            lease.release();
          }, function (e) {
            lease.release();
            throw e;
          });
        });
      });
    }).catch(function (e) {
      console.error('[npt] auto ' + type.plural.toLowerCase() + ': ' +
        (e && e.message ? e.message : e));
    });
  }

  // Called from the fetch wrapper once the mutation is known to have succeeded.
  function autoReact(type, ids) {
    if (!ids || !ids.length) return;
    autoNormalize(type, ids);
  }

  // Built once per type per slot and cached on the type: the wrapper runs on every
  // GraphQL request the page makes, and compiling fourteen regexes each time is a
  // cost paid on queries that were never going to match.
  function autoRe(type, slot) {
    var key = '_re_' + slot;
    if (!type[key]) type[key] = new RegExp('\\b' + type[slot] + '\\b');
    return type[key];
  }

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // Up to 3.2.0 this section carried a notice for the one configuration the old
  // settings could express and the plugin could not honour - both auto modes ticked
  // at once, which ran neither. The tri-state string cannot say that, so the notice
  // is gone and what is left is the opposite job: keeping the string the user typed
  // in the shape everything else reads.
  //
  // Where the notice goes, found by the one hook on that page that is not a
  // formatted display string: Stash gives every plugin setting an element id it
  // derives from the plugin id and the setting key -
  //
  //   id: `plugin-${pluginID}-${setting.name}`   (SettingsPluginsPanel.tsx)
  //
  // so `plugin-NormalizeParentTags-a1AutoModes` is ours by construction. No
  // version suffix, no localisation, nothing to guess. Two earlier attempts matched
  // the group's heading text instead and both were wrong about what it says; the
  // heading is now only a fallback, for a Stash that does not set those ids.
  //
  // Finding the id is also what tells us we are on the plugins settings page, so
  // there is no route test either. It was another assumption with nothing checking
  // it, and the ids cannot exist anywhere else.
  function hasClass(node, name) {
    return (' ' + String((node && node.className) || '') + ' ').indexOf(' ' + name + ' ') !== -1;
  }

  function settingElement(key) {
    return document.getElementById('plugin-' + PLUGIN_ID + '-' + key);
  }

  // Walks up from one of our settings to the group box that contains it. The notice
  // goes at the top of that box rather than beside the setting, because the settings
  // themselves live inside a <Collapse> that is shut by default - a notice in there
  // would be invisible until the user expanded the very group it is telling them to
  // look at.
  function ownSettingGroup() {
    var node = settingElement('a1AutoModes'), d;
    for (d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return node;
    }
    // Fallback for a Stash that sets no setting ids: the group headed with our own
    // name. It was the both-modes notice's fallback until 4.0.0 and it outlived that
    // notice, because everything else this section puts on the page - the README
    // link, the description split, the stale banner - needs the same box.
    //
    // Settings - Tasks heads *its* group with the same name, and that group is not
    // this one: it holds the task buttons and no settings, so decorating it would put
    // a README link and a split description on a page that never had either. The
    // heading is only enough to identify us; the buttons are what say which page.
    var heading = ownSettingGroupHeading();
    for (node = heading, d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return hasOwnTaskButton(node) ? null : node;
    }
    return heading && !hasOwnTaskButton(heading.parentElement)
      ? heading.parentElement : null;
  }

  // A plain recursive walk rather than `querySelectorAll`, like the sibling plugins'
  // `findActionByLabel`: it is a handful of nodes, and this way the check works on any
  // node rather than only on one a selector engine will answer for.
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
  // itself - Stash puts the id on the Form.Switch, not on the row - so this walks up
  // to the row the notice should sit against. ' setting ' is matched with its spaces
  // so that "setting-group" is not mistaken for it.
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
  // so the h3 there reads "Normalize Parent Tags (1.2.0)" - and, because that
  // template interpolates the literal when there is no version at all, sometimes
  // "Normalize Parent Tags undefined". Matching the bare name found neither, which
  // is why the notice never appeared at 1.2.0.
  //
  // Strip the suffix and compare exactly, rather than testing a prefix: a plugin
  // called "ᝯㄝₓ Normalize Parent Tags Extra" must not be mistaken for ours.
  function headingIsOurs(text) {
    var t = String(text == null ? '' : text).trim();
    if (t === PLUGIN_NAME) return true;
    t = t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '').trim();
    return t === PLUGIN_NAME;
  }

  // Our own SettingGroup, found the way the task interception finds its own: by a
  // heading carrying the plugin name. Never by position - the page lists every
  // installed plugin, and which one we are is the only thing we can be sure of.
  function ownSettingGroupHeading() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('h3') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (headingIsOurs(nodes[i].textContent)) return nodes[i];
    }
    return null;
  }

  // ── The setting row, taken over by the dialog that edits it ───────────────
  //
  // What Stash renders for a STRING plugin setting, read off `Inputs.tsx` on
  // `develop` (2026-08-18) and confirmed against a live 0.31 page:
  //
  //   <div class="setting" id="plugin-<id>-<key>">     <- ChangeButtonSetting
  //     <div><h3>name</h3><div class="value"><span>RAW</span></div>
  //          <div class="sub-heading">description</div></div>
  //     <div><button>Edit</button></div>               <- opens Stash's own modal
  //   </div>
  //
  // **The id is on the row, not on an input.** A STRING or NUMBER setting goes
  // through `ModalSetting` -> `ChangeButtonSetting`, which puts the id on the row
  // div; only a BOOLEAN puts it on a control (the `Form.Switch`). Everything here
  // that walks *up* from `settingElement` was right either way, which is why nothing
  // noticed - but 4.4.0 read `.value` off it as though it were a text box, and
  // `display:none` on it hid the whole row, heading and description with it. That is
  // exactly what the live screenshot showed.
  //
  // So this replaces the row's two Stash-rendered halves and leaves the rest of it
  // alone: the raw string in `.value` becomes the same line in words, and the Edit
  // button that opens Stash's raw-text modal becomes the button that opens ours.
  //
  //  - **Hidden from JS, and only once ours is in place.** A stylesheet rule would
  //    be shorter and would hide Stash's editor on a page where our own never built,
  //    leaving the setting with no editor at all. Both are re-applied per tick,
  //    because React hands back its own elements on a re-render - the same reason
  //    `paintTaskButtons` repaints every tick.
  //  - **The value comes from the settings cache, not from `.value`.** Our dialog
  //    saves with `configurePlugin` straight from `fetch`, which Stash's React state
  //    never hears about, so its own span would still be showing the old string. The
  //    cache is invalidated by our fetch hook the moment that mutation lands, and the
  //    same hook calls this tick.
  //  - **The button is teal like its twin in Settings - Tasks.** Amber is for a
  //    control that rewrites the library; this one edits a setting, and what that
  //    setting says is already in amber on the line above it.
  //
  // The canonical rewrite that used to live here went with the text box. Stash's
  // modal is still reachable if ours never builds, and a config file can hold
  // anything, so the value is still normalized - from the settings rather than from
  // the field, and only once per distinct string, so a save that fails cannot become
  // a loop.
  var FIELD_LINE_ID = 'npt-modes-line';
  var FIELD_BTN_ID  = 'npt-modes-button';
  var _normalizedFrom = null;

  // The first button in a subtree that is not one of ours. Stash's row has exactly
  // one; ours carries `_nptOwn`, so a second tick finds theirs rather than ours.
  function foreignButton(node) {
    if (!node) return null;
    if (node.tagName === 'BUTTON') return node._nptOwn ? null : node;
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

  function modeFieldTick() {
    var row = settingRow('a1AutoModes');
    if (!row) return;

    var line = document.getElementById(FIELD_LINE_ID);
    if (!line) {
      line = el('div', 'npt-modestring');
      line.id = FIELD_LINE_ID;
    }
    // Beside Stash's own value rather than inside it: React owns that subtree and
    // reconciles it on every re-render, and a node of ours in the middle of one is
    // the kind of thing that survives until it does not.
    var slot = byClass(row, 'value');
    var host = slot ? slot.parentNode : (row.childNodes[0] || row);
    if (line.parentNode !== host) {
      if (slot) host.insertBefore(line, slot.nextSibling);
      else host.appendChild(line);
    }
    hide(slot);

    var btn = document.getElementById(FIELD_BTN_ID);
    if (!btn) {
      btn = el('button', 'btn btn-sm ' + READONLY_BTN_VARIANT, TASK_MODES);
      btn.id = FIELD_BTN_ID;
      btn.type = 'button';
      btn._nptOwn = true;
      btn.addEventListener('click', function (e) {
        if (e.preventDefault) e.preventDefault();
        startRun(TASK_MODES);
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
      if (!_autoSettingsPending) {
        autoSettings().then(function () { modeFieldTick(); }, function () {});
      }
      return;
    }

    var modes = _autoSettings.modes, canon = formatAutoModes(modes);
    // Redrawn only when the value moves: this runs every second, and rebuilding
    // seven spans under the user's pointer for an unchanged value is churn.
    if (line._nptText !== canon) {
      line._nptText = canon;
      renderModeString(line, modes);
    }
    var raw = String(_autoSettings.a1AutoModes || '');
    if (_savingModes || !raw.replace(/^\s+|\s+$/g, '')) return;
    if (raw === canon || raw === _normalizedFrom) return;
    _normalizedFrom = raw;
    saveAutoModes(canon).then(null, function () {});
  }

  // Settings are only read while our own group is actually on the page, so a tab
  // parked anywhere else in Stash costs two getElementById calls a second and no
  // queries.
  // ── The README link on the settings page ──────────────────────────────────
  //
  // Stash does render a link for `url:` in the manifest, but as an unlabelled chain
  // icon in the group header, which is easy to miss entirely. This is the same URL
  // with the file name on it, directly under the description where the eye already
  // is. A description cannot carry it: Stash passes that string to React as a child
  // (`subHeading` in Inputs.tsx), so any <a> in it is escaped and shown as text, and
  // CSS cannot help either - generated content has no href and, in Chrome, is not
  // even copyable.
  //
  // Clicking it does not fold the group: SettingGroup's onDivClick walks up from the
  // event target and returns early for `a` and `button`.
  var README_URL = 'https://github.com/gregttx/StashPlugins/blob/main/NormalizeParentTags/README.md';
  var README_LINK_ID = 'npt-readme-link';

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
  // when it has to. `splitParagraphs` is idempotent: once the children are ours,
  // there is no text node left to split.
  function splitDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'npt-p')) return;   // already ours
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;                   // nothing to split
    var paras = text.split(/\n{2,}/);
    sub.textContent = '';
    paras.forEach(function (para) {
      var t = para.replace(/\s+/g, ' ').replace(/^ | $/g, '');
      if (t) sub.appendChild(el('div', 'npt-p', t));
    });
  }

  // ── Settings verbosity: a summary on the page, the rest on hover ──────────
  //
  // Seventeen settings averaging 220 characters is a wall. A description written as
  // "summary\n\ndetail" now shows only its first paragraph, with the rest moved into
  // a tooltip.
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
  // **What goes in which half is a judgement, made per setting**, which is why the
  // 17 splits are authored by hand rather than cut at the first sentence. The box
  // opens on focus as well as hover, so it is better reachable than a `title` was,
  // but it still does not exist on a touch device. The auto-mode warnings in a8/a9
  // were held in the visible half until 1.7.5 for that reason, and moved into the
  // tooltip at the user's request; see §6.
  var TIP_MARK = 'ⓘ';                       // circled Latin small letter i

  function setTipOpen(sub, on) {
    var cls = String(sub.className || '').replace(/\s*npt-tip-open\b/, '');
    sub.className = (on ? cls + ' npt-tip-open' : cls).replace(/^\s+/, '');
  }

  // A class toggled from JS rather than a `:hover ~` selector, because the two
  // triggers do not sit in one predictable place: the mark is inside the
  // .sub-heading and the name is an <h3> somewhere above it, and a sibling
  // combinator would depend on exactly how Stash nests the pair. This plugin has
  // shipped broken twice on a guess about that markup (§5b), and the guess is not
  // worth making again for a hover.
  //
  // The row is passed rather than the .sub-heading, and the current one looked up
  // per event: an <h3> is Stash's element and survives the re-renders that replace
  // everything we put in the row, so a captured reference would go stale. The flag
  // is what stops a second pair of listeners landing on it each time we rebuild.
  function tipTrigger(node, row) {
    if (!node || node._nptTipWired) return;
    node._nptTipWired = true;
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
    if (kids.length && hasClass(kids[0], 'npt-sum')) return;    // already ours
    var text = sub.textContent || '';
    var cut = text.indexOf('\n\n');
    if (cut === -1) return;                                     // nothing to hide
    var summary = oneLine(text.slice(0, cut));
    // Kept as paragraphs: a native tooltip honours newlines, and a description with
    // three paragraphs run together reads worse than the wall this is replacing.
    var detail = text.slice(cut + 2).split(/\n{2,}/).map(oneLine)
      .filter(function (p) { return !!p; }).join('\n\n');
    if (!summary || !detail) return;
    sub.textContent = '';
    if (!hasClass(sub, 'npt-tipped')) {
      sub.className = ((sub.className || '') + ' npt-tipped').replace(/^\s+/, '');
    }
    var sum = el('span', 'npt-sum', summary);
    sub.appendChild(sum);
    // tabIndex, so the box can be reached and read without a mouse. The box is a
    // sibling of the mark rather than a child: as a child it would sit inside an
    // inline span and inherit its clipping and stacking.
    var mark = el('span', 'npt-tip', TIP_MARK);
    mark.tabIndex = 0;
    sub.appendChild(mark);
    sub.appendChild(el('span', 'npt-tipbox', detail));
    tipTrigger(mark, row);
    // The visible summary opens it too. The mark is a small target for something
    // every row now hides half its text behind, and the box opens *above* the
    // .sub-heading, so it covers the name rather than the sentence being read - the
    // one place a hover-to-open box would have been in its own way.
    tipTrigger(sum, row);
    // The setting's *name* opens the same box. It used to carry a plain `title`
    // instead, so one row had two hover targets showing the same text in two
    // different tooltips - and the browser's was exactly what the box exists to
    // replace. Stash's own `<h3 title>` slot is left empty.
    // querySelector by tag name is all the fake DOM implements, and all this needs.
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
  var DESC_TOGGLE_ID = 'npt-desc-toggle';

  function descCollapsed(sub) { return hasClass(sub, 'npt-desc-collapsed'); }

  function setDescCollapsed(sub, on) {
    var cls = String(sub.className || '').replace(/\s*npt-desc-collapsed\b/, '');
    sub.className = (on ? cls + ' npt-desc-collapsed' : cls).replace(/^\s+/, '');
  }

  function collapseDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    var paras = 0;
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], 'npt-p')) paras++;
    if (paras < 2) return;                        // one paragraph hides nothing
    if (document.getElementById(DESC_TOGGLE_ID)) return;
    // A re-render drops the button and the class together, so the description
    // returns to collapsed rather than to a half-state with no way out of it.
    setDescCollapsed(sub, true);
    var btn = el('button', 'npt-desc-toggle', 'Show more');
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
  var STALE_ID = 'npt-stale-notice';

  // The group's own h3, not a search of the page: the header row comes before the
  // setting rows, each of which has an h3 too, and the group is already ours. That
  // also keeps this working in the plugins that find their group by setting id and
  // have no `headingIsOurs` at all.
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
    var box = el('div', 'npt-stale', '⚠ This page is still running ' +
      PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. ' +
      'Press Ctrl+Shift+R (⌘+Shift+R on a Mac) to reload it: your browser has cached ' +
      'the older script, and everything this plugin does until then is that older code.');
    box.id = STALE_ID;
    slot.parent.insertBefore(box, slot.before);
  }

  // Re-added rather than tracked: React re-renders this panel whenever a setting
  // changes and drops anything we put in it, so the tick puts it back. Keyed on the
  // id, so a re-render that kept it does not produce a second one.
  function ensureReadmeLink() {
    var group = ownSettingGroup();
    if (!group) return;
    // Both of these run on every tick, not just when the link is missing: React
    // re-renders this panel on any settings change, and the class is the only thing
    // making the description's paragraph breaks visible.
    injectStyle();
    if (!hasClass(group, 'npt-own-group')) {
      group.className = ((group.className || '') + ' npt-own-group').replace(/^\s+/, '');
    }
    splitDescription(group);
    collapseDescription(group);   // after the split: it counts the .npt-p divs
    tipSettings();
    ensureStaleNotice(group);     // before the early return: the link outlives it
    if (document.getElementById(README_LINK_ID)) return;
    var link = el('a', 'npt-readme', 'NormalizeParentTags/README.md');
    link.id = README_LINK_ID;
    link.href = README_URL;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = 'Open this plugin\'s documentation for the version it was published at';
    link.style = 'display:inline-block;margin-top:.35rem;font-size:.8rem;';
    var slot = readmeLinkSlot(group);
    slot.parent.insertBefore(link, slot.before);
  }

  // ── Plugin Task buttons ───────────────────────────────────────────────────
  //
  // `ownTaskName` decides what is ours - the same function the click interception
  // keys on, which checks the label *and* the enclosing group's heading, so another
  // plugin declaring a task by the same name is not repainted. It also returns the
  // label, which is what picks amber from teal here.
  //
  // `btn-info` appears in `BTN_VARIANTS` and is also what Show Tag Hierarchy ends up
  // carrying. That is safe because of the guard at the top of `paintButton`, not by
  // accident: it returns on a button that already has the variant being applied, so
  // the strip never runs over our own colour.
  var BTN_VARIANTS = /\bbtn-(secondary|primary|success|info|light|dark|link)\b/g;

  function setClass(node, name, on) {
    if (!node || hasClass(node, name) === !!on) return;
    node.className = on
      ? ((node.className || '') + ' ' + name).replace(/^\s+/, '')
      : String(node.className || '').split(/\s+/)
          .filter(function (c) { return c && c !== name; }).join(' ');
  }

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
      if (!name) continue;
      // Amber says "this rewrites the library", which is the run task alone: the other
      // two edit a setting and browse a tree. Neither carries a state mark - the one
      // that did is gone with the bar, and this page issues no settings query for it.
      paintButton(nodes[i], name === TASK_RUN ? PLUGIN_BTN_VARIANT : READONLY_BTN_VARIANT);
    }
  }

  function settingsTick() {
    // The link belongs on the settings page, and the task buttons are on a different
    // tab from either of them, so both run before anything that looks for our group.
    ensureReadmeLink();
    paintTaskButtons();
    modeFieldTick();
  }

  // No MutationObserver here, unlike the sibling's button injection: this is a
  // banner in a settings panel, not something that has to land before the user can
  // click it, and a second of delay after a re-render costs nothing. The timer plus
  // the navigation hooks are enough, and they cannot fight a React re-render.
  if (window.addEventListener) {
    window.addEventListener('load', settingsTick);
    window.addEventListener('popstate', function () { setTimeout(settingsTick, 300); });
  }
  // Twice, because the checkbox is a controlled input: the click hands off to React,
  // which sets its state and re-renders, so a synchronous read still sees the old
  // value. The 0ms tick lands after that in the normal case and makes the notice
  // feel immediate; the 300ms one covers a slow render.
  document.addEventListener('click', function () {
    setTimeout(settingsTick, 0);
    setTimeout(settingsTick, 300);
  }, true);
  setInterval(settingsTick, 1000);
  settingsTick();

  // ── Task interception ─────────────────────────────────────────────────────
  //
  // Layer 1: capture-phase click. React attaches its handlers to the root
  // container, which is a descendant of document, so a capture listener here runs
  // first and stopPropagation keeps PluginTasks' onPluginTaskClicked - and its
  // misleading "added job to queue" toast - from ever running.
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
    // ancestor for an h3 - which is what this did until 1.8.0 - climbs past the group
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
      var ours = !!heading && (heading.textContent || '').trim() === PLUGIN_NAME;
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
          startRun(vars.task_name || TASK_RUN);
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

      // Any tag mutation invalidates the cached hierarchy. Cheap to test, and
      // without it a parent added in another tab is ignored for up to a minute.
      if (/\btag(s)?(Create|Update|Destroy|Merge)\b/.test(q) || /\bbulkTagUpdate\b/.test(q)) {
        invalidateAutoGraph();
      }

      // Our own settings being saved. Auto mode caches them for
      // AUTO_SETTINGS_TTL_MS, so without this, turning a mode on and immediately
      // saving an entity would be governed by the old settings for up to ten
      // seconds. Two details: re-read only once the mutation has landed, or the old
      // values come straight back and are cached for another ten seconds; and scope
      // it to our own plugin_id, since the settings page saves each plugin in its
      // own mutation.
      if (/\bconfigurePlugin\b/.test(q) && v.plugin_id === PLUGIN_ID) {
        mutationSucceeded(p).then(function (ok) {
          if (!ok) return;
          invalidateAutoSettings();
          settingsTick();
        });
      }

      // One type at most can match: Stash capitalises the type inside the bulk name,
      // so no \b-anchored single name is a substring of a bulk one.
      TYPES.forEach(function (type) {
        var bulk = autoRe(type, 'bulk').test(q);
        if (!bulk && !autoRe(type, 'single').test(q)) return;
        var ids = bulk
          ? (v.input && v.input.ids)
          : (v.input && v.input.id != null ? [v.input.id] : null);
        if (!ids || !ids.length) return;
        // Whether to stand down for someone else's lease is decided inside
        // autoNormalize, once the settings say an auto mode is actually on - asking
        // here would announce "standing down" for a plugin that is not running.
        mutationSucceeded(p).then(function (ok) {
          if (ok) autoReact(type, ids);
        });
      });
    } catch (e) {
      // Not JSON, or no variables - nothing to match on.
    }
    return p;
  };
})();
