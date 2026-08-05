# CLAUDE.md — Normalize Parent Tags

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build
step, `gqlRequest`, `tick()` + MutationObserver) are in `../CLAUDE.md` and still apply.

**Status: implemented at 1.4.3.** This file is both the design and the map of the code — the
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

Either direction can also run **automatically**, on every entity Stash saves, rather than as a
library-wide pass — see §5b. Same planning code, no dialog.

**This plugin can destroy a tagging scheme in one click.** Prune deletes tag assignments library-
wide, Stash has no undo, and the only recovery from a run you have walked away from is a database
restore. Every surface — manifest description, task descriptions, README, and the dry-run dialog
itself — must tell the user to back up their database before the first run. Do not let that get
edited out for brevity, and in particular do not let the Undo button in §5 be presented as making
the backup unnecessary: it reaches its own writes, and only while the dialog is open.

**Auto mode can destroy one without any click at all**, which is why §5b is written the way it is:
it has no dialog, no review, no tag summary and no Undo, and a console line is the only record it
leaves. It is off by default, gated behind the same all-off entity toggles, and its two setting
descriptions carry the warning in place of the dialog that is not there.

The two are inverses in the useful sense: Roll Up then Prune returns the original antichain
(minus whatever the exclusion filters protected).

Neither task ever touches the tag hierarchy itself — only the tag *assignments* on entities.

## 2. Entry point: Settings → Tasks → Plugin Tasks

The user asked for these to live in the **Plugin Tasks** section of the Tasks page. There is no
patchable component for that page (see the list in Stash's `UIPluginApi.md` — `Setting` and
`SettingGroup` are patchable but far too generic, and there is no `SettingsTasksPanel` or
`PluginTasks`), so the placement is achieved a different way:

**Declare the tasks in `NormalizeParentTags.yml` under `tasks:` and let Stash render them.**
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
   `TASKS` is the list; adding a task means adding it there as well as to the manifest.
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
| `c4TagNameSeparator` | neither on its own — it splits `c2`/`c3` |
| `c5ExcludeAddTagWithCustomFieldName` | add |
| `c6ExcludeRemoveTagWithCustomFieldName` | remove |

Custom-field matching is presence-only via `hasOwnProperty` (never `in` — inherited keys like
`constructor` would match every tag), values never inspected, exactly as the sibling plugin does.
Name matching is a case-sensitive substring (`indexOf !== -1`) over the raw Unicode string: these
are meant for namespace markers, and case-insensitivity would drag in locale surprises for no
benefit. Aliases are not matched, only the name.

Since 0.5.0 the two name settings hold **several substrings separated by whitespace**, and a tag is
excluded when its name contains **any** of them (`splitTerms` + `nameMatchesAny`). Empty tokens are
dropped, so padding and repeated separators are harmless — and a blank setting must yield an empty
list, never a term matching every name. Note the upgrade consequence — a pre-0.5.0 value of
`Hair Colour` was one substring and is now two, matching strictly more tags. That direction is the
safe one (more tags protected from Prune, fewer added by Roll Up), but it is a silent change in
meaning for anyone who had a phrase in there.

`c4TagNameSeparator` (0.6.0) buys back the substring-with-a-space that whitespace splitting costs:
set it and the two lists split on that string instead. Three things it must keep doing:

- **Split on a string, never a `RegExp`.** `.` and `|` are plausible separators, and `new RegExp('|')`
  is an empty alternation that splits every character — single letters that would protect most of a
  library. Users should not have to escape punctuation.
- **Trim each term**, so `a, b` does not carry a leading space into the match, and drop the empties,
  so a setting of nothing but separators leaves an empty list.
- **Trim the separator itself**, and treat an empty one as "use whitespace" — which is also the only
  way to ask for a plain space.

Testing the separator needs care: splitting a phrase always leaves pieces that still match the tag
the phrase matched, so the two behaviours only differ against a *second* tag one of those pieces
reaches. The suite uses `Body Art` and `Art Deco` for exactly that, and the first version of the
test passed against the unfixed build until it did.

A protected tag never breaks correctness: a parent kept back by a filter is still implied by its
descendant, and the descendant's own status is unaffected.

## 5. Scale and the dialog's three phases

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

Request only what is needed: `id`, `tags { id }`, `organized` where it exists, and a display name.
`name` for performers, studios and groups; `title` everywhere else, but `title` is **optional** on
scenes, galleries and images, so each needs its own fallback:

| Type | Fallback after `title` |
| --- | --- |
| Scenes | `files { basename }` |
| Galleries | `files { basename }`, then `folder { basename }` — a gallery is a zip (`.cbz` is one) *or* a folder, and a folder gallery has no file at all |
| Images | `visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }` — `Image.files` is deprecated in favour of `visual_files`, which is a **union**, so the concrete types have to be named |
| Markers | `primary_tag { id name }` |

`entityLabel` reads whichever of `files` / `visual_files` / `folder` is present rather than
switching on `type.key`: the type's `fields` decides what exists, and a per-type branch in the
labeller is what let galleries and images log as `"untitled"` from 0.1.0 until 0.3.1 — the
fallback was written for scenes and never extended, and the two types did not even request the
fields it would have needed.

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
- A **legend** under the warning (`npt-legend`, 1.2.7) saying that the bracketed number is a Stash
  id and that counts are written `x250`. The convention was only obvious to whoever wrote it —
  `"Hair Colour" (45) x250` puts an id and a count on one line, and nothing said which was which.
  It states a rule the rest of the plugin has to keep: **brackets are ids, counts are not**. That is
  why the inspector's list headings read `Parents: 3` rather than `Parents (3)` (§5a) and why a
  failed batch logs `5 entities (ids 1, 2, …)`. A new surface putting a count in brackets does not
  merely read oddly, it makes the legend false. The sibling carries the same line, in the same two
  places (its dialog, and the console banner that stands in for one) — keep the wordings
  recognisable against each other.
