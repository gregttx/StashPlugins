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

  var TASK_PRUNE  = 'Prune Parent Tags from Entities';
  var TASK_ROLLUP = 'Roll Up Parent Tags onto Entities';
  var TASKS = [TASK_PRUNE, TASK_ROLLUP];

  var PAGE_SIZE      = 1000;  // entities per find query
  var CHUNK_SIZE     = 100;   // entity ids per bulk mutation
  var LOG_RENDER_CAP = 1000;  // log lines kept in the DOM; all of them stay in memory
  var LOG_FLUSH_MS   = 100;
  var CLEAR_ARM_MS   = 4000;  // how long Clear log stays armed for its second click
  var LEASE_TTL_MS   = 300000;

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
  var TYPES = [
    { key: 'performers', setting: 'a1EnablePerformers', label: 'Performer', plural: 'Performers',
      find: 'findPerformers', node: 'performers',
      bulk: 'bulkPerformerUpdate', bulkInput: 'BulkPerformerUpdateInput',
      organized: false, fields: 'id name' },
    { key: 'studios', setting: 'a2EnableStudios', label: 'Studio', plural: 'Studios',
      find: 'findStudios', node: 'studios',
      bulk: 'bulkStudioUpdate', bulkInput: 'BulkStudioUpdateInput',
      organized: true, fields: 'id name' },
    { key: 'groups', setting: 'a3EnableGroups', label: 'Group', plural: 'Groups',
      find: 'findGroups', node: 'groups',
      bulk: 'bulkGroupUpdate', bulkInput: 'BulkGroupUpdateInput',
      organized: false, fields: 'id name' },
    { key: 'galleries', setting: 'a4EnableGalleries', label: 'Gallery', plural: 'Galleries',
      find: 'findGalleries', node: 'galleries',
      bulk: 'bulkGalleryUpdate', bulkInput: 'BulkGalleryUpdateInput',
      // A gallery is a zip (often .cbz) or a folder, and either way the title is
      // optional - so both fallbacks are needed to name one in the log.
      organized: true, fields: 'id title files { basename } folder { basename }' },
    { key: 'scenes', setting: 'a5EnableScenes', label: 'Scene', plural: 'Scenes',
      find: 'findScenes', node: 'scenes',
      bulk: 'bulkSceneUpdate', bulkInput: 'BulkSceneUpdateInput',
      organized: true, fields: 'id title files { basename }' },
    { key: 'images', setting: 'a6EnableImages', label: 'Image', plural: 'Images',
      find: 'findImages', node: 'images',
      bulk: 'bulkImageUpdate', bulkInput: 'BulkImageUpdateInput',
      // Image.files is deprecated in favour of visual_files, which is a union of
      // ImageFile and VideoFile - hence the two inline fragments rather than a
      // plain basename selection. Both implement BaseFile, but naming the concrete
      // types is the form every Stash 0.31 accepts.
      organized: true, pageSize: 500,
      fields: 'id title visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }' },
    { key: 'markers', setting: 'a7EnableMarkers', label: 'Scene Marker', plural: 'Scene Markers',
      find: 'findSceneMarkers', node: 'scene_markers',
      bulk: 'bulkSceneMarkerUpdate', bulkInput: 'BulkSceneMarkerUpdateInput',
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

  function acquireLease(label) {
    var c = coop();
    var lease = { owner: PLUGIN_ID, label: label, until: Date.now() + LEASE_TTL_MS };
    c.leases.push(lease);
    return {
      renew: function () { lease.until = Date.now() + LEASE_TTL_MS; },
      release: function () {
        var i = c.leases.indexOf(lease);
        if (i !== -1) c.leases.splice(i, 1);
      },
    };
  }

  function siblingRespectsLeases() {
    return !!coop().respecters[SIBLING_ID];
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
    b1ExcludeEntityWithTagName: '',
    b2ExcludeOrganized: false,
    c1ExcludeTagWithIgnoreAutoTag: false,
    c2ExcludeAddTagNameContains: '',
    c3ExcludeRemoveTagNameContains: '',
    c4ExcludeAddTagWithCustomFieldName: '',
    c5ExcludeRemoveTagWithCustomFieldName: '',
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

  function tagQuery(settings) {
    // sort_name is what Stash sorts by when it is set; it costs one nullable string
    // per tag on a query that is already fetching the whole hierarchy.
    var fields = 'id name sort_name ignore_auto_tag parents { id }';
    if ((settings.c4ExcludeAddTagWithCustomFieldName || '').trim() ||
        (settings.c5ExcludeRemoveTagWithCustomFieldName || '').trim()) {
      fields += ' custom_fields';
    }
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

    return {
      byId: byId,
      ancestorsOf: ancestorsOf,
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

  // ── Exclusion filters ─────────────────────────────────────────────────────

  function makeFilters(settings, graph) {
    var addCF     = (settings.c4ExcludeAddTagWithCustomFieldName || '').trim();
    var removeCF  = (settings.c5ExcludeRemoveTagWithCustomFieldName || '').trim();
    var addStr    = settings.c2ExcludeAddTagNameContains || '';
    var removeStr = settings.c3ExcludeRemoveTagNameContains || '';

    function blocked(id, cfName, substr) {
      var t = graph.byId[id];
      if (!t) return true;                       // unknown tag: never touch it
      if (graph.cyclic[id]) return true;         // see buildGraph
      if (settings.c1ExcludeTagWithIgnoreAutoTag && t.ignore_auto_tag) return true;
      // Presence alone excludes; the value is never inspected. hasOwnProperty
      // rather than `in`, or inherited keys like "constructor" match every tag.
      if (cfName && t.custom_fields && hasOwn(t.custom_fields, cfName)) return true;
      if (substr && (t.name || '').indexOf(substr) !== -1) return true;
      return false;
    }

    return {
      canAdd:    function (id) { return !blocked(id, addCF, addStr); },
      canRemove: function (id) { return !blocked(id, removeCF, removeStr); },
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

  // Ids arrive from GraphQL as strings. Compare them as numbers where both parse,
  // so 9 sorts below 10, and fall back to a string compare so the order is total
  // whatever Stash hands us.
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
  function tagSummaryLine(graph, counts, verb) {
    var ids = [], id;
    for (id in counts) if (hasOwn(counts, id)) ids.push(id);
    if (!ids.length) return '';
    ids.sort(function (a, b) {
      var c = collateNames(tagSortKey(graph, a), tagSortKey(graph, b));
      if (c) return c;
      return lowerId(a, b) ? -1 : 1;
    });
    return ids.length + ' tag(s) ' + verb + ': ' + ids.map(function (tid) {
      return tagLabel(graph, tid) + ' x' + counts[tid];
    }).join(', ');
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

  function applyBatch(batch, run, graph) {
    var query = 'mutation NPT_' + batch.type.bulk + '($input: ' + batch.type.bulkInput + '!) {' +
      '  ' + batch.type.bulk + '(input: $input) { id }' +
      '}';
    var ids = batch.entries.map(function (e) { return e.id; });
    return gqlRequest(query, {
      input: { ids: ids, tag_ids: { ids: batch.tagIds, mode: batch.mode } },
    }).then(function () {
      batch.entries.forEach(function (entry) {
        batch.tagIds.forEach(function (tid) {
          // Entities are batched by identical delta, but each carries its own
          // reasons - the same redundant parent is rarely redundant for the same
          // cause twice - so the line is built per entry, not per batch.
          run.log(batch.mode, changeLine(graph, batch.type, entry.label, tid, entry.reason));
          run.appliedTags[tid] = (hasOwn(run.appliedTags, tid) ? run.appliedTags[tid] : 0) + 1;
        });
        run.wrote = true;
        run.applied++;
      });
    }, function (e) {
      // The whole batch failed, so none of its entities changed and none are
      // logged as changed.
      run.log('ERROR', batch.type.plural + ' - ' + batch.type.bulk + ' failed for ' +
        ids.length + ' entities (' + ids.slice(0, 5).join(', ') +
        (ids.length > 5 ? ', ...' : '') + '): ' + e.message);
      run.errors++;
      run.failed += batch.entries.length;
    });
  }

  // ── Dialog ────────────────────────────────────────────────────────────────

  var STYLE_ID = 'npt-style';
  var CSS =
    '.npt-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:2000;display:flex;align-items:center;justify-content:center;}' +
    '.npt-modal{background:#202b33;color:#e8eaed;border:1px solid #394b59;border-radius:4px;' +
    'width:min(900px,92vw);max-height:88vh;display:flex;flex-direction:column;font-size:.9rem;}' +
    '.npt-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.npt-title{font-size:1.1rem;font-weight:600;}' +
    '.npt-warn{color:#ffb648;margin-top:.35rem;}' +
    '.npt-note{color:#a7b6c2;margin-top:.35rem;}' +
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
    '.npt-hidden{display:none;}';

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

  // ── A run ─────────────────────────────────────────────────────────────────

  var _active = null;

  function startRun(taskName) {
    if (_active) { _active.focus(); return; }
    var mode = taskName === TASK_ROLLUP ? 'rollup' : 'prune';
    _active = new Run(taskName, mode);
    _active.begin();
  }

  function Run(taskName, mode) {
    this.taskName = taskName;
    this.mode = mode;
    // Deliberately outside reset(): a Rescan clears the counters but keeps the log,
    // so the log can still hold the record of writes an earlier pass made. This
    // latches once and is what makes Clear log ask before discarding that record.
    this.wrote = false;
    this.reset();
    this.build();
  }

  Run.prototype.reset = function () {
    this.plan = [];
    this.scanned = {};
    this.total = {};
    this.errors = 0;
    this.applied = 0;
    this.appliedTags = {};
    this.failed = 0;
    this.cancelled = false;
    this.stopped = false;
    this.lines = [];
    this.pending = [];
    this.rendered = 0;
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
    head.appendChild(el('div', 'npt-warn',
      'This cannot be undone. Back up your database before proceeding.'));
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
    this.clearBtn   = button('Clear log', 'npt-clear');
    this.rescanBtn  = button('Rescan', 'npt-rescan npt-hidden');
    this.closeBtn   = button('Close', 'npt-close npt-hidden');
    this.proceedBtn.disabled = true;

    this.proceedBtn.addEventListener('click', function () { self.proceed(); });
    this.cancelBtn.addEventListener('click', function () { self.cancel(); });
    this.stopBtn.addEventListener('click', function () { self.stop(); });
    this.copyBtn.addEventListener('click', function () { self.copy(); });
    this.clearBtn.addEventListener('click', function () { self.clearLog(); });
    this.rescanBtn.addEventListener('click', function () { self.rescan(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });

    [this.proceedBtn, this.cancelBtn, this.stopBtn, this.copyBtn, this.clearBtn,
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
    this.show(this.proceedBtn, scanning || ready);
    this.show(this.cancelBtn, scanning || ready);
    this.show(this.stopBtn, applying);
    this.show(this.rescanBtn, done);
    this.show(this.closeBtn, done);
    this.proceedBtn.disabled = !ready || !this.plan.length;
    this.copyBtn.disabled = false;
  };

  Run.prototype.logTagSummary = function (counts, verb) {
    // A run that stops before the tag query - no types enabled, settings failed -
    // has no graph to name anything with, and nothing to summarise either.
    if (!this.graph) return;
    var line = tagSummaryLine(this.graph, counts, verb);
    if (line) this.log('INFO', line);
  };

  Run.prototype.log = function (kind, message) {
    var line = '[' + kind + '] ' + message;
    this.lines.push(line);
    this.pending.push({ kind: kind, line: line });
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
      this.logEl.appendChild(el('div', 'npt-line npt-' + p.kind, p.line));
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
        this.lines.length + ' log line(s)';
    } else if (this.state === 'applying') {
      summary = 'Applying. ' + this.applied + ' of ' + this.plan.length + ' entities updated';
    } else {
      summary = 'Finished. ' + this.applied + ' entity change(s) applied' +
        (this.failed ? ', ' + this.failed + ' failed' : '');
    }
    if (this.errors) summary += ', ' + this.errors + ' error(s)';
    if (this.lines.length > LOG_RENDER_CAP) {
      summary += ' - showing the last ' + LOG_RENDER_CAP + ' of ' + this.lines.length + ' lines';
    }
    this.progressEl.textContent = parts.length ? summary + '\n' + parts.join('   ') : summary;
  };

  // ── Phase 1: scan ─────────────────────────────────────────────────────────

  Run.prototype.begin = function () {
    var self = this;
    this.setState('scanning');
    this.log('INFO', PLUGIN_NAME + ' - ' + this.taskName + ' - reviewing, nothing will be written yet.');

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
    var msg = 'Merge Performer Tags To Scenes has ' + on.join(' and ') + ' enabled, and this copy ' +
      'is too old to stand down. It will merge performer tags back into entities this run changes. ' +
      'Turn it off for the duration, or press Rescan afterwards.';
    this.log('WARN', msg);
    this.noteEl.textContent = msg;
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
    nextBatch().then(function () {
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

  Run.prototype.stop = function () {
    if (this.state !== 'applying') return;
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
    this.disarmClear();
    var lines = this.lines.slice();
    this.reset();
    this.lines = lines;
    this.log('INFO', '--- Rescan ---');
    this.logEl.textContent = '';
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

  // Empties the log: the rendered tail, and the `lines` array behind it that Copy
  // log exports. The plan is deliberately untouched - this is the log buffer, not
  // the run - so Proceed still has everything it needs afterwards.
  //
  // During review that is harmless; the log is a preview and nothing has been
  // written. Once phase 2 has applied something the log is the only record of what
  // was actually changed - Stash has no undo, and the plugin cannot rebuild the
  // list from anywhere - so a click there arms the button and a second one within
  // CLEAR_ARM_MS confirms it. The prompt lives in the button's own caption rather
  // than a native confirm() stacked on top of our modal.
  Run.prototype.clearLog = function () {
    if (!this.lines.length) return;
    var self = this;

    if (this.wrote && !this.clearArmed) {
      this.clearArmed = true;
      this.clearBtn.textContent = 'Clear log?';
      this.clearTimer = setTimeout(function () { self.disarmClear(); }, CLEAR_ARM_MS);
      return;
    }

    this.disarmClear();
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.lines = [];
    this.pending = [];
    while (this.logEl.firstChild) this.logEl.removeChild(this.logEl.firstChild);
    // A marker rather than an empty log, so an exported copy shows that lines were
    // dropped instead of reading as a run that did nothing.
    this.log('INFO', 'Log cleared. Earlier lines are gone from Copy log too.');
    this.renderProgress();
  };

  Run.prototype.disarmClear = function () {
    if (this.clearTimer) { clearTimeout(this.clearTimer); this.clearTimer = null; }
    this.clearArmed = false;
    if (this.clearBtn) this.clearBtn.textContent = 'Clear log';
  };

  Run.prototype.close = function () {
    this.disarmClear();
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    if (_active === this) _active = null;
  };

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
    return _fetch.apply(this, arguments);
  };
})();
