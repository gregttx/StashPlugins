# CLAUDE.md — GTTx Custom Fields Bulk Editor

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, the bulk-edit lease, the shared dialog chrome, the `GTTx ` name prefix) are in
`../CLAUDE.md` and still apply. The user-facing description is `README.md`; this file is for the
reasoning that does not belong in either.

**Status: 0.0.1 — written, nothing verified.** Every line of it exists and 56 automated checks
cover it, and *none of that is evidence it works*: the plugin's only footholds in Stash are a
dropdown id, a checkbox and a link pattern (§8), all read from notes rather than from a running
instance. The suite reproduces those notes, so it can only confirm the plugin is consistent with
what it was told.

**The major digit is a claim to the user that the thing works, and only a live click can support
it.** This shipped at 1.0.0 first, on the reasoning that the feature was complete and indivisible;
that reasoning is about the *code*, and the digit is about the *user*. See "A new plugin starts at
0.0.1" in the repo-root `CLAUDE.md`. From here: a patch per fix, a minor per verified capability,
1.0.0 when §8's table has been walked in a real Stash.

**It is the smallest plugin here by a wide margin, and that is the design.** No settings, no tasks,
no automatic mode, no fetch wrapper, no settings-page injection. It has one entry point, and until
the user opens a menu it does nothing but tick.

---

## 1. What it does, and the gap it fills

Seven entity types carry `custom_fields: Map!` — Scene, Image, Gallery, Performer, Studio, Group,
Tag — and Stash's UI edits them **one record at a time**. That is a UI limitation, not an API one:
five of the seven accept `custom_fields` on their *bulk* mutation, and the other two take a single
update each. The reference table in the repo-root `CLAUDE.md` ("custom fields in Stash") is where
that was established, and this plugin is what came of it.

So it does two things Stash cannot: **show** what a selection carries, and **write one field across
it**.

**Scene markers are excluded because `SceneMarker` has no `custom_fields` field at all.** The
original request named them; the schema does not have them. This is stated in the `.yml`
description, in the README and in `ENTITIES`' own comment, because "the marker list offers nothing"
otherwise reads as a bug. Do not let anyone "add the missing type".

## 2. The `ENTITIES` table is the spine

Keyed by the **plural URL segment**, not by a GraphQL type name, because that key does two jobs: it
names the type *and* it is how a list view is recognised. `/scenes`, `/performers/12/scenes` and
`/tags/9/images` all end in the list they show; `/scenes/12` and `/scenes/markers` end in something
that is not a key here, and so are not lists this plugin offers anything on. **That one-line route
rule is why there is no route table** — `listType()` is a `split('/').pop()` and a lookup.

`bulk: null` on Studio and Tag is the schema fact from the reference table: `BulkStudioUpdateInput`
and `BulkTagUpdateInput` carry no `custom_fields`. `writeChunk` branches on it and loops `single`
instead. Nothing else about those two differs.

## 3. Turning a selection into ids

The hardest part of the plugin, and the part with the least evidence behind it. Stash's list
selection lives in React state this plugin cannot reach, so it is read off the DOM: a **checked
checkbox** says a row is selected, and the row's own **detail link** says which entity that is.

**More than one distinct id under an ancestor means it is not a row.** `rowEntityId` climbs from the
checkbox and stops at the first ancestor that links anywhere; one id is the answer, more than one is
a refusal. This is not tidiness — a table view's **select-all** checkbox sits in the header, whose
nearest linking ancestor is the whole table, so accepting a multi-id answer would silently widen
every write to the entire list. A card that links to itself twice (its image and its title) still
gives one id, which is why the rule is "one *distinct* id" rather than "one link".

**The route filters which links count.** A scene card also links to its studio and its performers;
`spec.route` is the type's own pattern, so only the card's own links match. Two signals — the route
and the link — and either alone would be wrong.

**The walk is hand-rolled (`collect`), not `querySelectorAll`.** Same reason as
`findActionByLabel` in the two button plugins: the shared test harness's fake DOM answers class
selectors and nothing else, and this concern needs no selector engine. It skips nodes with no
`tagName`, because a real DOM's `childNodes` carries text nodes and the harness's does not.

## 4. The menu item

**`#more-menu` is the anchor and it has not been read off a running Stash.** It is the id Stash's
`ListOperationButtons` gives the "..." dropdown's toggle. react-bootstrap mounts the menu only while
it is open, which is why the tick has to be fast (a `MutationObserver` plus a 1 s timer) rather than
merely periodic: the menu appears the instant the user clicks, and a poll alone would show it
without our item about half the time.

