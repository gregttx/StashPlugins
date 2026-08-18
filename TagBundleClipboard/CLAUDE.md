# CLAUDE.md — ᝯㄝₓ Tag Bundle Clipboard

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, the shared dialog chrome, the cooperation protocols) are in `../CLAUDE.md` and still
apply. The user-facing description is `README.md`; this file is for the reasoning that does not
belong in either.

**Status: partly verified. 0.2.0.** Two live passes in, and most of the guesses held — §11 records
what was confirmed and what it cost. It is still `0.x`: §10's list is shorter than it was and not
empty, and the major digit is the claim that the whole thing works.

| Step | | Version |
| --- | --- | --- |
| 1 | Scaffold: manifest, two settings, `CSS`, the shared chrome, `coop().order` | 0.0.1 |
| 2 | The clipboard, the `ENTITIES` table, the detail container, the **Copy** button | 0.0.1 |
| 3 | The `TagSelect` capture, the **Paste** button and its dialog | 0.0.1 |
| 4 | The `debugButtons` channel, README, `tests/tagclip.test.js` | 0.0.1 |
| 5 | First live pass: icon captions, the settings-type fix, the tag hierarchy, Prune/Roll Up, the tag hover, column layout, Undo | 0.1.0 |
| 6 | Second live pass: the column overrun, the caption's dots back, and Prune/Roll Up gated on `NormalizeParentTags` and obeying its tag exclusions | 0.2.0 |

Steps 1–4 landed in one pass, so they share a version rather than each taking a minor. The table is
kept because it is the order the parts depend on each other in, which is what a second pass over
this file needs.

---

## 1. The one property everything else is arranged around

**This plugin issues no mutation.** Not "issues few", not "issues them carefully" — none. A paste
puts tags into a captured form control and Stash's own Save commits them.

That single fact removes, in one go, most of what the three sibling plugins spend their length on:

- no `guarded()` / `_writeDepth`, because there is no write for a reactive plugin to see;
- no **lease**, because a lease announces a bulk write;
- an **Undo that is not a second mechanism** — it hands the control the list it held before, which
  is the same one call an Add is (§8e). The siblings' Undo has to put a mutation back and can only
  reach its own writes; this one has neither problem;
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
question the user cannot see the answer to. Here `⮺ Tags` on a tagless entity flashes `No tags` —
one query, on a click, with an honest answer — and `📋Tags...` is meaningful whenever the form is
open. A probe per page view to hide a button that costs nothing to press would be the tail wagging
the dog. If the empty click turns out to be common in practice, the hook is `copyBundle`'s own query.

## 6. Two colours, in one plugin

`⮺ Tags` is `btn-info`, `📋Tags...` is `btn-warning`. The repo rule is "amber where a plugin wrote
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

## 8b. Redundant parent tags: Prune and Roll Up in a dialog that removes nothing

The two operations `NormalizeParentTags` names, scoped to one paste and applied to **the plan**
rather than to the library. That scoping is the whole reason they can live here at all: this plugin
issues no mutation, so Prune cannot mean "take the parent off the entity" — it means "do not add
it". Roll Up is the same shape in the other direction, and both are inverses, which is why the
control is one three-way select instead of two toggles that can contradict each other.

**They are defined over the transitive closure, not over one edge.** `descendantsOf`/`ancestorsOf`
walk breadth-first with a `seen` set — the set is not an optimisation, it is a cycle guard, because
nothing in Stash forbids a cycle in the tag hierarchy and a plain recursion would hang the dialog on
one. The distinction is worth a test of its own: a chain the bundle carries *completely* prunes the
same rows either way, and only a bundle with a gap in it (`Hair` and `Platinum`, no `Blonde`) tells
a transitive walk from a one-edge one. That mutant passed the suite until the gap fixture existed.

**One pass settles Prune, and that is a property rather than a shortcut.** A tag pruned for having a
descendant on the entity cannot be un-pruned by that descendant later being pruned itself: the
descendant was pruned for having a descendant of *its* own, which is a descendant of the first tag
too. So there is no fixpoint loop here, and adding one would be dead code.

