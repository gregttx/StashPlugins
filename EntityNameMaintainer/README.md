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

## The dialog

One line per occurrence, reading: the entity it is in with its id in brackets, the type and
attribute — numbered where that attribute holds more than one — and the text around the
match, with the match itself marked.

- **Tick** — every line starts ticked. Untick one to leave that occurrence alone.
- **Click the entity** — opens it in a new tab.
- **Filters** — one row of toggles for the entity types found and one for the attribute
  names found, amber while on. Turning one off hides its lines *and* leaves them alone. It
  never changes a tick, so turning it back on brings back exactly the selection that was
  there.
- **All On / All Off** — sets every filter at once. Same rule: filters only.
- **Replace with** — starts as the new name and is editable, because a replacement is not
  always literally the new name. "Jane Doe" may want to become "Jane" in the middle of a
  sentence.
- **Proceed** — writes. Afterwards the same button reads **Undo** and puts back exactly what
  this dialog changed, while it stays open.
- **Copy log** — the counters, the whole listing and every message, as plain text.
- **Close**, or the Escape key.

## Safety

- **Nothing is written until you press Proceed.** The scan is a read.
- **Every field is re-read immediately before it is written.** The occurrence positions
  recorded by the scan are checked against what is there now; a field somebody has changed
  in the meantime is skipped and said so in the log, rather than overwritten with a string
  built from a stale copy.
- **Custom fields are changed structurally**, key by key and value by value, never as text.
  A machine-written block in a custom field cannot come out malformed because of a rename.
- **An entity carrying another plugin's store is left out whole.** ᝯㄝₓ Custom Fields Bulk
  Editor keeps every custom field's description as JSON inside one tag's description;
  rewriting text inside that by substring is how it stops parsing, so the tag carrying its
  marker is skipped and counted.
- **It stands down while a sibling plugin is running a bulk task.** A library-wide rename
  would otherwise put up one dialog per entity. It takes a lease of its own while it writes,
  so those plugins stand down in turn.
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
see. It also stands down when another ᝯㄝₓ plugin holds a bulk lease — check the console for
a line saying so.

**A red banner says the page is running an older script.** Stash serves plugin JS with
caching on, so the browser can still be running the file it fetched before the update. Press
Ctrl+Shift+R (⌘+Shift+R on a Mac).

**The settings page shows nothing formatted.** The same cause. If the folder was updated
half-way — the `.yml` replaced and the `.js` not, or the reverse — the plugin can be looking
for a heading that has moved. Copy the whole folder.
