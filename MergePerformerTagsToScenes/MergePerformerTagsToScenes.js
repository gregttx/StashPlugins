(function () {
  'use strict';

  var PLUGIN_ID           = 'MergePerformerTagsToScenes';
  var PERFORMER_BTN_CLASS = 'cpt2s-merge-to-scenes-btn';
  var SCENE_BTN_CLASS     = 'cpt2s-merge-from-perfs-btn';

  var settings = { autoMergeOnSceneUpdate: false, autoMergeOnPerformerUpdate: false };
  var isMerging = false;

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

  // ── Core merge logic (shared by buttons and auto-merge) ───────────────────

  function mergeTagsIntoScene(sceneId) {
    return gqlRequest(
      'query FindScene($id: ID!) {' +
      '  findScene(id: $id) { tags { id } performers { tags { id } } }' +
      '}',
      { id: sceneId }
    ).then(function (data) {
      var scene = data.findScene;
      if (!scene || !(scene.performers || []).length) return;

      var perfTagSet = {};
      scene.performers.forEach(function (p) {
        (p.tags || []).forEach(function (t) { perfTagSet[t.id] = true; });
      });
      var perfTagIds = Object.keys(perfTagSet);
      if (!perfTagIds.length) return;

      var existingIds = (scene.tags || []).map(function (t) { return t.id; });
      var existingSet = {};
      existingIds.forEach(function (id) { existingSet[id] = true; });
      var missing = perfTagIds.filter(function (id) { return !existingSet[id]; });
      if (!missing.length) return;

      return updateSceneTags(sceneId, existingIds.concat(missing));
    });
  }

  function mergeTagsIntoAllPerformerScenes(performerId, onProgress) {
    return gqlRequest(
      'query FindPerformer($id: ID!) { findPerformer(id: $id) { tags { id } } }',
      { id: performerId }
    ).then(function (data) {
      var performer = data.findPerformer;
      if (!performer) return;
      var perfTagIds = (performer.tags || []).map(function (t) { return t.id; });
      if (!perfTagIds.length) return;

      return gqlRequest(
        'query FindPerformerScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {' +
        '  findScenes(filter: $filter, scene_filter: $scene_filter) { scenes { id tags { id } } }' +
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
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  function loadSettings() {
    gqlRequest('{ configuration { plugins } }', null)
      .then(function (data) {
        var ps = ((data.configuration || {}).plugins || {})[PLUGIN_ID] || {};
        settings.autoMergeOnSceneUpdate     = !!ps.autoMergeOnSceneUpdate;
        settings.autoMergeOnPerformerUpdate = !!ps.autoMergeOnPerformerUpdate;
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
    } catch (e) {}
    return p;
  };

  // ── Performer page: "Merge Tags to Scene(s)" ──────────────────────────────

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
    button.textContent = 'Merge Tags to Scene(s)';
    button.title = "Merge this performer's tags to all of their scenes";
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

  // ── Scene page: "Merge Tags from Performer(s)" ───────────────────────────

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
    button.textContent = 'Merge Tags from Performer(s)';
    button.title = "Merge all performer tags into this scene's tags";
    button.addEventListener('click', function (event) {
      event.preventDefault();
      var sId = getSceneId();
      if (!sId) return;
      var btn = event.currentTarget;
      var orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Merging...';
      mergeTagsIntoScene(sId)
        .then(function () {
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
