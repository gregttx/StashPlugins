# Propagate Tags and Performers to Related Entities

> ## 🚧 Under construction — 0.8.0, every step but the last has landed
>
> The library-wide task is complete and covers every path: it reviews, applies and undoes. **Back
> up your database before running it** — see below. Both automatic modes work, both cooperate with
> the two sibling plugins, and manual buttons with staging are now on the four edit pages —
> **but their placement has not been checked against a running Stash beyond the scene page**, see
> the warning further down.
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
> | Applying the plan, and Undo | **done** (0.3.0) |
> | The two paths out of a gallery's images | **done** (0.4.0) |
> | Automatic mode when the **target** is saved, with the per-entity cooldown | **done** (0.5.0) |
> | Automatic mode when the **source** is saved, fanning out to its targets | **done** (0.6.0) |
> | Cooperating with `MergePerformerTagsToScenes` and `NormalizeParentTags` | **done** (0.7.0) |
> | Manual buttons and staging | **done, placement unverified** (0.8.0) |

> ## ⚠ Back up your database before the first library-wide run
>
> The task adds tags and performers to potentially **every scene, gallery, image and group in your
> library** in one go, and **Stash has no undo**. This plugin only ever adds, so it cannot strip a
> tagging scheme the way a bad prune can — but a run you did not mean is thousands of entities
> carrying assignments you now have to find and remove, and there is no practical way to do that by
> hand. Stop Stash, copy `stash-go.sqlite` (next to your `config.yml`) somewhere safe, start Stash
> again — then run the task. Read the review log properly the first time; that is what it is for.
>
> The dialog has an **Undo** button, but it only reaches its own writes and only while it
> stays open. It is a way out of a run you regret in the moment, not a safety net — the backup is
> the safety net.
>
> The two **automatic** settings deserve the same caution for a different reason: they write on
> every save, with no dialog and nothing to undo them. The manual buttons are the safe way to try
> this plugin out.

> **Requires Stash 0.31.0 or newer.** Tag custom fields (the custom-field exclusion filter) and UI
> plugin component patching (staging into an edit form) both depend on it.

> ## ⚠ Manual button placement is unverified beyond the scene page
>
> The buttons look for a `.edit-buttons` container on each of the four edit tabs. That container is
> confirmed to exist on the **scene** page — `MergePerformerTagsToScenes`' own button already uses
> it — but the gallery, image and group pages reuse the same selector on the working assumption that
> Stash builds every entity's edit panel the same way, not on anything checked against a running
> instance. If a button never appears on one of those three pages, that assumption is the first
> thing to check; the task and both automatic modes are unaffected either way.

## What it does

Stash entities are related to each other, and the tags and performers on one are often true of
another. A scene's performers each carry tags; so does its studio, and each of its markers. A
gallery's images carry tags and performers of their own. A group's scenes carry everything above.
This plugin copies those assignments **along the relationship**, onto the entity that links them.

It is always a **copy**. Nothing is ever removed from the source, and nothing is removed from the
target either — the only thing in the plugin that removes anything at all is the dialog's Undo,
taking back what that same dialog just wrote.

Every line of the review log names the entity being changed, what is being added to it, and **which
entity it came from**:

```
[TAG] Scene "Interview 04" (1182) - Tag "Blonde" (2) - from Performer "Jane Doe" (7)
[TAG] Scene "Interview 04" (1182) - Tag "Outdoor" (3) - from Marker "Outdoor" (994), +2 more
```

Where several entities carried the same thing, one is named and the rest are counted — the named
one is where to start looking. Numbers in brackets are Stash ids, so you can go straight to
`/performers/7` to see why a tag was copied, or to undo one by hand later.

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
| Galleries | their **images** | the slowest path — a run reads every image in the library once, because Stash has no field from a gallery to its images |
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
| Galleries | their **images** | same sweep over every image as the tag path above |

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

## The automatic modes (0.5.0, 0.6.0)

Both react to Stash's own saves, immediately, with no dialog, no review and no undo — so treat them
as the sharp end of this plugin, and try the task first.