- A closing **tag summary** as the last line of the phase, listing every distinct tag the run
  touches and how many entities each lands on:
  `[INFO] 2 tag(s) to remove: "Blonde" (2) x1, "Hair Colour" (1) x250`

  The per-entity lines answer "what happened to this entity"; this answers "which tags did this
  run touch, and how widely", which is the question actually asked before trusting a Prune over a
  whole library — and the one a six-figure log cannot be read for.

  **Ordered the way Stash orders tags**, so the line reads straight against the tag list in the
  UI: `ORDER BY COALESCE(tags.sort_name, tags.name) COLLATE NATURAL_CI`. That means `sort_name`
  wins where it is set (it is nullable, never shown, and exists only to override the name for
  sorting — so a blank one is no override), compared case-insensitively and with numeric runs as
  numbers, hence `Volume 2` before `Volume 10`. `Intl.Collator({ numeric: true, sensitivity:
  'accent' })` is the browser's nearest equivalent; without `Intl` it degrades to a
  case-insensitive compare rather than throwing. The **id** is the final tie-break — Stash has one
  too, and two tags in different parts of the hierarchy may share a name.

  This is display order only. The id tie-break in `betterReason` is a different question — *which*
  tag to blame, not what order to print — and stays on the id.

  Phase 2 emits its own, counted from `appliedTags` — accumulated where a batch **succeeds**, not
  from the plan — so a failed batch or a **Stop** is not summarised as though it had landed. The
  two lines differing is meaningful, not a bug.

  **Its tags hover** (1.4.0), naming their aliases and description — the viewer's row tooltip, on
  the line the Proceed decision is actually made from. The mechanics:

  - `tagSummaryParts` returns segments instead of a string and `log()` takes an optional `parts`;
    `flush` builds a span per segment when it is there and keeps the plain `textContent` path for
    every other line. `lines` still gets the joined string, because Copy log hands over text.
  - **Only tags with something to add carry a tooltip** (`tagHasDetail`). The span already reads
    `"Body" (4) x3`; a tooltip repeating that would open on a hover to say what is already on the
    line. Nothing marks which tags have one — 1.4.1 removed the dotted underline and help cursor
    1.4.0 shipped with, because they read as decoration in a log that has none elsewhere — so a
    hover that opens has to earn it. The viewer's rows are the deliberate exception; see §5a.
  - **`loadTagDetail` fetches by id**, for the tens of tags a recap names rather than the thousands
    the hierarchy holds. This is the same rule as `tagQuery(settings, detail)` and it assumes
    `findTags(ids:)`; verify that against a live Stash like every other API assumption here.
  - **Failure is silent.** It buys a tooltip, not a run. The rejection handler resolves to an empty
    map and the line renders plain.
  - `reset()` bumps `pass` and `logTagSummary` captures it, so a recap whose query is still in
    flight when **Rescan** is pressed is dropped instead of landing in the next pass's log.

  The tooltip helpers live in their own section next to `tagLabel` rather than in the viewer, since
  1.4.0 made them two callers' code. The sibling has its own copy for the same reason its collator
  does: no shared module.
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

**There is deliberately no Clear log.** It existed until 0.10.0 and earned nothing: emptying the
buffer is only ever wanted before a Rescan, which empties the rendered view anyway, and once phase 2
has written something the log is the only record of what changed — Stash has no undo and the plugin
cannot reconstruct the list. A button whose whole safe use is covered by another button, and whose
unsafe use needed an arm/confirm latch (`run.wrote`, `CLEAR_ARM_MS`) to be survivable, is a button
worth removing rather than guarding. Its class also collided with the tree view's `.npt-clear`
input icon, which is what made the cost visible. Do not reintroduce it without a use Rescan does
not already serve.

**Two counters, deliberately.** `lines` is the export buffer: it survives a Rescan, because Copy
log is meant to hand over the whole session. `viewLines` counts what has gone into the log *since
the current pass emptied the view*, and is what the progress line describes — both the
`N log line(s)` figure and the `showing the last 1000 of N` clause. Reporting `lines` there was
wrong in a way that only showed up at scale: a pass that applied 28 000 lines followed by a rescan
finding nothing left the header claiming 28 161 lines and 27 161 hidden, over a log holding four.
Reset `viewLines` wherever the view is emptied — today that is `reset()`, which `rescan()` calls.

**A rescan starts a pass, so every per-pass surface has to be re-derived, not just added to.**
`reset()` handles the counters and `rescan()` clears the rendered log, but the head of the dialog
is written straight to the DOM: `begin()` blanks `noteEl` and repaints the progress line before
anything is loaded. The sibling warning is the reason — it tells the user to turn auto-merge off
and rescan, so leaving it up after they have done that reports a run as unsafe when it no longer
is. Anything else parked in the head needs the same treatment.

