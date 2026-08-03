// The hierarchy viewer: a read-only third task. What matters is that it never
// writes, that it draws a DAG as a tree without duplicating or looping, that the
// badges reflect the filters actually configured, and that the exports are
// well-formed.
'use strict';
const h = require('./npt-harness');

const TASK_TREE = 'Show Tag Hierarchy';

//        Root (1)                Loose (7, no parents, no children)
//        ├── Mid (2)
//        │   ├── Leaf (3)        also a child of Other (6)  -> a diamond
//        │   └── Skip (4)        name contains "Skip"
//        └── Other (6)
//            └── Leaf (3)        repeat
const TAGS = [
  { id: '1', name: 'Root', ignore_auto_tag: false, parents: [] },
  { id: '2', name: 'Mid', ignore_auto_tag: false, parents: [{ id: '1' }] },
  { id: '3', name: 'Leaf', ignore_auto_tag: false, parents: [{ id: '2' }, { id: '6' }] },
  { id: '4', name: 'Skip', ignore_auto_tag: false, parents: [{ id: '2' }] },
  { id: '6', name: 'Other', ignore_auto_tag: false, parents: [{ id: '1' }] },
  { id: '7', name: 'Loose', ignore_auto_tag: false, parents: [] },
];

function open(opts) {
  opts = opts || {};
  const env = h.makeEnv({
    quiet: true,
    clipboard: opts.clipboard,
    respond: (req) => {
      const q = req.query || '';
      if (q.indexOf('configuration') !== -1) {
        return { data: { configuration: { plugins: { NormalizeParentTags: opts.settings || {} } } } };
      }
      if (/NPTTagCounts/.test(q)) {
        if (opts.failCounts) return { errors: [{ message: 'too expensive' }] };
        return { data: { findTags: { tags: [
          { id: '1', scene_count: 12, image_count: 0, gallery_count: 0, performer_count: 3 },
          { id: '3', scene_count: 0, image_count: 0, gallery_count: 0, performer_count: 0 },
        ] } } };
      }
      if (/NPTTags/.test(q)) return { data: { findTags: { tags: opts.tags || TAGS } } };
      return { data: {} };
    },
  });
  h.run(env.ctx);
  h.startTask(env.ctx, TASK_TREE);
  return h.flush().then(() => ({ env, d: () => h.dialog(env.body) }));
}

// The viewer's rows are not npt-line nodes, so read them straight off the body.
const rows = (env) => env.body.descendants()
  .filter((n) => h.hasClass(n, 'npt-row'))
  .map((n) => n.textContent);
const rowFor = (env, name) => env.body.descendants()
  .filter((n) => h.hasClass(n, 'npt-row') && n.textContent.indexOf(name + ' (') !== -1)[0] || null;
const inspector = (env) => (env.body.descendants()
  .filter((n) => h.hasClass(n, 'npt-inspect'))[0] || {}).textContent || '';
const btn = (env, label) => env.body.descendants()
  .filter((n) => n.tagName === 'BUTTON' && n.textContent === label)[0] || null;