**The states are computed on every tick of a checkbox, not once.** Both modes are defined against
the *current* selection, so unticking the tag that was making a parent redundant has to bring the
parent back as an ordinary row immediately. That is why the change handler calls `render()` rather
than `updateCounts()` — a box can change its neighbours' states and the list's order, not just the
total.

**Held at `asis` while `_graph` is null.** A failed hierarchy read with the modes still live would
silently mean "nothing is redundant", which looks exactly like the mode having run and found
nothing. The select is disabled and the dialog says so in its log.

**Already-on-target beats rolled-up**, including for an ancestor the bundle never carried — Roll Up
has nothing to add where the tag is already on, so the row says the truer of the two things. It
*is* listed, though: the row is what explains why Roll Up stopped there.

## 8b². The modes are borrowed, so they are gated on the lender and obey its rules

Prune and Roll Up are `NormalizeParentTags`' operations. Two consequences, and they are one
decision rather than two:

- **They are only offered where that plugin is running in this page**, detected by
  `coop().respecters['NormalizeParentTags']` — the entry it registers unconditionally at load. Not
  an installed-plugin query: an installed copy this page never loaded has no settings worth
  mirroring either, and the `respecters` flag is the signal a sibling's dialog already reads to tell
  "will stand down" from "too old to know". Where it is absent the select is **hidden** rather than
  disabled (a one-option select is noise) and one INFO line in the log says why.
- **They honour its tag exclusions.** `splitTerms`, `nameMatchesAny` and `blockReason` are copied
  from it byte-for-byte, deliberately: the point is that a tag it protects is a tag this dialog
  leaves alone, and a near-miss in the matching would be a silent disagreement about which tags
  those are. Keep them in step the way the CSS and `coopObject` are kept in step.

**The mapping between the two vocabularies is the only translation, and it is worth stating.** Roll
Up adds, so it answers to the "never **add**" filters. Prune declines to add a parent, which reaches
the same end state as that plugin removing one — so it answers to "never **remove**". A tag its owner
has marked as never-to-be-removed should not lose its place here either.

**Its entity-level filters are deliberately not mirrored** (`b1ExcludeEntityWithTagName`,
`b2ExcludeOrganized`). Those keep an *automatic* pass off entities the user did not mean it to
touch; here the user opened this dialog, on this entity, by hand. Honouring them would mean a mode
that silently does nothing on an organized scene with nothing on screen saying why.

**A spared tag says so on its hover**, appended to the tag text: which plugin spared it and which
filter did. Where the spared tag is not in the bundle it is simply not listed — a row for a tag
nothing will do anything with is noise.

**Its settings cost no query.** `{ configuration { plugins } }` returns every plugin's block; Stash
cannot scope it, so the sibling's arrives with ours. The one thing that ordering costs is that the
hierarchy query has to wait for it (`settingsReady`), because whether to ask for `custom_fields` —
a map per tag, over the whole library — depends on whether either of its custom-field filters names
a key. Same conditional, same reason, as that plugin's own `tagQuery`.

## 8c. Five states, two axes, one `accent-color`

*Ticked* says whether the tag ends up on the entity; *colour* says who decided. Blue is the only
combination meaning "you decided, and it is on".

