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
  };
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

  // custom_fields was added to Tag in Stash 0.31.0. Requesting it on an older
  // server fails GraphQL validation and breaks every merge, so only ask for it
  // when the custom-field exclusion filter is actually configured.
  function tagFields() {
    var cfName = (settings.excludeTagWithCustomFieldName || '').trim();
    return cfName ? 'id ignore_auto_tag custom_fields' : 'id ignore_auto_tag';
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
    if (cfName && t.custom_fields && hasOwn(t.custom_fields, cfName)) {
      var cfVal = t.custom_fields[cfName];
      if (cfVal || cfVal === '') return false;
    }
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
        '  findScene(id: $id) { organized tags { id } performers { tags { ' + tagFields() + ' } } }' +
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
        var perfTagSet = {};
        var cfName = (settings.excludeTagWithCustomFieldName || '').trim();
        performers.forEach(function (p) {
          (p.tags || []).forEach(function (t) {
            if (tagIsMergeable(t, exclTagId, cfName)) perfTagSet[t.id] = true;
          });
        });
        var perfTagIds = Object.keys(perfTagSet);
        if (!perfTagIds.length) return false;
        var existingIds = (scene.tags || []).map(function (t) { return t.id; });
        var existingSet = {};
        existingIds.forEach(function (id) { existingSet[id] = true; });
        var missing = perfTagIds.filter(function (id) { return !existingSet[id]; });
        if (!missing.length) return false;
        return updateSceneTags(sceneId, existingIds.concat(missing)).then(function () { return true; });
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
        var perfTagIds = (performer.tags || []).filter(function (t) {
          return tagIsMergeable(t, exclTagId, cfName);
        }).map(function (t) { return t.id; });
        if (!perfTagIds.length) return;

        return gqlRequest(
          'query FindPerformerScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {' +
          '  findScenes(filter: $filter, scene_filter: $scene_filter) { scenes { id organized tags { id } } }' +
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
          function next() {
            if (i >= scenes.length) {
              // Report failures only after every scene has been attempted, so one bad
              // scene cannot silently cancel the rest of the run.
              if (failed) {
                throw new Error(failed + ' of ' + scenes.length +
                  ' scene(s) could not be updated; see the browser console for details');
              }
              return;
            }
            var scene = scenes[i++];
            if (onProgress) onProgress(i, scenes.length);
            if (settings.excludeSceneOrganized && scene.organized) return next();
            if (exclTagId) {
              var hasExcl = false;
              (scene.tags || []).forEach(function (t) { if (t.id === exclTagId) hasExcl = true; });
              if (hasExcl) return next();
            }
            var existingIds = (scene.tags || []).map(function (t) { return t.id; });
            var existingSet = {};
            existingIds.forEach(function (id) { existingSet[id] = true; });
            var missing = perfTagIds.filter(function (id) { return !existingSet[id]; });
            if (!missing.length) return next();
            return updateSceneTags(scene.id, existingIds.concat(missing))
              .catch(function (e) {
                failed++;
                console.error('[cpt2s] scene ' + scene.id + ' update failed:', e);
              })
              .then(next);
          }
          return next();
        });
      });
    });
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  function loadSettings() {
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
      })
      .catch(function () {});
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
    } catch (e) {}
    return p;
  };

  // ── Performer page: "Add Tags to Scene(s)" ────────────────────────────────

  var performerCheck = null; // { id, status: 'pending'|'yes'|'no' }

  function checkPerformerHasScenes(performerId) {
    gqlRequest(
      'query CheckPerformerScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {' +
      '  findScenes(filter: $filter, scene_filter: $scene_filter) { count }' +
      '}',
      {
        filter: { per_page: 1 },
        scene_filter: { performers: { value: [performerId], modifier: 'INCLUDES_ALL' } },
      }
    )
      .then(function (data) {
        if (performerCheck && performerCheck.id === performerId) {
          performerCheck.status = data.findScenes.count > 0 ? 'yes' : 'no';
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
    button.title = "Add this performer's tags to all of their scenes";
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
      if (existing) existing.parentNode.removeChild(existing);
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
    button.title = "Add all performer tags into this scene's tags";
    button.addEventListener('click', function (event) {
      event.preventDefault();
      var sId = getSceneId();
      if (!sId) return;
      var btn = event.currentTarget;
      var orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Merging...';
      mergeTagsIntoScene(sId)
        .then(function (changed) {
          btn.disabled = false;
          if (!changed) {
            // Scene was excluded by a filter or already had every tag. Say so, since
            // refreshSceneData() would otherwise leave the button looking mid-merge.
            btn.textContent = 'No changes';
            setTimeout(function () { btn.textContent = orig; }, 2000);
            return;
          }
          btn.textContent = orig;
          refreshSceneData(sId);
        })
        .catch(function (err) {
          console.error('[cpt2s]', err);
          alert('Error merging tags: ' + err.message);
          btn.disabled = false;
          btn.textContent = orig;
        });
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

  window.addEventListener('load', function () { loadSettings(); tick(); });
  document.addEventListener('click', function (event) {
    var target = event.target;
    var link = target && target.closest ? target.closest('a') : null;
    if (link) { setTimeout(tick, 300); setTimeout(loadSettings, 300); }
  });
  window.addEventListener('popstate', function () { setTimeout(tick, 300); setTimeout(loadSettings, 300); });

  // Started before the observer so a missing/unobservable root can never stop the
  // polling fallback from being installed.
  setInterval(tick, 1000);
  setInterval(loadSettings, 10000);

  if (!startObserver()) {
    document.addEventListener('DOMContentLoaded', function () { startObserver(); });
  }

  loadSettings();
  tick();
})();
