// SceneVariants, rendered by the real React through Stash's real patch mechanism.
//
// **This suite exists because a hand-rolled React fixture confirmed a bug twice.** The
// plugin's after-patch was written as `function (props, result)`, the sibling suite's
// harness invoked it as `fn(props, result)`, and both were wrong in the same way — so
// every check passed while the live scene page threw React error #31, "Objects are not
// valid as a React child (found: object with keys {})". A fixture written from the same
// assumption as the code under test cannot disagree with it.
//
// So this one supplies neither half. `PatchFunction` below is copied from
// `stashapp/stash` `ui/v2.5/src/patch.tsx` verbatim in behaviour — the Proxy, the
// before/instead/after loops, `args.concat(result)` — and React itself is what calls the
// patched component, so React decides what `args` contains. Nothing here asserts what
// that is; the render either survives or it does not.
//
// Needs `react` and `react-dom`, and skips itself without them, the way the placement
// suite skips without jsdom.
'use strict';
const path = require('path');
const h = require('./npt-harness');

let React, renderToStaticMarkup;
try {
  React = require('react');
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
} catch (e) {
  console.log('SKIP  scenevariants-render: react/react-dom not installed (npm install)');
  process.exit(0);
}

const SRC = process.env.SRC || path.join(__dirname, '..', 'SceneVariants', 'SceneVariants.js');

// ── Stash's patch mechanism, behaviour-for-behaviour ────────────────────────
//
// From `ui/v2.5/src/patch.tsx`. The one line this suite is about is
// `result = afterFn.apply(ctx, args.concat(result))` — `args` being whatever React passed
// the component, which is where the empty legacy-context object comes from.
function makePatch() {
  const afterFns = {};
  const PatchFunction = (name, fn) => new Proxy(fn, {
    apply(target, ctx, args) {
      let result = target.apply(ctx, args);
      for (const afterFn of afterFns[name] || []) {
        result = afterFn.apply(ctx, args.concat(result));
      }
      return result;
    },
  });
  // `PatchContainerComponent`: renders its children and nothing else.
  const PatchContainerComponent = (name) =>
    PatchFunction(name, (props) => React.createElement(React.Fragment, null, props.children));
  return {
    after: (name, fn) => { (afterFns[name] = afterFns[name] || []).push(fn); },
    container: PatchContainerComponent,
  };
}

// react-bootstrap, as far as the plugin uses it. Real components, so React renders them
// and any invalid child inside them is React's to reject.
const Bootstrap = {
  Nav: {
    Item: ({ children }) => React.createElement('li', { className: 'nav-item' }, children),
    Link: ({ eventKey, children }) =>
      React.createElement('a', { className: 'nav-link', 'data-rb-event-key': eventKey }, children),
  },
  Tab: {
    Pane: ({ eventKey, children }) =>
      React.createElement('div', { className: 'tab-pane', 'data-key': eventKey }, children),
  },
};

const VARIANTS = [
  { id: '9', title: 'Cool Shoot', tags: [{ id: '1', name: 'Full Length' }],
    paths: { screenshot: '/scene/9/screenshot', preview: '/scene/9/preview' },
    files: [{ duration: 2472, width: 1920, height: 1080 }] },
  { id: '77', title: 'Cool Shoot - Clip 1', tags: [{ id: '2', name: 'Partial Length' }],
    paths: { screenshot: '/scene/77/screenshot' },
    files: [{ duration: 300, width: 1280, height: 720 }] },
];

const scene = {
  id: '42', title: 'Cool Shoot - Clip 2',
  stash_ids: [{ endpoint: 'https://stashdb.org/graphql', stash_id: 'abc' }],
};

function respond(req) {
  if (req.query.indexOf('configuration { plugins }') !== -1) {
    return { data: { configuration: { plugins: { SceneVariants: {
      a1FullLengthTag: 'Full Length', a2PartialLengthTag: 'Partial Length' } } } } };
  }
  if (req.query.indexOf('SVRVariants') !== -1) {
    return { data: { findScenes: { scenes: VARIANTS } } };
  }
  return { data: {} };
}

(async function () {
  const patch = makePatch();
  const env = h.makeEnv({ quiet: true, pathname: '/scenes/42', respond });
  const errors = [];
  env.ctx.console = { log() {}, info() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) };
  // The real React, handed to the plugin exactly as Stash hands it over.
  env.ctx.PluginApi = { React, libraries: { Bootstrap }, patch: { after: patch.after } };
  env.ctx.window.PluginApi = env.ctx.PluginApi;
  h.run(env.ctx, SRC);

  // The two container components Stash declares, built here the way Scene.tsx builds
  // them. React calls these, so React decides what arguments the patches receive.
  const ScenePageTabs = patch.container('ScenePage.Tabs');
  const ScenePageTabContent = patch.container('ScenePage.TabContent');

  const props = { scene };
  const Strip = () => React.createElement('ul', { className: 'nav nav-tabs' },
    React.createElement(ScenePageTabs, props,
      React.createElement(Bootstrap.Nav.Item, { key: 'details' },
        React.createElement(Bootstrap.Nav.Link, { eventKey: 'scene-details-panel' }, 'Details'))));
  const Content = () => React.createElement('div', { className: 'tab-content' },
    React.createElement(ScenePageTabContent, props,
      React.createElement(Bootstrap.Tab.Pane, { key: 'details', eventKey: 'scene-details-panel' },
        'the details pane')));

  // The whole suite in one line each: React renders it, or React throws. #31 is what a
  // patch returning the legacy-context object as a child produces, and it is thrown here
  // rather than reported.
  let stripHtml = null, stripErr = null;
  try { stripHtml = renderToStaticMarkup(React.createElement(Strip)); }
  catch (e) { stripErr = e; }
  h.check('the tab strip renders under the real React',
    !stripErr, stripErr && stripErr.message);
  h.check('Stash’s own tab survives the patch',
    !!stripHtml && stripHtml.indexOf('scene-details-panel') !== -1, stripHtml);
  h.check('and the Variants tab is appended after it',
    !!stripHtml && stripHtml.indexOf('Variants') !== -1 &&
      stripHtml.indexOf('scene-details-panel') < stripHtml.indexOf('Variants'), stripHtml);

  let contentHtml = null, contentErr = null;
  try { contentHtml = renderToStaticMarkup(React.createElement(Content)); }
  catch (e) { contentErr = e; }
  h.check('the tab content renders under the real React',
    !contentErr, contentErr && contentErr.message);
  h.check('Stash’s own pane survives the patch',
    !!contentHtml && contentHtml.indexOf('the details pane') !== -1, contentHtml);
  h.check('and the Variants pane is appended after it',
    !!contentHtml && contentHtml.indexOf('scene-svr-variants-panel') !== -1, contentHtml);
  // A static render never runs effects, so this is the pane's first paint - the state it
  // is in for as long as the query is out, and the one the user sees first.
  h.check('the pane paints its looking-for-variants line before the query lands',
    !!contentHtml && contentHtml.indexOf('Looking for variants') !== -1, contentHtml);

  h.check('nothing was logged as an error', errors.length === 0, errors.join(' | '));
  h.finish();
}());
