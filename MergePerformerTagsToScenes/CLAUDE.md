# CLAUDE.md — Merge Performer Tags To Scenes

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, `tick()` + MutationObserver, the bulk-edit lease) are in `../CLAUDE.md` and still
apply. The user-facing description is `README.md`; this file is for the reasoning that does not
belong in either.

**Status: released, 1.9.1.** Requires Stash 0.31.0 or newer — tag `custom_fields` (the
custom-field exclusion filter) and `PluginApi.patch` (staging) both arrived there.

---

## 1. What it does, and the five paths that do it

Performer tags are copied onto scenes. Merging only ever **adds** tags — which is the assumption
behind half the decisions below, because a wrong merge cannot be taken back by the button that made
it. The single exception is the library-wide task's **Undo** (§7b), which removes tags that same
dialog added, and it is deliberately the only code in this plugin that removes a tag at all.

Five entry points share one core:

| Path | Trigger | Saves? |
| --- | --- | --- |
| Performer button, "Add Tags to Scene(s)" | click on the performer detail view | yes, every scene of the performer |
| Scene button, "Add Perf Tags" | click on the scene Edit tab | **stages** by default; saves if `saveTagsImmediately` |
| Auto-merge on scene update | `sceneUpdate` / `bulkSceneUpdate` seen in `fetch` | yes |
| Auto-merge on performer update | `performerUpdate` / `bulkPerformerUpdate` seen in `fetch` | yes, every scene of the performer |
| Library-wide task (1.2.0, review pass 1.3.0) | click in Settings - Tasks - Plugin Tasks | yes, after the user presses **Proceed** |

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
10. **Library-wide task** — the dialog, `checkSibling()`, the walk over every performer, the apply
    and its Undo, and layer 1 of the task-click interception
11. Fetch interception (layer 2 of the task interception sits at the top of the wrapper)
12. Performer button
13. Scene button
14. Main loop — refresh strategy, `maybeGoToEdit`, `tick()`, observer, bootstrap

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

**One filter, one implementation, three paths.** `sceneIsExcluded` answers the scene-level half
(Organized, the exclusion tag) and `sceneMergePlan` folds it together with the missing-tag diff.
`runMergeTagsIntoScene`, `runMergeTagsIntoAllPerformerScenes` and the task's review pass all go
through `sceneMergePlan`; only `stageTagsIntoSceneForm` stops at `sceneIsExcluded`, because it
reports "Scene excluded" as a distinct outcome and then diffs against the *form* rather than the
server. Until 1.4.1 the single-scene path had its own inline copy of both halves, which meant a
new scene-level filter had to be written three times to be right.

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

**The manifest keys carry ordering prefixes; the internal names do not.** `settings:` is a YAML
map, so the manifest's declaration order is lost and the settings page renders the keys **sorted
alphabetically** — which put "Save Tags Immediately" five rows below the button toggle it modifies
and does nothing without. Since 1.1.1 the keys are `a1`–`a4` (what starts a merge: buttons, the
staging flag right under them, then the two auto-merge modes), `b1`–`b2` (scene-level exclusions),
`c1`–`c2` (tag-level exclusions), `d1` (logging, last — it changes no behaviour). The same scheme
runs in `NormalizeParentTags`, down to `c1ExcludeTagWithIgnoreAutoTag` being the same key in both.

Those prefixed names appear in exactly two places: the manifest, and the nine `ps.*` reads in
`loadSettings`. Everything else uses the plain internal names, and this file follows the same
rule — prefixed where a manifest key is meant, plain where the code's own flag is. A key is also
the storage key, so the 1.1.1 rename reset everyone's settings once; there is no compatibility
shim, and doing it again needs a better reason than tidiness. (`NormalizeParentTags` does read the
*sibling's* wire names to detect auto-merge, and does accept both spellings — losing that warning
silently is the dangerous direction.)

