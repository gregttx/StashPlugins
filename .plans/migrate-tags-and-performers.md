# Plan: `PropagateTagsAndPerformers`

*Propagate Tags and Performers to Related Entities* — short prefix `ptp2re`. See D6.

**Status: BUILDING — steps 1-5 done and step 6 half done, the plugin is at 0.5.0** (last checked 2026-08-07).
All eight decisions are settled (§4) and every open question is closed (§6). The library-wide task
is complete for **all thirteen paths**: it reviews, applies on Proceed and reverses on Undo, and a
save of any target now triggers a reaction. Remaining: the **source** half of step 6, then the
`declares` registry, manual buttons + staging, and the repo `CLAUDE.md` section. See §8.

Where it stands, in numbers:

| | |
|---|---|
| Version | 0.5.0, in all three places |
| `PropagateTagsAndPerformers.js` | ~2,750 lines |
| Settings shipped | 25 (13 paths + 2 modes + 10 parity/filters) |
| Test suites | 6 of the plugin's own, 19 in the repo, all passing |
| Checks in the six | paths 60, base 64, plan 50, apply 43, sweep 30, auto 38 = **285** |
| Mutants confirmed | 6 + 10 + 13 + 14 + 9 + 12 + 12 = **76** |
| Landed on `main` | through 0.4.0 (`4c5bc96`); 0.5.0 is on `feat/propagate-auto` |

**Nothing here has been exercised against a running Stash.** Every foothold in Stash's markup and
schema is reproduced from notes. That is the standing caveat on the whole plan, and step 8's
placement work cannot even begin without an instance.

The design below is the *original* reasoning and is left as written, so that where implementation
disagreed with it the disagreement stays visible. Four such corrections are marked **SUPERSEDED**
in place: §2 and §5's per-gallery reverse query (step 5 replaced it with a sweep), §5's pipeline
order (stage 1 was wrong), and §4 D3's guess that staging would not generalise (D8 reversed it).
Where this file and the plugin's own `CLAUDE.md` differ, the plugin's is current — it documents
what the code does, this documents why it was asked for.

Lives at `.plans/migrate-tags-and-performers.md`, which is git-excluded via `.gitignore`.

---

## 1. Context

The user wants a new Stash plugin, inspired by `MergePerformerTagsToScenes` (MPTTS), that copies
**tags** and **performers** from related entities onto a target entity — generalising what MPTTS
does for one path (a scene's performers' tags → the scene) across the whole Stash relationship
graph. It should carry over MPTTS's actions and triggers: manual buttons, auto-on-update, a
library-wide task, the two-phase review dialog with Undo, exclusion filters, and the cross-plugin
lease protocol.

Alongside the build, the user asked three design questions (answered in §4) and asked that the
thinking be recorded in a new **TODO / IDEAS** section of the repo `CLAUDE.md` (draft in §7).

