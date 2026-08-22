# EntityNameMaintainer — design notes

Why the parts that look arbitrary are the way they are. This file does not ship
(`files:` carries the `js`, the `yml` and the `README.md`), so this is where a release is
argued.

**The ticks and the filters were live while the write ran (1.3.0).** `plan()` is taken at the top of
`apply()`, so neither could reach the write - which is exactly why neither should have looked as
though it could: unticking a line mid-write changed the listing and the counters under a write that
was doing no such thing.

**Two different guards, because the two controls fail differently.** The filter buttons are
disabled from `syncFilterButtons`, which `setState` already calls. A row's checkbox has its
`disabled` decided *when the row is drawn*, and a write that starts afterwards redraws nothing - so
the state is asked again inside `set()`, which every route into a tick already goes through, and
the box is put back rather than left showing a tick that did not take. **A flag set at render time
is not a guard against something that happens after the render.**

Found by auditing every dialog here after the same fault was reported against
`PropagateTagsAndPerformers`' Path Settings button.

**The Reload UI button (1.2.0, fixed at 1.2.1).** The stale banner said to reload and nothing on the page did
it, so `ensureStaleNotice` now also calls `ensureReloadUiButton`, which draws one red button beside
Stash's own **Reload plugins** while any plugin here reports a mismatch. The whole mechanism -
why Stash's own reload cannot replace a running script, why the anchor is the section rather than
the button's translated caption, and why the colour is red - is in the repo-root `CLAUDE.md` under
"one Reload UI button"; the three functions are byte-identical in all eight plugins and pinned.

**And its anchor was wrong on every released Stash** - the fix, one release later. The Reload
plugins button is in a `content d-flex justify-content-between` row on `develop`, and in a
`.setting` row of its own on everything up to and including v0.31.1; the first cut matched only the
first, so the button appeared for nobody. It is now the last `<button>` in our section that is not
inside a `.setting-group`, which is true of both. The repo-root note has the reasoning; the lesson
is the one this repo keeps relearning - **markup read off `develop` is not markup the user is
running**, and `tests/settings-page.test.js` now drives both shapes for exactly that reason.

**0.1.0 searches the custom field descriptions `CustomFieldsBulkEditor` keeps, by asking it for
them.** They are the one thing in the listing that is not in the library: prose the user wrote
about a field, mentioning names like any other prose, living as JSON inside one tag - the same tag
this plugin skips whole and must go on skipping, because replacing text inside JSON by substring is
how it stops parsing. So the text is fetched through `coop().api`, and the changed strings are
handed back to their owner. **Nothing here parses or serialises that JSON**, which is the whole
reason this is a call rather than a copy: the store's shape is that plugin's decision, and a copy
of it here would be wrong the first time it changed.

**0.1.1 stops the skip line reading as a loss.** *"Left out: 1 entity carrying another plugin's
machine-written store"* was true before and is still true - the store tag is skipped as an entity
whatever else happens, because its JSON is not text to rewrite by substring - but it now sits in a
run that has just searched the prose inside that very tag, where "left out" is the wrong thing for
a user to take away. So the line ends with which of the two happened: the descriptions were
searched through their owner and nothing was missed, or they were not, and the sibling is what
makes them searchable. `descriptionsRead` is `null` until the sibling answers, which is what tells
"none to search" from "never asked".

**It is an eighth entity *type*, not a new field.** `ENTITIES` gains a `cfbeDescriptions` entry
with a label, a plural and no route; `TYPE_ORDER` leaves it out, which is what keeps it out of the
scan loop and out of the introspection. Everything downstream then works unchanged - the plan
groups by type and id, the filters get a toggle, the listing gets rows, the stale check re-reads
before writing, Undo replays. The alternative - a field on some pseudo-entity - would have needed a
second code path through all of that.

**The one real difference is who writes, so that is the only fork: `job.write`.** A job with no
writer is an entity and goes out as a `<Type>Update`; a job with one calls it. `sendJob` is that
single line, and it takes the operation name as an argument rather than choosing it, because
`ENM_Write` and `ENM_Undo` are how a write is told from a replay in a Stash log and in the suite -
folding those into one name was the first attempt and the suite caught it.

