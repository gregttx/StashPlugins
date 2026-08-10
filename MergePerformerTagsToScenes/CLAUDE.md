# CLAUDE.md — Merge Performer Tags To Scenes

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, `tick()` + MutationObserver, the bulk-edit lease) are in `../CLAUDE.md` and still
apply. The user-facing description is `README.md`; this file is for the reasoning that does not
belong in either.

**Status: released, 1.15.6.** Requires Stash 0.31.0 or newer — tag `custom_fields` (the
custom-field exclusion filter) and `PluginApi.patch` (staging) both arrived there.

**1.12.1 renamed both manual buttons** — "Add Tags to Scene(s)" → "Copy Tags to all Scenes",
"Add Perf Tags" → "Copy all Tags from all Performers" — to match the naming convention
`PropagateTagsAndPerformers` settled on ("Copy [all|common] [Tags|Perfs] [to|from] all
<plural>") when it grew its own source-side buttons for the same path. Purely cosmetic on this
side, but load-bearing on the other: that plugin's manual-button dedup (§7d here, `declares` on
its side) matches on this exact label text to tell "another plugin's button is showing" from
"it only could be" - unrenamed, the two plugins' buttons for `tags:performer>scene` would no
longer text-match and both would show at once, the exact duplicate this protocol exists to
prevent.

**1.12.2 fixed the scene button's own placement.** Live-tested against
`PropagateTagsAndPerformers` 0.9.2 with a second button sharing `.edit-buttons`: ours was
consistently the one left dangling alone on a wrapped second line, because `addSceneButton`
placed it with a plain `container.appendChild(button)` — landing after Save and Delete — while
its sibling, the performer button, has always grouped itself with the other non-destructive
actions via `insertBeforeDelete`. With only one button in the row this was invisible; DOM order
decides wrap order, and a button appended last is the one that overflows first. Fixed by giving
the scene button the same `insertBeforeSave` treatment `PropagateTagsAndPerformers` already uses
for its own target-side buttons — see §5.

**1.13.0 makes the relative order of the two plugins' buttons deterministic**, where 1.12.2 only
made sure both landed on the same side of Save/Delete. Both plugins' insertion functions re-find
the anchor's live position and insert immediately before it, so with two plugins doing that
independently, whichever one's async eligibility check resolved last ended up closest to the
anchor — a race decided by network timing that could flip between page loads. `coop().order` fixes
a priority per plugin (this one registers 20, `PropagateTagsAndPerformers` registers 10) and
`insertOrdered` reads it back off each button's `_coopOwner`, so the same relative order comes out
regardless of which plugin's check finishes first. Full reasoning in the repo-root CLAUDE.md
("Cross-plugin cooperation: deterministic button ordering"); see §5 below for what is specific to
this plugin's own two buttons.

**1.14.0 moves the scene button's anchor itself, from Save to Delete.** Further live feedback after
1.13.0 shipped was that "before Save" was never actually the wanted position — "between Save and
Delete" was. Since Delete already sits right after Save on every page that has one, anchoring on
Delete alone produces that without needing to know where Save is at all — so `insertBeforeSave`/
`findButtonByLabel` are retired, and the scene button now goes through the exact same
`insertBeforeDelete` the performer button has used since 1.1.0. `PropagateTagsAndPerformers` 0.11.0
ships the identical change to its own target-side buttons, for the same reported reason.

