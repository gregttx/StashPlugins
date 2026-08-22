# ᝯㄝₓ Custom Fields Bulk Editor

> ## Backing up your database first is recommended
>
> **Apply** rewrites one custom field across every entity you had selected — potentially your whole
> library, if that is what you selected. The dialog's **[Undo](#undoing-an-apply)** button takes back
> exactly what that Apply wrote, so most mistakes are one click from being reversed.
>
> Two limits are worth knowing before you rely on it: Undo only reaches **this dialog's own writes**,
> and only **while the dialog stays open**. Close it, or reload the page, and Stash itself has no
> undo. Read the list before pressing Apply — that is what it is for — and for a first run over a
> large selection, stop Stash and copy `stash-go.sqlite` (next to your `config.yml`) somewhere safe.

> **Requires Stash 0.31.0 or newer.** `custom_fields` on the entity types, and `CustomFieldsInput`
> on their update mutations, are what this plugin is built on.

Stash stores custom fields on seven kinds of entity and lets you edit them **one record at a time**.
Its API has no such limit. This plugin adds the two things that are missing: a **view** of what a
whole selection — or the whole library — carries, and **one write across it**.

---

## Using it

**Two ways in.** For a selection:

1. Open any list view — Scenes, Images, Galleries, Performers, Studios, Groups or Tags — and
   **select some entities**.
2. Open the **"..."** menu at the top of the list (just right of the trash icon).
3. Pick **Custom Fields...** — the last item in the menu. It only appears while something is
   selected.

For the whole library, go to **Settings → Tasks → Plugin Tasks** and press
**Edit Custom Fields Across the Whole Library...** — the amber button under this plugin's name. It
opens the same dialog on everything, with no selecting to do. Reading a large library takes a
while — 155,000 entities is about fifteen seconds — and the counter says which type it is on and how
far through it is while you wait.

**Press Escape** at any point to close the dialog, exactly as Cancel or Close would. While a write
is actually in flight it does nothing — there is no Cancel to reach at that moment, and Stop is not
something a stray keypress should do.

The dialog opens on what the entities in scope carry **now**. On a task run every line names its
own type, because seven of them share the listing:

```
Scene "Beach Day" (412): shoot🟰2019-07
Scene "Beach Day" (412): source🟰dvd
Scene "Rooftop" (417): shoot🟰2021-02
```

Each of those coloured boxes is a **pill**, and clicking one does something:

| Pill | Click |
| --- | --- |
| `"Beach Day" (412)` | Opens that entity's page in a **new tab**. |
| `shoot`, `2019-07` | **Copies** that text to the clipboard. The pill flashes green. |
| `Added`, `Replaced`, `Deleted` *(after Apply)* | Nothing. It is a label. |

**`␀` means nothing is there** — either no such field, or a field set to an empty value. Hover it to
see which. It is dropped from anything you copy, so a copied line carries the empty value the entity
really has; names of your own containing `␀` are ordinary text and keep it.

Selecting lines and copying them gives you **plain text** — the pills come out as the text you see,
with no colours to paste into anything.

- **Filter by Type** appears on a task run only, since a selection is one type already. It
  narrows the listing to one of the seven; **All types** puts them back.
- **Filter by Entity**, **Filter by Name** and **Filter by Value** narrow that list as you type
  (case-insensitive substring, all of them applied together) — in that order, which is the order a
  line reads: which entity, then which field on it, then what it holds.
- **Filter by Entity** matches the entity as the line shows it — name, a space, then the id in
  brackets — so `Beach Day (412)`, `Beach Day` and `(412)` all reach that entity's fields.
- Each of the three has a mode beside it: **contains**, or **omits** for its exact complement. An
  empty box filters nothing in either mode.
- Each also has a **×** at the right-hand end of its box, showing only while there is something
  to empty.
- Each also **remembers the last ten things typed into it** and offers them back as you type, as
  the browser's own autocomplete. Each box keeps its own list — an entity name, a field name and a
  value are three different vocabularies — and an entry is kept when you leave the box, not on
  every keystroke. The lists live in this browser, not in your library or in the plugin settings.
