// Reproduces Stash's two performer-page markup states in jsdom and checks where the
// "Copy Tags to all Scenes" button lands.
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
const SCENE_BTN = '.cpt2s-merge-from-perfs-btn';

// Scene Edit tab: `.edit-buttons`, no dual-container ambiguity like the performer
// page. Save has no dedicated class, so the button carries no marker of its own -
// same shape `PropagateTagsAndPerformers` builds a scene edit row from.
const SCENE_EDIT_VIEW = `
  <div id="scene-page">
    <div class="edit-buttons">
      <button class="btn btn-secondary" type="button">Save</button>
      <button class="btn btn-danger delete">Delete</button>
    </div>
  </div>`;

// Delete nested in a wrapper element - `insertBeforeDelete` finds it via
// `querySelector('button.delete')`, unaffected by nesting, but `insertBefore` only
// accepts a direct child of the container as its reference node, so the walk-up has
// to find the wrapper, not Delete itself.
const SCENE_EDIT_VIEW_WRAPPED = `
  <div id="scene-page">
    <div class="edit-buttons">
      <button class="btn btn-secondary" type="button">Save</button>
      <div class="d-inline"><span><button class="btn btn-danger delete">Delete</button></span></div>
    </div>
  </div>`;

// No Delete at all - not a page this plugin's own scene button has ever actually
// been seen on live (Scene Edit always carries both), but `insertBeforeImportantAction`
// is a shared mechanism with the performer button and with PropagateTagsAndPerformers'
// copy of the same logic, and the Save-fallback branch deserves its own proof rather
// than relying on it never actually being exercised for this plugin's own call site.
const SCENE_EDIT_VIEW_NO_DELETE = `
  <div id="scene-page">
    <div class="edit-buttons">
      <button class="btn btn-secondary" type="button">Save</button>
    </div>
  </div>`;

