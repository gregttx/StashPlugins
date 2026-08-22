// Scene Variants
//
// Requires Stash 0.28.0 or newer: the scene page's `ScenePage.Tabs` and
// `ScenePage.TabContent` patch points are what this plugin is built on.
//
// A scene is often in the library twice: the whole thing, and a cut out of it. Stash
// has no first-class relation for "these two files are the same work", so the Variants
// tab this plugin adds to the scene page is that relation, derived rather than stored:
// the scenes sharing this one's stash-id, with whichever of them is the full-length one
// named as such.
//
// **One word for one idea: variant.** The plan this came from says "sibling set" for the
// relation and "variant" for a member of it, which is a distinction that reads as one in
// prose and as two synonyms in a UI. The plugin is called Scene Variants and the id is the
// contract, so `variant` is the word that survives everywhere - tab, copy, log, CSS.
//
// **Nothing in this file writes to the library.** It reads two queries - the variants and
// the tag tree they are classified against - and draws a list of links. There is no mutation to undo, no lease to take and nothing to stand a
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
  var PLUGIN_VERSION = '0.7.1';

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
  var TAB_KEY = 'scene-svr-variants-panel';
  var TAB_LABEL = 'Variants';
  // The tab this one goes in front of. Edit is last in Stash's strip and is the one tab
  // that is an action rather than a view, so it wants to stay at the end.
  var BEFORE_TAB_KEY = 'scene-edit-panel';

  var SETTINGS_TTL_MS = 10000;   // settings are re-read at most this often

  // The migration task writes, so it takes a lease for the duration - see the repo-root
  // CLAUDE.md. Sized to the work: a library-wide pass over every tagged scene is minutes,
  // and the lease is renewed per batch rather than taken once for all of it.
  var LEASE_TTL_MS = 120000;
  var READ_PAGE  = 500;          // scenes per scan query
  var WRITE_CHUNK = 10;          // scenes written in parallel

  // Stash's own button variant for a control that writes, and the one every plugin here
  // paints its task button with.
  var PLUGIN_BTN_VARIANT = 'btn-warning';

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function trim(text) {
    return String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
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
  // tab - the variants are found from the stash-id, which owes nothing to a tag -
  // and every row simply reads as unclassified. Inventing a default like "Full Length"
  // would name a tag most libraries do not have and then quietly classify nothing,
  // which looks exactly like a broken plugin.
  var DEFAULTS = {
    a1FullLengthTag: '',
    a2PartialLengthTag: '',
    a3VariantStashIdField: '',
    b1LogToConsole: false,
  };

  // ── The variant stash-id custom field ─────────────────────────────────────
  //
  // A stash-id is meant to name the *work*, and a stash-box has one entry for the full
  // scene - so a partial-length cut carrying the same stash-id is claiming to be the
  // thing it was cut out of. The migration task moves that claim into a custom field of
  // this plugin's own and takes the stash-id off, which leaves the identity where the
  // variant lookup can still read it and out of everywhere Stash treats a stash-id as an
  // assertion about the file: scraping, Submit to Stash-box, and duplicate detection.
  //
  // Prefixed like every other name this repo writes into a namespace it shares with the
  // user - a custom field key is flat and unowned, exactly like the description store's
  // marker field. Stash has no default for a plugin setting, so an empty box means this.
  var FIELD_DEFAULT = 'ᱜ╦╦🞮_Variant_Stash_ID';

  function fieldName(s) {
    return trim((s || settings()).a3VariantStashIdField) || FIELD_DEFAULT;
  }

  // `stashdb.org:9f3c1e2a-...`: the provider, then the id. The endpoint is a GraphQL URL
  // and its host is the half a reader recognises - keeping the whole of it would put an
  // `https://` and a `/graphql` in front of every value in Stash's own custom-field
  // panel, which is where this is read by eye.
  function hostOf(endpoint) {
    var t = trim(endpoint).replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    return t.split('/')[0] || t;
  }

  function variantValue(entry) {
    var id = trim(entry && entry.stash_id);
    if (!id) return '';
    var host = hostOf(entry && entry.endpoint);
    return host ? host + ':' + id : id;
  }

  // One line per stash-id, in the order the scene carries them. A scene with ids from two
  // providers is one work with two names for it, and both belong in the field; a value
  // holding one line is the ordinary case and the one the filter matches on exactly.
  function variantValues(stashIds) {
    var out = [], seen = {};
    (stashIds || []).forEach(function (e) {
      var v = variantValue(e);
      if (v && !hasOwn(seen, v)) { seen[v] = true; out.push(v); }
    });
    return out;
  }

  function splitValues(raw) {
    if (raw == null) return [];
    return String(raw).split('\n').map(trim).filter(function (v) { return !!v; });
  }

  function customField(scene, field) {
    var cf = scene && scene.custom_fields;
    return cf && typeof cf === 'object' && hasOwn(cf, field) ? cf[field] : null;
  }

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

  // **Four of the shared mechanisms are correctly left alone, and each absence is a rule
  // rather than an omission:**
  //
  //   no `respecters`    - the flag says "I react to saves and will stand down". This
  //                        plugin reacts to nothing: its one write is a task somebody
  //                        pressed, which is the case §7 of the repo-root rules says is
  //                        never suppressed.
  //   no `declares`      - the registry is for two plugins performing the *identical*
  //                        relationship copy, keyed by a path id. Nothing here copies a
  //                        relationship, so any path id would be a lie.
  //   no `order`         - the ordering protocol is for buttons sharing one of Stash's
  //                        own action rows. This plugin's only button is the one Stash
  //                        renders for its task.
  //   no `domBus`        - the shared MutationObserver is for a control that has to be
  //                        put back into Stash's DOM after every re-render. This plugin
  //                        hands React a component and React renders it, so there is
  //                        nothing to reconcile and nothing to watch for. The settings
  //                        page is decoration, which the one-second timer covers - the
  //                        same position `NormalizeParentTags` is in.
  //
  // The fifth it does take: the migration task rewrites many scenes on purpose, which is
  // exactly what a **lease** announces. It reads `debugButtons` too - the tab is a control
  // drawn into Stash's chrome and "why is it not there" is the same question that flag
  // answers for every sibling.

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
  // ── The tag tree ───────────────────────────────────────────────────────
  //
  // A configured name is matched against every tag's name *and* its aliases, and a scene
  // counts as classified when it carries the matched tag or any descendant of it. Both of
  // those are questions about the whole tag graph rather than about one string, so the
  // graph is what is fetched: one unfiltered `findTags`, cached, rather than a filter
  // query per name whose field spellings would be one more guess about Stash's schema -
  // the kind that cost this plugin two releases already.
  //
  // It also answers the question nothing else could: whether the two names are the same
  // tag, or one an ancestor of the other. That is a contradiction to report rather than
  // resolve - see `conflictNote`.
  var TAGS_QUERY =
    'query SVRTags { findTags(filter: { per_page: -1 }) ' +
    '{ tags { id name aliases parents { id } } } }';

  var TAGS_TTL_MS = 60000;   // the tag tree is re-read at most this often
  var _tagsWait = null, _tagsAt = 0;

  function tagTree() {
    if (!_tagsWait || Date.now() - _tagsAt > TAGS_TTL_MS) {
      _tagsAt = Date.now();
      _tagsWait = gqlRequest(TAGS_QUERY, null).then(function (data) {
        return (((data || {}).findTags) || {}).tags || [];
      }, function (err) {
        // Loud, like the variant query and for the same reason: with no tag tree every
        // row lists unclassified, which is indistinguishable from two tag names that
        // match nothing.
        console.warn('[svr] the tag list could not be read, so no row can be classified: ' +
          err.message);
        return [];
      });
    }
    return _tagsWait;
  }

  // The two configured names resolved against that tree: for each, the tags whose name or
  // any alias matches, and every descendant of those. Matching is by tag **id** from here
  // on - a name is only what starts the search, and a scene's tag is then that tag or it
  // is not.
  function matchers(tags, s) {
    var byId = {}, kids = {};
    tags.forEach(function (t) {
      byId[t.id] = t;
      (t.parents || []).forEach(function (p) {
        (kids[p.id] = kids[p.id] || []).push(t.id);
      });
    });

    function rootsFor(name) {
      var k = tagKey(name);
      if (!k) return [];
      return tags.filter(function (t) {
        if (tagKey(t.name) === k) return true;
        var aliases = t.aliases || [];
        for (var i = 0; i < aliases.length; i++) if (tagKey(aliases[i]) === k) return true;
        return false;
      });
    }

    // Breadth-first with a visited set. A Stash tag hierarchy is a graph rather than a
    // tree - a tag can have several parents - so a diamond or a cycle is a shape to
    // survive rather than one to assume away.
    function withDescendants(roots) {
      var set = {}, queue = roots.map(function (t) { return t.id; }), id, next, i;
      while (queue.length) {
        id = queue.shift();
        if (set[id]) continue;
        set[id] = true;
        next = kids[id] || [];
        for (i = 0; i < next.length; i++) queue.push(next[i]);
      }
      return set;
    }

    var fl = rootsFor(s.a1FullLengthTag), pl = rootsFor(s.a2PartialLengthTag);
    return { byId: byId, flRoots: fl, plRoots: pl,
      fl: withDescendants(fl), pl: withDescendants(pl) };
  }

  // The two values are mutually exclusive by definition, so a configuration where one tag
  // can be both is a contradiction the plugin cannot resolve. Left unsaid it surfaces as
  // every scene under the overlap being flagged red - a scene-level error for a settings
  // mistake, which is the wrong place to go looking. One sentence at the head of the pane
  // instead, and nothing is refused: the rows are still listed.
  //
  // One test covers all three shapes - the same tag under both names, and an ancestor and
  // a descendant either way round - because if the two descendant sets meet at all, the
  // two tags are related.
  function conflictNote(m) {
    if (!m.flRoots.length || !m.plRoots.length) return '';
    var shared = [], id;
    for (id in m.fl) if (hasOwn(m.fl, id) && m.pl[id]) shared.push(id);
    if (!shared.length) return '';
    var name = function (i) { return (m.byId[i] || {}).name || ('tag ' + i); };
    var same = m.flRoots.some(function (a) {
      return m.plRoots.some(function (b) { return b.id === a.id; });
    });
    if (same) {
      return '⚠ Both tag settings name the same tag (' + name(m.flRoots[0].id) +
        '), so every scene carrying it is listed as a contradiction. The full-length and ' +
        'partial-length tags are meant to be mutually exclusive.';
    }
    return '⚠ The full-length tag (' + name(m.flRoots[0].id) + ') and the ' +
      'partial-length tag (' + name(m.plRoots[0].id) + ') are related in the tag ' +
      'hierarchy, so ' + plural(shared.length, 'tag') + ' counts as both: ' +
      shared.map(name).join(', ') + '. The two are meant to be mutually exclusive.';
  }

  // ── Finding the variants ──────────────────────────────────────────────────
  //
  // One query, which is what the plan sketched and what a DOM-injected panel could not
  // have: the tab is handed `props.scene`, a `SceneDataFragment`, and that fragment
  // already carries `stash_ids`. Reading them off the page instead of asking for them is
  // the whole saving - there is nothing to look up before the filter can be written.
  //
  // `stash_ids_endpoint` takes a *list*, so one call covers a scene carrying several
  // ids, and the endpoint is deliberately left out: a variant set that spans two
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
  // Everything the hover delta compares, and nothing else. The list is the price of that
  // feature and is worth reading as one: a field named wrongly here does not lose the
  // delta, it loses the whole query and with it the tab's only answer. All of them are
  // ordinary `Scene` fields on the Stash this plugin already requires, and
  // `groups { group { ... } }` is the shape a sibling plugin runs against a live server.
  //
  // One string for both lookups below, because the two answers are merged into one list:
  // a row has to be the same shape whichever query found it, and two field lists that
  // drifted would show a delta against fields only half the rows carry.
  var SCENE_FIELDS =
    'id title tags { id name } ' +
    'paths { screenshot preview } files { duration width height } ' +
    'code details director date rating100 organized urls ' +
    'studio { id name } performers { id name } groups { group { id name } }';

  var VARIANTS_QUERY =
    'query SVRVariants($ids: [String!]) { findScenes(' +
    'scene_filter: { stash_ids_endpoint: { stash_ids: $ids, modifier: EQUALS } }, ' +
    'filter: { per_page: -1 }) { scenes { ' + SCENE_FIELDS + ' } } }';

  // The other half of the same question, for the scenes whose stash-id has been moved
  // into the custom field - and for the full-length ones carrying both, where either
  // query finds them. `custom_fields` takes a list of criteria and each one a list of
  // values; EQUALS over that list is an OR, the same semantics `stash_ids_endpoint` has
  // above, so one criterion covers a scene with several ids.
  //
  // Its own failure is caught where it is asked rather than here: a Stash that spells
  // this criterion differently must lose the half of the answer it cannot give, not the
  // half it can.
  var BY_FIELD_QUERY =
    'query SVRFieldMatch($field: String!, $values: [Any!]) { findScenes(' +
    'scene_filter: { custom_fields: [{ field: $field, value: $values, modifier: EQUALS }] }, ' +
    'filter: { per_page: -1 }) { scenes { ' + SCENE_FIELDS + ' } } }';

  // What this scene's own custom field holds. `props.scene` is Stash's
  // `SceneDataFragment` and whether it carries `custom_fields` is Stash's to decide, so
  // the field is read off it when it is there and asked for by id when it is not - one
  // query, on the scenes that need it, which after a migration is every partial-length
  // one. A failure reads as "no values", which is what a scene that never had any looks
  // like anyway.
  function ownFieldValues(scene, field, ids) {
    if (scene && scene.custom_fields && typeof scene.custom_fields === 'object') {
      return Promise.resolve(splitValues(customField(scene, field)));
    }
    // Only where the scene has no stash-id of its own, which after a migration is every
    // partial-length one and is the only case where the field says something the
    // stash-ids do not: a scene that still carries them derives the same values from
    // them, and the field a migration wrote holds exactly those. A query per scene page
    // to re-read what is already in hand is the two-round-trip version of a lookup this
    // plugin deliberately does in one.
    if (ids && ids.length) return Promise.resolve([]);
    return gqlRequest('query SVRSceneFields($id: ID!) { findScene(id: $id) ' +
      '{ id custom_fields } }', { id: String(scene && scene.id) })
      .then(function (data) {
        return splitValues(customField((data || {}).findScene, field));
      }, function () { return []; });
  }

  // What a lookup was matched on, in one phrase. Both halves are named where both were
  // used, because "no other scene shares this one's stash-id" is a different fact from
  // "...or its variant stash-id", and a user deciding whether to migrate a scene is
  // exactly the person who needs to know which was asked.
  function matchedOn(ids, own) {
    var parts = [];
    if (ids.length) parts.push(plural(ids.length, 'stash-id'));
    if (own.length) parts.push(plural(own.length, 'variant stash-id'));
    return parts.join(' and ');
  }

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
  function findVariants(scene) {
    var ids = ((scene && scene.stash_ids) || []).map(function (s) { return s.stash_id; })
      .filter(function (v) { return !!v; });
    return Promise.all([settingsReady(), tagTree()]).then(function (both) {
      var m = matchers(both[1], both[0]);
      var field = fieldName(both[0]);
      return ownFieldValues(scene, field, ids).then(function (own) {
        // The scene's own stash-ids expressed the way the field stores them, plus
        // whatever the field already holds. A migrated partial has only the second; a
        // full-length scene that has been through the task has both, and they agree.
        var values = variantValues(scene && scene.stash_ids).concat(own)
          .filter(function (v, i, all) { return all.indexOf(v) === i; });
        if (!ids.length && !values.length) {
          return { rows: [], conflict: conflictNote(m),
            why: 'This scene carries no stash-id and no "' + field + '" custom field, ' +
              'which are the only evidence this plugin uses so far.' };
        }
        return Promise.all([
          ids.length ? gqlRequest(VARIANTS_QUERY, { ids: ids }) : Promise.resolve(null),
          values.length ? gqlRequest(BY_FIELD_QUERY, { field: field, values: values })
            .then(null, function (err) {
              // Half an answer beats none: the stash-id half is still valid, and a
              // criterion this server spells differently is worth one line rather than
              // an empty tab.
              console.warn('[svr] the "' + field + '" custom-field lookup failed for scene ' +
                scene.id + ', so only stash-id matches are listed: ' + err.message);
              return null;
            }) : Promise.resolve(null),
        ]).then(function (answers) {
          var scenes = [], seen = {};
          answers.forEach(function (data) {
            ((((data || {}).findScenes) || {}).scenes || []).forEach(function (o) {
              if (hasOwn(seen, String(o.id))) return;
              seen[String(o.id)] = true;
              scenes.push(o);
            });
          });
          var others = scenes.filter(function (o) { return String(o.id) !== String(scene.id); });
          // The viewed scene as the query returned it - the same fields, selected the same
          // way, which is what the delta compares against. A server that does not agree this
          // scene carries the stash-id leaves it null, and every row then reports no
          // difference rather than reporting a wrong one.
          var self = scenes.filter(function (o) { return String(o.id) === String(scene.id); })[0];
          logToConsole('scene ' + scene.id + ': ' + plural(others.length, 'variant') +
            ' from ' + matchedOn(ids, own));
          return {
            rows: ordered(others, self, m),
            conflict: conflictNote(m),
            why: others.length
              ? 'Matched on ' + matchedOn(ids, own) + '.'
              : 'No other scene shares this one’s ' + matchedOn(ids, own) + '.',
          };
        });
      });
    }).then(null, function (err) {
      // Loud rather than silent: a pane that stays empty because a filter field is
      // named differently on this Stash looks exactly like a scene with no variants,
      // and only one of those is worth reporting.
      console.warn('[svr] variant lookup failed for scene ' + scene.id + ': ' + err.message);
      return { rows: [], why: 'The variant query failed: ' + err.message };
    });
  }
  // ── Classifying a variant ─────────────────────────────────────────────────
  //
  // The dimension is read off a tag, which is the whole of what makes it cheap: the
  // hard half of the problem is "which scenes are the same work", and it is already
  // answered by the time this runs.
  //
  // A scene carrying *both* tags is a real error rather than a tie - the two values are
  // mutually exclusive by definition - so it is shown as one instead of being resolved
  // by whichever test ran first.
  // **The label is the dimension's value, never the tag that carried it.** These shipped
  // echoing the configured tag name back, which is noise twice over: every row in a value
  // shows the same string, and the user picked it, so it says nothing they do not know. It
  // is also whatever they typed - a taxonomy of Unicode-marked namespaces renders as
  // `✨🎥Promo⚠∙` in a column meant to be scanned. The tag is *how* the value was read; the
  // value is what the tab is about. The tag name goes on the row's hover text, where a
  // reader who does want to confirm the match can find it and nobody else has to look at it.
  var ROLES = {
    fl: { label: 'Full-length' },
    pl: { label: 'Partial-length' },
    bad: { label: '⚠ both' },
  };

  // The tag named on the hover text is the one the scene actually carries, which is the
  // whole of what alias and descendant matching cost here: a row matched through a child
  // tag or an alias has to say which, or the hover text is answering "did it match the
  // right tag" with the string the reader typed into the settings.
  function classify(scene, m) {
    var full = null, partial = null;
    (scene.tags || []).forEach(function (t) {
      if (!full && m.fl[t.id]) full = t;
      if (!partial && m.pl[t.id]) partial = t;
    });
    if (full && partial) {
      return { role: 'bad', label: ROLES.bad.label, tags: full.name + ' and ' + partial.name };
    }
    if (full) return { role: 'fl', label: ROLES.fl.label, tags: full.name };
    if (partial) return { role: 'pl', label: ROLES.pl.label, tags: partial.name };
    return { role: 'none', label: '', tags: '' };
  }

  // ── The delta against the scene being viewed ──────────────────────────────
  //
  // What the hover text on a row answers: *how is this one different from the scene I am
  // looking at*. Two halves, and they are deliberately not symmetrical in what they show:
  //
  //   the tags, **by name** - a tag is a short string and the names are the answer;
  //   the attributes, **by name only** - which fields disagree, never how. A title and a
  //     details block are paragraphs, and a tooltip that quoted both sides would be a
  //     diff view nobody asked for. Knowing *that* the dates differ is what sends the
  //     reader to the two pages; which of them is right is a question for those pages.
  //
  // The scene being compared against comes out of the same `findScenes` answer rather than
  // off `props.scene`: the query returns every scene sharing the stash-id, this one
  // included, so both sides of every comparison are the same fields selected by the same
  // query. Reading one side off the props fragment instead would compare Stash's
  // `SceneDataFragment` - whose shape is Stash's to change - against ours, and any field
  // that fragment happens not to carry would read as a difference on every row.
  var ATTRS = [
    { key: 'title', label: 'Title' },
    { key: 'date', label: 'Date' },
    { key: 'studio', label: 'Studio', of: function (v) { return v ? v.name : ''; } },
    { key: 'performers', label: 'Performers', of: joinNames },
    { key: 'groups', label: 'Groups', of: joinNames },
    { key: 'rating100', label: 'Rating' },
    { key: 'code', label: 'Studio code' },
    { key: 'director', label: 'Director' },
    { key: 'details', label: 'Details' },
    { key: 'urls', label: 'URLs', of: joinNames },
    { key: 'organized', label: 'Organized' },
  ];

  // One comparable string for a list of names, whatever the list holds: performers and
  // studios carry a `name`, a scene's groups wrap theirs a level in, and urls are bare
  // strings. **Sorted**, because two scenes holding the same three performers in a
  // different order are not two scenes that disagree about their performers.
  function joinNames(list) {
    return (list || []).map(function (x) {
      if (x && x.name) return String(x.name);
      if (x && x.group && x.group.name) return String(x.group.name);
      return String(x == null ? '' : x);
    }).sort().join(' · ');
  }

  function attrValue(scene, a) {
    var v = scene ? scene[a.key] : null;
    if (a.of) return a.of(v);
    return String(v == null ? '' : v);
  }

  function tagNames(tags) {
    return (tags || []).map(function (t) { return t.name || ('tag ' + t.id); }).sort();
  }

  // Tags are compared by **id** and reported by name - the same split the classification
  // makes, and for the same reason: an id is what identifies a tag and a name is what a
  // reader can act on.
  function tagDelta(self, other) {
    var have = {}, theirs = {};
    (self.tags || []).forEach(function (t) { have[t.id] = true; });
    (other.tags || []).forEach(function (t) { theirs[t.id] = true; });
    return {
      extra: tagNames((other.tags || []).filter(function (t) { return !have[t.id]; })),
      missing: tagNames((self.tags || []).filter(function (t) { return !theirs[t.id]; })),
    };
  }

  // The hover text itself. "Same tags and attributes as this scene." rather than an empty
  // tooltip: a row with nothing to report is an answer - the two are duplicates of each
  // other in everything this plugin can see - and a tooltip that failed to open would read
  // as one that had never been built.
  function deltaText(self, other) {
    if (!self || String(self.id) === String(other.id)) return '';
    var d = tagDelta(self, other), lines = [];
    if (d.extra.length) {
      lines.push('Extra ' + plural(d.extra.length, 'tag') + ': ' + d.extra.join(', '));
    }
    if (d.missing.length) {
      lines.push('Missing ' + plural(d.missing.length, 'tag') + ': ' + d.missing.join(', '));
    }
    var differ = ATTRS.filter(function (a) {
      return attrValue(self, a) !== attrValue(other, a);
    }).map(function (a) { return a.label; });
    if (differ.length) lines.push('Attributes that differ: ' + differ.join(', '));
    return lines.length ? lines.join('\n') : 'Same tags and attributes as this scene.';
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

  function ordered(variants, self, m) {
    return variants.map(function (scene) {
      return { scene: scene, cls: classify(scene, m), delta: deltaText(self, scene) };
    }).sort(function (a, b) {
      var ra = ROLE_RANK[a.cls.role], rb = ROLE_RANK[b.cls.role];
      if (ra !== rb) return ra - rb;
      return ((bestFile(b.scene) || {}).duration || 0) - ((bestFile(a.scene) || {}).duration || 0);
    });
  }
  // ── The migration task ────────────────────────────────────────────────────
  //
  // A stash-id belongs to the *work*, and a stash-box holds one entry for the whole
  // scene - so a partial-length cut wearing the same stash-id is claiming to be the
  // thing it was cut out of, and every part of Stash that treats a stash-id as an
  // assertion about the file believes it. The task moves that claim into this plugin's
  // own custom field and takes the stash-id off the cut.
  //
  // Full-length scenes are written too, and keep their stash-ids. That is not symmetry
  // for its own sake: with the field on both sides the variant lookup is one query over
  // one criterion, where a library half-migrated needs the union of two. Their stash-id
  // is untouched, because on the full-length scene it is true.
  var TASK_NAME = 'Migrate Variant Stash-IDs...';

  // The scan reads only what a plan needs - the tags to classify by, the stash-ids to
  // move, and the field as it stands so an entry already in place is not written again.
  var MIGRATE_QUERY =
    'query SVRMigrateScan($f: FindFilterType, $tags: [ID!]) { findScenes(' +
    'scene_filter: { tags: { value: $tags, modifier: INCLUDES, depth: 0 } }, filter: $f) ' +
    '{ count scenes { id title tags { id } custom_fields ' +
    'stash_ids { endpoint stash_id } } } }';

  // Depth 0 with the descendants already expanded, rather than `depth: -1` over the two
  // configured roots: `matchers` has resolved the names through aliases and the whole
  // hierarchy by the time this runs, and reusing that answer keeps the task classifying
  // scenes by exactly the rule the tab classifies rows by. One filter semantics fewer to
  // be right about, and the two can never disagree.
  function tagIdsFor(m) {
    var out = [], id;
    for (id in m.fl) if (hasOwn(m.fl, id)) out.push(String(id));
    for (id in m.pl) if (hasOwn(m.pl, id) && !m.fl[id]) out.push(String(id));
    return out;
  }

  // What one scene needs doing to it, or null. Three shapes of "nothing to do" and they
  // are deliberately not one: a scene with no stash-id has nothing to move, a scene
  // whose field already says the right thing has nothing to write, and a scene that is
  // neither full nor partial is not this task's business at all.
  function planScene(scene, m, field) {
    var cls = classify(scene, m);
    if (cls.role !== 'fl' && cls.role !== 'pl') return null;
    var values = variantValues(scene.stash_ids);
    if (!values.length) return null;
    var had = customField(scene, field);
    var value = values.join('\n');
    var clear = cls.role === 'pl' && (scene.stash_ids || []).length > 0;
    if (String(had == null ? '' : had) === value && !clear) return null;
    return {
      id: String(scene.id),
      title: scene.title || ('Scene ' + scene.id),
      role: cls.role,
      field: field,
      value: value,
      had: had == null ? null : String(had),
      clear: clear,
      stashIds: (scene.stash_ids || []).map(function (e) {
        return { endpoint: e.endpoint, stash_id: e.stash_id };
      }),
    };
  }

  function writeInput(job) {
    var input = { id: job.id, custom_fields: { partial: {} } };
    input.custom_fields.partial[job.field] = job.value;
    // `stash_ids: []` on the partial only. `partial` is what leaves every other custom
    // field the scene carries alone, which is the whole reason it exists.
    if (job.clear) input.stash_ids = [];
    return input;
  }

  // The exact inverse, built at plan time from what the scene held: the field back to the
  // string it had - or removed, where it had none - and the stash-ids back on the ones
  // they were taken off. `remove` rather than an empty string, because a field set to ""
  // is a field the scene carries, and it did not carry one.
  function undoInput(job) {
    var input = { id: job.id };
    if (job.had == null) {
      input.custom_fields = { remove: [job.field] };
    } else {
      input.custom_fields = { partial: {} };
      input.custom_fields.partial[job.field] = job.had;
    }
    if (job.clear) input.stash_ids = job.stashIds;
    return input;
  }

  var SCENE_UPDATE =
    'mutation SVR_Write($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }';

  // ── The dialog ────────────────────────────────────────────────────────────
  //
  // The shared chrome every plugin here puts up, and the first one in this plugin: a
  // head with the backup sentence and a legend, a monospace log, and a footer whose
  // write button leads. Nothing is written until Proceed, which is the standing rule -
  // the scan is a read, and what it found is on screen before anything moves.
  var _active = null;

  function startRun() {
    if (_active) { _active.focus(); return; }
    _active = new Run();
    _active.begin();
  }

  function Run() {
    this.lines = [];        // the rendered log, kept until the dialog closes
    this.logText = [];      // the same thing as plain text, for Copy log
    this.jobs = [];         // what the scan found to do
    this.changes = [];      // what Proceed wrote, newest last, for Undo
    this.scanned = 0;
    this.total = 0;
    this.written = 0;
    this.failed = 0;
    this.state = 'scanning';
    this.stopped = false;
    this.build();
  }

  Run.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'svr-backdrop');
    this.modal = el('div', 'svr-modal');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'svr-head');
    // A plain block, so a title too long for one line wraps rather than being clipped.
    head.appendChild(el('div', 'svr-title', PLUGIN_SHORT_NAME + ' - Migrate Variant Stash-IDs'));
    this.staleEl = el('div', 'svr-stale svr-hidden', '');
    head.appendChild(this.staleEl);
    head.appendChild(el('div', 'svr-warn',
      'Backing up your database before proceeding is recommended. Undo only reverses what this ' +
      'dialog wrote, while it stays open, and cannot account for changes made elsewhere in the ' +
      'meantime.'));
    this.noteEl = el('div', 'svr-note svr-hidden', '');
    head.appendChild(this.noteEl);
    head.appendChild(el('div', 'svr-legend',
      'One line per scene: whether it is full-length or partial-length, the scene with its id ' +
      'in brackets, and the value its custom field will hold. A partial-length scene also has ' +
      'its stash-ids removed, which is what the migration is for; a full-length one keeps ' +
      'them.'));
    this.modal.appendChild(head);

    this.progressEl = el('div', 'svr-progress', 'Starting…');
    this.modal.appendChild(this.progressEl);

    this.logEl = el('div', 'svr-log');
    this.modal.appendChild(this.logEl);

    var foot = el('div', 'svr-foot');
    // One button for both halves of the write, the shape `EntityNameMaintainer` settled
    // on: Proceed until something has been written and Undo afterwards. The two never
    // overlap, because after a write the listing describes a library this dialog has
    // already changed.
    this.goBtn = button('Proceed', 'svr-go');
    this.goBtn.className = this.goBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.goBtn.disabled = true;
    // Offered while a write runs and never during the scan, which is the split the
    // siblings make too. A scan is a read: Close abandons it outright, so a second
    // control that ends it slowly - after the page in flight, which is hundreds of
    // scenes - would be the worse of the two exits and the one nearer the pointer.
    this.stopBtn = button('Stop', 'svr-stop svr-hidden');
    this.closeBtn = button('Close', 'svr-close');
    this.copyBtn = button('Copy log', 'svr-copy');
    this.copyBtn.title = 'Copy the counters, the messages and every line of the listing as ' +
      'plain text.';
    this.goBtn.addEventListener('click', function () { self.go(); });
    this.stopBtn.addEventListener('click', function () { self.stop(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });
    this.copyBtn.addEventListener('click', function () { self.copyLog(); });
    [this.goBtn, this.stopBtn, this.closeBtn, this.copyBtn].forEach(function (b) { foot.appendChild(b); });
    this.modal.appendChild(foot);

    wireEscape(this);
    document.body.appendChild(this.backdrop);
  };

  Run.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  Run.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*svr-hidden/g, '') + (visible ? '' : ' svr-hidden');
  };

  Run.prototype.note = function (text) {
    this.noteEl.textContent = text || '';
    this.show(this.noteEl, !!text);
  };

  Run.prototype.setState = function (state) {
    this.state = state;
    var busy = state !== 'listing';
    var writing = state === 'writing' || state === 'undoing';
    this.show(this.stopBtn, writing);
    // Closing mid-scan is safe and instant: nothing has been written, so there is
    // nothing to leave half-done, and the paging stops on the next answer. Closing
    // mid-write is the one thing this dialog must not let happen - what it wrote is
    // only undoable while it is open - so there Stop is the only way out.
    this.closeBtn.disabled = writing;
    this.syncFooter();
    this.spin(busy);
  };

  // Proceed until a write has landed, Undo afterwards, and the reason it is disabled said
  // out loud rather than left to be guessed at.
  Run.prototype.syncFooter = function () {
    var undo = this.changes.length > 0;
    this.goBtn.textContent = undo ? 'Undo' : 'Proceed';
    if (undo) {
      this.goBtn.disabled = this.state !== 'listing';
      this.goBtn.title = 'Put back the custom field and the stash-ids of every scene this ' +
        'dialog wrote. Only what it wrote, and only while it stays open.';
      return;
    }
    var why = this.state !== 'listing' ? 'Still working.'
      : this.stale ? 'Reload the page first: this tab is running an older script.'
        : !this.jobs.length ? 'Nothing found to migrate.'
          : '';
    this.goBtn.disabled = !!why;
    this.goBtn.title = why || ('Write ' + plural(this.jobs.length, 'scene') + '.');
  };

  Run.prototype.msg = function (kind, message) {
    var line = el('div', 'svr-line svr-' + kind);
    line.textContent = '[' + kind + '] ' + message;
    this.logEl.appendChild(line);
    this.lines.push(line);
    this.logText.push('[' + kind + '] ' + message);
    if (this.spinEl) this.logEl.appendChild(this.spinEl);   // back to the end
    this.scrollLog();
    if (settings().b1LogToConsole) console.info('[svr] ' + kind + ': ' + message);
  };

  Run.prototype.jobLine = function (job) {
    var text = (job.role === 'fl' ? ROLES.fl.label : ROLES.pl.label) + '  ' +
      job.title + ' [' + job.id + ']  ' + job.field + ' = ' +
      job.value.split('\n').join(' + ') +
      (job.clear ? '  (stash-ids removed)' : '');
    var line = el('div', 'svr-line svr-job svr-role-' + job.role, text);
    this.logEl.appendChild(line);
    this.lines.push(line);
    this.logText.push(text);
    if (this.spinEl) this.logEl.appendChild(this.spinEl);
    this.scrollLog();
  };

  // Coalesced: a scan page appends up to `READ_PAGE` lines in one go, and reading
  // `scrollHeight` after each of them forces a layout per line. That is what a stuttering
  // cursor and a Stop that takes a moment to answer both are - the main thread, not the
  // request. One read per burst says the same thing.
  Run.prototype.scrollLog = function () {
    var self = this;
    if (this.scrollQueued) return;
    this.scrollQueued = true;
    setTimeout(function () {
      self.scrollQueued = false;
      if (self.logEl && typeof self.logEl.scrollTop === 'number') {
        self.logEl.scrollTop = self.logEl.scrollHeight || 0;
      }
    }, 0);
  };

  Run.prototype.progress = function (text) {
    this.progressEl.textContent = text;
  };

  Run.prototype.progressText = function () {
    var parts = ['Scanned ' + this.scanned + (this.total ? ' of ' + this.total : '') +
      ' tagged ' + (this.scanned === 1 && !this.total ? 'scene' : 'scenes')];
    parts.push(plural(this.jobs.length, 'scene') + ' to migrate');
    if (this.written) parts.push(plural(this.written, 'scene') + ' written');
    if (this.failed) parts.push(plural(this.failed, 'failure'));
    return parts.join('. ') + '.';
  };

  // A cursor cycling under the last line of the log for as long as work is in flight, and
  // gone the moment it is not. It carries no `-line` class, since it is not a message and
  // must not be read back as one.
  Run.prototype.spin = function (on) {
    if (!on) {
      if (this.spinTimer) clearInterval(this.spinTimer);
      this.spinTimer = null;
      if (this.spinEl && this.spinEl.parentNode) this.spinEl.parentNode.removeChild(this.spinEl);
      this.spinEl = null;
      return;
    }
    if (this.spinTimer) return;
    var frames = ['▙', '▛', '▜', '▟'], i = 0, self = this;
    this.spinEl = el('div', 'svr-spin', frames[0]);
    this.logEl.appendChild(this.spinEl);
    this.spinTimer = setInterval(function () {
      i = (i + 1) % frames.length;
      if (self.spinEl) self.spinEl.textContent = frames[i];
    }, 500);
  };

  Run.prototype.copyLog = function () {
    var text = [this.progressEl.textContent].concat(this.logText).join('\n');
    var done = function () { };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    }
  };

  Run.prototype.stop = function () {
    if (this.state !== 'writing' && this.state !== 'undoing') return;
    if (this.stopped) return;
    this.stopped = true;
    this.msg('WARN', 'Stopping after the request in flight…');
  };

  Run.prototype.close = function () {
    // What ends a scan: the paging checks this before asking for the next page, so a
    // closed dialog stops reading rather than filling a log nobody can see.
    this.stopped = true;
    unwireEscape(this);
    this.spin(false);
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    _active = null;
  };

  // Escape acts through whichever of the footer's exits is showing and enabled, never by
  // calling `close()` itself. The footer is the dialog's own statement of what it will let
  // you do right now, so the key can never reach a button that is hidden or disabled - and
  // in particular does nothing mid-write.
  function escapeButton(run) {
    var b = run.closeBtn;
    return b && !b.disabled && !hasClass(b, 'svr-hidden') ? b : null;
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

  // ── The scan ──────────────────────────────────────────────────────────────

  Run.prototype.begin = function () {
    var self = this;
    this.setState('scanning');
    this.stopped = false;
    this.progress('Reading your settings and the tag hierarchy…');
    checkStale(this);
    var lease = foreignLease();
    if (lease) {
      // Noted, never stood down for: this run was started by hand, and §7's rule is that
      // a manual action is not suppressed. What it buys the reader is an explanation for
      // a scene that looks a moment out of date.
      this.note('Another plugin is running a bulk edit here (' + lease.label + '), so a ' +
        'scene may be read a moment behind what it holds.');
    }
    Promise.all([settingsReady(), tagTree()]).then(function (both) {
      var s = both[0];
      var m = matchers(both[1], s);
      var field = fieldName(s);
      self.field = field;
      var conflict = conflictNote(m);
      if (conflict) self.msg('WARN', conflict);
      var tags = tagIdsFor(m);
      if (!tags.length) {
        self.setState('listing');
        self.progress('Nothing to scan.');
        self.msg('WARN', 'Neither the full-length nor the partial-length tag setting names ' +
          'a tag in your library, so there is nothing to classify. Name them in this ' +
          'plugin’s settings first.');
        return null;
      }
      self.msg('INFO', 'Looking through every scene tagged full-length or partial-length ' +
        'for a stash-id to move into "' + field + '".');
      return self.scanPage(1, m, field, tags).then(function () {
        self.setState('listing');
        self.progress(self.progressText());
        if (!self.jobs.length) {
          self.msg('INFO', 'Nothing to migrate: every tagged scene either carries no ' +
            'stash-id or has been through this already.');
        }
      });
    }).then(null, function (err) {
      self.setState('listing');
      self.msg('ERROR', 'The scan failed: ' + (err && err.message ? err.message : String(err)));
      self.progress(self.progressText());
    });
  };

  // Paged rather than `per_page: -1`, which is what the rest of this plugin uses: a
  // library-wide scan is the one query here whose answer grows with the library, and the
  // counters are only worth having if they move while it runs.
  Run.prototype.scanPage = function (page, m, field, tags) {
    var self = this;
    return gqlRequest(MIGRATE_QUERY, {
      f: { page: page, per_page: READ_PAGE, sort: 'id', direction: 'ASC' }, tags: tags,
    }).then(function (data) {
      var answer = ((data || {}).findScenes) || {};
      var scenes = answer.scenes || [];
      self.total = answer.count || self.total;
      scenes.forEach(function (scene) {
        self.scanned++;
        var job = planScene(scene, m, field);
        if (!job) return;
        self.jobs.push(job);
        self.jobLine(job);
      });
      self.progress(self.progressText());
      // `stopped` here means the dialog was closed: stop reading.
      if (self.stopped || scenes.length < READ_PAGE) return null;
      return self.scanPage(page + 1, m, field, tags);
    });
  };

  // ── Writing, and taking it back ───────────────────────────────────────────

  Run.prototype.go = function () {
    if (this.changes.length) { this.undo(); return; }
    var self = this;
    this.setState('writing');
    this.stopped = false;
    this.msg('INFO', 'Writing ' + plural(this.jobs.length, 'scene') + '.');
    var lease = acquireLease('Variant stash-id migration');
    this.writeAll(this.jobs, writeInput, 'migrated', lease).then(function () {
      lease.release();
      self.setState('listing');
      self.progress(self.progressText());
      self.msg('INFO', 'Done: ' + plural(self.written, 'scene') + ' migrated' +
        (self.failed ? ', ' + plural(self.failed, 'failure') : '') +
        (self.stopped ? ' (stopped early; what was written stays written, and Undo takes ' +
          'back exactly that)' : '') + '.');
    });
  };

  Run.prototype.undo = function () {
    var self = this;
    var jobs = this.changes.slice().reverse();
    this.setState('undoing');
    this.stopped = false;
    this.msg('INFO', 'Putting back what ' + plural(jobs.length, 'scene') + ' held before.');
    var lease = acquireLease('Variant stash-id migration (undo)');
    this.written = 0;
    this.failed = 0;
    // `changes` is emptied a scene at a time by the write itself rather than upfront, so
    // a stopped or failed reversal still knows what it did not reach. Empty at the end
    // means back to a listing nobody has used, and Proceed offers the same jobs again.
    this.writeAll(jobs, undoInput, 'put back', lease).then(function () {
      lease.release();
      self.setState('listing');
      self.progress(self.progressText());
      self.msg('INFO', 'Undone: ' + plural(self.written, 'scene') + ' put back' +
        (self.failed ? ', ' + plural(self.failed, 'failure') : '') +
        (self.stopped ? ' (stopped early; what was put back stays put back)' : '') + '.');
      self.written = 0;
    });
  };

  // Batched so the log and the counters stay live on a long run, and so a failure is one
  // scene rather than the whole plan. The lease is renewed per batch rather than taken
  // once for the lot: what a crashed tab leaves behind is one batch, not the run.
  Run.prototype.writeAll = function (jobs, build, verb, lease) {
    var self = this;

    function batch(i) {
      if (i >= jobs.length || self.stopped) return Promise.resolve();
      lease.renew();
      var slice = jobs.slice(i, i + WRITE_CHUNK);
      return Promise.all(slice.map(function (job) {
        return gqlRequest(SCENE_UPDATE, { input: build(job) }).then(function () {
          self.written++;
          if (verb === 'migrated') self.changes.push(job);
          else {
            var ix = self.changes.indexOf(job);
            if (ix >= 0) self.changes.splice(ix, 1);
          }
          self.msg('INFO', job.title + ' [' + job.id + ']: ' + verb + '.');
        }, function (e) {
          self.failed++;
          self.msg('ERROR', job.title + ' [' + job.id + ']: ' +
            (e && e.message ? e.message : String(e)));
        });
      })).then(function () {
        self.progress(self.progressText());
        return batch(i + WRITE_CHUNK);
      });
    }

    return batch(0);
  };

  // ── Is this script the one Stash has installed? ───────────────────────────
  //
  // Stash serves plugin JS with caching on, so "Reload plugins" cannot replace a script
  // this page already executed. The settings page has this in its heading; a dialog does
  // not, so it asks - and a stale script is refused the write rather than merely warned
  // about, because what it would write is last release's idea of the plan.
  function checkStale(run) {
    gqlRequest('query SVRPluginVersion { plugins { id version } }', null)
      .then(function (data) {
        var list = (data && data.plugins) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id) === PLUGIN_ID) return list[i].version || null;
        }
        return null;
      }, function () { return null; })
      .then(function (installed) {
        if (!installed || installed === PLUGIN_VERSION) return;
        run.stale = true;
        run.staleEl.textContent = '⚠ This page is still running ' + PLUGIN_SHORT_NAME + ' ' +
          PLUGIN_VERSION + ', but ' + installed + ' is installed. Press Ctrl+Shift+R ' +
          '(⌘+Shift+R on a Mac) and open this again: nothing will be written until you do.';
        run.show(run.staleEl, true);
        run.syncFooter();
      });
  }

  // ── The task button ───────────────────────────────────────────────────────
  //
  // Declared in the yml so Stash renders a button for it in Settings → Tasks, and handled
  // entirely here: the click never reaches the server, because there is no `exec` behind
  // it and nothing server-side to run. A capture-phase listener on `document` runs before
  // React's own handler and stops the propagation, which is what keeps PluginTasks'
  // "added job to queue" toast from appearing over a dialog that is already open.
  //
  // Ours only if the label matches *and* the enclosing SettingGroup is headed with our
  // name - another plugin may declare a task called the same thing.
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
  // carries ours. Amber, because this one writes - the tab and its links are the reading
  // half of this plugin and take no colour from this rule.
  function paintTaskButtons() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('button') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (ownTaskName(nodes[i])) paintButton(nodes[i], PLUGIN_BTN_VARIANT);
    }
  }

  // ── Style ─────────────────────────────────────────────────────────────────

  var CSS =
    // ── The shared dialog chrome ────────────────────────────────────────────
    //
    // Kept literally identical to the sibling plugins' stylesheets wherever the dialogs
    // overlap, down to the hex values. They are separate strings because the plugins
    // share no module, not because they are meant to look different - and two of them
    // did drift, from #202b33 to #30404d, because nothing compared them.
    // `tests/style.test.js` pins the overlap. #202b33 is Blueprint's dark-gray2, the
    // step Stash's own page uses; every dim grey in these dialogs was chosen against it.
    '.svr-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.svr-modal{background:#202b33;color:#f5f8fa;border:1px solid #394b59;border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.svr-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.svr-title{font-size:1.1rem;font-weight:600;}' +
    '.svr-warn{color:#ffb648;margin-top:.35rem;}' +
    '.svr-note{color:#a7b6c2;margin-top:.35rem;}' +
    '.svr-legend{color:#7d8f9c;margin-top:.35rem;font-size:.8rem;}' +
    '.svr-progress{padding:.5rem 1rem;border-bottom:1px solid #394b59;color:#a7b6c2;' +
    'white-space:pre-wrap;}' +
    '.svr-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;font-size:.8rem;' +
    'line-height:1.35;min-height:14rem;}' +
    '.svr-line{white-space:pre-wrap;word-break:break-word;}' +
    '.svr-spin{color:#a7b6c2;}' +
    '.svr-ERROR{color:#ff7373;} .svr-WARN{color:#ffb648;} .svr-INFO{color:#a7b6c2;}' +
    '.svr-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.svr-foot button{margin-right:.5rem;}' +
    '.svr-hidden{display:none;}' +
    // ── This dialog's own ───────────────────────────────────────────────────
    //
    // A planned scene is not a message, so it does not wear one of the three message
    // colours; it wears the row colour the tab already gives that value, which is what
    // makes a listing of two hundred lines scannable by role.
    '.svr-job{margin-left:.5rem;}' +
    // ── The tab itself ──────────────────────────────────────────────────────
    //
    // Amber, so the one tab in the strip that Stash did not put there says so. This is the
    // repo's "a plugin wrote this" colour reaching a surface it had not covered: the rule
    // is written for *buttons*, where amber means the control writes and teal means it
    // only reads, and this plugin only reads. The distinction the split exists to draw
    // has no second member here - there is no other plugin tab to be told apart from this
    // one - while the distinction it is standing in for, Stash's tabs against ours, has
    // nothing else to carry it. See CLAUDE.md for why that is the reading rather than a
    // contradiction of the rule.
    //
    // A colour, not a Bootstrap variant, because a `Nav.Link` has none to borrow - the
    // same position the settings toggles are in. Scoped under `.nav-tabs` (Stash's own
    // class, only ever read here) so it outranks `.nav-tabs .nav-link`, which is where
    // Bootstrap sets the colour this replaces; equal specificity, and this sheet is
    // appended after Stash's, so source order settles it without an `!important`. Hover,
    // focus and the active tab are named because Bootstrap sets each of them separately.
    '.nav-tabs .svr-tab-link,.nav-tabs .svr-tab-link:hover,' +
    '.nav-tabs .svr-tab-link:focus,.nav-tabs .svr-tab-link.active{color:#ffb648;}' +
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
    // The settings contradiction, in the same red the row-level one wears - it is the same
    // fact reported one level up, before it can be mistaken for a fault in the scenes.
    '.svr-conflict{color:#ff7373;margin-bottom:.5rem;}' +
    '.svr-variant{display:flex;align-items:center;gap:.75rem;padding:.35rem .5rem;' +
    'border-radius:3px;}' +
    '.svr-variant:hover{background:#3c4f5d;}' +
    // A fixed 16:9 box, so a row is the same height whatever the cover's aspect is and the
    // list does not step in and out as it scrolls. `object-fit:cover` is what fills it
    // without distorting; a portrait scene is cropped rather than letterboxed, which is
    // what Stash's own cards do with the same content.
    '.svr-thumb-link{flex:0 0 auto;display:block;line-height:0;}' +
    '.svr-thumb{width:10rem;aspect-ratio:16/9;object-fit:cover;background:#0d1317;' +
    'border-radius:3px;display:block;}' +
    // A column: the title, then the facts line under it.
    '.svr-variant-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;' +
    'gap:.15rem;}' +
    '.svr-facts{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap;}' +
    // The floor a flex item keeps by default is the width of its longest word, which a
    // filename-shaped title blows straight through; releasing it is what lets the title
    // wrap instead of pushing the meta column off the row.
    '.svr-variant-title{overflow-wrap:anywhere;}' +
    // One rule for both, so the two things sitting after the title cannot end up at
    // different sizes: they are read together, at a glance, and a half-step between them
    // reads as one of them being an afterthought.
    '.svr-role,.svr-meta{font-size:.85rem;white-space:nowrap;}' +
    '.svr-meta{color:#a7b6c2;}' +
    // Green for the full-length one, because it is the answer the tab exists to give;
    // amber for a partial; red for the scene wearing both tags, which is a contradiction.
    // An untagged scene has no label at all, which is the only quiet state left.
    //
    // The partial was grey to begin with, on the reasoning that it is context rather than
    // an answer. Live use said otherwise, and the reasoning was wrong in a way worth
    // keeping written down: a reader is not looking up one row, they are scanning a short
    // list to see *which is which*, and a value rendered as the same grey as the metadata
    // beside it does not answer that at a glance. Both values are the answer; only the
    // absence of one is context.
    '.svr-role-fl{color:#84d68a;}' +
    '.svr-role-pl{color:#ffb648;}' +
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

  function button(label, className) {
    var b = el('button', 'btn btn-secondary btn-sm' + (className ? ' ' + className : ''), label);
    b.type = 'button';
    return b;
  }

  // Swaps one Bootstrap variant for another in place, so a button can go amber without
  // losing `btn` or `btn-sm`.
  function paintButton(btn, variant) {
    btn.className = String(btn.className || '')
      .replace(/\bbtn-(secondary|warning|info|primary|success|light|dark|link)\b/g, '')
      .replace(/\s+/g, ' ').replace(/^ | $/g, '') + ' ' + variant;
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
  //   * The after-patch is invoked as `afterFn.apply(ctx, args.concat(result))` and must
  //     return the new result. **`args` is what React passed the component, which is not
  //     one argument.** React calls a function component as `Component(props, secondArg)`
  //     where `secondArg` is the legacy context - `emptyContextObject`, `{}`, for any
  //     component that declares no `contextTypes`, which is all of them here. So the
  //     callback is handed `(props, {}, result)`, and a signature reading the result out
  //     of the second position renders that `{}` as a child: React error #31, "Objects
  //     are not valid as a React child (found: object with keys {})". The result is last
  //     by construction, so `safeAppend` searches backwards for the first *element*
  //     rather than indexing at all - being wrong here kills the whole scene page rather
  //     than losing a tab, and neither props nor a context object is ever an element.
  //     The patch list is read when the component *renders*, not when it is defined, so
  //     registering at script load is early enough however late Scene.tsx is imported.
  //   * `props.scene` is a `SceneDataFragment`, which already carries `stash_ids`. That
  //     is what makes the variant lookup one query rather than two: there is nothing to
  //     look up before the filter can be written.
  //   * `activeTabKey` is a plain `useState("scene-details-panel")` with no whitelist, so
  //     a key of our own is selectable exactly like Stash's nine.
  //
  // There is deliberately **no DOM fallback** for a Stash without these patch points. A
  // second implementation of the same tab, injected into the strip by hand, is the kind
  // of duplicate this repo has already decided against paying for elsewhere: it would
  // have to reproduce tab activation, pane switching and every re-render React does for
  // free. A Stash too old gets one console line and no tab.

  // Appending to what a patched component rendered, without being able to break the page
  // it is appending to.
  //
  // The result is the last argument by construction, whatever React put in front of it -
  // but "by construction" is what the two arguments in front of it were also thought to
  // be, and a wrong answer here does not degrade to a missing tab. It takes the whole
  // scene view down with a React error, for a plugin that only reads. So: the result is
  // checked for being an element before anything is appended to it, and building the
  // addition is wrapped, and either way out returns Stash's own render untouched.
  //
  // Untouched is the *only* safe answer. There is nothing else to fall back to - the
  // result is what the container component produced, so passing it through unchanged is
  // exactly the page as it would have been without this plugin.
  // Does this element, or anything inside it, carry `eventKey`? Stash's strip is a list
  // of `Nav.Item`s each wrapping a `Nav.Link`, and the key is on the link - so finding the
  // Edit tab means looking one level in. The same shape the deleted DOM version needed to
  // tell one `.nav-tabs` from another, for the same reason: the key is the only
  // unambiguous mark on that page, and the caption "Edit" is not unique.
  function carriesEventKey(React, node, key) {
    if (!React.isValidElement(node)) return false;
    if (node.props && node.props.eventKey === key) return true;
    var kids = node.props && node.props.children;
    if (kids == null) return false;
    var arr = React.Children.toArray(kids);
    for (var i = 0; i < arr.length; i++) {
      if (carriesEventKey(React, arr[i], key)) return true;
    }
    return false;
  }

  // Rebuilds a container's children with `extra` spliced in ahead of the one carrying
  // `key`. Returns null when there is nothing to splice into or no such child, which is
  // what makes this an *attempt*: the caller appends instead, and a Stash that renames or
  // drops its Edit tab loses the placement rather than the tab.
  //
  // `React.Children.toArray` rather than the raw value, because the raw value is not a
  // list: `props.children` is a single element when there is one child, an array when
  // there are several, and may hold nested arrays, `null`s and the empty strings Stash's
  // conditional tabs render. `toArray` normalises all of that.
  //
  // It also assigns keys, which turns out *not* to matter here and is worth writing down
  // so nobody re-derives it as a reason: React marks a child passed directly to
  // `createElement` as validated, so Stash's key-less static tabs do not start warning
  // when they are moved into an array. `toArray` is the right API for the shape, not a
  // fix for a warning.
  function insertBefore(React, container, extra, key) {
    var kids = container.props && container.props.children;
    if (kids == null) return null;
    var arr = React.Children.toArray(kids);
    for (var i = 0; i < arr.length; i++) {
      if (carriesEventKey(React, arr[i], key)) {
        arr.splice(i, 0, extra);
        return React.createElement(React.Fragment, null, arr);
      }
    }
    return null;
  }

  function safeAppend(React, args, build, beforeKey) {
    var last = args.length ? args[args.length - 1] : null;
    try {
      // Backwards for the first *element*, rather than an index. The result is last
      // today, and the two arguments in front of it were also "obviously" one argument
      // until React's legacy-context object turned up between them. Neither props nor a
      // context object is ever an element, so the search cannot pick the wrong one, and
      // it survives anything else arriving on either side.
      for (var i = args.length - 1; i >= 0; i--) {
        if (React.isValidElement(args[i])) {
          var extra = build();
          var placed = beforeKey ? insertBefore(React, args[i], extra, beforeKey) : null;
          return placed || React.createElement(React.Fragment, null, args[i], extra);
        }
      }
      // Nothing element-shaped at all. There is nothing to append to and nothing better
      // to return than what we were handed, so the page is whatever it would have been.
      gateLogOnce('shape', 'a patched component was called with ' +
        plural(args.length, 'argument') + ' and none of them an element - ' +
        'the Variants tab is not being added.');
      return last;
    } catch (e) {
      console.warn('[svr] the Variants tab could not be built, so it is not being added: ' +
        e.message);
      return last;
    }
  }

  function pluginApi() {
    var api = window.PluginApi;
    return api && api.patch && typeof api.patch.after === 'function' ? api : null;
  }

  // The tab is always present, even on the scenes - most of them, today - with no
  // stash-id and so no possible variant. A tab that came and went as a query landed
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
      React.createElement(Nav.Link, { eventKey: TAB_KEY, className: 'svr-tab-link' }, TAB_LABEL));
  }

  // One row. `row.cls.label` is empty for an unclassified scene and the span is then not
  // rendered at all, rather than rendered blank - an untagged variant is listed as
  // context, and a column of empty marks would read as something missing.
  // The cover, and the preview loop the scene cards play on hover.
  //
  // **A `<video poster>` rather than an image with a video over it.** Stash's own card
  // stacks the two and slides the video in, because a card is a fixed frame it can
  // position inside; one element that shows the cover until it is asked to play needs no
  // stacking context, no transition and no second URL fetched up front - `preload="none"`
  // is what keeps three previews on a page from being three downloads nobody asked for.
  //
  // **And not Stash's `SceneCard`, though `PluginApi.loadableComponents` offers it.** It
  // would bring the cover, the preview, the scrubber and the whole card look for free, and
  // it wants a `SlimSceneDataFragment` to do it - forty-odd fields across five nested
  // fragments, hand-copied into a query here and silently wrong the day Stash's card reads
  // one more. Two path fields against that is not a close call, and a row keeps the
  // dimension column a card has nowhere to put.
  function VariantThumb(React, scene) {
    var paths = scene.paths || {};
    if (!paths.screenshot && !paths.preview) return null;
    if (!paths.preview) {
      return React.createElement('img',
        { key: 'thumb', className: 'svr-thumb', src: paths.screenshot, alt: '', loading: 'lazy' });
    }
    return React.createElement('video', {
      key: 'thumb', className: 'svr-thumb', src: paths.preview, poster: paths.screenshot,
      muted: true, loop: true, playsInline: true, preload: 'none', disableRemotePlayback: true,
      // The promise is caught because a browser rejects `play()` when the pointer crosses
      // a row before the page has been interacted with, and an uncaught rejection in a
      // mouse handler is a console error on every hover.
      onMouseEnter: function (e) {
        var v = e.currentTarget, p = v.play();
        if (p && p.catch) p.catch(function () {});
      },
      // `load()`, not pause-and-rewind. A paused video keeps showing the frame it
      // stopped on, and rewinding it only moves that to frame zero of the *preview* - the
      // poster is painted while the element has no frame at all, and `load()` is what
      // returns it to that state. With `preload="none"` it fetches nothing on the way.
      onMouseLeave: function (e) { e.currentTarget.load(); },
    });
  }

  // Two lines: the title, then everything that describes the file. The value sits at the
  // head of the second line rather than after the title, which is what keeps a column of
  // them scannable - titles vary in length, so a value trailing one starts at a different
  // place on every row, and the eye has to hunt for it.
  function VariantRow(React, row) {
    var facts = [];
    if (row.cls.label) {
      facts.push(React.createElement('span', {
        key: 'role', className: 'svr-role svr-role-' + row.cls.role,
        // The tag that decided it, for whoever wants to confirm the match.
        title: row.cls.tags ? 'Tagged ' + row.cls.tags : null,
      }, row.cls.label));
    }
    var meta = metaOf(row.scene);
    if (meta) facts.push(React.createElement('span', { key: 'meta', className: 'svr-meta' }, meta));
    var line = [React.createElement('a', {
      key: 'title', className: 'svr-variant-title', href: '/scenes/' + row.scene.id,
    }, row.scene.title || ('Scene ' + row.scene.id))];
    if (facts.length) {
      line.push(React.createElement('div', { key: 'facts', className: 'svr-facts' }, facts));
    }
    var thumb = VariantThumb(React, row.scene);
    var kids = [React.createElement('div', { key: 'body', className: 'svr-variant-body' }, line)];
    if (thumb) {
      // The cover links too, and it is its own anchor rather than the whole row being one:
      // the title inside is already a link, and an anchor inside an anchor is invalid
      // markup that browsers resolve by closing the outer one early.
      kids.unshift(React.createElement('a',
        { key: 'thumblink', className: 'svr-thumb-link', href: '/scenes/' + row.scene.id }, thumb));
    }
    // On the row rather than on any one thing in it, so anywhere in the row answers it -
    // and the value span keeps its own title, which is a narrower answer about that span.
    return React.createElement('div',
      { key: row.scene.id, className: 'svr-variant', title: row.delta || null }, kids);
  }

  // `found` is null until the query lands, which is the loading state; after that it is
  // `{ rows, why }` and `why` is a whole sentence, because every one of the empty answers
  // needs one. The effect is keyed on the scene id so that walking the queue re-runs it,
  // and its cleanup drops the answer to a scene the user has already left.
  function VariantsPane(React) {
    return function (props) {
      var scene = (props && props.scene) || {};
      var state = React.useState(null);
      var found = state[0], setFound = state[1];

      React.useEffect(function () {
        var live = true;
        setFound(null);
        findVariants(scene).then(function (result) { if (live) setFound(result); });
        return function () { live = false; };
      }, [scene.id]);

      if (!found) {
        return React.createElement('div', { className: 'svr-tabpane' },
          React.createElement('div', { className: 'svr-empty' }, 'Looking for variants…'));
      }
      var kids = [];
      // Above the summary rather than below it: it is about the settings the whole list
      // was classified with, not about the list.
      if (found.conflict) {
        kids.push(React.createElement('div',
          { key: 'conflict', className: 'svr-conflict' }, found.conflict));
      }
      kids.push(React.createElement('div', { key: 'why', className: 'svr-summary' },
        found.rows.length
          ? plural(found.rows.length, 'other variant') + ' of this scene. ' + found.why
          : found.why));
      found.rows.forEach(function (row) { kids.push(VariantRow(React, row)); });
      return React.createElement('div', { className: 'svr-tabpane' }, kids);
    };
  }

  var _patched = false;

  function installTabs() {
    if (_patched) return true;
    var api = pluginApi();
    if (!api) {
      gateLogOnce('patch', 'PluginApi component patching is unavailable - no Variants tab. ' +
        'This plugin needs Stash 0.28.0 or newer.');
      return false;
    }
    var React = api.React;
    var Bootstrap = (api.libraries || {}).Bootstrap;
    var Nav = Bootstrap && Bootstrap.Nav, Tab = Bootstrap && Bootstrap.Tab;
    if (!React || !Nav || !Tab) {
      gateLogOnce('patch', 'PluginApi is present but React or react-bootstrap is not - ' +
        'no Variants tab.');
      return false;
    }
    var Pane = VariantsPane(React);
    api.patch.after('ScenePage.Tabs', function () {
      return safeAppend(React, arguments,
        function () { return TabLink(React, Nav); }, BEFORE_TAB_KEY);
    });
    api.patch.after('ScenePage.TabContent', function (props) {
      return safeAppend(React, arguments, function () {
        return React.createElement(Tab.Pane, { key: TAB_KEY, eventKey: TAB_KEY },
          React.createElement(Pane, { scene: props.scene }));
      });
    });
    _patched = true;
    gateLogOnce('patch', 'the Variants tab is registered on the scene page');
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
  // The fallback is guarded with `hasOwnTaskButton`, because Settings - Tasks heads *its*
  // group with the same name and decorating it would destroy the task button: the README
  // link picks its slot by structure, and there that slot is inside the button. The
  // guard matches this plugin's own task caption rather than merely testing for a
  // button - Stash puts its own Enable/Disable button in the plugin group's header row,
  // and a plugin here shipped that looser test and decorated nothing at all.
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
      if (hasClass(node, 'setting-group')) return hasOwnTaskButton(node) ? null : node;
    }
    return heading ? heading.parentElement : null;
  }

  function hasOwnTaskButton(node) {
    if (!node) return false;
    if (node.tagName === 'BUTTON' && trim(node.textContent) === TASK_NAME) return true;
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (hasOwnTaskButton(kids[i])) return true;
    }
    return false;
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

  // ── One Reload UI button for every stale plugin ───────────────────────────
  //
  // Byte-identical in every plugin here, like `coopObject` and the dialog CSS, and
  // pinned by `tests/style.test.js` for the same reason: whichever plugin notices a
  // mismatch first draws it, and a copy that had drifted would draw a second one.
  //
  // **Why the banner alone is not enough.** Stash's Reload plugins re-reads the plugin
  // folder on the *server*; the UI builds its list of plugin scripts through
  // `useMemoOnce` and injects the tags once at app boot, so nothing on the page
  // re-fetches them. Reloading the page is the whole fix, and the settings page is
  // where the user already is when they find out they need it - Stash itself puts a
  // Reload UI button beside a plugin it has just enabled, for exactly this reason.
  //
  // Red rather than the repo's amber: it is not one of ours in the sense the colour
  // rule means - it writes nothing and configures nothing - and it has to be told
  // apart from Stash's own button beside it.
  var RELOAD_UI_ID = 'gttx-reload-ui';
  var RELOAD_UI_TIP = '⚠ This page is running a mismatching version of plugin/s ' +
    'installed. Press to solve issue. Every other opened tab on Stash may require a ' +
    'similar UI refresh. Press Ctrl+Shift+R (⌘+Shift+R on a Mac) if you still see ' +
    'this afterward.';

  // One flag per plugin rather than one shared boolean: a plugin that has caught up
  // must be able to say so without clearing a sibling's claim.
  function anyStale() {
    var m = coop().staleUI || {}, k;
    for (k in m) if (Object.prototype.hasOwnProperty.call(m, k) && m[k]) return true;
    return false;
  }

  // Stash's own Reload plugins button, found by *where* it is rather than by its
  // caption, which is translated - the last button in our section that is not inside a
  // plugin's own group. Two shapes have to match: a released Stash puts it in a
  // `.setting` row of its own, and `develop` puts it in a flex row beside a filter box
  // whose clear button is a second button in that row. "Outside any `.setting-group`"
  // is what both have in common, and taking the last one is what keeps the filter box's
  // clear button from winning. Scoping to our own section is what keeps the
  // package-manager sections above it from matching at all.
  function reloadUiAnchor(group) {
    var sec = group;
    while (sec && !hasClass(sec, 'setting-section')) sec = sec.parentNode;
    if (!sec || !sec.querySelectorAll) return null;
    var all = sec.querySelectorAll('button'), i, p, b = null;
    for (i = 0; i < all.length; i++) {
      if (all[i].id === RELOAD_UI_ID) continue;
      for (p = all[i].parentNode; p && p !== sec; p = p.parentNode) {
        if (hasClass(p, 'setting-group')) break;
      }
      if (p === sec) b = all[i];
    }
    return b;
  }

  // Re-added rather than tracked, like everything else this tick puts on the page:
  // React drops it on the next render of the panel.
  function ensureReloadUiButton(group, stale) {
    var c = coop();
    if (!c.staleUI) c.staleUI = {};
    c.staleUI[PLUGIN_ID] = !!stale;
    var node = document.getElementById(RELOAD_UI_ID);
    var anchor = anyStale() ? reloadUiAnchor(group) : null;
    if (!anchor) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    if (node && node.parentNode === anchor.parentNode) return;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-danger';
    b.textContent = 'Reload UI';
    b.id = RELOAD_UI_ID;
    b.title = RELOAD_UI_TIP;
    // `margin-left:auto` rather than a class: the row is `justify-content-between`, so
    // a third child would otherwise sit alone in the middle of it. This puts our
    // button and Stash's together at the right, with the filter box still at the left.
    b.style = 'margin-left:auto;margin-right:.5rem;';
    b.addEventListener('click', function () {
      if (window.location && window.location.reload) window.location.reload();
    });
    anchor.parentNode.insertBefore(b, anchor);
  }

  function ensureStaleNotice(group) {
    var installed = installedFromHeading(group);
    var node = document.getElementById(STALE_ID);
    ensureReloadUiButton(group, !!installed && installed !== PLUGIN_VERSION);
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
    paintTaskButtons();
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

  // The one sentence that documents this plugin's custom field, filed in
  // `CustomFieldsBulkEditor`'s description store so it shows up wherever that plugin
  // shows a field. Feature-detected, never version-checked, and it never overwrites:
  // a description already filed under this name is somebody's writing.
  var FIELD_DESCRIPTION = 'The stash-id of the work this scene is a variant of, as ' +
    '<provider>:<stash-id>, one per line.\n\n' +
    'Written by ' + PLUGIN_NAME + '. A partial-length scene carries this instead of a ' +
    'real stash-id, because a stash-id names the whole work and a cut is not it; a ' +
    'full-length scene carries it as well as one. The Variants tab matches on this ' +
    'field and on stash-ids together, so a scene is found by either.';

  function describeVariantField() {
    var api = coop().api && coop().api.CustomFieldsBulkEditor;
    if (!api || typeof api.describeField !== 'function') return;
    api.describeField(fieldName(), FIELD_DESCRIPTION).then(function (outcome) {
      if (outcome === 'added') {
        svr('[svr] described the custom field "' + fieldName() + '" in ' +
          'CustomFieldsBulkEditor\u2019s description store.');
      } else if (outcome === 'queued') {
        svr('[svr] a description for "' + fieldName() + '" is waiting for ' +
          'CustomFieldsBulkEditor\u2019s description store - open "Manage Custom Field ' +
          'Descriptions..." and press Apply to file it.');
      }
    }, function () { /* a sentence is not worth an error */ });
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
  // Warms the settings cache so the first pane knows the two tag names, and documents
  // the custom field once the configured name is known - the sibling may not have loaded
  // yet at script bottom, and `describeField` is read off the shared object at call time.
  settingsReady().then(describeVariantField, function () {});
  tick();
}());
