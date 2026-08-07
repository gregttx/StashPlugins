# CLAUDE.md — Propagate Tags and Performers to Related Entities

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, the bulk-edit lease, the shared dialog chrome) are in `../CLAUDE.md` and still apply.
The user-facing description is `README.md`; this file is for the reasoning that does not belong in
either.

**Status: under construction, 0.8.1.** The version is below 1.0.0 deliberately and stays there
until the plugin is finished — the major digit is the claim that it is worth installing. Each
implementation step takes a minor bump; fixes within a step take the patch.

| Step | | Version |
| --- | --- | --- |
| 1 | Scaffold: manifest, settings, `TARGETS`/`PATHS`, CSS | 0.0.1 |
| 2 | Shared base: cooperation, GraphQL, task interception, dialog, settings page | 0.1.0 |
| 3 | The planner — all eleven walk-based paths | **0.2.0** |
| 4 | Phase 2 apply, and Undo | **0.3.0** |
| | — the log names the source entity, not the path | **0.3.1** |
| 5 | The two reverse-query paths (a gallery's images) | **0.4.0** |
| 6 | Auto mode, target side, **and** the per-entity cooldown | **0.5.0** |
| | — auto mode, source side (the fan-out) | **0.6.0** |
| 7 | The `declares` registry, **and** NormalizeParentTags awareness | **0.7.0** |
| 8 | Manual buttons and staging | **0.8.0**, fixed at 0.8.1 |
| 9 | Repo `CLAUDE.md` TODO/IDEAS | — |

**Step 8 placement is unverified against a live Stash beyond one page.** `.edit-buttons` is
confirmed to exist on the scene page (`MergePerformerTagsToScenes`' own scene button already uses
it); this plugin reuses it unverified for the gallery, image and group pages, on the working
assumption that Stash builds every entity's edit panel from the same button-row component. §5b says
what to check first if a button never appears somewhere.

**0.8.1 fixed the first thing a live Stash actually found: no buttons ever appeared, anywhere.**
`manualButtonsTick` called `.slice()` directly on `container.childNodes`, which throws in a real
browser — `childNodes` is a live `NodeList`, not an `Array`, and has no `.slice()`. The test suite
never caught it because the harness's own fake `childNodes` *is* a real array (other suites depend
on that: `.filter()`/`.indexOf()` against it, throughout `propagate-base`, `merge-task` and
`normalize-auto`), so nothing in this repo's testing could have distinguished the two shapes without
a container built specifically to reproduce a `NodeList`'s absence of `Array.prototype` methods —
which `tests/propagate-buttons.test.js` now has (`nodeListLikeContainer`), pinning this exact error.
The placement guess itself was fine; the bug was underneath it, in code this plugin's own dialog
never needed and so never wrote - every other `.childNodes` read in this file uses index access or
`.length`, never an `Array.prototype` method straight off the live collection.

**Steps 3 and 5 were re-cut during step 3.** The plan had two hops and the "common tags only" modes
as a step of their own, on the assumption that reaching a group's performers through its scenes
needed a query per group. It does not: GraphQL nests, so `Group.scenes { performers { tags } }` is
one query and a two-hop path is only a longer `walk`. The modes are a fold over the sources, equally
cheap. Splitting them out would have shipped a path whose "common tags only" setting was visible in
the UI and silently ignored, which is worse than either half. What genuinely differs is the two
paths out of a *gallery's images*, which have no field to walk and need a reverse query — so that is
step 5 now.

The full design, including the decisions that were taken and the paths that were rejected, is in
`.plans/migrate-tags-and-performers.md`, tracked in git alongside the rest of this plugin.

---

## 1. What it does, and the one word that matters

Tags and performers are copied **along Stash's entity relationships**: a scene's performers' tags
onto the scene, a gallery's images' performers onto the gallery, a group's scenes' tags onto the
group. Thirteen paths, each its own setting, all off on a fresh install.

It is a **copy, never a move**. Nothing is removed from the source, and nothing is removed from the
target either. The single exception is the dialog's Undo, which removes what that same dialog just
added — and every other decision in here assumes the additive rule, because a wrong copy cannot be
taken back by the thing that made it.

`MergePerformerTagsToScenes` implements one of the thirteen (`tags:performer>scene`). Both plugins
stay installable and both keep working with both enabled; the overlap is redundant work, never
wrong data, because both only ever add. Announced rather than prevented — see step 7.

## 2. The path table is the spine

`PATHS` in the JS is read by the task, both automatic modes, the manual buttons and the
cross-plugin declaration. Nothing else carries a list of what this plugin can do.

**Array order is the pipeline order, and it is semantics.** Paths cascade: running markers into
scenes before scenes into groups means the group transitively inherits marker tags, and the reverse
order does not. Six stages:

1. **Performer assignments** — images → galleries, galleries → scenes.
2. Tags onto scenes — markers, performers, studio.
3. Tags onto galleries — images.
4. Tags onto groups — scenes, studio, and through those scenes the performers and markers.
5. Sub-groups → containing groups.
6. The two reverses — groups → scenes, galleries → images.

**Stage 1 exists because the design got it wrong first.** The plan put the performer assignments in
stage 2, after the tag paths. That silently defers work by a whole run: `tags:performer>scene`
copies a scene's performers' tags onto the scene, and `performers:gallery>scene` gives the scene new
performers, so a performer arriving after the tag path has run brings no tags with it until the next
pass. Nothing errors, so nobody finds out. Anything that *assigns* has to land before anything that
*reads* the assignment.

