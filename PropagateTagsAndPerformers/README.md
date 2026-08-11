# Propagate Tags and Performers to Related Entities

> ## 🚧 Under construction — 0.12.14, every step but the last has landed
>
> The library-wide task is complete and covers every path: it reviews, applies and undoes. **Back
> up your database before running it** — see below. Both automatic modes work, both cooperate with
> the two sibling plugins, and manual buttons with staging are confirmed working on **all four
> target pages** — Scene, Gallery, Image and Group — with a second set of buttons on the **source's
> own page** instead: a performer, a studio, or one of those same four entities acting as a source.
>
> **If you are upgrading, two things are worth knowing.** Update `MergePerformerTagsToScenes` to
> 1.15.0 or newer alongside anything from 0.9.0 on, or the two plugins' buttons will duplicate on
> the one relationship they share. And if your buttons currently sit to the *left* of Save, you are
> on 0.12.0 or older: every version from 0.9.0 to 0.12.0 looked for Stash's Delete button only by a
> CSS class that does not exist on the Scene edit row, so all four silently placed buttons before
> Save. 0.12.1 finds it by label as well; update and they move between Save and Delete, which is
> where the placement work below was trying to put them all along.
>
> Button placement and row spacing took 0.9.0 through 0.12.8 to settle, most of it against live
> screenshots rather than tests. The step table records which release did what; the reasoning is in
> `CLAUDE.md`. What it comes to now: a button anchors on Delete, or Save where there is no Delete,
> and appends only when neither is there; the two plugins agree a fixed relative order rather than
> racing each other for the spot next to the anchor; and both the row gap and each button's own
> margins are read off whatever Stash already put in that row, so every gap in it matches, rather
> than being set to a fixed value that matched nothing.
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
> | Manual buttons and staging, target side | **done; confirmed on all four pages** (0.8.0 – 0.8.3) |
> | Button fixes, renamed buttons, and manual buttons on the source side | **done** (0.9.0) |
> | Button placement and row spacing, settled against live screenshots | **done** (0.9.1 – 0.12.8) |
> | Deterministic ordering against `MergePerformerTagsToScenes`' buttons in the same row | **done** (0.10.0) |

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

Each phase closes with a recap of every distinct tag and performer the run moves and how many
entities each lands on — the question worth asking before a library-wide write, and one a
six-figure log cannot be read for. Since 0.16.0 **the tags in that line hover**, naming their
aliases and description, which is what tells two tags sharing a name apart without leaving the
dialog. Only tags with something to add beyond the name carry one.

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

## Manual buttons and staging (0.8.0 – 0.12.1)

With **Show Manual Buttons** on, each enabled path adds a small button to the Edit tab of its
target — a scene with the performer-tags and studio-tags paths both enabled shows two buttons, not
one that tries to name both, and a path with no button setting simply has no button. Since 0.9.0,
each button is also labelled consistently: `"Copy [all|common] [Tags|Perfs] from all <plural>"` —
for example **"Copy all Tags from all Performers"** on a scene, or **"Copy common Tags from all
Scenes"** on a group if you have turned on that path's "common tags only" setting.

