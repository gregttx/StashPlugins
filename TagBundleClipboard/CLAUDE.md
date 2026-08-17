# CLAUDE.md — ᝯㄝₓ Tag Bundle Clipboard

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, the shared dialog chrome, the cooperation protocols) are in `../CLAUDE.md` and still
apply. The user-facing description is `README.md`; this file is for the reasoning that does not
belong in either.

**Status: written, not verified. 0.0.1.** Every step below has landed and the suite passes, and
neither of those is the thing the major digit claims. Nobody has clicked one of these buttons in a
running Stash. See "What is unverified" at the bottom — that list emptying is what moves this to
1.0.0, and the repo has shipped a 1.0.0 twice on "the code is complete" and been wrong both times.

| Step | | Version |
| --- | --- | --- |
| 1 | Scaffold: manifest, two settings, `CSS`, the shared chrome, `coop().order` | 0.0.1 |
| 2 | The clipboard, the `ENTITIES` table, the detail container, the **Copy** button | 0.0.1 |
| 3 | The `TagSelect` capture, the **Paste** button and its dialog | 0.0.1 |
| 4 | The `debugButtons` channel, README, `tests/tagclip.test.js` | 0.0.1 |

All four landed in one pass, so they share a version rather than each taking a minor. The table is
kept because it is the order the parts depend on each other in, which is what a second pass over
this file needs.

---

## 1. The one property everything else is arranged around

**This plugin issues no mutation.** Not "issues few", not "issues them carefully" — none. A paste
puts tags into a captured form control and Stash's own Save commits them.

That single fact removes, in one go, most of what the three sibling plugins spend their length on:

- no `guarded()` / `_writeDepth`, because there is no write for a reactive plugin to see;
- no **lease**, because a lease announces a bulk write;
- no **Undo**, because the form's own Reset is the undo and there is nothing else to take back;
- no **backup warning** in the dialog head — the standing rule that the backup sentence must not be
  edited out for brevity is about dialogs that write, and here it would simply be false. What sits
  in its place says where the tags actually go.

`tests/tagclip.test.js` ends with a blanket check that no mutation is issued by any path, after
exercising both buttons and an Add. **That is the check to keep if any others are ever pared back**,
because every deletion above is only safe while it holds.

## 2. Six entity types, and why not seven

`ENTITIES` holds Scene, Image, Gallery, Performer, Studio, Group — everything that carries a `tags`
field *and* has both a detail page to copy from and an edit form to paste into.

- **Tag** carries `parents`/`children`, not `tags`. A bundle has nowhere to land on one. This is a
  schema fact, not a scoping decision.
- **SceneMarker** carries tags and has no detail page of its own — the same placement gap that keeps
  `PropagateTagsAndPerformers` from giving its two marker paths a source button.

Both are stated in the README, because an absence with no reason beside it reads as a bug. The
precedent is `CustomFieldsBulkEditor` saying three times why markers are missing.

The table carries no mutation names, unlike every other entity table in this repo. That is §1 made
structural: there is nothing for one to name.

## 3. The clipboard is `localStorage`, and the two alternatives were rejected on facts this repo
already had written down

- **The system clipboard** was the user's first suggestion and is the worst of the three
  mechanically. Stash is commonly served over plain HTTP on a LAN, where `navigator.clipboard` does
  not exist at all — a fact three plugins here already carry in a comment beside their Copy log
  fallback — and `readText` is unavailable to page script in Firefox regardless of the scheme. It
  would also take the clipboard off whatever the user had copied, and holding N bundles would mean
  encoding a stack into one text blob and rewriting it on every copy.
- **The server** was the user's second suggestion, offered as "if that easier". It is not easier:
  `configurePlugin` replaces the whole settings map, so every copy would rewrite the plugin's
  configuration, and the blob would render as a text box on the settings page. More to the point it
  would be a mutation, which §1 exists to avoid.
- **`localStorage`** satisfies the actual requirement — "targets and sources can be open in separate
  tab" — in about ten lines, and every tab of one browser against one Stash shares it.