**A hit with no page has no link.** A description is named by the field it describes and there is
nothing to open, so the row draws a span where an entity draws an `<a>`. `entityLabel` is the same
fact in the log: `Custom field "colour"` rather than `Custom field colour "colour"`, off a `noId`
flag on the pseudo-spec, and every line that names what was written now goes through it.

**Feature-detected per call, and an absent sibling is not a failure.** The plugin may be disabled,
or a release older than the one that publishes the halves; both read correctly as "there are no
descriptions to search here", and the library half of the scan is untouched. A sibling that *is*
there but cannot answer gets a WARN and the listing still stands - refusing every library hit
because one sibling was unhappy would be the worse trade.

**Its suite loads the real publisher into the same page**, the way `tests/tagclip.test.js` does for
the other cross-plugin call in this repo. A fake would have proved only that this plugin can call a
function; what needs proving is that the two agree about what a description is, and only the real
one can answer that. It is loaded *after* this plugin, which is also what proves the API is read at
call time rather than captured at load.

**0.0.7 puts a confirm on Close.** The listing is not reproducible: the scan runs off a rename
that has already happened, and the old name is known only because the plugin watched it go. So
Close - and the Escape key, which acts through it - arms and counts down rather than closing, and a
second press within five seconds closes. The tooltip is the user's own wording: *Some
cross-references might be lost. Copy log just in case.*

**Only over a listing nothing has been done with.** Two ways that is true and one way it is not.
An empty listing is nothing to lose, and a confirm over it would be the dialog asking permission to
do nothing - the same rule §12 applies to All On / All Off. **A listing Proceed has already acted
on is equally nothing to lose**, which 0.0.7 got wrong: the replacements are in the library, the
listing has done its job, and asking again reads as the dialog refusing to let go. `changes` is
exactly that fact and needed no new state - Proceed fills it and Undo empties it - so an undone run
is guarded again, which is right, because it is back to being a listing nobody has used. The
countdown disarms itself, so a user who walks away comes back to an ordinary Close rather than to a
dialog waiting on a second press it will never explain.

**1.1.0 paints that same question on the button.** Close is green while pressing it will
close - nothing found, or a Proceed that has landed - and grey while it will ask. It is one
predicate, `clearToClose`, read by both `requestClose` and the paint, so the colour cannot come to
mean something the confirm does not: a second condition list would be a second definition of "clear",
free to drift from the one that actually decides.

**Green, which is neither of the repo's two button colours.** Amber says a control writes and teal
says it only reads, and Close does neither - it is the one control here whose colour is about the
*dialog's* state rather than about what the button does. This dialog is also the only one in the
repo that opens by itself, on a rename the user did not ask it about, so "you are done, nothing is
waiting on you" is worth a glance rather than a tooltip. Do not read this as a third repo-wide
convention; it is one button in one dialog, and the repo rule it does follow is that a colour has
to mean one thing.

**Painted from `setState` alone**, beside the cursor and the disabled flags, for the same reason
the disarm is: `hits` and `changes` only move on a scan, a write or an undo, and all three end
there. An armed Close is never green without that being a condition - arming only happens where
`clearToClose` is already false.

**And the head wears the whole name.** `PLUGIN_SHORT_NAME` exists to shorten where the manifest
name would crowd out what follows it; here what follows is an entity label and an id, which fits,
and a head reading `ᝯㄝₓ Name Maintainer` over a settings page reading `ᝯㄝₓ Entity Name Maintainer`
reads as a different plugin. It is `PLUGIN_NAME`, the way `NormalizeParentTags` writes the same
decision - as an assignment rather than a second copy of the literal, so a rename cannot move one
and not the other.

**It arms in the caption rather than putting up a second dialog.** `Are you sure? (5)` is on the
button being pressed, which is where the question is; a `confirm()` would be a modal over a modal,
and the repo has no chrome for one. Same latch shape as `PropagateTagsAndPerformers`' Undo, which
arms for the opposite reason - that one guards a write, this one guards a *loss of a read* - and
that is worth noting: this is the first control here that asks before something that writes
nothing.