**Never derive the order from the settings object's key order.** It is not guaranteed, and it would
put the reverses in the middle.

Two fields describe the traversal and only one of them is stored. `walk` is the list of field names
from the target down to whatever carries the payload, and `pathSelection()` builds the GraphQL
selection from it — because a `walk` and a hand-written `select` beside it are two things that can
disagree. Three shapes the builder has to get right:

- **A marker's primary tag counts.** `SceneMarker.primary_tag` is a required field of its own, and a
  marker whose primary tag is `Blonde` carries that tag as much as one that lists it. `markerTags`
  is what adds it to the selection.
- **`Scene.groups` and `Group.sub_groups` are not Groups.** They are `[SceneGroup!]` and
  `[GroupDescription!]`, each wrapping a Group in a `group` field, so both walks carry an explicit
  `group` step. Walking straight to `tags` asks for a field the type does not have.
- **A Gallery has no `images` field.** Only `image_count` and `image(index)`. So both paths out of a
  gallery's images use `reverse` — a `findImages` query with a gallery filter — rather than a walk.
  These are the only two paths reached that way.

**`Group` has no `performers` field, in any direction.** So no performer path can reach a group, and
`tags:performer>group` has to route through the group's scenes — which is what makes it two hops.
This is a schema fact, not a scoping decision; do not let anyone "add the missing path".

## 3. The two reversible pairs

```
tags:scene>group   ⇄  tags:group>scene
tags:image>gallery ⇄  tags:gallery>image
```

Two separate consequences, routinely confused:

**Homogenisation is a result, not a bug.** Under union, both directions drive every member to the
same tag set: scenes S1{A} and S2{C} in group G{B} converge on {A,B,C}. That is what running both
directions *means*, and it settles in two rounds. But a user who enabled each half because it
looked reasonable alone will not expect it, so the dialog says so (`pairedBoth`) and offers the two
ways out: disable one, or turn on "common tags only" for the aggregating half, which leaves almost
nothing to push back down.

**Auto-mode ping-pong is a bug, and needs the cooldown.** Each write triggers the other's reaction.
`guarded()`/`_writeDepth` does **not** cover this — it suppresses our own writes inside one
reaction, not the second reaction that the first one's mutation triggers. `NormalizeParentTags`'
per-entity cooldown is the defence and `MergePerformerTagsToScenes` has no equivalent, so it cannot
be copied from the nearer sibling. **Auto mode and the cooldown ship in the same step, never one
without the other** — that is step 6, and it is the whole reason those two are one step.

The *paths* need no such coupling and shipped with the rest at 0.2.0. Under the task neither
consequence is a hazard: one run applies each direction once, in a fixed order, and the plan-aware
gather means the second direction reads what the first one decided rather than racing it.

## 4. Settings

Twenty-four keys, prefix-ordered because `settings:` is a YAML map — the declaration order is gone
by the time Stash has parsed it and the page renders the keys sorted alphabetically. Blocks:
`a1`–`a4` what starts a run, `b`/`c`/`d`/`e` the paths grouped by what they write onto, `f` the
exclusion filters, `g` logging.

**The letters differ from the siblings and the suffixes do not.**
`ExcludeTagWithIgnoreAutoTag` is the same words in all three plugins; only the prefix moved, because
this plugin has five blocks of paths that they do not have. Keep the suffixes recognisable.

**A key is the storage key.** Renaming one silently resets it for every install and strands the old
value in the config. New settings take a prefix inside the block they belong to; if a block is full,
renumber that whole block in one go rather than bolting on a `b5a`.

**`a2SaveImmediately` is inverted on purpose**, the one setting here that is. Stash has no default
for a plugin setting and renders an unset `BOOLEAN` as unchecked, so the behaviour we want by
default (staging) has to be what "off" selects. Otherwise the box would read off while acting on,
and the first click on it would send `true`. Every path toggle is off by default for the opposite
reason: these are library-wide writes, and opting in per path is how the user says which
relationships they have thought about.

**`PATHS` is a second place the manifest keys live.** Unlike `DEFAULTS`, nothing in the plugin fails
loudly if a path names a key the manifest does not declare — the setting simply reads as `false`
forever, and the path is configurable in the UI and inert in the run. `tests/propagate-paths.test.js`
is the only thing holding the two halves together; keep it that way.

## 4a. The planner (0.2.0)

**Target-centric, and grouped into passes by stage and then by target.** Three paths writing tags
onto scenes in stage 2 are one query per page, not three — repeating a field is legal GraphQL and
the server merges the selections, so two paths sharing a walk prefix cost nothing. Grouping across
*stages* would be cheaper still and is wrong: the stage boundary is what makes the cascade work.

**The plan is keyed by the entity being written and what is being written to it** — `target:kind:id`
— never by the path that asked. A scene wanting tags from its performers, its studio and its markers
is one entry carrying the union, because the write is one delta on one entity. This is the sibling's
§7a rule and it is the one thing here that would silently lose data if rearranged.

**The cascade is the part that is easy to miss.** Paths cascade, but the review happens before any
write, so "read the sources fresh at each stage" cannot mean re-reading the server — nothing has
been written yet. It means reading the *plan*: when stage 4 copies a scene's tags onto its group, it
counts whatever stage 2 already planned for that scene as though it were there. `plannedFor()` does
this by looking the entry up in `planIndex`, so there is one answer to "what will this entity end up
with" and no second structure to disagree with the plan.

