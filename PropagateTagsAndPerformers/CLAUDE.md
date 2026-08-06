# CLAUDE.md — Propagate Tags and Performers to Related Entities

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, the bulk-edit lease, the shared dialog chrome) are in `../CLAUDE.md` and still apply.
The user-facing description is `README.md`; this file is for the reasoning that does not belong in
either.

**Status: under construction, 0.1.0.** The version is below 1.0.0 deliberately and stays there
until the plugin is finished — the major digit is the claim that it is worth installing. Each
implementation step takes a minor bump; fixes within a step take the patch.

| Step | | Version |
| --- | --- | --- |
| 1 | Scaffold: manifest, settings, `TARGETS`/`PATHS`, CSS | 0.0.1 |
| 2 | Shared base: cooperation, GraphQL, task interception, dialog, settings page | **0.1.0** |
| 3 | The planner — target-centric gather, tags, single hop | — |
| 4 | Phase 2 apply, and Undo | — |
| 5 | Two-hop paths and the "common tags only" modes | — |
| 6 | The two reverses **and** the per-entity cooldown, together | — |
| 7 | Auto mode, respecter registration, the `declares` registry | — |
| 8 | Manual buttons and staging | — |
| 9 | Repo `CLAUDE.md` TODO/IDEAS | — |

The full design, including the decisions that were taken and the paths that were rejected, is in
`.plans/migrate-tags-and-performers.md` (git-ignored).

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
be copied from the nearer sibling. **Ship the reverses and the cooldown in the same step, never one
without the other.**

Under the task neither is a hazard: one run applies each direction once, in a fixed order.

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

## 5. The dialog (0.1.0)

Ported from both siblings and deliberately identical to them: same head with a backup warning and an
id legend, same monospace log with a rendered tail, same footer, same `scanning|ready|applying|
undoing|done` state machine. The overlapping CSS is byte-identical across all three and
`tests/style.test.js` fails on any drift — see the repo-root CLAUDE.md.

**At 0.1.0 it reviews the configuration, not the library.** There is no planner yet, so `scan()`
logs one WARN saying so and finds nothing. What it *does* do is real and worth keeping separate
from the planner:

- names the enabled paths **in pipeline order**, because that order decides what one run reaches
- warns when both halves of a reversible pair are on
- names every exclusion filter in force, and says so explicitly when none is
- warns about another plugin's lease, without standing down
- compares the running script against the installed manifest

**"Nothing to do" and "nothing was read" must not look the same.** An empty plan because the library
is settled and an empty plan because the scan is not implemented are different facts, and the second
one says so in its own line. When step 3 lands, that line goes.

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

`node tests/run.js`. Three suites touch this plugin so far:

- **`propagate-paths.test.js`** — the tables, and the invariants the order carries. See
  `tests/README.md`.
- **`propagate-base.test.js`** — both layers of task interception, the dialog head, the
  configuration review, the version gate, the lease warning, the footer, and the settings-page
  injection.
- **`style.test.js`** — the CSS this plugin shares with its two siblings.

**Every check here was confirmed against a deliberately broken copy before being trusted.** Sixteen
mutants so far, each failing exactly the check written for it — a suite that passes for the wrong
reason is worse than no suite. Use `SRC=/path/to/mutant.js node tests/propagate-base.test.js`.

What they cannot cover: Stash's own behaviour. The suites reproduce its markup and its schema from
notes, so they prove the plugin does the right thing with what it is given, not that Stash still
gives it that. Anything touching §6 needs a click in a real instance before it is believed.
