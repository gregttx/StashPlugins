# FindEntitiesByTextContent — design notes

Why the parts that look arbitrary are the way they are. This file does not ship
(`files:` carries the `js`, the `yml` and the `README.md`), so this is where a release is
argued.

## 1. It exists because Stash's filters cannot be asked this question

Each `*FilterType` names its own fields — `SceneFilterType.details`,
`PerformerFilterType.details` — so "any text field" would already mean a query per type with
an `OR` chain across its fields. Custom fields close the door: `CustomFieldCriterionInput`
takes a `field` name, and there is no way to ask for whichever keys an entity happens to
carry. The repo-root note on custom fields says as much, and it is the reason
`CustomFieldsBulkEditor` reads a named selection rather than offering a key picker.

So the rows come back and the matching happens here. The `ponytail:` comment at the top of
the file names the only worthwhile narrowing — the per-type `OR` chain, which would cover
six of the seven types' non-custom-field halves — for if a large library makes this slow.

**Turning the types off by default is the real answer to speed**, and it is what the brief
asked for. A user looking for a studio name does not need Images read.

## 2. Teal, and the first plugin the read-only half of the colour rule applies to

The repo rule has always said: amber where a plugin writes, `btn-info` teal where it only
reads. Every plugin here writes, so the teal half had never been used. This one does not
write at all — no mutation on any path, pinned by its own suite — so its **task button** is
teal.

**The filter toggles are amber anyway**, at the user's explicit ask, and that is a
deliberate exception rather than an oversight. Amber here is doing the other job the rule
mentions: marking a control as *ours* rather than Stash's. `FILTER_ON_VARIANT` is a separate
constant from `PLUGIN_BTN_VARIANT` precisely so the two reasons stay legible.

## 3. Neither side of the lease protocol, and that is three absences on purpose