Three consequences:

- Every walk asks for the **source entity's own id**, because that is what the lookup is keyed on.
  It is not decoration, and `propagate-paths` pins it.
- `sourceType` on each path says what the walk lands on. The cascade applies only where that is
  itself one of our targets — seven of the thirteen paths. Performers, studios and markers are never
  targets, so nothing can ever be pending for them.
- Without it, the cascade still *happens*, just one run later, and nothing errors. That is why the
  test for it is paired with a negative: the same library with only the group path enabled must gain
  nothing, or the check would pass on the group path merely working.

**Deep group nesting is one level per run.** Stage 5 rolls sub-groups into their containing group,
but a sub-group that itself gained tags in stage 5 is not re-read within that stage. Rescan is the
answer, as it is for everything else the plan cannot see.

**Union versus common-tags-only** is a count against the number of sources. Two edges to keep true:
one source makes the two modes the same answer, and zero sources adds nothing under *either* — the
intersection of no sets is emptiness here, not everything, because a group with no scenes has no
scenes agreeing on anything. A source listing the same tag twice counts once, or it would look like
two sources agreeing.

**The exclusion filters, and what they cannot do.** Entity-level (`f1`, `f2`) skips a whole target;
tag-level (`f3`, `f4`) refuses one tag wherever it would land. A **performer** has no "ignore auto
tag" and no custom fields, so the two performer paths are governed by the entity-level filters
alone — the settings say "tags" for that reason. Two rules carried from the sibling: the exclusion
tag is resolved against the tag list already in hand (exact, case-sensitive — Stash compiles
`EQUALS` to SQL `LIKE`, where `_` and `%` are wildcards), and **failing to resolve it stops the
run** rather than planning unfiltered, because running without it would write to the very entities
it is there to protect and nothing here removes anything afterwards. The exclusion tag is also never
copied onto anything, or whatever received it would be permanently excluded.

**Naming.** Tags are named from the one `findTags` query every run makes anyway; `custom_fields` is
requested only when that filter is set. Everything else carries its name on the traversal instead,
because fetching every performer in the library to name the handful a plan mentions would be a query
for a log line. `entityLabel` reads whichever of `files` / `visual_files` / `folder` is present
rather than switching on the target type — a per-type branch there is what let galleries and images
log as "untitled" in the sibling for three releases.

**Attribution names the source entity** (0.3.1). A line reads `- from Performer "Jane" (7)`, not
`- from Performers`. Naming the path answered "which rule fired", which the rest of the line
already implies; naming the entity answers "which performer", which is the thing the user has to
open to understand or reverse a copy by hand. It cost a name field on every traversal — `SOURCES`,
which is where the seven source types get a singular label and the fields their label reads.

Four rules it turns on:

- **`SOURCES` reuses `TARGETS` for the four types that are both.** Two field lists for one entity
  are two lists that can drift, and the fallback chain reads whichever of `title` / `name` /
  `files` / `visual_files` / `folder` is present — the same chain `entityLabel` uses, for the same
  reason it does not switch on type.
- **Only the leaf of a walk is named.** An intermediate step is passed through and never logged;
  naming it would put a join on every scene under every group for a string nobody reads.
- **One name and a count**, `Performer "Jane" (7), +2 more`. A scene with forty performers would
  otherwise put forty of them on one line, and the first in walk order is enough to start from —
  walk order being what makes it the same name on every run.
- **The count is over the sources of the path that supplied it first**, not over every path. A tag
  reaching a scene from both its studio and a performer is one addition, attributed to whichever
  path reached it; counting across paths would mean holding attribution for additions never made.

Attribution is computed once, in phase 1, and held on the plan entry. Phase 2 and Undo read it back
rather than recomputing — by then the sources are long out of scope, and a batch groups entities
that wanted the same tag for different reasons, which is why the line is built per entry and never
per batch.

A **titleless marker is named by its primary tag**, which is what Stash shows on the scene's marker
list and which every marker path already selects. Marker titles are optional and usually blank, so
this is the common case rather than a fallback.

**A failed page is logged and the pass carries on.** One bad page must not cancel a library-wide
review, and a plan that is honest about being partial beats one that is quietly short. A failed
*tag* query is different and stops the run: it answers the filters and names everything, so there is
no run without it.

## 4b. Applying, and Undo (0.3.0)

**Every write is an ADD delta, never a rewritten list.** Two reasons, and the second is the one that
matters: a delta is applied by the server against the entity as it is *now*, so a tag someone added
from another tab between the scan and the apply is not silently reverted — which a full list built
from phase-1 data would do. It also lets entities sharing an addition be written together, which is
what turns tens of thousands of mutations into a few hundred.

`buildBatches` groups by `target | kind | sorted ids` and chunks at `CHUNK_SIZE`. Grouping is per
target *and* per kind because each pair has its own mutation and its own `BulkUpdateIds` field.

**Recorded on success only.** A batch enters `undoable` after the server has accepted it, so Undo
can never try to reverse a write that never landed, and a failed batch is neither logged as written
nor counted in the applied recap. That recap is accumulated from the writes rather than from the
plan — the two differing is meaningful, not a fault.

**Phase 2 reads nothing.** It applies the plan the user approved and nothing else. Re-reading the
library here would mean writing something that was never reviewed, and it is precisely what Rescan
does instead — deliberately and on request.

