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
> ## 0.2.4 — finding the empty ones
>
> The version number is the honest one. The plugin works in a real Stash — the menu item, the dialog
> and the write have all been exercised. **Filter by Value now has a mode beside it**: leave it on
> *contains*, or switch it to **is empty** to list only the fields set to nothing. An empty box means
> "no filter", so it could never ask that — and the query is a control rather than something typed
> in, so no value you might actually have can be mistaken for it.
>
> **`␀` marks "nothing there"** — either no such field, or a
> field set to an empty value, which used to come out as a pill with nothing in it. It highlights
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
whole selection carries, and **one write across it**.

---

## Using it

1. Open any list view — Scenes, Images, Galleries, Performers, Studios, Groups or Tags — and
   **select some entities**.
2. Open the **"..."** menu at the top of the list (just right of the trash icon).
3. Pick **Custom Fields...** — the last item in the menu. It only appears while something is
   selected.

**Press Escape** at any point to close the dialog, exactly as Cancel or Close would. While a write
is actually in flight it does nothing — there is no Cancel to reach at that moment, and Stop is not
something a stray keypress should do.

The dialog opens on what your selection carries **now**:

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

- **Filter by Name** and **Filter by Value** narrow that list as you type (case-insensitive
  substring, both applied together).
- The dropdown beside **Filter by Value** switches it from *contains* to **is empty**, which lists
  only the fields set to the empty string — the one thing an empty box cannot ask for, since an
  empty box means no filter. The text box greys out: the mode is the whole query. Pair it with
  **Apply to → Filtered list only** to write a value onto exactly the entities that have none.
- Scroll it, select it, copy it — there is no export button because there does not need to be one.
- Very long listings stop at **1000 lines on screen**, with a last line saying how many are not
  shown. Only the display is capped: the counters, Apply and Undo all still cover everything you
  selected. Use the filters to see the rest.
- The counters above it say how many entities were read, how many carry any custom field at all,
  how many fields that is in total, and how many lines the filters leave showing.
- Entities carrying **no** custom fields contribute no lines, but are still counted and are still
  written to.

## Editing

Below the list:

| Control | What it does |
| --- | --- |
| **Operation** — Add *(default)* | Sets the field **only where it is missing**. Existing values are left alone. |
| **Operation** — Overwrite | Sets the field on **every** entity in scope, replacing whatever was there. |
| **Operation** — Remove | Deletes the field from every entity in scope that has it. |
| **Apply to** — All *(default)* | Every entity you selected. |
| **Apply to** — Filtered list only | Only the entities still showing in the filtered list. |
| **Custom Field name** | Required. **Apply** stays disabled until it is filled in. |
| **Custom Field value** | May be empty — an empty string is a value like any other. Ignored by Remove. |

**Why Add/Overwrite and not Stash's own Overwrite/Add/Remove tabs.** A custom field holds *one*
value per key, so there is no list to append to. "Add" therefore means *do not overwrite* and
"Overwrite" means *overwrite*, which is the only distinction the data shape allows.

**Values are stored as text.** Whatever you type is written as a string. Custom fields can hold any
JSON value and the plugin displays non-string values it reads faithfully, but it does not try to
guess that `5` was meant as a number.

**Nothing is written until you press Apply.** Entities that already carry exactly the value you
asked for are not written to at all.

## After Apply

The list is replaced by exactly what changed, one line per entity, with what happened in front and
`␀` for the side where there is nothing:

```
Replaced Scene "Beach Day" (412): source🟰dvd ⇒ source🟰bluray
Added    Scene "Rooftop" (417): ␀ ⇒ source🟰bluray
```

A **Remove** reads the other way round — `Deleted … source🟰dvd ⇒ ␀` — and after an **Undo** the
lines are shown reversed, so undoing an *Added* reads as a *Deleted*.

**Cancel** becomes **Undo** and **Apply** becomes **Close**.

### Undoing an Apply

**Undo** puts back the value each entity carried *before* the Apply — the previous value where there
was one, and removing the field again where there was not. It is a field-by-field inverse, not a
restore of the whole record, so an unrelated edit made in between is not reverted.

It asks first: the first click arms the button and shows the count (*Undo 37 change(s)?*), the second
performs it. The arming lapses after a few seconds.

It only reaches **this dialog's own writes**, and only **while the dialog stays open**. Closing the
dialog ends it.

## What it covers

| Entity | Written by |
| --- | --- |
| Scene, Image, Gallery, Performer, Group | one bulk mutation per 100 entities |
| Studio, Tag | one update per entity — `BulkStudioUpdateInput` and `BulkTagUpdateInput` carry no `custom_fields` field |

**Scene markers are not offered.** They are the one selectable entity in Stash that has no
`custom_fields` field at all, so the marker list (`/scenes/markers`) shows no menu item. That is a
schema fact, not a gap in this plugin.

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
