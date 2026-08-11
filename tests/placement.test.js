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

// The real Scene edit row, reported live against 1.15.0 and reproduced here: Delete
// is present and styled `btn-danger`, but carries **no `.delete` class**. Every
// version up to 1.15.0 searched for Delete by that class alone, on the strength of a
// repo CLAUDE.md note claiming Stash applies it "throughout" - it does on the
// performer detail navbar, where the claim was confirmed, and not here. The class
// search found nothing, the Save fallback caught it, and the button landed before
// Save instead of between Save and Delete. 1.15.1 falls back to a text match on
// Delete before trying Save.
//
// The Delete here is deliberately an `<a>`, not a `<button>`: the live report did not
// establish which it is, so the fixture pins the harder of the two. A text search
// restricted to BUTTON would pass against a `<button>` fixture while still failing on
// a real page that renders a link.
const SCENE_EDIT_VIEW_UNCLASSED_DELETE = '<div id="scene-page"><div class="edit-buttons mb-3 pl-0">' +
  '<button class="btn btn-primary" type="submit">Save</button>' +
  '<a class="btn btn-danger" href="#"> Delete </a></div></div>';

// Stash's own buttons in this row carry a right margin only, at a value no utility
// class here can name (measured live: `margin: 0 10px 0 0`). 1.15.3 copies whatever
// the row already uses onto our own button instead of picking a class, so every gap
// in the row matches. jsdom computes real styles, so an inline margin here is enough
// to drive it - and `.edit-buttons` computes to `display: block`, the live shape,
// which is also what makes the wrapped-row spacing arrive as a bottom margin.
const SCENE_EDIT_VIEW_MARGINS = '<div id="scene-page"><div class="edit-buttons">' +
  '<button class="btn btn-primary" style="margin:0 10px 0 0">Save</button>' +
  '<button class="btn btn-danger delete" style="margin:0 10px 0 0">Delete</button></div></div>';

// A row that spaces its own children with `column-gap` instead of per-button margins.
// Our button gets that gap too, so a margin of ours would be added to the row's spacing
// rather than match it - 1.15.4 applies neither the copied margins nor the fallback
// class here. No live page is known to be this shape; it is the branch that keeps the
// copy rule from being wrong about a container nobody has measured.
const SCENE_EDIT_VIEW_GAPPED = '<div id="scene-page">' +
  '<div class="edit-buttons" style="display:flex;column-gap:10px">' +
  '<button class="btn btn-primary">Save</button>' +
  '<button class="btn btn-danger delete">Delete</button></div></div>';

// A row with no spacing of its own at all: nothing to copy, so the utility class is
// what our button falls back to - which is what shipped before any of this was
// measured. Since 1.15.4 that class is added by `applyButtonSpacing` rather than by the
// builder, so this is the only branch on which it exists.
const SCENE_EDIT_VIEW_NO_MARGINS = '<div id="scene-page"><div class="edit-buttons">' +
  '<button class="btn btn-primary">Save</button>' +
  '<button class="btn btn-danger delete">Delete</button></div></div>';

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

// The performer navbar as it is actually spaced, which is: inconsistently. `Auto tag...`
// and `Merge` touch each other on a live page, so the button our own lands after may
// carry no right margin at all - and the gap between two inline siblings is the first's
// right margin plus the second's left. 1.15.4 copied the donor's margins wholesale, so
// our button took `margin-left: 0` and touched `Submit to Stash-Box`, live-reported. The
// row's own step (7px, off Edit) is now filled in on whichever side is short.
const DETAIL_VIEW_MARGINS = `
  <div id="performer-page" class="row">
    <div class="details-edit">
      <button class="btn btn-primary edit" style="margin-right:7px">Edit</button>
      <button class="btn btn-secondary">Submit to Stash-Box</button>
      <button class="btn btn-danger delete" style="margin-right:7px">Delete</button>
    </div>
  </div>`;