**Rescan is not a convenience.** The whole plan is computed before the first write, so anything
that changes tags *during* phase 2 — the sibling plugin in §8, another browser tab, a running
scan — is invisible to the plan that is being applied. Rescan is how the user converges: run,
rescan, see an empty plan, and know the library is normalized.

### Phase 3 — undo (0.12.0)

The dialog can take its own writes back. It exists because the review pass answers "is this what I
meant?" only as well as the user reads it, and a six-figure log is not read closely — the first
honest signal that a Prune was misconfigured is the library afterwards.

**It is the apply, inverted.** `applyBatch` records each batch the server accepted on `undoable`;
`undoBatch` replays it with `ADD` and `REMOVE` swapped. Nothing else is stored, and nothing is
recomputed — the batch *is* the record, which is why the grouping that made the apply cheap makes
the undo cheap too.

**A delta, never a restore.** It would have been simpler to keep each entity's pre-run tag list and
`SET` it back. That is wrong: it would revert every unrelated edit made in between, which is the
one thing an undo must not do. `ADD`/`REMOVE` touches only the assignments the run itself changed,
for the same reason phase 2 writes deltas in the first place (§5).

**Newest batch first.** A rescan-and-apply cycle can write to one entity twice, and taking the
second write back before the first is the only order that lands where the run started.

**Recorded on success only.** A failed batch changed nothing, so it must not be reversed —
otherwise a `REMOVE` that the server refused would be "undone" by an `ADD` that puts a tag
somewhere it never was. This is the same discipline as the applied tag recap being counted from
writes rather than from the plan.

**Session-scoped, like `lines`.** `reset()` clears it and `rescan()` saves it across the call.
Converging on an empty plan is the normal way to finish a run, and losing the ability to undo at
exactly that moment would be the worst possible time.

**Offered in `ready` as well as `done`,** because a rescan leaves the dialog holding a fresh plan
over a library the previous pass already changed — precisely when the user is choosing between
applying more and taking back what is there. It always finishes in `done`: a plan reviewed against
the library as it was no longer describes it, so Rescan is the honest next step rather than a
Proceed left armed over stale ground.

**It arms and asks.** One click sets the caption to `Undo N change(s)?`, a second within
`UNDO_ARM_MS` carries it out, and Rescan/Close disarm it. This is the same mechanism removed from
Clear log at 0.10.0 and the reasoning is not in tension: Clear log's safe use was covered by another
button and its unsafe use was discarding a log, whereas Undo has no alternative and starts a
library-wide write from the state where Copy log, Rescan and Close are its immediate neighbours.
The count is what earns the prompt — it states the scope rather than asking a generic "are you
sure".

**It takes a lease** labelled `<task> (undo)`, because it is a bulk write like any other (§8).

**The head warning changed with it.** "This cannot be undone" was true and is no longer, so it now
leads with the backup instruction and states Undo's three limits — own writes, open dialog, blind
to concurrent changes — rather than leaving them to be discovered.

## 5a. The hierarchy viewer (0.7.0)

A read-only third task, `Show Tag Hierarchy`, on the same entry-point machinery as the other two.
It answers the questions the other two raise — *which tags does Prune consider redundant, why was
that one left alone, where are the diamonds* — against the same graph they run on.

**Deliberately not a node-link graph.** A real tag DAG is a hairball past a few hundred nodes, and
drawing one needs a layout engine this repo has nowhere to put: no build step, no bundler, no
runtime dependencies, and a plugin folder is copied as-is. A tag DAG is also *mostly a forest*, so
a tree is the honest shape and the handful of multi-parent tags are marked rather than hidden.
**Copy as DOT / Copy as Mermaid** exists for anyone who does want a drawn graph, in a tool built
for it.

How the DAG survives being drawn as a tree:

- A tag with several parents is drawn in full under its **primary parent** — the first in Stash's
  own sort order, so the choice is stable between runs — and appears under every other parent as a
  `↩ shown under X` row that does not expand. Without that, a diamond duplicates its whole subtree
  once per path.
- The real row carries `◆ n parents`, which is where Prune surprises people: every parent on every
  branch is implied.

**The row tooltip carries name, id, aliases and description** (1.3.0). The row itself can only show
a name and an id, and neither answers "is this the tag I think it is" for a scheme with namespaced
duplicates. Three rules hold it together:

- **Both free-text fields are capped**, aliases at eight names or `TIP_ALIAS_CHARS`, whichever cuts
  first, and the description at `TIP_DESC_CHARS` on a word boundary. A tag with forty aliases would
  otherwise put a wall of text under the pointer, which is worse than the id alone.
- **The tail is counted, never dropped.** `and 4 more` is what stops a truncated list from reading
  as a complete one, and it is why the aliases are filtered for blanks *before* the count is taken.
  The first alias is always named, excerpted if it has to be — `and 12 more` listing nothing is not
  a tooltip.
- **`aliases` and `description` are fetched only by the viewer**, through `tagQuery(settings,
  detail)`. A description is free text and can run to paragraphs; asking for one per tag on every
  prune of a library with thousands of them buys a payload no code path reads. Same rule as
  `custom_fields` being conditional, and as counts being opt-in below.

**A row is `Name (id)`, a badge is a count** (1.2.7). This dialog is the one place where the two
kinds of number sit side by side on the same row — `Hair Colour (45)   2 child(ren)` — so it says so
in the head, the tag name carries a tooltip repeating the id, and the inspector's list headings were
changed from `Parents (3)` to `Parents: 3`. That last one was the actual bug: a heading in brackets
over a list of tags, in a dialog where brackets mean ids, reads as the tag with id 3. Keep counts
out of brackets here, or the head legend is lying about the row beneath it.