**`guarded()` around the whole apply, not per batch.** Every batch is a `bulk*Update`, which is
exactly what this plugin's own auto mode will watch for at step 6, so without it a run with an auto
mode enabled would re-plan each batch it had just written. Per batch would re-open interception
between them. The lease cannot do this job: it is advisory, and we honour our own leases no more
than anyone else's.

**The lease is renewed per batch and released in every outcome** — success, failure, Stop — so a
reactive plugin is never left standing down. The expiry is the backstop for the one outcome neither
can catch: the tab going away mid-run.

### Undo

**The only code in this plugin that removes anything.** §1's "copy, never move" is written around
this exception rather than despite it.

- **A delta, not a restore.** It replays each accepted batch with `REMOVE` in place of `ADD`, taking
  back precisely what this run added and touching nothing else. Storing each entity's pre-run list
  and writing it back would be simpler and wrong: it would revert every unrelated edit made in
  between, which is the one thing an undo must not do.
- **Newest batch first.** A rescan-and-apply cycle can write to one entity twice, and taking the
  second write back before the first is the only order that lands where the run started.
- **It arms and asks**, with the count in the caption. One click here starts a library-wide write in
  the state where the user is most likely to be clicking around — Copy log, Rescan and Close are its
  neighbours. The count is what makes the prompt worth reading: it states the scope rather than
  asking a generic "are you sure".
- **Offered in `ready` as well as `done`**, because a rescan leaves the dialog holding a fresh plan
  over a library an earlier pass already changed — exactly when the user is choosing between
  applying more and taking back what is there. It always finishes in `done`: a plan reviewed against
  the library as it was no longer describes it.
- **Session-scoped.** `rescan()` carries `undoable` across the reset, like `lines`. Converging on an
  empty plan is the normal way to finish a run, and losing the ability to undo at that moment would
  be the worst possible time for it.
- **Guarded, and leased as `<task> (undo)`.** More sharply than the apply: an undo writes the
  inverse delta, so an auto mode reacting to it would put back exactly what the user just asked to
  have taken away.
- **Never gated on the version check.** It reverses writes this dialog already made, and stranding
  the user with changes they cannot take back is worse than the mismatch being guarded against.

### The log's two halves read alike

Phase 1 and phase 2 emit the same `[TAG]` / `[PERF]` lines — they describe the same changes, once as
a plan and once as a fact — and the `Applying N entity change(s) - <timestamp>` header is what
separates them. This is the siblings' convention and it caught out the first version of
`propagate-apply.test.js`, which read the whole log and thought it had seen a write. Any check about
what was *written* has to read below that header.

## 4c. The sweep: a gallery's images (0.4.0)

Eleven paths walk down fields of the target. The last two cannot: **`Gallery` has no `images`
field** — only `image_count` and `image(index)` — so the sources of `tags:image>gallery` and
`performers:image>gallery` have to be found from the other end. `reverse: { backRef: 'galleries' }`
names the field on the *source* that points at the target, and everything else about the query
comes from the source's own `TARGETS` entry, so there is no second copy of `findImages` to fall out
of step. A reverse path's `sourceType` must therefore be a target type; `propagate-paths` pins it.

**One sweep over every image, not one query per gallery.** The design sketched
`findImages(image_filter: { galleries: { value: [id], modifier: INCLUDES_ALL } }, per_page: -1)`
per gallery, by analogy with the sibling's per-performer scene query. That is worse in the two ways
that matter here: it costs a request per gallery, and `per_page: -1` against a gallery holding
twenty thousand images returns twenty thousand images in one response — the six-figure hazard the
design flagged, reintroduced by the query meant to avoid it. Sweeping pages uniformly, never builds
an unbounded response, and costs requests in proportion to the library rather than to the number of
galleries.

**The sweep runs at the start of its own pass, and both reverse paths sweep separately.** They sit
in different stages — performers in 1, tags in 3, because the tag paths read performers — so a
shared sweep would have to be taken once and reused across a stage boundary. It would halve the
requests in the one configuration where both are enabled, and it would move the correctness
argument into a comment: reuse is safe only while nothing between the two stages plans onto images,
which is true today and is not a property the path table promises. Sweeping per pass reads the plan
exactly where a walk would, so the cascade means the same thing whichever way the sources arrived.
Two passes over every image is the price, and both setting descriptions say so.

**One aggregation, two ways in.** `addSource`/`aggregate` hold what a set of sources contributes to
one target — `n`, `counts`, `order`, `first` — and a walk and a sweep both go through it. The two
were briefly separate and that is exactly the shape that drifts: the cascade, the count "common tags
only" divides by, and which source gets named would each have had two implementations.

**An image in two galleries counts for both.** It is added once per target it names, not once, or
the second gallery would silently lose it.

**A failed sweep page is logged and the pass carries on**, like a failed target page. Short rather
than wrong: every gallery it does reach is planned from every image it did read.

**The sweep gets its own progress segment**, and the pass counts as started only when it reaches its
targets — otherwise a target count of `0 / 0` sits beside a sweep that will run for a minute, which
reads as a stalled pass.

## 4d. Auto mode, target side (0.5.0)

The first thing here that writes without a Proceed button. Half of step 6: it reacts when one of the
four **targets** is saved. The source side — a save of a performer, a studio, a marker fanning out
to everything that reads it — is §4e below, one minor version later.

