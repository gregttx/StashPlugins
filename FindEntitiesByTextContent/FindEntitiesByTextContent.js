// Find Entities by Text Content
//
// Requires Stash 0.31.0 or newer: `custom_fields` on the seven entity types is one of
// the places this plugin looks.
//
// Stash can filter a Scene list on its own `details`, and a Performer list on its own
// `details`, and neither on the other's - and nothing at all on "whichever custom fields
// this entity happens to carry". So there is no way to ask it *which entities in my
// library mention this string*. This plugin answers that: one search box, a toggle per
// entity type, and a list of what it found.
//
// **Nothing here writes.** It is a read of the library and a list of links; there is no
// mutation to undo, no lease to take and nothing to stand a reactive plugin down for.
// Its head says where the results go rather than telling anyone to back up first.
//
// The scan is a read of the whole library, one page of one type at a time, because no
// server-side filter can answer the question above.
// ponytail: full paged scan; the six non-custom-field types could be narrowed with each
// filter type's own OR chain of INCLUDES criteria if a large library makes this slow.
//
// The design notes, and the reasoning behind the parts that look arbitrary, are in
// CLAUDE.md next to this file.
(function () {
  'use strict';

  var PLUGIN_ID   = 'FindEntitiesByTextContent';
  var PLUGIN_NAME = 'ᝯㄝₓ Find Entities by Text Content';
  // The name the dialog head wears. `PLUGIN_NAME` is the manifest's and has to stay
  // byte-identical to the `.yml`, because `ownParts`' heading match and `ownTaskName`
  // both find this plugin by it. This one is free to be short, and here it has to be:
  // the head goes on to quote what is being searched for.
  var PLUGIN_SHORT_NAME = 'ᝯㄝₓ Find by Text';

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and goes current the moment plugins are reloaded, while the browser can
  // still be running a script it cached before the edit.
  //
  // The major digit is zero and stays there until the plugin has been used in a live
  // Stash: it is the claim that the thing works, and no test in this repo can check a
  // guess about Stash's schema or about the markup its task panel renders.
  var PLUGIN_VERSION = '0.0.1';

  // Printed before anything else runs, so a script that loads and then throws is told
  // apart from one that never loaded at all. Through whatever the console offers rather
  // than console.info directly: this is the first statement in the file.
  function fetc(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  fetc('[fetc] FindEntitiesByTextContent.js ' + PLUGIN_VERSION + ' loaded. This is the running ' +
    'script\'s own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/StashPlugins/blob/main/FindEntitiesByTextContent/README.md';
  var STYLE_ID       = 'fetc-style';
  var README_LINK_ID = 'fetc-readme-link';
  var DESC_TOGGLE_ID = 'fetc-desc-toggle';
  var STALE_ID       = 'fetc-stale-notice';

  // **Teal, not amber.** The repo's rule is that a plugin's own control is amber where it
  // writes and `btn-info` where it only reads, and this plugin has no write in it at all -
  // so the task button Stash renders is the teal case the rule has been describing since
  // it was written. The filter toggles below are the exception, at the user's ask.
  var PLUGIN_BTN_VARIANT = 'btn-info';
  // A filter that is letting its category through, in the same amber every other control
  // these plugins draw wears. It marks the control as ours; nothing here writes, so it is
  // not the write colour doing double duty.
  var FILTER_ON_VARIANT = 'btn-warning';

  var READ_PAGE     = 500;   // entities per page of the scan
  var RESULT_BUFFER = 200;   // rows on screen before the search pauses itself
  var HISTORY_MAX   = 50;    // the most previous searches the box will keep
  var TICK_MS       = 1000;
  var CONTEXT       = 48;    // characters of surrounding text shown either side of a hit
  var ELLIPSIS      = '…';
  // The busy cursor under the last line of the log. The counters say how far the search
  // has got; this says it is still going, which is the question a page of 500 entities
  // leaves unanswered for seconds at a time.
  var SPIN_FRAMES = ['▙', '▛', '▜', '▟'];
  var SPIN_MS = 125;           // one four-frame cycle at 2Hz

  // Where the dialog keeps what the user asked it to remember. Under the one global this
  // repo reserves, so it cannot collide with another plugin's key.
  var STORE_KEY = '__GTTx__.fetcSearch';

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  // "3 scenes", "1 scene" - the count is always known where it is printed, so the
  // "(s)" these dialogs used to write everywhere was never carrying information. An
  // irregular plural passes its own; everything else takes an "s". Keep this function
  // byte-identical across the plugins, like the CSS.
  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function oneLine(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').replace(/^ | $/g, '');
  }

  // Newlines and runs of space collapsed, but nothing trimmed: this is for the text
  // *around* a match, where the space either side of it is part of what the line shows.
  function flatten(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ');
  }

  function trim(text) {
    return String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
  }

  // ── The seven entity types ────────────────────────────────────────────────
  //
  // `fields` is a list of *candidates*, not a promise: which of them the running Stash
  // actually has is settled by one introspection query at the start of every search (see
  // `describeFields`). A schema this plugin guessed wrong about would otherwise fail the
  // whole query and report as "nothing found", which is the one failure mode a search
  // tool must not have.
  //
  //   extra      the display fields that are not searchable text - a file's basename, a
  //              gallery's folder - so a result can name an entity with no title
  var ENTITIES = {
    scenes: {
      key: 'scenes', label: 'Scene', plural: 'Scenes', gqlType: 'Scene',
      find: 'findScenes', list: 'scenes', route: '/scenes/',
      extra: 'files { basename }',
      fields: ['title', 'code', 'details', 'director', 'urls', 'custom_fields'],
    },
    images: {
      key: 'images', label: 'Image', plural: 'Images', gqlType: 'Image',
      find: 'findImages', list: 'images', route: '/images/',
      extra: 'visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }',
      fields: ['title', 'code', 'details', 'photographer', 'urls', 'custom_fields'],
    },
    galleries: {
      key: 'galleries', label: 'Gallery', plural: 'Galleries', gqlType: 'Gallery',
      find: 'findGalleries', list: 'galleries', route: '/galleries/',
      extra: 'files { basename } folder { basename }',
      fields: ['title', 'code', 'details', 'photographer', 'urls', 'custom_fields'],
    },
    performers: {
      key: 'performers', label: 'Performer', plural: 'Performers', gqlType: 'Performer',
      find: 'findPerformers', list: 'performers', route: '/performers/',
      extra: '',
      fields: ['name', 'disambiguation', 'alias_list', 'details', 'urls', 'tattoos',
        'piercings', 'measurements', 'career_length', 'custom_fields'],
    },
    studios: {
      key: 'studios', label: 'Studio', plural: 'Studios', gqlType: 'Studio',
      find: 'findStudios', list: 'studios', route: '/studios/',
      extra: '',
      fields: ['name', 'aliases', 'details', 'urls', 'custom_fields'],
    },
    groups: {
      key: 'groups', label: 'Group', plural: 'Groups', gqlType: 'Group',
      find: 'findGroups', list: 'groups', route: '/groups/',
      extra: '',
      fields: ['name', 'aliases', 'synopsis', 'director', 'urls', 'custom_fields'],
    },
    tags: {
      key: 'tags', label: 'Tag', plural: 'Tags', gqlType: 'Tag',
      find: 'findTags', list: 'tags', route: '/tags/',
      extra: '',
      fields: ['name', 'aliases', 'description', 'custom_fields'],
    },
  };

  var TYPE_ORDER = ['scenes', 'images', 'galleries', 'performers', 'studios', 'groups', 'tags'];

  // The label a result line wears. One label per *concept*, shared across types on
  // purpose: Details means the same thing on a Scene and on a Performer.
  var FIELD_LABEL = {
    title: 'Title', name: 'Name', code: 'Code', details: 'Details',
    description: 'Description', synopsis: 'Synopsis', director: 'Director',
    photographer: 'Photographer', urls: 'URLs', aliases: 'Aliases',
    alias_list: 'Aliases', disambiguation: 'Disambiguation', tattoos: 'Tattoos',
    piercings: 'Piercings', measurements: 'Measurements', career_length: 'Career length',
  };
  var CF_NAME_LABEL  = 'Custom field name';
  var CF_VALUE_LABEL = 'Custom field value';

  // ── Settings ──────────────────────────────────────────────────────────────
  //
  // One, and it is the console switch every plugin here has. What the dialog remembers -
  // which types are ticked, and the recent searches - is deliberately **not** a setting:
  // it belongs to the person at this browser rather than to the server, it changes on
  // every search, and a plugin that writes its own configuration on every search is one
  // that can lose the user's settings to a partial `configurePlugin` (see the repo-root
  // CLAUDE.md). It goes in `localStorage` instead.
  var DEFAULTS = {
    a1LogToConsole: false,
  };

  // ── Cross-plugin cooperation ──────────────────────────────────────────────
  //
  // `window.__GTTx__` is the one global this repo reserves and everything shared
  // hangs off it. `StashPluginCoop` on its own was a name any third-party plugin
  // could have picked, and a collision would hand someone else's object our leases.
  //
  // `window.StashPluginCoop` stays as an alias to the very same object, and an
  // existing one is adopted rather than replaced: a user who updates one of these
  // plugins and not the others has two releases of the protocol in one tab, and both
  // halves have to keep seeing one set of leases. Keep this function byte-identical
  // across the plugins, like the CSS.
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

  // This plugin is on **neither** side of the lease protocol, and that is the rule being
  // followed rather than an omission. It writes nothing, so it has no bulk run to
  // announce; it reacts to nothing, so it has nothing to stand down; it performs no
  // relationship copy, so any path id in `declares` would be a lie; and it draws no
  // button into an entity's action row, so it takes no `order` priority. `TagBundleClipboard`
  // is the other plugin in this shape. `coop()` still creates all four fields, for
  // shape-consistency with its siblings.
  //
  // It does note a foreign lease in its log, which is not standing down: a bulk run in
  // another dialog is rewriting the very entities this search is reading, so a result may
  // be a moment out of date. Saying so costs a line; refusing to search would be absurd.
  function foreignLease() {
    var c = coop();
    var now = Date.now();
    for (var i = c.leases.length - 1; i >= 0; i--) {
      if (c.leases[i].until <= now) c.leases.splice(i, 1);
    }
    return c.leases.length ? c.leases[0] : null;
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

  // `configuration { plugins }` cannot be scoped to one plugin, so every other plugin's
  // settings arrive in the same response. Nothing here needs them.
  function loadSettings() {
    return gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
      var s = {};
      for (var k in DEFAULTS) {
        if (hasOwn(DEFAULTS, k)) s[k] = !!raw[k];
      }
      return s;
    });
  }

  // ── What the dialog remembers ─────────────────────────────────────────────
  //
  // In `localStorage`, so it is this browser's rather than the server's, and so that a
  // search never writes to the library or to the plugin configuration. Both halves are
  // opt-in from inside the dialog: the types are only kept while "Remember filters" is
  // ticked, and a search only joins the history while the history is set to hold more
  // than nothing.
  //
  // Every read and write is wrapped: a browser with storage disabled, or a private
  // window, throws on the accessor itself rather than returning null.
  function readStore() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var v = raw ? JSON.parse(raw) : null;
      if (!v || typeof v !== 'object') return {};
      return v;
    } catch (e) {
      return {};
    }
  }

  function writeStore(v) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(v));
    } catch (e) { /* a browser that will not store is not a reason to refuse a search */ }
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  var CSS =
    // Kept literally identical to the sibling plugins' stylesheets wherever the dialogs
    // overlap, down to the hex values. They are separate strings because the plugins
    // share no module, not because they are meant to look different - and two of them
    // did drift, from #202b33 to #30404d, because nothing compared them.
    // `tests/style.test.js` pins the overlap. #202b33 is Blueprint's dark-gray2, the
    // step Stash's own page uses; every dim grey in these dialogs was chosen against it.
    '.fetc-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.fetc-modal{background:#202b33;color:#f5f8fa;border:1px solid #394b59;border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.fetc-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.fetc-title{font-size:1.1rem;font-weight:600;}' +
    '.fetc-warn{color:#ffb648;margin-top:.35rem;}' +
    '.fetc-note{color:#a7b6c2;margin-top:.35rem;}' +
    '.fetc-legend{color:#7d8f9c;margin-top:.35rem;font-size:.8rem;}' +
    '.fetc-progress{padding:.5rem 1rem;border-bottom:1px solid #394b59;color:#a7b6c2;' +
    'white-space:pre-wrap;}' +
    '.fetc-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;font-size:.8rem;' +
    'line-height:1.35;min-height:14rem;}' +
    '.fetc-line{white-space:pre-wrap;word-break:break-word;}' +
    '.fetc-spin{color:#a7b6c2;}' +
    '.fetc-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
    '.fetc-ERROR{color:#ff7373;} .fetc-WARN{color:#ffb648;} .fetc-INFO{color:#a7b6c2;}' +
    '.fetc-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.fetc-foot button{margin-right:.5rem;}' +
    '.fetc-hidden{display:none;}' +
    '.fetc-search{padding:.5rem 1rem;border-bottom:1px solid #394b59;position:relative;' +
    'display:flex;gap:.5rem;align-items:center;}' +
    '.fetc-label{color:#a7b6c2;font-size:.85rem;white-space:nowrap;}' +
    '.fetc-textbox{background:#1f2b33;color:#f5f8fa;border:1px solid #394b59;border-radius:3px;' +
    'padding:.25rem .5rem;flex:1 1 12rem;min-width:8rem;}' +
    // A fixed height rather than the shared `max-height` alone: rows arrive while the
    // user is reading, and a content-sized modal would grow under the pointer with every
    // page of results. The modifier pattern `CustomFieldsBulkEditor` established - a
    // class beside the pinned rule, never an edit to what the other plugins share.
    '.fetc-modal.fetc-tall{height:88vh;}' +
    '.fetc-search-wrap{flex-wrap:wrap;}' +
    // ── This dialog's own ───────────────────────────────────────────────────
    //
    // The filter strip, byte-identical to `EntityNameMaintainer`'s: same control, same
    // meaning, one row of small toggles under the head.
    '.fetc-filters{padding:.4rem 1rem;border-bottom:1px solid #394b59;display:flex;' +
    'flex-direction:column;gap:.3rem;}' +
    '.fetc-filterrow{display:flex;gap:.35rem;align-items:center;flex-wrap:wrap;}' +
    '.fetc-filterbtn{font-size:.78rem;padding:.05rem .4rem;}' +
    '.fetc-ent{color:#7cc4ff;text-decoration:none;white-space:nowrap;}' +
    '.fetc-ent:hover{text-decoration:underline;}' +
    '.fetc-attr{color:#a7b6c2;white-space:nowrap;}' +
    '.fetc-ctx{flex:1 1 auto;overflow-wrap:anywhere;word-break:break-word;}' +
    '.fetc-mark{background:#3f6b46;border-radius:2px;padding:0 .1rem;}' +
    '.fetc-spacer{flex:1 1 auto;}' +
    // One entity per line. Not `.fetc-hitrow`: `EntityNameMaintainer`'s row is a decision
    // with a checkbox in it, and this one is a link - a class two plugins share has to
    // mean the same thing in both.
    '.fetc-result{display:flex;align-items:baseline;gap:.5rem;padding:.1rem .25rem;}' +
    '.fetc-result>*{min-width:0;}' +
    '.fetc-result:hover{background:#3c4f5d;}' +
    // The recent-searches pulldown, which is only on the page while the history is set
    // to keep something.
    '.fetc-recent{background:#1f2b33;color:#f5f8fa;border:1px solid #394b59;' +
    'border-radius:3px;padding:.25rem .5rem;max-width:16rem;}' +
    '.fetc-num{background:#1f2b33;color:#f5f8fa;border:1px solid #394b59;border-radius:3px;' +
    'padding:.25rem .35rem;width:4rem;}' +
    '.fetc-check{display:flex;align-items:center;gap:.3rem;color:#a7b6c2;font-size:.85rem;' +
    'white-space:nowrap;cursor:pointer;}' +
    '.fetc-readme{color:#7cc4ff;font-size:.8rem;margin-top:.35rem;display:inline-block;}' +
    // ── The settings page ───────────────────────────────────────────────────
    //
    // Stash renders the description as one text node in a `.sub-heading` that is
    // `white-space: normal`, and a description cannot carry markup - it is passed to
    // React as a child, so any tag in it is escaped. So the blank lines are made visible
    // by the class, and then rebuilt as divs.
    //
    // Scoped to our own group, never applied to `.sub-heading` at large - another
    // plugin's description is not ours to reflow.
    '.fetc-own-group .sub-heading{white-space:pre-wrap;}' +
    '.fetc-own-group .sub-heading .fetc-p{margin:0 0 .35em;}' +
    '.fetc-own-group .sub-heading .fetc-p:last-child{margin-bottom:0;}' +
    '.fetc-desc-collapsed .fetc-p:not(:first-child){display:none;}' +
    '.fetc-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
    // The per-setting hover box: a summary on the row, the rest behind a ⓘ that opens
    // from the mark, the summary or the setting's own name. Stash's `title` slot cannot
    // be sized, placed or opened from the keyboard, which is why this exists.
    '.fetc-tipped{position:relative;}' +
    '.fetc-tip{margin-left:.35rem;cursor:pointer;opacity:.65;font-style:normal;' +
    'font-size:1.05em;}' +
    '.fetc-tip:hover,.fetc-tip:focus{opacity:1;outline:none;}' +
    // pointer-events:none is load-bearing, not tidiness. Opened from the setting's name
    // the box lands over the h3, so a box that took the pointer would fire mouseleave on
    // the name, close, hand the pointer back and reopen - a flicker loop.
    '.fetc-tipbox{display:none;position:absolute;left:0;bottom:calc(100% + .35rem);' +
    'z-index:1500;width:max-content;max-width:100%;padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.fetc-tipped.fetc-tip-open .fetc-tipbox{display:block;}' +
    // ── Colour-coded toggles ────────────────────────────────────────────────
    //
    // Teal for the one setting, which only talks to the console - the same teal every
    // sibling gives its console switch, and here also the colour of the task button,
    // because nothing in this plugin writes.
    //
    // Keyed on the id SettingsPluginsPanel.tsx builds from the plugin id and the setting
    // key, the same anchor `settingElement` uses. Two shapes because the switch is
    // Stash's to render: `::before` is the track of the react-bootstrap Form.Switch it
    // renders today, and `accent-color` covers a plain checkbox if that ever changes.
    '#plugin-FindEntitiesByTextContent-a1LogToConsole{accent-color:#17a2b8;}' +
    '#plugin-FindEntitiesByTextContent-a1LogToConsole:checked~.custom-control-label::before' +
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

  function hasClass(node, name) {
    return !!node && (' ' + (node.className || '') + ' ').indexOf(' ' + name + ' ') !== -1;
  }

  // Swaps one Bootstrap variant for another in place, so a toggle can go amber and back
  // without losing `btn` or `btn-sm`.
  var BTN_VARIANTS = /\bbtn-(secondary|warning|info|primary|success|light|dark|link)\b/g;

  function paintButton(btn, variant) {
    if (hasClass(btn, variant)) return;
    btn.className = String(btn.className || '').replace(BTN_VARIANTS, '')
      .replace(/\s+/g, ' ').replace(/^ | $/g, '') + ' ' + variant;
  }

  // ── Is this script the one Stash has installed? ───────────────────────────
  //
  // "Reload plugins" re-reads the plugin folder on the server; it cannot replace a
  // script this page already fetched and executed. Comparing the two numbers is the
  // only way the script can notice it is the stale one.
  //
  // Resolves to null wherever the answer is unknown - a Stash too old for the field, a
  // plugin it cannot see, a failed request. Unknown is not a mismatch.
  function installedVersion() {
    return gqlRequest('query FETCPluginVersion { plugins { id version } }', null)
      .then(function (data) {
        var list = (data && data.plugins) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id) === PLUGIN_ID) return list[i].version || null;
        }
        return null;
      }, function () { return null; });
  }

  // ── Naming an entity ──────────────────────────────────────────────────────
  //
  // Whichever of the display fields is present, rather than a branch per type: a
  // per-type branch is what let galleries and images log as "untitled" in a sibling for
  // three releases.
  function firstBasename(files) {
    for (var i = 0; files && i < files.length; i++) {
      if (files[i] && files[i].basename) return files[i].basename;
    }
    return null;
  }

  function displayName(ent) {
    if (!ent) return null;
    return ent.title || ent.name || firstBasename(ent.files) || firstBasename(ent.visual_files) ||
      (ent.folder && ent.folder.basename) || null;
  }

  // Stash is commonly served over plain HTTP on a LAN, where the async clipboard API is
  // not available at all, so the textarea + execCommand path is the fallback rather than
  // a legacy branch.
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

  // ── What the running Stash actually stores ────────────────────────────────
  //
  // One introspection query settles, for every candidate field in the table above,
  // whether the server has it and whether it is a string, a list of strings or the
  // custom-field map. A field this plugin guessed wrong about is dropped rather than
  // failing the whole search query - which for a search tool is the difference between
  // "your Stash calls it something else" and "nothing in your library says that".
  //
  // Cached for the life of the page: the schema cannot change without a restart.
  var _shapes = null;

  function unwrap(t) {
    // NON_NULL and LIST wrappers carry the real type in `ofType`. `[String!]!` is four
    // deep - NON_NULL, LIST, NON_NULL, SCALAR - which is what the query has to ask for.
    var kind = null;
    while (t) {
      if (t.kind === 'LIST') kind = 'list';
      if (t.kind === 'SCALAR' || t.kind === 'OBJECT' || t.kind === 'ENUM') {
        return { kind: kind || (t.name === 'Map' ? 'map' : 'string'), name: t.name };
      }
      t = t.ofType;
    }
    return { kind: kind || 'string', name: null };
  }

  function describeFields() {
    if (_shapes) return Promise.resolve(_shapes);
    var parts = TYPE_ORDER.map(function (k) {
      return k + ': __type(name: "' + ENTITIES[k].gqlType + '") { fields { name type ' +
        '{ kind name ofType { kind name ofType { kind name ofType { kind name } } } } } }';
    });
    return gqlRequest('query FETC_Shapes { ' + parts.join(' ') + ' }', null)
      .then(function (data) {
        var out = {};
        TYPE_ORDER.forEach(function (k) {
          var known = {};
          ((data[k] || {}).fields || []).forEach(function (f) { known[f.name] = f.type; });
          var keep = [];
          ENTITIES[k].fields.forEach(function (name) {
            if (!hasOwn(known, name)) return;
            var shape = unwrap(known[name]);
            // A String scalar, a list of them, or the custom-field Map. Anything else
            // wearing a name we asked for - a date, a number, an object - is not text
            // and has no business in a text search.
            if (name === 'custom_fields') {
              if (shape.name === 'Map') keep.push({ name: name, kind: 'map' });
              return;
            }
            if (shape.name !== 'String') return;
            keep.push({ name: name, kind: shape.kind === 'list' ? 'list' : 'string' });
          });
          out[k] = keep;
        });
        _shapes = out;
        return out;
      });
  }

  // ── Finding the text ──────────────────────────────────────────────────────

  function occurrences(text, needle) {
    var out = [];
    if (!needle) return out;
    var hay = String(text).toLowerCase();
    var n = needle.toLowerCase();
    var i = 0;
    while ((i = hay.indexOf(n, i)) !== -1) {
      out.push(i);
      i += n.length;
    }
    return out;
  }

  // The three pieces a result line is drawn from. Whitespace is collapsed: a details
  // field is prose with newlines in it, and a result line is one line.
  function context(text, at, len) {
    var s = String(text);
    var from = Math.max(0, at - CONTEXT);
    var to = Math.min(s.length, at + len + CONTEXT);
    return {
      pre: (from > 0 ? ELLIPSIS : '') + flatten(s.slice(from, at)),
      hit: flatten(s.slice(at, at + len)),
      post: flatten(s.slice(at + len, to)) + (to < s.length ? ELLIPSIS : ''),
    };
  }

  function pageQuery(spec, shapes) {
    var sel = ['id'];
    shapes.forEach(function (f) { sel.push(f.name); });
    // `extra` holds only the display fields that are *not* in the table above, so
    // nothing is ever selected twice - which GraphQL refuses outright.
    if (spec.extra) sel.push(spec.extra);
    return 'query FETC_Scan($f: FindFilterType) { ' + spec.find + '(filter: $f) { count ' +
      spec.list + ' { ' + sel.join(' ') + ' } } }';
  }

  // One result per *entity*, not per occurrence: the question this plugin answers is
  // which entities mention the text, and a scene whose details say it nine times is one
  // scene. The attributes it matched in, with a count each, are on the line; the first
  // match's surroundings are what the line shows.
  function scanEntity(spec, shapes, ent, needle) {
    var attrs = [];
    var index = {};
    var first = null;
    function add(label, source, pos) {
      if (!hasOwn(index, label)) {
        index[label] = { label: label, count: 0 };
        attrs.push(index[label]);
      }
      index[label].count++;
      if (!first) first = { label: label, ctx: context(source, pos, needle.length) };
    }
    shapes.forEach(function (f) {
      var v = ent[f.name];
      if (f.kind === 'string') {
        if (typeof v !== 'string') return;
        occurrences(v, needle).forEach(function (p) {
          add(FIELD_LABEL[f.name] || f.name, v, p);
        });
        return;
      }
      if (f.kind === 'list') {
        if (!v || !v.length) return;
        v.forEach(function (str) {
          if (typeof str !== 'string') return;
          occurrences(str, needle).forEach(function (p) {
            add(FIELD_LABEL[f.name] || f.name, str, p);
          });
        });
        return;
      }
      // The custom-field map: the key is one searchable string and the value is another,
      // and they are two different attribute names because they are two different things
      // to have found.
      if (!v || typeof v !== 'object') return;
      Object.keys(v).forEach(function (key) {
        occurrences(key, needle).forEach(function (p) { add(CF_NAME_LABEL, key, p); });
        // Only strings. A custom field can hold a number or an object, and neither is
        // text this search has any business claiming to have looked in.
        if (typeof v[key] !== 'string') return;
        occurrences(v[key], needle).forEach(function (p) { add(CF_VALUE_LABEL, v[key], p); });
      });
    });
    if (!attrs.length) return null;
    return {
      typeKey: spec.key, id: String(ent.id), name: displayName(ent) || '',
      attrs: attrs, first: first,
    };
  }

  // ── The task ──────────────────────────────────────────────────────────────
  //
  // Declared in the yml so Stash renders a button for it in Settings → Tasks, and
  // handled entirely here: the click never reaches the server, because there is no
  // `exec` behind it and nothing server-side to run. A capture-phase listener on
  // `document` runs before React's own handler and stops the propagation, which is what
  // keeps PluginTasks' "added job to queue" toast from appearing over a dialog that is
  // already open.
  var TASK_NAME = 'Find Entities by Text Content...';

  // Ours only if the label matches *and* the enclosing SettingGroup is headed with our
  // name - another plugin may declare a task called the same thing. Answered from the
  // button's own group and stopped there: climbing past it reaches the panel holding
  // every plugin's group, where `querySelector('h3')` answers with whichever plugin is
  // listed first.
  function ownTaskName(btn) {
    var label = trim(btn.textContent);
    if (label !== TASK_NAME) return null;
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

  // Re-applied every tick rather than once: React re-renders this panel and hands back a
  // button with Stash's own classes, and `paintButton` is a no-op on one that already
  // carries ours.
  function paintTaskButtons() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('button') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (ownTaskName(nodes[i])) paintButton(nodes[i], PLUGIN_BTN_VARIANT);
    }
  }

  if (document.addEventListener) {
    document.addEventListener('click', function (event) {
      var target = event.target;
      var btn = target && target.closest ? target.closest('button') : null;
      if (!btn || !ownTaskName(btn)) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      startRun();
    }, true);
  }

  // ── The dialog ────────────────────────────────────────────────────────────

  var _active = null;
  var _opening = false;

  function startRun() {
    if (_active) { _active.focus(); return; }
    if (_opening) return;                      // a second click inside the round trip
    _opening = true;
    var go = function (s) {
      _opening = false;
      if (_active) return;
      _active = new Run(s);
      _active.begin();
    };
    loadSettings().then(go, function () { go(DEFAULTS); });
  }

  function Run(settings) {
    this.settings = settings || DEFAULTS;
    var stored = readStore();
    // Off by default, as asked: a search that covered everything the first time it was
    // opened would read the whole library before the user had chosen anything.
    this.typeOn = {};
    var remembered = stored.persist && stored.types ? stored.types : null;
    TYPE_ORDER.forEach(function (k) { this.typeOn[k] = !!(remembered && remembered[k]); }, this);
    this.persist = !!stored.persist;
    this.historyMax = Math.max(0, Math.min(HISTORY_MAX, parseInt(stored.historyMax, 10) || 0));
    this.history = (stored.history || []).slice(0, this.historyMax);
    // Every entity that matched, in scan order. The rendered rows are a window on this;
    // Copy log takes all of it.
    this.results = [];
    this.rendered = 0;
    this.scanned = 0;
    this.matched = 0;
    this.needle = '';
    this.loadingWhat = '';
    this.stale = false;
    // 'idle' before a search, 'running', 'paused' (by hand), 'full' (the buffer filled),
    // 'done'. One word decides the button caption, the cursor and what the counters say.
    this.state = 'idle';
    // Bumped on every Search and Refresh, so a page that was already in flight when the
    // user restarted cannot append to the new listing.
    this.epoch = 0;
    this.logText = [];
    this.build();
  }

  Run.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'fetc-backdrop');
    this.modal = el('div', 'fetc-modal fetc-tall');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'fetc-head');
    // A plain block, so a title too long for one line wraps rather than being clipped.
    this.titleEl = el('div', 'fetc-title', PLUGIN_SHORT_NAME);
    head.appendChild(this.titleEl);
    this.staleEl = el('div', 'fetc-stale fetc-hidden', '');
    head.appendChild(this.staleEl);
    // **Not the backup sentence.** This dialog issues no mutation of any kind, so telling
    // anyone to back up first would be false. It says what it is instead - the same
    // reasoning `TagBundleClipboard`'s head follows.
    head.appendChild(el('div', 'fetc-note',
      'Nothing here is written to your library: this is a read and a list of links.'));
    head.appendChild(el('div', 'fetc-legend',
      'One line per entity that matched, reading: the entity with its id in brackets, ' +
      'then which attributes matched and how many times each, then the text around the ' +
      'first match. Click an entity to open it in a new tab. Turn on the types you want ' +
      'searched - they all start off. A long search pauses itself when the list is full; ' +
      'Continue clears what is on screen and carries on, and Copy log keeps every result ' +
      'either way.'));
    // The run's own warnings go in the amber slot every writing dialog gives the backup
    // sentence, which this head does not have - the same swap `TagBundleClipboard` makes,
    // and for the same reason: the standing sentence above is a fact about the dialog and
    // these are facts about this run.
    this.noteEl = el('div', 'fetc-warn', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.progressEl = el('div', 'fetc-progress', 'Type something to look for, turn on a type, and press Search.');
    this.modal.appendChild(this.progressEl);

    var bar = el('div', 'fetc-search fetc-search-wrap');
    bar.appendChild(el('span', 'fetc-label', 'Contains:'));
    this.textInput = el('input', 'fetc-textbox');
    this.textInput.type = 'text';
    this.textInput.value = '';
    this.textInput.addEventListener('input', function () { self.syncFooter(); });
    bar.appendChild(this.textInput);

    // Only on the page while the history is set to keep something, so an unused feature
    // is not a control that has to be explained.
    this.recentEl = el('select', 'fetc-recent');
    this.recentEl.addEventListener('change', function () {
      if (!self.recentEl.value) return;
      self.textInput.value = self.recentEl.value;
      self.syncFooter();
    });
    bar.appendChild(this.recentEl);

    var keep = el('label', 'fetc-check');
    this.persistBox = el('input');
    this.persistBox.type = 'checkbox';
    this.persistBox.checked = this.persist;
    this.persistBox.addEventListener('change', function () {
      self.persist = !!self.persistBox.checked;
      self.save();
    });
    keep.appendChild(this.persistBox);
    keep.appendChild(el('span', null, 'Remember filters'));
    keep.title = 'Keep the entity types you have turned on, in this browser, for the next ' +
      'time this dialog is opened. Nothing is written to your library or to the plugin ' +
      'settings.';
    bar.appendChild(keep);

    bar.appendChild(el('span', 'fetc-label', 'Recent searches kept:'));
    this.historyInput = el('input', 'fetc-num');
    this.historyInput.type = 'number';
    this.historyInput.value = String(this.historyMax);
    this.historyInput.title = 'How many previous searches to offer in the pulldown, in this ' +
      'browser. Zero keeps none - and setting it to zero also throws away the ones already ' +
      'kept, which is how the list is cleared.';
    this.historyInput.addEventListener('change', function () { self.setHistoryMax(); });
    this.historyInput.addEventListener('input', function () { self.setHistoryMax(); });
    bar.appendChild(this.historyInput);
    this.modal.appendChild(bar);

    this.filtersEl = el('div', 'fetc-filters');
    this.typeRow = el('div', 'fetc-filterrow');
    this.typeRow.appendChild(el('span', 'fetc-label', 'Entity types'));
    TYPE_ORDER.forEach(function (k) {
      self.typeRow.appendChild(self.toggle(ENTITIES[k].plural, k));
    });
    this.filtersEl.appendChild(this.typeRow);
    this.modal.appendChild(this.filtersEl);

    this.logEl = el('div', 'fetc-log');
    this.modal.appendChild(this.logEl);

    var foot = el('div', 'fetc-foot');
    // One button for the whole search, which is what the caption slash in the brief says:
    // Search when there is nothing running, Pause while there is, Resume after a pause by
    // hand, and Continue after the list filled itself and stopped.
    this.goBtn = button('Search', 'fetc-go');
    this.refreshBtn = button('Refresh', 'fetc-refresh');
    this.refreshBtn.title = 'Throw the results away and search again from the beginning.';
    this.cancelBtn = button('Cancel', 'fetc-cancel');
    this.copyBtn = button('Copy log', 'fetc-copy');
    this.copyBtn.title = 'Copy the counters, the messages and every result as plain text - ' +
      'including the ones the on-screen list no longer shows.';
    this.allOnBtn = button('All On', 'fetc-allon fetc-filterbtn');
    this.allOffBtn = button('All Off', 'fetc-alloff fetc-filterbtn');
    [this.allOnBtn, this.allOffBtn].forEach(function (b) {
      paintButton(b, FILTER_ON_VARIANT);
      b.title = 'Turn every entity type on or off.';
    });

    this.goBtn.addEventListener('click', function () { self.go(); });
    this.refreshBtn.addEventListener('click', function () { self.refresh(); });
    this.cancelBtn.addEventListener('click', function () { self.close(); });
    this.copyBtn.addEventListener('click', function () { self.copyLog(); });
    this.allOnBtn.addEventListener('click', function () { self.setAll(true); });
    this.allOffBtn.addEventListener('click', function () { self.setAll(false); });

    [this.goBtn, this.refreshBtn, this.cancelBtn, this.copyBtn]
      .forEach(function (b) { foot.appendChild(b); });
    foot.appendChild(el('div', 'fetc-spacer'));
    foot.appendChild(this.allOnBtn);
    foot.appendChild(this.allOffBtn);
    this.modal.appendChild(foot);

    this.syncRecent();
    this.syncFooter();
    wireEscape(this);
    document.body.appendChild(this.backdrop);
  };

  Run.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  Run.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*fetc-hidden/g, '') + (visible ? '' : ' fetc-hidden');
  };

  Run.prototype.showStale = function (msg) {
    this.staleEl.textContent = msg || '';
    this.show(this.staleEl, !!msg);
  };

  Run.prototype.toggle = function (label, key) {
    var self = this;
    var b = button(label, 'fetc-filterbtn');
    b._key = key;
    paintButton(b, this.typeOn[key] ? FILTER_ON_VARIANT : 'btn-secondary');
    b.addEventListener('click', function () {
      self.typeOn[key] = !self.typeOn[key];
      paintButton(b, self.typeOn[key] ? FILTER_ON_VARIANT : 'btn-secondary');
      self.save();
      self.syncFooter();
    });
    return b;
  };

  Run.prototype.setAll = function (on) {
    var self = this;
    for (var i = 0; i < this.typeRow.childNodes.length; i++) {
      var b = this.typeRow.childNodes[i];
      if (!b._key) continue;
      self.typeOn[b._key] = on;
      paintButton(b, on ? FILTER_ON_VARIANT : 'btn-secondary');
    }
    this.save();
    this.syncFooter();
  };

  Run.prototype.chosen = function () {
    var self = this;
    return TYPE_ORDER.filter(function (k) { return self.typeOn[k]; });
  };

  // Zero is not merely "keep none": it is also how the list already kept is cleared,
  // which is the one thing a number box can be asked to do that is not about the future.
  Run.prototype.setHistoryMax = function () {
    var n = parseInt(trim(this.historyInput.value), 10);
    if (!(n > 0)) n = 0;
    this.historyMax = Math.min(HISTORY_MAX, n);
    this.history = this.historyMax ? this.history.slice(0, this.historyMax) : [];
    this.syncRecent();
    this.save();
  };

  Run.prototype.remember = function (text) {
    if (!this.historyMax) return;
    this.history = [text].concat(this.history.filter(function (t) { return t !== text; }))
      .slice(0, this.historyMax);
    this.syncRecent();
    this.save();
  };

  Run.prototype.syncRecent = function () {
    this.show(this.recentEl, this.historyMax > 0);
    this.recentEl.textContent = '';
    var blank = el('option', null, this.history.length ? 'Recent searches' : 'Nothing kept yet');
    blank.value = '';
    this.recentEl.appendChild(blank);
    this.history.forEach(function (t) {
      var o = el('option', null, t);
      o.value = t;
      this.recentEl.appendChild(o);
    }, this);
    this.recentEl.value = '';
  };

  Run.prototype.save = function () {
    var types = {};
    var self = this;
    TYPE_ORDER.forEach(function (k) { if (self.typeOn[k]) types[k] = true; });
    writeStore({
      persist: this.persist,
      types: this.persist ? types : null,
      historyMax: this.historyMax,
      history: this.history,
    });
  };

  // Search / Pause / Resume / Continue, and the reason the button is disabled said out
  // loud rather than left to be guessed at.
  Run.prototype.syncFooter = function () {
    var caption = this.state === 'running' ? 'Pause'
      : this.state === 'paused' ? 'Resume'
        : this.state === 'full' ? 'Continue' : 'Search';
    this.goBtn.textContent = caption;
    paintButton(this.goBtn, 'btn-secondary');
    var text = trim(this.textInput.value);
    var types = this.chosen().length;
    var why = this.state !== 'idle' && this.state !== 'done' ? ''
      : !text ? 'Type what to look for.'
        : !types ? 'Turn on at least one entity type.' : '';
    this.goBtn.disabled = !!why;
    this.goBtn.title = why || (caption === 'Pause' ? 'Stop after the page being read.'
      : caption === 'Continue' ? 'Clear the list on screen and carry on from where it stopped.'
        : caption === 'Resume' ? 'Carry on from where it stopped.'
          : 'Read every ' + plural(types, 'chosen type') + ' looking for this text.');
    this.refreshBtn.disabled = this.state === 'running' || !text || !types;
    this.textInput.disabled = this.state === 'running';
    this.historyInput.disabled = this.state === 'running';
    this.allOnBtn.disabled = this.state === 'running';
    this.allOffBtn.disabled = this.state === 'running';
    this.spin(this.state === 'running');
  };

  // A cursor cycling under the last line of the log for as long as work is in flight,
  // and gone the moment it is not. It carries no `-line` class, since it is not a message
  // and must not be read back as one.
  Run.prototype.spin = function (on) {
    if (!on) {
      if (this.spinTimer) clearInterval(this.spinTimer);
      this.spinTimer = null;
      if (this.spinEl && this.spinEl.parentNode) this.spinEl.parentNode.removeChild(this.spinEl);
      this.spinEl = null;
      return;
    }
    if (!this.spinEl) {
      this.spinEl = el('div', 'fetc-spin', SPIN_FRAMES[0]);
      var self = this, i = 0;
      this.spinTimer = setInterval(function () {
        self.spinEl.textContent = SPIN_FRAMES[++i % SPIN_FRAMES.length];
      }, SPIN_MS);
    }
    this.logEl.appendChild(this.spinEl);
  };

  Run.prototype.msg = function (kind, message) {
    var line = el('div', 'fetc-line fetc-' + kind);
    line.textContent = '[' + kind + '] ' + message;
    this.logEl.appendChild(line);
    this.logText.push('[' + kind + '] ' + message);
    if (this.spinEl) this.logEl.appendChild(this.spinEl);   // back to the end
    this.scrollLog();
    if (this.settings.a1LogToConsole) fetc('[fetc] ' + kind + ': ' + message);
    return line;
  };

  Run.prototype.note = function (message) {
    this.msg('WARN', message);
    this.noteEl.textContent = this.noteEl.textContent
      ? this.noteEl.textContent + ' ' + message : message;
  };

  Run.prototype.scrollLog = function () {
    if (this.logEl && typeof this.logEl.scrollHeight === 'number') {
      this.logEl.scrollTop = this.logEl.scrollHeight;
    }
  };

  Run.prototype.progress = function () {
    this.progressEl.textContent = this.state === 'idle' && !this.scanned
      ? 'Type something to look for, turn on a type, and press Search.'
      : 'Scanned ' + plural(this.scanned, 'entity', 'entities') +
        (this.loadingWhat && this.state === 'running' ? ' (' + this.loadingWhat + ')' : '') +
        '  ·  ' + plural(this.matched, 'match', 'matches') +
        '  ·  ' + this.rendered + ' on screen' +
        (this.state === 'paused' ? '  ·  paused'
          : this.state === 'full' ? '  ·  paused, list full'
            : this.state === 'done' ? '  ·  finished' : '');
  };

  Run.prototype.begin = function () {
    this.checkVersion();
    var other = foreignLease();
    if (other) {
      // Not a stand-down: this plugin has nothing to suppress. A bulk run is rewriting
      // the entities being read, so a result may be a moment out of date, and saying so
      // costs a line.
      this.note('Another plugin is applying bulk changes right now (' + other.owner + ' - ' +
        other.label + '), so what this search finds may be a moment behind.');
    }
    this.progress();
  };

  Run.prototype.checkVersion = function () {
    var self = this;
    installedVersion().then(function (installed) {
      if (!installed || installed === PLUGIN_VERSION) { self.showStale(''); return; }
      self.stale = true;
      var msg = '⚠ This page is running ' + PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION +
        ', but Stash has ' + installed + ' installed. Reload the page (F5); if this warning ' +
        'comes back, hard-refresh with Ctrl+Shift+R (⌘+Shift+R on a Mac).';
      self.msg('WARN', msg);
      self.showStale(msg);
    });
  };

  // ── Searching ─────────────────────────────────────────────────────────────

  Run.prototype.go = function () {
    if (this.state === 'running') { this.state = 'paused'; this.syncFooter(); this.progress(); return; }
    if (this.state === 'paused') { this.resume(); return; }
    if (this.state === 'full') { this.clearRows(); this.resume(); return; }
    this.start();
  };

  Run.prototype.refresh = function () {
    if (this.state === 'running') return;
    this.msg('INFO', 'Searching again from the beginning.');
    this.start();
  };

  Run.prototype.start = function () {
    var self = this;
    var text = trim(this.textInput.value);
    if (!text) return;                       // an empty box does nothing, as asked
    this.epoch++;
    this.needle = text;
    this.results = [];
    this.scanned = 0;
    this.matched = 0;
    this.clearRows();
    this.remember(text);
    this.titleEl.textContent = PLUGIN_SHORT_NAME + ' - "' + text + '"';
    this.queue = this.chosen().slice();
    this.page = 1;
    this.state = 'running';
    this.syncFooter();
    this.msg('INFO', 'Looking for "' + text + '" in ' +
      this.queue.map(function (k) { return ENTITIES[k].plural; }).join(', ') + '.');
    describeFields().then(function (shapes) {
      self.shapes = shapes;
      return self.step(self.epoch);
    }).then(null, function (e) {
      if (self.state !== 'running') return;
      self.msg('ERROR', 'The search failed: ' + (e && e.message ? e.message : String(e)));
      self.finish();
    });
  };

  Run.prototype.resume = function () {
    var self = this;
    if (this.state === 'done' || !this.queue) return;
    this.state = 'running';
    this.syncFooter();
    this.step(this.epoch).then(null, function (e) {
      if (self.state !== 'running') return;
      self.msg('ERROR', 'The search failed: ' + (e && e.message ? e.message : String(e)));
      self.finish();
    });
  };

  // One page of one type per turn, so Pause has somewhere to stand and the buffer can
  // stop the search rather than the search having to know about the buffer. `epoch` is
  // what stops a page that was already in flight from appending to a listing the user
  // has since restarted.
  Run.prototype.step = function (epoch) {
    var self = this;
    if (epoch !== this.epoch || this.state !== 'running') return Promise.resolve();
    if (!this.queue.length) { this.finish(); return Promise.resolve(); }
    var spec = ENTITIES[this.queue[0]];
    var fields = this.shapes[spec.key] || [];
    if (!fields.length) {
      this.msg('WARN', 'This Stash has none of the text fields this plugin looks for on ' +
        spec.plural + '; that type is skipped.');
      this.queue.shift();
      this.page = 1;
      return this.step(epoch);
    }
    this.loadingWhat = spec.plural;
    return gqlRequest(pageQuery(spec, fields),
      { f: { page: this.page, per_page: READ_PAGE, sort: 'id', direction: 'ASC' } })
      .then(function (data) {
        if (epoch !== self.epoch) return;
        var block = data[spec.find] || {};
        var list = block[spec.list] || [];
        list.forEach(function (ent) {
          self.scanned++;
          var hit = scanEntity(spec, fields, ent, self.needle);
          if (!hit) return;
          self.matched++;
          self.results.push(hit);
          if (self.rendered < RESULT_BUFFER) self.addRow(hit);
        });
        if (list.length < READ_PAGE) { self.queue.shift(); self.page = 1; } else self.page++;
        self.progress();
        // The list filled while this page was being read. Stop here rather than at the
        // exact row: a page is the unit everything else in this loop works in, and
        // half a page of results already on screen is not a state worth inventing.
        if (self.rendered >= RESULT_BUFFER && self.state === 'running') {
          self.state = 'full';
          self.syncFooter();
          self.progress();
          self.msg('INFO', 'Paused: the list on screen holds ' +
            plural(RESULT_BUFFER, 'result') + '. Continue clears it and carries on; every ' +
            'result so far is still in Copy log.');
          return;
        }
        return self.step(epoch);
      });
  };

  Run.prototype.finish = function () {
    this.state = 'done';
    this.loadingWhat = '';
    this.syncFooter();
    this.progress();
    this.msg('INFO', this.matched
      ? 'Finished: ' + plural(this.matched, 'entity', 'entities') + ' mention "' +
        this.needle + '", out of ' + plural(this.scanned, 'entity', 'entities') + ' read.'
      : 'Finished: nothing in the ' + plural(this.scanned, 'entity', 'entities') +
        ' read mentions "' + this.needle + '".');
  };

  // ── The listing ───────────────────────────────────────────────────────────

  Run.prototype.clearRows = function () {
    if (this.listEl && this.listEl.parentNode) this.listEl.parentNode.removeChild(this.listEl);
    this.listEl = el('div', 'fetc-results');
    this.logEl.insertBefore(this.listEl, this.logEl.firstChild);
    this.rendered = 0;
  };

  Run.prototype.addRow = function (hit) {
    if (!this.listEl) this.clearRows();
    var row = el('div', 'fetc-result');
    var link = el('a', 'fetc-ent', (hit.name || '(untitled)') + ' (' + hit.id + ')');
    link.href = ENTITIES[hit.typeKey].route + hit.id;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    row.appendChild(link);
    row.appendChild(el('span', 'fetc-attr', ENTITIES[hit.typeKey].label + ' · ' +
      hit.attrs.map(function (a) {
        return a.label + (a.count > 1 ? ' ×' + a.count : '');
      }).join(', ')));
    if (hit.first) {
      var ctx = el('span', 'fetc-ctx');
      ctx.appendChild(el('span', null, hit.first.ctx.pre));
      ctx.appendChild(el('span', 'fetc-mark', hit.first.ctx.hit));
      ctx.appendChild(el('span', null, hit.first.ctx.post));
      row.appendChild(ctx);
    }
    this.listEl.appendChild(row);
    this.rendered++;
    return row;
  };

  Run.prototype.resultText = function (hit) {
    return ENTITIES[hit.typeKey].label + ' ' + (hit.name || '(untitled)') + ' (' + hit.id +
      ') · ' + hit.attrs.map(function (a) {
        return a.label + (a.count > 1 ? ' x' + a.count : '');
      }).join(', ') +
      (hit.first ? ': ' + hit.first.ctx.pre + hit.first.ctx.hit + hit.first.ctx.post : '');
  };

  Run.prototype.copyLog = function () {
    var self = this;
    var lines = [this.progressEl.textContent, ''];
    // Every result, not only the ones the buffer is currently showing - which is the
    // whole reason the buffer is allowed to throw rows away.
    this.results.forEach(function (hit) { lines.push(self.resultText(hit)); });
    lines.push('');
    this.logText.forEach(function (l) { lines.push(l); });
    var was = this.copyBtn.textContent;
    copyToClipboard(lines.join('\n'), function (ok) {
      self.copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { self.copyBtn.textContent = was; }, 2000);
    });
  };

  // ── Escape ────────────────────────────────────────────────────────────────
  //
  // Escape acts through the footer's own exit rather than by calling `close()` itself.
  // The footer is the dialog's statement of what it will let you do right now, so the
  // key can never reach a button that is hidden or disabled.
  function escapeButton(run) {
    var b = run.cancelBtn;
    return b && !b.disabled && !hasClass(b, 'fetc-hidden') ? b : null;
  }

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
    // The epoch moves, so a page still in flight cannot append to a dialog that has gone.
    this.epoch++;
    this.state = 'done';
    unwireEscape(this);
    this.spin(false);
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    _active = null;
  };

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // The group gets the siblings' description treatment - a one-line summary, the rest
  // behind **Show more**, and a labelled link to the README under it - and the setting
  // row the per-setting hover box.
  //
  // The `plugin-<id>-<key>` id Stash builds is ours by construction and is the anchor;
  // the heading is the fallback, because a plugin whose only route in is a heading loses
  // its whole settings page to a rename.
  function headingIsOurs(text) {
    var t = trim(text);
    if (t === PLUGIN_NAME) return true;
    // Settings → Plugins appends the version - `${name} ${version ? `(${v})` : undefined}`
    // - and interpolates the literal `undefined` when a plugin has no version at all.
    t = t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '').trim();
    return t === PLUGIN_NAME;
  }

  function settingElement(key) {
    return document.getElementById('plugin-' + PLUGIN_ID + '-' + key);
  }

  function settingRow(key) {
    var node = settingElement(key);
    for (var d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting')) return node;
    }
    return null;
  }

  function byClass(root, name) {
    if (!root || typeof root.querySelector !== 'function') return null;
    try { return root.querySelector('.' + name) || null; } catch (e) { return null; }
  }

  // The group and the description, found from our own setting row where there is one and
  // from our heading otherwise. The description is required to be in the same `.setting`
  // row as the heading: Settings → Tasks heads its group with the plugin name too and
  // gives every task row a `.sub-heading` of its own, so anything looser decorates the
  // wrong panel - and there the slot the README link takes is inside the task button.
  function ownParts() {
    var anchors = [];
    for (var k in DEFAULTS) {
      if (!hasOwn(DEFAULTS, k)) continue;
      var e = settingElement(k);
      if (e) { anchors.push(e); break; }
    }
    var heads = document.querySelectorAll ? document.querySelectorAll('h3') : [];
    for (var i = 0; i < heads.length; i++) {
      if (headingIsOurs(heads[i].textContent)) anchors.push(heads[i]);
    }
    for (var a = 0; a < anchors.length; a++) {
      var node = anchors[a];
      for (var d = 0; node && d < 12; d++, node = node.parentElement) {
        if (!hasClass(node, 'setting-group')) continue;
        var heading = node.querySelector ? node.querySelector('h3') : null;
        var header = null;
        var rows = node.querySelectorAll ? node.querySelectorAll('.setting') : [];
        for (var r = 0; r < rows.length; r++) {
          if (rows[r].querySelector && rows[r].querySelector('h3') === heading) {
            header = rows[r];
            break;
          }
        }
        var sub = header ? byClass(header, 'sub-heading') : null;
        // A group whose header row holds a task button is Settings → Tasks, which heads
        // its group with the same name; decorating it destroys the button.
        var isTasks = header && header.querySelector && header.querySelector('button');
        if (sub && !isTasks && heading && headingIsOurs(heading.textContent)) {
          return { group: node, sub: sub, heading: heading };
        }
        break;
      }
    }
    return null;
  }

  // Stash puts the text back on every re-render of this panel, so this runs on every tick
  // and re-splits when it has to. Idempotent: once the children are ours there is no text
  // node left to split.
  function splitDescription(sub) {
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'fetc-p')) return;
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;
    var paras = text.split(/\n{2,}/);
    sub.textContent = '';
    paras.forEach(function (para) {
      var t = oneLine(para);
      if (t) sub.appendChild(el('div', 'fetc-p', t));
    });
  }

  function descCollapsed(sub) { return hasClass(sub, 'fetc-desc-collapsed'); }

  function setDescCollapsed(sub, on) {
    var cls = String(sub.className || '').replace(/\s*fetc-desc-collapsed\b/, '');
    sub.className = (on ? cls + ' fetc-desc-collapsed' : cls).replace(/^\s+/, '');
  }

  // The toggle is a `<button>` rather than a span: `SettingGroup`'s `onDivClick` walks up
  // from the event target and returns early only for `a` and `button`, so anything else
  // would fold the whole group on click.
  function collapseDescription(sub) {
    var kids = sub.childNodes || [];
    var paras = 0;
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], 'fetc-p')) paras++;
    if (paras < 2) return;
    if (document.getElementById(DESC_TOGGLE_ID)) return;
    setDescCollapsed(sub, true);
    var btn = el('button', 'fetc-desc-toggle', 'Show more');
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

  function readmeLinkSlot(sub) {
    return { parent: sub.parentNode, before: sub.nextSibling };
  }

  var TIP_MARK = 'ⓘ';                       // circled Latin small letter i

  function setTipOpen(sub, on) {
    var cls = String(sub.className || '').replace(/\s*fetc-tip-open\b/, '');
    sub.className = (on ? cls + ' fetc-tip-open' : cls).replace(/^\s+/, '');
  }

  // The row is passed rather than the .sub-heading, and the current one looked up per
  // event: an <h3> is Stash's element and survives the re-renders that replace everything
  // we put in the row, so a captured reference would go stale.
  function tipTrigger(node, row) {
    if (!node || node._fetcTipWired) return;
    node._fetcTipWired = true;
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
    if (kids.length && hasClass(kids[0], 'fetc-sum')) return;
    var text = sub.textContent || '';
    var cut = text.indexOf('\n\n');
    if (cut === -1) return;
    var summary = oneLine(text.slice(0, cut));
    var detail = text.slice(cut + 2).split(/\n{2,}/).map(oneLine)
      .filter(function (p) { return !!p; }).join('\n\n');
    if (!summary || !detail) return;
    sub.textContent = '';
    if (!hasClass(sub, 'fetc-tipped')) {
      sub.className = ((sub.className || '') + ' fetc-tipped').replace(/^\s+/, '');
    }
    var sum = el('span', 'fetc-sum', summary);
    sub.appendChild(sum);
    // tabIndex, so the box can be reached and read without a mouse. The box is a sibling
    // of the mark rather than a child: as a child it would sit inside an inline span and
    // inherit its clipping and stacking.
    var mark = el('span', 'fetc-tip', TIP_MARK);
    mark.tabIndex = 0;
    sub.appendChild(mark);
    sub.appendChild(el('span', 'fetc-tipbox', detail));
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

  // ── The stale-script banner ───────────────────────────────────────────────
  //
  // Stash serves plugin JS with caching on, so a browser holding the old file goes on
  // running it after an update and nothing on screen says so. The settings heading is
  // where the two numbers meet: Stash builds it as `${name} (${version})` from the
  // manifest, read fresh from the server, while `PLUGIN_VERSION` is what this script
  // actually is.
  function installedFromHeading(heading) {
    var t = heading ? trim(heading.textContent) : '';
    var m = /\(([^()]+)\)$/.exec(t);
    return m ? trim(m[1]) : null;
  }

  function ensureStaleNotice(parts) {
    var installed = installedFromHeading(parts.heading);
    var node = document.getElementById(STALE_ID);
    if (!installed || installed === PLUGIN_VERSION) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    var slot = { parent: parts.sub.parentNode, before: parts.sub };
    if (node && node.parentNode === slot.parent) return;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    var box = el('div', 'fetc-stale', '⚠ This page is still running ' +
      PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. ' +
      'Press Ctrl+Shift+R (⌘+Shift+R on a Mac) to reload it: your browser has cached the ' +
      'older script, and everything this plugin does until then is that older code.');
    box.id = STALE_ID;
    slot.parent.insertBefore(box, slot.before);
  }

  function settingsTick() {
    var parts = ownParts();
    if (!parts) return;
    injectStyle();
    if (!hasClass(parts.group, 'fetc-own-group')) {
      parts.group.className = ((parts.group.className || '') + ' fetc-own-group').replace(/^\s+/, '');
    }
    splitDescription(parts.sub);
    collapseDescription(parts.sub);   // after the split: it counts the .fetc-p divs
    tipSettings();
    ensureStaleNotice(parts);         // before the early return: the link outlives it
    if (document.getElementById(README_LINK_ID)) return;
    var link = el('a', 'fetc-readme', 'FindEntitiesByTextContent/README.md');
    link.id = README_LINK_ID;
    link.href = README_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Open this plugin\'s documentation';
    var slot = readmeLinkSlot(parts.sub);
    slot.parent.insertBefore(link, slot.before);
  }

  // ── Ticking ───────────────────────────────────────────────────────────────
  //
  // The settings page and the task button are decoration in a panel, not something that
  // has to land before the user can click it, so a timer plus the navigation hooks is
  // enough - there is no MutationObserver here and so nothing to subscribe to the shared
  // bus.
  function tick() {
    try { settingsTick(); } catch (e) { console.error('[fetc] settings tick failed', e); }
    try { paintTaskButtons(); } catch (e) { console.error('[fetc] task paint failed', e); }
  }

  if (window.addEventListener) {
    window.addEventListener('load', function () { tick(); });
    window.addEventListener('popstate', function () { setTimeout(tick, 300); });
  }
  setInterval(tick, TICK_MS);
  tick();

  // The shared object is brought into its full shape at load even though this plugin
  // registers nothing in it: every sibling does so as a side effect of the entry it
  // *does* make, and a plugin that loads first and leaves `leases` undefined is one the
  // next plugin's `coop()` has to repair. One call, and the invariant holds whoever
  // loads first.
  coop();
  window.__GTTx__.fetc = {
    occurrences: occurrences,
    context: context,
    scanEntity: scanEntity,
    open: startRun,
    dialog: function () { return _active; },
  };
}());