// A row whose neighbouring *sibling* is not the action the user sees: React wraps some
// row actions, and the wrapper carries no margin while the button inside it does. Reading
// the sibling reports "contributes nothing" and a full step gets added on top of a gap
// that was already there - which is what `PropagateTagsAndPerformers` hit on Group.
const DETAIL_VIEW_WRAPPED_NEIGHBOUR = `
  <div id="performer-page" class="row">
    <div class="details-edit">
      <div class="d-inline"><button class="btn btn-primary edit" style="margin-right:7px">Edit</button></div>
      <button class="btn btn-danger delete" style="margin-right:7px">Delete</button>
    </div>
  </div>`;

// And a row whose neighbouring sibling holds no action at all - an empty slot React left
// where a conditional action would go. Its margin is zero, but the gap is not: the button
// behind it is making one. Reading the slot doubled that gap on Group's detail row, which
// is what 1.15.8 walks past.
const DETAIL_VIEW_ACTIONLESS_NEIGHBOUR = `
  <div id="performer-page" class="row">
    <div class="details-edit">
      <button class="btn btn-primary edit" style="margin-right:7px">Edit</button>
      <div class="d-inline"></div>
      <button class="btn btn-danger delete" style="margin-right:7px">Delete</button>
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

// Settings - Tasks - Plugin Tasks: one SettingGroup per plugin, headed with its name,
// one button per declared task. The second group is another plugin declaring a task by
// the same name, which is the case `ownTaskName`'s heading check exists for - and the
// reason the paint cannot key on the label alone.
//
// The heading is the *bare* plugin name, with no version in brackets. That is what
// `PluginTasks.tsx` renders (`heading: o.name`); the `(1.17.0)` suffix belongs to
// Settings - Plugins, which is a different panel and has no task buttons on it.
const TASKS_VIEW = `
  <div id="tasks-page">
    <div class="setting-group">
      <div class="setting"><h3>Merge Performer Tags To Scenes</h3></div>
      <div class="setting">
        <div><button class="btn btn-secondary" type="button">Merge Performer Tags into All Their Scenes</button></div>
      </div>
    </div>
    <div class="setting-group">
      <div class="setting"><h3>Some Other Plugin</h3></div>
      <div class="setting">
        <div><button class="btn btn-secondary" type="button">Merge Performer Tags into All Their Scenes</button></div>
      </div>
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

// Since 1.16.0 the scene button's gate asks what a merge reads rather than only whether
// the scene has performers, so the default scene here carries a performer with a tag the
// scene itself does not have - otherwise there is nothing to merge and no button to
// place, which is what every placement check in this file is actually about. Mutable,
// and the calls counted, so the eligibility and invalidation section at the end can move
// it without a second responder.
let sceneForGate = { organized: false, tags: [], performers: [{ tags: [{ id: '99' }] }] };
let sceneGateCalls = 0;
// Extra settings folded into the config response, so one check can switch an exclusion
// filter on without a second responder. Empty for every check but that one.
let gateSettings = {};

