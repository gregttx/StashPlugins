// PropagateTagsAndPerformers' manual buttons and staging (D8, step 8).
//
// One button per enabled path whose target is the page being viewed, reusing the
// auto-mode machinery (AutoRun, autoContext) to plan one named entity rather than a
// second planner. A click either saves immediately (a2SaveImmediately) or - the
// default - stages into whichever form control (TagSelect / PerformerSelect) this
// plugin captured via PluginApi.patch.before, diffed against the form so a second
// click without saving reports nothing added.
//
// Placement (`.edit-buttons`) is unverified against a live Stash beyond the scene
// page - see PropagateTagsAndPerformers/CLAUDE.md §5b - so this suite is about the
// driver around that assumption, not proof the assumption holds.
'use strict';
const path = require('path');
const h = require('./npt-harness');

const NAME = 'PropagateTagsAndPerformers';
const SRC = process.env.SRC || path.join(__dirname, '..', NAME, NAME + '.js');

const TAGS = [
  { id: '1', name: 'Blonde', sort_name: null, ignore_auto_tag: false },
  { id: '2', name: 'Outdoor', sort_name: null, ignore_auto_tag: false },
];

// A scene with one performer carrying "Blonde", which the scene does not have yet.
const SCENE = {
  id: '10', title: 'S', files: [], tags: [], organized: false,
  performers: [{ id: '100', name: 'Jane', tags: [{ id: '1' }] }],
};