**1.15.0: that fallback was itself wrong, reported the very next round.** Group is not a page this
plugin touches, but the same shape of bug applies wherever a page has Save with no Delete at all —
`insertOrdered`'s no-anchor branch simply appends, which put a manual button *after* Save,
displacing Stash's own primary action from being the last thing in the row. The general rule, in
full in the repo-root CLAUDE.md ("Placing a manual button near Stash's own actions: important vs.
casual"): insert before the row's last button only when it is *important* — Delete or Save — and
append after it otherwise. `insertBeforeDelete` is renamed `insertBeforeImportantAction` and tries
Delete first, falls back to a re-added `findButtonByLabel`-based Save search only when Delete is
absent, and appends when neither is found. Not a reversion to the pre-1.14.0 `insertBeforeSave`,
which anchored on Save unconditionally rather than only when Delete is missing.

**1.15.1: none of the four versions above ever found Delete on the Scene edit row at all.** Reported
live against 1.15.0 — the row reads `Save · Delete`, and `container.querySelector('button.delete')`
returns null on it. Stash renders that Delete as `btn btn-danger` with **no `.delete` class**. The
class is real on the performer detail navbar, which is where the repo CLAUDE.md's "throughout" claim
came from and where `findPerformerDetailContainer` still relies on it, but it does not generalise.
So the class search found nothing, the Save fallback caught it, and the scene button landed *before*
Save on every page — which is exactly what 1.12.2 had done deliberately, then 1.14.0 and 1.15.0 each
believed they had changed. `insertBeforeImportantAction` now tries three things in order: `.delete`,
a text match on `'Delete'`, a text match on `'Save'`. `findButtonByLabel` becomes `findActionByLabel`,
matching `<a>` as well as `<button>` and trimming first, since the live report established neither.

**1.15.2 gives the scene button `mx-2` in place of `ml-2`.** A left-only margin was right while it
was appended at the end of the row; since 1.14.0 it sits *between* Save and Delete, so it had
nothing on its right and rendered flush against Delete — live-reported. The performer button already
moved off `ml-2` for exactly this reason when it started sitting between two of Stash's own buttons;
this is the same fix arriving one button later.

**The measurement that settled it, worth keeping because it retires a four-round guess.** On a live
Stash, `.edit-buttons` computes to **`display: block`** — not a flex row — and its own buttons to
**`margin: 0 10px 0 0`**, a right margin only, at a value no utility class in either plugin can name
(that Stash's root is 14px, so `mx-1` is 3.5px and `mx-2` is 7px). Two consequences, both of which
had been shipping wrong:

- **`row-gap` is inert there.** It is a flex/grid property, so `ensureRowGap` did nothing on Scene,
  Gallery and Image Edit, whose wrapped rows sat flush — while Group's `.details-edit`, which *is*
  flex, spaced correctly from the identical call. Same code, same value, opposite result, decided
  entirely by the container. The container is now asked which it is: `row-gap` where it is honoured,
  a bottom margin on our own buttons where it is not. The margin is safe in a block container for
  exactly the reason it was a regression in a flex one (`PropagateTagsAndPerformers` 0.9.2) — a
  block container has no flex line whose cross-size a margin box could inflate.
- **A fixed margin class cannot match a row whose own convention is 10px.** `mx-1` produced 13.5px
  after Save, 7px between two of ours and 3.5px before Delete. Rather than guess a fourth value,
  both plugins now copy the computed margins off a button *Stash* put in the row — identified by
  having no `_coopOwner`, so neither plugin's own buttons can be mistaken for Stash's. Every
  boundary in the row then matches, and it self-calibrates to a container that has never been
  measured from here, which is the point: `.details-edit`'s own convention is still unknown.

This plugin carries its own copy as `applyButtonSpacing` (1.15.3); the two share no module.

**1.15.4: the measurement was right and the page never saw it — Bootstrap's spacing utilities are
`!important`.** The `mx-2` both on-page buttons were built with outranked the inline
`margin-left`/`margin-right` copied from the row, so every horizontal gap stayed exactly what it had
been. The tell was the *same* `cssText` assignment working in the other axis: `margin-bottom`, which
no utility class sets, visibly fixed wrapped rows in that same release. **One declaration landing and
its neighbour not is a specificity problem, not a wrong value.** `SPACING_CLASS` is now off the
button at build time and added back by `applyButtonSpacing`, only on the branch with nothing to
measure — so the class and the measurement can never both be in play. Three cases, in order: a
container spacing its children with `column-gap` (ours inherits it, so a margin would be *added* to
the row's spacing rather than match it) gets nothing; a row with a donor gets the donor's margins; a
row with neither gets `mx-2`. A donor is any element carrying `btn` with no `_coopOwner`, not just a
`<button>` — Stash styles some row actions as links, as 1.15.1 already established for Delete — and
the test for one is a *positive* length check, since a style engine with no stylesheet loaded reports
`''` rather than `0px` and the old inequality read that as a margin worth copying.

**1.15.5: matching a button exactly is not the same as looking right next to it.** The gap between
two inline siblings is the first's right margin plus the second's left, and the donor's margins are a
*right* margin only — so copying them gave our button `margin-left: 0`. Correct on `.edit-buttons`,
where every one of Stash's buttons carries the right margin (and where it is what keeps a wrapped
second row flush with the first). Wrong on the performer navbar, which Stash spaces unevenly — its
own `Auto tag...` and `Merge` touch each other there — so our button landed flush against
`Submit to Stash-Box`. `fillNeighbourGaps` takes the row's *step* from the donor and adds only what
each actual neighbour is not already contributing, which is a no-op on the edit rows and the fix on
the navbar. The no-previous-element case is deliberately 0: our button starting the row should sit
on the same edge Stash's own first button does.

**1.15.6 measures that contribution rather than deriving it.** Reading the neighbour's own
`margin-right` answers "what does this element contribute to the gap" only where the element beside
ours is the button the user sees. On `PropagateTagsAndPerformers`' Group pages it is not — the gap
there was already right, so 1.15.5's top-up doubled it — and whatever produces such a gap (a wrapper
element, container padding, a margin on something invisible) `getBoundingClientRect` already accounts
for. This plugin's own two pages were not affected; the change is here because the rule is one design
in two copies and letting them drift is how the dialog CSS drifted for four months. `horizontalGap`
separates three cases: a measurable gap, no layout at all (fall back to the margin reading — the test
harnesses, and an undisplayed container), and two siblings on different visual rows, where the
horizontal distance means nothing and the left edge should stay flush.

**The lesson is bigger than the fix, and it is why 1.12.0–1.15.0 read as churn.** Four versions
argued about *which* anchor to prefer while the anchor search was failing on the row being tested.
A class confirmed on one page is evidence about that page. Before moving an anchor again, check the
current one is being found.

---

## 1. What it does, and the five paths that do it

Performer tags are copied onto scenes. Merging only ever **adds** tags — which is the assumption
behind half the decisions below, because a wrong merge cannot be taken back by the button that made
it. The single exception is the library-wide task's **Undo** (§7b), which removes tags that same
dialog added, and it is deliberately the only code in this plugin that removes a tag at all.

Five entry points share one core:

| Path | Trigger | Saves? |
| --- | --- | --- |
| Performer button, "Copy Tags to all Scenes" | click on the performer detail view | yes, every scene of the performer |
| Scene button, "Copy all Tags from all Performers" | click on the scene Edit tab | **stages** by default; saves if `saveTagsImmediately` |
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
is identified by its **Delete button**, which only the detail view renders. `insertBeforeImportantAction`
walks up from Delete to whichever node is the container's own child, because `insertBefore` only
accepts a direct child as its reference node.

**The scene button gets the same treatment as the performer button (1.12.2, re-anchored 1.14.0,
generalised to Delete-or-Save 1.15.0).** Before 1.12.2 the scene button was simply `appendChild`ed —
landing after Save and Delete, invisible with one button in the row but the one left to wrap onto
its own line the moment a second button (`PropagateTagsAndPerformers`' own) shares the row and DOM
order decides who overflows first. 1.12.2 gave it a Save-anchored `insertBeforeSave`/
`findButtonByLabel` (`.edit-buttons` carries no dedicated class for Save the way Delete has one, so
that pair walked `childNodes` matching on `textContent` instead), landing it before Save. Live
feedback after that shipped was that "before Save" was not actually the wanted position — "between
Save and Delete" was — and since Delete already sits right after Save on every page that has one,
anchoring on Delete alone produces that for free. 1.14.0 retired `insertBeforeSave`/
`findButtonByLabel` and the scene button called the performer button's `insertBeforeDelete`
directly.

**1.15.0: the design rule underneath this, stated in full.** A new button is inserted before
whichever of the row's buttons is *important* — one that must stay the last thing in the row, Delete
or Save being the two this plugin has ever shared a row with — and appended after everything
otherwise. `insertBeforeDelete` (renamed `insertBeforeImportantAction`) tries Delete first and falls back to a
Save search only when Delete is absent, appending when neither is found. **Since 1.15.1 "tries
Delete" means two searches, not one** — `.delete`, then a text match — because the class turned out
not to exist on the Scene edit row at all, which is what made 1.12.0–1.15.0 look like churn. This plugin has no live page that reaches
the Save fallback — Scene Edit always renders both — but the mechanism is shared with
`PropagateTagsAndPerformers`' target-side buttons, which do (Group's edit form has no Delete), and
`placement.test.js` proves this plugin's own copy of the fallback anyway, since a shared *design*
between two plugins with no shared *module* is exactly the kind of thing that can quietly drift.
`PropagateTagsAndPerformers` carries an identical `insertBeforeImportantAction` under the same name
for its own target- and source-side buttons; the two are separate copies because the plugins share
no module, not because the logic differs.

**`insertBeforeImportantAction` finishes through `insertOrdered` (1.13.0)**, not a raw
`container.insertBefore(button, anchor)`. Finding the anchor is unchanged; what changed is what
happens once it is found — `insertOrdered` walks back over already-placed siblings, skipping any
owned (`_coopOwner`) by a plugin `coop().order` ranks higher than this one's own 20, so a button
`PropagateTagsAndPerformers` (registered at 10) already placed is never displaced from its anchor by
this plugin's own insertion. See the repo-root CLAUDE.md for the full mechanism; this plugin's own
two button builders (`addPerformerButton`, `addSceneButton`) are what tag their elements with
`_coopOwner = PLUGIN_ID` before calling `insertBeforeImportantAction`.

**`performerCheck` / `sceneCheck`** cache per-id eligibility (`pending`/`yes`/`no`) so `tick()` —
which runs every second and on every DOM mutation burst — does not re-query. They are invalidated
by navigation and by the save-detection branches in §3, not by polling; a change made elsewhere
(another tab, a bulk edit) is not noticed until one of those happens.

**Caption flashing.** The scene button's messages are each shorter than "Copy all Tags from all Performers" so the
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

### Descriptions: a summary on the page, the rest on hover (1.11.0)

The same feature as `NormalizeParentTags` 1.7.5, ported here so the two settings pages read alike.
A description written as `summary\n\ndetail` shows only its first paragraph; the rest opens in a
tooltip, and the group description keeps its first paragraph behind a **Show more** toggle. Five of
the nine settings have a detail half; the visible text drops from 1334 characters to 691.

The full reasoning is in §6 of that plugin's CLAUDE.md and is not repeated. What matters on this
side:

- **The CSS is shared.** `.tipped`, `.tip`, `.tipbox`, `.tipped.tip-open .tipbox`,
  `.desc-collapsed`, `.desc-toggle` are now defined by both plugins, so `tests/style.test.js`
  compares them with the prefix stripped and fails on any difference. Change both together or
  neither — this is the same rule that already governs the dialog chrome.
- **The tooltip is a built element, not a native `title`.** A `title`'s font size, position and
  delay all belong to the browser, and it opens below-right of the pointer, under the arrow that
  summoned it. Stash's own `<h3 title>` slot is left empty on purpose: a `title` there would put
  the same words in the small tooltip the box exists to replace.
- **Three triggers, one box** — the mark, the visible summary and the setting's name — wired by a
  JS-toggled class rather than a `:hover ~` selector, because the three do not sit in one
  predictable place and this repo has shipped broken twice on a guess about that markup.
  `pointer-events:none` on the box is load-bearing: opened from the name it lands over the `<h3>`,
  and a box that took the pointer would flicker.
- **`SETTING_KEYS` is new and has to be kept in step with the manifest.** Unlike the sibling, this
  plugin had no table of its manifest keys — `loadSettings` reads its nine `ps.*` by hand (§6). A
  key missing from that array is simply never given a tooltip, silently.

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

## 7d. Declaring the path, and warning about a third plugin doing the same one (1.12.0)

`PropagateTagsAndPerformers` implements the same one path this plugin does —
`tags:performer>scene` — among thirteen others, and coexists with this plugin by design (its own
CLAUDE.md D3). `checkSibling` above is the wrong tool for noticing that: it is a *name-based* check
against one specific plugin's specific settings, built for a collision (NPT's prune/roll-up versus
any additive write) that has nothing to do with matching paths. This is the opposite shape of
problem — two plugins doing the *identical* thing — and it needed a mechanism that does not name
either side, so a third relationship-copying plugin gets the warning for free. See "Cross-plugin
cooperation: the `declares` registry" in the repo-root CLAUDE.md for the full design.

