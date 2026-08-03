# CLAUDE.md — Normalize Parent Tags

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build
step, `gqlRequest`, `tick()` + MutationObserver) are in `../CLAUDE.md` and still apply.

**Status: implemented at 0.2.0.** This file is both the design and the map of the code — the
sections below match the order of `NormalizeParentTags.js`. Where the code and this file
disagree, the code is what runs; fix the file.

Two things in here are deliberately *not* implemented, and should stay that way until there is
a reason: the candidate-narrowing tag filter in §5 (plain paging is correct and simpler, and the
per-page payload is only ids and tag ids), and any attempt to reconcile a plan with changes made
during phase 2 (Rescan is the answer, see §5).

---

## 1. What the plugin does

Stash tag hierarchies are implied downward: if `Blonde` has parent `Hair Colour`, an entity
tagged `Blonde` is already understood to be `Hair Colour`. Storing both on the same entity is
redundant. Two library-wide tasks make that explicit, in either direction:

- **Prune Parent Tags from Entities** — remove every tag on an entity that is a strict ancestor
  of another tag on the *same* entity. What survives is the antichain of the entity's tag set:
  every tag with no descendant of its own present. That includes leaf tags and any intermediate
  tag whose children (direct or indirect) are all absent.
- **Roll Up Parent Tags onto Entities** — add every strict ancestor, recursively, of every tag
  on the entity.

The task names are deliberately long: the name is both the `SettingGroup` heading and the button
label, and the short form ("Prune Parent Tags") reads as though it edits the tag hierarchy. The
prepositions carry the direction as well as the target.

**This plugin can destroy a tagging scheme in one click.** Prune deletes tag assignments library-
wide, Stash has no undo, and the only recovery is a database restore. Every surface — manifest
description, task descriptions, README, and the dry-run dialog itself — must tell the user to
back up their database before the first run. Do not let that get edited out for brevity.

The two are inverses in the useful sense: Roll Up then Prune returns the original antichain
(minus whatever the exclusion filters protected).

Neither task ever touches the tag hierarchy itself — only the tag *assignments* on entities.

## 2. Entry point: Settings → Tasks → Plugin Tasks

The user asked for these to live in the **Plugin Tasks** section of the Tasks page. There is no
patchable component for that page (see the list in Stash's `UIPluginApi.md` — `Setting` and
`SettingGroup` are patchable but far too generic, and there is no `SettingsTasksPanel` or
`PluginTasks`), so the placement is achieved a different way:

**Declare the two tasks in `NormalizeParentTags.yml` under `tasks:` and let Stash render them.**
`PluginTasks.tsx` lists every enabled plugin with `tasks.length > 0`, so declaring tasks is
enough to get a native, correctly-styled collapsible group named after the plugin, with one
button per task. No DOM construction, no CSS guessing, no breakage when Stash restyles the page.

The catch: this plugin has no `exec`/`interface`, so the task cannot actually run server-side.
Stash's loader does not mind (`Config.valid()` only checks `interface` and setting types, and
`tasks` without `exec` loads fine), but a click would reach `mutateRunPluginTask` and fail in the
job queue. So the click is caught client-side, with two independent layers:

1. **Primary — capture-phase click listener on `document`.** React 17+ attaches its handlers to
   the root container, which is a descendant of `document`, so a capture listener on `document`
   fires first and `stopPropagation()` prevents `onPluginTaskClicked` from ever running. This
   also suppresses the misleading "Added job to queue" toast. Identify the button by walking up
   to the enclosing `.setting`, and matching the button's text against our two declared task
   names *within* the plugin's own `SettingGroup` (match the group heading against the plugin
   name) — never by task name alone, or another plugin with a same-named task gets hijacked.
2. **Fallback — `window.fetch` wrapper.** If layer 1 misses (Stash restructures the page, the
   button is reached by keyboard in a way we did not anticipate), catch the `runPluginTask`
   mutation whose `plugin_id` is ours, return a synthesized successful response so the mutation
   never reaches the server, and open the dialog. The sibling plugin already wraps `fetch`, so
   the pattern is established here.

If both layers ever fail, the outcome is a failed job in Stash's log and no data change — the
safe direction.