No `respecters` entry (it reacts to nothing), no lease (it writes nothing), no `declares`
entry (no relationship copy), no `order` priority (no button in an entity's action row).
`TagBundleClipboard` is the other plugin in this shape, and its notes say the same thing: the
absences are the rule being followed, so the suite pins all of them together rather than
leaving a later edit free to add one quietly.

It does **note** a foreign lease in its head — not a stand-down. A bulk run is rewriting the
entities being read, so a result may be a moment out of date. Saying so costs a line;
refusing to search would be absurd.

**`coop()` is called at load even though nothing is registered.** Every sibling brings the
shared object into its full shape as a side effect of the entry it does make. A plugin that
loads first and leaves `leases` undefined is one the next plugin's `coop()` has to repair —
and would have been a real bug in a browser where this plugin happened to be alphabetically
first.

## 4. The field table is candidates; the server settles it

Byte-for-byte the same reasoning as `EntityNameMaintainer`'s, and the same code: candidate
names in the table, one aliased `__type` query per search, and a `String` / `[String!]!` /
`Map` answer per field. See the repo-root section "Ask the schema rather than guessing a
field name" — a search tool is the worst place for a schema guess, because a failed query
and an empty library are indistinguishable in the result.

The unwrap goes four levels; the suite's fixture is built at the full depth so a shortened
query fails there rather than in someone's library.

## 5. One result per entity, not per occurrence

The question is *which entities mention this*, and a scene whose details say it nine times is
one scene. So a result carries the attributes it matched in with a count each, and the first
match's surroundings.

This is the one substantive difference from `EntityNameMaintainer`, whose unit has to be the
occurrence because each one is a separate decision to replace or not. Here nothing is
decided, so the entity is the unit and the line stays readable.

## 6. Two filter rows that are not the same kind of control

`EntityNameMaintainer` has a row of entity types and a row of attribute names, and this
plugin now offers the same pair. They look identical - same shape, same amber, same
All On / All Off - and they act at different moments, which is worth being explicit about
rather than papering over:

- **Entity types decide what is *read*.** They are the whole list from the start, they are
  off by default, and turning one on is what sends the next search looking. They are
  remembered, because they are a standing choice about this library.
- **Attribute names decide what is *shown*,** over results already found. The list can only
  be what the search has hit so far - a toggle for an attribute nothing matched in could not
  change anything - so they appear as the search finds them, and a new search starts with the
  row empty again. They are not remembered, because they belong to the search on screen.

**A result is kept if any of its attributes is still showing, and displays only those.** An
entity that matched in Title and Details, with Details off, is still a Title match; its
Details chip goes, and so does the context if that was the line it was quoting. That last
part is why `scanEntity` keeps a context **per attribute** rather than one for the whole
result: a line quoting the details of an entity whose Details filter is off would be the
filter lying about itself.

**Copy log honours the attribute filters and not the buffer.** A filter is a choice about
what is being looked at; the buffer is a limit on what fits. The two deserve opposite
treatment and the tooltip says so.

## 7. The buffer pauses the search rather than the search knowing about the buffer

The brief offered two ways to keep a long result list bounded: bidirectional fetching over
the whole list, or auto-pausing when the buffer fills. The second is far less machinery and
loses nothing, because **every result stays in memory** — the cap is on rendered rows, and
Copy log hands over all of them.

`shownFrom` is what makes the window and the filters compose: the rows on screen are a
window over `results` starting there, Continue moves it to the end, and a filter click
redraws from it. The rows are never the results.

**It stops at a page boundary, not at the exact row.** A page is the unit the whole loop
works in; half a page of results on screen with the rest of that page discarded is a state
worth neither inventing nor explaining. So the check is at the end of the page, and the
on-screen count can be exactly the cap.

Continue clears the rendered rows and resumes. That is the one thing here that throws
something away, and the log line says where it went.

## 8. A control with nothing to act on is disabled, not merely inert

**All On / All Off** are dead when every type is already on, or already off. The second half
does real work here rather than being symmetry: the types start all-off, so All Off is
disabled the moment the dialog opens, which is what says that default is deliberate rather
than a dialog that failed to load its state.

Same rule as Search, whose `title` says which half is missing. A live button that does
nothing when pressed teaches the user that the control is broken.

## 9. Search and Refresh, and the state where they are not the same button

They were, and that was the bug: both called `start()`, so with the primary button reading
**Search** the two were a duplicate pair sitting side by side. Refresh has a real job in
exactly one place - the states where the primary button has become **Pause**, **Resume** or
**Continue**, and there is no other way to say *start over* without first resuming a search
you are done with.

So Refresh is **hidden wherever the primary button already says Search**. One line in
`syncFooter`, keyed off the caption that button just computed rather than off the state
again, so the two can never disagree about which case this is.

It works mid-run, and that costs nothing: `start()` moves the epoch, so the page in flight
is discarded rather than raced. Forcing a Pause first would have been a rule to explain.

## 10. The counters count toward something

"Scanned 4200 entities" answers *how far* and leaves *out of how many* unanswered, which on
a library-wide read is most of what the line is for.

The number is one query - `per_page: 1` per chosen type, aliased - before the first page.
**Accumulating the `count` the scan already receives with every page was the cheaper option
and the wrong one**: the denominator would grow as each new type is reached, so the line
would read "500 of 500", then "500 of 1700", and a target that moves is worse than no target.

It covers only the types that are turned on, and it is `null` until it lands - and stays
null if that one query fails, which leaves the counters saying exactly what they said before
this existed. **The failure is caught inside the chain rather than beside it**, or a failed
introspection would land in the same handler and the scan would run with no field shapes at
all.

## 11. The log reads in the order things happened

The listing and the messages share one box and one scrollbar. The list block was being
*inserted at the top*, which pushed every message below it - so the first line written, the
one saying what is being looked for, ended up last on the page, where a reader takes it for
the newest.

It is appended now, and `start()` writes its message *before* creating the block. A Continue
or a Refresh gets a fresh block rather than an emptied one, for the same reason: the results
start again after the message that says why.

## 12. `epoch`, which is what makes Refresh and Cancel safe

A page can be in flight when the user presses Refresh or closes the dialog. Every `step`
carries the epoch it started under and returns immediately if it has moved. Without it, a
stale page appends to a listing the user has already replaced — or to a dialog that is no
longer on the page.

`close()` bumps it too, for exactly that second case.

## 13. What is remembered lives in `localStorage`, not in the plugin configuration

Two reasons, and the second is the one that matters. It belongs to the person at this browser
rather than to the server — the same argument `TagBundleClipboard` makes for its clipboard.
And a plugin that wrote its own configuration on every search would be running
`configurePlugin` constantly, which **replaces** a plugin's settings rather than merging
into them (repo-root CLAUDE.md); the two releases that learned this the hard way both lost a
user's settings to one careless write.

Every read and write is wrapped in `try`/`catch`: a private window, or a browser set to block
site data, throws on the accessor itself.

**Zero clears the history as well as switching it off**, which is what the brief asked for
and is the one thing a number box can be asked to do that is not about the future. It is on
the box's own tooltip, because nothing about a "0" says so.

## 14. No settings at all, and what that costs

Every choice this plugin offers is made inside the dialog, where the user already is and
where it is answered on the spot. The one setting it had was the console switch every
sibling carries, and here it duplicated Copy log - which hands over the same lines plus
every result - on a page whose whole point is a list you are looking at.

Two consequences, and both are load-bearing rather than incidental:

- **Stash still renders a group, a heading and a description.** That description is the
  first thing anyone reads before installing, so the *description* half of the shared
  settings design is required here in full. Only the per-**setting** tooltip is not, and
  `tests/style.test.js`'s `settings: false` flag is checked in both directions so the flag
  records the absence rather than excusing a drift.
- **There is no `plugin-<id>-<key>` id to anchor on.** Every sibling with settings finds
  its group through those ids - ours by construction - and keeps a heading match only as a
  fallback. This plugin has the fallback promoted to the only route, which is the one
  anchor in the repo with nothing behind it. `CustomFieldsBulkEditor` was in this position
  before its 0.7.0 and its notes say the same thing.

## 15. The settings anchor, and the guard that excluded the page it was written for

Worth writing down at length because it is the exact shape of mistake this repo keeps
making, and this time it was caught by a user looking at the page rather than by anything
here.

The anchor has to tell two groups apart that are both headed with the plugin's name:
Settings → **Plugins**, which is ours to decorate, and Settings → **Tasks**, which is not -
decorating that one puts a README link and a split description on a page that never had
either, and destroys the task button, because the link's slot is picked by structure and
there that slot is inside the button.

The guard shipped as *"exclude a group whose header row holds a button"*. **Stash puts its
own Enable/Disable button in the plugin group's header row**, so the guard excluded
Settings → Plugins and nothing on this plugin's settings page was ever formatted.

The older plugins had it right and the reason is one word: they test by the task's
**caption**, not by "is there a button". `hasOwnTaskButton` walks the group for a `<button>`
whose text is one of *our own* task names. A button that is not ours says nothing about
which page this is.

**The general lesson is the one the button-placement note already states in another
context: a structural test has to name the thing it means.** "Has a button" was a proxy for
"is the Tasks page", and the proxy was false on the very page it was protecting. Where the
real distinguishing feature is a string this plugin owns, use the string.

## 16. The head does not tell anyone to back up

Nothing here writes, so the standing sentence would be false. The head says where the results
go instead — the `TagBundleClipboard` shape, and the shared rule is explicitly about dialogs
that *write*.

The consequence is that the run's own warnings need a slot, and they take the amber `.warn`
one the backup sentence would have occupied. Same swap `TagBundleClipboard` makes.

## 17. Search is refused rather than silently doing nothing

An empty box "does nothing", per the brief — and a button that does nothing when pressed
teaches nobody anything, so it is disabled with a title saying which half is missing. Same
for no types chosen. A box holding only spaces is empty.

## Unverified in a live Stash

Everything below is a guess the test suite cannot check. The major digit stays at 0 until
this list is empty.

- **The task button.** That Stash renders it in a `.setting-group` headed with the plugin
  name, that a capture-phase click listener beats React's, and that stopping propagation
  suppresses the "added job to queue" toast. Copied from `CustomFieldsBulkEditor`, where it
  is known to work, but never seen working from this file.
- **The introspection query** — `__type(name: "Scene")` and friends, aliased seven ways in
  one document — and whether the server permits introspection at all.
- **`FindFilterType` accepting `sort: "id", direction: ASC`** on all seven `find*` queries.
- **Every field name in `ENTITIES[*].fields`.** Introspection makes a wrong one harmless, but
  a *missing* one — a text field this plugin never thought to look in — is invisible.
- **How long a real search takes**, and therefore whether `RESULT_BUFFER` at 200 and
  `READ_PAGE` at 500 are the right numbers.
- **`per_page: 1` being honoured** by all seven `find*` queries, which is what keeps the
  denominator query cheap.
- **The settings page decoration.** `tests/settings-page.test.js` now drives it against
  both group shapes for every plugin here, so the *logic* is covered; what stays unverified
  is whether those fixtures match the markup Stash actually renders. The Disable button in
  the plugin group's header row is the newest claim in them and the one this plugin got
  wrong.
- **`<select>` and `<input type="number">` inside the dialog**, which no other plugin in this
  repo puts there and which Stash's own CSS may style.
