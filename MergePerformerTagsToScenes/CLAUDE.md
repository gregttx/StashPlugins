# CLAUDE.md — ᝯㄝₓ Merge Performer Tags To Scenes

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, `tick()` + MutationObserver, the bulk-edit lease) are in `../CLAUDE.md` and still
apply. The user-facing description is `README.md`; this file is for the reasoning that does not
belong in either.

**Status: released, 3.1.0.** Requires Stash 0.31.0 or newer — tag `custom_fields` (the
custom-field exclusion filter) and `PluginApi.patch` (staging) both arrived there.

**3.1.0 is the busy cursor.** `▙ ▛ ▜ ▟` under the last log line, one cycle at 2Hz, for as long as
the task dialog is reviewing, applying or undoing — the performer walk can spend seconds on one page
with the counters unchanged, which looks exactly like a hung tab. `spin(busy)` hangs off `setState`
and nothing else, `flush()` lifts the cursor out before appending and puts it back at the end, and
`close()` clears the interval for a dialog dismissed mid-write. It is `.cpt2s-spin`, never
`.cpt2s-line`, so neither the render cap nor `dialog().lines` sees it. Shared design, in the
repo-root CLAUDE.md; all four plugins took it in one release.

**3.0.0 is the second rename, and the same kind of change as 2.0.0.** The `GTTx ` prefix is now
`ᝯㄝₓ `, in the `.yml`, the `manifest`, `PLUGIN_NAME`, `PLUGIN_SHORT_NAME`, `SIBLING_NAME` and every
fixture in `tests/` that mounts a settings or tasks heading. The folder, the plugin **id**, every
setting key and every storage slot are untouched, so an upgrade keeps its configuration; the major
digit is for `ownTaskName` and the settings-page heading match now comparing against a different
string.

**The rename went into the `.yml` first, which is how it showed what each file is load-bearing
for.** With the manifest renamed and `PLUGIN_NAME` still on the old string, this plugin's settings
group was found as usual — `ownSettingGroup` enters through the `plugin-<id>-<key>` ids, and the
heading is only its fallback — while `ownTaskName`, which has **no id route and compares the
group's h3 against `PLUGIN_NAME` directly**, stopped recognising the task button: no interception
of Stash's own click, no amber. The sibling with neither route (`CustomFieldsBulkEditor`) lost its
whole settings panel. **A settings page that still looks right after a rename says nothing about
the tasks page.**

**2.4.1 takes the release notes out of the README.** The standing rule is new and lives in the
repo-root CLAUDE.md ("A README describes the plugin, not its history"): a block at the top of a
README is for a **major** version only - a rename, a settings reset, something a user already
running the plugin has to act on - and everything else belongs in the prose that describes the
behaviour, in the present tense. The 2.0.0 rename block is gone, and so is the 1.1.1 settings-reset notice - a major-version note that had outlived the upgrade it was written for, which is the case the rule's own exception is not meant to cover forever. The stale-script banner moved into *Checking which version is actually running*. Nothing was lost: each removed note had a section that
already covered its area, which is the test of whether the note was needed at all. The per-version
reasoning stays here, in a file that does not ship.