Rejected alternative: building our own section in the Tasks page by DOM injection. It is honest
about not being a server task, but it means hand-rolling Stash's `SettingSection`/`Setting`
markup and keeping it looking right across releases, for no functional gain.

## 3. Algorithm

### Hierarchy

One query fetches the whole DAG:

```graphql
findTags(filter: { per_page: -1 }) {
  tags { id name ignore_auto_tag parents { id } custom_fields }
}
```

`custom_fields` is only requested when one of the two custom-field settings is non-empty (same
rule as the sibling plugin). From this build:

- `parentsOf[id] -> [id]`
- `ancestorsOf[id] -> Set<id>` — memoized transitive closure, computed on demand with a
  recursion stack so a cycle cannot hang the walk (see §7 on cycles).

### Prune

For an entity with tag set `T`:

```
implied = union over t in T of ancestorsOf(t)      // strict ancestors only
remove  = { t in T : t in implied and removable(t) }
keep    = T \ remove
```

`implied` is computed against the **original** `T`, never against a set that is being mutated as
the loop runs. See §7 for why that matters.

### Roll Up

```
add = (union over t in T of ancestorsOf(t)) \ T, filtered by addable(t)
```

A tag rejected by `addable()` is skipped *individually* — its own parents are still added. The
filters describe a tag, not a barrier in the hierarchy. Document this; the other reading
(treat an excluded tag as a wall and stop climbing) is defensible but surprising.

### The reason ("due to")

`implied` is not a set but a map from each implied tag to the tag on the entity that implies it,
and that tag is logged as the change's reason. Where several present tags imply the same
ancestor, the **lowest** wins: a candidate that is an ancestor of another candidate is higher up
the hierarchy and loses. Candidates that are incomparable — a diamond, or two unrelated children
of one parent — are a genuine tie, broken on the **lowest tag id**, compared numerically where
both ids parse so 9 sorts below 10. The tie-break exists for determinism, not for meaning:
`for…in` order is not guaranteed, and a log that shuffles between two runs over an unchanged
library cannot be used to audit anything.

Two properties worth keeping true:

- **In Prune the reason tag is never itself removed in the same run.** If it were, whatever
  implied *it* would be a strictly lower candidate for the same ancestor and would have won the
  contest. So a `[REMOVE]` line always points at a tag that survives — which is the whole reason
  the clause is useful.
- **A marker's primary tag can be a reason**, since it counts as present. That is correct and
  informative: it explains a removal that is otherwise unexplainable from the marker's tag list
  alone.

### Markers

`SceneMarker` has `primary_tag: Tag!` (required, separate field) and `tags: [Tag!]!`.

- The primary tag **counts as present**: it goes into `T` for computing `implied`, so a marker
  with primary tag `Blonde` and tag `Hair Colour` prunes `Hair Colour`.
- The primary tag is **never a candidate for removal**: it is not in `tags`, the schema will not
  let it be blank, and dropping it would destroy the marker's meaning.
- Roll Up adds ancestors to `tags`, never to `primary_tag`.
- A tag that duplicates the primary tag inside `tags` is left alone. Removing it is arguably
  right but it is not a parent/child relationship, so it is out of scope.

## 4. Exclusion filters

Entity-level (skip the whole entity, both tasks):

