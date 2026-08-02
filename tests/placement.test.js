// Reproduces Stash's two performer-page markup states in jsdom and checks where the
// "Add Tags to Scene(s)" button lands.
//
// This is the only suite needing a real DOM: the plugin has to distinguish two
// containers Stash gives the same class, which a stub document cannot express.
// jsdom is an optional dependency — without it this suite skips rather than fails.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  console.log('\nPerformer button placement');
  console.log('  SKIP  jsdom is not installed — run "npm install" to enable this suite');
  process.exit(0);
}

const SRC = process.env.SRC || path.join(
  __dirname, '..', 'MergePerformerTagsToScenes', 'MergePerformerTagsToScenes.js');
const BTN = '.cpt2s-merge-to-scenes-btn';

// DetailsEditNavbar: the read-only detail view. Delete is rendered only when not editing.
const DETAIL_VIEW = `
  <div id="performer-page" class="row">
    <div class="details-edit">
      <button class="btn btn-primary edit">Edit</button>
      <button class="btn btn-secondary">Auto tag...</button>
      <button class="btn btn-secondary">Merge...</button>
      <button class="btn btn-primary">Submit to Stash-Box</button>
      <button class="btn btn-danger delete">Delete</button>
    </div>
  </div>`;

// Same, but with Delete nested in a wrapper element (insertBefore needs a direct child).
const DETAIL_VIEW_WRAPPED = `
  <div id="performer-page" class="row">
    <div class="details-edit">
      <button class="btn btn-primary edit">Edit</button>
      <div class="d-inline"><span><button class="btn btn-danger delete">Delete</button></span></div>
    </div>
  </div>`;

// PerformerEditPanel: the edit form. Same container class, Cancel/Save instead.
const EDIT_VIEW = `
  <div id="performer-page" class="row">
    <div class="details-edit col-xl-9">
      <button class="btn btn-primary mr-2">Cancel</button>
      <button class="btn btn-success">Save</button>
    </div>
  </div>`;

const dom = new JSDOM('<!doctype html><html><body><div id="root">' + DETAIL_VIEW + '</div></body></html>', {
  url: 'http://localhost:9999/performers/7',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const win = dom.window;

function makeResponse(payload) {
  const body = JSON.stringify(payload);
  return { ok: true, clone() { return makeResponse(payload); }, json: () => Promise.resolve(JSON.parse(body)) };
}

// Mutated mid-run to exercise the no-tags case; starts populated so the existing
// placement checks (which assume the button is eligible to appear) are unaffected.
let performerTags = [{ id: '1' }];

win.fetch = function (url, o) {
  const q = JSON.parse(o.body).query;
  if (q.indexOf('configuration') !== -1) {
    return Promise.resolve(makeResponse({ data: { configuration: { plugins: {
      MergePerformerTagsToScenes: { a1ShowManualMergeButtons: true } } } } }));
  }
  if (q.indexOf('CheckPerformerScenes') !== -1) {
    return Promise.resolve(makeResponse({ data: {
      findPerformer: { tags: performerTags },
      findScenes: { count: 4 },
    } }));
  }
  return Promise.resolve(makeResponse({ data: {} }));
};

vm.runInContext(fs.readFileSync(SRC, 'utf8'), dom.getInternalVMContext(), { filename: SRC });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = () => win.document.getElementById('root');
const btn = () => win.document.querySelector(BTN);

let failures = 0;
let passes = 0;
function check(name, cond, extra) {
  if (cond) { passes++; console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (extra ? '\n        ' + extra : '')); }
}

// The plugin ticks on a 1s interval; give each state change enough time to settle.
(async function () {
  console.log('\nPerformer button placement');

  await sleep(2500); // settings load + performer scene check + a tick to inject
  const b = btn();
  const order = () => Array.from(win.document.querySelectorAll('.details-edit > *'))
    .map((n) => n.textContent.trim()).join(' | ');
  check('button injected in the detail view', !!b);
  check('button sits in the navbar container (the one with Delete)',
    !!b && !!b.parentNode.querySelector('button.delete'),
    b ? 'parent classes: ' + b.parentNode.className : 'no button');
  check('button is placed immediately before Delete',
    !!b && b.nextElementSibling && b.nextElementSibling.classList.contains('delete'),
    'order: ' + order());
  check('button is not last in the bar', !!b && b.parentNode.lastElementChild !== b, 'order: ' + order());
  console.log('        rendered order: ' + order());

  root().innerHTML = EDIT_VIEW;
  await sleep(1500);
  check('button removed when the edit form replaces the navbar', btn() === null,
    btn() ? 'still present in: ' + btn().parentNode.className : '');

  // Hold in edit mode across several ticks to be sure it is not re-injected.
  await sleep(2500);
  check('button stays absent while editing', btn() === null,
    btn() ? 're-injected into: ' + btn().parentNode.className : '');

  root().innerHTML = DETAIL_VIEW;
  await sleep(1500);
  const back = btn();
  check('button reappears when returning to the detail view', !!back);
  check('and again in the navbar container',
    !!back && !!back.parentNode.querySelector('button.delete'));

  // Both containers present at once (transitional render): must pick the navbar.
  root().innerHTML = EDIT_VIEW + DETAIL_VIEW;
  await sleep(1500);
  const both = btn();
  check('with both containers mounted, picks the navbar',
    !!both && !!both.parentNode.querySelector('button.delete'),
    both ? 'parent classes: ' + both.parentNode.className : 'no button');

  // Delete nested inside a wrapper: must still land before the wrapper, not at the end.
  root().innerHTML = DETAIL_VIEW_WRAPPED;
  await sleep(1500);
  const w = btn();
  check('handles a Delete button nested in a wrapper element',
    !!w && w.nextElementSibling && !!w.nextElementSibling.querySelector('button.delete'),
    w ? 'next sibling: ' + (w.nextElementSibling && w.nextElementSibling.outerHTML) : 'no button');

  // A different performer with no tags: the eligibility check must come back 'no'
  // even though the scene count is still 4, so the button never appears.
  performerTags = [];
  win.history.pushState({}, '', '/performers/8');
  root().innerHTML = DETAIL_VIEW;
  await sleep(2500);
  check('button does not appear for a performer with no tags', btn() === null,
    btn() ? 'button present despite the performer having no tags' : '');

  // Saving the performer (adding tags to a previously tag-less one) must make the
  // button appear on its own, without a page reload.
  performerTags = [{ id: '2' }];
  await win.fetch('/graphql', { method: 'POST', body: JSON.stringify({
    query: 'mutation PerformerUpdate($input: PerformerUpdateInput!) { performerUpdate(input: $input) { id } }',
    variables: { input: { id: '8' } },
  }) });
  await sleep(2500);
  check('button appears after the performer is saved with new tags, without a reload',
    !!btn());

  console.log(failures === 0
    ? '\n' + passes + ' check(s) passed.'
    : '\n' + failures + ' of ' + (failures + passes) + ' check(s) FAILED.');
  win.close();
  process.exit(failures === 0 ? 0 : 1);
})();
