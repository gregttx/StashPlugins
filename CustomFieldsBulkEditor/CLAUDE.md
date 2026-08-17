# CLAUDE.md — ᝯㄝₓ Custom Fields Bulk Editor

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, the bulk-edit lease, the shared dialog chrome, the `ᝯㄝₓ ` name prefix) are in
`../CLAUDE.md` and still apply. The user-facing description is `README.md`; this file is for the
reasoning that does not belong in either.

**0.9.0's two filter modes, all of 0.10.0, all of 0.11.0, all of 0.12.0, all of 1.0.0, all of
1.1.0 and the stale-script banner of 1.2.0/1.3.0 are unverified** — §5b's truth modes, §5c's fixed height, §5d's divider and box sizing, §5e's three text
filters, §6a's Rename, §6b's scope switch, §24's three and §25's. Every one of them came from live use of
the dialogs (the shrinking window was reported, not deduced; so was the description box being too
small for what it holds, so was "Overwrite" reading as if it cleared an entity's whole set of
fields, and so was the hide field reading as an orphan), but nothing in any of the fixes has been
clicked: it is `tests/cfbe.test.js` at 218 checks, `tests/cfbe-desc.test.js` at 90, and twenty-five
mutants across the six releases.

**2.0.0 is a rename, and this plugin is the one it broke.** The `GTTx ` prefix is now `ᝯㄝₓ `, in
the `.yml`, the `manifest`, `PLUGIN_NAME`, `PLUGIN_SHORT_NAME` and the fixtures in
`tests/cfbe.test.js`, `tests/cfbe-desc.test.js` and `tests/cfbe-task.test.js`. The folder, the
plugin **id**, both setting keys and the description store's tag are untouched, so an upgrade keeps
its configuration; this is the plugin's first major digit that is not the 0.x claim, and it means
what §2's note says a rename means.

**It shipped as a live bug first, which is the point worth keeping.** The four manifests were
renamed a session before the scripts. The three siblings' settings pages carried on looking normal
— they find their group through the `plugin-<id>-<key>` ids Stash builds from the plugin id, and
match the heading only as a fallback — and this one's went undecorated with no error, no console
line and nothing to distinguish it from a plugin that had simply not loaded. That is exactly the
exposure §2 flagged when the heading became the only route in: **the sole anchor here is the one
piece of markup that a rename moves**, and it fails silently rather than loudly. Nothing about that
has changed and there is still no second route; what the episode adds is the failure's shape, for
the next time a name moves. `ownTaskName` was in the same position and was hit too, along with all
three siblings', since none of them has an id route for a task button either.

**1.3.1 finishes the README pass the siblings had at their own 1.4.1 / 2.6.1 / 2.4.1.** This
plugin's release-note blocks all went at 1.3.0, but two version references survived in
Troubleshooting - "that is the bug 0.1.1 fixed for four of them", "that is what 0.1.2 fixed for tags
and studios" - which is the exact shape the rule is against: someone reading a troubleshooting entry
wants to know whether their case is handled, and a release number does not answer that. Both now say
what *is* handled and name it (the four aliased routes; a row linking to a relative of its own
type), so the entry is useful to a reader who has never seen a changelog. Nothing in that file
carries a version now but the Stash requirement. The standing rule is in the repo-root CLAUDE.md
under "A README describes the plugin, not its history".