win.fetch = function (url, o) {
  const q = JSON.parse(o.body).query;
  if (q.indexOf('configuration') !== -1) {
    return Promise.resolve(makeResponse({ data: { configuration: { plugins: {
      MergePerformerTagsToScenes: Object.assign(
        { a1ShowManualMergeButtons: true }, gateSettings) } } } }));
  }
  if (q.indexOf('CheckPerformerScenes') !== -1) {
    return Promise.resolve(makeResponse({ data: {
      findPerformer: { tags: performerTags },
      findScenes: { count: 4 },
    } }));
  }
  // Since 1.16.0 the scene button's gate asks what a merge reads rather than only
  // whether the scene has performers, so this scene has to carry a performer with a
  // tag the scene itself does not have - otherwise there is nothing to merge and no
  // button to place, which is what every check in this file is actually about.
  if (q.indexOf('FindSceneMergeable') !== -1) {
    sceneGateCalls++;
    return Promise.resolve(makeResponse({ data: { findScene: sceneForGate } }));
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

  // Spacing against an inconsistently spaced navbar - see the fixture's own comment.
  root().innerHTML = DETAIL_VIEW_MARGINS;
  await sleep(1500);
  const navSpaced = btn();
  const navStyle = navSpaced ? win.getComputedStyle(navSpaced) : null;
  check('fills the gap a marginless neighbour leaves, rather than touching it',
    !!navStyle && navStyle.marginLeft === '7px', navStyle && navStyle.marginLeft);
  check('and fills the far side to the same step',
    !!navStyle && navStyle.marginRight === '7px', navStyle && navStyle.marginRight);

  // 1.15.7: the neighbour's margin is read *through* a wrapper to the action inside it.
  // 1.15.6 measured the gap with `getBoundingClientRect` instead; that is gone, because a
  // distance is a fact about one instant and the row it was measured in is not the row
  // that settles - live, it left this button flush against Delete on this very navbar.
  root().innerHTML = DETAIL_VIEW_WRAPPED_NEIGHBOUR;
  await sleep(1500);
  const wrappedNeighbour = btn();
  const wrappedStyle = wrappedNeighbour ? win.getComputedStyle(wrappedNeighbour) : null;
  check('a wrapped neighbour is read through to the action inside it',
    !!wrappedStyle && wrappedStyle.marginLeft === '0px', wrappedStyle && wrappedStyle.marginLeft);
  check('and the far side still gets the row\'s step',
    !!wrappedStyle && wrappedStyle.marginRight === '7px', wrappedStyle && wrappedStyle.marginRight);

  // 1.15.8: an element holding no action at all is walked past entirely, to the button
  // behind it. A zero read off something this code cannot identify as an action is not
  // evidence of a zero gap - it is evidence that nothing was read.
  root().innerHTML = DETAIL_VIEW_ACTIONLESS_NEIGHBOUR;
  await sleep(1500);
  const actionless = btn();
  const actionlessStyle = actionless ? win.getComputedStyle(actionless) : null;
  check('an element holding no action is walked past to the button behind it',
    !!actionlessStyle && actionlessStyle.marginLeft === '0px',
    actionlessStyle && actionlessStyle.marginLeft);

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

  // The bug 1.15.1 fixes: Delete present, `.delete` class absent, rendered as an <a>
  // with surrounding whitespace. Anchoring must still find it by text and land
  // between Save and Delete rather than falling through to the Save fallback.
  root().innerHTML = SCENE_EDIT_VIEW_UNCLASSED_DELETE;
  await sleep(1500);
  const unc = sbtn();
  const uncRow = sceneOrder();
  check('finds Delete by text when it carries no .delete class',
    !!unc && unc.nextElementSibling && unc.nextElementSibling.textContent.trim() === 'Delete',
    'order: ' + uncRow);
  check('and still lands after Save, not before it',
    !!unc && unc.previousElementSibling && unc.previousElementSibling.textContent.trim() === 'Save',
    'order: ' + uncRow);
  check('so Delete stays the last thing in the row',
    !!unc && unc.parentNode.lastElementChild.textContent.trim() === 'Delete', 'order: ' + uncRow);

  // Spacing, measured rather than chosen - see the fixture's own comment.
  root().innerHTML = SCENE_EDIT_VIEW_MARGINS;
  await sleep(1500);
  const spaced = sbtn();
  const spacedStyle = spaced ? win.getComputedStyle(spaced) : null;
  check('copies the row\'s own horizontal margins onto our button',
    !!spacedStyle && spacedStyle.marginRight === '10px' && spacedStyle.marginLeft === '0px',
    spacedStyle && [spacedStyle.marginLeft, spacedStyle.marginRight].join(' / '));
  check('and spaces a wrapped row with a bottom margin, since .edit-buttons is display:block',
    !!spacedStyle && spacedStyle.marginBottom !== '0px' && spacedStyle.marginBottom !== '',
    spacedStyle && spacedStyle.marginBottom);
  // 1.15.4, and the reason 1.15.3's measurement never reached a live page: Bootstrap's
  // spacing utilities carry `!important`, so the `mx-2` this button was built with
  // outranked the inline margins above and the copied value lost in the cascade. jsdom
  // loads no Bootstrap stylesheet, so it cannot show the losing margin - what it can
  // pin is the class being absent, which is the whole fix.
  check('and carries no utility spacing class, which would outrank them (!important)',
    !!spaced && !/\bmx-\d\b/.test(spaced.className), spaced && spaced.className);

  // `.edit-buttons` is `display: block`, so the wrapped-row gap has to arrive as the
  // bottom margin checked above and `row-gap` must be left off - it is a flex/grid
  // property and would be inert anyway, but setting it would misrepresent what spaced
  // the row.
  check('and no row-gap on a block container, where it would be inert',
    !!spaced && !spaced.parentNode.style.rowGap, spaced && spaced.parentNode.style.rowGap);

  root().innerHTML = SCENE_EDIT_VIEW_GAPPED;
  await sleep(1500);
  const gapped = sbtn();
  check('a row spaced by column-gap gets no horizontal margin from us',
    !!gapped && !/margin-left|margin-right/.test(gapped.getAttribute('style') || ''),
    gapped && gapped.getAttribute('style'));
  check('and no fallback class either - the gap already spaces our button',
    !!gapped && !/\bmx-\d\b/.test(gapped.className), gapped && gapped.className);
  // The other half of `ensureRowSpacing`: a flex container wraps into flex lines, which
  // `row-gap` does space. Until 1.15.9 this plugin set only the block-row margin, so a
  // flex row of its buttons wrapped flush while `PropagateTagsAndPerformers`, running
  // identical-looking code, spaced correctly. Fails against 1.15.8.
  check('a flex container is given row-gap, which it does honour',
    !!gapped && !!gapped.parentNode.style.rowGap,
    gapped && gapped.parentNode.style.rowGap);

  root().innerHTML = SCENE_EDIT_VIEW_NO_MARGINS;
  await sleep(1500);
  const unspaced = sbtn();
  check('a row with no spacing of its own falls back to the utility class',
    !!unspaced && /\bmx-2\b/.test(unspaced.className), unspaced && unspaced.className);

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

  // ── Scene button eligibility, and the save that re-arms it (1.16.0) ─────────
  //
  // Until 1.16.0 this button gated on `findScene { performers { id } }` - performer
  // existence alone - so a scene already carrying every one of its performers' tags
  // showed a button whose click could only report "No changes". The *performer* button
  // had never behaved that way (`checkPerformerHasScenes` requires `hasTags &&
  // hasScenes`), and the inconsistency was never a decision. It costs no extra round
  // trip: the query grew, the count of queries did not.
  console.log('\nScene button eligibility (1.16.0)');

  const sceneSave = (id, bulk) => win.fetch('/graphql', {
    method: 'POST',
    body: JSON.stringify(bulk
      ? { query: 'mutation X($input: I!) { bulkSceneUpdate(input: $input) { id } }', variables: { input: { ids: [String(id)] } } }
      : { query: 'mutation X($input: I!) { sceneUpdate(input: $input) { id } }', variables: { input: { id: String(id) } } }),
  });

  // A fresh scene id each time, so a check reads a probe of its own rather than the
  // single-slot cache's answer for the previous one.
  win.history.pushState({}, '', '/scenes/70');
  sceneForGate = { organized: false, tags: [{ id: '99' }], performers: [{ tags: [{ id: '99' }] }] };
  root().innerHTML = SCENE_EDIT_VIEW;
  await sleep(1500);
  check('a scene already carrying every performer tag shows no button', !sbtn());

  // Organized, with the filter that acts on it switched on. This is the check that
  // proves the gate goes through `sceneMergePlan` rather than a diff of its own: the
  // old gate could not see this filter at all, and a hand-rolled replacement would have
  // had to reimplement it (§3, "one filter, one implementation").
  // The setting is switched on and allowed to land *before* the navigation that arms
  // the probe. `sceneCheck` is keyed on the scene id alone, so a settings change while
  // a page is open is not noticed until the next navigation - true of this plugin since
  // the cache existed, unchanged here, and not what this check is about.
  // `pushState` fires no `popstate`, so the dispatch is what a real navigation would do.
  gateSettings = { b2ExcludeSceneOrganized: true };
  win.dispatchEvent(new win.PopStateEvent('popstate'));
  await sleep(2500);
  win.history.pushState({}, '', '/scenes/71');
  sceneForGate = { organized: true, tags: [], performers: [{ tags: [{ id: '99' }] }] };
  root().innerHTML = SCENE_EDIT_VIEW;
  await sleep(1500);
  check('and an Organized scene shows none either, which the old gate could not see',
    !sbtn());
  gateSettings = {};
  win.dispatchEvent(new win.PopStateEvent('popstate'));
  await sleep(2500);

  // The save that re-arms it. `sceneCheck` is keyed on the scene id, which a save does
  // not change, so before 1.16.0 this answer survived until a navigation.
  win.history.pushState({}, '', '/scenes/72');
  sceneForGate = { organized: false, tags: [{ id: '99' }], performers: [{ tags: [{ id: '99' }] }] };
  root().innerHTML = SCENE_EDIT_VIEW;
  await sleep(1500);
  check('no button before the save', !sbtn());
  sceneForGate = { organized: false, tags: [], performers: [{ tags: [{ id: '99' }] }] };
  await sceneSave(72);
  await sleep(1500);
  check('a save of the viewed scene re-probes and the button appears', !!sbtn());

  win.history.pushState({}, '', '/scenes/73');
  sceneForGate = { organized: false, tags: [], performers: [{ tags: [{ id: '99' }] }] };
  root().innerHTML = SCENE_EDIT_VIEW;
  await sleep(1500);
  check('a button before the save', !!sbtn());
  sceneForGate = { organized: false, tags: [{ id: '99' }], performers: [{ tags: [{ id: '99' }] }] };
  await sceneSave(73, true);
  await sleep(1500);
  check('and a bulk save that leaves nothing to merge takes it away', !sbtn());

  // The negative: a save naming some other scene must not re-probe. Counted rather than
  // observed through the button, since the button would not move either way.
  win.history.pushState({}, '', '/scenes/74');
  sceneForGate = { organized: false, tags: [], performers: [{ tags: [{ id: '99' }] }] };
  root().innerHTML = SCENE_EDIT_VIEW;
  await sleep(1500);
  const gateBefore = sceneGateCalls;
  await sceneSave(999);
  await sleep(1200);
  check('a save of a different scene does not re-probe', sceneGateCalls === gateBefore,
    'probes: ' + (sceneGateCalls - gateBefore));

  // ── The Plugin Tasks page (1.17.0) ──────────────────────────────────────────
  //
  // Amber for our own task button, and Stash's grey left alone on the identically
  // labelled button belonging to somebody else. The negative is the whole point: the
  // paint runs over every button on the page, so a version keying on the label alone
  // would repaint another plugin's task and pass the first check.
  win.history.pushState({}, '', '/settings?tab=tasks');
  root().innerHTML = TASKS_VIEW;
  await sleep(1500);
  const groups = win.document.querySelectorAll('.setting-group');
  const ourTask = groups[0].querySelector('button');
  const theirTask = groups[1].querySelector('button');
  check('our task button is repainted amber',
    ourTask.className.split(/\s+/).indexOf('btn-warning') !== -1, ourTask.className);
  check('and no longer carries Stash\'s grey',
    ourTask.className.split(/\s+/).indexOf('btn-secondary') === -1, ourTask.className);
  check('it keeps the btn class it needs to look like a button',
    ourTask.className.split(/\s+/).indexOf('btn') !== -1, ourTask.className);
  check('a same-named task in another plugin\'s group is left alone',
    theirTask.className === 'btn btn-secondary', theirTask.className);

  // Idempotence: the paint runs on every tick, and a button already carrying the
  // variant must come back unchanged rather than accumulating classes.
  const painted = ourTask.className;
  await sleep(1500);
  check('a second tick leaves the painted button untouched', ourTask.className === painted,
    painted + ' -> ' + ourTask.className);

  console.log(failures === 0
    ? '\n' + passes + ' check(s) passed.'
    : '\n' + failures + ' of ' + (failures + passes) + ' check(s) FAILED.');
  win.close();
  process.exit(failures === 0 ? 0 : 1);
})();