**`AutoRun` borrows `Run`'s planner rather than owning one.** `planEntry`, `plannedFor`,
`addSource`, `aggregate` and `planTarget` are assigned onto its prototype from `Run`'s. This is the
single most important thing in the section: a second planner would be free to drift from the one the
review dialog shows, and the *only* evidence a user has about what auto mode does is that the task
agrees with it. What differs is the driver — entities named rather than paged, no dialog, the log
going to the console.

The same argument produced two extractions:

- **`targetParts(pass)`**, shared by `passQuery` (the library walk) and `oneQuery` (auto mode's
  fetch of one entity). A field present in one copy and missing from the other is a path that
  silently plans nothing, and the same selection is what the "already has this" diff reads.
- **`resolveExclusionTagId(settings, tagMap)`**, shared by the scan and a reaction. Both let it
  throw: running unfiltered would copy onto the entities the filter exists to protect.

**`guarded()` wraps the whole reaction, and it is not decoration.** `bulkSceneUpdate` is precisely
what the branch that starts a reaction watches for, so without it every reaction would react to
itself. The cooldown would stop the recursion after one round — which is exactly why it must not be
the thing relied on: the round still costs a full pointless pass. The test asserts one
single-entity fetch per save, and a mutant that drops the guard fails it.

**The cooldown is for the *next* save, not this one.** `markWritten` / `cooledDown`, keyed
`target:id`, 8 s. It exists for the two reversible pairs: our write to a group is a group save,
which would propagate back to every scene in it, whose writes are scene saves. Union reaches a fixed
point so it terminates, but not before a burst of real writes. Three details:

- **Keyed per entity, never globally.** A save of scene 7 must not be ignored because scene 9 was
  written a second ago.
- **Marked only on success.** An entity we failed to write has not been written, and shielding it
  would silently skip the retry.
- **Swept on insert, above `AUTO_COOLDOWN_MAX`.** A timer would keep the tab awake to tidy a map
  nobody is reading.

**`mutationSucceeded` clones the response**, exactly as the sibling's does and for the same reason:
`fetch` resolves for an HTTP 500 and for a GraphQL error returned with HTTP 200. Our handler is
attached before Apollo's, so the body is unread and the clone is safe; a clone that fails assumes
success rather than dropping the reaction. Reacting to a save Stash rejected would copy tags on the
strength of an edit that never happened.

**The reverse paths use the per-target filtered query step 5 rejected** — `findImages` filtered to
one gallery — and that is not a reversal. What step 5 rejected was *a request per gallery across the
whole library*, to gather what one sweep gathers in one pass, and the hazard it actually named was
the unbounded response of `per_page: -1`. Here there is exactly one gallery, the one just saved, and
sweeping every image in the library to find its images would be absurd. `reverseQuery` pages like
everything else, so nothing is reintroduced. `reverse.backRef` doubles as the filter field name
(`Image.galleries` / `image_filter: { galleries: … }`); that is a convenience of Stash's naming and
not a rule it promises.

**Settings are cached with a TTL, and invalidated by our own `configurePlugin`.** Every mutation in
the UI reaches the fetch wrapper, and `configuration { plugins }` cannot be scoped to one plugin, so
reading them per mutation would put a full settings query behind every save. One in-flight load is
shared, so two quick saves are one load.

**`autoSuppressed()` is called after the mutation matches, not before**, so the one-time "standing
down" console line is only emitted for a save that would actually have been reacted to. Same shape
as the sibling's.

**`targetOfMutation` needs both regexes.** `/\bsceneUpdate\b/` does not match `bulkSceneUpdate` —
the capital S breaks the word boundary — and the two read their ids from different places
(`input.id` against `input.ids`).

**A reaction's failure is never rethrown into Stash's fetch chain.** The user's save succeeded; a
failed reaction to it must not look like a failed save.

## 4e. Auto mode, source side (0.6.0)

The other half of step 6: a save of a **Performer, Studio, SceneMarker**, or of a Scene, Gallery,
Image or Group acting as a *source* rather than a target, fans out to every target an enabled path
would have copied it onto. Enabling this on a popular performer's tag is genuinely expensive — the
setting's own description says so — but the mechanism reuses everything §4d built rather than
carrying a second write path.

**Once the affected target ids are known, a source reaction *is* a target reaction.**
`runAutoTargets(target, ids, settings, label)` is what §4d's `reactToTargets` was split into: the
cooldown, `guarded()`, the lease, `AutoRun`'s planner, all of it, called identically by both modes.
The only thing this section adds is finding those ids — `resolveSourceTargets` — and a wider
mutation matcher, `sourceOfMutation`, that recognises every entity type a `PATHS` entry ever reads
from rather than only the four it ever writes to.

**Two shapes of lookup, one per path, in `SOURCE_REVERSE`:**

- **`kind: 'field'`** — most paths have a plain field on the source pointing back at what refers to
  it: `Image.galleries`, `Gallery.scenes`, `Scene.groups`, `Group.scenes`, `Group.containing_groups`,
  `SceneMarker.scene`. One query per saved entity, no filter guessing. `tags:marker>group` and
  `performers:marker>group`'s tag counterpart chain two of these in **one** query rather than two
  round trips — `scene { groups { group { id } } }` off a single `findSceneMarker` — because a
  marker names exactly one scene, so there is nothing to page between the hops.
