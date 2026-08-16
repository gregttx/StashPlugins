# GTTx Custom Fields Bulk Editor

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
>
> ## 1.2.0 — a stale script says so on the settings page
>
> **When your browser is still running an older copy of this plugin, its settings group now says
> so in red.** Stash serves plugin scripts with caching on, so an update can leave the new version
> installed on the server while the page in front of you goes on running the old one — with nothing
> on screen to say which you have. The banner names both versions and the fix: **Ctrl+Shift+R**
> (⌘+Shift+R on a Mac). It sits at the top of the group, above the description, so it shows even
> with the group collapsed, and it disappears once the two agree.
>
> ## 1.1.1 — the store-tag row counts its carrier
>
> **`[store tag]` now carries a count like every other name in the list.** It reads
> `[store tag] x1` — one carrier, the tag itself — instead of being the one entry with no
> number beside it.
>
> ## 1.1.0 — a description follows its field
>
> **Rename a custom field and its description moves with it.** Descriptions are filed under the
> field's name, so a rename used to leave one behind: the renamed field arrived undescribed and the
> old description became an `[orphan]`. It now moves in the same press, for every field and not just
> the hide-from-add-lists one, and **Undo** moves it back. If the new name already has a description
> of its own, both are kept and the log says so.
>
> ## 1.0.0 — the hide field is nobody's loose end
>
> **Renaming the hide-from-add-lists field moves the setting with it.** Rename
> `Exclude_from_add_list` in the bulk dialog and the **Hide from Add Lists — Custom Field
> Name** setting follows, along with the mark the description store tag wears to hide
> itself. Left behind, that setting would name a field nothing carries any more, and
> everything you had hidden would quietly come back into the add lists. **Undo** takes the
> setting back with the field. A rename of any *other* field leaves the setting alone.
>
> **That field is no longer listed as an `[orphan]`.** The description store tag carries it
> — to hide itself — and that tag is deliberately left out of every scan, so the descriptions
> dialog was reporting the one field this plugin asks you to use as one nothing carries. It
> is marked **`[store tag]`** instead, in blue rather than amber, naming the tag that has it,
> and **Prune orphans** leaves it alone.
>
> **Filter by Entity comes before Filter by Name**, so the filter row reads in the order a
> line does: which entity, then which field on it.
>
> ## 0.12.0 — filter by entity, and say what you do *not* want
>
> **Every text filter has a mode beside it, and *omits* is the new one.** *contains* is what
> all three do by default; *omits* is its exact complement — the rows the same text would
> have hidden. An empty box filters nothing in either mode, so switching to *omits* on its
> own leaves the list, and **Apply to**, exactly as they were.
>
> **A third filter: Filter by Entity.** It matches the entity as the line shows it — name, a
> space, then the id in brackets — so `Cool Scene (42)`, `Cool Scene` and `(42)` all reach
> that one entity's fields.
>
> **Overwrite and Remove say what they leave alone.** *Overwrite* replaces the value of the
> **one** field you name; every other custom field on those entities is untouched.
>
> **A field-name tooltip reads *Click to copy Name*, with *Description:* under it.** A line
> has a name pill and a value pill and both copy on a click, so the tooltip now says which
> one it is on.
>
> ## 0.11.0 — the descriptions dialog divides its own room
>
> **A divider above the log.** Drag it to give the log more or less room; the panes above
> take the difference. The description box keeps its own corner grip, and the two work
> together.
>
> **The two boxes on the right have titles**, *Description* and *List of entities* — the
> second also saying how many entities carry the field you picked.
>
> **A long description opens at the size it needs.** Picking a field grows the box to fit
> what it holds, up to four fifths of the pane, so a paragraph is read without scrolling and
> the list under it never disappears. A short one leaves the split as it was.
>
> ## 0.10.0 — Rename, and two dialogs that stop moving under you
>
> **The dialogs are a fixed height.** Both of this plugin's dialogs sized themselves to
> whatever they were holding, so the whole window jumped smaller as a filter narrowed the
> list, and fought back when you dragged the description box taller. They are now a steady
> 88% of the window height, and it is the panes inside them that give and take.
>
> **A fourth operation: Rename.** It moves a custom field to a new name and keeps every
> entity's value. It is offered only while everything in scope carries **one** field name, since
> that name is what it renames; filter the list down to one and it lights up. The **Custom
> Field name** box then means the *new* name and the value box greys out. An entity that
> already carries the new name is skipped with a warning rather than having that value
> overwritten, and **Undo** puts the old name back and takes the new one off in one write.
>
> **Touching a filter switches Apply to → Filtered list only.** The scope can only ever
> narrow to what you can see, never widen behind you. Clear the last filter and it goes back
> to **All**, which by then means the same entities anyway.
>
> **Every operation has a tooltip**, including the one that explains why *Add* leaves an
> entity alone, and **Apply to** has one on both of its choices.
>
> ## 0.9.0 — filter the listing by whether a value is true
>
> **Filter by Value** gains two modes beside *contains* and *is empty*: **is true** and **is
> not true**. They read a value as a flag, exactly the way the **Hide from Add Lists**
> filter reads the field that hides an entity from a dropdown — the same rule, in one place,
> so a value can never be true in one half of the plugin and false in the other.
>
> The rule: empty, `0` and `false` are **not true** — in any case, and with spaces around
> them — and **everything else is true**, `"no"` and `"off"` included. That last part is the
> surprising half, so the dropdown carries it as a tooltip. **is not true** is the wider of
> the two modes and covers the empty ones as well, which is usually what you want when a
> field is being used as a yes/no.
>
> As with every other filter, **Apply to → Filtered list only** turns it into the scope of a
> write: list the entities whose flag is not true, and set it on exactly those.
>
> ## 0.8.1 — the descriptions dialog stays open for the next edit
>
> **Apply no longer ends the editing.** It wrote what you had typed and then locked the box
> until you pressed **Rescan**, which is right for the bulk editor — there the list on
> screen *is* the plan, and once it has been written it describes a library that has moved
> on. The descriptions dialog is not that: the fields on the left are unaffected by writing
> a description, so typing carries straight on afterwards, with **Apply** simply greyed out
> again until there is a new unsaved change. An **Undo** now also puts the box back to the
> text it restored, instead of leaving the reversed text on screen.
>
> **The two settings arrive with their defaults in the box.** Stash has no default value for
> a plugin setting — a text setting is empty until someone types in it — so both of these
> read as blank while the plugin was quietly using its default. They are now written into
> your settings the first time the plugin loads, so the box shows the name actually in use.
> A setting you have answered is never written over, and that includes one you have
> deliberately **cleared**: an empty **Hide from Add Lists** box means the filtering is off,
> and it stays off.
>
> ## 0.8.0 — every custom field can say what it is for
>
> A custom field's name is all Stash keeps of what it means. Now each one can carry a
> **description**: hover a field name anywhere in the dialog and it tells you what the
> field is for.
>
> They are written in a second task — Settings → Tasks → **Manage Custom Field
> Descriptions...** — which scans the library, lists every custom field it finds with how
> many entities carry it, and gives each one a box to describe it in and a read-only list
> of what carries it. Nothing is written until you press **Apply**, and **Undo** takes the
> whole thing back while the dialog stays open.
>
> The descriptions live in the **description of one tag**, so they are in your database
> rather than in one browser: covered by your database backup, carried by an export, and
> the same on every machine you open Stash from. The tag is created for you the first time
> you press Apply, is marked so that renaming it can never lose the descriptions, and is
> left out of the bulk editor's own listings.
>
> The same release can **hide an entity from Stash's add lists**: give it the custom field
> named in the settings (`Exclude_from_add_list` by default) and it stops being offered in
> the dropdowns you pick a tag, performer, studio, group, gallery or scene from while
> editing something else. It stays on its own list page, on the entities that already have
> it, and in the API — this hides it from being *added*, nothing more. An entity that is
> already assigned still shows in the editor that has it, so nothing drops out of a form
> you open.
>
> ## 0.7.3 — the dropdowns look like Stash's
>
> The four dropdowns in the dialog — the entity-type and value-mode filters, the write
> mode and **Apply to** — now carry the stacked ▲/▼ marker Stash puts on its own
> dropdowns, instead of whichever single chevron the browser happened to draw.
>
> ## 0.7.2 — the log follows itself again
>
> The list scrolls to its newest line when one is written, as the other three GTTx
> dialogs do. It was setting the scroll on the inner box while the outer one held the
> scrollbar, so the newest line could land below the fold after an **Apply** or a
> **Rescan**. Filtering still leaves the view where it is — a jump to the bottom of the
> list while you are typing a filter is not a help.
>
> Two things that look like the same kind of difference are deliberate and stay:
> **Undo** remains offered after you press it (it puts back each entity's previous
> value, so pressing it again re-asserts the same values — only a fresh Apply replaces
> what it will put back), and **Rescan** is offered while the listing is up, because a
> Rescan brings you back to that listing and would otherwise work only once.
>
> ## 0.7.1 — the footer sits where the other three plugins' footers sit
>
> **Apply** has moved to the **left** end of the row, where its siblings put **Proceed**,
> and the rest follow in their order: `Apply · Cancel · Copy log · Undo · Rescan · Close`.
> Nothing behaves differently. All four GTTx dialogs now read the same way round, which
> is the point — the write is the first button in every one of them.
>
> The three siblings gained this dialog's other two habits in the same release: their logs
> **stay until the dialog closes** rather than being cleared by a **Rescan**, and their
> **Rescan** button has a tooltip.
>
> ## 0.7.0 — the first setting: **Skip Images in the Whole-Library Task**
>
> Settings → Plugins now has one switch for this plugin. Turn it on and the library-wide
> task covers the other six types only — images are usually the most numerous thing in a
> library by a wide margin, and reading them can be most of the wait. It is **off by
> default**, and the dialog says so in an `[INFO]` line when it is on, rather than leaving
> a type quietly missing.
>
> It has no effect on a selection: the **"..."** menu acts on exactly what you selected,
> image lists included.
>
> **The dialogs are wider again** — 100rem, up from 80 — in all four GTTx plugins.
>
> ## 0.6.0 — every skip says why, and a summary is copyable
>
> **An Apply that leaves an entity alone now says so, with the reason.** The one worth
> seeing is `Add` over a field that is already set: it never overwrites, so those entities
> were dropped from the write in silence. They are a `[WARN]` now, tallying the values that
> were kept (`Kept: blue x12, red x3.`) and pointing at **Overwrite**. Two more are `[INFO]`,
> because nothing was refused — the field already holds the value you asked for, or a
> **Remove** found nothing to remove.
>
> **The names in a summary line are click-to-copy**, the same pills the listing has always
> had. They are what gets typed into **Field name** next, and a mistyped key is a bulk edit
> against the wrong field.
>
> **The dialog is wider** — in all four GTTx plugins, not just this one.
>
> ## 0.5.0 — one log, in the order things happened
>
> The `[INFO]`, `[WARN]` and `[ERROR]` lines are no longer a strip of their own under the
> listing. They are **in the listing**, where they happened, so there is **one box and one
> scrollbar** instead of two competing for a short window.
>
> The log also **keeps everything until you close the dialog**. A Rescan or an Apply adds
> its listing under the one before it rather than replacing it, so what a write changed is
> read against what was there, with the `[INFO]` line saying what was done in between.
> Typing in a filter still rewrites the listing in place — that is a restatement of what is
> in scope now, not something that happened.
>
> ## 0.4.0 — reading the listing, and getting back out of a write
>
> Five things the task dialog wanted once it had 155,000 entities in it:
>
> - **Filter by Type**, first in the filter row, on a task run only — a selection is
>   already one type.
> - **An `[INFO]` summary line** naming every custom field found with a count
>   (`colour x1204, shoot x87`), and after an Apply, what happened to them
>   (`Added x12, Replaced x5`). Counted over the whole write, not over the lines on screen.
> - **Copy log** — the counters, the `[INFO]` lines and the whole listing as plain text,
>   *including* the lines the 1000-line cap leaves off the screen.
> - **Rescan**, so a finished write can be re-read without closing the dialog, and **Undo
>   stays offered** until you close.
>
> ## 0.3.2 — a task for the whole library
>
> Settings → **Tasks → Plugin Tasks** now has **Edit Custom Fields Across the Whole Library...**,
> which opens the same dialog over every Scene, Image, Gallery, Performer, Studio, Group and Tag
> you have, instead of over a selection. Same listing, same filters, same Apply and Undo — each
> line names its own type, since there are seven of them in there at once.
>
> A large library takes a while to read — the counter names the type it is on and counts up as it
> goes, so you can see it working.
>
> 0.3.2 stops this plugin reformatting **its own task's description** on the Tasks page. That panel
> heads its group with the plugin name and describes each task the same way the plugin list
> describes a plugin, so the summary-and-**Show more** treatment meant for the plugin list was being
> applied there too.
>
> ## 0.2.5 — finding the empty ones
>
> The version number is the honest one. The plugin works in a real Stash — the menu item, the dialog
> and the write have all been exercised. **If you installed 0.2.4, replace it**: its `.yml` had an
> unescaped quote, which stopped Stash loading the plugin at all.
>
> **Filter by Value now has a mode beside it**: leave it on
> *contains*, or switch it to **is empty** to list only the fields set to nothing. An empty box means
> "no filter", so it could never ask that — and the query is a control rather than something typed
> in, so no value you might actually have can be mistaken for it.
>
> **`␀` marks "nothing there"** — either no such field, or a
> field set to an empty value. It highlights
> with the rest of the line when you select it, and it is left out of what you copy: you get the
> empty value the entity really has, and a name of your own containing `␀` keeps it.
>
> **0.2.0 rebuilt the list out of clickable pills**: an
> entity opens in a new tab, a field name or value copies itself, and copying a selection of lines
> still gives you plain text. Long listings are cut at 1000 lines on screen — the last line says how
> many are not shown, and it changes nothing about what Apply writes.
>
> 0.1.2 fixed **a selection being read short on the tag and
> studio lists**: a tag card names its parent tag and a studio card its parent studio, and the plugin
> could not tell that second link from the card's own, so it skipped the card entirely. Every tag or
> studio *with a parent* was silently missing — 1783 tags selected came through as 583. Scenes,
> images, galleries, performers and groups were never affected. **Check the count in the dialog's
> title against what the list says you selected**, and report it if they still disagree.
>
> 0.1.1 fixed the one list view that was known not to offer the menu, **a gallery's own Images tab**,
> along with three more that had the same cause and had not been noticed: a gallery's
> **Add Images**, a group's **Sub-Groups**, a studio's **Child Studios** and a performer's
> **Appears With**. Their URLs do not name what they list, and the plugin read the URL. See
> [troubleshooting](#troubleshooting) if a list still comes up empty-handed.
>
> It will reach 1.0.0 once the rest has been walked through in a live instance, not before.

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
  how many fields that is in total, and how many lines the filters leave showing.
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
| **Custom Field name** | Required. **Apply** stays disabled until it is filled in. Under **Rename** it is the *new* name, and says so. |
| **Custom Field value** | May be empty — an empty string is a value like any other. Ignored by Remove, and greyed out under Rename. |

Each of those has a tooltip on the dropdown itself.

**Rename in detail.** It is one write per distinct value — each carries that value onto the new key
and drops the old one in the same input, so no entity is ever briefly without the field. An entity
that **already carries the new name** is skipped with a `[WARN]` naming the value it would have
overwritten: that is a merge, not a rename, and the dialog will not decide it for you. **Undo**
reverses both halves at once.

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
| **Description Store Tag Name** | `ᱜ╦╦🞮 🗃️🔌 🛂🧲 🛠🛈🖫 ❌∙` | The name of the tag that holds every custom field's description. Changing it **renames the existing tag** rather than starting a second store — the tag is found by a marker custom field (`cfbe_desc_store`), not by its name. Leave it empty to go back to the default. |
| **Hide from Add Lists — Custom Field Name** | `Exclude_from_add_list` | Entities carrying this custom field are hidden from Stash's add/select dropdowns. Any value other than empty, `0` or `false` counts as marked. Clear the setting to switch the filtering off. Renaming that field with the dialog's **Rename** mode moves this setting with it, so the two cannot drift apart. |

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
that field's name everywhere in the bulk-edit dialog.

Some details worth knowing:

- **Nothing is written until Apply**, including the tag itself. A field marked `*` in the left pane
  has an unsaved edit; `•` means it already has a description.
- **`[orphan]`** is a description whose custom field no entity carries any more. It is kept rather
  than dropped — a field you cleared today may come back tomorrow — and **Prune orphans** clears
  them all in one press, staged like everything else.
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

## Cooperating with the other GTTx plugins

While it writes, this plugin takes a **bulk-edit lease** on the shared object the GTTx plugins use,
so `GTTx Merge Performer Tags To Scenes` and `GTTx Normalize Parent Tags` stand their automatic
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

Every GTTx plugin that draws a control into Stash's own UI answers to that one switch. This one will
say which of the three conditions is not met — not a list view, no open menu, or nothing selected —
on the next tick. Set it back to `false` to stop.

If it says **not a list view** on a page that plainly is one, that is the bug 0.1.1 fixed for four of
them: the plugin works out what a list holds from the URL, and a few of Stash's lists live at a URL
that names something else. Report the page's address (the `/…` part) and it can be added.

**If the dialog's title counts fewer than you selected**, the plugin is failing to recognise some of
the rows. It reads the selection off the page — a ticked checkbox, and the row's own link back to
itself — so a card laid out in a way it does not expect is skipped rather than guessed at. That is
what 0.1.2 fixed for tags and studios, whose cards also link to their parent. Report which list, and
the two numbers.

**The version in the settings page is not the one the console printed.** The settings page reads the
manifest, which goes current the moment plugins are reloaded; the console line comes from inside the
script your browser actually has. If they disagree, reload the page. The dialog checks this too, and
disables **Apply** while they disagree — but never Undo, since stranding you with changes you cannot
take back would be worse than the mismatch.

## Installing

Copy the `CustomFieldsBulkEditor` folder into your Stash plugins directory
(`<stash-config-dir>/plugins/`), then **Settings → Plugins → Reload Plugins**, and reload the page.