**And a write disarms it.** Pressing Proceed while the countdown is running is the answer to the
question the countdown is asking, so leaving it going means a disabled button reading
`Are you sure? (3)` mid-countdown while the replacements go out - and by the time it disarms itself the question
no longer applies at all, since `changes` is filled. It hangs off `setState`, not off `go()`: every
path in and out of a write goes through there, which is the same reason the cursor does.

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

## 2. The re-entrancy guard, and why `ORIG_FETCH` was only half of it

Every read and write this plugin makes goes through the fetch it captured at load, never
through `window.fetch`. Its own `sceneUpdate` — which carries a replaced `title`, and
therefore looks exactly like a rename — never reaches the wrapper.

**This stopped being the whole story once the script could be evaluated twice** - see the
note on the delegating wrapper below, and the `__enm` mark that replaced the reasoning here.
A `_writing` depth counter was written first, on the model of
`MergePerformerTagsToScenes`' `_mergeDepth`. It was dead code the moment `gqlRequest` was
pointed at `ORIG_FETCH`, and it survived one round as a reference to a variable that no
longer existed — which the settings load caught, and only because a `ReferenceError` in a
`.then` becomes a rejection rather than a crash. **A guard nothing exercises is a guard
nothing checks.**

## 3. Both halves of the lease protocol

This is the first plugin here that reacts *and* writes in bulk, and it needs both entries.

- **Respecter.** A sibling rewriting the library renames many things at once. One dialog per
  rename would be the worst possible answer, so a foreign lease means the plugin stands down
  entirely — no dialog, one console line. *Which* lease counts is the next section, and it
  is the part that was wrong.
- **Lease holder.** Proceed and Undo each take one for their duration, labelled
  `Entity name replacement` and `... (undo)`, per the repo rule that an Undo is a bulk run
  too.

It **declares** nothing: a text replacement is not a relationship copy, and any path id it
published would be a claim about a graph it never walks. It registers no `order` priority
either, because it draws no button into an entity's action row — the rename is the trigger.
Both absences are the rule being followed, and the suite pins them together the way
`TagBundleClipboard`'s three are.

## 4. *When* the lease is sampled, not whether

The bug this repo will make again, so it is written at length. The dialog opened for some
renames and not others, with nothing to distinguish them from the outside — the user's words
were "not sure what is the difference".

`onRename` ran after the mutation's response and sampled `foreignLease()` there. By that
instant a **sibling reacting to the same save** has already taken its own lease:
`NormalizeParentTags`' auto prune or roll-up, `MergePerformerTagsToScenes`' auto-merge. Both
react to a tag or performer update, both take a short lease while they rewrite what it
touched, and both do so in the same tick this plugin would have opened its dialog. So the
dialog silently did not open — and **whether the sibling reacts at all depends on the
entity**, which is precisely why it read as a property of the tag rather than as a race.

The fix is one line moved: sample the lease in the fetch wrapper, **before the write goes
out**, and carry that answer to `onRename`. At that moment nothing has reacted to this save
yet, so a lease that exists is a genuinely pre-existing bulk run — which is the only thing
the stand-down was ever meant to be about.

**The general shape: a lease answers "is a bulk run in progress", and that question has a
time.** Ask it after the event you are reacting to and you are also asking "did anyone else
react to this", which is a different question with the opposite right answer. Any future
plugin that both reacts and respects leases has this to get right.

## 5. The response body is shared, so nothing here reads it

**This is the bug that was actually happening**, found by `tools/enm-probe.js` against the
user's own Stash after three rounds of reading the diff had found nothing:

```
tagUpdate for Tag 2287 posts name as "..."
Tag 2287: the response was not JSON.
```

The mutation was seen, matched, and the old name read. Then `resp.clone().json()` **rejected**
— on a page carrying five of these plugins, each with its own `window.fetch` wrapper, each
cloning and reading the same response. The symptom was a dialog that did not open, with
nothing anywhere saying why until the trace existed.

