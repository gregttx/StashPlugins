# Plan: `PropagateTagsAndPerformers`

*Propagate Tags and Performers to Related Entities* — short prefix `ptp2re`. See D6.

**Status: BUILDING — all nine steps resolved (eight built, one retired), the plugin is at 0.12.10**
(last checked 2026-08-10). All eight decisions are settled (§4) and every open question is closed
(§6). The library-wide task is complete for **all thirteen paths**, both automatic modes work, this
plugin cooperates with both siblings (step 7), and manual buttons with staging sit on and work
correctly on **all four target pages, confirmed live** (step 8) — built best-effort, without a live
Stash to check the DOM against, per the user's explicit go-ahead, and then corrected against one as
the user tested it. Step 9 (a repo `CLAUDE.md` TODO/IDEAS section) turned out to have nothing left
to append — see §7.

0.9.0 answered the four "Button Improvement" TODOs the same round of live testing raised, building
three of them (button size, the naming convention plus new source-side buttons, and a narrower
existence-gating cut of the fourth) and deferring the rest by explicit decision — see step 8's own
entry and `CLAUDE.md` §5c. It also recorded two TODOs the user split out for later rather than
asking to be built now: a theme check, and a missing Scene-onto-Studio path.

**0.9.1 through 0.12.8 are one subject — where a manual button lands in Stash's own button row, and
how it is spaced — settled over eleven releases against live screenshots rather than tests.** The
per-release account has been retired from this file and from the plugin's `CLAUDE.md`; the step
table in `CLAUDE.md` records which release did what, and the rules that came out of it are in the
repo-root `CLAUDE.md` ("Placing a manual button near Stash's own actions" and "Cross-plugin
cooperation: deterministic button ordering"). Two of those rules cost the most and are worth
carrying forward into any future plugin here: **a class confirmed on one page is evidence about that
page** (four releases argued about which anchor to prefer while the anchor search was silently
failing on the very row being tested), and **a measured gap is true of one instant while a margin is
true whenever you ask** (0.12.6 derived spacing from `getBoundingClientRect` in a row that had not
finished settling, and was reverted).

0.12.9 is a repo-wide simplification pass rather than a feature: the apply/undo batch driver written
once instead of twice, `findByClass` replaced by `querySelector`, and the version archaeology cut out
of this file, the plugin `CLAUDE.md`s and the READMEs. It also fixed a real divergence it exposed —
`MergePerformerTagsToScenes` had never set `row-gap` on a flex container, so a wrapped row of its
buttons sat flush while this plugin, running what looked like the same code, spaced correctly.

Where it stands, in numbers:

| | |
|---|---|
| Version | 0.12.10, in all three places |
| `PropagateTagsAndPerformers.js` | ~4,150 lines |
| Settings shipped | 25 (13 paths + 2 modes + 10 parity/filters) — unchanged since 0.1.0; everything since has changed labels, behaviour and placement, not the settings table |
| Test suites | 8 of the plugin's own, 21 in the repo, all passing |
| Checks in the eight | paths 60, base 75, plan 50, apply 43, sweep 30, auto 38, auto-source 28, buttons 101 = **425** |
| Mutants confirmed | 6 + 10 + 13 + 14 + 9 + 12 + 12 + 3 + 4 (spot-checked) = **83+**; every button/placement check added from 0.9.0 on was confirmed the coarser way instead, against the pre-fix source via `SRC=`, rather than one hand-built mutant each |
| Sibling plugins also touched | `MergePerformerTagsToScenes` 1.11.0 → 1.15.9 (1.12.0 at step 7, 1.12.1 harmonizing its two button labels for 0.9.0's dedup, 1.13.0–1.15.8 its half of the placement work, 1.15.9 the simplification pass), `NormalizeParentTags` 1.7.5 → 1.7.7 |
| Landed on `main` | through 0.12.9 (`dee5079`); 0.12.10 is uncommitted |

**Nothing here has been exercised against a running Stash.** Every foothold in Stash's markup and
schema is reproduced from notes. That is the standing caveat on the whole plan, and step 8's
placement work cannot even begin without an instance.

The design below is the *original* reasoning and is left as written, so that where implementation
disagreed with it the disagreement stays visible. Four such corrections are marked **SUPERSEDED**
in place: §2 and §5's per-gallery reverse query (step 5 replaced it with a sweep), §5's pipeline
order (stage 1 was wrong), and §4 D3's guess that staging would not generalise (D8 reversed it).
Where this file and the plugin's own `CLAUDE.md` differ, the plugin's is current — it documents
what the code does, this documents why it was asked for.

Lives at `.plans/migrate-tags-and-performers.md`, tracked in git since "Track the working plan"
(before that, `.plans/*` was excluded wholesale; the repo `.gitignore` now carves this one file back
in). Everything else under `.plans/` — scratch notes, `.plans/memory/` — stays untracked.

---

## 1. Context

The user wants a new Stash plugin, inspired by `MergePerformerTagsToScenes` (MPTTS), that copies
**tags** and **performers** from related entities onto a target entity — generalising what MPTTS
does for one path (a scene's performers' tags → the scene) across the whole Stash relationship
graph. It should carry over MPTTS's actions and triggers: manual buttons, auto-on-update, a
library-wide task, the two-phase review dialog with Undo, exclusion filters, and the cross-plugin
lease protocol.

Alongside the build, the user asked three design questions (answered in §4) and asked that the
thinking be recorded in a new **TODO / IDEAS** section of the repo `CLAUDE.md`. §7 explains why that
never happened, and why nothing was lost by its not happening.

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

**Status of the registry itself: built, step 7, 0.7.0.** It ended up narrower than sketched here —
see step 7's own entry in §8 for what actually shipped and why the sibling plugins' hardcoded checks
were *not* replaced wholesale.

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

**This table is target-side only, and that is a real gap, surfaced after 0.8.0 shipped.** MPTTS
actually has a manual button in *both* directions for its one path: a scene-page button (pull tags
in) and a performer-page button (push this performer's tags out to every scene they appear in).
PTP2RE's source direction exists only as the reactive auto mode (step 6) — there is no on-demand
button for it. Filling that gap is not "add one button": MPTTS only ever needed one source page
(Performer); PTP2RE has *seven* distinct source types (Performer, Studio, SceneMarker, plus each of
Scene/Gallery/Image/Group also acting as a source for some paths on top of being a target for
others), so it is a second button surface roughly the size of this one, on pages this plugin has
never placed anything on before. Deliberately not scoped or built yet — noted here so it is not
mistaken for an oversight in the table above, which was always target-side by design (D8's own
framing), not by omission.

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

## 7. The `TODO / IDEAS` section that was never appended

Originally drafted here for appending to the repo `CLAUDE.md` at step 9, once the plugin was
finished. It had two parts, and both turned out unnecessary to move anywhere:

- **The cooperation registry** was the draft's proposal for `declares`. Step 7 built it, and the
  repo `CLAUDE.md` now has a "Cross-plugin cooperation: the `declares` registry" section describing
  the real thing — more accurate than this draft ever was, since it also explains why
  `NormalizeParentTags`' collision stays a separate, bespoke check rather than folding in, a
  decision this draft predates. Appending the draft on top would have duplicated it, one version
  stale the moment the other shipped.
- **The schema findings and rejected-path reasoning** (§2, §5 above) were assumed to need rescuing
  into the repo `CLAUDE.md` before they were lost, on the belief that this file was git-ignored
  scratch space. It was not: `.plans/migrate-tags-and-performers.md` has been tracked since "Track
  the working plan", and the repo `CLAUDE.md`'s own convention already covers this — a plugin's
  `CLAUDE.md` points here for "the decisions that were taken and the paths that were rejected"
  rather than duplicating them (see `PropagateTagsAndPerformers/CLAUDE.md`'s opening). Nothing here
  is more durable for having a copy pasted into a different file.

The user's original ask — get the thinking recorded somewhere permanent — was satisfied a different
way than planned: not by a deferred end-of-project dump, but by writing it into the plugin's own
`CLAUDE.md` as each step actually landed, and into the repo `CLAUDE.md` for the one piece
(cooperation) that other plugins needed to read. Step 9 is retired rather than done.

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

   **DONE, 0.6.0 — the source side** (`a4AutoOnSourceUpdate`). The reverse lookup this entry
   predicted turned out cheaper than fearing "thirteen unverifiable filter shapes" suggested: ten of
   the thirteen paths have a plain field on the source pointing back at what refers to it
   (`Image.galleries`, `Gallery.scenes`, `Scene.groups`, `Group.scenes`, `Group.containing_groups`,
   `SceneMarker.scene`), costing one query per saved entity and no filter guessing at all. Only
   three — a performer's scenes, a studio's scenes and groups, a gallery's images — need the filter
   shape this entry expected, and it is one shape (`<field>: { value: [$id], modifier: INCLUDES }`
   on the target's own filter type) reused three times rather than thirteen invented ones. The two
   two-hop paths (`tags:performer>group`, `tags:marker>group`) needed no second round trip: the
   first hop's query simply asks for the second hop's field too, so `pick()` reads the final ids
   straight out of one response.

   Once the affected target ids are known, a source reaction *is* a target reaction: `runAutoTargets`
   is what the target-side `reactToTargets` was split into, shared verbatim by both modes, so a
   second planner never had the chance to exist. `tests/propagate-auto-source.test.js`, 28 checks,
   spot-mutated rather than exhaustively (the two-hop `pick` for markers confirmed; the codebase's
   usual "every branch, every mutant" discipline was traded for breadth across thirteen paths given
   the size of the feature — a debt worth paying down before 1.0.0, not before this commit).
7. ~~Respecter registration (done at 0.1.0) and the `declares` registry (D3). **The only step that
   edits the sibling plugins**, both of which need their hardcoded two-way `checkSibling` replaced;
   both then need a version bump and their own suites re-run.~~ **DONE, 0.7.0 — narrower than
   sketched, correctly.** The premise that both siblings' `checkSibling` needed *replacing* turned
   out wrong on inspection: `MergePerformerTagsToScenes`' check against `NormalizeParentTags` (and
   the mirror this step added to this plugin) detects Prune/Roll Up colliding with *any* additive
   write, regardless of which relationship made it — a category-level interaction with no path id on
   either side, not the "same path" question `declares` answers. Folding it in would have needed a
   second, richer vocabulary (categories plus a collision matrix) nothing here needs yet, for a
   result that could only say less than the specific wording each existing check already gives.

   What shipped instead, after a mid-step check-in confirming the broader scope: `coop().declares`
   (`{ pluginId: [pathId, ...] }`) as an **addition**, not a replacement, solving exactly the "same
   path" question — `MergePerformerTagsToScenes` declares `'tags:performer>scene'` unconditionally
   at load, this plugin republishes its *currently enabled* path ids on every settings load (task
   and auto mode alike), and each scans the other's entries for an overlap, informationally, in its
   own dialog log. Generic in the sense that mattered: a third relationship-copying plugin needs
   nothing edited in either existing one. Alongside it, this plugin gained its own
   `checkHierarchySibling` — `MergePerformerTagsToScenes`' `checkSibling` ported rather than
   generalised, since eleven of thirteen paths here are exposed to Prune/Roll Up exactly as that
   plugin's one path is. `NormalizeParentTags` gained the `declares` field on its `coop()` for
   shape-consistency alone; it has no relationship-copy paths to publish into it.

   All three plugins bumped: `MergePerformerTagsToScenes` 1.11.0 → 1.12.0 and this plugin
   0.6.0 → 0.7.0 (both a user-visible feature), `NormalizeParentTags` 1.7.5 → 1.7.6 (an internal
   field with no visible behaviour change). New coverage in `merge-task.test.js` and
   `propagate-base.test.js`, both confirmed against a pre-step copy — the sibling's suite crashes
   outright on the missing registry rather than merely failing, the cleanest proof available that a
   check exercises real code.
8. ~~Manual buttons + staging across the four target pages (D8). **Blocked on a live Stash** — the
   placement work cannot be done from here, only guessed at, and MPTTS needed `insertBeforeDelete`
   plus a two-container filter for the scene page alone.~~ **DONE, 0.8.0 — best-effort, unblocked by
   an explicit choice rather than by the block actually lifting.** Offered the choice between waiting
   for a live instance and building on the one placement this repo has confirmed (`.edit-buttons`,
   proven by `MergePerformerTagsToScenes`' own scene button), the user chose to proceed and verify
   later — the same risk tier step 5's reverse-query guess accepted before 0.4.0 landed.

   No second planner: a click reuses `AutoRun` exactly as the target-side auto reaction does,
   `planEntities(target, paths, [id])` against one named id rather than a page. What is new is only
   where the result goes — `run.apply()` unchanged for "save immediately", or the plan pushed into a
   captured `TagSelect`/`PerformerSelect` for staging, diffed against the form the way
   `MergePerformerTagsToScenes`' own capture already does, generalised from one component and one
   scene id to two components keyed by route. Names for staged items ride along free: `run.tagMap`
   and `run.performerNames`, both already built for planning, so staging costs no query of its own.

   D8's own caveat about placement stands exactly as written - gallery, image and group pages reuse
   `.edit-buttons` unverified. `tests/propagate-buttons.test.js`, 27 checks, 2 spot-checked mutants;
   one of them found a genuinely dead branch (an entity-id staleness check duplicated across two
   removal paths, only one of which was ever reachable) and it was simplified out rather than kept
   for symmetry.

   **0.8.1 — the first thing a live Stash actually found, and it was not the placement guess.**
   `manualButtonsTick` called `.slice()` straight off `container.childNodes`; a real browser's
   `childNodes` is a `NodeList`, which has no `.slice()`, so every tick threw and no button ever
   rendered on any page - the master toggle, the path settings, `.edit-buttons` itself, all fine,
   none of it ever reached because the reconciliation loop above them errored first. Two checks
   added to `tests/propagate-buttons.test.js` (27 → 29): a `nodeListLikeContainer` that reconstructs
   `childNodes` as an `Object.create(null)` on every read, carrying nothing from `Array.prototype`,
   which the shared harness's own array-backed container structurally cannot reproduce - three other
   suites depend on `childNodes` staying a real array (`.filter()`/`.indexOf()` throughout
   `propagate-base`, `merge-task`, `normalize-auto`), so this was a dedicated container for one
   suite, not a harness change. Confirmed against the unfixed source: it throws the user's exact
   error, to the character.

   **0.8.2 — with the crash gone, Group still showed nothing, and this time it was the placement
   guess.** Group's edit form does not use `.edit-buttons` at all; a live console check (`Inspect` on
   the Save button) found `.details-edit col-xl-9 mt-3` instead. That container was not a fresh
   discovery - `MergePerformerTagsToScenes`' own performer button already reads it, for the *other*
   half of a swap Stash does on it: a detail-view navbar carrying a Delete button, and the edit form
   itself carrying Cancel/Save in its place. `findManualButtonContainer` now tries `.edit-buttons`
   first (Scene) and falls back to whichever `.details-edit` does not carry a `button.delete` (Group,
   and by the sibling's precedent, Performer - though Performer is not one of this plugin's four
   target pages). Five checks added (29 → 34), including the exact URL the live Group was found at
   (`/groups/53/scenes` - a tab, not the bare entity route, which is why the route regex matches on a
   trailing `/` rather than requiring end-of-string) and that `.edit-buttons` still wins outright when
   both containers are present, so the fallback can never shadow the confirmed case.

   Also required extending `tests/npt-harness.js` itself, not just this suite: `makeElement`'s own
   per-node `querySelector` only matched a bare tag name, and `button.delete` - the same compound
   selector `MergePerformerTagsToScenes` already uses, real enough to be covered by `placement.test.js`
   against actual jsdom - needs a tag-plus-class match. Low risk to extend: nothing existing calls
   `querySelector` with anything but a bare tag today, so widening what it accepts could not narrow
   what already passed.

   Gallery and Image remain completely unverified - neither confirmed working nor confirmed broken.

   **0.8.2 was also the point Gallery and Image got their first live check, and both worked
   unmodified** - `.edit-buttons` covers three of the four pages, only Group needed the fallback.

   **0.8.3, from screenshots of all four pages side by side: two more findings, neither a placement
   guess this time.** A height inconsistency - `.edit-buttons`' flex `align-items: stretch` makes a
   `btn-sm` button sharing a row with a taller sibling (Stash's own Save/Delete, or MPTTS's button,
   which carries no `btn-sm`) stretch to match it, while one that wraps to its own row does not, so
   the identical button class rendered two different heights purely by which row it landed on.
   `align-self: flex-start` on every button, unconditionally, fixes it regardless of neighbours.

   And a real duplicate: Scene showed this plugin's own "Add Perf Tags" beside
   `MergePerformerTagsToScenes`' identically-labelled button for `tags:performer>scene`, the one path
   the two plugins share. `declares` (step 7) already knew this could happen; nothing had asked it at
   button-render time. The fix needed two signals, not one - `otherPluginDeclaresPath` (capability,
   from `declares`) *and* `foreignButtonAlreadyShows` (fact, a DOM label match) both have to be true
   before a path drops out. `declares` alone would have been wrong in the other direction: it says
   another plugin *could* cover this path, not that its button is showing right now, and suppressing
   on capability alone would leave neither button up when the other plugin's own manual-button
   setting happens to be off. Matching on the visible label (`path.button`) rather than a
   plugin-specific class name is what keeps this generic - a future third relationship-copying plugin
   needs no edit here either, the same genericity `declares` itself was built for at step 7.
   Deliberately one-directional: `MergePerformerTagsToScenes` has no equivalent check pointed at this
   plugin, so it never yields in return. That is a choice, not a gap - the newer plugin defers to UI
   that was already there, not the other way round.

   Six checks added (34 → 40): the `align-self` style, and the four directions the duplicate check
   has to get right (suppressed when both signals agree, shown when declared but not actually
   visible, unaffected by a foreign button on an unrelated path, and never mistaking its own
   already-rendered button for a foreign one). Both confirmed against the unfixed source.

   **Four "Button Improvement" TODOs surfaced during this same round of live testing, discussed
   with the user before any of them were built, and settled with explicit decisions:**

   - *#1, button height, and #2, duplicate buttons.* Already fixes above (0.8.3's `align-self` and
     the two-signal `declares` check) — listed here only because they were raised in the same batch
     as the two below, not because either was still open.
   - *#3, missing source-side buttons.* Discussed as two alternatives: plain buttons matching
     MPTTS's own pattern, or moving the action into Stash's native per-list selection menu (the
     "..." dropdown beside Select All / Select None on a filtered, checkbox-selected list). The
     user's decision split it in two: build the plain-button version now, under a new naming
     convention (`"Copy [all|common] [Tags|Perfs] [to|from] all <plural>"`, differing from — and
     requiring a harmonizing rename of — MPTTS's own two buttons); keep the selection-menu idea as
     a separate, later TODO (#5 below), since it is a genuinely different placement question the
     button version does not answer, not a refinement of it.
   - *#4, buttons that cannot add anything.* Kept as a deferred "maybe," per the user's stated
     preference verbatim: *"I prefer a button that is always there t[h]an needed even if also when
     not needed than a missing button when it is needed"* — a false positive (a button that
     sometimes reports "No changes") is preferred over a false negative (a button silently absent
     when it would have helped). This is full eligibility gating — "would a click actually add
     anything" — and stays out of scope. See 0.9.0's entry below for the narrower thing that *did*
     get built instead, which this preference was checked against before building it.
   - *#5, new: source-side buttons via Stash's selection menu, split out of #3.* Deferred,
     unscoped. Noted as possibly applying to MPTTS too, not just here — the same "could this button
     become a menu item instead" question applies to its performer-page button.

   **0.9.0 built #1 (properly this time), #2 (harmonized both plugins), #3 (plain buttons, the new
   naming), and a narrower cut of #2 the live testing also turned up: existence gating.** Not #4 —
   the distinction is the load-bearing thing 0.9.0 had to get right, and it is documented at length
   in `PropagateTagsAndPerformers/CLAUDE.md` §5c rather than repeated here. In short: "Add Perf
   Tags" already hid itself with no performers on the scene (MPTTS's own button gates on exactly
   that), but every other button here showed regardless, since 0.8.0 deliberately walked eligibility
   gating back. That inconsistency — a button should hide when its source **does not exist at
   all**, never mind whether a click would find anything *new* — is Improvement 2's actual bug, and
   it is a strictly cheaper, narrower question than #4's "would this add anything," answered by a
   new `Run.prototype.planTarget` hook (`recordExistence`) reading the same `agg.n` the diff itself
   computes, before the diff decides eligibility. A scene whose performers' tags are already all
   present still shows its button — that is the check that proves this is not #4 wearing a
   different name.

   #1 turned out to be two separate things: 0.8.3's `align-self: flex-start` fixed the *relative*
   problem (our own buttons at two different heights depending on row) but not the *absolute* one —
   every manual button still used the shared `btn-sm` helper built for the dialog's own footer,
   reading smaller than MPTTS's and Stash's own plain `btn btn-secondary` buttons on every row, not
   only a mismatched one. `buildManualButton` now builds its own element instead of calling that
   helper.

   #3's source-side buttons needed `MergePerformerTagsToScenes` 1.12.1 as a companion change:
   its Performer-page button covers the identical `tags:performer>scene` path this plugin's new
   Performer-page button now also does, and the dedup check (0.8.3's two-signal design, extended to
   the source side unchanged) matches on visible label text — an unrenamed sibling would no longer
   text-match and both buttons would show, the exact duplicate the whole mechanism exists to
   prevent. Eleven of the thirteen paths got a source button; the two marker paths did not, since a
   `SceneMarker` has no detail page of its own to put one on — a placement gap, not an oversight.

   Placement for the six source pages (Performer, Studio, and the four target types acting as a
   source instead) repeats D8's own caveat one level further out: confirmed live only where MPTTS's
   existing performer button already proved the container (Performer), guessed by the same pattern
   everywhere else (Studio, and the *detail*, non-edit view of Scene/Gallery/Image/Group). Expect
   this to need the same kind of live-testing round D8 itself needed across 0.8.1 – 0.8.3.

   Eight checks became sixteen new checks in `propagate-buttons.test.js` (40 → 56): four for
   existence gating (an absent source hides the button; a present source with nothing new to add
   still shows it — the #4-versus-Improvement-2 distinction, pinned as a test rather than only a
   comment; two independently-gated paths on one page; a failed probe falling back to showing
   rather than hiding), and six for the source side (placement on performer and studio pages, the
   push-direction label, existence gating hiding an empty one, a click writing directly with no
   staging, the dedup check extended, and the two new route matchers). Confirmed the coarse way,
   against the pre-0.9.0 (0.8.3) source via `SRC=`, rather than one hand-built mutant per check —
   the shared fixture entity also had to grow fields for every path's walk, not only the ones each
   test names, since the existence probe now runs before *any* button is offered, including one a
   given test was never about.

   **0.9.1: two more live-Stash findings from the very next round of testing, this time from
   screenshots of eight pages at once, plus two new TODOs the user split out for later rather than
   asking to be built now.** Both fixes are placement, not logic — nothing about which button shows
   changed, only where it lands:

   - Both button kinds were landing **after** Stash's own Save/Delete instead of grouping with them
     — visible on Performer, Group and Studio detail pages for the source-side buttons, and on
     Scene and Group's Edit tabs for the target-side ones. `MergePerformerTagsToScenes`' own
     performer button already used `insertBeforeDelete`; this plugin's buttons, both kinds, were
     using plain `appendChild`. Fixed with the same technique on the source side (ported, not
     shared — the plugins carry no module between them) and a text-matched equivalent,
     `insertBeforeSave`, on the target side, since Stash gives Save no distinguishing class the way
     Delete carries one.
   - A page with two enabled paths wraps its second button onto a new row, and neither container
     Stash renders defines a row gap of its own, so the wrapped row sat flush against the one
     above — live-tested on Scene Edit and Gallery Edit. `my-1` alongside the existing `mx-1` on
     both button builders fixed it unconditionally, rather than trying to detect a wrap and margin
     only that case.

   A third item from the same screenshot round — a studio with no tags still showing "Copy Tags to
   all Scenes" — turned out to already be correct: the source-side existence gate asks whether any
   *target* exists (scenes, for that path), never whether the source carries what would be copied,
   consistent with the target-side gate's own Improvement-4 boundary read from the other direction.
   No code changed; a test now names the scenario explicitly instead of leaving it proven only by
   accident.

   Two new TODOs, deferred by the user's own framing ("for later," not "fix now") rather than
   scoped and built:

   - *#6, check the plugins' dialogs and injected buttons under Stash's other themes.* Everything
     verified live so far — the screenshots behind 0.8.1 through 0.9.1 alike — was checked against
     one theme. Unscoped; no design work done.
   - *#7, a missing path: Scene onto Studio, with a union/intersection choice like the two existing
     aggregating paths (D2).* None of the thirteen paths write onto a Studio at all today — Studio
     only ever appears as a *source* (§5c/§5d above). Unscoped; needs its own design pass through §2
     (does `Studio` have the right back-reference, or does it need a `reverse`-kind lookup the way
     the two gallery-images paths and §4e's performer/studio filter lookups do) before it is sized.

   Nine checks added to `propagate-buttons.test.js` (56 → 65): six for placement (before Save
   without a wrapper, before Save with one, two paths ordered correctly — target side; before
   Delete without a wrapper, before Delete with one, two paths ordered correctly — source side),
   two for the `my-1` class on each button builder, and one naming the studio-with-no-tags scenario
   explicitly. Confirmed the coarse way again, against the pre-0.9.1 (0.9.0) source via `SRC=` — all
   eight of the placement/spacing checks failed against it, and the studio one (already-correct
   behaviour) passed against it too, as expected for a check that names existing behaviour rather
   than a fix.

   **0.9.2: 0.9.1's own wrapped-row fix was itself a live-tested regression, caught the very next
   round.** `my-1`'s vertical margin, added to fix a wrapped row sitting flush against the one
   above, sits on a flex line shared with Stash's own Save/Delete/Submit-to-stash-box buttons in the
   common case (one enabled path, no wrap at all) — and `.edit-buttons`/`.details-edit`'s default
   `align-items: stretch` sizes a flex line to the tallest *margin box* on it, not the tallest
   content box, so the margin inflated the line and Stash's own buttons — still default `stretch`,
   unlike ours, which opts out via `align-self` — grew taller to fill it. Visible as button growth
   on Performer and Studio Details, and, on whichever page re-renders its button row often enough
   for unrelated reasons, as a visible jitter each time the insert re-triggered the same stretch
   recalculation. Fixed by moving the spacing onto the *container* as `row-gap` (`ensureRowGap`,
   called from both tick functions wherever they touch a container) — a property of the flex row
   itself, which CSS defines as space between lines rather than a contributor to either line's own
   cross-size, so it cannot leak into another button's height the way per-item margin did. `my-1` is
   gone from both button builders entirely.

   The same round: confirmed the 0.9.1 Scene Edit placement fix (Copy Tags from Studio landing
   before Save) works as designed, matching `MergePerformerTagsToScenes`' own placement — no change
   needed. Answered a question about that sibling plugin: its *performer*-page button
   (`checkPerformerHasScenes`) gates on `hasTags && hasScenes`, stricter than its own *scene*-page
   button and stricter than this plugin's own existence gating (source existence only, never the
   source's own tags) — a deliberate difference, not an oversight; see `CLAUDE.md` §5c. And surfaced
   a real, unfixed gap: Gallery Details reportedly renders no buttons of its own at all, so
   `findDetailContainer()`'s `.details-edit`-with-`button.delete` search can never match there and
   the source button for `tags:gallery>image` cannot appear on that one page. Left open pending a
   live look at what, if anything, Gallery Details does render to anchor on — a guessed fallback
   container would be exactly the kind of unverified guess this repo's own rule (§6) says not to
   ship without a screenshot behind it.

   Two checks added to `propagate-buttons.test.js` (65 → 67), one per button builder: `my-1`
   asserted *absent* rather than present, and the container asserted to carry `row-gap: .25rem`
   after either tick function touches it. Both fail against the pre-0.9.2 (0.9.1) source via `SRC=`,
   confirming they exercise the fix.

   **The very next round: the reported Scene Edit "misplacement" turned out to be
   `MergePerformerTagsToScenes`' bug, not this plugin's.** Screenshots (Scene Edit with two enabled
   paths, e.g. Studio + Performers, or Group + Performers) showed this plugin's own button correctly
   before Save on the first line every time, and "Copy all Tags from all Performers" — the *sibling*
   plugin's scene button — alone on a wrapped second line underneath. Its `addSceneButton` had always
   placed that button with a plain `container.appendChild(button)`, landing after Save/Delete rather
   than grouping with the other non-destructive actions the way its own performer button already
   does via `insertBeforeDelete` — invisible with one button in the row, but the button left to
   overflow first, since DOM order decides wrap order and `appendChild` puts it last. Fixed in
   `MergePerformerTagsToScenes` 1.12.2 by giving the scene button the identical `insertBeforeSave`/
   `findButtonByLabel` pair this plugin already carries (separate copies, since the two plugins share
   no module). Three checks added to `placement.test.js` (13 → 16): before Save rather than appended
   last, not the row's last child, and a Save nested in a wrapper handled correctly — all three fail
   against the pre-1.12.2 source. This plugin's own placement needed no change.

   **The Performer Details flicker is confirmed to live in `MergePerformerTagsToScenes` too, not
   introduced by this plugin's 0.9.2 fix.** With this plugin's manual buttons switched off entirely
   (so nothing of ours touches that page) and the sibling's left on, the flicker on "Copy Tags to all
   Scenes" and the adjacent Delete button persisted — ruling out `ensureRowGap`/`row-gap` or this
   plugin's reactive re-insertion as the cause. Root cause not yet found: a static read of the
   sibling's `tick()`/`addPerformerButton()` found no code path that mutates the DOM once
   `performerCheck` and the button's parent already match, which is the normal steady state on an
   idle page — so whatever is happening once a second is either Stash re-rendering that toolbar for
   reasons external to either plugin (amplified into a visible flash by the reactive re-insertion
   both plugins do), or something neither a code read nor the available fixtures can surface. Left
   open pending a live look (Network tab for a repeating request while idle, or React DevTools'
   "highlight updates") rather than a guessed fix — the same discipline as the still-open Gallery
   Details gap above.

   **The flicker narrowed further, and one of its two questions got a real answer while the other
   stayed open.** A synthetic reproduction built on `npt-harness.js` (loading this plugin's real
   tick loop, not a mutant) proved `_existenceCheckSrc`'s caching does not loop on a static DOM —
   five simulated one-second ticks after the initial settle produced zero further queries — which
   rules out a runaway query bug internal to this plugin. The user's own Network tab confirmed the
   three repeating requests are this plugin's own `PTP_sfilter_findScenes_performers`, and that they
   only appear on **performers with no tags**. The mechanism: `MergePerformerTagsToScenes`' own
   performer button gates on `hasTags && hasScenes`, so a tag-less performer never gets *its* button
   at all — this plugin's dedup (`otherPluginDeclaresPath` + `foreignButtonAlreadyShows`) then never
   finds a foreign button to defer to, and this plugin becomes the only one actually inserting into
   the shared container. What is still not reproduced in isolation: why the query re-fires every
   second on a *live* page when the harness (DOM only, no React) cannot make it loop at all — the
   leading theory is this plugin's raw DOM insertion disturbing React's own reconciliation of that
   container, not yet confirmed.

   **The ordering question got a real fix, not just a diagnosis.** "Are we making an assumption
   about the ordering of loading of the plugins?" — yes, in effect: both plugins' `insertBeforeSave`/
   `insertBeforeDelete` always re-found the anchor's *live* position and inserted immediately before
   it, so with two plugins doing that independently, whichever one's async eligibility check happened
   to resolve last ended up closest to Save/Delete, a result decided by network timing and free to
   flip between page loads. `coop().order` (repo-root `CLAUDE.md`, "Cross-plugin cooperation:
   deterministic button ordering") fixes a priority per plugin — `MergePerformerTagsToScenes` 20,
   this plugin 10 — and `insertOrdered` reads it back off each button's `_coopOwner` tag, walking
   past already-placed higher-priority siblings rather than displacing them. The two plugins now
   converge on the same final order regardless of which one ran first. Shipped as
   `PropagateTagsAndPerformers` 0.10.0 and `MergePerformerTagsToScenes` 1.13.0 together, since
   neither plugin's fix means anything without the other's matching priority registration.
   `tests/npt-harness.js` gained `previousSibling` for this (only `nextSibling` existed before) —
   missing silently, the ordering checks would have passed against the unfixed code too, since the
   priority scan's backward walk could never advance past the anchor.

   **The very next round of feedback: the anchor itself was wrong, not just the ordering between
   two plugins' buttons on it.** Reported still seeing the flicker (unresolved, see above) and
   Gallery Edit's button landing before Save, which sounded at first like the same "wrong (before
   the save)" wording from the previous round — but this time confirmed, when asked directly, to
   mean the button was never wanted before Save at all: the actually-wanted position was **between**
   Save and Delete. `insertBeforeSave`/`findButtonByLabel` (0.9.1) were retired outright rather than
   patched — since Delete already sits right after Save on every page that has one, anchoring on
   Delete alone produces "between Save and Delete" without needing to locate Save at all, so both
   plugins' target-side buttons now go through the exact same `insertBeforeDelete` the source side
   always used. Group's edit-form state, the one page confirmed to render no Delete (§5b), falls
   back to `insertOrdered`'s existing no-anchor branch — appending at the end, landing after Save
   simply because Save is the last thing there. Shipped as `PropagateTagsAndPerformers` 0.11.0 and
   `MergePerformerTagsToScenes` 1.14.0. Confirmed against two kinds of mutant: the pre-0.9.1 plain
   `appendChild` (lands after both), and a copy with the Save-anchored walk restored (lands before
   Save instead of between) — the second one is what makes this round's tests worth trusting, since
   a test only checking "not appended last" would have kept passing against the very bug just fixed.

   **The flicker itself is still open** — nothing in this round touched it, since no new evidence
   (an Initiator stack trace, or confirmation of whether it is now also on Gallery Edit rather than
   only tag-less performers) has come in yet to confirm or rule out the leading React-disruption
   theory from the previous round.

   **A named design principle, surfacing what the previous round had gotten only half right.**
   Restated directly: a new button is inserted before whichever of the row's own buttons is
   *important* — one that must stay the last thing in the row — and appended after everything
   otherwise. Delete and Save are the two Stash actions either plugin here has ever shared a row
   with. 0.11.0 had only fixed the *between* case (both present); the same round's report that
   Gallery Edit's button "was placed before Save" turned out, on the very next question, to be a
   *second* complaint under the same words as the first — this time confirmed to mean the wanted
   position was between Save and Delete, which 0.11.0 already covered for Gallery. What it had not
   covered was Group, whose edit form has no Delete at all: `insertOrdered`'s no-anchor fallback
   simply appended, landing the button *after* Save and displacing Stash's own primary action from
   being last — exactly the failure the "important button" principle exists to prevent, on the one
   page 0.11.0's Delete-only anchor could not reach. `insertBeforeDelete` is renamed
   `insertBeforeImportantAction` in both plugins and regains a Save fallback (`findButtonByLabel`,
   un-retired) for exactly that page — Delete tried first, Save only if Delete is absent, appending
   only if neither is found. Documented as a general rule in the repo-root `CLAUDE.md` ("Placing a
   manual button near Stash's own actions: important vs. casual") rather than folded quietly into
   this plugin's own notes, since the user's framing was explicitly for every plugin in this repo,
   not only these two — and because this is the second time in two rounds a placement assumption
   here has needed correcting, a documented rule is worth more than a fix that only this plugin
   remembers. Shipped as `PropagateTagsAndPerformers` 0.12.0 and `MergePerformerTagsToScenes` 1.15.0
   together. `MergePerformerTagsToScenes` has no live page that reaches the Save fallback itself
   (Scene Edit always renders both), so its own test coverage for it is a synthetic Save-only
   fixture — proof that its *copy* of the shared design does not quietly drift from
   `PropagateTagsAndPerformers`' own, not proof of anything about a real page.

   **0.12.1 / 1.15.1 — the round that explains why the four before it read as churn.** The user
   reported, after 0.12.0, that placement was *still* unchanged, and supplied the row itself from
   the console: `edit-buttons mb-3 pl-0` containing `Copy Tags from Studio · Copy all Tags from all
   Performers · Save · Delete`, with `querySelector('button.delete')` returning **false**. That last
   detail is the whole answer. Every version from 0.9.0 onward searched for Delete by the `.delete`
   class and nothing else, on the strength of a line in the repo-root `CLAUDE.md` asserting as
   *confirmed live* that Stash applies that class "throughout". It does not. The class is real on
   the detail-view navbar — which is where it was actually observed, and which is why both plugins'
   container finders still rely on it to tell a navbar from an edit form — and absent from Scene's
   edit row, where Delete is a plain `btn btn-danger`. So on the page every one of these reports came
   from, the class search never matched, the Save fallback caught every call, and each round's
   argument about *which* anchor to prefer changed nothing the user could see. 0.11.0 believed it had
   moved buttons between Save and Delete; 0.12.0 believed it had left that case alone and only fixed
   Group. Both were reasoning about a branch that was never reached.

   The fix is one extra search: `.delete`, then a text match on `'Delete'`, then a text match on
   `'Save'`. `findButtonByLabel` becomes `findActionByLabel`, matching `<a>` as well as `<button>`
   and trimming first, because the console output established neither the tag nor the padding and
   being wrong about either reproduces the same silent misplacement. The container finders are
   deliberately left on the class: there it is a *discriminator* between two states of the same
   container, confirmed present on the navbar, and loosening it would change which container is
   chosen — a worse failure than a misplaced button, and one nothing has reported.

   **The generalisable lesson, now written into the repo-root `CLAUDE.md` in place of the false
   claim: a class confirmed on one page is evidence about that page.** Four rounds of anchor churn
   cost less than the note that caused them, which was recorded as fact and then trusted by every
   subsequent round without being re-checked. Before moving an anchor again, confirm the current one
   is being *found* — the console one-liner that settled this in a single reply is worth reaching for
   first, ahead of any reasoning about which button ought to be preferred.

   **0.12.2 / 1.15.2 — the blink, and the spacing question deliberately left open.** With placement
   finally working, the same round reported a source button appearing and disappearing once a
   second. `foreignButtonAlreadyShows` is shared verbatim by both tick functions but excluded only
   `MANUAL_BTN_CLASS`, the target side's — so on the source side our own button matched its own
   label, the plugin concluded a sibling's button was showing, and dropped the path. That shrank
   `paths`, changed `pathIdsKey`, re-armed the existence probe and cleared every source button while
   it was pending; with the button gone the next tick saw no match and restored it. A period-2
   oscillation. It bites only where another plugin *declares* the path (`tags:performer>scene`, the
   one `MergePerformerTagsToScenes` declares) **and** is not currently showing its own button — with
   a genuine foreign button present the match is correct and the path stays dropped, which is why
   the source side's only dedup test, which supplied one, passed throughout. The target side was
   never affected: it excludes its own class. Also `ml-2` → `mx-2` on
   `MergePerformerTagsToScenes`' scene button, which had nothing on its right since 1.14.0 moved it
   between Save and Delete.

   **The row/column spacing was reported in the same message and deliberately not fixed in the same
   commit**, because the report contains a clue that says a guess would be wrong. Group Edit — the
   one page on `.details-edit` — has "perfect" line spacing, while Scene, Gallery and Image Edit,
   all on `.edit-buttons`, have wrapped rows that touch. Both containers get the same
   `row-gap: .25rem` from `ensureRowGap`, so if both were flex containers they would look alike.
   Corroborating: 0.9.1's `my-1` regression, which is a *flex* stretch mechanic, was only ever
   reported on `.details-edit` pages. The working hypothesis is that `.edit-buttons` is not a flex
   container at all, which would make `row-gap` inert on exactly the three pages that touch — and
   would mean the fix differs per container. Awaiting a `getComputedStyle` dump rather than
   shipping a fifth round of the same mistake this entry is about.

   **0.12.3 / 1.15.3 — the dump came back and the hypothesis held.** `.edit-buttons` computes to
   `display: block`, so `row-gap` was inert on exactly the three pages whose wrapped rows touched,
   while flex `.details-edit` spaced correctly from the identical call. Its own buttons compute to
   `margin: 0 10px 0 0` — a right margin only, at a value no utility class in either plugin can name
   (14px root, so `mx-1` is 3.5px and `mx-2` is 7px), which is why a fixed class produced a
   different gap on every boundary: 13.5px after Save, 7px between two of ours, 3.5px before Delete.

   Both halves are now measured rather than chosen. The container is asked whether it is flex and
   gets the mechanism that works there — `row-gap`, or a bottom margin on our own buttons, which is
   safe in a block container for precisely the reason 0.9.2 found it unsafe in a flex one. And the
   horizontal margins are copied off a button Stash put in the row, identified by having no
   `_coopOwner`. That last choice is deliberate over hardcoding 10px: `.details-edit`'s own
   convention has still never been measured from here, and a rule that reads the row cannot be wrong
   about a row it has not seen.

   **This is the second time in two rounds that one `getComputedStyle` dump has replaced a
   multi-round guess** — the anchor's missing `.delete` class was the first. The pattern is now
   explicit in the repo-root `CLAUDE.md`: ask the page what it is before reasoning about what to do
   with it.

   **0.12.4 / 1.15.4 — the measurement was right and the page never saw it.** The live report after
   0.12.3 was that wrapped-row spacing was fixed everywhere ("the top 2 lines are now spaced
   properly", "Group Edit: line spacing is perfect") while *every* horizontal gap was unchanged,
   page for page, with the exact signature the old fixed classes produced: large after Save (10px +
   `mx-1`'s 3.5px), tight before Delete (3.5px + 0), and the one boundary next to
   `MergePerformerTagsToScenes`' button a step wider (`mx-2`, 7px). One `cssText` assignment landing
   in one axis and not the other is not a wrong value — it is the cascade, and **Bootstrap's spacing
   utilities are `!important`**. `mx-1`/`mx-2` on our own buttons outranked the inline margins;
   `margin-bottom`, which no class sets, went through untouched.

   The class is now off the button at build time and `applyButtonSpacing` adds it back only where
   there is nothing to measure, so the two can never both be in play. Two adjacent gaps closed while
   the file was open: a donor is any `btn`-classed element with no `_coopOwner` rather than a
   `<button>` specifically (Stash styles some row actions as links — the same fact 0.12.1 had to
   absorb for Delete, and a navbar whose actions are all links had no donor at all), and a container
   that spaces its own children with `column-gap` now gets no margin from us, since ours inherits
   that gap and a margin would be added to the row's spacing rather than match it. That branch is
   speculative-but-cheap insurance for `.details-edit`, whose convention is *still* unmeasured.

   The donor test also became a positive length check rather than `!== '0px'`: jsdom reports `''`
   for an unset margin, which the inequality read as worth copying and applied as `margin-left:;` —
   nothing, with the class fallback already skipped. Found by the new fallback test failing, which
   is the argument for writing the fallback branch's test at all.

   **Three rounds, three mechanisms, one shape:** the anchor searched for a class that was not
   there, the row-gap set a property the container did not honour, and the margin lost to a rule it
   could not outrank. In each, the code did exactly what it said and the page disagreed.

   **0.12.5 / 1.15.5 — matching a button exactly is not the same as looking right next to it.** With
   the cascade fixed, the edit rows came back correct (every boundary at Stash's own 10px, and the
   wrapped second row flush on the left, both confirmed live) and the *detail navbars* came back
   worse: our button now touched the one before it on Performer and Studio. The reason is that a gap
   between two inline siblings is the first's right margin plus the second's left, and the donor's
   margins are a right margin only — so copying them wholesale gives our button `margin-left: 0`,
   which is right after a button that carries a right margin and wrong after one that does not.
   Stash's navbars are unevenly spaced: its own `Auto tag...` and `Merge` touch each other there.

   `fillNeighbourGaps` takes the row's *step* from the donor and adds only what each actual
   neighbour is not already contributing — a no-op on the edit rows, the fix on the navbars. Note
   that this is the first rule here that reads the button's *position*, not just its container: the
   same button needs different margins depending on what it landed next to.

   **0.12.6 / 1.15.6 — a margin answers "what is this element set to", not "how far apart are
   these".** 0.12.5 came back fixing Performer and Studio and breaking *Group*, both its detail
   navbar and its edit form: the gap before our first button roughly doubled, on those two pages and
   nowhere else. That is diagnostic on its own — Group's gap was already correct at 0.12.4, with
   `margin-left: 0`, so it is produced by something *other* than the neighbouring element's own
   `margin-right`, and reading that margin will always under-count it. Rather than hunt for what
   (a wrapper element between us, container padding, a margin on something invisible - each a
   separate guess, and this thread has already cost five), `horizontalGap` asks the page how far
   apart the two actually are and adds only the shortfall against the row's step.

   Three cases have to be separated, and the third is the one that is not arithmetic: a measurable
   gap, no layout at all (fall back to the margin reading — both harnesses, and any container not
   currently displayed), and two siblings on *different visual rows*, where the horizontal distance
   between them is meaningless and the answer is a flush left edge. The right side deliberately does
   not mirror that last one: a right margin at a row's end is invisible, while dropping it could let
   the next button fit on the row after all and invalidate the measurement it came from.

   **Every round of this has ended the same way** — the code was right about a value and wrong about
   what the page would do with it. The class that was not there, the property the container did not
   honour, the margin that lost the cascade, and now the margin that was not what made the gap.

   **0.12.7 / 1.15.7 — the measurement was worse in both directions, and its failure is the
   diagnosis.** Live against 0.12.6: our button landed *touching* Delete on every `.details-edit`
   page, while Group — the page the measurement was written for — did not change at all. Those two
   facts together pin it. For the right-hand measurement to have run, our button must have had a
   width; for the left to have fallen back to the margin path, the element *before* it must have had
   none. So the thing beside our button on Group is not a button at all, and on the right a gap that
   existed at insertion time had closed by the time the row settled.

   Both halves are the same lesson from opposite ends: **a measured distance is true of one instant,
   a margin is true whenever you ask** — do not derive a persistent style from a transient
   measurement. `getBoundingClientRect` is gone; `marginContribution` resolves through a wrapper to
   the action facing us (the last `.btn` inside the element before ours, the first inside the one
   after) and sums the wrapper's own margin with it. React wraps some row actions and the wrapper
   carries no margin while the button inside it does, which is exactly the "contributes nothing"
   misreading that doubled Group's gap.

   That was stated as a hypothesis rather than a confirmed cause, and it was half right: live, it
   fixed Group's **edit** form and left its **detail** row doubled exactly as before.

   **0.12.8 / 1.15.8 — the same mistake has a second form, and that is the one the detail row had.**
   Resolving *through* an element only helps if there is an action inside it to resolve to. The
   element before our first button there holds none — an empty slot where a conditional action would
   go — so its own absent margin was still being taken for the whole gap while the real one came from
   the button behind it. **A zero read off something this code cannot identify as an action is not
   evidence of a zero gap; it is evidence that nothing was read.**

   `neighbourGap` walks outward until it finds something recognisable, adding skipped elements' own
   margins on the way and assuming they have no width — width being the one quantity that cannot be
   had without consulting a layout that has not settled, which was 0.12.6's whole error. Three
   distinguishable answers, treated differently: an action found (top up to the row's step), elements
   present but nothing recognisable (add **nothing**, since guessing is precisely what doubles a
   gap), and nothing at all on that side (the row's own end margin, our button being at that end).

   **The arithmetic pinned this before any DOM was inspected, which is the transferable part.** Group
   was correct at 0.12.4 with `margin-left: 0` and doubled from 0.12.5 once a step was added — so the
   gap exists without us, and whatever we measured reported zero. That narrows the cause to "the
   thing measured is not the thing making the gap" without knowing what the element is. Naming it
   would still need a dump of that row; fixing it did not.

   **What is left on this thread is taste, not a defect.** The edit rows sit at Stash's own 10px on
   every boundary and live feedback calls that "a bit too large" (the reported ideal is nearer 7px,
   `mx-2`). Tightening it means our buttons deliberately not matching the row they are in, which is
   the user's call to make, not one to take silently while fixing something else.
9. ~~Append §7 to the repo `CLAUDE.md`.~~ **Retired rather than done** — see the current §7: both
   halves of the draft turned out to already be where they needed to be by the time this step was
   reached, one shipped and documented live, the other never actually at risk of being lost. Nothing
   is pending here.

Then **1.0.0**, which needs a real run against a real Stash instance — the standing caveat on every
step since 5, and the only thing left undone now that step 9 is retired rather than outstanding.

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
