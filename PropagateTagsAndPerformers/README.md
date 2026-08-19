# ᝯㄝₓ Propagate Tags and Performers to Related Entities

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
one is where to start looking. Numbers in brackets are ids, so you can go straight to
`/performers/7` to see why a tag was copied, or to undo one by hand later.

Each phase closes with a recap of every distinct tag and performer the run moves and how many
entities each lands on — the question worth asking before a library-wide write, and one a
six-figure log cannot be read for. **The tags in that line hover**, naming their
aliases and description, which is what tells two tags sharing a name apart without leaving the
dialog. Only tags with something to add beyond the name carry one.

`MergePerformerTagsToScenes` already does one of these thirteen paths, and does it well. This
plugin implements it too, so it can stand alone; the two coexist, and the dialog says so when both
are set to act on the same path. Neither disables the other.

## The thirteen paths

Every one of them is **off** on a fresh install. Which paths run is one setting, edited in the
**Path Settings** dialog — from **Settings → Tasks → Plugin Tasks**, or from the button on the
setting's own row under **Settings → Plugins**. Each path is *Off* or *On*, and the two group
aggregations offer a third choice, *Common tags only*.

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

The dialog says so when it finds a pair enabled, in **one** note however many pairs are on — with
both pairs enabled.

**Press Escape** to close the dialog, exactly as Cancel or Close would. While a write is actually
in flight it does nothing — there is no Cancel to reach at that moment, and Stop is not something a
stray keypress should do.

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

## The automatic modes

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

## Manual buttons and staging

With **Show Manual Buttons** on, each enabled path adds a small button to the Edit tab of its
target — a scene with the performer-tags and studio-tags paths both enabled shows two buttons, not
one that tries to name both, and a path with no button setting simply has no button. Each button
is labelled consistently: `"Add [all|common] [Tags|Perfs] from all <plural>"` —
for example **"Add all Tags from all Performers"** on a scene, or **"Add common Tags from all
Scenes"** on a group if you have set that path to *Common tags only*.

