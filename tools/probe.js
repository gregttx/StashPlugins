// Paste this whole file into a live Stash tab's DevTools console.
//
// It reports the DOM and API facts the five plugins here depend on and that no
// test in `tests/` can check - Stash's own markup, its computed styles, its
// schema. Output goes to the console and to the clipboard; paste it back into a
// Claude Code session rather than describing it, which is the entire point:
// every expensive bug in this repo's history (the `.delete` class that is not
// there, `row-gap` inert on `.edit-buttons`, margins double-counted on Group,
// task buttons lost to a rename) was a guess that one paste would have settled.
//
// IT REPORTS FACTS, NEVER CONCLUSIONS. It does not decide which anchor a button
// should take or what a gap should be - it prints what is on the page and lets
// the plugin's own rule apply. A probe that re-implemented those rules would be
// a sixth copy free to drift from the five, and a drifted probe lies with
// authority. So: "button.delete matches 0 nodes, children are [Save, Delete]",
// not "the anchor is Save".
//
// READ-ONLY. No mutation, no configurePlugin, no write of any kind. Safe on a
// real library. The only network call is a GraphQL introspection query.
//
// Run it once per page shape you care about (a scene, a performer, a group, a
// list view, the settings page) - it reports what is on screen now.

(function () {
  'use strict';

  var out = [];
  function w(s) { out.push(s == null ? '' : String(s)); }
  function head(s) { w(''); w('== ' + s); }
  function q(sel) { try { return document.querySelectorAll(sel); } catch (e) { return []; } }
  function txt(el) { return (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40); }
  function cls(el) { return String(el.className || '').slice(0, 60); }
  function cs(el, p) { try { return getComputedStyle(el)[p]; } catch (e) { return '?'; } }

  w('probe ' + new Date().toISOString() + '  ' + location.pathname + location.search);
  w('ua ' + navigator.userAgent.slice(0, 80));

  // -- containers ----------------------------------------------------------
  // Every selector the plugins reach for, with a count. A zero here is the
  // single most common cause of "the button did not appear".
  head('containers (selector -> count)');
  [ '#root', '.edit-buttons', '.details-edit', '#performer-page .details-edit',
    '.nav-tabs', 'a.nav-link', '.setting-group', '.setting', '.sub-heading',
    '.dropdown-menu', '#more-menu', '.grid-card', 'button.delete', '.delete'
  ].forEach(function (sel) { w('  ' + sel + ' -> ' + q(sel).length); });

  // -- button rows ---------------------------------------------------------
  // For each row: its own layout (the `display: block` that made row-gap inert
  // lives here), then every direct child with the margins the donor scan reads
  // and the `_coopOwner` that tells one of ours from one of Stash's.
  head('button rows');
  ['.edit-buttons', '.details-edit'].forEach(function (sel) {
    Array.prototype.forEach.call(q(sel), function (el, i) {
      w('  ' + sel + '[' + i + '] display=' + cs(el, 'display') +
        ' columnGap=' + cs(el, 'columnGap') + ' rowGap=' + cs(el, 'rowGap') +
        ' alignItems=' + cs(el, 'alignItems') + ' children=' + el.children.length);
      Array.prototype.forEach.call(el.children, function (c) {
        var inner = c.querySelector && c.querySelector('.btn');
        w('     <' + c.tagName.toLowerCase() + '> "' + txt(c) + '"' +
          ' class=[' + cls(c) + ']' +
          ' margin=' + cs(c, 'marginTop') + '/' + cs(c, 'marginRight') +
          '/' + cs(c, 'marginBottom') + '/' + cs(c, 'marginLeft') +
          (c._coopOwner ? ' OWNER=' + c._coopOwner : '') +
          (inner ? ' wraps<' + inner.tagName.toLowerCase() + ' .btn "' + txt(inner) + '" margin=' +
            cs(inner, 'marginRight') + '/' + cs(inner, 'marginLeft') + '>' : ''));
      });
    });
  });

  // -- actions by label ----------------------------------------------------
  // The inputs to the anchor search, not its answer: does the class match, and
  // what does the row actually contain, in order.
  head('actions in each row (in document order)');
  ['.edit-buttons', '.details-edit'].forEach(function (sel) {
    Array.prototype.forEach.call(q(sel), function (el, i) {
      var acts = [];
      (function walk(n) {
        Array.prototype.forEach.call(n.childNodes || [], function (k) {
          if (k.tagName === 'BUTTON' || k.tagName === 'A') {
            acts.push('"' + txt(k) + '"[' + cls(k) + ']');
          }
          walk(k);
        });
      })(el);
      w('  ' + sel + '[' + i + '] button.delete=' + (el.querySelector('button.delete') ? 'YES' : 'no') +
        ' actions=' + (acts.join(' | ') || '(none)'));
    });
  });

  // -- settings page -------------------------------------------------------
  // Which element a `plugin-<id>-<key>` id lands on is the fact that broke a
  // renormalizer for four releases: BOOLEAN puts it on the switch input, STRING
  // and NUMBER put it on the `.setting` row div and render no input at all.
  head('plugin setting ids (id -> element it lands on)');
  var ids = q('[id^="plugin-"]');
  if (!ids.length) w('  (none - not on Settings > Plugins)');
  Array.prototype.forEach.call(ids, function (el) {
    var row = el, d = 0;
    while (row && d++ < 10 && !/(^|\s)setting(\s|$)/.test(String(row.className || ''))) row = row.parentElement;
    w('  ' + el.id + ' -> <' + el.tagName.toLowerCase() + '>' +
      (el.type ? ' type=' + el.type : '') + ' class=[' + cls(el) + ']' +
      ' isSettingRow=' + (row === el ? 'YES' : 'no') +
      ' hasInputInside=' + (el.querySelector && el.querySelector('input') ? 'yes' : 'no'));
  });

  head('setting-group headings (manifest name + version as Stash renders them)');
  Array.prototype.forEach.call(q('h3'), function (h) {
    var t = (h.textContent || '').trim();
    if (t) w('  "' + t.slice(0, 90) + '"');
  });

  // -- button variants -----------------------------------------------------
  // Stash's theme is not stock Bootstrap - btn-warning renders white text here,
  // and btn-dark is themed identically to btn-secondary. Both facts came off a
  // live instance and neither is derivable from this repo.
  head('button variant rendering');
  ['btn-warning', 'btn-info', 'btn-secondary', 'btn-danger', 'btn-primary'].forEach(function (v) {
    var el = document.querySelector('.' + v);
    w('  ' + v + ' ' + (el ? 'color=' + cs(el, 'color') + ' bg=' + cs(el, 'backgroundColor') +
      ' "' + txt(el) + '"' : '(none on this page)'));
  });
  w('  root font-size=' + cs(document.documentElement, 'fontSize'));

  // -- shared object -------------------------------------------------------
  head('__GTTx__ (the one global this repo takes)');
  var ns = window.__GTTx__;
  if (!ns) w('  absent - no plugin of ours has loaded on this page');
  else {
    var c = ns.StashPluginCoop || {};
    w('  aliased on window: ' + (window.StashPluginCoop === c));
    w('  keys: ' + Object.keys(ns).join(', '));
    w('  leases: ' + JSON.stringify(c.leases || []));
    w('  respecters: ' + Object.keys(c.respecters || {}).join(', '));
    w('  order: ' + JSON.stringify(c.order || {}));
    w('  declares: ' + JSON.stringify(c.declares || {}));
    w('  api: ' + Object.keys(c.api || {}).map(function (k) {
      var a = c.api[k] || {};
      return k + '(v' + (a.version || '?') + ': ' + Object.keys(a).join('/') + ')';
    }).join(', '));
    w('  debugButtons: ' + !!c.debugButtons);
    w('  domBus: ' + (ns.domBus ? 'present, subscribers=' +
      ((ns.domBus.subscribers || ns.domBus.subs || []).length) : 'absent'));
  }
  var ours = Array.prototype.filter.call(q('button, a'), function (b) { return b._coopOwner; })
    .map(function (b) { return b._coopOwner + ':"' + txt(b) + '"'; });
  w('  our buttons on the page: ' + (ours.join(', ') || '(none)'));

  // -- schema --------------------------------------------------------------
  // Introspection only. The custom-fields table in the root CLAUDE.md is a
  // snapshot dated 2026-08-04; this is what the running server says today.
  head('graphql schema (async - printed below when it lands)');
  var body = JSON.stringify({ query: '{ __schema { types { name fields { name } inputFields { name } } } version: __type(name:"Query"){name} }' });
  try { probeSchema(); } catch (e) { report(out.concat(['', '== graphql schema', '  FAILED: ' + e])); }
  function probeSchema() {
  fetch('/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var types = (((j.data || {}).__schema || {}).types) || [], byName = {};
      types.forEach(function (t) { byName[t.name] = t; });
      var lines = ['', '== graphql schema'];
      ['Scene', 'Image', 'Gallery', 'Performer', 'Studio', 'Group', 'Tag', 'SceneMarker'].forEach(function (n) {
        var t = byName[n] || {}, bulk = byName['Bulk' + n + 'UpdateInput'];
        var has = function (o, f) { return ((o && (o.fields || o.inputFields)) || []).some(function (x) { return x.name === f; }); };
        lines.push('  ' + n + ' custom_fields=' + (has(t, 'custom_fields') ? 'yes' : 'NO') +
          '  Bulk' + n + 'UpdateInput=' + (bulk ? (has(bulk, 'custom_fields') ? 'custom_fields yes' : 'custom_fields NO') : 'absent'));
      });
      var mut = byName.Mutation || {};
      ['configurePlugin', 'configureUI'].forEach(function (m) {
        lines.push('  Mutation.' + m + ' = ' + ((mut.fields || []).some(function (f) { return f.name === m; }) ? 'present' : 'ABSENT'));
      });
      lines.push('  CustomFieldsInput = ' + (((byName.CustomFieldsInput || {}).inputFields || [])
        .map(function (f) { return f.name; }).join(', ') || 'absent'));
      report(out.concat(lines));
    })
    .catch(function (e) { report(out.concat(['', '== graphql schema', '  FAILED: ' + e])); });
  }

  function report(all) {
    var s = all.join('\n');
    console.log(s);
    try { copy(s); console.log('\n[copied to clipboard - paste into the session]'); }
    catch (e) { console.log('\n[select the output above and copy it]'); }
  }
})();