**Both of those badges are jumps** (0.9.0). A count of three parents that cannot be followed leaves
the user knowing a tag hangs off three branches and with no way to see the other two — the badge
states the problem and withholds the answer. `◆` walks to the **next** parent in sort order counting
from the row it is on, so it is stateless (the row knows its own `under`) and n clicks tour every
branch and come home; its tooltip names them all, since a tour is not a choice. `↩` goes to the full
copy it already names. Both are on repeat rows too, so the walk continues from wherever it landed —
which is why the `◆`/`↩` badges are no longer an `else if` pair.

`jumpTo(id, under)` is the single navigation primitive — reveal, select, render, centre — and Find
calls it with a null `under` meaning "wherever it lives". `under` is what makes an *occurrence*
addressable rather than a tag: `render()` keeps `occNodes[id][parentId]` alongside `rowNodes[id]`,
and `centerOn` falls back to the tag's own row when the occurrence is not drawn (its parent is in a
cycle, so it is never walked into). `rowNodes[id]` prefers the real row over a repeat explicitly;
which of the two is drawn last depends on where the parents sit in the tree, not on their sort
order, so the old "last one wins" comment was true only by accident.

Every tag named in the inspector is a jump as well. That is the direct way to reach *one particular*
parent, where the badge is the tour — the two gestures are worth having both of, and the inspector
is where the parents are already listed by name.
- **Cyclic tags are surfaced as roots.** They are unreachable from any real root, so a tree that
  only walked downwards would hide exactly the tags both tasks refuse to touch — the one case
  where a viewer earns its keep.

**Badges come from `filters.protections(id)`, not from a second copy of the rules.** `makeFilters`
returns a reason string rather than a bare boolean (`blockReason`), so the viewer can say *which*
filter protects a tag and can never drift from what the run will actually do. That is the whole
value of the badge; a re-implementation that agreed today and diverged in six months would be worse
than no badge.

**Nothing may assume the graph is there.** `build()` wires every control and *then* calls `load()`,
so both boxes and all five footer buttons are live before the tag query answers — and stay live
forever if it fails, since the dialog remains open showing `Could not load tags`. Every entry point
that reads the graph is gated on `ready()`; without it a keystroke in either box threw
`Cannot read properties of undefined (reading 'byId')` into the console on every character, with
nothing visible to explain it. `render()` is gated too, so a future caller cannot reopen the hole.

**Counts are opt-in.** `scene_count` and friends are per-tag resolver fields and one query over
thousands of tags is the expensive thing in this dialog, so they load on a button. `depth: 0` is
passed **explicitly**: the count is for the tag itself rather than for it plus everything beneath
it, and the server's default for an omitted `depth` is not documented in the schema — an ambiguous
number on screen is worse than no number.

**Find and Filter are two gestures, not one control with a mode.** Find *navigates*: it opens the
path to the match through the same primary parents the tree draws it under, selects it, and centres
the row (`scrollIntoView({ block: 'center' })`, with a manual `scrollTop` fallback). Filter
*reduces*: it throws the tree away for a flat list of matches. Conflating them would cost whichever
half the user wanted this time. Find clears an active filter before jumping, because "show me where
this tag lives" cannot be answered from a flat list — that is the one place they interact, and it
is the direction that keeps the request honest.

Both boxes are built by `clearableInput()`, which wraps the input and its × in a
`position: relative` container. The icon used to be pinned to the row itself, which worked only
while the row held one box - the moment Find was added beside Filter, that icon would have sat over
the wrong input. Clearing Find drops the box and the counter but leaves the tree where the find took
you: it is a way to stop searching, not an undo.

**Both boxes are case-insensitive; the exclusion filters are not.** They look similar and are
deliberately different: the box locates a tag a human is looking for, and nobody types a namespace
marker's exact case to find one. The filters decide what gets written, where matching loosely would
protect or skip tags by accident — see §4.

**The export follows the selection.** With a tag selected it emits that tag's neighbourhood
(ancestors + descendants + the edges among them), which is the part that is legible when drawn;
with nothing selected, the whole DAG. Edges whose other end is outside the exported set are
dropped, or the output references nodes it never declares.

## 5b. Auto mode (1.1.0)

`a8AutoPruneOnUpdate` and `a9AutoRollUpOnUpdate` make the plugin **reactive** as well as bulk: it
wraps `fetch`, and every entity Stash saves is re-normalized in the chosen direction immediately.
The tasks answer "normalize my library once"; these answer "and keep it that way".

**This breaks the invariant the rest of the plugin is built on.** Everywhere else, nothing is
written without a plan on screen and a Proceed, and §5's Undo exists because a six-figure review log
is not read closely. Out here there is no dialog, so there is no review, no tag summary and no Undo —
a `[REMOVE]` line in the browser console is the entire record. Auto Prune in particular deletes tag
assignments one save at a time, silently. The two setting descriptions say so in those words; they
are the only warning the user gets, so do not trim them for length.

**Which types are covered is `a1`–`a7`**, the same toggles that scope the tasks. One list rather than
a second set of seven, so the settings page cannot describe two different libraries — and the
all-off default carries over, which means a fresh install reacts to nothing until the user has said
which types they have thought about. The cost is real and worth stating: you cannot auto-prune only
scenes while the task covers everything.