**The fallback matches a menu by what is *in* it, never by class alone.** `.dropdown-menu` matches
the sort dropdown and the display-mode dropdown too, and injecting "Custom Fields..." into a sort
menu is a worse failure than not appearing at all. Stash puts the selection operations
(**Select All** / **Select None**) in this menu and nowhere else, so that is the signal. A dropdown
that is neither gets nothing. **If the fallback ever has to become looser, find a different signal —
do not drop the signal.**

**Reconciliation, not tracking.** React tears the menu down when it closes, so there is nothing
durable to hold. Every tick rebuilds the opinion from the route, the open menu and the selection.
The item carries `_cfbeKey` (type plus the id list) and is rebuilt when that changes, because the
click handler closes over the ids that were selected when it was made.

**"..." on the caption is the repo's promise that the click asks before it acts** — see "No write
without a plan in front of it" in the repo-root `CLAUDE.md`. It is amber for the same reason every
button the sibling plugins draw is: this is a control of ours in Stash's own chrome, and it leads to
a write. `.cfbe-menu-item` sets only `cursor` and `color`; the padding, hover and layout are
Stash's `.dropdown-item`.

## 5. The dialog

Ported from the three siblings and deliberately identical to them: same head with a backup warning
and an id legend, same `#202b33` modal, same footer buttons. `tests/style.test.js` compares all four
stylesheets with the prefixes stripped and fails on any drift.

**Two things it does not share, and one it half-shares.**

- **No `.log` of rendered lines — the listing is a `<textarea>.`** The siblings cap what they render
  (`LOG_RENDER_CAP`) because one node per line stops responding at six figures; a textarea is one
  node for any number of lines, and it is selectable and copyable with nothing to press, which is
  what the request asked for. `.cfbe-log` is the wrapper around it, so the shared rule still does its
  job (flex, scroll, monospace).
- **A `.cfbe-msgs` strip carries the `.cfbe-line` messages** — warnings, errors, the applied recap.
  There is no Copy log button: the thing worth copying is the list, and it is already a text box.
- **No settings page**, so none of the settings-page CSS. `tests/style.test.js` carries a
  `settingsPage: false` flag for exactly this, *and* a positive check that such a plugin declares no
  settings and styles none — or the flag would be hiding a drift rather than an absence.

**The state machine is four states, and the pairing is deliberate.** `loading → listing →
applying → applied`, with `undoing` returning to `applied`. Cancel/Apply and Undo/Close never
overlap: after an Apply the listing describes a library this dialog has already changed, so offering
Apply again over it would write from a plan nobody is looking at. **Rescan is what closing and
reselecting does** — there is no Rescan button, because the selection is the scope and the selection
lives in a list the dialog is covering.

