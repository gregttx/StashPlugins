# ᝯㄝₓ Entity Name Maintainer

Rename a performer, a studio, a tag or a scene, and every other place in your library that
mentioned the old name goes on mentioning it. Stash moves one string; this plugin notices
and offers to bring the rest along.

Requires Stash 0.31.0 or newer.

## What it does

It watches the tab you are working in for a rename. The moment one lands it reads the name
the entity had a second earlier, then walks every text field of every Scene, Image,
Gallery, Performer, Studio, Group and Tag looking for it, and puts up a dialog listing what
it found.

The fields it looks in:

| Type | Fields |
|---|---|
| Scene | title, code, details, director, URLs, custom field names and values |
| Image | title, code, details, photographer, URLs, custom field names and values |
| Gallery | title, code, details, photographer, URLs, custom field names and values |
| Performer | name, disambiguation, aliases, details, URLs, tattoos, piercings, measurements, career length, custom field names and values |
| Studio | name, aliases, details, URLs, custom field names and values |
| Group | name, aliases, synopsis, director, URLs, custom field names and values |
| Tag | name, aliases, description, custom field names and values |

Which of those your Stash actually has is settled by asking it, once per scan, rather than
assumed — a field this plugin looks for and your server does not have is skipped instead of
failing the whole search.

Scene markers are not covered: a marker carries a title but has no page of its own to be
renamed from.

**Custom field descriptions are covered too, where ᝯㄝₓ Custom Fields Bulk Editor is
installed and enabled.** Those descriptions are prose you wrote about a field, they mention
names like anything else you write, and they are not in the library at all — that plugin
keeps them as JSON inside one tag. This plugin does not read or write that JSON: it asks the
other plugin for the descriptions as text and hands back the ones you agreed to change. They
appear in the listing under their own filter, named by the field they describe, and Undo
puts them back the same way. With that plugin absent, older, or disabled, nothing is listed
and nothing else changes.

## The dialog

One line per occurrence, reading: the entity it is in with its id in brackets, the type and
attribute — numbered where that attribute holds more than one — and the text around the
match, with the match itself marked.

The listing and the messages share one box and read in the order things happened — the line
saying what is being looked for, then the occurrences, then whatever the run had to say
afterwards.

- **Tick** — every line starts ticked. Untick one to leave that occurrence alone.
- **Click the entity** — opens it in a new tab.
- **Filters** — one row of toggles for the entity types found and one for the attribute
  names found, amber while on. Turning one off hides its lines *and* leaves them alone. It
  never changes a tick, so turning it back on brings back exactly the selection that was
  there.
- **All On / All Off** — sets every filter at once. Same rule: filters only. Each is
  disabled when pressing it would change nothing — no filters, or every one already on (or
  already off).
- **Replace with** — starts as the new name and is editable, because a replacement is not
  always literally the new name. "Jane Doe" may want to become "Jane" in the middle of a
  sentence.
- **Proceed** — writes. Afterwards the same button reads **Undo** and puts back exactly what
  this dialog changed, while it stays open.
- **Cancel** — takes back the rename itself: the entity goes back to the name it had when
  the dialog opened, and the dialog closes. Nothing else is touched, because nothing else has
  been. It is offered only while **Proceed** has not run — after that the rename is no longer
  the only thing that would have to come back, and **Undo** is the control for that; an
  **Undo** brings **Cancel** back. If the name has moved again in the meantime it is left
  alone and the log says so. The Escape key never reaches this button.
- **Copy log** — the counters, the whole listing and every message, as plain text.
- **Close**, or the Escape key. While the listing holds occurrences *nothing has been done
  with yet*, the first press asks **Are you sure?** and counts down for a few seconds; a
  second press within five seconds closes. The scan runs off a rename that has already happened, so
  a listing thrown away cannot be asked for again — press **Copy log** first if you want to
  keep it. It closes on the first press once there is nothing left to lose: nothing was
  found, or **Proceed** has run. An **Undo** puts the question back, since it puts the
  listing back to one nobody has used. Pressing **Proceed** while it is counting down puts the
  button straight back to **Close** — the write is the answer to the question.

## While it scans

```
Scanned 4200 entities (Images)  ·  found 12 occurrences
Scenes 1200/1200  ·  Images 3000/17000  ·  Tags 0/240
```

The first line says how far it has got; the second says **where**, one entry per entity type
with that type's own total. Each total arrives with the first page of its type and does not
move afterwards.

There is no overall "out of N": adding the counts up as each type is reached would make the
grand total grow as the scan went, and a target that moves is worse than none. Per type the
number is honest, and it costs nothing — every page already carries its type's count.

## Safety

- **Nothing is written until you press Proceed.** The scan is a read.
- **The rename is confirmed against your library, not against the reply to the save.** After
  the save lands, the entity is read once more; the dialog opens only if it really is called
  the new name now. A save that is acknowledged and changes nothing opens nothing.
