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
`harness.js` evaluates the plugin inside a `vm` context holding a hand-rolled browser
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
| `staging.test.js` | `saveTagsImmediately` and the tag-staging path. Fakes `PluginApi` and mirrors Stash's `useTagsEdit` wiring to check that staging updates both the visible chips and formik (so Save enables), issues no mutation, diffs against the tag box rather than the saved scene, picks the right `TagSelect` among several, and falls back to saving where `PluginApi` is unavailable. |

## What they do not cover

These are simulations of Stash, not Stash. They pin down the plugin's own logic and
its assumptions about Stash's markup and component props — they cannot tell you those
assumptions are still true after a Stash upgrade. The staging suite is the most
exposed, since it models `useTagsEdit`'s behaviour rather than calling it. A passing
run is not a substitute for clicking the buttons once in a real instance.
