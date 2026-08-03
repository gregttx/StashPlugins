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

function scan(opts, task) {
  const env = h.makeEnv({ quiet: true, respond: h.makeResponder(opts), clipboard: opts.clipboard });
  h.run(env.ctx);
  h.startTask(env.ctx, task || h.TASK_PRUNE);
  return h.flush().then(() => ({ env, d: () => h.dialog(env.body) }));
}

Promise.resolve()

  .then(() => scan({ entities: bigLibrary() })).then(({ env, d }) => {
    h.check('phase 1 writes nothing', h.bulkCalls(env.calls).length === 0);
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

  // ── Clear log ────────────────────────────────────────────────────────────
  .then(() => {
    const copied = [];
    return scan({
      entities: bigLibrary(),
      clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } },
    }).then(({ env, d }) => {
      const planned = d().lines.length;
      h.check('Clear log is offered during review', d().visible('Clear log') && planned > 0);
      d().button('Clear log').click();
      // Past LOG_FLUSH_MS, or the marker line is still in the pending buffer.
      return h.flush(150).then(() => {
        h.check('during review one click clears the log',
          d().lines.length === 1 && d().lines[0].indexOf('Log cleared') !== -1,
          d().lines.join(' | '));
        d().button('Copy log').click();
        return h.flush(5).then(() => {
          h.check('Copy log exports the cleared buffer, not the old lines',
            copied.length === 1 && copied[0].indexOf('Log cleared') !== -1 &&
            copied[0].indexOf('Hair Colour') === -1, copied[0]);
          // Clearing is a log-buffer operation: the plan behind Proceed survives it.
          h.check('clearing the log does not clear the plan',
            d().button('Proceed').disabled === false);
          d().button('Proceed').click();
          return h.flush().then(() => {
            h.check('and Proceed still writes the whole plan',
              h.bulkCalls(env.calls).reduce((n, c) => n + c.variables.input.ids.length, 0) === 253);
          });
        });
      });
    });
  })

  .then(() => scan({ entities: bigLibrary() })).then(({ d }) => {
    d().button('Proceed').click();
    return h.flush().then(() => {
      const written = d().lines.length;
      d().button('Clear log').click();
      return h.flush(5).then(() => {
        // The log is the only record of what phase 2 wrote, so the first click
        // asks rather than discarding it.
        h.check('once something is written the first click only arms',
          d().lines.length === written && d().visible('Clear log?'), d().lines.length + ' lines');
        d().button('Clear log?').click();
        return h.flush(150).then(() => {
          h.check('the second click clears', d().lines.length === 1 &&
            d().lines[0].indexOf('Log cleared') !== -1, d().lines.join(' | '));
          h.check('and the caption goes back', d().visible('Clear log') && !d().button('Clear log?'));
        });
      });
    });
  })

  // A Rescan resets the counters but keeps the log, so the record of what the
  // first pass wrote is still in there and clearing must still ask.
  .then(() => scan({ entities: bigLibrary() })).then(({ d }) => {
    d().button('Proceed').click();
    return h.flush().then(() => {
      d().button('Clear log').click();          // arms
      d().button('Rescan').click();             // and is disarmed by the rescan
      return h.flush().then(() => {
        h.check('a rescan disarms the button', d().visible('Clear log') && !d().button('Clear log?'));
        const kept = d().lines.length;
        d().button('Clear log').click();
        return h.flush(5).then(() => {
          h.check('a rescan does not make the earlier writes forgettable',
            d().lines.length === kept && d().visible('Clear log?'), d().lines.length + ' lines');
        });
      });
    });
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