**`a2SaveTagsImmediately` is inverted on purpose.** Stash has no default value for a plugin setting
and renders an unset `BOOLEAN` as unchecked, so the behaviour we want by default (staging) has to
be what "off" selects. Otherwise the box would read off while acting on, and the first click on it
would send `true` rather than `false`. Any new boolean whose desired default is "on" needs the
same treatment — and if it is a *destructive* default, it needs the opposite (see
`NormalizeParentTags`, where every type toggle is deliberately off).

## 7. The bulk-edit lease (1.1.0, both sides since 1.5.0)

The protocol is documented in `../CLAUDE.md`. This plugin sits on **both** sides of it, because
the roles are per run rather than per plugin: auto-merge is reactive, the library-wide task is
bulk. Keep the two halves apart in your head — they never run against each other (§7a).

The **reactive** half:

- `coop().respecters[PLUGIN_ID] = true` at load. This is what lets a bulk plugin tell "will stand
  down" apart from "too old to know" and warn the user accordingly — it is not optional bookkeeping.
- `autoMergeSuppressed()` drops expired leases, then reports whether any remain. Expiry is the
  reason a crashed bulk run cannot disable auto-merge until the next reload.
- It is called in the **four auto-merge conditions only**, with the regex test first
  (`/\bbulkSceneUpdate\b/.test(q) && !autoMergeSuppressed()`) so the one-time "standing down"
  console line is only emitted for a mutation that would actually have been reacted to.
- **Manual button clicks are never suppressed.** The user asked for those directly.

The **bulk** half is `acquireLease()`, taken around the task's apply phase only — the same shape
as `NormalizeParentTags`', down to the 5-minute TTL, the per-unit `renew()`, and releasing on
success, on failure and on **Stop**. The two implementations are separate because the plugins
share no module; keep them readable against each other.

`autoMergeSuppressed()` will see our own lease during a task apply, which sounds like a plugin
standing itself down but is not: `guarded()` has already short-circuited the `fetch` wrapper for
every write the task issues, so the only mutation that can reach those branches while the lease is
held is a *user's* save in the same tab — which is precisely one that should stand down. The
console line naming us as the owner is accurate in that case.

## 7a. The library-wide task (1.2.0)

Declared under `tasks:` in the manifest so Stash renders it natively in **Settings → Tasks →
Plugin Tasks**, and caught in the browser, because this plugin has no `exec` and a queued job
could only fail. The mechanism is the one `NormalizeParentTags` established and it is deliberately
identical — capture-phase click listener keyed on the task name *within* a `SettingGroup` headed
with the plugin name, plus a backstop in the `fetch` wrapper keyed on `plugin_id`. Read §2 of that
plugin's CLAUDE.md before changing either layer.

One thing differs and matters: **layer 2 sits at the very top of the `fetch` wrapper**, ahead of
the `_mergeDepth` early return. A task click is a user action and stays one even if a merge happens
to be in flight, and the mutation has to be *answered* rather than forwarded — so it cannot go
through `_fetch` first the way the auto-merge branches do.

**Two phases, like the sibling.** Phase 1 walks the library read-only and lists every tag it
would add to every scene; **Proceed** is disabled until it finishes and stays disabled when the
plan is empty. Phase 2 writes the plan. The first cut of this task had only a confirmation step —
it described the active exclusions and started on **Start** — which guarded "you meant to press
this" rather than "here is what it will do". The cost of the review pass is real: it is the same
per-performer scene query the apply would issue, so a run is roughly twice the wall clock. That is
the price of being able to read the plan before a library-wide write with no undo.

**The plan is keyed by scene, not by performer.** A scene featuring two performers is missing tags
from both, and `updateSceneTags` writes the *whole* tag list. Two entries for one scene, each
carrying that scene's scan-time tags, would have the second write drop what the first added.
`planScene` folds every performer's needs into one entry per scene, and the entry records which
performers contributed so the log can still attribute it. This is the one thing in the task that
would silently lose data if it were rearranged.

