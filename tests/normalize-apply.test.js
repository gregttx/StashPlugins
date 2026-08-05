// Phase 2: that nothing is written before Proceed, that writes are grouped and
// chunked, that failures are isolated, and that the bulk-edit lease is held for
// exactly as long as the writes take.
'use strict';
const h = require('./npt-harness');

// 250 scenes needing the same removal, 3 needing a different one. Enough to cross
// the 100-per-request chunk boundary twice.
function bigLibrary() {
  const list = [];
  for (let i = 1; i <= 250; i++) {
    list.push({ id: String(i), title: 'S' + i, organized: false, tags: [{ id: '1' }, { id: '2' }] });
  }
  for (let i = 900; i < 903; i++) {
    list.push({ id: String(i), title: 'T' + i, organized: false, tags: [{ id: '4' }, { id: '5' }] });
  }
  return { findScenes: { node: 'scenes', list: list } };
}

// The hoverable segments of a recap line: only the tags with something to say beyond
// the caption carry a title, and nothing else about the line changes.
const recapLine = (env, verb) => env.body.descendants().filter((n) => h.hasClass(n, 'npt-line') &&
  n.textContent.indexOf('tag(s) ' + verb + ':') !== -1)[0] || null;
const recapSpans = (env, verb) => {
  const line = recapLine(env, verb);
  return line ? line.descendants() : [];
};
const recapTips = (env, verb) => recapSpans(env, verb).filter((n) => n.title)
  .map((n) => ({ text: n.textContent, title: n.title }));

function scan(opts, task) {
  const env = h.makeEnv({ quiet: true, respond: h.makeResponder(opts), clipboard: opts.clipboard });
  h.run(env.ctx);
  h.startTask(env.ctx, task || h.TASK_PRUNE);
  return h.flush().then(() => ({ env, d: () => h.dialog(env.body) }));
}