**Auto Propagate when the Target is Saved** reacts to a save of one of the four entities anything is
written to. Save a scene and every enabled path that copies *into* scenes runs on that one scene.

- It reads only the entity that was saved, not the library. A save costs one small query plus the
  tag list, and a write only if something is actually missing.
- **It ignores an entity it has just written to**, for 8 seconds. This is what stops the two
  reversible pairs above from bouncing: our write to a group is itself a group save, which would
  propagate straight back down to its scenes, whose writes are scene saves, and so on. It settles
  either way — but only after a burst of writes across the whole group, and every one of them is
  real.

**Auto Propagate when the Source is Saved** reacts to a save of anything an enabled path *reads
from* — a performer, a studio, a marker, or one of the four target entities acting as a source (a
scene names the group it belongs to, for instance). It looks up what that save affects and then
copies into each of those exactly as the target-side mode would, cooldown and all.

- This is the expensive one: saving a popular performer can rewrite every scene they appear in.
  Saving a studio can rewrite every scene and every group it produced.
- Most lookups cost one query per saved entity, following a field Stash already has —
  a gallery's own `scenes`, a group's own `scenes` and `containing_groups`, an image's own
  `galleries`, a marker's own `scene`. The three that do not have such a field — a performer's
  scenes, a studio's scenes and groups, a gallery's images — go through a filtered, paged query
  instead, the same way the slow gallery-images path above already does.
- A save can be **both**: a scene is a target of its own paths and a source for the group it
  belongs to, and both reactions run independently.

Both automatic modes share the rest of their behaviour:

- **They stand down while another plugin is writing in bulk**, and each holds its own short lease
  while it writes, so a sibling's reactive mode stands down for it in turn.
- A save Stash *rejected* is not reacted to. A response coming back is not the same as an edit
  being accepted, and copying tags onto an entity because of an edit that never happened would be
  the worst kind of surprise.

## Manual buttons and staging (0.8.0)

With **Show Manual Buttons** on, each enabled path adds a small button to the Edit tab of its
target — a scene with the performer-tags and studio-tags paths both enabled shows two buttons, not
one that tries to name both, and a path with no button setting simply has no button.

Clicking one does one of two things, depending on **Save Immediately**:

- **Off (the default) — stages.** The tags or performers it would add are pushed straight into the
  open edit form's own tag or performer box, exactly as if you had picked them from the dropdown
  yourself. Nothing is saved until you press Stash's own **Save** button, so you can review or
  remove any of them first. Clicking the same button again only adds what is still missing — tags
  you have since removed by hand are not put back, and a click that finds nothing reports "No
  changes" instead of restaging the same tags.
- **On — saves immediately.** The button copies and saves in one step, the same write the automatic
  modes and the library-wide task make. There is no staging, no review and no per-click undo — the
  library-wide task's Undo only ever reaches what that task's own dialog wrote.

A button that cannot find the tag or performer box — the Edit tab was never opened, or Stash's
markup does not match what this plugin expects on that page (see the warning near the top of this
README) — reports the problem in an alert rather than silently doing nothing.

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
(`[ptp2re] PropagateTagsAndPerformers.js 0.8.0 loaded`); if that number is behind the one in the
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
  task dialog names it in the log when both are covering `Tags: Performers → Scenes`. This works for
  any future plugin doing the same kind of copy too, not just this one by name.
- **`NormalizeParentTags`** walks the *tag hierarchy* instead of entity relationships, so the two
  compose rather than overlap: propagate tags onto an entity, then prune or roll up the parents. Its
  automatic modes and this plugin's stand down for one another while either is writing in bulk. And
  since eleven of these thirteen paths add tags, the task dialog also warns when NormalizeParentTags'
  **Auto Prune** or **Auto Roll Up on Entity Updates** is on — naming which, and what it would do to
  what this run adds — exactly as `MergePerformerTagsToScenes`' own dialog already does.

## Licence

Same terms as the rest of this repository.