function responder(opts) {
  opts = opts || {};
  return function (req) {
    const q = req.query || '';
    if (q.indexOf('configuration') !== -1) {
      const plugins = {};
      plugins[NAME] = opts.settings || {};
      return { data: { configuration: { plugins } } };
    }
    if (/PTPTags/.test(q)) return { data: { findTags: { tags: opts.tags || TAGS } } };
    const m = /query PTP_one_(\w+)\(/.exec(q);
    if (m) {
      const data = {};
      data[m[1]] = opts.entity !== undefined ? opts.entity : SCENE;
      return { data };
    }
    if (/mutation PTP_bulk/.test(q)) {
      if (opts.failWrite) return { errors: [{ message: 'write boom' }] };
      return { data: { ok: [] } };
    }
    return { data: {} };
  };
}

function editButtonsContainer(env) {
  const c = h.makeElement('div');
  c.className = 'edit-buttons';
  env.body.appendChild(c);
  return c;
}

function start(opts) {
  opts = opts || {};
  const patches = {};
  const env = h.makeEnv({
    quiet: true, respond: responder(opts), pathname: opts.pathname || '/scenes/10',
  });
  env.ctx.PluginApi = { patch: { before: (n, fn) => { patches[n] = fn; } } };
  env.ctx.window.PluginApi = env.ctx.PluginApi;
  env.ctx.alert = (m) => { env.ctx._alert = m; };
  h.run(env.ctx, SRC);
  return { env, patches };
}

// Simulates Stash rendering the control on the open edit form - a capture is
// recorded the moment the plugin's before-patch runs, exactly as it would from a
// real render. `onSelect` has to be a real function: the plugin's capture guard
// requires one, the same way it would refuse to capture a read-only render.
function renderControl(patches, name, values) {
  patches[name]({ isMulti: true, values: values || [], onSelect: () => {} });
}

const manualButtons = (env) => (env.body.descendants() || [])
  .filter((n) => h.hasClass(n, 'ptp2re-manual-btn'));

const writes = (calls) => calls.filter((c) => /mutation PTP_bulk/.test(c.query || ''));

(async () => {
  // ── The button appears, labelled from the path table ────────────────────────
  {
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const btns = manualButtons(env);
    h.check('one button for the one enabled path into scenes', btns.length === 1,
      btns.map((b) => b.textContent).join(','));
    h.check('labelled from the path table, not a second copy of the string',
      btns[0].textContent === 'Add Perf Tags', btns[0].textContent);
  }

  // ── Restraint ───────────────────────────────────────────────────────────────
  {
    const { env } = start({ settings: { b1TagsPerformersToScenes: true } }); // a1 off
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('with the master toggle off, no button appears', manualButtons(env).length === 0);
  }
  {
    const { env } = start({ settings: { a1ShowManualButtons: true } }); // no path enabled
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('with no path into this page, no button appears', manualButtons(env).length === 0);
  }
  {
    // A path into galleries does not put a button on the scene page.
    const { env } = start({
      settings: { a1ShowManualButtons: true, c1TagsImagesToGalleries: true },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('a path into another target puts no button here', manualButtons(env).length === 0);
  }
  {
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
      pathname: '/settings?tab=plugins',
    });
    env.tick();
    await h.flush(60);
    h.check('off any of the four pages, no button appears', manualButtons(env).length === 0);
  }
  {
    // No .edit-buttons container yet (edit tab not open).
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    env.tick();
    await h.flush(60);
    h.check('with no container found, no button appears', manualButtons(env).length === 0);
  }

  // ── Multiple enabled paths into one page ─────────────────────────────────────
  {
    const { env } = start({
      settings: {
        a1ShowManualButtons: true,
        b1TagsPerformersToScenes: true, b2TagsStudioToScenes: true,
      },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const labels = manualButtons(env).map((b) => b.textContent).sort();
    h.check('one button per enabled path, not one that tries to name both',
      labels.join(',') === 'Add Perf Tags,Add Studio Tags', labels.join(','));
  }

  // ── Staging (the default) ────────────────────────────────────────────────────
  {
    const { env, patches } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    h.check('a TagSelect patch was registered', typeof patches.TagSelect === 'function');
    renderControl(patches, 'TagSelect', []);

    const btn = manualButtons(env)[0];
    btn.click();
    await h.flush(80);

    h.check('no mutation is issued while staging', writes(env.calls).length === 0);
    h.check('the button reports what it staged', /Added 1/.test(btn.textContent), btn.textContent);
  }
  {
    // A second click with nothing new to add reports "No changes" rather than
    // restaging the same tag a second time.
    const { env, patches } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    renderControl(patches, 'TagSelect', [{ id: '1', name: 'Blonde' }]); // already staged
    const btn = manualButtons(env)[0];
    btn.click();
    await h.flush(80);
    h.check('nothing left to add reports no changes', btn.textContent === 'No changes', btn.textContent);
  }
  {
    // No control captured at all - the edit tab was never rendered with one.
    const { env } = start({
      settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    btn.click();
    await h.flush(80);
    h.check('with no captured control the button recovers rather than sticking on "Working..."',
      btn.textContent === 'Add Perf Tags', btn.textContent);
    h.check('and reports the error', /open the Edit tab/.test(env.ctx._alert || ''), env.ctx._alert);
  }

  // ── Save immediately ─────────────────────────────────────────────────────────
  {
    const { env } = start({
      settings: {
        a1ShowManualButtons: true, a2SaveImmediately: true, b1TagsPerformersToScenes: true,
      },
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    btn.click();
    await h.flush(80);
    const w = writes(env.calls);
    h.check('save-immediately issues a bulk mutation', w.length === 1);
    h.check('as an ADD delta onto the one entity',
      w.length && w[0].variables.input.ids.join() === '10' &&
      w[0].variables.input.tag_ids.mode === 'ADD' &&
      w[0].variables.input.tag_ids.ids.join() === '1');
    h.check('the button reports what was written', /Added 1/.test(btn.textContent), btn.textContent);
  }
  {
    const { env } = start({
      settings: {
        a1ShowManualButtons: true, a2SaveImmediately: true, b1TagsPerformersToScenes: true,
      },
      entity: Object.assign({}, SCENE, { tags: [{ id: '1' }] }), // already has it
    });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const btn = manualButtons(env)[0];
    btn.click();
    await h.flush(80);
    h.check('nothing to add issues no mutation', writes(env.calls).length === 0);
    h.check('and reports no changes', btn.textContent === 'No changes', btn.textContent);
  }

  // ── Reconciling stale buttons ─────────────────────────────────────────────────
  {
    // A second tick with nothing changed must not duplicate the button - the
    // reconciler has to recognise its own button rather than tearing it down and
    // rebuilding it on every DOM mutation burst.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const first = manualButtons(env)[0];
    env.tick();
    await h.flush(60);
    h.check('a second tick with nothing changed does not duplicate the button',
      manualButtons(env).length === 1);
    h.check('and it is the same node, not a replacement', manualButtons(env)[0] === first);
  }
  {
    // Navigating to a different scene while the container is reused (the common SPA
    // case, one edit panel re-rendered with new props) drops the stale button rather
    // than leaving it claiming to be about the wrong entity.
    const { env } = start({ settings: { a1ShowManualButtons: true, b1TagsPerformersToScenes: true } });
    const container = editButtonsContainer(env);
    env.tick();
    await h.flush(60);
    const first = manualButtons(env)[0];
    h.check('the button is there for the first scene', !!first);

    env.ctx.location.pathname = '/scenes/11';
    env.tick();
    await h.flush(60);
    const now = manualButtons(env);
    h.check('exactly one button remains after navigating to a different scene', now.length === 1);
    h.check('it is a fresh button, not the one left over from scene 10',
      now[0] !== first && now[0].parentNode === container);
  }

  // ── The route matcher ─────────────────────────────────────────────────────────
  {
    const { env } = start({ settings: {} });
    const rt = env.ctx.window.__ptp2re.currentRouteTarget;
    env.ctx.location.pathname = '/galleries/42';
    h.check('a gallery route is recognised', rt().target === 'gallery' && rt().id === '42');
    env.ctx.location.pathname = '/images/7/foo';
    h.check('an image route with a trailing path is still recognised',
      rt().target === 'image' && rt().id === '7');
    env.ctx.location.pathname = '/performers/1';
    h.check('a route this plugin never writes to matches nothing', rt() === null);
  }

  h.finish();
})();
