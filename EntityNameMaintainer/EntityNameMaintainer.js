// Entity Name Maintainer
//
// Requires Stash 0.31.0 or newer: `custom_fields` on the seven entity types is one of
// the places this plugin looks, and `CustomFieldsInput` on their update mutations is
// how it writes there.
//
// Renaming a performer, a studio, a tag or a scene in Stash moves one string. Every
// *other* string that mentioned it - a scene's details, a group's synopsis, a tag's
// description, a custom field's name or its value - goes on naming the old one, and
// nothing in Stash notices. This plugin does: it watches for a rename, reads the name
// the entity had a moment before, then walks every text field of every entity looking
// for it and offers to bring them along.
//
// **Nothing is written until Proceed.** The dialog lists one line per occurrence, each
// with a tick of its own, and the writes are per-field deltas so an Undo puts back
// exactly what this dialog changed.
//
// **The scan is a read of the whole library.** There is no server-side filter that can
// answer "any text field of any type contains this", because custom fields can only be
// filtered by naming the key up front - so the rows come back and the matching happens
// here.
// ponytail: full paged scan; the six non-custom-field types could be narrowed with each
// filter type's own OR chain of INCLUDES criteria if a large library makes this slow.
//
// The design notes, and the reasoning behind the parts that look arbitrary, are in
// CLAUDE.md next to this file.
(function () {
  'use strict';

  var PLUGIN_ID   = 'EntityNameMaintainer';
  var PLUGIN_NAME = 'ᝯㄝₓ Entity Name Maintainer';
  // The name the dialog head wears. `PLUGIN_NAME` is the manifest's and has to stay
  // byte-identical to the `.yml`, because `ownParts`' heading match finds this plugin's
  // block on the settings page with it. This one is free to be short, and here it has
  // to be: the head goes on to name the entity, the old name and the new one.
  var PLUGIN_SHORT_NAME = 'ᝯㄝₓ Name Maintainer';

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and goes current the moment plugins are reloaded, while the browser can
  // still be running a script it cached before the edit - so a heading reading one
  // version over the previous one's behaviour is the normal look of a stale script,
  // not a contradiction.
  //
  // The major digit is zero and stays there until the plugin has been used in a live
  // Stash: it is the claim that the thing works, and no test in this repo can check a
  // guess about Stash's schema or about which mutation its edit form actually posts.
  var PLUGIN_VERSION = '0.0.4';

  // Printed before anything else runs, so a script that loads and then throws is told
  // apart from one that never loaded at all. Through whatever the console offers rather
  // than console.info directly: this is the first statement in the file.
  function enm(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  enm('[enm] EntityNameMaintainer.js ' + PLUGIN_VERSION + ' loaded. This is the running ' +
    'script\'s own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/StashPlugins/blob/main/EntityNameMaintainer/README.md';
  var STYLE_ID       = 'enm-style';
  var README_LINK_ID = 'enm-readme-link';
  var DESC_TOGGLE_ID = 'enm-desc-toggle';
  var STALE_ID       = 'enm-stale-notice';

  // Amber for the buttons that write, and for the filter toggles while they are on.
  // See "one colour for a plugin wrote this" in the repo-root CLAUDE.md.
  var PLUGIN_BTN_VARIANT = 'btn-warning';

  var READ_PAGE    = 500;    // entities per page of the scan
  var WRITE_CHUNK  = 25;     // entities written per batch, so Undo and the log stay live
  var LEASE_TTL_MS = 300000;
  var TICK_MS      = 1000;
  var CONTEXT      = 48;     // characters of surrounding text shown either side of a hit
  var ELLIPSIS     = '…';
  // The busy cursor under the last line of the log. The counters say how far a scan or
  // a write has got; this says it is still going.
  var SPIN_FRAMES = ['▙', '▛', '▜', '▟'];
  var SPIN_MS = 125;           // one four-frame cycle at 2Hz

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
  // actually has is settled by one introspection query at the start of every scan (see
  // `describeFields`). A schema this plugin guessed wrong about would otherwise fail
  // the whole query and report as "nothing found", which is the one failure mode a
  // search tool must not have.
  //
  //   nameField  the field a rename moves, and so the one the fetch wrapper watches
  //   extra      the display fields that are not searchable text - a file's basename,
  //              a gallery's folder - so a hit can name an entity with no title
  //   update     the single-entity mutation; there is no bulk input carrying free text
  var ENTITIES = {
    scenes: {
      key: 'scenes', label: 'Scene', plural: 'Scenes', gqlType: 'Scene',
      find: 'findScenes', list: 'scenes', one: 'findScene', route: '/scenes/',
      update: 'sceneUpdate', updateInput: 'SceneUpdateInput', nameField: 'title',
      extra: 'files { basename }',
      fields: ['title', 'code', 'details', 'director', 'urls', 'custom_fields'],
    },
    images: {
      key: 'images', label: 'Image', plural: 'Images', gqlType: 'Image',
      find: 'findImages', list: 'images', one: 'findImage', route: '/images/',
      update: 'imageUpdate', updateInput: 'ImageUpdateInput', nameField: 'title',
      extra: 'visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }',
      fields: ['title', 'code', 'details', 'photographer', 'urls', 'custom_fields'],
    },
    galleries: {
      key: 'galleries', label: 'Gallery', plural: 'Galleries', gqlType: 'Gallery',
      find: 'findGalleries', list: 'galleries', one: 'findGallery', route: '/galleries/',
      update: 'galleryUpdate', updateInput: 'GalleryUpdateInput', nameField: 'title',
      extra: 'files { basename } folder { basename }',
      fields: ['title', 'code', 'details', 'photographer', 'urls', 'custom_fields'],
    },
    performers: {
      key: 'performers', label: 'Performer', plural: 'Performers', gqlType: 'Performer',
      find: 'findPerformers', list: 'performers', one: 'findPerformer', route: '/performers/',
      update: 'performerUpdate', updateInput: 'PerformerUpdateInput', nameField: 'name',
      extra: '',
      fields: ['name', 'disambiguation', 'alias_list', 'details', 'urls', 'tattoos',
        'piercings', 'measurements', 'career_length', 'custom_fields'],
    },
    studios: {
      key: 'studios', label: 'Studio', plural: 'Studios', gqlType: 'Studio',
      find: 'findStudios', list: 'studios', one: 'findStudio', route: '/studios/',
      update: 'studioUpdate', updateInput: 'StudioUpdateInput', nameField: 'name',
      extra: '',
      fields: ['name', 'aliases', 'details', 'urls', 'custom_fields'],
    },
    groups: {
      key: 'groups', label: 'Group', plural: 'Groups', gqlType: 'Group',
      find: 'findGroups', list: 'groups', one: 'findGroup', route: '/groups/',
      update: 'groupUpdate', updateInput: 'GroupUpdateInput', nameField: 'name',
      extra: '',
      fields: ['name', 'aliases', 'synopsis', 'director', 'urls', 'custom_fields'],
    },
    tags: {
      key: 'tags', label: 'Tag', plural: 'Tags', gqlType: 'Tag',
      find: 'findTags', list: 'tags', one: 'findTag', route: '/tags/',
      update: 'tagUpdate', updateInput: 'TagUpdateInput', nameField: 'name',
      extra: '',
      fields: ['name', 'aliases', 'description', 'custom_fields'],
    },
  };

  var TYPE_ORDER = ['scenes', 'images', 'galleries', 'performers', 'studios', 'groups', 'tags'];

  // The label a filter row and a hit line both wear. One label per *concept*, shared
  // across types on purpose: Details means the same thing on a Scene and on a
  // Performer, and a user turning it off means both.
  var FIELD_LABEL = {
    title: 'Title', name: 'Name', code: 'Code', details: 'Details',
    description: 'Description', synopsis: 'Synopsis', director: 'Director',
    photographer: 'Photographer', urls: 'URLs', aliases: 'Aliases',
    alias_list: 'Aliases', disambiguation: 'Disambiguation', tattoos: 'Tattoos',
    piercings: 'Piercings', measurements: 'Measurements', career_length: 'Career length',
  };
  var CF_NAME_LABEL  = 'Custom field name';
  var CF_VALUE_LABEL = 'Custom field value';

  // Which mutation on which type a rename arrives as, keyed by mutation name so the
  // fetch wrapper can look one up without walking the table.
  var BY_MUTATION = {};
  TYPE_ORDER.forEach(function (k) { BY_MUTATION[ENTITIES[k].update] = ENTITIES[k]; });

  // `CustomFieldsBulkEditor` keeps every custom field's *description* in one tag's own
  // description, as JSON. That is another plugin's plumbing rather than the user's
  // prose, and a text replacement inside it would rewrite JSON by hand - which is
  // exactly the way to break it. The tag marks itself with a custom field, so it can
  // be recognised whatever the user has renamed it to, and it is skipped whole.
  var CFBE_STORE_FIELDS = ['ᱜ╦╦🞮_🛂🧲_🛠🛈🖫_desc_store', 'cfbe_desc_store'];

  // ── Settings ──────────────────────────────────────────────────────────────
  //
  // A key is the storage key: renaming one silently resets it for every install.
  //
  // The two thresholds are settings rather than constants because what counts as "too
  // many" is a fact about the library, not about the plugin: a short name in a large
  // collection legitimately matches hundreds of times, and a user who cannot raise the
  // ceiling is a user the dialog has simply refused.
  var DEFAULTS = {
    a1SkipImages: false,
    b1WarnAbove: '200',
    c1StopAbove: '2000',
    d1LogToConsole: false,
  };

  function numSetting(s, key) {
    var n = parseInt(trim(s[key]), 10);
    if (!(n > 0)) n = parseInt(DEFAULTS[key], 10);
    return n;
  }

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

  // Both halves of the protocol, and this plugin needs both. It **reacts**: a rename
  // arriving while a sibling holds a lease is one of hundreds that bulk run is about to
  // make, and a dialog per rename would be the worst possible answer - so it registers
  // as a respecter and stands down. It also **writes** in bulk once Proceed is pressed,
  // so it takes a lease of its own for the duration.
  //
  // It declares nothing: a text replacement is not a relationship copy, and any path id
  // it published would be a claim about a graph it never walks. It draws no button into
  // an entity's action row - the rename itself is the trigger - so it registers no
  // `order` priority either.
  coop().respecters[PLUGIN_ID] = true;

  // Off unless `__GTTx__.StashPluginCoop.debugButtons = true`, typed into the browser
  // console: no setting, no reload, and read at call time so it takes effect on the next
  // rename. The shared switch rather than one of our own, because the question it answers -
  // "why did nothing happen when I renamed that" - is the same shape as "why is this button
  // not there", and a user in DevTools should have one thing to type.
  //
  // A rename is a user action rather than a tick, so these are **not** deduplicated: one
  // line per save is the point. The one exception is the unreadable-body line, which could
  // otherwise fire on every request the page makes.
  var _gateLast = {};

  // **And a ring of the same lines, kept whether or not anything is switched on.**
  //
  // The switch above has the flaw this repo has already written down once, about the
  // button diagnostics: a diagnostic that only speaks when it was turned on beforehand is
  // silent exactly when it is wanted. Nobody switches on a debug flag *before* the rename
  // that is going to fail - they switch it on afterwards, having noticed, and by then the
  // event is gone.
  //
  // So every decision is recorded regardless, bounded, and read back after the fact with
  // `__GTTx__.enm.status()`. It costs a string per save and answers the one question
  // nothing else can: whether this plugin saw the request at all.
  var TRACE_MAX = 25;
  var _trace = [];
  var _stats = { fetches: 0, readable: 0, graphql: 0, matched: 0 };

  function trace(line) {
    var t = new Date();
    _trace.push(('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) +
      ':' + ('0' + t.getSeconds()).slice(-2) + '  ' + line);
    if (_trace.length > TRACE_MAX) _trace.shift();
    gateLog(line);
  }

  function gateLog(line) {
    if (!coop().debugButtons) { _gateLast = {}; return; }
    console.info('[enm gate] ' + line);
  }

  function gateOnce(channel, line) {
    if (!coop().debugButtons) { _gateLast = {}; return; }
    if (_gateLast[channel] === line) return;
    _gateLast[channel] = line;
    console.info('[enm gate] ' + line);
  }

  // A bulk run announces itself for the duration of its writes, so a reactive plugin in
  // the same tab stands down rather than reacting to every entity we touch. Advisory,
  // always expiring, per tab - see the repo-root CLAUDE.md.
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

  // Someone else's lease, still live. Expired ones are dropped on the way past: a tab
  // that crashed mid-run must not disable this plugin until the next reload.
  function foreignLease() {
    var c = coop();
    var now = Date.now();
    for (var i = c.leases.length - 1; i >= 0; i--) {
      if (c.leases[i].until <= now) c.leases.splice(i, 1);
    }
    for (var j = 0; j < c.leases.length; j++) {
      if (c.leases[j].owner !== PLUGIN_ID) return c.leases[j];
    }
    return null;
  }

  // ── GraphQL ───────────────────────────────────────────────────────────────
  //
  // Through the fetch this script captured at load, never through `window.fetch`: the
  // wrapper below is watching for rename mutations, and this plugin's own reads and
  // writes must not be things it reacts to. Capturing it also means a *later* plugin
  // wrapping fetch does not get to see these, which is the same trade.
  var ORIG_FETCH = window.fetch && window.fetch.bind(window);

  function gqlRequest(query, variables) {
    return ORIG_FETCH('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, variables: variables }),
      // Ours. See `handle` - on a re-evaluated page the fetch captured at load *is* the
      // wrapper, and this is what keeps our own writes from looking like a user's rename.
      __enm: true,
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
        if (!hasOwn(DEFAULTS, k)) continue;
        s[k] = typeof DEFAULTS[k] === 'boolean' ? !!raw[k]
          : (hasOwn(raw, k) && raw[k] != null ? String(raw[k]) : DEFAULTS[k]);
      }
      seedDefaults(raw);
      return s;
    });
  }

  // Stash's plugin settings have no `default:` in the manifest - the panel shows
  // whatever is in `config.yml`, which is nothing at all until the user types in the
  // box. So a STRING setting reads as empty while the plugin is quietly using its
  // default. Writing the defaults in once settles it: the box shows the number it is
  // actually using.
  //
  // The **whole** map goes back, not just the keys being seeded: `configurePlugin`
  // replaces a plugin's configuration rather than merging into it (§`configurePlugin`
  // in the repo-root CLAUDE.md), so a partial input deletes every setting it does not
  // name. Silent on failure - a settings write nobody asked for must not put an error
  // in front of someone who came here to rename a tag.
  var _seeded = false;
  function seedDefaults(raw) {
    if (_seeded) return;
    var input = {};
    var missing = 0;
    var k;
    for (k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
    for (k in DEFAULTS) {
      if (!hasOwn(DEFAULTS, k) || typeof DEFAULTS[k] === 'boolean') continue;
      if (hasOwn(raw, k) && raw[k] != null) continue;
      input[k] = DEFAULTS[k];
      missing++;
    }
    if (!missing) return;
    _seeded = true;
    gqlRequest('mutation ENM_SeedSettings($id: ID!, $input: Map!) ' +
      '{ configurePlugin(plugin_id: $id, input: $input) }',
    { id: PLUGIN_ID, input: input }).then(null, function () { _seeded = false; });
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  var CSS =
    // Kept literally identical to the sibling plugins' stylesheets wherever the dialogs
    // overlap, down to the hex values. They are separate strings because the plugins
    // share no module, not because they are meant to look different - and two of them
    // did drift, from #202b33 to #30404d, because nothing compared them.
    // `tests/style.test.js` pins the overlap. #202b33 is Blueprint's dark-gray2, the
    // step Stash's own page uses; every dim grey in these dialogs was chosen against it.
    '.enm-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.enm-modal{background:#202b33;color:#f5f8fa;border:1px solid #394b59;border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.enm-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.enm-title{font-size:1.1rem;font-weight:600;}' +
    '.enm-warn{color:#ffb648;margin-top:.35rem;}' +
    '.enm-note{color:#a7b6c2;margin-top:.35rem;}' +
    '.enm-legend{color:#7d8f9c;margin-top:.35rem;font-size:.8rem;}' +
    '.enm-progress{padding:.5rem 1rem;border-bottom:1px solid #394b59;color:#a7b6c2;' +
    'white-space:pre-wrap;}' +
    '.enm-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;font-size:.8rem;' +
    'line-height:1.35;min-height:14rem;}' +
    '.enm-line{white-space:pre-wrap;word-break:break-word;}' +
    '.enm-spin{color:#a7b6c2;}' +
    '.enm-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
    '.enm-ERROR{color:#ff7373;} .enm-WARN{color:#ffb648;} .enm-INFO{color:#a7b6c2;}' +
    '.enm-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.enm-foot button{margin-right:.5rem;}' +
    '.enm-hidden{display:none;}' +
    '.enm-search{padding:.5rem 1rem;border-bottom:1px solid #394b59;position:relative;' +
    'display:flex;gap:.5rem;align-items:center;}' +
    '.enm-label{color:#a7b6c2;font-size:.85rem;white-space:nowrap;}' +
    // `.enm-textbox` rather than `.enm-input`: `CustomFieldsBulkEditor` already defines
    // `.cfbe-input`, and a class name two plugins share has to mean the same thing in
    // both - its box is a filter that flexes with three others beside it, this one is
    // the only control in its row.
    '.enm-textbox{background:#1f2b33;color:#f5f8fa;border:1px solid #394b59;border-radius:3px;' +
    'padding:.25rem .5rem;flex:1 1 12rem;min-width:8rem;}' +
    // A fixed height rather than the shared `max-height` alone: ticking a box changes
    // the counters and the Proceed caption, and a content-sized modal would resize
    // under the pointer between two ticks. The modifier pattern
    // `CustomFieldsBulkEditor` established - a class beside the pinned rule, never an
    // edit to what the other plugins share - and the same 88vh, because two plugins
    // defining `.tall` differently is the drift `style` exists to stop.
    '.enm-modal.enm-tall{height:88vh;}' +
    // ── This dialog's own ───────────────────────────────────────────────────
    //
    // The filter strip wraps: there is one toggle per entity type and one per attribute
    // name, and on a narrow window those are several lines. `.enm-search` is pinned
    // across the plugins, so the wrap is a modifier beside it.
    '.enm-search-wrap{flex-wrap:wrap;}' +
    // The two filter rows are a block of their own rather than more `.enm-search`
    // strips, because they are built and rebuilt as one thing when a scan finishes.
    '.enm-filters{padding:.4rem 1rem;border-bottom:1px solid #394b59;display:flex;' +
    'flex-direction:column;gap:.3rem;}' +
    '.enm-filterrow{display:flex;gap:.35rem;align-items:center;flex-wrap:wrap;}' +
    // The filter toggles are Bootstrap buttons so they take Stash's own hover and focus
    // with them; only the size is ours, and it is small because there can be a dozen.
    // `.enm-filterbtn` rather than `.enm-toggle` for the same reason `.enm-hitrow` is not
    // `.enm-row`: `PropagateTagsAndPerformers` has a `.ptp2re-toggle` and it is a grid
    // cell in a settings table.
    '.enm-filterbtn{font-size:.78rem;padding:.05rem .4rem;}' +
    // One hit per line. `.enm-hitrow` rather than `.enm-row`: `NormalizeParentTags`
    // already has a `.npt-row` and it is a row of its hierarchy tree, which is not this -
    // a class name two plugins share has to mean the same thing in both.
    // The checkbox is the one child that must not shrink when a long context string
    // releases the row's own min-width floor.
    '.enm-hitrow{display:flex;align-items:baseline;gap:.5rem;padding:.1rem .25rem;margin:0;' +
    'cursor:pointer;}' +
    '.enm-hitrow>*{min-width:0;}' +
    '.enm-hitrow input{flex:0 0 auto;}' +
    '.enm-hitrow:hover{background:#3c4f5d;}' +
    '.enm-hitrow-off{color:#7d8f9c;}' +
    '.enm-ent{color:#7cc4ff;text-decoration:none;white-space:nowrap;}' +
    '.enm-ent:hover{text-decoration:underline;}' +
    '.enm-attr{color:#a7b6c2;white-space:nowrap;}' +
    // The context string is the one part of the line that is allowed to be long, so it
    // is the one that takes the remaining room and breaks mid-word if it has to.
    '.enm-ctx{flex:1 1 auto;overflow-wrap:anywhere;word-break:break-word;}' +
    // The occurrence itself, inside its surroundings. Green rather than amber: it marks
    // what is there now, not what is about to change.
    '.enm-mark{background:#3f6b46;border-radius:2px;padding:0 .1rem;}' +
    '.enm-was{color:#7d8f9c;}' +
    '.enm-spacer{flex:1 1 auto;}' +
    '.enm-readme{color:#7cc4ff;font-size:.8rem;margin-top:.35rem;display:inline-block;}' +
    // ── The settings page ───────────────────────────────────────────────────
    //
    // Stash renders the description as one text node in a `.sub-heading` that is
    // `white-space: normal`, and a description cannot carry markup - it is passed to
    // React as a child, so any tag in it is escaped. So the blank lines are made visible
    // by the class, and then rebuilt as divs.
    //
    // Scoped to our own group, never applied to `.sub-heading` at large - another
    // plugin's description is not ours to reflow.
    '.enm-own-group .sub-heading{white-space:pre-wrap;}' +
    '.enm-own-group .sub-heading .enm-p{margin:0 0 .35em;}' +
    '.enm-own-group .sub-heading .enm-p:last-child{margin-bottom:0;}' +
    '.enm-desc-collapsed .enm-p:not(:first-child){display:none;}' +
    '.enm-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
    // The per-setting hover box: a summary on the row, the rest behind a ⓘ that opens
    // from the mark, the summary or the setting's own name. Stash's `title` slot cannot
    // be sized, placed or opened from the keyboard, which is why this exists.
    '.enm-tipped{position:relative;}' +
    '.enm-tip{margin-left:.35rem;cursor:pointer;opacity:.65;font-style:normal;' +
    'font-size:1.05em;}' +
    '.enm-tip:hover,.enm-tip:focus{opacity:1;outline:none;}' +
    // pointer-events:none is load-bearing, not tidiness. Opened from the setting's name
    // the box lands over the h3, so a box that took the pointer would fire mouseleave on
    // the name, close, hand the pointer back and reopen - a flicker loop.
    '.enm-tipbox{display:none;position:absolute;left:0;bottom:calc(100% + .35rem);' +
    'z-index:1500;width:max-content;max-width:100%;padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.enm-tipped.enm-tip-open .enm-tipbox{display:block;}' +
    // ── Colour-coded toggles ────────────────────────────────────────────────
    //
    // Teal for the one setting that only talks to the console, matching every sibling.
    // The two thresholds and the image switch keep Stash's blue: they choose what a
    // scan *covers*, not what anything does on its own, and marking everything would
    // mark nothing.
    //
    // Keyed on the id SettingsPluginsPanel.tsx builds from the plugin id and the setting
    // key, the same anchor `settingElement` uses. Two shapes because the switch is
    // Stash's to render: `::before` is the track of the react-bootstrap Form.Switch it
    // renders today, and `accent-color` covers a plain checkbox if that ever changes.
    '#plugin-EntityNameMaintainer-d1LogToConsole{accent-color:#17a2b8;}' +
    '#plugin-EntityNameMaintainer-d1LogToConsole:checked~.custom-control-label::before' +
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
  function paintButton(btn, variant) {
    btn.className = String(btn.className || '')
      .replace(/\bbtn-(secondary|warning|info|primary|success|light|dark|link)\b/g, '')
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
    return gqlRequest('query ENMPluginVersion { plugins { id version } }', null)
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
  // failing the whole scan query, which is the difference between "your Stash calls it
  // something else" and "nothing in your library mentions that name".
  //
  // Cached for the life of the page: the schema cannot change without a restart, and a
  // rename is exactly when nobody wants to wait for eight round trips.
  var _shapes = null;

  function unwrap(t) {
    // NON_NULL and LIST wrappers carry the real type in `ofType`. Two levels is enough
    // for everything here - `[String!]!` is the deepest shape in the table.
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
        '{ kind name ofType { kind name ofType { kind name } } } } }';
    });
    return gqlRequest('query ENM_Shapes { ' + parts.join(' ') + ' }', null)
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

  // ── Finding the old name in a string ──────────────────────────────────────
  //
  // Case-insensitively, because a name written in prose is written the way the sentence
  // wanted it, and a hit the user can see and untick is better than a miss they cannot.
  // ponytail: plain substring, so a short name matches inside a longer word ("Ann" in
  // "Anna"); the context on every line and the per-line tick are what that relies on.
  // A word-boundary mode is the upgrade if short names turn out to be common.
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

  // Only the occurrences named in `positions` - which is what makes a per-line tick
  // mean anything.
  function replaceAt(text, positions, len, to) {
    var out = '';
    var last = 0;
    positions.forEach(function (p) {
      out += String(text).slice(last, p) + to;
      last = p + len;
    });
    return out + String(text).slice(last);
  }

  // The three pieces a hit line is drawn from. Whitespace is collapsed: a details field
  // is prose with newlines in it, and a log line is one line.
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

  // ── The scan ──────────────────────────────────────────────────────────────
  //
  // One page of one type at a time, so the progress line means something and a stop
  // threshold can end it early. `sort: "id"` so the pages are stable while it runs.
  function pageQuery(spec, shapes) {
    var sel = ['id'];
    shapes.forEach(function (f) { sel.push(f.name); });
    // `extra` holds only the display fields that are *not* in the table above, so
    // nothing is ever selected twice - which GraphQL refuses outright.
    if (spec.extra) sel.push(spec.extra);
    return 'query ENM_Scan($f: FindFilterType) { ' + spec.find + '(filter: $f) { count ' +
      spec.list + ' { ' + sel.join(' ') + ' } } }';
  }

  // Every hit in one entity, in field order and then in occurrence order, which is the
  // order the sequence numbers on the lines are handed out in.
  function scanEntity(spec, shapes, ent, needle, self) {
    var hits = [];
    // The entity that was just renamed is not a mention of its old name in someone
    // else's text, and its own name field is the one field the rename has already
    // settled. Everything *else* on it is still fair game - a performer's details can
    // name them.
    var ownName = self && self.typeKey === spec.key && self.id === String(ent.id)
      ? self.nameField : null;
    var seq = {};
    function add(label, field, kind, slot, source, pos) {
      var n = (seq[label] = (seq[label] || 0) + 1);
      hits.push({
        typeKey: spec.key, entId: String(ent.id), entName: displayName(ent) || '',
        label: label, field: field, kind: kind, slot: slot,
        pos: pos, seq: n, ctx: context(source, pos, needle.length),
      });
    }
    shapes.forEach(function (f) {
      if (f.name === ownName) return;
      var v = ent[f.name];
      if (f.kind === 'string') {
        if (typeof v !== 'string') return;
        occurrences(v, needle).forEach(function (p) {
          add(FIELD_LABEL[f.name] || f.name, f.name, 'string', null, v, p);
        });
        return;
      }
      if (f.kind === 'list') {
        if (!v || !v.length) return;
        v.forEach(function (str, idx) {
          if (typeof str !== 'string') return;
          occurrences(str, needle).forEach(function (p) {
            add(FIELD_LABEL[f.name] || f.name, f.name, 'list', idx, str, p);
          });
        });
        return;
      }
      // The custom-field map: the key is one searchable string and the value is
      // another, and they are two different attribute names because replacing in one
      // renames a field while replacing in the other edits its contents.
      if (!v || typeof v !== 'object') return;
      Object.keys(v).forEach(function (key) {
        occurrences(key, needle).forEach(function (p) {
          add(CF_NAME_LABEL, 'custom_fields', 'cfname', key, key, p);
        });
        // Only strings. A custom field can hold a number or an object, and neither is
        // text a rename has any business rewriting.
        if (typeof v[key] !== 'string') return;
        occurrences(v[key], needle).forEach(function (p) {
          add(CF_VALUE_LABEL, 'custom_fields', 'cfvalue', key, v[key], p);
        });
      });
    });
    // Sequence numbers are per attribute label, and a label with exactly one hit shows
    // none at all - which is what `total` is for.
    var totals = {};
    hits.forEach(function (h) { totals[h.label] = (totals[h.label] || 0) + 1; });
    hits.forEach(function (h) { h.total = totals[h.label]; });
    return hits;
  }

  // This plugin's siblings keep machine-written blocks in ordinary text fields. Rewriting
  // one by substring is how a JSON store stops parsing, so an entity carrying the mark is
  // left out whole and said out loud.
  function isPluginStore(ent) {
    var cf = ent && ent.custom_fields;
    if (!cf || typeof cf !== 'object') return false;
    for (var i = 0; i < CFBE_STORE_FIELDS.length; i++) {
      if (hasOwn(cf, CFBE_STORE_FIELDS[i])) return true;
    }
    return false;
  }

  // ── The dialog ────────────────────────────────────────────────────────────

  var _active = null;

  function openRun(spec, id, oldName, newName, settings) {
    if (_active) { _active.focus(); return; }
    _active = new Run(spec, id, oldName, newName, settings);
    _active.begin();
  }

  function Run(spec, id, oldName, newName, settings) {
    this.spec = spec;
    this.id = String(id);
    this.oldName = oldName;
    this.newName = newName;
    // The entity the rename happened to, so the scan can leave its own name field out
    // of the listing - see `scanEntity`.
    this.origin = { typeKey: spec.key, id: String(id), nameField: spec.nameField };
    this.settings = settings || DEFAULTS;
    this.warnAbove = numSetting(this.settings, 'b1WarnAbove');
    this.stopAbove = numSetting(this.settings, 'c1StopAbove');
    // Every occurrence found, in scan order. `checked` is the user's own answer and is
    // never touched by a filter - see `enabled`.
    this.hits = [];
    // Which entity types and which attribute names the filters are letting through.
    // Both start all-on and are rebuilt from what the scan actually found.
    this.typeOn = {};
    this.attrOn = {};
    // What Proceed wrote, per entity, as the values that were there before it. This is
    // what Undo replays: a delta of exactly the fields this dialog changed.
    this.changes = [];
    this.written = 0;
    this.failed = 0;
    this.skipped = 0;
    this.scanned = 0;
    this.stopped = false;      // the stop threshold ended the scan early
    this.stale = false;
    this.loadingWhat = '';
    // Every line the log holds, as plain text - what Copy log copies. Built beside the
    // nodes rather than read back off them.
    this.logText = [];
    this.state = 'scanning';
    this.build();
  }

  Run.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'enm-backdrop');
    this.modal = el('div', 'enm-modal enm-tall');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'enm-head');
    // A plain block, so a title too long for one line wraps rather than being clipped.
    head.appendChild(el('div', 'enm-title', PLUGIN_SHORT_NAME + ' - ' + this.spec.label +
      ' ' + this.id + ' renamed'));
    this.staleEl = el('div', 'enm-stale enm-hidden', '');
    head.appendChild(this.staleEl);
    head.appendChild(el('div', 'enm-warn',
      'Backing up your database before proceeding is recommended. Undo only reverses what this dialog wrote, ' +
      'while it stays open, and cannot account for changes made elsewhere in the meantime.'));
    var legend = el('div', 'enm-legend');
    legend.appendChild(el('span', null,
      'One line per occurrence: the entity it is in, with its id in brackets, then the ' +
      'attribute - numbered where that attribute holds more than one - then the text ' +
      'around it. Click the entity to open it in a new tab. Untick a line to leave it ' +
      'alone. A filter turned off hides its lines and leaves them alone too, without ' +
      'changing any tick you have already made.'));
    head.appendChild(legend);
    this.noteEl = el('div', 'enm-note', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.progressEl = el('div', 'enm-progress', 'Scanning...');
    this.modal.appendChild(this.progressEl);

    // The two names, shown rather than typed: the rename has already happened and these
    // are what it moved. The new one is editable, because a replacement is not always
    // literally the new name - "Jane Doe" may want to become "Jane" in prose.
    var names = el('div', 'enm-search enm-search-wrap');
    names.appendChild(el('span', 'enm-label', 'Old name'));
    this.oldEl = el('span', null, this.oldName);
    names.appendChild(this.oldEl);
    names.appendChild(el('span', 'enm-label', 'Replace with'));
    this.newInput = el('input', 'enm-textbox');
    this.newInput.type = 'text';
    this.newInput.value = this.newName;
    this.newInput.addEventListener('input', function () { self.syncFooter(); });
    names.appendChild(this.newInput);
    this.modal.appendChild(names);

    this.filtersEl = el('div', 'enm-filters enm-hidden');
    this.typeRow = el('div', 'enm-filterrow');
    this.attrRow = el('div', 'enm-filterrow');
    this.filtersEl.appendChild(this.typeRow);
    this.filtersEl.appendChild(this.attrRow);
    this.modal.appendChild(this.filtersEl);

    this.logEl = el('div', 'enm-log');
    this.modal.appendChild(this.logEl);

    var foot = el('div', 'enm-foot');
    // One button for both halves of the write, which is what the caption slash in the
    // brief says: it is Proceed until something has been written and Undo afterwards.
    // The two never overlap - after a write the listing describes a library this dialog
    // has already changed, so offering Proceed over it would write from a plan the user
    // is no longer looking at.
    this.goBtn = button('Proceed', 'enm-go');
    this.goBtn.className = this.goBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.closeBtn = button('Close', 'enm-close');
    this.copyBtn = button('Copy log', 'enm-copy');
    this.copyBtn.title = 'Copy the counters, the messages and every line of the listing as ' +
      'plain text.';
    this.allOnBtn = button('All On', 'enm-allon enm-filterbtn');
    this.allOffBtn = button('All Off', 'enm-alloff enm-filterbtn');
    [this.allOnBtn, this.allOffBtn].forEach(function (b) {
      b.className = b.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
      b.title = 'Turn every filter above on or off. A filter only decides what is ' +
        'shown and what will be replaced; it never changes a tick.';
    });

    this.goBtn.addEventListener('click', function () { self.go(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });
    this.copyBtn.addEventListener('click', function () { self.copyLog(); });
    this.allOnBtn.addEventListener('click', function () { self.setAllFilters(true); });
    this.allOffBtn.addEventListener('click', function () { self.setAllFilters(false); });

    [this.goBtn, this.closeBtn, this.copyBtn].forEach(function (b) { foot.appendChild(b); });
    foot.appendChild(el('div', 'enm-spacer'));
    foot.appendChild(this.allOnBtn);
    foot.appendChild(this.allOffBtn);
    this.modal.appendChild(foot);

    wireEscape(this);
    document.body.appendChild(this.backdrop);
  };

  Run.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  Run.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*enm-hidden/g, '') + (visible ? '' : ' enm-hidden');
  };

  Run.prototype.showStale = function (msg) {
    this.staleEl.textContent = msg || '';
    this.show(this.staleEl, !!msg);
  };

  Run.prototype.setState = function (state) {
    this.state = state;
    var busy = state === 'writing' || state === 'undoing' || state === 'scanning';
    this.closeBtn.disabled = busy;
    this.copyBtn.disabled = false;
    this.newInput.disabled = state !== 'listing';
    this.syncFilterButtons();
    this.syncFooter();
    this.spin(busy);
  };

  // Proceed until a write has landed, Undo afterwards, and the reason it is disabled
  // said out loud rather than left to be guessed at.
  Run.prototype.syncFooter = function () {
    var undo = this.changes.length > 0;
    this.goBtn.textContent = undo ? 'Undo' : 'Proceed';
    if (undo) {
      this.goBtn.disabled = this.state !== 'listing';
      this.goBtn.title = 'Put back what each field held before Proceed. Only what this ' +
        'dialog wrote, and only while it stays open.';
      return;
    }
    var picked = this.enabledHits().length;
    var to = trim(this.newInput.value);
    var why = this.state !== 'listing' ? 'Still working.'
      : this.stopped ? 'Too many matches to act on safely - see the message above.'
        : this.stale ? 'Reload the page first: this tab is running an older script.'
          : !to ? 'Type what the old name should be replaced with.'
            : !picked ? 'Nothing is ticked and showing.'
              : '';
    this.goBtn.disabled = !!why;
    this.goBtn.title = why || ('Replace ' + plural(picked, 'occurrence') + '.');
  };

  // A cursor cycling under the last line of the log for as long as work is in flight,
  // and gone the moment it is not. It carries no `-line` class, since it is not a
  // message and must not be read back as one.
  Run.prototype.spin = function (on) {
    if (!on) {
      if (this.spinTimer) clearInterval(this.spinTimer);
      this.spinTimer = null;
      if (this.spinEl && this.spinEl.parentNode) this.spinEl.parentNode.removeChild(this.spinEl);
      this.spinEl = null;
      return;
    }
    if (!this.spinEl) {
      this.spinEl = el('div', 'enm-spin', SPIN_FRAMES[0]);
      var self = this, i = 0;
      this.spinTimer = setInterval(function () {
        self.spinEl.textContent = SPIN_FRAMES[++i % SPIN_FRAMES.length];
      }, SPIN_MS);
    }
    this.logEl.appendChild(this.spinEl);
  };

  Run.prototype.msg = function (kind, message) {
    var line = el('div', 'enm-line enm-' + kind);
    line.textContent = '[' + kind + '] ' + message;
    this.logEl.appendChild(line);
    this.logText.push('[' + kind + '] ' + message);
    if (this.spinEl) this.logEl.appendChild(this.spinEl);   // back to the end
    this.scrollLog();
    if (this.settings.d1LogToConsole) enm('[enm] ' + kind + ': ' + message);
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

  Run.prototype.progress = function (text) {
    this.progressEl.textContent = text;
  };

  Run.prototype.begin = function () {
    var self = this;
    this.setState('scanning');
    this.msg('INFO', 'Looking for "' + this.oldName + '" in every text field of every ' +
      'entity, after ' + this.spec.label + ' ' + this.id + ' was renamed to "' +
      this.newName + '".');
    if (this.settings.a1SkipImages) {
      this.msg('INFO', 'Images are left out of this scan: "Skip Images" is on in this ' +
        'plugin\'s settings.');
    }
    this.checkVersion();
    describeFields().then(function (shapes) {
      return self.scan(shapes);
    }).then(function () {
      self.setState('listing');
      self.buildFilters();
      self.renderHits();
      self.summarise();
    }, function (e) {
      self.msg('ERROR', 'The scan failed: ' + (e && e.message ? e.message : String(e)));
      self.setState('listing');
      self.buildFilters();
      self.renderHits();
      self.summarise();
    });
  };

  // One type at a time, one page at a time. The whole point of paging here rather than
  // `per_page: -1` is that the progress line and the stop threshold both need somewhere
  // to stand.
  Run.prototype.scan = function (shapes) {
    var self = this;
    var types = TYPE_ORDER.filter(function (k) {
      return !(k === 'images' && self.settings.a1SkipImages);
    });

    function nextType(i) {
      if (i >= types.length || self.stopped) return Promise.resolve();
      var spec = ENTITIES[types[i]];
      var fields = shapes[types[i]] || [];
      if (!fields.length) {
        self.msg('WARN', 'This Stash has none of the text fields this plugin looks for on ' +
          spec.plural + '; that type is skipped.');
        return nextType(i + 1);
      }
      var query = pageQuery(spec, fields);
      self.loadingWhat = spec.plural;

      function page(p) {
        if (self.stopped) return Promise.resolve();
        return gqlRequest(query, { f: { page: p, per_page: READ_PAGE, sort: 'id', direction: 'ASC' } })
          .then(function (data) {
            var block = data[spec.find] || {};
            var rows = block[spec.list] || [];
            rows.forEach(function (ent) {
              self.scanned++;
              if (isPluginStore(ent)) { self.skipped++; return; }
              var found = scanEntity(spec, fields, ent, self.oldName, self.origin);
              for (var h = 0; h < found.length; h++) self.hits.push(found[h]);
            });
            self.progress(self.progressText());
            if (self.hits.length > self.stopAbove) {
              self.stopped = true;
              return;
            }
            if (rows.length < READ_PAGE) return;
            return page(p + 1);
          });
      }

      return page(1).then(function () { return nextType(i + 1); });
    }

    return nextType(0);
  };

  Run.prototype.progressText = function () {
    var picked = this.state === 'listing' ? this.enabledHits().length : 0;
    return 'Scanned ' + plural(this.scanned, 'entity', 'entities') +
      (this.loadingWhat && this.state === 'scanning' ? ' (' + this.loadingWhat + ')' : '') +
      '  ·  found ' + plural(this.hits.length, 'occurrence') +
      (this.state === 'listing' ? '  ·  ' + picked + ' to replace' : '') +
      (this.written ? '  ·  replaced ' + this.written : '') +
      (this.failed ? '  ·  ' + plural(this.failed, 'failure') : '');
  };

  Run.prototype.summarise = function () {
    this.progress(this.progressText());
    if (this.skipped) {
      this.msg('INFO', 'Left out: ' + plural(this.skipped, 'entity', 'entities') +
        ' carrying another plugin\'s machine-written store. Rewriting text inside one by ' +
        'substring is how its JSON stops parsing.');
    }
    if (this.stopped) {
      this.msg('ERROR', 'Too many matches: the scan stopped after ' +
        plural(this.hits.length, 'occurrence') + ', over the limit of ' + this.stopAbove +
        ' set in this plugin\'s settings. "' + this.oldName + '" is common enough in your ' +
        'library that replacing it wholesale is very unlikely to be what you want. Nothing ' +
        'can be replaced from here; raise the limit in the settings if you disagree.');
      return;
    }
    if (!this.hits.length) {
      this.msg('INFO', 'Nothing else in your library mentions "' + this.oldName +
        '". The rename is complete on its own.');
      return;
    }
    if (this.hits.length > this.warnAbove) {
      this.note('Proceed with caution: ' + plural(this.hits.length, 'occurrence') +
        ' is over the ' + this.warnAbove + ' this plugin\'s settings call worth a second ' +
        'look. A short name matches inside longer words - read the lines before ticking.');
    }
  };

  Run.prototype.checkVersion = function () {
    var self = this;
    installedVersion().then(function (installed) {
      if (!installed || installed === PLUGIN_VERSION) { self.showStale(''); return; }
      self.stale = true;
      var msg = '⚠ This page is running ' + PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION +
        ', but Stash has ' + installed + ' installed. Reload the page (F5) before replacing ' +
        'anything; if this warning comes back, hard-refresh with Ctrl+Shift+R ' +
        '(⌘+Shift+R on a Mac).';
      self.msg('WARN', msg);
      self.showStale(msg);
      self.syncFooter();
    });
  };

  // ── The filters ───────────────────────────────────────────────────────────
  //
  // Only the types and the attribute names the scan actually hit: a toggle for a type
  // with nothing in it is a control that cannot change anything, and a row of them is
  // a row nobody reads.
  //
  // A filter decides what is *shown* and what Proceed *covers*. It never touches a
  // tick, so turning a category off and on again brings back exactly the selection that
  // was there - which is the whole reason it is not simply a bulk tick.
  Run.prototype.buildFilters = function () {
    var self = this;
    this.typeRow.textContent = '';
    this.attrRow.textContent = '';
    var types = [], attrs = [];
    this.hits.forEach(function (h) {
      if (types.indexOf(h.typeKey) === -1) types.push(h.typeKey);
      if (attrs.indexOf(h.label) === -1) attrs.push(h.label);
    });
    if (!types.length) {
      this.show(this.filtersEl, false);
      this.syncFilterButtons();
      return;
    }
    this.show(this.filtersEl, true);
    types.sort(function (a, b) { return TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b); });
    attrs.sort();

    this.typeRow.appendChild(el('span', 'enm-label', 'Entity types'));
    types.forEach(function (k) {
      self.typeOn[k] = true;
      self.typeRow.appendChild(self.toggle(ENTITIES[k].plural, self.typeOn, k));
    });
    this.attrRow.appendChild(el('span', 'enm-label', 'Attributes'));
    attrs.forEach(function (a) {
      self.attrOn[a] = true;
      self.attrRow.appendChild(self.toggle(a, self.attrOn, a));
    });
    this.syncFilterButtons();
  };

  Run.prototype.toggle = function (label, bag, key) {
    var self = this;
    var b = button(label, 'enm-filterbtn');
    b._bag = bag;
    b._key = key;
    paintButton(b, PLUGIN_BTN_VARIANT);
    b.addEventListener('click', function () {
      bag[key] = !bag[key];
      paintButton(b, bag[key] ? PLUGIN_BTN_VARIANT : 'btn-secondary');
      self.syncFilterButtons();
      self.renderHits();
    });
    return b;
  };

  // Disabled where pressing would change nothing: no filters at all, or every one of them
  // already in the state the button would put it in. A scan that found nothing draws no
  // toggles, and a live pair over an empty filter strip is two controls with nothing to
  // act on.
  Run.prototype.syncFilterButtons = function () {
    var toggles = [];
    [this.typeRow, this.attrRow].forEach(function (row) {
      for (var i = 0; i < row.childNodes.length; i++) {
        if (row.childNodes[i]._bag) toggles.push(row.childNodes[i]);
      }
    });
    var busy = this.state !== 'listing';
    var allOn = toggles.every(function (b) { return b._bag[b._key]; });
    var allOff = toggles.every(function (b) { return !b._bag[b._key]; });
    this.allOnBtn.disabled = busy || !toggles.length || allOn;
    this.allOffBtn.disabled = busy || !toggles.length || allOff;
  };

  Run.prototype.setAllFilters = function (on) {
    var self = this;
    var rows = [this.typeRow, this.attrRow];
    rows.forEach(function (row) {
      for (var i = 0; i < row.childNodes.length; i++) {
        var b = row.childNodes[i];
        if (!b._bag) continue;
        b._bag[b._key] = on;
        paintButton(b, on ? PLUGIN_BTN_VARIANT : 'btn-secondary');
      }
    });
    self.syncFilterButtons();
    self.renderHits();
  };

  Run.prototype.visible = function (h) {
    return this.typeOn[h.typeKey] !== false && this.attrOn[h.label] !== false;
  };

  // Ticked *and* showing. The two are deliberately separate: a filter is a scope, a
  // tick is a decision, and one must not silently overwrite the other.
  Run.prototype.enabledHits = function () {
    var self = this;
    return this.hits.filter(function (h) { return h.checked !== false && self.visible(h); });
  };

  // ── The listing ───────────────────────────────────────────────────────────

  Run.prototype.renderHits = function () {
    var self = this;
    if (!this.listEl) {
      this.listEl = el('div', 'enm-hits');
      this.logEl.insertBefore(this.listEl, this.logEl.firstChild);
    }
    this.listEl.textContent = '';
    this.hits.forEach(function (h) {
      if (!self.visible(h)) return;
      self.listEl.appendChild(self.hitRow(h));
    });
    this.progress(this.progressText());
    this.syncFooter();
  };

  Run.prototype.hitRow = function (h) {
    var self = this;
    // A div with a click of its own rather than a `<label>`: the row holds a link to the
    // entity, and a label activates its control from a click anywhere inside it - so
    // opening the entity would silently untick the line on the way out.
    var row = el('div', 'enm-hitrow' + (h.done ? ' enm-hitrow-off' : ''));
    var box = el('input');
    box.type = 'checkbox';
    box.checked = h.checked !== false;
    box.disabled = this.state !== 'listing' || !!h.done;
    function set(on) {
      if (box.disabled) return;
      box.checked = on;
      h.checked = on;
      self.progress(self.progressText());
      self.syncFooter();
    }
    box.addEventListener('change', function () { set(!!box.checked); });
    row.addEventListener('click', function (ev) {
      var t = ev && ev.target;
      if (t === box || (t && t.tagName === 'A')) return;
      set(!box.checked);
    });
    row.appendChild(box);

    var link = el('a', 'enm-ent', (h.entName || '(untitled)') + ' (' + h.entId + ')');
    link.href = ENTITIES[h.typeKey].route + h.entId;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    row.appendChild(link);

    row.appendChild(el('span', 'enm-attr', ENTITIES[h.typeKey].label + ' \u00b7 ' + h.label +
      (h.total > 1 ? ' (' + h.seq + ')' : '') +
      (h.kind === 'cfname' || h.kind === 'cfvalue' ? ' [' + h.slot + ']' : '')));

    var ctx = el('span', 'enm-ctx');
    ctx.appendChild(el('span', null, h.ctx.pre));
    ctx.appendChild(el('span', 'enm-mark', h.ctx.hit));
    ctx.appendChild(el('span', null, h.ctx.post));
    row.appendChild(ctx);
    return row;
  };

  Run.prototype.copyLog = function () {
    var self = this;
    var lines = [this.progressText(), ''];
    this.hits.forEach(function (h) {
      if (!self.visible(h)) return;
      lines.push((h.checked !== false ? '[x] ' : '[ ] ') + ENTITIES[h.typeKey].label + ' ' +
        (h.entName || '(untitled)') + ' (' + h.entId + ') · ' + h.label +
        (h.total > 1 ? ' (' + h.seq + ')' : '') +
        (h.kind === 'cfname' || h.kind === 'cfvalue' ? ' [' + h.slot + ']' : '') + ': ' +
        h.ctx.pre + h.ctx.hit + h.ctx.post);
    });
    lines.push('');
    this.logText.forEach(function (l) { lines.push(l); });
    var was = this.copyBtn.textContent;
    copyToClipboard(lines.join('\n'), function (ok) {
      self.copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { self.copyBtn.textContent = was; }, 2000);
    });
  };

  // ── Writing ───────────────────────────────────────────────────────────────

  Run.prototype.go = function () {
    if (this.changes.length) { this.undo(); return; }
    this.apply();
  };

  // One update per entity, carrying every field that entity has a ticked hit in - so an
  // entity with three changed fields is one write, and the previous values of exactly
  // those three fields are what Undo puts back.
  Run.prototype.plan = function () {
    var to = trim(this.newInput.value);
    var len = this.oldName.length;
    var byEntity = {};
    this.enabledHits().forEach(function (h) {
      if (h.done) return;
      var key = h.typeKey + '/' + h.entId;
      var e = byEntity[key] || (byEntity[key] = {
        typeKey: h.typeKey, entId: h.entId, entName: h.entName, fields: {}, hits: [],
      });
      var f = e.fields[h.field] || (e.fields[h.field] = { kind: h.kind, slots: {} });
      var slot = h.slot == null ? '' : String(h.slot);
      (f.slots[slot] || (f.slots[slot] = { positions: [] })).positions.push(h.pos);
      e.hits.push(h);
    });
    return { to: to, len: len, entities: Object.keys(byEntity).map(function (k) { return byEntity[k]; }) };
  };

  Run.prototype.apply = function () {
    var self = this;
    var p = this.plan();
    if (!p.entities.length) return;
    var other = foreignLease();
    if (other) {
      this.note('Another plugin is applying bulk changes right now (' + other.owner + ' - ' +
        other.label + '). Running both at once means each may undo part of the other.');
    }
    this.setState('writing');
    this.msg('INFO', 'Replacing "' + this.oldName + '" with "' + p.to + '" in ' +
      plural(this.enabledHits().length, 'place') + ' across ' +
      plural(p.entities.length, 'entity', 'entities') + '.');
    var lease = acquireLease('Entity name replacement');
    this.writeAll(p, function (ent) { return self.buildUpdate(p, ent); })
      .then(function () {
        lease.release();
        self.setState('listing');
        self.renderHits();
        self.msg('INFO', 'Done: ' + plural(self.written, 'occurrence') + ' replaced' +
          (self.failed ? ', ' + plural(self.failed, 'entity', 'entities') + ' failed' : '') +
          '. Undo puts them back while this dialog stays open.');
      }, function (e) {
        lease.release();
        self.setState('listing');
        self.renderHits();
        self.msg('ERROR', 'The replacement stopped: ' + (e && e.message ? e.message : String(e)));
      });
  };

  // Re-reads the entity before writing it, rather than editing the copy the scan
  // returned. The scan may be minutes old by the time Proceed is pressed, and a field
  // somebody else has changed in the meantime is one this plugin must not overwrite
  // with a stale string - the occurrence positions are checked against what is there
  // now, and a field that no longer matches is skipped and said out loud.
  Run.prototype.buildUpdate = function (p, ent) {
    var self = this;
    var spec = ENTITIES[ent.typeKey];
    var fields = (_shapes[ent.typeKey] || []).map(function (f) { return f.name; });
    return gqlRequest('query ENM_One($id: ID!) { ' + spec.one + '(id: $id) { id ' +
      fields.join(' ') + ' } }', { id: ent.entId }).then(function (data) {
      var live = data[spec.one];
      if (!live) throw new Error(spec.label + ' ' + ent.entId + ' no longer exists.');
      var input = { id: ent.entId };
      var before = { id: ent.entId };
      var partial = {}, remove = [], oldPartial = {}, oldRemove = [];
      var touched = 0;

      Object.keys(ent.fields).forEach(function (name) {
        var f = ent.fields[name];
        if (f.kind === 'string') {
          var cur = live[name];
          var pos = f.slots[''].positions;
          if (typeof cur !== 'string' || !self.stillThere(cur, pos, p.len)) {
            self.msg('WARN', spec.label + ' ' + ent.entId + ': ' + name + ' has changed ' +
              'since the scan and is left alone.');
            return;
          }
          before[name] = cur;
          input[name] = replaceAt(cur, pos, p.len, p.to);
          touched += pos.length;
          return;
        }
        if (f.kind === 'list') {
          var arr = (live[name] || []).slice();
          var ok = true;
          Object.keys(f.slots).forEach(function (idx) {
            var i = parseInt(idx, 10);
            var s = arr[i];
            if (typeof s !== 'string' || !self.stillThere(s, f.slots[idx].positions, p.len)) {
              ok = false;
              return;
            }
            arr[i] = replaceAt(s, f.slots[idx].positions, p.len, p.to);
            touched += f.slots[idx].positions.length;
          });
          if (!ok) {
            self.msg('WARN', spec.label + ' ' + ent.entId + ': ' + name + ' has changed ' +
              'since the scan and is left alone.');
            return;
          }
          before[name] = (live[name] || []).slice();
          input[name] = arr;
          return;
        }
        // The custom-field map. Structural throughout: a key is moved by writing the new
        // one and removing the old, and a value by writing the key again - so nothing
        // here edits JSON as text and a map cannot come out malformed.
        var cf = live.custom_fields || {};
        Object.keys(f.slots).forEach(function (key) {
          var positions = f.slots[key].positions;
          if (f.kind === 'cfname') {
            if (!hasOwn(cf, key) || !self.stillThere(key, positions, p.len)) return;
            var moved = replaceAt(key, positions, p.len, p.to);
            if (moved === key) return;
            if (hasOwn(cf, moved)) {
              self.msg('WARN', spec.label + ' ' + ent.entId + ': custom field "' + key +
                '" would become "' + moved + '", which it already has. Left alone.');
              return;
            }
            partial[moved] = cf[key];
            remove.push(key);
            oldPartial[key] = cf[key];
            oldRemove.push(moved);
            touched += positions.length;
            return;
          }
          var val = cf[key];
          if (typeof val !== 'string' || !self.stillThere(val, positions, p.len)) return;
          partial[key] = replaceAt(val, positions, p.len, p.to);
          oldPartial[key] = val;
          touched += positions.length;
        });
      });

      if (Object.keys(partial).length || remove.length) {
        input.custom_fields = { partial: partial };
        if (remove.length) input.custom_fields.remove = remove;
        before.custom_fields = { partial: oldPartial };
        if (oldRemove.length) before.custom_fields.remove = oldRemove;
      }
      if (!touched) return null;
      return { spec: spec, input: input, before: before, count: touched, hits: ent.hits };
    });
  };

  // The occurrence positions the scan recorded, checked against the string as it is
  // now. Cheap, exact, and the whole of this plugin's answer to "what if it moved".
  Run.prototype.stillThere = function (text, positions, len) {
    var needle = this.oldName.toLowerCase();
    var s = String(text).toLowerCase();
    for (var i = 0; i < positions.length; i++) {
      if (s.substr(positions[i], len) !== needle) return false;
    }
    return true;
  };

  // Batched so the log and the counters stay live on a long run, and so a failure is one
  // entity rather than the whole plan.
  Run.prototype.writeAll = function (p, build) {
    var self = this;
    var list = p.entities;

    function batch(i) {
      if (i >= list.length) return Promise.resolve();
      var slice = list.slice(i, i + WRITE_CHUNK);
      return Promise.all(slice.map(function (ent) {
        return build(ent).then(function (job) {
          if (!job) return null;
          return gqlRequest('mutation ENM_Write($input: ' + job.spec.updateInput + '!) { ' +
            job.spec.update + '(input: $input) { id } }', { input: job.input })
            .then(function () {
              self.written += job.count;
              self.changes.push({ spec: job.spec, input: job.before });
              job.hits.forEach(function (h) { h.done = true; });
              self.msg('INFO', job.spec.label + ' ' + ent.entId + ' "' +
                (ent.entName || '(untitled)') + '": ' + plural(job.count, 'occurrence') +
                ' replaced.');
              return null;
            });
        }).then(null, function (e) {
          self.failed++;
          self.msg('ERROR', ENTITIES[ent.typeKey].label + ' ' + ent.entId + ': ' +
            (e && e.message ? e.message : String(e)));
          return null;
        });
      })).then(function () {
        self.progress(self.progressText());
        return batch(i + WRITE_CHUNK);
      });
    }

    return batch(0);
  };

  // Replays the recorded previous values, newest first, so an entity written twice ends
  // up holding what it had before the first write.
  Run.prototype.undo = function () {
    var self = this;
    var jobs = this.changes.slice().reverse();
    this.setState('undoing');
    this.msg('INFO', 'Putting back what ' + plural(jobs.length, 'entity', 'entities') +
      ' held before.');
    var lease = acquireLease('Entity name replacement (undo)');
    var undone = 0;
    var failed = 0;

    function step(i) {
      if (i >= jobs.length) return Promise.resolve();
      var job = jobs[i];
      return gqlRequest('mutation ENM_Undo($input: ' + job.spec.updateInput + '!) { ' +
        job.spec.update + '(input: $input) { id } }', { input: job.input })
        .then(function () { undone++; }, function (e) {
          failed++;
          self.msg('ERROR', job.spec.label + ' ' + job.input.id + ': ' +
            (e && e.message ? e.message : String(e)));
        }).then(function () { return step(i + 1); });
    }

    step(0).then(function () {
      lease.release();
      self.changes = [];
      self.written = 0;
      self.hits.forEach(function (h) { h.done = false; });
      self.setState('listing');
      self.renderHits();
      self.msg('INFO', 'Undone: ' + plural(undone, 'entity', 'entities') + ' put back' +
        (failed ? ', ' + plural(failed, 'failure') : '') + '.');
    });
  };

  // ── Escape ────────────────────────────────────────────────────────────────
  //
  // Escape acts through whichever of the footer's exits is actually showing and
  // enabled, never by calling `close()` itself. The footer is the dialog's own statement
  // of what it will let you do right now, so the key can never reach a button that is
  // hidden or disabled - and in particular does nothing mid-write.
  function escapeButton(run) {
    var b = run.closeBtn;
    return b && !b.disabled && !hasClass(b, 'enm-hidden') ? b : null;
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
    unwireEscape(this);
    this.spin(false);
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    _active = null;
  };

  // ── Noticing a rename ─────────────────────────────────────────────────────
  //
  // Stash's edit forms post one `<type>Update` mutation carrying the whole form, name
  // field included - so a rename is not distinguishable from any other save by looking
  // at the request. What distinguishes it is the name the entity had a moment earlier,
  // and the only reliable way to have that is to ask before the write lands: the
  // wrapper reads the current name, *then* passes the request through. One small query
  // in front of a save the user has just pressed, and it is exact where a cache of names
  // seen earlier would be a guess about which page they came from.
  //
  // The wrap is registered on the shared object rather than as a local flag: this file
  // can be evaluated twice - a reload of plugins in a tab that already had it - and a
  // second wrap would double every request.
  // **One wrapper ever, delegating to the newest script that loaded.**
  //
  // A flag that simply says "already wrapped" latches: Stash's Reload plugins re-injects
  // the script into a page that is not reloading, so the new evaluation announces its
  // version in the console, finds the flag set, and installs nothing - leaving the
  // *previous* release's closure in charge of every rename while the banner says otherwise.
  // That is indistinguishable from a plugin that has stopped working, and it is the one
  // failure mode a version banner cannot warn about, because the banner is printed by the
  // half that is not running.
  //
  // So the handler lives on the shared object and the wrapper only forwards to it. The
  // newest evaluation overwrites the handler; nothing installs a second wrapper.
  function installRenameWatch() {
    var ns = window.__GTTx__;
    if (!ns || typeof ns !== 'object') ns = window.__GTTx__ = {};
    ns.enmHandle = handle;
    if (ns.enmFetchWrap || !ORIG_FETCH || !window.fetch) return;
    ns.enmFetchWrap = true;
    var orig = window.fetch.bind(window);
    _ourFetch = window.fetch = function (input, init) {
      var fn = ns.enmHandle;
      return fn ? fn(orig, input, init) : orig(input, init);
    };
  }

  // The wrapper this plugin put on the page, so `status()` can say whether it is still
  // the outermost one - which is normal and harmless when a sibling has wrapped since.
  var _ourFetch = null;

  // The operations in one request. A GraphQL POST is normally one object, but the
  // transport permits an **array** of them - a client that batches sends several
  // operations in one body - and a rename batched with whatever else the page happened to
  // be doing would otherwise go unseen, which from the outside reads as "it works on some
  // of them and not others".
  function operations(init) {
    _stats.fetches++;
    if (!init || typeof init.body !== 'string') {
      // Not an error: most requests a page makes are not this. Worth one line under the
      // debug switch, because `fetch(new Request(...))` carries its body on the request
      // rather than on `init`, and that is where it would show up.
      gateOnce('body', 'a request went past with no readable body on init; if renames are ' +
        'not being noticed at all, this is why.');
      return [];
    }
    _stats.readable++;
    var parsed;
    try { parsed = JSON.parse(init.body); } catch (e) { return []; }
    if (!parsed) return [];
    var ops = Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [parsed];
    if (ops.length && typeof ops[0].query === 'string') _stats.graphql++;
    return ops;
  }

  // The rename this request is about, or null. Deliberately narrow: one of the seven
  // update mutations, an `input` carrying an id, and a name field that is actually
  // present in it. Everything else - a bulk update, a merge, a scrape - is somebody
  // else's business.
  function renameOf(init) {
    var ops = operations(init);
    for (var i = 0; i < ops.length; i++) {
      var hit = renameOfOne(ops[i]);
      if (hit) return hit;
    }
    return null;
  }

  // Names, never values. A diagnostic that printed what the user typed would be one they
  // could not paste into a bug report.
  function keysOf(obj) {
    if (!obj || typeof obj !== 'object') return '';
    var out = [];
    for (var k in obj) if (hasOwn(obj, k)) out.push(k);
    return out.join(', ');
  }

  function renameOfOne(body) {
    if (!body || typeof body.query !== 'string') return null;
    for (var name in BY_MUTATION) {
      if (!hasOwn(BY_MUTATION, name)) continue;
      // The mutation name as it appears in the selection set, not merely anywhere in the
      // document: `sceneUpdate` is a substring of nothing else here, but `groupUpdate`
      // would match a document that only mentions it in a comment.
      if (body.query.indexOf(name + '(') === -1) continue;
      var spec = BY_MUTATION[name];
      var input = (body.variables || {}).input;
      if (!input || input.id == null) {
        // The variable *names* only - never their values, which are the user's data. What
        // this has to distinguish is a client that puts the entity in `variables.input`
        // from one that names it something else or writes it into the query text.
        trace(spec.update + ' posted with no id in variables.input. Variables carried: [' +
          keysOf(body.variables) + '].');
        return null;
      }
      var to = input[spec.nameField];
      if (typeof to !== 'string') {
        trace(spec.update + ' for ' + spec.label + ' ' + input.id + ' carries no ' +
          spec.nameField + '. Input carried: [' + keysOf(input) + '].');
        return null;
      }
      _stats.matched++;
      return { spec: spec, id: String(input.id), to: to };
    }
    return null;
  }

  // Nothing here needs a re-entrancy guard. Every read and write this plugin makes goes
  // through `ORIG_FETCH`, the fetch captured at load - so its own `sceneUpdate` carrying
  // a replaced title never reaches the wrapper below, and cannot be mistaken for a
  // user's rename.

  function currentName(spec, id) {
    return gqlRequest('query ENM_Name($id: ID!) { ' + spec.one + '(id: $id) { id ' +
      spec.nameField + ' } }', { id: id })
      .then(function (data) {
        var e = data[spec.one];
        return e ? e[spec.nameField] : null;
      }, function () { return null; });
  }

  // `held` is the lease that was already being held **when the mutation was posted**, not
  // one sampled now. That distinction is the whole of this function's correctness, and
  // getting it wrong is what made the plugin open a dialog for some renames and not
  // others:
  //
  //   - A **bulk run** the user started elsewhere is holding its lease before the write
  //     goes out. It is renaming many things, and a dialog per rename is the worst
  //     possible answer, so this stands down.
  //   - A **sibling reacting to this very save** - NormalizeParentTags' auto prune or
  //     roll-up, MergePerformerTagsToScenes' auto-merge - takes its lease *after* the
  //     response, in the same instant this would. Sampled here it looked identical to a
  //     bulk run, so the dialog silently never opened; and whether the sibling reacts at
  //     all depends on the entity, which is why it read as a property of the tag.
  function onRename(spec, id, from, to, held) {
    if (_active) {
      trace(spec.label + ' ' + id + ' renamed "' + from + '" to "' + to +
        '", but a dialog is already open; only one at a time.');
      return;
    }
    if (held) {
      trace(spec.label + ' ' + id + ' was renamed while ' + held.owner +
        ' already held a lease (' + held.label + '); standing down.');
      enm('[enm] ' + spec.label + ' ' + id + ' renamed while ' + held.owner +
        ' holds a lease (' + held.label + '); standing down.');
      return;
    }
    trace(spec.label + ' ' + id + ' renamed "' + from + '" to "' + to + '"; opening.');
    loadSettings().then(function (s) {
      openRun(spec, id, from, to, s);
    }, function () { openRun(spec, id, from, to, DEFAULTS); });
  }

  // **Nothing here reads the response body, and that is a decision paid for in the
  // field.** It used to: `resp.clone().json()`, checking for GraphQL errors before
  // reacting. On a page carrying five of these plugins - each with its own `fetch`
  // wrapper, each cloning and reading the same response - that `json()` rejected on a
  // real `tagUpdate`, and the only symptom was a dialog that did not open. The cause was
  // never pinned down, and pinning it down would have bought a fix good until the sixth
  // plugin.
  //
  // So the question "did the write land" is asked of the *server* instead: one more by-id
  // read, and the entity either carries the new name or it does not. That is both cheaper
  // to reason about and strictly more accurate - a mutation can return 200 with errors, or
  // succeed in part, and what this plugin needs to know is whether the old name is now
  // gone.
  //
  // **The general rule: a response body is shared, and a plugin that reads it is one of an
  // unknown number doing so.** Anything that can be re-read from the server should be.
  function handle(orig, input, init) {
    // This plugin's own reads and writes, marked rather than inferred. On a page where the
    // script has been re-evaluated, `ORIG_FETCH` is the delegating wrapper above, so an
    // `ENM_Write` carrying a replaced title would otherwise come back through here and be
    // read as a user's rename. A property on the init object; `fetch` ignores what it does
    // not know.
    if (init && init.__enm) return orig(input, init);
    {
      var rename = renameOf(init);
      if (!rename) return orig(input, init);
      // Sampled here, before the write goes out - see `onRename`.
      var held = foreignLease();
      trace(rename.spec.update + ' for ' + rename.spec.label + ' ' + rename.id +
        ' posts ' + rename.spec.nameField + ' as "' + rename.to + '"' +
        (held ? '; ' + held.owner + ' already holds a lease (' + held.label + ')' : '') + '.');
      var before = null;
      return currentName(rename.spec, rename.id).then(function (was) {
        before = was;
        return orig(input, init);
      }).then(function (resp) {
        // Only after the write is known to have landed, and only if the name actually
        // moved: Stash's edit form posts the name on every save, unchanged or not.
        if (!before) {
          trace(rename.spec.label + ' ' + rename.id + ': its name could not be read ' +
            'before the write, so there is no old name to look for.');
          return resp;
        }
        if (before === rename.to) {
          trace(rename.spec.label + ' ' + rename.id + ': saved as "' + rename.to +
            '", which is what it was already called. Not a rename.');
          return resp;
        }
        if (!resp || !resp.ok) {
          trace(rename.spec.label + ' ' + rename.id + ': the save did not come back as a ' +
            'success (' + (resp ? 'status ' + resp.status : 'no response') + ').');
          return resp;
        }
        // **The response body is deliberately not read.** See the note above `handle`.
        // One more by-id query instead: if the entity is now called what was posted, the
        // rename landed - which is the thing actually being asked, rather than the
        // absence of a GraphQL error in a body five plugins are all cloning at once.
        currentName(rename.spec, rename.id).then(function (now) {
          if (now === rename.to) {
            onRename(rename.spec, rename.id, before, rename.to, held);
            return;
          }
          trace(rename.spec.label + ' ' + rename.id + ': the save came back but it is ' +
            (now == null ? 'no longer readable' : 'still called "' + now + '"') +
            ', so nothing was renamed.');
        });
        return resp;
      });
    }
  }

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // The group gets the siblings' description treatment - a one-line summary, the rest
  // behind **Show more**, and a labelled link to the README under it - and each setting
  // row the per-setting hover box.
  //
  // The `plugin-<id>-<key>` ids Stash builds are ours by construction and are the
  // anchor; the heading is the fallback, because a plugin whose only route in is a
  // heading loses its whole settings page to a rename.
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

  // The group and the description, found from one of our own setting rows where there
  // is one and from our heading otherwise. The description is required to be in the
  // same `.setting` row as the heading: Settings → Tasks heads its group with the
  // plugin name too and gives every task row a `.sub-heading` of its own, so anything
  // looser decorates the wrong panel.
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
        if (sub && heading && headingIsOurs(heading.textContent)) {
          return { group: node, sub: sub, heading: heading };
        }
        break;
      }
    }
    return null;
  }

  // Stash puts the text back on every re-render of this panel, so this runs on every
  // tick and re-splits when it has to. Idempotent: once the children are ours there is
  // no text node left to split.
  function splitDescription(sub) {
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'enm-p')) return;
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;
    var paras = text.split(/\n{2,}/);
    sub.textContent = '';
    paras.forEach(function (para) {
      var t = oneLine(para);
      if (t) sub.appendChild(el('div', 'enm-p', t));
    });
  }

  function descCollapsed(sub) { return hasClass(sub, 'enm-desc-collapsed'); }

  function setDescCollapsed(sub, on) {
    var cls = String(sub.className || '').replace(/\s*enm-desc-collapsed\b/, '');
    sub.className = (on ? cls + ' enm-desc-collapsed' : cls).replace(/^\s+/, '');
  }

  // The toggle is a `<button>` rather than a span: `SettingGroup`'s `onDivClick` walks
  // up from the event target and returns early only for `a` and `button`, so anything
  // else would fold the whole group on click.
  function collapseDescription(sub) {
    var kids = sub.childNodes || [];
    var paras = 0;
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], 'enm-p')) paras++;
    if (paras < 2) return;
    if (document.getElementById(DESC_TOGGLE_ID)) return;
    setDescCollapsed(sub, true);
    var btn = el('button', 'enm-desc-toggle', 'Show more');
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
    var cls = String(sub.className || '').replace(/\s*enm-tip-open\b/, '');
    sub.className = (on ? cls + ' enm-tip-open' : cls).replace(/^\s+/, '');
  }

  // The row is passed rather than the .sub-heading, and the current one looked up per
  // event: an <h3> is Stash's element and survives the re-renders that replace
  // everything we put in the row, so a captured reference would go stale.
  function tipTrigger(node, row) {
    if (!node || node._enmTipWired) return;
    node._enmTipWired = true;
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
    if (kids.length && hasClass(kids[0], 'enm-sum')) return;
    var text = sub.textContent || '';
    var cut = text.indexOf('\n\n');
    if (cut === -1) return;
    var summary = oneLine(text.slice(0, cut));
    var detail = text.slice(cut + 2).split(/\n{2,}/).map(oneLine)
      .filter(function (p) { return !!p; }).join('\n\n');
    if (!summary || !detail) return;
    sub.textContent = '';
    if (!hasClass(sub, 'enm-tipped')) {
      sub.className = ((sub.className || '') + ' enm-tipped').replace(/^\s+/, '');
    }
    var sum = el('span', 'enm-sum', summary);
    sub.appendChild(sum);
    // tabIndex, so the box can be reached and read without a mouse. The box is a sibling
    // of the mark rather than a child: as a child it would sit inside an inline span and
    // inherit its clipping and stacking.
    var mark = el('span', 'enm-tip', TIP_MARK);
    mark.tabIndex = 0;
    sub.appendChild(mark);
    sub.appendChild(el('span', 'enm-tipbox', detail));
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
    var box = el('div', 'enm-stale', '⚠ This page is still running ' +
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
    if (!hasClass(parts.group, 'enm-own-group')) {
      parts.group.className = ((parts.group.className || '') + ' enm-own-group').replace(/^\s+/, '');
    }
    splitDescription(parts.sub);
    collapseDescription(parts.sub);   // after the split: it counts the .enm-p divs
    tipSettings();
    ensureStaleNotice(parts);         // before the early return: the link outlives it
    if (document.getElementById(README_LINK_ID)) return;
    var link = el('a', 'enm-readme', 'EntityNameMaintainer/README.md');
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
  // The settings page is decoration in a panel, not something that has to land before
  // the user can click it, so a timer plus the navigation hooks is enough - there is no
  // MutationObserver here and so nothing to subscribe to the shared bus.
  function tick() {
    try { settingsTick(); } catch (e) { console.error('[enm] settings tick failed', e); }
  }

  if (window.addEventListener) {
    window.addEventListener('load', function () { tick(); });
    window.addEventListener('popstate', function () { setTimeout(tick, 300); });
  }
  setInterval(tick, TICK_MS);
  tick();
  installRenameWatch();

  // The one thing this plugin exposes, for its own test suites: there is no page state
  // a test can drive it through, since the trigger is a mutation someone else posts.
  // Under `__GTTx__` rather than on `window`, like everything else shared here.
  // Everything a "why did nothing happen" report needs, in one line the user can paste:
  // `__GTTx__.enm.status()`. It reads back the trace kept above, so it answers about
  // renames that have *already* been made rather than only about the next one - and the
  // counters answer the question that comes before all the others, which is whether this
  // plugin is seeing the page's requests at all. A zero there means the hook is bypassed
  // and nothing about tags or names is relevant.
  function status() {
    var c = coop();
    var lines = [PLUGIN_NAME + ' ' + PLUGIN_VERSION];
    lines.push('fetch hook: ' + (window.__GTTx__.enmFetchWrap ? 'installed' : 'NOT INSTALLED') +
      (_ourFetch && window.fetch !== _ourFetch
        ? ', another plugin has wrapped since (normal - we are still in the chain)' : '') +
      (window.__GTTx__.enmHandle === handle ? '' : ', but a DIFFERENT evaluation of this ' +
        'script owns the handler'));
    lines.push('requests seen: ' + _stats.fetches + '  ·  with a readable body: ' +
      _stats.readable + '  ·  GraphQL: ' + _stats.graphql + '  ·  renames matched: ' +
      _stats.matched);
    lines.push('dialog open: ' + (_active ? 'yes' : 'no'));
    lines.push('leases held now: ' + (c.leases.map(function (l) {
      return l.owner + ' (' + l.label + ')';
    }).join(', ') || 'none'));
    lines.push(_trace.length ? 'last ' + plural(_trace.length, 'decision') + ', oldest first:'
      : 'no save has looked like a rename yet.');
    _trace.forEach(function (t) { lines.push('  ' + t); });
    var text = lines.join('\n');
    if (typeof console !== 'undefined' && console.log) console.log(text);
    return text;
  }

  window.__GTTx__.enm = {
    occurrences: occurrences,
    replaceAt: replaceAt,
    context: context,
    scanEntity: scanEntity,
    renameOf: renameOf,
    status: status,
    dialog: function () { return _active; },
  };
}());