- The dropdown beside **Filter by Value** also offers three modes that are the whole query on
  their own — the text box greys out for all three:
  - **is empty** lists only the fields set to the empty string — the one thing an empty box cannot
    ask for, since an empty box means no filter.
  - **is true** and **is not true** read the value as a flag, exactly the way the **Hide from Add
    Lists** filter does: empty, `0` and `false` are not true (in any case, and with spaces around
    them), and **everything else is** — `"no"` and `"off"` included. **is not true** is the wider
    of the two: it covers the empty ones as well.

  Pair any of them with **Apply to → Filtered list only** to write onto exactly those entities.
- Scroll it, select it, copy it — there is no export button because there does not need to be one.
- Very long listings stop at **1000 lines on screen**, with a last line saying how many are not
  shown. Only the display is capped: the counters, Apply and Undo all still cover everything you
  selected. Use the filters to see the rest.
- The counters above it say how many entities were read, how many carry any custom field at all,
  how many fields that is in total, and how many lines the filters leave showing. While a read or a
  write is running, a cursor cycles under the last line: the counters say how far it has got, the
  cursor says it is still going.
- After the listing, an `[INFO]` line names **every custom field found, with a count** —
  `Custom fields found: colour x1204, shoot x87.` That is the one question a listing of
  155,000 lines cannot answer by being scrolled. Every name in it **copies itself when
  clicked**, like the names in the listing. Messages sit in the same box as the listing,
  in the order they happened, and nothing is cleared until you close the dialog.
- **Copy log** copies the counters and then the whole log in that same order — every message
  and every listing, including the lines the 1000-line cap leaves off the screen.
- Entities carrying **no** custom fields contribute no lines, but are still counted and are still
  written to.

## Editing

Below the list:

| Control | What it does |
| --- | --- |
| **Operation** — Add *(default)* | Sets the field **only where it is missing**. Existing values are left alone. |
| **Operation** — Overwrite | Sets **that one field** on every entity in scope, replacing the value it already had. Every other custom field on those entities is untouched. |
| **Operation** — Remove | Deletes **that one field** from every entity in scope that has it. The entity's other custom fields are untouched. |
| **Operation** — Rename | Moves the field to a new name, keeping each entity's value. Only selectable while everything in scope carries **one** field name — that is the name it renames. |
| **Apply to** — All *(default)* | Every entity in scope: what you selected, or the whole library on a task run. |
| **Apply to** — Filtered list only | Only the entities still showing in the filtered list. Touching any filter switches to this on its own. |
| **Custom Field name** | Required. **Apply** stays disabled until it is filled in. Under **Rename** it is the *new* name, and says so. It remembers the last ten names written into it and offers them back — a list of its own, kept apart from the name *filter*'s. |
| **Custom Field value** | May be empty — an empty string is a value like any other. Ignored by Remove, and greyed out under Rename. It remembers the last ten values too. |

Each of those has a tooltip on the dropdown itself.

**Rename in detail.** It is one write per distinct value — each carries that value onto the new key
and drops the old one in the same input, so no entity is ever briefly without the field. An entity
that **already carries the new name** is skipped with a `[WARN]` naming the value it would have
overwritten: that is a merge, not a rename, and the dialog will not decide it for you. **Undo**
reverses both halves at once.

**Rename** is offered only while everything in scope carries one field name, and anything that
moves the scope can take that away — a filter, the type filter, a rescan over a library that has
changed. When it does, **the operation is marked, never switched**: while Rename is the one selected it goes
red — on the select and on its own line in the list, and on nothing else — **Apply** is blocked with
the reason in its tooltip, and an `[INFO]` line says it is not possible any more and why. Pick
another operation and the red goes; Rename is then simply greyed out like any unavailable choice. Nothing changes what you had selected — filter the scope back down to
one field name, or pick another operation. The line is said once on the way in, not once per
keystroke.

**Why Add/Overwrite and not Stash's own Overwrite/Add/Remove tabs.** A custom field holds *one*
value per key, so there is no list to append to. "Add" therefore means *do not overwrite* and
"Overwrite" means *overwrite*, which is the only distinction the data shape allows.