- **`kind: 'filter'`** — three paths have no back-reference to walk: a Performer and a Studio carry
  no field naming the Scenes or Groups that use them, and a Gallery has no `images` field, the same
  reason the sweep exists (§4c). These go through a filter on the *target's* own filter type —
  `scene_filter: { performers: { value: [$id], modifier: INCLUDES } }` — which is exactly the shape
  `reverseQuery` already trusts Stash to have for `Image.galleries`, generalised, and no more
  verified against a running instance than that was until 0.4.0. `tags:performer>group` reuses the
  same `performers` filter as `tags:performer>scene` but asks for `groups { group { id } }` in the
  same response, so the second hop costs nothing extra either.

**Every one of the thirteen has an entry, and `propagate-auto-source.test.js` pins that a `PATHS`
entry without one fails loudly** rather than silently doing nothing — the same shape of guarantee
`propagate-paths.test.js` gives the settings table.

**Filter-kind lookups page, field-kind lookups do not need to.** A performer with a six-figure scene
count is exactly the unbounded-response hazard §4c already named; a marker's single `scene` field or
a gallery's `scenes` list is not paginated in Stash's own schema, so there is nothing to page.

**Sequential per source id, not one combined query, even for a bulk save.** Every other reverse
lookup in this plugin already works this way — `AutoRun.reverseSources` fetches one target's sources
at a time — and a bulk save of *sources* is the uncommon case here, not the one worth a second query
shape for. The affected target ids are deduplicated across every source id before `runAutoTargets`
sees them, so two performers naming the same scene refresh it once, not twice.

**One save can be both a target and a source, and both reactions run.** A Scene is a target of its
own paths and, via `tags:scene>group`, a source for its group's. `targetOfMutation` and
`sourceOfMutation` are checked independently in the fetch wrapper off the same mutation, each gated
on its own setting (`a3` / `a4`) and its own cooldown check, because they write to different
entities and answer different questions — "refresh this" against "propagate this outward."

**A source reaction resolves ids with plain reads, never mutations**, so nothing here needs
`guarded()` of its own — only `runAutoTargets`'s write does, exactly as it did for the target side.
The resolution queries do not match `targetOfMutation` or `sourceOfMutation` at all, being `find*`
reads rather than `*Update` mutations, so there is no risk of a lookup being mistaken for a save
worth reacting to.

## 5. The dialog (0.1.0)

Ported from both siblings and deliberately identical to them: same head with a backup warning and an
id legend, same monospace log with a rendered tail, same footer, same `scanning|ready|applying|
undoing|done` state machine. The overlapping CSS is byte-identical across all three and
`tests/style.test.js` fails on any drift — see the repo-root CLAUDE.md.

**Before the planner runs it reviews the configuration.** Worth keeping separate from §4a, because
it is what tells the user whether the plan they are about to read was computed from the settings
they meant:

- names the enabled paths **in pipeline order**, because that order decides what one run reaches
- warns when both halves of a reversible pair are on
- names every exclusion filter in force, and says so explicitly when none is
- warns about another plugin's lease, without standing down
- notes another relationship-copying plugin declaring one of the same paths (§5a)
- warns about NormalizeParentTags' Prune/Roll Up modes, where they collide with an addition (§5a)
- compares the running script against the installed manifest

**The version gate is the only warning here that blocks.** Every other one — the lease, the pair, a
sibling's auto mode — is about the library or another plugin, where the user knows more than the
dialog does. This one is about the dialog running code the user has already replaced, which is the
one thing they cannot see. Three things keep it from being obstructive: unknown is never a mismatch
(a Stash too old for the field, a plugin it cannot see, a failed request all resolve to `null`); the
two quiet outcomes go to the console rather than the log; and **Undo is never gated on it**, because
stranding the user with changes they cannot take back is worse than the mismatch.

**Two counters, deliberately.** `lines` is the export buffer and survives a Rescan, because Copy log
hands over the whole session. `viewLines` counts what has gone into the log since the current pass
emptied the view, and is what the progress line describes — reporting `lines` there produced, in the
sibling, a header claiming 28 161 lines over a log holding four.

## 5a. Two other plugins, two different kinds of collision (0.7.0)

Step 7 of the design plan. Both checks run from `begin()`, right after the reversible-pair warning,
and both are informational log lines rather than head warnings — neither collision is a hazard the
version gate's "you cannot see this" sense is. Full design reasoning is in "Cross-plugin
cooperation: the `declares` registry" in the repo-root CLAUDE.md; this section is the map of the
code that implements it.

**`checkDeclaredOverlap` — the same path, run by someone else.** `MergePerformerTagsToScenes`
implements exactly one of this plugin's thirteen paths (`tags:performer>scene`) and declares it
unconditionally at its own load, into `coop().declares[MergePerformerTagsToScenes]`. This plugin
does the reverse: on every settings load — the task's own and auto mode's `autoSettings` refresh
alike, via the shared `publishDeclares(settings)` — it republishes its *currently enabled* path ids
into `coop().declares[PLUGIN_ID]`, because a path whose setting is off is not one it is actually
covering. `checkDeclaredOverlap(paths)` then scans the registry for any other plugin id whose array
names one of `paths`, and logs one line per other plugin naming every overlapping path label. This
is deliberately generic on both sides: nothing here names `MergePerformerTagsToScenes`, so a second
relationship-copying plugin needs no edit to either.

