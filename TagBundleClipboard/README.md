# ᝯㄝₓ Tag Bundle Clipboard

Copy a set of tags off one entity and paste it onto another, however unrelated the two are.

Stash has no "copy these tags over there" affordance, and the two other plugins in this repo that
move tags only copy along Stash's own relationships — a scene's performers' tags, a gallery's
images' tags. There is no relationship between two unrelated scenes to name, so there is no path to
follow. This is the manual case: **you pick the source, you pick the target, and you pick which
tags.**

Requires Stash 0.31.0 or newer.

---

## How it works

**Copy.** Open any Scene, Image, Gallery, Performer, Studio or Group and press **⮺ Tags** on its
detail view. Every tag it carries goes onto a clipboard as one bundle, named for the entity it came
from.

**Paste.** Open the Edit tab of any other entity of any of those six types and press
**📋Tags…**. A dialog lists the bundles on the clipboard, newest first. Pick one, tick the tags you
want, and press Add — they go straight into the tag box on the form behind the dialog.

Then press Stash's own **Save**, exactly as if you had picked each tag from the dropdown yourself.

## Nothing is written to your library

The plugin makes no changes of its own, at any point. A paste puts tags into the edit form; **Stash's
Save is what commits them.** Close the form without saving and nothing has happened.

That is why this dialog, alone among the plugins here, does not tell you to back up your database
first. Its **Undo** hands the tag box back exactly what it held before the last Add — including
anything you had typed in by hand since — and Stash's own Reset is still behind it.

## The clipboard

It holds several bundles at once — the number is a setting, five by default — and discards the
oldest when it is full.

It lives in your browser, not on the server, which has one consequence worth knowing in each
direction:

- **Every Stash tab in that browser shares it.** The source entity can be open in one tab and the
  target in another, which is the way this is meant to be used.
- **Another browser, another device and your database backup do not see it.** A bundle is scratch
  data with a lifetime of minutes; it is not part of your library.

## Reading the tag list

Every tag in the bundle is listed. A box you can tick is **blue** when it is on and **red** when you
have turned it off; a box you cannot tick tells you who decided instead:

| | |
|---|---|
| **grey, ticked** | the entity already carries this tag |
| **grey, clear** | Prune found it redundant |
| **amber, ticked** | Roll Up brings it in |

The list is ordered the same way: what you can still change first (on, then off), then what was
decided for you, with the tags the entity already has last. Within each group it sorts the way Stash
sorts tags anywhere else.

A paste only ever adds what is missing, so pressing Add twice does nothing the second time. What
counts as "already there" is read from **the form in front of you**, not from the server — so a tag
you have just added or removed by hand, without saving, is taken into account, and it is re-read at
the moment you press Add rather than when the dialog was drawn.

Hover any tag for its aliases, its parents, its children and its description.

## Redundant parent tags

**This part needs ᝯㄝₓ Normalize Parent Tags 3.2.0 or newer installed and running on the same
page.** Prune and Roll Up are its two operations and it is the one that works them out, so where it
is absent — or too old to be asked — the dropdown below is not shown and the dialog says so in its
log.

A dropdown beside Add decides what to do about a selection that carries both a tag and its parent:

| | |
|---|---|
| **leave as they are** | the default — what you tick is what goes on |
| **prune** | a tag is dropped when the entity will also carry one of its descendants, at any depth |
| **roll up** | every ancestor of a tag you are adding is added too, whether or not the bundle carried it |

Both follow the ticks live: unticking the tag that was making a parent redundant brings the parent
back as an ordinary, tickable row.

**Neither ever removes anything.** Prune only declines to add. Removing a redundant tag an entity
already carries is what **ᝯㄝₓ Normalize Parent Tags** does, with a review dialog and an Undo that
reaches the library.

**That plugin works them out, rather than this one copying its rules.** So every exclusion you have
set there applies here — its Ignore-auto-tag toggle, its name filters, its custom-field filters — and
so will any it gains in a future version, with nothing to update on this side. A tag spared that way
says which filter spared it on its hover text. Its *entity* filters (Organized, excluded by tag name)
are not applied: those exist to keep an automatic pass off entities you did not mean it to touch, and
you opened this dialog on this entity by hand.

The choice needs the tag hierarchy, which is read once per page. If that read fails, both modes are
held unavailable and the dialog says so.

What is *not* borrowed is which entity types that plugin is set to include. Those scope its library
sweep — its own settings page notes that images are "usually the largest type and the slowest to
scan", which is a reason to untick a type that has nothing to do with whether a tag on an image
should imply its parents. There is no sweep here: one entity, chosen by hand.

Those settings are read when the dialog opens. If you change them in another tab while it is sitting
open, **switch back to this one and the list re-plans against the new ones**, with a line in the log
saying so — nothing to close and reopen. A change that makes no difference to what is on screen
leaves the list alone, so glancing at another tab and coming back does not lose your place in a long
one.

