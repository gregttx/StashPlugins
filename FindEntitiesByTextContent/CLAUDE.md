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

## 6. The buffer pauses the search rather than the search knowing about the buffer

The brief offered two ways to keep a long result list bounded: bidirectional fetching over
the whole list, or auto-pausing when the buffer fills. The second is far less machinery and
loses nothing, because **every result stays in memory** — the cap is on rendered rows, and
Copy log hands over all of them.

**It stops at a page boundary, not at the exact row.** A page is the unit the whole loop
works in; half a page of results on screen with the rest of that page discarded is a state
worth neither inventing nor explaining. So the check is at the end of the page, and the
on-screen count can be exactly the cap.

Continue clears the rendered rows and resumes. That is the one thing here that throws
something away, and the log line says where it went.

## 7. `epoch`, which is what makes Refresh and Cancel safe

A page can be in flight when the user presses Refresh or closes the dialog. Every `step`
carries the epoch it started under and returns immediately if it has moved. Without it, a
stale page appends to a listing the user has already replaced — or to a dialog that is no
longer on the page.

`close()` bumps it too, for exactly that second case.

## 8. What is remembered lives in `localStorage`, not in the plugin configuration

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

## 9. The head does not tell anyone to back up

Nothing here writes, so the standing sentence would be false. The head says where the results
go instead — the `TagBundleClipboard` shape, and the shared rule is explicitly about dialogs
that *write*.

The consequence is that the run's own warnings need a slot, and they take the amber `.warn`
one the backup sentence would have occupied. Same swap `TagBundleClipboard` makes.

## 10. Search is refused rather than silently doing nothing

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
- **The settings page decoration**, which depends on Stash's own `.setting-group` /
  `.setting` / `.sub-heading` markup — including `ownParts`' refusal to decorate a group
  whose header row holds a button, which is how Settings → Tasks is told apart from
  Settings → Plugins here.
- **`<select>` and `<input type="number">` inside the dialog**, which no other plugin in this
  repo puts there and which Stash's own CSS may style.