Since 0.9.1, a button lands **beside Save and Delete rather than after them** — grouped with
Stash's own non-destructive actions, the same placement `MergePerformerTagsToScenes`' button
already uses, rather than trailing behind. On a page with two enabled paths, the row now also gets
a small gap between its two lines when it wraps, rather than the second row sitting flush against
the first. 0.9.1 supplied that gap with a margin on the buttons themselves, which turned out to
grow Stash's own Save/Delete/Submit buttons taller too — a flex row stretches every button sharing
it to match whichever one is tallest. 0.9.2 moves the gap onto the row itself instead, which does
not have that effect. Since 0.11.0, "beside" specifically means **between Save and Delete** — 0.9.1
had landed it before Save instead, and further live feedback was that this was the position
actually wanted, not that one. Since 0.12.0, a page with no Delete at all (Group's edit form) lands
its button **before Save** instead of after it, so Save — Stash's own primary action — always stays
the last thing in the row rather than being displaced by ours.

Since 0.12.1 this finally takes effect on Scene: up to 0.12.0 the plugin recognised Delete only
by a CSS class that Stash does not put on that page's Delete, so every version silently used the
Save fallback and placed buttons to the left of Save. Delete is now recognised by its label too.

### When a button appears

Since 0.13.0 a target-side button appears only when clicking it would **actually add something**.
It hides when the relationship is absent (a scene with no performers, a group with no studio), and
also when the relationship is there but has nothing left to give: the sources carry no tags, the
target already has all of them, the "common tags only" intersection is empty, or the exclusion
filters refuse everything that is left. An entity excluded outright by the entity-level filters
shows no buttons at all.

This costs nothing. Deciding whether to show the button already meant fetching the entity and its
sources and running the diff — up to 0.12.14 the answer was computed and thrown away, and the
button was drawn from the weaker question "is there a performer here at all".

**Source-side buttons stop one step short**, and it is a real limit rather than an oversight. They
hide when the source reaches nothing (a performer in no scenes) and, since 0.13.0, when the source
carries nothing worth copying (a performer with no tags of its own — matching what
`MergePerformerTagsToScenes`' performer button has always done). They do **not** check whether the
scenes on the far side already have those tags: that means reading every scene a studio touches,
which is unbounded. So a source button can still report "No changes" on click.

**The gate reads the server.** With **Save Immediately** off, a click diffs against the open edit
form instead — so if you remove a tag from the form without saving, the button that would put it
back stays hidden until you press Save. Saving re-checks immediately; you never need to reload.

### Why is a button missing?

Since 0.13.0 a button hides itself whenever clicking it would add nothing, and most of the reasons
are invisible from the page — the sources' tags, the target's own tags, the exclusion filters. To
see the reasoning, open the browser console (F12), run:

```js
StashPluginCoop.debugButtons = true
```

Each button reports whether it is shown or hidden and why, prefixed `[ptp2re gate]`, on the next tick —
no reload, no navigation, no setting to change. It works on the page you are already looking at,
which is the point: since 0.13.2 the answer is restated from what the plugin already knows rather
than only when it next re-checks. One switch covers both this plugin and its sibling, since they
draw buttons into the same rows. Set it to `false`, or reload the page, to turn it off again.

**Each button copies its own path and nothing else** (0.16.0). With both the performer and studio
paths enabled on a scene, "Copy all Tags from all Performers" copies the performers' tags and
leaves the studio's alone; the studio's button is what copies those. Up to 0.15.0 either button ran
every enabled path into the page, which is not what the caption, the tooltip or the setting
description said, and made this plugin's scene button quietly do more than
`MergePerformerTagsToScenes`' identically labelled one.

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

A button that cannot find the tag or performer box — the Edit tab was never opened, or a fresh
Stash version has changed markup this plugin has not seen yet — reports the problem in an alert
rather than silently doing nothing. On a Stash too old to let a plugin observe those boxes at all,
staging is impossible rather than merely failing, so since 0.16.0 the buttons **save** there
instead, say so in their tooltip, and warn once in the browser console.

**If `MergePerformerTagsToScenes` is also installed and showing its own button for the same path**
("Copy Tags to all Scenes" on the performer page, "Copy all Tags from all Performers" on the scene
page — today the only path the two plugins share), this plugin does not add a second one next to
it (0.8.3, and again for the new source-side button at 0.9.0 — see below). Nothing else changes:
click MPTTS's button and you get its behaviour; enable more paths here and you still get buttons
for all of them, this one path aside. This needs `MergePerformerTagsToScenes` 1.12.1 or newer,
which renamed its two buttons to match; an older copy's buttons will not be recognised and both
plugins' buttons will show.

### Source-side buttons (0.9.0)

The buttons above pull tags or performers *in* to whatever page you are viewing. Eleven of the
thirteen paths also offer the reverse: a button on the **source's own page** that pushes its tags
or performers *out* to everything an enabled path reaches — a performer's own page gets **"Copy
Tags to all Scenes"** and **"Copy Tags to all Groups"**, a studio's page the same two, and a
scene, gallery, image or group's own page (not its Edit tab — its ordinary detail view) gets
whichever of its own outgoing paths are enabled.

Two paths have no source button: a scene marker has no page of its own to put one on, being
something you view inside a scene's Markers tab rather than a page you navigate to directly.

Source-side buttons always save immediately, with no staging option — one click can resolve to
many different entities across many different pages at once, and there is no single form to stage
the result into. Everything else works the same as the target-side buttons: the gating above, the
dedup check against `MergePerformerTagsToScenes`, the same **Show Manual Buttons** toggle, and,
since 0.9.1, landing before Delete rather than after it.

**Placement beyond the performer and studio pages is unverified against a running Stash**, except
Scene and Gallery, whose markup was read off a live instance for 0.14.0 — see the note under the
button table. The
target-side buttons went through three rounds of live fixes (0.8.1 – 0.8.3) before all four of
their pages were confirmed; the source-side buttons are new at 0.9.0 and have not had that
round yet. If one is missing on a page it should be on, that is most likely it.

### Every button, by page

All 24 of this plugin's buttons, plus the 2 from `MergePerformerTagsToScenes` that share these
rows. Every one of them additionally needs **Show Manual Buttons** on (MPTTS's own setting is
**Show Manual Merge Buttons**), and every one is hidden when clicking it would add nothing — see
"When a button appears" above.

Within a row the order is fixed: `Save · …this plugin's buttons… · MPTTS's button · Delete`.
Group's Edit tab has no Delete, so everything there appends after Save.

| Page | View | Button | Plugin | Path / setting |
|---|---|---|---|---|
| `/scenes/<id>` | Edit tab | Copy all Perfs from all Galleries | this | `b5` |
| `/scenes/<id>` | Edit tab | Copy all Tags from all Markers | this | `b3` |
| `/scenes/<id>` | Edit tab | Copy all Tags from all Performers | this | `b1` — **hidden when MPTTS shows its own** |
| `/scenes/<id>` | Edit tab | Copy Tags from Studio | this | `b2` |
| `/scenes/<id>` | Edit tab | Copy all Tags from all Groups | this | `b4` |
| `/scenes/<id>` | Edit tab | Copy all Tags from all Performers | MPTTS | its only scene button |
| `/scenes/<id>` | Groups tab | Copy *all\|common* Tags to all Groups from their Scenes | this | `e1` — under the tab strip |
| `/galleries/<id>` | Edit tab | Copy all Perfs from all Images | this | `c2` |
| `/galleries/<id>` | Edit tab | Copy all Tags from all Images | this | `c1` |
| `/galleries/<id>` | Scenes tab | Copy Perfs to all Scenes | this | `b5` — under the tab strip |
| `/galleries/<id>` | Images tab | Copy Tags to all Images | this | `d1` — under the tab strip |
| `/images/<id>` | Edit tab | Copy all Tags from all Galleries | this | `d1` |
| `/images/<id>` | Galleries tab | Copy Perfs to all Galleries | this | `c2` — under the tab strip, if Image has one |
| `/images/<id>` | Galleries tab | Copy Tags to all Galleries | this | `c1` — under the tab strip, if Image has one |
| `/groups/<id>` | Edit tab | Copy *all\|common* Tags from all Scenes | this | `e1` |
| `/groups/<id>` | Edit tab | Copy Tags from Studio | this | `e3` |
| `/groups/<id>` | Edit tab | Copy all Tags from all Performers | this | `e4` |
| `/groups/<id>` | Edit tab | Copy all Tags from all Markers | this | `e5` |
| `/groups/<id>` | Edit tab | Copy *all\|common* Tags from all Sub-groups | this | `e6` |
| `/groups/<id>` | Detail | Copy Tags to all Scenes | this | `b4` |
| `/groups/<id>` | Detail | Copy *all\|common* Tags to all Containing Groups from their Sub-groups | this | `e6` |
| `/performers/<id>` | Detail | Copy Tags to all Scenes | this | `b1` — **hidden when MPTTS shows its own** |
| `/performers/<id>` | Detail | Copy Tags to all Groups | this | `e4` |
| `/performers/<id>` | Detail | Copy Tags to all Scenes | MPTTS | its only performer button |
| `/studios/<id>` | Detail | Copy Tags to all Scenes | this | `b2` |
| `/studios/<id>` | Detail | Copy Tags to all Groups | this | `e3` |

*all\|common* is whichever the path's own "common tags only" setting says; the button's label
changes with it.

**Source buttons sit in one of two places, and the page decides which.** Performer and Group show a
row of actions on their detail view (beside Delete), and the button joins it. Scene and Gallery show
no such row at all — just a tab strip (Details / File Info / Chapters / Edit) — so since 0.14.0 the
button gets a small row of its own directly under that strip. Image follows whichever shape it turns
out to have.

Since 0.15.0 a button in that row **appears only while the tab showing its targets is open** — the
Groups tab for "…to all Groups", the Images tab for "…to all Images". Where a page has no tab for
that type, the button shows on every tab rather than disappearing; a missing button is the worse
mistake. Buttons in a detail action row (Performer, Group) are not affected.

Until 0.13.3 those five buttons simply never appeared, and nothing said why; the gating diagnostics
below are what found it.

**Anything this plugin writes outside the task dialog refreshes what it wrote.** The groups (or
images, or scenes) it updated are dropped from Stash's client-side cache, so the panel you are
looking at redraws with the new tag counts instead of the ones it loaded before. No page reload —
a button keeps its "Added N". Since 0.16.0 this covers **both automatic modes** as well as both
buttons; before that only the source-side button refreshed, so an automatic propagation left the
page you had just saved showing what it read a moment earlier. Only entities actually written are
dropped: refetching a panel a run did not change is the one cost this has.

### What a source-side button actually does

This is the one thing worth reading twice, because the obvious reading is wrong.

**It does not copy the tags of the entity you are standing on.** It finds the targets that entity
reaches, then rebuilds *each of those targets from all of their own sources*. On a scene, "Copy
common Tags to all Groups from their Scenes" updates every group the scene belongs to, and each group
is computed from **every scene in it** — this one is merely how the groups were found.

With **common tags only** on, a tag is copied only if *every* scene in that group carries it. So a
tag unique to the scene you are on adds nothing, and the button can honestly report "No changes".
Turn the setting off and the label becomes "Copy all Tags…", the union, and it lands.

The same is true of the other source buttons, less dramatically: they aggregate too, but without a
"common" mode the extra sources only ever add on top of what you expected. Every source button's
tooltip says so.

Nowhere else. There are no buttons on list pages, on tag pages, or on scene markers — a marker has
no page of its own, which is why `tags:marker>scene` and `tags:marker>group` are the two paths with
no source-side button. `NormalizeParentTags` adds no entity-page button at all.

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
(`[ptp2re] PropagateTagsAndPerformers.js 0.12.8 loaded`); if that number is behind the one in the
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
  any future plugin doing the same kind of copy too, not just this one by name. Where both plugins'
  manual buttons land in the same row (Scene, Performer), the two agree on a fixed relative order
  (0.10.0), both anchored the same way: between Save and Delete where both exist, before Save where
  only Save does (0.11.0, 0.12.0) — never displacing either from the row, rather than whichever
  plugin's eligibility check happens to finish first.
- **`NormalizeParentTags`** walks the *tag hierarchy* instead of entity relationships, so the two
  compose rather than overlap: propagate tags onto an entity, then prune or roll up the parents. Its
  automatic modes and this plugin's stand down for one another while either is writing in bulk. And
  since eleven of these thirteen paths add tags, the task dialog also warns when NormalizeParentTags'
  **Auto Prune** or **Auto Roll Up on Entity Updates** is on — naming which, and what it would do to
  what this run adds — exactly as `MergePerformerTagsToScenes`' own dialog already does.

## Licence

Same terms as the rest of this repository.