Promise.resolve()

  .then(() => scan({ entities: bigLibrary() })).then(({ env, d }) => {
    h.check('phase 1 writes nothing', h.bulkCalls(env.calls).length === 0);
    // The log puts an id and a count on the same summary line - "Hair Colour" (1)
    // x250 - and nothing else in the dialog says which bracket means what.
    h.check('the head explains the ids in the log',
      d().legend.indexOf('Stash id') !== -1 && d().legend.indexOf('x250') !== -1, d().legend);
    h.check('Proceed and Cancel are the phase 1 buttons',
      d().visible('Proceed') && d().visible('Cancel') && !d().visible('Close') && !d().visible('Stop'));
    h.check('Proceed is enabled once a plan exists', d().button('Proceed').disabled === false);

    d().button('Proceed').click();
    return h.flush().then(() => {
      const bulks = h.bulkCalls(env.calls);
      // 250 identical removals chunk into 3 requests, the other 3 into 1.
      h.check('identical changes are grouped and chunked', bulks.length === 4,
        'got ' + bulks.length);
      h.check('chunks cap at 100 ids',
        bulks.every((c) => c.variables.input.ids.length <= 100) &&
        bulks[0].variables.input.ids.length === 100);
      h.check('writes are deltas, not a rewritten tag list',
        bulks.every((c) => c.variables.input.tag_ids.mode === 'REMOVE' &&
          !('tags' in c.variables.input)));
      h.check('the mutation is the type bulk mutation',
        bulks.every((c) => /mutation NPT_bulkSceneUpdate\(\$input: BulkSceneUpdateInput!\)/.test(c.query)));
      h.check('every planned entity is written',
        bulks.reduce((n, c) => n + c.variables.input.ids.length, 0) === 253);
      h.check('phase 2 buttons replace phase 1 buttons',
        d().visible('Close') && d().visible('Rescan') && !d().visible('Proceed'));
      h.check('the applied count is reported',
        d().progress.indexOf('253 entity change(s) applied') !== -1, d().progress);
      // Entities are batched by shared delta, but the reason is per entity: the
      // 250 lose Hair Colour to Blonde, the 3 lose Body to Tattoo, and both kinds
      // of line have to come back out of one batch loop with the right reason.
      const all = d().lines;
      const written = all.slice(all.findIndex((l) => l.indexOf('Applying') !== -1));
      h.check('phase 2 keeps each entity own reason',
        written.some((l) => l.indexOf('Scene "S1" (1) - Tag "Hair Colour" (1) - due to "Blonde" (2)') !== -1) &&
        written.some((l) => l.indexOf('Scene "T900" (900) - Tag "Body" (4) - due to "Tattoo" (5)') !== -1),
        written.slice(1, 3).join(' | '));
    });
  })

  .then(() => scan({ entities: bigLibrary() })).then(({ env, d }) => {
    d().button('Cancel').click();
    return h.flush().then(() => {
      h.check('Cancel writes nothing', h.bulkCalls(env.calls).length === 0);
      h.check('Cancel closes the dialog', !d().open);
    });
  })

  // ── Error isolation ──────────────────────────────────────────────────────
  .then(() => scan({
    entities: bigLibrary(),
    failBulk: (req) => req.variables.input.ids.indexOf('1') !== -1,
  })).then(({ env, d }) => {
    d().button('Proceed').click();
    return h.flush().then(() => {
      const lines = d().lines;
      h.check('a failed request is reported',
        lines.some((l) => l.indexOf('[ERROR]') === 0 && l.indexOf('bulkSceneUpdate failed') !== -1),
        lines.join(' | '));
      h.check('a failed request does not stop the run', h.bulkCalls(env.calls).length === 4);
      h.check('entities in a failed request are not logged as changed',
        !lines.some((l) => l.indexOf('[REMOVE] Scene "S1" (1)') === 0 &&
          lines.filter((x) => x === l).length > 1), lines.slice(0, 3).join(' | '));
      h.check('the failure count is reported',
        d().progress.indexOf('100 failed') !== -1, d().progress);
    });
  })

  // ── The bulk-edit lease ──────────────────────────────────────────────────
  .then(() => {
    const seen = [];
    const opts = { entities: bigLibrary() };
    const responder = h.makeResponder(opts);
    const env = h.makeEnv({
      quiet: true,
      respond: (req, calls) => {
        // Sample the shared coop object at the moment each request is answered.
        var held = ((env.ctx.window.StashPluginCoop || {}).leases || []);
        seen.push({
          bulk: /mutation NPT_bulk/.test(req.query || ''),
          leases: held.length,
          owner: held.length ? held[0].owner : null,
          label: held.length ? held[0].label : null,
          until: held.length ? held[0].until : 0,
        });
        return responder(req, calls);
      },
    });
    h.run(env.ctx);
    h.startTask(env.ctx, h.TASK_PRUNE);
    return h.flush().then(() => {
      h.check('no lease is held during the review pass',
        seen.every((s) => s.leases === 0), JSON.stringify(seen.slice(0, 3)));
      h.dialog(env.body).button('Proceed').click();
      return h.flush().then(() => {
        h.check('a lease is held while writing',
          seen.filter((s) => s.bulk).length === 4 && seen.filter((s) => s.bulk).every((s) => s.leases === 1));
        h.check('the lease is released when the run finishes',
          (env.ctx.window.StashPluginCoop.leases || []).length === 0);
        const held = seen.filter((s) => s.bulk);
        h.check('the lease names its owner and task, and expires',
          held.every((s) => s.owner === 'NormalizeParentTags' && s.label === h.TASK_PRUNE &&
            s.until > Date.now()), JSON.stringify(held[0]));
      });
    });
  })

  .then(() => {
    // A failing run must release the lease too, or a reactive plugin is left
    // standing down until the page is reloaded.
    const opts = { entities: bigLibrary(), failBulk: () => true };
    const env = h.makeEnv({ quiet: true, respond: h.makeResponder(opts) });
    h.run(env.ctx);
    h.startTask(env.ctx, h.TASK_PRUNE);
    return h.flush().then(() => {
      h.dialog(env.body).button('Proceed').click();
      return h.flush().then(() => {
        h.check('the lease is released even when every request fails',
          (env.ctx.window.StashPluginCoop.leases || []).length === 0);
      });
    });
  })

  // ── Sibling detection ────────────────────────────────────────────────────
  .then(() => scan({
    entities: bigLibrary(),
    siblingSettings: { a3AutoMergeOnSceneUpdate: true },
  })).then(({ d }) => {
    h.check('an auto-merging sibling that cannot stand down is a warning',
      d().lines.some((l) => l.indexOf('[WARN]') === 0 && l.indexOf('too old to stand down') !== -1),
      d().lines.join(' | '));
    h.check('the warning is repeated where the user cannot miss it',
      d().note.indexOf('Merge Performer Tags To Scenes') !== -1, d().note);
  })

  .then(() => {
    const env = h.makeEnv({
      quiet: true,
      respond: h.makeResponder({
        entities: bigLibrary(),
        siblingSettings: { a3AutoMergeOnSceneUpdate: true },
      }),
    });
    // Stand in for a sibling new enough to register itself.
    env.ctx.window.StashPluginCoop = { leases: [], respecters: { MergePerformerTagsToScenes: true } };
    h.run(env.ctx);
    h.startTask(env.ctx, h.TASK_PRUNE);
    return h.flush().then(() => {
      const d = h.dialog(env.body);
      h.check('a sibling that honours leases is reported, not warned about',
        d.lines.some((l) => l.indexOf('[INFO]') === 0 && l.indexOf('will stand down') !== -1) &&
        !d.lines.some((l) => l.indexOf('too old') !== -1), d.lines.join(' | '));
      h.check('no scare note when the sibling cooperates', d.note === '');
    });
  })

  .then(() => scan({
    entities: bigLibrary(),
    siblingSettings: { a3AutoMergeOnSceneUpdate: false, a4AutoMergeOnPerformerUpdate: false },
  })).then(({ d }) => {
    h.check('a sibling with auto-merge off is not mentioned at all',
      !d().lines.some((l) => l.indexOf('Merge Performer Tags To Scenes') !== -1), d().lines.join(' | '));
  })

  // The sibling's manifest keys gained ordering prefixes at its 1.1.1. An older
  // copy answers with the unprefixed names, and failing to notice it would drop
  // the warning silently - the one direction that matters.
  .then(() => scan({
    entities: bigLibrary(),
    siblingSettings: { autoMergeOnPerformerUpdate: true },
  })).then(({ d }) => {
    h.check('a pre-1.1.1 sibling is still detected under its old setting keys',
      d().lines.some((l) => l.indexOf('Auto Merge On Performer Updates') !== -1),
      d().lines.join(' | '));
  })

  // ── Log handling ─────────────────────────────────────────────────────────
  .then(() => {
    const copied = [];
    // Over the 1000-line render cap, which is the case the cap exists for.
    const list = [];
    for (let i = 1; i <= 1200; i++) {
      list.push({ id: String(i), title: 'S' + i, organized: false, tags: [{ id: '1' }, { id: '2' }] });
    }
    return scan({
      entities: { findScenes: { node: 'scenes', list: list } },
      clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } },
    }).then(({ env, d }) => {
      const rendered = d().lines.length;
      h.check('only the log tail is rendered', rendered <= 1000 && rendered > 0, 'rendered ' + rendered);
      h.check('the dialog says how much is hidden',
        d().progress.indexOf('showing the last 1000 of') !== -1, d().progress);
      d().button('Copy log').click();
      return h.flush(5).then(() => {
        h.check('Copy log copies every line, not the rendered tail',
          copied.length === 1 && copied[0].split('\n').length > rendered,
          'copied ' + (copied[0] || '').split('\n').length + ' vs rendered ' + rendered);
        // The counter in the progress line describes the log as it stands, and a
        // Rescan empties it. Counting the export buffer instead reported tens of
        // thousands of lines over a view holding four, and claimed to be hiding
        // the difference.
        d().button('Rescan').click();
        return h.flush(200).then(() => {
          const progress = d().progress;
          h.check('a rescan counts its own log lines, not the whole session',
            /Review complete\. \d+ entity change\(s\) planned, 120\d log line\(s\)/.test(progress),
            progress);
          // Its caption is still "Copied" from the click above, and the dialog
          // helper finds buttons by their text.
          (d().button('Copy log') || d().button('Copied')).click();
          return h.flush(5).then(() => {
            h.check('while Copy log still hands over both passes',
              copied.length === 2 &&
              copied[1].split('\n').length > copied[0].split('\n').length,
              'first ' + copied[0].split('\n').length +
              ', second ' + (copied[1] || '').split('\n').length);
          });
        });
      });
    });
  })

  .then(() => scan({ entities: bigLibrary() })).then(({ env, d }) => {
    d().button('Proceed').click();
    return h.flush().then(() => {
      const before = env.calls.length;
      d().button('Rescan').click();
      return h.flush().then(() => {
        h.check('Rescan re-reads settings and re-scans', env.calls.length > before &&
          env.calls.slice(before).some((c) => /query NPT_findScenes/.test(c.query || '')));
        h.check('Rescan returns the dialog to the review state',
          d().visible('Proceed') && !d().visible('Close'));
        h.check('Rescan keeps the earlier log', d().lines.some((l) => l.indexOf('--- Rescan ---') !== -1),
          d().lines.slice(0, 2).join(' | '));
      });
    });
  })

  // The warning tells the user to turn the sibling's auto-merge off and rescan.
  // Leaving it up after they have done exactly that says the run is still unsafe
  // when it is not, so every pass re-derives the note from the settings it just
  // loaded rather than only ever adding to it.
  .then(() => {
    const list = [{ id: '1', title: 'S1', organized: false, tags: [{ id: '1' }, { id: '2' }] }];
    let pass = 0;
    const inner = h.makeResponder({ entities: { findScenes: { node: 'scenes', list: list } } });
    const env = h.makeEnv({ quiet: true, respond: (req, calls) => {
      if ((req.query || '').indexOf('configuration') !== -1) {
        pass++;
        const plugins = { NormalizeParentTags: { a5EnableScenes: true } };
        if (pass === 1) plugins.MergePerformerTagsToScenes = { a3AutoMergeOnSceneUpdate: true };
        return { data: { configuration: { plugins } } };
      }
      return inner(req, calls);
    } });
    h.run(env.ctx);
    h.startTask(env.ctx, h.TASK_PRUNE);
    const d = () => h.dialog(env.body);
    return h.flush().then(() => {
      h.check('the sibling warning is on the dialog while it applies',
        d().note.indexOf('Merge Performer Tags To Scenes') !== -1, d().note);
      d().button('Proceed').click();
      return h.flush().then(() => {
        d().button('Rescan').click();
        return h.flush().then(() => {
          h.check('and is gone once the setting it warns about is off',
            d().note === '', d().note);
        });
      });
    });
  })

  // ── The closing tag summary ──────────────────────────────────────────────
  .then(() => scan({ entities: bigLibrary() })).then(({ d }) => {
    const planned = d().lines[d().lines.length - 1];
    h.check('the review summary counts every entity per tag',
      planned === '[INFO] 2 tag(s) to remove: "Body" (4) x3, "Hair Colour" (1) x250', planned);
    d().button('Proceed').click();
    return h.flush().then(() => {
      const applied = d().lines[d().lines.length - 1];
      h.check('the run ends with what was actually written',
        applied === '[INFO] 2 tag(s) removed: "Body" (4) x3, "Hair Colour" (1) x250', applied);
    });
  })

  // The recap is where a run enumerates the tags it is about to change, so it is
  // where a tag can say what it *is* - the sibling viewer's tooltip, on the line the
  // Proceed decision is actually made from.
  .then(() => scan({ entities: bigLibrary(), tagDetail: [
    { id: '1', name: 'Hair Colour', aliases: ['Hair Color', 'Haircolour'],
      description: 'Colour of the\n  hair, natural or dyed.' },
    { id: '4', name: 'Body', aliases: [], description: null },
  ] })).then(({ env, d }) => {
    const detail = env.calls.filter((c) => /NPTTagDetail/.test(c.query || ''));
    h.check('the detail query is scoped to the tags the recap names',
      detail.length === 1 && detail[0].variables.ids.slice().sort().join() === '1,4',
      JSON.stringify(detail.map((c) => c.variables)));
    const detailQuery = (detail[0] || {}).query || '';
    h.check('and asks for the two fields the hierarchy query does not',
      /aliases/.test(detailQuery) && /description/.test(detailQuery), detailQuery);

    const tips = recapTips(env, 'to remove');
    h.check('a tag with aliases and a description hovers to them',
      tips.length === 1 && tips[0].text.indexOf('"Hair Colour" (1)') === 0 &&
      tips[0].title === 'Hair Colour\nStash tag id 1\nAliases: Hair Color, Haircolour\n' +
        'Description: Colour of the hair, natural or dyed.', JSON.stringify(tips));
    // Nothing marks which tags hover, so a hover that opens has to say something the
    // line does not already.
    h.check('a tag with neither is left plain',
      !tips.some((t) => t.text.indexOf('Body') !== -1), JSON.stringify(tips));
    // The spans exist to hang a title on. Styling them read as decoration in a log
    // that has none elsewhere, so the recap has to look like every other line.
    h.check('and the tags are not styled, only titled',
      recapSpans(env, 'to remove').every((n) => !n.className), 
      recapSpans(env, 'to remove').map((n) => n.className).join('|'));
    h.check('and the line itself is unchanged as text',
      d().lines[d().lines.length - 1] ===
        '[INFO] 2 tag(s) to remove: "Body" (4) x3, "Hair Colour" (1) x250',
      d().lines[d().lines.length - 1]);

    // The apply's own recap is a second pass over the same tags, and a second query.
    d().button('Proceed').click();
    return h.flush().then(() => {
      h.check('the applied recap hovers too',
        recapTips(env, 'removed').length === 1, JSON.stringify(recapTips(env, 'removed')));
    });
  })

  // A tooltip is worth a query, not a run: the recap must read the same when the
  // query fails, and must not spend an [ERROR] line on it.
  .then(() => scan({ entities: bigLibrary(), failTagDetail: true })).then(({ env, d }) => {
    const planned = d().lines[d().lines.length - 1];
    h.check('a failed detail query still leaves the recap',
      planned === '[INFO] 2 tag(s) to remove: "Body" (4) x3, "Hair Colour" (1) x250', planned);
    h.check('and says nothing about it',
      !d().lines.some((l) => l.indexOf('[ERROR]') === 0), d().lines.join(' | '));
    h.check('and nothing hovers', recapTips(env, 'to remove').length === 0);
  })

  // The 250-entity delta is three chunks; failing the one holding id 1 must take
  // 100 entities off that tag's count and leave the other tag alone.
  .then(() => scan({
    entities: bigLibrary(),
    failBulk: (req) => req.variables.input.ids.indexOf('1') !== -1,
  })).then(({ d }) => {
    d().button('Proceed').click();
    return h.flush().then(() => {
      const applied = d().lines[d().lines.length - 1];
      h.check('a failed batch is not summarised as written',
        applied === '[INFO] 2 tag(s) removed: "Body" (4) x3, "Hair Colour" (1) x150', applied);
    });
  })

  // The reported case: a run that applied tens of thousands of lines, then a
  // rescan that finds nothing. The four lines it logs are the whole of the log,
  // and there is nothing hidden to announce.
  .then(() => {
    const dirty = Array.from({ length: 5 }, (_, i) =>
      ({ id: String(i + 1), title: 'S' + (i + 1), organized: false, tags: [{ id: '1' }, { id: '2' }] }));
    const clean = dirty.map((s) => ({ id: s.id, title: s.title, organized: false, tags: [{ id: '2' }] }));
    let pass = 0;
    const env = h.makeEnv({ quiet: true, respond: (req, calls) => {
      if (/query NPT_findScenes/.test(req.query || '')) {
        pass++;
        const list = pass > 1 ? clean : dirty;
        return { data: { findScenes: {
          count: list.length, scenes: req.variables.page === 1 ? list : [],
        } } };
      }
      return h.makeResponder({ entities: {} })(req, calls);
    } });
    h.run(env.ctx);
    h.startTask(env.ctx, h.TASK_PRUNE);
    const d = () => h.dialog(env.body);
    return h.flush().then(() => {
      d().button('Proceed').click();
      return h.flush().then(() => {
        d().button('Rescan').click();
        return h.flush(200).then(() => {
          h.check('a rescan that finds nothing reports only its own lines',
            d().progress.indexOf('Review complete. 0 entity change(s) planned, 4 log line(s)') === 0,
            d().progress);
          h.check('and does not claim to be hiding any',
            d().progress.indexOf('showing the last') === -1, d().progress);
        });
      });
    });
  })

  // The log buffer has no Clear: the dialog offers only Copy log, and Rescan is
  // what empties the rendered view for the next pass.
  .then(() => scan({ entities: bigLibrary() })).then(({ d }) => {
    h.check('the run dialog offers no Clear log button', !d().button('Clear log'));
  })

  // The other end of the lease. The sibling's library-wide task takes one while it
  // writes, so a run started on top of it has to say so - the same warning the
  // sibling's task raises about ours.
  .then(() => {
    const env = h.makeEnv({ quiet: true, respond: h.makeResponder({ entities: bigLibrary() }) });
    env.ctx.window.StashPluginCoop = {
      leases: [{
        owner: 'MergePerformerTagsToScenes',
        label: 'Merge Performer Tags into All Their Scenes',
        until: Date.now() + 60000,
      }],
      respecters: { MergePerformerTagsToScenes: true },
    };
    h.run(env.ctx);
    h.startTask(env.ctx, h.TASK_PRUNE);
    return h.flush().then(() => {
      const d = h.dialog(env.body);
      h.check('a lease held by another plugin is warned about',
        d.lines.some((l) => l.indexOf('[WARN]') === 0 &&
          l.indexOf('applying bulk changes right now') !== -1), d.lines.join(' | '));
      h.check('and the warning names who holds it and for what',
        d.note.indexOf('MergePerformerTagsToScenes') !== -1 &&
        d.note.indexOf('Merge Performer Tags into All Their Scenes') !== -1, d.note);
      // Advisory, not blocking: this is a manual action either way.
      h.check('but the review still runs', d.button('Proceed').disabled === false);
    });
  })

  .then(() => scan({ entities: bigLibrary() })).then(({ d }) => {
    h.check('no lease means no note', d().note === '', d().note);
  })

  // ── Undo ─────────────────────────────────────────────────────────────────
  //
  // The reversal is the same mutations with ADD and REMOVE swapped, so what matters
  // is that it is a delta rather than a restore, that it only ever covers writes the
  // server accepted, and that it cannot fire on one click.
  .then(() => scan({ entities: bigLibrary() })).then(({ env, d }) => {
    h.check('nothing to undo before anything is written', !d().visible('Undo'));
    d().button('Proceed').click();
    return h.flush().then(() => {
      const applied = h.bulkCalls(env.calls).length;
      h.check('Undo is offered once the apply has written', d().visible('Undo') && applied === 4);

      // One click arms and writes nothing: Undo starts a library-wide write next to
      // Copy log, Rescan and Close.
      d().button('Undo').click();
      return h.flush(5).then(() => {
        h.check('the first click only arms, naming the scope',
          h.bulkCalls(env.calls).length === applied && d().visible('Undo 253 change(s)?'),
          d().button('Undo') ? 'still plain' : 'armed');

        d().button('Undo 253 change(s)?').click();
        return h.flush().then(() => {
          const undo = h.bulkCalls(env.calls).slice(applied);
          h.check('the undo issues one mutation per applied batch', undo.length === 4,
            'got ' + undo.length);
          h.check('and every one of them is the inverse mode',
            undo.every((c) => c.variables.input.tag_ids.mode === 'ADD'),
            JSON.stringify(undo.map((c) => c.variables.input.tag_ids.mode)));
          // A rewritten tag list would revert whatever else changed since; a delta
          // touches only what the run wrote.
          h.check('the undo writes deltas, not whole tag lists',
            undo.every((c) => Array.isArray(c.variables.input.tag_ids.ids) &&
              Array.isArray(c.variables.input.ids)));
          h.check('it reverses the same entities the apply wrote',
            undo.reduce((n, c) => n + c.variables.input.ids.length, 0) === 253);
          h.check('the log records the reversal',
            d().lines.some((l) => l.indexOf('[ADD] Undo - ') === 0), d().lines.join(' | ').slice(0, 200));
          h.check('and the closing line says everything was taken back',
            d().lines.some((l) => l.indexOf('Everything this dialog wrote has been taken back') !== -1),
            d().lines.join(' | ').slice(-200));
          h.check('Undo disappears once there is nothing left to reverse', !d().visible('Undo'));
          h.check('the dialog is closable again', d().visible('Close') && d().visible('Rescan'));
        });
      });
    });
  })

  // Prune removes, so its undo adds; Roll Up adds, so its undo removes. The inverse
  // is read off what was written, not off which task is running.
  .then(() => scan({
    entities: {
      findScenes: {
        node: 'scenes',
        list: [{ id: '20', title: 'Leaf', organized: false, tags: [{ id: '3' }] }],
      },
    },
  }, h.TASK_ROLLUP)).then(({ env, d }) => {
    d().button('Proceed').click();
    return h.flush().then(() => {
      const applied = h.bulkCalls(env.calls);
      h.check('a roll up writes ADD',
        applied.length === 1 && applied[0].variables.input.tag_ids.mode === 'ADD');
      d().button('Undo').click();
      return h.flush(5).then(() => {
        h.check('the roll up arms with its own count', d().visible('Undo 1 change(s)?'),
          'armed caption wrong');
        d().button('Undo 1 change(s)?').click();
        return h.flush().then(() => {
          const undo = h.bulkCalls(env.calls).slice(applied.length);
          h.check("a roll up's undo removes what it added",
            undo.length === 1 && undo[0].variables.input.tag_ids.mode === 'REMOVE',
            JSON.stringify(undo.map((c) => c.variables.input.tag_ids.mode)));
          h.check('taking back exactly the tags it added',
            undo[0].variables.input.tag_ids.ids.join(',') ===
            applied[0].variables.input.tag_ids.ids.join(','),
            JSON.stringify(undo[0].variables.input.tag_ids.ids));
        });
      });
    });
  })

  // A batch the server refused was never applied, so it must not be reversed either.
  .then(() => {
    let seen = 0;
    const responder = h.makeResponder({ entities: bigLibrary() });
    const env = h.makeEnv({
      quiet: true,
      respond: (req, calls) => {
        // Fail the second of the four apply batches.
        if (/mutation NPT_bulk/.test(req.query || '') && ++seen === 2) {
          return { errors: [{ message: 'nope' }] };
        }
        return responder(req, calls);
      },
    });
    h.run(env.ctx);
    h.startTask(env.ctx, h.TASK_PRUNE);
    return h.flush().then(() => {
      const d = () => h.dialog(env.body);
      d().button('Proceed').click();
      return h.flush().then(() => {
        h.check('a failed batch drops out of what Undo offers',
          d().visible('Undo 153 change(s)?') === false && d().visible('Undo'));
        d().button('Undo').click();
        return h.flush(5).then(() => {
          h.check('the armed count covers only the batches that landed',
            d().visible('Undo 153 change(s)?'), 'armed caption wrong');
          d().button('Undo 153 change(s)?').click();
          return h.flush().then(() => {
            const undo = h.bulkCalls(env.calls).filter(
              (c) => c.variables.input.tag_ids.mode === 'ADD');
            h.check('and the undo reverses only those',
              undo.reduce((n, c) => n + c.variables.input.ids.length, 0) === 153);
          });
        });
      });
    });
  })

  // The lease covers the undo too: it is a bulk write like any other.
  .then(() => {
    const seen = [];
    const responder = h.makeResponder({ entities: bigLibrary() });
    let env;
    env = h.makeEnv({
      quiet: true,
      respond: (req, calls) => {
        const held = ((env.ctx.window.StashPluginCoop || {}).leases || []);
        seen.push({
          undo: /mutation NPT_bulk/.test(req.query || '') &&
            (req.variables.input.tag_ids || {}).mode === 'ADD',
          leases: held.length,
          label: held.length ? held[0].label : null,
        });
        return responder(req, calls);
      },
    });
    h.run(env.ctx);
    h.startTask(env.ctx, h.TASK_PRUNE);
    return h.flush().then(() => {
      const d = () => h.dialog(env.body);
      d().button('Proceed').click();
      return h.flush().then(() => {
        d().button('Undo').click();
        return h.flush(5).then(() => {
          d().button('Undo 253 change(s)?').click();
          return h.flush().then(() => {
            const during = seen.filter((s) => s.undo);
            h.check('a lease is held across the undo',
              during.length === 4 && during.every((s) => s.leases === 1),
              JSON.stringify(during));
            h.check('and it names itself as an undo',
              during.every((s) => s.label === h.TASK_PRUNE + ' (undo)'), JSON.stringify(during[0]));
            h.check('released when the undo finishes',
              (env.ctx.window.StashPluginCoop.leases || []).length === 0);
          });
        });
      });
    });
  })

  // Rescan starts a pass, not a session: the record of what earlier passes wrote is
  // exactly what Undo is for, and converging must not cost it.
  .then(() => scan({ entities: bigLibrary() })).then(({ d }) => {
    d().button('Proceed').click();
    return h.flush().then(() => {
      d().button('Rescan').click();
      return h.flush().then(() => {
        // The rescan lands in ready, holding a fresh plan over a library the first
        // pass already changed - the moment Undo is most likely to be wanted.
        h.check('a rescan keeps what Undo can still reverse',
          d().visible('Undo') && d().visible('Proceed'));
        d().button('Undo').click();
        return h.flush(5).then(() => {
          h.check('and still offers the whole session', d().visible('Undo 253 change(s)?'),
            'armed caption wrong');
          d().button('Undo 253 change(s)?').click();
          return h.flush().then(() => {
            // The reviewed plan predates the reversal, so Proceed must not stay armed
            // over ground that has just moved.
            h.check('undoing from ready ends in done, not back at Proceed',
              d().visible('Rescan') && d().visible('Close') && !d().visible('Proceed'));
          });
        });
      });
    });
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