Both single and bulk mutations are watched (`sceneUpdate` *and* `bulkSceneUpdate`), so a bulk edit
of 500 scenes normalizes all 500. That is usually the point, and it is also the largest silent write
this plugin can make without a dialog.

### Watching the mutations

`TYPES` gained a `single` field to go with `bulk`. The two never collide under a `\b`-anchored
regex because Stash capitalises the type inside the bulk name: `bulkSceneUpdate` does not contain
`sceneUpdate`, and neither contains `sceneMarkerUpdate`. The regexes are compiled once and cached on
the type (`autoRe`) — the wrapper runs on every GraphQL request the page makes, and compiling
fourteen of them per request is a cost paid overwhelmingly on queries that never match.

`mutationSucceeded` is copied from the sibling and for the same reason: `fetch` resolves for HTTP 500
and for GraphQL errors returned with HTTP 200, so "the request came back" is not "the edit was
saved". Normalizing a save Stash rejected would write changes the user never made.

**Known gap: `scenesUpdate` / `imagesUpdate`** — the array-input plural mutations — are not watched.
Stash's UI does not use them for tag edits. If that changes they need their own branch, reading ids
out of an array of inputs rather than one `input.ids`.

### Reading entities

Every plural find query takes `ids: [ID!]`, markers included, so `autoEntityQuery` fetches exactly
the touched entities in one request and `planEntity` runs against them unchanged. No paging, no
`count`, and no second planning implementation — `planEntity`, `buildBatches` and `applyBatch` are
the same code the tasks use. `applyBatch` writes into an `autoSink()` instead of a `Run`: same
fields, console instead of a DOM. Its `undoable` array is collected and dropped, because there is no
dialog to offer it from.

Those console lines are the dialog's lines, so they need the dialog's legend and have no head to put
it in. `autoLegend()` prints it once, from the first `log()` any sink makes — once per page rather
than once per reaction, since a mode that reacts to every save would otherwise repeat it forever, and
a line printed only at load would scroll away long before the first write it explains. The flag is
module-scoped for that reason: `autoSink()` returns a fresh object per reaction and could not carry
it.

### Caching

The tasks read settings once per run. Auto mode has no run to hang that off, and no main loop
either — the tasks were the only entry point until now. So both reads are cached on demand rather
than polled: settings for `AUTO_SETTINGS_TTL_MS`, the tag hierarchy for `AUTO_GRAPH_TTL_MS`. **An
idle tab issues no queries at all**, which is better than the sibling's 10s timer, and the price is
that a settings change takes up to ten seconds to take effect.

The graph cache is also **invalidated outright by any tag mutation** seen in the wrapper. Without
that, a parent created in another tab would be ignored for a minute — and a plugin whose whole
subject is the hierarchy cannot be a minute behind it.

### The four things that stop it eating a library

1. **Both modes on does nothing.** They are exact inverses, so whichever ran second would undo the
   first on every save. `autoMode` returns null and warns once. Picking one silently is a trap
   dressed as a convenience, and there is no ordering that makes both coherent.
2. **`guarded()` / `_writeDepth`**, the internal re-entrancy guard, modelled on the sibling's
   `_mergeDepth` and a counter for the same reason. It wraps the auto writes *and both task write
   paths*: phase 2 and Undo issue `bulk*Update` for every batch, which is precisely what the wrapper
   watches for, so without it a Prune task with Auto Prune enabled re-plans each batch it has just
   written — and an Undo would have its reversal put straight back.
3. **A lease**, so other reactive plugins stand down while we write. This is what stops the
   sibling's auto-merge from bouncing a prune straight back. It is short — `AUTO_LEASE_TTL_MS`, not
   the tasks' five minutes — because a crashed tab must not stand the sibling down for five minutes
   over one scene save. We honour our own lease no differently from anyone else's; §8 explains why
   that is correct rather than a self-inflicted deadlock.
4. **A per-entity cooldown**, for when 3 is not honoured. A plugin older than the protocol, or a
   server-side `hooks:` plugin that never sees this `window`, can still write our removals back.
   Without a cooldown, Prune and that plugin ping-pong over one entity for as long as the tab is
   open. After writing to an entity we ignore further updates to it for `AUTO_COOLDOWN_MS`, which
   caps the exchange at one round and leaves the other plugin's write standing — the safe direction,
   since it means fewer deletions rather than more.

Only entities we **wrote to** go on cooldown, never everything a mutation touched: marking an entity
we planned nothing for would suppress a later, legitimate reaction to it. The map is swept of
expired entries once it passes `AUTO_COOLDOWN_MAX` rather than capped, since a bulk edit can put
tens of thousands of ids in it and each expires on its own schedule.

Note that 2 and 4 overlap on the auto path — a self-reaction always targets ids marked a moment
earlier, so either alone would stop it. They do **not** overlap on the task path, where nothing
marks a cooldown, and that is where `_writeDepth` is doing work nothing else does. The test suite
says so explicitly, because a check that passes for the wrong reason is worse than no check.

### Saying so on the settings page (1.2.0)

Both modes on runs neither, which is the safe reading and an invisible one — the only signal was a
console line, and nobody has the console open while ticking a checkbox. `settingsTick()` puts a
notice inside the plugin's own `SettingGroup` for as long as both are on.

**It reports and does nothing else.** Switching one off automatically was considered and rejected
on three counts, all worth keeping written down because the idea will come back:

- Plugin settings are **server-side and shared** by every tab and every user of that Stash. A
  checkbox that silently unticks another unticks it for everybody.
- `configurePlugin(plugin_id, input)` exists, but Stash's settings page holds plugin config in
  **React component state** (`SettingStateContext` → `setPlugins`), not in the Apollo cache. An
  out-of-band write therefore leaves the box visibly ticked until a reload — it would fix the
  config and lie about it, and Apollo eviction (the sibling's trick for scene lists) cannot reach
  React state.
- Driving Stash's own `onChange` through `PluginApi.patch` *would* keep the UI honest, and is the
  only version that works. But it turns "both ticked does nothing" into "the second one you ticked
  is now live" — for Auto Prune, silent deletions starting from a click that used to be inert. That
  is a move from failing safe to failing on, and it would make the settings' own
  "Has no effect if …" wording false.

There is also no way to collapse the pair into one control: `PluginSettingTypeEnum` is
`STRING | NUMBER | BOOLEAN`, so Stash has no dropdown for a plugin setting.

**It reads the checkboxes, not the saved settings.** `liveConflictState()` returns
`prune.checked && rollup.checked` off the two inputs. That is the state the user is looking at, it
costs nothing, and it lags by nothing. Three releases tried to make a config-derived notice keep up
with a click and none of them did: Stash sets its own React state immediately and debounces the
save, so *anything* that re-reads the config is behind the checkbox and disagrees with the screen
while it is — which is worse than useless for a warning about which boxes are ticked. Querying the
server survives only as a fallback for a Stash whose inputs cannot be read.

**And it sits immediately above the Auto Prune row**, not at the top of the group box. The original
placement was chosen so the notice showed while the group was collapsed; but a collapsed group is
one you cannot misconfigure from, and in an expanded one it put the notice off the top of the screen,
far from the checkboxes it is about. Next to the controls is where a warning about those controls
belongs.

**A settings save invalidates the settings cache** — the `fetch` wrapper watches for
`configurePlugin` carrying our own `plugin_id` and drops it. This is nothing to do with the notice,
which reads the DOM: it is for **auto mode**, which caches settings for `AUTO_SETTINGS_TTL_MS` and
would otherwise keep writing under the old ones for up to ten seconds after you enable a mode. Two
details: re-read only **after** `mutationSucceeded`, or the old values come straight back and are
cached for another ten seconds; and scope it to our `plugin_id`, since the settings page saves each
plugin in its own mutation.

> **A detour worth not repeating.** 1.2.3 and 1.2.4 both tried to make a *config-derived* notice keep
> up with a click — first by invalidating on `configurePlugin`, then by polling settings once a
> second while the page was open. Neither helped, because the delay being chased was a stale
> `NormalizeParentTags.js` in the browser, not the cache. The version in the settings group heading
> comes from the manifest and reloads instantly, so it read the new version throughout while the old
> script ran. Two lessons: **get one measurement off the live instance before shipping a second fix
> for the same symptom**, and remember that a plugin's *displayed* version proves nothing about the
> code running. The per-second poll is gone; the invalidation stayed only because auto mode wants it
> for its own reasons.

Mechanics worth keeping: the group is found by a **heading carrying the plugin name**, never by
position, since the page lists every installed plugin — the same rule as the task interception in
§2.

**Anchor on the setting element ids, not on any heading.** `SettingsPluginsPanel.tsx` gives every
plugin setting an id built from the plugin id and the setting key:

```jsx
id: `plugin-${pluginID}-${setting.name}`   // plugin-NormalizeParentTags-a8AutoPruneOnUpdate
```

That is ours by construction — no version suffix, no localisation, nothing formatted for display.
`ownSettingGroup()` finds one of ours and walks up to the enclosing `.setting-group`. Finding it is
*also* what tells us the plugins settings page is showing, so there is no route test either; that
was one more assumption with nothing checking it, and those ids cannot exist on another page.

The notice goes at the **top of the group box**, not beside the setting: the settings themselves sit
inside a `<Collapse>` that `SettingsPluginsPanel` shuts by default, so a notice in there would be
invisible until the user expanded the very group it is telling them to look at. The group header is
outside the Collapse, so the top of the box is visible either way.

**Two releases shipped this broken by matching the heading text instead, and the tests agreed with
the bug both times** — they were written from the same guess as the code, so they modelled a DOM
Stash never produces. The heading match survives only as a fallback for a Stash that does not set
those ids, and `normalize-auto` now builds the real structure: group box, header, collapsed section,
and inputs carrying the real ids. Removing the id anchor fails the placement checks; the old
heading-only matcher failed seven.

**The two pages do not head that group the same way, which is what broke 1.2.0.**
Settings → Tasks passes the name straight through (`heading: o.name` in `PluginTasks.tsx`), but
Settings → Plugins appends the version:

```jsx
heading: `${plugin.name} ${plugin.version ? `(${plugin.version})` : undefined}`
```

so the `h3` there reads `Normalize Parent Tags (1.2.0)` — and, since that template interpolates the
literal when a plugin has no version, sometimes `Normalize Parent Tags undefined`. Matching the bare
name found neither, so the notice never appeared. `headingIsOurs` strips the suffix and compares
**exactly**; do not relax it to a prefix test, or a plugin called `Normalize Parent Tags Extra`
becomes us. All five spellings are pinned in `normalize-auto`, and both the original bug and the
prefix-match "fix" fail those checks.

The lesson generalises: every one of this plugin's footholds in Stash's markup is a guess until it
runs against a real Stash, and a test written from the same guess confirms nothing. When a DOM
assumption is added here, read the component that produces it. Rendering is idempotent, because the tick runs on a timer and on every navigation. Settings are
only read while that page is showing, so a tab parked anywhere else costs two string comparisons a
second and no queries. And a failed settings read leaves whatever is on screen rather than
flickering the notice off and back on. There is deliberately **no MutationObserver** here, unlike
the sibling's button injection: a banner in a settings panel does not have to land before the user
can click it, so the timer plus the navigation hooks are enough and cannot fight a React re-render.

### The exclusion tag

`b1ExcludeEntityWithTagName` resolving to nothing **stops auto mode** rather than letting it run
unfiltered, exactly as it aborts a task run — running unfiltered would touch the very entities the
user asked to protect. The dialog can stop a run and say so; out here there is nothing to stop, so
it warns once to the console and keeps refusing quietly until the setting is fixed or cleared.

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
- `a8`–`a9` — the two auto modes (§5b). They read better at the head of the block, above the toggles
  that scope them, and they are at its foot anyway: a key is the storage key, so renumbering `a1`–`a7`
  to make room would silently reset every entity toggle on every existing install. Directly under
  the toggles is the next best place, and it is where the settings page puts them.
- `b1`–`b2` — the entity-level exclusions.
- `c1`–`c6` — the tag-level filters: the both-directions one first, then the add/remove name pair,
  then `c4TagNameSeparator` directly under the two settings it splits, then the add/remove
  custom-field pair.

`c4TagNameSeparator` arrived last and was briefly `c6`, appended to avoid renumbering. It was moved
under `c2`/`c3` at 0.6.0, pushing the custom-field pair to `c5`/`c6` — a deliberate exception to the
rule below, taken while the plugin was still unreleased and the only install was the author's. That
window is closed for the next one.

Keep the YAML block itself in key order too. It is not what Stash reads, but a block that reads
differently from the page it produces is a trap for the next edit.

A key is also the **storage key** — Stash saves values under it — so renaming one silently
resets that setting for every existing install and strands the old value in the config. Renaming
happened once, at 0.1.1, while the only install was the author's. It should not happen again
without a good reason. New settings get a prefix in the block they belong to; if there is no gap
left, renumber the whole block in one go rather than bolting on a `c5a`.

**A new key has to be added to `DEFAULTS` as well.** `loadSettings` copies only the keys that table
declares, so a setting present in the manifest and missing from `DEFAULTS` reads as empty forever —
configurable in the UI and inert in the run. `c4TagNameSeparator` shipped that way for one test run;
the suite caught it because the separator case was written to fail without the feature.

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

- **Since 1.1.0 this plugin is on both sides of the protocol**, like the sibling and for the same
  reason: the roles are per *run*, not per plugin. The tasks are bulk; auto mode (§5b) is reactive.
  So it registers as a respecter at load and stands down for anyone else's lease before reacting —
  which is what makes the sibling's "will it stand down" warning, and ours, true in both directions.
  Registration is unconditional rather than gated on an auto mode being enabled: the flag means this
  copy honours the protocol, which is true whatever the settings say.
- **Auto mode honours our own lease no differently from anyone else's**, which sounds like a plugin
  standing itself down and is not. `guarded()` has already excluded every write we issue, so the
  only thing that can reach the check while our lease is held is a *user's* save in the same tab —
  precisely one that should wait for the bulk run to finish. The sibling's §7 documents the mirror
  image of this.
- The lease is taken **around phase 2 only**. Phase 1 writes nothing, so there is nothing to
  suppress, and holding a lease through a long scan would disable the sibling for no reason.
  Auto mode takes its own, much shorter one (§5b).
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

**The sibling is a bulk plugin too, since its 1.5.0.** Its library-wide task rewrites scenes across
the whole library and takes a lease while it does, so `begin()` reports one that is already held —
naming the owner and the task — the same way that dialog reports ours. It is a warning, not a
block: a task click is manual on both sides, and standing down for a lease we would only have taken
ourselves a moment later helps nobody. Ours is taken in `proceed()`, so nothing in `begin()` can be
looking at its own.

## 9. Testing

Five suites cover this plugin — `normalize-plan`, `normalize-apply`, `normalize-tasks`,
`normalize-tree`, `normalize-auto` — plus
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
  vs prototype keys, and that a skipped tag does not block its own parents in Roll Up. For the
  name filters: several substrings each protecting on their own, padding and repeated whitespace
  yielding no empty term, and a blank setting protecting nothing rather than everything.
- **Two-phase dialog** — no mutation is issued before Proceed; Cancel issues none at all.
- **The hierarchy viewer** (`normalize-tree`) — that it issues no mutation and nothing beyond the
  settings and tag queries, that a diamond appears under both parents with exactly one of them the
  repeat, that cyclic tags are still reachable, that badges and the inspector name the filter
  actually configured, the DOT/Mermaid exports including edge pruning at the selection boundary,
  counts being fetched only on demand and pinned to `depth: 0`, and the filter box - matching
  case-insensitively anywhere in a name, with its clear icon appearing only while there is
  something to clear - and the find bar, which opens the path to a match, selects and centres it,
  counts and cycles through matches with Enter, and clears an active filter on the way. The jumps
  are covered against a tag with **three** parents, since two only proves a badge toggles: the `◆`
  badge walks them in order and wraps, the `↩` badge reaches the full copy, the inspector's tag
  lists jump, and jumping out of a flat filtered list restores the tree first. A failed tag query
  is covered too: both boxes and all five footer buttons are driven against a dialog that has no
  graph, and must stay inert rather than throw.
- **What a rescan resets** — the log-line counter describes the new pass rather than the session
  (including the reported case: a rescan finding nothing reports four lines and claims nothing
  hidden), Copy log still exports both passes, and the sibling warning clears when the setting it
  warns about is turned off.
- **The tag summary** — the exact closing line in both directions and both phases, the per-tag
  entity counts, an empty plan producing none, and a failed batch dropping its 100 entities out
  of the applied count rather than out of the plan's. Its tooltips too: the detail query scoped by
  id to the tags the recap names and asking for the two fields the hierarchy query does not, the
  tooltip's contents, a tag with neither field left plain, both phases' recaps hovering, the line's
  text unchanged so Copy log is unaffected, and a failed detail query leaving the line readable and
  unremarked. Ordering is covered against all three parts
  of Stash's rule at once (a `sort_name` override, case-insensitivity, and `Volume 2` before
  `Volume 10`), plus that the tag query actually requests `sort_name`.