**One `guarded()` around the whole apply**, not one per scene. Every scene the task writes would
otherwise look to our own `fetch` wrapper like a user edit and re-enter the merge.

**Performers are paged** (`TASK_PAGE_SIZE`, sorted by id), not fetched with `per_page: -1`: a large
library has tens of thousands and one response holding all of them is a tab that stops responding.
Their tags come back with the page, so the review needs no second query per performer, and a
performer with nothing mergeable never costs a scene query at all.

**`sceneMergePlan` is shared by every saving path.** It is the single place that decides whether a
scene is skipped and which tags it is missing, so the plan the user approves and the write that
follows cannot disagree. Do not fork it for any caller — see §3.

**`taskTagFields()` always requests `name`,** unlike `tagFields()`, which adds it only while console
logging is on — the review log names every tag it plans to add regardless of that setting.

**`finishApply()` must not call `refreshSceneList()`.** Its fallback is `location.reload()`, which
would tear down the dialog and the log at the moment the user wants to read or copy it. The task
evicts the Apollo scene-list cache directly and accepts a stale list where Apollo is absent.

**Each phase closes with a tag recap** — every distinct tag the run moves and how many scenes it
lands on, `to add` for the plan and `added` for what was written:

```
[INFO] 3 tag(s) to add: "Zed" (20) x2, "Volume 2" (22) x1, "volume 10" (21) x1
```

Counted **per scene, not per performer** (a scene is written once whichever of its performers
asked for the tag), and the applied recap is counted from the writes rather than the plan, so a
failed scene or a **Stop** is not summarised as though it had landed. Ordering is Stash's own —
`COALESCE(sort_name, name)` under `NATURAL_CI`, via `Intl.Collator({ numeric: true, sensitivity:
'accent' })` with the id as tie-break — which is why `taskTagFields()` asks for `sort_name`. The
same rule is documented at greater length in §3 of `NormalizeParentTags`' CLAUDE.md; the two
implementations are separate because the plugins share no module, so a change to one is a
deliberate decision about the other.

**The recap's tags hover** (1.8.0), naming their aliases and description — the sibling's tree-row
tooltip, in the one place this dialog enumerates tags. Four things hold it up:

- **The line is rendered as spans, not text.** `taskTagSummaryParts` returns segments and `log()`
  takes an optional `parts`; `flush` builds a span per segment when it is there and keeps the plain
  `textContent` path for every other line. `lines` still gets the joined string, because Copy log
  hands over text and a tooltip is not text.
- **Only tags with something to add carry a tooltip.** The span already reads `"Tattoo" (11) x18`,
  so a tooltip repeating that would open on a hover to say what is already on the line.
  `taskTagHasDetail` is the gate. Nothing marks which tags have one — 1.8.1 removed the dotted
  underline and help cursor 1.8.0 shipped with, because they read as decoration in a log that has
  none elsewhere — so a hover that opens has to earn it. The sibling's rows tooltip
  unconditionally, and that is not an inconsistency: there the full name is itself information,
  since a long one is cut off by the row.
- **One query, scoped to the recap.** `loadTagDetail` fetches `aliases` and `description` by id for
  the tags the recap names — tens of them, after a walk that read tens of thousands of performers.
  Putting the two fields on `taskTagFields()` instead would carry a paragraph of description on
  every performer's tag list, for a tooltip on a line at the end. This is the same trade as the
  sibling's viewer-only `tagQuery(settings, detail)`, and it assumes `findTags(ids:)` — verify that
  against a live Stash, as with every other assumption about its API.
- **Failure is silent.** It buys a tooltip, not a merge. An `[ERROR]` line in a log being read for
  what was written would cost more than a recap that does not hover, so the rejection handler does
  nothing and the line renders plain.

The wait is what makes `pass` necessary: `reset()` bumps it and `logTagSummary` captures it, so a
recap whose detail query is still in flight when the user presses **Rescan** is dropped instead of
landing in the middle of the next pass's log.