**`checkHierarchySibling` — a different kind of collision, and not part of `declares`.** Ported
from `MergePerformerTagsToScenes`' own `checkSibling`, reading `NormalizeParentTags`' raw settings
(`a8AutoPruneOnUpdate` / `a9AutoRollUpOnUpdate`) out of the same `{ configuration { plugins } }`
response `loadSettings()` already fetches — `loaded.all[NPT_ID]`, no second query. Unlike the
overlap above, this is not "the same path": Prune can remove any tag this run adds regardless of
which of the eleven tag paths added it, and Roll Up piles ancestors on top of it the same way. That
is a category-level interaction (a hierarchy-rewriter versus any additive tag-writer), which has no
path id on either side for a generic registry scan to match — hence a name-based check reading a
named sibling's actual settings, exactly like the one it was ported from. `NPT_ID`/`NPT_NAME` are
this plugin's only hardcoded reference to another plugin, for exactly this reason.

Both halves of NPT's own no-op are handled the same way as the sibling's version: prune and roll-up
both on cancels out to nothing worth warning about, and "registered as a lease respecter" is
reported rather than warned about, since a respecting NPT will stand down while this task writes.

**Why one plugin gets a generic mechanism and the other gets a ported bespoke one, in the same
version.** They are answers to two different questions that happen to have arrived in the same
step: "is another plugin doing what I am doing" generalises cleanly across an open-ended set of
future plugins and needs no name; "does a hierarchy rewrite undo what I just added" is inherently
about one specific *kind* of plugin NPT is the only example of here, and forcing it into the path-id
vocabulary would need a second, richer vocabulary (categories, not paths, plus a collision matrix)
that nothing here needs yet.

## 5b. Manual buttons and staging (0.8.0, best-effort; fixed at 0.8.1)

D8 of the design plan, built without a running Stash to check the DOM against — the plan's own
caveat, carried forward rather than resolved. One button per enabled path whose target is the page
being viewed: `path.button` is already the label (set at 0.0.1), so nothing here invents a second
copy of the thirteen strings.

**No second planner.** `AutoRun` already plans a *named* set of ids without paging the library —
exactly what one entity is — so a click reuses it verbatim: `autoSettings()` for the cached
settings, `autoContext(s)` for the tag hierarchy and filters, `new AutoRun(s, ...)`,
`run.planEntities(target, paths, [id])`. The only new code is where the result goes.

**Two destinations, one `s.a2SaveImmediately` switch away from each other.**
"Save immediately" calls `run.apply(label)` unchanged — the exact function auto mode's target-side
reaction calls. Staging (the default) reads `run.plan` instead and pushes each entry's `add` ids
into a captured form control. Names for staged items come free: `run.tagMap` (built for the
exclusion filters anyway) for tags, `run.performerNames` (built by `AutoRun`'s own `addSource` while
walking any performers-kind path) for performers. Staging costs no query beyond what planning
already made.

**Capturing the form controls generalises MergePerformerTagsToScenes' one `TagSelect` capture to
two components, keyed by route instead of by scene id.** `installSelectPatches()` patches both
`TagSelect` and `PerformerSelect` through `PluginApi.patch.before`, and `captureSelect` records
`(target, id)` from `currentRouteTarget()` — the same `TARGETS[key].route` regex every other part of
this plugin already uses, so there is no second copy of the four route patterns. `findControl`
carries over the sibling's exact reasoning: newest capture first, preferring one whose `values`
match what this plugin last staged, because matching the *server's* tags would keep re-selecting
the pre-staging capture and report the same count on every click.

**The diff is against the form, not the server**, for the same reason as the sibling: a tag the
user added or removed by hand survives, and a second click without saving reports "No changes"
rather than restaging what is already there. `stageEntry` is the one function both kinds
(`_tagCaptures`/`_stagedTags` and `_perfCaptures`/`_stagedPerfs`) go through, parameterised by which
pair to read and write — two captures and two "expected" trackers because a scene page can stage
tags *and* performers in the same click, and they are different controls.

**A button that finds no control throws, which surfaces as an alert naming "open the Edit tab
first."** This is deliberately not swallowed into "No changes" - the two are different facts (the
run added nothing, versus the run could not tell what was already there) and conflating them would
hide a genuine placement failure behind the same caption a normal no-op shows.

**Reconciliation, not tracking.** `manualButtonsTick()` rebuilds its opinion of which buttons should
exist from `enabledPaths(s)` and the route on every tick, the same philosophy as `ensureReadmeLink`
and `settingsTick` elsewhere in this file: React can tear down and rebuild `.edit-buttons` on a
re-render, so there is nothing durable to track. A button is kept when both its path is still
enabled and its `_ptp2reEntityId` matches the current route; anything else is removed. **Only one of
the two removal paths does the entity-id check** — a button for a path that is still enabled but the
wrong entity is caught by the *per-path* loop (`existing._ptp2reEntityId === rt.id` failing before a
replacement is appended), so the reconciliation loop above it only has to ask "is this path still
wanted at all." A mutation test confirmed the second check in that loop was dead: removing it changed
nothing, because the per-path loop already covers the case.

**A `MutationObserver`, unlike the settings page's tick.** `ensureReadmeLink`'s comment explaining
why it has none does not apply here: a button has to land before the user can click it, and Stash's
edit forms re-render on every keystroke, so polling alone would leave it flickering. `startEntityObserver`
is `MergePerformerTagsToScenes`' own `startObserver`, ported rather than shared — the two plugins
carry no module between them — watching `#root` (falling back to `document.body`) and coalescing a
burst of mutations into one tick via a 100ms `setTimeout`, exactly like the sibling's.