- **Every field is re-read immediately before it is written.** The occurrence positions
  recorded by the scan are checked against what is there now; a field somebody has changed
  in the meantime is skipped and said so in the log, rather than overwritten with a string
  built from a stale copy.
- **Custom fields are changed structurally**, key by key and value by value, never as text.
  A machine-written block in a custom field cannot come out malformed because of a rename.
- **An entity carrying another plugin's store is left out whole.** ᝯㄝₓ Custom Fields Bulk
  Editor keeps every custom field's description as JSON inside one tag's description;
  rewriting text inside that by substring is how it stops parsing, so the tag carrying its
  marker is skipped and counted. The descriptions *in* it are still reached — by asking that
  plugin for them, which is the only way to change one without touching the JSON — and the
  line that reports the skip says so, rather than reading as something missed. With that
  plugin absent or disabled it says the descriptions are searchable when it is enabled.
- **It stands down while a sibling plugin is running a bulk task.** A library-wide rename
  would otherwise put up one dialog per entity. What decides is the lease being held *when
  you pressed Save* — a sibling that reacts to that same save, such as ᝯㄝₓ Normalize Parent
  Tags pruning the tag you just renamed, is not a bulk run and does not suppress the dialog.
  It takes a lease of its own while it writes, so those plugins stand down in turn.
- **Undo only reverses what this dialog wrote**, while it stays open, and cannot account for
  changes made elsewhere in the meantime. Backing up your database before proceeding is
  recommended.

## Matching

Matching is a plain case-insensitive substring. That is deliberate: a name written in prose
is written the way the sentence wanted it, and a hit you can see and untick is better than a
miss you cannot. The cost is that a short name matches inside longer words — "Ann" inside
"Anna" — which is what the context on every line, the per-line tick and the two limits below
are for.

## Settings

- **Skip Images in the Scan** — leave Images out, so the scan covers the other six types.
  Images are usually the most numerous type by a wide margin, and reading them can be most of
  the wait after every rename.
- **Warn Above This Many Matches** — over this many occurrences the dialog adds a
  proceed-with-caution note. Default 200.
- **Refuse Above This Many Matches** — the scan stops past this many occurrences and Proceed
  stays disabled. Default 2000. Counted in occurrences, not entities: one long description
  can hold several.
- **Log to the Browser Console** — print the dialog's messages under the `[enm]` prefix as
  well.

## Why the scan reads everything

There is no server-side filter that can answer "does any text field of any type contain this
string". Custom fields can only be filtered by naming the key up front, and there is no way
to ask for whichever keys an entity happens to carry. So the rows come back and the matching
happens in the browser, one page of one type at a time, with a progress line and a limit that
can end it early.

## Installing

Copy the `EntityNameMaintainer` folder into your Stash plugins directory
(`<stash-config-dir>/plugins/`) and press **Reload plugins** in Settings → Plugins.

## Troubleshooting

**The dialog never appears.** It reacts to a rename made in that same browser tab. A rename
made through the API, by a scraper, by an identify task or in another tab is not one it can
see. It also stands down when another ᝯㄝₓ plugin was already holding a bulk lease when you
pressed Save.

**To find out which it is, open the browser console and type:**

```js
__GTTx__.enm.status()
```

It prints what happened, *including for renames you have already made* — there is nothing to
switch on first. Read it top to bottom:

- **`fetch hook:`** — whether the hook is installed at all. "another plugin has wrapped
  since" is normal.
- **`requests seen:`** — this is the first thing to check. If it is **0**, the plugin is not
  seeing the page's network requests at all and nothing about which tag you renamed is
  relevant. If `renames matched:` is 0 while `GraphQL:` is not, the save did not look like
  one of the seven update mutations.
- **`leases held now:`** — another ᝯㄝₓ plugin in the middle of a bulk run.
- **the last few decisions** — one line per save that looked like a rename, saying what was
  posted and, if no dialog opened, exactly why: the name did not actually change, the old
  name could not be read, the save came back with errors, a dialog was already open, or a
  sibling held a lease when you pressed Save.

Paste that output into a bug report; it names no values from your library, only field names.

For a running commentary instead of a summary, `__GTTx__.StashPluginCoop.debugButtons = true`
prints the same lines to the console as they happen — the same switch every ᝯㄝₓ plugin uses.

**A red banner says the page is running an older script.** Stash serves plugin JS with
caching on, so the browser can still be running the file it fetched before the update. Press
Ctrl+Shift+R (⌘+Shift+R on a Mac).

**The settings page shows nothing formatted.** The same cause. If the folder was updated
half-way — the `.yml` replaced and the `.js` not, or the reverse — the plugin can be looking
for a heading that has moved. Copy the whole folder.