| Setting | Applies to |
| --- | --- |
| `b1ExcludeEntityWithTagName` | All types. Resolve the name to an ID once per run (exact, case-sensitive, client-side re-check — Stash's `EQUALS` compiles to SQL `LIKE`, where `_` and `%` are wildcards). Direct presence only; for markers, the primary tag counts. A failed lookup **aborts the run** rather than running unfiltered. |
| `b2ExcludeOrganized` | Scenes, images, galleries, studios — the only types with an `organized` field in Stash 0.31. Do **not** hard-code that list into the queries: request `organized` per type from a table, and if a future Stash adds the flag elsewhere, only the table changes. Performers, groups and markers have no flag, so the setting silently cannot protect them — say so in the setting's description. |

Tag-level (skip the individual tag):

| Setting | Blocks |
| --- | --- |
| `c1ExcludeTagWithIgnoreAutoTag` | add + remove |
| `c2ExcludeAddTagNameContains` | add |
| `c3ExcludeRemoveTagNameContains` | remove |
| `c4ExcludeAddTagWithCustomFieldName` | add |
| `c5ExcludeRemoveTagWithCustomFieldName` | remove |

Custom-field matching is presence-only via `hasOwnProperty` (never `in` — inherited keys like
`constructor` would match every tag), values never inspected, exactly as the sibling plugin does.
Name matching is a case-sensitive substring (`indexOf !== -1`) over the raw Unicode string: these
are meant for namespace markers, and case-insensitivity would drag in locale surprises for no
benefit. Aliases are not matched, only the name.

A protected tag never breaks correctness: a parent kept back by a filter is still implied by its
descendant, and the descendant's own status is unaffected.

## 5. Scale and the two-phase dialog

### Fetching entities

`per_page: -1` means "no paging, return every match in one response" — it is what the sibling
plugin uses for tag lookups. It is right for the tag list (thousands of rows at most) and wrong
for scenes and images (a large library has hundreds of thousands, and one response holding all
of them is a browser tab that stops responding). So:

- Tags: one `per_page: -1` query.
- Entities: **page**, `per_page: 1000` (500 for images), ascending by `id`, sequentially, so the
  dialog can count progress and the browser stays responsive.
- Narrowing, **deferred, not implemented**: only entities carrying a tag that *can* matter need fetching.
  For Prune that is the set of tags with at least one child; for Roll Up, tags with at least one
  parent. Pass those as `tags: { value: [...], modifier: INCLUDES, depth: 0 }` in the type's
  filter. `SceneMarkerFilterType` has a `tags` field too. If the ID list is enormous, or the
  filtered query errors, fall back to paging everything — the filter is an optimization, never
  a correctness requirement.

Request only what is needed: `id`, `tags { id }`, `organized` where it exists, and a display
name (`title` with a `files { basename }` fallback for scenes and images; `name` for performers,
studios, groups; `title` plus `primary_tag { id name }` for markers).

### Processing order

Types are scanned and applied in a fixed order, never in the order the settings happen to be
listed:

```
Performers → Studios → Groups → Galleries → Scenes → Images → Markers
```

Performers lead for the reason in §8: `MergePerformerTagsToScenes` reacts to a `bulkPerformerUpdate`
by merging performer tags into all of that performer's scenes, so anything it stirs up should be
stirred up before the scene and image passes run, not after. Markers trail their scenes for the
same reason in reverse — a marker is a child of a scene, and finishing with them means the scene
pass has already settled. The order is a constant in one place; do not derive it from the
settings object's key order, which is not guaranteed and would silently change meaning.

### Phase 1 — dry run

Modal, built as plain DOM appended to `document.body` with its own injected `<style>` (no React,
no PluginApi). It shows:

- A one-line backup warning at the top, permanently, not a dismissible notice: *"This cannot be
  undone. Back up your database before proceeding."*
- The task name, and the entity types included in the run, in processing order.
- Any run-level warning raised at startup — currently the sibling-plugin check in §8.
- Per-type progress: `Scenes 4200 / 12871`, plus a running "changes found" count.
- A scrollable log of every planned change, one line per tag per entity:
  `[REMOVE] Scene "My Scene" (123) - Tag "Hair Colour" (45) - due to "Platinum" (47)`
  `[ADD]    Performer "Jane" (7) - Tag "Blonde" (12) - due to "Platinum" (47)`
  `[ERROR]  Scenes page 5 - findScenes failed: ...`

  The **due to** clause names the tag already on the entity that implies the one being written -
  the entry's *reason*. Both the entity and the tag put their id outside the quotes, so a name
  containing brackets cannot be misread as one.
- Buttons: **Proceed** (enabled once the scan finishes, and disabled outright when there is
  nothing to do) and **Cancel** (abandons the run; during the scan it stops paging).

**Log volume is a real constraint.** A first run on a large library can plan six figures of
changes. Keep the full log in a JS array (that is what Copy exports) and render only the last
~1000 lines into the DOM, with a `showing last 1000 of 214503` note above it. Append in batches
on a timer rather than one node per change, or the scan is bottlenecked on layout.

Nothing is written in phase 1. The plan is held as
`[{ type, entityId, entityLabel, add: [], remove: [], reason: { tagId: tagId } }]`. `reason` is
narrowed to the tags actually being written rather than holding the entity's whole implied map —
a six-figure plan carrying an ancestor map per entry is a browser tab that runs out of memory.

### Phase 2 — apply

Only reached via Proceed. Same modal, log continues into a second section headed with the
timestamp, now recording what was actually written plus any errors.

Write with the **bulk** mutations in delta mode rather than per-entity full `tag_ids`:

```graphql
bulkSceneUpdate(input: { ids: [...], tag_ids: { ids: [...], mode: REMOVE } })
```

All seven types support it (`bulkSceneUpdate`, `bulkImageUpdate`, `bulkGalleryUpdate`,
`bulkPerformerUpdate`, `bulkStudioUpdate`, `bulkGroupUpdate`, `bulkSceneMarkerUpdate`), all with
`tag_ids: BulkUpdateIds` and `mode: SET | ADD | REMOVE`. Two reasons this beats a per-entity
`SET` of the full list:

1. `ADD`/`REMOVE` is a delta the server applies, so a tag someone added from another tab between
   the scan and the apply is not silently reverted. A full `SET` built from phase-1 data would
   clobber it.
2. Entities sharing an identical delta can be grouped into one mutation — and they usually do,
   because the same redundant parent tends to appear across many entities. Group by a sorted
   delta key, chunk `ids` at ~100, and issue chunks sequentially. This turns 50 000 mutations
   into a few hundred.

Per-chunk error isolation: a failed chunk is logged and the run continues. If a chunk fails,
none of its entities are logged as changed.

Chunks are applied in the §5 processing order, type by type — the grouping is by delta *within*
a type, never across types, since each type has its own mutation anyway.

Phase 2 buttons: **Copy log** (full array, not the rendered tail, via `navigator.clipboard`
with a `<textarea>` + `execCommand` fallback for non-HTTPS origins — Stash is commonly served
over plain HTTP on a LAN, where the async clipboard API is unavailable), **Rescan** (throws the
plan away and restarts phase 1 without closing the dialog), and **Close**. A **Stop** button
halts after the current chunk; already-applied chunks stay applied.

**Rescan is not a convenience.** The whole plan is computed before the first write, so anything
that changes tags *during* phase 2 — the sibling plugin in §8, another browser tab, a running
scan — is invisible to the plan that is being applied. Rescan is how the user converges: run,
rescan, see an empty plan, and know the library is normalized.

## 6. Settings

All settings are re-read at the start of every run (a single `{ configuration { plugins } }`
query — Stash cannot scope it to one plugin), not on a timer. The tasks are the only entry
point, so there is nothing to keep warm between runs.

**The `a1`/`b2`/`c3` key prefixes are load-bearing.** `settings:` is a YAML *map*, so the order
the manifest declares them in is gone by the time Stash has parsed it; the settings page renders
the keys **sorted alphabetically**, ignoring `displayName` and ignoring the setting type. Without
the prefixes the page interleaves the list in the order `enableGalleries … enableMarkers,
enablePerformers …`, which puts Scene Markers between Images and Performers and drops the
Organized toggle into the middle of the string filters. The prefixes buy three blocks the user
can read top to bottom:

- `a1`–`a7` — the entity toggles, in the §5 processing order, so the settings page and the run
  agree about what happens first.
- `b1`–`b2` — the entity-level exclusions.
- `c1`–`c5` — the tag-level filters: the both-directions one first, then add/remove pairs.

Keep the YAML block itself in key order too. It is not what Stash reads, but a block that reads
differently from the page it produces is a trap for the next edit.

A key is also the **storage key** — Stash saves values under it — so renaming one silently
resets that setting for every existing install and strands the old value in the config. Renaming
happened once, at 0.1.1, while the only install was the author's. It should not happen again
without a good reason. New settings get a prefix in the block they belong to; if there is no gap
left, renumber the whole block in one go rather than bolting on a `c5a`.

Stash has no default value for a plugin setting: an unset `BOOLEAN` reads as unchecked. Every
`enable*` type toggle is therefore **off on a fresh install**, and a run with none enabled must
say so in the dialog rather than silently doing nothing. That default is the right one here —
Prune deletes tag assignments, and opting in per type is how the user says which parts of the
library they have thought about. Do **not** invert the settings to make them default-on the way
`a2SaveTagsImmediately` is inverted in the sibling plugin; that trick is for a safe default, and
this one is not safe.

## 7. Answers to the questions this design was reviewed against

**Does Stash allow cycles in the tag hierarchy?** No. `pkg/tag/validate.go` calls
`ValidateHierarchyNew` / `ValidateHierarchyExisting` on every tag create and update, which reject
making a tag the parent of one of its own ancestors (`InvalidTagHierarchyError`). So a cycle
cannot be produced through the UI or the GraphQL API. Guard anyway, with a visited set in the
ancestor walk: the closure is memoized so the guard costs nothing, and the failure mode without
it is an infinite loop in the user's browser if a cycle ever arrives through a route that skips
validation (direct SQLite edits, a future import path). If a cycle *is* detected, log it as an
error and skip the tags involved rather than pruning them — under the plain rule every member of
a cycle implies every other, so all of them would be deleted.

**How can a one-pass computation depend on iteration order?** With the rule as specified it
cannot, and that is the point of stating it. Ancestry is a property of the tag graph, not of the
entity's tag set, so `implied` does not change as tags are removed — remove `A` first or `B`
first, the answer is the same. The order-dependence appears the moment the predicate is
re-evaluated against the *surviving* set instead of the original one ("remove `T` if some
**kept** tag has `T` as an ancestor"). In a chain `A → B → C` holding `{A, B, C}` both readings
agree on `{C}`; but in a cycle `A → B → A` holding `{A, B}`, the original-set rule deletes both,
while the surviving-set rule keeps whichever one the loop happened to visit second. That is the
whole of the difference — and it is another reason the cycle guard exists.

**What does `per_page: -1` mean?** Stash's `find*` queries paginate through
`filter: { page, per_page }`. `-1` is a sentinel for "ignore paging, return every match in one
response". Convenient, and dangerous on large types — see §5.

## 8. Interaction with the sibling plugin

`MergePerformerTagsToScenes` wraps `fetch` and reacts to our writes:

- **Auto Merge On Scene Updates** matches `/\bbulkSceneUpdate\b/` — every scene we touch gets its
  performers' tags merged back in, parents included.
- **Auto Merge On Performer Updates** matches `/\bbulkPerformerUpdate\b/` — every performer we
  touch has their tags pushed into *all* of their scenes.

Neither plugin is misbehaving; they simply disagree about direction. The fix is a cooperation
lease (see below) plus three fallbacks for when the lease is not honoured.

### The bulk-edit lease

Both plugins live in the same browser tab and therefore share one `window`. That is enough for a
handshake: during phase 2 this plugin takes a **lease** that asks reactive plugins to stand down,
and `MergePerformerTagsToScenes` checks for one before auto-merging. The contract is written up in
the repo-root `CLAUDE.md` (§ Cross-plugin cooperation) because it is not ours alone; the parts
specific to this plugin:

- The lease is taken **around phase 2 only**. Phase 1 writes nothing, so there is nothing to
  suppress, and holding a lease through a long scan would disable the sibling for no reason.
- Take it in a `try`/`finally` so a thrown error, a failed chunk or **Stop** cannot leave it
  latched. Leases also carry an expiry that is renewed per chunk, so a crashed tab releases it
  by itself.
- Renew per chunk rather than taking one long lease — a run over a big library can outlast any
  sane fixed expiry.
- The lease is **advisory**. Never assume anyone is listening: a sibling older than the protocol,
  or a third plugin nobody has heard of, will ignore it. Everything below still applies.
- What it suppresses is exactly the sibling reacting to *our* writes. Its own internal
  `_mergeDepth` re-entrancy guard is a different mechanism and is not touched.

**Server-side hooks are out of reach.** A plugin with `hooks:` in its YAML runs inside the Stash
server on `Scene.Update.Post` and friends. It never sees our `window`, so no lease can reach it.
If the user has one that touches tags, a run will fight it and the only remedies are disabling it
or a Rescan. Say so plainly rather than implying the lease covers everything.

Three things follow regardless.

**Performers run first** (§5). The performer pass is what triggers the wider, scene-fanning
merge, so it happens before the scene and image passes rather than after them. That does not
make the run self-correcting — see below — but it does mean the damage lands before the passes
that could report on it, rather than behind them.

**The plan is computed up front, so ordering alone cannot fix this.** Phase 1 finishes before
phase 2 writes anything, so tags the sibling adds to scenes *during* phase 2 were never in the
scene plan and will not be pruned by this run. **Rescan** is the answer, and this is the main
reason it exists.

**Detect it and say so.** The settings query is `{ configuration { plugins } }`, which returns
*every* plugin's settings in one response — we already pay for that. So at the start of a run,
read `plugins.MergePerformerTagsToScenes` out of the same response and, if either auto-merge flag
is on, check whether the installed copy registered itself as honouring leases:

- **Registered** — say so and move on: *"Merge Performer Tags To Scenes has auto-merge enabled;
  it will stand down while changes are applied."* No action needed from the user.
- **Not registered** (older than the protocol) — warn, naming the setting: the run will fight
  with it, and the user should either turn it off for the duration or plan on a Rescan.

Never toggle the sibling's settings from here. They are server-side configuration shared by every
tab and every user of that Stash, and a crash mid-run would leave them silently off — which is
exactly the failure mode the lease's expiry exists to avoid. Never block the run either: this is
the user's own pair of plugins, and the side effect is understandable once it is stated.

**Sibling side, done in 1.1.0.** `MergePerformerTagsToScenes` registers itself as a respecter at
load and checks `autoMergeSuppressed()` in each of its four auto-merge branches. The regex test
comes first in each condition (`/\bbulkSceneUpdate\b/.test(q) && !autoMergeSuppressed()`) so the
"standing down" console line is only emitted for a mutation it would actually have reacted to.
Manual button clicks are never suppressed — the user asked for those directly.

## 9. Testing

Three suites cover this plugin — `normalize-plan`, `normalize-apply`, `normalize-tasks` — plus
`coop` for the sibling's half of the lease. They run on `npt-harness.js`, which differs from the
sibling's harness in having a fake DOM real enough to build and read back a dialog, and which
starts runs by posting a `runPluginTask` mutation rather than by simulating a click. What they
cover:

- **Closure and pruning logic** — chains, diamonds (two parents), multi-root, the antichain
  result, and a planted cycle terminating with an error rather than hanging.
- **Marker handling** — primary tag implies but is never removed, and can be named as a reason.
- **The reason clause** — the lowest implying tag is named in both directions, incomparable
  candidates fall to the lowest id, and phase 2 keeps each entity's own reason even though
  entities are batched by shared delta.
- **Exclusion filters** — each of the seven, including add/remove asymmetry, `hasOwnProperty`
  vs prototype keys, and that a skipped tag does not block its own parents in Roll Up.
- **Two-phase dialog** — no mutation is issued before Proceed; Cancel issues none at all.
- **Grouping and chunking** — identical deltas collapse into one mutation, chunks cap at 100 ids,
  a failed chunk is isolated and its entities are not logged as changed.
- **Task interception** — the click never reaches `runPluginTask`, and the fetch fallback catches
  it if the click handler is bypassed.
- **Processing order** — performers are queried and written before scenes and images, whichever
  order the settings come back in.
- **Sibling detection** — an auto-merge flag set on `MergePerformerTagsToScenes` in the shared
  `configuration { plugins }` response raises the dialog warning, and its absence does not.

The suites cannot confirm Stash's own behaviour (page markup, `BulkUpdateIds` semantics), so any
change here still needs one run against a real instance — preferably a copy of the library.

## 10. Versioning

Per the repo convention: bump the patch digit in **both** `NormalizeParentTags.yml` and
`manifest` on every change; bump the minor digit and reset the patch for a new feature.
