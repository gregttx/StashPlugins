// SceneVariants: the Siblings panel.
//
// The plugin makes no mutation, so there is nothing to assert about writes. What is
// worth pinning is the shape of the answer: which scenes it decides are siblings, what
// order it puts them in, what it calls each one, and the three cases where it correctly
// shows nothing at all.
//
// The tab strip fixture is reproduced from a live Stash the same way
// `tests/tagclip.test.js` reproduces it - by the Edit tab's `data-rb-event-key`, since
// a scene page renders a second element whose text is exactly "Edit".
'use strict';
const path = require('path');
const h = require('./npt-harness');

const SRC = process.env.SRC || path.join(__dirname, '..', 'SceneVariants', 'SceneVariants.js');

// Scene 42, one stash-id, three siblings sharing it: a full-length one, a partial and
// an untagged one, deliberately returned in an order the panel has to change.
const SIBLINGS = [
  { id: '42', title: 'Cool Shoot - Clip 2', tags: [{ id: '2', name: 'Partial Length' }],
    files: [{ duration: 243, width: 1920, height: 1080 }] },
  { id: '77', title: 'Cool Shoot - Clip 1', tags: [{ id: '2', name: '  partial length  ' }],
    files: [{ duration: 300, width: 1280, height: 720 }] },
  { id: '9', title: 'Cool Shoot', tags: [{ id: '1', name: 'Full Length' }],
    files: [{ duration: 2472, width: 1920, height: 1080 }] },
  // Longer than the full-length one on purpose: role has to outrank running time, or
  // a duration-only sort would pass this fixture by accident.
  { id: '55', title: 'Cool Shoot (rip)', tags: [],
    files: [{ duration: 2500, width: 3840, height: 2160 }] },
];

function responder(opts) {
  return (req) => {
    const q = req.query;
    if (q.indexOf('configuration { plugins }') !== -1) {
      return { data: { configuration: { plugins: { SceneVariants: Object.assign({
        a1FullLengthTag: 'Full Length',
        a2PartialLengthTag: 'Partial Length',
      }, opts.settings) } } } };
    }
    if (q.indexOf('SVRScene') !== -1) {
      return { data: { findScene: {
        id: '42', title: 'Cool Shoot - Clip 2',
        stash_ids: opts.stashIds === undefined
          ? [{ endpoint: 'https://stashdb.org/graphql', stash_id: 'abc' }]
          : opts.stashIds,
      } } };
    }
    if (q.indexOf('SVRSiblings') !== -1) {
      if (opts.siblingsFail) return { errors: [{ message: 'unknown field stash_ids_endpoint' }] };
      return { data: { findScenes: { scenes: opts.siblings || SIBLINGS } } };
    }
    return { data: {} };
  };
}

// The scene page's tab strip: the entity's own is the one whose Edit tab carries a
// `*-edit-panel` key, and it is preceded here by a decoy that has neither, exactly as a
// Gallery page renders two.
function tabStrip(body) {
  const decoy = h.makeElement('div');
  decoy.className = 'nav nav-tabs';
  const decoyTab = h.makeElement('a');
  decoyTab.setAttribute('data-rb-event-key', 'images');
  decoyTab.textContent = 'Edit';
  decoy.appendChild(decoyTab);
  body.appendChild(decoy);

  const wrap = h.makeElement('div');
  const strip = h.makeElement('div');
  strip.className = 'mr-auto nav nav-tabs';
  const tab = h.makeElement('a');
  tab.setAttribute('data-rb-event-key', 'scene-edit-panel');
  tab.textContent = 'Edit';
  strip.appendChild(tab);
  wrap.appendChild(strip);
  body.appendChild(wrap);
  return { wrap, strip };
}

function start(opts) {
  opts = opts || {};
  const warnings = [];
  const env = h.makeEnv({
    quiet: true,
    pathname: opts.pathname || '/scenes/42',
    respond: opts.respond || responder(opts),
  });
  env.warnings = warnings;
  env.ctx.console = { log() {}, info() {}, error() {}, warn: (m) => warnings.push(String(m)) };
  h.run(env.ctx, SRC);
  return env;
}

const panel = (body) => body.descendants().filter((n) => n.id === 'svr-panel')[0] || null;
const rows = (p) => (p ? p.childNodes.slice(1) : []);
const titles = (p) => rows(p).map((r) => r.childNodes[0].textContent);
const roleOf = (row) => {
  const span = row.childNodes.filter((n) => (n.className || '').indexOf('svr-role') === 0)[0];
  return span ? span.className.replace('svr-role svr-role-', '') + ':' + span.textContent : null;
};

