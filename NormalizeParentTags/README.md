# Normalize Parent Tags

> ## ⚠ Back up your database before the first run
>
> These tasks rewrite tag assignments across your entire library, and **Stash has no undo**. A
> misconfigured Prune can strip a tagging scheme you spent years building, and the only way back
> is restoring your database file. Stop Stash, copy `stash-go.sqlite` (next to your `config.yml`)
> somewhere safe, start Stash again — then run the task. Review the dry-run log properly the
> first time; that is what it is for.

> **Requires Stash 0.31.0 or newer.** Tag custom fields (two of the exclusion filters) and the
> `organized` flag on studios both depend on it.
>
> **Version 0.1.2 is a first release.** It has automated tests behind it, but it has not been
> through a long life in other people's libraries — which is another reason to take the backup
> above and to read the review log before pressing Proceed.

A front-end-only Stash plugin that adds two library-wide tasks to **Settings → Tasks → Plugin
Tasks**:

- **Prune Parent Tags from Entities** — removes every tag on an entity that another tag on the
  *same* entity already implies.
- **Roll Up Parent Tags onto Entities** — adds every parent tag, recursively, of the tags already
  on the entity.

Both open a dialog that lists every change *before* anything is written. Nothing is saved until
you press **Proceed**.

## Why

Stash tag hierarchies imply downward. If `Blonde` has the parent `Hair Colour`, then an entity
tagged `Blonde` is already a `Hair Colour` — storing both is redundant. Which of the two you want
depends on how you search and browse:

- If you rely on Stash's hierarchical filters, keep only the most specific tag: **Prune**.
- If you want every level materialized on the entity (for exports, for flat filters, for other
  tools reading your library), keep them all: **Roll Up**.

**Prune** keeps every tag that has no descendant of its own on the entity. That means all leaf
tags, and also any intermediate tag whose children — direct or further down — are absent. Only
tags genuinely superseded by something more specific on the same entity are removed.

The two tasks are opposites: running Roll Up and then Prune gets you back where you started
(apart from anything an exclusion filter protected).

Neither task ever modifies the tag hierarchy itself. Tags, their parents and their children are
left exactly as they are — only which tags sit on which entity changes.

## The two-step dialog

Running a task opens a dialog that works in two phases.

**Phase 1 — review.** The plugin scans every enabled entity type and shows you a running count
and a log of every change it *would* make:

```
[REMOVE] Scene "My Scene" (123) - Tag "Hair Colour" (45) - due to "Platinum" (47)
[REMOVE] Image "IMG_0042" (900) - Tag "Hair Colour" (45) - due to "Blonde" (46)
[ADD]    Performer "Jane" (7) - Tag "Hair Colour" (45) - due to "Platinum" (47)
[ERROR]  Scenes page 5 - findScenes failed: ...
[INFO]   2 tag(s) to remove: "Blonde" (46) x1, "Hair Colour" (45) x250
```

The last line of each phase lists **every distinct tag the run touches**, with the number of
entities each one lands on. It is the quickest way to see whether a run is about to do what you
expect: the per-entity lines say what happens to one gallery, this says which tags are in play
across the whole library. Phase 2 prints its own version counting what was actually written, so
if a request failed the two lines will not match.

The tags are listed in the same order Stash itself sorts them — by **Sort Name** where a tag has
one, otherwise by name, ignoring case and treating numbers as numbers (`Volume 2` before
`Volume 10`) — so the line reads straight against your tag list without re-sorting it by eye.

The **due to** tag is the reason the change was planned: the tag already on the entity that
implies the one being written. Where several tags on the entity imply it, the lowest one in the
hierarchy is named — for Prune that tag is always one that survives the run, so the line reads as
"this is redundant *because of* that". Tags at the same level are tie-broken on the lower tag id
so that repeated runs log identically.

Nothing has been written at this point. **Cancel** walks away with your library untouched.

**Phase 2 — apply.** **Proceed** performs the changes and continues the log with what was
actually written, plus any errors. The log is scrollable throughout, **Copy log** puts the whole
thing on the clipboard, **Rescan** starts a fresh review pass without closing the dialog, and
**Close** dismisses it.