**The cause was not pinned down, and pinning it down would have bought a fix good until the
sixth plugin.** So the dependency is gone instead: the question "did the write land" is asked
of the *server*. One more by-id read after the mutation resolves, and the entity either
carries the new name or it does not.

That is not merely a workaround, it is the better question. A GraphQL mutation can return
200 carrying `errors`, or succeed in part; what this plugin needs to know is whether the old
name is now gone, and only the entity can say. The response check was answering a proxy for
it — the same category of mistake as §14's "has a button" standing in for "is the Tasks
page", in a completely different place.

**The general rule, and it belongs to any plugin in this repo that wraps `fetch`: a response
body is shared, and a plugin that reads one is one of an unknown number doing so. Anything
that can be re-read from the server should be.** `tests/enm.test.js` pins it from the outside
— it wraps the fake fetch, counts `clone()` and `json()` on every response to a request the
plugin did not make, and requires both to be zero.

The cost is one query per rename, next to the one already made before the write. The dialog
that follows makes dozens.

## 6. Two other things that could produce the same symptom, fixed while looking

Neither is confirmed as the cause; both are cheap and both fail in exactly the
"works sometimes" way, which is the shape that costs the most to diagnose.

- **A batched request body.** The GraphQL transport permits an *array* of operations in one
  body. `renameOf` read `body.query` off the parsed object, so a rename batched with
  whatever else the page happened to be doing would be invisible — and what else the page is
  doing is not a property of anything the user controls. It walks the array now, and
  `anyErrors` reads a batched response the same way.
- **A body that is not on `init`.** `fetch(new Request(...))` carries it on the request
  instead, where this cannot reach it synchronously. Not handled — reading it means
  `clone().text()`, which is async and would have to hold the write — but it is *reported*
  under the debug switch, so the next report says whether it is happening at all.

## 7. The diagnostic has to work backwards, and a latched wrapper is why

Both of these came out of the same report - *"still not seeing the dialog on rename, and the
case that used to work does not any more"* - and neither could be answered by reading the
diff, because the diff could not have caused it. What that says is not "look harder"; it is
that the plugin could not be asked what it did.

**A switch is the wrong shape for this.** The repo already wrote this down about the button
gates: a diagnostic that only speaks when it was turned on beforehand is silent exactly when
it is wanted. Nobody flips a flag *before* the rename that is going to fail. So every
decision now goes into a bounded ring - twenty-five lines, a string per save - read back with
`__GTTx__.enm.status()` after the fact. The switch is still there and prints the same lines
live; it is the running commentary, not the record.

**The counters come before the trace, and answer a question the trace cannot.**
`requests seen: 0` means the hook is bypassed and nothing about tags, names or leases is
relevant. That is the single most valuable line in the report and it did not exist.

**And a latched wrapper flag was found while building it.** `alreadyWrapped()` set a flag on
the shared object and returned early if it was set. Stash's Reload plugins re-injects the
script into a page that is *not* reloading - so the new evaluation prints its banner, finds
the flag, installs nothing, and leaves the **previous release's closure** handling every
rename. The console says one version; the behaviour is another's. **That is the one failure
a version banner cannot warn about, because the banner is printed by the half that is not
running.**

One wrapper ever, forwarding to `__GTTx__.enmHandle`, which the newest evaluation overwrites.
It costs a property and it makes "reload plugins" mean what it says.

The consequence that has to be handled with it: on a re-evaluated page the fetch this script
captured at load *is* the wrapper, so its own writes come back through it and an `ENM_Write`
carrying a replaced title reads as a user's rename. Every request this plugin makes is marked
`__enm` on its init object, and `handle` passes those straight through. §2's claim - that
`ORIG_FETCH` alone is enough - was true only while the script could be evaluated once.

## 8. The gate switch, on the name the repo already has

`__GTTx__.StashPluginCoop.debugButtons = true` turns on an `[enm gate]` channel. The name is
narrower than what it now covers — this plugin draws no button — but the repo-root rule is
explicit that renaming it would strand every user who has the old name written down, and the
point of a shared switch is that a user types **one** thing.