**What is genuinely unverified**, beyond `.edit-buttons` itself (§5's own caveat): the shape of a
`PerformerSelect` item — only `id` is used to build the diff-against-form `have` map, but `onSelect`
is handed `{ id, name }` for a staged item, and whether Stash's control needs more than that to
render a chip has never been checked against a running instance. The equivalent question for
`TagSelect` items (`aliases`, `image_path`) is answered by the sibling's own working code, which
this plugin's staged item deliberately mirrors (`{ id, name, aliases: [], image_path: null }`) —
empty rather than omitted, on the chance the control's renderer expects the keys to exist even
when there is nothing in them.

## 6. Anchoring in Stash's markup

Every foothold here is a guess until it runs against a real Stash, and a test written from the same
guess confirms nothing. Both siblings shipped broken twice on heading text; the rules that came out
of it apply unchanged:

- **Find our settings group by the `plugin-<id>-<key>` element ids**, never by heading text.
  `SettingsPluginsPanel.tsx` builds them from the plugin id and the setting key, so they are ours by
  construction. `ownSettingGroup()` tries every key in `DEFAULTS` rather than two named ones, so
  removing a setting cannot quietly break the anchor.
- **`headingIsOurs` strips the version suffix and compares exactly.** Settings → Tasks passes the
  name through; Settings → Plugins appends `(0.1.0)`, and interpolates the literal `undefined` when
  a plugin has no version. A prefix test would match a plugin whose name merely starts with ours.
- **Everything injected is re-added, not tracked.** React re-renders the panel on every settings
  change and drops it; the tick puts it back, and an id keeps that from producing a second one.
- **No MutationObserver on the settings page.** This is decoration, not something that must land
  before the user can click it, so the timer plus the navigation hooks are enough and cannot fight a
  re-render.

## 7. Testing

`node tests/run.js`. Seven suites touch this plugin so far:

- **`propagate-paths.test.js`** — the tables, and the invariants the order carries. See
  `tests/README.md`.
- **`propagate-base.test.js`** — both layers of task interception, the dialog head, the
  configuration review, the version gate, the lease warning, the footer, and the settings-page
  injection. Since 0.7.0 also §5a: publishing enabled paths into `coop().declares` (including an
  empty list with nothing enabled), another plugin declaring an overlapping path noted in the log
  and a non-overlapping one staying silent, and the NormalizeParentTags check's four outcomes
  (registered, unregistered, both modes cancelling out, not installed) ported from the sibling's own
  suite.
- **`propagate-plan.test.js`** — the walk over the library: the gather, the diff, both aggregation
  modes and their edges, the cascade, every exclusion filter, pass ordering, naming, the recap, and
  that a review issues no mutation at all.
- **`propagate-sweep.test.js`** — the two reverse paths and the sweep that gathers them: what it
  costs, that an image in two galleries reaches both, that it pages and accumulates, that every
  source is gathered before any target is read, a partial sweep after a failed page, and the
  progress line read *during* the sweep rather than after it.
- **`propagate-apply.test.js`** — phase 2 and Undo: delta writes, batching, failed batches isolated,
  Stop, Rescan, the leases, the arm/confirm latch, and that phase 2 reads nothing. It takes about
  nine seconds, four of which are spent waiting out `UNDO_ARM_MS` to prove an expired arm does not
  write. That wait is the check; do not shorten it by reaching into the constant.
- **`propagate-auto.test.js`** — auto mode, target side (§4d): it reacts and writes an ADD delta;
  restraint around the mode being off, no matching path, a rejected save, a deleted entity; that the
  reaction never reacts to its own write; the per-entity cooldown, keyed and marked correctly; the
  lease, honoured and released; bulk saves; the settings cache and its TTL; the exclusion filters;
  and a reverse path reacting without sweeping the library.
- **`propagate-auto-source.test.js`** — auto mode, source side (§4e): both lookup kinds, including a
  two-hop `field` and a two-hop `filter`; that every `PATHS` entry has a `SOURCE_REVERSE` entry; the
  same restraint suite as the target side, reused rather than re-derived because `runAutoTargets` is
  the same code; a bulk save deduplicating across sources; and that a save which is both a target and
  a source runs both reactions.
- **`propagate-buttons.test.js`** — manual buttons and staging (§5b): a button per enabled path
  labelled from `path.button`; restraint (the master toggle off, no path enabled, a path into
  another target, off any of the four pages, no `.edit-buttons` found); multiple enabled paths
  producing multiple buttons; staging pushing into a captured `TagSelect`, diffed against the form
  so a second click reports no changes; save-immediately issuing a bulk `ADD` delta instead; a
  missing captured control surfacing as an alert rather than a silent no-op; reconciliation not
  duplicating a button on an idle tick and replacing a stale one after navigating to a different
  entity; and the route matcher against all four page shapes plus an unrelated route. Since 0.8.1,
  a dedicated `nodeListLikeContainer` reproduces a real `NodeList`'s missing `Array.prototype`
  methods to pin the `.slice()` bug a live Stash actually found - the shared harness's own container
  cannot, since its `childNodes` is a genuine array.
- **`style.test.js`** — the CSS this plugin shares with its two siblings.

**Every check here was confirmed against a deliberately broken copy before being trusted.**
Sixty-four mutants so far, each failing exactly the check written for it — a suite that passes for the wrong
reason is worse than no suite. Use `SRC=/path/to/mutant.js node tests/propagate-base.test.js`.

What they cannot cover: Stash's own behaviour. The suites reproduce its markup and its schema from
notes, so they prove the plugin does the right thing with what it is given, not that Stash still
gives it that. Anything touching §6 needs a click in a real instance before it is believed.
