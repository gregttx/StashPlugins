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
  var PLUGIN_NAME = 'Normalize Parent Tags';
  var SIBLING_ID  = 'MergePerformerTagsToScenes';

  // The one version that proves anything. Everything the settings page shows is read
  // from the manifest over GraphQL and updates the moment plugins are reloaded, while
  // the browser can go on running a script it cached before the edit - so a heading
  // reading 1.4.4 over 1.4.0 behaviour is the normal look of a stale script, not a
  // contradiction. This constant travels inside the file, so the line below says
  // which script is actually running. Bump it with the manifest and the yml; the
  // `version` suite fails if the three disagree.
  var PLUGIN_VERSION = '1.6.1';

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

  var TASK_PRUNE  = 'Prune Parent Tags from Entities';
  var TASK_ROLLUP = 'Roll Up Parent Tags onto Entities';
  var TASK_TREE   = 'Show Tag Hierarchy';
  var TASKS = [TASK_PRUNE, TASK_ROLLUP, TASK_TREE];

  var PAGE_SIZE      = 1000;  // entities per find query
  var CHUNK_SIZE     = 100;   // entity ids per bulk mutation
  var LOG_RENDER_CAP = 1000;  // log lines kept in the DOM; all of them stay in memory
  var LOG_FLUSH_MS   = 100;
  var LEASE_TTL_MS   = 300000;
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
  // `single` is the per-entity update mutation, watched by auto mode alongside
  // `bulk`. The two names never collide under a \b-anchored regex because Stash
  // capitalises the type inside the bulk name: "bulkSceneUpdate" does not contain
  // "sceneUpdate", and neither contains "sceneMarkerUpdate".
  var TYPES = [
    { key: 'performers', setting: 'a1EnablePerformers', label: 'Performer', plural: 'Performers',
      find: 'findPerformers', node: 'performers',
      bulk: 'bulkPerformerUpdate', bulkInput: 'BulkPerformerUpdateInput', single: 'performerUpdate',
      organized: false, fields: 'id name' },
    { key: 'studios', setting: 'a2EnableStudios', label: 'Studio', plural: 'Studios',
      find: 'findStudios', node: 'studios',
      bulk: 'bulkStudioUpdate', bulkInput: 'BulkStudioUpdateInput', single: 'studioUpdate',
      organized: true, fields: 'id name' },
    { key: 'groups', setting: 'a3EnableGroups', label: 'Group', plural: 'Groups',
      find: 'findGroups', node: 'groups',
      bulk: 'bulkGroupUpdate', bulkInput: 'BulkGroupUpdateInput', single: 'groupUpdate',
      organized: false, fields: 'id name' },
    { key: 'galleries', setting: 'a4EnableGalleries', label: 'Gallery', plural: 'Galleries',
      find: 'findGalleries', node: 'galleries',
      bulk: 'bulkGalleryUpdate', bulkInput: 'BulkGalleryUpdateInput', single: 'galleryUpdate',
      // A gallery is a zip (often .cbz) or a folder, and either way the title is
      // optional - so both fallbacks are needed to name one in the log.
      organized: true, fields: 'id title files { basename } folder { basename }' },
    { key: 'scenes', setting: 'a5EnableScenes', label: 'Scene', plural: 'Scenes',
      find: 'findScenes', node: 'scenes',
      bulk: 'bulkSceneUpdate', bulkInput: 'BulkSceneUpdateInput', single: 'sceneUpdate',
      organized: true, fields: 'id title files { basename }' },
    { key: 'images', setting: 'a6EnableImages', label: 'Image', plural: 'Images',
      find: 'findImages', node: 'images',
      bulk: 'bulkImageUpdate', bulkInput: 'BulkImageUpdateInput', single: 'imageUpdate',
      // Image.files is deprecated in favour of visual_files, which is a union of
      // ImageFile and VideoFile - hence the two inline fragments rather than a
      // plain basename selection. Both implement BaseFile, but naming the concrete
      // types is the form every Stash 0.31 accepts.
      organized: true, pageSize: 500,
      fields: 'id title visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }' },
    { key: 'markers', setting: 'a7EnableMarkers', label: 'Scene Marker', plural: 'Scene Markers',
      find: 'findSceneMarkers', node: 'scene_markers',
      bulk: 'bulkSceneMarkerUpdate', bulkInput: 'BulkSceneMarkerUpdateInput', single: 'sceneMarkerUpdate',
      organized: false, fields: 'id title primary_tag { id name }' },
  ];

  // ── Cross-plugin cooperation ──────────────────────────────────────────────
  //
  // See "Cross-plugin cooperation: the bulk-edit lease" in the repo-root CLAUDE.md.
  // A lease asks reactive plugins in this tab to stand down while we write. It is
  // advisory and always expires, so a crash cannot disable anyone permanently.
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
    a1EnablePerformers: false,
    a2EnableStudios: false,
    a3EnableGroups: false,
    a4EnableGalleries: false,
    a5EnableScenes: false,
    a6EnableImages: false,
    a7EnableMarkers: false,
    // The auto modes sit at the end of the `a` block rather than at its head, where
    // they read better, because a key is also the storage key: renumbering a1-a7 to
    // make room would silently reset every entity toggle on an existing install. They
    // still land under the toggles that scope them, which is the next best place.
    a8AutoPruneOnUpdate: false,
    a9AutoRollUpOnUpdate: false,
    b1ExcludeEntityWithTagName: '',
    b2ExcludeOrganized: false,
    c1ExcludeTagWithIgnoreAutoTag: false,
    c2ExcludeAddTagNameContains: '',
    c3ExcludeRemoveTagNameContains: '',
    c4TagNameSeparator: '',
    c5ExcludeAddTagWithCustomFieldName: '',
    c6ExcludeRemoveTagWithCustomFieldName: '',
  };

  function loadSettings() {
    return gqlRequest('{ configuration { plugins } }', null).then(function (data) {
      var all = (data.configuration || {}).plugins || {};
      var raw = all[PLUGIN_ID] || {};
      var s = {};
      for (var k in DEFAULTS) {
        if (!hasOwn(DEFAULTS, k)) continue;
        s[k] = typeof DEFAULTS[k] === 'boolean' ? !!raw[k] : (raw[k] || '');
      }
      return { settings: s, sibling: all[SIBLING_ID] || null };
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

  function tagName(graph, id) {
    var t = graph.byId[id];
    return (t && t.name) || 'unknown';
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
  function planTagCounts(plan) {
    var counts = {};
    plan.forEach(function (entry) {
      (entry.remove.length ? entry.remove : entry.add).forEach(function (tid) {
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
    var parts = [{ text: ids.length + ' tag(s) ' + verb + ': ' }];
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
  function planEntity(type, ent, mode, ctx) {
    var s = ctx.settings;
    if (s.b2ExcludeOrganized && type.organized && ent.organized) return null;

    var tagIds = (ent.tags || []).map(function (t) { return t.id; });

    // A marker's primary tag lives in its own required field. It counts as present -
    // so it can imply the removal of its own ancestors from the marker's tag list -
    // but it is never itself added or removed.
    var present = {};
    tagIds.forEach(function (id) { present[id] = true; });
    if (type.key === 'markers' && ent.primary_tag) present[ent.primary_tag.id] = true;

    if (ctx.excludeTagId && present[ctx.excludeTagId]) return null;

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

    if (mode === 'prune') {
      // Computed against the entity's original tag set, never against a set being
      // mutated as the loop runs: ancestry belongs to the tag graph, not to the
      // entity, so the result does not depend on the order tags are visited.
      var remove = tagIds.filter(function (tid) {
        return hasOwn(implied, tid) && ctx.filters.canRemove(tid);
      });
      // The tag named as the reason is never itself removed here: anything that
      // implied it would be a strictly lower candidate for the same ancestor, and
      // would have won. So a Prune line always points at a tag that survives.
      return remove.length ? { add: [], remove: remove, reason: reasonsFor(implied, remove) } : null;
    }

    var add = [];
    for (k in implied) {
      if (!hasOwn(implied, k)) continue;
      if (hasOwn(present, k)) continue;
      // A tag the filters reject is skipped on its own; its parents are still
      // added. The filters describe a tag, not a wall in the hierarchy.
      if (ctx.filters.canAdd(k)) add.push(k);
    }
    return add.length ? { add: add, remove: [], reason: reasonsFor(implied, add) } : null;
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
          run.appliedTags[tid] = (hasOwn(run.appliedTags, tid) ? run.appliedTags[tid] : 0) + 1;
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
          run.undoneTags[tid] = (hasOwn(run.undoneTags, tid) ? run.undoneTags[tid] : 0) + 1;
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
    'width:min(56rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
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
    '.npt-i-title{font-size:1rem;font-weight:600;margin-bottom:.4rem;font-family:monospace;}' +
    '.npt-i-label{color:#7cc4ff;margin-top:.6rem;}' +
    '.npt-i-body{color:#d6dee4;white-space:pre-wrap;word-break:break-word;}' +
    '.npt-i-hint{color:#7d8f9c;}' +
    '.npt-conflict{margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid #ffb648;' +
    'background:rgba(255,182,72,.12);color:#ffb648;font-size:.9rem;line-height:1.4;}';

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
    var mode = taskName === TASK_ROLLUP ? 'rollup' : 'prune';
    _active = new Run(taskName, mode);
    _active.begin();
  }

  function Run(taskName, mode) {
    this.taskName = taskName;
    this.mode = mode;
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
    this.appliedTags = {};
    this.failed = 0;
    // What this dialog has written and can still take back: the batches the server
    // accepted, newest last. Session-scoped like `lines` rather than pass-scoped -
    // rescan() saves it across this call - because a rescan is how a run converges
    // and losing the ability to undo the first pass at that point would be the
    // moment the button was most wanted.
    this.undoable = [];
    this.undone = 0;
    this.undoFailed = 0;
    this.undoneTags = {};
    this.undoTotal = 0;
    this.cancelled = false;
    this.stopped = false;
    this.lines = [];
    this.pending = [];
    // `lines` is the export buffer and survives a Rescan, because Copy log is meant
    // to hand over the whole session - rescan() saves it across this call. It is
    // emptied here rather than kept, so a first run starts clean without the
    // constructor needing a special case. `viewLines` counts what has gone into the
    // log since the current pass emptied the view, which is what the progress line
    // describes: a rescan logging four lines must not report 28161 of them, nor claim
    // to be hiding the 27161 it no longer has. Same split as the sibling's TaskRun.
    this.viewLines = 0;
    this.state = 'scanning';
  };

  Run.prototype.build = function () {
    injectStyle();
    var self = this;

    this.backdrop = el('div', 'npt-backdrop');
    this.modal = el('div', 'npt-modal');
    this.backdrop.appendChild(this.modal);

    var head = el('div', 'npt-head');
    head.appendChild(el('div', 'npt-title', PLUGIN_NAME + ' - ' + this.taskName));
    // The Undo button reverses this dialog's own writes while it is open. That is
    // not a restore and must never be allowed to read as one, so the backup
    // instruction keeps the position it has always had and the limits are stated
    // beside it rather than left to be discovered.
    head.appendChild(el('div', 'npt-warn',
      'Back up your database before proceeding. Undo only reverses what this dialog wrote, ' +
      'only while it stays open, and cannot account for changes made elsewhere in the meantime.'));
    // Every name in this log carries a number in brackets and it is always a Stash
    // id, never a count - the counts in the log are written as `x250` or spelled out.
    // Nothing else in the dialog says so, and an id read as "250 of these" is the
    // kind of misreading that gets a Prune approved for the wrong reason.
    head.appendChild(el('div', 'npt-legend',
      'Reading the log: the number in brackets after a name is that entity\'s or tag\'s Stash id - ' +
      'Scene "My Scene" (123) is the scene with id 123. Counts are written as x250, never in brackets.'));
    this.noteEl = el('div', 'npt-note', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.progressEl = el('div', 'npt-progress', 'Starting...');
    this.modal.appendChild(this.progressEl);

    this.logEl = el('div', 'npt-log');
    this.modal.appendChild(this.logEl);

    var foot = el('div', 'npt-foot');
    this.proceedBtn = button('Proceed', 'npt-proceed');
    this.cancelBtn  = button('Cancel', 'npt-cancel');
    this.stopBtn    = button('Stop', 'npt-stop npt-hidden');
    this.copyBtn    = button('Copy log', 'npt-copy');
    this.undoBtn    = button('Undo', 'npt-undo npt-hidden');
    this.rescanBtn  = button('Rescan', 'npt-rescan npt-hidden');
    this.closeBtn   = button('Close', 'npt-close npt-hidden');
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
    this.viewLines++;
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

  // ── Phase 1: scan ─────────────────────────────────────────────────────────

  Run.prototype.begin = function () {
    var self = this;
    this.setState('scanning');
    // Every pass re-derives the note from freshly loaded settings, so it has to
    // start empty: the warning it carries tells the user to turn the sibling's
    // auto-merge off and rescan, and leaving it up after they have done exactly
    // that says the run is still unsafe when it no longer is.
    this.noteEl.textContent = '';
    this.renderProgress();
    this.log('INFO', PLUGIN_NAME + ' - ' + this.taskName + ' - reviewing, nothing will be written yet.');

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

      var types = TYPES.filter(function (t) { return self.settings[t.setting]; });
      if (!types.length) {
        self.log('WARN', 'No entity types are enabled. Turn on at least one "Include ..." setting ' +
          'in Settings - Plugins - ' + PLUGIN_NAME + ', then run the task again.');
        self.finishScan();
        return;
      }
      self.log('INFO', 'Included, in processing order: ' +
        types.map(function (t) { return t.plural; }).join(', '));

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
            return scanType(t, self.mode, ctx);
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
      this.log('INFO', 'Merge Performer Tags To Scenes has ' + on.join(' and ') +
        ' enabled; it will stand down while changes are applied.');
      return;
    }
    this.note('Merge Performer Tags To Scenes has ' + on.join(' and ') + ' enabled, and this copy ' +
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
      this.log('INFO', 'Review complete: ' + this.plan.length + ' entity change(s) planned across ' +
        buildBatches(this.plan).length + ' request(s). Nothing has been written. Press Proceed to apply.');
      this.logTagSummary(planTagCounts(this.plan),
        this.mode === 'prune' ? 'to remove' : 'to add');
    }
    this.setState('ready');
    this.flush();
  };

  // ── Phase 2: apply ────────────────────────────────────────────────────────

  Run.prototype.proceed = function () {
    if (this.state !== 'ready' || !this.plan.length) return;
    var self = this;
    this.setState('applying');
    this.applied = 0;
    this.appliedTags = {};
    this.failed = 0;
    this.log('INFO', 'Applying ' + this.plan.length + ' entity change(s) - ' + new Date().toISOString());

    var batches = buildBatches(this.plan);
    var lease = acquireLease(this.taskName);
    var i = 0;

    function nextBatch() {
      if (self.stopped || i >= batches.length) return Promise.resolve();
      lease.renew();
      return applyBatch(batches[i++], self, self.graph).then(function () {
        self.renderProgress();
        return nextBatch();
      });
    }

    // The lease is released in every outcome - success, failure, or Stop - so a
    // reactive plugin is never left standing down.
    //
    // guarded() is the other half of that, pointed inwards: every batch here is a
    // bulk*Update, which is exactly what this plugin's own auto mode watches for, so
    // without it a Prune task with Auto Prune enabled would re-plan each batch it had
    // just written. The lease cannot do this job - it is advisory and we honour our
    // own leases no more than anyone else's.
    guarded(nextBatch).then(function () {
      lease.release();
      self.finishApply();
    }, function (e) {
      lease.release();
      self.log('ERROR', 'Apply aborted: ' + (e && e.message ? e.message : e));
      self.errors++;
      self.finishApply();
    });
  };

  Run.prototype.finishApply = function () {
    this.log('INFO', 'Finished. ' + this.applied + ' entity change(s) applied' +
      (this.failed ? ', ' + this.failed + ' failed' : '') +
      (this.stopped ? ' (stopped early; changes already applied stay applied)' : '') +
      '. Press Rescan to review what is left.');
    // Counted from what was written, not from the plan: a failed batch, or a Stop,
    // must not be summarised as though it had landed.
    this.logTagSummary(this.appliedTags, this.mode === 'prune' ? 'removed' : 'added');
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
      this.undoBtn.textContent = 'Undo ' + undoableCount(this.undoable) + ' change(s)?';
      this.undoTimer = setTimeout(function () { self.disarmUndo(); }, UNDO_ARM_MS);
      return;
    }
    this.disarmUndo();

    this.setState('undoing');
    this.stopped = false;
    this.undone = 0;
    this.undoFailed = 0;
    this.undoneTags = {};
    this.undoTotal = undoableCount(this.undoable);
    this.log('INFO', 'Undoing ' + this.undoTotal + ' entity change(s) - ' + new Date().toISOString());

    var batches = this.undoable.slice().reverse();
    // An undo is a bulk write like any other, so it announces itself the same way.
    var lease = acquireLease(this.taskName + ' (undo)');
    var i = 0;

    function nextBatch() {
      if (self.stopped || i >= batches.length) return Promise.resolve();
      lease.renew();
      return undoBatch(batches[i++], self, self.graph).then(function () {
        self.renderProgress();
        return nextBatch();
      });
    }

    // Guarded for the same reason the apply is, and more sharply: an undo writes the
    // inverse delta, so an auto mode reacting to it would put back exactly what the
    // user just asked to have taken away.
    guarded(nextBatch).then(function () {
      lease.release();
      self.finishUndo();
    }, function (e) {
      lease.release();
      self.log('ERROR', 'Undo aborted: ' + (e && e.message ? e.message : e));
      self.errors++;
      self.finishUndo();
    });
  };

  Run.prototype.finishUndo = function () {
    this.log('INFO', 'Undo finished. ' + this.undone + ' entity change(s) reversed' +
      (this.undoFailed ? ', ' + this.undoFailed + ' could not be' : '') +
      (this.stopped ? ' (stopped early; what was reversed stays reversed)' : '') +
      (this.undoable.length
        ? '. ' + undoableCount(this.undoable) + ' change(s) are still applied.'
        : '. Everything this dialog wrote has been taken back.'));
    // Prune put tags back; Roll Up took its own additions off again.
    this.logTagSummary(this.undoneTags, this.mode === 'prune' ? 'restored' : 'removed again');
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
  // with several parents are marked rather than hidden. Copy as DOT / Mermaid is
  // there for anyone who does want a drawn graph, in a tool built for it.

  var TREE_ROW_CAP = 4000;   // rows rendered at once by a search; see renderSearch

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
    head.appendChild(el('div', 'npt-title', PLUGIN_NAME + ' - ' + this.taskName));
    this.noteEl = el('div', 'npt-note',
      'Read-only. Nothing here writes anything. Badges reflect the exclusion filters ' +
      'currently set in the plugin settings.');
    head.appendChild(this.noteEl);
    // Rows read "Hair Colour (45)" and badges read "2 child(ren)", so a number in
    // brackets here is an id and a number outside them is a count. The inspector's
    // list headings follow the same rule - they say "Parents: 3", not "Parents (3)".
    head.appendChild(el('div', 'npt-legend',
      'Each row reads Tag name (id): the number in brackets is the tag\'s Stash id, not a count. ' +
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
    this.countsBtn = button('Load counts', 'npt-counts');
    this.dotBtn = button('Copy as DOT', 'npt-dot');
    this.mmdBtn = button('Copy as Mermaid', 'npt-mmd');
    this.closeBtn = button('Close', 'npt-close');

    this.expandBtn.addEventListener('click', function () { self.expandAll(true); });
    this.collapseBtn.addEventListener('click', function () { self.expandAll(false); });
    this.countsBtn.addEventListener('click', function () { self.loadCounts(); });
    this.dotBtn.addEventListener('click', function () { self.copyGraph('dot'); });
    this.mmdBtn.addEventListener('click', function () { self.copyGraph('mermaid'); });
    this.closeBtn.addEventListener('click', function () { self.close(); });

    [this.expandBtn, this.collapseBtn, this.countsBtn, this.dotBtn, this.mmdBtn, this.closeBtn]
      .forEach(function (b) { foot.appendChild(b); });
    this.modal.appendChild(foot);

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
      var warn = el('div', 'npt-warn',
        'This page is running ' + PLUGIN_NAME + ' ' + PLUGIN_VERSION + ', but ' + installed +
        ' is installed. Reload the page (F5); if this warning comes back, hard-refresh with ' +
        'Ctrl+Shift+R. Everything below describes the rules in this older script, which may ' +
        'not be what the tasks would do now.');
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
      this.progressEl.textContent = shown + ' of ' + total + ' tag(s) match "' + this.query + '".';
    } else {
      shown = 0;
      this.roots.forEach(function (rid) { shown += this.renderNode(rid, 0, null); }, this);
      this.progressEl.textContent = total + ' tag(s), ' + this.roots.length + ' root(s). ' +
        shown + ' row(s) shown - click a tag for what Prune and Roll Up would do with it.';
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
    // ask: brackets are the tag's Stash id, the same id the run logs it under. It
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
    else badges.push({ cls: 'npt-b-dim', text: kids.length + ' child(ren)' });
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
      // is a Stash id, and a heading that broke the rule read as the tag with id 3.
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

    line('npt-i-title', tagLabel(g, id));

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
          desc.length + ' descendant(s).');
    } else {
      line('npt-i-body', 'Prune never removes this: it has no descendants, so nothing on an ' +
        'entity can imply it.');
    }
    if (anc.length) {
      line('npt-i-body', 'Roll Up adds its ' + anc.length + ' ancestor(s) to every entity ' +
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
      self.countsBtn.textContent = 'Counts loaded';
      self._countsBusy = false;
      self.render();
    }, function (e) {
      self.countsBtn.textContent = 'Counts failed';
      self._countsBusy = false;
      self.progressEl.textContent = 'Counts could not be loaded: ' + (e && e.message ? e.message : e);
      setTimeout(function () { self.countsBtn.textContent = 'Load counts'; }, 3000);
    });
  };

  // ── Export ────────────────────────────────────────────────────────────────

  // With a tag selected, exports that tag's neighbourhood - ancestors, descendants
  // and the edges between them - which is the part that is actually legible as a
  // drawn graph. With nothing selected, the whole DAG.
  TreeView.prototype.exportIds = function () {
    var g = this.graph, ids = [], id;
    if (this.selected && g.byId[this.selected]) {
      var set = {}, k;
      set[this.selected] = true;
      var anc = g.ancestorsOf(this.selected);
      for (k in anc) if (hasOwn(anc, k)) set[k] = true;
      this.descendantsOf(this.selected).forEach(function (d) { set[d] = true; });
      for (k in set) if (hasOwn(set, k)) ids.push(k);
      return this.sortIds(ids);
    }
    for (id in g.byId) if (hasOwn(g.byId, id)) ids.push(id);
    return this.sortIds(ids);
  };

  function dotEscape(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  TreeView.prototype.graphText = function (kind) {
    var g = this.graph;
    var ids = this.exportIds();
    var inSet = {};
    ids.forEach(function (id) { inSet[id] = true; });
    var out = [];

    if (kind === 'mermaid') {
      out.push('graph LR');
      ids.forEach(function (id) {
        out.push('  t' + id + '["' + dotEscape((g.byId[id] || {}).name) + ' (' + id + ')"]');
      });
      ids.forEach(function (id) {
        g.parentsOf(id).forEach(function (pid) {
          if (hasOwn(inSet, pid)) out.push('  t' + pid + ' --> t' + id);
        });
      });
      return out.join('\n');
    }

    out.push('digraph tags {');
    out.push('  rankdir=LR;');
    out.push('  node [shape=box];');
    ids.forEach(function (id) {
      out.push('  "' + id + '" [label="' + dotEscape((g.byId[id] || {}).name) + '"];');
    });
    ids.forEach(function (id) {
      g.parentsOf(id).forEach(function (pid) {
        if (hasOwn(inSet, pid)) out.push('  "' + pid + '" -> "' + id + '";');
      });
    });
    out.push('}');
    return out.join('\n');
  };

  TreeView.prototype.copyGraph = function (kind) {
    if (!this.ready()) return;
    var text = this.graphText(kind);
    var btn = kind === 'mermaid' ? this.mmdBtn : this.dotBtn;
    var label = kind === 'mermaid' ? 'Copy as Mermaid' : 'Copy as DOT';
    var scope = this.selected ? 'selection' : 'whole hierarchy';
    function done(ok) {
      btn.textContent = ok ? 'Copied ' + scope : 'Copy failed';
      setTimeout(function () { btn.textContent = label; }, 2000);
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
  // Which entity types are covered is the a1-a7 toggles, the same ones that scope
  // the tasks. One list, so the settings page cannot describe two different
  // libraries, and the all-off default carries over unchanged: a fresh install
  // reacts to nothing until the user has said which types they have thought about.
  //
  // Four things keep this from eating a library:
  //
  // 1. Prune and Roll Up are exact inverses, so both at once is incoherent rather
  //    than merely redundant. Enabling both does nothing at all (see autoMode) - the
  //    alternative, picking one silently, is a trap dressed as a convenience.
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

  var AUTO_PRUNE_NAME  = 'Auto Prune on Entity Updates';
  var AUTO_ROLLUP_NAME = 'Auto Roll Up on Entity Updates';

  var _autoBothWarned = false;

  // 'prune', 'rollup', or null for "do nothing". Both flags on is a configuration
  // error rather than a preference: one adds exactly what the other removes, so
  // whichever ran second would undo the first on every save.
  function autoMode(s) {
    var prune = !!s.a8AutoPruneOnUpdate, rollup = !!s.a9AutoRollUpOnUpdate;
    if (prune && rollup) {
      if (!_autoBothWarned) {
        _autoBothWarned = true;
        console.warn('[npt] "' + AUTO_PRUNE_NAME + '" and "' + AUTO_ROLLUP_NAME +
          '" are both enabled. They are exact opposites - one adds every tag the ' +
          'other removes - so neither is running. Turn one of them off.');
      }
      return null;
    }
    _autoBothWarned = false;
    return prune ? 'prune' : (rollup ? 'rollup' : null);
  }

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
      'brackets after a name is that entity\'s or tag\'s Stash id.');
  }

  // Enough of a Run for applyBatch to write into. The dialog's version renders to
  // the DOM and feeds Undo; this one only has a console, which is the whole
  // difference between the two modes and the reason the setting descriptions warn
  // about it. `undoable` is collected and dropped on the floor deliberately -
  // applyBatch pushes to it, and there is no dialog here to offer it from.
  function autoSink() {
    return {
      undoable: [], appliedTags: {}, applied: 0, failed: 0, errors: 0,
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
      var mode = autoMode(s);
      // Re-checked here rather than only at the call site: settings can have been
      // refreshed between the mutation going out and this running.
      if (!mode || !s[type.setting]) return;

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

          var lease = acquireLease(mode === 'prune' ? AUTO_PRUNE_NAME : AUTO_ROLLUP_NAME,
            AUTO_LEASE_TTL_MS);
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

  // ── The both-modes-on notice ──────────────────────────────────────────────
  //
  // Turning on both auto modes runs neither (see autoMode), which is the safe
  // reading but an invisible one: the only signal was a console line, and nobody
  // has the console open while ticking a checkbox. So the plugin says so where the
  // mistake is made - in its own settings group, for as long as both are on.
  //
  // It only ever *reports*. Switching one of them off from here was the obvious
  // alternative and was rejected twice over: plugin settings are server-side and
  // shared by every tab and every user of that Stash, and Stash's settings page
  // holds them in React component state, so a configurePlugin write would leave the
  // checkbox visibly ticked until a reload - fixing the config and lying about it.
  // Driving Stash's own onChange through PluginApi.patch would work, but it turns
  // "both ticked does nothing" into "the second one you ticked is now live", which
  // for Auto Prune means silent deletions starting from a click that used to be
  // inert. A notice changes no behaviour and cannot surprise anyone.
  var CONFLICT_ID = 'npt-conflict-notice';
  var CONFLICT_TEXT = '⚠ ' + AUTO_PRUNE_NAME + ' and ' + AUTO_ROLLUP_NAME +
    ' are both enabled. They are exact opposites - one adds every tag the other ' +
    'removes - so neither is running. Turn one of them off.';

  // Where the notice goes, found by the one hook on that page that is not a
  // formatted display string: Stash gives every plugin setting an element id it
  // derives from the plugin id and the setting key -
  //
  //   id: `plugin-${pluginID}-${setting.name}`   (SettingsPluginsPanel.tsx)
  //
  // so `plugin-NormalizeParentTags-a8AutoPruneOnUpdate` is ours by construction. No
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
    var node = settingElement('a8AutoPruneOnUpdate') || settingElement('a9AutoRollUpOnUpdate');
    for (var d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return node;
    }
    return null;
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

  // What the two checkboxes say *right now*, or null if they cannot be read.
  //
  // This is the state the user is looking at, and it is why the notice no longer
  // asks the server what the settings are. Stash sets its own React state the moment
  // you click, then debounces the save; a notice driven by re-reading the config
  // therefore lagged the checkbox by seconds and disagreed with the screen while it
  // did - which is worse than useless for a warning about which boxes are ticked.
  function liveConflictState() {
    var prune = settingElement('a8AutoPruneOnUpdate');
    var rollup = settingElement('a9AutoRollUpOnUpdate');
    if (!prune || !rollup) return null;
    if (typeof prune.checked !== 'boolean' || typeof rollup.checked !== 'boolean') return null;
    return prune.checked && rollup.checked;
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
  // called "Normalize Parent Tags Extra" must not be mistaken for ours.
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

  function removeConflictNotice() {
    var node = document.getElementById(CONFLICT_ID);
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  // Top of our own group box where the ids are available, otherwise under the
  // heading. Returns null when neither is on the page, which is also how the tick
  // knows the plugins settings page is not showing.
  function conflictNoticeSlot() {
    // Immediately above the two Auto settings, which is where the user is looking
    // when they tick one. It used to go at the top of the group box so that it
    // showed while the group was collapsed - but a collapsed group is one you
    // cannot misconfigure from, and in an expanded one that put the notice off the
    // top of the screen, far from the checkboxes it is about.
    var row = settingRow('a8AutoPruneOnUpdate') || settingRow('a9AutoRollUpOnUpdate');
    if (row && row.parentNode) return { parent: row.parentNode, before: row };
    var group = ownSettingGroup();
    if (group) return { parent: group, before: group.firstChild };
    var heading = ownSettingGroupHeading();
    if (heading && heading.parentNode) {
      return { parent: heading.parentNode, before: heading.nextSibling };
    }
    return null;
  }

  function renderConflictNotice(show) {
    var slot = show ? conflictNoticeSlot() : null;
    if (!slot) { removeConflictNotice(); return; }
    // Idempotent: the tick runs on a timer and on every navigation, so an already
    // correctly placed notice must not be rebuilt - and one left behind by a React
    // re-render must not be duplicated.
    var existing = document.getElementById(CONFLICT_ID);
    if (existing) {
      if (existing.parentNode === slot.parent) return;
      removeConflictNotice();
    }
    injectStyle();
    var note = el('div', 'npt-conflict', CONFLICT_TEXT);
    note.id = CONFLICT_ID;
    if (slot.before) slot.parent.insertBefore(note, slot.before);
    else slot.parent.appendChild(note);
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
  var README_URL = 'https://github.com/gregttx/StashPlugins/blob/e81c38047df984ab2774c57fd725975a55043072/NormalizeParentTags/README.md';
  var README_LINK_ID = 'npt-readme-link';

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

  // Re-added rather than tracked: React re-renders this panel whenever a setting
  // changes and drops anything we put in it, so the tick puts it back. Keyed on the
  // id, so a re-render that kept it does not produce a second one.
  function ensureReadmeLink() {
    var group = ownSettingGroup();
    if (!group) return;
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

  function settingsTick() {
    // Ahead of the conflict logic and outside its early return: the link belongs on
    // the settings page whatever the two Auto settings happen to be.
    ensureReadmeLink();
    if (!conflictNoticeSlot()) {
      removeConflictNotice();
      return;
    }
    // The checkboxes are the truth here, and reading them costs nothing and lags by
    // nothing. Only where they cannot be read - a Stash that renders these settings
    // some other way - does this fall back to asking the server, with the lag that
    // implies.
    var live = liveConflictState();
    if (live !== null) {
      renderConflictNotice(live);
      return;
    }
    autoSettings().then(function (s) {
      renderConflictNotice(!!s.a8AutoPruneOnUpdate && !!s.a9AutoRollUpOnUpdate);
    }, function () {
      // A failed settings read says nothing about the conflict either way; leave
      // whatever is on screen rather than flickering it off and back on.
    });
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
    var node = btn;
    for (var depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      var heading = node.querySelector ? node.querySelector('h3') : null;
      if (heading && (heading.textContent || '').trim() === PLUGIN_NAME) return label;
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
          startRun(vars.task_name || TASK_PRUNE);
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
