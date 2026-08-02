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
    { key: 'performers', setting: 'enablePerformers', label: 'Performer', plural: 'Performers',
      find: 'findPerformers', node: 'performers',
      bulk: 'bulkPerformerUpdate', bulkInput: 'BulkPerformerUpdateInput',
      organized: false, fields: 'id name' },
    { key: 'studios', setting: 'enableStudios', label: 'Studio', plural: 'Studios',
      find: 'findStudios', node: 'studios',
      bulk: 'bulkStudioUpdate', bulkInput: 'BulkStudioUpdateInput',
      organized: true, fields: 'id name' },
    { key: 'groups', setting: 'enableGroups', label: 'Group', plural: 'Groups',
      find: 'findGroups', node: 'groups',
      bulk: 'bulkGroupUpdate', bulkInput: 'BulkGroupUpdateInput',
      organized: false, fields: 'id name' },
    { key: 'galleries', setting: 'enableGalleries', label: 'Gallery', plural: 'Galleries',
      find: 'findGalleries', node: 'galleries',
      bulk: 'bulkGalleryUpdate', bulkInput: 'BulkGalleryUpdateInput',
      organized: true, fields: 'id title' },
    { key: 'scenes', setting: 'enableScenes', label: 'Scene', plural: 'Scenes',
      find: 'findScenes', node: 'scenes',
      bulk: 'bulkSceneUpdate', bulkInput: 'BulkSceneUpdateInput',
      organized: true, fields: 'id title files { basename }' },
    { key: 'images', setting: 'enableImages', label: 'Image', plural: 'Images',
      find: 'findImages', node: 'images',
      bulk: 'bulkImageUpdate', bulkInput: 'BulkImageUpdateInput',
      organized: true, fields: 'id title', pageSize: 500 },
    { key: 'markers', setting: 'enableMarkers', label: 'Scene Marker', plural: 'Scene Markers',
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
  var DEFAULTS = {
    enableScenes: false, enableImages: false, enableGalleries: false,
    enablePerformers: false, enableGroups: false, enableStudios: false,
    enableMarkers: false,
    excludeOrganized: false,
    excludeEntityWithTagName: '',
    excludeTagWithIgnoreAutoTag: false,
    excludeAddTagWithCustomFieldName: '',
    excludeRemoveTagWithCustomFieldName: '',
    excludeAddTagNameContains: '',
    excludeRemoveTagNameContains: '',
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
    var fields = 'id name ignore_auto_tag parents { id }';
    if ((settings.excludeAddTagWithCustomFieldName || '').trim() ||
        (settings.excludeRemoveTagWithCustomFieldName || '').trim()) {
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
    return '"' + ((t && t.name) || 'unknown') + ' (' + id + ')"';
  }

  // ── Exclusion filters ─────────────────────────────────────────────────────

  function makeFilters(settings, graph) {
    var addCF     = (settings.excludeAddTagWithCustomFieldName || '').trim();
    var removeCF  = (settings.excludeRemoveTagWithCustomFieldName || '').trim();
    var addStr    = settings.excludeAddTagNameContains || '';
    var removeStr = settings.excludeRemoveTagNameContains || '';

    function blocked(id, cfName, substr) {
      var t = graph.byId[id];
      if (!t) return true;                       // unknown tag: never touch it
      if (graph.cyclic[id]) return true;         // see buildGraph
      if (settings.excludeTagWithIgnoreAutoTag && t.ignore_auto_tag) return true;
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

  function entityLabel(type, ent) {
    var name = ent.name || ent.title;
    if (!name && type.key === 'scenes') {
      var files = ent.files || [];
      if (files.length) name = files[0].basename;
    }
    if (!name && type.key === 'markers' && ent.primary_tag) name = ent.primary_tag.name;
    return '"' + (name || 'untitled') + ' (' + ent.id + ')"';
  }

  // Returns { add: [], remove: [] } - both may be empty. `mode` is 'prune' or
  // 'rollup'; only one direction is ever populated.
  function planEntity(type, ent, mode, ctx) {
    var s = ctx.settings;
    if (s.excludeOrganized && type.organized && ent.organized) return null;

    var tagIds = (ent.tags || []).map(function (t) { return t.id; });

    // A marker's primary tag lives in its own required field. It counts as present -
    // so it can imply the removal of its own ancestors from the marker's tag list -
    // but it is never itself added or removed.
    var present = {};
    tagIds.forEach(function (id) { present[id] = true; });
    if (type.key === 'markers' && ent.primary_tag) present[ent.primary_tag.id] = true;

    if (ctx.excludeTagId && present[ctx.excludeTagId]) return null;

    var implied = {}, id, k;
    for (id in present) {
      if (!hasOwn(present, id)) continue;
      var anc = ctx.graph.ancestorsOf(id);
      for (k in anc) if (hasOwn(anc, k)) implied[k] = true;
    }

    if (mode === 'prune') {
      // Computed against the entity's original tag set, never against a set being
      // mutated as the loop runs: ancestry belongs to the tag graph, not to the
      // entity, so the result does not depend on the order tags are visited.
      var remove = tagIds.filter(function (tid) {
        return hasOwn(implied, tid) && ctx.filters.canRemove(tid);
      });
      return remove.length ? { add: [], remove: remove } : null;
    }

    var add = [];
    for (k in implied) {
      if (!hasOwn(implied, k)) continue;
      if (hasOwn(present, k)) continue;
      // A tag the filters reject is skipped on its own; its parents are still
      // added. The filters describe a tag, not a wall in the hierarchy.
      if (ctx.filters.canAdd(k)) add.push(k);
    }
    return add.length ? { add: add, remove: [] } : null;
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
          ctx.run.plan.push({ type: type, id: ent.id, label: label, add: delta.add, remove: delta.remove });
          delta.remove.forEach(function (tid) {
            ctx.run.log('REMOVE', type.label + ' ' + label + ' - Tag ' + tagLabel(ctx.graph, tid));
          });
          delta.add.forEach(function (tid) {
            ctx.run.log('ADD', type.label + ' ' + label + ' - Tag ' + tagLabel(ctx.graph, tid));
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
          run.log(batch.mode, batch.type.label + ' ' + entry.label + ' - Tag ' + tagLabel(graph, tid));
        });
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
    this.reset();
    this.build();
  }

  Run.prototype.reset = function () {
    this.plan = [];
    this.scanned = {};
    this.total = {};
    this.errors = 0;
    this.applied = 0;
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
    this.rescanBtn  = button('Rescan', 'npt-rescan npt-hidden');
    this.closeBtn   = button('Close', 'npt-close npt-hidden');
    this.proceedBtn.disabled = true;

    this.proceedBtn.addEventListener('click', function () { self.proceed(); });
    this.cancelBtn.addEventListener('click', function () { self.cancel(); });
    this.stopBtn.addEventListener('click', function () { self.stop(); });
    this.copyBtn.addEventListener('click', function () { self.copy(); });
    this.rescanBtn.addEventListener('click', function () { self.rescan(); });
    this.closeBtn.addEventListener('click', function () { self.close(); });

    [this.proceedBtn, this.cancelBtn, this.stopBtn, this.copyBtn, this.rescanBtn, this.closeBtn]
      .forEach(function (b) { foot.appendChild(b); });
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

        var exclName = (self.settings.excludeEntityWithTagName || '').trim();
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
    if (siblingSettings.autoMergeOnSceneUpdate) on.push('Auto Merge On Scene Updates');
    if (siblingSettings.autoMergeOnPerformerUpdate) on.push('Auto Merge On Performer Updates');
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

  Run.prototype.close = function () {
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
