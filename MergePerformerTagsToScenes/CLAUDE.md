# CLAUDE.md — Merge Performer Tags To Scenes

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, `tick()` + MutationObserver, the bulk-edit lease) are in `../CLAUDE.md` and still
apply. The user-facing description is `README.md`; this file is for the reasoning that does not
belong in either.

**Status: released, 1.1.0.** Requires Stash 0.31.0 or newer — tag `custom_fields` (the
custom-field exclusion filter) and `PluginApi.patch` (staging) both arrived there.

---

## 1. What it does, and the four paths that do it

Performer tags are copied onto scenes. Tags are only ever **added**, never removed — which is the
assumption behind half the decisions below, because a wrong merge cannot be undone by the plugin.

Four entry points share one core:

| Path | Trigger | Saves? |
| --- | --- | --- |
| Performer button, "Add Tags to Scene(s)" | click on the performer detail view | yes, every scene of the performer |
| Scene button, "Add Perf Tags" | click on the scene Edit tab | **stages** by default; saves if `saveTagsImmediately` |
| Auto-merge on scene update | `sceneUpdate` / `bulkSceneUpdate` seen in `fetch` | yes |
| Auto-merge on performer update | `performerUpdate` / `bulkPerformerUpdate` seen in `fetch` | yes, every scene of the performer |