**The version gate is the only warning here that blocks**, exactly as in the siblings, and **Undo is
never gated on it**: stranding the user with changes they cannot take back is worse than the
mismatch. Everything else (another plugin's lease) is stated and carried on with.

## 6. The three modes, and the one distinction the data allows

A custom field holds **one value per key**, so there is no list to append to and Stash's own
Overwrite/Add/Remove tabs do not transfer. Here:

- **Add** — `partial`, on entities that do **not** already carry the key. "Do not overwrite."
- **Overwrite** — `partial`, on every entity in scope.
- **Remove** — `remove: [name]`, on entities that **do** carry it.

`plan()` also drops entities that already hold exactly the value asked for, so a second Apply of the
same thing writes nothing rather than re-writing everything.

**`partial` and `remove`, never `full`.** `full` replaces the entire map and would discard every key
the caller did not send, which is the whole library's custom fields at once. Nothing here has a
reason to touch a key the user did not name.

**`Apply to: Filtered list only` selects the *entity* set, not the row set.** The filters narrow a
listing of `(entity, field, value)` rows; the scope takes the entities that still have at least one
row. That is the reading that survives all three modes — a Remove of field `X` scoped to a filter on
field `Y` still means "the entities showing", which is a thing a user can hold in their head. Making
it mean "the filtered rows" would make the field-name box and the name filter two half-overlapping
ways to say the same thing.

**Values are written as strings.** The `Map` accepts any JSON, and `valueText` renders what it reads
faithfully, but nothing tries to infer that `5` was meant as a number. Guessing would be a silent
type change on data the user cannot see the type of.

## 7. Applying, and Undo

**One delta for the whole apply.** Every entity in an apply gets the *same* `custom_fields` input, so
it is one bulk mutation per chunk of 100 rather than one per entity. `runWrites` takes batches
because Undo needs several; an apply passes one.

**A chunk is one mutation, so a type with no bulk mutation gets chunks of one.** Studio and Tag
would otherwise put a hundred single updates behind one chunk, where one refusal takes the
ninety-nine that were written with it out of the count. `runWrites` sizes the chunk off
`spec.bulk`, and `writeChunk` handles exactly one id on that branch.

**Undo replays each change as its own inverse** — the previous value back where there was one,
`remove` where there was not — grouped so that entities that shared a value share a mutation. A
stored copy of the whole map written back would be simpler and wrong: it would revert every
unrelated edit made in between, which is the one thing an undo must not do. This is the siblings'
rule (`4b`, and `MergePerformerTagsToScenes`' own Undo) applied to a single key.

**It arms and asks, with the count in the caption.** One click starts a write across a selection and
**Close** is its neighbour. Same `UNDO_ARM_MS` latch as `PropagateTagsAndPerformers`.

**The local `fields` map is moved with the server's**, on both the apply and the undo, so a second
operation in the same dialog plans against what this dialog actually wrote rather than against what
it read at open.

**The lease is taken by `runWrites` and released in every outcome** — success, a failed chunk, an
empty batch list — so a reactive sibling is never left standing down. The expiry is the backstop for
the one outcome nothing can catch: the tab going away mid-write.

**No `guarded()`, and no `respecters` entry.** This plugin never wraps `window.fetch` and never
reacts to a save, so there is nothing of its own to suppress and nothing to stand down. Registering
as a respecter would be a claim a sibling's dialog repeats to the user, and it would be false.

**No Apollo eviction.** The siblings evict what they wrote so a panel showing tags or performers
redraws. No Stash list view or card displays a custom field, so there is nothing on screen to
refresh; the entity's own detail page reads fresh on navigation.

## 8. Anchoring in Stash's markup

Every foothold here is a guess until it runs against a real Stash, and a test written from the same
guess confirms nothing. What this plugin is betting on, in descending order of how much it would
cost to be wrong:

| Assumption | If wrong |
| --- | --- |
| The "..." toggle carries `id="more-menu"` | The signal fallback (§4) still finds the menu |
| The menu holds **Select All** / **Select None** items | Only matters if the id is also wrong; then nothing appears |
| A selected row carries a checked `<input type="checkbox">` | Nothing is ever selected; no item appears |
| A row links to its own entity as `/<plural>/<id>` | Same |
| `.dropdown-item` is the class on menu items | Only the fallback's scan is affected |

**The gate switch is the diagnostic for all of it.** `__GTTx__.StashPluginCoop.debugButtons = true`
names which of the three conditions failed — not a list view, no open menu, nothing selected — on
the next tick, deduplicated per channel so an idle page does not emit forever. It is the shared
switch rather than one of our own for the reason the repo-root `CLAUDE.md` gives: "why is this
control not there" is rarely a question about one plugin. **Read `§5e` of
`PropagateTagsAndPerformers`' CLAUDE.md before changing it** — the lesson there is that a diagnostic
must restate a cached answer rather than only speaking when something recomputes, which is why these
lines come from the tick.

## 9. Testing

`node tests/run.js`. Two suites touch this plugin:

- **`cfbe.test.js`** — both halves. The menu: the item appended last in an open menu with a
  selection, absent without one, absent with nothing selected, removed when the selection is
  emptied, not duplicated by a second tick, found by the signal fallback when the id is missing and
  *not* found in a dropdown that is neither, refused for a table's select-all checkbox, refused on
  the marker list and on a detail page, offered on a list nested under another entity, and not
  confused by a card's links to other entity types. The dialog: the head, the legend, one aliased
  by-id query for the whole selection, the listing's shape and order, an entity with no fields
  contributing no line, the counters, both filters, Apply held back until a field name is given, and
  no mutation before it. Then each mode's write — Add skipping what already has the key, Overwrite
  covering everything, Remove as a `remove` delta on the entities that carry it — the filtered
  scope, the studio/tag single-update path, the lease held *in flight* and released, Undo arming and
  then writing one inverse batch per previous value, a deleted entity named rather than dropped, a
  failed write reported and not counted, the footer during an undo that is still in flight, and the
  version gate. Two of those read the dialog *mid-write*, which `h.HANG` is what makes possible: a
  lease only ever observed after the fact could as well never have been taken, and a footer only
  ever read after a write finishes cannot show the state that is wrong.
- **`style.test.js`** — the CSS this plugin shares with its three siblings, plus the check that a
  plugin declaring no settings styles none.

**Every check was confirmed against a deliberately broken copy before being trusted** — six
mutants: a container's many ids taken as a row, Add not refusing an existing key, the lease not
taken, `listType` matching by prefix instead of by last segment, Undo writing one flat batch, and
`undoing` not counting as applied for the footer. Each fails exactly the checks written for it. Use
`SRC=/path/to/mutant.js node tests/cfbe.test.js`.

What they cannot cover: §8. The suite reproduces Stash's list markup from notes, so it proves the
plugin does the right thing with what it is given, not that Stash still gives it that. **Click it
once in a real instance before believing any of §3 or §4.**