Terminology note carried through: this is a **copy**, not a move. Nothing is removed from the
source. "Migrate" in the request is read as "propagate". This matches MPTTS §1 ("merging only ever
adds tags"), and the alternative is plainly wrong — stripping tags off a performer because they
were copied to a scene would destroy the source data. The name confirms it: D6 chose
`PropagateTagsAndPerformers`, and this file keeps its `migrate-` filename only because renaming it
would break nothing and gain nothing.

---

## 2. Verified schema findings (the load-bearing research)

Fetched from `stashapp/stash` `graphql/schema/types/*.graphql` on the `develop` branch, 2026-08-06.
Per the repo `CLAUDE.md` convention, this is a snapshot — re-verify against the running Stash
before relying on it.

### Fields that decide which paths can exist

| Type | has `tags` | has `performers` | relationship fields |
|---|---|---|---|
| Scene | yes | **yes** | `scene_markers`, `galleries`, `groups: [SceneGroup!]!`, `studio`, `performers` |
| Gallery | yes | **yes** | `scenes`, `studio`, `chapters`, **no `images` field** (`image_count` + `image(index)` only) |
| Image | yes | **yes** | `galleries`, `studio` |
| Group | yes | **NO** | `studio`, `containing_groups`, `sub_groups`, `scenes` |
| Studio | yes | **NO** | `parent_studio`, `child_studios`, `groups` |
| SceneMarker | yes + `primary_tag` | **NO** | `scene` |
| Performer | yes | n/a | (no `studio` field) |

The one structural rule to carry forward: **`Studio`, `SceneMarker` and `Group` have no
`performers` field**, so performers can only ever move between Scenes, Galleries and Images.
Groups are tag-only sinks.

### Bulk mutation inputs (all confirmed present)

- `BulkSceneUpdateInput` — `tag_ids`, `performer_ids`, `gallery_ids`, `group_ids`
  (all `BulkUpdateIds`).
- `BulkGalleryUpdateInput` — `tag_ids`, `performer_ids`, `scene_ids`.
- `BulkImageUpdateInput` — `tag_ids`, `performer_ids`, `gallery_ids`.
- `BulkGroupUpdateInput` — `tag_ids`, `containing_groups` / `sub_groups`
  (`BulkUpdateGroupDescriptionsInput`).
- `BulkStudioUpdateInput` — `tag_ids` present. (Consistent with the repo `CLAUDE.md` custom-fields
  table, which only says this input lacks `custom_fields`.)
- `BulkSceneMarkerUpdateInput` — exists (`ids`, `title`, `primary_tag_id`, `tag_ids`), not needed:
  markers are only ever a **source** here.

So every write this plugin needs is a single `ADD`-mode bulk mutation — the same delta-write shape
`NormalizeParentTags` (NPT) already uses in `applyBatch`, never a whole-list rewrite.

### Two query shapes worth noting up front

- **Gallery → its images** has no field to traverse. ~~Must go through
  `findImages(image_filter: { galleries: { value: [id], modifier: INCLUDES_ALL } }, filter: { per_page: -1 })`
  — structurally identical to MPTTS's existing per-performer scene query
  (`MergePerformerTagsToScenes.js:598`). Reuse that shape.~~

  **SUPERSEDED at step 5 (0.4.0).** That shape costs one request per gallery and, with
  `per_page: -1`, returns a twenty-thousand-image gallery in a single response — the exact
  six-figure hazard §5 warns about, reintroduced by the query written to avoid it. What ships is a
  **sweep**: one paged pass over *every* image (`sort: "id"`, fixed `per_page`), bucketed by the
  galleries each image names in `Image.galleries`. Requests scale with the library, not with the
  gallery count, and no page is unbounded. `Image.galleries` is load-bearing for both #4 and #13
  and has never been seen returning real data.
- **Group → performers/markers** is a **two-hop** traversal (`Group.scenes` → `performers`/
  `scene_markers`). Must be labelled as such in the UI so the user understands the cost and the
  indirection. *(Landed at 0.2.0, and cheaper than feared: GraphQL nests, so a second hop is a
  longer `walk` in one query, not a second request.)*

---

## 3. What the existing plugins give us (exploration results)

| | `MergePerformerTagsToScenes` | `NormalizeParentTags` |
|---|---|---|
| JS | 2,452 lines | 3,117 lines |
| Settings | 9 | 16 |
| Tasks | 1 | 3 |

**Reusable patterns, all of which this plugin needs a copy of** (the repo has no shared module and
no build step — a plugin folder is copied as-is, so every helper is duplicated by design):

- `coop()` / `acquireLease()` / suppression check / `guarded()` re-entrancy **counter**
  — MPTTS `:83`–`:165`, NPT `:129`–`:188`.
- `gqlRequest` — MPTTS `:194`. Calls the *wrapped* `window.fetch`, which is why `guarded()` exists.
- `loadSettings` via `{ configuration { plugins } }` — MPTTS `:677`. Returns **every** plugin's
  settings in one response, which is how sibling-detection works for free.
- The whole review dialog: `TaskRun` (MPTTS `:957`+) / `Run` (NPT `:1074`–`:1704`) — same head,
  legend, monospace log with render cap, Proceed/Stop/Copy/Rescan/Undo/Close footer, same state
  machine (`scanning|ready|applying|undoing|done`).
- `buildBatches` (NPT `:790`) — group entities by identical delta, chunk at 100.
- Undo as an **inverse delta**, never a restore — NPT `undoBatch` `:866`, MPTTS `:1576`.
- Task interception, both layers: capture-phase click (`ownTaskName`, MPTTS `:1792`) + the
  `runPluginTask` backstop at the very top of the fetch wrapper (MPTTS `:1861`).
- Settings-page injection: `ownSettingGroup` (by element id, never heading text) `:2319`,
  `splitDescription` `:2348`, `ensureReadmeLink` `:2366`.
- **NPT's per-entity cooldown** (`cooledDown` `:2527`, `markWritten` `:2532`, `AUTO_COOLDOWN_MS`
  8 s) — MPTTS has no equivalent. **Required**, now that two bidirectional pairs ship (D5).

**Constraints inherited from the repo `CLAUDE.md`:**

- Overlapping dialog CSS must stay **byte-identical** across plugins; `tests/style.test.js` parses
  the CSS strings, strips the plugin prefix and fails on any shared selector that differs. A third
  plugin must be added to that suite. Modal background is pinned to `#202b33`, never `#30404d`.
- Version lives in **three** places (`PLUGIN_VERSION`, the `.yml`, the `manifest`);
  `tests/version.test.js` enforces agreement, plus `url:` == `README_URL`, description identical in
  yml and manifest, double-quoted, paragraphed with `\n\n`, and `/blob/main/` never a pinned SHA.
- Setting keys double as storage keys — renaming one resets it for every user.
- Take a lease for **every** bulk run, including Undo (labelled `<task> (undo)`); register as a
  respecter at load; warn about someone else's lease but **never stand down for it**; manual
  actions are never suppressed.
- Every surface must tell the user to back up before the first run; Undo must never be presented as
  making a backup unnecessary.

---

## 4. Decisions made

### D1 — Performer paths ✅ *(user chose)*

`Performers from Studios → Scenes` and `Performers from Markers → Scenes` are not buildable
(see the field table in §2). `Galleries → Scenes` ships in their place
(`Scene.galleries.performers`). `Scenes → Galleries` for performers was offered and **not** taken.

### D2 — Union/intersection: the two aggregations into Groups ✅ *(user chose)*

Two paths get the choice, both of them multi-source aggregations whose target is a Group:

- `Scenes → Groups` (tags) — union of every scene's tags, or only tags common to all of them
- `Sub-groups → Containing Groups` (tags) — same, over sub-groups

