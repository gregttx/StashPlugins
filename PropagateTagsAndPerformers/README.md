# Propagate Tags and Performers to Related Entities

> ## 🚧 Under construction — 0.2.0 reviews but cannot yet apply
>
> The task now walks your library and lists **every change it would make**, for eleven of the
> thirteen paths. Nothing is written: pressing Proceed does nothing yet, and the two paths out of a
> gallery's images are not planned at all. Treat it as a way to see what the plugin *would* do to
> your library before it can do it.
>
> The version stays below **1.0.0** until the plugin is finished and worth using; the major digit
> is what says so. Until then each of the steps below takes a minor bump as it lands.
>
> This README describes the plugin as designed. Each section is marked with the step that
> delivers it, and the list is kept honest as they land:
>
> | | Status |
> | --- | --- |
> | Settings, path table, stylesheet | **done** (0.0.1) |
> | Task entry point, review dialog, settings page | **done** (0.1.0) |
> | The library scan, for the eleven paths reached by traversal | **done** (0.2.0) |
> | Applying the plan, and Undo | not started |
> | The two paths out of a gallery's images | not started |
> | Automatic modes, with the per-entity cooldown | not started |
> | Manual buttons and staging | not started |

> ## ⚠ Back up your database before the first library-wide run
>
> The task adds tags and performers to potentially **every scene, gallery, image and group in your
> library** in one go, and **Stash has no undo**. This plugin only ever adds, so it cannot strip a
> tagging scheme the way a bad prune can — but a run you did not mean is thousands of entities
> carrying assignments you now have to find and remove, and there is no practical way to do that by
> hand. Stop Stash, copy `stash-go.sqlite` (next to your `config.yml`) somewhere safe, start Stash
> again — then run the task. Read the review log properly the first time; that is what it is for.
>
> The dialog will have an **Undo** button, but it only reaches its own writes and only while it
> stays open. It is a way out of a run you regret in the moment, not a safety net — the backup is
> the safety net.
>
> The two **automatic** settings deserve the same caution for a different reason: they write on
> every save, with no dialog and nothing to undo them. The manual buttons are the safe way to try
> this plugin out.

> **Requires Stash 0.31.0 or newer.** Tag custom fields (the custom-field exclusion filter) and UI
> plugin component patching (staging into an edit form) both depend on it.

## What it does

Stash entities are related to each other, and the tags and performers on one are often true of
another. A scene's performers each carry tags; so does its studio, and each of its markers. A
gallery's images carry tags and performers of their own. A group's scenes carry everything above.
This plugin copies those assignments **along the relationship**, onto the entity that links them.

It is always a **copy**. Nothing is ever removed from the source, and nothing is removed from the
target either — the only thing in the plugin that removes anything at all is the dialog's Undo,
taking back what that same dialog just wrote.

`MergePerformerTagsToScenes` already does one of these thirteen paths, and does it well. This
plugin implements it too, so it can stand alone; the two coexist, and the dialog says so when both
are set to act on the same path. Neither disables the other.

## The thirteen paths

Each one is a separate setting, and every one of them is **off** on a fresh install.

### Tags

| Onto | From | Notes |
| --- | --- | --- |
| Scenes | their **performers** | the path `MergePerformerTagsToScenes` also covers |
| Scenes | their **studio** | |
| Scenes | their **markers** | a marker's primary tag counts as one of its tags |
| Scenes | their **groups** | reverse of *Groups ← Scenes* — see the warning below |
| Galleries | their **images** | the slowest path; six-figure image counts are normal. Not yet implemented |
| Images | their **galleries** | reverse of *Galleries ← Images* — see the warning below |
| Groups | their **scenes** | union, or **only the tags every scene shares** |
| Groups | their **studio** | |
| Groups | their scenes' **performers** | two hops — a group has no performers of its own |
| Groups | their scenes' **markers** | two hops, for the same reason |
| Groups | their **sub-groups** | union, or **only the tags every sub-group shares** |

### Performers

| Onto | From | Notes |
| --- | --- | --- |
| Scenes | their **galleries** | |
| Galleries | their **images** | *(not yet implemented)* |

There is deliberately **no performer path onto a Group**, in any direction: `Group` has no
`performers` field in Stash's schema at all. Groups are tag-only. That is why *Groups ← performers*
above has to route through the group's scenes.