**Values are stored as text.** Whatever you type is written as a string. Custom fields can hold any
JSON value and the plugin displays non-string values it reads faithfully, but it does not try to
guess that `5` was meant as a number.

**Nothing is written until you press Apply.** Entities that already carry exactly the value you
asked for are not written to at all.

**Every entity Apply passes over is accounted for**, before it writes anything:

| Line | Why |
| --- | --- |
| `[WARN] Skipped 12 scenes: "colour" is already set there to another value, and "Add" never overwrites. Kept: blue x9, red x3. Use "Overwrite" to replace them.` | Those entities keep what they had. |
| `[INFO] Skipped 4 scenes: "colour" is already "blue" there, so there is nothing to write.` | Not a refusal — the field already holds what you asked for. |
| `[INFO] Skipped 7 scenes: "colour" is not set there, so there is nothing to remove.` | A **Remove** over entities that never had the field. |

## After Apply

Exactly what changed is listed under what was there, one line per entity, with what happened in
front and `␀` for the side where there is nothing:

```
Replaced Scene "Beach Day" (412): source🟰dvd ⇒ source🟰bluray
Added    Scene "Rooftop" (417): ␀ ⇒ source🟰bluray
```

A **Remove** reads the other way round — `Deleted … source🟰dvd ⇒ ␀` — and after an **Undo** the
lines are shown reversed, so undoing an *Added* reads as a *Deleted*.

An `[INFO]` line after it totals it: `Applied "overwrite" on field "source" to 417
scenes: Added x12, Replaced x405.` Those counts cover the whole write, not just the lines on
screen.

**Cancel** becomes **Undo** and **Apply** becomes **Close**, with **Rescan** between them.

### Undoing an Apply

**Undo** puts back the value each entity carried *before* the Apply — the previous value where there
was one, and removing the field again where there was not. It is a field-by-field inverse, not a
restore of the whole record, so an unrelated edit made in between is not reverted.

It asks first: the first click arms the button and shows the count (*Undo 37 changes?*), the second
performs it. The arming lapses after a few seconds.

It only reaches **this dialog's own writes**, and only **while the dialog stays open**. Closing the
dialog ends it. Nothing else does: Undo stays in the footer after you have used it (pressing it
again just re-asserts the same values), and it survives a **Rescan**. Only a fresh **Apply**
replaces what it will put back.

**Rescan** re-reads everything in scope and lists what it carries *now*, so you can make a second
edit without closing and reselecting. It is offered before an Apply too, if the library has moved
under a dialog you left open.

## What it covers

| Entity | Written by |
| --- | --- |
| Scene, Image, Gallery, Performer, Group | one bulk mutation per 100 entities |
| Studio, Tag | one update per entity — `BulkStudioUpdateInput` and `BulkTagUpdateInput` carry no `custom_fields` field |

**Scene markers are not offered.** They are the one selectable entity in Stash that has no
`custom_fields` field at all, so the marker list (`/scenes/markers`) shows no menu item. That is a
schema fact, not a gap in this plugin.

## Settings

One switch and two names, in Settings → Plugins:

| Setting | Default | What it does |
| --- | --- | --- |
| **Skip Images in the Whole-Library Task** | off | Leaves Images out of the library-wide task, so it covers the other six types only. Images are usually the most numerous type by a wide margin, and reading them can be most of the wait. The dialog says in an `[INFO]` line when it is on. It applies to the descriptions task too, where a field only images carry will then read as an orphan. |
| **Description Store Tag Name** | `ᱜ╦╦🞮 🗃️🔌 🛂🧲 🛠🛈🖫 ❌∙` | The name of the tag that holds every custom field's description. Changing it **renames the existing tag** rather than starting a second store — the tag is found by a marker custom field (`ᱜ╦╦🞮_🛂🧲_🛠🛈🖫_desc_store`), not by its name. Leave it empty to go back to the default. |
| **Hide from Add Lists — Custom Field Name** | `ᱜ╦╦🞮_exclude_from_add_list` | Entities carrying this custom field are hidden from Stash's add/select dropdowns. Any value other than empty, `0` or `false` counts as marked. Clear the setting to switch the filtering off. Renaming that field with the dialog's **Rename** mode moves this setting with it, so the two cannot drift apart. |

