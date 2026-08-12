# GTTx Custom Fields Bulk Editor

> ## ⚠ Back up your database before the first run
>
> **Apply** rewrites one custom field across every entity you had selected — potentially your whole
> library, if that is what you selected — and **Stash has no undo**. Stop Stash, copy
> `stash-go.sqlite` (next to your `config.yml`) somewhere safe, start Stash again, then use the
> plugin. Read the list before pressing Apply; that is what it is for.
>
> The dialog does have an **[Undo](#undoing-an-apply)** button, but it only reaches its own writes and
> only while it stays open. It is a way out of an Apply you regret in the moment, not a safety net —
> the backup is the safety net.

> **Requires Stash 0.31.0 or newer.** `custom_fields` on the entity types, and `CustomFieldsInput`
> on their update mutations, are what this plugin is built on.
>
> ## 0.0.1 — this has never been run in a real Stash
>
> The version number is the honest one. The plugin is complete and has 56 automated checks behind
> it, but those checks reproduce Stash's markup **from notes**, so they prove the plugin is
> self-consistent and nothing more. The three things it has to be right about — the `...` menu's
> id, what a selected row looks like, and how a row links to its own entity — have not been read off
> a running instance. Expect to have to report that the menu item does not appear; the
> [troubleshooting switch](#troubleshooting) below is there to say which of the three failed.
>
> It will reach 1.0.0 when that has been walked through in a live Stash, not before.

Stash stores custom fields on seven kinds of entity and lets you edit them **one record at a time**.
Its API has no such limit. This plugin adds the two things that are missing: a **view** of what a
whole selection carries, and **one write across it**.

It is a front-end-only plugin with **no settings and no tasks**. It does nothing at all until you
open a menu.

---

## Using it

1. Open any list view — Scenes, Images, Galleries, Performers, Studios, Groups or Tags — and
   **select some entities**.
2. Open the **"..."** menu at the top of the list (just right of the trash icon).
3. Pick **Custom Fields...** — the last item in the menu. It only appears while something is
   selected.

The dialog opens on what your selection carries **now**:

```
Scene "Beach Day" (412) - shoot - 2019-07
Scene "Beach Day" (412) - source - dvd
Scene "Rooftop" (417) - shoot - 2021-02
```

- **Filter by Name** and **Filter by Value** narrow that list as you type (case-insensitive
  substring, both applied together).
- The list is a plain text box: scroll it, select it, copy it. There is no export button because
  there does not need to be one.
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

The list is replaced by exactly what changed, one line per entity:

```
Scene "Beach Day" (412) - source - dvd -> bluray
Scene "Rooftop" (417) - source - (none) -> bluray
```

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

**The version in the settings page is not the one the console printed.** The settings page reads the
manifest, which goes current the moment plugins are reloaded; the console line comes from inside the
script your browser actually has. If they disagree, reload the page. The dialog checks this too, and
disables **Apply** while they disagree — but never Undo, since stranding you with changes you cannot
take back would be worse than the mismatch.

## Installing

Copy the `CustomFieldsBulkEditor` folder into your Stash plugins directory
(`<stash-config-dir>/plugins/`), then **Settings → Plugins → Reload Plugins**, and reload the page.
