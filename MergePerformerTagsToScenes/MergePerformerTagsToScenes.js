// Merge Performer Tags To Scenes
//
// Requires Stash 0.31.0 or newer: tag custom_fields (the custom-field exclusion
// filter) and PluginApi component patching (staging tags into the scene edit form)
// both depend on it.
(function () {
  'use strict';

  var PLUGIN_ID           = 'MergePerformerTagsToScenes';
  var PERFORMER_BTN_CLASS = 'cpt2s-merge-to-scenes-btn';
  var SCENE_BTN_CLASS     = 'cpt2s-merge-from-perfs-btn';

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
  function sceneLogLabel(scene, sceneId) {
    var name = scene.title;
    if (!name) {
      var files = scene.files || [];
      if (files.length) name = files[0].basename;
    }
    return (name || 'untitled') + ' (' + (scene.id || sceneId) + ')';
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
    logInfo('merge logging enabled — one line will appear here per tag merged into a scene');
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
      logInfo('Tag "' + (t.name || 'unnamed') + ' (' + t.id + ')" ' +
        action + ' to Scene "' + label + '"');
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
        if (settings.excludeSceneOrganized && scene.organized) return false;
        if (exclTagId) {
          var hasExcl = false;
          (scene.tags || []).forEach(function (t) { if (t.id === exclTagId) hasExcl = true; });
          if (hasExcl) return false;
        }
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
        var existingIds = (scene.tags || []).map(function (t) { return t.id; });
        var existingSet = {};
        existingIds.forEach(function (id) { existingSet[id] = true; });
        var missing = perfTagIds.filter(function (id) { return !existingSet[id]; });
        if (!missing.length) return false;
        return updateSceneTags(sceneId, existingIds.concat(missing)).then(function () {
          logMerges(missing.map(function (id) { return perfTagById[id]; }), scene, sceneId, 'saved');
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
          if (settings.excludeSceneOrganized && scene.organized) return { status: 'excluded' };
          if (exclTagId) {
            var hasExcl = false;
            (scene.tags || []).forEach(function (t) { if (t.id === exclTagId) hasExcl = true; });
            if (hasExcl) return { status: 'excluded' };
          }

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
              if (settings.excludeSceneOrganized && scene.organized) continue;
              if (exclTagId) {
                var hasExcl = false;
                (scene.tags || []).forEach(function (t) { if (t.id === exclTagId) hasExcl = true; });
                if (hasExcl) continue;
              }
              var existingIds = (scene.tags || []).map(function (t) { return t.id; });
              var existingSet = {};
              existingIds.forEach(function (id) { existingSet[id] = true; });
              var missing = perfTagIds.filter(function (id) { return !existingSet[id]; });
              if (!missing.length) continue;
              return updateSceneTags(scene.id, existingIds.concat(missing))
                .then(makeSceneLogger(scene, missing))
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
        settings.showManualMergeButtons    = !!ps.showManualMergeButtons;
        settings.autoMergeOnSceneUpdate    = !!ps.autoMergeOnSceneUpdate;
        settings.autoMergeOnPerformerUpdate = !!ps.autoMergeOnPerformerUpdate;
        settings.excludeSceneOrganized     = !!ps.excludeSceneOrganized;
        settings.excludeSceneWithTagName       = ps.excludeSceneWithTagName || '';
        settings.excludeTagWithIgnoreAutoTag    = !!ps.excludeTagWithIgnoreAutoTag;
        settings.excludeTagWithCustomFieldName  = ps.excludeTagWithCustomFieldName || '';
        settings.saveTagsImmediately            = !!ps.saveTagsImmediately;
        settings.logMergesToConsole             = !!ps.logMergesToConsole;
        announceLogging();
      })
      .catch(function () {})
      // Stamped on completion as well as on dispatch, so the throttle window starts
      // from when the answer arrived rather than from when a slow request began.
      .then(function () { _settingsInFlight = false; _settingsLoadedAt = Date.now(); });
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
    var p = _fetch.apply(this, arguments);
    if (_mergeDepth > 0 || typeof url !== 'string' || url.indexOf('/graphql') === -1 || !opts || !opts.body) {
      return p;
    }
    try {
      var parsed = JSON.parse(opts.body);
      var q = parsed.query || '';
      var vars = parsed.variables || {};

      if (settings.autoMergeOnSceneUpdate && /\bbulkSceneUpdate\b/.test(q)) {
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

      if (settings.autoMergeOnSceneUpdate && /\bsceneUpdate\b/.test(q)) {
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

      if (settings.autoMergeOnPerformerUpdate && /\bperformerUpdate\b/.test(q)) {
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

      if (settings.autoMergeOnPerformerUpdate && /\bbulkPerformerUpdate\b/.test(q)) {
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

  function tick() {
    maybeGoToEdit();
    addPerformerButton();
    addSceneButton();
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