**Declared unconditionally at load**, alongside `respecters[PLUGIN_ID] = true`:
`coop().declares[PLUGIN_ID] = ['tags:performer>scene']`. Unconditional because this plugin always
performs that one path, via its buttons at minimum, regardless of what its auto-merge settings say
— the same reasoning as the respecter flag being unconditional.

**`checkDeclaredOverlap()` reads the registry, not any plugin's settings.** It scans
`coop().declares` for any *other* plugin id whose array contains `'tags:performer>scene'` and notes
it in the log — informational, never a head warning, because redundant work between two
add-only plugins is never wrong data. Called from `begin()` right after `checkSibling()`; the two
are independent and both can fire in the same run.

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

`placement.test.js` also covers the scene button's own placement, in its own Scene Edit tab section
using an `.edit-buttons` fixture rather than the performer page's dual-container one: since 1.14.0,
the button lands between Save and Delete rather than before Save or after both, including a Delete
nested inside a wrapper element (the target side never needed this check before 1.14.0, since it
never searched for Delete). Confirmed to fail against a copy of the pre-1.12.2 plain `appendChild`
(landing after both), and separately against a copy with the 1.12.2-through-1.13.0 Save-anchored
walk restored (landing before Save instead of between).

Since 1.15.0: a fixture with Save and no Delete at all - not a shape Scene Edit is ever actually seen
in, but `insertBeforeImportantAction` is a mechanism shared with `PropagateTagsAndPerformers`, whose
own target-side buttons do meet this shape (Group), so this plugin's copy of the same Save-fallback
logic gets its own proof rather than relying on it never being exercised for real. The button lands
before Save rather than appended after it, and Save stays the row's last child. Fails against a copy
with the Save fallback removed from `insertBeforeImportantAction`, confirming the check exercises
the fallback itself rather than passing on `insertOrdered`'s unrelated no-anchor branch.