The first two are read when you press a task button, so flipping one and running the task in the
same session does what it says. **Skip Images** does not affect a selection — the **"..."** menu acts
on exactly what you selected, image lists included.

**The two names are written into your settings the first time the plugin loads**, since Stash has no
default value for a plugin setting and the boxes would otherwise read as empty while the plugin used
the defaults above. Whatever you have put there is never written over — including a box you have
**cleared on purpose**, which is a different thing from one that was never set: an empty **Hide from
Add Lists** means no filtering at all, and an empty **Description Store Tag Name** goes back to the
default name.

## Custom field descriptions

Settings → Tasks → **Manage Custom Field Descriptions...** scans the library and shows every custom
field it found on the left, with how many entities carry each. Pick one and you get a box to
describe it in and a list of exactly what carries it; the description then shows as a tooltip on
that field's name everywhere in the bulk-edit dialog — **and on the entity's own page**, where Stash
shows the field's name and nothing else. Hover it there and you get the name, then the description
under it.

That works on any detail page — a scene, a tag, a performer — and it is matched on the *name*: an
element whose whole text is a custom field you have described gets the tooltip, wherever Stash chose
to put it. Nothing is decorated on a list page, on a link, or inside this plugin's own dialogs.

Some details worth knowing:

- **Nothing is written until Apply**, including the tag itself. A field marked `*` in the left pane
  has an unsaved edit; `•` means it already has a description.
- **The pane reads Name, then Description.** The field's name is in an editable box on the first
  line, the description box is under a heading of its own, and the read-only list of what carries
  the field is under that.
- **Changing the name renames the field.** Type a new one in that box and a **Rename** button
  appears beside it (Enter does the same). The box is live as soon as a field is picked, whether or
  not the description has been touched. It **stages** the
  rename, like everything else here: the left pane shows the new name at once, and **Apply** is what
  writes it across every entity carrying the field — with its description — while **Undo** puts the
  old name back. Type the library's own name back in and press Rename again to take a staged rename
  off. **Rescan** is held back while one is staged, since it would re-read a library the rename has
  not reached yet; Apply, or close the dialog to discard it.
  - A name another custom field already has is **refused** — that is a merge, not a rename, and it
    would overwrite the values already under that name.
  - The **Hide from Add Lists** field cannot be renamed here: its name is a setting, and this
    dialog already handles the other direction (change the setting, then **Migrate**). Renaming it
    from the list would leave the setting pointing at a name nothing carries.
  - One rename at a time. A second is refused until the first is applied.
- **`[orphan]`** is a description whose custom field no entity carries any more. It is kept rather
  than dropped — a field you cleared today may come back tomorrow — and **Prune orphans** clears
  them all in one press, staged like everything else. The rows go with them: an orphan row is a
  description with no field behind it, so once the description is gone there is nothing left to
  show. The log lists what was pruned, and Apply writes it. With no orphan to clear, the button is
  greyed out.
- **`[store tag] x1`** is a field carried only by the tag the descriptions themselves live on — in
  practice the **Hide from Add Lists** field, which that tag wears to hide itself. The scan leaves
  that tag out, so this is what would otherwise read as an orphan; picking it names the tag, and
  **Prune orphans** leaves it alone. The count is always one: that tag.
- **Apply does not close the editing.** It writes, reports what changed in the log, and leaves the
  box and the field list exactly where they were, so the next description can be typed straight
  away — Apply greys out again until there is something new to write.
- **Undo** puts the tag's description and name back exactly as they were before Apply, and the box
  with it. A tag the dialog *created* is left in place; delete it by hand if you do not want it.
- **Rescan** re-reads the library and the store, keeping whatever you have typed.
- **The room is yours to divide.** Drag the divider above the log to trade room between the panes
  and the log, and the description box's own bottom-right corner to resize just that box. Picking a
  field sizes the box to the description it loads — up to four fifths of the pane — so a long one
  needs no scrolling.
- **A rename takes the description with it.** Renaming a custom field in the bulk dialog moves its
  description to the new name, so it stays attached to the field rather than becoming an orphan. A
  new name that already has a description of its own is left as it is, and the log says both were
  kept.