Two shapes, and the split is the repo's own: a rename is a **user action**, so those lines
are not deduplicated — one line per save is the point, and seeing the line at all is what
says the hook fired. The one deduplicated line is "a request went past with no readable
body", which could otherwise fire on every request the page makes.

What it answers, in order: the mutation was seen and what it posted; the lease held at that
moment; the old name that was read; whether the name actually moved; whether the save came
back clean; and whether a dialog was already open. **That list is the set of ways this plugin
can decide to do nothing**, which is the whole of what a "why did nothing happen" diagnostic
has to cover.

## 9. The field table is candidates; the server settles it

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

## 10. Case-insensitive substring, and what pays for it

Matching is a plain case-insensitive substring. A name written in prose is written the way
the sentence wanted it, so a case-sensitive match misses the mentions most worth fixing —
and a hit the user can see and untick is better than a miss they cannot.

What that costs is "Ann" matching inside "Anna". Three things pay for it and they are all in
the dialog rather than in the matcher: the **context on every line** with the match marked,
the **tick on every line**, and the **two limits**. The `ponytail:` comment on `occurrences`
names the upgrade — a word-boundary mode — for when short names turn out to be common
enough to be worth a control.

## 11. Filters scope, ticks decide, and the two never touch

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

## 12. A control with nothing to act on is disabled, not merely inert

**All On / All Off** are dead when pressing them would change nothing: there are no filter
toggles at all — a scan that found nothing draws none — or every one of them is already in
the state the button would put it in.

Small, and worth stating because the alternative is the usual one: a live button that does
nothing when pressed teaches the user that the control is broken rather than that there is
nothing to do. The same rule already governs Proceed, whose `title` says which half is
missing. `FindEntitiesByTextContent` gained the same pair on the same day, where it also
answers the question its all-off default raises: All Off is dead the moment the dialog opens,
which is what says the types start off deliberately.

## 13. Attribute labels are per concept, not per field

`Details` on a Scene and `Details` on a Performer are one filter, because a user turning
Details off means both. `alias_list` and `aliases` both read **Aliases**. Custom fields are
*two* labels, `Custom field name` and `Custom field value`, because replacing in one renames
a field and replacing in the other edits its contents — a user may well want one and not the
other.

## 14. Custom fields are changed structurally, never as text

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

## 15. Every field is re-read immediately before it is written

The dialog can be open for minutes. The scan recorded occurrence *positions*, and a position
into a string somebody else has since edited is a position into a different string.

So `buildUpdate` re-reads the entity by id and checks, character for character, that the old
name is still at each recorded position. A field that has moved is skipped, named in the log,
and its neighbours in the same entity are still written. That is cheap — one query per entity
being written, in a batch that is already writing — and it is the whole of this plugin's
answer to concurrency. It is *not* a transaction: something changed between the re-read and
the write still wins.

## 16. The counters say where the scan is, not only how far

`Scanned 4200 entities` answers *how far* and leaves *where* unanswered, and on a library
whose Images outnumber everything else by an order of magnitude those are different
questions: a number that has stopped moving and a number moving through the biggest type
look identical.

So a second line, one entry per type in scope, `Plural read/there`.

**Each type's own total costs nothing** — every page query already selects `count`, so the
denominator lands with that type's first page and never moves. **There is deliberately no
aggregate "of N"**: summing those counts as each type is reached would make the grand total
grow while the scan ran, which is the moving-target problem `FindEntitiesByTextContent`
needed a whole extra query to avoid. Per type the number is honest without one.

A type this Stash has none of the searched fields on is dropped from the breakdown rather
than left at zero, where it would read as a type still to come; the log line is what says it
was skipped.

## 17. The listing reads in the order things happened

The listing and the messages share one box and one scrollbar. The list block was being
*inserted at the top*, which pushed every message below it - so the first line written, the
one saying what is being looked for, ended up last on the page, where a reader takes it for
the newest. It is appended now, and the cursor is moved back under it, since the cursor's
whole job is to be the last thing in the box.

