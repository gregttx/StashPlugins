// Custom Fields Bulk Editor
//
// Requires Stash 0.31.0 or newer: `custom_fields` on the seven entity types, and
// `CustomFieldsInput` on their update mutations, are what this plugin is built on.
//
// Stash can already store a custom field on a Scene, Image, Gallery, Performer,
// Studio, Group or Tag, and its UI can only edit one record at a time. The API has
// no such limit - five of the seven accept `custom_fields` on their *bulk* mutation,
// and the other two take one single update each - so this plugin adds the one thing
// missing: a view of what a selection actually carries, and one write across it.
//
// It adds a "Custom Fields..." item to the "..." menu of any entity list view while
// something is selected, and does nothing anywhere else. No settings, no tasks, and
// nothing that runs on its own.
//
// The design notes, and the reasoning behind the parts that look arbitrary, are in
// CLAUDE.md next to this file.
(function () {
  'use strict';

  var PLUGIN_ID   = 'CustomFieldsBulkEditor';
  var PLUGIN_NAME = 'GTTx Custom Fields Bulk Editor';
  // The name the dialog head wears. The same string here, because this name already
  // fits in a title that goes on to name an entity type and a count - the constant
  // exists so that every head in the repo reads from one expression, not because
  // every plugin has to shorten. See the repo-root CLAUDE.md, "one name prefix".
  var PLUGIN_SHORT_NAME = 'GTTx Custom Fields Bulk Editor';

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and goes current the moment plugins are reloaded, while the browser can
  // still be running a script it cached before the edit. This constant travels
  // inside the file; bump it with the manifest and the yml, or the `version` suite
  // fails.
  var PLUGIN_VERSION = '1.2.0';

  // Printed before anything else runs, so a script that loads and then throws is told
  // apart from one that never loaded at all. Through whatever the console offers
  // rather than console.info directly: this is the first statement in the file.
  function cfbe(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  cfbe('[cfbe] CustomFieldsBulkEditor.js ' + PLUGIN_VERSION + ' loaded. This is the ' +
    'running script own version - the settings page reads the manifest instead, which can be ' +
    'newer than the script your browser has cached.');

  var README_URL = 'https://github.com/gregttx/StashPlugins/blob/main/CustomFieldsBulkEditor/README.md';
  var STYLE_ID   = 'cfbe-style';
  var README_LINK_ID = 'cfbe-readme-link';
  var DESC_TOGGLE_ID = 'cfbe-desc-toggle';

  // The one control this plugin draws into Stash's own UI, and the button that
  // writes, in amber. Stash's own menu items and row actions are neutral, and these
  // are not the same kind of thing: this one reaches out and rewrites every entity in
  // a selection. See "one colour for a plugin wrote this" in the repo-root CLAUDE.md.
  var PLUGIN_BTN_VARIANT = 'btn-warning';

  var CHUNK_SIZE   = 100;   // entity ids per read alias batch and per bulk mutation
  var READ_PAGE    = 5000;  // entities per page of the task's whole-library read
  var LEASE_TTL_MS = 300000;
  var UNDO_ARM_MS  = 4000;  // how long Undo stays armed for its second click
  var TICK_MS      = 1000;
  var OBSERVE_MS   = 100;   // a burst of DOM mutations coalesced into one tick
  var ROW_WALK_MAX = 8;     // ancestors climbed from a checkbox looking for its row
  var LIST_RENDER_CAP = 1000;  // listing rows put in the DOM; all of them stay in memory
  // The two boxes in the descriptions dialog's right pane say what they are, since one
  // is typed into and the other is read-only and neither is obvious from its contents.
  var DESC_HEAD  = 'Description';
  var USERS_HEAD = 'List of entities';
  var EQ = '🟰';  // the name-value separator, U+1F7F0
  var NONE = '␀';      // "no field here": what an Add starts from, a Delete ends at, U+2400
  var ARROW = ' ⇒ ';

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  // `a1` scopes the *task* only - a selection is exactly what the user picked - and it
  // is off by default, so an install that never opens the settings page behaves as it
  // always did. Stash stores an unset BOOLEAN as absent, which is the same thing as
  // false here.
  //
  // `b1` names the tag that holds the description store (§22) and `c1` the custom field
  // that hides an entity from Stash's add/select dropdowns (§23). A STRING setting the
  // user has cleared arrives as the empty string, which is not the same as never having
  // set it: an empty `c1` is how the dropdown filter is turned off, so the default is
  // only used where the key is absent. An empty `b1` cannot name a tag, so that one
  // falls back to the default either way.
  var DEFAULT_STORE_TAG = 'ᱜ╦╦🞮 🗃️🔌 🛂🧲 🛠🛈🖫 ❌∙';
  var DEFAULTS = {
    a1SkipImagesInTask: false,
    b1DescriptionTagName: DEFAULT_STORE_TAG,
    c1ExcludeFromAddListField: 'Exclude_from_add_list',
  };
  var SKIP_IMAGES_NAME = 'Skip Images in the Whole-Library Task';

  // The custom field the store tag carries so it can be found again after any rename,
  // and the value written into `c1ExcludeFromAddListField` on it. Neither is a setting:
  // the marker is this plugin's own plumbing, and the value is what §23's filter reads
  // as "marked".
  var STORE_FIELD = 'cfbe_desc_store';
  var MARK_VALUE = '1';

  // The sentence above the JSON in the store tag's description. Stash renders that
  // description on the tag's card and detail page, so it opens with something a human
  // can act on; the blob is parsed from the first `{` to the last `}`, which is why the
  // header must not contain a brace.
  var STORE_HEADER = PLUGIN_NAME + ' - custom field descriptions. Managed by the ' +
    'plugin: edit them in Settings - Tasks - "' + 'Manage Custom Field Descriptions...' +
    '". Delete this whole description to reset the store.';

  // "3 changes", "1 change" - the count is always known where it is printed, so the
  // "(s)" these dialogs used to write everywhere was never carrying information. An
  // irregular plural passes its own; everything else takes an "s". Keep this function
  // byte-identical across the plugins, like the CSS.
  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  // ── The seven entity types ────────────────────────────────────────────────
  //
  // Keyed by the plural segment Stash puts in the URL, because that is also how a
  // list view is recognised: `/scenes`, `/performers/12/scenes` and `/tags/9/images`
  // all end in the type they list. `/scenes/markers` ends in `markers`, which is not
  // a key here and so is not a list this plugin offers anything on - SceneMarker is
  // the one selectable entity in Stash with no `custom_fields` field at all, so there
  // is nothing to edit rather than something left undone.
  //
  //   one         the by-id query; every entity in a batch is one alias of it
  //   fields      what `displayName` reads, so the list can name the entity
  //   route       matches this type's own detail link, which is how a selected card
  //               is turned back into an id
  //   bulk        the mutation that takes `ids` and one `custom_fields` delta.
  //               Absent for Studio and Tag: `BulkStudioUpdateInput` and
  //               `BulkTagUpdateInput` carry no `custom_fields` field, so those two
  //               are written one at a time through `single` instead. That is a
  //               schema fact, not a scoping decision - do not "add the missing bulk".
  var ENTITIES = {
    scenes: {
      key: 'scenes', label: 'Scene', plural: 'Scenes',
      one: 'findScene', fields: 'title files { basename }',
      route: /^\/scenes\/(\d+)(?:[/?#]|$)/,
      bulk: 'bulkSceneUpdate', bulkInput: 'BulkSceneUpdateInput',
      single: 'sceneUpdate', singleInput: 'SceneUpdateInput',
    },
    images: {
      key: 'images', label: 'Image', plural: 'Images',
      one: 'findImage',
      fields: 'title visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }',
      route: /^\/images\/(\d+)(?:[/?#]|$)/,
      bulk: 'bulkImageUpdate', bulkInput: 'BulkImageUpdateInput',
      single: 'imageUpdate', singleInput: 'ImageUpdateInput',
    },
    galleries: {
      key: 'galleries', label: 'Gallery', plural: 'Galleries',
      one: 'findGallery', fields: 'title files { basename } folder { basename }',
      route: /^\/galleries\/(\d+)(?:[/?#]|$)/,
      bulk: 'bulkGalleryUpdate', bulkInput: 'BulkGalleryUpdateInput',
      single: 'galleryUpdate', singleInput: 'GalleryUpdateInput',
    },
    performers: {
      key: 'performers', label: 'Performer', plural: 'Performers',
      one: 'findPerformer', fields: 'name',
      route: /^\/performers\/(\d+)(?:[/?#]|$)/,
      bulk: 'bulkPerformerUpdate', bulkInput: 'BulkPerformerUpdateInput',
      single: 'performerUpdate', singleInput: 'PerformerUpdateInput',
    },
    groups: {
      key: 'groups', label: 'Group', plural: 'Groups',
      one: 'findGroup', fields: 'name',
      route: /^\/groups\/(\d+)(?:[/?#]|$)/,
      bulk: 'bulkGroupUpdate', bulkInput: 'BulkGroupUpdateInput',
      single: 'groupUpdate', singleInput: 'GroupUpdateInput',
    },
    studios: {
      key: 'studios', label: 'Studio', plural: 'Studios',
      one: 'findStudio', fields: 'name',
      route: /^\/studios\/(\d+)(?:[/?#]|$)/,
      bulk: null, bulkInput: null,
      single: 'studioUpdate', singleInput: 'StudioUpdateInput',
    },
    tags: {
      key: 'tags', label: 'Tag', plural: 'Tags',
      one: 'findTag', fields: 'name',
      route: /^\/tags\/(\d+)(?:[/?#]|$)/,
      bulk: null, bulkInput: null,
      single: 'tagUpdate', singleInput: 'TagUpdateInput',
    },
  };

  // The filter argument each `find<Plural>` query takes, for the two queries that ask
  // "which entities carry this custom field" rather than "give me everything". A table
  // rather than a rule because six of the seven are the singular of the key and
  // `galleries` is not - `gallery_filter`, not `gallerie_filter`. Read off
  // stashapp/stash `develop` (schema.graphql), 2026-08-16; every one of the seven
  // filter types carries `custom_fields: [CustomFieldCriterionInput!]`.
  var FILTER_ARG = {
    scenes: 'scene_filter', images: 'image_filter', galleries: 'gallery_filter',
    performers: 'performer_filter', groups: 'group_filter', studios: 'studio_filter',
    tags: 'tag_filter',
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

  // This plugin is bulk-only: it never watches `window.fetch` and never reacts to a
  // save, so it registers no `respecters` entry - claiming to honour leases while
  // having nothing to stand down would be a lie a sibling's dialog would repeat to
  // the user. It has no relationship-copy paths, so it declares nothing either, and
  // it puts no button in an entity's action row, so it takes no `order` priority.
  // `coop()` still creates all four fields, for shape-consistency with its siblings.

  // Off unless `__GTTx__.StashPluginCoop.debugButtons = true`, typed into the browser
  // console: no setting, no reload, and read at call time so it takes effect on the
  // next tick. The shared switch rather than one of our own, because the question it
  // answers - "why is this control not there" - is rarely about a single plugin.
  //
  // Deduplicated per channel: the tick runs every second and on every DOM mutation
  // burst, so an undeduplicated line would emit forever on a page nobody is touching.
  // What is worth seeing is the moment an outcome changes. Turning the flag off
  // clears the channels, so switching it back on restates the current position.
  var _gateLast = {};
  function gateLogOnce(channel, line) {
    if (!coop().debugButtons) { _gateLast = {}; return; }
    if (_gateLast[channel] === line) return;
    _gateLast[channel] = line;
    console.info('[cfbe gate] ' + line);
  }

  // A bulk run announces itself for the duration of its writes, so a reactive plugin
  // in the same tab stands down rather than reacting to every entity we touch.
  // Advisory, always expiring, per tab - see the repo-root CLAUDE.md.
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
  // plugin's settings arrive in the same response - which is what the sibling plugins'
  // cross-checks read, for free. Nothing here needs them yet.
  function loadSettings() {
    return gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
      var s = {};
      for (var k in DEFAULTS) {
        if (!hasOwn(DEFAULTS, k)) continue;
        // A cleared STRING setting is the empty string, and that is a *choice* - it is
        // how the dropdown filter is switched off. So the default applies only where
        // the key is absent, never where the user has emptied it.
        s[k] = typeof DEFAULTS[k] === 'boolean' ? !!raw[k] : effective(raw, k);
      }
      // Except this one: the empty string cannot name a tag, so it means the same as
      // never having set it.
      if (!s.b1DescriptionTagName) s.b1DescriptionTagName = DEFAULT_STORE_TAG;
      seedDefaults(raw);
      return s;
    });
  }

  // Stash's plugin settings have no `default:` in the manifest - the panel shows
  // whatever is in `config.yml`, which is nothing at all until the user types in the
  // box. So a STRING setting reads as empty while the plugin is quietly using its
  // default, and the two states a blank box can mean - "never set" and "deliberately
  // cleared", which are *not* the same thing here - look identical.
  //
  // Writing the defaults in once settles both: the box shows the name it is actually
  // using, and clearing it becomes a visible choice. Only keys that are absent are
  // seeded, so this can never overwrite an answer the user has given, and the whole
  // map goes back because `configurePlugin` replaces it rather than merging.
  // Silent on failure: a settings write nobody asked for must not put an error in
  // front of someone who came here to look at custom fields.
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
    gqlRequest('mutation CFBE_SeedSettings($id: ID!, $input: Map!) ' +
      '{ configurePlugin(plugin_id: $id, input: $input) }',
    { id: PLUGIN_ID, input: input }).then(null, function () { _seeded = false; });
  }

  // The effective value of one setting, out of the raw map: the same "absent means the
  // default, empty means cleared" rule `loadSettings` reads by, so the two can never
  // disagree about what the plugin is actually using.
  function effective(raw, key) {
    return hasOwn(raw, key) && raw[key] != null ? String(raw[key]) : DEFAULTS[key];
  }

  // ── The description store ─────────────────────────────────────────────────
  //
  // One tag holds every custom field's description, in its own `description` string
  // rather than in its `custom_fields` map. The map was the obvious place and it is
  // taken: the same tag has to carry the marker below, and `Exclude_from_add_list`,
  // and each of those would be indistinguishable from a description entry keyed on the
  // same name. The description is a `text` column (migration 36 of stashapp/stash), so
  // there is no length to design around, and one `tagUpdate` writes the whole store
  // atomically - version, field list and all.
  //
  // A human sentence first, because Stash renders this description on the tag's card
  // and detail page; the blob is everything from the first `{` to the last `}`.
  function parseStore(text) {
    var s = String(text == null ? '' : text);
    var empty = { version: null, hideField: '', descriptions: {} };
    // A blank description is an empty store - that is what deleting it by hand does,
    // and it is the documented way to reset. Anything else has to parse: text that
    // does not is somebody's writing, and writing over it is the one move here with no
    // way back. A `{` with no `}` after it took a round to get right, because reading
    // "no blob found" off it treats a mangled store as an empty one.
    if (!s.replace(/^\s+|\s+$/g, '')) return empty;
    var open = s.indexOf('{');
    var close = s.lastIndexOf('}');
    if (open === -1 || close < open) {
      return { broken: true, version: null, hideField: '', descriptions: {} };
    }
    try {
      var blob = JSON.parse(s.slice(open, close + 1));
      return {
        version: blob.version || null,
        hideField: blob.hideField || '',
        descriptions: (blob.descriptions && typeof blob.descriptions === 'object')
          ? blob.descriptions : {},
      };
    } catch (e) {
      // Deliberately not "assume empty": a description somebody hand-edited into
      // invalid JSON may still hold every description they ever wrote, and writing over
      // it would be the one unrecoverable move here.
      return { broken: true, version: null, hideField: '', descriptions: {} };
    }
  }

  function serialiseStore(store) {
    return STORE_HEADER + '\n\n' + JSON.stringify({
      version: PLUGIN_VERSION,
      hideField: store.hideField || '',
      descriptions: store.descriptions || {},
    });
  }

  // Numeric, part by part, so "0.10.0" is newer than "0.9.0" - which a string compare
  // gets backwards, and which this plugin will reach.
  function cmpVersion(a, b) {
    var x = String(a || '').split('.');
    var y = String(b || '').split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  // Found by its marker custom field, never by its name: the name is a setting the user
  // is invited to change, and a store that could be lost by renaming it would be a
  // store nobody should keep anything in. Two marked tags is a state nothing here
  // creates, so it is resolved rather than refused - the one whose name matches the
  // setting, else the lowest id - and the dialog says which it took.
  function findStoreTag(settings) {
    return gqlRequest('query CFBE_Store($f: TagFilterType) { findTags(filter: { per_page: -1 }, ' +
      'tag_filter: $f) { tags { id name description custom_fields } } }',
    { f: { custom_fields: [{ field: STORE_FIELD, modifier: 'NOT_NULL' }] } })
      .then(function (data) {
        var tags = ((data && data.findTags) || {}).tags || [];
        if (!tags.length) return null;
        var wanted = settings.b1DescriptionTagName;
        for (var i = 0; i < tags.length; i++) {
          if (String(tags[i].name) === wanted) return tags[i];
        }
        return tags.slice().sort(function (a, b) {
          return (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);
        })[0];
      });
  }

  // Read once per dialog and cached for the page, because the tooltips in the bulk
  // dialog want it too and it is one small query either way. `_storeTagId` is what
  // keeps the store tag out of the listings that would otherwise show this plugin's own
  // plumbing back to the user.
  var _descriptions = {};
  var _storeTagId = null;
  var _storeTagFields = {};        // its own custom fields - the marker, and the hide field
  var _store = null;               // the parsed blob, for the writes a rename has to make

  function readStore(settings) {
    return findStoreTag(settings).then(function (tag) {
      var parsed = tag ? parseStore(tag.description) : { version: null, hideField: '', descriptions: {} };
      _storeTagId = tag ? String(tag.id) : null;
      _storeTagFields = (tag && tag.custom_fields) || {};
      _store = parsed;
      _descriptions = parsed.broken ? {} : parsed.descriptions;
      return { tag: tag, store: parsed };
    }, function (e) {
      // A store that cannot be read is not a reason to refuse a bulk edit: the bulk
      // dialog only wants it for tooltips, and the manage dialog reports it itself.
      _descriptions = {};
      _storeTagId = null;
      _storeTagFields = {};
      _store = null;
      throw e;
    });
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  var CSS =
    // Kept literally identical to the three sibling plugins' stylesheets wherever
    // the dialogs overlap, down to the hex values. They are separate strings because
    // the plugins share no module, not because they are meant to look different -
    // and two of them did drift, from #202b33 to #30404d, because nothing compared
    // them. `tests/style.test.js` pins the overlap now. #202b33 is Blueprint's
    // dark-gray2, the step Stash's own page uses; every dim grey in these dialogs was
    // chosen against it.
    '.cfbe-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.cfbe-modal{background:#202b33;color:#f5f8fa;border:1px solid #394b59;border-radius:4px;' +
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.cfbe-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.cfbe-title{font-size:1.1rem;font-weight:600;}' +
    '.cfbe-warn{color:#ffb648;margin-top:.35rem;}' +
    '.cfbe-note{color:#a7b6c2;margin-top:.35rem;}' +
    '.cfbe-legend{color:#7d8f9c;margin-top:.35rem;font-size:.8rem;}' +
    '.cfbe-progress{padding:.5rem 1rem;border-bottom:1px solid #394b59;color:#a7b6c2;' +
    'white-space:pre-wrap;}' +
    '.cfbe-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;font-size:.8rem;' +
    'line-height:1.35;min-height:14rem;}' +
    '.cfbe-line{white-space:pre-wrap;word-break:break-word;}' +
    '.cfbe-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
    '.cfbe-ERROR{color:#ff7373;} .cfbe-WARN{color:#ffb648;} .cfbe-INFO{color:#a7b6c2;}' +
    '.cfbe-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.cfbe-foot button{margin-right:.5rem;}' +
    '.cfbe-hidden{display:none;}' +
    // The filter row, shared with NormalizeParentTags' find bar: same position in the
    // dialog (a strip under the head), same job, so the same rule.
    '.cfbe-search{padding:.5rem 1rem;border-bottom:1px solid #394b59;position:relative;' +
    'display:flex;gap:.5rem;align-items:center;}' +
    // ── This dialog's own ───────────────────────────────────────────────────
    //
    // **Both of this plugin's dialogs are a fixed height, and the siblings' are not.**
    // `.cfbe-modal` has a `max-height` and no `height` - it is pinned byte-identical
    // across the four plugins, and for a dialog that is only a log that is right: it
    // sizes to what it holds and grows to the cap. These two are not only a log. The
    // bulk dialog's list shrinks as a filter narrows it, and the descriptions dialog's
    // textarea is user-resizable, so the modal moved under the pointer in both - the
    // window jumping to a new size while you are reading it. A modifier rather than an
    // edit to the shared rule, for the reason `.cfbe-listwrap` is one.
    '.cfbe-modal.cfbe-tall{height:88vh;}' +
    // Three labelled boxes with a mode each (0.12.0) no longer fit one line on a narrow
    // window, and the shared `.cfbe-search` is pinned across the four plugins - so the
    // wrap is a modifier here, the same escape hatch `.cfbe-tall` above is. `gap` is
    // already both axes, so the wrapped line spaces itself.
    '.cfbe-search-wrap{flex-wrap:wrap;}' +
    // The list was a <textarea> until 0.2.0, which is what made it selectable and
    // copyable with nothing to press and kept a selection of several thousand
    // entities down to one node. Pills need real elements, so the node count is back
    // and `LIST_RENDER_CAP` is what keeps it bounded - the same trade the siblings
    // make with `LOG_RENDER_CAP`.
    '.cfbe-list{width:100%;height:100%;min-height:0;box-sizing:border-box;overflow:auto;' +
    'background:#1f2b33;color:#f5f8fa;border:1px solid #394b59;border-radius:3px;' +
    'font-family:monospace;font-size:.8rem;line-height:1.9;padding:.35rem .5rem;}' +
    // A modifier on the shared `.cfbe-log`, not an edit to it: that rule is pinned
    // byte-identical across the four dialogs (`tests/style.test.js`) and its 14rem
    // floor is right for a plain log. This box holds the whole session - listings and
    // messages together - so a floor tall enough to push the modal past its own
    // max-height on a short window costs the dialog more than it buys the list.
    '.cfbe-listwrap{min-height:8rem;}' +
    '.cfbe-entry{white-space:pre-wrap;word-break:break-word;}' +
    // `display:inline`, deliberately: a selection dragged across inline-*block* pills
    // copies with line breaks nobody selected, and copying the listing as text is the
    // reason this list exists at all. Vertical padding is 0 for the same reason it
    // would otherwise overlap the line above.
    '.cfbe-pill{display:inline;border-radius:3px;padding:0 .3rem;background:#30404d;}' +
    '.cfbe-pill-act{background:#394b59;color:#a7b6c2;}' +
    '.cfbe-pill-ent{background:#2c4a63;color:#7cc4ff;text-decoration:none;}' +
    '.cfbe-pill-cf{cursor:pointer;}' +
    '.cfbe-pill-ent:hover,.cfbe-pill-cf:hover{background:#425a6b;}' +
    '.cfbe-pill-copied{background:#3f6b46;}' +
    // Real text, so it takes the selection highlight like the rest of the line;
    // `selectionText` is what keeps it out of what gets copied.
    // One rule for both, so the legend's ␀ cannot drift from the list's. The mark is
    // the one character in a monospace line that a monospace face renders as a box of
    // its own; the legend is not monospace, but it quotes the list, so the two have to
    // agree. Font only - the legend keeps its own colour and size.
    '.cfbe-none,.cfbe-nonemark{font-family:sans-serif;}' +
    '.cfbe-none{color:#a7b6c2;}' +
    '.cfbe-pill-failed{background:#7a3b3b;}' +
    '.cfbe-editor{padding:.5rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.cfbe-label{color:#a7b6c2;font-size:.85rem;white-space:nowrap;}' +
    '.cfbe-input,.cfbe-select{background:#1f2b33;color:#f5f8fa;border:1px solid #394b59;' +
    'border-radius:3px;padding:.25rem .5rem;}' +
    '.cfbe-input{flex:1 1 10rem;min-width:8rem;}' +
    // Stash marks its own dropdowns with a stacked ▲/▼ (Settings - Logs - Log Level);
    // a bare <select> gets whatever single chevron the browser draws. `appearance:none`
    // removes that one and the pair goes back as a background image, inline as a data
    // URI so the plugin stays a folder copy with no assets beside it. Quotes inside the
    // SVG are percent-encoded rather than escaped, so the CSS string stays readable.
    '.cfbe-select{-webkit-appearance:none;-moz-appearance:none;appearance:none;' +
    'padding-right:1.4rem;background-repeat:no-repeat;background-position:right .4rem center;' +
    'background-image:url("data:image/svg+xml;charset=utf-8,' +
    '%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%278%27 height=%2716%27%3E' +
    '%3Cpath fill=%27%23a7b6c2%27 d=%27M4 3l3 4H1z%27/%3E' +
    '%3Cpath fill=%27%23a7b6c2%27 d=%27M4 13l-3-4h6z%27/%3E%3C/svg%3E");}' +
    // The value box is disabled while the mode is the whole query, and these inputs
    // set their own background and colour, so the browser's own disabled look does not
    // show through.
    '.cfbe-input:disabled{opacity:.5;}' +
    // ── The manage-descriptions dialog ──────────────────────────────────────
    //
    // Two panes over one log. None of these selectors exists in a sibling, so
    // `tests/style.test.js` correctly leaves them alone - the pinning is for rules two
    // dialogs both draw, and no other dialog here has a second pane.
    '.cfbe-panes{display:flex;gap:.5rem;padding:.5rem 1rem;flex:2 1 auto;min-height:0;}' +
    '.cfbe-names{flex:0 0 20rem;overflow:auto;min-height:8rem;background:#1f2b33;' +
    'border:1px solid #394b59;border-radius:3px;padding:.25rem 0;}' +
    '.cfbe-name{display:block;width:100%;box-sizing:border-box;text-align:left;border:0;' +
    'background:none;color:#f5f8fa;font-family:monospace;font-size:.8rem;cursor:pointer;' +
    'padding:.1rem .5rem;}' +
    '.cfbe-name:hover{background:#3c4f5d;}' +
    '.cfbe-name-on{background:#425a6b;}' +
    '.cfbe-name-orphan{color:#ffb648;}' +
    // Not the orphan amber: a store-tag field is accounted for, not a loose end.
    '.cfbe-name-store{color:#48aff0;}' +
    '.cfbe-detail{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:.35rem;}' +
    '.cfbe-detail-head{color:#a7b6c2;font-size:.85rem;}' +
    '.cfbe-text{width:100%;box-sizing:border-box;min-height:5rem;background:#1f2b33;' +
    'color:#f5f8fa;border:1px solid #394b59;border-radius:3px;padding:.35rem .5rem;' +
    'font-family:inherit;font-size:.85rem;resize:vertical;}' +
    '.cfbe-users{flex:1 1 auto;overflow:auto;min-height:5rem;background:#1f2b33;' +
    'border:1px solid #394b59;border-radius:3px;padding:.35rem .5rem;font-family:monospace;' +
    'font-size:.8rem;line-height:1.9;}' +
    // The same modifier trick `.cfbe-listwrap` is: the shared `.cfbe-log` claims the
    // column with `flex:1 1 auto`, and in this dialog the panes above it are what the
    // room belongs to. Editing the shared rule for a local need is what the pinning in
    // `tests/style.test.js` exists to stop.
    '.cfbe-logshort{flex:1 1 10rem;min-height:5rem;}' +
    // The handle between the panes and the log. A textarea gets its grip from
    // `resize:vertical` for free; a flex row between two boxes has no such thing, so
    // this is the one place here that needs a drag of its own.
    '.cfbe-divider{flex:0 0 auto;height:.6rem;margin:0 1rem;cursor:row-resize;}' +
    '.cfbe-divider::after{content:"";display:block;height:2px;margin-top:.2rem;' +
    'background:#394b59;border-radius:1px;}' +
    '.cfbe-divider:hover::after{background:#7cc4ff;}' +
    '.cfbe-readme{color:#7cc4ff;font-size:.8rem;margin-top:.35rem;display:inline-block;}' +
    // ── The settings page ───────────────────────────────────────────────────
    //
    // Stash renders the description as one text node in a `.sub-heading` that is
    // `white-space: normal`, and a description cannot carry markup - it is passed to
    // React as a child, so any tag in it is escaped. So the blank lines are made
    // visible by the class, and then rebuilt as divs: under `pre-wrap` a blank line
    // is always one whole line-height and nothing in CSS can target it.
    //
    // Scoped to our own group, never applied to `.sub-heading` at large - another
    // plugin's description is not ours to reflow.
    //
    // The three rules below are the description half of the shared design, and the
    // four after them the per-setting half - byte-identical with the siblings' copies,
    // and required of this plugin from 0.7.0, which is when it got its first setting.
    '.cfbe-own-group .sub-heading{white-space:pre-wrap;}' +
    '.cfbe-own-group .sub-heading .cfbe-p{margin:0 0 .35em;}' +
    '.cfbe-own-group .sub-heading .cfbe-p:last-child{margin-bottom:0;}' +
    '.cfbe-desc-collapsed .cfbe-p:not(:first-child){display:none;}' +
    '.cfbe-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
    // The per-setting hover box: a summary on the row, the rest behind a ⓘ that opens
    // from the mark, the summary or the setting's own name. Stash's `title` slot cannot
    // be sized, placed or opened from the keyboard, which is why this exists.
    '.cfbe-tipped{position:relative;}' +
    '.cfbe-tip{margin-left:.35rem;cursor:pointer;opacity:.65;font-style:normal;' +
    'font-size:1.05em;}' +
    '.cfbe-tip:hover,.cfbe-tip:focus{opacity:1;outline:none;}' +
    // pointer-events:none is load-bearing, not tidiness. Opened from the setting's
    // name the box lands over the h3, so a box that took the pointer would fire
    // mouseleave on the name, close, hand the pointer back to the name, and reopen -
    // a flicker loop for as long as it is hovered.
    '.cfbe-tipbox{display:none;position:absolute;left:0;bottom:calc(100% + .35rem);' +
    'z-index:1500;width:max-content;max-width:100%;padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.cfbe-tipped.cfbe-tip-open .cfbe-tipbox{display:block;}' +
    // The menu item, amber because it is the one thing this plugin puts into Stash's
    // own chrome and it leads to a write. Stash's `.dropdown-item` supplies the
    // padding, the hover and the layout; only the two things that are ours are set.
    '.cfbe-menu-item{cursor:pointer;color:#ffb648;}';

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

  // A drag handle that pins the height of the element above it, so the flex column
  // below takes whatever is left. The listeners go on `document` rather than on the
  // handle: a fast drag leaves the pointer behind, and a mouseup outside the 10px bar
  // would otherwise never arrive and the drag would latch.
  function splitter(above) {
    var bar = el('div', 'cfbe-divider');
    bar.title = 'Drag to give the log below more or less room.';
    var y0 = 0, h0 = 0;
    function move(ev) {
      var room = above.parentNode ? above.parentNode.clientHeight : 0;
      // The floor keeps the panes usable; the ceiling keeps the log and the footer on
      // screen, since neither can shrink past its own `min-height`.
      var max = Math.max(120, room - 200);
      var want = Math.max(80, Math.min(h0 + (ev.clientY - y0), max));
      above.style.flex = '0 0 ' + want + 'px';
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    bar.addEventListener('mousedown', function (ev) {
      y0 = ev.clientY;
      h0 = above.offsetHeight || above.clientHeight || 0;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      if (ev.preventDefault) ev.preventDefault();   // no text selection while dragging
    });
    return bar;
  }

  function hasClass(node, name) {
    return !!node && (' ' + (node.className || '') + ' ').indexOf(' ' + name + ' ') !== -1;
  }

  // ── Is this script the one Stash has installed? ───────────────────────────
  //
  // "Reload plugins" re-reads the plugin folder on the server; it cannot replace a
  // script this page already fetched and executed. Comparing the two numbers is the
  // only way the script can notice it is the stale one.
  //
  // Resolves to null wherever the answer is unknown - a Stash too old for the field,
  // a plugin it cannot see, a failed request. Unknown is not a mismatch.
  function installedVersion() {
    return gqlRequest('query CFBEPluginVersion { plugins { id version } }', null)
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
  // per-type branch is what let galleries and images log as "untitled" in a sibling
  // for three releases. `title` is optional on scenes, galleries and images, so each
  // falls back to its file - and a gallery can be a folder, with no file at all.
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

  // Stash is commonly served over plain HTTP on a LAN, where the async clipboard API
  // is not available at all, so the textarea + execCommand path is the fallback rather
  // than a legacy branch. Same shape as the siblings' Copy log button, minus the
  // caption swap: a pill reports by flashing, not by renaming itself.
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

  // Custom field values are an arbitrary JSON `Map`, so anything that is not already
  // a string is shown as JSON rather than as `[object Object]`.
  function valueText(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  // Present and not obviously false: the value is read rather than merely its presence,
  // so that clearing a field to `0` unmarks the entity without having to delete the key.
  //
  // **One predicate for both places a value is read as a yes/no**: the dropdown filter
  // of §23 and the listing's "is true" mode. A custom field is a string map with no
  // boolean in it, so this is the whole of what "true" means in this plugin - and two
  // answers to it, one hiding an entity and one listing it, would be a bug waiting for
  // whichever value fell between them.
  function isMarked(v) {
    if (v == null || v === false || v === 0) return false;
    var s = String(v).replace(/^\s+|\s+$/g, '').toLowerCase();
    return s !== '' && s !== '0' && s !== 'false';
  }

  // ── Which list is on screen, and what is selected ─────────────────────────

  // The last path segment names the type: `/scenes`, `/performers/12/scenes` and
  // `/tags/9/images` all end in the list they show, and a detail page (`/scenes/12`)
  // or the marker list (`/scenes/markers`) ends in something that is not a key here.
  //
  // Four list views are exceptions, and 0.1.1 is the release that stopped missing
  // them - the reported symptom was a gallery's own image list drawing no menu item.
  // A detail page's tabs go through `useTabKey`, which puts the tab in the URL as
  // `<base>/<tabKey>`, and three tab keys are not the plural of what they list; a
  // gallery is worse still, since `Gallery.tsx` routes its right-hand tabs by hand to
  // `/galleries/<id>` and `/galleries/<id>/add`, so the images tab has no segment of
  // its own at all. All four render the same `Filtered*List` as the top-level list,
  // with the same "..." menu and the same selection. Read off stashapp/stash
  // `develop` (Gallery.tsx, Group.tsx, Studio.tsx, Performer.tsx), 2026-08-13.
  //
  // Matched on the whole path rather than the tail: `add` on its own is far too
  // common a segment to hand to an entity type on sight.
  var ROUTE_ALIASES = [
    [/^\/galleries\/\d+(?:\/add)?$/, 'images'],       // a gallery's images, and add-images
    [/^\/groups\/\d+\/subgroups$/, 'groups'],
    [/^\/studios\/\d+\/childstudios$/, 'studios'],
    [/^\/performers\/\d+\/appearswith$/, 'performers'],
  ];

  function listType() {
    var path = String((window.location && window.location.pathname) || '')
      .replace(/[?#].*$/, '').replace(/\/+$/, '');
    for (var i = 0; i < ROUTE_ALIASES.length; i++) {
      if (ROUTE_ALIASES[i][0].test(path)) return ROUTE_ALIASES[i][1];
    }
    var seg = path.split('/').pop();
    return hasOwn(ENTITIES, seg) ? seg : null;
  }

  // A plain recursive walk rather than `querySelectorAll`: neither the shared test
  // harness's fake DOM nor this concern needs a selector engine, and the same walk
  // has to skip text nodes, which carry no tagName.
  function collect(node, match, out) {
    out = out || [];
    var kids = node && node.childNodes;
    for (var i = 0; kids && i < kids.length; i++) {
      var c = kids[i];
      if (!c || !c.tagName) continue;
      if (match(c)) out.push(c);
      collect(c, match, out);
    }
    return out;
  }

  function checkedBoxes(root) {
    return collect(root, function (n) {
      return n.tagName === 'INPUT' && String(n.type).toLowerCase() === 'checkbox' && !!n.checked;
    });
  }

  // Every distinct id of this type linked to from inside `node`, with how many links
  // point at each, in first-seen order. One id is a row; more than one is either a
  // container, or a row that links to a relative of its own type.
  function idsUnder(node, spec) {
    var seen = {};
    var out = [];
    collect(node, function (n) {
      if (n.tagName !== 'A' || !n.getAttribute) return false;
      var m = spec.route.exec(n.getAttribute('href') || '');
      if (m) {
        if (!hasOwn(seen, m[1])) { seen[m[1]] = { id: m[1], links: 0 }; out.push(seen[m[1]]); }
        seen[m[1]].links++;
      }
      return false;
    });
    return out;
  }

  // A single row, as opposed to a container of them: `GridCard` puts `grid-card` on
  // every card in every list view, and a table view's rows are `<tr>`. Both read off
  // stashapp/stash `develop`, 2026-08-13.
  function isRow(node) {
    if (node.tagName === 'TR') return true;
    return /(^|\s)grid-card(\s|$)/.test(String(node.className || ''));
  }

  // A checked checkbox says "this row is selected"; the row's own detail link says
  // which entity that is. Climb from the box until an ancestor links somewhere.
  //
  // **More than one id in something that is not a row means it is a container.** A
  // table view's select-all box sits in the header, whose only ancestor carrying links
  // is the whole table - so it resolves to every id on the page, and taking that as a
  // selection would silently widen a write to the entire list.
  //
  // **Inside a row, more than one id means a relative of the same type**, which is why
  // 0.1.2 exists: a tag card links to its parent tag and a studio card to its parent
  // studio, so every tag and studio with a parent was being dropped from the selection.
  // The row's own link is the one it renders *twice* - `GridCard` links both the
  // thumbnail and the title at it, and both list tables do the same - while a relative
  // gets exactly one. So the id with strictly the most links wins, and a tie is still a
  // refusal.
  function rowEntityId(box, spec) {
    var n = box.parentNode;
    for (var depth = 0; n && depth < ROW_WALK_MAX; depth++) {
      var found = idsUnder(n, spec);
      if (found.length === 1) return found[0].id;
      if (found.length > 1) return isRow(n) ? dominantId(found) : null;
      n = n.parentNode;
    }
    return null;
  }

  function dominantId(found) {
    var best = found[0];
    var tied = false;
    for (var i = 1; i < found.length; i++) {
      if (found[i].links > best.links) { best = found[i]; tied = false; }
      else if (found[i].links === best.links) tied = true;
    }
    return tied ? null : best.id;
  }

  function selectedIds(type) {
    var spec = ENTITIES[type];
    var seen = {};
    var ids = [];
    checkedBoxes(document.body).forEach(function (box) {
      var id = rowEntityId(box, spec);
      if (id && !hasOwn(seen, id)) { seen[id] = true; ids.push(id); }
    });
    return ids;
  }

  // ── The menu item ─────────────────────────────────────────────────────────

  var MENU_LABEL = 'Custom Fields...';
  var MENU_ITEM_CLASS = 'cfbe-menu-item';

  // Stash's list toolbar renders the "..." dropdown with `id="more-menu"` on its
  // toggle, and react-bootstrap only mounts the menu itself while it is open - so
  // this finds nothing except in the moment the user has it open, which is exactly
  // when the item has to be there.
  //
  // The fallback exists because that id is the single point of failure for the whole
  // plugin and it has not been read off a running Stash. It matches a menu by what is
  // *in* it - Stash puts the selection operations in this menu and nowhere else - so
  // it cannot capture the sort or the display-mode dropdown, which is the one thing a
  // looser fallback must not do.
  var MENU_SIGNALS = ['select all', 'select none'];

  function menuOf(toggleParent) {
    return toggleParent ? toggleParent.querySelector('.dropdown-menu') : null;
  }

  function looksLikeOperationMenu(menu) {
    var items = collect(menu, function (n) { return hasClass(n, 'dropdown-item'); });
    for (var i = 0; i < items.length; i++) {
      var text = String(items[i].textContent || '').replace(/\s+/g, ' ').toLowerCase();
      if (MENU_SIGNALS.indexOf(text.replace(/^ | $/g, '')) !== -1) return true;
    }
    return false;
  }

  function findMenu() {
    var toggle = document.getElementById('more-menu');
    var menu = menuOf(toggle && toggle.parentNode);
    if (menu) return menu;
    var all = document.querySelectorAll('.dropdown-menu');
    for (var i = 0; i < all.length; i++) {
      if (looksLikeOperationMenu(all[i])) return all[i];
    }
    return null;
  }

  // Through `document`, not a walk: this runs on every tick and on every DOM mutation
  // burst, and a list view holding a thousand cards is not a subtree to sweep once a
  // second for a node that is usually absent. Indexed rather than `forEach`, because a
  // real `NodeList` carries nothing from `Array.prototype` in every engine.
  function existingItems() {
    var found = document.querySelectorAll('.' + MENU_ITEM_CLASS);
    var out = [];
    for (var i = 0; i < found.length; i++) out.push(found[i]);
    return out;
  }

  function clearItems(keep) {
    existingItems().forEach(function (n) {
      if (n !== keep && n.parentNode) n.parentNode.removeChild(n);
    });
  }

  function buildItem(type, ids) {
    // An <a> with no href, the shape react-bootstrap's own Dropdown.Item renders, so
    // Stash's `.dropdown-item` styling applies unchanged.
    var item = el('a', 'dropdown-item ' + MENU_ITEM_CLASS, MENU_LABEL);
    item.title = 'View and bulk edit the custom fields of the ' + ids.length + ' selected ' +
      (ids.length === 1 ? ENTITIES[type].label.toLowerCase() : ENTITIES[type].plural.toLowerCase()) +
      '. Opens a dialog listing what they carry now; nothing is written until you press Apply.';
    item.addEventListener('click', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      startRun(type, ids);
    });
    return item;
  }

  // Reconciliation rather than tracking: React tears the menu down when it closes and
  // rebuilds it on the next open, so there is nothing durable to hold on to. Every
  // tick rebuilds the opinion of whether the item should exist, and where.
  function menuTick() {
    var type = listType();
    if (!type) {
      clearItems(null);
      gateLogOnce('route', 'not an entity list view (' +
        String((window.location && window.location.pathname) || '') + ')');
      return;
    }

    var menu = findMenu();
    if (!menu) {
      clearItems(null);
      gateLogOnce('route', ENTITIES[type].plural + ' list: no open "..." menu to add to');
      return;
    }

    var ids = selectedIds(type);
    if (!ids.length) {
      clearItems(null);
      gateLogOnce('route', ENTITIES[type].plural + ' list: menu open, nothing selected');
      return;
    }
    gateLogOnce('route', ENTITIES[type].plural + ' list: menu open, ' + ids.length + ' selected');

    // Always last in the menu, and rebuilt when the selection changes: the caption
    // says nothing about the count but the tooltip does, and a click has to carry the
    // ids that were selected when it was made.
    var current = null;
    existingItems().forEach(function (n) {
      if (n.parentNode === menu && n._cfbeKey === type + ':' + ids.join(',') &&
          n === menu.childNodes[menu.childNodes.length - 1]) current = n;
    });
    if (current) { clearItems(current); return; }

    clearItems(null);
    var item = buildItem(type, ids);
    item._cfbeKey = type + ':' + ids.join(',');
    menu.appendChild(item);
  }

  // ── The library-wide task ─────────────────────────────────────────────────
  //
  // Declared in the yml so Stash renders a button for it in Settings → Tasks, and
  // handled entirely here: the click never reaches the server, because there is no
  // `exec` behind it and nothing server-side to run. A capture-phase listener on
  // `document` runs before React's own handler and stops the propagation, which is
  // what keeps PluginTasks' "added job to queue" toast from appearing over a dialog
  // that is already open.
  //
  // **One layer, where `MergePerformerTagsToScenes` has two.** Its second layer
  // answers the `runPluginTask` mutation inside a `fetch` wrapper it already has for
  // auto-merge. This plugin has no wrapper and gains nothing else from one, and the
  // failure it would cover is visible and harmless: if the click is not recognised,
  // no dialog opens and Stash queues a job that does nothing. Add the second layer if
  // that is ever seen, not before.
  var TASK_NAME = 'Edit Custom Fields Across the Whole Library...';
  var TASK_DESC = 'Manage Custom Field Descriptions...';
  var TASK_NAMES = [TASK_NAME, TASK_DESC];

  // Ours only if the label matches *and* the enclosing SettingGroup is headed with
  // our name - another plugin may declare a task called the same thing. Answered from
  // the button's own group and stopped there: climbing past it reaches the panel
  // holding every plugin's group, where `querySelector('h3')` answers with whichever
  // plugin is listed first (§ownTaskName in MergePerformerTagsToScenes, 1.17.0).
  //
  // Returns *which* of our tasks it is, because two of them now share this path and the
  // click has to open the right dialog.
  function ownTaskName(btn) {
    var label = String(btn.textContent || '').replace(/^\s+|\s+$/g, '');
    if (TASK_NAMES.indexOf(label) === -1) return null;
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

  // `btn-warning` is deliberately not in the strip list - it is what we add, and the
  // guard in `paintButton` returns before any of this once it is there.
  var BTN_VARIANTS = /\bbtn-(secondary|primary|success|info|light|dark|link)\b/g;

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
      if (ownTaskName(nodes[i])) paintButton(nodes[i], PLUGIN_BTN_VARIANT);
    }
  }

  if (document.addEventListener) {
    document.addEventListener('click', function (event) {
      var target = event.target;
      var btn = target && target.closest ? target.closest('button') : null;
      var task = btn && ownTaskName(btn);
      if (!task) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      if (task === TASK_DESC) startDescRun(); else startRun(null, null);
    }, true);
  }

  // ── The dialog ────────────────────────────────────────────────────────────

  var _active = null;

  // `type` names one of the seven and `ids` is what was selected; both null is the
  // task, which walks every type instead. The dialog is the same object either way -
  // the difference lives in `specs`, and in every entity carrying the spec it came
  // from rather than the run holding one for all of them.
  // A selection opens immediately: no setting reaches it, so there is nothing to wait
  // for. The task reads the settings **at the click** rather than at load, so flipping
  // the switch and pressing the button in the same page session does what it says. A
  // read that fails is not a reason not to run - the defaults are the behaviour this
  // plugin had before the setting existed.
  var _opening = false;

  function startRun(type, ids) {
    if (_active) { _active.focus(); return; }
    if (type) { openRun(type, ids, DEFAULTS); return; }
    if (_opening) return;                      // a second click inside the round trip
    _opening = true;
    var go = function (s) { _opening = false; openRun(null, null, s); };
    loadSettings().then(go, function () { go(DEFAULTS); });
  }

  // The manage-descriptions task. Same shape as the whole-library one - the settings
  // are read at the click, not at load - because both of its settings name something
  // the dialog is about to go looking for.
  function startDescRun() {
    if (_active || _opening) { if (_active) _active.focus(); return; }
    _opening = true;
    var go = function (s) {
      _opening = false;
      if (_active) return;
      _active = new DescRun(s);
      _active.begin();
    };
    loadSettings().then(go, function () { go(DEFAULTS); });
  }

  function openRun(type, ids, settings) {
    if (_active) { _active.focus(); return; }
    _active = new Run(type, ids, settings);
    _active.begin();
  }

  // Images are optional in the whole-library task and nowhere else: they are usually
  // the most numerous type by a wide margin, so on a large library they are most of the
  // read - and a selection is exactly what the user picked, image lists included.
  function allSpecs(settings) {
    var out = [];
    for (var k in ENTITIES) {
      if (!hasOwn(ENTITIES, k)) continue;
      if (k === 'images' && settings.a1SkipImagesInTask) continue;
      out.push(ENTITIES[k]);
    }
    return out;
  }

  function Run(type, ids, settings) {
    this.type = type;
    this.settings = settings || DEFAULTS;
    this.spec = type ? ENTITIES[type] : null;   // null: the whole library, every type
    this.specs = type ? [ENTITIES[type]] : allSpecs(this.settings);
    this.ids = ids || [];
    // { id, label, fields } per entity that still exists, in selection order.
    this.entities = [];
    // The listing, flattened: one per (entity, custom field).
    this.rows = [];
    // What the last Apply wrote, and what each entity carried before it. This is what
    // Undo replays - a per-key delta, never a stored copy of the whole map, so it puts
    // back exactly the one field this dialog changed and touches nothing else.
    this.changes = [];
    // `{from, to}` while the last Apply renamed the field the "Hide from Add Lists"
    // setting names, so an Undo can take the setting back with it.
    this.hideRename = null;
    this.applied = 0;
    this.failed = 0;
    this.undone = 0;
    // Set by checkVersion when the running script is not the one Stash has installed.
    this.stale = false;
    this.undoArmed = 0;
    // Which type the whole-library read is on, and how far into it: the progress line
    // is the only thing saying a 15-second read is moving at all.
    this.loadingWhat = '';
    // How many entities were left out because they are this plugin's own plumbing -
    // today only ever the store tag, and reported rather than dropped in silence.
    this.storeSkipped = 0;
    // Every line the listing holds, uncapped, as plain text - what Copy log copies.
    // Built beside the nodes rather than read back off them, so the 1000-line render
    // cap does not silently truncate a copied log too.
    this.listText = [];
    this.state = 'loading';
    this.build();
  }

  Run.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'cfbe-backdrop');
    this.modal = el('div', 'cfbe-modal cfbe-tall');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'cfbe-head');
    // A plain block, so a title too long for one line wraps rather than being clipped.
    head.appendChild(el('div', 'cfbe-title', PLUGIN_SHORT_NAME + ' - ' + (this.spec
      ? this.spec.plural + ' - ' + this.ids.length + ' selected'
      : 'Whole library - every entity type that carries custom fields')));
    head.appendChild(el('div', 'cfbe-warn',
      'Backing up your database before proceeding is recommended. Undo only reverses what this dialog wrote, ' +
      'while it stays open, and cannot account for changes made elsewhere in the meantime.'));
    // Built from spans rather than one string, so the ␀ can carry `cfbe-nonemark` and
    // render in the same face the list draws it in. The two plain spans are unclassed
    // and inherit everything the legend sets; the legend itself gets no text of its own,
    // the same shape `rowNode` uses for a line.
    var legend = el('div', 'cfbe-legend');
    legend.appendChild(el('span', null,
      'Reading the list: the number in brackets after the entity name is its id. The rest of ' +
      'the line reads: entity: field name ' + EQ + ' field value, and after Apply, ' +
      'what changed as before ' + ARROW.replace(/^\s+|\s+$/g, '') + ' after. '));
    legend.appendChild(el('span', 'cfbe-nonemark', NONE));
    legend.appendChild(el('span', null,
      ' marks nothing there - either no such field, or a field set to an empty value; it is a ' +
      'mark on the screen only, and copies as nothing. Click an entity to open it in a new tab; ' +
      'click a field name or value to copy it. Counts are written with prefix "x".'));
    head.appendChild(legend);
    this.noteEl = el('div', 'cfbe-note', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.progressEl = el('div', 'cfbe-progress', 'Loading...');
    this.modal.appendChild(this.progressEl);

    var filters = el('div', 'cfbe-search cfbe-search-wrap');
    // Only on a task run: a selection is one type by construction, and a pulldown
    // offering the six it cannot contain would be six ways to empty the list. Left
    // null otherwise, which is what `filtered` reads.
    if (!this.spec) {
      var typeOpts = [['', 'All types']];
      this.specs.forEach(function (s) { typeOpts.push([s.key, s.plural]); });
      this.typeFilter = this.select('cfbe-filter-type', typeOpts, '');
      this.typeFilter.addEventListener('change', function () { self.filterChanged(); });
      filters.appendChild(el('span', 'cfbe-label', 'Type'));
      filters.appendChild(this.typeFilter);
    }
    // Entity before name, at the user's ask: the filters read left to right in the
    // order a line does - which entity, then which field on it.
    filters.appendChild(el('span', 'cfbe-label', 'Filter by Entity'));
    this.entMode = this.select('cfbe-filter-entmode', TEXT_MODES, 'contains');
    filters.appendChild(this.entMode);
    this.entFilter = this.input('cfbe-filter-ent');
    // The one filter box whose subject is not on the line as plain text: the row shows
    // the entity as a pill, so the box has to say what shape it is matching against.
    this.entFilter.title = this.entMode.title = 'Matches the entity name and id together, ' +
      'as name, space, id in brackets - so "Cool Scene (42)", "Cool Scene" and "(42)" all ' +
      'find that one row.';
    filters.appendChild(this.entFilter);
    filters.appendChild(el('span', 'cfbe-label', 'Filter by Name'));
    this.nameMode = this.select('cfbe-filter-namemode', TEXT_MODES, 'contains');
    filters.appendChild(this.nameMode);
    this.nameFilter = this.input('cfbe-filter-name');
    filters.appendChild(this.nameFilter);
    filters.appendChild(el('span', 'cfbe-label', 'Filter by Value'));
    // The mode is a control of its own rather than something typed into the box, because
    // any sentinel the box could carry is also a value somebody is allowed to have.
    this.valueMode = this.select('cfbe-filter-mode', TEXT_MODES.concat([
      ['empty', 'is empty'], ['true', 'is true'], ['nottrue', 'is not true'],
    ]), 'contains');
    // The two truth modes are one predicate away from being a lie about themselves -
    // "no" and "off" are true by it - so the rule goes on the control rather than in a
    // release note nobody has open.
    this.valueMode.title = '"is true" reads a value the way the add-list filter does: ' +
      'empty, 0 and false are not true, and everything else is - "no" and "off" included. ' +
      '"is empty" is the narrower of the two.';
    filters.appendChild(this.valueMode);
    this.valueFilter = this.input('cfbe-filter-value');
    filters.appendChild(this.valueFilter);
    [this.nameFilter, this.entFilter, this.valueFilter].forEach(function (i) {
      i.addEventListener('input', function () { self.filterChanged(); });
    });
    [this.nameMode, this.entMode].forEach(function (s) {
      s.addEventListener('change', function () { self.filterChanged(); });
    });
    this.valueMode.addEventListener('change', function () {
      // Nothing to type in when the mode is the whole query, and a box left enabled
      // would read as a second condition that is silently not applied.
      self.valueFilter.disabled = !needsText(self.valueMode.value);
      self.filterChanged();
    });
    this.modal.appendChild(filters);

    var listWrap = el('div', 'cfbe-log cfbe-listwrap');
    this.listEl = el('div', 'cfbe-list');
    // The pills are markup, and a copy out of markup carries the markup with it. The
    // selection's own text is what the user sees, so that is what goes on the
    // clipboard - as `text/html` too, or a rich editor would paste the pills back.
    this.listEl.addEventListener('copy', function (ev) {
      var text = window.getSelection ? selectionText(window.getSelection()) : '';
      if (!text || !ev || !ev.clipboardData) return;
      ev.clipboardData.setData('text/plain', text);
      ev.clipboardData.setData('text/html',
        text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      if (ev.preventDefault) ev.preventDefault();
    });
    listWrap.appendChild(this.listEl);
    this.modal.appendChild(listWrap);

    var ops = el('div', 'cfbe-editor');
    // Per option *and*, in `syncOps`, on the select itself: an `<option title>` is
    // honoured by some browsers and ignored by others, while the select's own title is
    // reliable everywhere - so it carries whichever mode is currently chosen.
    this.modeSel = this.select('cfbe-mode', [
      ['add', 'Add', MODE_TIPS.add], ['overwrite', 'Overwrite', MODE_TIPS.overwrite],
      ['remove', 'Remove', MODE_TIPS.remove], ['rename', 'Rename', MODE_TIPS.rename],
    ], 'add');
    this.scopeSel = this.select('cfbe-scope', [
      ['all', 'All', SCOPE_TIPS.all], ['filtered', 'Filtered list only', SCOPE_TIPS.filtered],
    ], 'all');
    ops.appendChild(el('span', 'cfbe-label', 'Operation'));
    ops.appendChild(this.modeSel);
    ops.appendChild(el('span', 'cfbe-label', 'Apply to'));
    ops.appendChild(this.scopeSel);
    [this.modeSel, this.scopeSel].forEach(function (s) {
      s.addEventListener('change', function () { self.syncOps(); });
    });
    this.modal.appendChild(ops);

    var fields = el('div', 'cfbe-editor');
    // The label is rewritten under Rename: the box means the *new* name there, and a
    // box that means two things needs to say which one it means right now.
    this.nameLabel = el('span', 'cfbe-label', 'Custom Field name');
    fields.appendChild(this.nameLabel);
    this.nameInput = this.input('cfbe-field-name');
    fields.appendChild(this.nameInput);
    fields.appendChild(el('span', 'cfbe-label', 'Custom Field value'));
    this.valueInput = this.input('cfbe-field-value');
    fields.appendChild(this.valueInput);
    [this.nameInput, this.valueInput].forEach(function (i) {
      i.addEventListener('input', function () { self.syncApply(); });
    });
    this.modal.appendChild(fields);

    var foot = el('div', 'cfbe-foot');
    this.cancelBtn = button('Cancel', 'cfbe-cancel');
    // Amber: this is the button that writes. See "one colour for a plugin wrote this".
    this.applyBtn = button('Apply', 'cfbe-apply');
    this.applyBtn.className = this.applyBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.undoBtn = button('Undo', 'cfbe-undo cfbe-hidden');
    this.undoBtn.className = this.undoBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.rescanBtn = button('Rescan', 'cfbe-rescan cfbe-hidden');
    this.copyBtn = button('Copy log', 'cfbe-copy');
    this.closeBtn = button('Close', 'cfbe-close cfbe-hidden');
    this.applyBtn.disabled = true;
    this.undoBtn.title = 'Put back the value each entity carried before Apply, field by field. ' +
      'Only what this dialog wrote, and only while it stays open.';
    this.rescanBtn.title = 'Read the custom fields again and list what they are now. ' +
      'Undo stays available; a fresh Apply is what replaces it.';
    this.copyBtn.title = 'Copy the counters, the [INFO] lines and the whole listing as plain ' +
      'text - including the lines the 1000-line cap leaves off the screen.';

    this.cancelBtn.addEventListener('click', function () { self.close(); });
    this.applyBtn.addEventListener('click', function () { self.apply(); });
    this.undoBtn.addEventListener('click', function () { self.undo(); });
    this.rescanBtn.addEventListener('click', function () { self.rescan(); });
    this.copyBtn.addEventListener('click', function () { self.copyLog(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });

    // The siblings' footer order, which three of the four plugins already had:
    // <write> Cancel [Stop] Copy log Undo Rescan Close. There is no Stop here - a
    // write is one bulk mutation per batch and the dialog disables its own footer for
    // the duration - so Apply takes Proceed's leading position and the rest follow.
    [this.applyBtn, this.cancelBtn, this.copyBtn, this.undoBtn, this.rescanBtn, this.closeBtn]
      .forEach(function (b) { foot.appendChild(b); });
    this.modal.appendChild(foot);

    wireEscape(this);
    document.body.appendChild(this.backdrop);
  };

  Run.prototype.input = function (className) {
    var i = el('input', 'cfbe-input ' + className);
    i.type = 'text';
    i.value = '';
    return i;
  };

  // `[value, label]`, or `[value, label, tooltip]`. The options are kept on `_opts` as
  // well as in the DOM: a mode that is only sometimes available has to be disabled by
  // name later, and walking `childNodes` for it would be the same lookup written twice.
  Run.prototype.select = function (className, options, initial) {
    var s = el('select', 'cfbe-select ' + className);
    s._opts = {};
    options.forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
      if (o[2]) opt.title = o[2];
      s._opts[o[0]] = opt;
      s.appendChild(opt);
    });
    s.value = initial;
    return s;
  };

  Run.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  Run.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*cfbe-hidden/g, '') + (visible ? '' : ' cfbe-hidden');
  };

  Run.prototype.setState = function (state) {
    this.state = state;
    var listing = state === 'listing';
    // `undoing` counts as applied for the footer: the write it is performing started
    // from this half of it, and flipping back to Cancel/Apply mid-undo would offer a
    // second write over a library the first one is still moving.
    var applied = state === 'applied' || state === 'undoing';
    var busy = state === 'applying' || state === 'undoing';
    // Cancel and Apply while there is something to decide; Undo and Close once there
    // is something to take back. The two pairs never overlap: after Apply the listing
    // describes a library this dialog has already changed, so offering Apply again
    // over it would write from a plan the user is no longer looking at.
    this.show(this.cancelBtn, !applied);
    this.show(this.applyBtn, !applied);
    // Shown for as long as there is something to take back, in *any* state - not only
    // in `applied`. A Rescan returns the dialog to `listing`, and hiding Undo there
    // would mean rescanning quietly threw the undo away.
    this.show(this.undoBtn, this.changes.length > 0);
    this.show(this.rescanBtn, listing || applied);
    this.show(this.closeBtn, applied);
    this.cancelBtn.disabled = busy;
    this.undoBtn.disabled = busy;
    this.rescanBtn.disabled = busy;
    this.closeBtn.disabled = busy;
    [this.modeSel, this.scopeSel, this.nameInput, this.valueInput].forEach(function (n) {
      n.disabled = !listing;
    });
    // After the loop, because Rename disables the value box in `listing` too.
    this.syncOps();
  };

  // Apply is enabled by the one rule the user asked for - a non-empty field name,
  // an empty value being a legitimate thing to store - plus the version gate, which
  // is the only warning in this repo's dialogs that blocks. Undo is deliberately not
  // gated on it: stranding the user with changes they cannot take back is worse than
  // the mismatch it protects against.
  Run.prototype.syncApply = function () {
    var rename = this.modeSel.value === 'rename';
    this.applyBtn.disabled = this.state !== 'listing' ||
      !String(this.nameInput.value || '').replace(/^\s+|\s+$/g, '') || this.stale ||
      (rename && !this.renameName);
    this.applyBtn.title = rename && !this.renameName
      ? 'Rename needs one field name in scope: what Apply covers carries more than one, ' +
        'or nothing at all. Filter the list down to a single field name first.'
      : rename
        ? 'Rename "' + this.renameName + '" on everything in scope, keeping each value.'
        : '';
  };

  Run.prototype.note = function (message) {
    this.msg('WARN', message);
    this.noteEl.textContent = this.noteEl.textContent
      ? this.noteEl.textContent + ' ' + message : message;
  };

  // Into the listing itself, at the end, so a message sits where it happened rather
  // than in a strip of its own that has to be read against the list beside it. One
  // box, one scrollbar, one order of events - and nothing here ever clears it, so the
  // whole session is still there when the dialog closes.
  //
  // The text goes in as a child node rather than as the line's own `textContent`, so
  // that a caller can append pills after it - setting text and then appending would
  // drop one or the other depending on whose DOM you are in. Returns the line for
  // exactly that.
  Run.prototype.msg = function (kind, message) {
    var line = el('div', 'cfbe-line cfbe-' + kind);
    line.appendChild(textNode('[' + kind + '] ' + message));
    this.listEl.appendChild(line);
    this.scrollList();
    return line;
  };

  // A tally inside a message line, with every name a click-to-copy pill: these are the
  // strings that get typed into Field name and Value next, and retyping one by hand is
  // how a bulk edit reaches the wrong key.
  Run.prototype.tallyMsg = function (kind, lead, t, tail, named) {
    var line = this.msg(kind, lead);
    t.forEach(function (pair, i) {
      if (i) line.appendChild(textNode(', '));
      line.appendChild(copyPill(pair[0], named));
      line.appendChild(textNode(' x' + pair[1]));
    });
    line.appendChild(textNode(tail == null ? '.' : tail));
    this.scrollList();
    return line;
  };

  // Both boxes, because this dialog is the only one of the four with two of them: the
  // siblings' `.<prefix>-log` is itself the scroller, while here it is a wrapper around
  // `.cfbe-list`. Which of the two actually scrolls depends on whether the inner box's
  // `height:100%` resolves - against a flex parent whose own height comes from a
  // `max-height` it is not definite, the inner one grows instead and the wrapper is
  // what has the overflow. Scrolling the one that cannot move costs nothing; scrolling
  // only the wrong one leaves the last line off screen.
  Run.prototype.scrollList = function () {
    [this.listEl, this.listEl.parentNode].forEach(function (box) {
      if (box && typeof box.scrollHeight === 'number') box.scrollTop = box.scrollHeight;
    });
  };

  Run.prototype.begin = function () {
    var self = this;
    this.setState('loading');

    // Said rather than assumed, for the reason every skip in `reportSkips` is: a type
    // missing from a whole-library run is otherwise indistinguishable from a bug.
    if (!this.spec && this.settings.a1SkipImagesInTask) {
      this.msg('INFO', 'Images are left out of this run: "' + SKIP_IMAGES_NAME +
        '" is on in this plugin\'s settings.');
    }

    // Someone else's lease, held right now. Ours is taken in apply(). It is advisory
    // and this is a manual action, so it does not block - but two plugins rewriting
    // the same entities at once is worth saying out loud.
    if (coop().leases.length) {
      this.note('Another plugin is applying bulk changes right now (' +
        coop().leases[0].owner + ' - ' + coop().leases[0].label + '). Running both at once ' +
        'means each may undo part of the other; let it finish first.');
    }

    // Not chained ahead of the read: one small query against a batch that may be a
    // hundred, and it lands long before Apply is reachable.
    this.checkVersion();

    // The store *is* chained ahead of it, and that is the difference: the field-name
    // pills carry their descriptions as tooltips, and `_storeTagId` is what keeps this
    // plugin's own plumbing tag out of the listing. One small query in front of a read
    // that may take fifteen seconds. A store that cannot be read is not a reason to
    // refuse a bulk edit - the pills simply have nothing to say.
    readStore(this.settings).then(null, function (e) {
      self.msg('WARN', 'The custom field descriptions could not be read: ' +
        (e && e.message ? e.message : String(e)) + ' Field names have no tooltips in ' +
        'this listing; nothing else is affected.');
    }).then(function () {
      return self.load();
    }).then(function () {
      self.setState('listing');
      self.renderList();
      self.summarise();
    }, function (e) {
      self.msg('ERROR', 'Reading custom fields failed: ' + (e && e.message ? e.message : String(e)));
      self.setState('listing');
      self.renderList();
      self.summarise();
    });
  };

  // Re-read and re-list, in place. `begin()` again rather than a second loader: a
  // rescan has to re-check the version and re-warn about someone else's lease for the
  // same reasons the first read did, and both live there.
  //
  // `changes` is deliberately kept, so Undo survives a rescan - it writes by id, not
  // through the entity objects the read has just replaced. A fresh Apply is what
  // replaces it, which is the one thing that can.
  Run.prototype.rescan = function () {
    this.entities = [];
    this.rows = [];
    this.applied = 0;
    this.failed = 0;
    this.undone = 0;
    this.loadingWhat = '';
    // A new listing rather than a rewrite of the one on screen: it is a fresh read of
    // a library that may have moved, and the log says so between the two.
    this.blockEl = null;
    this.msg('INFO', 'Rescanning.');
    this.begin();
  };

  // The line a listing of 155,000 entities cannot give by being scrolled: every
  // custom field name in scope, with how many entities carry it, in the `x250` form
  // the legend describes. Emitted once per read, so a rescan restates it.
  Run.prototype.summarise = function () {
    if (this.storeSkipped) {
      this.msg('INFO', 'The custom field descriptions are kept on tag ' + _storeTagId +
        ', which is left out of this listing: what it carries is this plugin\'s own ' +
        'plumbing. Edit the descriptions in Settings - Tasks - "' + TASK_DESC + '".');
    }
    var t = tally(this.rows, function (r) { return r.name; });
    if (!t.length) {
      this.msg('INFO', 'No custom fields on any of the ' + this.entities.length + ' ' +
        this.noun() + ' in scope.');
      return;
    }
    this.tallyMsg('INFO', 'Custom fields found: ', t, null, true);
  };

  Run.prototype.checkVersion = function () {
    var self = this;
    installedVersion().then(function (installed) {
      if (!installed || installed === PLUGIN_VERSION) {
        console.info('[cfbe] running ' + PLUGIN_VERSION + ', Stash reports ' +
          (installed || 'nothing') + ' installed.');
        return;
      }
      self.stale = true;
      self.note('This page is running ' + PLUGIN_NAME + ' ' + PLUGIN_VERSION + ', but Stash has ' +
        installed + ' installed. Reload the page before applying anything; if this warning ' +
        'comes back, hard-refresh with Ctrl+Shift+R.');
      self.syncApply();
    });
  };

  // ── Reading ───────────────────────────────────────────────────────────────
  //
  // One aliased by-id query per batch of a hundred, rather than a filtered list query
  // per entity type. Every one of the seven has a `find<Type>(id:)`, so one query
  // shape serves all of them and nothing here has to be right about the shape of
  // seven different filter inputs.
  // The store tag carries this plugin's own plumbing - the marker custom field, and
  // whatever marks it hidden from the dropdowns - and none of that is the user's data
  // to bulk edit. So it is left out of every listing here, counted rather than dropped
  // in silence: a tag missing from a whole-library run has to say why, the same as an
  // entity skipped by `plan()` does.
  Run.prototype.keep = function (spec, ent) {
    if (spec.key === 'tags' && _storeTagId && String(ent.id) === _storeTagId) {
      this.storeSkipped++;
      return false;
    }
    return true;
  };

  Run.prototype.load = function () {
    var self = this;
    if (!this.spec) {
      return this.specs.reduce(function (p, spec) {
        return p.then(function () { return self.loadAll(spec); });
      }, Promise.resolve());
    }
    var chunks = [];
    for (var i = 0; i < this.ids.length; i += CHUNK_SIZE) {
      chunks.push(this.ids.slice(i, i + CHUNK_SIZE));
    }
    return chunks.reduce(function (p, chunk) {
      return p.then(function () { return self.loadChunk(chunk); });
    }, Promise.resolve());
  };

  Run.prototype.loadChunk = function (ids) {
    var self = this;
    var spec = this.spec;
    var parts = ids.map(function (id, i) {
      return 'r' + i + ': ' + spec.one + '(id: ' + JSON.stringify(String(id)) + ') { id ' +
        spec.fields + ' custom_fields }';
    });
    return gqlRequest('query CFBE_Read { ' + parts.join(' ') + ' }', null).then(function (data) {
      ids.forEach(function (id, i) {
        var ent = data && data['r' + i];
        // An entity deleted between the selection and the read is reported rather
        // than silently dropped: the count in the head came from the selection.
        if (!ent) { self.msg('WARN', spec.label + ' ' + id + ' no longer exists.'); return; }
        if (!self.keep(spec, ent)) return;
        self.entities.push({
          spec: spec, id: String(ent.id), display: displayName(ent) || 'untitled',
          fields: ent.custom_fields || {},
        });
      });
    });
  };

  // The task's read: one query per type, paged. `per_page: -1` is the repo's
  // convention for "everything" and is what this asked for first - but a library of
  // 155,000 entities answers that in one 15-second silence, with a dialog that looks
  // hung and a counter that goes from nothing to the final number. Reported live.
  //
  // **A progress counter can only count what has arrived**, so the read has to arrive
  // in pieces. `count` comes back with every page, which is what makes the line a
  // fraction rather than a tally, and it costs nothing extra to ask for.
  //
  // `READ_PAGE` is the whole trade: smaller pages update the line more often and cost
  // one round trip each. 5,000 puts a 155,000-entity type at 31 requests and a line
  // that moves several times a second - a thousand would be 155 round trips of
  // latency added to a read the user has already been told is slow.
  //
  // **The query name and the field it returns are both derivable.** `find<Plural>`
  // for all seven, and the list inside it is named by the same plural segment the
  // table is already keyed on - so neither needs a column of its own. If a future
  // Stash breaks that pattern for one type, give that spec an explicit field rather
  // than teaching this function about exceptions.
  //
  // Failures are per type: a Stash that refuses one query still lists the other six,
  // with a line saying which one is missing. Silently showing six sevenths of a
  // library and calling it the library is the outcome worth avoiding.
  Run.prototype.loadAll = function (spec) {
    var self = this;
    var query = 'find' + spec.plural;
    var read = 0;

    function page(n) {
      return gqlRequest('query CFBE_ReadAll { ' + query + '(filter: { per_page: ' +
        READ_PAGE + ', page: ' + n + ' }) { count ' + spec.key + ' { id ' + spec.fields +
        ' custom_fields } } }', null).then(function (data) {
        var res = (data && data[query]) || {};
        var list = res[spec.key] || [];
        list.forEach(function (ent) {
          if (!self.keep(spec, ent)) return;
          self.entities.push({
            spec: spec, id: String(ent.id), display: displayName(ent) || 'untitled',
            fields: ent.custom_fields || {},
          });
        });
        read += list.length;
        self.loadingWhat = spec.plural.toLowerCase() + ' - ' + read +
          (typeof res.count === 'number' ? ' of ' + res.count : '');
        self.renderProgress();
        // A short page is the last one. A last page that happens to be exactly full
        // costs one more query returning nothing, which is cheaper than trusting
        // `count` to agree with what a concurrent edit leaves in the list.
        if (list.length >= READ_PAGE) return page(n + 1);
      });
    }

    return page(1).then(null, function (e) {
      self.msg('ERROR', 'Reading ' + spec.plural.toLowerCase() + ' failed: ' +
        (e && e.message ? e.message : String(e)) + ' They are not in this listing, ' +
        'and nothing here will write to them.');
    });
  };

  // ── The listing ───────────────────────────────────────────────────────────

  Run.prototype.buildRows = function () {
    var rows = [];
    this.entities.forEach(function (e) {
      var names = [];
      for (var k in e.fields) { if (hasOwn(e.fields, k)) names.push(k); }
      names.sort();
      names.forEach(function (k) {
        rows.push({ spec: e.spec, id: e.id, display: e.display,
          name: k, value: valueText(e.fields[k]), raw: e.fields[k] });
      });
    });
    this.rows = rows;
  };

  // `[['a', 12], ['b', 3]]` over whatever `key` names, sorted. One function for every
  // summary line: the read counts field names, an Apply counts Added/Replaced/Deleted,
  // a skipped Add counts the values it left alone. Pairs rather than the joined string
  // it returned until 0.6.0, because a name in a summary is worth a copy pill and a
  // string cannot carry one - `tallyText` is the same line where plain text will do.
  function tally(items, key) {
    var counts = {};
    var names = [];
    items.forEach(function (item) {
      var k = key(item);
      if (!hasOwn(counts, k)) { counts[k] = 0; names.push(k); }
      counts[k]++;
    });
    names.sort();
    return names.map(function (n) { return [n, counts[n]]; });
  }

  function tallyText(t) {
    return t.map(function (pair) { return pair[0] + ' x' + pair[1]; }).join(', ');
  }

  // ── Pills ─────────────────────────────────────────────────────────────────
  //
  // A line reads `<Type> {"name" (id)}: {field}🟰{value}`, and a change line is the
  // same with an action pill in front and a before ⇒ after. Three kinds, three
  // behaviours: the action pill says what happened and does nothing, the entity pill
  // is a link to that entity, and a field name or value copies itself.
  function textNode(s) { return el('span', null, s); }

  // Real text, not `content:` on an empty span, and that is the second thing this
  // mark has been through. Generated content cannot be selected: it paints no
  // highlight when the user drags across the line, so a line with a mark in it looked
  // like it had a hole in the selection. Selectable is worth more than the guarantee
  // the empty span bought, because the guarantee can be had another way - see
  // `selectionText`, which drops the mark *elements* from what gets copied.
  function noneNode(title) {
    var n = el('span', 'cfbe-none', NONE);
    n.title = title;
    return n;
  }

  // What a copy out of the list should say: the values the entities really have, with
  // the marks left out - they stand for nothing being there, so they stand for nothing
  // in the text either.
  //
  // Read off a *clone* of the selected range with the mark elements removed, never by
  // stripping the mark's character out of the string: an entity name is free to
  // contain that character, and this user's names are full of Unicode marks. Changing
  // `NONE` therefore stays a one-line change, which is what it was.
  //
  // `cloneContents` keeps the ancestors of a partial selection, so a multi-row
  // selection arrives as one `.cfbe-entry` per line and a within-one-row selection as
  // the pills themselves - which is why the newline goes in only between entries.
  function selectionText(sel) {
    var plain = sel ? String(sel) : '';
    if (!plain || !sel.rangeCount || !sel.getRangeAt) return plain;
    var frag;
    try { frag = sel.getRangeAt(0).cloneContents(); } catch (e) { return plain; }
    if (!frag || !frag.querySelectorAll || !frag.childNodes) return plain;
    var marks = frag.querySelectorAll('.cfbe-none');
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].parentNode) marks[i].parentNode.removeChild(marks[i]);
    }
    var out = '';
    for (var j = 0; j < frag.childNodes.length; j++) {
      var kid = frag.childNodes[j];
      if (j && hasClass(kid, 'cfbe-entry')) out += '\n';
      out += kid.textContent || '';
    }
    return out;
  }

  function pill(kind, text) { return el('span', 'cfbe-pill cfbe-pill-' + kind, text); }

  function entityPill(spec, id, display) {
    var a = el('a', 'cfbe-pill cfbe-pill-ent', '"' + display + '" (' + id + ')');
    a.href = '/' + spec.key + '/' + id;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Open this ' + spec.label.toLowerCase() + ' in a new tab';
    return a;
  }

  // An empty name or value is a real thing to store, and it was rendering as a pill
  // with nothing in it - indistinguishable from a bug, and the actual complaint that
  // sent this round. It gets the same ∅ the absent side gets, for the same reason and
  // by the same mechanism: the pill's *text* stays empty, so a click still copies the
  // empty string and a selection still reads it as one.
  // `named` says this pill holds a custom field *name* rather than a value, which is
  // the only thing that can carry a description. Passed by the caller rather than
  // guessed from the store: a value that happens to read like a field name is a value,
  // and a tooltip explaining it as a field would be a confident lie.
  function copyPill(text, named) {
    var p = pill('cf', text === '' ? null : text);
    if (text === '') p.appendChild(noneNode('empty - this field is set, to nothing'));
    var desc = named && hasOwn(_descriptions, text) ? String(_descriptions[text] || '') : '';
    // What the click does comes first, because it is true of every pill; the
    // description is what only some of them have, and it is the longer half. A name
    // pill says *which* of the two things on the line it copies, and labels the
    // description rather than letting a sentence run on from the click.
    p.title = named
      ? 'Click to copy Name' + (desc ? '\nDescription: ' + desc : '')
      : 'Click to copy';
    p.addEventListener('click', function () {
      // A drag-select that ends inside a pill fires a click, and copying the pill
      // there would take the clipboard off the selection the user just made. A plain
      // click has already collapsed any selection by the time it arrives.
      if (window.getSelection && String(window.getSelection())) return;
      var base = 'cfbe-pill cfbe-pill-cf';
      copyToClipboard(text, function (ok) {
        p.className = base + (ok ? ' cfbe-pill-copied' : ' cfbe-pill-failed');
        setTimeout(function () { p.className = base; }, 900);
      });
    });
    return p;
  }

  // A field side of a line: the pair, or ∅ where there is no field on that side.
  function appendField(row, field) {
    if (!field) { row.appendChild(noneNode('no field here')); return; }
    row.appendChild(copyPill(field.name, true));
    row.appendChild(textNode(EQ));
    row.appendChild(copyPill(field.value));
  }

  Run.prototype.rowNode = function (r, action, before, after) {
    var row = el('div', 'cfbe-entry');
    if (action) {
      row.appendChild(pill('act', action));
      row.appendChild(textNode(' '));
    }
    // The row's own spec, not the run's: a task run has seven types in one listing,
    // and the type word in front of a line is the only thing that says which.
    var spec = r.spec || this.spec;
    row.appendChild(textNode(spec.label + ' '));
    row.appendChild(entityPill(spec, r.id, r.display));
    row.appendChild(textNode(': '));
    appendField(row, before);
    if (action) {
      row.appendChild(textNode(ARROW));
      appendField(row, after);
    }
    return row;
  };

  // The same line as `rowNode`, as text. The ␀ marks are left out for the reason a
  // copied *selection* leaves them out: they stand for nothing being there, so they
  // stand for nothing in the text either.
  function fieldText(field) { return field ? field.name + EQ + field.value : ''; }

  Run.prototype.lineText = function (r, action, before, after) {
    var spec = r.spec || this.spec;
    return (action ? action + ' ' : '') + spec.label + ' "' + r.display + '" (' + r.id + '): ' +
      fieldText(before) + (action ? ARROW + fieldText(after) : '');
  };

  // Which side of a change holds a field, and what to call what happened. Read off
  // the two sides rather than off the mode, which is what makes an undo name itself
  // correctly: reversing an Added is a Deleted. One function, because the node, the
  // text and the summary tally all have to agree about it.
  function changeSides(c, reversed) {
    var before = c.had ? { name: c.name, value: valueText(c.before) } : null;
    // `c.to` is a rename: the value is the same on both sides and the *name* moves,
    // which is also why the action word cannot be read off which side is missing.
    var after = c.remove ? null : { name: c.to || c.name, value: valueText(c.after) };
    if (reversed) { var swap = before; before = after; after = swap; }
    return { before: before, after: after,
      action: c.to ? 'Renamed' : !before ? 'Added' : !after ? 'Deleted' : 'Replaced' };
  }

  // One place where the cap is applied, so both the listing and the change recap say
  // the same thing when there is more than the DOM should hold. `text` runs over
  // *every* item, capped or not: Copy log is not a copy of the DOM, and it hangs on
  // the block rather than on the run so an earlier block can still be copied whole.
  //
  // A listing goes into a block of its own, appended after whatever the log already
  // holds. Re-filtering rewrites the current block in place - it restates what is in
  // scope *now*, and one new listing per keystroke is not a history of anything -
  // while a rescan or a write clears `blockEl` first and so starts another.
  Run.prototype.fillList = function (items, build, text) {
    var self = this;
    var block = this.blockEl;
    if (!block) {
      block = this.blockEl = el('div', 'cfbe-block');
      this.listEl.appendChild(block);
    }
    while (block.firstChild) block.removeChild(block.firstChild);
    block._text = items.map(function (item) { return text.call(self, item); });
    items.slice(0, LIST_RENDER_CAP).forEach(function (item) {
      block.appendChild(build.call(self, item));
    });
    if (items.length > LIST_RENDER_CAP) {
      block.appendChild(el('div', 'cfbe-entry cfbe-INFO',
        '... and ' + plural(items.length - LIST_RENDER_CAP, 'more line') + ' not shown. ' +
        'Filter to narrow the list; every one of them is still in scope.'));
    }
  };

  // The two modes every text filter here offers, and the only two that read the box
  // beside them - the value filter's other three are the whole query on their own.
  var TEXT_MODES = [['contains', 'contains'], ['omits', 'omits']];

  function needsText(mode) { return mode === 'contains' || mode === 'omits'; }

  // An empty box filters nothing, in **either** mode: "omits nothing" is every row, not
  // none. Everything else is one `indexOf`, negated for "omits".
  function textMatch(hay, needle, mode) {
    if (!needle) return true;
    var found = String(hay).toLowerCase().indexOf(needle) !== -1;
    return mode === 'omits' ? !found : found;
  }

  // The entity as one string to filter on. Not the pill's own text, which quotes the
  // name: typing what the row shows has to work, and `"Cool Scene" (42)` would then
  // refuse `Cool Scene (42)` over a quote nobody thinks of as part of the name.
  function entityText(r) { return r.display + ' (' + r.id + ')'; }

  // The value test is judged on the **raw** value, not on the text the row shows: an
  // empty array is `[]` on screen and not-true underneath, and the mode has to agree
  // with the dropdown filter that reads the same field, which never sees the text.
  Run.prototype.filtered = function () {
    var name = String(this.nameFilter.value || '').toLowerCase();
    var nameMode = this.nameMode.value;
    var ent = String(this.entFilter.value || '').toLowerCase();
    var entMode = this.entMode.value;
    var type = this.typeFilter ? this.typeFilter.value : '';
    var mode = this.valueMode.value;
    var value = needsText(mode) ? String(this.valueFilter.value || '').toLowerCase() : '';
    return this.rows.filter(function (r) {
      if (type && r.spec.key !== type) return false;
      if (!textMatch(r.name, name, nameMode)) return false;
      if (!textMatch(entityText(r), ent, entMode)) return false;
      if (mode === 'empty') return r.value === '';
      if (mode === 'true') return isMarked(r.raw);
      if (mode === 'nottrue') return !isMarked(r.raw);
      return textMatch(r.value, value, mode);
    });
  };

  Run.prototype.renderList = function () {
    this.buildRows();
    var rows = this.filtered();
    this.fillList(rows, function (r) {
      return this.rowNode(r, null, { name: r.name, value: r.value });
    }, function (r) {
      return this.lineText(r, null, { name: r.name, value: r.value });
    });
    this.renderProgress(rows.length);
    this.syncOps(rows);
  };

  // Is any filter actually narrowing the listing? The three truth/empty modes are a
  // filter with an empty box, which is why this cannot just test the text boxes. A mode
  // that *does* read a box is not itself a filter: "omits" with nothing typed in keeps
  // every row, so testing the mode there would switch the scope for no narrowing at all.
  Run.prototype.filtering = function () {
    return !!(this.typeFilter && this.typeFilter.value) ||
      !!String(this.nameFilter.value || '') ||
      !!String(this.entFilter.value || '') ||
      !needsText(this.valueMode.value) ||
      !!String(this.valueFilter.value || '');
  };

  // **Touching a filter moves the scope to "Filtered list only".** Asked for from live
  // use, and it is the safer direction by construction: the scope can only ever narrow
  // to what is on screen, never widen behind the user. It moves back to "All" when the
  // last filter is cleared, which is not a second rule - with nothing filtering, the
  // two selections cover the same entities and the select should say the simpler one.
  Run.prototype.filterChanged = function () {
    this.scopeSel.value = this.filtering() ? 'filtered' : 'all';
    this.renderList();
  };

  // The one field name everything in scope carries, or null if they carry more than one
  // - which is the whole of Rename's precondition. `rows` is passed in where the caller
  // has just computed it: this runs on every keystroke in a filter box, over a listing
  // that can be six figures long.
  Run.prototype.renameFrom = function (rows) {
    var scoped = this.scopeSel.value === 'filtered'
      ? (rows || this.filtered()) : this.rows;
    var name = null;
    for (var i = 0; i < scoped.length; i++) {
      if (name === null) name = scoped[i].name;
      else if (scoped[i].name !== name) return null;
    }
    return name;
  };

  // Rename is offered only while the scope carries exactly one field name, and the
  // value box is not part of it. A mode that *becomes* unavailable while selected stays
  // selected - silently switching the operation under a user about to press Apply would
  // be worse than a disabled button that says why.
  Run.prototype.syncOps = function (rows) {
    var rename = this.modeSel.value === 'rename';
    this.renameName = this.renameFrom(rows);
    if (this.modeSel._opts && this.modeSel._opts.rename) {
      this.modeSel._opts.rename.disabled = !this.renameName;
    }
    this.modeSel.title = MODE_TIPS[this.modeSel.value] || '';
    this.scopeSel.title = SCOPE_TIPS[this.scopeSel.value] || '';
    this.valueInput.disabled = rename || this.state !== 'listing';
    this.nameLabel.textContent = rename ? 'New Custom Field name' : 'Custom Field name';
    this.syncApply();
  };

  // What to call the things in scope. A selection run knows its one type; the task
  // has seven and calls them entities, which is also what the counters say.
  Run.prototype.noun = function () {
    return this.spec ? this.spec.plural.toLowerCase() : 'entities';
  };

  Run.prototype.renderProgress = function (listed) {
    var withFields = this.entities.filter(function (e) {
      for (var k in e.fields) { if (hasOwn(e.fields, k)) return true; }
      return false;
    }).length;

    var summary;
    if (this.state === 'loading') {
      // The task has no denominator until every type has answered, so it counts up
      // rather than towards - and names the type it is on, since one of the seven can
      // be most of the wait on a large library.
      summary = this.spec
        ? 'Loading. ' + this.entities.length + ' of ' + this.ids.length + ' read'
        : 'Loading ' + (this.loadingWhat || '') + '. ' + this.entities.length + ' read so far';
    } else if (this.state === 'applying') {
      summary = 'Applying. ' + this.applied + ' of ' + plural(this.changes.length, 'entity change') + ' written';
    } else if (this.state === 'undoing') {
      summary = 'Undoing. ' + this.undone + ' of ' + plural(this.changes.length, 'change') + ' reversed';
    } else if (this.state === 'applied') {
      summary = 'Applied. ' + plural(this.applied, 'entity change') + ' written' +
        (this.failed ? ', ' + this.failed + ' failed' : '') +
        (this.undone ? ', ' + this.undone + ' reversed by Undo' : '');
    } else {
      summary = this.entities.length + ' ' + this.noun() + ' read, ' +
        withFields + ' with custom fields, ' + plural(this.rows.length, 'field') + ' in total, ' +
        plural(listed == null ? this.rows.length : listed, 'line') + ' listed';
    }
    this.progressEl.textContent = summary;
  };

  // ── Applying ──────────────────────────────────────────────────────────────

  // What the three modes mean, and why they are not Stash's own bulk tabs: a custom
  // field holds one value per key, so there is no list to append to. "Add" therefore
  // means *do not overwrite* - only entities that do not already carry the key are
  // written - and "Overwrite" means every entity in scope regardless. That is the
  // distinction worth having, and it is the only one the data shape allows.
  Run.prototype.plan = function () {
    var mode = this.modeSel.value;
    var name = String(this.nameInput.value || '').replace(/^\s+|\s+$/g, '');
    var value = String(this.valueInput.value || '');

    var scope = this.entities;
    if (this.scopeSel.value === 'filtered') {
      // Keyed by type *and* id: ids are only unique within a type, and a task run has
      // all seven in one listing - so a filtered scene 5 would otherwise carry tag 5
      // into the write with it.
      var keep = {};
      this.filtered().forEach(function (r) { keep[r.spec.key + ':' + r.id] = true; });
      scope = scope.filter(function (e) { return hasOwn(keep, e.spec.key + ':' + e.id); });
    }

    // Three reasons an entity in scope gets no change, all of them worth a line: they
    // are the difference between "it worked" and "it did nothing to half of these",
    // and the dialog said the same thing either way until 0.6.0. The order matters -
    // an "Add" over a key that already holds the asked-for value is *unchanged*, not
    // *refused*, so the equal-value test runs first for every mode that writes one.
    var changes = [];
    var skipped = { present: [], unchanged: [], absent: [], collide: [] };

    // Rename is the one mode whose *source* field is not the one in the box: the box
    // holds the new name, and the old one is whatever the scope carries - which is why
    // it is only offered while the scope carries exactly one. `from` is read here
    // rather than trusted from `syncOps`, so a plan is never made from a stale answer.
    if (mode === 'rename') {
      var from = this.renameFrom();
      scope.forEach(function (e) {
        if (!from || !hasOwn(e.fields, from)) { skipped.absent.push(e); return; }
        if (name === from) { skipped.unchanged.push(e); return; }
        // The write is `partial` plus `remove` in one input, so an entity that already
        // carries the new name would have it overwritten and the old value lost. That
        // is a merge, not a rename, and it is not this dialog's to decide.
        if (hasOwn(e.fields, name)) { skipped.collide.push({ value: valueText(e.fields[name]) }); return; }
        changes.push({
          spec: e.spec, id: e.id, display: e.display, entity: e, name: from, to: name,
          had: true, before: e.fields[from], after: e.fields[from], remove: false,
        });
      });
      return { mode: mode, name: name, from: from, value: value,
        changes: changes, skipped: skipped };
    }

    scope.forEach(function (e) {
      var has = hasOwn(e.fields, name);
      var now = has ? valueText(e.fields[name]) : null;
      if (mode === 'remove') {
        if (!has) { skipped.absent.push(e); return; }
      } else if (has && now === value) {
        skipped.unchanged.push(e); return;
      } else if (mode === 'add' && has) {
        skipped.present.push({ value: now }); return;
      }
      changes.push({
        spec: e.spec, id: e.id, display: e.display, entity: e, name: name,
        had: has, before: has ? e.fields[name] : null,
        after: mode === 'remove' ? null : value, remove: mode === 'remove',
      });
    });
    return { mode: mode, name: name, value: value, changes: changes, skipped: skipped };
  };

  // What a value looks like inside a sentence, where an empty one has to say so.
  function quoted(value) { return value === '' ? 'empty' : '"' + value + '"'; }

  // What each operation does, in the tooltip rather than in a legend: the four differ
  // in what they refuse, which is the part a caption cannot carry. "Add" not
  // overwriting is the one that has surprised people (§6), and Rename's condition is
  // the one that explains why it is sometimes greyed out.
  var MODE_TIPS = {
    add: 'Set the field only where it is missing. An entity that already carries it is ' +
      'left alone, whatever its value - "Add" never overwrites.',
    overwrite: 'Set this one field on every entity in scope, replacing the value it ' +
      'already has there. Every other custom field on those entities is left untouched - ' +
      '"Overwrite" replaces one field\'s value, never an entity\'s whole set of fields.',
    remove: 'Delete this one field from every entity in scope that has it. The entity\'s ' +
      'other custom fields are left untouched.',
    rename: 'Rename the field itself, keeping each entity\'s value. Available only when ' +
      'everything in scope carries the same one field name; "Custom Field name" is the ' +
      'new name, and the value box is not used.',
  };

  var SCOPE_TIPS = {
    all: 'Every entity this dialog read, whatever the filters are showing.',
    filtered: 'Only the entities the filters leave on screen. Changing a filter switches ' +
      'to this on its own.',
  };

  Run.prototype.reportSkips = function (planned) {
    var s = planned.skipped;
    var noun = ' ' + this.noun() + ': "' + planned.name + '" ';
    if (planned.mode === 'rename') {
      if (s.absent.length) {
        this.msg('INFO', 'Skipped ' + s.absent.length + ' ' + this.noun() + ': "' +
          (planned.from || '') + '" is not set there, so there is nothing to rename.');
      }
      if (s.unchanged.length) {
        this.msg('INFO', 'Skipped ' + s.unchanged.length + ' ' + this.noun() +
          ': the new name is the name it already has.');
      }
      if (s.collide.length) {
        this.tallyMsg('WARN', 'Skipped ' + s.collide.length + ' ' + this.noun() + ': "' +
          planned.name + '" is already set there, and renaming onto it would ' +
          'overwrite that value. Kept: ',
        tally(s.collide, function (r) { return r.value; }),
        '. Remove or rename that field first.');
      }
      return;
    }
    if (s.present.length) {
      this.tallyMsg('WARN', 'Skipped ' + s.present.length + noun +
        'is already set there to another value, and "Add" never overwrites. Kept: ',
      tally(s.present, function (r) { return r.value; }),
      '. Use "Overwrite" to replace them.');
    }
    if (s.unchanged.length) {
      this.msg('INFO', 'Skipped ' + s.unchanged.length + noun + 'is already ' +
        quoted(planned.value) + ' there, so there is nothing to write.');
    }
    // An INFO rather than a WARN, for the reason the one above it is: nothing was
    // refused, the end state asked for is already the one on the entity.
    if (s.absent.length) {
      this.msg('INFO', 'Skipped ' + s.absent.length + noun +
        'is not set there, so there is nothing to remove.');
    }
  };

  // Renaming the field the **Hide from Add Lists** setting names is a rename of the
  // setting too, and nothing else here can notice it: leave the setting on the old name
  // and the dropdown filter goes on looking for a field nothing carries any more, so
  // every entity the user had hidden quietly comes back into the add lists. The store
  // tag carries that field to hide *itself* and is never in this dialog's scope
  // (`keep`), so its own mark has to be moved by hand or it un-hides itself the same way.
  //
  // The description filed under the old name is deliberately *not* moved here. The
  // descriptions dialog compares the store's `hideField` with the setting and moves it
  // on its next open - that is the code that knows how to write the store, and this one
  // would be a second copy of it.
  // A rename moves the field's **description** with it, for every field and not only
  // the hide one: the description is filed under the name, so a rename that left it
  // behind turned it into an orphan and left the renamed field undescribed - the value
  // follows the name, and this is the other thing that has to.
  //
  // It writes the store from the module-level copy `readStore` cached, because the bulk
  // dialog holds no store of its own. Refused rather than forced in the two states the
  // descriptions dialog also refuses to write in - a description that is not our JSON,
  // and a store stamped by a newer release - since both are cases where writing the
  // whole blob back is what loses something. Resolves either way, so the caller can
  // chain the hide-field rename after it and never have two writes to one tag in
  // flight at once.
  Run.prototype.moveDescription = function (from, to) {
    var self = this;
    if (!_storeTagId || !_store || !hasOwn(_descriptions, from)) return Promise.resolve();
    if (_store.broken || (_store.version && cmpVersion(_store.version, PLUGIN_VERSION) > 0)) {
      this.msg('WARN', 'The description filed under "' + from + '" stays there: the ' +
        'description store on tag ' + _storeTagId + ' is ' + (_store.broken
        ? 'not something this plugin wrote' : 'from a newer release') + ', and this ' +
        'dialog will not write over it. "Manage Custom Field Descriptions..." says how ' +
        'to recover it.');
      return Promise.resolve();
    }
    if (hasOwn(_descriptions, to)) {
      this.msg('INFO', '"' + to + '" already has a description, so the one under "' +
        from + '" was left where it is rather than written over. Both are in "Manage ' +
        'Custom Field Descriptions...".');
      return Promise.resolve();
    }

    var descriptions = {};
    for (var k in _descriptions) {
      if (hasOwn(_descriptions, k)) descriptions[k === from ? to : k] = _descriptions[k];
    }
    // The store records which field the hide setting named when it was last written, so
    // a rename of *that* field moves this too - or the descriptions dialog would read
    // the difference as a rename of the setting and offer to migrate a library that has
    // already moved.
    var hideField = _store.hideField === from ? to : _store.hideField;
    return gqlRequest('mutation CFBE_TagUpdate($input: TagUpdateInput!) ' +
      '{ tagUpdate(input: $input) { id } }',
    { input: { id: _storeTagId, description: serialiseStore(
      { hideField: hideField, descriptions: descriptions }) } })
      .then(function () {
        _descriptions = descriptions;
        _store = { version: PLUGIN_VERSION, hideField: hideField, descriptions: descriptions };
        self.msg('INFO', 'The description of "' + from + '" moved to "' + to +
          '" in the description store.');
      }, function (e) {
        self.msg('WARN', 'The field was renamed, but its description is still filed ' +
          'under "' + from + '": ' + (e && e.message ? e.message : String(e)) +
          ' Move it by hand in "Manage Custom Field Descriptions...".');
      });
  };

  // Decided against the **live** setting rather than against `this.settings`: a
  // selection run opens without reading the settings at all (`startRun` hands it
  // `DEFAULTS`), so its own copy would say "Exclude_from_add_list" for a user who has
  // named the field something else - and a rename of that default would then move a
  // setting that was never pointing at it. Resolves to whether the setting moved, which
  // is what an Undo needs to know.
  //
  // The whole map goes back because `configurePlugin` replaces `plugins.<id>` rather
  // than merging it, the same reason `seedDefaults` sends `raw` along with its keys.
  Run.prototype.followHideRename = function (from, to) {
    var self = this;
    return gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var raw = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
      if (effective(raw, 'c1ExcludeFromAddListField') !== from) return false;
      var input = {};
      for (var k in raw) if (hasOwn(raw, k)) input[k] = raw[k];
      input.c1ExcludeFromAddListField = to;
      return gqlRequest('mutation CFBE_SetSetting($id: ID!, $input: Map!) ' +
        '{ configurePlugin(plugin_id: $id, input: $input) }',
      { id: PLUGIN_ID, input: input }).then(function () {
        self.settings.c1ExcludeFromAddListField = to;
        self.msg('INFO', 'The "Hide from Add Lists - Custom Field Name" setting now ' +
          'reads "' + to + '", so what was marked with "' + from + '" stays hidden ' +
          'from the add lists. Its description moves with it the next time "Manage ' +
          'Custom Field Descriptions..." is opened.');
        self.moveStoreMark(from, to);
        return true;
      });
    }, function (e) {
      self.msg('WARN', 'The field was renamed, but the "Hide from Add Lists - Custom ' +
        'Field Name" setting could not be updated: ' +
        (e && e.message ? e.message : String(e)) + ' Set it to "' + to + '" by hand, or ' +
        'nothing marked with it is hidden from the add lists any more.');
      return false;
    });
  };

  // The store tag marks *itself* with the hide field, and is never in this dialog's
  // scope (`keep`) - so its mark is the one the rename cannot reach on its own, and a
  // tag left carrying the old name stops hiding itself.
  Run.prototype.moveStoreMark = function (from, to) {
    var self = this;
    if (!_storeTagId || !hasOwn(_storeTagFields, from)) return;
    var mark = {};
    mark[to] = MARK_VALUE;
    gqlRequest('mutation CFBE_TagUpdate($input: TagUpdateInput!) ' +
      '{ tagUpdate(input: $input) { id } }',
    { input: { id: _storeTagId, custom_fields: { partial: mark, remove: [from] } } })
      .then(function () {
        delete _storeTagFields[from];
        _storeTagFields[to] = MARK_VALUE;
      }, function () {
        self.msg('WARN', 'The description store tag (' + _storeTagId + ') still carries "' +
          from + '" rather than "' + to + '", so it may start showing up in the add lists.');
      });
  };

  Run.prototype.apply = function () {
    var self = this;
    var planned = this.plan();
    this.reportSkips(planned);
    if (!planned.changes.length) {
      this.msg('INFO', 'Nothing to change: no ' + this.noun() +
        ' in scope need "' + planned.name + '" ' +
        (planned.mode === 'remove' ? 'removed.'
          : planned.mode === 'rename' ? 'as their field name.' : 'set to that value.'));
      return;
    }

    this.changes = planned.changes;
    this.applied = 0;
    this.failed = 0;
    this.undone = 0;
    this.setState('applying');
    this.renderProgress();

    // Grouped by the delta each entity needs, which for an apply is one delta for all
    // of them: an ADD/Overwrite sets the same key to the same value, and a Remove
    // drops the same key. So this is one bulk mutation per chunk, not one per entity.
    var payload = planned.mode === 'remove'
      ? { remove: [planned.name] }
      : (function () { var p = {}; p[planned.name] = planned.value; return { partial: p }; })();

    // One batch per entity type, because the mutation is per type: five of the seven
    // take a bulk update and two do not, and an id means nothing without the type it
    // belongs to. A selection run has exactly one batch, as it always did.
    //
    // **A rename groups by value as well**, because it carries each entity's own value
    // over to the new key - the same grouping Undo below uses, and for the same reason.
    var byType = {};
    var batches = [];
    planned.changes.forEach(function (c) {
      var key = planned.mode === 'rename'
        ? c.spec.key + '|' + valueText(c.before) : c.spec.key;
      if (!hasOwn(byType, key)) {
        byType[key] = { spec: c.spec, ids: [], cf: planned.mode === 'rename'
          ? (function () { var p = {}; p[c.to] = c.before;
            return { partial: p, remove: [c.name] }; })()
          : payload };
        batches.push(byType[key]);
      }
      byType[key].ids.push(c.id);
    });
    var label = 'Custom Fields - ' + planned.mode + ' "' + planned.name + '"';

    this.runWrites(batches, label).then(function (ok) {
      self.applied = ok;
      // Only once something was actually written: a rename that failed everywhere must
      // not move a description, or the setting, off the name the library still carries.
      if (ok && planned.mode === 'rename' && planned.from) {
        self.moveDescription(planned.from, planned.name)
          .then(function () { return self.followHideRename(planned.from, planned.name); })
          .then(function (moved) {
            if (moved) self.hideRename = { from: planned.from, to: planned.name };
          });
      }
      // The local copy is moved with the server's, so Undo compares against what the
      // dialog actually wrote rather than against the map it read at open.
      planned.changes.forEach(function (c) {
        if (planned.mode === 'remove') delete c.entity.fields[c.name];
        else if (planned.mode === 'rename') {
          c.entity.fields[c.to] = c.before;
          delete c.entity.fields[c.name];
        } else c.entity.fields[c.name] = planned.value;
      });
      self.renderChanges(planned, false);
      self.setState('applied');
      self.renderProgress();
    });
  };

  // Undo replays each change as its own inverse: put the previous value back where
  // there was one, remove the key where there was not. A stored copy of the whole map
  // written back would be simpler and wrong - it would revert every unrelated edit
  // made in between, which is the one thing an undo must not do.
  //
  // It arms and asks, with the count in the caption: one click here starts a write
  // across a selection, with Close as its neighbour.
  Run.prototype.undo = function () {
    var self = this;
    var now = Date.now();
    if (!this.undoArmed || now - this.undoArmed > UNDO_ARM_MS) {
      this.undoArmed = now;
      this.undoBtn.textContent = 'Undo ' + plural(this.changes.length, 'change') + '?';
      setTimeout(function () {
        if (self.undoBtn.textContent !== 'Undo') self.undoBtn.textContent = 'Undo';
      }, UNDO_ARM_MS);
      return;
    }
    this.undoArmed = 0;
    this.undoBtn.textContent = 'Undo';

    // One batch per distinct previous value, plus one for everything that had no
    // value at all. Entities that shared a value before the apply share a mutation.
    var groups = {};
    this.changes.forEach(function (c) {
      // By type as well as by previous value, for the reason `apply` groups by type.
      var key = c.spec.key + '|' + (c.had ? 'v:' + valueText(c.before) : 'absent');
      if (!groups[key]) {
        // Reversing a rename puts the old key back *and* takes the new one off - one
        // input, both halves, or the undo would leave the field under both names.
        groups[key] = { spec: c.spec, ids: [], cf: c.to
          ? (function () { var p = {}; p[c.name] = c.before;
            return { partial: p, remove: [c.to] }; })()
          : c.had
            ? (function () { var p = {}; p[c.name] = c.before; return { partial: p }; })()
            : { remove: [c.name] } };
      }
      groups[key].ids.push(c.id);
    });

    var batches = [];
    for (var k in groups) { if (hasOwn(groups, k)) batches.push(groups[k]); }

    this.setState('undoing');
    this.renderProgress();
    this.runWrites(batches, 'Custom Fields (undo)').then(function (ok) {
      self.undone = ok;
      // The description followed the rename out, and the setting with it where the
      // rename was the hide field's; both follow the undo back. Read off the changes
      // rather than remembered separately - `c.to` is what a rename leaves on one.
      var ren = null;
      self.changes.forEach(function (c) { if (!ren && c.to) ren = { from: c.name, to: c.to }; });
      if (ok && ren) {
        self.moveDescription(ren.to, ren.from).then(function () {
          if (!self.hideRename) return null;
          var h = self.hideRename;
          self.hideRename = null;
          return self.followHideRename(h.to, h.from);
        });
      }
      self.changes.forEach(function (c) {
        if (c.to) delete c.entity.fields[c.to];
        if (c.had) c.entity.fields[c.name] = c.before;
        else delete c.entity.fields[c.name];
      });
      self.renderChanges(null, true);
      // Back to `applied` rather than to `listing`: the listing this dialog opened
      // with describes a library it has now written to twice, and re-offering Apply
      // over it would write from a plan nobody is looking at. **Rescan** is the way
      // back to a plan, and it is in the footer beside this.
      //
      // `changes` is kept, so Undo stays offered until the dialog closes. Pressing it
      // again re-asserts the same before-values, which is idempotent - it was cleared
      // here until 0.4.0, which left an undone run with Close as its only option.
      self.setState('applied');
      self.renderProgress();
    });
  };

  // The one write driver, shared by Apply and Undo. Takes the lease, renews it per
  // batch and releases it in every outcome - success, failure, an empty batch list -
  // so a reactive plugin is never left standing down.
  Run.prototype.runWrites = function (batches, label) {
    var self = this;
    var lease = acquireLease(label);
    var ok = 0;

    // One chunk per bulk mutation - or per *entity* where there is no bulk mutation,
    // so that one refused Studio is reported as one failure rather than taking the
    // ninety-nine that were written with it out of the count. The batch carries the
    // spec, so a task run's Studios chunk one at a time while its Scenes go a hundred
    // at a time, in the same pass.
    var chunks = [];
    batches.forEach(function (b) {
      var size = b.spec.bulk ? CHUNK_SIZE : 1;
      for (var i = 0; i < b.ids.length; i += size) {
        chunks.push({ spec: b.spec, ids: b.ids.slice(i, i + size), cf: b.cf });
      }
    });

    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        lease.renew();
        return self.writeChunk(chunk.spec, chunk).then(function () {
          ok += chunk.ids.length;
          self.applied = self.state === 'applying' ? ok : self.applied;
          self.undone = self.state === 'undoing' ? ok : self.undone;
          self.renderProgress();
        }, function (e) {
          self.failed += chunk.ids.length;
          self.msg('ERROR', 'Writing ' + chunk.ids.length + ' ' +
            chunk.spec.plural.toLowerCase() + ' failed: ' +
            (e && e.message ? e.message : String(e)));
        });
      });
    }, Promise.resolve()).then(function () {
      lease.release();
      return ok;
    }, function (e) {
      lease.release();
      throw e;
    });
  };

  // Five of the seven take the whole chunk in one bulk mutation. Studio and Tag have
  // no `custom_fields` on their bulk input, so they arrive here one id at a time
  // (`runWrites` chunks them that way) and go out as single updates - sequentially,
  // for the same reason everything else here is sequential: a hundred parallel writes
  // against a Stash that is also serving the page is not a kindness.
  Run.prototype.writeChunk = function (spec, chunk) {
    if (spec.bulk) {
      return gqlRequest('mutation CFBE_' + spec.bulk + '($input: ' + spec.bulkInput + '!) { ' +
        spec.bulk + '(input: $input) { id } }',
      { input: { ids: chunk.ids, custom_fields: chunk.cf } });
    }
    return gqlRequest('mutation CFBE_' + spec.single + '($input: ' + spec.singleInput +
      '!) { ' + spec.single + '(input: $input) { id } }',
    { input: { id: chunk.ids[0], custom_fields: chunk.cf } });
  };

  // After a write the log gains what happened, under the listing that described the
  // library before it. The older block is not a claim about now - it is what was
  // there, with the [INFO] line saying what was done to it in between.
  Run.prototype.renderChanges = function (planned, reversed) {
    this.blockEl = null;
    this.fillList(this.changes, function (c) {
      var s = changeSides(c, reversed);
      return this.rowNode(c, s.action, s.before, s.after);
    }, function (c) {
      var s = changeSides(c, reversed);
      return this.lineText(c, s.action, s.before, s.after);
    });
    // Counted over every change, never over the rendered rows: the listing stops at
    // LIST_RENDER_CAP and the summary is the thing that has to be right about a write
    // bigger than the screen.
    var acts = tallyText(tally(this.changes, function (c) { return changeSides(c, reversed).action; }));
    if (planned) {
      this.msg('INFO', 'Applied "' + planned.mode + '" on field "' + planned.name + '" to ' +
        this.changes.length + ' ' + this.noun() + ': ' + acts + '.');
    } else {
      this.msg('INFO', 'Reversed ' + plural(this.changes.length, 'change') + ': ' + acts + '.');
    }
  };

  // The counters, then the log in the order it happened: every message as itself, and
  // every listing from the text built beside its nodes rather than from the DOM, so
  // what is copied includes the lines the render cap left off the screen.
  Run.prototype.copyLog = function () {
    var self = this;
    var parts = [this.progressEl.textContent || ''];
    var kids = this.listEl.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      parts = kids[i]._text ? parts.concat(kids[i]._text) : parts.concat([kids[i].textContent || '']);
    }
    copyToClipboard(parts.join('\n'), function (ok) {
      self.copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { self.copyBtn.textContent = 'Copy log'; }, 2000);
    });
  };

  // ── Escape ────────────────────────────────────────────────────────────────
  //
  // Escape acts through whichever of Cancel/Close the footer is actually showing,
  // never by calling `close()` itself. The footer is the dialog's own statement of
  // what it will let you do right now, so routing the key through it means the key
  // can never reach a button that is hidden or disabled - and in particular does
  // nothing mid-write, where both are hidden and Stop is the only way out. A key
  // that quietly abandoned a run in flight would be worse than one that does nothing.
  function escapeButton(run) {
    var order = [run.closeBtn, run.cancelBtn];
    for (var i = 0; i < order.length; i++) {
      var b = order[i];
      if (b && !b.disabled && !hasClass(b, 'cfbe-hidden')) return b;
    }
    return null;
  }

  // On `document`, not on the modal: the modal is not focusable, so a click into the
  // listing or either filter box would otherwise put the key out of reach. Removed in
  // `close()` - a dialog that has gone away must not still be answering for the page.
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
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    _active = null;
  };

  // ── Manage custom field descriptions ──────────────────────────────────────
  //
  // The second dialog. It reads the same library the task does, and writes to exactly
  // one entity - the store tag - plus, if the user asks for it, one custom field rename
  // across the entities carrying it.
  //
  // It borrows the first dialog's machinery by assignment rather than by inheritance:
  // `loadAll`, `msg`, `runWrites` and the rest are the same functions, and the two
  // objects agree on the handful of fields those touch. There is no module between
  // these plugins, and there is no class hierarchy inside one either.
  function DescRun(settings) {
    this.settings = settings || DEFAULTS;
    this.spec = null;                       // always a whole-library read
    this.specs = allSpecs(this.settings);
    this.entities = [];
    this.rows = [];
    this.changes = [];
    this.applied = 0;
    this.failed = 0;
    this.undone = 0;
    this.stale = false;
    this.storeSkipped = 0;
    this.loadingWhat = '';
    this.undoArmed = 0;
    this.tag = null;             // the store tag as read, null if there is none yet
    this.store = null;           // its parsed blob
    this.base = {};              // descriptions as read - what the diff is against
    this.desc = {};              // the working copy the textarea edits
    this.hideField = '';         // the field name the store was last written with
    this.fields = {};            // custom field name -> the entities carrying it
    this.names = [];             // the left pane, in order
    this.sel = null;
    this.blocked = '';           // why Apply is off, if it is
    this.created = false;        // this dialog is what made the store tag
    this.undoTo = null;          // the tag's name and description before Apply
    this.migration = null;       // an armed custom field rename, once the scan finds one
    this.state = 'loading';
    this.build();
  }

  DescRun.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'cfbe-backdrop');
    this.modal = el('div', 'cfbe-modal cfbe-tall');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'cfbe-head');
    head.appendChild(el('div', 'cfbe-title',
      PLUGIN_SHORT_NAME + ' - Custom field descriptions'));
    head.appendChild(el('div', 'cfbe-warn',
      'Backing up your database before proceeding is recommended. Undo only reverses what this dialog wrote, ' +
      'while it stays open, and cannot account for changes made elsewhere in the meantime.'));
    head.appendChild(el('div', 'cfbe-legend',
      'Every custom field in the library is on the left, with how many entities carry ' +
      'it; pick one to write what it means. A field marked [orphan] has a description ' +
      'but no entity left carrying it; one marked [store tag] is carried only by the ' +
      'tag the descriptions themselves live on, which this scan leaves out. ' +
      'The descriptions live in the description of one ' +
      'tag, and nothing is written until you press Apply. Counts are written with ' +
      'prefix "x".'));
    this.noteEl = el('div', 'cfbe-note', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.progressEl = el('div', 'cfbe-progress', 'Loading...');
    this.modal.appendChild(this.progressEl);

    var panes = this.panesEl = el('div', 'cfbe-panes');
    this.namesEl = el('div', 'cfbe-names');
    panes.appendChild(this.namesEl);
    var detail = el('div', 'cfbe-detail');
    this.detailEl = el('div', 'cfbe-detail-head', DESC_HEAD + ' - pick a custom field on the left.');
    detail.appendChild(this.detailEl);
    this.textEl = el('textarea', 'cfbe-text');
    this.textEl.disabled = true;
    this.textEl.addEventListener('input', function () {
      if (self.sel == null) return;
      self.desc[self.sel] = self.textEl.value;
      self.renderNames();
      self.syncApply();
    });
    detail.appendChild(this.textEl);
    this.usersHead = el('div', 'cfbe-detail-head', USERS_HEAD);
    detail.appendChild(this.usersHead);
    this.usersEl = el('div', 'cfbe-users');
    detail.appendChild(this.usersEl);
    panes.appendChild(detail);
    this.modal.appendChild(panes);
    this.modal.appendChild(splitter(panes));

    var listWrap = el('div', 'cfbe-log cfbe-listwrap cfbe-logshort');
    this.listEl = el('div', 'cfbe-list');
    listWrap.appendChild(this.listEl);
    this.modal.appendChild(listWrap);

    var ops = el('div', 'cfbe-editor');
    this.pruneBtn = button('Prune orphans', 'cfbe-prune');
    this.pruneBtn.title = 'Drop every description whose custom field no longer exists ' +
      'on any entity. Staged like every other edit here: Apply is what writes it.';
    this.pruneBtn.addEventListener('click', function () { self.prune(); });
    ops.appendChild(this.pruneBtn);
    this.migrateBtn = button('Migrate', 'cfbe-migrate cfbe-hidden');
    this.migrateBtn.className = this.migrateBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.migrateBtn.addEventListener('click', function () { self.armMigration(); });
    ops.appendChild(this.migrateBtn);
    this.modal.appendChild(ops);

    var foot = el('div', 'cfbe-foot');
    this.cancelBtn = button('Cancel', 'cfbe-cancel');
    this.applyBtn = button('Apply', 'cfbe-apply');
    this.applyBtn.className = this.applyBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.undoBtn = button('Undo', 'cfbe-undo cfbe-hidden');
    this.undoBtn.className = this.undoBtn.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    this.rescanBtn = button('Rescan', 'cfbe-rescan cfbe-hidden');
    this.copyBtn = button('Copy log', 'cfbe-copy');
    this.closeBtn = button('Close', 'cfbe-close cfbe-hidden');
    this.applyBtn.disabled = true;
    this.undoBtn.title = 'Put the store tag back the way it was before Apply. ' +
      'Only what this dialog wrote, and only while it stays open.';
    this.rescanBtn.title = 'Read the library and the store again. Unsaved edits in this ' +
      'dialog are kept.';
    this.copyBtn.title = 'Copy the counters and the whole log as plain text.';

    this.cancelBtn.addEventListener('click', function () { self.close(); });
    this.applyBtn.addEventListener('click', function () { self.apply(); });
    this.undoBtn.addEventListener('click', function () { self.undo(); });
    this.rescanBtn.addEventListener('click', function () { self.rescan(); });
    this.copyBtn.addEventListener('click', function () { self.copyLog(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });
    [this.applyBtn, this.cancelBtn, this.copyBtn, this.undoBtn, this.rescanBtn, this.closeBtn]
      .forEach(function (b) { foot.appendChild(b); });
    this.modal.appendChild(foot);

    wireEscape(this);
    document.body.appendChild(this.backdrop);
  };

  // Borrowed whole from the first dialog. Every one of these reads only fields both
  // objects have, which is what the constructor above is being careful about.
  DescRun.prototype.msg = Run.prototype.msg;
  DescRun.prototype.tallyMsg = Run.prototype.tallyMsg;
  DescRun.prototype.note = Run.prototype.note;
  DescRun.prototype.scrollList = Run.prototype.scrollList;
  DescRun.prototype.fillList = Run.prototype.fillList;
  DescRun.prototype.load = Run.prototype.load;          // `spec` is null: the task's branch
  DescRun.prototype.loadAll = Run.prototype.loadAll;
  DescRun.prototype.keep = Run.prototype.keep;
  DescRun.prototype.checkVersion = Run.prototype.checkVersion;
  DescRun.prototype.runWrites = Run.prototype.runWrites;
  DescRun.prototype.writeChunk = Run.prototype.writeChunk;
  DescRun.prototype.copyLog = Run.prototype.copyLog;
  DescRun.prototype.close = Run.prototype.close;
  DescRun.prototype.focus = Run.prototype.focus;
  DescRun.prototype.show = Run.prototype.show;
  DescRun.prototype.noun = Run.prototype.noun;

  DescRun.prototype.begin = function () {
    var self = this;
    this.setState('loading');

    if (this.settings.a1SkipImagesInTask) {
      this.msg('INFO', 'Images are left out of this run: "' + SKIP_IMAGES_NAME +
        '" is on in this plugin\'s settings. A description for a field only images ' +
        'carry will read as an orphan here.');
    }
    if (coop().leases.length) {
      this.note('Another plugin is applying bulk changes right now (' +
        coop().leases[0].owner + ' - ' + coop().leases[0].label + '). Running both at once ' +
        'means each may undo part of the other; let it finish first.');
    }
    this.checkVersion();

    readStore(this.settings).then(function (r) {
      self.tag = r.tag;
      self.store = r.store;
      self.adoptStore();
    }, function (e) {
      self.blocked = 'the description store could not be read';
      self.msg('ERROR', 'Reading the description store failed: ' +
        (e && e.message ? e.message : String(e)) + ' Nothing will be written.');
    }).then(function () {
      return self.load();
    }).then(function () { self.ready(); }, function (e) {
      self.msg('ERROR', 'Reading the library failed: ' + (e && e.message ? e.message : String(e)));
      self.ready();
    });
  };

  // What the store says, and what this dialog is allowed to do about it. The version
  // gate is the one thing here that blocks: a store written by a newer release may hold
  // keys this script would drop on the next write, and dropping them silently is worse
  // than refusing.
  DescRun.prototype.adoptStore = function () {
    if (!this.tag) {
      this.msg('INFO', 'No description store yet. Apply will create tag "' +
        this.settings.b1DescriptionTagName + '" to hold the descriptions, marked with ' +
        'custom field "' + STORE_FIELD + '" so that renaming it later cannot lose them.');
    } else {
      this.msg('INFO', 'Descriptions are kept on tag "' + this.tag.name + '" (' +
        this.tag.id + ')' + (this.store.version ? ', last written by version ' +
        this.store.version : '') + '.');
    }

    if (this.tag && this.store.broken) {
      this.blocked = 'the store tag\'s description is not valid JSON';
      this.msg('ERROR', 'The description of tag ' + this.tag.id + ' is not something ' +
        'this plugin wrote: the JSON in it does not parse. Nothing will be written, so ' +
        'that whatever is in there is not lost. To recover: fix or delete that ' +
        'description by hand on the tag\'s own edit page, then reopen this dialog.');
      return;
    }
    if (this.store.version && cmpVersion(this.store.version, PLUGIN_VERSION) > 0) {
      this.blocked = 'the store was written by a newer version';
      this.msg('ERROR', 'The store on tag ' + this.tag.id + ' was written by ' +
        PLUGIN_NAME + ' ' + this.store.version + ', and this page is running ' +
        PLUGIN_VERSION + '. Editing is off, because a newer release may keep things in ' +
        'there that this one would drop on the next write. To recover: install and load ' +
        'that version (or newer), or - if it is gone - delete that tag\'s description by ' +
        'hand, which resets the store and loses the descriptions in it.');
      return;
    }

    var d = this.store.descriptions || {};
    for (var k in d) {
      if (hasOwn(d, k)) { this.base[k] = String(d[k]); this.desc[k] = String(d[k]); }
    }
    this.hideField = this.store.hideField || '';

    // The one description this plugin seeds itself, so that the field it asks the user
    // to mark entities with is documented in the same place every other field is.
    var hide = this.settings.c1ExcludeFromAddListField;
    if (hide && !hasOwn(this.desc, hide)) {
      this.desc[hide] = 'Set on an entity to hide it from Stash\'s add/select ' +
        'dropdowns. Any value other than empty, 0 or false counts as set. Read by ' +
        PLUGIN_NAME + '.';
      this.msg('INFO', 'Seeded a description for "' + hide + '", the field named by ' +
        'this plugin\'s "Hide from Add Lists" setting. Edit it like any other; Apply ' +
        'writes it.');
    }

    // A rescan's unsaved edits, put back over the baseline that has just been re-read.
    var self = this;
    if (this.pendingEdits) {
      this.pendingEdits.forEach(function (c) {
        if (c.after) self.desc[c.name] = c.after; else delete self.desc[c.name];
      });
      this.pendingEdits = null;
    }
  };

  // The library has arrived: what carries what, which descriptions have nothing left
  // carrying them, and whether the hide field has been renamed since the store was
  // last written.
  DescRun.prototype.ready = function () {
    var self = this;
    this.fields = {};
    this.entities.forEach(function (e) {
      for (var k in e.fields) {
        if (!hasOwn(e.fields, k)) continue;
        if (!hasOwn(self.fields, k)) self.fields[k] = [];
        self.fields[k].push(e);
      }
    });

    var found = [];
    for (var k in this.fields) { if (hasOwn(this.fields, k)) found.push(k); }
    found.sort();
    // The store tag is left out of the scan (`keep`), so a field only *it* carries -
    // the hide-from-add-lists field it marks itself with - has an entity behind it that
    // this dialog cannot see. Calling that an orphan is wrong twice: it reads as
    // "nothing uses this any more", and Prune would then offer to drop the description
    // of the one field this plugin asks the user to use.
    var storeOnly = [];
    var orphans = [];
    for (var d in this.desc) {
      if (!hasOwn(this.desc, d) || hasOwn(this.fields, d)) continue;
      if (hasOwn(_storeTagFields, d)) storeOnly.push(d); else orphans.push(d);
    }
    storeOnly.sort();
    orphans.sort();
    this.names = found.concat(storeOnly, orphans);
    this.storeOnly = storeOnly;
    this.orphans = orphans;

    this.msg('INFO', plural(found.length, 'custom field') + ' found across ' +
      plural(this.entities.length, 'entity', 'entities') + ', ' +
      plural(this.described(found), 'of them', 'of them') + ' described' +
      (orphans.length ? ', and ' + plural(orphans.length, 'description') +
        ' with no entity left carrying the field' : '') + '.');
    if (storeOnly.length) {
      this.msg('INFO', plural(storeOnly.length, 'field') + ' marked [store tag]: ' +
        storeOnly.join(', ') + '. Nothing else in the library carries ' +
        (storeOnly.length === 1 ? 'it' : 'them') + ', but the description store tag "' +
        (this.tag ? this.tag.name : '') + '" does - and this scan leaves that tag out. ' +
        'Not an orphan, and Prune leaves ' + (storeOnly.length === 1 ? 'it' : 'them') +
        ' alone.');
    }

    // A rename of the hide-field setting since the store was last written. The
    // description follows it here, in the working copy; the entities carrying the old
    // key are a library write and wait for the button.
    var hide = this.settings.c1ExcludeFromAddListField;
    if (this.hideField && hide && this.hideField !== hide) {
      if (hasOwn(this.desc, this.hideField) && !hasOwn(this.desc, hide)) {
        this.desc[hide] = this.desc[this.hideField];
        delete this.desc[this.hideField];
        this.msg('INFO', 'The "Hide from Add Lists" setting has been renamed from "' +
          this.hideField + '" to "' + hide + '" since the store was written; its ' +
          'description has moved with it.');
      }
      var carriers = this.fields[this.hideField] || [];
      if (carriers.length) {
        this.migration = { from: this.hideField, to: hide, entities: carriers, armed: false };
        this.migrateBtn.textContent = 'Migrate ' + carriers.length + ' to "' + hide + '"';
        this.show(this.migrateBtn, true);
        this.note(plural(carriers.length, 'entity', 'entities') + ' still carry the old ' +
          'field name "' + this.hideField + '". They are not hidden from the dropdowns ' +
          'any more. "Migrate" stages the rename; Apply writes it.');
      }
    }

    this.setState('listing');
    this.renderNames();
    this.renderProgress();
  };

  DescRun.prototype.described = function (names) {
    var self = this;
    return names.filter(function (n) {
      return hasOwn(self.desc, n) && String(self.desc[n]).replace(/^\s+|\s+$/g, '') !== '';
    }).length;
  };

  DescRun.prototype.renderNames = function () {
    var self = this;
    while (this.namesEl.firstChild) this.namesEl.removeChild(this.namesEl.firstChild);
    this.names.forEach(function (name) {
      var store = !hasOwn(self.fields, name) && hasOwn(_storeTagFields, name);
      var orphan = !hasOwn(self.fields, name) && !store;
      var has = String(self.desc[name] || '').replace(/^\s+|\s+$/g, '') !== '';
      var changed = String(self.desc[name] || '') !== String(self.base[name] || '');
      var b = el('button', 'cfbe-name' + (self.sel === name ? ' cfbe-name-on' : '') +
        (orphan ? ' cfbe-name-orphan' : store ? ' cfbe-name-store' : ''),
      (changed ? '* ' : has ? '• ' : '  ') + name +
        (orphan ? ' [orphan]' : store ? ' [store tag] x1' : ' x' + self.fields[name].length));
      b.type = 'button';
      b.title = orphan
        ? 'Described, but no entity in this scan carries it'
        : store
          ? 'Carried by the description store tag itself, which this scan leaves out - ' +
            'no other entity carries it'
          : plural(self.fields[name].length, 'entity', 'entities') + ' carry this field';
      b.addEventListener('click', function () { self.pick(name); });
      self.namesEl.appendChild(b);
    });
  };

  DescRun.prototype.pick = function (name) {
    this.sel = name;
    this.textEl.value = String(this.desc[name] || '');
    this.textEl.disabled = !this.editable();
    this.sizeText();
    var users = this.fields[name] || [];
    // A field only the store tag carries has one carrier this scan never read, so the
    // pane names it and draws it as a row of its own rather than reading as an orphan.
    var store = !users.length && hasOwn(_storeTagFields, name) && this.tag;
    this.detailEl.textContent = DESC_HEAD + ' of custom field "' + name + '"';
    this.usersHead.textContent = USERS_HEAD + ' - ' + (users.length
      ? plural(users.length, 'entity', 'entities') + ' carry "' + name + '"'
      : store
        ? 'only the description store tag carries "' + name + '", to hide itself from ' +
          'the add lists. This plugin\'s own plumbing, and left out of the scan.'
        : 'no entity in this scan carries "' + name +
          '" (orphan). Clearing the box above removes it.');
    while (this.usersEl.firstChild) this.usersEl.removeChild(this.usersEl.firstChild);
    var self = this;
    if (store) {
      var row = el('div', 'cfbe-entry');
      row.appendChild(textNode(ENTITIES.tags.label + ' '));
      row.appendChild(entityPill(ENTITIES.tags, this.tag.id, this.tag.name));
      row.appendChild(textNode(': '));
      row.appendChild(copyPill(valueText(_storeTagFields[name])));
      this.usersEl.appendChild(row);
    }
    users.slice(0, LIST_RENDER_CAP).forEach(function (e) {
      var row = el('div', 'cfbe-entry');
      row.appendChild(textNode(e.spec.label + ' '));
      row.appendChild(entityPill(e.spec, e.id, e.display));
      row.appendChild(textNode(': '));
      row.appendChild(copyPill(valueText(e.fields[name])));
      self.usersEl.appendChild(row);
    });
    if (users.length > LIST_RENDER_CAP) {
      this.usersEl.appendChild(el('div', 'cfbe-entry cfbe-INFO',
        '... and ' + plural(users.length - LIST_RENDER_CAP, 'more') + ' not shown.'));
    }
    this.renderNames();
  };

  // Grow the box to whatever description was just loaded, so a long one is read without
  // scrolling, and stop at four fifths of the pane so the list under it never vanishes.
  // Only ever on `pick()`: the box is `resize:vertical`, and re-sizing one the user has
  // just dragged would fight them. The floor is the CSS `min-height`, which is why this
  // clears the height first and then only ever sets a bigger one - a short description
  // lands back on the default split rather than on one line.
  DescRun.prototype.sizeText = function () {
    var box = this.textEl;
    if (!box.style) return;
    box.style.height = '';
    var room = this.panesEl ? this.panesEl.clientHeight : 0;
    var want = box.scrollHeight;
    if (!room || !want) return;
    box.style.height = Math.min(want + 4, Math.round(room * 0.8)) + 'px';
  };

  DescRun.prototype.prune = function () {
    var self = this;
    var gone = (this.orphans || []).filter(function (n) { return hasOwn(self.desc, n); });
    if (!gone.length) { this.msg('INFO', 'No orphan descriptions to prune.'); return; }
    gone.forEach(function (n) { delete self.desc[n]; });
    if (gone.indexOf(this.sel) !== -1) { this.sel = null; this.textEl.value = ''; }
    this.msg('INFO', 'Pruned ' + plural(gone.length, 'orphan description') +
      ': ' + gone.join(', ') + '. Apply writes it.');
    this.renderNames();
    this.syncApply();
  };

  DescRun.prototype.armMigration = function () {
    if (!this.migration) return;
    this.migration.armed = true;
    this.migrateBtn.disabled = true;
    this.msg('INFO', 'Staged: rename custom field "' + this.migration.from + '" to "' +
      this.migration.to + '" on ' + plural(this.migration.entities.length, 'entity', 'entities') +
      '. Apply writes it, and Undo puts the old name back.');
    this.syncApply();
  };

  // What Apply would write, as a list of `{name, before, after}`. An empty `after` is a
  // description being removed, which is how the box clears one.
  DescRun.prototype.diff = function () {
    var out = [];
    var seen = {};
    var k;
    for (k in this.desc) {
      if (!hasOwn(this.desc, k)) continue;
      seen[k] = true;
      var after = String(this.desc[k]).replace(/^\s+|\s+$/g, '');
      var before = hasOwn(this.base, k) ? String(this.base[k]) : '';
      if (after !== before) out.push({ name: k, before: before, after: after });
    }
    for (k in this.base) {
      if (hasOwn(this.base, k) && !hasOwn(seen, k) && String(this.base[k]) !== '') {
        out.push({ name: k, before: String(this.base[k]), after: '' });
      }
    }
    out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return out;
  };

  DescRun.prototype.pending = function () {
    return this.diff().length > 0 ||
      !this.tag ||
      (this.tag && this.tag.name !== this.settings.b1DescriptionTagName) ||
      (this.store && this.store.version !== PLUGIN_VERSION) ||
      (this.hideField !== this.settings.c1ExcludeFromAddListField) ||
      !!(this.migration && this.migration.armed);
  };

  // **A written Apply does not end this dialog the way it ends the other one.** There
  // the listing *is* the plan, so once it has been written the lines on screen describe
  // a library that has moved on and the only honest next step is a rescan. Here the
  // left pane is the library's custom fields, which an Apply does not touch, and the
  // box is what the user came to type in - so editing stays open afterwards, with the
  // write's own report in the log below it. Apply is simply disabled again until the
  // next unsaved change, which `pending()` already answers.
  DescRun.prototype.editable = function () {
    return (this.state === 'listing' || this.state === 'applied') && !this.blocked;
  };

  DescRun.prototype.setState = function (state) {
    this.state = state;
    var applied = state === 'applied' || state === 'undoing';
    var busy = state === 'applying' || state === 'undoing';
    var edit = this.editable();
    this.show(this.cancelBtn, !applied);
    this.show(this.applyBtn, true);
    this.show(this.undoBtn, !!this.undoTo || !!(this.migration && this.migration.done));
    this.show(this.rescanBtn, state === 'listing' || state === 'applied');
    this.show(this.closeBtn, applied);
    this.cancelBtn.disabled = busy;
    this.undoBtn.disabled = busy;
    this.rescanBtn.disabled = busy;
    this.closeBtn.disabled = busy;
    this.pruneBtn.disabled = !edit;
    this.textEl.disabled = !edit || this.sel == null;
    this.syncApply();
  };

  DescRun.prototype.syncApply = function () {
    this.applyBtn.disabled = !this.editable() || this.stale || !this.pending();
    this.applyBtn.title = this.blocked
      ? 'Editing is off: ' + this.blocked + '.'
      : 'Write the descriptions to the store tag. Nothing else in the library is ' +
        'touched unless a rename is staged.';
  };

  DescRun.prototype.renderProgress = function () {
    var summary;
    if (this.state === 'loading') {
      summary = 'Loading ' + (this.loadingWhat || '') + '. ' + this.entities.length +
        ' read so far';
    } else if (this.state === 'applying') {
      summary = 'Applying.';
    } else if (this.state === 'undoing') {
      summary = 'Undoing.';
    } else {
      var changes = this.diff().length;
      summary = this.names.length + ' custom fields, ' +
        this.described(this.names) + ' described, ' +
        (changes ? plural(changes, 'unsaved change') : 'no unsaved changes') +
        (this.state === 'applied' && !changes ? ' - last Apply written' : '');
    }
    this.progressEl.textContent = summary;
  };

  // One `tagCreate` or one `tagUpdate` carries the whole store - name, description and
  // the marker custom field - so there is no state in which the tag exists but cannot
  // be found again. The custom field rename, if one is staged, is a separate pass over
  // the library through the same `runWrites` an Apply in the other dialog uses.
  DescRun.prototype.apply = function () {
    var self = this;
    var changes = this.diff();
    if (!this.pending()) { this.msg('INFO', 'Nothing to change.'); return; }

    this.setState('applying');
    this.renderProgress();
    this.undoTo = this.tag ? { name: this.tag.name, description: this.tag.description || '' } : null;

    var store = {
      hideField: this.settings.c1ExcludeFromAddListField,
      descriptions: {},
    };
    for (var k in this.desc) {
      if (!hasOwn(this.desc, k)) continue;
      var v = String(this.desc[k]).replace(/^\s+|\s+$/g, '');
      if (v) store.descriptions[k] = v;
    }
    var description = serialiseStore(store);
    var name = this.settings.b1DescriptionTagName;
    var marks = {};
    marks[STORE_FIELD] = MARK_VALUE;
    if (store.hideField) marks[store.hideField] = MARK_VALUE;

    var write = this.tag
      ? gqlRequest('mutation CFBE_TagUpdate($input: TagUpdateInput!) { tagUpdate(input: $input) ' +
        '{ id name description } }',
      { input: { id: this.tag.id, name: name, description: description,
        custom_fields: { partial: marks } } })
      : gqlRequest('mutation CFBE_TagCreate($input: TagCreateInput!) { tagCreate(input: $input) ' +
        '{ id name description } }',
      { input: { name: name, description: description, custom_fields: marks } });

    var lease = acquireLease('Custom field descriptions');
    write.then(function (data) {
      var tag = (data && (data.tagUpdate || data.tagCreate)) || null;
      if (!self.tag) {
        self.created = true;
        self.msg('INFO', 'Created tag "' + name + '"' + (tag ? ' (' + tag.id + ')' : '') +
          ' to hold the descriptions.');
      } else if (self.tag.name !== name) {
        self.msg('INFO', 'Renamed the store tag from "' + self.tag.name + '" to "' + name + '".');
      }
      self.tag = { id: tag ? String(tag.id) : (self.tag && self.tag.id),
        name: name, description: description };
      _storeTagId = self.tag.id;
      self.reportChanges(changes, false);
      self.base = {};
      for (var kk in store.descriptions) {
        if (hasOwn(store.descriptions, kk)) self.base[kk] = store.descriptions[kk];
      }
      self.hideField = store.hideField;
      self.store = { version: PLUGIN_VERSION, hideField: store.hideField,
        descriptions: store.descriptions };
      _descriptions = store.descriptions;
      lease.release();
      return self.runMigration(false);
    }, function (e) {
      lease.release();
      self.msg('ERROR', 'Writing the descriptions failed: ' +
        (e && e.message ? e.message : String(e)) +
        (/UNIQUE|unique|exists/.test(String(e && e.message)) ? ' A tag called "' + name +
          '" already exists and is not this one - rename it, or point the setting at ' +
          'another name.' : ''));
      self.undoTo = null;
    }).then(function () {
      self.setState('applied');
      self.renderProgress();
    });
  };

  // Written as one line per description rather than as a listing block: there are
  // dozens of these at most, and each one is a sentence the user typed.
  DescRun.prototype.reportChanges = function (changes, reversed) {
    if (!changes.length) return;
    var self = this;
    this.blockEl = null;
    this.fillList(changes, function (c) {
      var before = reversed ? c.after : c.before;
      var after = reversed ? c.before : c.after;
      var row = el('div', 'cfbe-entry');
      row.appendChild(pill('act', !before ? 'Added' : !after ? 'Deleted' : 'Replaced'));
      row.appendChild(textNode(' '));
      row.appendChild(copyPill(c.name, true));
      row.appendChild(textNode(': '));
      if (before) row.appendChild(copyPill(before)); else row.appendChild(noneNode('no description'));
      row.appendChild(textNode(ARROW));
      if (after) row.appendChild(copyPill(after)); else row.appendChild(noneNode('no description'));
      return row;
    }, function (c) {
      var before = reversed ? c.after : c.before;
      var after = reversed ? c.before : c.after;
      return (!before ? 'Added' : !after ? 'Deleted' : 'Replaced') + ' ' + c.name +
        ': ' + before + ARROW + after;
    });
    this.msg('INFO', (reversed ? 'Reversed ' : 'Wrote ') +
      plural(changes.length, 'description') + '.');
    this.lastChanges = changes;
  };

  // The staged custom field rename: one delta per (type, value), because entities that
  // shared a value share a mutation - the same grouping Undo in the other dialog uses,
  // and for the same reason.
  DescRun.prototype.runMigration = function (reversed) {
    var self = this;
    var m = this.migration;
    if (!m || !m.armed || (reversed ? !m.done : m.done)) return Promise.resolve();
    var from = reversed ? m.to : m.from;
    var to = reversed ? m.from : m.to;

    var groups = {};
    var batches = [];
    m.entities.forEach(function (e) {
      var value = e.fields[from];
      if (value === undefined) return;
      var key = e.spec.key + '|' + valueText(value);
      if (!hasOwn(groups, key)) {
        var partial = {};
        partial[to] = value;
        groups[key] = { spec: e.spec, ids: [], cf: { partial: partial, remove: [from] } };
        batches.push(groups[key]);
      }
      groups[key].ids.push(e.id);
    });
    if (!batches.length) return Promise.resolve();

    return this.runWrites(batches, 'Custom field rename "' + from + '" to "' + to + '"')
      .then(function (ok) {
        m.done = !reversed;
        m.entities.forEach(function (e) {
          if (e.fields[from] === undefined) return;
          e.fields[to] = e.fields[from];
          delete e.fields[from];
        });
        self.msg('INFO', (reversed ? 'Reversed the rename on ' : 'Renamed "' + from +
          '" to "' + to + '" on ') + plural(ok, 'entity', 'entities') + '.');
      });
  };

  // Undo puts the store tag back the way it was - one write, because the store is one
  // field - and reverses the rename if one went out with it. A tag this dialog
  // *created* is left in place: deleting an entity the user may since have used
  // elsewhere is not something an undo of a description edit should do.
  DescRun.prototype.undo = function () {
    var self = this;
    var now = Date.now();
    if (!this.undoArmed || now - this.undoArmed > UNDO_ARM_MS) {
      this.undoArmed = now;
      this.undoBtn.textContent = 'Undo?';
      setTimeout(function () {
        if (self.undoBtn.textContent !== 'Undo') self.undoBtn.textContent = 'Undo';
      }, UNDO_ARM_MS);
      return;
    }
    this.undoArmed = 0;
    this.undoBtn.textContent = 'Undo';
    this.setState('undoing');
    this.renderProgress();

    var back = this.undoTo;
    var lease = acquireLease('Custom field descriptions (undo)');
    var write = back
      ? gqlRequest('mutation CFBE_TagUpdate($input: TagUpdateInput!) { tagUpdate(input: $input) ' +
        '{ id name description } }',
      { input: { id: this.tag.id, name: back.name, description: back.description } })
      : Promise.resolve(null);

    write.then(function () {
      lease.release();
      if (back) {
        var parsed = parseStore(back.description);
        self.base = {};
        self.desc = {};
        for (var k in parsed.descriptions) {
          if (!hasOwn(parsed.descriptions, k)) continue;
          self.base[k] = String(parsed.descriptions[k]);
          self.desc[k] = String(parsed.descriptions[k]);
        }
        self.hideField = parsed.hideField || '';
        self.store = parsed;
        _descriptions = parsed.descriptions;
        self.tag = { id: self.tag.id, name: back.name, description: back.description };
        self.reportChanges(self.lastChanges || [], true);
      } else if (self.created) {
        self.msg('WARN', 'The store tag was created by this dialog, so there is nothing ' +
          'to put its description back to. The tag itself is left in place - delete it ' +
          'by hand if it is not wanted.');
      }
      return self.runMigration(true);
    }, function (e) {
      lease.release();
      self.msg('ERROR', 'Undo failed: ' + (e && e.message ? e.message : String(e)));
    }).then(function () {
      self.undoTo = null;
      self.setState('applied');
      // The box has to be re-read from the restored working copy, not just re-rendered
      // around it: editing stays open after an Undo, so a box still showing the text
      // that was just reversed would be the next thing typed over.
      if (self.sel != null) self.pick(self.sel); else self.renderNames();
      self.renderProgress();
    });
  };

  // A fresh read of the library and the store, keeping whatever is being typed: the
  // edits in this dialog are the reason it is open, and throwing them away on a rescan
  // would make the button a way to lose work.
  DescRun.prototype.rescan = function () {
    this.entities = [];
    this.fields = {};
    this.loadingWhat = '';
    this.blockEl = null;
    this.blocked = '';
    this.msg('INFO', 'Rescanning. Unsaved edits are kept.');
    // The *edits*, not the whole working copy: what comes back from the store is the
    // new baseline, and only the lines this dialog changed go back over the top of it.
    // Held for `adoptStore` to re-apply rather than merged here, because the store has
    // not been read yet and merging into what it is about to fill would be a race.
    this.pendingEdits = this.diff();
    this.desc = {};
    this.base = {};
    this.begin();
  };

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // The group gets the siblings' description treatment - a one-line summary, the rest
  // behind **Show more**, and a labelled link to the README under it - and each of the
  // three setting rows the per-setting hover box. The description half of that was here
  // first and mattered most while the plugin had no settings at all: it is the only
  // thing in the group that is ours, and the first thing a user reads before installing.
  //
  // **The heading is the only anchor available, and that is the one thing here worth
  // being uneasy about.** Every sibling finds its group through the
  // `plugin-<id>-<key>` element ids Stash builds from the plugin id and a setting
  // key - ours by construction - and keeps a heading match only as a fallback,
  // because two of them shipped broken twice on heading text (§6 of
  // PropagateTagsAndPerformers' CLAUDE.md). A plugin that declares no settings has no
  // such ids to anchor on. So this is the fallback promoted to the only route, and it
  // is why `headingIsOurs` compares *exactly* rather than by prefix.
  function headingIsOurs(text) {
    var t = String(text == null ? '' : text).trim();
    if (t === PLUGIN_NAME) return true;
    // Settings → Plugins appends the version - `${name} ${version ? `(${v})` : undefined}`
    // - and interpolates the literal `undefined` when a plugin has no version at all.
    t = t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '').trim();
    return t === PLUGIN_NAME;
  }

  // The group and the description, found in one walk from our own heading - and the
  // description is required to be **in the same `.setting` row as that heading**.
  //
  // **Both panels build the same shapes out of the same classes**, which is why
  // nothing looser works. Settings → Plugins puts our h3 and the description in one
  // header row. Settings → Tasks heads its group with the plugin name too, and gives
  // every *task* row an h3 of its own with a `.sub-heading` under it - so "a
  // `.sub-heading` somewhere in the group" finds a task's description and decorates
  // the wrong panel. Confirmed live 2026-08-13: `cfbe-own-group` was landing on the
  // Tasks group, whose only description is the task's.
  //
  // A group with no header description of ours is not ours to decorate, and returning
  // nothing is the whole of the fix.
  function ownParts() {
    var heads = document.querySelectorAll ? document.querySelectorAll('h3') : [];
    for (var i = 0; i < heads.length; i++) {
      if (!headingIsOurs(heads[i].textContent)) continue;
      var node = heads[i];
      var header = null;
      for (var d = 0; node && d < 10; d++, node = node.parentElement) {
        if (!header && hasClass(node, 'setting')) header = node;
        if (!hasClass(node, 'setting-group')) continue;
        var sub = header ? byClass(header, 'sub-heading') : null;
        if (sub) return { group: node, sub: sub, heading: heads[i] };
        break;    // our heading, but no description beside it: keep looking
      }
    }
    return null;
  }

  function byClass(root, name) {
    if (!root || typeof root.querySelector !== 'function') return null;
    try { return root.querySelector('.' + name) || null; } catch (e) { return null; }
  }

  function oneLine(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').replace(/^ | $/g, '');
  }

  // Stash puts the text back on every re-render of this panel, so this runs on every
  // tick and re-splits when it has to. Idempotent: once the children are ours there
  // is no text node left to split.
  function splitDescription(sub) {
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'cfbe-p')) return;   // already ours
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;                    // nothing to split
    var paras = text.split(/\n{2,}/);
    sub.textContent = '';
    paras.forEach(function (para) {
      var t = oneLine(para);
      if (t) sub.appendChild(el('div', 'cfbe-p', t));
    });
  }

  function descCollapsed(sub) { return hasClass(sub, 'cfbe-desc-collapsed'); }

  function setDescCollapsed(sub, on) {
    var cls = String(sub.className || '').replace(/\s*cfbe-desc-collapsed\b/, '');
    sub.className = (on ? cls + ' cfbe-desc-collapsed' : cls).replace(/^\s+/, '');
  }

  // The description sits in the group *header*, outside the `<Collapse>` Stash shuts
  // by default - so it is on screen at full height whether the group is expanded or
  // not, and hiding paragraphs is the only thing that shortens it.
  //
  // The toggle is a `<button>` rather than a span: `SettingGroup`'s `onDivClick`
  // walks up from the event target and returns early only for `a` and `button`, so
  // anything else would fold the whole group on click.
  function collapseDescription(sub) {
    var kids = sub.childNodes || [];
    var paras = 0;
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], 'cfbe-p')) paras++;
    if (paras < 2) return;                        // one paragraph hides nothing
    if (document.getElementById(DESC_TOGGLE_ID)) return;
    // A re-render drops the button and the class together, so the description returns
    // to collapsed rather than to a half-state with no way out of it.
    setDescCollapsed(sub, true);
    var btn = el('button', 'cfbe-desc-toggle', 'Show more');
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

  // Under the description, which is inside the group header and so shows whether or
  // not the group is expanded. The fallbacks are for a Stash that renders no
  // sub-heading (an empty description) or no header row at all.
  // Always under the description, which `ownParts` has already found and required.
  // The fallbacks this had - the header box, then the group itself - are what put the
  // link inside the *heading* of a group with no description of ours, so they are gone
  // with the case that reached them.
  function readmeLinkSlot(sub) {
    return { parent: sub.parentNode, before: sub.nextSibling };
  }

  // ── The per-setting hover box ──────────────────────────────────────────────
  //
  // Copied from the siblings, function for function, because there is no module
  // between these plugins - see the shared-dialog-chrome note in the repo-root
  // CLAUDE.md. The summary stays on the row and everything after the first blank line
  // goes into a box opened from the ⓘ, the summary or the setting's own name.
  var TIP_MARK = 'ⓘ';                       // circled Latin small letter i

  // SettingsPluginsPanel.tsx gives every plugin setting an id built from the plugin id
  // and the setting key - `plugin-CustomFieldsBulkEditor-a1SkipImagesInTask`. That is
  // ours by construction: no version suffix, no localisation, nothing formatted for
  // display. From 0.7.0 this plugin finally has one of those to anchor on; `ownParts`
  // still goes in by the heading, because it needs the description beside it.
  function settingElement(key) {
    return document.getElementById('plugin-' + PLUGIN_ID + '-' + key);
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

  function setTipOpen(sub, on) {
    var cls = String(sub.className || '').replace(/\s*cfbe-tip-open\b/, '');
    sub.className = (on ? cls + ' cfbe-tip-open' : cls).replace(/^\s+/, '');
  }

  // The row is passed rather than the .sub-heading, and the current one looked up per
  // event: an <h3> is Stash's element and survives the re-renders that replace
  // everything we put in the row, so a captured reference would go stale. The flag is
  // what stops a second pair of listeners landing on it each time we rebuild.
  function tipTrigger(node, row) {
    if (!node || node._cfbeTipWired) return;
    node._cfbeTipWired = true;
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
    if (kids.length && hasClass(kids[0], 'cfbe-sum')) return;   // already ours
    var text = sub.textContent || '';
    var cut = text.indexOf('\n\n');
    if (cut === -1) return;                                     // nothing to hide
    var summary = oneLine(text.slice(0, cut));
    var detail = text.slice(cut + 2).split(/\n{2,}/).map(oneLine)
      .filter(function (p) { return !!p; }).join('\n\n');
    if (!summary || !detail) return;
    sub.textContent = '';
    if (!hasClass(sub, 'cfbe-tipped')) {
      sub.className = ((sub.className || '') + ' cfbe-tipped').replace(/^\s+/, '');
    }
    var sum = el('span', 'cfbe-sum', summary);
    sub.appendChild(sum);
    // tabIndex, so the box can be reached and read without a mouse. The box is a
    // sibling of the mark rather than a child: as a child it would sit inside an
    // inline span and inherit its clipping and stacking.
    var mark = el('span', 'cfbe-tip', TIP_MARK);
    mark.tabIndex = 0;
    sub.appendChild(mark);
    sub.appendChild(el('span', 'cfbe-tipbox', detail));
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
  var STALE_ID = 'cfbe-stale-notice';

  // The heading `ownParts` already matched, handed straight back rather than searched
  // for again - this is the one plugin here whose only route into its own group is
  // that heading, so re-finding it would be re-running the fragile half for nothing.
  function installedFromHeading(heading) {
    var t = heading ? String(heading.textContent == null ? '' : heading.textContent).trim() : '';
    var m = /\(([^()]+)\)$/.exec(t);
    return m ? m[1].replace(/^\s+|\s+$/g, '') : null;
  }

  // Above the description rather than under it: it is the first thing in the group
  // worth reading, and it leaves the README link's slot alone. Both sit in the group
  // header, outside Stash's <Collapse>, so a collapsed group still shows the banner.
  function staleSlot(sub) {
    return { parent: sub.parentNode, before: sub };
  }

  function ensureStaleNotice(parts) {
    var installed = installedFromHeading(parts.heading);
    var node = document.getElementById(STALE_ID);
    // No parenthesised version on the heading means Settings → Tasks, which heads its
    // group with the bare name - not a mismatch, and nothing to say.
    if (!installed || installed === PLUGIN_VERSION) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    var slot = staleSlot(parts.sub);
    if (node && node.parentNode === slot.parent) return;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    var box = el('div', 'cfbe-stale', '⚠ This page is still running ' +
      PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. ' +
      'Press Ctrl+Shift+R (⌘+Shift+R on a Mac) to reload it: your browser has cached ' +
      'the older script, and everything this plugin does until then is that older code.');
    box.id = STALE_ID;
    slot.parent.insertBefore(box, slot.before);
  }

  // Re-added rather than tracked: React re-renders this panel and drops anything we
  // put in it. Keyed on the id, so a re-render that kept it makes no second one.
  function settingsTick() {
    var parts = ownParts();
    if (!parts) return;
    var group = parts.group;
    injectStyle();
    if (!hasClass(group, 'cfbe-own-group')) {
      group.className = ((group.className || '') + ' cfbe-own-group').replace(/^\s+/, '');
    }
    splitDescription(parts.sub);
    collapseDescription(parts.sub);   // after the split: it counts the .cfbe-p divs
    tipSettings();                    // the setting rows, which are not in the header
    ensureStaleNotice(parts);         // before the early return: the link outlives it
    if (document.getElementById(README_LINK_ID)) return;
    var link = el('a', 'cfbe-readme', 'CustomFieldsBulkEditor/README.md');
    link.id = README_LINK_ID;
    link.href = README_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Open this plugin\'s documentation';
    var slot = readmeLinkSlot(parts.sub);
    slot.parent.insertBefore(link, slot.before);
  }

  // ── Hiding entities from Stash's add/select dropdowns ─────────────────────
  //
  // An entity carrying the field named by `c1ExcludeFromAddListField` is dropped from
  // the six `Find*ForSelect` queries Stash's own select components run - the dropdown
  // you pick a tag, performer, studio, group, gallery or scene from while editing
  // something else. It is still on its list page, still on the entities that already
  // have it, and still in the API: this hides it from being *added*, nothing more.
  //
  // All six types rather than tags alone, for the reason the feature exists at all: a
  // plumbing entity is plumbing whatever its type.
  //
  // **This is what made the plugin wrap `window.fetch`**, which §7 of its CLAUDE.md
  // said it never would. It still registers no `respecters` entry: it filters what a
  // *read* answers, and never reacts to anyone's write, so there is nothing for it to
  // stand down from while a sibling holds a lease.
  var SELECT_OPS = {
    FindScenesForSelect: 'scenes', FindGalleriesForSelect: 'galleries',
    FindPerformersForSelect: 'performers', FindStudiosForSelect: 'studios',
    FindGroupsForSelect: 'groups', FindTagsForSelect: 'tags',
  };

  var _marked = {};            // entity key -> Promise of { ids: {}, count: n }
  var _filterSettings = null;

  function filterSettings() {
    if (!_filterSettings) {
      _filterSettings = loadSettings().then(null, function () { return DEFAULTS; });
    }
    return _filterSettings;
  }

  // Lazily, once per type per page load, and never refreshed - the same cache-first
  // bargain Stash's own UI makes with its tag list: mark something in another tab and
  // this tab picks it up on reload.
  // Polling six queries against a library this size to catch a rare edit would cost
  // more than it saves.
  function markedIds(spec, field) {
    if (_marked[spec.key]) return _marked[spec.key];
    _marked[spec.key] = gqlRequest('query CFBE_Marked { find' + spec.plural +
      '(filter: { per_page: -1 }, ' + FILTER_ARG[spec.key] + ': { custom_fields: [{ field: ' +
      JSON.stringify(field) + ', modifier: NOT_NULL }] }) { ' + spec.key +
      ' { id custom_fields } } }', null).then(function (data) {
      var list = ((data && data['find' + spec.plural]) || {})[spec.key] || [];
      var out = { ids: {}, count: 0 };
      list.forEach(function (o) {
        if (!isMarked((o.custom_fields || {})[field])) return;
        out.ids[String(o.id)] = true;
        out.count++;
      });
      return out;
    }, function () { return { ids: {}, count: 0 }; });
    return _marked[spec.key];
  }

  // **A by-id request under the same operation name must not be filtered**, and this is
  // the one thing here that would have been a data loss rather than a nuisance.
  // `StashService.ts` has two functions per type behind one operation:
  // `queryFindTagsForSelect(filter)` asks what to *offer*, and
  // `queryFindTagsByIDForSelect(ids)` asks for the ones already *assigned*, so the
  // editor can draw them. Filtering the second would make a marked tag vanish out of the
  // form of every entity that already has it - and then saving that form would take the
  // tag off. `ids` in the variables is what tells them apart.
  function selectOp(init) {
    try {
      var body = init && init.body;
      if (!body || typeof body !== 'string') return null;
      var req = JSON.parse(body);
      if (!hasOwn(SELECT_OPS, req.operationName)) return null;
      var ids = req.variables && req.variables.ids;
      if (ids && ids.length) return null;
      return SELECT_OPS[req.operationName];
    } catch (e) {
      return null;
    }
  }

  // A real `Response` where there is one, because Apollo reads the body through it and
  // a shim is one method away from being wrong about something. The plain object is for
  // the test harness, whose fetch answers with exactly this shape.
  function jsonResponse(resp, json) {
    var text = JSON.stringify(json);
    if (typeof Response === 'function') {
      return new Response(text,
        { status: resp.status, statusText: resp.statusText, headers: resp.headers });
    }
    return {
      ok: resp.ok, status: resp.status, statusText: resp.statusText, headers: resp.headers,
      json: function () { return Promise.resolve(json); },
      text: function () { return Promise.resolve(text); },
      clone: function () { return this; },
    };
  }

  function filterSelectResponse(resp, key) {
    var spec = ENTITIES[key];
    return filterSettings().then(function (s) {
      var field = s.c1ExcludeFromAddListField;
      if (!field) return resp;                       // cleared: the filter is off
      return markedIds(spec, field).then(function (marked) {
        if (!marked.count) return resp;
        return resp.clone().json().then(function (json) {
          var res = ((json || {}).data || {})['find' + spec.plural];
          var list = res && res[spec.key];
          if (!list || !list.length) return resp;
          var kept = list.filter(function (o) { return !marked.ids[String(o.id)]; });
          if (kept.length === list.length) return resp;
          res[spec.key] = kept;
          // The count rides along on these queries and Stash shows it as "N more" - so
          // it has to lose exactly what the list did, or the dropdown offers to load
          // entities that are not there.
          if (typeof res.count === 'number') res.count -= (list.length - kept.length);
          return jsonResponse(resp, json);
        });
      });
    });
  }

  // Wrapped once, and every failure path returns the original response: a dropdown that
  // shows one entity too many is a nuisance, and one that shows nothing because a
  // filter threw is a broken editor.
  function installSelectFilter() {
    if (!window.fetch || window.__cfbeSelectFilter) return;
    window.__cfbeSelectFilter = true;
    var orig = window.fetch;
    window.fetch = function (url, init) {
      var out = orig.apply(this, arguments);
      var key = selectOp(init);
      if (!key || !out || typeof out.then !== 'function') return out;
      return out.then(function (resp) {
        try {
          return filterSelectResponse(resp, key).then(null, function () { return resp; });
        } catch (e) {
          return resp;
        }
      });
    };
  }

  // ── Ticking ───────────────────────────────────────────────────────────────
  //
  // Stash is a SPA, so there is no page load to hang this off: the tick re-derives
  // whether the menu item should exist from the route, the open menu and the
  // selection, and every signal below is just a reason to run it again.
  //
  // A MutationObserver as well as the timer, because the dropdown is mounted the
  // instant the user opens it and has to carry our item before they read it - a
  // one-second poll would show the menu without it about half the time.
  var _tickTimer = null;

  function scheduleTick() {
    if (_tickTimer) return;
    _tickTimer = setTimeout(function () {
      _tickTimer = null;
      try { menuTick(); } catch (e) { console.error('[cfbe] tick failed', e); }
    }, OBSERVE_MS);
  }

  var _observing = false;
  function startObserver() {
    if (_observing || typeof MutationObserver === 'undefined') return;
    var root = document.getElementById('root') || document.body;
    if (!root) return;
    _observing = true;
    var observer = new MutationObserver(scheduleTick);
    observer.observe(root, { childList: true, subtree: true });
  }

  // The settings page is not observed, only ticked: this is decoration in a panel,
  // not something that has to land before the user can click it, so the timer plus
  // the navigation hooks are enough and cannot fight a React re-render. The menu item
  // is the opposite case, which is why only `menuTick` is on the observer.
  function tick() {
    try { menuTick(); } catch (e) { console.error('[cfbe] tick failed', e); }
    try { settingsTick(); } catch (e) { console.error('[cfbe] settings tick failed', e); }
    try { paintTaskButtons(); } catch (e) { console.error('[cfbe] task paint failed', e); }
  }

  if (window.addEventListener) {
    window.addEventListener('load', function () { tick(); startObserver(); });
    window.addEventListener('popstate', function () { setTimeout(tick, 300); });
  }
  setInterval(tick, TICK_MS);
  tick();
  startObserver();
  installSelectFilter();
}());