| | box | colour | live |
|---|---|---|---|
| `add` | ticked | blue (Stash's) | yes |
| `off` | clear | red | yes |
| `rolled` | ticked | amber | no |
| `pruned` | clear | grey | no |
| `have` | ticked | grey | no |

**`have` is ticked, and that was a change.** It shipped clear-and-disabled, which read as the
opposite of what the row beside it said — "already on this Scene" with an empty box. The tick is the
honest mark; the grey is what says it is not yours to change.

**One CSS property does all of it.** `accent-color` on the browser's own checkbox, never a rebuilt
control: five one-line rules, and the browser mutes the accent on a disabled box, which is the
effect wanted anyway — the three fixed states are meant to read quieter than the two live ones.

## 8d. Layout: columns from the platform, not from a breakpoint

The tag pane scrolls and the list **inside** it is left at auto height. That is what makes the
browser balance the rows across the columns rather than laying out one tall column and overflowing
sideways — a multicol box with a definite height fragments into more columns instead of getting
taller, which with `overflow:auto` becomes horizontal scrolling.

`column-width` is a *minimum*: the browser fits as many as it can and widens them to fill. So a wide
modal gets fewer, wider columns and a narrow one gets a single column, with no media query of ours
to keep in step with the modal's own `width:min(100rem,94vw)`. The user asked for columns sized to
the longest row; CSS gives equal columns instead, which is close enough that a hand-rolled measure
pass would be paying real complexity for the difference.

**A column box does not clip, so anything too wide prints over its neighbour** — which is what a
long tag name with no space in it did on the first live pass. The fix is two rules and **neither
works alone**: a flex item will not shrink below the width of its longest word until `min-width:0`
releases that floor, and once released the word still needs `overflow-wrap:anywhere` to be allowed
to break mid-word. `word-break:break-word` is not a substitute — it leaves the item's min-content
contribution unchanged, so the column stays too wide and nothing has moved. The floor has to be
released on the row as well as on the name, and the checkbox pinned at `flex:0 0 auto` so it is not
squashed by the same release. No test here has a layout engine, so the suite pins the class on the
element and the declarations in the sheet, and three mutants confirm it.

## 8e. Undo, which the siblings cannot have and this one can

The three sibling dialogs write to the library, so their Undo has to put a mutation back and can
only reach its own writes. This one only ever handed a list to a control, so its Undo is **the same
one call an Add is**, with an earlier list.

Snapshots, not diffs: `pasteTags` returns what the box held before, and `undo()` hands that back.
A tag added by hand between two presses therefore goes with the undo. That is said in the log rather
than guarded against — reconstructing which of the box's entries were the user's would be guessing,
and Stash's own Reset is behind it.

`setFormTags` is the single writer into the control, which is what stops Add and Undo from
disagreeing about what "put this list in the box" means.

## 8f. The diff is re-derived at the press, in `render()` and nowhere else

`picked()` reads `this._rows`, which `render()` built. So `add()` calls `render()` **first** and
reads the selection after. Without that line the press would use the answer computed when the list
was last drawn, and a tag typed into the box by hand since would be staged a second time — the exact
behaviour §4's deleted duplicate was there to prevent, arriving back through a different door.

The rule is unchanged and now has one home instead of two: **one place reads the control, and
everything else reads what that produced.**

## 9. Testing

`node tests/run.js`, or `node tests/tagclip.test.js` alone. One suite, because the plugin is small
enough for one. It runs on `npt-harness.js` with a fake `localStorage` of its own.

Mutants confirmed, each failing exactly the check written for it. From the first pass: a strip found
by class, no queue trim, every stored entry accepted, ordering that ignores priority, a copy that
stores an empty bundle, `picked()` answering from the render instead of the live control, `picked()`
ignoring the form, a missing control read as an empty entity, and the diff removed from the one
place it lives. A tenth passed the whole suite and led to a deletion instead of a check (§4).

From the 0.1.0 pass, eleven: Prune and Roll Up each walking one edge instead of the closure,
Roll Up skipping the ancestors the bundle does not carry, Roll Up ignoring already-on-target, the
group ranking dropped from the sort, `sort_name` ignored, `have` drawn clear, the mode select left
live with no hierarchy, the children edge dropped from the hover text, `undo()` popping without
handing the list back, and `add()` reading the selection without re-deriving it first.

From the 0.2.0 pass, twelve: the sibling gate removed from `classify` (not only from the control),
the select shown where the sibling is absent, each of the two protection checks dropped, the
custom-field filter reading a *value* rather than presence, the `ignore_auto_tag` rule dropped, the
term separator ignored, `custom_fields` asked for unconditionally, and — for the column overrun,
which no harness here can lay out — each half of the CSS fix and the class on the element.

**The one that did not fail is the one worth remembering.** A Prune walking a single edge passed
every check, because the fixture chain was fully populated in the bundle — one edge and the closure
prune the same three rows there. It took a bundle with a *gap* in the chain to tell them apart
(§8b).

Two things the suite deliberately does *not* prove, and both are §10:

- that Stash's markup still looks like these fixtures;
- that `TagSelect`'s `onSelect` does what this plugin assumes on the three edit panels no sibling has
  exercised (Performer, Studio, Image).

## 10. What is unverified

Shorter than it was — §11 is what emptied most of it. What is left:

1. **The detail container on Studio and Image.** `PropagateTagsAndPerformers` 0.13.3 confirmed
   Performer and Group render a navbar and Scene and Gallery do not; these two were never observed.
   They reach `ensureTabStripRow`, which is the safe direction.
2. **`⮺ Tags` shows on every tab, not only the detail one.** Confirmed live on Scene, Image and
   Gallery, where the row sits under the tab strip and the tab strip does not go away when the Edit
   tab is open. It contradicts the original spec and was left alone at the user's call ("no big
   deal"); the fix, if it is ever wanted, is to read the strip's active tab rather than to guess a
   container. Note it is not obviously an improvement: copying the tags off the entity you are
   editing is a real thing to want, and hiding the button would mean switching tabs to do it.
3. **The tag pill area on a detail view.** The README says `⮺ Tags` is in the action row, which is
   where it is. The user asked for it *next to the tag pills*, and that markup has never been read,
   so it was not guessed at. Moving it needs one `outerHTML` paste from a Scene and a Performer
   detail view. If `PluginApi.patch.after` turns out to exist, the same paste settles whether
   `📋Tags...` can render straight after the `TagSelect` instead — which would be *less* code than
   the row placement, not more.
4. **The tag hierarchy query on a large library.** `findTags(filter:{per_page:-1})` with
   `description` and `aliases` on every row is the biggest payload this plugin asks for, and it has
   only been reasoned about. It is one query per page, cached for the page's life; if it turns out
   to hurt, the cheap first move is dropping `description` and fetching it per bundle instead.

## 11. What the live passes settled

Both on 2026-08-18, against the user's own Stash.

### Second pass (0.2.0)

- **A long tag name with no space in it printed over the next column.** §8d has the fix and the
  reason `word-break:break-word` alone does not do it.
- **The `"..."` came back on the paste caption.** §11's first-pass note below has the argument that
  shipped and the argument that replaced it: an icon says what a button is *about*, not what
  pressing it *commits to*.
- **Prune and Roll Up are gated on `NormalizeParentTags` and obey its exclusions** (§8b²). This was
  the user's call and it is the right one for a reason worth keeping: borrowing another plugin's
  operation while ignoring that plugin's "never touch this tag" settings would leave one plugin
  protecting a tag and another quietly acting on it in the same library.

### First pass (0.1.0)

Four of §10's five items closed:

- **`TagSelect`'s `onSelect` updates the chips on Group, Image, Performer, Studio and Scene.** This
  was the assumption the whole plugin rests on and it held on every panel checked. §4's reasoning
  about `useTagsEdit()` is confirmed rather than merely sourced.
- **`.details-edit`-without-a-Delete is the edit form on Performer and Studio.** `📋 Tags` lands
  just before Save on both, exactly as it does everywhere else.
- **The two icon captions.** `Copy Tags` / `Paste Tags...` became `⮺ Tags` / `📋Tags...` at the
  user's request. The paste button shipped once *without* the repo's `"..."` suffix, on the argument
  that an icon does what the dots do, and that was taken back a release later: an icon says what the
  button is **about**, and the dots say what pressing it **commits to**. Those are different
  questions, so one does not stand in for the other. The convention holds for icon captions too.
- **`type: NUMBER` renders `0` for an unset setting.** Not blank, not the documented 5 — a number
  that is neither, in the only NUMBER setting in this repo. It is `STRING` now, which is what every
  other free-text setting here already used and what `maxBundles` was parsing either way. **A
  setting type is a UI decision as much as a storage one**, and "unset" has to be a state the box
  can show.

One thing observed and not ours to fix: **Stash's Image and Gallery edit panels render Save and
Delete with no Cancel**, where Scene and the others have one. Read off `develop` on the same day —
`ImageEditPanel.tsx` and `GalleryEditPanel.tsx` build their `.edit-buttons` row from those two
buttons only. No issue is filed for it upstream.

**Read "Anchoring in Stash's markup" in `PropagateTagsAndPerformers`' CLAUDE.md before changing any
anchor here.** Its lesson, paid for over four releases: a class confirmed on one page is evidence
about that page, and before moving an anchor, check that the current one is being *found*.
