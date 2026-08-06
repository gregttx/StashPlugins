// Merge Performer Tags To Scenes
//
// Requires Stash 0.31.0 or newer: tag custom_fields (the custom-field exclusion
// filter) and PluginApi component patching (staging tags into the scene edit form)
// both depend on it.
(function () {
  'use strict';

  var PLUGIN_ID           = 'MergePerformerTagsToScenes';
  var PLUGIN_NAME         = 'Merge Performer Tags To Scenes';
  var SIBLING_ID          = 'NormalizeParentTags';
  var SIBLING_NAME        = 'Normalize Parent Tags';

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and updates as soon as plugins are reloaded, while the browser can still
  // be running a script it cached before the edit — a heading reading 1.8.3 over
  // 1.8.0 behaviour is the normal look of a stale script. This constant travels
  // inside the file. Bump it with the manifest and the yml; the `version` suite
  // fails if the three disagree.
  var PLUGIN_VERSION      = '1.10.4';

  // Printed before anything else runs, so a script that loads and then throws is told
  // apart from one that never loaded: banner plus error means the new code is running
  // and broken, no banner means the browser is still on the old one.
  // Through whatever the console offers rather than console.info directly, the way
  // logInfo already does: this is the first statement in the file, so a console
  // without it would take the whole plugin down before anything loaded.
  function cpt2s(message) {
    if (typeof console !== 'undefined' && (console.info || console.log)) {
      (console.info || console.log).call(console, message);
    }
  }

  cpt2s('[cpt2s] MergePerformerTagsToScenes.js ' + PLUGIN_VERSION + ' loaded. This is the ' +
    'running script’s own version — the settings page reads the manifest instead, which can ' +
    'be newer than the script your browser has cached.');
  var PERFORMER_BTN_CLASS = 'cpt2s-merge-to-scenes-btn';
  var SCENE_BTN_CLASS     = 'cpt2s-merge-from-perfs-btn';

  // Declared in the manifest so Stash lists it under Settings - Tasks - Plugin
  // Tasks, but run in the browser: this plugin has no exec, so a queued job could
  // only fail. See the task section near the end of this file.
  var TASK_MERGE_ALL   = 'Merge Performer Tags into All Their Scenes';
  var TASKS            = [TASK_MERGE_ALL];
  var TASK_PAGE_SIZE   = 500;   // performers per page while walking the library
  var TASK_LOG_CAP     = 1000;  // log lines kept in the DOM; all of them stay in memory
  var TASK_FLUSH_MS    = 100;
  var TASK_UNDO_CHUNK  = 100;   // scene ids per undo mutation
  var TASK_UNDO_ARM_MS = 4000;  // how long Undo stays armed for its second click

  var settings = {
    showManualMergeButtons: false,
    autoMergeOnSceneUpdate: false,
    autoMergeOnPerformerUpdate: false,
    excludeSceneOrganized: false,
    excludeSceneWithTagName: '',
    excludeTagWithIgnoreAutoTag: false,
    excludeTagWithCustomFieldName: '',
    logMergesToConsole: false,
    // Inverted on purpose. Stash has no default value for plugin settings and renders
    // an unset BOOLEAN as unchecked, so the behaviour we want by default has to be the
    // one that "off" selects — otherwise the box would read off while acting on, and
    // the first click on it would send true rather than false.
    saveTagsImmediately: false,
  };

  // ── Cross-plugin cooperation ──────────────────────────────────────────────
  //
  // See "Cross-plugin cooperation: the bulk-edit lease" in the repo-root CLAUDE.md.
  // This plugin is on both sides of the protocol.
  //
  // Reactive: another plugin rewriting many entities on purpose (NormalizeParentTags)
  // takes a lease for the duration of its writes; auto-merge stands down while one is
  // held, because those writes look exactly like user edits from in here and reacting
  // to them undoes the other plugin's work as fast as it lands. Manual button clicks
  // are never suppressed: the user asked for those directly.
  //
  // Bulk: the library-wide task rewrites scenes across the whole library, which is
  // the same thing seen from the other end, so it takes a lease of its own while it
  // writes. Nothing in this repo honours it yet - the sibling is not reactive - but
  // the protocol is not ours alone, and a bulk run that does not announce itself is
  // the case a third plugin could not defend against.
  function coop() {
    var c = window.StashPluginCoop;
    if (!c || typeof c !== 'object') c = window.StashPluginCoop = {};
    if (!c.leases) c.leases = [];
    if (!c.respecters) c.respecters = {};
    return c;
  }

  // Identical to NormalizeParentTags' acquireLease, deliberately: renew per unit of
  // work rather than taking one long lease, and release in every outcome so an error
  // or a Stop cannot leave a reactive plugin standing down. The expiry is the
  // backstop for the outcome neither can catch - the tab going away mid-run.
  var LEASE_TTL_MS = 300000;

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

  // Registered at load so a bulk plugin can tell "will stand down" apart from "too
  // old to know about leases" and warn the user accordingly.
  coop().respecters[PLUGIN_ID] = true;

  var _standDownAnnounced = false;
  function autoMergeSuppressed() {
    var c = coop();
    var now = Date.now();
    // Expired leases are dropped rather than honoured: a tab that crashes mid-run
    // must not leave auto-merge disabled until the next page reload.
    for (var i = c.leases.length - 1; i >= 0; i--) {
      if (!c.leases[i] || !(c.leases[i].until > now)) c.leases.splice(i, 1);
    }
    if (!c.leases.length) { _standDownAnnounced = false; return false; }
    if (!_standDownAnnounced) {
      _standDownAnnounced = true;
      console.info('[cpt2s] auto-merge is standing down while ' + c.leases[0].owner +
        ' applies bulk changes (' + c.leases[0].label + ')');
    }
    return true;
  }

  // Staging is the default, but it needs PluginApi. Where that is missing the button
  // falls back to merging and saving, because the user never opted into review — they
  // just get the behaviour their Stash can support.
  function stagingActive() {
    return !settings.saveTagsImmediately && _tagPatchInstalled;
  }

  var _warnedNoStaging = false;
  function warnNoStagingOnce() {
    if (_warnedNoStaging || settings.saveTagsImmediately || _tagPatchInstalled) return;
    _warnedNoStaging = true;
    console.warn('[cpt2s] tag staging is unavailable — this Stash does not expose PluginApi ' +
      'component patching, so "Add Perf Tags" will merge and save directly.');
  }
  // Depth of merge work currently in flight. A counter rather than a boolean so
  // that overlapping flows (a bulk update racing a single update, a manual button
  // click racing auto-merge) cannot have the first one to finish re-open fetch
  // interception while the others are still issuing mutations.
  var _mergeDepth = 0;

  var _excludeTagId   = null;
  var _excludeTagName = '';
  var _excludeTagAt   = 0; // when the current cached hit/miss was resolved
  var EXCLUDE_TAG_HIT_TTL_MS  = 60000;
  var EXCLUDE_TAG_MISS_TTL_MS = 10000;

  var GOTO_EDIT_TIMEOUT_MS = 10000;

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Runs fn() with fetch interception suppressed for the lifetime of the promise
  // it returns. Every entry point into merge work goes through this, so the
  // mutations we issue ourselves are never mistaken for user edits.
  function guarded(fn) {
    _mergeDepth++;
    var p;
    try {
      p = fn();
    } catch (e) {
      _mergeDepth--;
      throw e;
    }
    return p.then(
      function (v) { _mergeDepth--; return v; },
      function (e) { _mergeDepth--; throw e; }
    );
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function getPerformerId() {
    var m = window.location.pathname.match(/^\/performers\/(\d+)(?:\/|$)/);
    return m ? m[1] : null;
  }

  function getSceneId() {
    var m = window.location.pathname.match(/^\/scenes\/(\d+)(?:\/|$)/);
    return m ? m[1] : null;
  }

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

  function updateSceneTags(sceneId, tagIds) {
    return gqlRequest(
      'mutation SceneUpdate($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }',
      { input: { id: sceneId, tag_ids: tagIds } }
    );
  }

  // Takes tags off scenes as a delta, which is the one place this plugin removes a
  // tag at all - see the Undo section of the task. REMOVE rather than a rewritten
  // list on purpose: the forward merge writes the whole list because it is building
  // one, but an undo that rewrote the list would revert anything changed since,
  // which is exactly what an undo must not do.
  function removeSceneTags(sceneIds, tagIds) {
    return gqlRequest(
      'mutation BulkSceneUpdate($input: BulkSceneUpdateInput!) {' +
      '  bulkSceneUpdate(input: $input) { id }' +
      '}',
      { input: { ids: sceneIds, tag_ids: { ids: tagIds, mode: 'REMOVE' } } }
    );
  }

  // custom_fields is only requested when the custom-field exclusion filter is
  // configured — it is dead weight on every tag of every performer otherwise.
  //
  // withDisplay adds the fields Stash's TagSelect needs to render a chip. Its Tag
  // type is Pick<Tag, "id"|"name"|"sort_name"|"aliases"|"image_path"|"stash_ids">;
  // sort_name and stash_ids are left out because they drive dropdown sorting and
  // stash-box matching, neither of which applies to a chip we inject.
  function tagFields(withDisplay) {
    var cfName = (settings.excludeTagWithCustomFieldName || '').trim();
    var fields = 'id ignore_auto_tag';
    if (cfName) fields += ' custom_fields';
    // The log line names the tag, so the name comes along for that too.
    if (withDisplay || settings.logMergesToConsole) fields += ' name';
    if (withDisplay) fields += ' aliases image_path';
    return fields;
  }

  // ── Merge logging (logMergesToConsole) ────────────────────────────────────

  // Scene fields the log line needs, spliced into whichever scene query is about to
  // run. Requested only when logging is on: on the performer path these ride along
  // with every scene of the performer, so they are pure weight otherwise.
  function sceneLogFields() {
    return settings.logMergesToConsole ? ' title files { basename }' : '';
  }

  // A scene's title is optional in Stash, so fall back to the file name the way its
  // own UI does rather than logging an empty pair of quotes. sceneId is passed
  // separately because the single-scene queries look the scene up by id and do not
  // ask for it back.
  //
  // The label carries its own quotes and leaves the id outside them - "Name" (12),
  // not "Name (12)" - so a title containing brackets cannot be misread as an id.
  // NormalizeParentTags logs the same shape.
  function sceneLogLabel(scene, sceneId) {
    var name = scene.title;
    if (!name) {
      var files = scene.files || [];
      if (files.length) name = files[0].basename;
    }
    return '"' + (name || 'untitled') + '" (' + (scene.id || sceneId) + ')';
  }

  function logInfo(msg) {
    var log = console.info || console.log;
    if (log) log.call(console, '[' + PLUGIN_ID + '] ' + msg);
  }

  // Announced once when the setting is seen on, and again if it is switched off and
  // back on. Without it there is no way to tell "logging is not working" apart from
  // "nothing has been merged yet" — the log is silent in both cases, and merging
  // nothing is the normal outcome of a scene that already has all its performer tags.
  var _loggingAnnounced = false;
  function announceLogging() {
    if (!settings.logMergesToConsole) { _loggingAnnounced = false; return; }
    if (_loggingAnnounced) return;
    _loggingAnnounced = true;
    logInfo('merge logging enabled — one line will appear here per tag merged into a scene. ' +
      'The number in brackets after a name is that tag\'s or scene\'s Stash id.');
  }

  // One line per tag, at info level. Callers log only once the change is real: after
  // the mutation resolves when saving, after the form takes the tags when staging.
  //
  // action is 'staged' or 'saved'. Names can be missing if logging was switched on
  // between the query being built and this call, hence the fallback.
  function logMerges(tags, scene, sceneId, action) {
    if (!settings.logMergesToConsole) return;
    var label = sceneLogLabel(scene, sceneId);
    tags.forEach(function (t) {
      logInfo('Tag "' + (t.name || 'unnamed') + '" (' + t.id + ') ' +
        action + ' to Scene ' + label);
    });
  }

  // Resolves the tag ID for excludeSceneWithTagName. Both hits and misses are cached
  // with a TTL: a miss expires quickly so the filter starts working once the user
  // creates the tag, and a hit expires too so that deleting or recreating the tag is
  // noticed instead of leaving a stale ID that silently matches nothing forever.
  // A failed request rejects rather than resolving to null: silently treating an
  // error as "no exclusion configured" would merge tags into the very scenes the
  // user asked to protect, and tags are never removed again.
  function resolveExclusionTagId() {
    var name = (settings.excludeSceneWithTagName || '').trim();
    if (!name) { _excludeTagId = null; _excludeTagName = ''; return Promise.resolve(null); }
    if (name === _excludeTagName) {
      var age = Date.now() - _excludeTagAt;
      if (_excludeTagId && age < EXCLUDE_TAG_HIT_TTL_MS) return Promise.resolve(_excludeTagId);
      if (!_excludeTagId && age < EXCLUDE_TAG_MISS_TTL_MS) return Promise.resolve(null);
    }
    // per_page: -1 because Stash compiles the EQUALS modifier to SQL LIKE, where _ and
    // % are wildcards. A name containing either can match far more tags than the default
    // page holds, and the exact match falling off page 1 would silently disable the
    // filter — the one failure mode this lookup exists to prevent.
    return gqlRequest(
      'query FindTagByName($filter: FindFilterType, $tag_filter: TagFilterType) {' +
      '  findTags(filter: $filter, tag_filter: $tag_filter) { tags { id name } }' +
      '}',
      {
        filter: { per_page: -1 },
        tag_filter: { name: { value: name, modifier: 'EQUALS' } },
      }
    ).then(function (data) {
      // The server-side match is also case-insensitive, so re-check exactly here to
      // make sure a near-miss can never bind the exclusion to the wrong tag.
      var tags = (data.findTags || {}).tags || [];
      var match = null;
      tags.forEach(function (t) { if (!match && t.name === name) match = t; });
      var hadId = _excludeTagId && name === _excludeTagName;
      _excludeTagName = name;
      _excludeTagId   = match ? match.id : null;
      _excludeTagAt   = Date.now();
      if (!match) {
        console.warn('[cpt2s] exclusion tag not found: ' + name +
          (hadId ? ' (it existed a moment ago — scenes are no longer being excluded)' : ''));
      }
      return _excludeTagId;
    });
  }

  // ── Core merge logic (shared by buttons and auto-merge) ───────────────────

  // Shared predicate for the two tag-level exclusion filters. exclTagId is rejected
  // as well: copying the "skip this scene" tag onto scenes would permanently exclude
  // them from every future merge, and tags are never removed again.
  function tagIsMergeable(t, exclTagId, cfName) {
    if (exclTagId && t.id === exclTagId) return false;
    if (settings.excludeTagWithIgnoreAutoTag && t.ignore_auto_tag) return false;
    // Presence alone excludes: the value is never inspected. Tag custom fields come
    // back as JSON, so a value typed as text is a string — "false" and "0" are truthy
    // in JS, which made any value-based rule surprising to configure. hasOwnProperty
    // rather than `in` so inherited keys like "constructor" cannot match every tag.
    if (cfName && t.custom_fields && hasOwn(t.custom_fields, cfName)) return false;
    return true;
  }

  // The scene-level half of the exclusion rules. Split out because the staging path
  // needs the answer on its own - it reports "Scene excluded" rather than merging -
  // while the two saving paths only want it folded into sceneMergePlan. One copy, so
  // a new scene-level filter cannot land on two of the three and be forgotten on the
  // third.
  function sceneIsExcluded(scene, exclTagId) {
    if (settings.excludeSceneOrganized && scene.organized) return true;
    if (exclTagId) {
      var hasExcl = false;
      (scene.tags || []).forEach(function (t) { if (t.id === exclTagId) hasExcl = true; });
      if (hasExcl) return true;
    }
    return false;
  }

  // The one place that decides whether a scene is skipped and, if not, which of the
  // performer tags it is missing. Returns null for "skip", otherwise
  // { existingIds, missing }. All three saving paths - the single scene, a
  // performer's scenes, and the task's review pass - go through it, so the plan the
  // user approves and the write that follows can never disagree about what a scene
  // needs.
  function sceneMergePlan(scene, perfTagIds, exclTagId) {
    if (sceneIsExcluded(scene, exclTagId)) return null;
    var existingIds = (scene.tags || []).map(function (t) { return t.id; });
    var existingSet = {};
    existingIds.forEach(function (id) { existingSet[id] = true; });
    var missing = perfTagIds.filter(function (id) { return !existingSet[id]; });
    return missing.length ? { existingIds: existingIds, missing: missing } : null;
  }

  // Resolves to true when the scene's tags were updated, false when it was skipped
  // (excluded by a filter, or already carrying every performer tag).
  function mergeTagsIntoScene(sceneId) {
    return guarded(function () { return runMergeTagsIntoScene(sceneId); });
  }

  function runMergeTagsIntoScene(sceneId) {
    return resolveExclusionTagId().then(function (exclTagId) {
      return gqlRequest(
        'query FindScene($id: ID!) {' +
        '  findScene(id: $id) { organized' + sceneLogFields() +
        ' tags { id } performers { tags { ' + tagFields() + ' } } }' +
        '}',
        { id: sceneId }
      ).then(function (data) {
        var scene = data.findScene;
        if (!scene) return false;
        var performers = scene.performers || [];
        if (!performers.length) return false;
        // Keyed by id to dedupe performers sharing a tag; the tag itself is kept as
        // the value so the log line can name what was merged.
        var perfTagById = {};
        var cfName = (settings.excludeTagWithCustomFieldName || '').trim();
        performers.forEach(function (p) {
          (p.tags || []).forEach(function (t) {
            if (tagIsMergeable(t, exclTagId, cfName)) perfTagById[t.id] = t;
          });
        });
        var perfTagIds = Object.keys(perfTagById);
        if (!perfTagIds.length) return false;
        var plan = sceneMergePlan(scene, perfTagIds, exclTagId);
        if (!plan) return false;
        return updateSceneTags(sceneId, plan.existingIds.concat(plan.missing)).then(function () {
          logMerges(plan.missing.map(function (id) { return perfTagById[id]; }), scene, sceneId, 'saved');
          return true;
        });
      });
    });
  }

  // ── Staging into the scene edit form (the default; see saveTagsImmediately) ─
  //
  // Instead of saving, push the performer tags into the open edit form's tag box so
  // the user can review them and press Save themselves.
  //
  // Stash's scene edit form does not render its tag list from formik.values.tag_ids —
  // useTagsEdit() keeps its own copy and calls formik.setFieldValue as a side effect:
  //
  //   function onSetTags(items) { setTags(items); setFieldValue(items.map(i => i.id)); }
  //
  // So writing to formik alone would enable Save while leaving the visible chips
  // stale. Going through onSetTags does both. It reaches us as the onSelect prop of
  // TagSelect, which Stash exposes through PluginApi's component patching.

  var _tagSelectCaptures = [];
  var TAG_SELECT_CAPTURE_LIMIT = 10;
  var _tagPatchInstalled = false;

  function installTagSelectPatch() {
    var api = window.PluginApi;
    if (!api || !api.patch || typeof api.patch.before !== 'function') return false;
    try {
      // A before-patch returns the argument list for the real render, so returning
      // props untouched makes this a pure observer.
      api.patch.before('TagSelect', function (props) {
        if (!settings.saveTagsImmediately && props &&
            props.isMulti && typeof props.onSelect === 'function') {
          // values is tracked on the entry rather than read back off props, so it can
          // be corrected the moment we stage into the control instead of waiting for
          // React to re-render and capture it again.
          _tagSelectCaptures.push({
            props: props,
            sceneId: getSceneId(),
            values: props.values || [],
          });
          if (_tagSelectCaptures.length > TAG_SELECT_CAPTURE_LIMIT) _tagSelectCaptures.shift();
        }
        return [props];
      });
      _tagPatchInstalled = true;
      return true;
    } catch (e) {
      console.warn('[cpt2s] could not patch TagSelect:', e);
      return false;
    }
  }

  // What the scene's tag control is expected to be holding: our own last staged list
  // if we have already written to it, otherwise whatever the scene has on the server.
  var _stagedForm = { sceneId: null, ids: null };

  function idsOf(tags) {
    return (tags || []).map(function (t) { return t.id; }).sort().join(',');
  }

  // TagSelect is used all over Stash, so pick the capture belonging to this scene's
  // edit form: newest first, preferring one whose contents match what we expect the
  // control to hold. Matching against expectedIds rather than the server's tags is
  // what makes a second click see the already-staged list — matching on the server's
  // tags would keep re-selecting the stale pre-staging capture and report the same
  // count every time. If the user has hand-edited the box nothing matches, and the
  // newest capture is the right answer anyway.
  function findSceneTagControl(expectedIds) {
    var sid = getSceneId();
    var wanted = expectedIds ? expectedIds.slice().sort().join(',') : null;
    var newest = null;
    for (var i = _tagSelectCaptures.length - 1; i >= 0; i--) {
      var c = _tagSelectCaptures[i];
      if (c.sceneId !== sid) continue;
      if (!newest) newest = c;
      if (wanted !== null && idsOf(c.values) === wanted) return c;
    }
    return newest;
  }

  // Resolves to a status string: 'staged' (with count), 'nochange', or 'excluded'.
  function stageTagsIntoSceneForm(sceneId) {
    return guarded(function () {
      return resolveExclusionTagId().then(function (exclTagId) {
        return gqlRequest(
          'query FindSceneForStaging($id: ID!) {' +
          '  findScene(id: $id) { organized' + sceneLogFields() +
          ' tags { id } performers { tags { ' + tagFields(true) + ' } } }' +
          '}',
          { id: sceneId }
        ).then(function (data) {
          var scene = data.findScene;
          if (!scene) return { status: 'nochange' };

          // The exclusion filters are applied exactly as in save-immediately mode:
          // they express "these tags do not belong on this scene", which is true
          // however the tags get there.
          if (sceneIsExcluded(scene, exclTagId)) return { status: 'excluded' };

          var cfName = (settings.excludeTagWithCustomFieldName || '').trim();
          var byId = {};
          (scene.performers || []).forEach(function (p) {
            (p.tags || []).forEach(function (t) {
              if (tagIsMergeable(t, exclTagId, cfName)) byId[t.id] = t;
            });
          });

          var existingIds = (scene.tags || []).map(function (t) { return t.id; });
          var expectedIds = _stagedForm.sceneId === sceneId ? _stagedForm.ids : existingIds;
          var control = findSceneTagControl(expectedIds);
          if (!control) {
            throw new Error('could not find the scene tag editor — open the Edit tab first');
          }

          // Diff against what is in the form, not what is on the server, so tags the
          // user has already added or removed by hand are respected — and so clicking
          // twice without saving reports 0 the second time.
          var current = control.values || [];
          var have = {};
          current.forEach(function (t) { have[t.id] = true; });

          var added = [];
          Object.keys(byId).forEach(function (id) {
            if (have[id]) return;
            var t = byId[id];
            added.push({
              id: t.id,
              name: t.name,
              aliases: t.aliases || [],
              image_path: t.image_path || null,
            });
          });
          if (!added.length) return { status: 'nochange' };

          var next = current.concat(added);
          control.props.onSelect(next);
          logMerges(added, scene, sceneId, 'staged');
          // Record the new contents immediately. React will re-render and capture the
          // control again, but this keeps the count correct even if it does not.
          control.values = next;
          _stagedForm = { sceneId: sceneId, ids: next.map(function (t) { return t.id; }) };
          return { status: 'staged', count: added.length };
        });
      });
    });
  }

  function mergeTagsIntoAllPerformerScenes(performerId, onProgress) {
    return guarded(function () { return runMergeTagsIntoAllPerformerScenes(performerId, onProgress); });
  }

  function runMergeTagsIntoAllPerformerScenes(performerId, onProgress) {
    return resolveExclusionTagId().then(function (exclTagId) {
      return gqlRequest(
        'query FindPerformer($id: ID!) { findPerformer(id: $id) { tags { ' + tagFields() + ' } } }',
        { id: performerId }
      ).then(function (data) {
        var performer = data.findPerformer;
        if (!performer) return;
        var cfName = (settings.excludeTagWithCustomFieldName || '').trim();
        var perfTags = (performer.tags || []).filter(function (t) {
          return tagIsMergeable(t, exclTagId, cfName);
        });
        var perfTagIds = perfTags.map(function (t) { return t.id; });
        if (!perfTagIds.length) return;
        var perfTagById = {};
        perfTags.forEach(function (t) { perfTagById[t.id] = t; });

        return gqlRequest(
          'query FindPerformerScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {' +
          '  findScenes(filter: $filter, scene_filter: $scene_filter) { scenes { id organized' +
          sceneLogFields() + ' tags { id } } }' +
          '}',
          {
            filter: { per_page: -1 },
            scene_filter: { performers: { value: [performerId], modifier: 'INCLUDES_ALL' } },
          }
        ).then(function (data2) {
          var scenes = data2.findScenes.scenes;
          if (!scenes || !scenes.length) return;

          var i = 0;
          var failed = 0;
          // Skipped scenes advance the loop; only a scene that actually needs updating
          // chains a promise and re-enters. Recursing on skips instead grew the stack
          // by a frame per scene and overflowed at roughly twelve thousand consecutive
          // skips — and skipping is the common path, since every re-run skips the
          // scenes that already carry the tags.
          function next() {
            while (i < scenes.length) {
              var scene = scenes[i++];
              if (onProgress) onProgress(i, scenes.length);
              var plan = sceneMergePlan(scene, perfTagIds, exclTagId);
              if (!plan) continue;
              return updateSceneTags(scene.id, plan.existingIds.concat(plan.missing))
                .then(makeSceneLogger(scene, plan.missing))
                .catch(makeSceneFailureHandler(scene))
                .then(next);
            }
            // Report failures only after every scene has been attempted, so one bad
            // scene cannot silently cancel the rest of the run.
            if (failed) {
              throw new Error(failed + ' of ' + scenes.length +
                ' scene(s) could not be updated; see the browser console for details');
            }
          }

          // Built outside the loop so the handlers close over this scene rather than
          // over the loop's shared `var`.
          function makeSceneFailureHandler(scene) {
            return function (e) {
              failed++;
              console.error('[cpt2s] scene ' + scene.id + ' update failed:', e);
            };
          }

          // Chained ahead of the failure handler, so a scene that could not be updated
          // is never logged as merged.
          function makeSceneLogger(scene, mergedIds) {
            return function () {
              logMerges(mergedIds.map(function (id) { return perfTagById[id]; }),
                scene, scene.id, 'saved');
            };
          }

          return next();
        });
      });
    });
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  // loadSettings is called on every link click and popstate as well as on a timer, so
  // that a settings change is picked up promptly after the user navigates away from
  // the settings page. Those triggers fire far more often than settings actually
  // change, and the query behind them is not cheap: Stash cannot scope
  // `configuration { plugins }` to one plugin, so every call returns the settings of
  // every installed plugin. Throttling keeps the prompt pickup while collapsing a
  // burst of navigation into a single request, and stops a slow response from
  // overlapping the next call.
  var LOAD_SETTINGS_MIN_INTERVAL_MS = 2000;
  var _settingsLoadedAt = 0;
  var _settingsInFlight = false;
  var _siblingSettings = null;

  // force skips the rate limit but never the in-flight check — there is nothing to be
  // gained by stacking a second copy of the same query on a slow connection.
  function loadSettings(force) {
    var now = Date.now();
    if (_settingsInFlight) return;
    if (!force && now - _settingsLoadedAt < LOAD_SETTINGS_MIN_INTERVAL_MS) return;
    _settingsLoadedAt = now;
    _settingsInFlight = true;
    gqlRequest('{ configuration { plugins } }', null)
      .then(function (data) {
        var ps = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
        // The a1/b2/d1 prefixes on the manifest keys are what orders the settings
        // page: `settings:` is a YAML map, so Stash renders the keys sorted, and
        // without them "Save Tags Immediately" lands five rows below the button
        // toggle it modifies. This is the only place the wire names are read - the
        // internal `settings.*` names below are the plugin's own and stay plain.
        settings.showManualMergeButtons         = !!ps.a1ShowManualMergeButtons;
        settings.saveTagsImmediately            = !!ps.a2SaveTagsImmediately;
        settings.autoMergeOnSceneUpdate         = !!ps.a3AutoMergeOnSceneUpdate;
        settings.autoMergeOnPerformerUpdate     = !!ps.a4AutoMergeOnPerformerUpdate;
        settings.excludeSceneWithTagName        = ps.b1ExcludeSceneWithTagName || '';
        settings.excludeSceneOrganized          = !!ps.b2ExcludeSceneOrganized;
        settings.excludeTagWithIgnoreAutoTag    = !!ps.c1ExcludeTagWithIgnoreAutoTag;
        settings.excludeTagWithCustomFieldName  = ps.c2ExcludeTagWithCustomFieldName || '';
        settings.logMergesToConsole             = !!ps.d1LogMergesToConsole;
        // Every plugin's settings arrive in this one response - Stash cannot scope
        // it - so the sibling's are already paid for, and the task dialog uses them
        // to warn (see checkSibling). Kept as the raw object rather than unpacked
        // into named flags: they are somebody else's wire names, and the one place
        // that reads them is the one place that should know them.
        _siblingSettings = ((data.configuration || {}).plugins || {})[SIBLING_ID] || null;
        announceLogging();
      })
      .catch(function () {})
      // Stamped on completion as well as on dispatch, so the throttle window starts
      // from when the answer arrived rather than from when a slow request began.
      .then(function () { _settingsInFlight = false; _settingsLoadedAt = Date.now(); });
  }

  // ── Library-wide task ─────────────────────────────────────────────────────
  //
  // The task is declared in the manifest so Stash renders it natively under
  // Settings - Tasks - Plugin Tasks, but this plugin has no `exec`, so a click that
  // reached the server could only produce a failed job. Both layers below stop it
  // from getting there, exactly as NormalizeParentTags does: a capture-phase click
  // listener, and a backstop in the fetch wrapper keyed on the plugin id that the
  // runPluginTask mutation carries.
  //
  // What the run does is what the performer button does, for every performer in the
  // library. There is no dry-run phase: the merge only ever *adds* tags, and the set
  // it would add is exactly what the per-performer pass computes scene by scene, so
  // a planning pass would cost the same queries as the run itself and could still be
  // stale by the time it was applied. The dialog opens ready-but-not-started
  // instead, so the user confirms before anything is written.

  var TASK_STYLE_ID = 'cpt2s-task-style';
  var TASK_CSS =
    '.cpt2s-backdrop{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);' +
    'z-index:1600;display:flex;align-items:center;justify-content:center;}' +
    '.cpt2s-modal{background:#202b33;color:#f5f8fa;border:1px solid #394b59;border-radius:4px;' +
    'width:min(56rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
    '.cpt2s-head{padding:.75rem 1rem;border-bottom:1px solid #394b59;}' +
    '.cpt2s-title{font-size:1.1rem;font-weight:600;}' +
    '.cpt2s-warn{color:#ffb648;margin-top:.35rem;}' +
    '.cpt2s-note{color:#a7b6c2;margin-top:.35rem;}' +
    '.cpt2s-legend{color:#7d8f9c;margin-top:.35rem;font-size:.8rem;}' +
    '.cpt2s-progress{padding:.5rem 1rem;border-bottom:1px solid #394b59;color:#a7b6c2;' +
    'white-space:pre-wrap;}' +
    '.cpt2s-log{flex:1 1 auto;overflow:auto;padding:.5rem 1rem;font-family:monospace;' +
    'font-size:.8rem;line-height:1.35;min-height:14rem;}' +
    '.cpt2s-line{white-space:pre-wrap;word-break:break-word;}' +
    '.cpt2s-ERROR{color:#ff7373;} .cpt2s-WARN{color:#ffb648;} .cpt2s-MERGE{color:#84d68a;}' +
    '.cpt2s-INFO{color:#a7b6c2;}' +
    '.cpt2s-foot{padding:.75rem 1rem;border-top:1px solid #394b59;display:flex;gap:.5rem;' +
    'flex-wrap:wrap;align-items:center;}' +
    '.cpt2s-foot button{margin-right:.5rem;}' +
    '.cpt2s-hidden{display:none;}' +
    // Stash's own .sub-heading is white-space: normal, so the newlines in this
    // plugin's description would collapse into one paragraph. Scoped to the group we
    // marked, never to .sub-heading at large: another plugin's description is not
    // ours to reflow, and it may well have been written for the collapse.
    // pre-wrap is the fallback for a description we have not split yet - a blank
    // line renders as a blank line. Once split, the paragraphs are divs and the gap
    // is this margin instead: roughly a third of a line, not a whole one.
    '.cpt2s-own-group .sub-heading{white-space:pre-wrap;}' +
    '.cpt2s-own-group .sub-heading .cpt2s-p{margin:0 0 .35em;}' +
    '.cpt2s-own-group .sub-heading .cpt2s-p:last-child{margin-bottom:0;}';

  function taskInjectStyle() {
    if (document.getElementById(TASK_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = TASK_STYLE_ID;
    style.textContent = TASK_CSS;
    (document.head || document.body || document.documentElement).appendChild(style);
  }

  function taskEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function taskButton(label, className) {
    var b = taskEl('button', 'btn btn-secondary btn-sm' + (className ? ' ' + className : ''), label);
    b.type = 'button';
    return b;
  }

  // The review log names every tag it plans to add, so `name` is always requested -
  // unlike tagFields(), which adds it only while console logging is on. Everything
  // else the filters need is the same.
  function taskTagFields() {
    var cfName = (settings.excludeTagWithCustomFieldName || '').trim();
    // sort_name is what Stash orders tags by where it is set; the closing recap
    // below lists them in that order so it reads against the tag list in the UI.
    return 'id name sort_name ignore_auto_tag' + (cfName ? ' custom_fields' : '');
  }

  // Stash orders tags by COALESCE(sort_name, name) under its NATURAL_CI collation:
  // case-insensitive, with numeric runs compared as numbers so "Volume 2" precedes
  // "Volume 10". Same rule as NormalizeParentTags' summary line - see §3 of its
  // CLAUDE.md. Intl.Collator is the browser's nearest equivalent; without Intl this
  // degrades to a case-insensitive compare, and the id tie-break keeps the order
  // total either way.
  var taskCollate = (function () {
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

  function taskTagSortKey(t) {
    if (!t) return '';
    return ((t.sort_name || '').trim()) || t.name || '';
  }

  function taskLowerId(a, b) {
    var na = parseInt(a, 10), nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na < nb;
    return String(a) < String(b);
  }

  var TIP_ALIASES = 8;        // aliases named in a tooltip before the rest are a count
  var TIP_ALIAS_CHARS = 120;  // and the width that can cut the list shorter still
  var TIP_DESC_CHARS = 240;   // how much of a description the excerpt carries

  // Free text arrives with newlines and runs of spaces in it, and a tooltip line is
  // one line however the description was written.
  function taskOneLine(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  // Cut on the last space before the limit so a word is never sliced in half - unless
  // the only space is near the start, where honouring it would throw most of the
  // excerpt away.
  function taskExcerpt(text, max) {
    var s = taskOneLine(text);
    if (s.length <= max) return s;
    var cut = s.slice(0, max);
    var space = cut.lastIndexOf(' ');
    if (space > max * 0.6) cut = cut.slice(0, space);
    return cut.replace(/[\s,;:.\-]+$/, '') + '…';
  }

  // The recap names a tag; this says what the tag *is*. Both free-text fields are
  // capped, and the tail of the alias list is counted rather than dropped - a
  // shortened list that does not say it is shortened reads as a complete one. Same
  // shape as NormalizeParentTags' tagTooltip, separate because the plugins share no
  // module; keep the two readable against each other.
  function taskAliasList(t) {
    return (((t && t.aliases) || []).map(taskOneLine)).filter(function (a) { return !!a; });
  }

  // Whether the tag has anything to say that the recap does not already show. The
  // span already reads `"Tattoo" (11) x18`, so a tooltip repeating the name and id
  // would open on a hover only to repeat the line underneath it - and since nothing
  // marks which tags have one, every hover that does open had better say something
  // new. (The sibling's tree rows tooltip unconditionally, because there the full
  // name is itself information: a long one is cut off by the row.)
  function taskTagHasDetail(t) {
    return !!(taskAliasList(t).length || taskOneLine(t && t.description));
  }

  function taskTagTooltip(t, id) {
    var lines = [taskOneLine((t && t.name) || 'unnamed'), 'Stash tag id ' + id];

    var aliases = taskAliasList(t);
    if (aliases.length) {
      var shown = [], used = 0;
      for (var i = 0; i < aliases.length; i++) {
        if (shown.length && (shown.length >= TIP_ALIASES || used + aliases[i].length > TIP_ALIAS_CHARS)) break;
        shown.push(shown.length ? aliases[i] : taskExcerpt(aliases[i], TIP_ALIAS_CHARS));
        used += aliases[i].length + 2;
      }
      var rest = aliases.length - shown.length;
      lines.push('Aliases: ' + shown.join(', ') + (rest > 0 ? ', and ' + rest + ' more' : ''));
    }

    var desc = taskOneLine(t && t.description);
    if (desc) lines.push('Description: ' + taskExcerpt(desc, TIP_DESC_CHARS));
    return lines.join('\n');
  }

  // The per-scene lines answer "what happened to this scene". This answers "which
  // tags did this run move, and onto how many scenes" - the question worth asking
  // before approving a library-wide merge, and one a six-figure log cannot be read
  // for.
  //
  // Returned as segments rather than a string: each tag becomes its own span so it
  // can carry a tooltip naming its aliases and description, which is what tells two
  // tags with the same name apart without leaving the dialog. `detail` is optional -
  // without it the line is exactly what it always was, which is also what happens
  // when the detail query fails.
  function taskTagSummaryParts(counts, tagsById, verb, detail) {
    var ids = [], id;
    for (id in counts) if (hasOwn(counts, id)) ids.push(id);
    if (!ids.length) return null;
    ids.sort(function (a, b) {
      var c = taskCollate(taskTagSortKey(tagsById[a]), taskTagSortKey(tagsById[b]));
      if (c) return c;
      return taskLowerId(a, b) ? -1 : 1;
    });
    var parts = [{ text: ids.length + ' tag(s) ' + verb + ': ' }];
    ids.forEach(function (tid, i) {
      var t = tagsById[tid];
      var d = detail && hasOwn(detail, tid) ? detail[tid] : null;
      parts.push({
        text: '"' + ((t && t.name) || 'unnamed') + '" (' + tid + ') x' + counts[tid],
        title: d && taskTagHasDetail(d) ? taskTagTooltip(d, tid) : null,
      });
      if (i < ids.length - 1) parts.push({ text: ', ' });
    });
    return parts;
  }

  function taskPartsText(parts) {
    return parts.map(function (p) { return p.text; }).join('');
  }

  function performerLabel(p) {
    return '"' + (p.name || 'unnamed') + '" (' + p.id + ')';
  }

  // What Stash has installed, as opposed to what this file says it is. "Reload
  // plugins" re-reads the plugin folder on the server but cannot replace a script
  // this page already executed, so the manifest can say 1.8.4 while the browser runs
  // 1.8.3 — and every version Stash renders comes from that manifest. Comparing the
  // two is the only way the script can notice it is the stale one. The sibling has
  // the same check; see its §5 for the reasoning, and the repo-root CLAUDE.md for
  // why the two are separate implementations.
  //
  // Resolves to null wherever the answer is unknown - a Stash too old for the field,
  // a plugin it cannot see, a failed request - because unknown is not a mismatch and
  // a run must not be blocked by one more query failing. It catches only what a
  // version bump makes visible: editing the file without bumping it leaves both
  // numbers equal and this check blind.
  function installedVersion() {
    return gqlRequest('query CPT2SPluginVersion { plugins { id version } }', null)
      .then(function (data) {
        var list = (data && data.plugins) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id) === PLUGIN_ID) return list[i].version || null;
        }
        return null;
      }, function () { return null; });
  }

  var _activeTask = null;

  function startTaskRun(taskName) {
    if (_activeTask) { _activeTask.focus(); return; }
    _activeTask = new TaskRun(taskName || TASK_MERGE_ALL);
    _activeTask.build();
  }

  function TaskRun(taskName) {
    this.taskName = taskName;
    this.reset();
  }

  // Same shape as NormalizeParentTags' Run.reset: everything a pass owns is cleared
  // here, and rescan() is the only caller that puts anything back. Keep the two
  // readable against each other - they are one design with two sets of counters.
  TaskRun.prototype.reset = function () {
    // One entry per scene, never one per performer: a scene featuring two performers
    // is missing tags from both, and writing it twice from a plan computed before
    // either write would have the second write - built from the scene's scan-time
    // tags - drop what the first one added. See planScene.
    this.plan = [];
    this.planByScene = {};
    // Set by checkVersion when the running script is not the installed one. Per pass,
    // because a rescan re-checks - the user may have reloaded plugins in between.
    this.stale = false;
    // Scenes per tag, for the closing recap: what the plan would touch, and what the
    // apply actually wrote. `tagsById` carries the names and sort keys for both.
    this.plannedTagCounts = {};
    this.appliedTagCounts = {};
    this.tagsById = {};
    // Aliases and descriptions for the recap's tooltips, fetched per recap rather
    // than during the walk. `pass` counts the passes so a recap whose detail query
    // is still in flight when Rescan is pressed cannot land in the next one's log.
    this.tagDetail = {};
    this.pass = (this.pass || 0) + 1;
    this.tagsPlanned = 0;
    this.performersSeen = 0;
    this.performersTotal = 0;
    this.scenesUpdated = 0;
    this.tagsAdded = 0;
    this.errors = 0;
    // What this dialog has written and can still take back: one entry per scene the
    // server accepted, holding only the tags this run put there. Session-scoped like
    // `lines` rather than pass-scoped - rescan() saves it across this call - so
    // converging on an empty plan does not cost the ability to undo the passes that
    // got there. Same rule as the sibling's Run.undoable.
    this.undoable = [];
    this.undone = 0;
    this.undoFailed = 0;
    this.undoneTagCounts = {};
    this.undoTotal = 0;
    this.cancelled = false;
    this.stopped = false;
    // `lines` is the export buffer and survives a Rescan, because Copy log is meant
    // to hand over the whole session - rescan() saves it across this call. It is
    // emptied here rather than kept, so a first run starts clean without the
    // constructor needing a special case. `viewLines` counts what has gone into the
    // log since the current pass emptied the view, which is what the progress line
    // describes: a rescan logging four lines must not report the thousands behind it,
    // nor claim to be hiding the ones it no longer has.
    this.lines = [];
    this.pending = [];
    this.viewLines = 0;
    this.state = 'scanning';
  };

  TaskRun.prototype.build = function () {
    taskInjectStyle();
    var self = this;

    this.backdrop = taskEl('div', 'cpt2s-backdrop');
    this.modal = taskEl('div', 'cpt2s-modal');
    this.backdrop.appendChild(this.modal);

    var head = taskEl('div', 'cpt2s-head');
    head.appendChild(taskEl('div', 'cpt2s-title', PLUGIN_NAME + ' - ' + this.taskName));
    // The merge only ever adds tags. Undo is the single exception in this plugin -
    // it takes back what this dialog itself added - and it is not a restore, so the
    // backup instruction stays and its limits are stated beside it.
    head.appendChild(taskEl('div', 'cpt2s-warn',
      'The merge only ever adds tags. Back up your database before the first run: Undo reverses ' +
      'what this dialog added, only while it stays open, and cannot account for changes made ' +
      'elsewhere in the meantime.'));
    // Same legend as NormalizeParentTags', because the log lines are the same shape:
    // the id sits outside the quotes, and the only other numbers here are counts
    // written as x250. Saying which is which is cheaper than a misread scene id.
    head.appendChild(taskEl('div', 'cpt2s-legend',
      'Reading the log: the number in brackets after a name is that scene\'s, performer\'s or ' +
      'tag\'s Stash id - Scene "My Scene" (345) is the scene with id 345. Counts are written ' +
      'as x250, never in brackets.'));
    this.noteEl = taskEl('div', 'cpt2s-note', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.progressEl = taskEl('div', 'cpt2s-progress', 'Starting...');
    this.modal.appendChild(this.progressEl);

    this.logEl = taskEl('div', 'cpt2s-log');
    this.modal.appendChild(this.logEl);

    var foot = taskEl('div', 'cpt2s-foot');
    this.proceedBtn = taskButton('Proceed', 'cpt2s-proceed');
    this.cancelBtn  = taskButton('Cancel', 'cpt2s-cancel');
    this.stopBtn    = taskButton('Stop', 'cpt2s-stop cpt2s-hidden');
    this.copyBtn    = taskButton('Copy log', 'cpt2s-copy');
    this.undoBtn    = taskButton('Undo', 'cpt2s-undo cpt2s-hidden');
    this.rescanBtn  = taskButton('Rescan', 'cpt2s-rescan cpt2s-hidden');
    this.closeBtn   = taskButton('Close', 'cpt2s-close cpt2s-hidden');
    this.proceedBtn.disabled = true;
    this.undoBtn.title = 'Remove the tags this dialog added, from the scenes it added them to. ' +
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
    this.begin();
  };

  TaskRun.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  TaskRun.prototype.show = function (node, visible) {
    node.className = node.className.replace(/\s*cpt2s-hidden/g, '') + (visible ? '' : ' cpt2s-hidden');
  };

  TaskRun.prototype.setState = function (state) {
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
    // the user is deciding between merging more and taking back what is there.
    this.show(this.undoBtn, (ready || done) && this.undoable.length > 0);
    this.show(this.rescanBtn, done);
    this.show(this.closeBtn, done);
    // Undo is deliberately not gated on `stale`: it takes back tags this dialog has
    // already added, and stranding the user with a merge they cannot reverse would be
    // worse than the mismatch it is protecting them from.
    this.proceedBtn.disabled = !ready || !this.plan.length || this.stale;
  };

  // A run-level warning: into the log, where Copy log will carry it, and into the
  // dialog head, where it stays visible after the log has scrolled past it. Appends
  // rather than assigns, so a second warning cannot silently replace the first;
  // begin() blanks the head on every pass, so a rescan re-derives both.
  TaskRun.prototype.note = function (msg) {
    this.log('WARN', msg);
    this.noteEl.textContent = this.noteEl.textContent
      ? this.noteEl.textContent + ' ' + msg : msg;
  };

  // The distinct tags a run moves are a bounded set - tens, where the walk that
  // found them read tens of thousands of performers - so their aliases and
  // descriptions are worth one query here and would be worth nothing on
  // taskTagFields(), where the same text would ride along on every performer's tag
  // list. A description can run to paragraphs; see NormalizeParentTags' §5a for the
  // same trade in its viewer.
  //
  // Failure is silent by design. This buys a tooltip, not a merge, and an [ERROR]
  // line in a log the user is reading for what was written would be a worse outcome
  // than a recap that hovers to nothing.
  TaskRun.prototype.loadTagDetail = function (counts) {
    var ids = [], id;
    for (id in counts) if (hasOwn(counts, id)) ids.push(id);
    if (!ids.length) return Promise.resolve();
    var self = this;
    return gqlRequest(
      'query CPT2STagDetail($ids: [ID!]) { findTags(ids: $ids) ' +
      '{ tags { id name aliases description } } }', { ids: ids }
    ).then(function (data) {
      (((data.findTags || {}).tags) || []).forEach(function (t) { self.tagDetail[t.id] = t; });
    }, function () { /* the recap still reads; it just does not hover */ });
  };

  TaskRun.prototype.logTagSummary = function (counts, verb) {
    var self = this;
    // A rescan empties the log while this is in flight, and a recap of the pass
    // before it would land in the middle of the new one. The pass token is what
    // makes the wait safe.
    var pass = this.pass;
    return this.loadTagDetail(counts).then(function () {
      if (self.pass !== pass) return;
      var parts = taskTagSummaryParts(counts, self.tagsById, verb, self.tagDetail);
      if (parts) self.log('INFO', taskPartsText(parts), parts);
      self.flush();
    });
  };

  // `parts` is optional, and only the tag recap passes it: the line is rendered as
  // spans so each tag can carry its own tooltip. `lines` keeps the plain string
  // either way - Copy log hands over text, and a tooltip is not text.
  TaskRun.prototype.log = function (kind, message, parts) {
    var line = '[' + kind + '] ' + message;
    this.lines.push(line);
    this.viewLines++;
    this.pending.push({ kind: kind, line: line, parts: parts || null });
    this.scheduleFlush();
  };

  TaskRun.prototype.scheduleFlush = function () {
    var self = this;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(function () {
      self.flushTimer = null;
      self.flush();
    }, TASK_FLUSH_MS);
  };

  // Only the tail is rendered. A first run over a large library can plan six figures
  // of scenes, and one node per line is a tab that stops responding; the full log
  // stays in `lines`, which is what Copy log exports.
  TaskRun.prototype.flush = function () {
    if (!this.pending.length) return;
    var pending = this.pending;
    this.pending = [];
    pending.forEach(function (p) {
      var node = taskEl('div', 'cpt2s-line cpt2s-' + p.kind, p.parts ? null : p.line);
      // The line looks exactly like every other one: the spans exist to hang a
      // title on, and carry no styling of their own. An underline and a help cursor
      // were tried at 1.8.0 and read as decoration on a log that has none elsewhere.
      if (p.parts) {
        node.appendChild(taskEl('span', null, '[' + p.kind + '] '));
        p.parts.forEach(function (seg) {
          var span = taskEl('span', null, seg.text);
          if (seg.title) span.title = seg.title;
          node.appendChild(span);
        });
      }
      this.logEl.appendChild(node);
    }, this);
    while (this.logEl.childNodes && this.logEl.childNodes.length > TASK_LOG_CAP) {
      this.logEl.removeChild(this.logEl.firstChild);
    }
    if (typeof this.logEl.scrollHeight === 'number') this.logEl.scrollTop = this.logEl.scrollHeight;
    this.renderProgress();
  };

  TaskRun.prototype.renderProgress = function () {
    var summary;
    if (this.state === 'scanning') {
      summary = 'Reviewing. Performers ' + this.performersSeen + ' / ' + this.performersTotal +
        ', ' + this.plan.length + ' scene(s) to update';
    } else if (this.state === 'ready') {
      summary = 'Review complete. ' + this.plan.length + ' scene(s) to update, ' +
        this.tagsPlanned + ' tag assignment(s) to add. Nothing has been written.';
    } else if (this.state === 'applying') {
      summary = 'Merging. ' + this.scenesUpdated + ' of ' + this.plan.length + ' scene(s) updated';
    } else if (this.state === 'undoing') {
      summary = 'Undoing. ' + this.undone + ' of ' + this.undoTotal + ' scene(s) reversed';
    } else {
      summary = 'Finished. ' + this.scenesUpdated + ' scene(s) updated, ' +
        this.tagsAdded + ' tag assignment(s) added' +
        (this.undone ? ', ' + this.undone + ' scene(s) reversed by Undo' : '') +
        (this.stopped ? ' (stopped early; what was written stays written)' : '');
    }
    if (this.errors) summary += ', ' + this.errors + ' error(s)';
    if (this.viewLines > TASK_LOG_CAP) {
      summary += ' - showing the last ' + TASK_LOG_CAP + ' of ' + this.viewLines + ' lines';
    }
    this.progressEl.textContent = summary;
  };

  // ── Phase 1: review ───────────────────────────────────────────────────────

  TaskRun.prototype.begin = function () {
    var self = this;
    this.setState('scanning');
    this.noteEl.textContent = '';
    this.renderProgress();
    this.log('INFO', PLUGIN_NAME + ' - ' + this.taskName + ' - reviewing, nothing will be written yet.');
    this.describeFilters();

    // A lease means a bulk plugin is mid-run. It is advisory and this is a manual
    // action, so it does not block - but two plugins rewriting the same scenes at
    // once is worth saying out loud.
    if (coop().leases.length) {
      this.note('Another plugin is applying bulk changes right now. Running both at once means ' +
        'each may undo part of the other; let it finish first.');
    }

    this.checkSibling();
    // Not chained ahead of the walk: one small query against a pass that reads every
    // performer in the library. It lands long before Proceed is reachable, and
    // setState is re-applied when it does.
    this.checkVersion();

    resolveExclusionTagId().then(function (exclTagId) {
      return self.walk(1, exclTagId);
    }).then(function () {
      self.finishScan();
    }, function (e) {
      self.log('ERROR', 'Review failed: ' + (e && e.message ? e.message : e));
      self.errors++;
      self.finishScan();
    });
  };

  // The mirror of NormalizeParentTags' own check: it reads our auto-merge flags out
  // of the shared settings response and says whether we will stand down, and since
  // its 1.1.0 it has reactive modes worth the same treatment in reverse. Both of its
  // directions collide with a merge - Prune strips the parent tags we add straight
  // back out, Roll Up piles more ancestors on top - so the warning names which.
  //
  // Unlike its version, this reads the last loaded copy rather than reloading: the
  // task shares `settings` with the rest of the plugin, which is refreshed on
  // navigation and on the 10s timer. That is the same freshness describeFilters()
  // already runs on.
  TaskRun.prototype.checkSibling = function () {
    var ps = _siblingSettings;
    if (!ps) return;

    var prune = !!ps.a8AutoPruneOnUpdate, rollup = !!ps.a9AutoRollUpOnUpdate;
    // Both at once is that plugin's own documented no-op - they are exact inverses,
    // so it runs neither - and warning about a mode that is not running would send
    // the user to turn off something already inert.
    if (prune === rollup) return;

    var mode = prune ? 'Auto Prune on Entity Updates' : 'Auto Roll Up on Entity Updates';
    var effect = prune
      ? 'it will remove the parent tags this merge adds, wherever a more specific tag on the ' +
        'same scene already implies them'
      : 'it will add every ancestor of the tags this merge adds';

    if (coop().respecters[SIBLING_ID]) {
      this.log('INFO', SIBLING_NAME + ' has ' + mode + ' enabled; it will stand down while ' +
        'this task writes.');
      return;
    }
    // Not registered means one of two things and there is no way to tell them apart
    // from here: the plugin is disabled in Stash (so its settings linger in the
    // config but nothing is running), or the installed copy predates the lease
    // protocol. Say both rather than assert the alarming one.
    this.note(SIBLING_NAME + ' has ' + mode + ' enabled in its settings but has not registered ' +
      'as honouring bulk-edit leases - either it is disabled in Stash, or the installed copy is ' +
      'older than the protocol. If it is running, ' + effect + '. Turn it off for the duration, ' +
      'or check the result afterwards.');
  };

  TaskRun.prototype.describeFilters = function () {
    var on = [];
    if (settings.excludeSceneOrganized) on.push('scenes marked Organized are skipped');
    if ((settings.excludeSceneWithTagName || '').trim()) {
      on.push('scenes tagged "' + settings.excludeSceneWithTagName.trim() + '" are skipped');
    }
    if (settings.excludeTagWithIgnoreAutoTag) on.push('tags set to Ignore auto tag are not merged');
    if ((settings.excludeTagWithCustomFieldName || '').trim()) {
      on.push('tags with the custom field "' + settings.excludeTagWithCustomFieldName.trim() +
        '" are not merged');
    }
    this.log('INFO', on.length ? 'Active exclusions: ' + on.join('; ') + '.'
      : 'No exclusion filters are configured, so every performer tag will be merged.');
  };

  // Pages the performer list rather than asking for all of them at once: a large
  // library has tens of thousands, and `per_page: -1` on that is one response the
  // tab has to hold whole. Tags come back with the page, so the review needs no
  // second query per performer.
  TaskRun.prototype.walk = function (page, exclTagId) {
    var self = this;
    if (this.cancelled) return Promise.resolve();
    return gqlRequest(
      'query CPT2S_TaskPerformers($page: Int!, $per: Int!) {' +
      '  findPerformers(filter: { page: $page, per_page: $per, sort: "id", direction: ASC }) {' +
      '    count performers { id name tags { ' + taskTagFields() + ' } }' +
      '  }' +
      '}',
      { page: page, per: TASK_PAGE_SIZE }
    ).then(function (data) {
      var result = (data && data.findPerformers) || {};
      var list = result.performers || [];
      self.performersTotal = result.count || 0;
      if (!list.length) return;

      var i = 0;
      function nextPerformer() {
        // Performers with nothing mergeable are skipped here rather than costing a
        // scene query each: on a large library that is most of the run's savings.
        while (i < list.length) {
          if (self.cancelled) return;
          var p = list[i++];
          self.performersSeen++;
          var perfTags = (p.tags || []).filter(function (t) {
            return tagIsMergeable(t, exclTagId, (settings.excludeTagWithCustomFieldName || '').trim());
          });
          if (!perfTags.length) continue;
          return self.reviewPerformer(p, perfTags, exclTagId).then(nextPerformer);
        }
        self.renderProgress();
        if (self.cancelled || self.performersSeen >= self.performersTotal) return;
        return self.walk(page + 1, exclTagId);
      }
      return nextPerformer();
    });
  };

  TaskRun.prototype.reviewPerformer = function (p, perfTags, exclTagId) {
    var self = this;
    var perfTagIds = perfTags.map(function (t) { return t.id; });
    var perfTagById = {};
    perfTags.forEach(function (t) { perfTagById[t.id] = t; });

    return gqlRequest(
      'query CPT2S_TaskPerformerScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {' +
      '  findScenes(filter: $filter, scene_filter: $scene_filter) {' +
      '    scenes { id organized title files { basename } tags { id } }' +
      '  }' +
      '}',
      {
        filter: { per_page: -1 },
        scene_filter: { performers: { value: [p.id], modifier: 'INCLUDES_ALL' } },
      }
    ).then(function (data) {
      var scenes = (data.findScenes && data.findScenes.scenes) || [];
      scenes.forEach(function (scene) {
        var need = sceneMergePlan(scene, perfTagIds, exclTagId);
        if (!need) return;
        self.planScene(scene, need, perfTagById, p);
      });
      self.renderProgress();
    }, function (e) {
      self.log('ERROR', 'Performer ' + performerLabel(p) + ': listing scenes failed: ' +
        (e && e.message ? e.message : e));
      self.errors++;
    });
  };

  // Folds one performer's needs for one scene into that scene's single plan entry.
  TaskRun.prototype.planScene = function (scene, need, perfTagById, p) {
    var entry = this.planByScene[scene.id];
    if (!entry) {
      entry = {
        scene: scene,
        existingIds: need.existingIds,
        tagIds: [],
        tags: [],
        from: [],
      };
      this.planByScene[scene.id] = entry;
      this.plan.push(entry);
    }
    var added = [];
    var self = this;
    need.missing.forEach(function (id) {
      if (entry.tagIds.indexOf(id) !== -1) return;   // another performer already needs it
      entry.tagIds.push(id);
      entry.tags.push(perfTagById[id]);
      added.push(perfTagById[id]);
      self.tagsById[id] = perfTagById[id];
      // Counted per scene, not per performer: the scene is written once whichever
      // of its performers asked for the tag.
      self.plannedTagCounts[id] = (hasOwn(self.plannedTagCounts, id) ? self.plannedTagCounts[id] : 0) + 1;
    });
    entry.from.push(performerLabel(p));
    this.tagsPlanned += added.length;
    if (added.length) {
      this.log('MERGE', 'Performer ' + performerLabel(p) + ' - Scene ' +
        sceneLogLabel(scene, scene.id) + ' - ' + added.length + ' tag(s): ' +
        added.map(function (t) { return '"' + (t.name || 'unnamed') + '" (' + t.id + ')'; }).join(', '));
    }
  };

  // Called from begin(), so a rescan re-checks: the script cannot change without a
  // page reload, but the installed version can, if the user reloads plugins while
  // this dialog is open - which is what they do after seeing the warning.
  TaskRun.prototype.checkVersion = function () {
    var self = this;
    return installedVersion().then(function (installed) {
      // The two quiet outcomes go to the console, beside the load banner, rather than
      // into the log: this log is about the library, a matching version is the boring
      // case, and a line arriving whenever one small query resolves would land in a
      // different place every run.
      if (!installed) {
        cpt2s('[cpt2s] version check: Stash reported no installed version; running ' +
          PLUGIN_VERSION + '.');
        return;
      }
      if (installed === PLUGIN_VERSION) {
        cpt2s('[cpt2s] version check: running ' + PLUGIN_VERSION + ', which is what is installed.');
        return;
      }
      // The plan is being computed by code that is not what is installed, so Proceed
      // is held back until the page is reloaded. This is the one warning in this
      // dialog that blocks: every other one is about the library or another plugin,
      // where the user knows more than the dialog does - here the dialog knows
      // something the user cannot see.
      self.stale = true;
      self.note('This page is running ' + PLUGIN_NAME + ' ' + PLUGIN_VERSION + ', but ' +
        installed + ' is installed. Reload the page (F5) and run the task again; if this ' +
        'warning comes back, hard-refresh with Ctrl+Shift+R. Proceed stays disabled until the ' +
        'script matches, since the plan would be computed by the older code.');
      self.setState(self.state);
    });
  };

  TaskRun.prototype.finishScan = function () {
    this.flush();
    if (this.cancelled) return;
    if (!this.plan.length) {
      this.log('INFO', 'Nothing to merge.');
    } else {
      this.log('INFO', 'Review complete: ' + this.tagsPlanned + ' tag assignment(s) across ' +
        this.plan.length + ' scene(s). Nothing has been written. Press Proceed to apply.');
      this.logTagSummary(this.plannedTagCounts, 'to add');
    }
    this.setState('ready');
    this.flush();
  };

  // ── Phase 2: apply ────────────────────────────────────────────────────────

  TaskRun.prototype.proceed = function () {
    if (this.state !== 'ready' || !this.plan.length) return;
    var self = this;
    this.setState('applying');
    this.scenesUpdated = 0;
    this.tagsAdded = 0;
    this.appliedTagCounts = {};
    this.log('INFO', 'Applying ' + this.plan.length + ' scene change(s) - ' + new Date().toISOString());

    var i = 0;
    // The lease covers phase 2 only. Phase 1 writes nothing, so there is nothing to
    // suppress, and holding one across a library-wide review would stand a reactive
    // plugin down for the half of the run that cannot disturb it.
    var lease = acquireLease(this.taskName);
    // One guard around the whole apply rather than one per scene: every scene we
    // write would otherwise look to our own fetch wrapper like a user edit and
    // re-enter the merge. That is internal re-entrancy; the lease above is about
    // other plugins, and the two are not substitutes.
    guarded(function () {
      function nextEntry() {
        if (self.stopped || i >= self.plan.length) return Promise.resolve();
        lease.renew();
        return self.applyEntry(self.plan[i++]).then(nextEntry);
      }
      return nextEntry();
    }).then(function () {
      lease.release();
      self.finishApply();
    }, function (e) {
      lease.release();
      self.log('ERROR', 'Apply aborted: ' + (e && e.message ? e.message : e));
      self.errors++;
      self.finishApply();
    });
  };

  // The write is the scene's scan-time tags plus every tag the plan folded into it.
  // Anything a *third party* changed in between is lost the same way any other Stash
  // edit loses a concurrent one - but nothing this run does can clobber itself,
  // because a scene appears in the plan exactly once.
  TaskRun.prototype.applyEntry = function (entry) {
    var self = this;
    return updateSceneTags(entry.scene.id, entry.existingIds.concat(entry.tagIds)).then(function () {
      // Recorded only once the server has taken it, so Undo can never try to reverse
      // a write that never landed. Only the tags this run added are kept: the scene's
      // own tags are none of Undo's business.
      self.undoable.push({ scene: entry.scene, tagIds: entry.tagIds.slice() });
      self.scenesUpdated++;
      self.tagsAdded += entry.tagIds.length;
      entry.tagIds.forEach(function (id) {
        self.appliedTagCounts[id] = (hasOwn(self.appliedTagCounts, id) ? self.appliedTagCounts[id] : 0) + 1;
      });
      logMerges(entry.tags, entry.scene, entry.scene.id, 'saved');
      self.log('MERGE', 'Scene ' + sceneLogLabel(entry.scene, entry.scene.id) + ' - ' +
        entry.tagIds.length + ' tag(s) added - from Performer ' + entry.from.join(', '));
      self.renderProgress();
    }, function (e) {
      self.log('ERROR', 'Scene ' + sceneLogLabel(entry.scene, entry.scene.id) + ' update failed: ' +
        (e && e.message ? e.message : e));
      self.errors++;
    });
  };

  TaskRun.prototype.finishApply = function () {
    this.log('INFO', 'Finished. ' + this.scenesUpdated + ' scene(s) updated, ' +
      this.tagsAdded + ' tag assignment(s) added' +
      (this.errors ? ', ' + this.errors + ' error(s)' : '') +
      (this.stopped ? ' (stopped early; what was written stays written)' : '') +
      '. Press Rescan to review what is left.');
    // Counted from what was written, not from the plan: a failed scene, or a Stop,
    // must not be summarised as though it had landed.
    this.logTagSummary(this.appliedTagCounts, 'added');
    this.setState('done');
    this.flush();

    // Evict the cached scene list so open views pick the new tags up - but never
    // through refreshSceneList, whose fallback is location.reload(). Reloading here
    // would tear down this dialog, and the log with it, at the moment the user wants
    // to read or copy it. Without Apollo the worst case is a stale list until they
    // navigate, which is the right way round.
    var client = window.__APOLLO_CLIENT__;
    if (client && client.cache && client.cache.evict) {
      client.cache.evict({ id: 'ROOT_QUERY', fieldName: 'findScenes' });
      client.cache.gc();
    }
  };

  // ── Undo ──────────────────────────────────────────────────────────────────
  //
  // Takes back the tags this dialog added, as a REMOVE delta per scene. What it is
  // *not* is a restore: it reverses this dialog's own writes and nothing else, it
  // cannot see a change made in between, and it dies with the tab. The head of the
  // dialog says so and the backup instruction stays where it was.
  //
  // The apply writes one scene at a time because it is building each scene's whole
  // tag list; the undo has no such need, so it groups scenes by the set of tags to
  // take off - the same trick as the sibling's buildBatches - and one mutation
  // serves up to TASK_UNDO_CHUNK of them.
  function buildUndoBatches(entries) {
    var groups = {}, order = [];
    entries.forEach(function (entry) {
      var tagIds = entry.tagIds.slice().sort();
      var key = tagIds.join(',');
      if (!hasOwn(groups, key)) {
        groups[key] = { tagIds: tagIds, entries: [] };
        order.push(key);
      }
      groups[key].entries.push(entry);
    });

    var batches = [];
    order.forEach(function (key) {
      var g = groups[key];
      for (var i = 0; i < g.entries.length; i += TASK_UNDO_CHUNK) {
        batches.push({ tagIds: g.tagIds, entries: g.entries.slice(i, i + TASK_UNDO_CHUNK) });
      }
    });
    return batches;
  }

  // Allowed from ready and done - anywhere the dialog is not itself mid-write. It
  // finishes in done either way: once the writes are reversed, a plan reviewed
  // against the library as it was no longer describes it, so Rescan is the honest
  // next step rather than a Proceed left armed over stale ground.
  TaskRun.prototype.undo = function () {
    if ((this.state !== 'ready' && this.state !== 'done') || !this.undoable.length) return;
    var self = this;

    // A single click here starts a library-wide write, in the one state where the
    // user is most likely to be clicking around - Copy log, Rescan and Close are its
    // neighbours - so it arms and asks. The count is what makes the prompt worth
    // reading: it is the scope of the reversal, not a generic "are you sure".
    if (!this.undoArmed) {
      this.undoArmed = true;
      this.undoBtn.textContent = 'Undo ' + this.undoable.length + ' scene(s)?';
      this.undoTimer = setTimeout(function () { self.disarmUndo(); }, TASK_UNDO_ARM_MS);
      return;
    }
    this.disarmUndo();

    this.setState('undoing');
    this.stopped = false;
    this.undone = 0;
    this.undoFailed = 0;
    this.undoneTagCounts = {};
    this.undoTotal = this.undoable.length;
    this.log('INFO', 'Undoing the merge on ' + this.undoTotal + ' scene(s) - ' +
      new Date().toISOString());

    // Newest first, the order that composes: a rescan-and-apply cycle can write to
    // one scene twice, and taking the second write back before the first is the only
    // sequence that lands where the run started.
    var batches = buildUndoBatches(this.undoable.slice().reverse());
    // An undo is a bulk write like any other, so it announces itself the same way.
    var lease = acquireLease(this.taskName + ' (undo)');
    var i = 0;

    // One guard around the whole undo, exactly as the apply has: every scene it
    // writes would otherwise look to our own fetch wrapper like a user edit - and
    // bulkSceneUpdate is precisely what auto-merge on scene update watches for, so
    // without this the plugin would merge the tags straight back in.
    guarded(function () {
      function nextBatch() {
        if (self.stopped || i >= batches.length) return Promise.resolve();
        lease.renew();
        return self.undoBatch(batches[i++]).then(nextBatch);
      }
      return nextBatch();
    }).then(function () {
      lease.release();
      self.finishUndo();
    }, function (e) {
      lease.release();
      self.log('ERROR', 'Undo aborted: ' + (e && e.message ? e.message : e));
      self.errors++;
      self.finishUndo();
    });
  };

  TaskRun.prototype.undoBatch = function (batch) {
    var self = this;
    var ids = batch.entries.map(function (e) { return e.scene.id; });
    return removeSceneTags(ids, batch.tagIds).then(function () {
      batch.entries.forEach(function (entry) {
        // Dropped from the record as it is reversed, so a Stop halfway leaves behind
        // exactly the scenes that still carry what this run added.
        var at = self.undoable.indexOf(entry);
        if (at !== -1) self.undoable.splice(at, 1);
        entry.tagIds.forEach(function (id) {
          self.undoneTagCounts[id] = (hasOwn(self.undoneTagCounts, id) ? self.undoneTagCounts[id] : 0) + 1;
        });
        self.undone++;
        self.log('MERGE', 'Undo - Scene ' + sceneLogLabel(entry.scene, entry.scene.id) + ' - ' +
          entry.tagIds.length + ' tag(s) removed again');
      });
      self.renderProgress();
    }, function (e) {
      self.log('ERROR', 'Undo failed for ' + ids.length + ' scene(s) (' +
        ids.slice(0, 5).join(', ') + (ids.length > 5 ? ', ...' : '') + '): ' +
        (e && e.message ? e.message : e));
      self.errors++;
      self.undoFailed += batch.entries.length;
    });
  };

  TaskRun.prototype.finishUndo = function () {
    this.log('INFO', 'Undo finished. ' + this.undone + ' scene(s) reversed' +
      (this.undoFailed ? ', ' + this.undoFailed + ' could not be' : '') +
      (this.stopped ? ' (stopped early; what was reversed stays reversed)' : '') +
      (this.undoable.length
        ? '. ' + this.undoable.length + ' scene(s) still carry what this run added.'
        : '. Everything this dialog added has been taken back.'));
    this.logTagSummary(this.undoneTagCounts, 'removed again');
    this.setState('done');
    this.flush();

    // Same reasoning as finishApply: evict the cached scene list directly rather
    // than through refreshSceneList, whose fallback would reload the page and tear
    // this dialog down along with its log.
    var client = window.__APOLLO_CLIENT__;
    if (client && client.cache && client.cache.evict) {
      client.cache.evict({ id: 'ROOT_QUERY', fieldName: 'findScenes' });
      client.cache.gc();
    }
  };

  TaskRun.prototype.disarmUndo = function () {
    if (this.undoTimer) { clearTimeout(this.undoTimer); this.undoTimer = null; }
    this.undoArmed = false;
    if (this.undoBtn) this.undoBtn.textContent = 'Undo';
  };

  TaskRun.prototype.stop = function () {
    if (this.state !== 'applying' && this.state !== 'undoing') return;
    this.stopped = true;
    this.log('WARN', 'Stopping after the current ' +
      (this.state === 'undoing' ? 'request' : 'scene') + '...');
  };

  TaskRun.prototype.cancel = function () {
    this.cancelled = true;
    this.log('INFO', 'Cancelled. Nothing was written.');
    this.close();
  };

  // The plan is computed in full before the first write, so anything that changes
  // tags while phase 2 runs - another tab, a scan, the auto-merge modes - is not in
  // the plan being applied. Rescanning until it comes back empty is how a run
  // converges.
  TaskRun.prototype.rescan = function () {
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

  TaskRun.prototype.copy = function () {
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

  TaskRun.prototype.close = function () {
    this.disarmUndo();
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    if (_activeTask === this) _activeTask = null;
  };

  // Layer 1: capture-phase click. React attaches its handlers to the root
  // container, a descendant of document, so a capture listener here runs first and
  // stopPropagation keeps PluginTasks' own handler - and its misleading "added job
  // to queue" toast - from running at all.
  //
  // The button is only ours if it carries our task name AND sits inside a
  // SettingGroup headed with the plugin name; another plugin may declare a task by
  // the same name. Where the group cannot be identified the click is left alone:
  // layer 2 still catches it, keyed on the plugin id in the mutation itself.
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
    startTaskRun(taskName);
  }, true);

  // Layer 2 lives in the fetch wrapper below; this builds the response it answers
  // with, so the mutation is never forwarded to a server that has nothing to exec.
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

  // ── Fetch interception for auto-merge ─────────────────────────────────────
  //
  // Wraps window.fetch to detect sceneUpdate / performerUpdate mutations from
  // Stash itself. _mergeDepth guards against recursion when our own merge work
  // fires a sceneUpdate mutation.

  // fetch resolves for HTTP 500 and for GraphQL errors returned with HTTP 200, so
  // "the request came back" is not "the edit was saved". Inspect a clone of the
  // response before acting on it — our handler is attached before Apollo's, so the
  // body is still unread at this point.
  function mutationSucceeded(p) {
    return p.then(function (resp) {
      if (!resp || !resp.ok) return false;
      var clone;
      try {
        clone = resp.clone();
      } catch (e) {
        return true; // body already consumed; assume success rather than skipping
      }
      return clone.json().then(
        function (json) { return !json || !json.errors; },
        function () { return true; }
      );
    }, function () { return false; });
  }

  var _fetch = window.fetch;
  window.fetch = function (url, opts) {
    // Layer 2 of the task interception, ahead of everything else: the mutation must
    // be answered rather than forwarded, so it cannot go through _fetch first, and
    // the check has to sit in front of the _mergeDepth early return - a task click
    // is a user action and stays one even if a merge happens to be in flight.
    if (typeof url === 'string' && url.indexOf('/graphql') !== -1 && opts && opts.body) {
      try {
        var taskReq = JSON.parse(opts.body);
        var taskVars = taskReq.variables || {};
        if (/\brunPluginTask\b/.test(taskReq.query || '') && taskVars.plugin_id === PLUGIN_ID) {
          startTaskRun(taskVars.task_name || TASK_MERGE_ALL);
          return Promise.resolve(fakeOk({ data: { runPluginTask: PLUGIN_ID + '-handled-in-browser' } }));
        }
      } catch (e) { /* not JSON, or not ours: fall through to the real fetch */ }
    }

    var p = _fetch.apply(this, arguments);
    if (_mergeDepth > 0 || typeof url !== 'string' || url.indexOf('/graphql') === -1 || !opts || !opts.body) {
      return p;
    }
    try {
      var parsed = JSON.parse(opts.body);
      var q = parsed.query || '';
      var vars = parsed.variables || {};

      if (settings.autoMergeOnSceneUpdate && /\bbulkSceneUpdate\b/.test(q) && !autoMergeSuppressed()) {
        var bulkSceneIds = vars.input && vars.input.ids;
        if (bulkSceneIds && bulkSceneIds.length) {
          mutationSucceeded(p).then(function (ok) {
            if (!ok) return;
            var i = 0;
            function nextScene() {
              if (i >= bulkSceneIds.length) {
                refreshSceneList();
                return;
              }
              var sid = String(bulkSceneIds[i++]);
              mergeTagsIntoScene(sid)
                .catch(function (e) { console.error('[cpt2s] auto-merge bulk scene:', e); })
                .then(nextScene);
            }
            nextScene();
          });
        }
      }

      if (settings.autoMergeOnSceneUpdate && /\bsceneUpdate\b/.test(q) && !autoMergeSuppressed()) {
        var sceneId = vars.input && vars.input.id;
        if (sceneId) {
          mutationSucceeded(p).then(function (ok) {
            if (!ok) return;
            mergeTagsIntoScene(String(sceneId))
              .catch(function (e) { console.error('[cpt2s] auto-merge scene:', e); })
              .then(function () {
                if (getSceneId() === String(sceneId)) refreshSceneData(sceneId);
              });
          });
        }
      }

      if (settings.autoMergeOnPerformerUpdate && /\bperformerUpdate\b/.test(q) && !autoMergeSuppressed()) {
        var performerId = vars.input && vars.input.id;
        if (performerId) {
          mutationSucceeded(p).then(function (ok) {
            if (!ok) return;
            mergeTagsIntoAllPerformerScenes(String(performerId))
              .catch(function (e) { console.error('[cpt2s] auto-merge performer:', e); })
              .then(function () { refreshSceneList(); });
          });
        }
      }

      if (settings.autoMergeOnPerformerUpdate && /\bbulkPerformerUpdate\b/.test(q) && !autoMergeSuppressed()) {
        var performerIds = vars.input && vars.input.ids;
        if (performerIds && performerIds.length) {
          mutationSucceeded(p).then(function (ok) {
            if (!ok) return;
            var i = 0;
            function nextPerformer() {
              if (i >= performerIds.length) {
                refreshSceneList();
                return;
              }
              var pid = String(performerIds[i++]);
              mergeTagsIntoAllPerformerScenes(pid)
                .catch(function (e) { console.error('[cpt2s] auto-merge bulk performer:', e); })
                .then(nextPerformer);
            }
            nextPerformer();
          });
        }
      }

      // The performer button's eligibility (tags + scenes) is cached per performer
      // id so it isn't re-queried on every tick. That cache goes stale the moment a
      // save changes the performer's tags — most visibly when a performer with no
      // tags gains some, which should make the button appear without a page reload.
      // Unconditional on autoMergeOnPerformerUpdate: the cache is invalidated by the
      // save itself, not by whether auto-merge is also configured to run.
      if (/\bperformerUpdate\b/.test(q)) {
        var savedPerformerId = vars.input && vars.input.id;
        if (savedPerformerId != null) {
          mutationSucceeded(p).then(function (ok) {
            if (ok && performerCheck && performerCheck.id === String(savedPerformerId)) {
              performerCheck = null;
            }
          });
        }
      }
      if (/\bbulkPerformerUpdate\b/.test(q)) {
        var savedPerformerIds = vars.input && vars.input.ids;
        if (savedPerformerIds && savedPerformerIds.length) {
          mutationSucceeded(p).then(function (ok) {
            if (!ok || !performerCheck) return;
            var ids = savedPerformerIds.map(String);
            if (ids.indexOf(performerCheck.id) !== -1) performerCheck = null;
          });
        }
      }
    } catch (e) {}
    return p;
  };

  // ── Performer page: "Add Tags to Scene(s)" ────────────────────────────────

  var performerCheck = null; // { id, status: 'pending'|'yes'|'no' }

  // A performer with no tags has nothing to merge, so the button would be a dead
  // click — checked alongside the scene count so both conditions resolve in one
  // round trip instead of gating the button behind two sequential queries.
  function checkPerformerHasScenes(performerId) {
    gqlRequest(
      'query CheckPerformerScenes($id: ID!, $filter: FindFilterType, $scene_filter: SceneFilterType) {' +
      '  findPerformer(id: $id) { tags { id } }' +
      '  findScenes(filter: $filter, scene_filter: $scene_filter) { count }' +
      '}',
      {
        id: performerId,
        filter: { per_page: 1 },
        scene_filter: { performers: { value: [performerId], modifier: 'INCLUDES_ALL' } },
      }
    )
      .then(function (data) {
        if (performerCheck && performerCheck.id === performerId) {
          var hasTags   = !!(data.findPerformer && (data.findPerformer.tags || []).length);
          var hasScenes = !!(data.findScenes && data.findScenes.count > 0);
          performerCheck.status = (hasTags && hasScenes) ? 'yes' : 'no';
        }
      })
      .catch(function () {
        if (performerCheck && performerCheck.id === performerId) performerCheck.status = 'no';
      });
  }

  // Stash renders a .details-edit container in two different places on the performer
  // page and swaps between them: DetailsEditNavbar in the detail view, and the edit
  // form's own container while editing. Only the detail view lists the performer's
  // scenes, so that is the only place the button belongs — matching on .details-edit
  // alone would follow the user into the edit form.
  //
  // The navbar is identified by its Delete button, which Stash renders only when not
  // editing; the edit form holds Cancel/Save instead.
  function findPerformerDetailContainer() {
    var candidates = document.querySelectorAll('#performer-page .details-edit');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].querySelector('button.delete')) return candidates[i];
    }
    return null;
  }

  // Places the button just ahead of Delete so it groups with the other non-destructive
  // actions instead of trailing the red button. Delete may be nested inside a wrapper
  // element, so walk up to whichever node is the container's own child — insertBefore
  // only accepts a direct child as the reference node.
  function insertBeforeDelete(container, button) {
    var node = container.querySelector('button.delete');
    while (node && node.parentNode !== container) node = node.parentNode;
    if (node) container.insertBefore(button, node);
    else container.appendChild(button);
  }

  function removePerformerButton() {
    var existing = document.querySelector('.' + PERFORMER_BTN_CLASS);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function addPerformerButton() {
    if (!settings.showManualMergeButtons) {
      removePerformerButton();
      return;
    }
    var performerId = getPerformerId();
    if (!performerId) return;
    var container = findPerformerDetailContainer();
    if (!container) {
      // Editing (or the navbar has not rendered yet) — drop a button left over from
      // the detail view rather than letting it ride along into the edit form.
      removePerformerButton();
      return;
    }
    var existing = document.querySelector('.' + PERFORMER_BTN_CLASS);
    if (existing) {
      if (existing.parentNode === container) return;
      if (existing.parentNode) existing.parentNode.removeChild(existing);
    }

    if (!performerCheck || performerCheck.id !== performerId) {
      performerCheck = { id: performerId, status: 'pending' };
      checkPerformerHasScenes(performerId);
      return;
    }
    if (performerCheck.status !== 'yes') return;

    var button = document.createElement('button');
    button.type = 'button';
    // mx-2 rather than ml-2: the button now sits between two of Stash's own buttons,
    // so it needs breathing room on both sides instead of just the left.
    button.className = 'btn btn-secondary mx-2 ' + PERFORMER_BTN_CLASS;
    button.textContent = 'Add Tags to Scene(s)';
    // The scene set comes from a findScenes query keyed only on this performer, not
    // from the list below, so say so — an active filter looks like it ought to apply.
    button.title = "Add this performer's tags to every scene featuring them. " +
      "Filters and selections in the scene list are ignored.";
    button.addEventListener('click', function (event) {
      event.preventDefault();
      var perfId = getPerformerId();
      if (!perfId) return;
      var btn = event.currentTarget;
      var orig = btn.textContent;
      btn.disabled = true;
      mergeTagsIntoAllPerformerScenes(perfId, function (i, total) {
        btn.textContent = 'Merging... (' + i + '/' + total + ')';
      })
        .then(function () {
          btn.disabled = false;
          btn.textContent = orig;
          refreshSceneList();
        })
        .catch(function (err) {
          console.error('[cpt2s]', err);
          alert('Error merging tags: ' + err.message);
          btn.disabled = false;
          btn.textContent = orig;
        });
    });
    insertBeforeDelete(container, button);
  }

  // ── Scene page: "Add Perf Tags" ───────────────────────────────────────────

  var sceneCheck = null; // { id, status: 'pending'|'yes'|'no' }
  var _sceneFlashToken = 0;
  var FLASH_MS = 1400;

  function checkSceneHasPerformers(sceneId) {
    gqlRequest(
      'query FindScenePerformers($id: ID!) { findScene(id: $id) { performers { id } } }',
      { id: sceneId }
    )
      .then(function (data) {
        var hasPerfs = data.findScene && (data.findScene.performers || []).length > 0;
        if (sceneCheck && sceneCheck.id === sceneId) {
          sceneCheck.status = hasPerfs ? 'yes' : 'no';
        }
      })
      .catch(function () {
        if (sceneCheck && sceneCheck.id === sceneId) sceneCheck.status = 'no';
      });
  }

  function addSceneButton() {
    if (!settings.showManualMergeButtons) {
      var existing = document.querySelector('.' + SCENE_BTN_CLASS);
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    var sceneId = getSceneId();
    if (!sceneId) return;
    if (document.querySelector('.' + SCENE_BTN_CLASS)) return;
    var container = document.querySelector('.edit-buttons');
    if (!container) return;

    if (!sceneCheck || sceneCheck.id !== sceneId) {
      sceneCheck = { id: sceneId, status: 'pending' };
      checkSceneHasPerformers(sceneId);
      return;
    }
    if (sceneCheck.status !== 'yes') return;

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary ml-2 ' + SCENE_BTN_CLASS;
    button.textContent = 'Add Perf Tags';
    function updateSceneButtonTitle() {
      button.title = stagingActive()
        ? "Add all performer tags to the tag box for review — you still have to press Save"
        : "Add all performer tags into this scene's tags";
    }
    updateSceneButtonTitle();
    button.addEventListener('mouseenter', updateSceneButtonTitle);
    button.addEventListener('click', function (event) {
      event.preventDefault();
      var sId = getSceneId();
      if (!sId) return;
      var btn = event.currentTarget;
      var orig = btn.textContent;

      // Shows each message in turn and then restores the caption. Splitting the
      // messages keeps every one of them shorter than "Add Perf Tags", so the button
      // never changes width. The token makes a later click supersede a running
      // sequence instead of the two fighting over the caption.
      function flash() {
        var texts = Array.prototype.slice.call(arguments);
        var token = ++_sceneFlashToken;
        var i = 0;
        (function step() {
          if (token !== _sceneFlashToken) return;
          if (i >= texts.length) { btn.textContent = orig; return; }
          btn.textContent = texts[i++];
          setTimeout(step, FLASH_MS);
        })();
      }
      function fail(err) {
        console.error('[cpt2s]', err);
        alert('Error merging tags: ' + err.message);
        _sceneFlashToken++; // cancel any flash still in flight
        btn.disabled = false;
        btn.textContent = orig;
      }

      btn.disabled = true;

      if (stagingActive()) {
        btn.textContent = 'Adding...';
        stageTagsIntoSceneForm(sId)
          .then(function (result) {
            btn.disabled = false;
            if (result.status === 'excluded') return flash('Scene excluded');
            if (result.status === 'nochange') return flash('No changes');
            // Nothing is saved and nothing is refetched: the tags are now sitting in
            // the form for the user to review, and Stash's own Save button is live.
            flash('Added ' + result.count, 'Save pending');
          })
          .catch(fail);
        return;
      }

      warnNoStagingOnce();
      btn.textContent = 'Merging...';
      mergeTagsIntoScene(sId)
        .then(function (changed) {
          btn.disabled = false;
          if (!changed) {
            // Scene was excluded by a filter or already had every tag. Say so, since
            // refreshSceneData() would otherwise leave the button looking mid-merge.
            flash('No changes');
            return;
          }
          btn.textContent = orig;
          refreshSceneData(sId);
        })
        .catch(fail);
    });
    container.appendChild(button);
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  var _reloading = false;

  function refreshSceneData(sceneId) {
    var client = window.__APOLLO_CLIENT__;
    if (client && client.cache && client.cache.evict) {
      client.cache.evict({ id: 'Scene:' + sceneId });
      client.cache.gc();
      return;
    }
    // _reloading stops maybeGoToEdit from consuming the key during the ticks that
    // still run between the write and the browser actually unloading the page. It is
    // set after the write so a storage failure cannot leave it stuck on.
    try { sessionStorage.setItem('cpt2s_goto_edit', String(sceneId)); } catch (e) {}
    _reloading = true;
    window.location.reload();
  }

  function refreshSceneList() {
    var client = window.__APOLLO_CLIENT__;
    if (client && client.cache && client.cache.evict) {
      client.cache.evict({ id: 'ROOT_QUERY', fieldName: 'findScenes' });
      client.cache.gc();
      return;
    }
    window.location.reload();
  }

  // The pending goto-edit key is always consumed: on a scene we are no longer
  // looking at, and on a deadline if the Edit link never renders. Leaving it behind
  // would make a later, unrelated visit to that scene jump into edit mode.
  var _gotoEditDeadline = 0;

  function clearGotoEdit() {
    try { sessionStorage.removeItem('cpt2s_goto_edit'); } catch (e) {}
    _gotoEditDeadline = 0;
  }

  function maybeGoToEdit() {
    if (_reloading) return;
    var gotoId;
    try { gotoId = sessionStorage.getItem('cpt2s_goto_edit'); } catch (e) { return; }
    if (!gotoId) { _gotoEditDeadline = 0; return; }
    if (gotoId !== getSceneId()) { clearGotoEdit(); return; }
    if (!_gotoEditDeadline) _gotoEditDeadline = Date.now() + GOTO_EDIT_TIMEOUT_MS;
    var links = document.querySelectorAll('a.nav-link');
    for (var i = 0; i < links.length; i++) {
      if (links[i].textContent.trim() === 'Edit') {
        clearGotoEdit();
        links[i].click();
        return;
      }
    }
    if (Date.now() > _gotoEditDeadline) clearGotoEdit();
  }

  // ── The README link on the settings page ──────────────────────────────────
  //
  // Stash does render a link for `url:` in the manifest, but as an unlabelled chain
  // icon in the group header, which is easy to miss. This is the same URL with the
  // file name on it, directly under the description. The description itself cannot
  // carry it: Stash passes that string to React as a child (`subHeading` in
  // Inputs.tsx), so an <a> in it is escaped and shown as text, and CSS cannot help -
  // generated content has no href.
  //
  // Clicking it does not fold the group: SettingGroup's onDivClick walks up from the
  // event target and returns early for `a` and `button`.
  //
  // The sibling has the same feature, anchored the same way, for the same reason
  // there are two of everything here: the plugins share no module.
  var README_URL = 'https://github.com/gregttx/StashPlugins/blob/main/MergePerformerTagsToScenes/README.md';
  var README_LINK_ID = 'cpt2s-readme-link';

  function settingsHasClass(node, name) {
    return (' ' + String((node && node.className) || '') + ' ').indexOf(' ' + name + ' ') !== -1;
  }

  // Only the DOM API the fake DOM in the tests also implements, so the suites drive
  // the same code path a browser does.
  function findByClass(root, name, depth) {
    if (!root || depth > 6) return null;
    var kids = root.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (settingsHasClass(kids[i], name)) return kids[i];
      var found = findByClass(kids[i], name, (depth || 0) + 1);
      if (found) return found;
    }
    return null;
  }

  // Stash gives every plugin setting an element id built from the plugin id and the
  // setting key - `plugin-MergePerformerTagsToScenes-a1ShowManualMergeButtons` - so
  // it is ours by construction, with no heading text to match and nothing formatted
  // for display. Finding one is also what says the plugins settings page is showing.
  // See §2 of NormalizeParentTags' CLAUDE.md: matching the heading instead shipped
  // broken twice over there.
  function ownSettingGroup() {
    var node = document.getElementById('plugin-' + PLUGIN_ID + '-a1ShowManualMergeButtons') ||
      document.getElementById('plugin-' + PLUGIN_ID + '-d1LogMergesToConsole');
    for (var d = 0; node && d < 10; d++, node = node.parentElement) {
      if (settingsHasClass(node, 'setting-group')) return node;
    }
    return null;
  }

  // Under the description, which is in the group header and therefore outside the
  // <Collapse> - so it shows whether or not the group is expanded.
  function readmeLinkSlot(group) {
    var sub = findByClass(group, 'sub-heading', 0);
    if (sub && sub.parentNode) return { parent: sub.parentNode, before: sub.nextSibling };
    var header = findByClass(group, 'setting', 0);
    var box = header && header.childNodes && header.childNodes[0];
    if (box) return { parent: box, before: null };
    return { parent: group, before: null };
  }

  // Paragraph spacing needs elements. Under `white-space: pre-wrap` a blank line is
  // always one whole line-height and nothing can target it, so the description's
  // paragraphs are rebuilt as divs and the gap becomes a margin - about a third of a
  // line, rather than a whole empty one.
  //
  // Stash renders the description as a single text node; React puts that text node
  // back on every re-render of this panel, so this runs on every tick and re-splits
  // when it has to. `splitParagraphs` is idempotent: once the children are ours,
  // there is no text node left to split.
  function splitDescription(group) {
    var sub = findByClass(group, 'sub-heading', 0);
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && settingsHasClass(kids[0], 'cpt2s-p')) return;   // already ours
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;                   // nothing to split
    var paras = text.split(/\n{2,}/);
    sub.textContent = '';
    paras.forEach(function (para) {
      var t = para.replace(/\s+/g, ' ').replace(/^ | $/g, '');
      if (t) sub.appendChild(taskEl('div', 'cpt2s-p', t));
    });
  }

  // Re-added rather than tracked: React re-renders this panel whenever a setting
  // changes and drops anything we put in it, so the tick puts it back. Keyed on the
  // id, so a re-render that kept it does not produce a second one.
  function ensureReadmeLink() {
    var group = ownSettingGroup();
    if (!group) return;
    // Both of these run on every tick, not just when the link is missing: React
    // re-renders this panel on any settings change, and the class is the only thing
    // making the description's paragraph breaks visible.
    taskInjectStyle();
    if (!settingsHasClass(group, 'cpt2s-own-group')) {
      group.className = ((group.className || '') + ' cpt2s-own-group').replace(/^\s+/, '');
    }
    splitDescription(group);
    if (document.getElementById(README_LINK_ID)) return;
    var link = taskEl('a', 'cpt2s-readme', 'MergePerformerTagsToScenes/README.md');
    link.id = README_LINK_ID;
    link.href = README_URL;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = 'Open this plugin\'s documentation for the version it was published at';
    link.style = 'display:inline-block;margin-top:.35rem;font-size:.8rem;';
    var slot = readmeLinkSlot(group);
    slot.parent.insertBefore(link, slot.before);
  }

  function tick() {
    maybeGoToEdit();
    addPerformerButton();
    addSceneButton();
    // Costs two getElementById calls off the settings page, which is where this tab
    // spends none of its time; no query, no observer of its own.
    ensureReadmeLink();
  }

  // The MutationObserver watches the whole SPA subtree, which churns constantly
  // during video playback, so coalesce bursts into a single tick.
  var _tickScheduled = false;
  function scheduleTick() {
    if (_tickScheduled) return;
    _tickScheduled = true;
    setTimeout(function () { _tickScheduled = false; tick(); }, 100);
  }

  function startObserver() {
    var target = document.getElementById('root') || document.body || document.documentElement;
    if (!target) return false;
    try {
      new MutationObserver(scheduleTick).observe(target, { childList: true, subtree: true });
      return true;
    } catch (e) {
      console.warn('[cpt2s] could not observe the DOM; falling back to polling:', e);
      return true; // don't retry: the interval below still drives tick()
    }
  }

  // Patches have to be registered before the components they target first render,
  // so this runs at script load. Stash sets window.PluginApi before loading plugin
  // scripts; the load-event retry only covers an unusual ordering.
  if (!installTagSelectPatch()) {
    window.addEventListener('load', function () { installTagSelectPatch(); });
  }

  window.addEventListener('load', function () { loadSettings(); tick(); });
  document.addEventListener('click', function (event) {
    var target = event.target;
    var link = target && target.closest ? target.closest('a') : null;
    // Wrapped rather than passed by reference so a timer argument can never arrive as
    // loadSettings' `force` and defeat the throttle.
    if (link) { setTimeout(tick, 300); setTimeout(function () { loadSettings(); }, 300); }
  });
  window.addEventListener('popstate', function () {
    setTimeout(tick, 300);
    setTimeout(function () { loadSettings(); }, 300);
  });

  // Started before the observer so a missing/unobservable root can never stop the
  // polling fallback from being installed.
  setInterval(tick, 1000);
  // force: the periodic refresh is the backstop that guarantees settings changes are
  // picked up, so it must never be throttled away by a recent navigation.
  setInterval(function () { loadSettings(true); }, 10000);

  if (!startObserver()) {
    document.addEventListener('DOMContentLoaded', function () { startObserver(); });
  }

  loadSettings();
  tick();
})();
