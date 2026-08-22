# ᝯㄝₓ Find Entities by Text Content

Which entities in your library mention this text?

Stash cannot be asked. It will filter a scene list on a scene's own `details`, and a
performer list on a performer's own `details`, and nothing at all on whichever custom fields
an entity happens to carry. This plugin is that one question, with one box to type it into.

Requires Stash 0.31.0 or newer.

## Using it

**Settings → Tasks → Plugin Tasks → Find Entities by Text Content...**

Type what to look for, turn on the entity types you want searched — they all start **off**,
so nothing is read until you say so — and press **Search**. The amber **All On** and **All
Off** pair sets them all at once, and each is disabled when pressing it would change nothing,
so All Off is dead the moment the dialog opens.

It looks in every text field of every type you turned on:

| Type | Fields |
|---|---|
| Scene | title, code, details, director, URLs, custom field names and values |
| Image | title, code, details, photographer, URLs, custom field names and values |
| Gallery | title, code, details, photographer, URLs, custom field names and values |
| Performer | name, disambiguation, aliases, details, URLs, tattoos, piercings, measurements, career length, custom field names and values |
| Studio | name, aliases, details, URLs, custom field names and values |
| Group | name, aliases, synopsis, director, URLs, custom field names and values |
| Tag | name, aliases, description, custom field names and values |

Which of those your Stash actually has is settled by asking it, once per search, rather than
assumed — a field this plugin looks for and your server does not have is skipped instead of
failing the whole search.

Scene markers are not searched: a marker carries a title and no page of its own to open.

## The results

One line per entity that matched, reading: the entity with its id in brackets, then which
attributes matched and how many times each, then the text around the first match with the
match marked.

```
Beach day (1)      Scene · Title, Details ×2, URLs, Custom field value   …Beach day…
Sandy (7)          Performer · Details                                   Likes the BEACH
Outdoors (3)       Tag · Aliases, Custom field name                      beachy
```

Click one to open it in a new tab. A second row of filters appears above the list as the
search finds attributes to offer — Title, Details, Aliases, Custom field name, and so on,
one for every attribute something has actually matched in. Turning one off hides the
entities that only matched there, and drops that attribute's chip from the ones that also
matched elsewhere, so a line never claims a match it is hiding. They start on; the amber
**All On** / **All Off** pair covers both rows.

The two rows are not the same kind of control. **Entity types decide what is read** — they
are the whole list from the start, and turning one on is what sends the search looking.
**Attributes decide what is shown**, over results already found, so the list can only be what
the search has hit so far.

The results and the messages share one box and read in
the order things happened — the line saying what is being looked for, then the results, then
whatever the run had to say afterwards.

Counters and a cycling cursor across the top say how far it has read, out of how many, and
that it is still going:

```
Scanned 4200 of 18300 entities (Images)  ·  37 matches  ·  37 on screen
Scenes 1200/1200  ·  Galleries 0/0  ·  Images 3000/17000  ·  Tags 0/100
```

The first line says how far the whole search has got; the second says **where** it is. On a
library whose Images outnumber everything else, that is the difference between a number that
seems to have stopped and one that is working through the biggest type.

The totals are read once before the first page and cover only the types you turned on, so
they mean the same thing from the first page to the last. A type this Stash has none of the
searched fields on is left out of the breakdown — the log says it was skipped.

## Pausing, and the list on screen

- **Search** becomes **Pause** while it runs and **Resume** after, so a long search can be
  stopped and picked up rather than started again. Resume carries on from the page it
  stopped at; nothing is read twice.
- When the list on screen is full it **pauses itself** and the button reads **Continue**,
  which clears the screen and carries on.
- **Copy log** hands over the counters, the messages and every result the attribute filters
  leave, as plain text — including the ones the screen no longer shows. A filter is a choice
  about what you are looking at, so it is honoured; the buffer is not a choice, so it is not.
- **Refresh** throws away what this search has found and starts it again from the
  beginning, with whatever the box now says. It only appears while the other button has
  become Pause, Resume or Continue — those are the states where **Search** carries the
  current search *on* and there is no other way to say *start over*. When that button
  already says Search, Refresh would do the same thing, so it is not offered.
- **Cancel**, or the Escape key, closes it. Once a search has run out it reads **Close**
  instead — the same button, saying which of the two pressing it now means.

The **×** at the right-hand end of the box empties it. It is there only while there is
something to empty.

## Remembering

Two things the dialog can keep, both off until you ask for them, and both in **this browser**
rather than on the server:

- **Remember filters** — the entity types you turned on come back the next time it is opened.
- **Recent searches kept** — how many previous searches the **box itself** offers back as you
  type, the way the other boxes in these plugins do. Setting it to **zero** keeps none, and is
  also what throws away the ones already kept.

Neither is a plugin setting, and neither writes anything: they live in the browser's own
storage. A private window, or a browser set to block site data, simply remembers nothing.

## Nothing is written

This is a read of your library and a list of links. There is no undo because there is nothing
to undo, and the dialog says so where a writing one would tell you to back up first. It takes
no bulk lease and stands down for nobody — though it does note in its head when another ᝯㄝₓ
plugin is rewriting the library while you search, since a result may then be a moment behind.

## Matching

A plain case-insensitive substring. A short word matches inside longer ones — "sea" inside
"season" — which is why the text around every result is on the line: so you can see which it
was.

## Why it reads everything

There is no server-side filter that can answer "does any text field of any type contain this
string". Each type's filter names its own fields, so a query would have to be built per type
and OR-ed across fields; and custom fields can only be filtered by naming the key up front,
with no way to ask for whichever keys an entity happens to carry. So the rows come back and
the matching happens in the browser, one page of one type at a time, with counters and a
Pause.

Turning off the types you do not need is the way to make it quick — which is why they all
start off.

## No settings

There are none, on purpose. Every choice this plugin offers — what to look for, which types
to read, what to remember — is made inside the dialog, where you already are. Its group on
the settings page carries the description and nothing else.

## Installing

Copy the `FindEntitiesByTextContent` folder into your Stash plugins directory
(`<stash-config-dir>/plugins/`) and press **Reload plugins** in Settings → Plugins.

## Troubleshooting

**The task button does nothing.** The click is handled in the browser — there is no
server-side job behind it. If Stash instead shows an "added job to queue" toast, the page is
running a script that does not recognise the button; reload with Ctrl+Shift+R.

**A red banner says the page is running an older script.** Stash serves plugin JS with
caching on, so the browser can still be running the file it fetched before the update. Press
Ctrl+Shift+R (⌘+Shift+R on a Mac).

**A red Reload UI button appears beside Stash's own Reload plugins** while any ᝯㄝₓ plugin's script is out of date, at the top of Settings → Plugins. Pressing it reloads the page, which is the whole fix: **Reload plugins** re-reads the plugin folder on the server and cannot replace a script this page has already run. Any other Stash tab you have open needs the same.

**A type is skipped with a warning.** Your Stash has none of the text fields this plugin
looks for on that type. That is the introspection check doing its job rather than a failure;
the other types are searched normally.