**Rescan** exists for the same reason it does in the sibling: the plan is computed before the first
write, so anything that changes tags during phase 2 — another tab, a scan, the auto-merge modes —
is invisible to the plan being applied. Since 1.4.2 `finishApply` closes with *"Press Rescan to
review what is left."*, the sibling's wording, because a finished run is not the same thing as a
settled library and the button alone does not say so.

**It takes a lease while it writes, warns about anyone else's, and stands down for neither.** The
lease covers phase 2 only — phase 1 writes nothing, so there is nothing to suppress, and holding
one across a library-wide review would stand a reactive plugin down for the half of the run that
cannot disturb it. Since `NormalizeParentTags` 1.1.0 the lease is actually honoured in this repo:
its auto-prune / auto-roll-up modes are reactive and stand down for ours, so this task no longer
has to rely on the user having turned them off. Its *dialog* still only warns about ours rather
than yielding to it, exactly as this one warns about its — both warnings are advisory because a
task click is manual, and §7's rule is that manual actions are never suppressed. Taking one anyway
was the point even while nothing listened: until 1.5.0 this run wrote across the whole library
announcing nothing, which is the case a third plugin could not have defended against.

## 7b. Undo (1.6.0)

The task dialog can take its own writes back. It is the **only** thing in this plugin that removes
a tag, and §1's "merging only ever adds" is written around that exception rather than despite it.

**It cannot be the apply inverted, the way the sibling's is.** `applyEntry` writes each scene's
*whole* tag list, because it is building one — `existingIds.concat(tagIds)`. Replaying that
inverted would mean writing `existingIds` back, which reverts anything changed since. So the undo
uses `removeSceneTags`: a `bulkSceneUpdate` with `tag_ids: { ids, mode: REMOVE }`, carrying only
the tags this run added. Delta, never a restore — the same rule as the sibling's, reached by a
different route because the forward writes differ.

**It groups where the apply cannot.** The apply is per scene because each scene's list is its own;
the undo only names tags to remove, so `buildUndoBatches` groups scenes by identical tag set and
chunks at `TASK_UNDO_CHUNK`, exactly as `NormalizeParentTags`' `buildBatches` does.

**`guarded()` around the whole undo is load-bearing, not decoration.** `bulkSceneUpdate` is
precisely what this plugin's own auto-merge watches for (§3, "the two regexes are not redundant").
Without the guard, an undo with Auto Merge On Scene Updates enabled would merge the tags straight
back into every scene it had just cleaned. The test for this drives an undo with that setting on
and asserts no `FindScene` query follows.

Everything else matches the sibling and the reasoning is in §5's Phase 3 of its CLAUDE.md rather than
repeated here: recorded on success only, newest scene first, session-scoped across a Rescan,
offered in `ready` as well as `done` and always finishing in `done`, an arm/confirm carrying the
scope in the caption, and a lease labelled `<task> (undo)`.

**The head warning changed with it.** It used to read "Tags are only ever added, never removed -
but there is no undo", and both halves of that are now wrong for this dialog. It leads with what
the merge does, keeps the backup instruction, and states Undo's limits.

## 7c. Warning about the sibling's reactive modes (1.7.0)

`NormalizeParentTags` 1.1.0 gained **Auto Prune / Auto Roll Up on Entity Updates**, which react to
entity saves the way our auto-merge does. `checkSibling()` is the mirror of the check that plugin
has always run against *us*: it reads the sibling's flags out of the shared
`configuration { plugins }` response — which we already pay for — and reports them at the top of
the task dialog.

**Both of its directions collide with a merge, differently, so the warning names which.** Auto
Prune removes the parent tags this merge adds, wherever a more specific tag on the same scene
implies them; Auto Roll Up piles further ancestors on top of them. A generic "the sibling is
active" would leave the user to work out which of those they are looking at.

**Both of its modes on at once is silence, not a double warning.** That is the sibling's own
documented no-op — they are exact inverses, so it runs neither — and warning about a mode that is
not running would send the user to switch off something already inert. `prune === rollup` covers
that and the both-off case in one test.

