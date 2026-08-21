// Paste this whole file into a live Stash tab's DevTools console, then rename a tag,
// then run `__enmProbe.report()` and paste the output back into a Claude Code session.
//
// It answers one question that nothing inside ᝯㄝₓ Entity Name Maintainer can answer about
// itself: **does that plugin ever see the request Stash posts when you rename something?**
// A plugin's own diagnostic is written by the code that may not be running; this one is
// independent of it.
//
// IT REPORTS FACTS, NEVER CONCLUSIONS. It does not decide why the dialog did not open. It
// prints what the page is, what it posted and who was listening, and lets the rule apply.
//
// READ-ONLY. It sends no request of its own, changes no setting, and writes nothing to the
// library. It installs listeners on `window.fetch` and `XMLHttpRequest` that record and
// pass through; `__enmProbe.stop()` removes them, and a page reload removes them anyway.
//
// It is deliberately independent of the plugin: it works with ᝯㄝₓ Entity Name Maintainer
// installed, not installed, disabled, or running a stale script.

(function () {
  'use strict';

  var MAX = 40;              // requests remembered
  var TEXT = 220;            // characters of a query kept
  var prev = window.__enmProbe;
  if (prev && prev.stop) prev.stop();

  var seen = [];
  var counts = { fetch: 0, fetchGql: 0, xhr: 0, xhrGql: 0 };

  // The seven mutations ᝯㄝₓ Entity Name Maintainer watches for, and the field each one
  // moves. Kept here rather than read off the plugin, so the probe still reports when the
  // plugin is absent or is a different release.
  var WATCHED = {
    sceneUpdate: 'title', imageUpdate: 'title', galleryUpdate: 'title',
    performerUpdate: 'name', studioUpdate: 'name', groupUpdate: 'name', tagUpdate: 'name',
  };

  function keys(obj) {
    if (!obj || typeof obj !== 'object') return '';
    var out = [];
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out.push(k);
    return out.join(', ');
  }

  function clock() {
    var t = new Date();
    return ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) +
      ':' + ('0' + t.getSeconds()).slice(-2);
  }

  // Everything about one request, as facts. Values from the library are never recorded -
  // only field names, and the *lengths* of the two strings that decide whether a save is
  // a rename, so the report can be pasted into an issue.
  function record(via, url, body) {
    var entry = { at: clock(), via: via, url: String(url).slice(0, 80) };
    counts[via]++;
    var parsed = null;
    if (typeof body === 'string') {
      try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
    }
    if (!parsed) {
      entry.note = typeof body === 'string' ? 'body is not JSON' : 'no string body (' +
        Object.prototype.toString.call(body) + ')';
      push(entry);
      return;
    }
    var ops = Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [parsed];
    entry.batched = ops.length > 1 ? ops.length + ' operations in one body' : null;
    var interesting = false;
    entry.ops = [];
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i] || {};
      if (typeof op.query !== 'string') {
        entry.ops.push({ note: 'operation with no query string; keys: [' + keys(op) + ']' });
        continue;
      }
      counts[via + 'Gql']++;
      var o = {
        query: op.query.replace(/\s+/g, ' ').slice(0, TEXT),
        vars: keys(op.variables),
      };
      // Which of the seven, if any, and what the plugin would have looked for in it.
      for (var name in WATCHED) {
        if (!Object.prototype.hasOwnProperty.call(WATCHED, name)) continue;
        if (op.query.indexOf(name) === -1) continue;
        o.watched = name;
        o.asSelection = op.query.indexOf(name + '(') !== -1;
        var input = (op.variables || {}).input;
        o.hasVariablesInput = !!input;
        o.inputKeys = keys(input);
        o.hasId = !!input && input.id != null;
        var field = WATCHED[name];
        o.nameField = field;
        o.nameFieldType = input ? typeof input[field] : 'no input';
        o.nameFieldLength = input && typeof input[field] === 'string'
          ? input[field].length : null;
        interesting = true;
        break;
      }
      entry.ops.push(o);
    }
    entry.interesting = interesting;
    push(entry);
  }

  function push(entry) {
    seen.push(entry);
    if (seen.length > MAX) seen.shift();
  }

  // ── The two transports ────────────────────────────────────────────────────
  //
  // Both, because which one Stash uses is the fact in question. A GraphQL client that
  // captured `fetch` before any plugin loaded, or that uses XMLHttpRequest, is invisible
  // to every plugin in this repo - and that would be the answer.

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = init && init.body != null ? input : (input && input.url) || input;
      var body = init && init.body != null ? init.body
        : (input && typeof input === 'object' ? '[body on the Request object]' : null);
      record('fetch', url, body);
    } catch (e) { /* a probe must never break the page */ }
    return origFetch.apply(this, arguments);
  };
  var probeFetch = window.fetch;

  var origSend = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;
  var origOpen = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
  if (origOpen && origSend) {
    window.XMLHttpRequest.prototype.open = function (method, url) {
      this.__enmProbeUrl = url;
      return origOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function (body) {
      try { record('xhr', this.__enmProbeUrl || '(unknown)', body); } catch (e) { /* never break */ }
      return origSend.apply(this, arguments);
    };
  }

  // ── The report ────────────────────────────────────────────────────────────

  function native(fn) {
    try { return String(fn).indexOf('[native code]') !== -1; } catch (e) { return false; }
  }

  function plugins() {
    var ns = window.__GTTx__;
    if (!ns) return '  __GTTx__ is not on this page: no ᝯㄝₓ plugin has loaded.';
    var out = [];
    out.push('  __GTTx__ keys: [' + keys(ns) + ']');
    var coop = ns.StashPluginCoop || {};
    out.push('  respecters: [' + keys(coop.respecters) + ']');
    out.push('  order: [' + keys(coop.order) + ']');
    out.push('  declares: [' + keys(coop.declares) + ']');
    out.push('  leases now: ' + ((coop.leases || []).map(function (l) {
      return l.owner + ' (' + l.label + ', ' + Math.round((l.until - Date.now()) / 1000) +
        's left)';
    }).join(', ') || 'none'));
    out.push('  enmFetchWrap: ' + !!ns.enmFetchWrap + ',  enmHandle: ' +
      (typeof ns.enmHandle) + ',  enm api: ' + (ns.enm ? 'present' : 'absent'));
    return out.join('\n');
  }

  function report() {
    var lines = [];
    lines.push('== enm-probe  ' + new Date().toISOString() + '  ' + location.pathname);

    lines.push('');
    lines.push('== transports');
    lines.push('  window.fetch is still the probe\'s: ' + (window.fetch === probeFetch) +
      (window.fetch === probeFetch ? '' : ' (something replaced it after the probe loaded)'));
    lines.push('  the fetch the probe wrapped was native: ' + native(origFetch) +
      (native(origFetch) ? ' -- NO plugin wrapper was installed under the probe'
        : ' -- something had already wrapped it, which is what a plugin hook looks like'));
    lines.push('  requests seen through fetch: ' + counts.fetch +
      ' (GraphQL operations: ' + counts.fetchGql + ')');
    lines.push('  requests seen through XMLHttpRequest: ' + counts.xhr +
      ' (GraphQL operations: ' + counts.xhrGql + ')');

    lines.push('');
    lines.push('== plugins on this page');
    lines.push(plugins());

    lines.push('');
    lines.push('== what the plugin says about itself');
    try {
      lines.push(window.__GTTx__ && window.__GTTx__.enm && window.__GTTx__.enm.status
        ? '  ' + window.__GTTx__.enm.status().split('\n').join('\n  ')
        : '  no __GTTx__.enm.status() on this page');
    } catch (e) {
      lines.push('  __GTTx__.enm.status() threw: ' + (e && e.message));
    }

    var hits = seen.filter(function (e) { return e.interesting; });
    lines.push('');
    lines.push('== requests that named one of the seven update mutations: ' + hits.length);
    hits.forEach(function (e) {
      lines.push('  ' + e.at + '  via ' + e.via + '  ' + e.url +
        (e.batched ? '  [' + e.batched + ']' : ''));
      e.ops.forEach(function (o) {
        if (!o.watched) return;
        lines.push('      mutation: ' + o.watched +
          '   in the selection set: ' + o.asSelection);
        lines.push('      variables: [' + o.vars + ']   variables.input present: ' +
          o.hasVariablesInput + '   has id: ' + o.hasId);
        lines.push('      input keys: [' + o.inputKeys + ']');
        lines.push('      ' + o.nameField + ': typeof ' + o.nameFieldType +
          (o.nameFieldLength == null ? '' : ', ' + o.nameFieldLength + ' characters'));
        lines.push('      query: ' + o.query);
      });
    });

    lines.push('');
    lines.push('== the last ' + Math.min(seen.length, 12) + ' requests, whatever they were');
    seen.slice(-12).forEach(function (e) {
      var first = (e.ops && e.ops[0] && e.ops[0].query) || e.note || '';
      lines.push('  ' + e.at + '  ' + e.via + '  ' + e.url + '  ' + first.slice(0, 90));
    });

    var text = lines.join('\n');
    console.log(text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        console.info('[enm-probe] the report is on the clipboard.');
      }, function () { /* the console copy is the fallback */ });
    }
    return text;
  }

  function stop() {
    if (window.fetch === probeFetch) window.fetch = origFetch;
    if (origOpen) window.XMLHttpRequest.prototype.open = origOpen;
    if (origSend) window.XMLHttpRequest.prototype.send = origSend;
    console.info('[enm-probe] listeners removed.');
  }

  window.__enmProbe = { report: report, stop: stop, seen: seen, counts: counts };

  console.info('[enm-probe] listening. Now rename a tag - the one that does not open the ' +
    'dialog - and then run:  __enmProbe.report()');
}());
