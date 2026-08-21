# EntityNameMaintainer — design notes

Why the parts that look arbitrary are the way they are. This file does not ship
(`files:` carries the `js`, the `yml` and the `README.md`), so this is where a release is
argued.

## 1. The trigger is a rename, not a button

The brief said "when an entity is renamed (manually for now, maybe more later, on-update)",
which reads two ways: *the trigger is manual for now*, or *only hand-made renames are
covered for now*. The user picked the second — the plugin watches `window.fetch` and reacts
to the mutation Stash's own edit form posts.

That choice is what makes the old name obtainable at all. A button pressed after a rename
would have to ask the user to type the name they just replaced, which is the one string they
no longer have in front of them. **So the wrapper reads the current name first, then lets the
mutation through.** One small query in front of a save the user has just pressed, and it is
exact.

The alternative considered and rejected: cache every entity name seen in a `find*` response
and look the id up on a rename. Cheaper by one round trip, and a guess — it is right only
when the page that loaded the entity is the page doing the renaming, which is usually true
and not always, and there is no way for the plugin to tell the two apart.

**A save is not a rename.** Stash's edit form posts the name field on every save whether or
not it moved, so the reaction is gated on `before !== to` and on the response having landed
without errors. `tests/enm.test.js` pins both.

## 2. Nothing here needs a re-entrancy guard, and that is a property of `ORIG_FETCH`

Every read and write this plugin makes goes through the fetch it captured at load, never
through `window.fetch`. Its own `sceneUpdate` — which carries a replaced `title`, and
therefore looks exactly like a rename — never reaches the wrapper.

A `_writing` depth counter was written first, on the model of
`MergePerformerTagsToScenes`' `_mergeDepth`. It was dead code the moment `gqlRequest` was
pointed at `ORIG_FETCH`, and it survived one round as a reference to a variable that no
longer existed — which the settings load caught, and only because a `ReferenceError` in a
`.then` becomes a rejection rather than a crash. **A guard nothing exercises is a guard
nothing checks.**

## 3. Both halves of the lease protocol

This is the first plugin here that reacts *and* writes in bulk, and it needs both entries.

- **Respecter.** A sibling rewriting the library renames many things at once. One dialog per
  rename would be the worst possible answer, so a live foreign lease means the plugin stands
  down entirely — no dialog, one console line.
- **Lease holder.** Proceed and Undo each take one for their duration, labelled
  `Entity name replacement` and `... (undo)`, per the repo rule that an Undo is a bulk run
  too.

It **declares** nothing: a text replacement is not a relationship copy, and any path id it
published would be a claim about a graph it never walks. It registers no `order` priority
either, because it draws no button into an entity's action row — the rename is the trigger.
Both absences are the rule being followed, and the suite pins them together the way
`TagBundleClipboard`'s three are.

## 4. The field table is candidates; the server settles it

`ENTITIES[*].fields` is a list of names this plugin would *like* to search. One
introspection query per scan turns that into what the running Stash actually has, and what
shape each one is — `String`, `[String!]!`, or the `Map` that custom fields live in.

This is not defensiveness for its own sake. Every other plugin here has a section in its
notes about a schema guess that was wrong, and the failure mode for a *search* tool is the
worst one available: a bad field name fails the whole query, the scan reports nothing, and
"your Stash calls it something else" is indistinguishable from "nothing in your library
mentions that name". A dropped field is at least a smaller answer to the right question.

It also removes the shape guessing. `Studio.aliases` is a list and `Group.aliases` may not
be; `Performer` uses `alias_list` and everything else uses `aliases`. None of that has to be
right in the table, because none of it is read from the table.

**The unwrap goes four levels deep**, which is what `[String!]!` costs: NON_NULL → LIST →
NON_NULL → SCALAR. It shipped at three, which silently dropped every list field, and
`tests/enm.test.js` builds its fixture at the full depth precisely so that a shortened
query fails there rather than in someone's library.

The cache is per page load, because the schema cannot change without a restart and a rename
is exactly the moment nobody wants to wait for it twice.

## 5. Case-insensitive substring, and what pays for it

Matching is a plain case-insensitive substring. A name written in prose is written the way
the sentence wanted it, so a case-sensitive match misses the mentions most worth fixing —
and a hit the user can see and untick is better than a miss they cannot.

What that costs is "Ann" matching inside "Anna". Three things pay for it and they are all in
the dialog rather than in the matcher: the **context on every line** with the match marked,
the **tick on every line**, and the **two limits**. The `ponytail:` comment on `occurrences`
names the upgrade — a word-boundary mode — for when short names turn out to be common
enough to be worth a control.

## 6. Filters scope, ticks decide, and the two never touch

The first draft had the filters act as bulk tick/untick, which is what a filter row usually
does when there is nothing else in the dialog. The user's own correction is the design:

> Change this to: The filters, when Off, hide from view and ignore those replacements (Off),
> without losing the previous Off/On selection when On/visible. Turning filter On shows
> category in list but does not change instance checkbox.