**Registered means reported; unregistered means warned.** `coop().respecters[SIBLING_ID]` is the
same signal the sibling reads about us, and a registered copy stands down for the lease the apply
takes, so it is an `INFO` line rather than a head warning.

**The unregistered branch is deliberately two-handed.** Not being registered means either the
plugin is disabled in Stash — its settings linger in the config response while nothing is running —
or the installed copy predates the protocol. There is no way to tell those apart from here, and
asserting the alarming one would cry wolf at every user who has the plugin installed but switched
off. The wording says both and leads with "if it is running". *(The sibling's mirror of this is
more assertive than ours; if that side is ever revised, align the two.)*

**It reads the last loaded settings rather than reloading.** The sibling's version reloads because
its dialog loads settings per run anyway; ours shares the plugin-wide `settings` refresh — the 10s
timer and the navigation triggers in §6 — which is the same freshness `describeFilters()` has always
run on. The failure mode is a task clicked within a second of a hard reload showing no warning,
which is the safe direction: no warning rather than a wrong one.

**It never blocks.** Same rule as the lease warning above it: a task click is manual, and §7's rule
is that manual actions are not suppressed.

## 8. Logging

Two different prefixes, deliberately: user-facing merge lines use the full `[MergePerformerTagsToScenes]`
(via `logInfo`), diagnostics use the short `[cpt2s]`. A merge line reads
`Tag "Blonde" (12) saved to Scene "My Scene" (345)` — the id sits **outside** the quotes on both,
which is what `NormalizeParentTags` does too, so a name containing brackets cannot be read as an
id. `sceneLogLabel` returns the quotes as part of the label; callers must not add their own.

**Say that the number is an id, wherever a user meets one** (1.7.6). The convention is only obvious
to whoever wrote it: a bracketed number reads just as easily as a count, and `"Blonde" (12) x250`
has one of each on the same line. So the task dialog carries a `cpt2s-legend` line under its warning,
and the "logging enabled" banner names it for the console path — the two places a log line is first
seen. The rule it states is what the code must keep true: **brackets are ids, counts are `x250`**.
Anything new that puts a count in brackets breaks the legend rather than merely reading oddly.
`NormalizeParentTags` says the same thing in the same two shapes; keep the wordings recognisable
against each other. Merge lines are `info` level, one per tag per
scene, and only for tags that actually changed something — a skipped scene, an already-present tag
and a failed update all produce nothing, which is why the one-time "logging enabled" banner exists
at all. `announceLogging` re-arms when the setting is switched off and on.

The extra fields the log line needs (`name` on tags, `title`/`files { basename }` on scenes) are
spliced into the queries only while the setting is on — see `tagFields()` and `sceneLogFields()`.
This is a UI plugin: it cannot write to the Stash server log or the Logs page, and the README says
so in three places because users keep looking there.

## 9. Tests

`node tests/run.js`. Five suites touch this plugin: `merge-logic`, `placement` (needs `jsdom`),
`logging`, `staging`, `merge-task`, plus `coop` for the lease. See `tests/README.md` for what each
covers.

`merge-task.test.js` runs on `npt-harness.js` rather than `harness.js`, because the task builds a
dialog and `harness.js` fakes only enough DOM for a plugin that injects a button. That harness now
takes the source path and plugin id as arguments (`run(ctx, src)`, `startTask(ctx, task, pluginId)`)
and its `dialog(body, prefix)` reads either plugin's markup — one fake DOM for both, rather than a
copy that drifts. It covers: the click never reaching the server, the review pass
writing nothing, a scene wanted by two performers being planned and written **once** with the union
of their tags, scenes that already carry the tag being skipped, untagged performers costing no
scene query, an empty plan disabling Proceed, the apply not re-entering its own auto-merge, a
failed scene isolated and not logged as merged, **Stop**, **Rescan**, and the closing tag recap in
both phases (including its Stash-order sorting and a failed scene dropping out of the applied
count). The Stop case presses the button from inside the responder on
the fifth write, so the moment it lands does not depend on how many ticks a flush happens to take.