Every other path is hard-coded UNION. Two separate settings, not one shared "group aggregation
mode" — a library where every scene in a group should agree is not necessarily one where every
sub-group should.

Edge cases to pin in tests, for both: one source ⇒ intersection == that source's tags; zero
sources ⇒ nothing added, either mode.

The distinction still generalises to every multi-source path (a scene's performers, a scene's
markers, a gallery's images) and could be promoted later. Single-source paths (Studio → Scene)
collapse to the same result either way, so a later generalisation needs no special-casing.

### D3 — Relationship to MPTTS: coexist *and* absorb its functionality ✅ *(user chose)*

> "Keep coexisting with MPTTS, but also absorb MPTTS functionality."
> "…also coexist nicely with existing and future plugins."

Reading, since confirmed and being built to:

- The new plugin reaches **feature parity** with MPTTS — it implements `Performers → Scenes` tags
  itself, plus MPTTS's manual buttons, its staging-vs-immediate-save behaviour, its auto-on-update
  triggers and its library-wide task — so it stands alone and MPTTS becomes redundant *in function*.
- MPTTS is **not** deleted, not absorbed as a folder, and does not lose its plugin id. Both remain
  installable and both keep working if both are enabled.
- Overlap is therefore expected at runtime and must be **detected and announced**, not prevented.
  Both plugins only ever ADD tags, so double-coverage is redundant work and doubled log noise, never
  wrong data.
- The hardcoded two-way `checkSibling` (MPTTS `:1275`, NPT `:1418`) should generalise to an
  **N-way declaration registry** so this works for future plugins too:

  ```js
  window.StashPluginCoop = {
    leases:     [],   // [{owner, label, until}]   — existing
    respecters: {},   // {pluginId: true}          — existing
    declares:   {},   // {pluginId: ["tags:performer>scene", ...]}  — NEW
  };
  ```

  At scan time, for each of my enabled paths: if another plugin declares the same path **and** its
  reactive mode is on, warn in the dialog head. A future plugin gets the warning for free without
  editing any existing plugin. Backwards compatible — `declares` simply absent for old plugins,
  handled like `respecters` already handles "too old to know".

~~**Open sub-question for resume:** absorbing MPTTS's *staging* (writing into the open scene edit
form via `PluginApi.patch.before('TagSelect')`, MPTTS §4) is the one feature that does not
generalise cleanly — it is specific to the scene edit page's tag control.~~ **SUPERSEDED — see D8.**
The premise was false: `TagSelect` is used across every edit panel and `PerformerSelect` is equally
patchable. Staging generalises to all four target pages.

**Status of the registry itself: not built.** `declares` is step 7, and it is the one remaining
step that edits the two *sibling* plugins as well as this one.

### D4 — Not unifying with NormalizeParentTags ✅ *(recommendation, user did not object)*

The user asked whether to fold NPT in and build one unified Tag Manager. **Recommendation: no.**

- NPT walks the **tag hierarchy** (tag → parent tag); this plugin walks **entity relationships**
  (scene → performer). Different graphs, different algorithms — NPT computes an ancestor closure and
  an antichain, this computes a relational gather. They compose but do not overlap.
- 3,117 + 2,452 + ~2,500 lines in one ES5 IIFE with no build step is unreviewable.
- Plugin id == folder name == settings storage namespace. Merging means every existing user loses
  every setting and must reinstall.
- The lease protocol exists *because* they are separate; merging two of three does not remove the
  need for it.