Everything funnels into two functions — `runMergeTagsIntoScene` (one scene) and
`runMergeTagsIntoAllPerformerScenes` (a performer's scenes) — plus `stageTagsIntoSceneForm` for
the staging path. Add behaviour to those, not to the callers.

## 2. Code map

The file is sectioned with `── ... ─` comments, in this order:

1. Settings object and `stagingActive()` / `warnNoStagingOnce()`
2. **Cross-plugin cooperation** — `coop()`, respecter registration, `autoMergeSuppressed()`
3. Helpers — `guarded()`, `gqlRequest`, `updateSceneTags`, `tagFields()`
4. Merge logging (`logMergesToConsole`)
5. `resolveExclusionTagId()` and its TTL cache
6. Core merge logic — `tagIsMergeable`, `mergeTagsIntoScene`, `runMergeTagsIntoScene`
7. Staging — `installTagSelectPatch`, `findSceneTagControl`, `stageTagsIntoSceneForm`
8. `mergeTagsIntoAllPerformerScenes`
9. Settings loading and its throttle
10. Fetch interception
11. Performer button
12. Scene button
13. Main loop — refresh strategy, `maybeGoToEdit`, `tick()`, observer, bootstrap

## 3. The invariants

These are the things that will look like dead weight and are not.

**`guarded()` / `_mergeDepth`.** Every entry point into merge work is wrapped in `guarded()`,
which increments a counter for the life of the returned promise; the `fetch` wrapper returns early
while it is non-zero. Without it, our own `sceneUpdate` would re-trigger auto-merge. It is a
**counter, not a boolean**, because flows overlap — a bulk update racing a single one, a button
click racing auto-merge — and the first to finish must not re-open interception for the others.
It is also strictly *internal*: suppressing *other* plugins is what the lease in §7 is for.

**`mutationSucceeded()` clones the response.** `fetch` resolves for HTTP 500 and for GraphQL
errors returned with HTTP 200, so "the request came back" is not "the edit was saved". Our handler
is attached before Apollo's, so the body is still unread and a `clone()` is safe; a `clone()`
failure falls back to assuming success rather than skipping the merge. Auto-merge must never act
on a save Stash rejected.

**The two regexes are not redundant.** `/\bsceneUpdate\b/` does not match `bulkSceneUpdate` (the
capital S breaks it), so both branches are needed, and each reads its ids from a different place
(`input.id` versus `input.ids`). Note the consequence for other plugins: anything issuing a
mutation whose query text contains `bulkSceneUpdate` will be reacted to. That is exactly why
`NormalizeParentTags` needs the lease.

**The `performerUpdate` cache-invalidation branches are unconditional** — not gated on
`autoMergeOnPerformerUpdate` — because they invalidate `performerCheck`, which decides whether the
button appears. A performer gaining its first tag has to make the button appear whether or not
auto-merge is configured. Do not "tidy" them into the auto-merge conditions.

**The exclusion-tag lookup rejects rather than resolving to `null` on error.** Treating a failed
lookup as "no exclusion configured" would merge tags into the very scenes the user asked to
protect, and tags are never removed again. Hits are cached 60s, misses 10s, both keyed on the
configured name, so creating or deleting the tag is noticed without a page reload.

**`per_page: -1` in `resolveExclusionTagId`.** Stash compiles the `EQUALS` modifier to SQL `LIKE`,
where `_` and `%` are wildcards, so a name containing either can match far more tags than one page
holds — and the exact match falling off page 1 would silently disable the filter. The client-side
re-check on `t.name === name` exists for the same reason (the server match is case-insensitive).

**The exclusion tag is never propagated.** `tagIsMergeable` rejects it: copying the "skip this
scene" tag onto scenes would permanently exclude them from every future merge.

**Custom-field matching is presence-only, via `hasOwnProperty`.** Values are JSON, so a text
`"false"` is truthy in JS and any value-based rule is surprising to configure. `in` would let
inherited keys like `constructor` match every tag.

**`runMergeTagsIntoAllPerformerScenes` loops on skips and only chains on work.** Recursing on
skipped scenes grew the stack a frame per scene and overflowed at roughly twelve thousand
consecutive skips — and skipping is the common path, since every re-run skips scenes that already
carry the tags. Failures are counted and thrown *after* every scene is attempted, so one bad scene
cannot cancel the rest.

## 4. Staging (the default for the scene button)

Stash's scene edit form does not render its tag list from `formik.values.tag_ids`. `useTagsEdit()`
keeps its own copy and calls `setFieldValue` as a side effect:

```js
function onSetTags(items) { setTags(items); setFieldValue(items.map(i => i.id)); }
```

Writing to formik alone would enable Save while leaving the visible chips stale. So the plugin
goes through `onSetTags`, which it reaches as the `onSelect` prop of `TagSelect`, observed through
`PluginApi.patch.before` — a pure observer that returns `[props]` untouched.

`TagSelect` is used all over Stash, so `findSceneTagControl(expectedIds)` picks the capture
belonging to this scene's edit form: newest first, preferring one whose contents match what the
control is *expected* to hold. Expected means our own last staged list if we have written to it,
otherwise the server's tags — matching on the server's tags instead would keep re-selecting the
stale pre-staging capture and report the same count on every click. If nothing matches (the user
hand-edited the box) the newest capture is the right answer anyway.

Three deliberate behaviours here:

- The diff is against **the form**, not the server, so hand-added or hand-removed tags survive and
  a second click without saving reports "No changes".
- `control.values` is updated the moment we stage, rather than waiting for React to re-render and
  be captured again.
- Where `PluginApi` is missing entirely, the button **merges and saves** and warns once to the
  console. The user never opted into review; they get what their Stash can support.

The patch is installed at script load, before the components it targets first render, with a
`load`-event retry only for unusual ordering.

## 5. Buttons, placement, and the caches behind them

**Two `.details-edit` containers.** Stash renders one in `DetailsEditNavbar` (detail view) and one
in the performer edit form, and swaps between them. Only the detail view lists the performer's
scenes, so matching on `.details-edit` alone would follow the user into the edit form. The navbar
is identified by its **Delete button**, which only the detail view renders. `insertBeforeDelete`
walks up from Delete to whichever node is the container's own child, because `insertBefore` only
accepts a direct child as its reference node.

**`performerCheck` / `sceneCheck`** cache per-id eligibility (`pending`/`yes`/`no`) so `tick()` —
which runs every second and on every DOM mutation burst — does not re-query. They are invalidated
by navigation and by the save-detection branches in §3, not by polling; a change made elsewhere
(another tab, a bulk edit) is not noticed until one of those happens.

**Caption flashing.** The scene button's messages are each shorter than "Add Perf Tags" so the
button never changes width, and `_sceneFlashToken` makes a later click supersede a running
sequence instead of the two fighting over the caption.

**Refresh strategy.** `refreshSceneData` / `refreshSceneList` evict from `window.__APOLLO_CLIENT__`
where it exists and only fall back to `location.reload()` otherwise. The reload path stores
`cpt2s_goto_edit` in `sessionStorage` so the user lands back on the Edit tab; `maybeGoToEdit`
always consumes that key — on a different scene, or on a 10s deadline if the Edit link never
renders — because leaving it behind would make an unrelated later visit jump into edit mode.
`_reloading` stops the ticks between the write and the unload from consuming it early.

## 6. Settings

`loadSettings` runs on link clicks, `popstate`, and a 10s timer. Navigation triggers fire far more
often than settings change and the query is not cheap (Stash cannot scope `configuration { plugins }`
to one plugin, so every call returns every plugin's settings), so it is throttled to one call per
2s with an in-flight guard. The periodic refresh passes `force` to skip the throttle but never the
in-flight check; navigation handlers wrap it in a function so a timer argument can never arrive as
`force`.

**`saveTagsImmediately` is inverted on purpose.** Stash has no default value for a plugin setting
and renders an unset `BOOLEAN` as unchecked, so the behaviour we want by default (staging) has to
be what "off" selects. Otherwise the box would read off while acting on, and the first click on it
would send `true` rather than `false`. Any new boolean whose desired default is "on" needs the
same treatment — and if it is a *destructive* default, it needs the opposite (see
`NormalizeParentTags`, where every type toggle is deliberately off).

## 7. The bulk-edit lease (1.1.0)

The protocol is documented in `../CLAUDE.md`. This plugin is the **reactive** side:

- `coop().respecters[PLUGIN_ID] = true` at load. This is what lets a bulk plugin tell "will stand
  down" apart from "too old to know" and warn the user accordingly — it is not optional bookkeeping.
- `autoMergeSuppressed()` drops expired leases, then reports whether any remain. Expiry is the
  reason a crashed bulk run cannot disable auto-merge until the next reload.
- It is called in the **four auto-merge conditions only**, with the regex test first
  (`/\bbulkSceneUpdate\b/.test(q) && !autoMergeSuppressed()`) so the one-time "standing down"
  console line is only emitted for a mutation that would actually have been reacted to.
- **Manual button clicks are never suppressed.** The user asked for those directly.

## 8. Logging

Two different prefixes, deliberately: user-facing merge lines use the full `[MergePerformerTagsToScenes]`
(via `logInfo`), diagnostics use the short `[cpt2s]`. Merge lines are `info` level, one per tag per
scene, and only for tags that actually changed something — a skipped scene, an already-present tag
and a failed update all produce nothing, which is why the one-time "logging enabled" banner exists
at all. `announceLogging` re-arms when the setting is switched off and on.

The extra fields the log line needs (`name` on tags, `title`/`files { basename }` on scenes) are
spliced into the queries only while the setting is on — see `tagFields()` and `sceneLogFields()`.
This is a UI plugin: it cannot write to the Stash server log or the Logs page, and the README says
so in three places because users keep looking there.

## 9. Tests

`node tests/run.js`. Four suites touch this plugin: `merge-logic`, `placement` (needs `jsdom`),
`logging`, `staging`, plus `coop` for the lease. See `tests/README.md` for what each covers.

`staging.test.js` is the most exposed, because it *models* `useTagsEdit` rather than calling it.
Anything touching §4 needs a click in a real Stash before it is believed. Same for §5: the suites
reproduce Stash's markup from memory, so they prove the plugin picks the right container out of
what it is given, not that Stash still gives it that.

When fixing a bug, confirm the new test fails against the unfixed plugin:
`SRC=/path/to/old.js node tests/merge-logic.test.js`.

## 10. Versioning

Patch digit for fixes, minor for features, in **both** `MergePerformerTagsToScenes.yml` and
`manifest` — and the `description` lives in both files too, so a wording change means editing
both. The `manifest` `files:` list ships `js`, `yml` and `README.md`; this file is development
material and stays out of it.