The same mistake was in `FindEntitiesByTextContent` and was fixed there first. **Two plugins
whose dialogs are one design will have one bug twice** - which is the argument for looking at
the sibling when a report names either.

## 18. Two limits, and only one of them refuses

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

## 19. One button for Proceed and Undo

The brief writes it `[Proceed/Undo]`, and the two never overlap: after a write the listing
describes a library this dialog has already changed, so offering Proceed over it would write
from a plan the user is no longer looking at. Same reasoning as
`CustomFieldsBulkEditor`'s Apply/Undo pair, one button instead of two because the brief asked
for one and there is nothing to show in both states at once.

Amber, per the repo's colour rule — it writes. **All On / All Off are amber too**, at the
user's explicit request, which is the one place here that does not follow from the rule (they
change nothing in the library). The rule is about telling a plugin's controls from Stash's,
and these are unambiguously ours.

## 20. The head carries the backup sentence

This dialog writes, so it carries the standing sentence in the shared wording, unedited. The
`TagBundleClipboard` waiver is for dialogs that issue no mutation at all, which this is not.

## 20b. The head names the entity, not just its id

`Tag "Blonde hair" (57) renamed` rather than `Tag 57 renamed`. The id is the one thing about
the entity the user cannot recognise, and the shape is the repo's — `Label "name" (id)`, the
same one every log line here already uses. **The new name, not the old one**: the head says
which entity this is about as it stands now, and the old name is what every line below quotes.

It costs no query, which is what separates this from the siblings' `scopeLabel`: the rename is
the trigger, so both names are already in hand when the dialog is constructed.

## 20c. Cancel takes back the rename, and only while it is the only write

The dialog reacts to a rename that has **already landed**, so the user's own edit is the one
write it cannot undo through `changes` - `changes` holds what *this dialog* wrote. Cancel is
that missing half: one `<Type>Update` putting `nameField` back to `oldName`, then `close()`.

Three decisions in it:

- **Offered only while `changes` is empty.** After Proceed the replacements in the library
  all point at the new name, and putting the name back alone would leave every one of them
  wrong. `changes` is already the fact the write button's caption is decided by, and an Undo
  empties it, so Cancel comes back with Proceed - one condition, no second flag.
- **Amber, where every sibling's Cancel is grey.** Theirs abandon a plan; this one writes.
  The repo's colour rule is about which controls change the library.
- **Escape does not reach it.** `escapeButton` returns `closeBtn` only, which is where this
  plugin's copy of that shared function differs from the other four. A key press that wrote
  to the library would be a worse version of the thing the Close confirm exists to prevent.

- **It reloads the page.** The entity was changed from outside Stash's own UI, so the form
  behind the dialog goes on showing the name that was just taken back and no plugin here can
  re-render somebody else's React state. `location.reload()` is what the user would press F5
  for, and nothing is lost by it: the save that opened this dialog is the write that landed.
  Only on success - a refused revert changed nothing and must leave the log on screen to be
  read.

- **The entity decides whether it landed, not the response.** §5's rule applied to this
  plugin's own write: a mutation can return 200 carrying `errors`, and a request that rejects
  can still have been applied. So the write is followed by one more `currentName`, and the
  write's own error is only reported if that read agrees the name is not back. Reporting
  "not reverted" over a name that is already back would leave the dialog describing a library
  it no longer matches, and skip the reload that would have shown it.

It re-reads the name immediately before writing, like every other write here: an entity
renamed again since the dialog opened is not this dialog's to put back, and the log says so
rather than the write going out. The read and the write both go through `gqlRequest`, so the
watcher does not see its own reversal as a new rename.

## 21. Scene markers are not covered

A marker carries a `title` and no page of its own to be renamed from, so there is no rename
for the watcher to see. Adding markers to the *scan* alone would mean listing occurrences in
a type that can never be the trigger — worth doing when there is a second way in, not before.

## Unverified in a live Stash

Everything below is a guess the test suite cannot check. The plugin has been run in a live
Stash, which is what the major digit says; these assumptions are the ones no test in this
repo reaches, and a Stash upgrade can still move any of them.

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