- **Naming an untitled entity** — a zip gallery falls back to its file, a folder gallery to its
  folder, an image to its `visual_files` basename, and a real title still wins over all of them.
  The queries are asserted too: the fallback fields are useless if they are never requested, and
  that combination is exactly what shipped broken.
- **The id legend** — the run dialog's head says a bracketed number is a Stash id and a count is
  written `x250`; the viewer's says the same for its rows, its name tooltip repeats it, and the
  inspector's headings are asserted to count *outside* brackets (`All descendants: 4`) since that is
  the rule the legend depends on. The tooltip's own content is covered too: the aliases and
  description it adds, both caps (eight names, then a counted tail; an excerpt cut on a word
  boundary), a tag with neither field saying nothing about them, and — in `normalize-plan` — a run
  *not* asking for either field. Auto mode's console legend is checked for being printed once,
  ahead of the first line it explains, and not repeated on the next reaction.
- **The dialog chrome** (`style`, repo-level) — every CSS rule this dialog shares with the
  sibling's is compared against it and has to match. See the repo-root CLAUDE.md; this is the check
  that would have caught the modal being `#202b33` here and `#30404d` there.
- **No Clear log** — the run dialog does not offer one. Pinned so a reintroduction has to argue
  with §5 rather than slip back in.
- **Grouping and chunking** — identical deltas collapse into one mutation, chunks cap at 100 ids,
  a failed chunk is isolated and its entities are not logged as changed.