A button lands **between Save and Delete** — grouped with Stash's own non-destructive actions,
the same placement `MergePerformerTagsToScenes`' buttons use. On a page with no Delete at all
(Group's edit form) it lands **before Save**, so Save — Stash's own primary action — always stays
the last thing in the row rather than being displaced by ours. On a page with two enabled paths,
the row gets a small gap between its two lines when it wraps; the gap is on the row rather than on
the buttons, since a margin on a button in a flex row grows Stash's own buttons taller with it.

Every button this plugin draws is **amber**, where Stash's own row actions are grey.
Amber is this repo's colour for "a plugin put this here, and pressing it writes to entities other
than the one in front of you" — the same colour `MergePerformerTagsToScenes` uses for its two
buttons, so a row holding both reads as one kind of thing rather than two. It is deliberately not
the blue of a primary action: Save is still the primary action on those pages. Inside the review
dialog the same colour marks **Proceed** and **Undo**, the two buttons in that footer that change
anything.

### When a button appears

A target-side button appears only when clicking it would **actually add something**.
It hides when the relationship is absent (a scene with no performers, a group with no studio), and
also when the relationship is there but has nothing left to give: the sources carry no tags, the
target already has all of them, the "common tags only" intersection is empty, or the exclusion
filters refuse everything that is left. An entity excluded outright by the entity-level filters
shows no buttons at all.

This costs nothing. Deciding whether to show the button already means fetching the entity and its
sources and running the diff, so the answer is there to be used.

**Source-side buttons stop one step short**, and it is a real limit rather than an oversight. They
hide when the source reaches nothing (a performer in no scenes) and when the source
carries nothing worth copying (a performer with no tags of its own — the same gate
`MergePerformerTagsToScenes`' performer button uses). They do **not** check whether the
scenes on the far side already have those tags: that means reading every scene a studio touches,
which is unbounded. So a source button can still report "No changes" on click.

**The gate reads the server.** With **Save Immediately** off, a click diffs against the open edit
form instead — so if you remove a tag from the form without saving, the button that would put it
back stays hidden until you press Save. Saving re-checks immediately; you never need to reload.

### Why is a button missing?

A button hides itself whenever clicking it would add nothing, and most of the reasons
are invisible from the page — the sources' tags, the target's own tags, the exclusion filters. To
see the reasoning, open the browser console (F12), run:

```js
__GTTx__.StashPluginCoop.debugButtons = true
```

Each button reports whether it is shown or hidden and why, prefixed `[ptp2re gate]`, on the next tick —
no reload, no navigation, no setting to change. It works on the page you are already looking at,
which is the point: the answer is restated from what the plugin already knows rather
than only when it next re-checks. One switch covers every plugin in this repo that draws a control
into Stash's own UI — two of them share these very rows, and "why is this missing" is rarely a
question about only one. Set it to `false`, or reload the page, to turn it off again.

**Each button copies its own path and nothing else.** With both the performer and studio
paths enabled on a scene, "Add all Tags from all Performers" copies the performers' tags and
leaves the studio's alone; the studio's button is what copies those — which is what the caption,
the tooltip and the setting description each say it does.

Clicking one does one of two things, depending on **Save Immediately**:

- **Off (the default) — stages.** The tags or performers it would add are pushed straight into the
  open edit form's own tag or performer box, exactly as if you had picked them from the dropdown
  yourself. Nothing is saved until you press Stash's own **Save** button, so you can review or
  remove any of them first. Clicking the same button again only adds what is still missing — tags
  you have since removed by hand are not put back, and a click that finds nothing reports "No
  changes" instead of restaging the same tags.
- **On — reviews in a dialog.** The caption gains a trailing **"..."** to say so. The click opens
  the same dialog the library-wide task uses, scoped to this one entity and this one path: it lists
  every change, writes nothing until you press **Proceed**, and offers **Undo**, **Rescan** and
  **Copy log** afterwards. **Rescan keeps the log** — it writes a `--- Rescan ---` line and carries
  on below it, rather than clearing the view for the next pass. While the dialog is working —
  scanning, applying or undoing — a cursor cycles under the last line: the counters say how far it
  has got, the cursor says it is still going. Nothing in this plugin writes from a
  click without either staging it or showing it to you first. The dialog's heading names what it is
  scoped to — *Add Tags to all Scenes - from Performer "Jane" (100)* — so a dialog opened from a
  button says which entity it is about, by the name you know it by.

A button that cannot find the tag or performer box — the Edit tab was never opened, or a fresh
Stash version has changed markup this plugin has not seen yet — reports the problem in an alert
rather than silently doing nothing. On a Stash too old to let a plugin observe those boxes at all,
staging is impossible rather than merely failing, so the buttons **review in the dialog** there
instead, say so in their tooltip, and warn once in the browser console.

**If `MergePerformerTagsToScenes` is also installed and showing its own button for the same path**
("Add Tags to all Scenes" on the performer page, "Add all Tags from all Performers" on the scene
page — today the only path the two plugins share), this plugin does not add a second one next to
it, on the source side as well as the target side. Nothing else changes:
click MPTTS's button and you get its behaviour; enable more paths here and you still get buttons
for all of them, this one path aside. This needs `MergePerformerTagsToScenes` 1.12.1 or newer,
which renamed its two buttons to match; an older copy's buttons will not be recognised and both
plugins' buttons will show.

### Source-side buttons

The buttons above pull tags or performers *in* to whatever page you are viewing. Eleven of the
thirteen paths also offer the reverse: a button on the **source's own page** that pushes its tags
or performers *out* to everything an enabled path reaches — a performer's own page gets **"Copy
Tags to all Scenes"** and **"Add Tags to all Groups"**, a studio's page the same two, and a
scene, gallery, image or group's own page (not its Edit tab — its ordinary detail view) gets
whichever of its own outgoing paths are enabled.

Two paths have no source button: a scene marker has no page of its own to put one on, being
something you view inside a scene's Markers tab rather than a page you navigate to directly.

Source-side buttons have no staging option — one click can resolve to many different entities
across many different pages at once, and there is no single form to stage the result into. They
therefore always end in **"..."** and always open the review dialog, which lists every change across
every entity the source reaches before a single one is written. This is the widest write the plugin
offers from one click. Everything else works the same as the target-side buttons: the gating
above, the dedup check against `MergePerformerTagsToScenes`, the same **Show Manual Buttons**
toggle, and the same place in the row, before Delete.

**Placement beyond the performer and studio pages is unverified against a running Stash**, except
Scene and Gallery, whose markup was read off a live instance — see the note under the button table.
The target-side buttons have been through rounds of live fixes and all four of their pages are
confirmed; the source-side buttons have not had that round. If one is missing on a page it should
be on, that is most likely it.

### Every button, by page

All 24 of this plugin's buttons, plus the 2 from `MergePerformerTagsToScenes` that share these
rows. Every one of them additionally needs **Show Manual Buttons** on (MPTTS's own setting is
**Show Manual Merge Buttons**), and every one is hidden when clicking it would add nothing — see
"When a button appears" above.

Within a row the order is fixed: `Save · …this plugin's buttons… · MPTTS's button · Delete`.
Group's Edit tab has no Delete, so everything there appends after Save.

| Page | View | Button | Plugin | Path |
|---|---|---|---|---|
| `/scenes/<id>` | Edit tab | Add all Perfs from all Galleries | this | `performers:gallery>scene` |
| `/scenes/<id>` | Edit tab | Add all Tags from all Markers | this | `tags:marker>scene` |
| `/scenes/<id>` | Edit tab | Add all Tags from all Performers | this | `tags:performer>scene` — **hidden when MPTTS shows its own** |
| `/scenes/<id>` | Edit tab | Add Tags from Studio | this | `tags:studio>scene` |
| `/scenes/<id>` | Edit tab | Add all Tags from all Groups | this | `tags:group>scene` |
| `/scenes/<id>` | Edit tab | Add all Tags from all Performers | MPTTS | its only scene button |
| `/scenes/<id>` | Groups tab | Add *all\|common* Tags to all Groups from their Scenes | this | `tags:scene>group` — under the tab strip |
| `/galleries/<id>` | Edit tab | Add all Perfs from all Images | this | `performers:image>gallery` |
| `/galleries/<id>` | Edit tab | Add all Tags from all Images | this | `tags:image>gallery` |
| `/galleries/<id>` | Scenes tab | Add Perfs to all Scenes | this | `performers:gallery>scene` — under the tab strip |
| `/galleries/<id>` | Images tab | Add Tags to all Images | this | `tags:gallery>image` — under the tab strip |
| `/images/<id>` | Edit tab | Add all Tags from all Galleries | this | `tags:gallery>image` |
| `/images/<id>` | Galleries tab | Add Perfs to all Galleries | this | `performers:image>gallery` — under the tab strip, if Image has one |
| `/images/<id>` | Galleries tab | Add Tags to all Galleries | this | `tags:image>gallery` — under the tab strip, if Image has one |
| `/groups/<id>` | Edit tab | Add *all\|common* Tags from all Scenes | this | `tags:scene>group` |
| `/groups/<id>` | Edit tab | Add Tags from Studio | this | `tags:studio>group` |
| `/groups/<id>` | Edit tab | Add all Tags from all Performers | this | `tags:performer>group` |
| `/groups/<id>` | Edit tab | Add all Tags from all Markers | this | `tags:marker>group` |
| `/groups/<id>` | Edit tab | Add *all\|common* Tags from all Sub-groups | this | `tags:subgroup>group` |
| `/groups/<id>` | Detail | Add Tags to all Scenes | this | `tags:group>scene` |
| `/groups/<id>` | Detail | Add *all\|common* Tags to all Containing Groups from their Sub-groups | this | `tags:subgroup>group` |
| `/performers/<id>` | Detail | Add Tags to all Scenes | this | `tags:performer>scene` — **hidden when MPTTS shows its own** |
| `/performers/<id>` | Detail | Add Tags to all Groups | this | `tags:performer>group` |
| `/performers/<id>` | Detail | Add Tags to all Scenes | MPTTS | its only performer button |
| `/studios/<id>` | Detail | Add Tags to all Scenes | this | `tags:studio>scene` |
| `/studios/<id>` | Detail | Add Tags to all Groups | this | `tags:studio>group` |

*all\|common* is whichever the path is set to in Path Settings; the button's label
changes with it. The captions above are the base text: a button whose click opens the review dialog
also shows a trailing **"..."** — every Detail-view (source-side) button always, and every Edit-tab
button while **Save Immediately** is on or staging is unavailable.

**Source buttons sit in one of two places, and the page decides which.** Performer and Group show a
row of actions on their detail view (beside Delete), and the button joins it. Scene and Gallery show
no such row at all — just a tab strip (Details / File Info / Chapters / Edit) — so the
button gets a small row of its own directly under that strip. Image follows whichever shape it turns
out to have.

A button in that row **appears only while the tab showing its targets is open** — the
Groups tab for "…to all Groups", the Images tab for "…to all Images". Where a page has no tab for
that type, the button shows on every tab rather than disappearing; a missing button is the worse
mistake. Buttons in a detail action row (Performer, Group) are not affected.

**Anything this plugin writes outside the task dialog refreshes what it wrote.** The groups (or
images, or scenes) it updated are dropped from Stash's client-side cache, so the panel you are
looking at redraws with the new tag counts instead of the ones it loaded before. No page reload —
a button keeps its "Added N". This covers **both automatic modes** as well as both buttons, so an
automatic propagation never leaves the page you have just saved showing what it read a moment
earlier. Only entities actually written are dropped: refetching a panel a run did not change is the
one cost this has.

### What a source-side button actually does

This is the one thing worth reading twice, because the obvious reading is wrong.

**It does not copy the tags of the entity you are standing on.** It finds the targets that entity
reaches, then rebuilds *each of those targets from all of their own sources*. On a scene, "Copy
common Tags to all Groups from their Scenes" updates every group the scene belongs to, and each group
is computed from **every scene in it** — this one is merely how the groups were found.

With **common tags only** on, a tag is copied only if *every* scene in that group carries it. So a
tag unique to the scene you are on adds nothing, and the button can honestly report "No changes".
Turn the setting off and the label becomes "Add all Tags…", the union, and it lands.

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

**Reload plugins cannot replace the script your browser is already running.** It re-reads the
plugin folder on the server; the JavaScript in your open page was fetched when the page loaded and
stays until the page reloads. The version beside the plugin's name in the settings list settles
nothing either — it comes from the manifest, which goes current the instant you reload plugins even
when the running script is older.

The plugin says so when that happens, in red, in two places — both naming the version you are
running, the version installed, and the fix:

- **Settings → Plugins → ᝯㄝₓ Propagate Tags and Performers to Related Entities**, at the top of the
  group and above the description, so it shows even with the group collapsed. It disappears once the
  two agree.
- **The dialog**, in a box of its own under the title. **Proceed stays disabled** while they
  disagree, since the plan would otherwise be computed by the code you replaced, and the warning
  goes into the log so **Copy log** carries it.

Press **F5** first — Stash serves plugin scripts so that a normal reload picks up a changed file —
and keep **Ctrl+Shift+R** (**Cmd+Shift+R**) for when it does not. If neither works, check the new
`.js` really is in your plugins folder: a file that was never copied cannot be refreshed into
existence. The console prints the version it is actually running at every page load
(`[ptp2re] PropagateTagsAndPerformers.js <version> loaded`), which is the one number a cached script
cannot fake.

None of this catches an edit made without changing the version: both numbers stay equal and there
is nothing to compare.

## Settings

All under **Settings → Plugins → ᝯㄝₓ Propagate Tags and Performers to Related Entities**. Each
description shows one line on the page; hover it, or the setting's name, for the rest.

**Running it** — whether the manual buttons appear, whether they save or stage for review, and the
two automatic modes (react when the *target* is saved, or when a *source* is saved). The
source-side mode fans out: saving one performer can rewrite every scene they appear in.

**Paths** — one row, listing the paths that are on in three columns and holding the button that
opens the **Path Settings** dialog. All thirteen are in that dialog, in two columns read top to bottom — which is
the order a run walks them in, and that order decides what one run reaches. Each is *Off* or *On*,
and the two group aggregations offer *Common tags only* as a third choice. The setting itself is one line of text (`tags:studio>scene=ON,
tags:scene>group=COMMON`) and can be typed by hand — it is read forgivingly, in any order and any
case, and rewritten in canonical form. A path nobody names is off. Upgrading from an earlier
release carries your existing path toggles over untouched.

**Exclusion filters** — skip entities carrying a tag you name, skip entities marked Organized,
never copy tags set to *Ignore auto tag*, and never copy tags carrying a custom field you name.

The **Paths** row leaves a value it cannot read exactly as it is, and says so in red rather than
reporting "No paths enabled" — the two look the same from the list and are not the same thing. A
value it reads only in part is left alone too, with the paths it *did* read shown above the warning;
only what it understands completely is ever tidied into canonical form. Pressing **Save** in the
dialog replaces the whole setting with what the selectors show, which the dialog says before you do
it.

If you also run `MergePerformerTagsToScenes`, these are the same four questions it asks, worded for
a wider set of entities — so any of them you have **never set here** takes that plugin's answer the
first time this one loads, and is saved here as yours. It is asked once. From then on this is where
you change it, and a value you have set is never replaced — including a toggle you have switched
back off, which is why the rule is about whether you have *touched* the setting rather than what it
currently says.

**Logging** — write every copy to the browser console (F12 → Console; **not** the Stash server log
or the Logs page — this is a UI plugin and cannot write there).

Four of those switches are not Stash's blue. **Save Immediately** and the two
automatic modes are **amber**, the plugin's colour for a setting that makes it write without
showing you a plan first; the logging switch is **teal**, for one that only talks to the console.
Everything else stays blue. In **Settings → Tasks → Plugin Tasks** the propagate task is amber for
the same reason, and **Path Settings** is teal — it writes a setting, not your library.

## Relationship to the other plugins in this repo

- **`MergePerformerTagsToScenes`** implements one of these paths. Both can be installed and enabled
  at once; both only ever add, so the overlap is redundant work rather than wrong data, and the
  task dialog names it in the log when both are covering `Tags: Performers → Scenes`. This works for
  any future plugin doing the same kind of copy too, not just this one by name. Where both plugins'
  manual buttons land in the same row (Scene, Performer), the two agree on a fixed relative order,
  both anchored the same way: between Save and Delete where both exist, before Save where only Save
  does — never displacing either from the row, rather than whichever plugin's eligibility check
  happens to finish first.
- **`NormalizeParentTags`** walks the *tag hierarchy* instead of entity relationships, so the two
  compose rather than overlap: propagate tags onto an entity, then prune or roll up the parents. Its
  automatic modes and this plugin's stand down for one another while either is writing in bulk. And
  since eleven of these thirteen paths add tags, the task dialog also warns when NormalizeParentTags
  is set to prune or roll up an entity type automatically — naming which direction, and what it
  would do to what this run adds — exactly as `MergePerformerTagsToScenes`' own dialog already
  does.
- **`CustomFieldsBulkEditor`** does not overlap at all: it edits *custom fields*, which nothing here
  reads or writes, and it puts its control in the list view's "..." menu rather than in an entity's
  action row. The one thing they share is the lease — this plugin's automatic modes stand down while
  that one is applying, and its dialog says so if you open it while a run here is writing.

## Licence

Same terms as the rest of this repository.