Since 1.15.1: `SCENE_EDIT_VIEW_UNCLASSED_DELETE`, the row a live Stash actually renders - Delete
present, `.delete` absent. Two of its three checks fail against 1.15.0 (the button lands before Save
instead of between Save and Delete); the third, that Delete stays the row's last child, passes
against both and is there to catch the opposite regression rather than this one. The fixture's
Delete is deliberately an `<a>` with padded text, because the live report established neither the
tag nor the whitespace - an exact-match search restricted to `BUTTON` would pass a tidier fixture
while still failing the real page.

Since 1.13.0 it also covers deterministic ordering (`coop().order`): this plugin registers priority
20 at load; a lower-priority foreign button (`PropagateTagsAndPerformers`, seeded at 10 via
`_coopOwner` on a fixture element, since the harness only ever runs this plugin's own script) is
not displaced from Delete when this plugin's own scene button inserts; and, the direction that
actually exercises `insertOrdered`'s skip branch rather than passing by coincidence, a *higher*-
priority foreign button (a fictitious 30, since nothing in this repo currently outranks 20) is not
displaced either - this plugin's own button yields and lands on the far side of it instead.
Confirmed against a copy with `insertOrdered` reverted to a plain `container.insertBefore(button,
anchor)`, which fails exactly those two checks and nothing else.

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

And §7d: the plugin declares its own path unconditionally at load; a second plugin's `coop().declares`
entry naming the same path is noted in the log, informationally, through `openWithDeclares` (the same
shape as `openAfterSettings`, seeding the registry instead of a respecter flag); a different path
from the same plugin is not mentioned; and nothing else declaring the path says nothing. Confirmed
against a copy without the feature, which throws on the registry lookup rather than merely failing a
check — the cleanest possible proof the check exercises real code.

`merge-task.test.js` also covers the 1.11.0 settings-page split: the group description collapsing
behind a `<button>` toggle that expands and flips its caption, a two-paragraph setting keeping only
its first paragraph, the detail being an *element* rather than a native `title` (with no `title`
left on the mark or the name to double up with it), a focusable mark, all three triggers opening
and closing the same box, and `pointer-events:none` pinned by name. Twelve of them fail against
1.10.5.

`style.test.js` needs no harness at all: it reads both plugins' CSS strings as text and fails on any
rule the two dialogs define differently. Since 1.11.0 that includes the settings-page tooltip
rules, which are the same in both plugins by design. The shared-chrome rule it enforces is in the repo-root
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

**The description is a link plus the text, in three files.** It leads with a README permalink
pinned to a **commit SHA**, not `main`, so a user reading it in Stash gets the documentation for
roughly the code they have rather than whatever `main` says today. A commit cannot contain its own
hash, so the SHA is the revision where the README last changed — update it whenever the README does,
not on every version bump. The same string lives in ``MergePerformerTagsToScenes.yml`` and in `manifest`'s
`metadata.description`; they must match, and both must stay **double-quoted**, because the text
contains `": "` and a plain YAML scalar cannot hold that (MergePerformerTagsToScenes's manifest was unparseable YAML
until 2026-08-06 for exactly this reason).

**`url:` is the only clickable link Stash offers here** (1.5.4 / 1.9.3). Read from Stash's own
source rather than guessed: `SettingsPluginsPanel.tsx` passes `subHeading: plugin.description` into
`Inputs.tsx`, which renders `<div className="sub-heading">{subHeading}</div>` — a React child, so
markup in a description is escaped and shows as literal `<a href=…>` text. There is no markdown
either. The manifest's `url` (`URL *string \`yaml:"url"\`` in `pkg/plugin/config.go`) is rendered
by `renderLink` as an `ExternalLink` button — a chain icon in the plugin's header row, beside
Enable/Disable. Icon only: it takes no anchor text, so the link cannot be labelled.

The description does **not** carry the URL. It did until 1.6.0/1.10.0, on the theory that the text
reached places the icon does not; in practice Stash renders it as plain text, so it was an
unclickable 90-character prefix in front of every word that mattered. The two links are `url:` and
the injected one, and they must stay identical — the `version` suite fails if they drift.

**The description is paragraphs, and it takes two tricks to show them.** Stash renders it as one
text node inside a `.sub-heading` that is `white-space: normal`, and a description cannot carry
markup, since Stash passes it to React as a child. So the plugin marks its own settings group with
`.cpt2s-own-group` — in the tick that injects the README link, and on **every** tick, because React drops
anything we add whenever it re-renders the panel.

- **`white-space: pre-wrap`, scoped to that class**, makes the newlines visible at all. Scoped, never
  applied to `.sub-heading` at large: another plugin's description is not ours to reflow, and may
  well have been written for the collapse.
- **The paragraphs are then rebuilt as `.cpt2s-p` divs**, because a blank line under `pre-wrap` is always
  one whole line-height and nothing in CSS can target it. Splitting on blank lines drops them and
  the gap becomes `margin: 0 0 .35em` — about a third of a line. `splitDescription` is idempotent
  (once the children are ours there is no text node left to split) and re-runs after a re-render
  puts the text node back.

The two together mean the text degrades sensibly: if only the CSS applies, the paragraphs show with
full blank lines between them; if neither does, it collapses into prose that still reads, because
every line break falls at the end of a sentence. It is stored as a double-quoted one-liner with
`\n` escapes rather than a YAML block scalar, so the file stays greppable line by line and
`version.test.js` can keep reading it with a regex.

**Both point at `/blob/main/`, not a SHA** (1.6.2 / 1.10.2). A pinned revision was the first
instinct and it was tried: it means the link shows the documentation for roughly the code the user
has, rather than whatever `main` says today. Two things killed it. A SHA has to be **pushed** before
GitHub can resolve it, and pinning to a commit that was still sitting on a local branch shipped a
404 twice. And it has to be re-pinned every time a README changes, which is a step nothing enforces
and everything forgets — a link that silently rots into old documentation is worse than one that
tracks the branch. `main` is always current and always resolves; the cost is that a user on an old
version reads the newest docs, which the version line in the console at least lets them notice.

**And a labelled link of our own** (1.10.0). The chain icon is easy to miss, so the plugin injects
`<a>MergePerformerTagsToScenes/README.md</a>` into its own settings group, under the description. The
constraints that led here are worth keeping, because they close off the cheaper-looking routes:
Stash renders the description as a React child, so markup in it is escaped; CSS `content` cannot
carry an `href` and is not even copyable in Chrome; and there is no markdown anywhere in that panel.
JS is the only way to get link text.

Three details it depends on:

- **The group is found by the `plugin-<id>-<setting>` element ids**, never by heading text — the
  rule §2 of `NormalizeParentTags`' CLAUDE.md exists for, having shipped broken twice on headings.
- **It is re-added, not tracked.** React re-renders the panel on every settings change and drops
  anything injected into it, so the tick puts it back; the id keeps that from producing a second
  one.
- **Clicking it does not fold the group**, because `SettingGroup`'s `onDivClick` walks up from the
  event target and returns early for `a` and `button`. Read that before moving the link anywhere.

`README_URL` in the script, `url:` in the yml and the URL at the head of the description are the
same pinned revision, and the `version` suite fails if they drift apart.

**Three places, not two, since 1.8.3.** `PLUGIN_VERSION` at the top of the script is the third,
and it is the only one that says anything about the code actually running: the yml and the manifest
are read by Stash over GraphQL and go current the moment plugins are reloaded, while the browser may
still be executing a script it cached before the edit. The constant is printed to the console at
load, so "which version am I running" has an answer that a stale script cannot fake — a heading
reading 1.8.3 over older behaviour is the normal look of a cached script, not a contradiction.
`tests/version.test.js` loads the plugin and fails if the printed version and the manifest disagree,
which is what stops the third place from drifting.

