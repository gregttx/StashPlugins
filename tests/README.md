# Tests

Node test suites for the plugins in this repo. They exist because the plugins do
things that are painful to verify by clicking around a live Stash: fetch
interception, re-entrancy guards, error paths that need a failing server, and DOM
placement that depends on which of two identically-classed containers is mounted.

## Running them

```
node tests/run.js        # or: npm test
```

No install is needed for most of it. One suite (`placement`) needs a real DOM and
will skip itself with a `SKIP` line unless `jsdom` is present:

```
npm install              # optional, enables the placement suite
```

Everything else is plain Node with no dependencies.

## How it works

The plugins are ES5 IIFEs with no exports, so there is nothing to `require`. Instead
`harness.js` (and `npt-harness.js`, which serves both plugins' dialogs — it takes the
source path and plugin id as arguments, and `dialog(body, prefix)` reads either one's
markup — and fakes enough DOM for a plugin that builds a
whole dialog) evaluates the plugin inside a `vm` context holding a hand-rolled browser
— `window`, `document`, `fetch`, `sessionStorage`, `MutationObserver` — and the tests
drive it the way a browser would: by answering its GraphQL requests and by calling the
event handlers it attaches. Assertions are a `check(name, condition)` helper; there is
no test framework.

Each suite runs in its own process, because the plugin installs global state (it wraps
`window.fetch` and registers intervals) that must not leak between suites.

### Checking that a test actually tests something

`SRC` points the harness at a different copy of the plugin, which is how these suites
were validated in the first place — every regression test was confirmed to fail against
the version before its fix:

```
SRC=/tmp/old-version.js node tests/merge-logic.test.js
```

## The suites

| Suite | Covers |
| --- | --- |
| `merge-logic.test.js` | Fetch interception and the merge core: re-entrancy guarding, exclusion-tag lookup paging, gating auto-merge on the triggering mutation actually succeeding, per-scene error isolation, custom-field exclusion (including prototype keys), and not propagating the exclusion tag itself. |
| `placement.test.js` | Where the performer button is injected. Reproduces Stash's two `.details-edit` containers — `DetailsEditNavbar` in the detail view, the edit form's own container while editing — and asserts the button appears only in the former, immediately before Delete, including when Delete is nested in a wrapper. Needs `jsdom`. |
| `logging.test.js` | `logMergesToConsole`: the one-time "logging enabled" banner (emitted once, never repeated by the 10s settings refresh), the exact log-line format, "saved" versus "staged", one line per tag actually merged (not per tag considered), the scene-title fallback to the file name, that a failed scene update is not logged as merged, and that the fields the line needs are only queried while the setting is on. |
| `normalize-plan.test.js` | `NormalizeParentTags` phase 1: the ancestor closure (chains, diamonds, intermediate tags whose children are absent), roll-up, every exclusion filter in both directions, marker primary tags, a planted cycle terminating with an error instead of emptying the entity, processing order, and the shape of the queries. |
| `normalize-apply.test.js` | `NormalizeParentTags` phase 2: nothing written before Proceed, identical changes grouped and chunked at 100 ids, delta writes rather than a rewritten tag list, failed-request isolation, the bulk-edit lease held for exactly the writes and released on every path, sibling detection, the log render cap versus Copy log, and Rescan. |
| `normalize-tasks.test.js` | `NormalizeParentTags` task interception: the capture-phase click (including leaving another plugin's same-named task alone) and the `runPluginTask` backstop, which must answer without reaching the server. |
| `merge-task.test.js` | `MergePerformerTagsToScenes`' library-wide task: the click never reaching the server, the dialog opening ready rather than running, nothing written before **Start**, scenes that already carry the tag skipped and untagged performers costing no scene query, the run not re-entering its own auto-merge, a failed scene isolated and not counted as merged, and **Stop** halting between performers. Runs on `npt-harness.js`, which is the one with a DOM real enough for a dialog. |
| `coop.test.js` | The bulk-edit lease from the reactive side: `MergePerformerTagsToScenes` registering itself, standing down while a lease is held, resuming on release, and ignoring an expired one. |
| `staging.test.js` | `saveTagsImmediately` and the tag-staging path. Fakes `PluginApi` and mirrors Stash's `useTagsEdit` wiring to check that staging updates both the visible chips and formik (so Save enables), issues no mutation, diffs against the tag box rather than the saved scene, picks the right `TagSelect` among several, and falls back to saving where `PluginApi` is unavailable. |

## What they do not cover

These are simulations of Stash, not Stash. They pin down the plugin's own logic and
its assumptions about Stash's markup and component props — they cannot tell you those
assumptions are still true after a Stash upgrade. The staging suite is the most
exposed, since it models `useTagsEdit`'s behaviour rather than calling it. A passing
run is not a substitute for clicking the buttons once in a real instance.
