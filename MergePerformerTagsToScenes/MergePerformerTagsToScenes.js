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
  var isMerging = false;

  var _excludeTagId    = null;
  var _excludeTagName  = '';
  var _excludeTagMissAt = 0; // when a "tag not found" result was last cached
  var EXCLUDE_TAG_MISS_TTL_MS = 10000;

  // ── Helpers ───────────────────────────────────────────────────────────────

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

  // Resolves the tag ID for excludeSceneWithTagName. A successful lookup is cached
  // for as long as the setting is unchanged; a miss is cached only briefly, so the
  // filter starts working once the user creates or renames the tag without needing
  // a page reload. A failed request rejects rather than resolving to null: silently
  // treating an error as "no exclusion configured" would merge tags into the very
  // scenes the user asked to protect, and tags are never removed again.
  function resolveExclusionTagId() {
    var name = (settings.excludeSceneWithTagName || '').trim();
    if (!name) { _excludeTagId = null; _excludeTagName = ''; return Promise.resolve(null); }
    if (name === _excludeTagName) {
      if (_excludeTagId) return Promise.resolve(_excludeTagId);
      if (Date.now() - _excludeTagMissAt < EXCLUDE_TAG_MISS_TTL_MS) return Promise.resolve(null);
    }
    return gqlRequest(
      'query FindTagByName($tag_filter: TagFilterType) { findTags(tag_filter: $tag_filter) { tags { id name } } }',
      { tag_filter: { name: { value: name, modifier: 'EQUALS' } } }
    ).then(function (data) {
      // Stash compiles the EQUALS modifier to SQL LIKE, so the server-side match is
      // case-insensitive and treats _ and % as wildcards. Re-check exactly here so a
      // near-miss can never bind the exclusion to the wrong tag.
      var tags = (data.findTags || {}).tags || [];
      var match = null;
      tags.forEach(function (t) { if (!match && t.name === name) match = t; });
      _excludeTagName   = name;
      _excludeTagId     = match ? match.id : null;
      _excludeTagMissAt = match ? 0 : Date.now();
      if (!match) console.warn('[cpt2s] exclusion tag not found: ' + name);
      return _excludeTagId;
    });
  }

  // ── Core merge logic (shared by buttons and auto-merge) ───────────────────

  // Resolves to true when the scene's tags were updated, false when it was skipped
  // (excluded by a filter, or already carrying every performer tag).
  function mergeTagsIntoScene(sceneId) {
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
            if (settings.excludeTagWithIgnoreAutoTag && t.ignore_auto_tag) return;
            if (cfName && t.custom_fields && (cfName in t.custom_fields)) {
              var cfVal = t.custom_fields[cfName];
              if (cfVal || cfVal === '') return;
            }
            perfTagSet[t.id] = true;
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
    return resolveExclusionTagId().then(function (exclTagId) {
      return gqlRequest(
        'query FindPerformer($id: ID!) { findPerformer(id: $id) { tags { ' + tagFields() + ' } } }',
        { id: performerId }
      ).then(function (data) {
        var performer = data.findPerformer;
        if (!performer) return;
        var cfName = (settings.excludeTagWithCustomFieldName || '').trim();
        var perfTagIds = (performer.tags || []).filter(function (t) {
          if (settings.excludeTagWithIgnoreAutoTag && t.ignore_auto_tag) return false;
          if (cfName && t.custom_fields && (cfName in t.custom_fields)) {
            var cfVal = t.custom_fields[cfName];
            if (cfVal || cfVal === '') return false;
          }
          return true;
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
          function next() {
            if (i >= scenes.length) return;
            var scene = scenes[i++];
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
            if (onProgress) onProgress(i, scenes.length);
            return updateSceneTags(scene.id, existingIds.concat(missing)).then(next);
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
  // Stash itself. isMerging guards against recursion when our own updateSceneTags
  // calls fire a sceneUpdate mutation.

  var _fetch = window.fetch;
  window.fetch = function (url, opts) {
    var p = _fetch.apply(this, arguments);
    if (isMerging || typeof url !== 'string' || url.indexOf('/graphql') === -1 || !opts || !opts.body) {
      return p;
    }
    try {
      var parsed = JSON.parse(opts.body);
      var q = parsed.query || '';
      var vars = parsed.variables || {};

      if (settings.autoMergeOnSceneUpdate && /\bbulkSceneUpdate\b/.test(q)) {
        var bulkSceneIds = vars.input && vars.input.ids;
        if (bulkSceneIds && bulkSceneIds.length) {
          p.then(function () {
            isMerging = true;
            var i = 0;
            function nextScene() {
              if (i >= bulkSceneIds.length) {
                isMerging = false;
                refreshSceneList();
                return;
              }
              var sid = String(bulkSceneIds[i++]);
              mergeTagsIntoScene(sid)
                .catch(function (e) { console.error('[cpt2s] auto-merge bulk scene:', e); })
                .then(nextScene);
            }
            nextScene();
          }).catch(function () {});
        }
      }

      if (settings.autoMergeOnSceneUpdate && /\bsceneUpdate\b/.test(q)) {
        var sceneId = vars.input && vars.input.id;
        if (sceneId) {
          p.then(function () {
            isMerging = true;
            mergeTagsIntoScene(String(sceneId))
              .catch(function (e) { console.error('[cpt2s] auto-merge scene:', e); })
              .then(function () {
                isMerging = false;
                if (getSceneId() === String(sceneId)) refreshSceneData(sceneId);
              });
          }).catch(function () {});
        }
      }

      if (settings.autoMergeOnPerformerUpdate && /\bperformerUpdate\b/.test(q)) {
        var performerId = vars.input && vars.input.id;
        if (performerId) {
          p.then(function () {
            isMerging = true;
            mergeTagsIntoAllPerformerScenes(String(performerId))
              .catch(function (e) { console.error('[cpt2s] auto-merge performer:', e); })
              .then(function () { isMerging = false; refreshSceneList(); });
          }).catch(function () {});
        }
      }

      if (settings.autoMergeOnPerformerUpdate && /\bbulkPerformerUpdate\b/.test(q)) {
        var performerIds = vars.input && vars.input.ids;
        if (performerIds && performerIds.length) {
          p.then(function () {
            isMerging = true;
            var i = 0;
            function nextPerformer() {
              if (i >= performerIds.length) {
                isMerging = false;
                refreshSceneList();
                return;
              }
              var pid = String(performerIds[i++]);
              mergeTagsIntoAllPerformerScenes(pid)
                .catch(function (e) { console.error('[cpt2s] auto-merge bulk performer:', e); })
                .then(nextPerformer);
            }
            nextPerformer();
          }).catch(function () {});
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

  function addPerformerButton() {
    if (!settings.showManualMergeButtons) {
      var existing = document.querySelector('.' + PERFORMER_BTN_CLASS);
      if (existing) existing.parentNode.removeChild(existing);
      return;
    }
    var performerId = getPerformerId();
    if (!performerId) return;
    if (document.querySelector('.' + PERFORMER_BTN_CLASS)) return;
    var container = document.querySelector('#performer-page .details-edit');
    if (!container) return;

    if (!performerCheck || performerCheck.id !== performerId) {
      performerCheck = { id: performerId, status: 'pending' };
      checkPerformerHasScenes(performerId);
      return;
    }
    if (performerCheck.status !== 'yes') return;

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary ml-2 ' + PERFORMER_BTN_CLASS;
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
    container.appendChild(button);
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

  function refreshSceneData(sceneId) {
    var client = window.__APOLLO_CLIENT__;
    if (client && client.cache && client.cache.evict) {
      client.cache.evict({ id: 'Scene:' + sceneId });
      client.cache.gc();
      return;
    }
    sessionStorage.setItem('cpt2s_goto_edit', String(sceneId));
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

  function maybeGoToEdit() {
    var gotoId = sessionStorage.getItem('cpt2s_goto_edit');
    if (!gotoId || gotoId !== getSceneId()) return;
    var links = document.querySelectorAll('a.nav-link');
    for (var i = 0; i < links.length; i++) {
      if (links[i].textContent.trim() === 'Edit') {
        sessionStorage.removeItem('cpt2s_goto_edit');
        links[i].click();
        return;
      }
    }
  }

  function tick() {
    maybeGoToEdit();
    addPerformerButton();
    addSceneButton();
  }

  window.addEventListener('load', function () { loadSettings(); tick(); });
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a');
    if (link) { setTimeout(tick, 300); setTimeout(loadSettings, 300); }
  });
  window.addEventListener('popstate', function () { setTimeout(tick, 300); setTimeout(loadSettings, 300); });
  new MutationObserver(function () { tick(); })
    .observe(document.getElementById('root') || document.body, { childList: true, subtree: true });

  setInterval(tick, 1000);
  setInterval(loadSettings, 10000);
  loadSettings();
  tick();
})();
