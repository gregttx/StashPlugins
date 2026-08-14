// PropagateTagsAndPerformers phase 2, and the Undo that reverses it.
//
// The two are one subject: the undo is the apply replayed with REMOVE in place of
// ADD, so anything that changes how a batch is built changes both. The rules this
// suite exists to hold are that nothing is written before Proceed, that every write
// is a delta rather than a rewritten list, that only writes the server accepted are
// counted or reversed, and that a bulk run announces itself with a lease.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const NAME = 'PropagateTagsAndPerformers';
const SRC = process.env.SRC || path.join(__dirname, '..', NAME, NAME + '.js');
const PREFIX = 'ptp2re';
const TASK = 'Propagate Tags and Performers to All Related Entities...';

const TAGS = [
  { id: '1', name: 'Hair Colour', sort_name: null, ignore_auto_tag: false },
  { id: '2', name: 'Blonde', sort_name: null, ignore_auto_tag: false },
  { id: '3', name: 'Outdoor', sort_name: null, ignore_auto_tag: false },
];

function responder(opts) {
  opts = opts || {};
  const lib = opts.library || {};
  return function (req, calls) {
    const q = req.query || '';
    if (/PluginVersion/.test(q)) return { data: { plugins: [] } };
    if (q.indexOf('configuration') !== -1) {
      const plugins = {};
      plugins[NAME] = opts.settings || {};
      return { data: { configuration: { plugins } } };
    }
    if (/PTPTags/.test(q)) return { data: { findTags: { tags: opts.tags || TAGS } } };
    const find = /query PTP_(\w+)\(/.exec(q);
    if (find) {
      const spec = lib[find[1]] || { node: 'scenes', list: [] };
      const out = { count: spec.list.length };
      out[spec.node] = req.variables.page === 1 ? spec.list : [];
      const data = {};
      data[find[1]] = out;
      return { data: data };
    }
    const bulk = /mutation PTP_(\w+)\(/.exec(q);
    if (bulk) {
      if (opts.failBulk && opts.failBulk(req, calls)) return { errors: [{ message: 'bulk boom' }] };
      if (opts.onBulk) opts.onBulk(req, calls);
      const data = {};
      data[bulk[1]] = req.variables.input.ids.map((id) => ({ id }));
      return { data: data };
    }
    return { data: {} };
  };
}

function boot(opts) {
  const env = h.makeEnv({ quiet: true, respond: responder(opts) });
  h.run(env.ctx, SRC);
  return env;
}

// Opens the dialog and lets the review finish, leaving it in `ready`.
function review(opts) {
  const env = boot(opts);
  return h.startTask(env.ctx, TASK, NAME).then(() => h.flush(120)).then(() => ({
    env, d: h.dialog(env.ctx.document.body, PREFIX),
  }));
}

const bulks = (calls) => calls.filter((c) => /mutation PTP_bulk/.test(c.query || ''));

// Phase 1 and phase 2 log the same kinds of line - they describe the same changes,
// once as a plan and once as a fact - and the "Applying ..." header is what separates
// them. A check that read the whole log would see the plan and think it saw a write.
function appliedLines(d) {
  const at = d.lines.findIndex((l) => /^\[INFO\] Applying /.test(l));
  return at === -1 ? [] : d.lines.slice(at + 1);
}

// One scene wanting one tag from its performers, and a second wanting a different
// one, so batching has something to group and something to keep apart.
const LIB = {
  findScenes: { node: 'scenes', list: [
    { id: '10', title: 'One', tags: [], organized: false,
      performers: [{ id: '100', name: 'Jane', tags: [{ id: '2' }] }] },
    { id: '11', title: 'Two', tags: [], organized: false,
      performers: [{ id: '100', name: 'Jane', tags: [{ id: '2' }] }] },
    { id: '12', title: 'Three', tags: [], organized: false,
      performers: [{ id: '101', name: 'Ada', tags: [{ id: '3' }] }] },
  ] },
};
const SETTINGS = { b1TagsPerformersToScenes: true };

Promise.resolve()

  // ── Nothing is written before Proceed ─────────────────────────────────────
  .then(() => review({ settings: SETTINGS, library: LIB })).then(({ env, d }) => {
    h.check('the review writes nothing', bulks(env.calls).length === 0,
      bulks(env.calls).length + ' mutations');
    h.check('and reports how many requests the apply will take',
      d.lines.some((l) => /2 requests?/.test(l)),
      d.lines.filter((l) => /Review complete/.test(l)).join('\n'));
  })

  .then(() => {
    // A stale script disables Proceed, and `proceed()` refuses again on its own.
    // Two lines of defence because the first is a DOM attribute: a keyboard
    // activation, a click landing before setState re-applies, or a stale reference
    // must not reach a write with code the user has already replaced.
    const env = h.makeEnv({
      quiet: true,
      respond: (req) => (/PluginVersion/.test(req.query || '')
        ? { data: { plugins: [{ id: NAME, version: '9.9.9' }] } }
        : responder({ settings: SETTINGS, library: LIB })(req)),
    });
    h.run(env.ctx, SRC);
    return h.startTask(env.ctx, TASK, NAME).then(() => h.flush(120)).then(() => {
      const d = h.dialog(env.ctx.document.body, PREFIX);
      h.check('a stale script has a plan but a disabled Proceed',
        d.button('Proceed').disabled === true && /9\.9\.9/.test(d.note), d.note);
      d.button('Proceed').click();
      return h.flush(60).then(() => {
        h.check('and clicking it anyway writes nothing', bulks(env.calls).length === 0,
          bulks(env.calls).length + ' mutations');
      });
    });
  })

  // ── The apply ─────────────────────────────────────────────────────────────
  .then(() => review({ settings: SETTINGS, library: LIB })).then(({ env, d }) => {
    d.button('Proceed').click();
    return h.flush(120).then(() => {
      const w = bulks(env.calls);
      // Two scenes want the same tag and are written together; the third wants a
      // different one and cannot join them. Grouping by delta is what turns tens of
      // thousands of mutations into a few hundred on a real library.
      h.check('entities wanting the same addition are written together', w.length === 2,
        w.length + ' mutations');
      const first = w.filter((c) => c.variables.input.ids.length === 2)[0];
      h.check('the shared batch carries both scenes',
        !!first && first.variables.input.ids.slice().sort().join() === '10,11',
        first ? first.variables.input.ids.join() : 'no batch of two');
      // A delta, never a rewritten list: a tag someone added from another tab between
      // the scan and the apply is not silently reverted, which a full list built from
      // phase-1 data would do.
      h.check('and goes out as an ADD delta',
        w.every((c) => c.variables.input.tag_ids && c.variables.input.tag_ids.mode === 'ADD'),
        JSON.stringify(w[0] && w[0].variables.input));
      h.check('carrying only the ids being added',
        !!first && first.variables.input.tag_ids.ids.join() === '2',
        first ? first.variables.input.tag_ids.ids.join() : '');
    });
  })

  .then(() => review({ settings: SETTINGS, library: LIB })).then(({ env, d }) => {
    d.button('Proceed').click();
    return h.flush(120).then(() => {
      const dd = h.dialog(env.ctx.document.body, PREFIX);
      h.check('the apply logs a line per entity per addition',
        appliedLines(dd).filter((l) => /^\[TAG\] Scene .* - Tag /.test(l)).length === 3,
        'got ' + appliedLines(dd).filter((l) => /^\[TAG\]/.test(l)).length);
      // Attribution is held on the plan entry, not recomputed: by phase 2 the sources
      // are long out of scope, and a batch groups entities that wanted the same tag
      // for different reasons - so it is read per entry, not per batch.
      h.check('and each names the entity responsible, as the plan did',
        appliedLines(dd).some((l) =>
          /^\[TAG\] Scene "One" \(10\) - Tag "Blonde" \(2\) - from Performer "Jane" \(100\)$/.test(l)),
        appliedLines(dd).filter((l) => /^\[TAG\]/.test(l)).join('\n'));
      h.check('and reports what landed', dd.lines.some((l) => /3 entity changes? applied/.test(l)),
        dd.lines.filter((l) => /Finished/.test(l)).join('\n'));
      // A finished run is not a settled library: the plan was computed before the
      // first write, so anything that changed during phase 2 is invisible to it.
      h.check('and points at Rescan rather than declaring the library settled',
        dd.lines.some((l) => /Press Rescan to review what is left/.test(l)));
      h.check('the footer moves to done',
        dd.visible('Rescan') && dd.visible('Close') && dd.visible('Undo') &&
        !dd.visible('Proceed') && !dd.visible('Stop'),
        ['Proceed', 'Stop', 'Rescan', 'Close', 'Undo'].filter((b) => dd.visible(b)).join(' '));
    });
  })

  // ── Performers write into their own field ─────────────────────────────────
  .then(() => review({
    settings: { b5PerformersGalleriesToScenes: true },
    library: { findScenes: { node: 'scenes', list: [
      { id: '10', title: 'One', tags: [], organized: false, performers: [],
        galleries: [{ id: '30', performers: [{ id: '101', name: 'Ada' }] }] },
    ] } },
  })).then(({ env, d }) => {
    d.button('Proceed').click();
    return h.flush(120).then(() => {
      const w = bulks(env.calls);
      h.check('a performer addition writes performer_ids, not tag_ids',
        w.length === 1 && !!w[0].variables.input.performer_ids &&
        !w[0].variables.input.tag_ids &&
        w[0].variables.input.performer_ids.mode === 'ADD',
        JSON.stringify(w[0] && w[0].variables.input));
    });
  })

  // ── Each target uses its own mutation ─────────────────────────────────────
  .then(() => review({
    settings: { b1TagsPerformersToScenes: true, e3TagsStudioToGroups: true },
    library: {
      findScenes: { node: 'scenes', list: [
        { id: '10', title: 'One', tags: [], organized: false,
          performers: [{ id: '100', tags: [{ id: '2' }] }] },
      ] },
      findGroups: { node: 'groups', list: [
        { id: '20', name: 'Series', tags: [], studio: { id: '200', tags: [{ id: '3' }] } },
      ] },
    },
  })).then(({ env, d }) => {
    d.button('Proceed').click();
    return h.flush(120).then(() => {
      const names = bulks(env.calls).map((c) => /mutation PTP_(\w+)\(/.exec(c.query)[1]);
      h.check('scenes and groups go through their own bulk mutations',
        names.slice().sort().join() === 'bulkGroupUpdate,bulkSceneUpdate', names.join());
    });
  })

  // ── A failed batch is isolated ────────────────────────────────────────────
  .then(() => review({
    settings: SETTINGS, library: LIB,
    // The batch of two fails; the single one must still be written.
    failBulk: (req) => req.variables.input.ids.length === 2,
  })).then(({ env, d }) => {
    d.button('Proceed').click();
    return h.flush(120).then(() => {
      const dd = h.dialog(env.ctx.document.body, PREFIX);
      h.check('a failed batch is logged as an error',
        dd.lines.some((l) => /^\[ERROR\].*bulkSceneUpdate failed for 2 entities/.test(l)),
        dd.lines.filter((l) => /ERROR/.test(l)).join('\n'));
      // None of its entities changed, so none of them may be logged as changed -
      // they are still in the *plan* above the "Applying" line, which is correct and
      // is why this reads only the lines after it.
      h.check('and none of its entities are logged as written',
        !appliedLines(dd).some((l) => /^\[TAG\] Scene "One"/.test(l)) &&
        appliedLines(dd).some((l) => /^\[TAG\] Scene "Three"/.test(l)),
        appliedLines(dd).filter((l) => /^\[TAG\]/.test(l)).join('\n'));
      h.check('the run carries on to the next batch',
        dd.lines.some((l) => /1 entity changes? applied, 2 failed/.test(l)),
        dd.lines.filter((l) => /Finished/.test(l)).join('\n'));
      // Counted from what the server accepted, not from the plan: a recap that
      // summarised the plan would report tags that never landed.
      const recap = dd.lines.filter((l) => /tags? added/.test(l))[0] || '';
      h.check('and the applied recap counts only what landed',
        /1 tags? added: "Outdoor" \(3\) x1/.test(recap), recap);
    });
  })

  .then(() => review({
    settings: SETTINGS, library: LIB,
    failBulk: (req) => req.variables.input.ids.length === 2,
  })).then(({ env, d }) => {
    d.button('Proceed').click();
    return h.flush(120).then(() => {
      const dd = h.dialog(env.ctx.document.body, PREFIX);
      // Held rather than looked up again: arming changes the caption, so
      // `button('Undo')` stops finding it the moment it is clicked.
      const undoBtn = dd.button('Undo');
      undoBtn.click();
      return h.flush(5).then(() => {
        // The armed caption states the scope. A failed batch was never recorded, so
        // it is not offered for reversal either.
        h.check('Undo arms with the count of what actually landed',
          /^Undo 1 changes?\?$/.test(undoBtn.textContent), undoBtn.textContent);
        h.check('and writes nothing on the first click',
          bulks(env.calls).filter((c) => /REMOVE/.test(JSON.stringify(c.variables))).length === 0);
      });
    });
  })

  // ── Undo ──────────────────────────────────────────────────────────────────
  .then(() => review({ settings: SETTINGS, library: LIB })).then(({ env, d }) => {
    d.button('Proceed').click();
    return h.flush(120).then(() => {
      const dd = h.dialog(env.ctx.document.body, PREFIX);
      const before = bulks(env.calls).length;
      const undoBtn = dd.button('Undo');
      undoBtn.click();
      undoBtn.click();
      return h.flush(120).then(() => {
        const undoWrites = bulks(env.calls).slice(before);
        h.check('a second click within the window carries the reversal out',
          undoWrites.length === 2, undoWrites.length + ' mutations');
        // A delta, not a restore: it takes back precisely what this run added and
        // touches nothing else, which is what lets it run over a library that has
        // moved on - and what stops it being a substitute for a backup.
        h.check('every reversal is a REMOVE delta',
          undoWrites.every((c) => c.variables.input.tag_ids.mode === 'REMOVE'),
          JSON.stringify(undoWrites[0] && undoWrites[0].variables.input));
        h.check('carrying only the ids this run added',
          undoWrites.every((c) => c.variables.input.tag_ids.ids.length === 1));
        // Newest first is the order that composes: a rescan-and-apply cycle can write
        // to one entity twice, and taking the second write back first is the only
        // sequence that lands where the run started.
        h.check('newest batch first',
          undoWrites[0].variables.input.ids.join() === '12', undoWrites[0].variables.input.ids.join());
        const ddd = h.dialog(env.ctx.document.body, PREFIX);
        h.check('and the log says everything was taken back',
          ddd.lines.some((l) => /Everything this dialog wrote has been taken back/.test(l)),
          ddd.lines.filter((l) => /Undo finished/.test(l)).join('\n'));
        h.check('the recap names what was removed again',
          ddd.lines.some((l) => /tags? removed again/.test(l)),
          ddd.lines.filter((l) => /removed again/.test(l)).join('\n'));
        // The same line as the apply, marked as its reversal. Which entity was
        // responsible is exactly what the user is checking when they read an Undo,
        // and the entry carries it, so nothing has to be recomputed to say it.
        h.check('and each reversal names what the addition came from',
          ddd.lines.some((l) =>
            /^\[TAG\] Undo - Scene "One" \(10\) - Tag "Blonde" \(2\) - from Performer "Jane" \(100\)$/
              .test(l)),
          ddd.lines.filter((l) => /Undo - /.test(l)).join('\n'));
        h.check('and Undo is no longer offered', !ddd.visible('Undo'));
      });
    });
  })

  .then(() => review({ settings: SETTINGS, library: LIB })).then(({ env, d }) => {
    d.button('Proceed').click();
    return h.flush(120).then(() => {
      const dd = h.dialog(env.ctx.document.body, PREFIX);
      const before = bulks(env.calls).length;
      const undoBtn = dd.button('Undo');
      undoBtn.click();
      // Let the arming window lapse. The second click then re-arms rather than
      // writing, which is the whole point of the latch.
      return new Promise((r) => setTimeout(r, 4200)).then(() => {
        undoBtn.click();
        return h.flush(10).then(() => {
          h.check('an expired arm does not write',
            bulks(env.calls).length === before, 'wrote ' + (bulks(env.calls).length - before));
        });
      });
    });
  })

  .then(() => review({ settings: SETTINGS, library: LIB })).then(({ env, d }) => {
    // An undo is a bulk write like any other, so it announces itself the same way -
    // and names itself as an undo, since a plugin standing down deserves to know
    // which direction it is standing down for.
    const seen = [];
    const coop = env.ctx.window.StashPluginCoop;
    const origPush = coop.leases.push;
    coop.leases.push = function (l) { seen.push(l.label); return origPush.apply(this, arguments); };
    d.button('Proceed').click();
    return h.flush(120).then(() => {
      const dd = h.dialog(env.ctx.document.body, PREFIX);
      const undoBtn = dd.button('Undo');
      undoBtn.click();
      undoBtn.click();
      return h.flush(120).then(() => {
        h.check('the apply takes a lease named for the task', seen[0] === TASK, seen.join(' | '));
        h.check('and the undo takes one named as an undo',
          seen[1] === TASK + ' (undo)', seen.join(' | '));
        // Released in every outcome, so a reactive plugin is never left standing down.
        h.check('both are released when they finish',
          env.ctx.window.StashPluginCoop.leases.length === 0,
          JSON.stringify(env.ctx.window.StashPluginCoop.leases));
      });
    });
  })

  // ── Stop ──────────────────────────────────────────────────────────────────
  .then(() => {
    let dlg = null;
    const env = boot({
      settings: SETTINGS, library: LIB,
      // Pressed from inside the responder on the first write, so the moment it lands
      // does not depend on how many ticks a flush happens to take.
      onBulk: () => { if (dlg) dlg.button('Stop').click(); },
    });
    return h.startTask(env.ctx, TASK, NAME).then(() => h.flush(120)).then(() => {
      const d = h.dialog(env.ctx.document.body, PREFIX);
      dlg = d;
      d.button('Proceed').click();
      return h.flush(120).then(() => {
        const dd = h.dialog(env.ctx.document.body, PREFIX);
        h.check('Stop halts after the current request', bulks(env.calls).length === 1,
          bulks(env.calls).length + ' mutations');
        h.check('and says what has already been written stays written',
          dd.lines.some((l) => /stopped early; changes already applied stay applied/.test(l)),
          dd.lines.filter((l) => /Finished/.test(l)).join('\n'));
        h.check('and the dialog still finishes in done', dd.visible('Close'));
        // What was written can still be taken back - the batch was recorded on
        // success, and Stop does not discard the record.
        h.check('and Undo is offered for what did land', dd.visible('Undo'));
      });
    });
  })

  // ── Rescan ────────────────────────────────────────────────────────────────
  .then(() => review({ settings: SETTINGS, library: LIB })).then(({ env, d }) => {
    d.button('Proceed').click();
    return h.flush(120).then(() => {
      const dd = h.dialog(env.ctx.document.body, PREFIX);
      const linesBefore = dd.lines.length;
      dd.button('Rescan').click();
      return h.flush(150).then(() => {
        const ddd = h.dialog(env.ctx.document.body, PREFIX);
        h.check('a rescan keeps the rendered log', ddd.lines.length > linesBefore,
          ddd.lines.length + ' vs ' + linesBefore);
        h.check('and marks where the fresh review starts',
          ddd.lines.some((l) => /--- Rescan ---/.test(l)));
        h.check('and the lines the earlier pass wrote are still on screen',
          ddd.lines.some((l) => /^\[INFO\] Applying /.test(l)), ddd.lines.length + ' lines');
        h.check('and Rescan says what it keeps',
          /The log is kept/.test(ddd.button('Rescan').title || ''),
          ddd.button('Rescan').title);
        // Converging on an empty plan is the normal way to finish a run, and losing
        // the ability to undo at exactly that moment would be the worst time for it.
        h.check('and keeps what can still be undone', ddd.visible('Undo'),
          ['Undo', 'Proceed'].filter((b) => ddd.visible(b)).join(' '));
      });
    });
  })

  .then(() => {
    let copied = null;
    const env = h.makeEnv({
      quiet: true, respond: responder({ settings: SETTINGS, library: LIB }),
      clipboard: { writeText: (t) => { copied = t; return Promise.resolve(); } },
    });
    h.run(env.ctx, SRC);
    return h.startTask(env.ctx, TASK, NAME).then(() => h.flush(120)).then(() => {
      const d = h.dialog(env.ctx.document.body, PREFIX);
      d.button('Proceed').click();
      return h.flush(120).then(() => {
        const dd = h.dialog(env.ctx.document.body, PREFIX);
        dd.button('Rescan').click();
        return h.flush(150).then(() => {
          h.dialog(env.ctx.document.body, PREFIX).button('Copy log').click();
          return h.flush(5).then(() => {
            // Copy log hands over the whole session, and so does the rendered log
            // now - the export buffer was the only half that survived a rescan.
            h.check('Copy log still carries the pass before the rescan',
              copied !== null && /--- Rescan ---/.test(copied) &&
              /entity changes? applied/.test(copied),
              copied === null ? 'nothing copied' : copied.split('\n').length + ' lines');
          });
        });
      });
    });
  })

  // ── The apply writes from the plan and reads nothing ──────────────────────
  .then(() => review({ settings: SETTINGS, library: LIB })).then(({ env, d }) => {
    const readsBefore = env.calls.filter((c) => /query PTP_/.test(c.query || '')).length;
    d.button('Proceed').click();
    return h.flush(120).then(() => {
      const readsAfter = env.calls.filter((c) => /query PTP_/.test(c.query || '')).length;
      // Phase 2 applies the plan the user approved and nothing else. Re-reading the
      // library here would mean writing something that was never reviewed - and it is
      // precisely what Rescan exists to do instead, deliberately and on request.
      h.check('phase 2 issues no reads of its own', readsAfter === readsBefore,
        (readsAfter - readsBefore) + ' extra queries');
      h.check('and every request it makes is a write',
        bulks(env.calls).length === 2, bulks(env.calls).length + ' mutations');
    });
  })

  .then(() => h.finish(), (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