(async function () {
  {
    const env = start();
    tabStrip(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    const p = panel(env.body);
    h.check('the panel is drawn on a scene with siblings', !!p);
    h.check('the scene being viewed is not listed as its own sibling',
      titles(p).indexOf('Cool Shoot - Clip 2') === -1, titles(p).join(' | '));
    // Full-length first even though the untagged rip is the longer file, then by running
    // time: the rip outranks the 5-minute partial.
    h.check('full-length first, then longest',
      JSON.stringify(titles(p)) ===
        JSON.stringify(['Cool Shoot', 'Cool Shoot (rip)', 'Cool Shoot - Clip 1']),
      titles(p).join(' | '));
    h.check('the head counts the siblings and says what matched them on',
      p.childNodes[0].textContent === '3 other scenes are the same work — matched on 1 stash-id',
      p.childNodes[0].textContent);
    // The one thing in the query that is neither a guess nor a preference. The stash IDs
    // criterion accepts four modifiers and rejects the rest outright, INCLUDES among
    // them - which is the natural guess for a list criterion, is what every other list
    // filter in Stash takes, and is what shipped and failed on a live server. EQUALS
    // over a list ORs the ids, which is the "any of these" the panel needs.
    const sibQuery = env.calls.filter((c) => c.query.indexOf('SVRSiblings') !== -1)[0].query;
    h.check('the sibling query asks with EQUALS, the modifier the server accepts',
      sibQuery.indexOf('modifier: EQUALS') !== -1 && sibQuery.indexOf('INCLUDES') === -1,
      sibQuery);
    h.check('each row links to its scene',
      rows(p).map((r) => r.childNodes[0].href).join(' ') === '/scenes/9 /scenes/55 /scenes/77',
      rows(p).map((r) => r.childNodes[0].href).join(' '));
  }

  {
    const env = start();
    const fx = tabStrip(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    const p = panel(env.body);
    h.check('the panel sits after the entity\'s own strip, not the decoy',
      p.parentNode === fx.wrap &&
        fx.wrap.childNodes.indexOf(p) === fx.wrap.childNodes.indexOf(fx.strip) + 1);
    h.check('a full-length sibling is named and marked',
      roleOf(rows(p)[0]) === 'fl:Full Length', roleOf(rows(p)[0]));
    h.check('an untagged sibling is listed with no role at all',
      roleOf(rows(p)[1]) === null, roleOf(rows(p)[1]));
    // The stored tag name is padded and lower-cased; these are typed into a settings
    // box by hand, so a comparison that respected either would classify nothing.
    h.check('the tag match ignores case and surrounding space',
      roleOf(rows(p)[2]) === 'pl:Partial Length', roleOf(rows(p)[2]));
  }

  {
    // Both tags on one scene is a contradiction rather than a tie: the two values are
    // mutually exclusive by definition, so it is reported rather than resolved by
    // whichever test ran first.
    const env = start({ siblings: [
      { id: '9', title: 'Confused', tags: [{ id: '1', name: 'Full Length' },
        { id: '2', name: 'Partial Length' }], files: [{ duration: 60 }] },
    ] });
    tabStrip(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    h.check('a scene carrying both tags is flagged rather than classified',
      roleOf(rows(panel(env.body))[0]) === 'bad:both tags',
      roleOf(rows(panel(env.body))[0]));
  }

  {
    const env = start({ settings: { a1FullLengthTag: '', a2PartialLengthTag: '' } });
    tabStrip(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    const p = panel(env.body);
    h.check('with no tag names configured the panel still lists the siblings',
      titles(p).length === 3, titles(p).join(' | '));
    h.check('and classifies none of them',
      rows(p).every((r) => roleOf(r) === null));
  }

  {
    const env = start({ stashIds: [] });
    tabStrip(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    h.check('a scene with no stash-id gets no panel', !panel(env.body));
    h.check('and the sibling query is never sent',
      env.calls.every((c) => c.query.indexOf('SVRSiblings') === -1),
      env.calls.map((c) => c.query.slice(0, 30)).join(' | '));
  }

  {
    const env = start({ siblings: [] });
    tabStrip(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    h.check('a scene whose stash-id nobody shares gets no panel', !panel(env.body));
  }

  {
    // A filter field named differently on this Stash looks exactly like "there was
    // nothing to show", and only one of those is worth reporting - so the failure is
    // loud whatever the logging setting says.
    const env = start({ siblingsFail: true });
    tabStrip(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    h.check('a failed sibling query draws no panel', !panel(env.body));
    h.check('and says so on the console without being asked',
      env.warnings.some((w) => w.indexOf('sibling lookup failed for scene 42') !== -1),
      env.warnings.join(' | '));
  }

  {
    const env = start();
    tabStrip(env.body);
    await h.flush();
    env.tick();
    await h.flush();
    const first = panel(env.body);
    const queries = env.calls.filter((c) => c.query.indexOf('SVR') !== -1).length;
    env.tick();
    env.tick();
    await h.flush();
    h.check('ticking again neither duplicates the panel nor replaces it',
      env.body.descendants().filter((n) => n.id === 'svr-panel').length === 1 &&
        panel(env.body) === first);
    h.check('and asks the server nothing further',
      env.calls.filter((c) => c.query.indexOf('SVR') !== -1).length === queries,
      String(env.calls.filter((c) => c.query.indexOf('SVR') !== -1).length));

    env.ctx.location.pathname = '/performers/3';
    env.tick();
    await h.flush();
    h.check('leaving the scene page takes the panel with it', !panel(env.body));
  }

  h.finish();
}());