**2.4.0 puts the same warning in the dialogs.** The version check was always there and always
blocked Proceed; what changed is that its message is a box of its own (`.cpt2s-stale`, the settings
banner's red) under the dialog title, rather than a sentence appended to `noteEl` behind whatever
else the run had to say. Three things about it:

- **`showStale(msg)` rather than `note(msg)`**, and the message goes to the log by hand beside it.
  `note` does both, which is right for a warning about the *library* - the log is where a user reads
  those back. This one is about the dialog itself running code the user has already replaced, and it
  is the only warning here that blocks, so it gets its own place in the head and keeps the log line
  Copy log needs.
- **`begin()` clears it**, like the note beside it: a rescan after the reload the box asked for must
  not go on claiming the script is stale.
- **The harness's `dialog().note` now concatenates both boxes**, and `dialog().stale` reads the new
  one alone. Every existing check asking "does the head say so" keeps working and keeps meaning what
  it meant; the checks that are about *which* box a message is in name it.

**2.3.0 tells the user the script is stale, where they can see it.** Stash serves plugin JS with
caching on, so a browser can go on running the old file after an update with nothing on screen
saying so - and the settings heading is the one place the two numbers meet, since Stash builds it
as `${name} (${version})` from the **manifest**, read fresh from the server, while
`PLUGIN_VERSION` is what the browser actually loaded. `ensureStaleNotice` compares them on the
settings tick and puts a red banner in this plugin's own group when they disagree, naming both
numbers and **Ctrl+Shift+R**.

Four things it depends on, all four duplicated byte-identically across the four plugins like every
other shared mechanism here:

- **No query.** The number is already on the page, and this tick runs once a second.
  `installedVersion` asks the server the same question, which is right for a dialog that opens once
  and wrong for a timer - and `CustomFieldsBulkEditor`'s settings page is pinned by a test as
  issuing no queries at all.
- **The heading is read from the group already found**, never searched for across the page: the
  header row precedes the setting rows, which have h3s of their own, and a page carrying several
  plugins' groups would otherwise offer a stranger's version number.
- **Unknown is not a mismatch.** Settings → Tasks heads its group with the bare name and no
  version at all, so no parenthesised number means silence rather than a guess.
- **Above the description, inside the group header** - which is outside Stash's `<Collapse>`, so a
  collapsed group still shows it, and the README link's slot is untouched.

It catches only what a version bump makes visible; editing a file without bumping it leaves both
numbers equal and this check blind, which is the practical argument for the repo's patch-digit rule.

**2.2.3 is the last of the anchor archaeology.** "Spacing settled over 1.15.2 to 1.15.9" was the
one paragraph of it whose *body* described current behaviour, so it was rewritten rather than cut:
margins read off the row, measured against the button the user can see rather than the wrapper
beside it, and a wrapped row spaced by whichever mechanism that row's layout honours. The versions
are gone; the three facts are not. `../CLAUDE.md`'s placement section still carries the reasoning.

**2.2.2 drops the "you are on 1.15.0 or earlier" note.** It was the last piece of anchor history in
the README and it was kept back from 2.2.1's pass for being actionable rather than merely
historical; the user's call is that it goes with the rest.

**2.2.1 is a README pass.** The reference sections had accumulated version archaeology - "Since
1.13.0 the two plugins agree...", "0.9.1 supplied that gap with a margin, which turned out to..." -
which is a changelog written into the middle of an explanation of how the plugin behaves *now*. The
release-note blocks at the top of the README are the place for that, and they still have it; the
rest reads in the present tense. Nothing in the script changed but the version constant.

**2.2.0 keeps the log until the dialog closes, and gives Rescan a tooltip.** `rescan()` no longer
empties the rendered log — it writes `--- Rescan ---` and the next pass carries on below it, which is
what `CustomFieldsBulkEditor` has always done and what the user asked the other three to match. The
consequence is a **deletion**: `viewLines` existed only because a rescan emptied the view under the
counter, so with the view session-scoped it is exactly `lines.length` and is gone — the
`showing the last 1000 of N` clause reads that instead. All three siblings changed together, along
with the shared footer order: `CustomFieldsBulkEditor` moved Apply to the leading position this
dialog gives Proceed, so all four footers now read the same way round.

**2.1.2 says "id", not "Stash id", and never "(s)".** Two repo-wide wording rules landed together, and
both are in the root `CLAUDE.md`. *Stash ID* is already Stash's own name for a **stash-box**
identifier, so calling the local database id one was a claim about a metadata provider that had
never been consulted - every dialog head, legend and README here now says **id**. And every
generated `3 scene(s)` / `2 child(ren)` now agrees with its own count, through one
`plural(n, one, many)` helper held byte-identical in all four plugins beside `coopObject`.

**2.1.1 trims one word from the head.** "only while it stays open" is now "while it stays open" - the load-bearing "only" is the one in "reverses only what this dialog wrote", and a second in the same clause read as emphasis rather than a limit. All three dialogs were reworded together at the user's wording; `CustomFieldsBulkEditor` 0.4.1 carries the same sentence.

**2.1.0 adds Escape to the dialogs.** Every dialog here now closes on Escape, through whichever of Cancel/Close its footer is showing rather than around the footer - so the key does nothing mid-write, where both are hidden and Stop is the only way out. The head's backup line was reworded to "Backing up your database before proceeding is recommended." at the same version, in all four plugins; the sentence stating what Undo cannot reach is unchanged.

**2.0.1 is a README line.** A fourth plugin, `GTTx Custom Fields Bulk Editor`, joined the repo, so the upgrade banner's "its two siblings" had become wrong. The README ships in `files:`, which is why a prose fix took a patch digit; nothing in the script changed but the constant.

**2.0.0 is a rename, not a rewrite.** The display name is now `GTTx Merge Performer Tags To
Scenes`, in the `.yml`, the `manifest` and `PLUGIN_NAME` alike, and `PLUGIN_SHORT_NAME` follows it
(it is still the same string — this name fits). The folder, the plugin **id**, every setting key
and every storage slot are unchanged, so an upgrade keeps its configuration; what changes is every
heading match, since `ownSettingGroup` and `ownTaskName` compare against that name. The major digit
is the warning to anyone matching on it. See "Cross-plugin cooperation: one name prefix" in the
repo-root `CLAUDE.md`.

**The button-label text is a cross-plugin contract, not cosmetics.** Both manual buttons read
"Add Tags to all Scenes" / "Add all Tags from all Performers", matching the convention
`PropagateTagsAndPerformers` uses ("Copy [all|common] [Tags|Perfs] [to|from] all <plural>"). That
plugin's manual-button dedup matches on this exact visible text to tell "another plugin's button is
showing" from "it only could be"; reword one side and the two plugins' buttons for
`tags:performer>scene` stop matching and both appear, the exact duplicate the protocol prevents.
Since 1.18.0 both carry a trailing "..." when the click opens the review dialog — the performer
button always, the scene button only where staging is unavailable — and the sibling's dedup compares
with the dots stripped, precisely so the two halves of that contract can differ on it.

**Neither button writes on its own any more** (1.18.0). Both open the task's dialog, scoped to one
performer or one scene; §7e is the map of that. The base captions above are what did not change.

**Button placement and row spacing are one design in two copies**, shared with
`PropagateTagsAndPerformers` and written up in full in the repo-root CLAUDE.md ("Placing a manual
button near Stash's own actions" and "Cross-plugin cooperation: deterministic button ordering"). The
rules that cost the most to learn, in short: Delete carries no `.delete` class on the Scene edit row,
so the anchor search is `.delete` then a text match on Delete then on Save; Bootstrap's spacing
utilities are `!important`, so a measured margin only lands with the class off the button; and a
margin is true whenever you ask while a `getBoundingClientRect` gap is true of one instant. **Before
moving an anchor again, check the current one is being found** - four releases argued about which
anchor to prefer while the search was silently failing on the row being tested. §5 below is this
plugin's own map of that code.

---

## 1. What it does, and the five paths that do it

Performer tags are copied onto scenes. Merging only ever **adds** tags — which is the assumption
behind half the decisions below, because a wrong merge cannot be taken back by the button that made
it. The single exception is the library-wide task's **Undo** (§7b), which removes tags that same
dialog added, and it is deliberately the only code in this plugin that removes a tag at all.

Five entry points share one core:

| Path | Trigger | Saves? |
| --- | --- | --- |
| Performer button, "Add Tags to all Scenes..." | click on the performer detail view | **reviews** in the dialog, scoped to that performer (§7e) |
| Scene button, "Add all Tags from all Performers" | click on the scene Edit tab | **stages** by default; **reviews** in the dialog if `saveTagsImmediately`, or where staging is unavailable |
| Auto-merge on scene update | `sceneUpdate` / `bulkSceneUpdate` seen in `fetch` | yes |
| Auto-merge on performer update | `performerUpdate` / `bulkPerformerUpdate` seen in `fetch` | yes, every scene of the performer |
| Library-wide task (1.2.0, review pass 1.3.0) | click in Settings - Tasks - Plugin Tasks | yes, after the user presses **Proceed** |

The two automatic modes funnel into `runMergeTagsIntoScene` (one scene) and
`runMergeTagsIntoAllPerformerScenes` (a performer's scenes); the scene button's staging path is
`stageTagsIntoSceneForm`; everything else goes through the task's own review pass, scoped (§7e). Add
behaviour to those, not to the callers.

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

**The `performerUpdate` and `sceneUpdate` cache-invalidation branches are unconditional** — not
gated on `autoMergeOnPerformerUpdate` / `autoMergeOnSceneUpdate` — because they invalidate
`performerCheck` / `sceneCheck`, which decide whether the buttons appear. A performer gaining its
first tag has to make the button appear whether or not auto-merge is configured. Do not "tidy" them
into the auto-merge conditions.

The `sceneCheck` pair is new at 1.16.0 and arrived with the scene button's eligibility gate (§5).
Until then that cache had no invalidation at all, which was survivable while it asked only "has this
scene any performers" — an answer that rarely changed under an open page. It is not survivable now
that the gate reads the scene's own tags, since changing exactly that is the commonest thing a user
does on an Edit tab. Both pairs call `tick()` straight after clearing: clearing only *arms* a
re-probe on the next tick, and the tick after that draws the result, so without it a save is up to
two seconds from showing its effect.

**The exclusion-tag lookup rejects rather than resolving to `null` on error.** Treating a failed
lookup as "no exclusion configured" would merge tags into the very scenes the user asked to
protect, and tags are never removed again. Hits are cached 60s, misses 10s, both keyed on the
configured name, so creating or deleting the tag is noticed without a page reload.

**A name matching no tag rejects too** (1.16.3). It used to warn to the console and merge
unfiltered, which is the *same* silent failure the sentence above refuses, reached by a typo instead
of by a network fault — and a typo is much likelier than a failed request. The caching is unchanged,
so creating the tag starts the filter working without a reload; what changed is that a run stops
meanwhile rather than proceeding without the protection it was asked for. Every caller already
handled a rejection sensibly and none needed touching: the task logs `[ERROR] Review failed` and
finishes with an empty plan, the scene gate hides the button and says why on the debug channel, and
both button clicks alert. **`PropagateTagsAndPerformers` has always thrown on this condition** —
its own comment even claimed "the sibling does the same" while this side did the opposite, which is
what a side-by-side reading of the two plugins found. A note asserting what a sibling does is worth
no more than the last time someone checked.

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
(another tab, a bulk edit) is not noticed until one of those happens. Neither is invalidated by a
*settings* change either, so switching an exclusion filter on while a page is open is not seen until
the next navigation — small, pre-existing, and not worth a snapshot-and-compare to fix.

**The scene button gates on eligibility since 1.16.0, not on performer existence.** It asked
`findScene { performers { id } }`, so a scene already carrying every one of its performers' tags
showed a button whose click could only report "No changes" — while the *performer* button had always
required `hasTags && hasScenes`. That inconsistency was read by `PropagateTagsAndPerformers` 0.9.0 as
a deliberate trade and cited as precedent for its own weaker gating; it was not one. The performer
side carries a comment arguing for the stronger gate, the scene side carries no counter-argument
anywhere. One got the reasoning and the other was never revisited.

Two things make the fix cheap and keep it honest:

- **`scenePlanFrom(scene, exclTagId)` and `sceneMergeSelection()` are extracted, not reimplemented.**
  The gate asks the identical question the click answers, through the same function and the same
  selection — §3's "one filter, one implementation" applied to a *reader* rather than a writer. A
  gate with a diff of its own would be a second opinion free to drift, and a button that hides while
  a click would have merged is drift nobody would notice. It also picks up Organized, the exclusion
  tag and the custom-field rules, none of which the old gate could see.
- **The query grew; the number of queries did not.** Still one round trip, on the same tick.

**Not eligible now means *removed*, not merely "not added".** `addSceneButton`'s already-exists early
return used to sit *above* the eligibility check, so once the button was on the page nothing
re-evaluated it. Harmless while the gate asked about performers and nothing invalidated the cache;
wrong the moment a save can make an eligible scene ineligible. A click that merges everything now
takes its own button away.

**One consequence worth knowing: "Scene excluded" is now nearly unreachable.** `stageTagsIntoSceneForm`
reports it as a distinct outcome (§3), but an excluded scene no longer draws a button to click. The
caption survives for the one case that still reaches it — the gate's cached answer going stale,
because the scene became Organized in another tab — and `staging.test.js` drives exactly that, via a
`gateScene` that disagrees with the scene the click reads.

**The gate reads the server; a staged click reads the form.** Remove a tag from the open form without
saving and the button that would restore it stays hidden until Save. Save is what reconciles them,
which is what the `sceneUpdate` branch in §3 is for. `PropagateTagsAndPerformers` §5e documents the
same ceiling for the same reason — gating against the captured controls would re-evaluate on every
keystroke.

**A switch to ask a button why it is missing** (1.16.1). `coop().debugButtons`, set from the
console, turns on a `[cpt2s gate]` channel naming for each button whether it is shown or hidden and
why. Shared with `PropagateTagsAndPerformers` and documented in the repo-root CLAUDE.md. Two things
about this plugin's copy:

- **`scenePlanFrom` reports its own reasons**, from the branches that already exist inside it, and
  takes a `who` label because the gate and the click now ask it the same question — two identical
  lines with nothing to tell them apart would be worse than none. It also *recovers* one reason
  `sceneMergePlan` folds away: an excluded scene and a complete one both come back `null`, and they
  are one absent button and two different things to go and fix.
- **The performer button's line names both halves** rather than the verdict, for the same reason:
  "no tags of their own" and "in no scenes" are one absent button and two different fixes.
- **The outcome is reported from the tick, not from the check that computed it** (1.16.2). Both
  slots gained a `why` string, and `_lastPlanReason` carries `scenePlanFrom`'s refusal out to the
  caller that stores it. 1.16.1 logged only from the check, which runs once per entity — so
  switching the flag on while already on the page said nothing, which is how a debug flag is
  switched on. A diagnostic that only speaks when a cache misses is silent exactly when it is
  wanted.

**Caption flashing.** The scene button's messages are each shorter than "Add all Tags from all Performers" so the
button never changes width, and `_sceneFlashToken` makes a later click supersede a running
sequence instead of the two fighting over the caption.

**Refresh strategy.** `refreshSceneData` / `refreshSceneList` evict from `window.__APOLLO_CLIENT__`
where it exists and only fall back to `location.reload()` otherwise. The reload path stores
`cpt2s_goto_edit` in `sessionStorage` so the user lands back on the Edit tab; `maybeGoToEdit`
always consumes that key — on a different scene, or on a 10s deadline if the Edit link never
renders — because leaving it behind would make an unrelated later visit jump into edit mode.
`_reloading` stops the ticks between the write and the unload from consuming it early.

**Both buttons are `btn-warning` since 1.17.0**, not `btn-secondary`, and so is the task button
`paintTaskButtons` repaints on the Plugin Tasks page. The reasoning, the two live facts about
Stash's theme that it rests on, and why it is pinned to the same string in the sibling are in the
repo-root CLAUDE.md under *one colour for "a plugin wrote this"*. Placement is unchanged: §5d's
important-vs-casual rule still decides *where*, and amber is still a casual button rather than a
primary one.

`paintTaskButtons` reuses `ownTaskName` rather than matching the label a second time, which is what
keeps the paint and the click interception from ever disagreeing about what is ours. That function
gained a real fix at 1.17.0 — it now answers from the button's own `.setting-group` and stops,
where it used to climb past it into the panel holding every plugin's group and match whichever
plugin was listed first. A plugin declaring a task by the same name as ours was hijacked by that,
which is the one thing the heading check exists to stop; see §2 of `NormalizeParentTags`' CLAUDE.md
for the full note, since all three plugins carried it and all three were fixed together.

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
  `.desc-collapsed`, `.desc-toggle` are now defined by every plugin here that has a settings
  page, so `tests/style.test.js` compares them with the prefix stripped and fails on any
  difference. Change them all together or none of them — this is the same rule that already governs the dialog chrome.
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
[INFO] 3 tags to add: "Zed" (20) x2, "Volume 2" (22) x1, "volume 10" (21) x1
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
settled library and the button alone does not say so. Since 2.2.0 the button also carries a
`title` saying what it keeps, and the log it used to clear is kept with it.

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

`NormalizeParentTags` 1.1.0 gained automatic Prune / Roll Up on entity updates, which react to
entity saves the way our auto-merge does. `checkSibling()` is the mirror of the check that plugin
has always run against *us*: it reads the sibling's settings out of the shared
`configuration { plugins }` response — which we already pay for — and reports them at the top of
the task dialog.

**Both of its directions collide with a merge, differently, so the warning names which.** Auto
Prune removes the parent tags this merge adds, wherever a more specific tag on the same scene
implies them; Auto Roll Up piles further ancestors on top of them. A generic "the sibling is
active" would leave the user to work out which of those they are looking at.

**Its settings changed shape at its 4.0.0, and `siblingAutoModes` is where that is absorbed.** It
now publishes one string with a mode per entity type (`SCENES=PRUNE, IMAGES=ROLLUP`), so both
directions can genuinely be on at once — for different types — and the warning says so rather than
picking one. The pre-4.0.0 pair of booleans is still read when the string is absent, and there
**both on at once is silence**: that was the sibling's own documented no-op — exact inverses, so it
ran neither — and warning about a mode that is not running would send the user to switch off
something already inert.

**This is the cost the `api` registry note in the repo root predicted, paid once.** That plugin
publishes `autoMode` as *a question, not a setting*, precisely so a caller survives a
repartitioning of its settings; `TagBundleClipboard`, which asks the question, changed nothing when
every one of those keys was renamed. This check reads the settings by name and therefore did
change. It stays that way for the reason §7c gives - the warning is about a setting that may be set
while that plugin is disabled and answering nothing - and the trade is now a measured one rather
than an assumed one.

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

## 7e. The buttons open this dialog too, scoped (1.18.0)

The repo-root CLAUDE.md states the rule ("No write without a plan in front of it, and '...' says
which"). This is where this plugin's half of it lives.

**Two scopes, one dialog.** `startTaskRun(taskName, scope)` takes `{ performerId }` or
`{ sceneId }`; `begin()` branches to `scanScope` instead of `walk(1, …)`, and everything below that
— the plan, Proceed, the recap, Undo, Rescan, Copy log — is the code the library-wide task already
ran. The head reads `<caption> - from Performer "Ann" (7)` / `<caption> - for Scene "S102" (102)`,
which is also the lease label.

**The title was `<caption>... - Performer 7` until 1.18.1**, and both halves of that were wrong.
`stripEllipsis` takes the dots back off, because they are a promise a *caption* makes — "this click
asks before it acts" — and are only punctuation in the middle of a sentence here. `scopeLabel(kind,
id)` names the entity, reusing `performerLabel` and `sceneLogLabel` so a title and a log line cannot
disagree about how one is written; it costs one by-id read per scoped click, made while a dialog
opens on a review about to make several, and falls back to the bare kind and id rather than
rejecting. The direction word is the copy's: `from` a performer, `for` a scene.

**`PLUGIN_SHORT_NAME` is declared beside `PLUGIN_NAME` and is the same string.** The sibling needed
a genuinely shorter one; this plugin's manifest name already fits. The constant exists for shape —
both dialogs build their head from the same expression, and a future rename has one place to happen
— while `PLUGIN_NAME` stays the manifest's, because `ownSettingGroup` matches the settings page's
heading against it.

**`scanPerformer` is `reviewPerformer` with the performer fetched by id**, so the per-performer half
of the walk is not reimplemented — it is the same function the page loop calls, given one performer
instead of a page of them. **`scanScene` goes the other way round**: it reads the scene with its
performers named and folds each of them into `planScene`, which is what makes the log say *which*
performer a tag came from. Both go through `sceneMergePlan`, so §3's "one filter, one
implementation" now covers the review as well as the three writes.

**An excluded scene says so.** `sceneMergePlan` folds "excluded" and "already has everything" into
one `null`; the scene scope asks `sceneIsExcluded` first and logs it, because an empty dialog with
no explanation is the one thing a review must not be. The gate makes this rare — an excluded scene
draws no button — but the gate's answer is cached and can go stale, which is exactly the case that
reaches it.

**The performer button lost its progress caption**, `Merging... (12/340)`. That is not a
regression to fix by putting it back: the dialog's own progress line says more, and the button is
underneath it.

**Apollo eviction grew a second half.** `finishApply`/`finishUndo` evicted the `findScenes` list
only, which is right for a task run and useless for a scoped one — its user is looking at the scene
the dialog just wrote, rendered from `Scene:<id>`. `evictWritten` now drops both, from
`wroteScenes`, accumulated per pass on the server's acceptance rather than from the plan.

**What is deliberately unchanged:** `mergeTagsIntoScene` and `mergeTagsIntoAllPerformerScenes` still
exist and still write directly — they are what the two *automatic* modes call, and those write
without a dialog by design. Nothing else calls them.

## 7f. Copy became Add (3.2.0)

Every manual button here said **Copy** — `Copy Tags to all Scenes...`, and twenty-odd more between this plugin and its
sibling. That was unambiguous while these two were the only plugins in the repo that moved tags.
`TagBundleClipboard` made it ambiguous: it has a real clipboard, and a row could end up carrying two
buttons both saying "Copy" and meaning different things.

They all say **Add** now, in the same release as the sibling's, so the cross-plugin dedup — which
compares two plugins' live button *text* — still matches. `Copy log` in the footer is untouched: it
copies to the system clipboard, which is what the word means outside this repo.

Minor, not major: nothing matches on these strings except that dedup, and both sides moved together.
The major digit is for a rename users have to act on, which is what `ownSettingGroup` and
`ownTaskName` matching on the plugin **name** made the `ᝯㄝₓ ` prefix. The full reasoning, including
why `Add` beat Import/Export and Propagate, is in the repo-root `CLAUDE.md` under "One verb per idea".

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
using an `.edit-buttons` fixture rather than the performer page's dual-container one: the button
lands between Save and Delete, a Delete nested in a wrapper element is still found, and a fixture
with Save and no Delete at all falls back to before Save with Save left last. That last shape is not
one Scene Edit is ever seen in, but `insertBeforeImportantAction` is shared with
`PropagateTagsAndPerformers`, whose target-side buttons do meet it (Group), so this plugin's copy of
the fallback gets its own proof rather than relying on never being exercised.

`SCENE_EDIT_VIEW_UNCLASSED_DELETE` is the row a live Stash actually renders - Delete present,
`.delete` absent, styled as an `<a>` with padded label text. The untidiness is the fixture's whole
point: an exact-match search restricted to `BUTTON` would pass a tidier one while still failing the
real page.

It also covers row spacing (the row's own margins copied onto our button, a wrapped row spaced by
`margin-bottom` since `.edit-buttons` is `display: block`, no utility class left to outrank the
measurement, and a `column-gap` row getting nothing from us), and deterministic ordering
(`coop().order`): this plugin registers priority 20 at load; a lower-priority foreign button
(`PropagateTagsAndPerformers`, seeded at 10 via `_coopOwner`, since the harness only ever runs this
plugin's own script) is not displaced from Delete; and - the direction that actually exercises
`insertOrdered`'s skip branch rather than passing by coincidence - a *higher*-priority foreign button
(a fictitious 30, since nothing here outranks 20) is not displaced either, this plugin's own button
yielding and landing on its far side.

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
count). Since 2.2.0 the Rescan case also pins what it *keeps* — the earlier pass's `[INFO] Applying`
and `[MERGE]` lines still on screen below the marker — and that the button's tooltip says so; both
fail against 2.1.4. The Stop case presses the button from inside the responder on
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

`style.test.js` needs no harness at all: it reads every plugin's CSS string as text and fails on any
rule two or more of the dialogs define differently. Since 1.11.0 that includes the settings-page
tooltip rules, which are the same in every plugin that has a settings page by design. The shared-chrome rule it enforces is in the repo-root
CLAUDE.md.

`staging.test.js` is the most exposed, because it *models* `useTagsEdit` rather than calling it.
Anything touching §4 needs a click in a real Stash before it is believed. Same for §5: the suites
reproduce Stash's markup from memory, so they prove the plugin picks the right container out of
what it is given, not that Stash still gives it that.

When fixing a bug, confirm the new test fails against the unfixed plugin:
`SRC=/path/to/old.js node tests/merge-logic.test.js`.

`merge-logic.test.js` §12 covers 1.16.3's exclusion-tag change: a configured name matching no tag
writes nothing at all. It fails against 1.16.2, which merged unfiltered.

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