There is also no path onto a **Performer**. It was considered and rejected: a performer appears in
thousands of scenes, so the union of those scenes' tags is enormous and near-meaningless.

## ⚠ The two reversible pairs

Two of the paths are the exact reverse of another:

```
Tags: Scenes → their Group      ⇄   Tags: Groups → their Scenes
Tags: Images → their Gallery    ⇄   Tags: Galleries → their Images
```

Enabling **both halves of a pair** does something you may not expect: every member converges on the
same tag set. Two scenes in a group, one tagged `Interview` and one tagged `Outdoor`, end up with
the group and *both* scenes carrying `Interview` **and** `Outdoor`. That is what running both
directions means, it is not a bug, and it happens in two rounds.

If that is not what you want, two things help:

- Turn on **common tags only** for *Scenes → their Group*. The group then gains only the tags every
  one of its scenes already has, so pushing back down adds almost nothing.
- Or simply do not enable both halves.

Under the **task** this is not a concern: one run applies each direction once, in a fixed order.
The hazard is the automatic modes, where each write triggers the other.

## Order matters, and it is fixed

The paths cascade. Copying marker tags onto scenes *before* copying scene tags onto groups means
the group transitively inherits the marker tags; the other order leaves them for the next run. So
the order is fixed, and the dialog states it:

1. **Performer assignments** — images onto galleries, galleries onto scenes. These run first
   because the tag paths read performers, and a performer that arrives later brings no tags with it
   until the next run.
2. **Tags onto scenes** — from markers, performers, studio.
3. **Tags onto galleries** — from images.
4. **Tags onto groups** — from scenes, studio, and (through those scenes) performers and markers.
5. **Tags onto containing groups** — from sub-groups, once those groups have gathered.
6. **The two reverses** — groups back onto scenes, galleries back onto images — last, so they
   distribute what stages 1–5 gathered rather than a stale set.

## Installing

Copy the `PropagateTagsAndPerformers` folder into your Stash plugins directory (next to your
`config.yml`, usually `~/.stash/plugins/`) so that you have:

```
plugins/PropagateTagsAndPerformers/PropagateTagsAndPerformers.yml
plugins/PropagateTagsAndPerformers/PropagateTagsAndPerformers.js
plugins/PropagateTagsAndPerformers/README.md
```

Then **Settings → Plugins → Reload plugins**, and reload the page in your browser.

If the plugin appears in the settings list but nothing else happens, the browser is probably still
running a cached copy of the script. The console prints the version it is actually running at load
(`[ptp2re] PropagateTagsAndPerformers.js 0.2.0 loaded`); if that number is behind the one in the
settings heading, press F5. The heading comes from the manifest and goes current the moment plugins
are reloaded, so it proves nothing about the script.

## Settings

All under **Settings → Plugins → Propagate Tags and Performers to Related Entities**. Each
description shows one line on the page; hover it, or the setting's name, for the rest.

**Running it** — whether the manual buttons appear, whether they save or stage for review, and the
two automatic modes (react when the *target* is saved, or when a *source* is saved). The
source-side mode fans out: saving one performer can rewrite every scene they appear in.

**The thirteen paths**, grouped by what they write onto: scenes, galleries, images, groups. The two
group aggregations each have a **common tags only** toggle directly beneath them.

**Exclusion filters** — skip entities carrying a tag you name, skip entities marked Organized,
never copy tags set to *Ignore auto tag*, and never copy tags carrying a custom field you name.

**Logging** — write every copy to the browser console (F12 → Console; **not** the Stash server log
or the Logs page — this is a UI plugin and cannot write there).

## Relationship to the other plugins in this repo

- **`MergePerformerTagsToScenes`** implements one of these paths. Both can be installed and enabled
  at once; both only ever add, so the overlap is redundant work rather than wrong data, and the
  dialog will point it out.
- **`NormalizeParentTags`** walks the *tag hierarchy* instead of entity relationships, so the two
  compose rather than overlap: propagate tags onto an entity, then prune or roll up the parents. Its
  automatic modes and this plugin's stand down for one another while either is writing in bulk.

## Licence

Same terms as the rest of this repository.