**If you have Auto Prune or Auto Roll Up switched on for the type you are pasting onto, the dropdown
is not offered at all** and the log says why: that plugin acts on Stash's **Save**, which is the
button this dialog hands off to, so the decision is already being made on every save and choosing
differently for one paste would not survive it.

## What is not offered

**Tags** and **Scene Markers**, and both absences are deliberate:

- A **Tag** carries parent and child tags rather than tags of its own, so a bundle of tags has
  nowhere to land on one.
- A **Scene Marker** does carry tags, but has no detail page to put a Copy button on.

## Settings

| Setting | |
|---|---|
| **Bundles Kept on the Clipboard** | How many bundles to keep before the oldest is discarded. Leave it empty for 5. Anything from 1 to 50; a value outside that is clamped rather than refused. Lowering it discards nothing until the next copy. |
| **Log to the Browser Console** | Print each copy and each paste under the `[tbc]` prefix, so a session can be read back after the dialog has been closed. |

## Where the buttons are

**⮺ Tags** goes on the detail view — in the row of actions beside Delete on a Performer or a
Group, and in a small row of its own under the tab strip on a Scene or a Gallery, which render no
action row there. It is teal, because it only reads.

**📋Tags…** goes in the edit form's button row, between Save and Delete. It is amber, the colour
every plugin here uses for a control that changes something — in this case the form, not the
library. The trailing "…" is this repo's convention for a button that asks before it acts. **Add**
in the dialog wears the same amber, and so does the redundancy dropdown beside it once it is set to
Prune or Roll Up: that is the press, and the control deciding what the press covers.

Both captions are an icon and a noun, which only says what the button is about to somebody who
already knows. **Hover either one**: its title opens with the words the caption gave up — *Copy
Tags*, *Paste Tags* — and then explains what pressing it does.

If another of these plugins is installed, its buttons and these share the row in a fixed order
rather than whichever loaded first.

## Relationship to the other plugins in this repo

- **ᝯㄝₓ Merge Performer Tags To Scenes** and **ᝯㄝₓ Propagate Tags and Performers to Related
  Entities** copy tags along relationships, automatically or in bulk. This one copies them by hand
  between entities with no relationship at all. They do not overlap, and all three can be installed
  together.
- **ᝯㄝₓ Normalize Parent Tags** rewrites tag *hierarchies* on entities, and computes this plugin's
  Prune and Roll Up (above) — they are its operations, and it is asked rather than imitated. Its two
  **automatic** modes are the one thing worth knowing before you paste: they react to Stash's Save,
  which is the click this dialog defers to, so a paste can be rewritten in the same breath that
  commits it — Auto Prune removing tags you just added, Auto Roll Up adding their ancestors. Where
  that applies to the type you are pasting onto, the dialog says so and withdraws the choice.
  Nothing here can prevent it: that mode is doing exactly what it was turned on to do, to a save it
  cannot tell from any other.
- **ᝯㄝₓ Custom Fields Bulk Editor** is unrelated.

## Troubleshooting

**The 📋Tags… button is not there.** Three things it needs, in order: you are on one of the six
entity pages; the **Edit** tab is open, since the button sits in the edit form's own button row; and
your Stash exposes plugin component patching, without which there is no way to put tags into a form.
The last of those prints one line to the browser console saying so.

**Neither button is there, and the settings page looks fine.** Check **Settings → Plugins** shows
`ᝯㄝₓ Tag Bundle Clipboard`. If the folder was copied over an older version and only some files
landed, the settings page can look completely normal while the buttons are gone — the settings are
found by ids built from the plugin id, which no rename moves, while everything else matches on the
name.

**Why is this button hidden?** Type this into the browser console:

```js
__GTTx__.StashPluginCoop.debugButtons = true
```

Every plugin here that draws a control into Stash's own chrome then explains, in the console, which
of its buttons it is showing and why. It takes effect on the next tick — no reload, no setting.
Set it back to `false` to stop.

**A bundle I copied in another tab is not in the list.** The list is read when the dialog opens.
Close it and open it again.

## Checking which version is actually running

Stash serves plugin scripts with caching on, so a browser can go on running the old file after an
update. The plugin says which one it loaded, in the console, when the page loads:

```
[tbc] TagBundleClipboard.js <version> loaded.
```

If that number disagrees with the one beside the plugin's name in **Settings → Plugins**, a red
banner appears in the plugin's own settings group saying so, and the paste dialog carries the same
warning in its head. Press **Ctrl+Shift+R** (⌘+Shift+R on a Mac).

## Installing

Copy the `TagBundleClipboard` folder into your Stash plugins directory (`<stash-config-dir>/plugins/`)
and reload plugins in **Settings → Plugins**.