**Rescan** matters more than it looks. The plan is worked out in full before the first change is
written, so anything that alters tags *while* phase 2 runs — another browser tab, a scan, the
sibling plugin described below — is not in the plan being applied. Rescanning until the plan
comes back empty is how you know the library has settled.

On a large library the log can run to many thousands of lines. Only the most recent are kept on
screen (the dialog says how many are hidden); **Copy log** always copies all of them.

**Clear log** empties it — both what is on screen and what **Copy log** would export — which is
useful for reading the next Rescan against a clean slate. It never touches the plan, so
**Proceed** still applies everything that was found. Once changes have actually been written the
log is the only record of what happened, so the button asks for a second click before discarding
it; copy the log first if you want to keep it.

## Entity types

Every type is **off** until you enable it in **Settings → Plugins → Normalize Parent Tags**.
Stash has no default value for a plugin setting, and since Prune deletes tag assignments, opting
in per type is deliberate.

| Setting | Covers |
| --- | --- |
| **Include Performers** | Performers |
| **Include Studios** | Studios |
| **Include Groups** | Groups — called Movies before Stash 0.28 |
| **Include Galleries** | Galleries |
| **Include Scenes** | Scenes |
| **Include Images** | Images — usually the biggest type, and the slowest to scan |
| **Include Scene Markers** | Scene markers — see below |

They are listed on the settings page in that same order, which is the order enabled types are
always processed in, whichever order you switch them on: **performers → studios → groups →
galleries → scenes → images → markers**. Performers lead because of the sibling-plugin
interaction described at the end of this file.

**Scene markers** work slightly differently, because a marker has a required *primary tag* on top
of its ordinary tags. The primary tag is never added and never removed — but it does count as
present, so a marker whose primary tag is `Blonde` will have `Hair Colour` pruned from its other
tags.

## Exclusion filters

Two filters protect whole entities:

- **Exclude entities carrying this tag** — enter a tag name; any entity carrying it is left
  alone. Matched by exact name, case-sensitive. The tag must be on the entity directly — carrying
  a child of it does not count. For markers, having it as the primary tag also excludes.
- **Exclude entities marked as Organized** — skips any entity with the Organized flag set. In
  Stash 0.31 only **scenes, images, galleries and studios** have that flag; performers, groups
  and markers have none, so this setting cannot protect them. If a future Stash adds the flag to
  more types, they are covered automatically.

Five more protect individual tags, split by direction so you can, for example, let a tag be added
but never removed, plus one that sets how the two name filters are written:

- **Never add or remove tags set to Ignore auto tag** — applies in both directions. Such tags
  still count as present, so they can still make their own parents redundant.
- **Never add tags whose name contains (space separated substring)** / **Never remove tags whose
  name contains (space separated substring)** — enter one or more substrings separated by spaces;
  a tag whose name contains **any** of them anywhere is skipped. Case-sensitive, and any Unicode
  character works, which makes it a good fit for namespace markers in tag names. Because spaces
  separate the substrings, a single substring cannot contain one.

  > **Upgrading from 0.4.x:** a value that used to be a phrase, say `Hair Colour`, is now read as
  > the two substrings `Hair` and `Colour` and will match more tags than before. Check these two
  > settings after updating if you had spaces in either — or set a separator, below, and the
  > phrase works again as it did.
- **Separator for the two "name contains" settings** — leave empty to separate those substrings on
  spaces. Enter any character instead — a comma, a pipe, or any Unicode character you never use in
  tag names — and the substrings are separated on that, which is how a substring can then contain a
  space: with a separator of `,`, the entry `Body Art, Art Deco` is two substrings rather than
  four. The separator is matched literally, so punctuation needs no escaping, and spaces around
  each substring are trimmed.
- **Never add tags marked via a Custom Field** / **Never remove tags marked via a Custom Field** —
  enter a custom field name. **Only the presence of the field matters** — the value is never
  looked at, so any value at all (including a blank one) applies the exclusion. To lift it,
  remove the field from the tag rather than setting it to something falsy.

Two things worth knowing about the tag-level filters:

- Skipping a tag does not stop the climb. If Roll Up is not allowed to add `Hair Colour`, it
  still adds `Hair Colour`'s own parents. The filters describe a tag, not a wall in the hierarchy.
- Protecting a parent from removal never changes what happens to anything else — the child that
  made it redundant is unaffected either way.

## Installation

0. Check your Stash version is **0.31.0 or newer** (**Settings → System**, or the footer).
1. Find your Stash plugins directory: the `plugins` folder next to your `config.yml` (the same
   place as your Stash database, shown at the top of **Settings → System**). Create it if it does
   not exist.
2. Copy the whole `NormalizeParentTags` folder into it:
   ```
   <stash-config-dir>/plugins/NormalizeParentTags/NormalizeParentTags.yml
   <stash-config-dir>/plugins/NormalizeParentTags/NormalizeParentTags.js
   <stash-config-dir>/plugins/NormalizeParentTags/manifest
   ```
3. In Stash, go to **Settings → Plugins** and click **Reload plugins** (or restart Stash).
4. Refresh your browser (F5) so the plugin's JavaScript is loaded.
5. Enable the entity types you want in **Settings → Plugins → Normalize Parent Tags**.

## How it works

Pure client-side JavaScript (`ui.javascript` in the manifest). It calls Stash's `/graphql`
endpoint from your browser using your existing logged-in session — no server-side plugin runtime,
no Python.

The two tasks are declared in the manifest so that Stash lists them natively under **Plugin
Tasks**, but they are handled entirely in the browser: the click is caught before it can queue a
server-side job, which is why the dialog appears instead of a job in the queue.

**Keep the tab open.** The run lives in the page. Navigating away or closing the tab stops it —
mid-run, that means the changes already written stay written and the rest are never made.

## Notes / limitations

- Both tasks always cover your whole library. Filters and selections in the scene, image or
  performer lists are not read.
- Changes are written as add/remove deltas rather than as a wholesale rewrite of each entity's
  tag list, so a tag added from another browser tab between the review and the apply is not
  reverted. It may, however, mean the applied result differs slightly from the reviewed plan.
- Entities that need the same change are updated together in one request, so a run makes far
  fewer requests than it lists changes.
- If a request fails, the entities in it are reported as errors and are not counted as changed;
  the rest of the run continues.
- Cycles in a tag hierarchy are impossible to create through Stash's UI or API, which rejects
  them. If one is ever found anyway, the tags involved are reported as an error and skipped —
  under the plain rule, every tag in a cycle implies every other one, so all of them would
  otherwise be deleted.
- Installing this plugin does not undo anything you have already tagged. It only ever acts when
  you click one of the two tasks and then press Proceed.

## If you also use Merge Performer Tags To Scenes

That plugin's two auto-merge settings react to *this* plugin's writes, because from its point of
view they look like any other edit:

- **Auto Merge On Scene Updates** — every scene this plugin touches gets its performers' tags
  merged back in, parents included.
- **Auto Merge On Performer Updates** — every performer this plugin touches has their tags pushed
  out to *all* of their scenes.

Neither plugin is misbehaving; they pull in opposite directions by design. So the two are built
to cooperate: **while this plugin is applying changes, it asks Merge Performer Tags To Scenes to
stand down, and it does.** Auto-merge resumes the moment the apply finishes — including if it
fails, if you press Stop, or if you close the tab mid-run. Nothing is switched off in the
settings, and other browser tabs are unaffected.

If either auto-merge setting is on when you start a run, the dialog tells you which, and whether
the installed version is new enough to stand down. If it is older than the cooperation protocol,
you have two options: turn its auto-merge off for the duration of the run, or press **Rescan**
afterwards and apply the second, much smaller plan. Performers are processed first either way, so
that the wider scene-fanning merge happens before the scene and image passes rather than after
them. If both auto-merge settings are off, there is no interaction at all.

This only covers plugins running in your browser. A plugin with server-side **hooks** — the
Python or executable kind that Stash runs on `Scene.Update.Post` and similar — runs inside Stash
itself, cannot be asked to stand down from here, and will react to this plugin's changes like any
other edit. If you have one that touches tags, disable it for the run.
- Settings are read at the start of each run, so a change takes effect on the next run without a
  page reload.
