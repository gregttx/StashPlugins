// Merge Performer Tags To Scenes
//
// Requires Stash 0.31.0 or newer: tag custom_fields (the custom-field exclusion
// filter) and PluginApi component patching (staging tags into the scene edit form)
// both depend on it.
(function () {
  'use strict';

  var PLUGIN_ID           = 'MergePerformerTagsToScenes';
  var PLUGIN_NAME         = 'ᝯㄝₓ Merge Performer Tags To Scenes';
  // The name the dialog wears, declared beside the full one the way
  // `PropagateTagsAndPerformers` declares its own - there, the manifest name is long
  // enough to crowd out the task, the path and the entity that follow it in a scoped
  // title. Here it already fits, so the two are the same string. The constant exists
  // anyway, so the head reads identically in both plugins and a future rename has one
  // place to happen; `PLUGIN_NAME` stays the manifest's, since `ownSettingGroup`
  // matches the settings page's heading against it.
  var PLUGIN_SHORT_NAME   = PLUGIN_NAME;
  var SIBLING_ID          = 'NormalizeParentTags';
  var SIBLING_NAME        = 'ᝯㄝₓ Normalize Parent Tags';

  // The one version that proves anything. The settings page reads the manifest over
  // GraphQL and updates as soon as plugins are reloaded, while the browser can still
  // be running a script it cached before the edit — a heading reading 1.8.3 over
  // 1.8.0 behaviour is the normal look of a stale script. This constant travels
  // inside the file. Bump it with the manifest and the yml; the `version` suite
  // fails if the three disagree.
  var PLUGIN_VERSION      = '3.5.1';

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

  // "3 changes", "1 change" - the count is always known where it is printed, so the
  // "(s)" these dialogs used to write everywhere was never carrying information. An
  // irregular plural passes its own; everything else takes an "s". Keep this function
  // byte-identical across the plugins, like the CSS.
  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  cpt2s('[cpt2s] MergePerformerTagsToScenes.js ' + PLUGIN_VERSION + ' loaded. This is the ' +
    'running script’s own version — the settings page reads the manifest instead, which can ' +
    'be newer than the script your browser has cached.');
  // The horizontal fallback both on-page buttons get when the row has no spacing of its
  // own to copy - see `applyButtonSpacing`. Deliberately not on the button at build
  // time: Bootstrap's spacing utilities are `!important`.
  var SPACING_CLASS       = 'mx-2';
  var PERFORMER_BTN_CLASS = 'cpt2s-merge-to-scenes-btn';
  var SCENE_BTN_CLASS     = 'cpt2s-merge-from-perfs-btn';
  // The two captions. The base text is a cross-plugin contract - `PropagateTagsAndPerformers`
  // matches on it to tell "the other plugin is already showing this button" from "it
  // only could be" - and the trailing "..." is this repo's mark for a click that opens
  // a dialog rather than acting. The performer button always does; the scene button
  // does only where staging is unavailable, so it resolves its caption per tick and the
  // sibling's dedup compares with the dots stripped.
  var PERFORMER_BTN_LABEL = 'Add Tags to all Scenes...';
  var SCENE_BTN_LABEL     = 'Add all Tags from all Performers';

  // Every button this plugin puts on a page, and the task button Stash renders for
  // it, in amber. Stash's own row actions are `btn-secondary`, so a button of ours
  // sitting among them was indistinguishable from one of its own - and these are not
  // the same kind of thing: Stash's write what is in the form in front of you, ours
  // reach out and rewrite other entities. Amber says "this one is mine and it writes"
  // without claiming the primary role `btn-primary` would.
  //
  // A Bootstrap variant class rather than a colour of our own, so the hover, focus
  // and active states come from Stash's theme and stay in step with it. Its
  // `btn-warning` renders white text, unlike stock Bootstrap's dark - checked live,
  // 2026-08-11 - so nothing here overrides the foreground. `btn-dark` is worth
  // knowing about and not worth using: Stash themes it identically to
  // `btn-secondary`, so it would read as no change at all.
  //
  // Pinned to the same string in PropagateTagsAndPerformers: the two plugins' buttons
  // share a row, and one amber beside one grey would read as a difference in kind
  // rather than in plugin.
  var PLUGIN_BTN_VARIANT  = 'btn-warning';

  // Declared in the manifest so Stash lists it under Settings - Tasks - Plugin
  // Tasks, but run in the browser: this plugin has no exec, so a queued job could
  // only fail. See the task section near the end of this file.
  var TASK_MERGE_ALL   = 'Merge Performer Tags into All Their Scenes...';
  var TASKS            = [TASK_MERGE_ALL];
  var TASK_PAGE_SIZE   = 500;   // performers per page while walking the library
  var TASK_LOG_CAP     = 1000;  // log lines kept in the DOM; all of them stay in memory
  var TASK_FLUSH_MS    = 100;
  var TASK_UNDO_CHUNK  = 100;   // scene ids per undo mutation
  var TASK_UNDO_ARM_MS = 4000;  // how long Undo stays armed for its second click
  // The busy cursor under the last log line. The counters say how far a pass has
  // got; this says it is still going, which is the question a walk that spends
  // seconds on one page of performers leaves unanswered.
  var SPIN_FRAMES      = ['▙', '▛', '▜', '▟'];
  var SPIN_MS          = 125;   // one four-frame cycle at 2Hz

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

  // The one global this repo reserves: `window.__GTTx__`, holding every object these
  // plugins share. `StashPluginCoop` on its own was a name any third-party plugin
  // could have picked, and a collision would hand someone else's object our leases;
  // nesting it under an owner prefix makes that a non-question.
  //
  // `window.StashPluginCoop` stays as an alias to the very same object, and an existing
  // one is adopted rather than replaced. A user who updates one of these plugins and
  // not the others has two releases of the protocol in one tab, and both halves have to
  // keep seeing one set of leases - the alias costs a line, a missed lease costs a bulk
  // run. Keep this function byte-identical across the three plugins, like the CSS.
  function coopObject() {
    var ns = window.__GTTx__;
    if (!ns || typeof ns !== 'object') ns = window.__GTTx__ = {};
    var c = ns.StashPluginCoop || window.StashPluginCoop;
    if (!c || typeof c !== 'object') c = {};
    ns.StashPluginCoop = c;
    if (window.StashPluginCoop !== c) window.StashPluginCoop = c;
    return c;
  }

  // ── The shared DOM bus ────────────────────────────────────────────────────
  //
  // One MutationObserver on Stash's root for every plugin in this repo, rather than one
  // each. The four that need one watch the same subtree for the same reason - a control
  // has to land before the user reads the panel it is in - and with all of them installed
  // that was four registrations firing on every DOM burst, which on a Scene page with
  // video playing is continuous. It is the one place the "five copies of one design" rule
  // compounds rather than merely repeats, which is why this is shared rather than copied.
  //
  // Whichever plugin loads first creates the observer; the rest subscribe to it. Each
  // keeps its own debounce, because what a burst costs each of them differs.
  //
  // Advisory in exactly the way the lease is: a plugin too old to know about the bus makes
  // its own observer and still works, and one subscriber throwing does not silence the
  // rest. `subscribe` is idempotent and safe to call again - which is what the load-event
  // retry does when there was no root to observe at script bottom - and answers whether
  // anything is being observed yet, so a caller with a polling fallback can tell.
  //
  // Byte-identical in every plugin that has one, like `coopObject` above and for the same
  // reason; `tests/style.test.js` fails on a drifted copy.
  function domBus() {
    var ns = window.__GTTx__;
    if (!ns || typeof ns !== 'object') ns = window.__GTTx__ = {};
    var bus = ns.domBus;
    if (bus && typeof bus.subscribe === 'function') return bus;
    bus = ns.domBus = { subs: [], observing: false };
    bus.notify = function () {
      for (var i = 0; i < bus.subs.length; i++) {
        try { bus.subs[i](); } catch (e) { /* one subscriber must not silence the rest */ }
      }
    };
    bus.subscribe = function (fn) {
      if (bus.subs.indexOf(fn) === -1) bus.subs.push(fn);
      if (bus.observing || typeof MutationObserver !== 'function') return bus.observing;
      var root = document.getElementById('root') || document.body || document.documentElement;
      if (!root) return false;
      try {
        new MutationObserver(bus.notify).observe(root, { childList: true, subtree: true });
        bus.observing = true;
      } catch (e) {
        bus.observing = false;
      }
      return bus.observing;
    };
    return bus;
  }

  function coop() {
    var c = coopObject();
    if (!c.leases) c.leases = [];
    if (!c.respecters) c.respecters = {};
    if (!c.declares) c.declares = {};
    if (!c.order) c.order = {};
    return c;
  }

  // ── Button gating diagnostics ────────────────────────────────────────────
  //
  // Off unless `__GTTx__.StashPluginCoop.debugButtons = true`, typed into the browser console:
  // no setting, no reload, no file edit, and read at call time so it takes effect on the
  // next tick. On the shared object rather than a global of our own, so the one switch
  // also turns on `PropagateTagsAndPerformers`' - both plugins draw buttons into these
  // same rows, and "why is this button missing" is rarely a question about only one.
  //
  // `gateLog` fires every time, and its callers are the eligibility probes, which run
  // once per entity and again after each save that invalidates them - seeing the same
  // answer twice is the point, since it says the re-check ran. `gateLogOnce` is for the
  // tick-driven states: `tick()` runs every second and on every DOM mutation burst, so
  // an undeduplicated line there would emit forever on an untouched page. Turning the
  // flag off clears the channels, so switching it back on restates the current position.
  var _gateLast = {};
  function gateLog(line) {
    if (!coop().debugButtons) return;
    console.info('[cpt2s gate] ' + line);
  }
  function gateLogOnce(channel, line) {
    if (!coop().debugButtons) { _gateLast = {}; return; }
    if (_gateLast[channel] === line) return;
    _gateLast[channel] = line;
    console.info('[cpt2s gate] ' + line);
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

  // A fixed, agreed priority for the deterministic-ordering protocol below
  // (`insertOrdered`) - not a capability like `respecters`, but a number both sides
  // have to pick once and keep consistent, the same way the two plugins pin their
  // overlapping CSS byte-identical. Higher sits closer to Save/Delete; this plugin's
  // performer and scene buttons were on the page first, so they keep that position
  // and PropagateTagsAndPerformers (registered at 10) lands to their left instead of
  // racing them for it. Gaps of 10 leave room for a third plugin to slot in without
  // renumbering either existing value.
  coop().order[PLUGIN_ID] = 20;

  // Declared at load, unconditionally: this plugin always performs this one path,
  // via its buttons at minimum, whatever its auto-merge settings say. `declares` is
  // the N-way registry `PropagateTagsAndPerformers` (a later, generalised sibling
  // that implements the same path among thirteen) reads to warn about redundant
  // work - see the repo-root CLAUDE.md. The id matches its own path table exactly,
  // by agreement rather than by any shared code: the two plugins carry no shared
  // module, so the string `'tags:performer>scene'` is the entire contract.
  coop().declares[PLUGIN_ID] = ['tags:performer>scene'];

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
      'component patching, so "Add all Tags from all Performers" will merge and save directly.');
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
      'The number in brackets after a name is that tag\'s or scene\'s id.');
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
  //
  // **A name that matches no tag rejects too** (1.16.3). It used to warn to the console
  // and merge unfiltered, which is the same silent-failure shape the paragraph above
  // rejects, reached by a typo instead of by a network error: the user believes scenes
  // carrying that tag are protected, every one of them is merged into, and nothing here
  // removes a tag afterwards. A miss is still *cached* on the short TTL, so creating the
  // tag starts the filter working without a reload - what changed is that the run stops
  // meanwhile instead of proceeding without the protection it was asked for.
  // `PropagateTagsAndPerformers`' `resolveExclusionTagId` throws on the same condition,
  // with the same message shape; the two were opposite until now.
  function excludeTagMissing(name) {
    return new Error('The exclusion tag "' + name + '" does not exist. Nothing was ' +
      'merged: running without it would write to the scenes it is there to protect. ' +
      'Create the tag, or clear that setting.');
  }

  function resolveExclusionTagId() {
    var name = (settings.excludeSceneWithTagName || '').trim();
    if (!name) { _excludeTagId = null; _excludeTagName = ''; return Promise.resolve(null); }
    if (name === _excludeTagName) {
      var age = Date.now() - _excludeTagAt;
      if (_excludeTagId && age < EXCLUDE_TAG_HIT_TTL_MS) return Promise.resolve(_excludeTagId);
      if (!_excludeTagId && age < EXCLUDE_TAG_MISS_TTL_MS) {
        return Promise.reject(excludeTagMissing(name));
      }
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
          (hadId ? ' (it existed a moment ago — merging is stopping until it is back)' : ''));
        throw excludeTagMissing(name);
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

  // Everything between "here is a scene" and "here is what it needs", extracted at
  // 1.16.0 so the scene button's gate can ask the identical question the click answers.
  // Same rule as `sceneMergePlan` itself (§3, "one filter, one implementation"): a gate
  // that re-derived this would be a second opinion free to drift from the first, and a
  // button that hides while a click would have merged is the drift nobody would notice.
  // Returns `null` for a scene with nothing to do - no performers, no mergeable tags,
  // excluded, or already carrying everything.
  // `who` labels the diagnostic line, because the gate and the click now ask this the
  // same question through this same function - two identical lines with nothing to tell
  // them apart would be worse than none.
  // The reason the most recent `scenePlanFrom` refused, so a *cached* eligibility answer
  // can still be explained. The gate probes once per scene, so without this the debug
  // channel says nothing at all to someone who switches it on while already looking at
  // the page whose button they are asking about - which is the normal way to switch it
  // on. Read straight after the call that set it, never later.
  var _lastPlanReason = null;

  function scenePlanFrom(scene, exclTagId, who) {
    function no(reason) { _lastPlanReason = reason; gateLog(who + ': no - ' + reason); return null; }
    if (!scene) return no('scene not found');
    var performers = scene.performers || [];
    if (!performers.length) return no('no performers on this scene');
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
    if (!perfTagIds.length) {
      return no('the performers here carry no mergeable tags (all excluded, or they have none)');
    }
    var plan = sceneMergePlan(scene, perfTagIds, exclTagId);
    // `sceneMergePlan` folds two refusals into one `null`, so the reason is recovered
    // rather than reported by it: an excluded scene and a complete one are one absent
    // button and two entirely different things to go and fix.
    if (!plan) {
      return no(sceneIsExcluded(scene, exclTagId)
        ? 'scene excluded by a filter (Organized, or the exclusion tag)'
        : 'scene already carries all ' + plural(perfTagIds.length, 'mergeable performer tag'));
    }
    plan.tagById = perfTagById;
    _lastPlanReason = plural(plan.missing.length, 'tag') + ' to add';
    gateLog(who + ': YES - ' + _lastPlanReason);
    return plan;
  }

  // The selection both callers need. One string, for the same reason `scenePlanFrom`
  // is one function: a field present in the click's query and missing from the gate's
  // is a gate answering a different question from the one it reports on.
  function sceneMergeSelection() {
    return 'organized' + sceneLogFields() +
      ' tags { id } performers { tags { ' + tagFields() + ' } }';
  }

  function runMergeTagsIntoScene(sceneId) {
    return resolveExclusionTagId().then(function (exclTagId) {
      return gqlRequest(
        'query FindScene($id: ID!) {' +
        '  findScene(id: $id) { ' + sceneMergeSelection() + ' }' +
        '}',
        { id: sceneId }
      ).then(function (data) {
        var scene = data.findScene;
        var plan = scenePlanFrom(scene, exclTagId, 'merge into scene ' + sceneId);
        if (!plan) return false;
        return updateSceneTags(sceneId, plan.existingIds.concat(plan.missing)).then(function () {
          logMerges(plan.missing.map(function (id) { return plan.tagById[id]; }), scene, sceneId, 'saved');
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
              throw new Error(failed + ' of ' + plural(scenes.length, 'scene') +
                ' could not be updated; see the browser console for details');
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
  // The manifest's setting keys, each mapped to the plugin's own name for it. One
  // table rather than the three hand-kept lists this replaced - the unpacking below,
  // the tooltip list, and the pair of keys `ownSettingGroup` anchored on - because a
  // key missing from any one of them failed silently: no tooltip, or an anchor that a
  // rename could quietly break. `tests/version.test.js` fails if the `.yml` declares a
  // key this does not name.
  //
  // The a1/b2/d1 prefixes on the manifest keys are what orders the settings page:
  // `settings:` is a YAML map, so Stash renders the keys sorted, and without them
  // "Save Tags Immediately" lands five rows below the button toggle it modifies. This
  // is the only place the wire names are read - the internal names on the right are
  // the plugin's own and stay plain. A `false` default means a boolean, `''` a string.
  var SETTING_MAP = {
    a1ShowManualMergeButtons:      ['showManualMergeButtons', false],
    a2SaveTagsImmediately:         ['saveTagsImmediately', false],
    a3AutoMergeOnSceneUpdate:      ['autoMergeOnSceneUpdate', false],
    a4AutoMergeOnPerformerUpdate:  ['autoMergeOnPerformerUpdate', false],
    b1ExcludeSceneWithTagName:     ['excludeSceneWithTagName', ''],
    b2ExcludeSceneOrganized:       ['excludeSceneOrganized', false],
    c1ExcludeTagWithIgnoreAutoTag: ['excludeTagWithIgnoreAutoTag', false],
    c2ExcludeTagWithCustomFieldName: ['excludeTagWithCustomFieldName', ''],
    d1LogMergesToConsole:          ['logMergesToConsole', false],
  };

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
        for (var key in SETTING_MAP) {
          if (!hasOwn(SETTING_MAP, key)) continue;
          var spec = SETTING_MAP[key];
          settings[spec[0]] = typeof spec[1] === 'boolean' ? !!ps[key] : (ps[key] || '');
        }
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
    'width:min(100rem,94vw);max-height:88vh;display:flex;flex-direction:column;}' +
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
    '.cpt2s-spin{color:#a7b6c2;}' +
    '.cpt2s-stale{margin:.5rem 0;padding:.6rem .75rem;border-left:4px solid #ff7373;' +
    'background:rgba(255,115,115,.14);color:#ff7373;font-size:.95rem;line-height:1.45;' +
    'font-weight:600;}' +
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
    '.cpt2s-own-group .sub-heading .cpt2s-p:last-child{margin-bottom:0;}' +
    // A per-setting description shows its first paragraph and hides the rest in a
    // tooltip. The mark is the only thing saying there is one - a hover that opens
    // with no invitation is a hover nobody makes.
    //
    // Built rather than borrowed: a native `title` is the browser's, and its font
    // size, its position and its delay cannot be reached from CSS. It opens
    // *below-right* of the pointer, which is exactly where the arrow sits, so the
    // first line arrives half covered. This one opens above the row in a readable
    // size, and - the part `title` could never do - on keyboard focus as well.
    //
    // These rules are shared with NormalizeParentTags and `tests/style.test.js`
    // compares them with the prefix stripped: keep them byte-identical to that
    // plugin's, or change both together.
    '.cpt2s-tipped{position:relative;}' +
    '.cpt2s-tip{margin-left:.35rem;cursor:pointer;opacity:.65;font-style:normal;' +
    'font-size:1.05em;}' +
    '.cpt2s-tip:hover,.cpt2s-tip:focus{opacity:1;outline:none;}' +
    // pointer-events:none is load-bearing, not tidiness. Opened from the setting's
    // name the box lands over the h3, so a box that took the pointer would fire
    // mouseleave on the name, close, hand the pointer back to the name, and reopen -
    // a flicker loop for as long as it is hovered.
    '.cpt2s-tipbox{display:none;position:absolute;left:0;bottom:calc(100% + .35rem);' +
    'z-index:1500;width:max-content;max-width:100%;padding:.5rem .65rem;' +
    'background:#202b33;color:#d6dee4;border:1px solid #425a6b;border-radius:3px;' +
    'font-size:.92rem;line-height:1.45;white-space:pre-wrap;pointer-events:none;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.55);}' +
    '.cpt2s-tipped.cpt2s-tip-open .cpt2s-tipbox{display:block;}' +
    // The group description sits in the group header, outside the <Collapse>, so it
    // is on screen at whatever size whether the group is expanded or not. Hiding all
    // but the first paragraph is the only thing that shortens it.
    '.cpt2s-desc-collapsed .cpt2s-p:not(:first-child){display:none;}' +
    '.cpt2s-desc-toggle{display:block;margin-top:.25rem;padding:0;border:0;' +
    'background:none;color:#7cc4ff;font-size:.8rem;cursor:pointer;' +
    'text-decoration:underline;}' +
    // ── Colour-coded toggles ────────────────────────────────────────────────
    //
    // Amber for the switches that make this plugin write on its own - the two auto
    // modes, which merge with no dialog and no undo, and the one that turns the
    // scene button from staging tags for review into saving them - and teal for the
    // one that only talks to the console. Every other setting keeps Stash's blue:
    // this marks the ones that are not like the rest, and marking everything would
    // mark nothing.
    //
    // Keyed on the ids SettingsPluginsPanel.tsx builds from the plugin id and the
    // setting key, the same anchor `settingElement` uses, rather than on position
    // or heading text.
    //
    // Two shapes because the switch is Stash's to render: `::before` is the track
    // of a react-bootstrap Form.Switch, which is what it renders today, and
    // `accent-color` covers a plain checkbox if that ever changes. Whichever is not
    // in use costs nothing.
    '#plugin-MergePerformerTagsToScenes-a2SaveTagsImmediately,' +
    '#plugin-MergePerformerTagsToScenes-a3AutoMergeOnSceneUpdate,' +
    '#plugin-MergePerformerTagsToScenes-a4AutoMergeOnPerformerUpdate{accent-color:#ffc107;}' +
    '#plugin-MergePerformerTagsToScenes-a2SaveTagsImmediately:checked~.custom-control-label::before,' +
    '#plugin-MergePerformerTagsToScenes-a3AutoMergeOnSceneUpdate:checked~.custom-control-label::before,' +
    '#plugin-MergePerformerTagsToScenes-a4AutoMergeOnPerformerUpdate:checked~.custom-control-label::before' +
    '{background-color:#ffc107;border-color:#ffc107;}' +
    '#plugin-MergePerformerTagsToScenes-d1LogMergesToConsole{accent-color:#17a2b8;}' +
    '#plugin-MergePerformerTagsToScenes-d1LogMergesToConsole:checked~.custom-control-label::before' +
    '{background-color:#17a2b8;border-color:#17a2b8;}';

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
    var parts = [{ text: plural(ids.length, 'tag') + ' ' + verb + ': ' }];
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

  // The "..." is a promise a *caption* makes - "this click asks before it acts". Inside
  // a sentence it is trailing punctuation in the middle of one, so a scoped run's title
  // takes it back off before naming the entity after it.
  function stripEllipsis(label) {
    return String(label).replace(/\.+$/, '');
  }

  // What a scoped run's title calls the entity the click was made on. Reuses the two
  // label functions the log already writes, so a title and a log line can never
  // disagree about how an entity is named.
  //
  // A query for a title, and it earns it: the dialog used to say "Performer 57", which
  // names the one thing about that performer the user cannot recognise. It is one by-id
  // read, made while a dialog opens on a review about to make several.
  //
  // Falls back to the bare kind and id rather than rejecting - a dialog that cannot
  // name its scope should still open. It is a title.
  function scopeLabel(kind, id) {
    var performer = kind === 'Performer';
    var query = performer
      ? 'query CPT2S_ScopeName($id: ID!) { findPerformer(id: $id) { id name } }'
      : 'query CPT2S_ScopeName($id: ID!) { findScene(id: $id) { id title files { basename } } }';
    return gqlRequest(query, { id: String(id) }).then(function (data) {
      var ent = (data && (performer ? data.findPerformer : data.findScene)) || { id: id };
      return kind + ' ' + (performer ? performerLabel(ent) : sceneLogLabel(ent, id));
    }, function () {
      return kind + ' ' + id;
    });
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

  // `scope` is what the two manual buttons add: `{ performerId }` for the performer
  // page's button (that performer's scenes) or `{ sceneId }` for the scene page's (that
  // one scene). Absent for the library-wide task, which walks every performer.
  function startTaskRun(taskName, scope) {
    if (_activeTask) { _activeTask.focus(); return; }
    _activeTask = new TaskRun(taskName || TASK_MERGE_ALL, scope);
    _activeTask.build();
  }

  function TaskRun(taskName, scope) {
    this.taskName = taskName;
    // Held on the run rather than passed to begin(), because Rescan calls begin()
    // again and a rescan of a scoped run has to stay scoped.
    this.scope = scope || null;
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
    // Scenes the server has accepted a write for this pass, so the dialog can drop
    // exactly those from Apollo's cache when it finishes. The library-wide task barely
    // needs it - it evicts the scene *list* - but a scoped run's user is looking at the
    // one scene it wrote, and a stale `Scene:7` is what they would see.
    this.wroteScenes = {};
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
    // constructor needing a special case. The rendered log survives a Rescan too, so
    // `lines.length` is also what the progress line counts; a separate pass-scoped
    // counter existed only while a rescan emptied the view under it.
    this.lines = [];
    this.pending = [];
    this.state = 'scanning';
  };

  TaskRun.prototype.build = function () {
    taskInjectStyle();
    var self = this;

    this.backdrop = taskEl('div', 'cpt2s-backdrop');
    this.modal = taskEl('div', 'cpt2s-modal');
    this.backdrop.appendChild(this.modal);

    var head = taskEl('div', 'cpt2s-head');
    // A plain block, so a scoped title too long for one line wraps rather than being
    // clipped. Nothing to set: it is the default, and it holds only because no rule in
    // `TASK_CSS` makes this a flex child or sets `white-space`.
    head.appendChild(taskEl('div', 'cpt2s-title', PLUGIN_SHORT_NAME + ' - ' + this.taskName));
    // The stale-script warning gets a box of its own, in the same red the settings
    // banner uses, rather than a sentence appended to `noteEl` among the run's other
    // warnings. Every other note here is about the library or another plugin; this one
    // is about the dialog itself running code the user has already replaced, and it is
    // the only one that disables Proceed. It reads as a different kind of thing because
    // it is one.
    this.staleEl = taskEl('div', 'cpt2s-stale cpt2s-hidden', '');
    head.appendChild(this.staleEl);
    // The merge only ever adds tags. Undo is the single exception in this plugin -
    // it takes back what this dialog itself added - and it is not a restore, so the
    // backup instruction stays and its limits are stated beside it.
    head.appendChild(taskEl('div', 'cpt2s-warn',
      'The merge only ever adds tags. Backing up your database before proceeding is recommended: Undo only ' +
      'reverses what this dialog added, while it stays open, and cannot account for changes made ' +
      'elsewhere in the meantime.'));
    // Same legend as NormalizeParentTags', because the log lines are the same shape:
    // the id sits outside the quotes, and the only other numbers here are counts
    // written as x250. Saying which is which is cheaper than a misread scene id.
    head.appendChild(taskEl('div', 'cpt2s-legend',
      'Reading the log: the number in brackets after a name is that scene\'s, performer\'s or ' +
      'tag\'s id - Scene "My Scene" (345) is the scene with id 345. Counts are written ' +
      'as x250, never in brackets.'));
    this.noteEl = taskEl('div', 'cpt2s-note', '');
    head.appendChild(this.noteEl);
    this.modal.appendChild(head);

    this.progressEl = taskEl('div', 'cpt2s-progress', 'Starting...');
    this.modal.appendChild(this.progressEl);

    this.logEl = taskEl('div', 'cpt2s-log');
    this.modal.appendChild(this.logEl);

    var foot = taskEl('div', 'cpt2s-foot');
    // Amber: the two buttons that write. See "one colour for a plugin wrote this".
    this.proceedBtn = taskButton('Proceed', 'cpt2s-proceed');
    this.cancelBtn  = taskButton('Cancel', 'cpt2s-cancel');
    this.stopBtn    = taskButton('Stop', 'cpt2s-stop cpt2s-hidden');
    this.copyBtn    = taskButton('Copy log', 'cpt2s-copy');
    this.undoBtn    = taskButton('Undo', 'cpt2s-undo cpt2s-hidden');
    [this.proceedBtn, this.undoBtn].forEach(function (b) {
      b.className = b.className.replace('btn-secondary', PLUGIN_BTN_VARIANT);
    });
    this.rescanBtn  = taskButton('Rescan', 'cpt2s-rescan cpt2s-hidden');
    this.closeBtn   = taskButton('Close', 'cpt2s-close cpt2s-hidden');
    this.proceedBtn.disabled = true;
    this.undoBtn.title = 'Remove the tags this dialog added, from the scenes it added them to. ' +
      'Only what this dialog wrote, and only while it stays open.';
    this.rescanBtn.title = 'Review again and replace the plan with whatever is left to merge. ' +
      'The log is kept, and so is what Undo can still reverse.';

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

    wireEscape(this);
    document.body.appendChild(this.backdrop);
    this.begin();
  };

  TaskRun.prototype.focus = function () {
    if (this.modal && this.modal.scrollIntoView) this.modal.scrollIntoView();
  };

  // Empty hides it. `begin()` clears it on every pass for the same reason it clears
  // the note: a rescan after a reload must not go on claiming the script is stale.
  TaskRun.prototype.showStale = function (msg) {
    this.staleEl.textContent = msg || '';
    this.show(this.staleEl, !!msg);
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
    this.spin(scanning || applying || undoing);
  };

  // A cursor cycling under the last log line for as long as work is in flight, and
  // gone the moment it is not. It is a sibling of the lines rather than part of one,
  // so it survives a flush that appends under it - `flush` moves it back to the end -
  // and it carries no `-line` class, since it is not a log line and must not be read
  // back as one. `state` is the single source of truth for whether it runs: every
  // path in and out of a write goes through setState.
  TaskRun.prototype.spin = function (on) {
    if (!on) {
      if (this.spinTimer) clearInterval(this.spinTimer);
      this.spinTimer = null;
      if (this.spinEl && this.spinEl.parentNode) this.spinEl.parentNode.removeChild(this.spinEl);
      this.spinEl = null;
      return;
    }
    if (!this.spinEl) {
      this.spinEl = taskEl('div', 'cpt2s-spin', SPIN_FRAMES[0]);
      var self = this, i = 0;
      this.spinTimer = setInterval(function () {
        self.spinEl.textContent = SPIN_FRAMES[++i % SPIN_FRAMES.length];
      }, SPIN_MS);
    }
    this.logEl.appendChild(this.spinEl);
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
    // Out of the way while the lines land, so the cursor is neither counted against
    // the render cap nor left in the middle of the log.
    if (this.spinEl && this.spinEl.parentNode) this.logEl.removeChild(this.spinEl);
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
    if (this.spinEl) this.logEl.appendChild(this.spinEl);
    if (typeof this.logEl.scrollHeight === 'number') this.logEl.scrollTop = this.logEl.scrollHeight;
    this.renderProgress();
  };

  TaskRun.prototype.renderProgress = function () {
    var summary;
    if (this.state === 'scanning') {
      summary = 'Reviewing. Performers ' + this.performersSeen + ' / ' + this.performersTotal +
        ', ' + plural(this.plan.length, 'scene') + ' to update';
    } else if (this.state === 'ready') {
      summary = 'Review complete. ' + plural(this.plan.length, 'scene') + ' to update, ' +
        plural(this.tagsPlanned, 'tag assignment') + ' to add. Nothing has been written.';
    } else if (this.state === 'applying') {
      summary = 'Merging. ' + this.scenesUpdated + ' of ' + plural(this.plan.length, 'scene') + ' updated';
    } else if (this.state === 'undoing') {
      summary = 'Undoing. ' + this.undone + ' of ' + plural(this.undoTotal, 'scene') + ' reversed';
    } else {
      summary = 'Finished. ' + plural(this.scenesUpdated, 'scene') + ' updated, ' +
        plural(this.tagsAdded, 'tag assignment') + ' added' +
        (this.undone ? ', ' + plural(this.undone, 'scene') + ' reversed by Undo' : '') +
        (this.stopped ? ' (stopped early; what was written stays written)' : '');
    }
    if (this.errors) summary += ', ' + plural(this.errors, 'error');
    if (this.lines.length > TASK_LOG_CAP) {
      summary += ' - showing the last ' + TASK_LOG_CAP + ' of ' + this.lines.length + ' lines';
    }
    this.progressEl.textContent = summary;
  };

  // ── Phase 1: review ───────────────────────────────────────────────────────

  TaskRun.prototype.begin = function () {
    var self = this;
    this.setState('scanning');
    this.noteEl.textContent = '';
    this.showStale('');
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
    this.checkDeclaredOverlap();
    // Not chained ahead of the walk: one small query against a pass that reads every
    // performer in the library. It lands long before Proceed is reachable, and
    // setState is re-applied when it does.
    this.checkVersion();

    resolveExclusionTagId().then(function (exclTagId) {
      return self.scope ? self.scanScope(exclTagId) : self.walk(1, exclTagId);
    }).then(function () {
      self.finishScan();
    }, function (e) {
      self.log('ERROR', 'Review failed: ' + (e && e.message ? e.message : e));
      self.errors++;
      self.finishScan();
    });
  };

  // NormalizeParentTags' automatic modes, as its settings actually spell them.
  // Since its 4.0.0 that is one string carrying a mode per entity type
  // ("SCENES=PRUNE, IMAGES=ROLLUP"), so both directions can be on at once for
  // different types; before it, two booleans covering every type it was enabled for,
  // where both at once was that plugin's own documented no-op.
  //
  // Read by name rather than through its `coop().api`, like the rest of this check:
  // the API answers for one entity type at a time and needs the plugin to be running
  // in this page, and what this warning is about is a setting that may be set while
  // the plugin is disabled. Its 4.0.0 renamed every key it had, which is why the old
  // pair is still read - an install that has not been touched since 3.2.0 still
  // carries them, and this check has to keep working against it.
  function siblingAutoModes(ps) {
    var modes = String((ps && ps.a1AutoModes) || '');
    if (modes) {
      return {
        prune: /=\s*prune\b/i.test(modes),
        rollup: /=\s*roll[\s_-]*up\b/i.test(modes),
      };
    }
    var prune = !!(ps && ps.a8AutoPruneOnUpdate), rollup = !!(ps && ps.a9AutoRollUpOnUpdate);
    if (prune === rollup) return { prune: false, rollup: false };
    return { prune: prune, rollup: rollup };
  }

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

    var auto = siblingAutoModes(ps);
    if (!auto.prune && !auto.rollup) return;

    // Both, where its settings set one type to prune and another to roll up - a state
    // its pre-4.0.0 pair of booleans could not express and this used to read as "no
    // mode is running".
    var mode = auto.prune && auto.rollup
      ? 'automatic Prune and Roll Up'
      : (auto.prune ? 'automatic Prune' : 'automatic Roll Up');
    var effect = auto.prune && auto.rollup
      ? 'it will rewrite the tags this merge adds - removing the ones a more specific tag ' +
        'on the same scene implies, or adding every ancestor, depending on the entity type'
      : (auto.prune
        ? 'it will remove the parent tags this merge adds, wherever a more specific tag on the ' +
          'same scene already implies them'
        : 'it will add every ancestor of the tags this merge adds');

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

  // The N-way counterpart to `checkSibling` above: that one is specific to
  // NormalizeParentTags because its collision (prune/roll-up along the tag
  // hierarchy) is a different kind from this one and needs its own wording. This
  // one is generic - any plugin, present or future, that declares
  // `'tags:performer>scene'` in `coop().declares` is doing the exact same path this
  // plugin does, which is redundant work and doubled log lines, never wrong data,
  // since both plugins only ever add. `PropagateTagsAndPerformers` is the first
  // such plugin; nothing here names it, so a second one needs no edit here either.
  TaskRun.prototype.checkDeclaredOverlap = function () {
    var declares = coop().declares, others = [];
    for (var id in declares) {
      if (!hasOwn(declares, id) || id === PLUGIN_ID) continue;
      if ((declares[id] || []).indexOf('tags:performer>scene') !== -1) others.push(id);
    }
    if (!others.length) return;
    this.log('INFO', others.join(', ') + ' also merges performer tags onto scenes ' +
      '(declares the same path). Running both is redundant work and doubled log lines, ' +
      'never wrong data - both only ever add.');
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

  // ── Phase 1, scoped: what a manual button reviews ─────────────────────────
  //
  // The same review pass, over one performer or one scene instead of the library. It
  // goes through `reviewPerformer` / `sceneMergePlan` / `planScene` like the walk does,
  // so the plan the dialog lists is the plan the walk would have listed - §3's "one
  // filter, one implementation" extended to the review itself. What it replaces is a
  // click that wrote with nothing in front of the user.
  TaskRun.prototype.scanScope = function (exclTagId) {
    return this.scope.performerId
      ? this.scanPerformer(this.scope.performerId, exclTagId)
      : this.scanScene(this.scope.sceneId, exclTagId);
  };

  // One performer's scenes. `reviewPerformer` does the whole of it once the performer's
  // own mergeable tags are in hand, which is the same shape the walk uses per page.
  TaskRun.prototype.scanPerformer = function (performerId, exclTagId) {
    var self = this;
    this.performersTotal = 1;
    return gqlRequest(
      'query CPT2S_TaskPerformer($id: ID!) {' +
      '  findPerformer(id: $id) { id name tags { ' + taskTagFields() + ' } }' +
      '}',
      { id: String(performerId) }
    ).then(function (data) {
      var p = data && data.findPerformer;
      self.performersSeen = 1;
      if (!p) {
        self.log('ERROR', 'Performer ' + performerId + ' was not found.');
        self.errors++;
        return null;
      }
      var perfTags = (p.tags || []).filter(function (t) {
        return tagIsMergeable(t, exclTagId, (settings.excludeTagWithCustomFieldName || '').trim());
      });
      if (!perfTags.length) {
        self.log('INFO', 'Performer ' + performerLabel(p) +
          ' carries no mergeable tags - they have none, or every one is excluded.');
        self.renderProgress();
        return null;
      }
      return self.reviewPerformer(p, perfTags, exclTagId);
    });
  };

  // One scene, from the other end: its performers are the sources, and each contributes
  // to the same single plan entry - which is exactly what `planScene` is for, and why
  // this does not need a plan shape of its own.
  TaskRun.prototype.scanScene = function (sceneId, exclTagId) {
    var self = this;
    return gqlRequest(
      'query CPT2S_TaskScene($id: ID!) {' +
      '  findScene(id: $id) {' +
      '    id organized title files { basename } tags { id }' +
      '    performers { id name tags { ' + taskTagFields() + ' } }' +
      '  }' +
      '}',
      { id: String(sceneId) }
    ).then(function (data) {
      var scene = data && data.findScene;
      if (!scene) {
        self.log('ERROR', 'Scene ' + sceneId + ' was not found.');
        self.errors++;
        return;
      }
      // Said out loud rather than left as an empty plan: an excluded scene and a scene
      // that already has everything are one empty dialog and two different things to go
      // and fix. `sceneMergePlan` folds both into `null`, so this asks first.
      if (sceneIsExcluded(scene, exclTagId)) {
        self.log('INFO', 'Scene ' + sceneLogLabel(scene, scene.id) +
          ' is excluded by a filter (Organized, or the exclusion tag). Nothing to merge.');
        self.renderProgress();
        return;
      }
      var performers = scene.performers || [];
      self.performersTotal = performers.length;
      var cfName = (settings.excludeTagWithCustomFieldName || '').trim();
      performers.forEach(function (p) {
        self.performersSeen++;
        var perfTags = (p.tags || []).filter(function (t) {
          return tagIsMergeable(t, exclTagId, cfName);
        });
        if (!perfTags.length) return;
        var perfTagById = {};
        perfTags.forEach(function (t) { perfTagById[t.id] = t; });
        var need = sceneMergePlan(scene, Object.keys(perfTagById), exclTagId);
        if (!need) return;
        self.planScene(scene, need, perfTagById, p);
      });
      self.renderProgress();
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
        sceneLogLabel(scene, scene.id) + ' - ' + plural(added.length, 'tag') + ': ' +
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
      var msg = '\u26a0 This page is running ' + PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION +
        ', but ' + installed + ' is installed. Reload the page (F5) and run the task again; ' +
        'if this warning comes back, hard-refresh with Ctrl+Shift+R (\u2318+Shift+R on a Mac). ' +
        'Proceed stays disabled until the script matches, since the plan would be computed by ' +
        'the older code.';
      // Into the log as well as the box: Copy log is how a user reports this, and a
      // warning that only exists as chrome is one they cannot paste.
      self.log('WARN', msg);
      self.showStale(msg);
      self.setState(self.state);
    });
  };

  TaskRun.prototype.finishScan = function () {
    this.flush();
    if (this.cancelled) return;
    if (!this.plan.length) {
      this.log('INFO', 'Nothing to merge.');
    } else {
      this.log('INFO', 'Review complete: ' + plural(this.tagsPlanned, 'tag assignment') +
        ' across ' + plural(this.plan.length, 'scene') +
        '. Nothing has been written. Press Proceed to apply.');
      this.logTagSummary(this.plannedTagCounts, 'to add');
    }
    this.setState('ready');
    this.flush();
  };

  // ── Phase 2: apply ────────────────────────────────────────────────────────

  // Apply and Undo walk their units - plan entries one side, undo batches the other -
  // identically, and the reasoning holds for both, which is why it is written once.
  //
  // The lease covers the writing phase only. Phase 1 writes nothing, so there is
  // nothing to suppress, and holding one across a library-wide review would stand a
  // reactive plugin down for the half of the run that cannot disturb it. It is renewed
  // per unit and released in every outcome - success, failure, Stop - so a reactive
  // plugin is never left standing down.
  //
  // One guard around the whole thing rather than one per unit: every scene written
  // would otherwise look to our own fetch wrapper like a user edit and re-enter the
  // merge - and `bulkSceneUpdate`, which the undo issues, is precisely what auto-merge
  // on scene update watches for, so without this an undo would merge the tags straight
  // back in. That is internal re-entrancy; the lease is about other plugins, and the
  // two are not substitutes.
  //
  // Progress is rendered by `applyEntry`/`undoBatch` themselves, not from here.
  TaskRun.prototype.runUnits = function (units, leaseLabel, step, verb, finish) {
    var self = this;
    var lease = acquireLease(leaseLabel);
    var i = 0;

    guarded(function () {
      function next() {
        if (self.stopped || i >= units.length) return Promise.resolve();
        lease.renew();
        return step(units[i++]).then(next);
      }
      return next();
    }).then(function () {
      lease.release();
      finish.call(self);
    }, function (e) {
      lease.release();
      self.log('ERROR', verb + ' aborted: ' + (e && e.message ? e.message : e));
      self.errors++;
      finish.call(self);
    });
  };

  TaskRun.prototype.proceed = function () {
    if (this.state !== 'ready' || !this.plan.length) return;
    var self = this;
    this.setState('applying');
    this.scenesUpdated = 0;
    this.tagsAdded = 0;
    this.appliedTagCounts = {};
    // Held by the state machine today - a stopped run lands in `done` and only a
    // rescan returns it to `ready` - but stated here anyway, the way `undo` states it.
    this.stopped = false;
    this.log('INFO', 'Applying ' + plural(this.plan.length, 'scene change') + ' - ' + new Date().toISOString());

    this.runUnits(this.plan.slice(), this.taskName,
      function (entry) { return self.applyEntry(entry); },
      'Apply', TaskRun.prototype.finishApply);
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
      self.wroteScenes[entry.scene.id] = true;
      self.scenesUpdated++;
      self.tagsAdded += entry.tagIds.length;
      entry.tagIds.forEach(function (id) {
        self.appliedTagCounts[id] = (hasOwn(self.appliedTagCounts, id) ? self.appliedTagCounts[id] : 0) + 1;
      });
      logMerges(entry.tags, entry.scene, entry.scene.id, 'saved');
      self.log('MERGE', 'Scene ' + sceneLogLabel(entry.scene, entry.scene.id) + ' - ' +
        plural(entry.tagIds.length, 'tag') + ' added - from Performer ' + entry.from.join(', '));
      self.renderProgress();
    }, function (e) {
      self.log('ERROR', 'Scene ' + sceneLogLabel(entry.scene, entry.scene.id) + ' update failed: ' +
        (e && e.message ? e.message : e));
      self.errors++;
    });
  };

  TaskRun.prototype.finishApply = function () {
    this.log('INFO', 'Finished. ' + plural(this.scenesUpdated, 'scene') + ' updated, ' +
      plural(this.tagsAdded, 'tag assignment') + ' added' +
      (this.errors ? ', ' + plural(this.errors, 'error') : '') +
      (this.stopped ? ' (stopped early; what was written stays written)' : '') +
      '. Press Rescan to review what is left.');
    // Counted from what was written, not from the plan: a failed scene, or a Stop,
    // must not be summarised as though it had landed.
    this.logTagSummary(this.appliedTagCounts, 'added');
    this.setState('done');
    this.flush();

    this.evictWritten();
  };

  // Evict the cached scene list, and every scene this pass wrote, so open views pick
  // the new tags up - but never through refreshSceneList, whose fallback is
  // location.reload(). Reloading here would tear down this dialog, and the log with it,
  // at the moment the user wants to read or copy it. Without Apollo the worst case is a
  // stale view until the user navigates, which is the right way round.
  //
  // The named scenes matter for the manual buttons' scoped runs: their user is looking
  // at the very scene the dialog just wrote, which is read from `Scene:<id>` rather
  // than from the list.
  TaskRun.prototype.evictWritten = function () {
    var client = window.__APOLLO_CLIENT__;
    if (!client || !client.cache || !client.cache.evict) return;
    client.cache.evict({ id: 'ROOT_QUERY', fieldName: 'findScenes' });
    for (var id in this.wroteScenes) {
      if (hasOwn(this.wroteScenes, id)) client.cache.evict({ id: 'Scene:' + id });
    }
    this.wroteScenes = {};
    if (client.cache.gc) client.cache.gc();
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
      this.undoBtn.textContent = 'Undo ' + plural(this.undoable.length, 'scene') + '?';
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
    this.log('INFO', 'Undoing the merge on ' + plural(this.undoTotal, 'scene') + ' - ' +
      new Date().toISOString());

    // Newest first, the order that composes: a rescan-and-apply cycle can write to
    // one scene twice, and taking the second write back before the first is the only
    // sequence that lands where the run started. An undo is a bulk write like any
    // other, so it announces itself the same way - see runUnits.
    this.runUnits(buildUndoBatches(this.undoable.slice().reverse()), this.taskName + ' (undo)',
      function (batch) { return self.undoBatch(batch); },
      'Undo', TaskRun.prototype.finishUndo);
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
        self.wroteScenes[entry.scene.id] = true;
        entry.tagIds.forEach(function (id) {
          self.undoneTagCounts[id] = (hasOwn(self.undoneTagCounts, id) ? self.undoneTagCounts[id] : 0) + 1;
        });
        self.undone++;
        self.log('MERGE', 'Undo - Scene ' + sceneLogLabel(entry.scene, entry.scene.id) + ' - ' +
          plural(entry.tagIds.length, 'tag') + ' removed again');
      });
      self.renderProgress();
    }, function (e) {
      self.log('ERROR', 'Undo failed for ' + plural(ids.length, 'scene') + ' (' +
        ids.slice(0, 5).join(', ') + (ids.length > 5 ? ', ...' : '') + '): ' +
        (e && e.message ? e.message : e));
      self.errors++;
      self.undoFailed += batch.entries.length;
    });
  };

  TaskRun.prototype.finishUndo = function () {
    this.log('INFO', 'Undo finished. ' + plural(this.undone, 'scene') + ' reversed' +
      (this.undoFailed ? ', ' + this.undoFailed + ' could not be' : '') +
      (this.stopped ? ' (stopped early; what was reversed stays reversed)' : '') +
      (this.undoable.length
        ? '. ' + plural(this.undoable.length, 'scene') + ' still carry what this run added.'
        : '. Everything this dialog added has been taken back.'));
    this.logTagSummary(this.undoneTagCounts, 'removed again');
    this.setState('done');
    this.flush();

    // Same reasoning as finishApply, through the same function.
    this.evictWritten();
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
  //
  // The rendered log is kept rather than emptied: the "--- Rescan ---" marker
  // separates the passes, and a log that stays until the dialog closes is the whole
  // session on screen - the same thing Copy log has always handed over.
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

  // ── Escape ────────────────────────────────────────────────────────────────
  //
  // Escape acts through whichever of Cancel/Close the footer is actually showing,
  // never by calling `close()` itself. The footer is the dialog's own statement of
  // what it will let you do right now, so routing the key through it means the key
  // can never reach a button that is hidden or disabled - and in particular does
  // nothing mid-write, where both are hidden and Stop is the only way out. A key
  // that quietly abandoned a run in flight would be worse than one that does nothing.
  function escapeButton(run) {
    var order = [run.closeBtn, run.cancelBtn];
    for (var i = 0; i < order.length; i++) {
      var b = order[i];
      if (b && !b.disabled && !hasClass(b, 'cpt2s-hidden')) return b;
    }
    return null;
  }

  // On `document`, not on the modal: the modal is not focusable, so a click into the
  // log would otherwise put the key out of reach. Removed in `close()` - a dialog that
  // has gone away must not still be answering for the page.
  function wireEscape(run) {
    run._onEscape = function (ev) {
      if (!ev || (ev.key !== 'Escape' && ev.keyCode !== 27)) return;
      var b = escapeButton(run);
      if (!b) return;
      if (ev.preventDefault) ev.preventDefault();
      b.click();
    };
    document.addEventListener('keydown', run._onEscape);
  }

  function unwireEscape(run) {
    if (run._onEscape && document.removeEventListener) {
      document.removeEventListener('keydown', run._onEscape);
    }
    run._onEscape = null;
  }

  TaskRun.prototype.close = function () {
    unwireEscape(this);
    this.disarmUndo();
    this.spin(false);
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    if (_activeTask === this) _activeTask = null;
    // Whatever this dialog wrote may have made a button on the page behind it eligible
    // or not, and the buttons were unreachable while it was open - so this is the first
    // moment a re-check is worth anything. The fetch wrapper's own invalidation cannot
    // do it: every write in here runs inside `guarded()`, which returns before those
    // branches. Clearing only arms the probe; the tick is what runs it.
    sceneCheck = null;
    performerCheck = null;
    tick();
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
    // Answer from the button's *own* SettingGroup and stop there. Testing every
    // ancestor for an h3 - which is what this did until 1.17.0 - climbs past the group
    // on a miss and into the panel holding every plugin's group, where
    // `querySelector('h3')` answers with whichever plugin is listed first. A plugin
    // declaring a task by the same name as ours was therefore hijacked whenever we
    // happened to be above it, which is the one thing the heading check exists to
    // stop. Found by the tasks-page check in `tests/placement.test.js`.
    //
    // A group's first h3 is its heading: PluginTasks renders it in the header, above
    // the per-task `Setting` rows that each carry an h3 of their own - which is also
    // why the walk cannot simply stop at the nearest ancestor containing any h3.
    //
    // The any-ancestor walk survives as a fallback for a Stash that does not put
    // `setting-group` on that box. It carries the bug above, and that is deliberate:
    // it is the behaviour every release before this one shipped, so it can be no worse
    // than what it replaces.
    var node = btn;
    var fallback = null;
    for (var depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      var heading = node.querySelector ? node.querySelector('h3') : null;
      var ours = !!heading && (heading.textContent || '').trim() === PLUGIN_NAME;
      if (hasClass(node, 'setting-group')) return ours ? label : null;
      if (ours) fallback = label;
    }
    return fallback;
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

      // The same two branches for `sceneCheck`, added at 1.16.0 alongside the scene
      // button's eligibility gate. Until then this cache had no invalidation at all,
      // which was survivable while it only asked "has this scene any performers" - the
      // one edit that could change that answer was rare. It is not survivable now that
      // the gate reads the scene's own tags: adding a performer in the Edit tab and
      // pressing Save has to make the button appear, and merging its tags has to make it
      // go away, neither with a navigation.
      //
      // Unconditional on `autoMergeOnSceneUpdate`, for the reason §3 already states
      // about the performer pair: this decides whether a button appears, and that is not
      // something a user should have to enable auto-merge to get.
      // `tick()` straight after, rather than leaving it to the 1s interval: clearing the
      // slot only *arms* a re-probe on the next tick, and the tick after that is what
      // draws the result - up to two seconds of a stale button either way. Calling it
      // here spends the first of those immediately. `tick()` is idempotent by
      // construction (it is what the interval and the observer both call), so an extra
      // one costs a probe at most.
      if (/\bsceneUpdate\b/.test(q)) {
        var savedSceneId = vars.input && vars.input.id;
        if (savedSceneId != null) {
          mutationSucceeded(p).then(function (ok) {
            if (ok && sceneCheck && sceneCheck.id === String(savedSceneId)) { sceneCheck = null; tick(); }
          });
        }
      }
      if (/\bbulkSceneUpdate\b/.test(q)) {
        var savedSceneIds = vars.input && vars.input.ids;
        if (savedSceneIds && savedSceneIds.length) {
          mutationSucceeded(p).then(function (ok) {
            if (!ok || !sceneCheck) return;
            if (savedSceneIds.map(String).indexOf(sceneCheck.id) !== -1) { sceneCheck = null; tick(); }
          });
        }
      }
    } catch (e) {}
    return p;
  };

  // ── Performer page: "Add Tags to all Scenes" ─────────────────────────────

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
        var hasTags   = !!(data.findPerformer && (data.findPerformer.tags || []).length);
        var hasScenes = !!(data.findScenes && data.findScenes.count > 0);
        // Both halves named, not just the verdict: "this performer has no tags" and
        // "this performer is in no scenes" are one absent button and two different
        // things to go and fix.
        var why = hasTags && hasScenes ? 'has tags and scenes'
          : !hasTags && !hasScenes ? 'no tags of their own, and in no scenes'
          : !hasTags ? 'no tags of their own to copy'
          : 'in no scenes to copy them to';
        if (performerCheck && performerCheck.id === performerId) {
          performerCheck.status = (hasTags && hasScenes) ? 'yes' : 'no';
          performerCheck.why = why;
        }
      })
      .catch(function (e) {
        var failed = 'the check itself failed: ' + (e && e.message ? e.message : e);
        if (performerCheck && performerCheck.id === performerId) {
          performerCheck.status = 'no'; performerCheck.why = failed;
        }
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

  // A plain recursive walk over `childNodes`/`tagName`, matching on the action's own
  // text - the same technique this file's dedup checks already rely on, and
  // deliberately not `querySelectorAll`, which the shared test harness's fake DOM
  // nodes do not implement (only `querySelector`). Text is the only reliable way to
  // find Save, which carries no distinguishing class, and - since 1.15.1 - the only
  // reliable way to find Delete either, on the rows where it carries no `.delete`.
  //
  // Matches `<a>` as well as `<button>`, and trims before comparing. Stash styles
  // some row actions as links rather than buttons, and neither the tag nor the
  // surrounding whitespace is something this plugin should have to be right about:
  // the cost of accepting both is nil, and the cost of guessing wrong is a button
  // silently landing in the wrong place, which is exactly the bug 1.15.1 fixes.
  function findActionByLabel(root, label) {
    var kids = root.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if ((k.tagName === 'BUTTON' || k.tagName === 'A') &&
          (k.textContent || '').trim() === label) return k;
      var found = findActionByLabel(k, label);
      if (found) return found;
    }
    return null;
  }

  // Shared by both this plugin's buttons since 1.14.0. The design rule, stated
  // plainly: a new button is inserted before whichever of the row's buttons is
  // "important" - one that must stay the last thing in the row, because moving it
  // would be a bigger surprise than where our own button lands - and appended after
  // everything otherwise. Delete and Save are the two buttons this plugin has ever
  // found itself sharing a row with that qualify.
  //
  // Three searches, in order: Delete by its `.delete` class, Delete by its text,
  // then Save by its text. Either may be nested inside a wrapper element, so the
  // walk-up to the container's own direct child happens after the search, not baked
  // into any of them.
  //
  // 1.15.1: the middle search is new, and it is the whole fix. Every version up to
  // 1.15.0 looked for Delete *only* by `.delete`, on the strength of a note in the
  // repo CLAUDE.md that said Stash gives Delete that class "throughout". It does
  // not. It carries it on the performer detail navbar - which is where the claim was
  // actually confirmed, and where this plugin's own container search still relies on
  // it - but the Scene edit row renders Delete as `btn btn-danger` with no `.delete`
  // at all. On that row the class search found nothing, the Save fallback caught it,
  // and every button landed *before* Save instead of between Save and Delete.
  //
  // That one over-generalisation is worth naming, because it cost four versions of
  // anchor churn (1.12.0-1.15.0) that all moved the anchor between Save and Delete
  // without ever fixing the reason Delete could not be found. A class confirmed on
  // one page is evidence about that page. Falling back to text costs one walk and
  // removes the need to be right about which pages style Delete which way.
  function insertBeforeImportantAction(container, button) {
    var node = container.querySelector('button.delete')
            || findActionByLabel(container, 'Delete')
            || findActionByLabel(container, 'Save');
    while (node && node.parentNode !== container) node = node.parentNode;
    ensureRowSpacing(container);
    insertOrdered(container, button, node);
    applyButtonSpacing(container, button);
  }

  // 1.15.3, mirroring `PropagateTagsAndPerformers` 0.12.3 - the two carry no shared
  // module, so this is a second copy of one design rather than one implementation.
  //
  // Measured on a live Stash rather than chosen: `.edit-buttons` computes to
  // `display: block`, and its own buttons to `margin: 0 10px 0 0` - a *right* margin
  // only, at a value no utility class here can name (that Stash's root is 14px, so
  // `mx-1` is 3.5px and `mx-2` is 7px). A fixed class therefore produced a different
  // gap on every boundary in the row. Copying the margins off a button Stash put
  // there - one with no `_coopOwner`, so neither plugin's own buttons can be mistaken
  // for Stash's - makes every boundary match, and self-calibrates to a container this
  // has never been measured against.
  //
  // The bottom margin is the wrapped-row spacing, and only where `row-gap` cannot do
  // it: a block container has no flex line whose cross-size a margin could inflate,
  // which is what made vertical margin a regression in a flex row (see
  // `PropagateTagsAndPerformers` 0.9.2 - this plugin's single buttons never hit it).
  var ROW_GAP = '.25rem';

  function computedStyleOf(node) {
    var w = (typeof window !== 'undefined') ? window : null;
    if (!w || typeof w.getComputedStyle !== 'function' || !node) return null;
    try { return w.getComputedStyle(node) || null; } catch (e) { return null; }
  }

  // Wrapped-row spacing, by whichever mechanism the container honours. `row-gap` is a
  // flex/grid property, so it is inert on `.edit-buttons` (`display: block`, measured
  // live) while working on the flex `.details-edit` - same call, opposite result,
  // decided entirely by the container. So the container is asked which it is, and the
  // block case gets a bottom margin on our own button instead (`applyButtonSpacing`).
  //
  // Unknown display - no `getComputedStyle` at all, which is the test harness - keeps
  // the flex treatment: an inert `row-gap` is the one outcome that cannot make a row
  // worse.
  //
  // Byte-for-byte the same function as `PropagateTagsAndPerformers`' own, bar the
  // marker property's prefix. Until 1.15.9 this plugin had no equivalent at all and
  // set only the block-row margin, so a flex row of its buttons wrapped flush while
  // the sibling's spaced correctly from identical-looking code.
  function ensureRowSpacing(container) {
    if (!container) return;
    // A real element's `.style` is always a live CSSStyleDeclaration, never absent -
    // this guard only ever fires in the test harness, whose fake elements have no
    // `.style` until something sets one.
    if (!container.style) container.style = {};
    var cs = computedStyleOf(container);
    var display = (cs && cs.display) || '';
    var flexish = !display || display.indexOf('flex') !== -1 || display.indexOf('grid') !== -1;
    container._cpt2sBlockRow = !flexish;
    container.style.rowGap = flexish ? ROW_GAP : '';
  }

  // 1.15.4, mirroring `PropagateTagsAndPerformers` 0.12.4 - and the release that made
  // 1.15.3's measurement actually reach the page. **Bootstrap's spacing utilities are
  // `!important`**, so the `mx-2` these buttons carried at build time beat the inline
  // `margin-left`/`margin-right` copied from the row, and every horizontal gap stayed
  // exactly what it had been - while `margin-bottom`, which no class sets, took effect
  // and visibly fixed wrapped-row spacing in that same release. One `cssText`
  // assignment working in one axis and not the other is the shape of a specificity
  // problem, not a wrong value.
  //
  // So `SPACING_CLASS` is off the button at build time and added back here, only on the
  // branch that has nothing to measure. Three cases, in order: a container that spaces
  // its own children with `column-gap` (ours gets it too, so any margin would be added
  // to Stash's spacing rather than match it); a donor to copy from - any element with
  // the `btn` class and no `_coopOwner`, `<a>` included, since Stash styles some row
  // actions as links; or neither, in which case the class is what shipped.
  function nonZeroLength(value) {
    return !!value && value !== 'normal' && parseFloat(value) > 0;
  }

  function hasClass(node, name) {
    return (' ' + String((node && node.className) || '') + ' ').indexOf(' ' + name + ' ') !== -1;
  }

  function pxOf(value) {
    var n = parseFloat(value);
    return n > 0 ? n : 0;
  }

  // 1.15.4 copied the donor's margins onto our button wholesale, which gave it
  // `margin-left: 0`. That is correct on a row where every button carries a right
  // margin - Scene's `.edit-buttons`, where it is also what keeps a wrapped second row
  // flush with the first - and wrong on a row where they do not. Stash's own detail
  // navbars are inconsistently spaced (`Auto tag...` and `Merge` touch each other on
  // Performer), so landing after one of the marginless ones left our button touching
  // it, live-reported at 1.15.4.
  //
  // The gap between two inline siblings is the first's right margin plus the second's
  // left margin, so 1.15.5 took the row's own step from the donor and filled whatever
  // each *actual neighbour* was not already contributing. 1.15.6 measured that gap with
  // `getBoundingClientRect` rather than deriving it, and 1.15.7 takes the measurement
  // back out: a distance is a fact about one instant, and the row it was measured in is
  // not the row that settles. Live, it put this plugin's button flush against Delete on
  // the performer navbar - a gap that existed at insertion time and had closed by the
  // time the page finished laying out.
  //
  // What survives is the structural half of that diagnosis: **the DOM sibling beside our
  // button is not always the action the user sees**. React wraps some row actions (a
  // file input beside its button, a dropdown beside its toggle), and a wrapper carries no
  // margin of its own while the action inside it does - so reading the sibling reports
  // "contributes nothing" for a neighbour that plainly contributes a gap. `neighbourGap`
  // resolves through the wrapper to the action facing us. No layout is consulted, so the
  // answer is the same whenever it is asked.
  //
  // 1.15.8 takes the same idea one step further, because the same mistake has a second
  // form: an element holding *no* action at all. Reading its (absent) margin as the whole
  // gap is what left Group's detail row doubled for three releases after the wrapper fix
  // sorted its edit row out. **A zero read off something this code cannot identify as an
  // action is not evidence of a zero gap** - so `neighbourGap` walks past it instead.
  //
  // Both directions are walked from one `childNodes` snapshot: a real `NodeList` is live.
  function borderingAction(node, fromEnd) {
    if (!node) return null;
    if (hasClass(node, 'btn')) return node;
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[fromEnd ? kids.length - 1 - i : i];
      if (!k || !k.tagName) continue;
      var found = borderingAction(k, fromEnd);
      if (found) return found;
    }
    return null;
  }

  // What already separates our button from the nearest *action* on one side. Three
  // answers, treated differently by `sideMargin`:
  //   { gap: n }      an action n px away - top our margin up to the row's step.
  //   { gap: null }   elements are there but nothing recognisable - add nothing, since
  //                   we have no idea what space they take and a wrong guess doubles it.
  //   null            nothing at all on this side - fall back to Stash's own margin.
  //
  // Skipped elements contribute both their margins and are assumed to have no width;
  // width is the one thing here that cannot be read without consulting a layout that has
  // not settled yet, which is exactly what 1.15.6 got wrong.
  function neighbourGap(container, button, forward) {
    var kids = container.childNodes || [], idx = -1, i;
    for (i = 0; i < kids.length; i++) { if (kids[i] === button) { idx = i; break; } }
    if (idx === -1) return null;
    var near = forward ? 'marginLeft' : 'marginRight';
    var far = forward ? 'marginRight' : 'marginLeft';
    var dir = forward ? 1 : -1;
    var total = 0, seen = false;
    for (i = idx + dir; i >= 0 && i < kids.length; i += dir) {
      var k = kids[i];
      if (!k || !k.tagName) continue;
      seen = true;
      var cs = computedStyleOf(k);
      total += pxOf(cs && cs[near]);
      var action = borderingAction(k, !forward);
      if (action) {
        // A wrapper with a margin *and* an inset button is rare, but summing the two is
        // closer to the truth than picking one, and both are usually zero.
        if (action !== k) total += pxOf((computedStyleOf(action) || {})[near]);
        return { gap: total };
      }
      total += pxOf(cs && cs[far]);
    }
    return seen ? { gap: null } : null;
  }

  function sideMargin(info, step, own) {
    if (!info) return pxOf(own);
    if (info.gap === null) return 0;
    return Math.max(0, step - info.gap);
  }

  function fillNeighbourGaps(container, button, m) {
    var step = Math.max(pxOf(m.left), pxOf(m.right));
    // Nothing on a side means our button is at that end of the row, where Stash's own
    // convention is the whole answer: `margin: 0 10px 0 0`, so no left margin to push it
    // off the edge its first button sits on, and a right margin to trail the last.
    return [
      'margin-left:' + sideMargin(neighbourGap(container, button, false), step, m.left) + 'px',
      'margin-right:' + sideMargin(neighbourGap(container, button, true), step, m.right) + 'px'
    ];
  }

  // The row's own spacing step, read off a button Stash put there - one carrying `btn`
  // with no `_coopOwner`, so neither plugin's buttons can be mistaken for Stash's, and
  // `<a>` included since Stash styles some row actions as links (1.15.1 established
  // that for Delete).
  //
  // The length test is *positive*, not `!== '0px'`: a style engine with no stylesheet
  // loaded reports the empty string rather than `0px`, which an inequality reads as a
  // margin worth copying and then applies as `margin-left:;` - nothing at all, with the
  // class fallback already skipped. jsdom catches it in the placement suite; the same
  // hazard is live on any row whose buttons genuinely carry no margin.
  //
  // No `getComputedStyle` at all (the shared test harness's fake DOM) returns null, so
  // the class fallback stands in - which is exactly what shipped before any of this was
  // measured.
  function stashButtonMargins(container) {
    var kids = container.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k._coopOwner || !hasClass(k, 'btn')) continue;
      var cs = computedStyleOf(k);
      if (!cs) return null;
      if (nonZeroLength(cs.marginLeft) || nonZeroLength(cs.marginRight)) {
        return { left: cs.marginLeft || '0px', right: cs.marginRight || '0px' };
      }
    }
    return null;
  }

  function applyButtonSpacing(container, button) {
    // `align-self:flex-start` first, and the assignment unconditional, so this is the
    // same three lines as the two sibling plugins: it opts the button out of a flex
    // row's `align-items: stretch`, and a row that spaces its own children with
    // `column-gap` still needs it even though it needs no margin from us.
    var parts = ['align-self:flex-start'];
    var cs = computedStyleOf(container);
    if (!cs || !nonZeroLength(cs.columnGap)) {
      var m = stashButtonMargins(container);
      if (m) parts = parts.concat(fillNeighbourGaps(container, button, m));
      else if (!hasClass(button, SPACING_CLASS)) button.className += ' ' + SPACING_CLASS;
    }
    if (container._cpt2sBlockRow) parts.push('margin-bottom:' + ROW_GAP);
    button.style = parts.join(';') + ';';
  }

  // Deterministic ordering between plugins sharing this row (repo-root CLAUDE.md,
  // "Cross-plugin cooperation: deterministic button ordering"). Both this plugin's
  // and PropagateTagsAndPerformers' `insertBeforeImportantAction` used to always
  // insert immediately before their anchor, so with both enabled, whichever plugin's
  // async eligibility check happened to resolve last ended up closest to it - a race
  // decided by network timing, not a rule, and it could flip on every reload.
  // `coop().order` fixes a priority per plugin id; a button already sitting there
  // and owned by a higher-priority plugin is skipped over rather than displaced, so
  // this plugin's own button always lands on the low-priority side of it regardless
  // of which plugin inserted first. `anchor` may be null (neither Delete nor Save
  // found), in which case there is nothing to order against.
  function insertOrdered(container, button, anchor) {
    if (!anchor) { container.appendChild(button); return; }
    var order = coop().order;
    var myPriority = order[PLUGIN_ID] || 0;
    var ref = anchor;
    var scan = anchor.previousSibling;
    while (scan) {
      var ownerPriority = scan._coopOwner ? (order[scan._coopOwner] || 0) : null;
      if (ownerPriority === null || ownerPriority <= myPriority) break;
      ref = scan;
      scan = scan.previousSibling;
    }
    container.insertBefore(button, ref);
  }

  function removePerformerButton() {
    var existing = document.querySelector('.' + PERFORMER_BTN_CLASS);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function addPerformerButton() {
    if (!settings.showManualMergeButtons) {
      gateLogOnce('p:setting', 'performer button: Show Manual Merge Buttons is off');
      removePerformerButton();
      return;
    }
    gateLogOnce('p:setting', 'performer button: Show Manual Merge Buttons is on');
    var performerId = getPerformerId();
    if (!performerId) return;
    var container = findPerformerDetailContainer();
    if (!container) {
      // Editing (or the navbar has not rendered yet) — drop a button left over from
      // the detail view rather than letting it ride along into the edit form.
      gateLogOnce('p:container', 'performer button: no detail navbar - the edit form is ' +
        'open, or the navbar has not rendered yet');
      removePerformerButton();
      return;
    }
    gateLogOnce('p:container', 'performer button: detail navbar found on performer ' + performerId);
    var existing = document.querySelector('.' + PERFORMER_BTN_CLASS);
    if (existing) {
      if (existing.parentNode === container) return;
      if (existing.parentNode) existing.parentNode.removeChild(existing);
    }

    if (performerCheck && performerCheck.status !== 'pending') {
      // From the tick rather than the check, so a cached answer still explains itself -
      // see `_lastPlanReason` for why that matters. Both halves named rather than the
      // verdict: "no tags of their own" and "in no scenes" are one absent button and
      // two different things to go and fix.
      gateLogOnce('p:outcome', 'performer button, performer ' + performerCheck.id + ': ' +
        (performerCheck.status === 'yes' ? 'SHOWN' : 'hidden') +
        (performerCheck.why ? ' - ' + performerCheck.why : ''));
    }
    if (!performerCheck || performerCheck.id !== performerId) {
      performerCheck = { id: performerId, status: 'pending' };
      gateLog('probing performer ' + performerId + ' - the outcome below is this probe\'s');
      checkPerformerHasScenes(performerId);
      return;
    }
    if (performerCheck.status !== 'yes') return;

    var button = document.createElement('button');
    button.type = 'button';
    button._coopOwner = PLUGIN_ID; // read by `insertOrdered`'s cross-plugin priority scan
    // No spacing class here since 1.15.4 - `applyButtonSpacing` copies the row's own
    // margins inline and adds `mx-2` back itself when there is nothing to copy. A
    // Bootstrap `mx-*` is `!important` and would outrank the copied margins.
    button.className = 'btn ' + PLUGIN_BTN_VARIANT + ' ' + PERFORMER_BTN_CLASS;
    // "Add Tags to all Scenes", not the older "Add Tags to Scene(s)": harmonized
    // with PropagateTagsAndPerformers' naming convention, since that plugin's own
    // manual-button dedup (§7d's `declares`) matches on this exact label text to
    // decide whether its own identical-path button is already showing here.
    // "..." because the click opens the review dialog rather than merging - the
    // convention every button in these plugins that asks something first now follows.
    button.textContent = PERFORMER_BTN_LABEL;
    // The scene set comes from a findScenes query keyed only on this performer, not
    // from the list below, so say so — an active filter looks like it ought to apply.
    button.title = "Add this performer's tags to every scene featuring them. " +
      "Opens a dialog listing every change first; nothing is written until you press " +
      "Proceed. Filters and selections in the scene list are ignored.";
    // Until 1.18.0 this merged straight into every scene the performer appears in - the
    // widest unreviewed write in the plugin, and the only one with no staging and no
    // plan. It now opens the task's own dialog scoped to this performer: same review,
    // same Proceed, same Undo, over one performer's scenes instead of the library.
    button.addEventListener('click', function (event) {
      event.preventDefault();
      var perfId = getPerformerId();
      if (!perfId) return;
      scopeLabel('Performer', perfId).then(function (what) {
        startTaskRun(stripEllipsis(PERFORMER_BTN_LABEL) + ' - from ' + what,
          { performerId: perfId });
      });
    });
    insertBeforeImportantAction(container, button);
  }

  // ── Scene page: "Add all Tags from all Performers" ───────────────────────

  var sceneCheck = null; // { id, status: 'pending'|'yes'|'no' }
  var _sceneFlashToken = 0;
  var FLASH_MS = 1400;

  // 1.16.0: eligibility, not existence. Until then this asked only whether the scene
  // had any performers, so a scene already carrying every one of their tags showed a
  // button whose click could report nothing but "No changes" - which is what the
  // *performer* button had never done (`checkPerformerHasScenes` has always required
  // `hasTags && hasScenes`). The two of this plugin's own buttons disagreeing was never
  // a decision; the performer side got the reasoning and this side was not revisited.
  //
  // It costs no extra round trip. The query grows from `performers { id }` to what a
  // merge actually reads, and `scenePlanFrom` then answers exactly the question the
  // click will answer - including the Organized and exclusion-tag filters and the
  // custom-field tag rules, which the old gate could not see at all.
  //
  // What it reads is the server. In staging mode the click diffs against the *form*, so
  // an unsaved edit is invisible here until Save - which the `sceneUpdate` branch in the
  // fetch wrapper is what makes sufficient.
  function checkSceneHasPerformers(sceneId) {
    resolveExclusionTagId()
      .then(function (exclTagId) {
        return gqlRequest(
          'query FindSceneMergeable($id: ID!) {' +
          '  findScene(id: $id) { ' + sceneMergeSelection() + ' }' +
          '}',
          { id: sceneId }
        ).then(function (data) {
          var plan = scenePlanFrom(data.findScene, exclTagId, 'scene button, scene ' + sceneId);
          if (sceneCheck && sceneCheck.id === sceneId) {
            sceneCheck.status = plan ? 'yes' : 'no';
            sceneCheck.why = _lastPlanReason;
          }
        });
      })
      .catch(function (e) {
        var failed = 'the check itself failed: ' + (e && e.message ? e.message : e);
        gateLog('scene button, scene ' + sceneId + ': no - ' + failed);
        if (sceneCheck && sceneCheck.id === sceneId) { sceneCheck.status = 'no'; sceneCheck.why = failed; }
      });
  }

  // "..." only where the click opens the dialog. With staging available it puts the
  // tags in the box in front of you and asks nothing, which is not what the dots mean.
  function sceneButtonLabel() {
    return stagingActive() ? SCENE_BTN_LABEL : SCENE_BTN_LABEL + '...';
  }

  function addSceneButton() {
    if (!settings.showManualMergeButtons) {
      gateLogOnce('s:setting', 'scene button: Show Manual Merge Buttons is off');
      var existing = document.querySelector('.' + SCENE_BTN_CLASS);
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    gateLogOnce('s:setting', 'scene button: Show Manual Merge Buttons is on');
    var sceneId = getSceneId();
    if (!sceneId) return;
    var container = document.querySelector('.edit-buttons');
    if (!container) {
      gateLogOnce('s:container', 'scene button: no .edit-buttons row on this page yet - ' +
        'on a Scene that means the Edit tab is not open');
      return;
    }
    gateLogOnce('s:container', 'scene button: row found on scene ' + sceneId);

    if (!sceneCheck || sceneCheck.id !== sceneId) {
      sceneCheck = { id: sceneId, status: 'pending' };
      gateLog('probing scene ' + sceneId + ' - the outcome below is this probe\'s');
      checkSceneHasPerformers(sceneId);
      return;
    }
    // 1.16.0: not eligible means *removed*, not merely "not added". The
    // already-exists early return used to sit above this check, so once the button was
    // on the page nothing ever re-evaluated it - harmless while the gate asked only
    // whether the scene had performers and nothing invalidated the cache anyway, and
    // wrong the moment a save can make an eligible scene ineligible. A click that
    // merges everything now takes its own button away.
    gateLogOnce('s:outcome', 'scene button, scene ' + sceneId + ': ' +
      (sceneCheck.status === 'yes' ? 'SHOWN' : 'hidden') +
      (sceneCheck.why ? ' - ' + sceneCheck.why : ''));
    var showing = document.querySelector('.' + SCENE_BTN_CLASS);
    if (sceneCheck.status !== 'yes') {
      if (showing && showing.parentNode) showing.parentNode.removeChild(showing);
      return;
    }
    if (showing) {
      // The caption depends on a setting, so a button already on the page is relabelled
      // rather than left saying "..." after staging was switched back on. Only while it
      // is showing its own label: mid-flash the text is "Added 3", and rewriting that
      // would cut the flash short.
      var want = sceneButtonLabel();
      if (showing.textContent === showing._cpt2sLabel && showing._cpt2sLabel !== want) {
        showing.textContent = showing._cpt2sLabel = want;
      }
      return;
    }

    var button = document.createElement('button');
    button.type = 'button';
    button._coopOwner = PLUGIN_ID; // read by `insertOrdered`'s cross-plugin priority scan
    // No spacing class here since 1.15.4, same as the performer button - the fallback
    // `mx-2` (which replaced a left-only `ml-2` at 1.15.2, once this button started
    // landing *between* Save and Delete rather than at the row's end) is now applied by
    // `applyButtonSpacing` only when the row has no margins of its own to copy.
    button.className = 'btn ' + PLUGIN_BTN_VARIANT + ' ' + SCENE_BTN_CLASS;
    // "Add all Tags from all Performers", not the older "Add Perf Tags" - same
    // harmonization as the performer button above. `_cpt2sLabel` is what the caption
    // is *supposed* to read, held apart from `textContent` because a click overwrites
    // that with "Adding..."/"Added 3" while a flash is in flight.
    button.textContent = button._cpt2sLabel = sceneButtonLabel();
    function updateSceneButtonTitle() {
      button.title = stagingActive()
        ? "Add all performer tags to the tag box for review — you still have to press Save"
        : "Add all performer tags into this scene's tags. Opens a dialog listing every " +
          "change first; nothing is written until you press Proceed.";
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
      // messages keeps every one of them shorter than the button's own label, so the
      // button never changes width. The token makes a later click supersede a running
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

      // No form to stage into, so the review happens in the dialog instead of not at
      // all (1.18.0). It plans this one scene through the same pass the library-wide
      // task uses and writes nothing until Proceed - which is what the "..." on the
      // caption promises. The button itself goes straight back to its label: the dialog
      // covers it, so a flash underneath would be a caption nobody can see.
      warnNoStagingOnce();
      btn.disabled = false;
      btn.textContent = orig;
      scopeLabel('Scene', sId).then(function (what) {
        startTaskRun(stripEllipsis(SCENE_BTN_LABEL) + ' - for ' + what, { sceneId: sId });
      });
    });
    insertBeforeImportantAction(container, button);
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

  // The first descendant carrying a class, in document order. This was a hand-rolled
  // depth-capped walk until the test harness grew a class selector; the walk existed
  // only because the fake DOM could not answer `.foo`, not because a browser cannot.
  // `querySelector` is the same search with the same ordering, and the depth cap it
  // drops was arbitrary rather than load-bearing.
  function byClass(root, name) {
    if (!root || typeof root.querySelector !== 'function') return null;
    try { return root.querySelector('.' + name) || null; } catch (e) { return null; }
  }

  // Stash gives every plugin setting an element id built from the plugin id and the
  // setting key - `plugin-MergePerformerTagsToScenes-a1ShowManualMergeButtons` - so
  // it is ours by construction, with no heading text to match and nothing formatted
  // for display. Finding one is also what says the plugins settings page is showing.
  // See §2 of NormalizeParentTags' CLAUDE.md: matching the heading instead shipped
  // broken twice over there.
  function ownSettingGroup() {
    var node = null, d, key;
    for (key in SETTING_MAP) {
      if (!hasOwn(SETTING_MAP, key)) continue;
      node = settingElement(key);
      if (node) break;
    }
    for (d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return node;
    }
    // Fallback: the group headed with our own name. The ids are still the anchor,
    // but they are only ours *while they exist* - a release that renames every key
    // leaves this code unable to find its own group, and the first casualty is the
    // stale-script banner, which is the one thing on this page that release needed to
    // show. NormalizeParentTags 4.0.0 renamed all nine of its keys and its own 3.2.0
    // banner went silent in every tab that had not been reloaded.
    //
    // Settings - Tasks heads *its* group with the same name, and that group is not
    // this one: it holds the task buttons and no settings, so decorating it would put
    // a README link and a split description on a page that never had either - and the
    // link lands inside the task button, replacing the label `ownTaskName` matches on.
    // The heading identifies us; the buttons say which page.
    var heading = ownSettingGroupHeading();
    for (node = heading, d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting-group')) return hasOwnTaskButton(node) ? null : node;
    }
    return heading && !hasOwnTaskButton(heading.parentElement)
      ? heading.parentElement : null;
  }

  // The two pages that show a group headed with our name do not head it the same
  // way. Settings - Tasks passes the plugin name straight through
  // (`heading: o.name`), but Settings - Plugins appends the version:
  //
  //   heading: `${plugin.name} ${plugin.version ? `(${plugin.version})` : undefined}`
  //
  // so the h3 there reads "... (3.3.1)" - and, because that template interpolates the
  // literal when there is no version at all, sometimes "... undefined".
  //
  // Strip the suffix and compare exactly, rather than testing a prefix: a plugin whose
  // name merely starts with ours must not be mistaken for us.
  function headingIsOurs(text) {
    var t = String(text == null ? '' : text).trim();
    if (t === PLUGIN_NAME) return true;
    t = t.replace(/\s*\([^()]*\)$/, '').replace(/\s+undefined$/, '').trim();
    return t === PLUGIN_NAME;
  }

  function ownSettingGroupHeading() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('h3') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (headingIsOurs(nodes[i].textContent)) return nodes[i];
    }
    return null;
  }

  // A plain recursive walk rather than `querySelectorAll('button')`: this runs against
  // a group that may be anywhere in the page's own markup, and matching on the task
  // captions is the only thing that identifies the Tasks page from inside it.
  function hasOwnTaskButton(node) {
    if (!node) return false;
    if (node.tagName === 'BUTTON' &&
        TASKS.indexOf(String(node.textContent || '').replace(/^\s+|\s+$/g, '')) !== -1) {
      return true;
    }
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (hasOwnTaskButton(kids[i])) return true;
    }
    return false;
  }

  // Under the description, which is in the group header and therefore outside the
  // <Collapse> - so it shows whether or not the group is expanded.
  function readmeLinkSlot(group) {
    var sub = byClass(group, 'sub-heading');
    if (sub && sub.parentNode) return { parent: sub.parentNode, before: sub.nextSibling };
    var header = byClass(group, 'setting');
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
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'cpt2s-p')) return;   // already ours
    var text = sub.textContent || '';
    if (text.indexOf('\n') === -1) return;                   // nothing to split
    var paras = text.split(/\n{2,}/);
    sub.textContent = '';
    paras.forEach(function (para) {
      var t = para.replace(/\s+/g, ' ').replace(/^ | $/g, '');
      if (t) sub.appendChild(taskEl('div', 'cpt2s-p', t));
    });
  }

  // ── Settings verbosity: a summary on the page, the rest on hover ──────────
  //
  // A description written as "summary\n\ndetail" shows only its first paragraph,
  // with the rest moved into a tooltip. The sibling plugin's CLAUDE.md §6 carries
  // the full reasoning; the parts that matter here:
  //
  // Stash's own Setting renders `<h3 title={tooltip}>` (Inputs.tsx), but
  // SettingsPluginsPanel never passes a tooltip for a plugin setting, and
  // `PluginSetting` has no field to declare one - name, display_name, description,
  // type is the whole type. So the slot exists, is always empty for us, and the
  // tooltip is built here instead.
  //
  // The split rides on the blank line the description format already supports rather
  // than a delimiter of our own. If this script never runs - a stale browser cache,
  // a .js that was never copied into the plugin folder - Stash renders the whole
  // description exactly as before, instead of showing a raw marker.
  //
  // **What goes in which half is a judgement, made per setting.** The box opens on
  // focus as well as hover, so it is better reachable than a `title` was, but it
  // still does not exist on a touch device.
  var TIP_MARK = 'ⓘ';                       // circled Latin small letter i

  function settingElement(key) {
    return document.getElementById('plugin-' + PLUGIN_ID + '-' + key);
  }

  // The `.setting` row a given setting lives in. `settingElement` returns the input
  // itself - Stash puts the id on the Form.Switch, not on the row - so this walks up
  // to the row. ' setting ' is matched with its spaces so that "setting-group" is not
  // mistaken for it.
  function settingRow(key) {
    var node = settingElement(key);
    for (var d = 0; node && d < 10; d++, node = node.parentElement) {
      if (hasClass(node, 'setting')) return node;
    }
    return null;
  }

  function setTipOpen(sub, on) {
    var cls = String(sub.className || '').replace(/\s*cpt2s-tip-open\b/, '');
    sub.className = (on ? cls + ' cpt2s-tip-open' : cls).replace(/^\s+/, '');
  }

  // A class toggled from JS rather than a `:hover ~` selector, because the triggers
  // do not sit in one predictable place: the mark and the summary are inside the
  // .sub-heading and the name is an <h3> somewhere above it, and a sibling
  // combinator would depend on exactly how Stash nests them.
  //
  // The row is passed rather than the .sub-heading, and the current one looked up
  // per event: an <h3> is Stash's element and survives the re-renders that replace
  // everything we put in the row, so a captured reference would go stale. The flag
  // is what stops a second pair of listeners landing on it each time we rebuild.
  function tipTrigger(node, row) {
    if (!node || node._cpt2sTipWired) return;
    node._cpt2sTipWired = true;
    var toggle = function (on) {
      var sub = byClass(row, 'sub-heading');
      if (sub) setTipOpen(sub, on);
    };
    node.addEventListener('mouseenter', function () { toggle(true); });
    node.addEventListener('mouseleave', function () { toggle(false); });
    node.addEventListener('focus', function () { toggle(true); });
    node.addEventListener('blur', function () { toggle(false); });
  }

  function tipSetting(key) {
    var row = settingRow(key);
    if (!row) return;
    var sub = byClass(row, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    if (kids.length && hasClass(kids[0], 'cpt2s-sum')) return;   // already ours
    var text = sub.textContent || '';
    var cut = text.indexOf('\n\n');
    if (cut === -1) return;                                              // nothing to hide
    var summary = taskOneLine(text.slice(0, cut));
    // Kept as paragraphs: white-space:pre-wrap on the box honours them, and three
    // paragraphs run together read worse than the wall this is replacing.
    var detail = text.slice(cut + 2).split(/\n{2,}/).map(taskOneLine)
      .filter(function (p) { return !!p; }).join('\n\n');
    if (!summary || !detail) return;
    sub.textContent = '';
    if (!hasClass(sub, 'cpt2s-tipped')) {
      sub.className = ((sub.className || '') + ' cpt2s-tipped').replace(/^\s+/, '');
    }
    var sum = taskEl('span', 'cpt2s-sum', summary);
    sub.appendChild(sum);
    // tabIndex, so the box can be reached and read without a mouse. The box is a
    // sibling of the mark rather than a child: as a child it would sit inside an
    // inline span and inherit its clipping and stacking.
    var mark = taskEl('span', 'cpt2s-tip', TIP_MARK);
    mark.tabIndex = 0;
    sub.appendChild(mark);
    sub.appendChild(taskEl('span', 'cpt2s-tipbox', detail));
    tipTrigger(mark, row);
    // The visible summary opens it too - the mark is a small target - and so does
    // the setting's name. Stash's own `<h3 title>` slot is left empty: a `title`
    // there would put the same words in the small browser tooltip this replaces.
    tipTrigger(sum, row);
    var h3 = row.querySelector ? row.querySelector('h3') : null;
    if (h3) tipTrigger(h3, row);
  }

  function tipSettings() {
    for (var key in SETTING_MAP) if (hasOwn(SETTING_MAP, key)) tipSetting(key);
  }

  // The group description is in the group *header*, which is outside the <Collapse>
  // - so it stays on screen at full height whether the group is expanded or not, and
  // per-plugin collapse does not shorten it. Hiding all but the first paragraph is
  // the only thing that does.
  //
  // A <button>, never a <span>: SettingGroup's onDivClick walks up from the event
  // target and returns early for `a` and `button`, so anything else folds the whole
  // group on click. A button is also the keyboard-reachable choice, which matters
  // more here than for the tooltips - this is the half of the description that has
  // nowhere else to be read.
  var DESC_TOGGLE_ID = 'cpt2s-desc-toggle';

  function descCollapsed(sub) { return hasClass(sub, 'cpt2s-desc-collapsed'); }

  function setDescCollapsed(sub, on) {
    var cls = String(sub.className || '').replace(/\s*cpt2s-desc-collapsed\b/, '');
    sub.className = (on ? cls + ' cpt2s-desc-collapsed' : cls).replace(/^\s+/, '');
  }

  function collapseDescription(group) {
    var sub = byClass(group, 'sub-heading');
    if (!sub) return;
    var kids = sub.childNodes || [];
    var paras = 0;
    for (var i = 0; i < kids.length; i++) if (hasClass(kids[i], 'cpt2s-p')) paras++;
    if (paras < 2) return;                        // one paragraph hides nothing
    if (document.getElementById(DESC_TOGGLE_ID)) return;
    // A re-render drops the button and the class together, so the description
    // returns to collapsed rather than to a half-state with no way out of it.
    setDescCollapsed(sub, true);
    var btn = taskEl('button', 'cpt2s-desc-toggle', 'Show more');
    btn.id = DESC_TOGGLE_ID;
    btn.type = 'button';
    btn.addEventListener('click', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      var open = descCollapsed(sub);
      setDescCollapsed(sub, !open);
      btn.textContent = open ? 'Show less' : 'Show more';
    });
    sub.appendChild(btn);
  }

  // Re-added rather than tracked: React re-renders this panel whenever a setting
  // changes and drops anything we put in it, so the tick puts it back. Keyed on the
  // id, so a re-render that kept it does not produce a second one.
  // ── The stale-script banner ───────────────────────────────────────────────
  //
  // Stash serves plugin JS with caching on, so a browser holding the old file goes
  // on running it after an update and nothing on screen says so. The settings
  // heading is where the two numbers meet: Stash builds it as `${name} (${version})`
  // from the **manifest**, read fresh from the server, while `PLUGIN_VERSION` is what
  // this script actually is. A disagreement means the page is running code the
  // manifest has already replaced.
  //
  // No query for it - the number is on the page already, and this tick runs once a
  // second. `installedVersion` asks the server the same question, which is right for
  // a dialog that opens once and wrong for a timer.
  //
  // It catches only what a version bump makes visible; editing the file without
  // bumping leaves both numbers equal, which is the practical reason this repo bumps
  // the patch digit on every change.
  var STALE_ID = 'cpt2s-stale-notice';

  // The group's own h3, not a search of the page: the header row comes before the
  // setting rows, each of which has an h3 too, and the group is already ours.
  function installedFromHeading(group) {
    var h3 = group && group.querySelector ? group.querySelector('h3') : null;
    var t = h3 ? String(h3.textContent == null ? '' : h3.textContent).trim() : '';
    var m = /\(([^()]+)\)$/.exec(t);
    return m ? m[1].replace(/^\s+|\s+$/g, '') : null;
  }

  // Above the description rather than under it: it is the first thing in the group
  // worth reading, and it leaves the README link's slot alone. Both sit in the group
  // header, outside Stash's <Collapse>, so a collapsed group still shows the banner.
  function staleSlot(group) {
    var sub = byClass(group, 'sub-heading');
    if (sub && sub.parentNode) return { parent: sub.parentNode, before: sub };
    return { parent: group, before: group.firstChild };
  }

  function ensureStaleNotice(group) {
    var installed = installedFromHeading(group);
    var node = document.getElementById(STALE_ID);
    // No parenthesised version on the heading means Settings → Tasks, which heads its
    // group with the bare name - not a mismatch, and nothing to say.
    if (!installed || installed === PLUGIN_VERSION) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    var slot = staleSlot(group);
    if (node && node.parentNode === slot.parent) return;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    var box = taskEl('div', 'cpt2s-stale', '⚠ This page is still running ' +
      PLUGIN_SHORT_NAME + ' ' + PLUGIN_VERSION + ', but ' + installed + ' is installed. ' +
      'Press Ctrl+Shift+R (⌘+Shift+R on a Mac) to reload it: your browser has cached ' +
      'the older script, and everything this plugin does until then is that older code.');
    box.id = STALE_ID;
    slot.parent.insertBefore(box, slot.before);
  }

  function ensureReadmeLink() {
    var group = ownSettingGroup();
    if (!group) return;
    // Both of these run on every tick, not just when the link is missing: React
    // re-renders this panel on any settings change, and the class is the only thing
    // making the description's paragraph breaks visible.
    taskInjectStyle();
    if (!hasClass(group, 'cpt2s-own-group')) {
      group.className = ((group.className || '') + ' cpt2s-own-group').replace(/^\s+/, '');
    }
    splitDescription(group);
    collapseDescription(group);   // after the split: it counts the .cpt2s-p divs
    tipSettings();
    ensureStaleNotice(group);     // before the early return: the link outlives it
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

  // ── Plugin Task buttons ───────────────────────────────────────────────────
  //
  // Settings - Tasks - Plugin Tasks renders every task of every plugin with the same
  // `btn-secondary`, so nothing on that page says which buttons rewrite the library.
  // Repainting ours in the same amber as its page buttons is the whole change.
  //
  // `ownTaskName` decides what is ours - the same function the click interception
  // keys on, which checks the label *and* the enclosing group's heading, so another
  // plugin declaring a task by the same name is not repainted.
  //
  // Swapping Bootstrap's variant class rather than writing a colour: `btn-warning`
  // brings Stash's hover, focus and active states with it, which a background-color
  // of ours would have to restate and then keep in step with the theme.
  //
  // `btn-warning` is deliberately not in the strip list - it is what we add, and the
  // guard in `paintButton` returns before any of this once it is there.
  var BTN_VARIANTS = /\bbtn-(secondary|primary|success|info|light|dark|link)\b/g;

  function paintButton(btn, variant) {
    if (hasClass(btn, variant)) return;                        // already ours
    var cls = String(btn.className || '').replace(BTN_VARIANTS, '');
    btn.className = cls.replace(/\s+/g, ' ').replace(/^ | $/g, '') + ' ' + variant;
  }

  // Re-applied every tick rather than once: React re-renders this panel and hands
  // back a button with Stash's own classes, and `paintButton` is a no-op on one that
  // still carries ours.
  function paintTaskButtons() {
    var nodes = document.querySelectorAll ? document.querySelectorAll('button') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (ownTaskName(nodes[i])) paintButton(nodes[i], PLUGIN_BTN_VARIANT);
    }
  }

  function tick() {
    maybeGoToEdit();
    addPerformerButton();
    addSceneButton();
    // Costs two getElementById calls off the settings page, which is where this tab
    // spends none of its time; no query, no observer of its own.
    ensureReadmeLink();
    paintTaskButtons();
  }

  // The MutationObserver watches the whole SPA subtree, which churns constantly
  // during video playback, so coalesce bursts into a single tick.
  var _tickScheduled = false;
  function scheduleTick() {
    if (_tickScheduled) return;
    _tickScheduled = true;
    setTimeout(function () { _tickScheduled = false; tick(); }, 100);
  }

  // The shared bus rather than an observer of our own - see `domBus`. No return value
  // and no retry: there was a `if (!startObserver()) DOMContentLoaded` retry here and it
  // was unreachable, since the only falsy answer needed `document.documentElement` to be
  // missing and the catch deliberately reported success because the interval below covers
  // it. A guard that reads as protection and provides none is worse than none.
  // `subscribe` is idempotent, so this is safe from both the script bottom and `load`.
  function startObserver() {
    domBus().subscribe(scheduleTick);
  }

  // Patches have to be registered before the components they target first render,
  // so this runs at script load. Stash sets window.PluginApi before loading plugin
  // scripts; the load-event retry only covers an unusual ordering.
  if (!installTagSelectPatch()) {
    window.addEventListener('load', function () { installTagSelectPatch(); });
  }

  window.addEventListener('load', function () { loadSettings(); startObserver(); tick(); });
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

  startObserver();

  loadSettings();
  tick();
})();