So `enabled = checked && typeOn[type] && attrOn[label]`, and nothing writes to `checked` but
the user. The reason it matters is loss: a filter that sets ticks destroys work, and the
destruction is invisible until the category comes back. **All On / All Off act on the
filters only**, for the same reason.

The filter rows are built from what the scan actually hit — a toggle for a type with nothing
in it is a control that cannot change anything.

## 7. Attribute labels are per concept, not per field

`Details` on a Scene and `Details` on a Performer are one filter, because a user turning
Details off means both. `alias_list` and `aliases` both read **Aliases**. Custom fields are
*two* labels, `Custom field name` and `Custom field value`, because replacing in one renames
a field and replacing in the other edits its contents — a user may well want one and not the
other.

## 8. Custom fields are changed structurally, never as text

A custom-field key is moved by writing the new one into `partial` and putting the old one in
`remove`; a value is changed by writing the key again. Nothing in this plugin edits JSON as
a string, so a map cannot come out malformed. A rename that would collide with a key the
entity already has is skipped and said out loud.

Values that are not strings — a number, an object — are not text and are left alone.

**And the entity that carries another plugin's store is skipped whole.**
`CustomFieldsBulkEditor` keeps every custom field's description as JSON inside one tag's
*description*, which is an ordinary text field as far as this plugin can tell. Rewriting
inside it by substring is exactly how it stops parsing. The store marks itself with a custom
field so it can be recognised after any rename; both the current name and the legacy one are
checked, since the two plugins can be at different releases.

## 9. Every field is re-read immediately before it is written

The dialog can be open for minutes. The scan recorded occurrence *positions*, and a position
into a string somebody else has since edited is a position into a different string.

So `buildUpdate` re-reads the entity by id and checks, character for character, that the old
name is still at each recorded position. A field that has moved is skipped, named in the log,
and its neighbours in the same entity are still written. That is cheap — one query per entity
being written, in a batch that is already writing — and it is the whole of this plugin's
answer to concurrency. It is *not* a transaction: something changed between the re-read and
the write still wins.

## 10. Two limits, and only one of them refuses

`b1WarnAbove` adds a proceed-with-caution note and changes nothing else. `c1StopAbove` ends
the scan and disables Proceed.

Both are settings rather than constants because what counts as "too many" is a fact about
the library. A short name in a large collection legitimately matches hundreds of times, and
a user who cannot raise the ceiling is a user the dialog has simply refused. They are counted
in **occurrences**, not entities: one long description can hold several, and the number that
matters is how many replacements the press commits to.

The stop limit ends the scan rather than merely disabling the button, because there is no
point reading another hundred thousand rows for a listing nobody can act on. Copy log and
the listing still work, so the user can see what it found.

## 11. One button for Proceed and Undo

The brief writes it `[Proceed/Undo]`, and the two never overlap: after a write the listing
describes a library this dialog has already changed, so offering Proceed over it would write
from a plan the user is no longer looking at. Same reasoning as
`CustomFieldsBulkEditor`'s Apply/Undo pair, one button instead of two because the brief asked
for one and there is nothing to show in both states at once.

Amber, per the repo's colour rule — it writes. **All On / All Off are amber too**, at the
user's explicit request, which is the one place here that does not follow from the rule (they
change nothing in the library). The rule is about telling a plugin's controls from Stash's,
and these are unambiguously ours.

## 12. The head carries the backup sentence

This dialog writes, so it carries the standing sentence in the shared wording, unedited. The
`TagBundleClipboard` waiver is for dialogs that issue no mutation at all, which this is not.

## 13. Scene markers are not covered

A marker carries a `title` and no page of its own to be renamed from, so there is no rename
for the watcher to see. Adding markers to the *scan* alone would mean listing occurrences in
a type that can never be the trigger — worth doing when there is a second way in, not before.

## Unverified in a live Stash

Everything below is a guess the test suite cannot check. The major digit stays at 0 until
this list is empty.

- **Which mutation Stash's edit form actually posts, and what it carries.** The watcher
  matches `<type>Update(` in the query and an `input` with an `id` and a name field. A form
  that posts a differently-named operation, or wraps the input, is not one it sees.
- **That the response body is JSON and `resp.ok` is true on success.** Both are assumed.
- **The introspection query itself** — `__type(name: "Scene")` and friends, aliased seven
  ways in one document.
- **`FindFilterType` accepting `sort: "id", direction: ASC` on all seven `find*` queries.**
- **Whether `custom_fields: { partial, remove }` in one input does what the schema reads as
  doing** — write the new keys and drop the old ones, in that order.
- **That a `[String!]` field can be written back as a plain array** on every one of the seven
  update inputs.
- **Every field name in `ENTITIES[*].fields`.** Introspection makes a wrong one harmless, but
  a *missing* one — a text field this plugin never thought to look in — is invisible.
- **The settings page decoration**, which depends on Stash's own `.setting-group` /
  `.setting` / `.sub-heading` markup.
- **How long a whole-library scan actually takes**, and therefore whether `a1SkipImages` is
  enough or the per-field `OR` filter chain in the `ponytail:` note is needed.