- **Task interception** — the click never reaches `runPluginTask`, and the fetch fallback catches
  it if the click handler is bypassed.
- **Processing order** — performers are queried and written before scenes and images, whichever
  order the settings come back in.
- **Sibling detection** — an auto-merge flag set on `MergePerformerTagsToScenes` in the shared
  `configuration { plugins }` response raises the dialog warning, and its absence does not.
- **Someone else's lease** — one held at `begin()` is warned about, names its owner and label in
  the head, and does not disable Proceed; no lease leaves the head empty.
- **Undo** — not offered before a write; one click arms with the scope in the caption and writes
  nothing; the reversal issues one mutation per applied batch, every one of them the inverse mode
  and a delta rather than a tag list; a failed batch is left out of both the armed count and the
  reversal; a lease is held across it and named `(undo)`; a rescan keeps it; and undoing from
  `ready` lands in `done` rather than back at Proceed. Roll Up is covered as well as Prune, since
  the inverse is read off what was written and not off the task.

- **Auto mode** (`normalize-auto`) — that a save triggers exactly one delta write in the configured
  direction; that an already-normalized entity costs a read and no write; every gate (both modes
  off, both modes on, a disabled entity type); that a bulk mutation is reacted to as one write
  covering only the entities that needed changing; that an auto write does not cascade; the
  cooldown, including that an entity we planned nothing for is *not* on it; standing down for a live
  lease but not an expired one; registering as a respecter; a lease held across the write and
  released after; a save Stash rejected not being reacted to; the exclusion filters still applying,
  including an unresolvable exclusion tag stopping auto mode outright; **the task's apply not being
  reacted to**, which is `_writeDepth`'s own test; and the tag-graph cache, fetched once and
  invalidated by a tag mutation.

  Every guard in §5b was confirmed against a deliberately broken copy before being trusted —
  `_writeDepth`, the task guard, the cooldown, the lease check, the both-modes rule and
  `mutationSucceeded` each have a mutant that fails exactly one check. That exercise is also what
  showed that the "does not cascade" check passes with `_writeDepth` removed, because the cooldown
  covers the same case; the check is named for the outcome it proves rather than the mechanism it
  does not, and the task-apply case is where the guard is isolated.

The suites cannot confirm Stash's own behaviour (page markup, `BulkUpdateIds` semantics), so any
change here still needs one run against a real instance — preferably a copy of the library. That
goes double for auto mode, whose whole surface is a `fetch` wrapper reacting to mutation names this
repo can only assert against its own fake Stash.

## 10. Versioning

Per the repo convention: bump the patch digit in **both** `NormalizeParentTags.yml` and
`manifest` on every change; bump the minor digit and reset the patch for a new feature.