**What it costs is stated rather than hidden**, in the settings description and the README: not
another browser, not another device, not the database backup. `CustomFieldsBulkEditor` §23's note
that a mark "is in the database and in the backup rather than in one browser's `localStorage`" is
about a mark on an entity that is part of the user's data. A bundle is scratch with a lifetime of
minutes; the two are not the same kind of thing, and the reasoning there does not transfer here.

**No `storage`-event listener.** The picker reads the clipboard fresh every time it renders, which
is the only moment it matters. A bundle copied in another tab while the dialog sits open appears the
next time anything is clicked; the README says so.

### The bundle carries a version, and that is not speculative generality

`{ v: 1, at, type, id, label, tags: [{ id, name }] }`. This is the one thing in the repo that is
*persisted* outside the database, outlives a plugin upgrade, and has nothing that could migrate it.
`validBundle` drops anything that does not parse or does not match the shape, silently — a key
another page happens to have taken must not make the picker unopenable until the user clears their
browser storage by hand. `tests/tagclip.test.js` drives both: a value that is not JSON, and a
well-formed array holding somebody else's objects.

**`label` and the tag `name`s are captured at copy time**, which is what makes the picker cost zero
queries: it draws itself from the clipboard, and `pasteTags` builds `TagSelect` items straight from
the bundle. A renamed tag shows its old name in the picker; the **id** is what is staged, so the
copy is still correct. That is the right trade for a bundle whose lifetime is minutes.

**The limit is applied on push, not on read.** Lowering the setting therefore discards nothing until
the next copy, which is what the setting's own description promises — and is the kinder direction:
a setting edit that silently threw away bundles would be the one thing about this plugin a user
could not undo.

## 4. Putting tags into the form

The capture is `MergePerformerTagsToScenes`' and `PropagateTagsAndPerformers`' — `PluginApi.patch
.before('TagSelect')`, a pure observer returning `[props]` untouched — keyed by this plugin's own
six-type route rather than by a scene id or by four target types.

`findControl`'s "prefer a capture whose contents match what we last put in" rule is carried over
verbatim and for the same reason: matching against the *server's* tags would keep re-selecting the
stale pre-paste capture and report the same count on every press.

**A missing control is not an empty entity, and conflating them was a real bug caught by the
suite.** `formTagIds` returns `null` where no capture matches the route, and `picked()` returns `[]`
on that rather than falling through to `|| []`. Without the guard, a dialog opened with the Edit tab
shut listed every tag in the bundle as addable, disabled nothing, and ended in `pasteTags` throwing
on the press — an error thrown over a pane that was already explaining the real problem. The pane
says "open the Edit tab" and Add stays disabled.

**The diff lives in `picked()` and nowhere else.** It was in both `picked()` and `pasteTags` for one
round, and a mutant that gutted the second copy passed the entire suite — which is the tell that it
was never deciding anything: both read the same live control through the same `findControl`,
synchronously, on the same press. **A duplicate maintained in two places is worth checking for a
third option: not duplicating it.** `pasteTags` now appends what it is handed and says so.

**`picked()` re-reads the control on the press rather than answering from what `render()` drew**,
which is what makes "diffed against the form" mean anything: a tag typed into the box by hand after
the dialog opened is excluded without a re-render. A mutant caching the render-time answer fails
exactly that check.

**Where `PluginApi.patch` is missing, the button is not drawn at all**, and this is the one place
this plugin deliberately differs from both siblings. They degrade to *writing*, which is the right
call for a plugin whose other modes write anyway — the user opted into the button, not into staging.
Here writing would break §1, and there is nothing else to degrade to. One console line says so; Copy
Tags is unaffected and the bundles wait for a Stash that can paste them.

## 5. Placement