Promise.resolve()

  .then(() => open()).then(({ env, d }) => {
    h.check('the viewer never queries anything but settings and tags',
      env.calls.every((c) => /configuration|NPTTags/.test(c.query || '')),
      env.calls.map((c) => (c.query || '').slice(0, 30)).join(' | '));
    h.check('and issues no mutation at all',
      !env.calls.some((c) => /mutation/.test(c.query || '')));

    const r = rows(env);
    // Roots open, everything below them closed: both roots plus Root's own two
    // children, with those children collapsed. Roots sort in Stash's order, so
    // Loose leads Root.
    h.check('roots are open and their children collapsed',
      r.length === 4 && r[0].indexOf('Loose (7)') !== -1 && r[1].indexOf('Root (1)') !== -1 &&
      r[2].indexOf('▸') === 0 && r[2].indexOf('Mid (2)') !== -1, r.join(' | '));
    h.check('nothing below the second level is drawn yet',
      !r.some((l) => l.indexOf('Leaf (3)') !== -1 || l.indexOf('Skip (4)') !== -1), r.join(' | '));
    h.check('the header counts the hierarchy',
      d().progress.indexOf('6 tag(s), 2 root(s)') === 0, d().progress);
  })

  .then(() => open()).then(({ env }) => {
    btn(env, 'Expand all').click();
    const r = rows(env);
    // Leaf hangs off both Mid and Other. It must appear under each - once as the
    // real node, once as a pointer - and never expand a second subtree.
    const leafRows = r.filter((l) => l.indexOf('Leaf (3)') !== -1);
    h.check('a tag with two parents appears under both', leafRows.length === 2, r.join(' | '));
    h.check('one of them is marked as the repeat, not drawn twice',
      leafRows.filter((l) => l.indexOf('↩ shown under') !== -1).length === 1, leafRows.join(' | '));
    h.check('and the real one is marked as a diamond',
      leafRows.some((l) => l.indexOf('◆ 2 parents') !== -1), leafRows.join(' | '));
    h.check('every tag is reachable once expanded',
      ['Root (1)', 'Mid (2)', 'Skip (4)', 'Other (6)', 'Loose (7)']
        .every((n) => r.some((l) => l.indexOf(n) !== -1)), r.join(' | '));
    h.check('leaves and child counts are labelled',
      r.some((l) => l.indexOf('Root (1)') !== -1 && l.indexOf('2 child(ren)') !== -1) &&
      r.some((l) => l.indexOf('Loose (7)') !== -1 && l.indexOf('leaf') !== -1), r.join(' | '));
  })

  // Badges have to come from the filters actually configured, or the viewer would
  // be a second opinion about the run rather than a window onto it.
  .then(() => open({ settings: { c3ExcludeRemoveTagNameContains: 'Skip' } })).then(({ env }) => {
    btn(env, 'Expand all').click();
    const r = rows(env);
    h.check('a protected tag says which filter protects it',
      r.some((l) => l.indexOf('Skip (4)') !== -1 && l.indexOf('⛔ never removed: name filter') !== -1),
      r.join(' | '));
    h.check('and an unprotected sibling says nothing',
      r.some((l) => l.indexOf('Mid (2)') !== -1 && l.indexOf('⛔') === -1), r.join(' | '));
  })

  .then(() => open({ settings: { c1ExcludeTagWithIgnoreAutoTag: true },
    tags: TAGS.map((t) => (t.id === '2' ? Object.assign({}, t, { ignore_auto_tag: true }) : t)) }))
    .then(({ env }) => {
      btn(env, 'Expand all').click();
      h.check('ignore_auto_tag is named as the reason in both directions',
        rows(env).some((l) => l.indexOf('Mid (2)') !== -1 &&
          l.indexOf('never removed: Ignore auto tag') !== -1 &&
          l.indexOf('never added: Ignore auto tag') !== -1), rows(env).join(' | '));
    })

  // A cycle cannot be reached from any root, so a tree that only walked downwards
  // from roots would hide exactly the tags the run refuses to touch.
  .then(() => open({ tags: [
    { id: '1', name: 'Root', ignore_auto_tag: false, parents: [] },
    { id: '8', name: 'Ping', ignore_auto_tag: false, parents: [{ id: '9' }] },
    { id: '9', name: 'Pong', ignore_auto_tag: false, parents: [{ id: '8' }] },
  ] })).then(({ env }) => {
    const r = rows(env);
    h.check('tags in a cycle are surfaced rather than hidden',
      r.some((l) => l.indexOf('Ping (8)') !== -1) && r.some((l) => l.indexOf('Pong (9)') !== -1),
      r.join(' | '));
    h.check('and are badged as a cycle',
      r.filter((l) => l.indexOf('⚠ cycle') !== -1).length === 2, r.join(' | '));
  })

  // The inspector is the "why" half: it has to answer in terms of the two tasks.
  .then(() => open()).then(({ env }) => {
    rowFor(env, 'Root').click();
    const i = inspector(env);
    h.check('the inspector lists descendants of the selected tag',
      i.indexOf('All descendants') !== -1 && i.indexOf('"Mid" (2)') !== -1, i);
    h.check('and says what Prune would do with it',
      i.indexOf('Prune removes this from any entity that also carries one of its 4 descendant(s)') !== -1, i);
    h.check('and that Roll Up has nothing to add above a root',
      i.indexOf('Roll Up adds nothing for this tag') !== -1, i);
  })

  .then(() => open()).then(({ env }) => {
    btn(env, 'Expand all').click();
    rowFor(env, 'Loose').click();
    const i = inspector(env);
    h.check('a childless tag is reported as never pruned',
      i.indexOf('Prune never removes this: it has no descendants') !== -1, i);
  })

  .then(() => open({ settings: { c3ExcludeRemoveTagNameContains: 'Root' } })).then(({ env }) => {
    rowFor(env, 'Root').click();
    h.check('a protected tag says so instead of promising a removal',
      inspector(env).indexOf('Prune would leave this in place - protected: name filter') !== -1,
      inspector(env));
  })

  // Search is how a four-level namespace scheme stays usable at a few thousand tags.
  .then(() => open()).then(({ env, d }) => {
    const input = env.body.descendants().filter((n) => h.hasClass(n, 'npt-search-input'))[0];
    const type = (v) => {
      input.value = v;
      (input.handlers.input || []).forEach((fn) => fn({}));
      return rows(env);
    };
    const r = type('Le');
    h.check('search flattens to the matching tags', r.length === 1 &&
      r[0].indexOf('Leaf (3)') !== -1, r.join(' | '));
    h.check('and says how many matched', d().progress.indexOf('1 of 6 tag(s) match "Le"') === 0,
      d().progress);
    // A find-as-you-type box nobody types the exact case into.
    h.check('a match is case-insensitive',
      type('leaf').length === 1 && type('LEAF').length === 1 && type('lEaF').length === 1,
      type('leaf').join(' | '));
    h.check('and matches anywhere in the name, not just the start',
      type('oot').length === 1 && type('oot')[0].indexOf('Root (1)') !== -1, type('oot').join(' | '));
    h.check('a substring spanning nothing matches nothing', type('zzz').length === 0);

    // The clear affordance only exists while there is something to clear.
    const clear = env.body.descendants()
      .filter((n) => h.hasClass(n, 'npt-search-clear'))[0];
    h.check('the clear icon is offered once the box has text', !h.hasClass(clear, 'npt-hidden'));
    clear.click();
    h.check('clicking it empties the box', input.value === '');
    h.check('and restores the whole tree', rows(env).length === 4, rows(env).join(' | '));
    h.check('and hides itself again', h.hasClass(clear, 'npt-hidden'), clear.className);
  })

  .then(() => open()).then(({ env }) => {
    const clear = env.body.descendants()
      .filter((n) => h.hasClass(n, 'npt-search-clear'))[0];
    h.check('the clear icon starts hidden', !!clear && h.hasClass(clear, 'npt-hidden'),
      clear && clear.className);
    h.check('and is labelled for what it does', clear.title === 'Clear filter', clear.title);
  })

  // ── Find ─────────────────────────────────────────────────────────────────
  //
  // Find navigates where filter reduces: the tree stays a tree, the path to the
  // match is opened, and the row is brought to the middle of the view.
  .then(() => open()).then(({ env }) => {
    const find = env.body.descendants().filter((n) => h.hasClass(n, 'npt-find-input'))[0];
    const count = () => (env.body.descendants()
      .filter((n) => h.hasClass(n, 'npt-find-count'))[0] || {}).textContent;
    const type = (v) => {
      find.value = v;
      (find.handlers.input || []).forEach((fn) => fn({}));
    };
    const enter = () => (find.handlers.keydown || []).forEach((fn) => fn({ key: 'Enter' }));

    // Leaf sits two levels down, under Mid, under Root - all collapsed at open.
    type('leaf');
    const r = rows(env);
    h.check('find opens the path to the match rather than flattening the tree',
      r.length > 4 && r.some((l) => l.indexOf('Root (1)') !== -1) &&
      r.some((l) => l.indexOf('Mid (2)') !== -1) &&
      r.some((l) => l.indexOf('Leaf (3)') !== -1), r.join(' | '));
    h.check('the match is selected',
      env.body.descendants().some((n) => h.hasClass(n, 'npt-row-sel') &&
        n.textContent.indexOf('Leaf (3)') !== -1));
    h.check('and centred in the view',
      (rowFor(env, 'Leaf').scrolledIntoView || {}).block === 'center',
      JSON.stringify(rowFor(env, 'Leaf').scrolledIntoView));
    h.check('with a position among the matches', count() === '1 of 1', count());

    // "o" hits Root, Other and Loose - Enter walks them in Stash's order and wraps.
    type('o');
    h.check('a partial match counts every hit', count() === '1 of 3', count());
    enter();
    h.check('Enter advances to the next match', count() === '2 of 3', count());
    enter(); enter();
    h.check('and wraps at the end', count() === '1 of 3', count());

    type('zzz');
    h.check('no match says so rather than jumping somewhere', count() === 'no match', count());
  })

  // Find has to put the tree back if a filter had replaced it with a flat list,
  // or "show me where this lives" has nowhere to show it.
  .then(() => open()).then(({ env }) => {
    const filter = env.body.descendants().filter((n) => h.hasClass(n, 'npt-search-input'))[0];
    filter.value = 'Leaf';
    (filter.handlers.input || []).forEach((fn) => fn({}));
    h.check('the filter has flattened the tree first', rows(env).length === 1);

    const find = env.body.descendants().filter((n) => h.hasClass(n, 'npt-find-input'))[0];
    find.value = 'skip';
    (find.handlers.input || []).forEach((fn) => fn({}));
    h.check('finding clears the filter', filter.value === '');
    h.check('and shows the match in its place in the tree',
      rows(env).some((l) => l.indexOf('Root (1)') !== -1) &&
      rows(env).some((l) => l.indexOf('Skip (4)') !== -1), rows(env).join(' | '));
  })

  // ── Export ───────────────────────────────────────────────────────────────
  .then(() => {
    const copied = [];
    return open({ clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } })
      .then(({ env }) => {
        btn(env, 'Copy as DOT').click();
        return h.flush(5).then(() => {
          const dot = copied[0] || '';
          h.check('DOT exports the whole hierarchy by default',
            dot.indexOf('digraph tags {') === 0 && dot.indexOf('}') !== -1 &&
            dot.indexOf('"1" [label="Root"];') !== -1, dot.slice(0, 120));
          h.check('with an edge per parent, both of a diamond included',
            dot.indexOf('"2" -> "3";') !== -1 && dot.indexOf('"6" -> "3";') !== -1, dot);
          h.check('and no edge to a tag outside the export',
            dot.split('\n').filter((l) => l.indexOf('->') !== -1).length === 5, dot);
        });
      });
  })

  .then(() => {
    const copied = [];
    return open({ clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } })
      .then(({ env }) => {
        btn(env, 'Expand all').click();
        rowFor(env, 'Mid').click();
        btn(env, 'Copy as Mermaid').click();
        return h.flush(5).then(() => {
          const mmd = copied[0] || '';
          // Mid's neighbourhood is Root (ancestor), Leaf and Skip (descendants).
          h.check('Mermaid exports the selection when there is one',
            mmd.indexOf('graph LR') === 0 && mmd.indexOf('t2[') !== -1 &&
            mmd.indexOf('t1[') !== -1 && mmd.indexOf('t3[') !== -1 &&
            mmd.indexOf('t7[') === -1, mmd);
          h.check('and drops edges whose other end is not in the selection',
            mmd.indexOf('t6 --> t3') === -1, mmd);
        });
      });
  })

  // ── Counts ───────────────────────────────────────────────────────────────
  .then(() => open()).then(({ env }) => {
    h.check('counts are not fetched until asked for',
      !env.calls.some((c) => /NPTTagCounts/.test(c.query || '')));
    btn(env, 'Load counts').click();
    return h.flush(50).then(() => {
      const q = env.calls.filter((c) => /NPTTagCounts/.test(c.query || ''))[0] || {};
      h.check('the count query pins depth to the tag itself',
        (q.query || '').indexOf('scene_count(depth: 0)') !== -1, q.query);
      const r = rows(env);
      h.check('counts appear on the rows that have them',
        r.some((l) => l.indexOf('Root (1)') !== -1 && l.indexOf('12 scenes · 3 performers') !== -1),
        r.join(' | '));
    });
  })

  .then(() => open({ failCounts: true })).then(({ env, d }) => {
    btn(env, 'Load counts').click();
    return h.flush(50).then(() => {
      h.check('a failed count query is reported and leaves the tree usable',
        d().progress.indexOf('Counts could not be loaded') === 0 && rows(env).length === 4,
        d().progress);
    });
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