- If you rename the **Hide from Add Lists** setting, the description follows it, and the dialog
  counts the entities still carrying the old field name and offers a **Migrate** button that renames
  it across them. Renaming a setting never writes to your library on its own.

**Where they are stored, and how to reset.** In the description of the store tag: a sentence saying
what it is, then a block of JSON. Delete that whole description on the tag's own edit page and the
store is reset. If it is ever edited into something that is not valid JSON, the dialog refuses to
write and says so rather than overwriting what is there.

**A store written by a newer version of this plugin** stops the dialog from editing it, because a
newer release may keep things in there that an older one would drop. Load that version (or newer),
or delete the tag's description by hand — which loses the descriptions in it.

## Relationship to the other plugins in this repo

While it writes, this plugin takes a **bulk-edit lease** on the shared object the ᝯㄝₓ plugins use,
so `ᝯㄝₓ Merge Performer Tags To Scenes` and `ᝯㄝₓ Normalize Parent Tags` stand their automatic
modes down until it finishes rather than reacting to every entity it touches. If one of *them* is
writing when you open the dialog, the head says so — advisory, not a lock; you started this by hand
and it will not refuse.

Nothing else overlaps: no other plugin here touches custom fields, and none of them puts anything in
the list-view menu.

## Troubleshooting

**The menu item is not there.** Type this in the browser console (F12 → Console) and open the menu
again:

```js
__GTTx__.StashPluginCoop.debugButtons = true
```

Every ᝯㄝₓ plugin that draws a control into Stash's own UI answers to that one switch. This one will
say which of the three conditions is not met — not a list view, no open menu, or nothing selected —
on the next tick. Set it back to `false` to stop.

If it says **not a list view** on a page that plainly is one: the plugin works out what a list holds
from the URL, and a few of Stash's lists live at a URL that names something else — a gallery's own
images, a group's sub-groups, a studio's child studios, a performer's appears-with. Those four are
known and handled; report the page's address (the `/…` part) if you find another and it can be
added.

**If the dialog's title counts fewer than you selected**, the plugin is failing to recognise some of
the rows. It reads the selection off the page — a ticked checkbox, and the row's own link back to
itself — so a card laid out in a way it does not expect is skipped rather than guessed at. Rows that
link to a *relative* of their own type are handled: a tag card names its parent tag and a studio card
its parent studio, and the row's own entity is the one it links twice. Report which list, and the two
numbers.

**The settings group is plain — no README link under the description, no hover boxes on the
settings, and the stale-script warning could not appear there either.** This plugin finds its own
block on **Settings → Plugins** by the group's heading, which is the plugin's name, and it is the
only plugin here with no second route in. So the name in `CustomFieldsBulkEditor.js` and the name in
`CustomFieldsBulkEditor.yml` have to be the same string: if the folder was updated a file at a time,
copy it again whole. The two task buttons under **Settings → Tasks** go with it, since they are
recognised by the same heading; the list-view menu item and its dialog are unaffected. Nothing in
the console says any of this.

### Checking which version is actually running

**Your browser is running an older copy of the plugin.** Stash serves plugin scripts with caching
on, so an update can leave the new version installed on the server while the page in front of you
goes on running the old one. You do not have to go looking for this — the plugin says so in red, in
two places:

- **Its settings group**, at the top, above the description — so it shows even with the group
  collapsed.
- **Either dialog**, in a box of its own under the title.

Both name the version you are running, the version installed, and the fix: reload the page, and if
the warning comes back, hard-refresh with **Ctrl+Shift+R** (⌘+Shift+R on a Mac). **Apply** stays
disabled while they disagree — but never Undo, since stranding you with changes you cannot take back
would be worse than the mismatch. The warning goes into the log too, so **Copy log** carries it.

It catches an update, not an edit: the two numbers only differ once the version changes, so a script
edited in place without a version bump looks current to this check.

## Installing

Copy the `CustomFieldsBulkEditor` folder into your Stash plugins directory
(`<stash-config-dir>/plugins/`), then **Settings → Plugins → Reload Plugins**, and reload the page.

## Licence

Same terms as the rest of this repository.
