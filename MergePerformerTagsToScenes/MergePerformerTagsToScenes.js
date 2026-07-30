(function () {
  'use strict';

  var PERFORMER_BTN_CLASS = 'cpt2s-merge-to-scenes-btn';
  var SCENE_BTN_CLASS     = 'cpt2s-merge-from-perfs-btn';

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
        if (json.errors) {
          throw new Error(json.errors.map(function (e) { return e.message; }).join('; '));
        }
        return json.data;
      });
  }

  function updateSceneTags(sceneId, tagIds) {
    var mutation =
      'mutation SceneUpdate($input: SceneUpdateInput!) {' +
      '  sceneUpdate(input: $input) { id }' +
      '}';
    return gqlRequest(mutation, { input: { id: sceneId, tag_ids: tagIds } });
  }

  // ── Performer page: "Merge Tags to Scene(s)" ──────────────────────────────

  var performerCheck = null; // { id, status: 'pending'|'yes'|'no' }

  function checkPerformerHasScenes(performerId) {
    var query =
      'query CheckPerformerScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {' +
      '  findScenes(filter: $filter, scene_filter: $scene_filter) { count }' +
      '}';
    gqlRequest(query, {
      filter: { per_page: 1 },
      scene_filter: { performers: { value: [performerId], modifier: 'INCLUDES_ALL' } },
    })
      .then(function (data) {
        if (performerCheck && performerCheck.id === performerId) {
          performerCheck.status = data.findScenes.count > 0 ? 'yes' : 'no';
        }
      })
      .catch(function () {
        if (performerCheck && performerCheck.id === performerId) {
          performerCheck.status = 'no';
        }
      });
  }

  function mergeTagsToScenesHandler(event) {
    event.preventDefault();
    var performerId = getPerformerId();
    if (!performerId) return;

    var button = event.currentTarget;
    var originalText = button.textContent;
    button.disabled = true;

    var perfQuery =
      'query FindPerformer($id: ID!) {' +
      '  findPerformer(id: $id) { id name tags { id } }' +
      '}';
    var scenesQuery =
      'query FindPerformerScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {' +
      '  findScenes(filter: $filter, scene_filter: $scene_filter) {' +
      '    scenes { id tags { id } }' +
      '  }' +
      '}';

    gqlRequest(perfQuery, { id: performerId })
      .then(function (data) {
        var performer = data.findPerformer;
        if (!performer) return;

        var performerTagIds = (performer.tags || []).map(function (t) { return t.id; });
        if (performerTagIds.length === 0) return;

        return gqlRequest(scenesQuery, {
          filter: { per_page: -1 },
          scene_filter: { performers: { value: [performerId], modifier: 'INCLUDES_ALL' } },
        }).then(function (data2) {
          var scenes = data2.findScenes.scenes;
          if (!scenes || scenes.length === 0) return;

          var i = 0;
          function next() {
            if (i >= scenes.length) return;
            var scene = scenes[i++];
            var existingIds = (scene.tags || []).map(function (t) { return t.id; });
            var existingSet = {};
            existingIds.forEach(function (id) { existingSet[id] = true; });
            var missing = performerTagIds.filter(function (id) { return !existingSet[id]; });
            if (missing.length === 0) return next();
            button.textContent = 'Merging... (' + i + '/' + scenes.length + ')';
            return updateSceneTags(scene.id, existingIds.concat(missing)).then(next);
          }
          return next();
        });
      })
      .catch(function (err) {
        console.error('[mergePerformerTagsToScenes]', err);
        alert('Error merging tags: ' + err.message);
      })
      .then(function () {
        button.disabled = false;
        button.textContent = originalText;
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
    button.addEventListener('click', mergeTagsToScenesHandler);
    container.appendChild(button);
  }

  // ── Scene page: "Merge Tags from Performer(s)" ───────────────────────────

  var sceneCheck = null; // { id, status: 'pending'|'yes'|'no' }

  function checkSceneHasPerformers(sceneId) {
    var query =
      'query FindScenePerformers($id: ID!) {' +
      '  findScene(id: $id) { performers { id } }' +
      '}';
    gqlRequest(query, { id: sceneId })
      .then(function (data) {
        var hasPerfs = data.findScene &&
          data.findScene.performers &&
          data.findScene.performers.length > 0;
        if (sceneCheck && sceneCheck.id === sceneId) {
          sceneCheck.status = hasPerfs ? 'yes' : 'no';
        }
      })
      .catch(function () {
        if (sceneCheck && sceneCheck.id === sceneId) {
          sceneCheck.status = 'no';
        }
      });
  }

  function mergeTagsFromPerformersHandler(event) {
    event.preventDefault();
    var sceneId = getSceneId();
    if (!sceneId) return;

    var button = event.currentTarget;
    var originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Merging...';

    var query =
      'query FindScene($id: ID!) {' +
      '  findScene(id: $id) {' +
      '    tags { id }' +
      '    performers { tags { id } }' +
      '  }' +
      '}';

    gqlRequest(query, { id: sceneId })
      .then(function (data) {
        var scene = data.findScene;
        if (!scene) return;

        var performers = scene.performers || [];
        if (performers.length === 0) return;

        var allPerfTagIds = {};
        performers.forEach(function (p) {
          (p.tags || []).forEach(function (t) { allPerfTagIds[t.id] = true; });
        });
        var perfTagIds = Object.keys(allPerfTagIds);
        if (perfTagIds.length === 0) return;

        var existingIds = (scene.tags || []).map(function (t) { return t.id; });
        var existingSet = {};
        existingIds.forEach(function (id) { existingSet[id] = true; });
        var missing = perfTagIds.filter(function (id) { return !existingSet[id]; });
        if (missing.length === 0) return;

        return updateSceneTags(sceneId, existingIds.concat(missing));
      })
      .catch(function (err) {
        console.error('[mergePerformerTagsToScenes]', err);
        alert('Error merging tags: ' + err.message);
      })
      .then(function () {
        button.disabled = false;
        button.textContent = originalText;
      });
  }

  function addSceneButton() {
    var sceneId = getSceneId();
    if (!sceneId) return;
    if (document.querySelector('.' + SCENE_BTN_CLASS)) return;

    var container = document.querySelector('#scene-page .details-edit');
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
    button.addEventListener('click', mergeTagsFromPerformersHandler);
    container.appendChild(button);
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  function tick() {
    addPerformerButton();
    addSceneButton();
  }

  window.addEventListener('load', tick);
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a');
    if (link) setTimeout(tick, 300);
  });
  window.addEventListener('popstate', function () {
    setTimeout(tick, 300);
  });

  var root = document.getElementById('root') || document.body;
  new MutationObserver(function () { tick(); })
    .observe(root, { childList: true, subtree: true });

  setInterval(tick, 1000);
  tick();
})();