The right unification is the **cooperation layer** (D3's `declares` registry), not the code.

### D5 — Scope of v1 ✅ *(user chose)*

- **Two reverses ship:** tags `Groups → Scenes` and tags `Galleries → Images`.
- **Two reverses rejected:** tags `Galleries → Scenes` and tags `Scenes → Galleries` — the
  scene↔gallery link is not to be used for tags in either direction. It still carries *performers*
  (#12).
- **`Child Studios → Parent Studio` rejected** — sibling studios under a shared parent are
  typically unrelated, so rolling their tags upward merges unrelated things.

**Consequence — the two accepted reverses are exactly the two that close a cycle**, and both need
handling (see §5 "Bidirectional pairs").

### D6 — Naming ✅ *(user chose)*

| | value |
|---|---|
| folder / plugin id | `PropagateTagsAndPerformers` |
| yml `name:` (display) | `Propagate Tags and Performers to Related Entities` |
| short prefix | `ptp2re` |

The id is deliberately shorter than the display name: it is also the **settings storage
namespace**, so renaming it later resets every user's settings, and it threads through every
setting element id (`plugin-<id>-a1…`).

"Propagate", not "Merge" — Stash already uses *merge* for combining two entities into one (the
performer and tag merge dialogs), so reusing it for an additive copy collides with an existing UI
concept. Not "Migrate" either: nothing is ever removed from a source.

**The short prefix must stay CSS-safe.** The user's first choice, `pt&p2re`, cannot be used: the
prefix is not only a console tag but the CSS class prefix, element-id prefix, button-class prefix
and sessionStorage-key prefix — `.cpt2s-modal`, `cpt2s-task-style`, `cpt2s-merge-to-scenes-btn`,
`cpt2s_goto_edit`. `&` is not a valid CSS identifier character, so `.pt&p2re-modal` fails to parse
and the browser drops the rule **silently**, leaving an unstyled dialog and no error.
`tests/style.test.js` also strips this prefix by regex to compare shared chrome across plugins.

Following MPTTS §8, there are two log prefixes: `[Propagate Tags and Performers to Related
Entities]` on user-facing lines, `[ptp2re]` on diagnostics.

### D7 — Settings model: per-path booleans ✅ *(user chose)*

13 path toggles + 2 union/intersection modes + ~10 MPTTS-parity settings ≈ 25, prefix-ordered and
grouped by target. Settings are the single source of truth for tasks, buttons and auto mode alike.
A phase-0 checkbox matrix in the task dialog narrows scope for one run and never writes back.

### D8 — Staging generalises to every target page ✅ *(user chose)*

**An earlier claim in this plan was wrong and is corrected here.** Staging is *not* specific to the
scene edit form. `TagSelect` is a component Stash uses across all its edit panels — the MPTTS
source says so at `:492` ("TagSelect is used all over Stash") — and **`PerformerSelect` is equally
patchable**. Both are in Stash's registered component list (`ui/v2.5/src/docs/en/Manual/
UIPluginApi.md`), along with `StudioSelect`, `GroupSelect`, `GallerySelect`. MPTTS keys its
captures on `sceneId` because scenes are all it needs, not because of any limitation.

Calling `props.onSelect(items)` runs whatever handler that panel installed, so the plugin never
needs to know whether a given edit panel uses `useTagsEdit` or writes formik directly — it does
exactly what a user picking from the dropdown does. That is what makes this portable.

**Manual buttons, one per enabled path, on the target's edit page:**

| Page (target) | Buttons | Paths |
|---|---|---|
| Scene | Tags from Performers / Studio / Markers / Groups; Performers from Galleries | #1 #2 #3 #10 #12 |
| Gallery | Tags from Images; Performers from Images | #4 #13 |
| Group | Tags from Scenes / Studio / Performers (via scenes) / Markers (via scenes) / Sub-groups | #5 #6 #7 #8 #9 |
| Image | Tags from Galleries | #11 |

**No performer button on the Group page** — `Group` has no `performers` field. Groups are tag-only
sinks; #7 exists precisely because performers' *tags* must route through the group's scenes.

Buttons are gated on their path's own setting under one master `ShowManualButtons` toggle, so a
user who enabled two scene paths sees two buttons rather than five.

Implementation deltas from MPTTS:

- Captures keyed `(entityType, entityId)` from the route, not `sceneId`.
  `findSceneTagControl(expectedIds)` becomes `findControl(kind, type, id, expectedIds)`; the
  newest-first + prefer-matching-`expectedIds` logic carries over unchanged, and is what makes a
  second click see the already-staged list rather than re-reporting the same count.
- **Two capture rings**, one per patched component. The `props.isMulti` filter applies to both.
- `props.values` item shape for `PerformerSelect` must be checked in a live Stash; only `id` is
  strictly needed.
- **Placement per page cannot be settled from here.** MPTTS needed `insertBeforeDelete` plus a
  two-container filter for the scene page alone; the Gallery and Group panels need the same
  treatment worked out against a running instance. Per the repo `CLAUDE.md`, tests pin these
  assumptions but cannot confirm they survive a Stash upgrade.

---

## 5. Design sketch

### Path model

One table drives everything, in the spirit of NPT's `TYPES` (`NormalizeParentTags.js:86`), whose
**array order is the processing order** and must never be derived from settings key order.

```js
// { id, kind, source, target, setting, hops, query, bulk, bulkField }
{ id: 'tags:performer>scene', kind: 'tags', source: 'performers', target: 'scene',
  setting: 'a1TagsPerformersToScenes', hops: 1,
  bulk: 'bulkSceneUpdate', bulkInput: 'BulkSceneUpdateInput', bulkField: 'tag_ids' }
```

Every path is expressed **target-centric**: iterate targets, one query per target (or per page of
targets) gathering its sources. This matches MPTTS's existing loop shape and keeps the plan keyed
by the entity being written — MPTTS §7a records that keying its plan by scene rather than performer
is "the one thing that would silently lose data if rearranged". Same rule applies here.

### Pipeline order (a real design issue, not a detail)

Paths cascade. Running `markers → scenes` before `scenes → groups` means the group transitively
inherits marker tags; the reverse order does not. Sources must be read **fresh** at each stage. Fix
a documented order and state it in the dialog:

1. the **performer assignments** — `images → galleries` (#13), `galleries → scenes` (#12)
2. tags onto scenes: `markers → scenes`, `performers → scenes`, `studio → scenes`  (#3, #1, #2)
3. tags onto galleries: `images → galleries`  (#4)
4. `scenes → groups`, `studio → groups`, two-hop `performers/markers → groups`  (#5, #6, #7, #8)
5. `sub-groups → containing groups`  (#9)
6. the reverses last, so they distribute what stages 1-5 gathered:
   `groups → scenes` (#10), `galleries → images` (#11)

**Stage 1 is a correction made during implementation (2026-08-06); the plan had it wrong.** The
earlier draft put #12 in stage 2, *after* the tag paths. That silently defers work by a whole run:
#1 copies a scene's performers' tags onto the scene, and #12 gives the scene new performers, so a
performer arriving after #1 has run brings no tags with it until the next pass — and nothing errors,
so nobody finds out. Performer assignments have to land before anything reads performers.
`tests/propagate-paths.test.js` pins it (`every performer assignment lands before the first tag
path`), and a mutant that reorders them fails that check.

Stage 6 is where the homogenisation described below actually happens, and putting it last is
deliberate — a reverse run before its forward partner would distribute a stale set.

### Bidirectional pairs — the main hazard in v1

Both accepted reverses close a loop with a path already in the set:

    tags  Scenes  → Groups     (#5)   ⇄   Groups    → Scenes   (#10)
    tags  Images  → Galleries  (#4)   ⇄   Galleries → Images   (#11)

Two separate things follow, and they are often confused:

**1. Auto mode ping-pong.** A scene save propagates to its group; the group write is itself a
mutation the plugin watches, which propagates back to every scene in that group; and so on. It
terminates — union reaches a fixed point — but not before a burst of writes. **NPT's per-entity
cooldown must be ported** (`cooledDown` NPT `:2527`, `markWritten` `:2532`, `AUTO_COOLDOWN_MS` 8 s);
MPTTS has no equivalent, so this cannot be copied from the nearer sibling. `guarded()`/`_writeDepth`
alone is **not** sufficient — it suppresses our own writes within one reaction, not the second
reaction triggered by the first one's mutation.

**2. Homogenisation — a semantic effect, not a bug.** Running both directions of a pair under UNION
drives every member to the same tag set. Scenes S1{A} and S2{C} in group G{B} converge to
S1 = S2 = G = {A,B,C}. This is what "both directions" means and it is fast (two rounds), but a user
enabling both because each looked reasonable alone will not expect it. Two mitigations, both worth
having:

- **Say so in the dialog** when a run has both halves of a pair enabled.
- **Intersection is the gentler pairing.** With `Scenes → Groups` set to INTERSECTION, the group
  only gains tags every scene already has, so pushing back down is nearly a no-op — only the
  group's *own* tags spread. Worth recommending in the setting's description.

Under the **tasks** this is a non-issue: each task run is one direction, applied in a fixed order.
The hazard is auto mode only.

### Union vs intersection

Applies to `Scenes → Groups` and `Sub-groups → Containing Groups` (D2). Intersection = the tag must
be present on **every** source. Edge cases to pin in tests: one source ⇒ intersection == that
source's tags; zero sources ⇒ nothing added, either mode.

### Scale warnings

`images → galleries` is the dangerous one — six-figure image counts are normal. Page the targets
(MPTTS uses `TASK_PAGE_SIZE` 500 for performers, deliberately *not* `per_page: -1`) ~~and use
`per_page: -1` only for the per-target source fetch.~~

**SUPERSEDED at step 5**, second half only: paging the *targets* was right and is what ships, but
`per_page: -1` for the source fetch was wrong for the one path that needed it (see §2). Nothing in
the plugin issues `per_page: -1`; every query is paged. The rule that replaced it: **an unbounded
response is a hazard wherever it appears, including inside a per-target fetch** — a gallery is not
smaller than the library just because it is one row of it.

The residual cost is real and accepted: with both #4 and #13 enabled, a run makes **two** full
passes over every image, because the two paths sit in different stages. Both setting descriptions
say so.

### Deliberately excluded

All three go in the IDEAS section so they are not re-proposed:

- **`Scenes/Images/Galleries → Performers` (tags).** A performer appears in thousands of scenes;
  the union of all their tags is enormous and near-meaningless.
- **`Scenes ↔ Galleries` (tags), both directions.** The link exists and carries performers usefully
  (#12), but the two tag sets are not the same kind of thing.
- **`Child Studios → Parent Studio` (tags).** Siblings under a shared parent are typically
  unrelated, so rolling them up merges unrelated things. Structurally it is the twin of #9, which
  is exactly why it needs recording — it will look like a free win to whoever notices the symmetry.

### Tests

Add suites driven by `tests/npt-harness.js`, which already takes a source path and plugin id and
whose `dialog(body, prefix)` reads any plugin's markup. Register the new plugin in
`tests/style.test.js` and `tests/version.test.js`. Validate every regression test against the
unfixed source via `SRC=…` before trusting it.

---

## 6. Questions — ALL CLOSED

### Q1 — Settings model — **CLOSED**, see D7. Per-path booleans.

### Q2 — Which paths ship in v1 — **CLOSED**, see D5. 13 paths, listed below.

### Q3 — Plugin name — **CLOSED**, see D6.

### Q4 — Staging — **CLOSED**, see D8. Generalised to all four target pages.

### The v1 path list as it currently stands

13 paths. `⇄` marks the two bidirectional pairs (see §5).

```
TAGS (11)                                  target ← source traversal
  #1  Performers → Scenes             Scene.performers.tags
  #2  Studio     → Scenes             Scene.studio.tags
  #3  Markers    → Scenes             Scene.scene_markers.{primary_tag,tags}
  #10 Groups     → Scenes          ⇄  Scene.groups[].group.tags

  #4  Images     → Galleries       ⇄  findImages(gallery filter).tags

  #11 Galleries  → Images          ⇄  Image.galleries.tags

  #5  Scenes     → Groups          ⇄  Group.scenes.tags        union | INTERSECTION
  #6  Studio     → Groups             Group.studio.tags
  #7  Performers → Groups  (2 hops)   Group.scenes.performers.tags
  #8  Markers    → Groups  (2 hops)   Group.scenes.scene_markers.tags

  #9  Sub-groups → Containing Groups  Group.sub_groups.tags    union | INTERSECTION

PERFORMERS (2)
  #12 Galleries  → Scenes             Scene.galleries.performers
  #13 Images     → Galleries          findImages(gallery filter).performers
```

Settings implied: 13 path toggles + 2 mode settings = **15**, plus the ~10 MPTTS-parity settings
(buttons, staging, auto triggers, 4 exclusion filters, logging) ≈ **25 total**. For comparison,
NormalizeParentTags ships 16 today.

Structural notes that fall out of the set:

- **Groups are tag-only sinks** — no performer path reaches a Group in any direction.
- **Performers are never a target.** Tags flowing *onto* performers was considered and rejected: a
  performer appears in thousands of scenes, so the union of their tags is enormous and
  near-meaningless.
- **Scene ↔ Gallery carries performers but not tags** (#12 only), by explicit choice.
- **Two sources are reached by reverse query**, not by a field: #4 and #13 both go through
  `findImages` with a gallery filter, because `Gallery` has no `images` field.

---

## 7. Draft: new `TODO / IDEAS` section for the repo `CLAUDE.md`

Drafted here, to be appended to `/d/AI_Projects/StashPlugins/CLAUDE.md` at **step 9**, once the
plugin is finished. Deliberately not written there yet: the repo `CLAUDE.md` describes what exists,
and half of this is still forward-looking.

**Rewritten 2026-08-07** to match what was actually built. The first draft was written before
implementation and had two things wrong in text meant to become repo documentation: it prescribed
the per-gallery `findImages` query that step 5 replaced with a sweep, and its worked example of a
bidirectional pair used `Scenes ↔ Galleries` — a pair **D5 explicitly rejected**, and one that does
not exist in the shipped path table. The real pairs are `Scenes ↔ Groups` and `Images ↔ Galleries`.

```markdown
## TODO / IDEAS

### A third plugin: propagating tags and performers along entity relationships

Where `NormalizeParentTags` walks the **tag hierarchy**, `PropagateTagsAndPerformers` walks **entity
relationships** — copying a scene's performers' tags onto the scene, a gallery's images' performers
onto the gallery, a group's scenes' tags onto the group. `MergePerformerTagsToScenes` is one path of
it. Copy, never move: nothing is removed from the source.

**What the schema allows** (verified against `stashapp/stash` `graphql/schema/types/*`, 2026-08-06 —
re-verify before relying on it). Three types carry no `performers` field at all: **Studio**,
**SceneMarker** and **Group**. So performer propagation into a Group is impossible in any direction,
and the only real performer path into a Scene is from its Galleries.

`Gallery` has no `images` field either, and the obvious workaround is a trap. Filtering `findImages`
to one gallery costs a request per gallery and, with `per_page: -1`, returns a twenty-thousand-image
gallery in one response. Reaching a gallery's images safely means **sweeping** every image once,
paged, and bucketing by `Image.galleries` — the reverse of the traversal you wanted, which is the
general shape for any "no field points this way" relationship in Stash.

Every write is a single ADD-mode bulk mutation. `BulkSceneUpdateInput`, `BulkGalleryUpdateInput` and
`BulkImageUpdateInput` all carry `tag_ids` **and** `performer_ids`; `BulkGroupUpdateInput` and
`BulkStudioUpdateInput` carry `tag_ids` only.

**Order is semantics, not detail.** Paths cascade: `markers → scenes` before `scenes → groups` means
groups transitively inherit marker tags, and the reverse order does not. An implementation needs a
fixed, documented pipeline order and must say so in the dialog — and, like MPTTS's task, must key
its plan by the entity being *written*. The subtlest ordering rule is that **assignments come before
the paths that read them**: copying galleries' performers onto a scene after copying performers'
tags onto it defers the new performers' tags by a whole run, silently and without error.

Because the review happens before any write, "read sources fresh at each stage" cannot mean
re-reading the server — nothing has been written yet. It means reading the **plan**: a later stage
must count what an earlier stage already decided for an entity as though it were already there.

**Reverse paths are where the danger is.** Enabling both `Scenes → Groups` and `Groups → Scenes`
(or both halves of `Images ↔ Galleries`) drives every member of the group to the same tag set —
a fixed point under union, reached in two rounds. That is what running both directions *means*, not
a bug, but a user who enabled each half on its own merits will not expect it. Under a task it is
harmless: one run applies each direction once, in a fixed order. Under a reactive auto mode the two
writes trigger each other. `NormalizeParentTags` has the defence — the per-entity cooldown at
`AUTO_COOLDOWN_MS` — and `MergePerformerTagsToScenes` does not. Ship reactive modes for a
bidirectional pair only with the cooldown ported across; `guarded()`/`_writeDepth` is **not** it,
since it suppresses our own writes within one reaction, not the next reaction the first one causes.

**Union vs intersection generalises.** Two aggregations into a Group need the choice today — from
its scenes, and from its sub-groups — but every multi-source path has it (a scene's performers, a
scene's markers, a gallery's images). Single-source paths collapse to the same answer either way,
so promoting it later needs no special case. Intersection is also the gentler half of a
bidirectional pair: a group that only gains tags every scene already has has almost nothing to
push back down.

**Considered and rejected:** tags from Scenes/Images/Galleries onto **Performers** — a performer
appears in thousands of scenes, so the union of their tags is enormous and near-meaningless. Tags
between Scenes and Galleries in either direction — the link exists and carries performers usefully,
but the tag sets are not the same kind of thing. Tags from child studios up to a parent studio —
siblings under a shared parent are typically unrelated, so rolling them up merges unrelated things.

### Cooperation: from a two-way sibling check to an N-way registry

`checkSibling` is hardcoded to one other plugin on both sides (`MergePerformerTagsToScenes.js:1275`,
`NormalizeParentTags.js:1418`), which does not survive a third plugin. The fix is small and fits the
existing handshake: a `declares` map alongside `leases` and `respecters`, in which each plugin
publishes the migrations it performs.

    window.StashPluginCoop.declares = { pluginId: ["tags:performer>scene", ...] }

A plugin then warns when another plugin declares a path it also performs *and* has its reactive mode
on. Absent `declares` is handled exactly as absent `respecters` already is — "too old to know" — and
a future plugin gets the warning without any existing plugin being edited. Advisory like the lease:
it warns, it never stands down.

### Do not merge the plugins into one

Folding `NormalizeParentTags` and `MergePerformerTagsToScenes` into a unified tag manager has been
considered and rejected. They walk different graphs with different algorithms — an ancestor closure
and antichain against a relational gather — and share only chrome. One ES5 IIFE of 5,500+ lines with
no build step is unreviewable, and because the plugin id is the folder name *and* the settings
storage namespace, merging resets every user's settings and forces a reinstall. The duplication
worth removing is in the cooperation layer, not the code.
```

---

## 8. Implementation order

**Versioning while this is being built.** The plugin starts at **0.0.1** and stays below 1.0.0
until it is finished and worth installing — the major digit is what says "ready for consumption",
and a scaffold claiming 1.0.0 tells a user the opposite of the truth. Each step below is a feature,
so it takes the **minor** digit (0.1.0, 0.2.0, …); fixes within a step take the patch. 1.0.0 is
step 9 plus a run against a real Stash, not step 9 alone.


1. ~~Scaffold `PropagateTagsAndPerformers/` — yml, manifest, JS skeleton, README. Version in three
   places; add to `tests/version.test.js` and `tests/style.test.js`.~~ **DONE, 0.0.1.** Also
   delivered: the `TARGETS` and `PATHS` tables with the selection builders, the full 24-key settings
   block, the dialog + settings-page CSS (which is why `style.test.js` passes at step 1 rather than
   step 2), and a new suite `tests/propagate-paths.test.js` pinning the yml against the tables and
   the table's order against the pipeline. `style.test.js` was generalised from a hardcoded pair to
   an N-way comparison. Six mutants confirmed to fail the suite.
2. ~~Port the shared base from MPTTS/NPT: `coop()`, `acquireLease`, `guarded`, `gqlRequest`,
   `loadSettings`, task interception (both layers), settings-page injection, the dialog + its CSS
   (overlapping selectors byte-identical).~~ **DONE, 0.1.0.** Also delivered: the settings-page
   description split and tooltips (the third copy of that design), `describeFilters` and
   `pairedBoth`, and a new suite `tests/propagate-base.test.js` (64 checks, 10 mutants confirmed).
   The dialog reviews the *configuration* rather than the library until step 3 lands — enabled paths
   in pipeline order, filters in force, pair warning, lease warning, version gate — and says
   explicitly that the scan is not implemented, so an empty plan for want of a scanner cannot be
   mistaken for an empty plan over a settled library. A per-plugin `CLAUDE.md` was written too.
3. ~~The path table and `planEntity` equivalent — one table, target-centric, array order = pipeline
   order (§5). Tags first, single-hop only.~~ **DONE, 0.2.0** — and wider than planned. Two hops and
   the union/intersection modes were folded in from step 5, because both turned out to be nearly
   free: GraphQL nests, so `Group.scenes { performers { tags } }` is **one** query and a two-hop
   path is only a longer `walk`, and a mode is a fold over the sources. Shipping a path whose
   "common tags only" setting was visible in the UI and silently ignored would have been worse than
   either half. So step 3 covers all **eleven** walk-based paths; only the two reverse-*query* paths
   (out of a gallery's images) are left, and they are step 5 now.

   Also delivered, and not in the original sketch: **the cascade**. The plan flagged that sources
   must be read fresh at each stage, but the review happens before any write, so "fresh" cannot mean
   re-reading the server — nothing has been written. It means reading the *plan*: `plannedFor()`
   makes stage 4 count whatever stage 2 already decided for a scene as though it were there. That
   needed a `sourceType` per path and the source entity's own `id` in every walk selection.
   `tests/propagate-plan.test.js`, 13 mutants confirmed — 49 checks at the time, 50 now, since
   0.3.1 pinned the attribution clause in the same fixtures.
4. ~~Phase 1 review + phase 2 apply + Undo, via `buildBatches` grouping and ADD-mode bulk
   mutations.~~ **DONE, 0.3.0.** The library-wide task is complete for the eleven walk-based paths:
   batching by identical delta, ADD-mode writes, failed batches isolated, Stop, Rescan, the lease
   renewed per batch and released in every outcome, and Undo as a REMOVE delta replayed newest-first
   behind an arm/confirm latch. `tests/propagate-apply.test.js`, 14 mutants confirmed — 41 checks
   at the time, 43 now, for the same reason as step 3.

   One thing the plan did not anticipate: phase 1 and phase 2 emit the same `[TAG]`/`[PERF]` lines,
   separated only by the `Applying ...` header, so a test asserting what was *written* has to read
   below that header. The first version of the suite did not, and passed on the plan.

   **0.3.1 — the log names the source entity.** Asked for after reading a run's output: a line said
   `- from Performers`, which is the rule that fired, not the performer to go and look at. Each
   source type now carries a label and the fields that label reads (`SOURCES`, reusing `TARGETS` for
   the four types that are both), and a line reads `- from Performer "Jane" (7), +2 more` — one
   named in walk order, the rest counted. Attribution is computed in phase 1, held on the plan
   entry, and read back by phase 2 and Undo rather than recomputed. 9 mutants confirmed.

   It cost a name field on every traversal, which is what the plan had judged not worth it. The
   judgement was wrong: the clause is only useful if it names something you can open.
5. ~~The two reverse-query paths (#4, #13) — a gallery's images, reached by `findImages` with a
   gallery filter rather than by a walk, plus the paging that makes six-figure image counts safe.~~
   **DONE, 0.4.0.** All thirteen paths now run under the task.

   **The per-gallery filtered query was the wrong shape**, and this plan proposed it twice (§2, §5).
   It costs a request per gallery, and `per_page: -1` against a gallery holding twenty thousand
   images returns twenty thousand images in one response — reintroducing, in the query meant to
   avoid it, exactly the six-figure hazard §5 flagged. What shipped instead is a **sweep**: one
   paged pass over every image, keyed by the galleries each image names. Uniform pages, no
   unbounded response, and requests in proportion to the library rather than to the gallery count.

   Both reverse paths sweep separately, because they are in different stages (performers in 1, tags
   in 3). A shared sweep would halve the requests in that configuration and would be safe only
   while nothing between the two stages plans onto images — true today, not a property the table
   promises. Per pass, the sweep reads the plan exactly where a walk would.

   `tests/propagate-sweep.test.js`, 30 checks, 12 mutants confirmed. Two of them escaped the first
   set of checks and both were the check's fault: an ordering check on a single-page fixture could
   not tell "all sources gathered first" from "the sweep merely started first", and the progress
   check read the line after the run rather than during the sweep.
6. **HALF DONE, 0.5.0 — the target side.** Auto mode **and the per-entity cooldown together** —
   never one without the other (§5 "Bidirectional pairs"). The reverse *paths* (#10, #11) shipped at
   0.2.0 and need no coupling: under the task each direction is applied once, in a fixed order. It
   is the reactive modes that bounce off each other.

   **Landed:** a save of any of the four targets runs every enabled path into that entity. The
   cooldown, the short lease, `mutationSucceeded`, the settings cache, and `guarded()` around the
   whole reaction. `tests/propagate-auto.test.js`, 38 checks, 12 mutants confirmed.

   The design decision worth keeping: **`AutoRun` borrows `Run`'s planner** rather than owning one,
   which forced `targetParts` and `resolveExclusionTagId` out into shared functions. The user's only
   evidence about what auto mode does is that the task agrees with it, and two planners cannot be
   held to that.

   Two corrections found while building, both by testing rather than by reading:

   - `AutoRun.apply` first wrote **without `guarded()`**, so every reaction would have reacted to
     its own `bulkSceneUpdate`. The cooldown would have stopped it after one round, which is exactly
     the trap: it would have looked correct while costing a pointless pass per save.
   - A check on the missing-exclusion-tag case passed against a mutant that broke the name match,
     because the tag it wrongly resolved to was the one being copied — so the run wrote nothing
     *either way*. Same failure mode as step 5's two escapees: a check that cannot tell "refused to
     run" from "ran and found nothing".

   **Not done: the source side** (`a4AutoOnSourceUpdate`). It needs a reverse lookup per path —
   given a saved performer, which scenes? — which is a new column in the path table and thirteen
   Stash filter shapes that cannot be verified from here. Until it lands the setting warns once to
   the console that it does nothing, rather than sitting there looking like a mode that runs and
   finds nothing.
7. Respecter registration (done at 0.1.0) and the `declares` registry (D3). **The only step that
   edits the sibling plugins**, both of which need their hardcoded two-way `checkSibling` replaced;
   both then need a version bump and their own suites re-run.
8. Manual buttons + staging across the four target pages (D8). **Blocked on a live Stash** — the
   placement work cannot be done from here, only guessed at, and MPTTS needed `insertBeforeDelete`
   plus a two-container filter for the scene page alone.
9. Append §7 to the repo `CLAUDE.md`.

Then **1.0.0**, which is step 9 *plus* a real run against a real instance — not step 9 alone.

Verify with `node tests/run.js`, and check each new regression test fails against the unfixed
source via `SRC=…` before trusting it. Step 5 is the standing argument for that discipline: two
mutants survived the first set of checks and **both were the check's fault, not the code's** — an
ordering check on a single-page fixture could not distinguish "all sources gathered first" from
"the sweep merely started first", and a progress check read the line after the run instead of
during the sweep. A check that cannot fail is worse than no check, because it reports a guarantee
it is not making.

A passing suite is not a substitute for clicking the buttons once in a real instance — especially
for D8's placement, and now also for `Image.galleries`, which two shipped paths depend on and which
has only ever been seen in a fixture.
