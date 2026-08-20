// Scene Variants
//
// Requires Stash 0.28.0 or newer: the scene page's `ScenePage.Tabs` and
// `ScenePage.TabContent` patch points are what this plugin is built on.
//
// A scene is often in the library twice: the whole thing, and a cut out of it. Stash
// has no first-class relation for "these two files are the same work", so the Siblings
// tab this plugin adds to the scene page is that relation, derived rather than stored:
// the scenes sharing this one's stash-id, with whichever of them is the full-length one
// named as such.
//
// **Nothing in this file writes to the library.** It reads one query and draws a list
// of links. There is no mutation to undo, no lease to take and nothing to stand a
// reactive plugin down for.
//
// The design notes, and the reasoning behind the parts that look arbitrary, are in
// CLAUDE.md next to this file.
(function () {
  'use strict';

  var PLUGIN_ID   = 'SceneVariants';
  var PLUGIN_NAME = 'ᝯㄝₓ Scene Variants';
  // The name a head wears. `PLUGIN_NAME` is the manifest's and has to stay
  // byte-identical to the `.yml`, because `ownSettingGroup`'s fallback and
  // `headingIsOurs` find this plugin's block on the settings page by matching that
  // heading. This one is free to be short; here it already fits.
  var PLUGIN_SHORT_NAME = 'ᝯㄝₓ Scene Variants';

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and goes current the moment plugins are reloaded, while the browser can
  // still be running a script it cached before the edit - so a heading reading one
  // version over the previous one's behaviour is the normal look of a stale script,
  // not a contradiction.
  //
  // The major digit is zero and stays there until the plugin has been used in a live
  // Stash: it is the claim that the thing works, and no test in this repo can check a
  // guess about Stash's markup or about a filter field name.
  var PLUGIN_VERSION = '0.1.0';

  // Printed before anything else runs, so a script that loads and then throws is told
  // apart from one that never loaded at all. Through whatever the console offers rather
  // than console.info directly: this is the first statement in the file.
  function svr(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  svr('[svr] SceneVariants.js ' + PLUGIN_VERSION + ' loaded. This is the running ' +
    'script\'s own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/StashPlugins/blob/main/SceneVariants/README.md';
  var README_LINK_ID = 'svr-readme-link';
  var DESC_TOGGLE_ID = 'svr-desc-toggle';
  var STYLE_ID       = 'svr-style';

  // The tab's own key, in the namespace Stash's own nine sit in - `scene-details-panel`,
  // `scene-edit-panel` and the rest. `svr` in the middle of it because the key is a
  // string in a space Stash owns and any plugin can write into: it is not a class we
  // prefix by convention, it is the value `activeTabKey` holds while our tab is open.
  var TAB_KEY = 'scene-svr-siblings-panel';
  var TAB_LABEL = 'Siblings';

  var SETTINGS_TTL_MS = 10000;   // settings are re-read at most this often

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  // "3 scenes", "1 scene" - the count is always known where it is printed, so the
  // "(s)" these plugins used to write everywhere was never carrying information. An
  // irregular plural passes its own; everything else takes an "s". Keep this function
  // byte-identical across the plugins, like the CSS.
  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function oneLine(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').replace(/^ | $/g, '');
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  //
  // A key is the storage key: renaming one silently resets it for every install and
  // strands the old value in the config.
  //
  // The two tag names are the user's, not this plugin's, and they are deliberately
  // empty by default. A library that has not adopted the convention still gets the
  // panel - the siblings are found from the stash-id, which owes nothing to a tag -
  // and every row simply reads as unclassified. Inventing a default like "Full Length"
  // would name a tag most libraries do not have and then quietly classify nothing,
  // which looks exactly like a broken plugin.
  var DEFAULTS = {
    a1FullLengthTag: '',
    a2PartialLengthTag: '',
    b1LogToConsole: false,
  };

  // Compared case-insensitively and with the surrounding space trimmed, because these
  // are typed into a settings box by hand rather than picked from a list.
  function tagKey(name) {
    return String(name == null ? '' : name).replace(/^\s+|\s+$/g, '').toLowerCase();
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

  // **Five of the shared mechanisms are correctly left alone, and each absence is a rule
  // rather than an omission:**
  //
  //   no lease           - a lease announces a bulk *write*, and this plugin issues no
  //                        mutation at all.
  //   no `respecters`    - the flag says "I react to saves and will stand down". This
  //                        plugin reacts to nothing.
  //   no `declares`      - the registry is for two plugins performing the *identical*
  //                        relationship copy, keyed by a path id. Nothing here copies a
  //                        relationship, so any path id would be a lie.
  //   no `order`         - the ordering protocol is for buttons sharing one of Stash's
  //                        own action rows. This plugin draws no button at all.
  //   no `domBus`        - the shared MutationObserver is for a control that has to be
  //                        put back into Stash's DOM after every re-render. This plugin
  //                        hands React a component and React renders it, so there is
  //                        nothing to reconcile and nothing to watch for. The settings
  //                        page is decoration, which the one-second timer covers - the
  //                        same position `NormalizeParentTags` is in.
  //
  // What it does read is `debugButtons`, below - the tab is a control drawn into Stash's
  // chrome and "why is it not there" is the same question that flag answers for every
  // sibling.

  // ── Tab gating diagnostics ───────────────────────────────────────────────
  //
  // Off unless `__GTTx__.StashPluginCoop.debugButtons = true`, which is typed into the
  // browser console: no setting, no reload, no file edit, and the flag is read at call
  // time so it takes effect on the next tick.
  //
  // Deduplicated per channel, because a React re-render can ask the same question many
  // times a second. Turning the flag off clears the channels, so switching it back on
  // restates the current position rather than staying silent until something moves.
  var _gateLast = {};
  function gateLogOnce(channel, line) {
    if (!coop().debugButtons) { _gateLast = {}; return; }
    if (_gateLast[channel] === line) return;
    _gateLast[channel] = line;
    console.info('[svr gate] ' + line);
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
      var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
      var s = {};
      for (var k in DEFAULTS) {
        if (!hasOwn(DEFAULTS, k)) continue;
        s[k] = typeof DEFAULTS[k] === 'boolean' ? !!raw[k] : (raw[k] == null ? '' : String(raw[k]));
      }
      return s;
    });
  }

  // Read synchronously by the settings tick and refreshed on a timer, the shape every
  // sibling plugin uses.
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
        _settingsAt = Date.now(); _settingsWait = null;
      });
    }
    return _settings;
  }

  function logToConsole(msg) {
    if (settings().b1LogToConsole) console.info('[svr] ' + msg);
  }
  // ── Finding the siblings ──────────────────────────────────────────────────
  //
  // One query, which is what the plan sketched and what a DOM-injected panel could not
  // have: the tab is handed `props.scene`, a `SceneDataFragment`, and that fragment
  // already carries `stash_ids`. Reading them off the page instead of asking for them is
  // the whole saving - there is nothing to look up before the filter can be written.
  //
  // `stash_ids_endpoint` takes a *list*, so one call covers a scene carrying several
  // ids, and the endpoint is deliberately left out: a sibling set that spans two
  // metadata providers is still one work, and naming an endpoint would hide half of it.
  // Omitting it leaves the endpoint out of the join condition entirely, which is what
  // makes that work rather than matching nothing.
  //
  // **The modifier is EQUALS, and it is the one that means "any of these".** The stash
  // IDs criterion accepts exactly four - IS_NULL, NOT_NULL, EQUALS, NOT_EQUALS - and
  // rejects everything else outright, INCLUDES among them; EQUALS over a list ORs the
  // ids, which is the semantics wanted here. INCLUDES is the natural guess for a list
  // criterion and every other list filter in Stash takes it, so this is the one place
  // reading like its neighbours is wrong.
  var SIBLINGS_QUERY =
    'query SVRSiblings($ids: [String!]) { findScenes(' +
    'scene_filter: { stash_ids_endpoint: { stash_ids: $ids, modifier: EQUALS } }, ' +
    'filter: { per_page: -1 }) { scenes { id title tags { id name } ' +
    'files { duration width height } } } }';

  // Resolves once the first settings read has landed, so the rows are classified against
  // the user's tag names rather than against the empty defaults. The pane reads settings
  // exactly once, when it mounts, and nothing re-renders it afterwards - so a
  // classification made half a second early would simply be wrong for as long as the tab
  // stayed open.
  function settingsReady() {
    settings();
    // `_settingsWait`'s own handlers return nothing - they assign `_settings` and are
    // done - so what resolves has to be read back rather than passed through.
    return _settingsWait ? _settingsWait.then(function () { return _settings; })
      : Promise.resolve(_settings);
  }

  // Everything the tab shows, as one promise: the rows in the order they go on screen,
  // and the sentence explaining what they were matched on. The three empty answers are
  // values rather than failures - a scene with no stash-id is the ordinary case here,
  // not an error - and only the fourth, a query the server refused, is loud.
  function findSiblings(scene) {
    var ids = ((scene && scene.stash_ids) || []).map(function (s) { return s.stash_id; })
      .filter(function (v) { return !!v; });
    if (!ids.length) {
      return Promise.resolve({ rows: [], why: 'This scene carries no stash-id, which is ' +
        'the only evidence this plugin uses so far.' });
    }
    return settingsReady().then(function (s) {
      return gqlRequest(SIBLINGS_QUERY, { ids: ids }).then(function (data) {
        var scenes = (((data || {}).findScenes) || {}).scenes || [];
        var others = scenes.filter(function (o) { return String(o.id) !== String(scene.id); });
        logToConsole('scene ' + scene.id + ': ' + plural(others.length, 'sibling') +
          ' from ' + plural(ids.length, 'stash-id'));
        return {
          rows: ordered(others, s),
          why: others.length
            ? 'Matched on ' + plural(ids.length, 'stash-id') + '.'
            : 'No other scene shares this one’s ' + plural(ids.length, 'stash-id') + '.',
        };
      });
    }).then(null, function (err) {
      // Loud rather than silent: a pane that stays empty because a filter field is
      // named differently on this Stash looks exactly like a scene with no siblings,
      // and only one of those is worth reporting.
      console.warn('[svr] sibling lookup failed for scene ' + scene.id + ': ' + err.message);
      return { rows: [], why: 'The sibling query failed: ' + err.message };
    });
  }
  // ── Classifying a sibling ─────────────────────────────────────────────────
  //
  // The dimension is read off a tag, which is the whole of what makes it cheap: the
  // hard half of the problem is "which scenes are the same work", and it is already
  // answered by the time this runs.
  //
  // A scene carrying *both* tags is a real error rather than a tie - the two values are
  // mutually exclusive by definition - so it is shown as one instead of being resolved
  // by whichever test ran first.
  function classify(scene, s) {
    var full = tagKey(s.a1FullLengthTag), partial = tagKey(s.a2PartialLengthTag);
    var hasFull = false, hasPartial = false;
    (scene.tags || []).forEach(function (t) {
      var k = tagKey(t.name);
      if (full && k === full) hasFull = true;
      if (partial && k === partial) hasPartial = true;
    });
    if (hasFull && hasPartial) return { role: 'bad', label: 'both tags' };
    if (hasFull) return { role: 'fl', label: s.a1FullLengthTag };
    if (hasPartial) return { role: 'pl', label: s.a2PartialLengthTag };
    return { role: 'none', label: '' };
  }

  function bestFile(scene) {
    var files = scene.files || [];
    var best = null;
    for (var i = 0; i < files.length; i++) {
      if (!best || (files[i].duration || 0) > (best.duration || 0)) best = files[i];
    }
    return best;
  }

  function hhmmss(seconds) {
    var n = Math.round(Number(seconds) || 0);
    if (!n) return '';
    var h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
    var pad = function (v) { return (v < 10 ? '0' : '') + v; };
    return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(sec);
  }

  function metaOf(scene) {
    var f = bestFile(scene), parts = [];
    if (f && f.width && f.height) parts.push(f.width + '×' + f.height);
    var d = hhmmss(f && f.duration);
    if (d) parts.push(d);
    return parts.join(' · ');
  }

  // Full-length first, then longest. The order is the answer to "which of these did I
  // mean", and the ranking the plan sketches is only worth building once there is more
  // than one candidate at the top - which the user says is rare.
  var ROLE_RANK = { fl: 0, none: 1, bad: 1, pl: 2 };

  function ordered(siblings, s) {
    return siblings.map(function (scene) {
      return { scene: scene, cls: classify(scene, s) };
    }).sort(function (a, b) {
      var ra = ROLE_RANK[a.cls.role], rb = ROLE_RANK[b.cls.role];
      if (ra !== rb) return ra - rb;
      return ((bestFile(b.scene) || {}).duration || 0) - ((bestFile(a.scene) || {}).duration || 0);
    });
  }
  // ── Style ─────────────────────────────────────────────────────────────────

  var CSS =
    // ── The tab's pane ──────────────────────────────────────────────────────
    //
    // Not the shared dialog chrome: this plugin puts up no dialog, so a backdrop, a log
    // and a footer would be a stylesheet for markup that never exists. It is not a card
    // either - the pane sits inside Stash's own tab content, beside Details and File
    // Info, so it takes no background and no border of its own and lets the page's
    // showing through. The greys are the dialogs' greys all the same - #a7b6c2 and
    // #7d8f9c, the two dim steps - because a sixth palette would read as a sixth author.
    // `.svr-tabpane`, not `.svr-pane`: TagBundleClipboard already has a `.pane` and it
    // is a different thing - a scrolling column inside a two-column dialog. A class two
    // plugins share has to mean the same thing in both, and a *tab* pane is not that.
    '.svr-tabpane{padding:1rem;}' +
    '.svr-summary{color:#7d8f9c;margin-bottom:.5rem;}' +
    '.svr-sib{display:flex;align-items:baseline;gap:.5rem;padding:.35rem .5rem;' +
    'flex-wrap:wrap;border-radius:3px;}' +
    '.svr-sib:hover{background:#3c4f5d;}' +
    // The floor a flex item keeps by default is the width of its longest word, which a
    // filename-shaped title blows straight through; releasing it is what lets the title
    // wrap instead of pushing the meta column off the row.
    '.svr-sib-title{flex:1 1 20rem;min-width:0;overflow-wrap:anywhere;}' +
    '.svr-meta{color:#a7b6c2;font-size:.85rem;white-space:nowrap;}' +
    '.svr-role{font-size:.85rem;white-space:nowrap;}' +
    // Green for the full-length one, because it is the answer the tab exists to give.
    // Grey for a partial and for an untagged scene: both are context rather than an
    // answer, and a library that has not adopted the tags reads as quiet rather than
    // broken. Red only for the scene wearing both, which is a contradiction.
    '.svr-role-fl{color:#84d68a;}' +
    '.svr-role-pl{color:#7d8f9c;}' +
    '.svr-role-bad{color:#ff7373;}' +
    // Byte-identical to TagBundleClipboard's, because a class two plugins share has to
    // mean the same thing in both and here it does: the line standing in for a list
    // that has nothing in it.
    '.svr-empty{padding:.5rem 1rem;color:#7d8f9c;}' +
    // Stash's own .sub-heading is white-space: normal, so this plugin's description
    // would collapse into one paragraph. Scoped to the group we marked, never to
    // .sub-heading at large: another plugin's description is not ours to reflow.
    '.svr-own-group .sub-heading{white-space:pre-wrap;}' +
    '.svr-own-group .sub-heading .svr-p{margin:0 0 .35em;}' +
    '.svr-own-group .sub-heading .svr-p:last-child{margin-bottom:0;}' +
    // A per-setting description shows its first paragraph and hides the rest in a
    // tooltip. The mark is the only thing saying there is one - a hover that opens with
    // no invitation is a hover nobody makes. Built rather than borrowed: a native
    // `title` opens below-right of the pointer, exactly where the arrow sits, so its
    // first line arrives half covered, and its size cannot be reached from CSS.
    //
    // These rules are shared with every sibling plugin and `tests/style.test.js`
    // compares them with the prefix stripped: keep them byte-identical, or change all
    // of them together.
    '.svr-tipped{position:relative;}' +
    '.svr-tip{margin-left:.35rem;cursor:pointer;opacity:.65;font-style:normal;' +
    'font-size:1.05em;}' +
    '.svr-tip:hover,.svr-tip:focus{opacity:1;outline:none;}' +
    // pointer-events:none is load-bearing, not tidiness. Opened from the setting's
    // name the box lands over the h3, so a box that took the pointer would fire
    // mouseleave on the name, close, hand the pointer back to the name, and reopen -
    // a flicker loop for as long as it is hovered.
    '.svr-tipbox{display:none;position:absolute;left:0;bottom:calc(100% + .35rem);' +
    'z-index:1500;width:max-content;max-width:100%;padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.svr-tipped.svr-tip-open .svr-tipbox{display:block;}' +
    // The group description sits in the group header, outside the <Collapse>, so it is
    // on screen at whatever size whether the group is expanded or not. Hiding all but
    // the first paragraph is the only thing that shortens it.
    '.svr-desc-collapsed .svr-p:not(:first-child){display:none;}' +
    '.svr-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
    '.svr-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
    // ── Colour-coded toggles ────────────────────────────────────────────────
    //
    // Teal for the one setting that only talks to the console, matching every sibling.
    // The two tag names keep Stash's blue: they say what a row is *called*, not what
    // anything does on its own, and marking everything would mark nothing. Nothing here
    // is amber, because nothing here writes.
    //
    // Keyed on the id SettingsPluginsPanel.tsx builds from the plugin id and the
    // setting key, the same anchor `settingElement` uses, rather than on position or
    // heading text. Two shapes because the switch is Stash's to render: `::before` is
    // the track of the react-bootstrap Form.Switch it renders today, and `accent-color`
    // covers a plain checkbox if that ever changes.
    '#plugin-SceneVariants-b1LogToConsole{accent-color:#17a2b8;}' +
    '#plugin-SceneVariants-b1LogToConsole:checked~.custom-control-label::before' +
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

  function hasClass(node, name) {
    return (' ' + String((node && node.className) || '') + ' ').indexOf(' ' + name + ' ') !== -1;
  }

  function byClass(root, name) {
    if (!root || typeof root.querySelector !== 'function') return null;
    try { return root.querySelector('.' + name) || null; } catch (e) { return null; }
  }
  // ── The tab ───────────────────────────────────────────────────────────────
  //
  // A real tab beside Details, Queue, Markers, Group, Filter, File Info, History and
  // Edit - not a block injected under the strip. Stash renders its tab strip and its tab
  // content each wrapped in a `PatchContainerComponent`, which exists for exactly this:
  //
  //   const ScenePageTabs      = PatchContainerComponent<IProps>("ScenePage.Tabs");
  //   const ScenePageTabContent = PatchContainerComponent<IProps>("ScenePage.TabContent");
  //
  // Each renders `props.children` and nothing else, so an `after` patch is handed the
  // rendered children and returns whatever should be there instead. Appending is the
  // whole of what this plugin does to them.
  //
  // Three facts this is built on, read off `stashapp/stash` and worth not re-deriving:
  //
  //   * The after-patch is invoked as `afterFn.apply(ctx, args.concat(result))`, so for
  //     a component it receives `(props, result)` and must return the new result.
  //     The patch list is read when the component *renders*, not when it is defined, so
  //     registering at script load is early enough however late Scene.tsx is imported.
  //   * `props.scene` is a `SceneDataFragment`, which already carries `stash_ids`. That
  //     is what makes this one query rather than two: there is nothing to look up before
  //     the filter can be written.
  //   * `activeTabKey` is a plain `useState("scene-details-panel")` with no whitelist, so
  //     a key of our own is selectable exactly like Stash's nine.
  //
  // There is deliberately **no DOM fallback** for a Stash without these patch points. A
  // second implementation of the same tab, injected into the strip by hand, is the kind
  // of duplicate this repo has already decided against paying for elsewhere: it would
  // have to reproduce tab activation, pane switching and every re-render React does for
  // free. A Stash too old gets one console line and no tab.

  function pluginApi() {
    var api = window.PluginApi;
    return api && api.patch && typeof api.patch.after === 'function' ? api : null;
  }

  // The tab is always present, even on the scenes - most of them, today - with no
  // stash-id and so no possible sibling. A tab that came and went as a query landed
  // would move the strip under the pointer, and the empty cases are the ones worth
  // explaining: "this scene carries no stash-id" is a fact about the library the user
  // can act on, and a tab that hid itself would be the one place it could never appear.
  //
  // The caption carries no count, which is the price of that: the strip and the pane are
  // two separate patches rendering two separate components, so a count in the caption
  // would need the query's answer to be shared between them - a module-level cache and a
  // subscription, to save the user one click. The pane counts its own rows in its first
  // line instead.
  function TabLink(React, Nav) {
    return React.createElement(Nav.Item, { key: TAB_KEY },
      React.createElement(Nav.Link, { eventKey: TAB_KEY }, TAB_LABEL));
  }

  // One row. `row.cls.label` is empty for an unclassified scene and the span is then not
  // rendered at all, rather than rendered blank - an untagged sibling is listed as
  // context, and a column of empty marks would read as something missing.
  function SiblingRow(React, row) {
    var kids = [React.createElement('a', {
      key: 'title', className: 'svr-sib-title', href: '/scenes/' + row.scene.id,
    }, row.scene.title || ('Scene ' + row.scene.id))];
    if (row.cls.label) {
      kids.push(React.createElement('span',
        { key: 'role', className: 'svr-role svr-role-' + row.cls.role }, row.cls.label));
    }
    var meta = metaOf(row.scene);
    if (meta) kids.push(React.createElement('span', { key: 'meta', className: 'svr-meta' }, meta));
    return React.createElement('div', { key: row.scene.id, className: 'svr-sib' }, kids);
  }

  // `found` is null until the query lands, which is the loading state; after that it is
  // `{ rows, why }` and `why` is a whole sentence, because every one of the empty answers
  // needs one. The effect is keyed on the scene id so that walking the queue re-runs it,
  // and its cleanup drops the answer to a scene the user has already left.
  function SiblingsPane(React) {
    return function (props) {
      var scene = (props && props.scene) || {};
      var state = React.useState(null);
      var found = state[0], setFound = state[1];

      React.useEffect(function () {
        var live = true;
        setFound(null);
        findSiblings(scene).then(function (result) { if (live) setFound(result); });
        return function () { live = false; };
      }, [scene.id]);

      if (!found) {
        return React.createElement('div', { className: 'svr-tabpane' },
          React.createElement('div', { className: 'svr-empty' }, 'Looking for siblings…'));
      }
      var kids = [React.createElement('div', { key: 'why', className: 'svr-summary' },
        found.rows.length
          ? plural(found.rows.length, 'other scene') + ' ' +
            (found.rows.length === 1 ? 'is' : 'are') + ' the same work. ' + found.why
          : found.why)];
      found.rows.forEach(function (row) { kids.push(SiblingRow(React, row)); });
      return React.createElement('div', { className: 'svr-tabpane' }, kids);
    };
  }

  var _patched = false;

  function installTabs() {
    if (_patched) return true;
    var api = pluginApi();
    if (!api) {
      gateLogOnce('patch', 'PluginApi component patching is unavailable - no Siblings tab. ' +
        'This plugin needs Stash 0.28.0 or newer.');
      return false;
    }
    var React = api.React;
    var Bootstrap = (api.libraries || {}).Bootstrap;
    var Nav = Bootstrap && Bootstrap.Nav, Tab = Bootstrap && Bootstrap.Tab;
    if (!React || !Nav || !Tab) {
      gateLogOnce('patch', 'PluginApi is present but React or react-bootstrap is not - ' +
        'no Siblings tab.');
      return false;
    }
    var Pane = SiblingsPane(React);
    api.patch.after('ScenePage.Tabs', function (props, result) {
      return React.createElement(React.Fragment, null, result, TabLink(React, Nav));
    });
    api.patch.after('ScenePage.TabContent', function (props, result) {
      return React.createElement(React.Fragment, null, result,
        React.createElement(Tab.Pane, { key: TAB_KEY, eventKey: TAB_KEY },
          React.createElement(Pane, { scene: props.scene })));
    });
    _patched = true;
    gateLogOnce('patch', 'the Siblings tab is registered on the scene page');
    // The pane's own CSS has to be on the page before React first renders it, and there
    // is no tick watching the scene page any more to put it there.
    injectStyle();
    return true;
  }
  // ── The settings page ─────────────────────────────────────────────────────

  // SettingsPluginsPanel.tsx gives every plugin setting an id built from the plugin id
  // and the setting key - `plugin-SceneVariants-a1FullLengthTag`. That is ours by
  // construction: no version suffix, no localisation, nothing formatted for display.
  // Two plugins here shipped this broken by matching heading text instead, twice, so
  // the ids are the anchor and the heading is only a fallback.
  function settingElement(key) {
    return document.getElementById('plugin-' + PLUGIN_ID + '-' + key);
  }

  // Walks up from any one of our settings to the group box that contains it. Trying
  // every key rather than a named one means removing or renaming a setting cannot
  // quietly break the anchor - but a release that renames them *all* can, and the first
  // casualty of that is the stale-script banner, which is the one thing on this page
  // such a release needed to show. So the group headed with our own name is the
  // fallback, inside this function rather than OR'd in by each caller.
  //
  // The sibling plugins guard that fallback with a `hasOwnTaskButton` check, because
  // Settings - Tasks heads *its* group with the same name and decorating it would
  // destroy the task button. This plugin declares no `tasks:`, so there is no such
  // group for the heading match to find; adding one means adding the guard.
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
    var heading = ownSettingGroupHeading();
    for (node = heading, d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return node;
    }
    return heading ? heading.parentElement : null;
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
  // so the h3 there reads "... (<version>)" - and, because that template interpolates
  // the literal when there is no version at all, sometimes "... undefined".
  //
  // Strip the suffix and compare exactly, rather than testing a prefix: a plugin whose
  // name merely starts with ours must not be mistaken for us.
  function ownSettingGroupHeading() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('h3') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (headingIsOurs(nodes[i].textContent)) return nodes[i];
    }
    return null;
  }

  function headingIsOurs(text) {
    var t = String(text == null ? '' : text).trim();
    if (t === PLUGIN_NAME) return true;
    t = t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '').trim();
    return t === PLUGIN_NAME;
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
    if (kids.length && hasClass(kids[0], 'svr-p')) return;   // already ours
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;                   // nothing to split
    var paras = text.split(/\n{2,}/);
    sub.textContent = '';
    paras.forEach(function (para) {
      var t = oneLine(para);
      if (t) sub.appendChild(el('div', 'svr-p', t));
    });
  }

  // ── Settings verbosity: a summary on the page, the rest on hover ──────────
  //
  // A description written as "summary\n\ndetail" shows only its first paragraph, with
  // the rest moved into a tooltip. Stash's own Setting renders `<h3 title={tooltip}>`,
  // but SettingsPluginsPanel never passes a tooltip for a plugin setting and
  // `PluginSetting` has no field to declare one - so the slot exists, is always empty
  // for us, and is filled from here.
  var TIP_MARK = 'ⓘ';                  // circled Latin small letter i

  function setTipOpen(sub, on) {
    var cls = String(sub.className || '').replace(/\s*svr-tip-open\b/, '');
    sub.className = (on ? cls + ' svr-tip-open' : cls).replace(/^\s+/, '');
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
    if (!node || node._svrTipWired) return;
    node._svrTipWired = true;
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
    if (kids.length && hasClass(kids[0], 'svr-sum')) return;   // already ours
    var text = sub.textContent || '';
    var cut = text.indexOf('\n\n');
    if (cut === -1) return;                                    // nothing to hide
    var summary = oneLine(text.slice(0, cut));
    var detail = text.slice(cut + 2).split(/\n{2,}/).map(oneLine)
      .filter(function (p) { return !!p; }).join('\n\n');
    if (!summary || !detail) return;
    sub.textContent = '';
    if (!hasClass(sub, 'svr-tipped')) {
      sub.className = ((sub.className || '') + ' svr-tipped').replace(/^\s+/, '');
    }
    var sum = el('span', 'svr-sum', summary);
    sub.appendChild(sum);
    // tabIndex, so the box can be reached and read without a mouse. The box is a
    // sibling of the mark rather than a child: as a child it would sit inside an inline
    // span and inherit its clipping and stacking.
    var mark = el('span', 'svr-tip', TIP_MARK);
    mark.tabIndex = 0;
    sub.appendChild(mark);
    sub.appendChild(el('span', 'svr-tipbox', detail));
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
  function descCollapsed(sub) { return hasClass(sub, 'svr-desc-collapsed'); }

  function setDescCollapsed(sub, on) {
    var cls = String(sub.className || '').replace(/\s*svr-desc-collapsed\b/, '');
    sub.className = (on ? cls + ' svr-desc-collapsed' : cls).replace(/^\s+/, '');
  }

  function collapseDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    var paras = 0;
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], 'svr-p')) paras++;
    if (paras < 2) return;                        // one paragraph hides nothing
    if (document.getElementById(DESC_TOGGLE_ID)) return;
    // A re-render drops the button and the class together, so the description returns
    // to collapsed rather than to a half-state with no way out of it.
    setDescCollapsed(sub, true);
    var btn = el('button', 'svr-desc-toggle', 'Show more');
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
  // second.
  var STALE_ID = 'svr-stale-notice';

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
    var box = el('div', 'svr-stale', '⚠ This page is still running ' +
      PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. ' +
      'Press Ctrl+Shift+R (⌘+Shift+R on a Mac) to reload it: your browser has cached ' +
      'the older script, and everything this plugin does until then is that older code.');
    box.id = STALE_ID;
    slot.parent.insertBefore(box, slot.before);
  }

  // Re-added rather than tracked: React re-renders this panel whenever a setting changes
  // and drops anything we put in it, so the tick puts it back. Keyed on the id, so a
  // re-render that kept it does not produce a second one.
  function ensureReadmeLink() {
    var group = ownSettingGroup();
    if (!group) return;
    injectStyle();
    if (!hasClass(group, 'svr-own-group')) {
      group.className = ((group.className || '') + ' svr-own-group').replace(/^\s+/, '');
    }
    splitDescription(group);
    collapseDescription(group);   // after the split: it counts the .svr-p divs
    tipSettings();
    ensureStaleNotice(group);     // before the early return: the link outlives it
    if (document.getElementById(README_LINK_ID)) return;
    var link = el('a', 'svr-readme', 'SceneVariants/README.md');
    link.id = README_LINK_ID;
    link.href = README_URL;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = 'Open this plugin’s documentation';
    link.style = 'display:inline-block;margin-top:.35rem;font-size:.8rem;';
    var slot = readmeLinkSlot(group);
    slot.parent.insertBefore(link, slot.before);
  }

  function settingsTick() {
    ensureReadmeLink();
  }
  // ── Wiring ────────────────────────────────────────────────────────────────
  //
  // Patches have to be registered before the components they target first render, so
  // this runs at script load; the `load` retry only covers Stash setting
  // window.PluginApi later than usual.
  //
  // The timer is for the settings page alone. There is no MutationObserver and no click
  // or popstate handler, because there is nothing left to put back into the DOM: React
  // renders the tab and the pane, and re-renders them itself. That is the same position
  // `NormalizeParentTags` is in, and the reason this plugin subscribes to no `domBus`.

  function tick() {
    try { settingsTick(); } catch (e) { console.error('[svr] settings tick:', e); }
  }

  installTabs();

  if (window.addEventListener) {
    window.addEventListener('load', function () {
      installTabs();
      tick();
    });
  }
  setInterval(tick, 1000);
  settings();   // warm the settings cache so the first pane knows the two tag names
  tick();
}());