Ported wholesale from `PropagateTagsAndPerformers`, which spent six releases (0.9.0–0.14.0) getting
it right against a live Stash. The rules are in the repo-root `CLAUDE.md` under "Placing a manual
button near Stash's own actions" and "deterministic button ordering"; **this is a copy, not a
redesign**, and the comments kept in the source are the ones that would otherwise invite one. The
four that cost the most, restated only because someone editing this file will be tempted:

- `.edit-buttons` computes to `display: block`, so `row-gap` is inert there and honoured on the flex
  `.details-edit` — same call, opposite result, decided by the container.
- Stash's own buttons carry `margin: 0 10px 0 0`, a step no utility class here can name, so it is
  read off a donor rather than chosen.
- Bootstrap's spacing utilities are `!important`, so the class is off the button at build time and
  added back only on the branch with nothing to measure.
- A margin is true whenever you ask; a `getBoundingClientRect` gap is true of one instant. Do not
  derive a persistent style from a transient measurement.

**Two containers, one per button**, both halves of the swap `findEditContainer`/`findDetailContainer`
already read: the `.details-edit` *without* a Delete is the edit form (Paste), the one *with* a
Delete is the detail navbar (Copy). Only Performer and Group render that navbar, confirmed live by
`PropagateTagsAndPerformers` 0.13.3, so Scene and Gallery reach `ensureTabStripRow` instead.

**The tab strip is found by its Edit tab's `-edit-panel` key, never by `.nav-tabs`.** Gallery renders
two strips and only the entity's own carries that key; Scene independently renders a second element
whose text is exactly `Edit`, so a label match would be ambiguous too. **The suite's fixture carries
a decoy strip first**, with a bare key and an `Edit`-reading tab — without it, a mutant matching by
class passes, which is exactly the shape of test that proves nothing.

**`coop().order` priority 5**, under `PropagateTagsAndPerformers`' 10 and
`MergePerformerTagsToScenes`' 20. These are the most casual buttons in the repo, so furthest from
the anchor is right. It fits the gaps of 10 the protocol reserved either side.

**No existence or eligibility gating**, and this is a deliberate departure from both siblings.
`PropagateTagsAndPerformers` spent five releases on a probe because its buttons ask an expensive
question the user cannot see the answer to. Here Copy Tags on a tagless entity flashes `No tags` —
one query, on a click, with an honest answer — and Paste Tags is meaningful whenever the form is
open. A probe per page view to hide a button that costs nothing to press would be the tail wagging
the dog. If the empty click turns out to be common in practice, the hook is `copyBundle`'s own query.

## 6. Two colours, in one plugin

Copy Tags is `btn-info`, Paste Tags is `btn-warning`. The repo rule is "amber where a plugin wrote
this, teal where it only reads", and this plugin is the first here to have one of each. Copy only
reads; Paste changes the form, which is what the siblings' amber staging buttons do.

It also does something worth keeping: it tells the user at a glance which of the two is the safe
one. Do not harmonise them for symmetry.

The **settings** toggles follow the same rule and land on one colour: the console switch is teal like
every sibling's, and the bundle limit keeps Stash's blue, because it chooses what the clipboard
*holds* rather than starting anything. `tests/style.test.js` checks that every `#plugin-<id>-<key>`
selector names a key the `.yml` declares — a renamed setting drops its colour silently otherwise.

## 7. Three shared mechanisms this plugin correctly does not use

Each absence is a rule from the repo-root `CLAUDE.md` being followed by *not* registering, and the
suite pins all three together so a future edit cannot quietly add one:

- **No lease.** It announces a bulk write. There is none.
- **No `respecters` entry.** The flag means "I react to saves and will stand down". This plugin
  reacts to nothing, and registering would be a claim a sibling's dialog repeats to the user, and
  that claim would be false — worse than silence, which the other side already reads correctly as
  "not listening".
- **No `declares` entry.** The registry is for two plugins performing the *identical* relationship
  copy, keyed by a path id from `PropagateTagsAndPerformers`' vocabulary. There is no relationship
  here: the user picks both ends by hand. Any path id would be a lie, and the point of that registry
  is that a plugin can trust what it reads.