It also covers the id legend from §8, in both of the places a log line is first met: the task
dialog's head, and — in `logging.test.js` — the "logging enabled" banner that stands in for a head
on the console path. And the recap's tooltips from §7a: the detail query scoped to the tags the
recap names and asking for the two fields the performer walk does not, the tooltip's contents, a tag
with neither field left plain, the line's text unchanged so Copy log is unaffected, and a failed
detail query leaving the recap readable and unremarked.

It also covers §7c: a registered sibling reported rather than warned about, an unregistered one
warning in the dialog head with the effect named per direction, both of its modes on producing
silence, and neither a sibling without an auto mode nor an absent one being mentioned at all. Those
cases start the task through `openAfterSettings`, which lets the bootstrap settings load land first —
`checkSibling` reads what that stored, so a helper that races it would test nothing. All four
behaviours were confirmed against deliberately broken copies before being trusted.

`style.test.js` needs no harness at all: it reads both plugins' CSS strings as text and fails on any
rule the two dialogs define differently. The shared-chrome rule it enforces is in the repo-root
CLAUDE.md.

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

**The dialog refuses to write with a stale script** (1.9.0). `checkVersion` asks Stash what version
of this plugin is installed (`query CPT2SPluginVersion { plugins { id version } }`) and compares it with `PLUGIN_VERSION`. On a
mismatch it warns in the head, naming both numbers and the fix, and **disables Proceed** until the
page is reloaded. Four things make that safe rather than obstructive:

- **Unknown is not a mismatch.** A Stash too old for the field, a plugin it cannot see, a failed
  request — all resolve to `null` and change nothing. The check exists to catch a stale script, not
  to make a run depend on one more query succeeding.
- **Only the two quiet outcomes go to the console**, beside the load banner. A matching version is
  the boring case, and a log line arriving whenever one small query resolves would land somewhere
  different every run — the dialog's log is about the library.
- **Undo is never gated on it.** It reverses writes this dialog already made; stranding the user
  with changes they cannot take back would be worse than the mismatch being guarded against.
- **It is the only warning here that blocks**, and the reason is worth keeping straight: every
  other one — the lease, the sibling's auto modes — is about the library or another plugin, where
  the user knows more than the dialog does. This one is about the dialog itself running code the
  user has already replaced, which is the one thing they cannot see.

It is not fired ahead of the scan but alongside it: one small query against a pass that reads the
whole library, landing long before Proceed is reachable, with `setState` re-applied when it does.
`begin()` calls it, so a rescan re-checks — the script cannot change without a page reload, but the
installed version can, and reloading plugins is exactly what the user does after seeing the warning.

**A plain F5 is normally enough** (measured 2026-08-06 against Stash 0.31.x): the browser
revalidates the plugin script on a normal reload, so the warning leads with F5 and keeps
Ctrl+Shift+R as the fallback. Do not talk the user straight into a hard refresh — the failure that
actually cost a session here was a `.js` that had never been copied into the plugin folder, where
no amount of refreshing helps and only the version line tells you so.

**What it cannot catch:** an edit with no version bump. Both numbers stay equal and the check is
blind, which is the practical argument for bumping the patch digit on every change.

**Three places, not two, since 1.8.3.** `PLUGIN_VERSION` at the top of the script is the third,
and it is the only one that says anything about the code actually running: the yml and the manifest
are read by Stash over GraphQL and go current the moment plugins are reloaded, while the browser may
still be executing a script it cached before the edit. The constant is printed to the console at
load, so "which version am I running" has an answer that a stale script cannot fake — a heading
reading 1.8.3 over older behaviour is the normal look of a cached script, not a contradiction.
`tests/version.test.js` loads the plugin and fails if the printed version and the manifest disagree,
which is what stops the third place from drifting.

