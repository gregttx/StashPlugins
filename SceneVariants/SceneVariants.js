// Scene Variants
//
// A scene is often in the library twice: the whole thing, and a cut out of it. Stash
// has no first-class relation for "these two files are the same work", so the panel
// this plugin draws on a scene page is that relation, derived rather than stored: the
// scenes sharing this one's stash-id, with whichever of them is the full-length one
// named as such.
//
// **Nothing in this file writes to the library.** It reads two queries and draws a
// list of links. There is no mutation to undo, no lease to take and nothing to stand a
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
  var PLUGIN_VERSION = '0.0.2';

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
  var PANEL_ID       = 'svr-panel';

  var SETTINGS_TTL_MS = 10000;   // settings are re-read at most this often
  var SCENE_ROUTE = /^\/scenes\/(\d+)(?:[/?#]|$)/;

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

  // **Four of the five shared mechanisms are correctly left alone, and each absence is
  // a rule rather than an omission:**
  //
  //   no lease           - a lease announces a bulk *write*, and this plugin issues no
  //                        mutation at all.
  //   no `respecters`    - the flag says "I react to saves and will stand down". This
  //                        plugin reacts to nothing.
  //   no `declares`      - the registry is for two plugins performing the *identical*
  //                        relationship copy, keyed by a path id. Nothing here copies a
  //                        relationship, so any path id would be a lie.
  //   no `order`         - the ordering protocol is for buttons sharing one of Stash's
  //                        own action rows. This plugin draws a panel in a container of
  //                        its own, with nobody to be ordered against.
  //
  // What it does read is `debugButtons`, below - the panel is a control drawn into
  // Stash's chrome and "why is it not there" is the same question that flag answers for
  // every sibling.

  // ── Panel gating diagnostics ─────────────────────────────────────────────
  //
  // Off unless `__GTTx__.StashPluginCoop.debugButtons = true`, which is typed into the
  // browser console: no setting, no reload, no file edit, and the flag is read at call
  // time so it takes effect on the next tick.
  //
  // Deduplicated per channel, because the tick runs every second and on every DOM
  // mutation burst. Turning the flag off clears the channels, so switching it back on
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

  // Read synchronously by the tick and refreshed on a timer, the shape every sibling
  // uses. Awaiting a settings query inside a draw would put a round trip in front of a
  // value that changes once a year.
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
  // Two queries, not one. The filter needs this scene's stash-ids, so the second call
  // cannot be written until the first has answered; the plan's single-query sketch
  // assumed a caller that already held them. Both are cached per scene id for the life
  // of the page, which is what keeps a panel that redraws on every DOM burst from
  // asking again.
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
  var SCENE_QUERY =
    'query SVRScene($id: ID!) { findScene(id: $id) { id title stash_ids { endpoint stash_id } } }';

  var SIBLINGS_QUERY =
    'query SVRSiblings($ids: [String!]) { findScenes(' +
    'scene_filter: { stash_ids_endpoint: { stash_ids: $ids, modifier: EQUALS } }, ' +
    'filter: { per_page: -1 }) { scenes { id title tags { id name } ' +
    'files { duration width height } } } }';

  // One entry, replaced when the route changes. A scene page is looked at for minutes
  // and a second one is a navigation away, so a map keyed by id would grow for the life
  // of the tab to serve a hit rate of nearly zero.
  var _probe = null;

  function probe(sceneId) {
    if (_probe && _probe.id === sceneId) return _probe;
    _probe = { id: sceneId, done: false, siblings: [], why: 'probing' };
    var entry = _probe;
    gqlRequest(SCENE_QUERY, { id: sceneId })
      .then(function (data) {
        var scene = (data && data.findScene) || null;
        var ids = ((scene && scene.stash_ids) || []).map(function (s) { return s.stash_id; })
          .filter(function (v) { return !!v; });
        if (!ids.length) return { scenes: [], why: 'this scene carries no stash-id' };
        return gqlRequest(SIBLINGS_QUERY, { ids: ids }).then(function (found) {
          return {
            scenes: ((found && found.findScenes) || {}).scenes || [],
            why: 'matched on ' + plural(ids.length, 'stash-id'),
          };
        });
      })
      .then(function (result) {
        if (_probe !== entry) return;                 // the user navigated away
        entry.siblings = result.scenes.filter(function (s) {
          return String(s.id) !== String(sceneId);
        });
        entry.done = true;
        entry.why = result.why;
        logToConsole('scene ' + sceneId + ': ' +
          plural(entry.siblings.length, 'sibling') + ' (' + entry.why + ')');
        scheduleTick();
      }, function (err) {
        if (_probe !== entry) return;
        entry.done = true;
        entry.why = 'the sibling query failed';
        // Loud rather than silent: a panel that never appears because a filter field is
        // named differently on this Stash looks exactly like a panel that decided there
        // was nothing to show, and only one of those is worth reporting.
        console.warn('[svr] sibling lookup failed for scene ' + sceneId + ': ' + err.message);
        scheduleTick();
      });
    return _probe;
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
    // ── The panel ───────────────────────────────────────────────────────────
    //
    // Its own rules, not the shared dialog chrome: this plugin puts up no dialog, so
    // the backdrop, the log and the footer would be a stylesheet for markup that never
    // exists. The greys are the dialogs' greys all the same - #202b33 behind, #394b59
    // for a border, #a7b6c2 and #7d8f9c for the two dim steps - because the panel sits
    // on the same page as those dialogs and a sixth palette would read as a sixth
    // author.
    '.svr-panel{background:#202b33;border:1px solid #394b59;border-radius:4px;' +
    'margin:.5rem 0;padding:.35rem 0;}' +
    '.svr-panel-head{padding:.25rem .75rem;color:#7d8f9c;font-size:.8rem;}' +
    '.svr-sib{display:flex;align-items:baseline;gap:.5rem;padding:.25rem .75rem;' +
    'flex-wrap:wrap;}' +
    '.svr-sib:hover{background:#3c4f5d;}' +
    // The floor a flex item keeps by default is the width of its longest word, which a
    // filename-shaped title blows straight through; releasing it is what lets the title
    // wrap instead of pushing the meta column off the panel.
    '.svr-sib-title{flex:1 1 20rem;min-width:0;overflow-wrap:anywhere;color:#7cc4ff;}' +
    '.svr-sib-title:hover{color:#7cc4ff;text-decoration:underline;}' +
    '.svr-meta{color:#a7b6c2;font-size:.85rem;white-space:nowrap;}' +
    '.svr-role{font-size:.85rem;white-space:nowrap;}' +
    // Green for the full-length one, because it is the answer the panel exists to give.
    // Grey for a partial and for an untagged scene: both are context rather than an
    // answer, and a library that has not adopted the tags reads as quiet rather than
    // broken. Red only for the scene wearing both, which is a contradiction.
    '.svr-role-fl{color:#84d68a;}' +
    '.svr-role-pl{color:#7d8f9c;}' +
    '.svr-role-bad{color:#ff7373;}' +
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

  // ── Where the panel goes ──────────────────────────────────────────────────
  //
  // Ported from TagBundleClipboard, which found this anchor against a live Stash. A
  // scene page renders no action row at all - it shows a tab strip instead, Details /
  // File Info / Chapters / Edit - so the strip is the one landmark to hang something
  // off, and the panel goes in a container of ours immediately after it.
  //
  // **The strip is found by its Edit tab's key, not by its class.** Scene renders a
  // second element whose text is exactly "Edit", and a Gallery page renders two
  // `.nav-tabs` strips of which only the entity's own carries a `*-edit-panel` key.
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

  // ── The panel ─────────────────────────────────────────────────────────────

  function clearPanel() {
    var node = document.getElementById(PANEL_ID);
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function buildPanel(sceneId, rows, why) {
    var panel = el('div', 'svr-panel');
    panel.id = PANEL_ID;
    panel._svrKey = sceneId + ':' + rows.map(function (r) {
      return r.scene.id + ':' + r.cls.role;
    }).join(',');
    panel.appendChild(el('div', 'svr-panel-head',
      plural(rows.length, 'other scene') + ' ' +
      (rows.length === 1 ? 'is' : 'are') + ' the same work — ' + why));
    rows.forEach(function (row) {
      var line = el('div', 'svr-sib');
      var link = el('a', 'svr-sib-title', row.scene.title || ('Scene ' + row.scene.id));
      link.href = '/scenes/' + row.scene.id;
      line.appendChild(link);
      if (row.cls.label) {
        line.appendChild(el('span', 'svr-role svr-role-' + row.cls.role, row.cls.label));
      }
      var meta = metaOf(row.scene);
      if (meta) line.appendChild(el('span', 'svr-meta', meta));
      panel.appendChild(line);
    });
    return panel;
  }

  // Reconciliation, not tracking: React can tear down and rebuild the scene page on a
  // re-render, so there is nothing durable to hold on to. Each tick rebuilds its opinion
  // of what the panel should say and replaces the old one only when that opinion has
  // changed - a panel rebuilt on every DOM burst would drop the user's text selection
  // in it once a second.
  function panelTick() {
    var m = SCENE_ROUTE.exec(location.pathname);
    if (!m) {
      gateLogOnce('route', 'not on a Scene page');
      clearPanel();
      return;
    }
    var sceneId = m[1];
    gateLogOnce('route', 'on Scene ' + sceneId);
    injectStyle();

    var found = probe(sceneId);
    if (!found.done) { gateLogOnce('panel', 'still looking for siblings of Scene ' + sceneId); return; }
    if (!found.siblings.length) {
      gateLogOnce('panel', 'no siblings for Scene ' + sceneId + ' - ' + found.why +
        ' - panel not shown');
      clearPanel();
      return;
    }

    var strip = findTabStrip();
    if (!strip || !strip.parentNode) {
      gateLogOnce('panel', 'no tab strip on Scene ' + sceneId + ' - panel not shown');
      clearPanel();
      return;
    }

    var rows = ordered(found.siblings, settings());
    var panel = buildPanel(sceneId, rows, found.why);
    var existing = document.getElementById(PANEL_ID);
    if (existing && existing.parentNode === strip.parentNode &&
        existing._svrKey === panel._svrKey) {
      gateLogOnce('panel', plural(rows.length, 'sibling') + ' shown for Scene ' + sceneId);
      return;
    }
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    strip.parentNode.insertBefore(panel, strip.nextSibling);
    gateLogOnce('panel', plural(rows.length, 'sibling') + ' shown for Scene ' + sceneId);
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

  var _tickTimer = null;

  function tick() {
    try { settingsTick(); } catch (e) { console.error('[svr] settings tick:', e); }
    try { panelTick(); } catch (e) { console.error('[svr] panel tick:', e); }
  }

  function scheduleTick() {
    if (_tickTimer) return;
    _tickTimer = setTimeout(function () { _tickTimer = null; tick(); }, 100);
  }

  // The shared bus rather than an observer of our own - see `domBus`. This is called at
  // script bottom *and* from the `load` handler, so that a script evaluated after `load`
  // has already fired is still observed; `subscribe` is idempotent, which is what stops
  // the ordinary case registering twice for the life of the page.
  function startObserver() {
    domBus().subscribe(scheduleTick);
  }

  if (window.addEventListener) {
    window.addEventListener('load', function () {
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
  settings();   // warm the settings cache so the first panel knows the two tag names
  startObserver();
  tick();
}());
