// Tag Bundle Clipboard
//
// Requires Stash 0.31.0 or newer: PluginApi component patching (putting tags into an
// edit form) depends on it.
//
// Copies a set of tags off one entity onto a clipboard, and pastes a chosen part of
// it into another entity's edit form. The two entities need no relationship of any
// kind - that is the whole point, and it is what separates this from the two sibling
// plugins here that copy tags along Stash's own relationships.
//
// **Nothing in this file writes to the library.** A paste puts tags into the form in
// front of you and Stash's own Save is what commits them. There is no mutation to
// undo, no lease to take and nothing to stand a reactive plugin down for.
//
// The design notes, and the reasoning behind the parts that look arbitrary, are in
// CLAUDE.md next to this file.
(function () {
  'use strict';

  var PLUGIN_ID   = 'TagBundleClipboard';
  var PLUGIN_NAME = 'ᝯㄝₓ Tag Bundle Clipboard';
  // The name the dialog wears. `PLUGIN_NAME` is the manifest's, and it has to stay
  // byte-identical to the `.yml` because `ownSettingGroup`'s fallback and
  // `headingIsOurs` find this plugin's block on the settings page by matching that
  // heading. This one is free to be short; here it already fits, which is fine - the
  // constant is what makes every head read from one expression.
  var PLUGIN_SHORT_NAME = 'ᝯㄝₓ Tag Bundle Clipboard';

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and goes current the moment plugins are reloaded, while the browser can
  // still be running a script it cached before the edit - so a heading reading 0.1.0
  // over 0.0.1 behaviour is the normal look of a stale script, not a contradiction.
  // This constant travels inside the file. Bump it with the manifest and the yml;
  // the `version` suite fails if the three disagree.
  //
  // Below 1.0.0 deliberately, and it stays there until the plugin has been used in a
  // live Stash: the major digit is the claim that the thing works, and no test in this
  // repo can check a guess about Stash's markup.
  var PLUGIN_VERSION = '0.0.1';

  // Printed before anything else runs, so a script that loads and then throws is told
  // apart from one that never loaded at all: banner plus error means the new code is
  // running and broken, no banner means the browser is still on the old one. Through
  // whatever the console offers rather than console.info directly: this is the first
  // statement in the file, so a console without it would take the whole plugin down
  // before anything loaded.
  function tbc(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  tbc('[tbc] TagBundleClipboard.js ' + PLUGIN_VERSION + ' loaded. This is the running ' +
    'script own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/StashPlugins/blob/main/TagBundleClipboard/README.md';
  var README_LINK_ID = 'tbc-readme-link';
  var DESC_TOGGLE_ID = 'tbc-desc-toggle';
  var STYLE_ID       = 'tbc-style';

  // The repo-wide colour convention: amber for a control that writes, teal for one
  // that only reads. This plugin has one of each, which is unusual here and is the
  // rule read literally rather than a decoration:
  //
  //   Copy Tags   reads the entity and puts a bundle in this browser. Teal.
  //   Paste Tags  puts tags into the edit form, which is what the sibling plugins'
  //               amber staging buttons do. Amber.
  //
  // A Bootstrap variant class rather than a colour of our own, so the hover, focus and
  // active states come from Stash's theme and stay in step with it. Its `btn-warning`
  // renders white text, unlike stock Bootstrap's dark - checked live, 2026-08-11 - so
  // nothing here overrides the foreground.
  var PASTE_BTN_VARIANT = 'btn-warning';
  var COPY_BTN_VARIANT  = 'btn-info';

  var LOG_RENDER_CAP = 1000;   // log lines kept in the DOM; all of them stay in memory
  var FLASH_MS       = 1500;   // how long a button shows its result before reverting
  var SETTINGS_TTL_MS = 10000; // settings are re-read at most this often

  var DEFAULT_BUNDLES = 5;
  var MIN_BUNDLES = 1;
  var MAX_BUNDLES = 50;

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

  // ── The six entities ──────────────────────────────────────────────────────
  //
  // Every type that carries a `tags` field *and* has a detail page to copy from and an
  // edit form to paste into. Two of Stash's seven tag-ish types are deliberately
  // absent, and both absences are stated in the README so neither reads as a bug:
  //
  //   Tag          carries `parents`/`children`, not `tags`. A bundle of tags has
  //                nowhere to land on one.
  //   SceneMarker  carries tags, but has no detail page of its own - the same
  //                placement gap that keeps PropagateTagsAndPerformers from giving
  //                its two marker paths a source button.
  //
  // `route` recognises the page, `one` and `fields` name the entity for the bundle
  // label. Nothing here names a mutation, because this plugin makes none.
  var ENTITIES = {
    scene: {
      key: 'scene', label: 'Scene', plural: 'Scenes',
      one: 'findScene', fields: 'title files { basename }',
      route: /^\/scenes\/(\d+)(?:[/?#]|$)/,
    },
    image: {
      key: 'image', label: 'Image', plural: 'Images',
      one: 'findImage',
      fields: 'title visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }',
      route: /^\/images\/(\d+)(?:[/?#]|$)/,
    },
    gallery: {
      key: 'gallery', label: 'Gallery', plural: 'Galleries',
      one: 'findGallery', fields: 'title files { basename } folder { basename }',
      route: /^\/galleries\/(\d+)(?:[/?#]|$)/,
    },
    performer: {
      key: 'performer', label: 'Performer', plural: 'Performers',
      one: 'findPerformer', fields: 'name',
      route: /^\/performers\/(\d+)(?:[/?#]|$)/,
    },
    studio: {
      key: 'studio', label: 'Studio', plural: 'Studios',
      one: 'findStudio', fields: 'name',
      route: /^\/studios\/(\d+)(?:[/?#]|$)/,
    },
    group: {
      key: 'group', label: 'Group', plural: 'Groups',
      one: 'findGroup', fields: 'name',
      route: /^\/groups\/(\d+)(?:[/?#]|$)/,
    },
  };

  // Which of the six pages is showing, from the route alone.
  function currentRoute() {
    for (var key in ENTITIES) {
      if (!hasOwn(ENTITIES, key)) continue;
      var m = ENTITIES[key].route.exec(location.pathname);
      if (m) return { type: key, id: m[1] };
    }
    return null;
  }

  function firstBasename(files) {
    if (!files) return null;
    for (var i = 0; i < files.length; i++) {
      if (files[i] && files[i].basename) return files[i].basename;
    }
    return null;
  }

  // The display name, reading whichever of the five fields is present rather than
  // switching on the type - a per-type branch there is what let galleries and images
  // log as "untitled" in a sibling for three releases.
  function displayName(ent) {
    if (!ent) return null;
    return ent.title || ent.name || firstBasename(ent.files) ||
      firstBasename(ent.visual_files) || (ent.folder && ent.folder.basename) || null;
  }

  // `Scene "Cool Shoot" (42)`. The one shape every label in this plugin takes, so a
  // bundle in the picker and an entity in a log line read the same way.
  function entityLabel(type, ent, id) {
    var e = ENTITIES[type];
    var name = displayName(ent);
    return (e ? e.label : type) + (name ? ' "' + name + '"' : '') + ' (' + id + ')';
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  //
  // A key is the storage key: renaming one silently resets it for every install and
  // strands the old value in the config.
  var DEFAULTS = {
    a1MaxBundles: '',
    b1LogToConsole: false,
  };

  // Stash has no default for a plugin setting - `PluginSettingConfig` carries a
  // display name, a description and a type, and nothing else - so an untouched box
  // reads as empty and the default has to live here. Clamped rather than refused: a
  // number outside the range is a typo, and refusing it would leave the clipboard
  // behaving as if the setting were unset with nothing saying why.
  function maxBundles(s) {
    var n = parseInt((s && s.a1MaxBundles) || '', 10);
    if (!(n > 0)) return DEFAULT_BUNDLES;
    return Math.max(MIN_BUNDLES, Math.min(MAX_BUNDLES, n));
  }

  // ── Cross-plugin cooperation ──────────────────────────────────────────────
  //
  // `window.__GTTx__` is the only global this repo takes, and everything shared hangs
  // off it. `StashPluginCoop` on its own was a name any third-party plugin could have
  // picked, and a collision would hand someone else's object our leases.
  //
  // `window.StashPluginCoop` stays as an alias to the very same object, and an existing
  // one is adopted rather than replaced. A user who updates one of these plugins and
  // not the others has two releases of the protocol in one tab, and both halves have to
  // keep seeing one set of leases - the alias costs a line, a missed lease costs a bulk
  // run. Keep this function byte-identical across the plugins, like the CSS.
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
    if (!c.order) c.order = {};
    return c;
  }

  // **Three of the five shared mechanisms are correctly left alone, and each absence
  // is a rule rather than an omission:**
  //
  //   no lease           - a lease announces a bulk *write*, and this plugin issues no
  //                        mutation at all. Taking one would stand a reactive sibling
  //                        down over a form edit.
  //   no `respecters`    - the flag says "I react to saves and will stand down". This
  //                        plugin reacts to nothing, and registering would be a claim a
  //                        sibling's dialog repeats to the user and that would be false.
  //   no `declares`      - the registry is for two plugins performing the *identical*
  //                        relationship copy, keyed by a path id. There is no
  //                        relationship here: the user picks both ends by hand, so
  //                        there is no path id that would not be a lie.
  //
  // What it does register is the ordering priority, because its buttons genuinely do
  // share a row with two other plugins' - `insertOrdered` below. 5 sits under
  // PropagateTagsAndPerformers' 10 and MergePerformerTagsToScenes' 20, so these land
  // furthest from Save/Delete, which is right for the most casual pair of buttons in
  // the repo.
  coop().order[PLUGIN_ID] = 5;

  // ── Button gating diagnostics ────────────────────────────────────────────
  //
  // Off unless `__GTTx__.StashPluginCoop.debugButtons = true`, which is typed into the
  // browser console: no setting, no reload, no file edit, and the flag is read at call
  // time so it takes effect on the next tick. On the shared object rather than a global
  // of our own because every plugin here that draws a button into these rows answers to
  // it, and "why is this button missing" is rarely a question about only one of them.
  //
  // Deduplicated per channel: the tick that draws these buttons runs every second and
  // on every DOM mutation burst, so an undeduplicated line would emit forever on a page
  // nobody is touching. What is worth seeing is the moment an outcome changes. Turning
  // the flag off clears the channels, so switching it back on restates the current
  // position rather than staying silent until something moves.
  var _gateLast = {};
  function gateLogOnce(channel, line) {
    if (!coop().debugButtons) { _gateLast = {}; return; }
    if (_gateLast[channel] === line) return;
    _gateLast[channel] = line;
    console.info('[tbc gate] ' + line);
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

  function loadSettings() {
    return gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var all = (data.configuration || {}).plugins || {};
      var raw = all[PLUGIN_ID] || {};
      var s = {};
      for (var k in DEFAULTS) {
        if (!hasOwn(DEFAULTS, k)) continue;
        s[k] = typeof DEFAULTS[k] === 'boolean' ? !!raw[k] : (raw[k] == null ? '' : String(raw[k]));
      }
      return s;
    });
  }

  // Read synchronously by the click handlers and refreshed on a timer, the shape
  // MergePerformerTagsToScenes uses. Awaiting a settings query inside a click would put
  // a round trip between the press and the dialog for a value that changes once a year.
  var _settings = null, _settingsAt = 0, _settingsWait = null;

  function settings() {
    if (!_settings) {
      _settings = {};
      for (var k in DEFAULTS) if (hasOwn(DEFAULTS, k)) _settings[k] = DEFAULTS[k];
    }
    if (!_settingsWait && Date.now() - _settingsAt > SETTINGS_TTL_MS) {
      _settingsWait = loadSettings().then(function (s) {
        _settings = s; _settingsAt = Date.now(); _settingsWait = null;
      }, function () {
        // A failed read keeps the last known settings rather than reverting to the
        // defaults: the clipboard limit going back to 5 because one query failed would
        // discard bundles the user asked to keep.
        _settingsAt = Date.now(); _settingsWait = null;
      });
    }
    return _settings;
  }

  function logToConsole(msg) {
    if (settings().b1LogToConsole) console.info('[tbc] ' + msg);
  }

  // ── The clipboard ─────────────────────────────────────────────────────────
  //
  // `localStorage`, not the server and not the system clipboard.
  //
  //   * It is shared by every tab of one browser against one Stash, which is exactly
  //     the case the feature exists for - the source entity open in one tab, the target
  //     in another.
  //   * The system clipboard was rejected on a fact this repo already had written down:
  //     Stash is commonly served over plain HTTP on a LAN, where `navigator.clipboard`
  //     does not exist at all, and `readText` is unavailable to page script in Firefox
  //     regardless. It would also take the clipboard off whatever the user had copied.
  //   * The server was rejected as cost without a matching need: a bundle is scratch
  //     data with a lifetime of minutes, and putting it in the database would mean a
  //     mutation per copy in a plugin whose whole design is that it makes none.
  //
  // What that costs, stated in the settings description rather than hidden: a bundle
  // does not reach another browser, another device, or the database backup.
  var KEY = '__GTTx__.tagClipboard';

  function storage() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  // A bundle is *persisted* data that outlives a plugin upgrade and cannot be migrated
  // by anything, so it carries a version and is validated on the way in. Anything that
  // does not parse, or does not look like one of ours, is dropped silently rather than
  // thrown: a key some other page happens to have taken must not break the picker.
  function validBundle(b) {
    return !!b && typeof b === 'object' && b.v === 1 &&
      typeof b.type === 'string' && hasOwn(ENTITIES, b.type) &&
      b.id != null && Object.prototype.toString.call(b.tags) === '[object Array]';
  }

  function loadBundles() {
    var store = storage();
    if (!store) return [];
    try {
      var raw = store.getItem(KEY);
      if (!raw) return [];
      var list = JSON.parse(raw);
      if (Object.prototype.toString.call(list) !== '[object Array]') return [];
      return list.filter(validBundle);
    } catch (e) {
      return [];
    }
  }

  function saveBundles(list) {
    var store = storage();
    if (!store) return false;
    try { store.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  // Newest last in storage, newest first in the picker. The limit is applied here
  // rather than on read, so lowering the setting does not discard anything until the
  // next copy - which is what the setting's description promises.
  function pushBundle(bundle) {
    var list = loadBundles();
    list.push(bundle);
    var max = maxBundles(settings());
    while (list.length > max) list.shift();
    return saveBundles(list) ? list : null;
  }

  function dropBundle(at) {
    var list = loadBundles();
    for (var i = 0; i < list.length; i++) {
      if (list[i].at === at) { list.splice(i, 1); saveBundles(list); break; }
    }
    return loadBundles();
  }

  function ago(then) {
    var s = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (s < 60) return plural(s, 'second') + ' ago';
    if (s < 3600) return plural(Math.round(s / 60), 'minute') + ' ago';
    if (s < 86400) return plural(Math.round(s / 3600), 'hour') + ' ago';
    return plural(Math.round(s / 86400), 'day') + ' ago';
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  var CSS =
    // Kept literally identical to the three siblings' CSS wherever the four dialogs
    // overlap, down to the hex values. They are separate strings because the plugins
    // share no module, not because they are meant to look different - and two of them
    // did drift, from #202b33 to #30404d, because nothing compared them.
    // `tests/style.test.js` pins the overlap now, across all four. #202b33 is
    // Blueprint's dark-gray2, the step Stash's own page uses; every dim grey in these
    // dialogs was chosen against it - the log's #a7b6c2 and #7d8f9c - and they separate
    // better on it than on the lighter #30404d.
    '.tbc-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.tbc-modal{background:#202b33;color:#f5f8fa;border:1px solid #394b59;border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.tbc-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.tbc-title{font-size:1.1rem;font-weight:600;}' +
    '.tbc-warn{color:#ffb648;margin-top:.35rem;}' +
    '.tbc-note{color:#a7b6c2;margin-top:.35rem;}' +
    '.tbc-legend{color:#7d8f9c;margin-top:.35rem;font-size:.8rem;}' +
    '.tbc-progress{padding:.5rem 1rem;border-bottom:1px solid #394b59;color:#a7b6c2;' +
    'white-space:pre-wrap;}' +
    '.tbc-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;' +
    'font-size:.8rem;line-height:1.35;min-height:14rem;}' +
    '.tbc-line{white-space:pre-wrap;word-break:break-word;}' +
    '.tbc-spin{color:#a7b6c2;}' +
    '.tbc-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
    '.tbc-ERROR{color:#ff7373;} .tbc-WARN{color:#ffb648;} .tbc-TAG{color:#84d68a;}' +
    '.tbc-INFO{color:#a7b6c2;}' +
    '.tbc-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.tbc-foot button{margin-right:.5rem;}' +
    '.tbc-hidden{display:none;}' +
    // ── The picker's own two panes ──────────────────────────────────────────
    //
    // A fixed `height` rather than the shared `max-height` alone: ticking a checkbox
    // changes the Add button's caption and the counters, and a content-sized modal
    // would resize under the pointer between two ticks. This is the modifier pattern
    // CustomFieldsBulkEditor 0.10.0 established - a class beside the pinned rule,
    // never an edit to what four other plugins share - and the same 88vh, because two
    // plugins defining `.tall` differently is exactly the drift `style` exists to stop.
    '.tbc-modal.tbc-tall{height:88vh;}' +
    // `.tbc-cols` rather than `.tbc-panes`: CustomFieldsBulkEditor already has a
    // `.panes` and it is a different layout (padded, `flex: 2 1 auto`, no divider). A
    // name two plugins share has to mean the same thing in both.
    '.tbc-cols{flex:1 1 auto;display:flex;min-height:0;border-bottom:1px solid #394b59;}' +
    '.tbc-pane{overflow:auto;padding:.5rem 0;}' +
    '.tbc-pane-bundles{flex:0 0 34%;border-right:1px solid #394b59;}' +
    '.tbc-pane-tags{flex:1 1 auto;}' +
    '.tbc-empty{padding:.5rem 1rem;color:#7d8f9c;}' +
    '.tbc-bundle{display:flex;align-items:baseline;gap:.5rem;padding:.35rem 1rem;' +
    'cursor:pointer;border-left:3px solid transparent;}' +
    '.tbc-bundle:hover{background:#3c4f5d;}' +
    '.tbc-bundle-on{background:#425a6b;border-left-color:#7cc4ff;}' +
    '.tbc-bundle-name{flex:1 1 auto;word-break:break-word;}' +
    '.tbc-bundle-meta{color:#7d8f9c;font-size:.8rem;white-space:nowrap;}' +
    '.tbc-bundle-drop{border:0;background:none;color:#7d8f9c;cursor:pointer;padding:0 .25rem;' +
    'font-size:.9rem;line-height:1;}' +
    '.tbc-bundle-drop:hover{color:#ff7373;}' +
    '.tbc-tagrow{display:flex;align-items:baseline;gap:.5rem;padding:.2rem 1rem;margin:0;' +
    'cursor:pointer;}' +
    '.tbc-tagrow:hover{background:#3c4f5d;}' +
    '.tbc-tagrow-have{cursor:default;color:#7d8f9c;}' +
    '.tbc-tagrow-have:hover{background:none;}' +
    '.tbc-have-mark{font-size:.8rem;color:#7d8f9c;}' +
    // Stash's own .sub-heading is white-space: normal, so this plugin's description
    // would collapse into one paragraph. Scoped to the group we marked, never to
    // .sub-heading at large: another plugin's description is not ours to reflow.
    '.tbc-own-group .sub-heading{white-space:pre-wrap;}' +
    '.tbc-own-group .sub-heading .tbc-p{margin:0 0 .35em;}' +
    '.tbc-own-group .sub-heading .tbc-p:last-child{margin-bottom:0;}' +
    // A per-setting description shows its first paragraph and hides the rest in a
    // tooltip. The mark is the only thing saying there is one - a hover that opens with
    // no invitation is a hover nobody makes. Built rather than borrowed: a native
    // `title` opens below-right of the pointer, exactly where the arrow sits, so its
    // first line arrives half covered, and its size cannot be reached from CSS.
    //
    // These rules are shared with all three sibling plugins and `tests/style.test.js`
    // compares them with the prefix stripped: keep them byte-identical, or change all
    // four together.
    '.tbc-tipped{position:relative;}' +
    '.tbc-tip{margin-left:.35rem;cursor:pointer;opacity:.65;font-style:normal;' +
    'font-size:1.05em;}' +
    '.tbc-tip:hover,.tbc-tip:focus{opacity:1;outline:none;}' +
    // pointer-events:none is load-bearing, not tidiness. Opened from the setting's
    // name the box lands over the h3, so a box that took the pointer would fire
    // mouseleave on the name, close, hand the pointer back to the name, and reopen -
    // a flicker loop for as long as it is hovered.
    '.tbc-tipbox{display:none;position:absolute;left:0;bottom:calc(100% + .35rem);' +
    'z-index:1500;width:max-content;max-width:100%;padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.tbc-tipped.tbc-tip-open .tbc-tipbox{display:block;}' +
    // The group description sits in the group header, outside the <Collapse>, so it is
    // on screen at whatever size whether the group is expanded or not. Hiding all but
    // the first paragraph is the only thing that shortens it.
    '.tbc-desc-collapsed .tbc-p:not(:first-child){display:none;}' +
    '.tbc-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
    // Our own row under the tab strip, for the detail pages that render no action row
    // (Scene, Gallery, and Image if it is the same). This is the one container the
    // plugin creates itself, so there is no neighbour to measure a gap off and none of
    // `applyButtonSpacing`'s branches apply - the row spaces its own children instead,
    // which is the `column-gap` case that helper already knows to keep its hands off.
    '.tbc-src-row{display:flex;flex-wrap:wrap;column-gap:.5rem;row-gap:.25rem;' +
    'margin:.5rem 0;}' +
    // ── Colour-coded toggles ────────────────────────────────────────────────
    //
    // Teal for the one setting that only talks to the console, matching every sibling.
    // The bundle limit keeps Stash's blue: it chooses what the clipboard *holds*, not
    // what anything does on its own, and marking everything would mark nothing.
    //
    // Keyed on the id SettingsPluginsPanel.tsx builds from the plugin id and the
    // setting key, the same anchor `settingElement` uses, rather than on position or
    // heading text. Two shapes because the switch is Stash's to render: `::before` is
    // the track of the react-bootstrap Form.Switch it renders today, and `accent-color`
    // covers a plain checkbox if that ever changes.
    '#plugin-TagBundleClipboard-b1LogToConsole{accent-color:#17a2b8;}' +
    '#plugin-TagBundleClipboard-b1LogToConsole:checked~.custom-control-label::before' +
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

  // Stash is commonly served over plain HTTP on a LAN, where the async clipboard API is
  // not available at all, so the textarea + execCommand path is the fallback rather
  // than a legacy branch.
  function copyToClipboard(text, done) {
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
    var nav = window.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      nav.clipboard.writeText(text).then(function () { done(true); },
        function () { done(fallback()); });
      return;
    }
    done(fallback());
  }

  // ── Putting tags into the edit form ───────────────────────────────────────
  //
  // Stash's edit forms do not render their tag list from `formik.values.tag_ids` -
  // `useTagsEdit()` keeps its own copy and calls `setFieldValue` as a side effect - so
  // writing to formik alone would enable Save while leaving the visible chips stale.
  // Going through the control's own `onSelect` does both, and does exactly what a user
  // picking from the dropdown does, which is what makes this portable across six
  // different edit panels without knowing how any of them is wired.
  //
  // The same capture MergePerformerTagsToScenes and PropagateTagsAndPerformers both
  // use, keyed by this plugin's own six-type route rather than by a scene id.
  var _captures = [];
  var CAPTURE_LIMIT = 10;
  var _patchInstalled = false;

  function captureSelect(props) {
    if (!props || !props.isMulti || typeof props.onSelect !== 'function') return;
    var rt = currentRoute();
    _captures.push({ props: props, type: rt && rt.type, id: rt && rt.id, values: props.values || [] });
    if (_captures.length > CAPTURE_LIMIT) _captures.shift();
  }

  // Patches have to be registered before the components they target first render, so
  // this runs at script load; the load-event retry below only covers Stash setting
  // window.PluginApi later than usual.
  function installTagSelectPatch() {
    var api = window.PluginApi;
    if (!api || !api.patch || typeof api.patch.before !== 'function') return false;
    try {
      // A before-patch returns the argument list for the real render, so returning
      // props untouched makes this a pure observer.
      api.patch.before('TagSelect', function (props) { captureSelect(props); return [props]; });
      _patchInstalled = true;
      return true;
    } catch (e) {
      console.warn('[tbc] could not patch TagSelect:', e);
      return false;
    }
  }

  var _warnedNoPatch = false;
  function warnNoPatchOnce() {
    if (_patchInstalled || _warnedNoPatch) return;
    _warnedNoPatch = true;
    console.warn('[tbc] this Stash does not expose PluginApi component patching, so there ' +
      'is no way to put tags into an edit form. The Paste Tags button is not shown. Copy ' +
      'Tags still works, and the bundles are waiting for a Stash that can paste them.');
  }

  function idsOf(items) {
    return (items || []).map(function (t) { return String(t.id); }).sort().join(',');
  }

  // TagSelect is used all over Stash, so pick the capture belonging to this page:
  // newest first, preferring one whose contents match what the control is expected to
  // hold. Matching on what this plugin last put in rather than on the server's tags is
  // what makes a second paste see the already-pasted list - the server's tags would
  // keep re-selecting the stale pre-paste capture and report the same count every time.
  // If nothing matches (hand-edited box) the newest capture is the right answer anyway.
  function findControl(type, id, expectedIds) {
    var wanted = expectedIds ? expectedIds.slice().sort().join(',') : null;
    var newest = null;
    for (var i = _captures.length - 1; i >= 0; i--) {
      var c = _captures[i];
      if (c.type !== type || c.id !== id) continue;
      if (!newest) newest = c;
      if (wanted !== null && idsOf(c.values) === wanted) return c;
    }
    return newest;
  }

  var _pasted = { type: null, id: null, ids: null };

  // What the form is holding right now, which is what a paste is diffed against and
  // what the picker greys out. **The form, never the server**: it reflects a tag the
  // user has just added or removed by hand without saving, which is precisely the state
  // someone pasting into an open editor is in.
  //
  // Returns null where there is no control at all, which the caller reads as "open the
  // Edit tab first" rather than as an empty entity - the two are different facts and
  // conflating them would hide a placement failure behind a normal-looking no-op.
  function formTagIds(type, id) {
    var expected = (_pasted.type === type && _pasted.id === id) ? _pasted.ids : null;
    var control = findControl(type, id, expected);
    if (!control) return null;
    return (control.values || []).map(function (t) { return String(t.id); });
  }

  // The staged item's shape mirrors what MergePerformerTagsToScenes has working live:
  // `aliases` and `image_path` empty rather than omitted, on the chance the control's
  // renderer expects the keys to exist even when there is nothing in them.
  //
  // **The diff lives in `picked()`, not here.** It was in both for one round, and a
  // mutant that gutted this copy passed the whole suite - which is the tell that it was
  // never deciding anything: `picked()` reads the same live control through the same
  // `findControl`, synchronously, on the same press. Two filters over one list are two
  // places to be right about a rule that has one answer, so this one is gone rather
  // than covered by a second check. What is left is honest about what it does: it
  // appends what it is handed.
  function pasteTags(type, id, tags) {
    var expected = (_pasted.type === type && _pasted.id === id) ? _pasted.ids : null;
    var control = findControl(type, id, expected);
    if (!control) throw new Error('could not find the tag box - open the Edit tab first');
    var current = control.values || [];
    var added = tags.map(function (t) {
      return { id: String(t.id), name: t.name, aliases: [], image_path: null };
    });
    if (!added.length) return 0;
    var next = current.concat(added);
    control.props.onSelect(next);
    control.values = next;
    _pasted = { type: type, id: id, ids: next.map(function (t) { return String(t.id); }) };
    return added.length;
  }

  // ── Copying a bundle ──────────────────────────────────────────────────────

  function tagQueryFor(type) {
    var e = ENTITIES[type];
    return 'query TBCEntityTags($id: ID!) { ' + e.one + '(id: $id) { id ' + e.fields +
      ' tags { id name } } }';
  }

  function copyBundle(type, id) {
    var e = ENTITIES[type];
    return gqlRequest(tagQueryFor(type), { id: id }).then(function (data) {
      var ent = data && data[e.one];
      if (!ent) throw new Error('that ' + e.label + ' no longer exists');
      var tags = (ent.tags || []).map(function (t) {
        return { id: String(t.id), name: t.name || ('tag ' + t.id) };
      });
      if (!tags.length) return { count: 0 };
      var bundle = {
        v: 1,
        at: Date.now(),
        type: type,
        id: String(id),
        label: entityLabel(type, ent, id),
        tags: tags,
      };
      var list = pushBundle(bundle);
      if (!list) throw new Error('could not write to this browser storage');
      logToConsole('copied ' + plural(tags.length, 'tag') + ' from ' + bundle.label +
        ' - ' + plural(list.length, 'bundle') + ' on the clipboard');
      return { count: tags.length, kept: list.length };
    });
  }

  // ── The paste dialog ──────────────────────────────────────────────────────

  var _active = null;

  // Escape acts through whichever of Cancel/Close the footer is actually showing, never
  // by calling `close()` itself. The footer is the dialog's own statement of what it
  // will let you do right now, so routing the key through it means the key can never
  // reach a button that is hidden or disabled.
  function escapeButton(run) {
    var order = [run.closeBtn, run.cancelBtn];
    for (var i = 0; i < order.length; i++) {
      var b = order[i];
      if (b && !b.disabled && !hasClass(b, 'tbc-hidden')) return b;
    }
    return null;
  }

  // On `document`, not on the modal: the modal is not focusable, so a click into the
  // log would otherwise put the key out of reach. Removed in `close()` - a dialog that
  // has gone away must not still be answering for the page.
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

  function openPaste(type, id, label) {
    if (_active) return _active;
    _active = new PasteRun(type, id, label);
    return _active;
  }

  function PasteRun(type, id, label) {
    this.type = type;
    this.id = String(id);
    this.scope = label;
    this.lines = [];
    this.selected = null;     // the bundle's `at`, which is its identity in the list
    this.checked = {};        // tag id -> true, for the selected bundle only
    injectStyle();
    this.build();
    wireEscape(this);
    this.render();
  }

  PasteRun.prototype.build = function () {
    var self = this;
    this.backdrop = el('div', 'tbc-backdrop');
    // `tbc-tall` is this plugin's own modifier on the shared modal: ticking a checkbox
    // changes the counters and the Add caption, and a content-sized dialog would resize
    // under the pointer between two ticks.
    this.modal = el('div', 'tbc-modal tbc-tall');

    var head = el('div', 'tbc-head');
    head.appendChild(el('div', 'tbc-title', PLUGIN_SHORT_NAME + ' - Paste Tags - ' + this.scope));
    this.staleEl = el('div', 'tbc-stale tbc-hidden');
    head.appendChild(this.staleEl);
    // Not the siblings' backup warning, and that is the point rather than an omission:
    // this dialog writes nothing to the library, so telling the user to back up first
    // would be false. What replaces it is the sentence saying where the tags actually go.
    head.appendChild(el('div', 'tbc-note', 'Nothing is written to your library. The tags ' +
      'you add go into the tag box on the form behind this dialog, and Stash’s own ' +
      'Save is what commits them - closing the form without saving leaves nothing behind.'));
    this.noteEl = el('div', 'tbc-warn');
    head.appendChild(this.noteEl);
    head.appendChild(el('div', 'tbc-legend', 'A bundle is named for the entity it was ' +
      'copied from, with its database id in brackets. Tags this ' +
      (ENTITIES[this.type] ? ENTITIES[this.type].label : 'entity') +
      ' already carries are listed but cannot be ticked.'));
    this.modal.appendChild(head);

    this.progressEl = el('div', 'tbc-progress');
    this.modal.appendChild(this.progressEl);

    var panes = el('div', 'tbc-cols');
    this.bundlesEl = el('div', 'tbc-pane tbc-pane-bundles');
    this.tagsEl = el('div', 'tbc-pane tbc-pane-tags');
    panes.appendChild(this.bundlesEl);
    panes.appendChild(this.tagsEl);
    this.modal.appendChild(panes);

    this.logEl = el('div', 'tbc-log');
    this.modal.appendChild(this.logEl);

    var foot = el('div', 'tbc-foot');
    // Add leads, matching the four plugins' harmonised footer order. The caption is
    // **Add**, not the siblings' Proceed, for the reason CustomFieldsBulkEditor says
    // Apply: there is no plan above to proceed with - the press is the whole action.
    this.addBtn = button('Add');
    this.addBtn.addEventListener('click', function () { self.add(); });
    this.copyBtn = button('Copy log');
    this.copyBtn.addEventListener('click', function () { self.copyLog(); });
    this.closeBtn = button('Close');
    this.closeBtn.addEventListener('click', function () { self.close(); });
    // Declared so `escapeButton` can look for it without a special case; this dialog
    // has no mid-write state, so it is never shown.
    this.cancelBtn = null;
    foot.appendChild(this.addBtn);
    foot.appendChild(this.copyBtn);
    foot.appendChild(this.closeBtn);
    this.modal.appendChild(foot);

    this.backdrop.appendChild(this.modal);
    document.body.appendChild(this.backdrop);

    checkInstalledVersion(function (installed) {
      self.staleEl.className = 'tbc-stale';
      self.staleEl.textContent = '⚠ This page is still running ' + PLUGIN_SHORT_NAME +
        ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. Press Ctrl+Shift+R ' +
        '(⌘+Shift+R on a Mac) to reload it: your browser has cached the older script.';
      self.log('WARN', 'the running script is ' + PLUGIN_VERSION + ' and ' + installed +
        ' is installed - reload the page');
    });
  };

  PasteRun.prototype.log = function (kind, message) {
    var line = '[' + kind + '] ' + message;
    this.lines.push(line);
    this.logEl.appendChild(el('div', 'tbc-line tbc-' + kind, line));
    while (this.logEl.childNodes.length > LOG_RENDER_CAP) {
      this.logEl.removeChild(this.logEl.childNodes[0]);
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  };

  PasteRun.prototype.copyLog = function () {
    var self = this;
    var orig = this.copyBtn.textContent;
    copyToClipboard(this.lines.join('\n'), function (ok) {
      self.copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { self.copyBtn.textContent = orig; }, FLASH_MS);
    });
  };

  PasteRun.prototype.close = function () {
    unwireEscape(this);
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    if (_active === this) _active = null;
  };

  // Everything the dialog shows is derived from the clipboard and the captured control
  // on every render, rather than tracked: a paste changes what the form holds, dropping
  // a bundle changes the list, and re-deriving is shorter than keeping two views in
  // step. The clipboard is re-read here too, so a bundle copied in another tab while
  // this dialog was open appears the next time anything is clicked.
  PasteRun.prototype.render = function () {
    var self = this;
    var bundles = loadBundles().slice().reverse();   // newest first
    var have = formTagIds(this.type, this.id);
    var haveMap = {};
    (have || []).forEach(function (tid) { haveMap[tid] = true; });

    if (this.selected != null && !bundles.some(function (b) { return b.at === self.selected; })) {
      this.selected = null;
    }
    if (this.selected == null && bundles.length) {
      this.selected = bundles[0].at;
      this.checked = {};
    }

    this.bundlesEl.textContent = '';
    if (!bundles.length) {
      this.bundlesEl.appendChild(el('div', 'tbc-empty', 'The clipboard is empty. Press ' +
        '"Copy Tags" on the detail view of any Scene, Image, Gallery, Performer, Studio ' +
        'or Group to put a bundle on it.'));
    }
    bundles.forEach(function (b) {
      var row = el('div', 'tbc-bundle' + (b.at === self.selected ? ' tbc-bundle-on' : ''));
      row.appendChild(el('span', 'tbc-bundle-name', b.label));
      row.appendChild(el('span', 'tbc-bundle-meta',
        plural(b.tags.length, 'tag') + ' · ' + ago(b.at)));
      var drop = el('button', 'tbc-bundle-drop', '✕');
      drop.type = 'button';
      drop.title = 'Remove this bundle from the clipboard';
      drop.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        dropBundle(b.at);
        if (self.selected === b.at) { self.selected = null; self.checked = {}; }
        self.log('INFO', 'dropped ' + b.label + ' from the clipboard');
        self.render();
      });
      row.appendChild(drop);
      row.addEventListener('click', function () {
        if (self.selected === b.at) return;
        self.selected = b.at;
        self.checked = {};
        self.render();
      });
      self.bundlesEl.appendChild(row);
    });

    var bundle = null;
    for (var i = 0; i < bundles.length; i++) if (bundles[i].at === this.selected) bundle = bundles[i];

    this.tagsEl.textContent = '';
    var addable = 0, already = 0;
    if (!bundle) {
      this.tagsEl.appendChild(el('div', 'tbc-empty', 'Pick a bundle on the left.'));
    } else if (have === null) {
      // A missing control is its own fact, not an empty entity. It means the Edit tab
      // is not open - or that this plugin's guess about which container the button
      // belongs in put it somewhere the form is not.
      this.tagsEl.appendChild(el('div', 'tbc-empty', 'The tag box on this page has not ' +
        'been found. Open the Edit tab and reopen this dialog.'));
    } else {
      bundle.tags.forEach(function (t) {
        var mine = haveMap[String(t.id)];
        if (mine) already++; else addable++;
        // Unchecked *and* disabled, which is the user's "selected out, unselectable":
        // the tag is still listed, so the bundle reads as what was copied, and it can
        // never be part of what is added.
        var row = el('label', 'tbc-tagrow' + (mine ? ' tbc-tagrow-have' : ''));
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.disabled = !!mine;
        box.checked = !mine && self.checked[String(t.id)] !== false;
        box.addEventListener('change', function () {
          self.checked[String(t.id)] = !!box.checked;
          self.updateCounts();
        });
        row.appendChild(box);
        row.appendChild(el('span', null, t.name));
        if (mine) {
          row.appendChild(el('span', 'tbc-have-mark', 'already on this ' +
            (ENTITIES[self.type] ? ENTITIES[self.type].label : 'entity')));
        }
        self.tagsEl.appendChild(row);
      });
      if (!bundle.tags.length) {
        this.tagsEl.appendChild(el('div', 'tbc-empty', 'That bundle carries no tags.'));
      }
    }

    this._bundle = bundle;
    this._counts = { addable: addable, already: already, bundles: bundles.length,
      noForm: !!bundle && have === null };
    this.updateCounts();
  };

  // What is currently ticked, in the bundle's own order so the log reads the way the
  // list does. Reads the checkboxes' model rather than the DOM: a tag defaults to
  // ticked, and `checked[id] === false` is the only thing that unticks it.
  //
  // **A missing control means nothing is pickable, not that the entity is empty.**
  // `formTagIds` returns null there, and reading that as "holds no tags" would offer
  // every tag in the bundle, disable nothing, and end in `pasteTags` throwing on the
  // press - an error where the pane above it is already explaining the real problem.
  PasteRun.prototype.picked = function () {
    var self = this;
    if (!this._bundle) return [];
    var have = formTagIds(this.type, this.id);
    if (have === null) return [];
    var haveMap = {};
    have.forEach(function (tid) { haveMap[tid] = true; });
    return this._bundle.tags.filter(function (t) {
      return !haveMap[String(t.id)] && self.checked[String(t.id)] !== false;
    });
  };

  PasteRun.prototype.updateCounts = function () {
    var c = this._counts || { addable: 0, already: 0, bundles: 0, noForm: false };
    var n = this.picked().length;
    this.progressEl.textContent =
      plural(c.bundles, 'bundle') + ' on the clipboard' +
      // With no control found there is nothing to compare against, and printing
      // "0 tags already there" would read as an answer rather than as the absence of
      // one - the same conflation `picked()`'s null guard exists to prevent, one line
      // further out.
      (c.noForm ? ' · no tag box on this page to compare against'
        : ' · ' + plural(c.addable, 'tag') + ' this ' +
          (ENTITIES[this.type] ? ENTITIES[this.type].label : 'entity') + ' does not have · ' +
          plural(c.already, 'tag') + ' already there');
    this.addBtn.textContent = n ? ('Add ' + plural(n, 'tag')) : 'Add';
    this.addBtn.disabled = !n;
  };

  PasteRun.prototype.add = function () {
    var picked = this.picked();
    if (!picked.length) return;
    var self = this;
    var names = picked.map(function (t) { return t.name; }).join(', ');
    try {
      var n = pasteTags(this.type, this.id, picked);
      this.log('TAG', 'added ' + plural(n, 'tag') + ' to ' + this.scope + ': ' + names);
      this.log('INFO', 'they are in the form behind this dialog - press Save there to ' +
        'keep them.');
      logToConsole('pasted ' + plural(n, 'tag') + ' onto ' + this.scope +
        ' from ' + (this._bundle ? this._bundle.label : 'a bundle'));
    } catch (err) {
      this.log('ERROR', (err && err.message) || String(err));
      this.noteEl.textContent = (err && err.message) || String(err);
    }
    // Re-derived rather than adjusted: the pasted tags are now what the form holds, so
    // the same render that drew them as addable draws them as already there, and a
    // second Add is correctly a no-op.
    self.render();
  };

  // ── Is this script the one Stash has installed? ───────────────────────────
  //
  // "Reload plugins" re-reads the plugin folder on the server; it cannot replace a
  // script this page already fetched and executed. So the manifest can say 0.2.0 while
  // the browser is still running 0.1.0, and every surface Stash renders - the version
  // beside the plugin name included - shows the new number, because they all come from
  // the manifest over GraphQL. Comparing the two is the only way the script can notice
  // it is the stale one.
  //
  // Resolves to null wherever the answer is unknown: a Stash too old for the field, a
  // plugin it cannot see, a failed request. Unknown is not a mismatch.
  function installedVersion() {
    return gqlRequest('query TBCPluginVersion { plugins { id version } }', null)
      .then(function (data) {
        var list = (data && data.plugins) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id) === PLUGIN_ID) return list[i].version || null;
        }
        return null;
      }, function () { return null; });
  }

  function checkInstalledVersion(onMismatch) {
    installedVersion().then(function (installed) {
      if (!installed || installed === PLUGIN_VERSION) return;
      onMismatch(installed);
    });
  }

  // ── The settings page ─────────────────────────────────────────────────────

  function hasClass(node, name) {
    return (' ' + String((node && node.className) || '') + ' ').indexOf(' ' + name + ' ') !== -1;
  }

  // SettingsPluginsPanel.tsx gives every plugin setting an id built from the plugin id
  // and the setting key - `plugin-TagBundleClipboard-a1MaxBundles`. That is ours by
  // construction: no version suffix, no localisation, nothing formatted for display.
  // Two plugins here shipped this broken by matching heading text instead, twice, so
  // the ids are the anchor and the heading is only a fallback.
  function settingElement(key) {
    return document.getElementById('plugin-' + PLUGIN_ID + '-' + key);
  }

  // Walks up from any one of our settings to the group box that contains it. Trying
  // every key rather than a named one means removing or renaming a setting cannot
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

  function settingRow(key) {
    var node = settingElement(key);
    for (var d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting')) return node;
    }
    return null;
  }

  // The two pages that show a group headed with our name do not head it the same way.
  // Settings - Tasks passes the plugin name straight through, but Settings - Plugins
  // appends the version:
  //
  //   heading: `${plugin.name} ${plugin.version ? `(${plugin.version})` : undefined}`
  //
  // so the h3 there reads "... (0.0.1)" - and, because that template interpolates the
  // literal when there is no version at all, sometimes "... undefined".
  //
  // Strip the suffix and compare exactly, rather than testing a prefix: a plugin whose
  // name merely starts with ours must not be mistaken for us.
  function headingIsOurs(text) {
    var t = String(text == null ? '' : text).trim();
    if (t === PLUGIN_NAME) return true;
    t = t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '').trim();
    return t === PLUGIN_NAME;
  }

  function byClass(root, name) {
    if (!root || typeof root.querySelector !== 'function') return null;
    try { return root.querySelector('.' + name) || null; } catch (e) { return null; }
  }

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
  // Stash renders the description as a single text node; React puts that text node back
  // on every re-render of this panel, so this runs on every tick and re-splits when it
  // has to. It is idempotent: once the children are ours, there is no text node left.
  function splitDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'tbc-p')) return;   // already ours
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;                   // nothing to split
    var paras = text.split(/\n{2,}/);
    sub.textContent = '';
    paras.forEach(function (para) {
      var t = oneLine(para);
      if (t) sub.appendChild(el('div', 'tbc-p', t));
    });
  }

  // ── Settings verbosity: a summary on the page, the rest on hover ──────────
  //
  // A description written as "summary\n\ndetail" shows only its first paragraph, with
  // the rest moved into a tooltip. Stash's own Setting renders `<h3 title={tooltip}>`,
  // but SettingsPluginsPanel never passes a tooltip for a plugin setting and
  // `PluginSetting` has no field to declare one - so the slot exists, is always empty
  // for us, and is filled from here.
  //
  // The split rides on the blank line the description format already supports rather
  // than a delimiter of our own. If this script never runs, Stash renders the whole
  // description exactly as it did before, instead of showing a raw marker.
  var TIP_MARK = 'ⓘ';                  // circled Latin small letter i

  function setTipOpen(sub, on) {
    var cls = String(sub.className || '').replace(/\s*tbc-tip-open\b/, '');
    sub.className = (on ? cls + ' tbc-tip-open' : cls).replace(/^\s+/, '');
  }

  // A class toggled from JS rather than a `:hover ~` selector, because the triggers do
  // not sit in one predictable place: the mark is inside the .sub-heading and the name
  // is an <h3> somewhere above it, and a sibling combinator would depend on exactly how
  // Stash nests the pair.
  //
  // The row is passed rather than the .sub-heading, and the current one looked up per
  // event: an <h3> is Stash's element and survives the re-renders that replace
  // everything we put in the row, so a captured reference would go stale. The flag is
  // what stops a second pair of listeners landing on it each time we rebuild.
  function tipTrigger(node, row) {
    if (!node || node._tbcTipWired) return;
    node._tbcTipWired = true;
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
    if (kids.length && hasClass(kids[0], 'tbc-sum')) return;   // already ours
    var text = sub.textContent || '';
    var cut = text.indexOf('\n\n');
    if (cut === -1) return;                                    // nothing to hide
    var summary = oneLine(text.slice(0, cut));
    var detail = text.slice(cut + 2).split(/\n{2,}/).map(oneLine)
      .filter(function (p) { return !!p; }).join('\n\n');
    if (!summary || !detail) return;
    sub.textContent = '';
    if (!hasClass(sub, 'tbc-tipped')) {
      sub.className = ((sub.className || '') + ' tbc-tipped').replace(/^\s+/, '');
    }
    var sum = el('span', 'tbc-sum', summary);
    sub.appendChild(sum);
    // tabIndex, so the box can be reached and read without a mouse. The box is a
    // sibling of the mark rather than a child: as a child it would sit inside an inline
    // span and inherit its clipping and stacking.
    var mark = el('span', 'tbc-tip', TIP_MARK);
    mark.tabIndex = 0;
    sub.appendChild(mark);
    sub.appendChild(el('span', 'tbc-tipbox', detail));
    tipTrigger(mark, row);
    tipTrigger(sum, row);
    var h3 = row.querySelector ? row.querySelector('h3') : null;
    if (h3) tipTrigger(h3, row);
  }

  function tipSettings() {
    for (var k in DEFAULTS) {
      if (hasOwn(DEFAULTS, k)) tipSetting(k);
    }
  }

  // The group description is in the group *header*, which is outside the <Collapse> -
  // so it stays on screen at full height whether the group is expanded or not, and
  // per-plugin collapse does not shorten it. Hiding all but the first paragraph is the
  // only thing that does.
  //
  // A <button>, never a <span>: SettingGroup's onDivClick walks up from the event
  // target and returns early for `a` and `button`, so anything else folds the whole
  // group on click.
  function descCollapsed(sub) { return hasClass(sub, 'tbc-desc-collapsed'); }

  function setDescCollapsed(sub, on) {
    var cls = String(sub.className || '').replace(/\s*tbc-desc-collapsed\b/, '');
    sub.className = (on ? cls + ' tbc-desc-collapsed' : cls).replace(/^\s+/, '');
  }

  function collapseDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    var paras = 0;
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], 'tbc-p')) paras++;
    if (paras < 2) return;                        // one paragraph hides nothing
    if (document.getElementById(DESC_TOGGLE_ID)) return;
    // A re-render drops the button and the class together, so the description returns
    // to collapsed rather than to a half-state with no way out of it.
    setDescCollapsed(sub, true);
    var btn = el('button', 'tbc-desc-toggle', 'Show more');
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
  // Stash serves plugin JS with caching on, so a browser holding the old file goes on
  // running it after an update and nothing on screen says so. The settings heading is
  // where the two numbers meet: Stash builds it as `${name} (${version})` from the
  // **manifest**, read fresh from the server, while `PLUGIN_VERSION` is what this
  // script actually is.
  //
  // No query for it - the number is on the page already, and this tick runs once a
  // second. `installedVersion` asks the server the same question, which is right for a
  // dialog that opens once and wrong for a timer.
  var STALE_ID = 'tbc-stale-notice';

  // The group's own h3, not a search of the page: the header row comes before the
  // setting rows, each of which has an h3 too, and the group is already ours.
  function installedFromHeading(group) {
    var h3 = group && group.querySelector ? group.querySelector('h3') : null;
    var t = h3 ? String(h3.textContent == null ? '' : h3.textContent).trim() : '';
    var m = /\(([^()]+)\)$/.exec(t);
    return m ? m[1].replace(/^\s+|\s+$/g, '') : null;
  }

  function staleSlot(group) {
    var sub = byClass(group, 'sub-heading');
    if (sub && sub.parentNode) return { parent: sub.parentNode, before: sub };
    return { parent: group, before: group.firstChild };
  }

  function ensureStaleNotice(group) {
    var installed = installedFromHeading(group);
    var node = document.getElementById(STALE_ID);
    // No parenthesised version on the heading means Settings - Tasks, which heads its
    // group with the bare name - not a mismatch, and nothing to say.
    if (!installed || installed === PLUGIN_VERSION) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    var slot = staleSlot(group);
    if (node && node.parentNode === slot.parent) return;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    var box = el('div', 'tbc-stale', '⚠ This page is still running ' +
      PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. ' +
      'Press Ctrl+Shift+R (⌘+Shift+R on a Mac) to reload it: your browser has cached ' +
      'the older script, and everything this plugin does until then is that older code.');
    box.id = STALE_ID;
    slot.parent.insertBefore(box, slot.before);
  }

  // Re-added rather than tracked: React re-renders this panel whenever a setting
  // changes and drops anything we put in it, so the tick puts it back. Keyed on the id,
  // so a re-render that kept it does not produce a second one.
  //
  // The group is found by our own setting ids, with `headingIsOurs` behind it for a
  // Stash that renders the ids differently - the fallback exists because two plugins
  // here shipped broken on heading text alone.
  function ownGroupByHeading() {
    var groups = document.querySelectorAll ? document.querySelectorAll('.setting-group') : [];
    for (var i = 0; i < groups.length; i++) {
      var h3 = groups[i].querySelector ? groups[i].querySelector('h3') : null;
      if (h3 && headingIsOurs(h3.textContent)) return groups[i];
    }
    return null;
  }

  function ensureReadmeLink() {
    var group = ownSettingGroup() || ownGroupByHeading();
    if (!group) return;
    // All of these run on every tick, not just when the link is missing: React
    // re-renders this panel on any settings change, and the class is the only thing
    // making the description's paragraph breaks visible.
    injectStyle();
    if (!hasClass(group, 'tbc-own-group')) {
      group.className = ((group.className || '') + ' tbc-own-group').replace(/^\s+/, '');
    }
    splitDescription(group);
    collapseDescription(group);   // after the split: it counts the .tbc-p divs
    tipSettings();
    ensureStaleNotice(group);     // before the early return: the link outlives it
    if (document.getElementById(README_LINK_ID)) return;
    var link = el('a', 'tbc-readme', 'TagBundleClipboard/README.md');
    link.id = README_LINK_ID;
    link.href = README_URL;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = 'Open this plugin’s documentation';
    link.style = 'display:inline-block;margin-top:.35rem;font-size:.8rem;';
    var slot = readmeLinkSlot(group);
    slot.parent.insertBefore(link, slot.before);
  }

  // No MutationObserver here, unlike the button injection: this is decoration in a
  // settings panel, not something that has to land before the user can click it, and a
  // second of delay after a re-render costs nothing.
  function settingsTick() {
    ensureReadmeLink();
  }

  // ── Where a button goes ───────────────────────────────────────────────────
  //
  // All of this is ported from PropagateTagsAndPerformers, which spent six releases
  // getting it right against a live Stash. The reasoning is in the repo-root CLAUDE.md
  // under "Placing a manual button near Stash's own actions" and "deterministic button
  // ordering"; what follows is a copy, not a redesign, and the comments kept here are
  // the ones that would otherwise invite one.

  // The edit form. `.edit-buttons` is Scene's own row, confirmed live. Every other page
  // checked so far renders its edit form inside `.details-edit` instead, a container
  // Stash swaps between two states: a detail-view navbar carrying a Delete button, and
  // the edit form itself carrying Cancel/Save in its place. We want the edit-form
  // instance, so skip any `.details-edit` that carries a Delete.
  function findEditContainer() {
    var c = document.querySelector('.edit-buttons');
    if (c) return c;
    var candidates = document.querySelectorAll('.details-edit');
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i].querySelector('button.delete')) return candidates[i];
    }
    return null;
  }

  // The other half of that swap: the detail-view navbar, carrying Delete. Confirmed
  // live for Performer and Group; Studio, Scene, Gallery and Image are the same guess.
  function findDetailContainer() {
    var candidates = document.querySelectorAll('.details-edit');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].querySelector('button.delete')) return candidates[i];
    }
    return null;
  }

  // ── The tab strip: where a detail button goes on a page with no navbar ─────
  //
  // Only Performer and Group render a navbar. Scene and Gallery show a tab strip
  // instead - Details / File Info / Chapters / Edit - and no action row at all. Read off
  // a live Stash rather than guessed:
  //
  //   <div class="scene-tabs order-xl-first order-last">      <- grandparent, flex
  //     <div>                                                  <- parent, block, 1 child
  //       <div class="mr-auto nav nav-tabs" role="tablist">    <- the strip, flex
  //         <div class="nav-item"><a data-rb-event-key="scene-details-panel" ...>
  //         ... <a data-rb-event-key="scene-edit-panel">Edit</a>
  //
  // **The strip is found by its Edit tab's key, not by its class.** Gallery renders
  // *two* `.nav-tabs` strips - its own panels, and an Images/Add strip for the image
  // list - and only the entity's own carries a `*-edit-panel` key. Scene also renders a
  // second element whose text is exactly "Edit", so matching on the label would be
  // ambiguous there too. The key is the one unambiguous signal on both pages.
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

  var SRC_ROW_CLASS = 'tbc-src-row';

  // A row of our own, immediately after the strip inside the strip's own block-level
  // parent. Not *inside* the strip: it is `role="tablist"`, whose children are meant to
  // be tabs, and it is the flex row the tabs are laid out in. A button in there would be
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
  // branch is the only one they ever reach.
  function findCopyContainer() {
    return findDetailContainer() || ensureTabStripRow();
  }

  // Deterministic ordering between plugins sharing this row. Both siblings' insertion
  // used to always land immediately before their anchor, so with several enabled,
  // whichever plugin's async check resolved last ended up closest to it - a race decided
  // by network timing that could flip on every reload. `coop().order` fixes a priority
  // per plugin id; a button already there and owned by a higher-priority plugin is
  // skipped over rather than displaced. `anchor` may be null, in which case there is
  // nothing to order against.
  function insertOrdered(container, btn, anchor) {
    if (!anchor) { container.appendChild(btn); return; }
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
    container.insertBefore(btn, ref);
  }

  // A plain recursive walk over `childNodes`/`tagName`, deliberately not
  // `querySelectorAll`, which the shared test harness's fake DOM does not implement.
  // Text is the only reliable way to find Save, which carries no distinguishing class,
  // and the only reliable way to find Delete on the rows where it carries no `.delete` -
  // the Scene edit row renders it as `btn btn-danger` with no class at all.
  //
  // Matches `<a>` as well as `<button>`, and trims before comparing: Stash styles some
  // row actions as links and pads their text.
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

  // A new button is inserted before whichever of the row's buttons is "important" - one
  // that must stay the last thing in the row - and appended after everything otherwise.
  // Delete and Save are the two that qualify; a row whose trailing button is neither
  // gets a plain append, which is the safe default in either direction since it never
  // displaces a button this code did not recognise.
  //
  // Three searches, in order: Delete by its `.delete` class, Delete by its text, then
  // Save by its text. Any may be nested inside a wrapper, so the walk up to the
  // container's own direct child happens after the search rather than inside it.
  function insertBeforeImportantAction(container, btn) {
    var node = container.querySelector('button.delete')
            || findActionByLabel(container, 'Delete')
            || findActionByLabel(container, 'Save');
    while (node && node.parentNode !== container) node = node.parentNode;
    insertOrdered(container, btn, node);
    // After insertion, not in the builder: the margins are copied off a sibling, so they
    // cannot be known until the button has a container to be a sibling in.
    applyButtonSpacing(container, btn);
  }

  // `.edit-buttons` computes to `display: block` on a live Stash - not a flex row - so
  // `row-gap` there is inert and wrapped rows sit flush, while `.details-edit`, which
  // *is* flex, spaces correctly from the identical call. Same code, same value, opposite
  // result, decided entirely by the container. So the container is asked which it is and
  // gets the mechanism that works there: `row-gap` where it is honoured, a bottom margin
  // on our own buttons where it is not.
  var ROW_GAP = '.25rem';
  // The horizontal fallback, applied by `applyButtonSpacing` and *only* on the branch
  // that has nothing to measure. Deliberately not on the button at build time:
  // Bootstrap's spacing utilities carry `!important`, so a class here would outrank the
  // inline margins copied off the row and the measurement would never reach the page.
  var SPACING_CLASS = 'mx-1';

  function computedStyleOf(node) {
    var w = (typeof window !== 'undefined') ? window : null;
    if (!w || typeof w.getComputedStyle !== 'function' || !node) return null;
    try { return w.getComputedStyle(node) || null; } catch (e) { return null; }
  }

  function ensureRowSpacing(container) {
    if (!container) return;
    // A real element's `.style` is always a live CSSStyleDeclaration - this guard only
    // ever fires in the test harness, whose fake elements have none until something
    // sets one.
    if (!container.style) container.style = {};
    var cs = computedStyleOf(container);
    var display = (cs && cs.display) || '';
    // Unknown display keeps the flex treatment: it is the one that cannot make a row
    // worse, since an inert `row-gap` is exactly what shipped for three versions.
    var flexish = !display || display.indexOf('flex') !== -1 || display.indexOf('grid') !== -1;
    container._tbcBlockRow = !flexish;
    container.style.rowGap = flexish ? ROW_GAP : '';
  }

  // Stash's own buttons in `.edit-buttons` compute to `margin: 0 10px 0 0`, and 10px is
  // not a step any utility class here can name (at a 14px root, `mx-1` is 3.5px). So the
  // row's step is read off a button Stash put there - one with no `_coopOwner`, so no
  // plugin's button can be mistaken for Stash's - rather than chosen. The donor does not
  // have to be a `<button>`: what identifies one is the `btn` class plus the absence of
  // `_coopOwner`.
  function stashButtonMargins(container) {
    var kids = container.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k._coopOwner || !hasClass(k, 'btn')) continue;
      var cs = computedStyleOf(k);
      if (!cs) return null;
      // A *positive* test, not "not 0px": a style engine with no stylesheet loaded
      // reports the empty string rather than `0px`, which an inequality reads as a
      // margin worth copying and then applies as `margin-left:;` - nothing at all, with
      // the class fallback already skipped.
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
  // `childNodes` snapshot: a real `NodeList` is live.
  function childIndex(kids, btn) {
    for (var i = 0; i < kids.length; i++) { if (kids[i] === btn) return i; }
    return -1;
  }

  // The element whose margin actually borders ours. A row's DOM siblings are not all row
  // actions: React wraps some of them, and a wrapper carries no margin of its own while
  // the action inside it does. `fromEnd` picks which end of a wrapper faces us. An
  // element holding no action anywhere inside returns null, which is the signal
  // `neighbourGap` walks on rather than trusting the element's own margin.
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
  // outward rather than stopping at the first DOM sibling. **A zero read off something
  // this code cannot identify as an action is not evidence of a zero gap** - that
  // mistake doubled a gap on Group's detail row for three releases running.
  //
  // Three answers, treated differently by the caller:
  //   { gap: n }      an action was found, n px away - top our margin up to the step.
  //   { gap: null }   elements are there but nothing recognisable - add nothing. A wrong
  //                   guess here is what doubles a gap.
  //   null            nothing at all on this side - fall back to Stash's own margin.
  //
  // Skipped elements contribute both their margins and are assumed to have no width;
  // width is the one quantity here that cannot be had without a layout that has not
  // settled yet.
  function neighbourGap(container, btn, forward) {
    var kids = container.childNodes || [];
    var idx = childIndex(kids, btn);
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

  // The gap between two inline siblings is the first's right margin plus the second's
  // left margin, so what our button needs on a side depends on what its neighbour
  // already contributes - not on what one donor happens to carry. Nothing on a side
  // means our button is at that end of the row, where Stash's own convention is the
  // whole answer.
  //
  // A `getBoundingClientRect` measurement was tried here instead and taken back out: a
  // distance is a fact about one instant, and these rows are still settling when a
  // button is inserted. **Do not derive a persistent style from a transient
  // measurement.**
  function fillNeighbourGaps(container, btn, m) {
    var step = Math.max(pxOf(m.left), pxOf(m.right));
    return [
      'margin-left:' + sideMargin(neighbourGap(container, btn, false), step, m.left) + 'px',
      'margin-right:' + sideMargin(neighbourGap(container, btn, true), step, m.right) + 'px'
    ];
  }

  // One `cssText` assignment rather than property-by-property, so the whole inline style
  // stays one readable string in the DOM inspector while chasing a placement bug. Three
  // cases, in order:
  //   1. The container spaces its own children with `column-gap` - our button gets it
  //      too, so any margin of ours would be *added* to Stash's spacing rather than
  //      matching it. Nothing to apply.
  //   2. A donor exists - take the row's step from it and fill whatever each neighbour
  //      is not already contributing, leaving the class off so the inline margins are
  //      not outranked.
  //   3. Neither - `mx-1`.
  function applyButtonSpacing(container, btn) {
    var parts = ['align-self:flex-start'];
    var cs = computedStyleOf(container);
    if (!cs || !nonZeroLength(cs.columnGap)) {
      var m = stashButtonMargins(container);
      if (m) parts = parts.concat(fillNeighbourGaps(container, btn, m));
      else if (!hasClass(btn, SPACING_CLASS)) btn.className += ' ' + SPACING_CLASS;
    }
    if (container._tbcBlockRow) parts.push('margin-bottom:' + ROW_GAP);
    btn.style = parts.join(';') + ';';
  }

  // ── The two buttons ───────────────────────────────────────────────────────

  var COPY_BTN_ID  = 'tbc-copy-btn';
  var PASTE_BTN_ID = 'tbc-paste-btn';
  var BTN_CLASS    = 'tbc-btn';

  function clearButtons(id) {
    var node = document.getElementById(id);
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  // Deliberately not the shared `button()` helper: that carries `btn-sm`, sized for the
  // dialog's own footer. Stash's own Save/Delete and the sibling plugins' on-page
  // buttons all carry plain `btn btn-<variant>` with no size modifier, so a `btn-sm`
  // button beside them reads smaller in both height and font-size.
  //
  // No margin here on purpose: `applyButtonSpacing` sets them inline from the row's own
  // convention, and a Bootstrap `mx-*` class would outrank it. `align-self:flex-start`
  // opts the button out of a flex row's `align-items: stretch`, so it is the same height
  // whichever row it lands on.
  function buildButton(id, label, variant, title, onClick) {
    var btn = el('button', 'btn ' + variant + ' ' + BTN_CLASS, label);
    btn.type = 'button';
    btn.id = id;
    btn._coopOwner = PLUGIN_ID;  // read by `insertOrdered`'s cross-plugin priority scan
    btn._tbcLabel = label;
    btn.title = title;
    btn.style = 'align-self:flex-start;';
    btn.addEventListener('click', function (event) {
      if (event && event.preventDefault) event.preventDefault();
      onClick(btn);
    });
    return btn;
  }

  function flash(btn, text) {
    btn.textContent = text;
    setTimeout(function () { btn.textContent = btn._tbcLabel; }, FLASH_MS);
  }

  var COPY_LABEL  = 'Copy Tags';
  // "..." because the click opens a dialog rather than acting - the repo-wide
  // convention. The copy button has none: it acts immediately and writes nothing.
  var PASTE_LABEL = 'Paste Tags...';

  function onCopy(btn) {
    var rt = currentRoute();
    if (!rt) return;
    btn.disabled = true;
    btn.textContent = 'Working...';
    copyBundle(rt.type, rt.id).then(function (r) {
      btn.disabled = false;
      flash(btn, r.count ? ('Copied ' + plural(r.count, 'tag')) : 'No tags');
    }, function (err) {
      btn.disabled = false;
      btn.textContent = btn._tbcLabel;
      console.error('[tbc]', err);
      alert('Error: ' + (err && err.message ? err.message : err));
    });
  }

  function onPaste(btn) {
    var rt = currentRoute();
    if (!rt) return;
    var e = ENTITIES[rt.type];
    // The dialog is its own feedback and it covers this button, so the caption is
    // restored immediately rather than flashed underneath a modal nobody can see.
    // One by-id query for the label would put a round trip between the press and the
    // dialog; the form's own heading is not reachable from here, so the scope is named
    // from the route alone and the bundle list carries the richer labels.
    openPaste(rt.type, rt.id, e.label + ' ' + rt.id);
  }

  function copyTitle() {
    return 'Put every tag on this entity onto the clipboard as one bundle, ready to ' +
      'paste onto another entity. Nothing is written and nothing is removed.';
  }

  function pasteTitle() {
    return 'Pick a bundle from the clipboard and choose which of its tags to add to ' +
      'the tag box on this form. Tags already here cannot be picked, and Stash’s ' +
      'own Save is what commits what you add.';
  }

  // Reconciliation, not tracking: React can tear down and rebuild these rows on a
  // re-render, so there is nothing durable to track. Each tick rebuilds its opinion of
  // which buttons should exist from the route and the containers, and an id keeps a
  // re-render that kept ours from producing a second one.
  function buttonsTick() {
    var rt = currentRoute();
    if (!rt) {
      gateLogOnce('route', 'not on a Scene/Image/Gallery/Performer/Studio/Group page');
      clearButtons(COPY_BTN_ID);
      clearButtons(PASTE_BTN_ID);
      return;
    }
    injectStyle();
    gateLogOnce('route', 'on ' + ENTITIES[rt.type].label + ' ' + rt.id);

    // The copy button, on the detail view.
    var copyBox = findCopyContainer();
    var copy = document.getElementById(COPY_BTN_ID);
    if (!copyBox) {
      gateLogOnce('copy', 'no detail button row or tab strip on ' + ENTITIES[rt.type].label +
        ' - Copy Tags not shown');
      if (copy && copy.parentNode) copy.parentNode.removeChild(copy);
    } else {
      if (copy && (copy.parentNode !== copyBox || copy._tbcEntity !== rt.type + ':' + rt.id)) {
        copy.parentNode.removeChild(copy);
        copy = null;
      }
      if (!copy) {
        copy = buildButton(COPY_BTN_ID, COPY_LABEL, COPY_BTN_VARIANT, copyTitle(), onCopy);
        copy._tbcEntity = rt.type + ':' + rt.id;
        ensureRowSpacing(copyBox);
        insertBeforeImportantAction(copyBox, copy);
      }
      gateLogOnce('copy', 'Copy Tags shown on ' + ENTITIES[rt.type].label + ' ' + rt.id);
    }

    // The paste button, on the edit form. It needs somewhere to put the tags, so a
    // Stash with no component patching gets no button at all rather than one that
    // fails on click - there is nothing to degrade to here that would not be a
    // mutation, which is the one thing this plugin does not do.
    var paste = document.getElementById(PASTE_BTN_ID);
    if (!_patchInstalled) {
      warnNoPatchOnce();
      gateLogOnce('paste', 'PluginApi component patching is unavailable - Paste Tags not shown');
      if (paste && paste.parentNode) paste.parentNode.removeChild(paste);
      return;
    }
    var editBox = findEditContainer();
    if (!editBox) {
      gateLogOnce('paste', 'no edit form open on ' + ENTITIES[rt.type].label +
        ' - Paste Tags not shown');
      if (paste && paste.parentNode) paste.parentNode.removeChild(paste);
      return;
    }
    if (paste && (paste.parentNode !== editBox || paste._tbcEntity !== rt.type + ':' + rt.id)) {
      paste.parentNode.removeChild(paste);
      paste = null;
    }
    if (!paste) {
      paste = buildButton(PASTE_BTN_ID, PASTE_LABEL, PASTE_BTN_VARIANT, pasteTitle(), onPaste);
      paste._tbcEntity = rt.type + ':' + rt.id;
      ensureRowSpacing(editBox);
      insertBeforeImportantAction(editBox, paste);
    }
    gateLogOnce('paste', 'Paste Tags shown on ' + ENTITIES[rt.type].label + ' ' + rt.id);
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  //
  // A `MutationObserver` for the buttons, unlike the settings page's plain tick: a
  // button has to land before the user can click it, and Stash's edit forms re-render on
  // every keystroke, so polling alone would leave it flickering in and out. A burst of
  // mutations is coalesced into one tick.
  var _tickTimer = null;

  function tick() {
    try { settingsTick(); } catch (e) { console.error('[tbc] settings tick:', e); }
    try { buttonsTick(); } catch (e) { console.error('[tbc] buttons tick:', e); }
  }

  function scheduleTick() {
    if (_tickTimer) return;
    _tickTimer = setTimeout(function () { _tickTimer = null; tick(); }, 100);
  }

  function startObserver() {
    if (typeof MutationObserver !== 'function') return;
    var root = document.getElementById('root') || document.body;
    if (!root) return;
    new MutationObserver(scheduleTick).observe(root, { childList: true, subtree: true });
  }

  // Patches have to be registered before the components they target first render, so
  // this runs at script load. The load-event retry only covers Stash setting
  // window.PluginApi later than usual.
  installTagSelectPatch();

  if (window.addEventListener) {
    window.addEventListener('load', function () {
      if (!_patchInstalled) installTagSelectPatch();
      startObserver();
      tick();
    });
    window.addEventListener('popstate', function () { setTimeout(tick, 300); });
  }
  document.addEventListener('click', function () {
    setTimeout(tick, 0);
    setTimeout(tick, 300);
  }, true);
  setInterval(tick, 1000);
  settings();   // warm the settings cache so the first copy knows the bundle limit
  startObserver();
  tick();
}());