// Simulates PropagateTagsAndPerformers having already inserted its own button,
// between Save and Delete, before this plugin's own tick runs - the
// deterministic-ordering case (`coop().order`, repo-root CLAUDE.md) that used to be
// a race decided by whichever plugin's async check resolved last. `id="foreign-btn"`
// is how the test locates it to tag it with `_coopOwner`, a JS property that cannot
// be expressed in markup. No whitespace between the three buttons - React never
// renders adjacent JSX elements with a text node between them the way an indented
// HTML literal would, and a stray whitespace sibling here would only test this
// fixture, not the plugin.
const SCENE_EDIT_VIEW_WITH_FOREIGN = '<div id="scene-page"><div class="edit-buttons">' +
  '<button class="btn btn-secondary" type="button">Save</button>' +
  '<button class="btn btn-secondary" id="foreign-btn">Copy Tags to all Scenes</button>' +
  '<button class="btn btn-danger delete">Delete</button></div></div>';

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
  if (q.indexOf('FindScenePerformers') !== -1) {
    return Promise.resolve(makeResponse({ data: { findScene: { performers: [{ id: '1' }] } } }));
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

  // ── Scene Edit tab: the scene button's own placement ────────────────────────
  //
  // Live-tested twice on this same row. 1.12.2 fixed a button landing after
  // Save/Delete entirely (a plain `appendChild`), anchoring on Save instead. Live
  // feedback after that shipped was that "before Save" was not actually the wanted
  // position - "between Save and Delete" was - so 1.14.0 retired the Save-anchored
  // `insertBeforeSave` and reuses `insertBeforeDelete`, the performer button's own
  // mechanism, for the scene button too.
  console.log('\nScene button placement');

  win.history.pushState({}, '', '/scenes/55');
  root().innerHTML = SCENE_EDIT_VIEW;
  await sleep(2500); // settings load + scene performer check + a tick to inject

  const sbtn = () => win.document.querySelector(SCENE_BTN);
  const sceneOrder = () => Array.from(win.document.querySelectorAll('.edit-buttons > *'))
    .map((n) => n.textContent.trim()).join(' | ');
  const s = sbtn();
  check('scene button injected', !!s);
  check('scene button lands between Save and Delete, not before Save or after Delete',
    !!s && s.previousElementSibling && s.previousElementSibling.textContent.trim() === 'Save' &&
    s.nextElementSibling && s.nextElementSibling.textContent.trim() === 'Delete',
    'order: ' + sceneOrder());

  // Delete nested inside a wrapper element - insertBefore only accepts a direct
  // child as the reference node, so the walk-up has to find the wrapper, not Delete
  // itself.
  root().innerHTML = SCENE_EDIT_VIEW_WRAPPED;
  await sleep(1500);
  const sw = sbtn();
  check('handles a Delete button nested in a wrapper element',
    !!sw && sw.nextElementSibling && !!sw.nextElementSibling.querySelector('button.delete'),
    sw ? 'next sibling: ' + (sw.nextElementSibling && sw.nextElementSibling.outerHTML) : 'no button');

  // No Delete at all - `insertBeforeImportantAction` falls back to finding Save
  // instead of appending after it, so Stash's own primary action stays the last
  // thing in the row (0.12.0/1.15.0's fix, alongside PropagateTagsAndPerformers').
  root().innerHTML = SCENE_EDIT_VIEW_NO_DELETE;
  await sleep(1500);
  const noDel = sbtn();
  const noDelRow = sceneOrder();
  check('with no Delete in the container, the button lands before Save, not after it',
    !!noDel && noDel.nextElementSibling && noDel.nextElementSibling.textContent.trim() === 'Save',
    'order: ' + noDelRow);
  check('so Save stays the last thing in the row',
    !!noDel && noDel.parentNode.lastElementChild.textContent.trim() === 'Save', 'order: ' + noDelRow);

  // Deterministic ordering against another plugin's button (coop().order): this
  // plugin registers priority 20, closer to Delete than PropagateTagsAndPerformers'
  // own 10, so its button always lands adjacent to Delete regardless of whether the
  // other plugin's button was already there first.
  check('registers its own priority in coop().order at load',
    win.StashPluginCoop && win.StashPluginCoop.order.MergePerformerTagsToScenes === 20,
    win.StashPluginCoop && JSON.stringify(win.StashPluginCoop.order));
  win.StashPluginCoop.order.PropagateTagsAndPerformers = 10;
  root().innerHTML = SCENE_EDIT_VIEW_WITH_FOREIGN;
  win.document.getElementById('foreign-btn')._coopOwner = 'PropagateTagsAndPerformers';
  await sleep(1500);
  const ordered = sbtn();
  const orderedRow = sceneOrder();
  check('a lower-priority foreign button already there is not displaced from Delete',
    !!ordered && ordered.nextElementSibling && ordered.nextElementSibling.textContent.trim() === 'Delete',
    'order: ' + orderedRow);
  check('our own scene button lands on the near side of it, adjacent to Delete',
    !!ordered && ordered.previousElementSibling &&
    ordered.previousElementSibling.id === 'foreign-btn',
    'order: ' + orderedRow);

  // The other direction: a foreign button registered *higher* than this plugin's
  // own 20 must not be displaced from Delete either - proves this plugin's own
  // insertOrdered actually defers when it is the lower-priority side, rather than
  // only ever landing next to the anchor because nothing else in this repo
  // currently outranks it.
  win.StashPluginCoop.order.SomeNewerPlugin = 30;
  root().innerHTML = SCENE_EDIT_VIEW_WITH_FOREIGN;
  win.document.getElementById('foreign-btn')._coopOwner = 'SomeNewerPlugin';
  await sleep(1500);
  const outranked = sbtn();
  const outrankedRow = sceneOrder();
  check('a higher-priority foreign button already there is not displaced from Delete',
    !!outranked && win.document.getElementById('foreign-btn').nextElementSibling &&
    win.document.getElementById('foreign-btn').nextElementSibling.textContent.trim() === 'Delete',
    'order: ' + outrankedRow);
  check('our own scene button yields, landing on the far side of it instead',
    !!outranked && outranked.nextElementSibling && outranked.nextElementSibling.id === 'foreign-btn',
    'order: ' + outrankedRow);

  console.log(failures === 0
    ? '\n' + passes + ' check(s) passed.'
    : '\n' + failures + ' of ' + (failures + passes) + ' check(s) FAILED.');
  win.close();
  process.exit(failures === 0 ? 0 : 1);
})();
