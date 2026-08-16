// The hierarchy viewer: a read-only third task. What matters is that it never
// writes, that it draws a DAG as a tree without duplicating or looping, that the
// badges reflect the filters actually configured, and that the exports are
// well-formed.
'use strict';
const h = require('./npt-harness');

const TASK_TREE = 'Show Tag Hierarchy...';

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

// The same Leaf, hung off three parents: two only proves a badge toggles, three
// proves it walks the parents in order and wraps.
const DIAMOND = [
  { id: '1', name: 'Root', ignore_auto_tag: false, parents: [] },
  { id: '2', name: 'Mid', ignore_auto_tag: false, parents: [{ id: '1' }] },
  { id: '3', name: 'Leaf', ignore_auto_tag: false, parents: [{ id: '2' }, { id: '6' }, { id: '10' }] },
  { id: '6', name: 'Other', ignore_auto_tag: false, parents: [{ id: '1' }] },
  { id: '10', name: 'Zed', ignore_auto_tag: false, parents: [{ id: '1' }] },
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
      // What Stash says is installed, for the viewer's own version check. Absent
      // unless a case asks for it, so every other case exercises the unknown path.
      if (/NPTPluginVersion/.test(q)) {
        if (opts.failVersion) return { errors: [{ message: 'no such field' }] };
        return { data: { plugins: opts.installed
          ? [{ id: opts.installed.id, version: opts.installed.version }] : [] } };
      }
      if (/NPTTagCounts/.test(q)) {
        if (opts.failCounts) return { errors: [{ message: 'too expensive' }] };
        return { data: { findTags: { tags: [
          { id: '1', scene_count: 12, image_count: 0, gallery_count: 0, performer_count: 3 },
          { id: '3', scene_count: 0, image_count: 0, gallery_count: 0, performer_count: 0 },
        ] } } };
      }
      if (/NPTTags/.test(q)) {
        if (opts.failTags) return { errors: [{ message: 'database is locked' }] };
        return { data: { findTags: { tags: opts.tags || TAGS } } };
      }
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
// The row's tooltip: what a hover says about a tag beyond its own caption.
const tip = (env, name) => (((rowFor(env, name) || { descendants: () => [] }).descendants()
  .filter((n) => h.hasClass(n, 'npt-tag-name'))[0] || {}).title) || '';
const btn = (env, label) => env.body.descendants()
  .filter((n) => n.tagName === 'BUTTON' && n.textContent === label)[0] || null;

// Rows as nodes rather than text, for the jumps: which row was centred, and which
// branch it sits in, are the whole question there.
const rowNodes = (env) => env.body.descendants().filter((n) => h.hasClass(n, 'npt-row'));
const leafRows = (env) => rowNodes(env).filter((n) => n.textContent.indexOf('Leaf (3)') !== -1);
const centred = (env) => rowNodes(env).filter((n) => n.scrolledIntoView)[0] || null;
const badge = (row, mark) => (row ? row.descendants()
  .filter((n) => h.hasClass(n, 'npt-badge') && n.textContent.indexOf(mark) !== -1)[0] : null) || null;
// Every parent in these fixtures has one child, so the row above says which
// branch the jump landed in.
const branchOf = (env, row) => {
  const all = rowNodes(env);
  const i = all.indexOf(row);
  return i > 0 ? all[i - 1].textContent : '(none)';
};

Promise.resolve()

  .then(() => open()).then(({ env, d }) => {
    // Settings, the hierarchy, and the version check that tells a stale tab it is
    // one. Nothing per-tag, nothing per-entity: the point is that opening the viewer
    // costs a bounded, small number of queries however big the library is.
    h.check('the viewer never queries anything but settings, tags and its own version',
      env.calls.every((c) => /configuration|NPTTags|NPTPluginVersion/.test(c.query || '')),
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
      d().progress.indexOf('6 tags, 2 roots') === 0, d().progress);
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
      r.some((l) => l.indexOf('Root (1)') !== -1 && l.indexOf('2 children') !== -1) &&
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
      i.indexOf('Prune removes this from any entity that also carries one of its 4 descendants') !== -1, i);
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

  // Rows carry an id in brackets and badges carry counts outside them, on the same
  // line. Which is which has to be said, and no count may be written in brackets or
  // the head is describing a notation the rows do not follow.
  .then(() => open()).then(({ env, d }) => {
    h.check('the head says the bracketed number is a tag id',
      d().legend.indexOf('id') !== -1 && d().legend.indexOf('not a count') !== -1,
      d().legend);
    h.check('and the tag name repeats it as a tooltip',
      tip(env, 'Root').indexOf('Stash tag id 1') !== -1, tip(env, 'Root'));

    rowFor(env, 'Root').click();
    const i = inspector(env);
    h.check('the inspector counts its lists outside brackets',
      i.indexOf('All descendants: 4') !== -1, i);
    h.check('and never in them, where a number means a tag id',
      i.indexOf('All descendants (4)') === -1, i);
  })

  // The tooltip is the only place the viewer says what a tag *means* rather than
  // where it sits. Both fields are free text, so both are capped rather than trusted
  // to be short - a tag with forty aliases would otherwise cover the tree.
  .then(() => {
    const many = [];
    for (let i = 1; i <= 12; i++) many.push('A' + i);
    const long = 'Every hair colour that occurs naturally, plus the dyed ones that pass for ' +
      'natural, but not the ones nobody would mistake for a colour hair grows in - those hang ' +
      'off Unnatural Colour instead, which is a sibling of this tag rather than a child of it.';
    return open({ tags: [
      { id: '1', name: 'Root', ignore_auto_tag: false, parents: [],
        aliases: ['Alpha', 'Beta'], description: 'Top of\nthe   tree.' },
      { id: '2', name: 'Mid', ignore_auto_tag: false, parents: [{ id: '1' }],
        aliases: many, description: long },
      { id: '3', name: 'Bare', ignore_auto_tag: false, parents: [{ id: '1' }],
        aliases: [], description: null },
    ] }).then(({ env }) => {
      h.check('the tooltip names the tag and its aliases',
        tip(env, 'Root').indexOf('Root\nStash tag id 1\nAliases: Alpha, Beta') === 0,
        JSON.stringify(tip(env, 'Root')));
      // A description is a paragraph of free text; a tooltip line is a line.
      h.check('and its description, collapsed onto one line',
        tip(env, 'Root').indexOf('Description: Top of the tree.') !== -1,
        JSON.stringify(tip(env, 'Root')));
      h.check('a tag with neither says nothing about them',
        tip(env, 'Bare') === 'Bare\nStash tag id 3', JSON.stringify(tip(env, 'Bare')));

      const mid = tip(env, 'Mid');
      const listed = mid.split('\n').filter((l) => l.indexOf('Aliases: ') === 0)[0] || '';
      h.check('a long alias list is capped',
        listed.indexOf('A1, A2, A3, A4, A5, A6, A7, A8, and 4 more') !== -1, listed);
      // Counted rather than dropped: a truncated list that does not say it is
      // truncated is worse than no list.
      h.check('and the rest are counted, not dropped', listed.indexOf('A9') === -1, listed);

      const desc = mid.split('\n').filter((l) => l.indexOf('Description: ') === 0)[0] || '';
      const body = desc.slice('Description: '.length);
      h.check('a long description is excerpted',
        body.length < long.length && body.charAt(body.length - 1) === '…', body.length + ' of ' + long.length);
      h.check('and cut on a word boundary, not mid-word',
        long.indexOf(body.slice(0, -1)) === 0 && long.charAt(body.length - 1) === ' ', body);
    });
  })

  // The two fields are asked for here and nowhere else: a run over a library with
  // thousands of tags would be paying for descriptions no code path reads.
  .then(() => open()).then(({ env }) => {
    const q = env.calls.filter((c) => /NPTTags/.test(c.query || ''))[0].query;
    h.check('the viewer asks for aliases and description',
      q.indexOf('aliases') !== -1 && q.indexOf('description') !== -1, q);
  })

  // ── A stale tab explaining the old rules ─────────────────────────────────
  //
  // The viewer writes nothing, so there is nothing to gate - but every badge and
  // every inspector verdict answers "what would Prune do with this tag" out of the
  // filter rules in this script. A tab left open from before an update answers with
  // the old ones, confidently.
  .then(() => open({ installed: { id: 'NormalizeParentTags', version: '9.9.9' } }))
    .then(({ env, d }) => {
      // `npt-stale` since 2.5.0, not `npt-warn`: the same red box the settings page
      // uses, so a stale script looks the same wherever the user meets it.
      const warn = env.body.descendants()
        .filter((n) => h.hasClass(n, 'npt-stale')).map((n) => n.textContent).join(' ');
      h.check('a stale viewer says which script it is running',
        warn.indexOf('9.9.9 is installed') !== -1 && warn.indexOf('Ctrl+Shift+R') !== -1, warn);
      h.check('and that what it shows describes the older rules',
        warn.indexOf('may not be what the tasks would do now') !== -1, warn);
      // Read-only: warning is the whole of it. Blocking the one tool that helps while
      // the install is sorted out would be a poor trade.
      h.check('but nothing is disabled', btn(env, 'Expand all').disabled !== true &&
        btn(env, 'Load counts').disabled !== true && btn(env, 'Close').disabled !== true);
      btn(env, 'Expand all').click();
      h.check('and the tree still works', rows(env).length > 4, String(rows(env).length));
      h.check('the read-only line is still there, under the warning',
        d().note.indexOf('Read-only') === 0, d().note);
    })

  .then(() => {
    const version = /var PLUGIN_VERSION\s*=\s*'([^']+)'/
      .exec(require('fs').readFileSync(h.SRC, 'utf8'))[1];
    return open({ installed: { id: 'NormalizeParentTags', version } }).then(({ env }) => {
      h.check('a matching version warns about nothing',
        env.body.descendants().filter((n) => h.hasClass(n, 'npt-warn')).length === 0);
    });
  })

  // Unknown is not a mismatch, here as in the run dialog.
  .then(() => open({ failVersion: true })).then(({ env }) => {
    h.check('a failed version query warns about nothing',
      env.body.descendants().filter((n) => h.hasClass(n, 'npt-warn')).length === 0);
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
    h.check('and says how many matched', d().progress.indexOf('1 of 6 tags match "Le"') === 0,
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

    const findClear = env.body.descendants()
      .filter((n) => h.hasClass(n, 'npt-find-clear'))[0];
    h.check('the find box offers a clear icon once it has text',
      !h.hasClass(findClear, 'npt-hidden'));
    h.check('and it is labelled for what it does', findClear.title === 'Clear find', findClear.title);
    findClear.click();
    h.check('clicking it empties the find box', find.value === '');
    h.check('and drops the match counter', count() === '', count());
    h.check('and hides itself again', h.hasClass(findClear, 'npt-hidden'), findClear.className);
    // Clearing a find is not an undo: the tag it took you to stays where you are.
    h.check('while leaving the tree where the find left it',
      env.body.descendants().some((n) => h.hasClass(n, 'npt-row-sel')));
  })

  .then(() => open()).then(({ env }) => {
    const findClear = env.body.descendants()
      .filter((n) => h.hasClass(n, 'npt-find-clear'))[0];
    h.check('the find clear icon starts hidden',
      !!findClear && h.hasClass(findClear, 'npt-hidden'), findClear && findClear.className);
    // Two boxes on one row: each icon belongs to its own, or one of them lands in
    // the wrong place the moment the row gains a second input.
    const wraps = env.body.descendants().filter((n) => h.hasClass(n, 'npt-inputwrap'));
    h.check('each box carries its own clear icon in its own wrapper',
      wraps.length === 2 &&
      wraps.every((w) => w.descendants().some((n) => h.hasClass(n, 'npt-clear'))),
      'wrappers: ' + wraps.length);
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

  // ── Jumping between the parents of a diamond ─────────────────────────────
  //
  // "◆ 3 parents" that cannot be followed leaves the user knowing a tag hangs off
  // three branches and with no way to see the other two.
  .then(() => open({ tags: DIAMOND })).then(({ env }) => {
    btn(env, 'Expand all').click();
    const real = leafRows(env).filter((n) => n.textContent.indexOf('↩') === -1)[0];
    const mark = badge(real, '◆');
    h.check('the diamond badge is offered as a jump', !!mark && h.hasClass(mark, 'npt-b-act'),
      mark && mark.className);
    h.check('and names every parent, so one can be picked out directly',
      ['"Mid" (2)', '"Other" (6)', '"Zed" (10)'].every((p) => (mark.title || '').indexOf(p) !== -1),
      mark.title);

    // Each click walks to the next parent in Stash's order, from wherever the row
    // sits, so three clicks tour all three branches and come home.
    mark.click();
    h.check('clicking it lands under the next parent',
      branchOf(env, centred(env)).indexOf('Other (6)') !== -1, branchOf(env, centred(env)));
    badge(centred(env), '◆').click();
    h.check('and again under the one after that',
      branchOf(env, centred(env)).indexOf('Zed (10)') !== -1, branchOf(env, centred(env)));
    badge(centred(env), '◆').click();
    h.check('wrapping round to where the tag is drawn in full',
      branchOf(env, centred(env)).indexOf('Mid (2)') !== -1, branchOf(env, centred(env)));
    h.check('the tag stays selected throughout',
      centred(env).textContent.indexOf('Leaf (3)') !== -1 &&
      h.hasClass(centred(env), 'npt-row-sel'), centred(env).className);
  })

  // A pointer that cannot be followed is half a pointer.
  .then(() => open()).then(({ env }) => {
    btn(env, 'Expand all').click();
    const pointer = leafRows(env).filter((n) => n.textContent.indexOf('↩') !== -1)[0];
    badge(pointer, '↩').click();
    h.check('the "shown under" badge goes to the row it names',
      branchOf(env, centred(env)).indexOf('Mid (2)') !== -1 &&
      centred(env).textContent.indexOf('↩') === -1, branchOf(env, centred(env)));
  })

  // The badge tours the parents one at a time; the inspector lists them, which is
  // how one is reached directly.
  .then(() => open()).then(({ env }) => {
    btn(env, 'Expand all').click();
    leafRows(env).filter((n) => n.textContent.indexOf('↩') === -1)[0].click();
    const links = env.body.descendants().filter((n) => h.hasClass(n, 'npt-i-link'));
    h.check('the inspector renders its tags as jumps',
      links.some((n) => n.textContent.indexOf('"Mid" (2)') !== -1) &&
      links.some((n) => n.textContent.indexOf('"Other" (6)') !== -1),
      links.map((n) => n.textContent).join(' | '));
    links.filter((n) => n.textContent.indexOf('"Other" (6)') !== -1)[0].click();
    h.check('clicking one goes to that tag',
      centred(env).textContent.indexOf('Other (6)') !== -1 &&
      h.hasClass(centred(env), 'npt-row-sel'), centred(env).textContent);
    h.check('and the inspector follows the selection',
      inspector(env).indexOf('"Other" (6)') === 0, inspector(env).slice(0, 40));
    // The title is the way out of the viewer to the tag itself, and it has to leave
    // this tab alone: the modal holds a scan of the whole hierarchy that a navigation
    // here would throw away.
    const title = env.body.descendants().filter((n) => h.hasClass(n, 'npt-i-title'))[0];
    h.check('the inspector title links to the tag it names',
      !!title && title.tagName === 'A' && title.href === '/tags/6',
      title && title.tagName + ' ' + title.href);
    h.check('in a new tab, and says so',
      title.target === '_blank' && title.title === 'Open this tag in a new tab',
      title.target + ' | ' + title.title);
  })

  // Same rule as Find: there are no branches in a flat list to land in.
  .then(() => open()).then(({ env }) => {
    const filter = env.body.descendants().filter((n) => h.hasClass(n, 'npt-search-input'))[0];
    filter.value = 'Leaf';
    (filter.handlers.input || []).forEach((fn) => fn({}));
    h.check('the filter has flattened the tree first', rows(env).length === 1);

    badge(leafRows(env)[0], '◆').click();
    h.check('jumping from a filtered row clears the filter', filter.value === '');
    h.check('and puts the tag back in the branch it jumped to',
      branchOf(env, centred(env)).indexOf('Other (6)') !== -1, rows(env).join(' | '));
  })

  // ── The footer ───────────────────────────────────────────────────────────

  // Copy as DOT and Copy as Mermaid were removed at 2.2.0: the graphs they produced
  // were unreadable at real library size, which is the same reason this dialog draws
  // a tree rather than a node-link graph. Pinned so a reintroduction has to argue
  // with that rather than slip back in.
  .then(() => open()).then(({ env }) => {
    h.check('the viewer offers no graph export',
      btn(env, 'Copy as DOT') === null && btn(env, 'Copy as Mermaid') === null);
    h.check('and its footer is the four controls that are left',
      env.body.descendants().filter((n) => h.hasClass(n, 'npt-foot'))[0]
        .childNodes.map((n) => n.textContent).join(' | ') ===
        'Expand all | Collapse all | Load counts | Close',
      env.body.descendants().filter((n) => h.hasClass(n, 'npt-foot'))[0]
        .childNodes.map((n) => n.textContent).join(' | '));
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
      // It shipped saying 'Counts loaded' - a status, on the one control whose caption
      // is read to find out whether pressing it again is worth anything. It is: the
      // click re-fetches.
      h.check('and the button now offers the re-fetch rather than reporting a status',
        btn(env, 'Refresh counts') !== null && btn(env, 'Counts loaded') === null);
      // Guarded so a source without the caption reports the check above rather than
      // aborting the chain on it.
      const again = btn(env, 'Refresh counts');
      if (again) again.click();
      return h.flush(50).then(() => {
        h.check('which is what a second click does',
          !!again && env.calls.filter((c) => /NPTTagCounts/.test(c.query || '')).length === 2);
      });
    });
  })

  // The one control here that costs a query, so it says what it will fetch before it
  // is pressed - including the depth, which is the number people misread.
  .then(() => open()).then(({ env }) => {
    const t = btn(env, 'Load counts').title || '';
    h.check('the counts button explains itself on hover',
      t.indexOf('scenes, images, galleries and performers') !== -1 &&
      t.indexOf('not for it plus everything under it') !== -1, t);
  })

  .then(() => open({ failCounts: true })).then(({ env, d }) => {
    btn(env, 'Load counts').click();
    return h.flush(50).then(() => {
      h.check('a failed count query is reported and leaves the tree usable',
        d().progress.indexOf('Counts could not be loaded') === 0 && rows(env).length === 4,
        d().progress);
      h.check('and the button goes back to offering the load it never made',
        btn(env, 'Counts failed') !== null && btn(env, 'Refresh counts') === null);
    });
  })

  // Every control is built and wired before the tags are fetched, and the fetch may
  // never succeed - in which case the dialog stays open around a graph that does not
  // exist. Driving it then must do nothing, not throw on every keystroke.
  .then(() => open({ failTags: true })).then(({ env, d }) => {
    h.check('a failed tag query is reported',
      d().progress.indexOf('Could not load tags') === 0, d().progress);

    const find = env.body.descendants().filter((n) => h.hasClass(n, 'npt-find-input'))[0];
    const filter = env.body.descendants().filter((n) => h.hasClass(n, 'npt-search-input'))[0];
    const drive = (el, v) => { el.value = v; (el.handlers.input || []).forEach((fn) => fn({})); };

    drive(find, 'leaf');
    drive(filter, 'leaf');
    (find.handlers.keydown || []).forEach((fn) => fn({ key: 'Enter' }));
    ['Expand all', 'Collapse all', 'Load counts']
      .forEach((label) => btn(env, label).click());

    return h.flush(10).then(() => {
      h.check('and the controls stay inert rather than throwing without a graph',
        rows(env).length === 0 && d().progress.indexOf('Could not load tags') === 0,
        d().progress);
      h.check('a graphless dialog issues no further queries',
        env.calls.filter((c) => /NPTTagCounts/.test(c.query)).length === 0);
    });
  })

  // The viewer has only a Close, which the same handler reads without a second copy
  // of it - the run dialog's Cancel simply is not there to find.
  .then(() => open())
  .then(({ env, d }) => {
    h.check('the viewer is up before Escape', d().open);
    h.check('an open dialog listens on the document',
      (env.ctx.document.handlers.keydown || []).length === 1,
      String((env.ctx.document.handlers.keydown || []).length));
    h.fire(env.ctx.document, 'keydown', { key: 'Escape' });
    h.check('Escape closes the viewer', !d().open);
    h.check('and the key handler goes with it',
      (env.ctx.document.handlers.keydown || []).length === 0,
      String((env.ctx.document.handlers.keydown || []).length));
  })

  .then(h.finish, (e) => { console.error(e); process.exit(1); });
