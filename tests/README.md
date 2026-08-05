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
`harness.js` (or `npt-harness.js`, whose DOM is real enough for a plugin that builds a
whole dialog — it serves both plugins, taking the source path and plugin id as
arguments, with `dialog(body, prefix)` reading either one's markup) evaluates the plugin inside a `vm` context holding a hand-rolled browser
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
| `logging.test.js` | `logMergesToConsole`: the one-time "logging enabled" banner (emitted once, never repeated by the 10s settings refresh), the exact log-line format, "saved" versus "staged", one line per tag actually merged (not per tag considered), the scene-title fallback to the file name, that the banner names the bracketed number as a Stash id (the console has no dialog head to say it in), that a failed scene update is not logged as merged, and that the fields the line needs are only queried while the setting is on. |
| `normalize-plan.test.js` | `NormalizeParentTags` phase 1: the ancestor closure (chains, diamonds, intermediate tags whose children are absent), roll-up, every exclusion filter in both directions, marker primary tags, a planted cycle terminating with an error instead of emptying the entity, processing order, and the shape of the queries. |
| `normalize-apply.test.js` | `NormalizeParentTags` phase 2: nothing written before Proceed, identical changes grouped and chunked at 100 ids, delta writes rather than a rewritten tag list, failed-request isolation, the head legend explaining that a bracketed number is an id and a count is written `x250`, the bulk-edit lease held for exactly the writes and released on every path, sibling detection, a lease held by another plugin being warned about rather than blocking, the log render cap versus Copy log, Rescan, and **Undo** - armed before it writes, one inverse-mode delta per applied batch, failed batches excluded, leased, surviving a rescan, and landing in done rather than back at Proceed. |
| `normalize-tree.test.js` | `NormalizeParentTags`' read-only hierarchy viewer: that it issues no mutation and no query beyond settings and tags, that a multi-parent tag is drawn in full under one parent and as a non-expanding pointer under the others, that cyclic tags stay reachable, that the badges and inspector name the filter actually configured, the find bar (opening the path to a match, centring it, cycling with Enter) and the flat filter, that the `◆ n parents` badge walks a three-parent tag round every branch and the `↩` badge reaches the full copy, the DOT/Mermaid exports (including dropping edges that leave the exported set), counts loading only on demand at `depth: 0`, and the notation the rows use - an id in brackets, a tooltip repeating it, and counts kept outside the brackets, headings included (`Parents: 3`, never `Parents (3)`) - and what the row tooltip adds to it: aliases and description, each capped (eight aliases then a counted tail, a description excerpted on a word boundary), absent fields saying nothing, and the two of them being queried here and nowhere else. |
| `normalize-tasks.test.js` | `NormalizeParentTags` task interception: the capture-phase click (including leaving another plugin's same-named task alone) and the `runPluginTask` backstop, which must answer without reaching the server. |
| `normalize-auto.test.js` | `NormalizeParentTags`' reactive **Auto Prune / Auto Roll Up on entity updates**: one delta write per save in the configured direction, both single and bulk mutations, every settings gate (both off, both on — which must run neither, since they are exact inverses — and a disabled entity type), the exclusion filters still applying, an unresolvable exclusion tag stopping it outright, a save Stash rejected not being reacted to, standing down for a live lease but not an expired one, registering as a respecter, a lease held across its writes, the per-entity cooldown that breaks a ping-pong with a plugin that does not honour leases, the tag-graph cache and its invalidation by a tag mutation, the one-time console legend printed before the first line it explains and not again, and — the one `_writeDepth` is isolated by — the task's own phase 2 not being reacted to. |
| `merge-task.test.js` | `MergePerformerTagsToScenes`' library-wide task, both phases: the click never reaching the server, the review pass writing nothing, a scene wanted by two performers planned and written **once** with the union of their tags (two writes from one scan would drop each other's), scenes that already carry the tag skipped, untagged performers costing no scene query, an empty plan disabling Proceed, the apply not re-entering its own auto-merge, a failed scene isolated, **Stop**, **Rescan**, the closing tag recap in both phases (Stash-ordered, and a failed scene dropping out of the applied count), the head legend naming the bracketed number as a Stash id, the bulk-edit lease it takes while writing - none during the review, one across the writes, released on Stop as well as on success - and **Undo**, which goes out as a grouped REMOVE delta rather than a rewritten tag list, skips scenes that failed, and is guarded so it cannot re-enter the plugin's own auto-merge. Runs on `npt-harness.js`, which is the one with a DOM real enough for a dialog. |
| `coop.test.js` | The bulk-edit lease from the reactive side: `MergePerformerTagsToScenes` registering itself, standing down while a lease is held, resuming on release, and ignoring an expired one. The bulk side of the same plugin is in `merge-task`, since it needs a dialog. |
| `staging.test.js` | `saveTagsImmediately` and the tag-staging path. Fakes `PluginApi` and mirrors Stash's `useTagsEdit` wiring to check that staging updates both the visible chips and formik (so Save enables), issues no mutation, diffs against the tag box rather than the saved scene, picks the right `TagSelect` among several, and falls back to saving where `PluginApi` is unavailable. |

## What they do not cover

These are simulations of Stash, not Stash. They pin down the plugin's own logic and
its assumptions about Stash's markup and component props — they cannot tell you those
assumptions are still true after a Stash upgrade. The staging suite is the most
exposed, since it models `useTagsEdit`'s behaviour rather than calling it. A passing
run is not a substitute for clicking the buttons once in a real instance.