**1.3.0 puts the same warning in the dialogs.** The version check was always there and always
blocked Apply; what changed is that its message is a box of its own (`.cfbe-stale`, the settings
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

**Both dialogs get it from one place.** `DescRun` borrows `showStale` the way it already borrows `show` and `checkVersion`, so the descriptions dialog needed nothing but the box in its own head. And the log line goes through `msg`, not `log` - this plugin's `Run` has no `log`.

**1.2.0 tells the user the script is stale, where they can see it.** Stash serves plugin JS with
caching on, so a browser can go on running the old file after an update with nothing on screen
saying so - and the settings heading is the one place the two numbers meet, since Stash builds it
as `${name} (${version})` from the **manifest**, read fresh from the server, while
`PLUGIN_VERSION` is what the browser actually loaded. `ensureStaleNotice` compares them on the
settings tick and puts a red banner in this plugin's own group when they disagree, naming both
numbers and **Ctrl+Shift+R**. All four plugins gained it in one release, byte-identically, like
every other shared mechanism here; the repo-level notes are in the siblings' files and the rules are
the same. Two things are this plugin's own:

- **The heading is handed back by `ownParts` rather than re-found.** This is the one plugin whose
  only route into its own group *is* that heading (§10), so re-running the fragile half to read a
  number off it would be paying the risk twice. `ownParts` now returns `heading` beside `group` and
  `sub`; everything else reads the same.
- **It costs no query**, which matters here more than in the siblings: `tests/cfbe.test.js` pins
  this plugin's settings page as issuing none at all, and that check would have caught a version
  read that went to the server.

`checkVersion`'s dialog note gained the same key at the same version - the other three already said
"if this warning comes back, hard-refresh with Ctrl+Shift+R" and this one stopped at "reload the
page", which is the sentence a cached script survives.

**1.0.0 is the user's call, not this file's.** The repo rule is that the major digit says a plugin
has been used in a real Stash and that the unverified list above is empty; the first half is true —
the menu item, both dialogs, the task and the descriptions store are all in daily use — and the
second is not. The bump was asked for explicitly, so it is the user's claim about their own
instance rather than a conclusion drawn here. What that changes going forward: a patch per fix, a
minor per delivered capability, and this paragraph goes when the list above does.

**Status: 1.3.1 — §22–§23 are being used, and the first reports are in.** Everything those two
sections describe was written in one branch (`cf-descriptions`) from a specification, against schema
read off `stashapp/stash` `develop` on 2026-08-16. The dialog **opens, scans, writes and is being
typed into** in a live Stash as of 2026-08-16, which is what 0.8.1 answers: Apply locked the box
until a Rescan (§22a), and both STRING settings read as empty until edited (§22b). What is still
unverified: Undo, Prune, Migrate, the version gate, and every one of the six dropdowns §23 filters.
The suite covers all of it — 84 checks in `tests/cfbe-desc.test.js`, each confirmed against a
deliberately broken copy — but it reproduces Stash's answers from notes, which is exactly the limit
stated at the end of §9.

**Status of everything before it: 0.7.3 — partly verified.** The user has it installed and has reported back, which is the
first real evidence any of it works: the menu item, the dialog and the entity types it offers are
being used. §8's table was walked live on 2026-08-13 and is **confirmed** for `/tags` in card mode;
what is *not* verified is the table view, an aliased route, an Apply, and §12's write. §12's task, dialog and read **are** confirmed live on 2026-08-13, over 155,012 entities. The pills (§5a) and the
value filter's "is empty" mode (§5b) **are** — both requested from live use and confirmed working
there, the pills after two reports and the filter after 0.2.5 made the plugin loadable again. §10 is
confirmed too, at 0.3.2: the description collapses behind **Show more** with the README linked under
it, and no task description is touched. §13's five additions came out of that same live task run and
are unverified, as are §14–§21 — every one of them a text, layout or logging change asked for from
live use and shipped without a live click behind it. The gallery-images gap reported 2026-08-12 is **closed** at 0.1.1, along with three more
list views that had the same cause (§2); the undercounted tag and studio selections reported
2026-08-13 are closed at 0.1.2 (§3).

**0.4.5 says "id", not "Stash id", and never "(s)".** Two repo-wide wording rules landed together, and
both are in the root `CLAUDE.md`. *Stash ID* is already Stash's own name for a **stash-box**
identifier, so calling the local database id one was a claim about a metadata provider that had
never been consulted - every dialog head, legend and README here now says **id**. And every
generated `3 scene(s)` / `2 child(ren)` now agrees with its own count, through one
`plural(n, one, many)` helper held byte-identical in all four plugins beside `coopObject`.

0.1.0 is the settings-page description (§10) and Escape (§11), both new capability rather than
fixes; 0.1.1 is §2's route fix and 0.1.2 is §3's; 0.2.0 is the pill listing (§5a), and
0.2.1–0.2.3 the empty-marker rounds and 0.2.4 the value filter's "is empty" mode (§5b), which 0.2.5
had to reissue after an unescaped quote in its own `.yml` stopped Stash loading the plugin at all;
0.3.0 is the library-wide task (§12), 0.3.1 its paged read and 0.3.2 the anchor fix in §10; 0.4.0 is
§13, five things the task dialog wanted once it held a whole library; 0.5.0 is §16, one log in the
order things happened, 0.6.0 is §17, every skip saying why, 0.7.0 is §18, the first setting, and
0.7.1 is §19, the footer in the siblings' order, 0.7.2 is §20, the last line
of the log back on screen, and 0.7.3 is §21, the dropdown marker.
350 automated checks cover the plugin across its three suites, and they still
reproduces Stash's markup **from notes** — it can only confirm the plugin is consistent with what it
was told.

**The major digit is a claim to the user that the thing works, and only a live click can support
it.** This shipped at 1.0.0 first, on the reasoning that the feature was complete and indivisible;
that reasoning is about the *code*, and the digit is about the *user*, so it was corrected to
0.0.1. See "A new plugin starts at 0.0.1" in the repo-root `CLAUDE.md`. It reached 1.0.0 again at
§24 — this time because the user, who runs it, asked for it; see the note at the top of this file.
That is the only thing that can move a major digit here, and it is not something to reason your way
to on a plugin's behalf.

**It was the smallest plugin here by a wide margin, and 0.8.0 is where that stopped being the
design.** Until then: one setting, no automatic mode, no fetch wrapper, and two entry points that
both opened the same dialog. It now has three settings, a second dialog with a second task behind
it (§22), and a `window.fetch` wrapper that filters six of Stash's own queries (§23). What has *not*
changed is that nothing runs on its own: the wrapper answers Stash's reads and writes nothing, and
every write still comes from a button in a dialog. Since 0.1.0 it also decorates its own block on
the settings page (§10), which is presentation rather than an entry point.

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

**`ROUTE_ALIASES` is the exception list, and 0.1.1 is what earned it.** Reported live: a gallery's
own Images tab drew no menu item. The cause is that its URL is not `…/images` — Stash's detail-page
tabs go through `useTabKey`, which writes the tab into the path as `<base>/<tabKey>`, and three tab
keys are not the plural of what the tab lists; a gallery is worse still, since `Gallery.tsx` routes
its right-hand tabs by hand and its images tab has **no segment of its own at all**. Four views, one
cause:

| URL | Lists |
| --- | --- |
| `/galleries/<id>` | Images |
| `/galleries/<id>/add` | Images |
| `/groups/<id>/subgroups` | Groups |
| `/studios/<id>/childstudios` | Studios |
| `/performers/<id>/appearswith` | Performers |

**Read off `stashapp/stash` `develop`, 2026-08-13** — `Gallery.tsx`, `Group.tsx`, `Studio.tsx`,
`Performer.tsx` and `Shared/DetailsPage/Tabs.tsx` — not inferred from the one page that was
reported. All five render the same `Filtered*List` as the top-level list, with the same "..." menu
and the same selection, which is what makes one alias table the whole fix. That sweep is also what
says the list is complete for today's Stash: every other tab key *is* the plural it lists, and
`/tags/<id>/markers` correctly resolves to nothing.

**Matched on the whole path, never on the tail.** `add` alone is far too common a segment to hand to
an entity type on sight, and the type it would be handed to is the one that then gets written.

**The rejected fix, kept because it will be proposed again: infer the type from the checked rows.**
Genuinely ambiguous — `rowEntityId` climbs to the first ancestor linking to exactly one id **of the
type it is given**, and a scene card links to its studio and its performers as well as itself, so
probing every type against the rows matches several. The URL is what disambiguates, which is why the
fix is to teach it four more URLs rather than to stop reading it.

**A URL this table does not know still fails safe**: `listType()` returns `null`, no item is drawn,
and `debugButtons` says "not a list view" — which is the line the README now tells the user to
report.

## 3. Turning a selection into ids

The hardest part of the plugin, and the part with the least evidence behind it. Stash's list
selection lives in React state this plugin cannot reach, so it is read off the DOM: a **checked
checkbox** says a row is selected, and the row's own **detail link** says which entity that is.

**More than one distinct id under an ancestor that is not a row means it is a container.**
`rowEntityId` climbs from the checkbox and stops at the first ancestor that links anywhere; one id is
the answer. This is not tidiness — a table view's **select-all** checkbox sits in the header, whose
nearest linking ancestor is the whole table, so accepting a multi-id answer would silently widen
every write to the entire list. A card that links to itself twice (its image and its title) still
gives one id, which is why the rule is "one *distinct* id" rather than "one link".

**But a row can carry a second id of its own type, and 0.1.2 is what that cost.** Reported live:
selecting 1783 tags produced 583, and 1000 studios produced 562, while scenes, groups and performers
were exact. The cause is in `TagCard.tsx` and `StudioCard.tsx` (and both list tables): a tag names
its **parent tag** and a studio its **parent studio**, as a link of the same type the route matches
— so every tag and studio with a parent was a two-id answer, and every one of them was refused. Two
thirds of a real tag list, silently absent from a selection the user had just made.

**The row's own id is the one it links *twice*.** `GridCard` renders `CardNavLink` at `props.url`
for both the thumbnail and the title, and `TagListTable`/`StudioListTable` do the same with the
image cell and the name cell; a parent gets exactly one link in either view. So a multi-id answer is
resolved by taking the id with **strictly** the most links, and a tie is still a refusal.

**That tie-break is applied only inside a row** — `<tr>`, or a `grid-card` class, both read off
`stashapp/stash` `develop` on 2026-08-13. Counting links across a *container* would resolve a
select-all in a studio list to a single studio, because a studio that is the parent of many others is
linked more than any other id in that table. The multi-id refusal is what protects the whole list
from a select-all, and the tie-break must not be able to reach it; `tests/cfbe.test.js` drives
exactly that table.

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

- **No `.log` of rendered lines — the listing is a stack of `.cfbe-entry` pill lines.** It was a
  `<textarea>` until 0.2.0, for a reason worth keeping in view: a textarea is *one* node for any
  number of lines, where the siblings have to cap what they render (`LOG_RENDER_CAP`) because one
  node per line stops responding at six figures. Pills are markup, so that cost is back and
  `LIST_RENDER_CAP` is the same answer — see §5a. `.cfbe-log` is still the wrapper, so the shared
  rule still does its job (flex, scroll, monospace).
- **The `.cfbe-line` messages are in the listing, not beside it** — warnings, errors, the applied
  recap, each appended where it happened. They had a `.cfbe-msgs` strip of their own until 0.5.0;
  see §16 for why one box beat two.
- **The per-setting tooltip CSS is here since 0.7.0**, which is when the plugin got its first
  setting to hang one on — four rules, byte-identical with the siblings' copies (§18). It carried
  only the **description** rules before that, under `tests/style.test.js`'s `settings: false` flag;
  no plugin here sets that flag today. See §10, and the repo-root CLAUDE.md for why the description
  half is required of every plugin regardless.

**The state machine is four states, and the pairing is deliberate.** `loading → listing →
applying → applied`, with `undoing` returning to `applied`. Cancel/Apply and Undo/Close never
overlap: after an Apply the listing describes a library this dialog has already changed, so offering
Apply again over it would write from a plan nobody is looking at. **Rescan re-reads the same scope
without closing** — the selection is the scope and it does not change while the dialog covers the
list it came from, so a rescan is a fresh read of the same entities rather than a fresh selection.
Widening the scope still means closing and reselecting.

**The version gate is the only warning here that blocks**, exactly as in the siblings, and **Undo is
never gated on it**: stranding the user with changes they cannot take back is worse than the
mismatch. Everything else (another plugin's lease) is stated and carried on with.

## 5a. The pill listing (0.2.0)

Requested from live use, and the shape is the request's: a line is
`<Type> {"name" (id)}: {field}🟰{value}`, and after a write the same line with an action pill in
front and a before ⇒ after. **Three pill kinds, three behaviours, and the kinds are what the
behaviours are for** — `.cfbe-pill-act` states what happened and does nothing, `.cfbe-pill-ent` is
an `<a>` to that entity's detail page in a new tab, `.cfbe-pill-cf` copies its own text.

**The line class is `.cfbe-entry`, not `.cfbe-row`.** `NormalizeParentTags` defines `.npt-row` for
the hierarchy viewer's tree, which is a different thing with different rules, and
`tests/style.test.js` compares selectors with the prefixes stripped — so the obvious name would have
been pinned against a rule it has nothing to do with. Same reason two dialogs may not both call
something `.cfbe-list` unless they mean it.

**The action is read off the two sides, never off the mode.** `!before ? 'Added' : !after ?
'Deleted' : 'Replaced'` — which is what makes an undo name itself correctly rather than repeating
the word the apply used. Reversing an Added is a Deleted, and `renderChanges` swaps the sides for
an undo, so one expression covers both directions.

**The empty marker (`␀`) marks two different things, and took three rounds to get right.**

The report was "∅ is not shown — it is replaced by an empty pill", and 0.2.1 read it as a missing
glyph (the marker was `∅` then): the list is `font-family: monospace`, so `.cfbe-none` took that one span out of the monospace
stack. **That was the wrong diagnosis, and the evidence to reject it was already on the page** — the
user's own entity names contain ∅ (their tag taxonomy is built out of Unicode marks), and those
render in this dialog, in these pills, in that font. A character rendering elsewhere on the same
line is the check to make *before* blaming a font.

The actual cause is that ∅ was only ever drawn where a field is **absent**, and an **empty value**
is a different thing that was drawn as a pill with nothing in it — which is what an empty pill is.
Both now get the mark: `appendField` for the absent side, `copyPill` for a value or name that is the
empty string.

**The mark was `content:` on an empty span for one version, and 0.2.3 is what that cost.** Drawing
it in CSS made the guarantee structural — a mark on the screen and nothing in the string, so a
copied line carries the value the entity really has. But **generated content cannot be selected**:
dragging across a line painted no highlight over the mark, so the selection looked like it had a
hole in it. Reported live, and it is the right trade to reverse: the mark is real text again, and
the guarantee moved into `selectionText`.

**`selectionText` drops the mark *elements*, never the mark's character.** It clones the selected
range, removes every `.cfbe-none` in the clone, and reads the text back. Stripping the character
from the string would have been three characters shorter and wrong: an entity name is free to
contain it, and **this user's names are full of Unicode marks** — which is also why changing `NONE`
stays a one-line change. `tests/cfbe.test.js` pins that with a name holding the mark character, and
the character-stripping mutant fails exactly that check and nothing else.

`cloneContents` keeps the ancestors of a partial selection, so a multi-row selection arrives as one
`.cfbe-entry` per line and a within-one-row selection as the pills themselves — hence the newline
between entries only. Joining every child with one would break a single line into its pills.

**The character is the user's to choose, and they chose `␀` (U+2400).** It was `∅` (U+2205), which
they found too close to a zero at this size. `⦰` (U+29B0) was offered in the same message and
declined: the character was never the problem, and it is the rarest glyph of the three. The `title`
is what says which of the two meanings a mark carries.

**`display:inline` on the pills, not `inline-block`.** A selection dragged across inline-*block*
elements copies with line breaks nobody selected, and copying the listing as text is why the list
exists. Vertical padding is 0 for the neighbouring reason: on an inline box it would overlap the
line above rather than grow the line.

**The copy handler is on the list, and rewrites both flavours.** A copy out of markup carries the
markup, so the `copy` listener puts `getSelection().toString()` on the clipboard as `text/plain`
*and* as an escaped `text/html` — without the second, a rich editor pastes the pills back with their
colours. This is the one thing here that the test suite cannot reach: the harness has no selection.

**A pill click with a live selection does nothing**, because a drag-select that happens to end
inside a pill fires a click, and copying the pill there would take the clipboard off the selection
the user just made. A plain click has already collapsed the selection by the time it arrives, so the
guard costs nothing in the normal case.

**`copyToClipboard` is the siblings' function, minus the caption swap.** Stash is commonly served
over plain HTTP on a LAN, where `navigator.clipboard` does not exist at all, so the
textarea + `execCommand` path is the fallback rather than a legacy branch. A pill reports by
flashing a class for 900ms; it must not rename itself, because its text is the thing being copied.

**`LIST_RENDER_CAP` is what the pills cost.** One node per line is back — six or so, in fact — so
the listing is cut at 1000 rows with a line saying how many are not shown. **The cap is on the
render, never on the scope**: the counters and every write still describe the whole listing, and the
overflow line says so, because a user who reads "1000 lines" and applies to 5000 entities has been
lied to by the dialog.

## 5b. "is empty" is a mode, not a word you type (0.2.4)

**An empty filter box means "no filter", so it can never be how you ask for the empty ones** —
typing nothing is how you ask for everything. Reported live: "an empty value in the filter shows
everything." The query needs a spelling of its own.

**Every in-band spelling is ambiguous, and the ambiguity is not theoretical.** This shipped first as
"type `␀` on its own into either box", reusing §5a's marker, and was rejected within the hour: it
cannot tell a value that *is* `␀` from one that is empty. `""`, `<empty>`, `NULL` all fail the same
way — **any sentinel a text box can carry is also a value somebody is allowed to have**, and this
user's values are full of Unicode marks. The fixture in `tests/cfbe.test.js` gives one entity
`rating: '␀'` for exactly that reason: the check that the marker is ordinary text under *contains*
is what stops the ambiguous design being reintroduced.

**So the mode is a `<select>` beside the box** — `contains` (default) and `is empty` — and
`filtered()` branches on it rather than on the text. Out of band, so nothing typed can be mistaken
for it. The box is `disabled` in `is empty` mode: the mode is the whole query, and a live box would
read as a second condition that is silently not applied. `.cfbe-input:disabled{opacity:.5}` because
these inputs paint their own background, so the browser's disabled look does not show through.

**"is not empty" is deliberately absent.** Nobody has asked for it, and it is one more entry in the
options array the day somebody does. Note that `contains` with an empty box does *not* cover it —
that is no filter at all, and the empty ones show along with everything else. **0.9.0 is the day
somebody did**, near enough: what was asked for is the *truth* pair below, and "is not true" covers
the empty ones along with `0` and `false` — which is what a user filtering on a flag actually wants.
A bare "is not empty" is still absent, and now has even less reason to exist.

**0.9.0: `is true` and `is not true`, on the same predicate §23 hides an entity by.** The trigger was
a list of exactly which values read as false — `""`, `"0"`, `"false"`, a JSON `0`, a JSON `false`,
and whitespace-padded versions of the strings — and the observation that nobody is going to type
those one at a time into a `contains` box. Three things fix the shape of it:

- **One predicate, not two.** `isMarked` moved up beside `valueText` and is now read by both the
  listing and the fetch filter. A custom field is a string map with no boolean in it, so this
  function *is* what "true" means in this plugin; a second answer to the same question — one hiding
  an entity from a dropdown, one listing it as true — would be a bug waiting for whichever value
  fell between them.
- **Judged on the raw value, so `raw` joined `value` on the row.** `valueText([])` is `"[]"`, which
  reads as true as text and is not true as a value — and the dropdown filter never sees the text at
  all. The fixture pins that case for exactly this reason.
- **The rule goes on the control.** `"no"` and `"off"` are *true* by this predicate, which is
  surprising enough that leaving it to a release note would be a trap; the mode `<select>` carries a
  `title` saying so. This is the one place in the plugin where a control explains its own semantics
  rather than the head legend doing it — the legend describes the listing, and this is a definition.

**0.2.4 did not load at all, and the reason is worth more than the feature.** The sentence added to the `.yml` description named the new mode in quotes, and that description is a double-quoted YAML scalar — which ends at the first unescaped quote. Stash could not parse the manifest, so it dropped the **whole plugin**, not the description. Every other quote in that string is `\"`; the two new ones were not, because they arrived through a `sed` and nothing read the result. `tests/version.test.js` now strips each backslash escape and fails on any quote still standing — a check that costs one line and catches the class. The reason the suite was silent before is that its description regex is greedy, so both files still captured the same broken string and the mismatch check passed.

**The check is the escape, not a YAML parse.** There is no YAML library here and adding one would make the check optional the way `jsdom` makes `placement` optional — skipped on exactly the machine that needed it.

**The name filter gets no mode** — *until 0.12.0, and the reason it got one then is not the reason
it was refused here.* A custom-field key is never the empty string, so none of this section's modes
has anything to offer it. §5e's pair is a different question: it is about the *direction* of a
substring match, which every text box has.

**It reaches the write through the door that already exists.** "Apply to → Filtered list only" is
defined as the entities the filters leave showing, so "set this on exactly the ones that have
nothing" needed no code in §7 at all.

## 5c. Both dialogs are a fixed height, and the siblings' are not (0.10.0)

**Reported live: the dialog "shrinks down" when you drag the description box taller, or change a
filter.** It did, and the cause is one declaration. `.cfbe-modal` sets `max-height:88vh` and **no
`height`**, inside a backdrop that centres it — so the modal is *content-sized*, and every content
change resizes the window: filter a listing down to three lines and the whole dialog collapses
around them; drag the `textarea` in the descriptions dialog and the modal grows to the cap and then
takes the room out of everything else.

**That rule is right for the plugins it is shared with.** It is pinned byte-identical across all
four (`tests/style.test.js`), and the siblings' dialogs are a head, a log and a footer — a box that
sizes to its log is the correct behaviour there. These two are not that: one has a filter bar over a
list, the other has two panes and a user-resizable box in one of them.

**So `.cfbe-modal.cfbe-tall{height:88vh}`, a modifier, exactly as `.cfbe-listwrap` is one.** The
shared rule is untouched, the plugin-specific selector is invisible to the pinning check (it exists
in one plugin, so there is nothing to compare it against), and the panes inside now do the giving
and taking that the window used to do. Do not "fix" this by editing `.cfbe-modal` — that changes
three other plugins for a complaint about this one.

## 5d. Who gets the room inside the descriptions dialog (0.11.0)

Once §5c stopped the *window* moving, the question of how the fixed height is divided became the
user's rather than the layout's. Three parts, and they are deliberately three different mechanisms:

**The description box is dragged by the browser.** `.cfbe-text` is `resize:vertical`, which is a
native grip and needs no code. Nothing here reimplements it.

**The panes-over-log divider is the one place that needs a handle of its own**, because a flex
column gives no grip between two boxes. `splitter(above)` returns a `.cfbe-divider` bar that pins
`above.style.flex` to a pixel height on drag, so the log below takes what is left. Three details
worth keeping: the `mousemove`/`mouseup` listeners go on **`document`**, not on the bar — a fast
drag leaves the pointer behind and a `mouseup` off the 10px bar would never arrive, latching the
drag; `preventDefault` on `mousedown` stops the text selection a drag over a log otherwise makes;
and the clamp has both ends, since `.cfbe-log` and `.cfbe-foot` have `min-height`s that stop them
shrinking and an unclamped drag pushes the footer off the modal.

**The description box grows to what was just loaded, and only then.** `sizeText()` clears the
height, reads `scrollHeight`, and sets the smaller of the content and **four fifths of the pane** —
so a long description is read without scrolling and the entity list under it never disappears. The
floor is the CSS `min-height`, which is why it only ever sets a *bigger* height: a short
description lands back on the default split rather than on one line. It is called from `pick()`
alone. **Do not call it on input**: the box is user-resizable, and re-sizing a box someone has just
dragged is the plugin fighting them.

**The two boxes have titles because neither is obvious from its contents** — one is typed into and
one is read-only, and before this the single head above the box described *the entity list*.
`DESC_HEAD` / `USERS_HEAD` are constants because both strings are used twice, once in the empty
state and once with the field name in them.

## 5e. Three text filters, one shape (0.12.0)

Asked for from live use: "omits" on the value filter, "contains and omits" on the name filter, and a
third filter over the entity itself.

**One `TEXT_MODES` array and one `textMatch`, not three of each.** The value filter's `<select>` is
`TEXT_MODES.concat(...)` — its three §5b modes are the *extension*, and the two directions are the
base every text box here shares. `needsText(mode)` is the one predicate deciding whether a mode
reads the box beside it, and it is read in both places that ever cared: the `disabled` toggle and
`filtering()`.

**An empty box filters nothing in *either* direction.** "Omits nothing" is every row, not none — the
only reading that keeps "clear the box" meaning "no filter", which is §5b's founding rule. It also
makes the mode alone not a filter, which is why `filtering()` tests `!needsText(...)` rather than
`mode !== 'contains'`: the naive test switches **Apply to** to *Filtered list only* (§6b) the moment
someone picks "omits", before they have typed anything, silently narrowing a scope for no narrowing
at all.

**The entity filter matches `name (id)`, not the pill's own text.** `entityText(r)` builds
`Cool Scene (42)`; `entityPill` renders `"Cool Scene" (42)`. The difference is one pair of quotes,
and matching the pill would mean `Cool Scene (42)` — typed exactly as the row reads to a human —
finding nothing, over a quote nobody thinks of as part of the name. The two are deliberately not
the same string, and the box carries a `title` saying which shape it wants. It is the only filter
whose subject is not on the line as plain text, which is why it is also the only one that has to
explain itself.

**Classes: `cfbe-filter-namemode` / `cfbe-filter-entmode` / `cfbe-filter-ent`.** The value mode kept
`cfbe-filter-mode` — three selects sharing one class would break every `one(env.body, ...)` lookup
in the suite, and the value mode is the one that was there first.

**The filter row wraps, through a modifier.** `.cfbe-search` is one of the chrome selectors pinned
byte-identical across the four plugins, so the `flex-wrap` goes on a `.cfbe-search-wrap` beside it —
the same escape hatch `.cfbe-tall` (§5c) and `.cfbe-listwrap` are.

## 6. The four modes, and the one distinction the data allows

A custom field holds **one value per key**, so there is no list to append to and Stash's own
Overwrite/Add/Remove tabs do not transfer. Here:

- **Add** — `partial`, on entities that do **not** already carry the key. "Do not overwrite."
- **Overwrite** — `partial`, on every entity in scope.
- **Remove** — `remove: [name]`, on entities that **do** carry it.
- **Rename** (0.10.0) — `partial: {new: value}` **and** `remove: [old]` in one input, on entities
  that carry the old key. See §6a.

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

**Every mode carries a tooltip, on the option and on the select** (0.10.0). An `<option title>` is
honoured by some browsers and ignored by others, so the select's own `title` is set to whichever
mode is currently chosen — the reliable half. The four differ in what they *refuse*, which is the
part a one-word caption cannot carry: "Add" never overwriting is the one that has surprised people,
and Rename's precondition is what explains a greyed-out option. **Apply to** is tooltipped the same
way, and its *Filtered list only* tip says the filters switch to it on their own, so the behaviour
in §6b is discoverable from the control it moves.

**Overwrite and Remove had to say what they leave *alone*, not only what they touch** (0.12.0).
Reported live: "replacing whatever is there" reads as replacing an entity's whole set of custom
fields. The plugin never did that — `full` is refused above for exactly this reason — but the
tooltip was the only place a user could have learned it, and it did not say. Both now name the
scope of the write as **one field** and state that the entity's others are untouched. Add and
Rename are left alone: neither has ever read as wholesale, and adding the sentence to all four
would make it furniture nobody reads.

**Values are written as strings.** The `Map` accepts any JSON, and `valueText` renders what it reads
faithfully, but nothing tries to infer that `5` was meant as a number. Guessing would be a silent
type change on data the user cannot see the type of.

## 6a. Rename, and why it is sometimes greyed out (0.10.0)

**The fourth mode is the only one whose source field is not the box.** Add, Overwrite and Remove all
act on the name typed into **Custom Field name**; Rename needs *two* names, and there is nowhere to
type a second one. So the old name comes from the scope — which is why it is offered only while
everything in scope carries **exactly one** field name, and why the box's label changes to **New
Custom Field name** while it is selected. A second text box would have been the obvious alternative
and is worse: it would sit empty and meaningless in the three modes that do not use it, and it would
let a user name a field the scope does not contain, which is a rename of nothing.

**One write per distinct value, not per entity and not per type.** A rename carries each entity's own
value across, so entities that shared a value share a mutation — the same grouping Undo has always
used, and the same one `DescRun.runMigration` uses for the hide-field rename. `apply()`'s type-only
grouping stays for the other three modes, where the payload genuinely is one delta for everybody.

**`partial` and `remove` go in one input, and that is what makes it a rename rather than a copy.**
Two mutations would leave a window where an entity had the field under both names, or neither.

**An entity already carrying the new name is refused, not merged.** The write would set the new key
and drop the old one, so the value already under the new name would be overwritten and unrecoverable
— a merge, decided silently, on data the dialog can see and the user cannot. It is a `[WARN]` with
the kept values tallied, in the shape §17 gives every other skip.

**The precondition is recomputed from the scope on every keystroke, and `plan()` reads it again.**
`syncOps` disables the option and `syncApply` disables the button, but the plan does not trust
either: `renameFrom()` is called once more inside `plan()`, so a stale answer can never become a
write. A mode that becomes unavailable *while selected* stays selected, with Apply disabled and the
reason in its `title` — switching the operation under someone about to press Apply would be worse
than a button that says why it is off.

## 6b. Touching a filter narrows the scope (0.10.0)

**Asked for from live use, and it is safe in one direction only.** Changing any filter sets
**Apply to** to *Filtered list only*. The scope can only ever narrow to what is on screen, never
widen behind the user, so the automatic direction is the conservative one. Clearing the last filter
sets it back to *All* — not a second rule: with nothing filtering, the two selections cover the same entities
and the select should say the simpler one.

**`filtering()` cannot just test the two text boxes.** Three of the value modes (*is empty*, *is
true*, *is not true*) are a filter with an empty box, which is exactly the case that would have
looked like "no filter" to a naive check.

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

**No `guarded()`, and no `respecters` entry.** This plugin never reacts to a save, so there is
nothing of its own to suppress and nothing to stand down. Registering as a respecter would be a
claim a sibling's dialog repeats to the user, and it would be false.

**It does wrap `window.fetch` since 0.8.0, and that changes nothing here.** §23's dropdown filter
edits what a `Find*ForSelect` *read* answers; it never sees a mutation and has no reaction to
suppress. Standing down for a lease would only mean showing hidden entities in a dropdown while a
sibling ran a task, which is not what a lease is about.

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
  the marker list and on a detail page, offered on a list nested under another entity, offered on
  each of the five routes whose URL does not name what they list and refused on an unrelated
  `/add`, not confused by a card's links to other entity types, and — since 0.1.2 — still reading a
  card that links to its own parent (the id it links twice wins), while refusing a row whose links
  are evenly split and refusing a select-all over a table where one id happens to be linked most.
  The dialog: the head, the legend, one aliased
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
  Since 0.1.0 it also covers the settings page (§10): the group found by a heading carrying the
  version suffix, marked as ours, its description rebuilt as paragraphs and collapsed behind a
  `<button>` toggle that expands and flips its caption, the README linked under it, an idle tick
  producing no second copy of any of it, no queries issued at all, a one-paragraph description
  getting no toggle but still getting its link, and — the check the anchor actually needs — a plugin
  whose name merely *starts* with ours left alone. And Escape (§11): it closes the dialog from the
  listing and takes its `document` handler with it, does nothing at all while a write is in flight
  (with the footer state that makes that true asserted alongside it, or the check would pass for the
  wrong reason), and ignores every other key.
- **`cfbe-task.test.js`** — the library-wide task (§12), and only what changes when a run has no
  type of its own. The button: repainted amber, another plugin's identically labelled one left
  grey, the paint idempotent across ticks, and a click on theirs neither opening our dialog nor
  being interfered with. The click: `preventDefault` *and* `stopPropagation`, and nothing resembling
  `runPluginTask` reaching the server. The read: one query per type, seven of them, each asking
  for a page at a time with `count` beside it, with `findGalleries { galleries }` pinning that the
  query name and its result field are both derived from the plural, and the progress line sampled
  *inside* the responder so what it records is what the dialog showed while a page was in flight. The dialog: a head naming the library rather than a
  selection, one listing holding three types with each line naming its own, entity pills linking to
  the right type per row, and counters that count entities. The write: scenes in one bulk mutation,
  performers in their own, studios and tags one at a time, and no type's ids ever handed to another
  type's mutation — the same assertion again for Undo. The filtered scope with scene 1, performer 1
  and tag 1 all present, which is the check that pins type-plus-id keying. One type refusing its
  read reported while the other six still list. And the group on the Tasks page left undecorated,
  which is §12's bug. Since 0.4.0, the type filter (§13): offered here and *not* on a selection run,
  every supported type in it with All first, narrowing the listing to one type and the counter
  following it. `cfbe.test.js` covers the other four: the summary line after a read, the
  action tally after an Apply, Copy log carrying the counters, the messages and the listing, and
  Rescan re-reading while leaving the pending Undo in the footer. Since 0.5.0 both suites read the
  **last `.cfbe-block`** rather than every `.cfbe-entry` in the body, the log now keeping every
  listing it has drawn (§16); three checks in `cfbe.test.js` pin that — the block/message order
  after a write, filtering rewriting the current block instead of logging a second one, and Copy
  log coming out chronological.
- **`style.test.js`** — the CSS this plugin shares with its three siblings: the dialog chrome, the
  description rules and, since 0.7.0, the per-setting tooltip rules. Its `toggles` flag is what
  keeps this plugin out of the coloured-toggle checks: its one setting chooses what a run *covers*,
  which is Stash's blue by the repo-root rule. That flag was `settingsPage` — a key no entry ever
  carried, so every check under it ran over nothing until 0.7.0 noticed.

**Every check was confirmed against a deliberately broken copy before being trusted** — eleven
mutants: a container's many ids taken as a row, Add not refusing an existing key, the lease not
taken, `listType` matching by prefix instead of by last segment, Undo writing one flat batch,
`undoing` not counting as applied for the footer, the most-linked tie-break accepting a tie, the
same tie-break applied outside a row, and — since §24 — the whole of 0.12.1 (which fails the five
new hide-field checks and nothing else) plus a `followHideRename` deciding from the run's own copy
of the settings rather than from the live map, which fails exactly the one check written for it.
Each fails exactly the checks written for it. Use
`SRC=/path/to/mutant.js node tests/cfbe.test.js`.

What they cannot cover: §8. The suite reproduces Stash's list markup from notes, so it proves the
plugin does the right thing with what it is given, not that Stash still gives it that. **Click it
once in a real instance before believing any of §3 or §4.**

## 10. The settings page (0.1.0)

The plugin had nothing to configure until 0.7.0 (§18), so its block in Settings → Plugins was a
heading, a description and Stash's own Enable/Disable and link buttons. It gets the siblings'
**description** treatment — a one-line summary, the rest behind a **Show more** toggle, and a labelled link to the
README under it — because that block is the first thing a user reads before installing, and a wall
of prose there is exactly what that design exists to fix. Requested directly; §6 of
`NormalizeParentTags`' CLAUDE.md carries the full reasoning and is not repeated.

**The per-setting tooltips were the one part not ported, until there was a setting row to hover.**
`tests/style.test.js` splits the old one-flag settings list in two, which is what let this plugin
carry one half and not the other (§5); 0.7.0 brought the other half with the setting.

**The heading is still the only anchor `ownParts` has, and it is the weakest one in this repo.**
Every sibling finds its group through the `plugin-<id>-<key>` element ids Stash builds from the
plugin id and a setting key — ours by construction — and keeps a heading match only as a fallback,
*because two of them shipped broken twice on heading text*. This plugin had no such ids until
0.7.0, and now has exactly one: `tipSetting` uses it, but `ownParts` cannot, because what it has to
find is the **group header's own description**, and the id points into a setting row instead. So the
fallback is still the only route in, which is why:

- `headingIsOurs` compares **exactly**, after stripping the version suffix Settings → Plugins
  appends (`ᝯㄝₓ Custom Fields Bulk Editor (0.1.0)`) and the literal `undefined` its template
  interpolates for a plugin with no version. A prefix test would make
  `ᝯㄝₓ Custom Fields Bulk Editor Extra` us; `tests/cfbe.test.js` drives exactly that.
- The fixture in the suite carries the version suffix, because a bare-name match is the specific
  bug both siblings shipped.
- If Stash ever restyles that panel, this is the first thing here to break, and it will break
  silently — the description simply renders as Stash rendered it before, which is the right way for
  it to fail but says nothing.

**A plugin's own description and its task descriptions use the same two classes, and that is what
§10 gets wrong if it searches the group.** Our `h3` and the plugin description sit in one `.setting`
header row; a *task* row carries an `h3` of its own (the task name) with a `.sub-heading` under it
(the task description) — so "a `.sub-heading` somewhere inside the group" finds a task's. Live on
2026-08-13, `cfbe-own-group` landed on a group whose only description was a task's, and that task
description was the thing being split and collapsed. The group carrying our heading is also
`collapsible`, which is worth knowing before assuming what is in the DOM at any moment.

`ownParts()` therefore requires the description to be **in the same `.setting` row as our own
heading**, and returns the group and that description together, in one walk. A group whose heading
is ours but whose header carries no description is not ours to decorate. This replaced
`ownSettingGroup()` and a 0.3.0 guard that asked only whether the group contained a `.sub-heading`
anywhere — which the Tasks group does.

**The first attempt at this was aimed at the wrong half.** 0.3.0 saw the Tasks group being decorated
and concluded the panel had *no* description; the guard it added ("skip a group with no
`.sub-heading`") was therefore true of a page that does not exist, and changed nothing live. The
evidence that corrected it was a console dump of the actual group — which is the rule in the
repo-root `CLAUDE.md`: ask the page what it is before reasoning about what to do with it.

**Everything is re-added rather than tracked**, on the same tick as the menu, because React
re-renders the panel and drops what we put in it. `splitDescription` is idempotent (once the
children are ours there is no text node left to split), `collapseDescription` returns early once
`#cfbe-desc-toggle` exists, and the link is keyed on its own id. A re-render therefore returns the
description to *collapsed* rather than to a half-state with no way out.

**The toggle is a `<button>`**: `SettingGroup`'s `onDivClick` walks up from the event target and
returns early only for `a` and `button`, so a `<span>` would fold the whole group on click.

**No `MutationObserver` here, unlike the menu.** The menu has to carry our item before the user
reads it; this is decoration in a panel, so the timer plus the navigation hooks are enough and
cannot fight a re-render. It also issues **no queries at all** — the suite pins that.

## 11. Escape (0.1.0)

Escape closes the dialog by clicking whichever of Cancel/Close the footer is currently showing, and
does nothing when neither is available — mid-write, both are hidden and Stop is the dialog's only
way out. The mechanism is shared with all three siblings and written up in the repo-root CLAUDE.md;
this plugin's copy is byte-identical apart from the `cfbe-hidden` class name.

## 12. The library-wide task (0.3.0)

Requested directly: "a task to bulk edit all entities that support it, using a similar dialog".
It is the *same* dialog, not a similar one — the whole design is that a run with no entity type of
its own is still a `Run`.

**One flag, seven specs.** `Run(type, ids)` with both null is the task: `this.spec` is null and
`this.specs` is all seven. Everything that used to read `this.spec` now reads the spec of the
**entity in front of it** — `loadChunk` and `loadAll` both stamp `spec` on every entity, rows and
changes carry it forward, and `rowNode` prints `r.spec.label`. `this.spec` survives only where the
question really is about the *run*: the head, the counters' noun (`noun()`), and the by-id read
path a selection uses.

**The read is one query per type with `per_page: -1`.** The by-id batching a selection uses cannot
express "everything" — it needs the ids first, and the task has none. `find<Plural>` and the list
field inside it are both derivable from `plural`/`key` for all seven, so neither needed a column in
`ENTITIES`; if a future Stash breaks that for one type, give *that* spec an explicit field rather
than teaching `loadAll` about exceptions. Failures are per type, so one refused query leaves the
other six listed with a line saying which is missing — silently showing six sevenths of a library
and calling it the library is the outcome worth avoiding.

**Two places had to learn that an id is only unique within a type**, and both were correct before
only because a run held one type:

- `plan()`'s *Filtered list only* scope keyed `keep` by id, so a filtered scene 5 dragged tag 5 into
  the write with it. Now keyed `spec.key + ':' + id`.
- `apply()` and `undo()` built one batch of ids; the mutation is per type, and five of the seven
  take a bulk update while two do not. Both now group by type first, and `runWrites` reads the
  chunk size off each batch's own spec — so a task's studios go one at a time while its scenes go a
  hundred at a time, in one pass.

**The click is intercepted, never served.** A capture-phase listener on `document` matches the
button by label *and* by the heading of its own `setting-group`, then `preventDefault` +
`stopPropagation`. `MergePerformerTagsToScenes` has a second layer answering the `runPluginTask`
mutation inside a `fetch` wrapper it already owns for auto-merge; this plugin has no wrapper, gains
nothing else from one, and the failure the layer covers is visible and harmless — no dialog opens
and Stash queues a job that does nothing. **Add the second layer if that is ever seen, not before.**

**The bug this found before a live run: `settingsTick` was decorating the Tasks page.** Settings →
Tasks renders a group headed with the plugin name too, and the heading is the *only* anchor this
plugin has (§10). So `ownSettingGroup` matched it, `readmeLinkSlot` fell through its
no-`.sub-heading` fallbacks to the header box, and the README link landed **inside the h3** — the
same text `ownTaskName` reads. One tick after the page loaded, the task button would have stopped
being ours. The guard is structural, not a route check: a group with no description has nothing
here to do, and `?tab=` is Stash's to rename. The fallbacks that reached the heading are gone with
the case that reached them.

**The read is paged, and that is a UI decision rather than a data one.** It shipped as one
`per_page: -1` query per type, which is this repo's convention and is correct - and on the user's
own library, 155,012 entities, it left the dialog showing nothing for fifteen seconds and then
jumped to the final number. Reported as looking hung. **A progress counter can only count what has
arrived**, so the read has to arrive in pieces; `count` rides along on every page, which is what
makes the line a fraction rather than a tally. `READ_PAGE` at 5,000 is the trade: 31 round trips for
that type and a line that moves several times a second, where 1,000 would add 155 round trips of
latency to a read the user has already been told is slow. The delay itself was explicitly *not* the
complaint.

**"No type picker, deliberately" lasted one live run.** This section argued that per-type work is
what the list-view menu item already does, on a list the user has already narrowed with Stash's own
filters. That is true and it missed the point: the menu item narrows *before* you can see what the
library carries, and the whole reason to open the task is to look at all seven at once first. The
filter is §13.

It also guessed the wrong control — "a third `<select>` beside Operation and Apply-to". It belongs
in the **filter row**, because it filters the listing rather than the write; that it also narrows a
write is *Apply to → Filtered list only* doing its existing job, which is exactly how the other two
filters already reach the write.

## 13. What a whole library made the dialog want (0.4.0)

Five things, reported together after the first live task run over 155,012 entities. Four are about
a listing too big to read and one is a layout bug that only a small window shows.

**A filter by entity type, on a task run only.** `this.typeFilter` is built in `build()` behind
`if (!this.spec)` and read back through `this.typeFilter ? .value : ''`, so a selection run has no
control and `filtered()` needs no branch. A selection is one type by construction — six of the
seven options would empty the list and the seventh would do nothing. It leads the filter row rather
than trailing it: it is the coarsest of the three, and the one a user reaches for first.

**One `[INFO]` line naming every custom field found, with a count.** The listing says what each
entity carries; nothing said what the *selection* carries, and at 155,012 entities that is the only
question the screen cannot answer by being scrolled. `tally(items, key)` returns `a x12, b x3` and
is used twice: over the rows for the read (`summarise()`, re-emitted on every Rescan), and over the
**changes** for an Apply or Undo (`Added x1, Replaced x2`). Counted off `this.changes`, never off
the rendered rows — `LIST_RENDER_CAP` stops the listing at 1000 lines and the summary is precisely
the thing that has to be right about a write bigger than the screen. The `x250` form is the one the
head's own legend already declares, so it needed no explaining.

**Copy log**, the same button the three siblings have, over a listing rather than a log. It takes
the counters and then the log in order — every message as itself, every listing from the text built
beside its nodes in `fillList` and **uncapped**, so a copy carries what the render cap left off the
screen. That is the whole reason it is not a `textContent` read of the list element. `fillList`
therefore takes a third argument, a text builder per item, and `changeSides(c, reversed)` was
factored out so the node, the text and the tally cannot disagree about which side of a change holds
a field. Since 0.5.0 that text hangs on the block rather than on the run (§16), so an earlier
listing is still copied whole after a later one has been drawn.

**Rescan, and an Undo that stays.** An undone run used to clear `this.changes`, which hid Undo and
left **Close** as the only button in the footer — the reported complaint. Two changes, and the
second is the one that matters:

- `setState` shows Undo on `this.changes.length > 0` in **any** state, not only in `applied`. A
  Rescan returns the dialog to `listing`, and the old rule would have meant a rescan quietly threw
  the undo away.
- `undo()` keeps its changes. Pressing it twice re-asserts the same before-values, which is
  idempotent; only a fresh **Apply** replaces what it will put back.

`rescan()` re-enters `begin()` rather than calling a second loader — the version check and the
lease warning belong to a read, and both live there. It clears the entities and the counters and
leaves `changes` alone: Undo writes by id and spec, not through the entity objects the read
replaces.

**The listing sat over the `[INFO]` lines, and the cause is one CSS line nobody would guess.** A
flex item with `overflow` other than `visible` has an **automatic minimum size of zero**, so
`.cfbe-msgs` was the one thing in the modal's column the flex algorithm could squash to nothing —
and it did, on any window short enough, while `.cfbe-log` beside it kept the `min-height:14rem` the
shared chrome gives it. `flex:0 0 auto` on the strip is the fix; it stays content-sized, so an
empty strip still costs no room.

**0.5.0 retired the strip rather than the fix** (§16): with the messages inside the listing there is
one scroller, so nothing in the column can be squashed by the other. The lesson survives its own
element — a flex item with `overflow` set is the thing to suspect whenever a box disappears on a
short window.

That alone would have pushed the modal past its own `max-height`, so the floor had to come down
with it — and `.cfbe-log` is **pinned byte-identical across the four dialogs** by
`tests/style.test.js` and is not ours to edit. `.cfbe-listwrap`, a second class on the same
element, carries the smaller floor. A modifier beside a shared rule is the move whenever one
plugin's copy of the chrome holds something the others' do not; editing the shared rule for a
local need is what the pinning exists to stop.

## 14. The head reads shorter, and the dialog no longer links its own README

0.4.1, at the user's wording. Three cuts, none of them behavioural:

- **"only while it stays open" → "while it stays open."** The other "only" in that sentence is the
  load-bearing one (*only reverses what this dialog wrote*); a second one in the same clause read
  as emphasis rather than a limit. 0.4.2 moved that first `only` ahead of the verb, matching the
  word order the other three dialogs took at `NormalizeParentTags` 2.2.1 / `MergePerformerTagsToScenes`
  2.1.1 / `PropagateTagsAndPerformers` 1.1.1 — four heads, one sentence. 0.4.3 dropped the clause
  in front of it, *Apply rewrites one custom field across every entity in scope*: it describes what
  the dialog does rather than what Undo cannot reach, and `README.md` says it at length. The head
  is now the siblings' sentence verbatim.
- **The legend stops teaching the id and the count separately.** `NormalizeParentTags` and the two
  after it spend a sentence on *Scene "My Scene" (123) is the scene with id 123* because their logs
  are prose and a bracketed number could be either. This dialog's lines are a table with the id in
  a fixed column, so naming it once — *the number in brackets after the entity name is its id* —
  is the whole job, and the count rule shrinks to a trailing *Counts are written with prefix "x"*.
  `tests/cfbe.test.js` matches the new clause, not the `Stash id` string the other three carried
  until the repo-wide rename below.
- **The head's `Plugin README` link is gone.** CFBE was the only plugin here that put one in the
  dialog as well as under the settings description, and the dialog is opened by someone already
  mid-task. The settings-page link (`README_LINK_ID`, §10) is unaffected and still tested; so is
  `README_URL` and the `.cfbe-readme` rule, which that link still uses.

**"Selecting lines and copying gives plain text" left the legend but not the plugin.** It is still
true, still documented in `README.md`, and was the one sentence there describing something the user
cannot see from the screen — which is an argument for the README carrying it, not the head.

## 15. The legend's ␀ is drawn by the list's own rule

0.4.4. `.cfbe-none` sets `font-family:sans-serif` because the mark sits in a monospace
line and a monospace face draws U+2400 as a wide box; the legend, which is not
monospace, quoted the same character out of a plain string and got whatever the head's
face makes of it. The two are the same mark and had to look it.

**One rule, two selectors** — `.cfbe-none,.cfbe-nonemark{font-family:...}` with the
colour left on `.cfbe-none` alone. A second declaration of the same face is a second
thing to keep in step, and the legend keeps its own colour and size: the ask was the
font and only the font.

**The legend is spans now, with no text of its own.** It was one string, and a mark
inside a string cannot be styled. The shape is `rowNode`'s — a div holding spans, the
two plain ones unclassed so they inherit everything the legend sets.

**Text-then-append is what the harness cannot see.** The first cut set the legend's
`textContent` and appended the mark after it, which is correct in a browser and reads
*short* in `tests/npt-harness.js`: its `textContent` getter returns `_text` when it is
set and ignores the children beneath it. The existing legend check went red, which is
the good outcome — a fixture that had answered with the whole string suddenly answering
with two-thirds of it. Building from spans avoids it entirely, and is the shape the rest
of this dialog already uses.

## 16. One log, in the order things happened (0.5.0)

At the user's ask: put the `[INFO]` lines **into** the listing, chronologically, use **one**
scroller, and keep adding to it until the dialog exits. Three sentences, and each one removes
something rather than adding it.

**The strip is gone, not moved.** `.cfbe-msgs` and `this.msgEl` are deleted; `msg()` appends its
line straight into `this.listEl`. Two boxes meant two scrollbars over one sequence of events, and
the reader had to interleave them by eye — which is also what made §13's squashed-strip bug
possible at all. There is nothing left to squash.

**A listing is a `.cfbe-block` inside the log, and the log is never cleared.** `fillList` used to
empty `listEl`; now it fills `this.blockEl`, creating and appending one when there is none. The
distinction that makes this work is between a *restatement* and an *event*:

- **Re-filtering restates.** `renderList` reuses the current block, so typing in a filter rewrites
  the listing in place. One block per keystroke would be a history of nothing.
- **A rescan or a write is an event.** `rescan()` and `renderChanges()` clear `blockEl` first, so
  each starts a block of its own under the `[INFO]` line that announced it.

So an Apply now reads: the listing as it was, the line saying what was done to it, and what
changed — where it used to *replace* the listing and leave only the last of the three. The old
justification for replacing (a pre-write listing is the dialog's stalest possible claim) is
answered by position rather than by deletion: the older block is above, with the write between
them, and nothing above the newest block claims to be now.

**`listText` moved onto the block as `_text`.** One `this.listText` could only ever describe the
newest listing, and Copy log now copies the whole log. A plain JS property on the node, like
`_coopOwner` in the siblings — nothing serialises it, and `copyLog` walking `listEl.childNodes`
reads either a block's `_text` or a message's `textContent` with no third case.

**The render cap is unchanged and still per listing.** `LIST_RENDER_CAP` bounds what one block
draws; a session that rescans ten times holds ten capped blocks, which is the point of keeping
them. If that ever needs a ceiling of its own, cap the number of *blocks* — the text a dropped
block would take with it is the only thing that decision costs.

**`tests/cfbe.test.js` and `tests/cfbe-task.test.js` read the last block**, not every
`.cfbe-entry` in the body, which is the one change the accumulation forced on them: after an Apply
the pre-apply listing is still in the DOM and "the list" means the newest one. Three checks pin the
behaviour — the block/message order after a write, that filtering adds no second block, and that
Copy log comes out chronological.

## 17. Every skip says why, and a summary copies itself (0.6.0)

**A plan that drops an entity in silence reads as "it worked".** `plan()` had three `return`s and
the dialog said nothing about any of them; the one that actually costs the user is `Add` over a key
that is already set, which is *most of the selection* on a second run and produced a write of three
entities out of four hundred with no explanation. `plan()` now returns `skipped` beside `changes`,
and `apply()` calls `reportSkips` **before** the "Nothing to change" check — so the empty plan, the
case with least to say for itself, is exactly the one that now says the most.

**Refused and unchanged are different things, and the order of the tests is what tells them
apart.** `Add` over a key already holding the asked-for value used to fall into the "already
present" branch, because that test came first. It now runs *after* the equal-value test, for every
mode that writes: an entity already carrying `colour🟰blue` when you ask for `colour🟰blue` was not
refused, it was already right. So `present` is a **WARN** naming "Overwrite" as the way through,
while `unchanged` and `absent` (a Remove finding nothing to remove) are **INFO** — nothing was
denied there.

**A skip line counts, it does not list.** `s.present` holds `{value:}` and nothing else, tallied
into `Kept: blue x9, red x3.`; a per-entity line would be a second listing of up to 155,000 rows
appended to a log that keeps everything (§16). The tally is the shape §13 already chose for the
same question.

**`tally` returns pairs now, and that is the whole of the copy-pill change.** A name in a summary
is what gets typed into **Field name** next, and a string cannot carry a pill. So `tally` returns
`[[name, count], …]`, `tallyText` joins it where plain text will do (the Applied recap, whose names
are `Added`/`Replaced`/`Deleted` and worth copying to nobody), and `tallyMsg` builds the line with
`copyPill` — the same pill, the same click, the same 900ms flash as the listing's.

**`msg()` puts its text in a child node and returns the line.** Setting `textContent` and then
appending would drop one or the other — the harness's `appendChild` nulls `_text`, and mixing the
two in a real DOM is no clearer. One shape, so a caller that wants to append can.

**Test-side, `pills()` is scoped to the last block** for the reason `lines()` already was: a check
about a *row's* pills means the ones in the listing, and the summary now has its own. `msgPills`
is the counterpart for a message line. Six checks cover the three reasons, the pills in both kinds
of line, and that a skip is reported even when nothing is left to write.

## 18. The first setting (0.7.0)

**`a1SkipImagesInTask`, one BOOLEAN, off by default.** Asked for from live use, where the task read
155,012 entities and images were most of them. It scopes the **task** and nothing else: a selection
is exactly what the user picked, and an image list is one of the places the menu item is opened
from, so a setting that quietly emptied that selection would be wrong twice over.

**Read at the click, not at load.** `startRun` splits: a typed run opens immediately, and the task
chains one `configuration { plugins }` query and opens after it. A setting read at load would mean
flipping the switch and pressing the button in the same page session does the old thing — the
failure mode nobody would report as a bug, they would just conclude the setting does nothing. The
cost is one round trip before a dialog that is about to make dozens, and `_opening` guards the gap
so a double click cannot open two dialogs. **A failed read runs with `DEFAULTS`**, because the
defaults are exactly the behaviour this plugin had before the setting existed.

**`allSpecs(settings)` is where it lands**, so the whole run is shaped by the spec list it was built
with: the read, the type filter's options and every counter follow from `this.specs` and needed no
knowledge of the setting. **And `begin()` says it out loud** — a type simply missing from a
whole-library run reads as a bug, which is the same reason every skipped entity says why since §17.

**It also cost the settings-page half this plugin had skipped.** No settings meant no setting rows,
so `tests/style.test.js`'s `SETTING_TIPS` were legitimately absent (§5). One setting brings all
four rules and the `TIP_MARK`/`settingElement`/`settingRow`/`tipSetting` machinery with it, copied
function for function from the siblings — there is no module between these plugins, and the
alternative to copying is drift. `ownParts` is unchanged and still enters by the heading: the id
now exists, but it points into a *setting row*, and what `ownParts` has to find is the group
header's own description.

**What the setting is not: coloured.** The repo-root rule paints amber the settings that make a
plugin write on its own; this one chooses what a run *covers*, which keeps Stash's blue. That is
what `tests/style.test.js`'s new `toggles` flag records — and fixing the filter it replaced
(`settingsPage`, a key no entry ever carried) is how the dead check under it was found.

## 19. The footer order is the siblings' (0.7.1)

`[Apply, Cancel, Copy log, Undo, Rescan, Close]`, replacing `[Cancel, Undo, Rescan, Copy log, Apply,
Close]`. Nothing behaves differently; the write moved from second-to-last to first.

**Three plugins against one decided it, not an argument about which position is better.** The
siblings all read `Proceed · Cancel · Stop · Copy log · Undo · Rescan · Close`, and the user asked
for the button positions to be harmonised "unless there is a specific reason". There was none on
record here — this footer was built before the three had converged on anything and its order was
never argued for — so the majority order wins and the smaller diff is on this side.

**The caption stays "Apply" — that one *is* the specific reason.** A sibling's Proceed writes the
plan already enumerated in its log, and is disabled until there is one. Here the log lists what the
entities carry now and `plan()` runs inside `apply()`, so the press is the plan and the write at
once — Apply describes that and Proceed would not. It also pairs with the **Apply to** select
directly above, which is what decides how far that press reaches.

**The one gap is Stop, and it is a real absence rather than an omission to fill.** A write here is
one bulk mutation per batch with the whole footer disabled for the duration, so there is no state in
which a Stop could be pressed. Apply therefore takes Proceed's leading position and the rest follow
in sequence; nothing is left holding a place for a button that does not exist.

**`tests/cfbe.test.js` pins the whole sequence as one string**, read off `.cfbe-foot`'s children in
DOM order. The other three are not pinned the same way — the check would be four copies of one
literal, and the drift it guards against is what this section just corrected on the one plugin that
had it. Pin theirs if a second footer ever moves.

## 20. The last line, and the two habits that stay this plugin's own (0.7.2)

Three differences from the siblings, reported together from live use. One was a bug and two are
answers to a question the siblings never had to ask.

**The scroll: two boxes, and only one of them was moved.** `scrollList()` set `scrollTop` on
`.cfbe-list`, which is where every sibling's log lives — except that theirs *is* the scroller
(`.npt-log` is `flex:1 1 auto; overflow:auto` and holds the lines directly) while this dialog wraps
its list in `.cfbe-log.cfbe-listwrap` and puts `.cfbe-list` inside it. Which of the two actually
overflows depends on whether the inner box's `height:100%` resolves, and against a flex parent whose
own height comes from a `max-height` it does not: the inner box grows to fit instead, nothing
overflows it, and the assignment is a no-op on a box that cannot move while the wrapper holds the
scrollbar. Both are set now. This is the repo-root lesson about `.edit-buttons` in another form —
**a declaration that lands on the wrong element looks exactly like a value that did not work**.

**The scroll hangs off `msg()`, not off the listing.** `fillList` deliberately does not scroll: it
also runs on every keystroke in the filters, and jumping to the end of the list while someone is
typing one would be worse than not moving at all. Every path that appends a *new* block ends in a
message — `summarise()` after a read, the recap line after an Apply or an Undo — so the last line is
reached that way. A future path that appends a block and says nothing would not scroll, and would
need its own call rather than a rule in `fillList`.

**Undo stays after being pressed, and that is a mechanism difference, not a preference.** A sibling
consumes its undo record — `NormalizeParentTags` splices each reversed batch out of `undoable` as it
goes, so a full undo empties it and the button hides itself, with anything left over keeping it shown
and the log saying how many changes are still applied. Here `undo()` rebuilds its batches from
`changes`, which nothing empties, and writes each entity's `before` value back: a *restore*, not the
reversal of a delta, so pressing it twice re-asserts the same values and there is nothing to hide.
Only a fresh Apply replaces what it will put back. §7 has the rest.

**Rescan is offered in `listing`, where a sibling offers it only in `done`.** Their equivalent state
is `ready`, which holds a plan their scan has just produced — rescanning there would re-run the read
you are looking at, and Cancel is the way out. This dialog's `listing` holds *data* rather than a
plan, and a Rescan returns it to `listing`: hiding the button there would make it single-use, and
after a first rescan there would be no way to ask again.

## 21. The dropdown marker (0.7.3)

Stash draws a stacked ▲/▼ on its own dropdowns — Settings › Logs › Log Level is the one the user
named — and a bare `<select>` gets whichever single chevron the browser draws instead, which is what
this dialog's four had. `appearance:none` removes that one and the pair goes back as a
`background-image`, an inline `data:image/svg+xml` so a plugin folder is still a copy with no assets
beside it.

**It is CSS in one plugin, not a shared rule.** `.cfbe-select` is the only `<select>` in the repo —
the other three dialogs have none — so there is nothing for `tests/style.test.js` to pin it against,
and it correctly ignores a selector only one plugin defines. If a sibling ever grows a dropdown, this
rule is what it copies.

**Quotes inside the SVG are percent-encoded (`%27`), not escaped.** The CSS lives in a
single-quoted JS string and the `url()` is double-quoted, so anything else would need a backslash on
every attribute. `#` has to be `%23` regardless — unencoded it starts a fragment.

## 22. Custom field descriptions, and where they live (0.8.0)

A custom field's name is all Stash keeps of what it means, and a library with thirty of them is a
library where nobody remembers what four of them were for. So each name gets one description, shown
as a tooltip on the field-name pills in the bulk dialog and edited in a second dialog of its own.

**The tooltip leads with "Click to copy Name" and labels the description under it** (0.12.0 put the
click first; it had shipped the other way round, and 0.12.1 named the two halves). What the click
does is true of *every* pill and is one line; the description is the longer half and only some pills
have one — so the constant part first is what makes the tooltips scannable down a listing, and what
stops a described field's tooltip reading as a different kind of thing from an undescribed one's.
The word **Name** is there because a line carries a name pill and a value pill and both copy on a
click, so "Click to copy" alone did not say which one this is; `named` already distinguished them
for the description lookup, and the caption now reads off the same flag. **Description:** labels the
second line rather than letting it run on from the first as an unmarked sentence.

**The store is one tag's `description` string, not its `custom_fields` map.** The map was the
obvious place — a 1-1 mapping is what a map is — and it is taken twice over: the same tag has to
carry the marker below *and* the field that hides it from the dropdowns, and each of those is
indistinguishable from a description entry keyed on the same name. Namespacing the keys would work
(`cfdesc⟩<name>`) and costs a prefix out of Stash's 64-character custom field name limit, plus a
rule about which keys are internal that every listing then has to know. The description column is
`text` (migration 36 of `stashapp/stash`), so there is no size to design around; one `tagUpdate`
writes the version, the field list and every description atomically; and there is no key layout to
be right about at all.

**What it costs, and it is worth knowing before this is "improved":**

- **The blob is visible.** `TagCard.tsx` renders `tag.description`, and so does the tag's own page.
  Hence the sentence in front of it, and hence the tag being marked hidden from the dropdowns when
  it is created.
- **A hand-edit can break it**, which is why `parseStore` returns `broken` rather than an empty
  store, and why the dialog then refuses to write. **A blank description is the exception**: that
  is the documented reset, so it reads as an empty store. A `{` with no `}` after it took a round
  to get right — the first cut read "no blob found" off it and would have written over whatever
  somebody had typed there.
- **Read-modify-write of the whole store.** Two tabs editing descriptions is last-write-wins.
  That is the same bargain everything else here makes with a Stash that offers no better.

**The tag is found by a marker custom field (`ᱜ╦╦🞮_🛂🧲_🛠🛈🖫_desc_store`), never by its name.** The
name is a setting the user is invited to change, so a store found by name is a store that a rename
loses. It also means the rename *is* a rename: the dialog finds the tag it already has and writes
the new name onto it. Two marked tags is a state nothing here creates, so it is resolved rather than
refused — the one whose name matches the setting, else the lowest id — and the log says which.

**The marker wears the plugins' own prefix, and the old name upgrades itself.** It was
`cfbe_desc_store` until 2.0.1, which is a name anything else keeping custom fields could have
picked — and a collision there would hand the store to a tag that is not one. `findStoreTag` asks
for the current marker, and only when that misses asks for `LEGACY_STORE_FIELD` and moves whatever
it finds across in one `tagUpdate` (`partial` the new key, `remove` the old). Silent on purpose:
the store is the same store, and the name of the field holding it together is not something the
user chose. The second query costs one round trip, and only while no upgraded store exists.

**The tag is created with `ignore_auto_tag: true` and one ASCII alias.** Its name is unreachable
from a keyboard, so `GTTx Custom Field Description Store` is what makes it findable in Stash's own search;
and it is plumbing rather than a tag to file scenes under, so auto-tag has no business matching on
it. Both go on `tagCreate` only — a store that already exists is the user's to configure, and an
Apply that quietly re-asserted either would be this dialog writing something nobody staged.

**Nothing is written until Apply, including this plugin's own housekeeping.** Creating the tag,
seeding the description for the hide-from-add-lists field, and pruning orphans are all staged into
the working copy and go out on the one press. A dialog that wrote its own plumbing on open would be
the one place in this repo where opening something changes the library.

**Undo puts the tag's description and name back, and leaves a tag it created in place.** The store
is one field, so one write reverses it — this is the one Undo here that *can* honestly be a stored
copy written back, because the thing it is restoring is the whole of what it wrote. Deleting a tag
the user may have used elsewhere in the meantime is not something an undo of a description edit
gets to do; the log says the tag stays and gives its id.

**An orphan is a description whose field no entity carries** — *and which the store tag does not
carry either*, which is §24's correction: the tag is left out of the scan, so a field only it wears
was being reported as an orphan and offered to Prune. Kept and marked rather than dropped:
a field cleared off every entity today is one that may come back tomorrow, and losing the sentence
that explains it would be worse than a stale line in a list. **Prune** clears them all in one go,
and is staged like everything else.

**A renamed hide field moves its description here and offers to move the library.** The store
records the field name it was last written with, so the dialog can tell a rename from a first run.
The description follows the setting immediately, in the working copy; the entities still carrying
the old key are a bulk write and wait behind a **Migrate** button, which stages one rename batch per
(type, value) — the same grouping Undo in the first dialog uses, for the same reason. Renaming a
setting must not itself write to the library.

**The version gate blocks, and it is the only thing here that does.** A store stamped with a version
newer than the running script may hold keys this script would drop on its next write, so editing is
off and the log names both ways out: load that release (or newer), or delete the tag's description
by hand and lose what is in it. `cmpVersion` compares part by part as numbers, because `"0.10.0"` is
newer than `"0.9.0"` and a string compare says otherwise.

**`DescRun` borrows `Run`'s methods by assignment**, not by inheritance: `loadAll`, `msg`,
`fillList`, `runWrites`, `close` and the rest are the same functions, and the two constructors agree
on the handful of fields those touch. There is no module between these plugins and there is no class
hierarchy inside one either. The one thing it does *not* borrow is `renderProgress`, because its
counters count fields and descriptions rather than entities and rows.

## 22a. An Apply does not end this dialog (0.8.1)

**The first thing live use said about §22: "after an Apply, rescan required before I can edit
again".** `DescRun.setState` was a copy of `Run`'s, and it had inherited the assumption underneath
it without the reason for it. In the first dialog the listing *is* the plan — every line describes a
write that has now happened, so the screen is describing a library that has moved on and a rescan is
the only honest way back to an editable state. **The descriptions dialog has no such listing.** Its
left pane is the library's custom fields, which writing a description does not touch, and its right
pane is a box the user came here to type in. Nothing on screen goes stale when Apply succeeds.

So `editable()` is `listing || applied`, and Apply stays *visible* in the applied state rather than
being swapped for Close — `pending()` already answers "is there anything to write", which is the
whole of the enable rule. **Cancel still becomes Close after a write**, because that word is about
what has happened rather than about what can be typed next, and the escape-key indirection (§11)
follows the footer wherever it lands.

**Undo had to re-read the box, not just re-render around it.** It restores `desc` and `base` from
the tag's previous description and called `renderNames()` — correct while the box was locked
afterwards, and wrong the moment editing continues: the box would still show the text that was just
reversed, and the next keystroke would write it back. `pick(this.sel)` re-reads it from the restored
working copy.

**The lesson is about copied state machines, not about this button.** `DescRun` borrows `Run`'s
methods by assignment on purpose (§22), and this is the cost of that: a borrowed method carries the
*first* dialog's model of what a write means. Check each borrowed one against what the second dialog
actually shows before assuming the state names mean the same thing.

## 22b. Stash has no default for a plugin setting, so the plugin writes them in (0.8.1)

**The second report: both STRING settings read as empty until edited.** `PluginSettingConfig` in
`stashapp/stash` carries `displayName`, `description` and `type` — and no default. Settings →
Plugins renders whatever is in `config.yml` under `plugins.<id>`, which is *nothing* until the user
types in a box. So a setting the plugin was quietly defaulting looked unset, and worse, looked
identical to one deliberately cleared — a distinction this plugin actually depends on, since an
empty `c1ExcludeFromAddListField` is how §23's filtering is switched off.

`seedDefaults` writes the absent string defaults in once, from `loadSettings`, through
`configurePlugin`. Four things it is careful about:

- **Only absent keys.** `hasOwn(raw, k)` is already how `loadSettings` tells "never set" from
  "cleared", and the seed uses the same test — so a cleared box is never refilled, which would
  otherwise turn a switched-off filter back on behind the user's back.
- **The whole map goes back.** `SetPluginConfiguration` replaces `plugins.<id>` rather than merging,
  so the seed sends `raw` plus the missing keys. Sending only the new keys would drop the settings
  the user has.
- **Booleans are left out.** Absent already means `false` for a `BOOLEAN`, and Stash renders the
  switch off either way, so there is nothing for a seed to make visible.
- **Silent on failure, and once per page.** A settings write nobody asked for must not put an error
  in front of someone who came here to look at custom fields; `_seeded` is cleared again if the
  write fails, so the next load retries.

**The alternative was a `placeholder` on the input**, set from `settingsTick` — cosmetic, no write,
and rejected because it says the wrong thing about exactly the case that matters: grey default text
in an empty box is *right* for a setting never set and *a lie* for one deliberately cleared, and the
two look the same. A written-in value makes them different.

**It is the one write in this plugin that happens without an Apply**, and it is defensible only
because it writes to the plugin's own config rather than to the library: no entity, no tag, nothing
the database backup is there to protect. Do not take it as a precedent for anything under §22's
staging rule.

## 23. Hiding an entity from Stash's add lists (0.8.0)

An entity carrying the field named by `c1ExcludeFromAddListField` is dropped from the six
`Find*ForSelect` queries — the dropdown you pick a tag, performer, studio, group, gallery or scene
from while editing something else. It stays on its own list page, on the entities that already have
it, and in the API.

**All six types rather than tags alone**, for the reason the feature exists at all: a plumbing
entity is plumbing whatever its type. The marking lives on the entity, in a custom field, so it is
in the database and in the backup rather than in one browser's `localStorage`.

**Marked means present and not obviously false**, rather than merely present: the *value* is read,
so clearing a field to `0` unmarks an entity without deleting the key. The plugin writes `1` when
it marks its own store tag.

**The count has to lose exactly what the list did.** These queries return `count` beside the list
and Stash shows it as how many more there are; a filtered list under an unfiltered count is a
dropdown offering to load entities that are not there.

**A by-id request under the same operation name is not filtered, and that is the one thing here
that would have lost data rather than annoyed somebody.** `StashService.ts` has two functions per
type behind one operation: `queryFindTagsForSelect(filter)` asks what to *offer*, and
`queryFindTagsByIDForSelect(ids)` asks for the ones already *assigned*, so the editor can draw them
as chips. Filtering the second would make a marked tag vanish from the form of every entity that
already has it - and saving that form would then take the tag off. `ids` in the variables is what
tells them apart. Read off `stashapp/stash` `develop`, 2026-08-16, *after* the filter was written
and before it was committed; nothing in the operation name says the second call exists.

**Every failure path returns the original response.** A dropdown showing one entity too many is a
nuisance; one showing nothing because a filter threw is a broken editor. That is also why the
marked-id read resolves to an empty set on failure rather than rejecting.

**Read once per type per page load, never refreshed.** The same cache-first bargain Stash's own UI
makes: mark something in another tab and this tab picks it up on reload. Six polling queries against
a library this size would cost more than the staleness does.

**`FILTER_ARG` is a table, not a rule.** Six of the seven filter arguments are the singular of the
plural key and `galleries` is not — `gallery_filter`. Read off `schema.graphql` on 2026-08-16,
along with the fact that all seven filter types carry `custom_fields`.

**A real `Response` where there is one.** Apollo reads the body back through it, and a shim is one
method away from being wrong about something. The plain object is for the test harness, whose fetch
answers with exactly that shape.

## 24. The hide field is nobody's loose end (1.0.0)

Three things, all of them about the one custom field this plugin asks the user to *use* rather than
merely to look at — and two of them were the same mistake in two places: the store tag is left out
of every scan, so anything that reasons about "who carries this field" was missing the tag that
carries it.

**A rename of that field takes the setting with it.** `Rename` moved the key on every entity in
scope and left **Hide from Add Lists — Custom Field Name** naming the old one, so the dropdown
filter went on asking for a field nothing carried and everything the user had hidden came back into
the add lists — silently, with no error and nothing on screen about it. `followHideRename` writes
the setting after a rename that wrote something, and `undo()` writes it back.

**It is decided against the *live* setting, never against `this.settings`.** A selection run opens
with `DEFAULTS` — `startRun` only reads the settings for the *task* — so a user who has named the
field something else would have had a rename of the literal `Exclude_from_add_list` move a setting
that was never pointing at it. The check and the write are one round trip: read `configuration
{ plugins }`, compare through `effective()` (the same "absent means the default, empty means
cleared" rule `loadSettings` reads by, now shared rather than written twice), and send the whole map
back because `configurePlugin` replaces it. `tests/cfbe.test.js` drives exactly that case, and the
mutant that reads `this.settings` instead fails on it alone.

**The store tag's own mark has to be moved by hand, because nothing else can reach it.** It carries
the hide field to hide *itself* and `keep` takes it out of every scope, so a rename that skipped it
would leave the plugin's own plumbing tag showing up in the dropdowns. `moveStoreMark` is one
`tagUpdate` with `partial` and `remove` in one input — the same shape §6a's rename uses — and it
only fires when the tag actually carries the old key, so it can never *add* a mark to a tag the user
has deliberately unmarked.

**And in the descriptions dialog, that field is not an orphan.** `ready()` split the descriptions
with nothing carrying them into two lists: a true orphan, and one the store tag carries
(`_storeTagFields`, cached beside `_storeTagId` by `readStore` — the store query already asked for
`custom_fields`). The second is `[store tag]` in blue rather than `[orphan]` in amber, names the tag
in the log and in the right-hand pane, draws that tag as its one carrier row, and — the part that
actually mattered — is **not** in `this.orphans`, so **Prune** does not offer to delete the
description of the one field this plugin seeds itself.

**Why blue rather than a second amber.** Amber here means "a loose end you may want to clear"; a
store-tag field is accounted for, and marking it the same way would make the orphan colour mean
nothing. `.cfbe-name-store` is plugin-local, like `.cfbe-name-orphan` beside it, so
`tests/style.test.js` correctly ignores it.

**It reads `[store tag] x1`** (1.1.1). Every other described name in that list ends in a carrier
count, and this one shipped without one — the only entry in the column with no number beside it,
which reads as a count that failed to compute rather than as a different kind of row. The literal
`1` is not a shortcut: the marker is only applied when the scan found *no* carriers and the store
tag has the field, so the tag is the carrier and there is exactly one. `[orphan]` keeps no count,
because nothing carries it and `x0` would be noise.

**The filter row reads entity-first** (`Filter by Entity`, then `Filter by Name`, then
`Filter by Value`), at the user's ask: that is the order a line reads, and the type filter that
leads on a task run is the same idea one step coarser. The controls are appended in that order and
wired afterwards by reference, so nothing else moved.

**The other plugin is out of the prose.** Every mention of the CommunityScripts *Custom Field Tag
Filter* plugin — in the `.yml` setting description, in the seeded description this plugin writes for
its own hide field, and in four comments — is gone. It was only ever cited as the source of a
convention, and it is a plugin with settings of its own that this one does not read, so naming it in
a description a user reads next to *our* setting invited exactly the confusion it caused. Nothing
about the mechanism changed.

## 25. A description follows its field (1.1.0)

§24 moved the *setting* on a rename and left the other half of the same mistake in place: a
description is filed under the field's **name**, so a rename left it behind — the renamed field
arrived undescribed, and the description became an `[orphan]` under a name nothing carried. The
value follows the name through `partial` + `remove`; this is the other thing that has to.

**For every field, not for the hide one.** The obvious reading of the request was to fix the field
§24 is about, and that would have been the special case of a general bug: nothing about the hide
field makes its description more attached to its name than any other. `moveDescription` runs for
every rename, and `followHideRename` stays what it is — the *setting* really is one field's
business.

**It writes the store from the module-level copy, not from a dialog.** `readStore` already caches
`_descriptions` for the field-name tooltips; it now keeps the parsed blob beside them as `_store`,
which is all `serialiseStore` needs. The bulk dialog therefore writes the descriptions store
without holding one, and without a second parser: one `tagUpdate` carrying `description`, the same
shape `DescRun.apply` sends.

**Refused in the two states the descriptions dialog also refuses to write in** — a description that
is not our JSON (`broken`), and a store stamped by a newer release. Both are cases where writing
the whole blob back is what loses something, and the reasoning in §22's version gate is unchanged
by the caller being a different dialog. It says so in the log rather than failing silently, because
the user is left with a description under the old name either way and only the line tells them.

**A new name that already has a description keeps it.** Overwriting it would destroy a sentence
somebody wrote, silently, to make room for another one — the same call `plan()` makes when a rename
would land on a key an entity already carries (§6a), and for the same reason. One `[INFO]` names
both.

**Chained, never fired alongside.** `apply()` runs `moveDescription` and *then* `followHideRename`,
so the two `tagUpdate`s a hide-field rename makes — the description and the mark — are never in
flight against the same tag at once. Undo reverses both, and reads the pair off `c.to` on the
changes rather than remembering a second copy of it; pressing Undo twice is idempotent, because the
second call finds nothing filed under the name it would move.
