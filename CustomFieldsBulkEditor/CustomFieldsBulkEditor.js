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
  var PLUGIN_VERSION = '0.2.4';

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
  var LEASE_TTL_MS = 300000;
  var UNDO_ARM_MS  = 4000;  // how long Undo stays armed for its second click
  var TICK_MS      = 1000;
  var OBSERVE_MS   = 100;   // a burst of DOM mutations coalesced into one tick
  var ROW_WALK_MAX = 8;     // ancestors climbed from a checkbox looking for its row
  var LIST_RENDER_CAP = 1000;  // listing rows put in the DOM; all of them stay in memory
  var EQ = '🟰';  // the name-value separator, U+1F7F0
  var NONE = '␀';      // "no field here": what an Add starts from, a Delete ends at, U+2400
  var ARROW = ' ⇒ ';

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
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
    'width:min(56rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
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
    // The list was a <textarea> until 0.2.0, which is what made it selectable and
    // copyable with nothing to press and kept a selection of several thousand
    // entities down to one node. Pills need real elements, so the node count is back
    // and `LIST_RENDER_CAP` is what keeps it bounded - the same trade the siblings
    // make with `LOG_RENDER_CAP`.
    '.cfbe-list{width:100%;height:100%;min-height:12rem;box-sizing:border-box;overflow:auto;' +
    'background:#1f2b33;color:#f5f8fa;border:1px solid #394b59;border-radius:3px;' +
    'font-family:monospace;font-size:.8rem;line-height:1.9;padding:.35rem .5rem;}' +
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
    '.cfbe-none{color:#a7b6c2;font-family:sans-serif;}' +
    '.cfbe-pill-failed{background:#7a3b3b;}' +
    '.cfbe-msgs{max-height:6rem;overflow:auto;padding:0 1rem .35rem;font-family:monospace;' +
    'font-size:.8rem;line-height:1.35;}' +
    '.cfbe-editor{padding:.5rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.cfbe-label{color:#a7b6c2;font-size:.85rem;white-space:nowrap;}' +
    '.cfbe-input,.cfbe-select{background:#1f2b33;color:#f5f8fa;border:1px solid #394b59;' +
    'border-radius:3px;padding:.25rem .5rem;}' +
    '.cfbe-input{flex:1 1 10rem;min-width:8rem;}' +
    // The value box is disabled while the mode is the whole query, and these inputs
    // set their own background and colour, so the browser's own disabled look does not
    // show through.
    '.cfbe-input:disabled{opacity:.5;}' +
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
    // There are no per-setting tooltip rules here because there are no settings; see
    // §5 of this plugin's CLAUDE.md. The three rules below are the description half
    // of the shared design and are byte-identical with the siblings' copies.
    '.cfbe-own-group .sub-heading{white-space:pre-wrap;}' +
    '.cfbe-own-group .sub-heading .cfbe-p{margin:0 0 .35em;}' +
    '.cfbe-own-group .sub-heading .cfbe-p:last-child{margin-bottom:0;}' +
    '.cfbe-desc-collapsed .cfbe-p:not(:first-child){display:none;}' +
    '.cfbe-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
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

  // ── The dialog ────────────────────────────────────────────────────────────

  var _active = null;

  function startRun(type, ids) {
    if (_active) { _active.focus(); return; }
    _active = new Run(type, ids);
    _active.begin();
  }

  function Run(type, ids) {
    this.type = type;
    this.spec = ENTITIES[type];
    this.ids = ids;
    // { id, label, fields } per entity that still exists, in selection order.
    this.entities = [];
    // The listing, flattened: one per (entity, custom field).
    this.rows = [];
    // What the last Apply wrote, and what each entity carried before it. This is what
    // Undo replays - a per-key delta, never a stored copy of the whole map, so it puts
    // back exactly the one field this dialog changed and touches nothing else.
    this.changes = [];
    this.applied = 0;
    this.failed = 0;
    this.undone = 0;
    // Set by checkVersion when the running script is not the one Stash has installed.
    this.stale = false;
    this.undoArmed = 0;
    this.state = 'loading';
    this.build();
  }

  Run.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'cfbe-backdrop');
    this.modal = el('div', 'cfbe-modal');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'cfbe-head');
    // A plain block, so a title too long for one line wraps rather than being clipped.
    head.appendChild(el('div', 'cfbe-title', PLUGIN_SHORT_NAME + ' - ' + this.spec.plural +
      ' - ' + this.ids.length + ' selected'));
    head.appendChild(el('div', 'cfbe-warn',
      'Backing up your database before proceeding is recommended. Apply rewrites one custom field across every ' +
      'entity in scope, and Undo reverses only what this dialog wrote, only while it stays ' +
      'open, and cannot account for changes made elsewhere in the meantime.'));
    head.appendChild(el('div', 'cfbe-legend',
      'Reading the list: the number in brackets after a name is that entity\'s Stash id - ' +
      'Scene "My Scene" (123) is the scene with id 123. Counts are written as x250, never in ' +
      'brackets. A line reads: entity: field name ' + EQ + ' field value, and after Apply, ' +
      'what changed as before ' + ARROW.replace(/^\s+|\s+$/g, '') + ' after. ' + NONE +
      ' marks nothing there - either no such field, or a field set to an empty value; it is a ' +
      'mark on the screen only, and copies as nothing. Click an entity to open it in a new tab; ' +
      'click a field name or value to copy it. Selecting lines and copying gives plain text.'));
    this.noteEl = el('div', 'cfbe-note', '');
    head.appendChild(this.noteEl);
    var link = el('a', 'cfbe-readme', 'Plugin README');
    link.href = README_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    head.appendChild(link);
    this.modal.appendChild(head);

    this.progressEl = el('div', 'cfbe-progress', 'Loading...');
    this.modal.appendChild(this.progressEl);

    var filters = el('div', 'cfbe-search');
    filters.appendChild(el('span', 'cfbe-label', 'Filter by Name'));
    this.nameFilter = this.input('cfbe-filter-name');
    filters.appendChild(this.nameFilter);
    filters.appendChild(el('span', 'cfbe-label', 'Filter by Value'));
    // The mode is a control of its own rather than something typed into the box, because
    // any sentinel the box could carry is also a value somebody is allowed to have.
    this.valueMode = this.select('cfbe-filter-mode', [
      ['contains', 'contains'], ['empty', 'is empty'],
    ], 'contains');
    filters.appendChild(this.valueMode);
    this.valueFilter = this.input('cfbe-filter-value');
    filters.appendChild(this.valueFilter);
    [this.nameFilter, this.valueFilter].forEach(function (i) {
      i.addEventListener('input', function () { self.renderList(); });
    });
    this.valueMode.addEventListener('change', function () {
      // Nothing to type in when the mode is the whole query, and a box left enabled
      // would read as a second condition that is silently not applied.
      self.valueFilter.disabled = self.valueMode.value !== 'contains';
      self.renderList();
    });
    this.modal.appendChild(filters);

    var listWrap = el('div', 'cfbe-log');
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

    this.msgEl = el('div', 'cfbe-msgs');
    this.modal.appendChild(this.msgEl);

    var ops = el('div', 'cfbe-editor');
    this.modeSel = this.select('cfbe-mode', [
      ['add', 'Add'], ['overwrite', 'Overwrite'], ['remove', 'Remove'],
    ], 'add');
    this.scopeSel = this.select('cfbe-scope', [
      ['all', 'All'], ['filtered', 'Filtered list only'],
    ], 'all');
    ops.appendChild(el('span', 'cfbe-label', 'Operation'));
    ops.appendChild(this.modeSel);
    ops.appendChild(el('span', 'cfbe-label', 'Apply to'));
    ops.appendChild(this.scopeSel);
    [this.modeSel, this.scopeSel].forEach(function (s) {
      s.addEventListener('change', function () { self.syncApply(); });
    });
    this.modal.appendChild(ops);

    var fields = el('div', 'cfbe-editor');
    fields.appendChild(el('span', 'cfbe-label', 'Custom Field name'));
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
    this.closeBtn = button('Close', 'cfbe-close cfbe-hidden');
    this.applyBtn.disabled = true;
    this.undoBtn.title = 'Put back the value each entity carried before Apply, field by field. ' +
      'Only what this dialog wrote, and only while it stays open.';

    this.cancelBtn.addEventListener('click', function () { self.close(); });
    this.applyBtn.addEventListener('click', function () { self.apply(); });
    this.undoBtn.addEventListener('click', function () { self.undo(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });

    [this.cancelBtn, this.undoBtn, this.applyBtn, this.closeBtn].forEach(function (b) {
      foot.appendChild(b);
    });
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

  Run.prototype.select = function (className, options, initial) {
    var s = el('select', 'cfbe-select ' + className);
    options.forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
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
    this.show(this.undoBtn, applied && this.changes.length > 0);
    this.show(this.closeBtn, applied);
    this.cancelBtn.disabled = busy;
    this.undoBtn.disabled = busy;
    this.closeBtn.disabled = busy;
    [this.modeSel, this.scopeSel, this.nameInput, this.valueInput].forEach(function (n) {
      n.disabled = !listing;
    });
    this.syncApply();
  };

  // Apply is enabled by the one rule the user asked for - a non-empty field name,
  // an empty value being a legitimate thing to store - plus the version gate, which
  // is the only warning in this repo's dialogs that blocks. Undo is deliberately not
  // gated on it: stranding the user with changes they cannot take back is worse than
  // the mismatch it protects against.
  Run.prototype.syncApply = function () {
    this.applyBtn.disabled = this.state !== 'listing' ||
      !String(this.nameInput.value || '').replace(/^\s+|\s+$/g, '') || this.stale;
  };

  Run.prototype.note = function (message) {
    this.msg('WARN', message);
    this.noteEl.textContent = this.noteEl.textContent
      ? this.noteEl.textContent + ' ' + message : message;
  };

  Run.prototype.msg = function (kind, message) {
    this.msgEl.appendChild(el('div', 'cfbe-line cfbe-' + kind, '[' + kind + '] ' + message));
    if (typeof this.msgEl.scrollHeight === 'number') this.msgEl.scrollTop = this.msgEl.scrollHeight;
  };

  Run.prototype.begin = function () {
    var self = this;
    this.setState('loading');

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

    this.load().then(function () {
      self.setState('listing');
      self.renderList();
    }, function (e) {
      self.msg('ERROR', 'Reading custom fields failed: ' + (e && e.message ? e.message : String(e)));
      self.setState('listing');
      self.renderList();
    });
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
        installed + ' installed. Reload the page before applying anything.');
      self.syncApply();
    });
  };

  // ── Reading ───────────────────────────────────────────────────────────────
  //
  // One aliased by-id query per batch of a hundred, rather than a filtered list query
  // per entity type. Every one of the seven has a `find<Type>(id:)`, so one query
  // shape serves all of them and nothing here has to be right about the shape of
  // seven different filter inputs.
  Run.prototype.load = function () {
    var self = this;
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
        self.entities.push({
          id: String(ent.id), display: displayName(ent) || 'untitled',
          fields: ent.custom_fields || {},
        });
      });
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
        rows.push({ id: e.id, display: e.display, name: k, value: valueText(e.fields[k]) });
      });
    });
    this.rows = rows;
  };

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
  function copyPill(text) {
    var p = pill('cf', text === '' ? null : text);
    if (text === '') p.appendChild(noneNode('empty - this field is set, to nothing'));
    p.title = 'Click to copy';
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
    row.appendChild(copyPill(field.name));
    row.appendChild(textNode(EQ));
    row.appendChild(copyPill(field.value));
  }

  Run.prototype.rowNode = function (r, action, before, after) {
    var row = el('div', 'cfbe-entry');
    if (action) {
      row.appendChild(pill('act', action));
      row.appendChild(textNode(' '));
    }
    row.appendChild(textNode(this.spec.label + ' '));
    row.appendChild(entityPill(this.spec, r.id, r.display));
    row.appendChild(textNode(': '));
    appendField(row, before);
    if (action) {
      row.appendChild(textNode(ARROW));
      appendField(row, after);
    }
    return row;
  };

  // One place where the cap is applied, so both the listing and the change recap say
  // the same thing when there is more than the DOM should hold.
  Run.prototype.fillList = function (items, build) {
    var self = this;
    while (this.listEl.firstChild) this.listEl.removeChild(this.listEl.firstChild);
    items.slice(0, LIST_RENDER_CAP).forEach(function (item) {
      self.listEl.appendChild(build.call(self, item));
    });
    if (items.length > LIST_RENDER_CAP) {
      this.listEl.appendChild(el('div', 'cfbe-entry cfbe-INFO',
        '... and ' + (items.length - LIST_RENDER_CAP) + ' more line(s) not shown. ' +
        'Filter to narrow the list; every one of them is still in scope.'));
    }
  };

  Run.prototype.filtered = function () {
    var name = String(this.nameFilter.value || '').toLowerCase();
    var empty = this.valueMode.value === 'empty';
    var value = empty ? '' : String(this.valueFilter.value || '').toLowerCase();
    return this.rows.filter(function (r) {
      return (!name || r.name.toLowerCase().indexOf(name) !== -1) &&
        (empty ? r.value === '' : (!value || r.value.toLowerCase().indexOf(value) !== -1));
    });
  };

  Run.prototype.renderList = function () {
    this.buildRows();
    var rows = this.filtered();
    this.fillList(rows, function (r) {
      return this.rowNode(r, null, { name: r.name, value: r.value });
    });
    this.renderProgress(rows.length);
  };

  Run.prototype.renderProgress = function (listed) {
    var withFields = this.entities.filter(function (e) {
      for (var k in e.fields) { if (hasOwn(e.fields, k)) return true; }
      return false;
    }).length;

    var summary;
    if (this.state === 'loading') {
      summary = 'Loading. ' + this.entities.length + ' of ' + this.ids.length + ' read';
    } else if (this.state === 'applying') {
      summary = 'Applying. ' + this.applied + ' of ' + this.changes.length + ' entity change(s) written';
    } else if (this.state === 'undoing') {
      summary = 'Undoing. ' + this.undone + ' of ' + this.changes.length + ' change(s) reversed';
    } else if (this.state === 'applied') {
      summary = 'Applied. ' + this.applied + ' entity change(s) written' +
        (this.failed ? ', ' + this.failed + ' failed' : '') +
        (this.undone ? ', ' + this.undone + ' reversed by Undo' : '');
    } else {
      summary = this.entities.length + ' ' + this.spec.plural.toLowerCase() + ' read, ' +
        withFields + ' with custom fields, ' + this.rows.length + ' field(s) in total, ' +
        (listed == null ? this.rows.length : listed) + ' line(s) listed';
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
      var keep = {};
      this.filtered().forEach(function (r) { keep[r.id] = true; });
      scope = scope.filter(function (e) { return hasOwn(keep, e.id); });
    }

    var changes = [];
    scope.forEach(function (e) {
      var has = hasOwn(e.fields, name);
      if (mode === 'add' && has) return;
      if (mode === 'remove' && !has) return;
      var after = mode === 'remove' ? null : value;
      // Nothing to write where the value is already exactly what was asked for.
      if (mode !== 'remove' && has && valueText(e.fields[name]) === value) return;
      changes.push({
        id: e.id, display: e.display, entity: e, name: name,
        had: has, before: has ? e.fields[name] : null, after: after, remove: mode === 'remove',
      });
    });
    return { mode: mode, name: name, value: value, changes: changes };
  };

  Run.prototype.apply = function () {
    var self = this;
    var planned = this.plan();
    if (!planned.changes.length) {
      this.msg('INFO', 'Nothing to change: no ' + this.spec.plural.toLowerCase() +
        ' in scope need "' + planned.name + '" ' +
        (planned.mode === 'remove' ? 'removed.' : 'set to that value.'));
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

    var ids = planned.changes.map(function (c) { return c.id; });
    var label = 'Custom Fields - ' + planned.mode + ' "' + planned.name + '"';

    this.runWrites([{ ids: ids, cf: payload }], label).then(function (ok) {
      self.applied = ok;
      // The local copy is moved with the server's, so Undo compares against what the
      // dialog actually wrote rather than against the map it read at open.
      planned.changes.forEach(function (c) {
        if (planned.mode === 'remove') delete c.entity.fields[c.name];
        else c.entity.fields[c.name] = planned.value;
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
      this.undoBtn.textContent = 'Undo ' + this.changes.length + ' change(s)?';
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
      var key = c.had ? 'v:' + valueText(c.before) : 'absent';
      if (!groups[key]) {
        groups[key] = { ids: [], cf: c.had
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
      self.changes.forEach(function (c) {
        if (c.had) c.entity.fields[c.name] = c.before;
        else delete c.entity.fields[c.name];
      });
      self.renderChanges(null, true);
      // Back to `applied` rather than to `listing`: the listing this dialog opened
      // with describes a library it has now written to twice, and re-offering Apply
      // over it would write from a plan nobody is looking at. Rescanning is what
      // closing and reselecting does.
      self.changes = [];
      self.setState('applied');
      self.renderProgress();
    });
  };

  // The one write driver, shared by Apply and Undo. Takes the lease, renews it per
  // batch and releases it in every outcome - success, failure, an empty batch list -
  // so a reactive plugin is never left standing down.
  Run.prototype.runWrites = function (batches, label) {
    var self = this;
    var spec = this.spec;
    var lease = acquireLease(label);
    var ok = 0;

    // One chunk per bulk mutation - or per *entity* where there is no bulk mutation,
    // so that one refused Studio is reported as one failure rather than taking the
    // ninety-nine that were written with it out of the count.
    var size = spec.bulk ? CHUNK_SIZE : 1;
    var chunks = [];
    batches.forEach(function (b) {
      for (var i = 0; i < b.ids.length; i += size) {
        chunks.push({ ids: b.ids.slice(i, i + size), cf: b.cf });
      }
    });

    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        lease.renew();
        return self.writeChunk(spec, chunk).then(function () {
          ok += chunk.ids.length;
          self.applied = self.state === 'applying' ? ok : self.applied;
          self.undone = self.state === 'undoing' ? ok : self.undone;
          self.renderProgress();
        }, function (e) {
          self.failed += chunk.ids.length;
          self.msg('ERROR', 'Writing ' + chunk.ids.length + ' ' +
            spec.plural.toLowerCase() + ' failed: ' + (e && e.message ? e.message : String(e)));
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

  // After a write the list box shows what happened rather than what was there: the
  // listing it replaces described the library before the write, and leaving it up
  // would be the dialog's own stalest possible claim.
  Run.prototype.renderChanges = function (planned, reversed) {
    this.fillList(this.changes, function (c) {
      var before = c.had ? { name: c.name, value: valueText(c.before) } : null;
      var after = c.remove ? null : { name: c.name, value: valueText(c.after) };
      if (reversed) { var swap = before; before = after; after = swap; }
      // The action is read off the two sides rather than off the mode, which is what
      // makes an undo name itself correctly: reversing an Added is a Deleted.
      var action = !before ? 'Added' : !after ? 'Deleted' : 'Replaced';
      return this.rowNode(c, action, before, after);
    });
    if (planned) {
      this.msg('INFO', 'Applied "' + planned.mode + '" on field "' + planned.name + '" to ' +
        this.changes.length + ' ' + this.spec.plural.toLowerCase() + '.');
    } else {
      this.msg('INFO', 'Reversed ' + this.changes.length + ' change(s).');
    }
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

  // ── The settings page ─────────────────────────────────────────────────────
  //
  // This plugin has no settings, so its block in Settings → Plugins is a heading, a
  // description and Stash's own Enable/Disable and link buttons - nothing to
  // configure. It still gets the siblings' description treatment, because the
  // description is the only thing there that is ours and it is the first thing a
  // user reads before installing: a one-line summary, the rest behind **Show more**,
  // and a labelled link to the README under it.
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

  function ownSettingGroup() {
    var heads = document.querySelectorAll ? document.querySelectorAll('h3') : [];
    for (var i = 0; i < heads.length; i++) {
      if (!headingIsOurs(heads[i].textContent)) continue;
      var node = heads[i];
      for (var d = 0; node && d < 10; d++, node = node.parentElement) {
        if (hasClass(node, 'setting-group')) return node;
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
  function splitDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
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
  function collapseDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
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
  function readmeLinkSlot(group) {
    var sub = byClass(group, 'sub-heading');
    if (sub && sub.parentNode) return { parent: sub.parentNode, before: sub.nextSibling };
    var header = byClass(group, 'setting');
    var box = header && header.childNodes && header.childNodes[0];
    if (box) return { parent: box, before: null };
    return { parent: group, before: null };
  }

  // Re-added rather than tracked: React re-renders this panel and drops anything we
  // put in it. Keyed on the id, so a re-render that kept it makes no second one.
  function settingsTick() {
    var group = ownSettingGroup();
    if (!group) return;
    injectStyle();
    if (!hasClass(group, 'cfbe-own-group')) {
      group.className = ((group.className || '') + ' cfbe-own-group').replace(/^\s+/, '');
    }
    splitDescription(group);
    collapseDescription(group);   // after the split: it counts the .cfbe-p divs
    if (document.getElementById(README_LINK_ID)) return;
    var link = el('a', 'cfbe-readme', 'CustomFieldsBulkEditor/README.md');
    link.id = README_LINK_ID;
    link.href = README_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Open this plugin\'s documentation';
    var slot = readmeLinkSlot(group);
    slot.parent.insertBefore(link, slot.before);
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
  }

  if (window.addEventListener) {
    window.addEventListener('load', function () { tick(); startObserver(); });
    window.addEventListener('popstate', function () { setTimeout(tick, 300); });
  }
  setInterval(tick, TICK_MS);
  tick();
  startObserver();
}());