What it *does* register is `coop().order` (§5) and it answers `coop().debugButtons`, both because
its buttons genuinely share a row with two other plugins'.

## 8. The dialog

Shared chrome, byte-identical where it overlaps, pinned by `tests/style.test.js` across five plugins
now. Two plugin-local additions and one near-miss:

- **`.tbc-cols`, not `.tbc-panes`.** `CustomFieldsBulkEditor` already defines `.cfbe-panes` and it is
  a different layout (padded, `flex: 2 1 auto`, no divider). The suite caught the collision on the
  first run. **A class name two plugins share has to mean the same thing in both**, so the rename is
  the fix rather than forcing the values to agree.
- **`.tbc-tall` took `CustomFieldsBulkEditor`'s 88vh** rather than the 70vh it was written with, for
  the mirror-image reason: `.tall` *is* the same thing in both — a modal whose content changes while
  the user reads it and must not resize under the pointer — so two values would have been exactly the
  drift the suite exists to stop.
- **`Add`, not `Proceed`.** The three siblings enumerate every change into the log first, so Proceed
  means "write the plan above". Here the ticked boxes are the plan and the press is the whole action,
  which is what Add says. Same reasoning as `CustomFieldsBulkEditor`'s Apply, and the footer position
  is the harmonised one — the write button leads.

**Escape goes through the footer**, via `escapeButton`, like all four siblings. `cancelBtn` is
declared and always null: this dialog has no mid-write state to cancel, and a special case in
`escapeButton` would be a fifth copy of that function that is not the same function.

## 9. Testing

`node tests/run.js`, or `node tests/tagclip.test.js` alone. One suite, because the plugin is small
enough for one. It runs on `npt-harness.js` with a fake `localStorage` of its own.

Nine mutants confirmed, each failing exactly the check written for it: a strip found by class, no
queue trim, every stored entry accepted, ordering that ignores priority, a copy that stores an empty
bundle, `picked()` answering from the render instead of the live control, `picked()` ignoring the
form, a missing control read as an empty entity, and the diff removed from the one place it lives. A
tenth passed the whole suite and led to a deletion instead of a check (§4).

Two things the suite deliberately does *not* prove, and both are §10:

- that Stash's markup still looks like these fixtures;
- that `TagSelect`'s `onSelect` does what this plugin assumes on the three edit panels no sibling has
  exercised (Performer, Studio, Image).

## 10. What is unverified

Not one line of this has run against a Stash. The list, most likely to be wrong first:

1. **`.details-edit`-without-a-Delete is the edit form on Performer and Studio.** Neither page has
   been checked for it. Scene is confirmed (`.edit-buttons`); Group is confirmed for the fallback.
2. **The detail container on Studio and Image.** `PropagateTagsAndPerformers` 0.13.3 confirmed
   Performer and Group render a navbar and Scene and Gallery do not; these two were never observed.
   They will reach `ensureTabStripRow`, which is the safe direction.
3. **`TagSelect` on the Performer, Studio and Image edit panels.** The capture is confirmed live on
   Scene, and the design plan for `PropagateTagsAndPerformers` records that `TagSelect` is used
   across all of Stash's edit panels — but "used" and "its `onSelect` updates the chips" are two
   claims and only the first is sourced.
4. **The tag pill area on a detail view.** The README says Copy Tags is in the action row, which is
   where it is. The user asked for it *next to the tag pills*, and that markup has never been read,
   so it was not guessed at. Moving it needs one `outerHTML` paste from a Scene and a Performer
   detail view. If `PluginApi.patch.after` turns out to exist, the same paste settles whether Paste
   Tags can render straight after the `TagSelect` instead — which would be *less* code than the row
   placement, not more.

**Read "Anchoring in Stash's markup" in `PropagateTagsAndPerformers`' CLAUDE.md before changing any
anchor here.** Its lesson, paid for over four releases: a class confirmed on one page is evidence
about that page, and before moving an anchor, check that the current one is being *found*.
