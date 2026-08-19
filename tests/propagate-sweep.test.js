// PropagateTagsAndPerformers' two reverse paths: the tags and the performers of a
// gallery's images, copied onto the gallery.
//
// These are the only two paths Stash gives no field for. `Gallery` has `image_count`
// and `image(index)` and nothing else, so the sources cannot be walked to - a run
// sweeps every image in the library once and keys what it finds by the galleries each
// image names. That sweep is the whole subject of this suite: what it costs, what it
// gathers, what happens when part of it fails, and that it finishes before a single
// target is read.
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
  { id: '4', name: 'Interview', sort_name: null, ignore_auto_tag: false },
];

// A fixture is either `{ node, list }` or `{ node, pages: [[...], [...]] }`. Paging is
// not an optional extra here - the sweep is the one query in the plugin that is
// expected to run to six figures - so the responder serves real pages and reports a
// count across all of them.
function serve(spec, page) {
  const pages = spec.pages || [spec.list || []];
  const total = pages.reduce((n, p) => n + p.length, 0);
  const out = { count: total };
  out[spec.node] = pages[page - 1] || [];
  return out;
}

function responder(opts) {
  opts = opts || {};
  const lib = opts.library || {};
  return function (req) {
    const q = req.query || '';
    if (/PluginVersion/.test(q)) return { data: { plugins: [] } };
    if (q.indexOf('configuration') !== -1) {
      const plugins = {};
      plugins[NAME] = opts.raw ? (opts.settings || {}) : h.propagateSettings(opts.settings);
      return { data: { configuration: { plugins } } };
    }
    if (/PTPTags/.test(q)) return { data: { findTags: { tags: opts.tags || TAGS } } };
    // The sweep and the stage-6 target query are both `findImages`. The plugin names
    // them apart, and so does this - a fixture for one must never answer the other.
    const find = /query PTP_(sweep_)?(\w+)\(/.exec(q);
    if (find) {
      const key = find[1] ? 'sweep' : find[2];
      if (opts.failPage && opts.failPage[key] === req.variables.page) {
        return { errors: [{ message: key + ' page boom' }] };
      }
      const spec = lib[key] || { node: 'images', list: [] };
      const data = {};
      // Keyed by the GraphQL field, which is `findImages` either way - the `sweep_`
      // is in the operation name, not in the selection.
      data[find[2]] = serve(spec, req.variables.page);
      return { data: data };
    }
    return { data: {} };
  };
}

function run(opts) {
  const env = h.makeEnv({ quiet: true, respond: responder(opts) });
  h.run(env.ctx, SRC);
  return h.startTask(env.ctx, TASK, NAME).then(() => h.flush(200)).then(() => ({
    env, d: h.dialog(env.ctx.document.body, PREFIX),
  }));
}

const tagLines = (d) => d.lines.filter((l) => /^\[TAG\]/.test(l));
const perfLines = (d) => d.lines.filter((l) => /^\[PERF\]/.test(l));
const sweeps = (calls) => calls.filter((c) => /query PTP_sweep_/.test(c.query || ''));
const galleryReads = (calls) => calls.filter((c) => /query PTP_findGalleries/.test(c.query || ''));

// Two images in one gallery, disagreeing about tags, plus a third image in a gallery
// of its own and a fourth in no gallery at all.
const IMAGES = [
  { id: '40', title: 'a.jpg', tags: [{ id: '2' }], performers: [{ id: '100', name: 'Jane' }],
    galleries: [{ id: '30' }] },
  { id: '41', title: 'b.jpg', tags: [{ id: '3' }], performers: [{ id: '100', name: 'Jane' }],
    galleries: [{ id: '30' }] },
  { id: '42', title: 'c.jpg', tags: [{ id: '4' }], performers: [{ id: '101', name: 'Ada' }],
    galleries: [{ id: '31' }] },
  { id: '43', title: 'loose.jpg', tags: [{ id: '2' }], performers: [], galleries: [] },
];
const GALLERIES = [
  { id: '30', title: 'First', tags: [], organized: false, performers: [] },
  { id: '31', title: 'Second', tags: [], organized: false, performers: [] },
  { id: '32', title: 'Empty', tags: [], organized: false, performers: [] },
];
const LIB = {
  sweep: { node: 'images', list: IMAGES },
  findGalleries: { node: 'galleries', list: GALLERIES },
};

Promise.resolve()

  // ── The gather ────────────────────────────────────────────────────────────
  .then(() => run({ settings: { c1TagsImagesToGalleries: true }, library: LIB }))
  .then(({ env, d }) => {
    const lines = tagLines(d);
    h.check('a gallery gains the tags of its images', lines.length === 3, lines.join('\n'));
    h.check('gathered per gallery, not pooled across the library',
      /Gallery "First" \(30\) - Tag "Blonde" \(2\)/.test(lines.join('\n')) &&
      /Gallery "Second" \(31\) - Tag "Interview" \(4\)/.test(lines.join('\n')),
      lines.join('\n'));
    // Its images are the sources, and the log names one of them. The image is the
    // entity to open to see why the gallery carries the tag.
    h.check('and names the image it came from',
      /Gallery "First" \(30\) - Tag "Blonde" \(2\) - from Image "a\.jpg" \(40\)$/m
        .test(lines.join('\n')), lines.join('\n'));
    // An image belonging to no gallery is swept and contributes nothing. It is not an
    // error, and it must not land on some other gallery.
    h.check('an image in no gallery reaches nothing',
      !lines.some((l) => /loose\.jpg/.test(l)), lines.join('\n'));
    h.check('and a gallery with no images gains nothing',
      !lines.some((l) => /"Empty"/.test(l)), lines.join('\n'));
    h.check('the sweep is one query over images, not one per gallery',
      sweeps(env.calls).length === 1, sweeps(env.calls).length + ' sweep pages');
  })

  .then(() => run({ settings: { c2PerformersImagesToGalleries: true }, library: LIB }))
  .then(({ d }) => {
    const lines = perfLines(d);
    h.check('a gallery gains the performers of its images', lines.length === 2,
      lines.join('\n'));
    // Two images carry Jane, so she is one addition attributed to the first of them.
    h.check('two images agreeing is one addition, counted',
      /Gallery "First" \(30\) - Performer "Jane" \(100\) - from Image "a\.jpg" \(40\), \+1 more$/m
        .test(lines.join('\n')), lines.join('\n'));
  })

  .then(() => run({
    settings: { c1TagsImagesToGalleries: true },
    library: {
      // An image in two galleries. It is one source that names two targets, and it
      // counts for both - the sweep adds it once per gallery it names.
      sweep: { node: 'images', list: [
        { id: '40', title: 'a.jpg', tags: [{ id: '2' }], galleries: [{ id: '30' }, { id: '31' }] },
      ] },
      findGalleries: { node: 'galleries', list: GALLERIES },
    },
  })).then(({ d }) => {
    h.check('an image in two galleries reaches both',
      tagLines(d).length === 2 &&
      /"First" \(30\)/.test(tagLines(d).join('\n')) &&
      /"Second" \(31\)/.test(tagLines(d).join('\n')),
      tagLines(d).join('\n'));
  })

  // ── Paging ────────────────────────────────────────────────────────────────
  .then(() => run({
    settings: { c1TagsImagesToGalleries: true },
    library: {
      // The one query in the plugin expected to run to six figures. Sources for one
      // gallery arriving on different pages have to accumulate rather than replace.
      sweep: { node: 'images', pages: [
        [{ id: '40', title: 'a.jpg', tags: [{ id: '2' }], galleries: [{ id: '30' }] }],
        [{ id: '41', title: 'b.jpg', tags: [{ id: '3' }], galleries: [{ id: '30' }] }],
      ] },
      findGalleries: { node: 'galleries', list: GALLERIES },
    },
  })).then(({ env, d }) => {
    h.check('the sweep pages through the library', sweeps(env.calls).length === 2,
      sweeps(env.calls).length + ' sweep pages');
    h.check('and a gallery keeps what every page contributed',
      tagLines(d).length === 2, tagLines(d).join('\n'));
    h.check('the sweep never asks for everything at once',
      sweeps(env.calls).every((c) => c.variables.per_page > 0),
      sweeps(env.calls).map((c) => c.variables.per_page).join(','));
  })

  // ── Ordering ──────────────────────────────────────────────────────────────
  .then(() => run({
    settings: { c1TagsImagesToGalleries: true },
    library: {
      // Paged on purpose. The property is that *every* source is gathered before *any*
      // target is read, and a single-page sweep cannot tell that from "the sweep is
      // merely started first" - which is what a run interleaving the two would look
      // like. A gallery read early is planned from a partial set and never revisited:
      // the pass moves on, and nothing errors.
      sweep: { node: 'images', pages: [
        [{ id: '40', title: 'a.jpg', tags: [{ id: '2' }], galleries: [{ id: '30' }] }],
        [{ id: '41', title: 'b.jpg', tags: [{ id: '3' }], galleries: [{ id: '30' }] }],
      ] },
      findGalleries: { node: 'galleries', list: GALLERIES },
    },
  })).then(({ env, d }) => {
    const isSweep = (c) => /query PTP_sweep_/.test(c.query || '');
    const isTarget = (c) => /query PTP_findGalleries/.test(c.query || '');
    let lastSweep = -1, firstTarget = -1;
    env.calls.forEach((c, i) => {
      if (isSweep(c)) lastSweep = i;
      if (isTarget(c) && firstTarget === -1) firstTarget = i;
    });
    h.check('every source is gathered before the first target is read',
      lastSweep !== -1 && firstTarget !== -1 && lastSweep < firstTarget,
      'last sweep at ' + lastSweep + ', first galleries at ' + firstTarget);
    h.check('so the gallery is planned from the whole library, not from page one',
      tagLines(d).length === 2, tagLines(d).join('\n'));
  })

  .then(() => {
    // The progress line, read *during* the sweep rather than after it. A target count
    // of 0 / 0 sitting next to a sweep that will run for a minute reads as a pass that
    // has stalled, so the pass counts as started only once it reaches its targets.
    let ctx = null, seen = null;
    const base = responder({
      settings: { c1TagsImagesToGalleries: true },
      library: {
        sweep: { node: 'images', pages: [
          [{ id: '40', title: 'a.jpg', tags: [{ id: '2' }], galleries: [{ id: '30' }] }],
          [{ id: '41', title: 'b.jpg', tags: [{ id: '3' }], galleries: [{ id: '30' }] }],
        ] },
        findGalleries: { node: 'galleries', list: GALLERIES },
      },
    });
    const env = h.makeEnv({ quiet: true, respond: (req) => {
      // On the sweep's second page: the first has landed, so the sweep is visibly
      // running and the targets have not been touched.
      if (/query PTP_sweep_/.test(req.query || '') && req.variables.page === 2 && ctx) {
        seen = h.dialog(ctx.document.body, PREFIX).progress;
      }
      return base(req);
    } });
    ctx = env.ctx;
    h.run(env.ctx, SRC);
    return h.startTask(env.ctx, TASK, NAME).then(() => h.flush(200)).then(() => {
      h.check('a running sweep is reported without a stalled target count',
        !!seen && /Images 3: 1 \/ 2/.test(seen) && !/Galleries 3:/.test(seen), seen);
    });
  })

  .then(() => run({
    settings: { c1TagsImagesToGalleries: true, c2PerformersImagesToGalleries: true },
    library: LIB,
  })).then(({ env, d }) => {
    // The two reverse paths sit in different stages - performers before tags, because
    // the tag paths read performers - so they cannot share one sweep. Two passes over
    // every image is the price, and the setting descriptions say so.
    h.check('the two reverse paths sweep separately, being different stages',
      sweeps(env.calls).length === 2, sweeps(env.calls).length + ' sweeps');
    h.check('and both plan their own additions',
      tagLines(d).length === 3 && perfLines(d).length === 2,
      tagLines(d).length + ' tag, ' + perfLines(d).length + ' performer');
  })

  .then(() => run({
    settings: { c1TagsImagesToGalleries: true, d1TagsGalleriesToImages: true },
    library: {
      sweep: { node: 'images', list: [
        { id: '40', title: 'a.jpg', tags: [{ id: '2' }], galleries: [{ id: '30' }] },
      ] },
      findGalleries: { node: 'galleries', list: [
        { id: '30', title: 'First', tags: [{ id: '3' }], organized: false, performers: [] },
      ] },
      findImages: { node: 'images', list: [
        { id: '40', title: 'a.jpg', tags: [{ id: '2' }],
          galleries: [{ id: '30', title: 'First', tags: [{ id: '3' }] }] },
      ] },
    },
  })).then(({ d }) => {
    const lines = tagLines(d).join('\n');
    // Both halves of the reversible pair, in one run. Stage 3 pushes the image's tag
    // up; stage 6 pushes the gallery's tag down. Each direction is applied once, which
    // is what makes the pair safe under the task and not under auto mode.
    h.check('both halves of the pair each apply once',
      /Gallery "First" \(30\) - Tag "Blonde" \(2\)/.test(lines) &&
      /Image "a\.jpg" \(40\) - Tag "Outdoor" \(3\)/.test(lines),
      lines);
    // The image gains Outdoor in stage 6, *after* the sweep of stage 3 read it. So the
    // gallery does not also gain it back through the image - the run converges one
    // level at a time, and Rescan is the answer, as it is everywhere else.
    h.check('and a stage-6 addition does not travel back up in the same run',
      tagLines(d).length === 2, lines);
  })

  // ── A partial sweep ───────────────────────────────────────────────────────
  .then(() => run({
    settings: { c1TagsImagesToGalleries: true },
    failPage: { sweep: 2 },
    library: {
      sweep: { node: 'images', pages: [
        [{ id: '40', title: 'a.jpg', tags: [{ id: '2' }], galleries: [{ id: '30' }] }],
        [{ id: '41', title: 'b.jpg', tags: [{ id: '3' }], galleries: [{ id: '30' }] }],
      ] },
      findGalleries: { node: 'galleries', list: GALLERIES },
    },
  })).then(({ d }) => {
    h.check('a failed sweep page is logged as an error',
      d.lines.some((l) => /^\[ERROR\].*sweep page 2 failed/.test(l)), d.lines.join('\n'));
    // Short rather than wrong: every gallery it reaches is planned from every image it
    // did read. The alternative - abandoning the pass - throws away a page of work for
    // a failure the next run may not repeat.
    h.check('and the pass carries on with what it gathered',
      tagLines(d).length === 1 && /Tag "Blonde" \(2\)/.test(tagLines(d)[0]),
      tagLines(d).join('\n'));
    h.check('the review still ends ready to apply', d.button('Proceed').disabled === false);
  })

  // ── The target side is unchanged ──────────────────────────────────────────
  .then(() => run({
    settings: { c1TagsImagesToGalleries: true, f2ExcludeTargetOrganized: true },
    library: {
      sweep: { node: 'images', list: IMAGES },
      findGalleries: { node: 'galleries', list: [
        { id: '30', title: 'First', tags: [], organized: true, performers: [] },
        { id: '31', title: 'Second', tags: [], organized: false, performers: [] },
      ] },
    },
  })).then(({ d }) => {
    // The filters run against the target, so a swept source reaching an excluded
    // gallery is dropped at the same place a walked one would be.
    h.check('an Organized gallery is skipped whatever gathered its sources',
      tagLines(d).length === 1 && /"Second"/.test(tagLines(d)[0]), tagLines(d).join('\n'));
  })

  .then(() => run({
    settings: { c1TagsImagesToGalleries: true },
    library: {
      sweep: { node: 'images', list: IMAGES },
      findGalleries: { node: 'galleries', list: [
        { id: '30', title: 'First', tags: [{ id: '2' }, { id: '3' }], organized: false,
          performers: [] },
      ] },
    },
  })).then(({ d }) => {
    h.check('a gallery already carrying its images tags is left alone',
      tagLines(d).length === 0, tagLines(d).join('\n'));
  })

  // ── Progress ──────────────────────────────────────────────────────────────
  .then(() => run({ settings: { c1TagsImagesToGalleries: true }, library: LIB }))
  .then(({ d }) => {
    // Reading every image is otherwise a silent minute before the gallery count moves
    // at all, so the sweep gets a segment of its own.
    h.check('the progress line reports the sweep as well as the targets',
      /Images 3: \d+ \/ \d+/.test(d.progress) && /Galleries 3: \d+ \/ \d+/.test(d.progress),
      d.progress);
    h.check('and the log says why every image is being read',
      d.lines.some((l) => /no field leads from a Gallery to its Images/.test(l)),
      d.lines.filter((l) => /Stage 3/.test(l)).join('\n'));
    h.check('and reports what the sweep covered',
      d.lines.some((l) => /read 4 images, covering 2 galleries/.test(l)),
      d.lines.filter((l) => /covering/.test(l)).join('\n'));
  })

  // ── Through to the write ──────────────────────────────────────────────────
  .then(() => run({ settings: { c1TagsImagesToGalleries: true }, library: LIB }))
  .then(({ env, d }) => {
    d.button('Proceed').click();
    return h.flush(200).then(() => {
      const writes = env.calls.filter((c) => /\bmutation\b/.test(c.query || ''));
      h.check('a swept plan writes through the gallery bulk mutation',
        writes.length > 0 && writes.every((c) => /bulkGalleryUpdate/.test(c.query)),
        writes.map((c) => (c.query || '').slice(0, 40)).join(' | '));
      h.check('as an ADD delta of tag ids',
        writes.every((c) => c.variables.input.tag_ids.mode === 'ADD'),
        JSON.stringify(writes[0] && writes[0].variables.input));
      // Phase 2 applies the plan and reads nothing - least of all a second sweep,
      // which would be the most expensive read in the plugin done for no reason.
      h.check('and phase 2 sweeps nothing',
        sweeps(env.calls).length === 1, sweeps(env.calls).length + ' sweeps');
    });
  })

  .then(() => h.finish(), (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
