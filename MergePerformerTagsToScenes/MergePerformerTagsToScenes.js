(function () {
  'use strict';

  var BUTTON_CLASS = 'cpt2s-merge-tags-btn';

  function getPerformerId() {
    var m = window.location.pathname.match(/^\/performers\/(\d+)(?:\/|$)/);
    return m ? m[1] : null;
  }

  function gqlRequest(query, variables) {
    return fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, variables: variables }),
    })
      .then(function (resp) {
        return resp.json();
      })
      .then(function (json) {
        if (json.errors) {
          throw new Error(json.errors.map(function (e) { return e.message; }).join('; '));
        }
        return json.data;
      });
  }

  function getPerformer(id) {
    var query =
      'query FindPerformer($id: ID!) {' +
      '  findPerformer(id: $id) {' +
      '    id' +
      '    name' +
      '    tags { id name }' +
      '  }' +
      '}';
    return gqlRequest(query, { id: id }).then(function (data) {
      return data.findPerformer;
    });
  }

  function getPerformerScenes(id) {
    var query =
      'query FindPerformerScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {' +
      '  findScenes(filter: $filter, scene_filter: $scene_filter) {' +
      '    scenes {' +
      '      id' +
      '      title' +
      '      tags { id }' +
      '    }' +
      '  }' +
      '}';
    var variables = {
      filter: { per_page: -1 },
      scene_filter: { performers: { value: [id], modifier: 'INCLUDES_ALL' } },
    };
    return gqlRequest(query, variables).then(function (data) {
      return data.findScenes.scenes;
    });
  }

  function updateSceneTags(sceneId, tagIds) {
    var mutation =
      'mutation SceneUpdate($input: SceneUpdateInput!) {' +
      '  sceneUpdate(input: $input) { id }' +
      '}';
    return gqlRequest(mutation, { input: { id: sceneId, tag_ids: tagIds } });
  }

  function mergeTagsHandler(event) {
    event.preventDefault();
    var performerId = getPerformerId();
    if (!performerId) return;

    var button = event.currentTarget;
    var originalText = button.textContent;
    button.disabled = true;

    getPerformer(performerId)
      .then(function (performer) {
        if (!performer) {
          alert('Performer not found.');
          return;
        }

        var performerTagIds = (performer.tags || []).map(function (t) { return t.id; });
        if (performerTagIds.length === 0) {
          // alert('"' + performer.name + '" has no tags to merge.');
          return;
        }

        return getPerformerScenes(performerId).then(function (scenes) {
          if (!scenes || scenes.length === 0) {
            // alert('No scenes found for "' + performer.name + '".');
            return;
          }

/*           var confirmed = window.confirm(
            'Merge ' + performerTagIds.length + ' tag(s) from "' + performer.name + '" to ' +
            scenes.length + ' scene(s)?\n\n' +
            'Existing scene tags will be kept; performer tags will be added where missing.'
          );
          if (!confirmed) return;
 */
          var updated = 0;
          var skipped = 0;
          var i = 0;

          function next() {
            if (i >= scenes.length) {
              // alert('Done. Updated ' + updated + ' scene(s). ' + skipped + ' scene(s) already had all tags.');
              return;
            }

            var scene = scenes[i++];
            var existingIds = (scene.tags || []).map(function (t) { return t.id; });
            var existingSet = {};
            existingIds.forEach(function (id) { existingSet[id] = true; });
            var missing = performerTagIds.filter(function (id) { return !existingSet[id]; });

            if (missing.length === 0) {
              skipped++;
              return next();
            }

            button.textContent = 'Merging... (' + i + '/' + scenes.length + ')';
            return updateSceneTags(scene.id, existingIds.concat(missing)).then(function () {
              updated++;
              return next();
            });
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

  function addButton() {
    var performerId = getPerformerId();
    if (!performerId) return;
    if (document.querySelector('.' + BUTTON_CLASS)) return;

    var container = document.querySelector('#performer-page .details-edit');
    if (!container) return;

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary ml-2 ' + BUTTON_CLASS;
    button.textContent = 'Merge Tags to Scenes';
    button.title = "Merge this performer's tags to all of their scenes";
    button.addEventListener('click', mergeTagsHandler);

    container.appendChild(button);
  }

  function tick() {
    addButton();
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
  var observer = new MutationObserver(function () {
    tick();
  });
  observer.observe(root, { childList: true, subtree: true });

  setInterval(tick, 1000);
  tick();
})();
